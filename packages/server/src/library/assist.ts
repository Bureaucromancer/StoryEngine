// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Accounts } from '../auth/accounts.js';
import type { Config } from '../config.js';
import type { Layout } from '../storage/layout.js';
import { readBindings, readSystemBindings } from '../providers/bindings.js';
import { resolveConnections } from '../providers/connections.js';
import { resolveRole } from '../providers/roles.js';
import type { ProviderFactory } from '../providers/factory.js';

/**
 * ***The field assist contract's server half*** —
 * [10 §11.1](../../../../docs/design/10-ui-surfaces.md),
 * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * [10 §11](../../../../docs/design/10-ui-surfaces.md) opens by saying what this
 * is for: *"Every text field can be generated, refined and reverted…
 * Retrofitting these field by field produces exactly what all three sources
 * have: assistance in the two or three places someone got round to, and a plain
 * textarea everywhere else. They should be **primitives the editors are built
 * from**, so that 'does this field have AI assist?' is never a question anyone
 * asks."* This is the one endpoint behind that primitive.
 *
 * ***Two operations and not four***, because two of §11.1's four never reach a
 * server. **Generate** writes a field from nothing; **refine** rewrites it
 * against a guidance string — *"'make it darker' is the whole interaction, and
 * without it the only recourse is regenerate-and-hope"*. **Revert** and
 * **accept as-is** are the client holding a previous value, and that is not an
 * oversight: §11.1's *"nothing may require a model call to proceed, ever"* is
 * only true if the escape hatch lives on the side with no endpoint to lose.
 *
 * ***Context is the part §11.1 says gets skimped, so it is what this takes most
 * seriously.*** *"'Generate an appearance' must see the actor's name, summary,
 * tags and the treatment it is being authored against. An assist that receives
 * only the field label produces generic slop and trains people not to use it."*
 * So the caller sends **the whole working draft** — not the saved object, which
 * would be blind to the three things the person just typed, and not the field,
 * which is the failure the sentence names.
 *
 * ***No session, and therefore no preset, no lore and no cast.*** A library
 * object is authored outside any story, so there is no assembly to run: this
 * resolves the account's `prose` role, renders one instruction, and calls.
 * *That is a deliberate floor rather than a first draft.* The alternative — an
 * assist that reached for whichever session happened to be open — would make
 * the quality of a library edit depend on a piece of state the author is not
 * looking at and cannot reason about.
 *
 * ***`prose` rather than `fast`, and [P7.5] is why.*** `resolveRole` has no
 * cross-role fallback: a role nobody bound resolves `unbound` and the call
 * fails. Nothing in this build binds anything but `prose` — no install default,
 * no wizard, no route that would suggest it — so asking for the role this
 * *should* use would mean an assist button that fails on every stock install.
 * The finding is bigger than this file and is recorded at P7.5.
 */

export interface AssistContext {
  layout: Layout;
  accounts: Accounts;
  providers: ProviderFactory;
  config: Config;
}

export interface AssistRequest {
  account: string;
  /** What kind of object is being edited — *actor*, *lorebook*. */
  subject: string;
  /** The field's dotted path, which is also its key in `generated`. */
  path: string;
  /** What the editor calls the field, in the author's language. */
  label: string;
  /** The working draft, which is what the person is looking at. */
  draft: unknown;
  /** Absent for *generate*; the free-text steer for *refine*. */
  guidance?: string;
  /** The value being refined. Absent for *generate*. */
  current?: string;
  signal?: AbortSignal;
}

export type AssistResult =
  | { ok: true; text: string; model: string; seed: string }
  | { ok: false; reason: 'not-bound' | 'no-answer' };

/**
 * The instruction, assembled from the four things a field assist knows.
 *
 * **One message rather than a fake conversation.** This is a single-turn
 * instruction; three roles pretending to a history the model never had would be
 * ceremony, and the one thing it would buy — a system block — is not worth a
 * shape that says something untrue about how the feature works.
 *
 * *The draft goes in as JSON.* It is what the object **is**, the schemas are
 * public ([19 §4]), and a model that can read the shape can see that `summary`
 * is empty where `name` is not — which is the context §11.1 asks for and which
 * a prose summary of the object would flatten.
 */
function instruction(request: AssistRequest): string {
  const lines = [
    `You are helping an author write one field of a ${request.subject} in their library.`,
    `The field is "${request.label}" (${request.path}).`,
    '',
    'Here is the whole object as it currently stands, including the fields they',
    'have already written. Use it: what you write has to fit what is there.',
    '',
    JSON.stringify(request.draft, null, 2),
    '',
  ];

  const guidance = request.guidance?.trim() ?? '';
  if (guidance !== '') {
    lines.push(
      'This is what the field says now:',
      '',
      request.current ?? '',
      '',
      `Rewrite it, following this instruction from the author: ${guidance}`,
    );
  } else {
    lines.push(`Write the "${request.label}" field.`);
  }

  /**
   * ***The output contract, and it is most of why this is a prompt rather than
   * a bare question.*** What comes back goes straight into a text input, so a
   * preamble, a heading or three options to choose from is not a worse answer —
   * it is an answer the field cannot hold, and the person's only recourse would
   * be to edit the model's framing out by hand every time.
   */
  lines.push(
    '',
    'Reply with the field’s new text and nothing else. No preamble, no',
    'heading, no quotation marks around the whole of it, and no alternatives to',
    'choose between.',
  );
  return lines.join('\n');
}

export async function assistField(
  context: AssistContext,
  request: AssistRequest,
): Promise<AssistResult> {
  const held = await context.accounts.find(request.account);
  const { usable } = await resolveConnections(context.layout, request.account, {
    privateConnections: held?.capabilities.privateConnections ?? false,
  });
  const resolution = resolveRole({
    role: 'prose',
    bindings: await readBindings(context.layout, request.account),
    defaults: await readSystemBindings(context.layout),
    usable,
  });
  if (!resolution.ok) return { ok: false, reason: 'not-bound' };

  const provider = context.providers(resolution.connection);
  const text = instruction(request);
  const result = await provider.generate({
    modelId: resolution.modelId,
    // `fromBlocks` is not optional and this is the honest value for it: the
    // message did not come from a preset's blocks, it came from this file.
    messages: [{ role: 'user', content: text, fromBlocks: ['se.assist.field'] }],
    params: { temperature: 0.9, maxTokens: 600 },
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });

  const answer = result.text.trim();
  if (answer === '') return { ok: false, reason: 'no-answer' };
  /**
   * ***The seed is the prompt, not a number***, and [10 §11.2] is why: the
   * provenance record's `seed` is *"the input the generation ran from"*, and
   * what it buys is honest disclosure — *"this was model-written, from this
   * prompt, with this model"*. A random integer would answer a question about
   * reproducibility that a text endpoint cannot answer anyway; the prompt
   * answers the question that was actually asked.
   */
  return { ok: true, text: answer, model: resolution.modelId, seed: text };
}
