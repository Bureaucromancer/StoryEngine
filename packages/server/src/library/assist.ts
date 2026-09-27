// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Candidate, StepDefinition } from '@storyengine/sdk';
import { remedyFor, type ErrorClass, type FailureRemedy } from '@storyengine/shared';

import type { Accounts } from '../auth/accounts.js';
import type { Config } from '../config.js';
import type { Layout } from '../storage/layout.js';
import { readBindings, readSystemBindings } from '../providers/bindings.js';
import { resolveConnections } from '../providers/connections.js';
import type { ProviderFactory } from '../providers/factory.js';
import { readTaskRoles } from '../providers/task-roles.js';
import {
  CallFailed,
  Cancelled,
  performCall,
  RoleUnresolved,
  WindowTooSmall,
} from '../turns/calls.js';
import { fromModelCall, recordUsage } from '../usage/log.js';

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
 * resolves the role the account chose for assist (`prose` unless it chose
 * otherwise, `providers/task-roles.ts`), renders one instruction, and calls.
 * *That is a deliberate floor rather than a first draft.* The alternative — an
 * assist that reached for whichever session happened to be open — would make
 * the quality of a library edit depend on a piece of state the author is not
 * looking at and cannot reason about.
 *
 * ***`prose` rather than `fast`, and [P7.5] is why.*** `resolveRole` has no
 * cross-role fallback: a role nobody bound resolves `unbound` and the call
 * fails. ~~Nothing in this build binds anything but `prose` — no install default,
 * no wizard, no route that would suggest it —~~ *Corrected 2026-09-27, with
 * [25 C15](../../../../docs/design/25-open-questions.md): the first-run offer
 * does bind `fast` and the others, but only on an install whose admin accepted
 * it.* So asking for the role this *should* use would still mean an assist
 * button that fails on every install that declined it. The finding is bigger
 * than this file and is recorded at P7.5.
 *
 * ***`prose` by default, and the account's choice since 2026-09-27.*** Until C15
 * is decided the person chooses which of their roles this asks for
 * (`providers/task-roles.ts`, set on the same settings pane as the bindings), so
 * somebody who has bound `fast` to a cheap model can point assist at it without
 * waiting on a decision about every role at once. The default is the role that
 * resolves on every install.
 *
 * ***What it spent is recorded, and nothing else is.*** The route writes no
 * object, no provenance and no history ([10 §11.4]: *"They produce no turn
 * record"*), but the call cost money whether or not the person keeps the
 * answer, so its figures go to the account's usage log (`usage/log.ts`) — an
 * assist somebody rejected is the one the provenance would never have seen.
 */

export interface AssistContext {
  layout: Layout;
  accounts: Accounts;
  providers: ProviderFactory;
  config: Config;
  /**
   * What the last update check learned about this server's internet, read when
   * an assist fails — the runner's `connectivity` and impersonation's `online`,
   * for the remedy's one question about the network.
   */
  online?: () => boolean | null;
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
  | { ok: false; reason: 'not-bound' | 'no-answer' | 'window-too-small' | 'cancelled' }
  /**
   * The endpoint failed, as a class and a remedy — the same answer a failed
   * turn and a failed draft give (2026-09-27). The endpoint's own words are
   * for the log line and go no further.
   */
  | {
      ok: false;
      reason: 'provider-failed';
      class: ErrorClass;
      remedy: FailureRemedy;
      detail?: string;
    };

/**
 * ***A call like every other call*** (2026-09-27).
 *
 * The assist asked the provider directly — `provider.generate` with no
 * `performCall` around it — so it was the one call in the build with no idle
 * bound, no retry for a busy endpoint, and no classification: a wrong key or a
 * model server that was down reached the route as an exception and the person
 * as a bare 500, and a person who closed the editor left the call running,
 * because the route handed it no signal. Going through `performCall` gives it
 * [21 §4]'s bound, the ladder and the classes, and the route passes the signal
 * that ends when the person leaves.
 *
 * *A step definition for a call that is not a step*, because that is what
 * `performCall` takes and every field of it is true here: its role is
 * `prose`, which the call replaces with the account's choice (below), it
 * contributes the text a person will
 * read, and it writes no channel — so its purpose derives to `prose` like a
 * narration's.
 */
const ASSIST_STEP: StepDefinition = {
  id: 'se.assist.field',
  stage: 'generate',
  reads: [],
  writes: [],
  contributes: 'messages',
  callKind: 'assist',
  when: { when: 'cadence', everyNTurns: 1 },
  failure: 'abort',
  role: 'prose',
};

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
  const text = instruction(request);
  /**
   * One candidate, required, and the only one: the message did not come from a
   * preset's blocks, it came from this file, and a budget that dropped it would
   * be asking the model nothing.
   */
  const ask: Candidate = {
    id: 'se.assist.field',
    source: { kind: 'step', stepId: ASSIST_STEP.id },
    reason: `a draft of the ${request.label} field, asked for by its author`,
    role: 'user',
    text,
    required: true,
  };
  /**
   * ***The role is the account's to choose*** — `task-roles.json`, a stopgap
   * for [25 C15]. The step says `prose` because that is what it asked for
   * before anyone could say otherwise; the call asks for whichever role the
   * person picked in settings.
   */
  const { assist: role } = await readTaskRoles(context.layout, request.account);

  let answer: string;
  let model: string;
  try {
    const outcome = await performCall(
      {
        definition: { ...ASSIST_STEP, role },
        bindings: await readBindings(context.layout, request.account),
        defaults: await readSystemBindings(context.layout),
        usable,
        providers: context.providers,
        config: context.config,
        notFilled: [],
        signal: request.signal ?? new AbortController().signal,
        // Nothing is recorded as a turn or a job: an assist writes neither, so
        // there is no checkpoint for either seam to be about. What it spent is
        // recorded below, in the usage log.
        onCallAssembled: () => undefined,
        onProgress: () => undefined,
      },
      { params: { temperature: 0.9, maxTokens: 600 } },
      [ask],
    );
    /**
     * **Before the empty-answer check, not after it.** A reply with nothing in
     * it still cost what the provider says it cost, and `no-answer` is the case
     * a person is most likely to press the button again over.
     */
    await recordUsage(
      context.layout,
      request.account,
      fromModelCall(outcome.call, `assist:${request.path}`, { subject: request.subject }),
    );
    answer = outcome.text.trim();
    model = outcome.call.resolved.modelId;
  } catch (error) {
    if (error instanceof RoleUnresolved) return { ok: false, reason: 'not-bound' };
    if (error instanceof WindowTooSmall) return { ok: false, reason: 'window-too-small' };
    if (error instanceof Cancelled) return { ok: false, reason: 'cancelled' };
    if (error instanceof CallFailed) {
      return {
        ok: false,
        reason: 'provider-failed',
        class: error.class,
        remedy: remedyFor({
          reason: error.class,
          endpoint: error.endpoint,
          stalled: error.stalled,
          online: context.online?.() ?? null,
        }),
        ...(error.detail === undefined ? {} : { detail: error.detail }),
      };
    }
    throw error;
  }

  if (answer === '') return { ok: false, reason: 'no-answer' };
  /**
   * ***The seed is the prompt, not a number***, and [10 §11.2] is why: the
   * provenance record's `seed` is *"the input the generation ran from"*, and
   * what it buys is honest disclosure — *"this was model-written, from this
   * prompt, with this model"*. A random integer would answer a question about
   * reproducibility that a text endpoint cannot answer anyway; the prompt
   * answers the question that was actually asked.
   */
  return { ok: true, text: answer, model, seed: text };
}
