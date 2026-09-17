// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Candidate } from '@storyengine/sdk';

import { collectCandidates } from '../assembly/collect.js';
import type { Accounts } from '../auth/accounts.js';
import type { Config } from '../config.js';
import type { ProviderFactory } from '../providers/factory.js';
import { loreReport } from '../retrieval/blocks.js';
import { retrieve } from '../retrieval/retrieve.js';
import { Rng } from '../rng/rng.js';
import type { SessionContext } from '../sessions/store.js';
import { readParty } from '../sessions/cast.js';
import { performCall, RoleUnresolved } from './calls.js';
import { gatherAssemblyInputs } from './gather.js';
import { previewStepFor } from './preview.js';

/**
 * ***The model writes your next message, as your character*** —
 * [06 §3.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.4](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §3.1 makes it small on purpose: *"impersonation is a per-turn override, not a
 * separate feature. SillyTavern's impersonate — the model writes your next
 * message as your persona, and you edit or accept it — is simply a
 * `player`-controlled member being model-authored for one turn. Same mechanism,
 * flipped for a turn."*
 *
 * ***The fork §3.1 leaves, and the arm this stage takes.*** Its three details
 * are not all satisfiable by one implementation, and the tension is worth
 * stating rather than resolving quietly:
 *
 * - *"It is a draft, not a commitment. The output lands in the input box,
 *   editable, and is not sent until the user sends it. **Anything else takes
 *   authorship away rather than assisting it.**"*
 * - *"It is a `generate` step like any other, so it is **recorded in the turn
 *   record** and rewrite/reroll apply."*
 *
 * **A draft that commits a turn is not a draft**, and the first bullet is the
 * one §3.1 argues for rather than merely states — *takes authorship away* is the
 * sentence the whole feature is measured against. So **nothing is committed**:
 * this assembles and dispatches and hands the words back, and the second
 * bullet's two promises are kept the two ways that remain available. *Recorded*
 * is the job log, which carries the call the way it carries every other model
 * call this build makes. *Re-rollable without ceremony* is pressing the button
 * again — which is the literal reading, costs nothing, and is what a person
 * dissatisfied with a draft actually does.
 *
 * *The alternative, recorded so it can be re-argued rather than rediscovered*: a
 * turn committed off the path, which would put the draft in the workbench with
 * its prompt and its block table. It is a real gain and it buys a permanent
 * cost — every impersonation leaves a sibling in the tree, visible to
 * `readTranscript`'s sibling map as a line the player might have taken and did
 * not. **A feature for when you are stuck should not make the tree noisier the
 * more you use it.**
 *
 * ***Built on `preview.ts`'s gather rather than on the runner***, and the reason
 * is [P3 §1.6]'s: that file exists because *assemble-without-dispatch* is a seam
 * worth having, and this is the same seam with a dispatch on the end. The runner
 * commits, advances a head, writes segments and announces — every one of which
 * is exactly what a draft must not do.
 */

export interface ImpersonateContext {
  sessions: SessionContext;
  accounts: Accounts;
  providers: ProviderFactory;
  config: Config;
}

export interface ImpersonateRequest {
  account: string;
  sessionId: string;
  /** The head to write against, which is what a submission now would name. */
  parentTurnId: string | null;
  /**
   * Whose words these are.
   *
   * *The persona by default*, which is the SillyTavern case and the one §3.1
   * describes. Naming another member is [06 §8]'s *"more than one member may be
   * `control: 'player'`"* followed through: one human authoring a pair is a
   * normal way to run a story, and a draft affordance that could only ever
   * speak for one of them would be the feature refusing half of its own reason
   * to exist.
   */
  actorId?: string;
  signal: AbortSignal;
}

export type ImpersonateResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'no-prose-step' | 'not-a-player' | 'role-unbound' | 'role-dangling' };

/**
 * The instruction that flips the call.
 *
 * ***The card is the subject, not the audience*** — §3.1's third detail, and the
 * only one of the three that is about the prompt. The ordinary prose call is
 * addressed *to* the narrator *about* these characters; this one asks for one
 * character's own next line, in the first person, and says so as plainly as the
 * schema degrade does.
 *
 * **Appended to the candidates rather than spliced into the messages**, which is
 * `schemaInstruction`'s arrangement and for its reasons: it is estimated,
 * budgeted and recorded like everything else, and the workbench shows a reader
 * the sentence they did not write and why it is there.
 *
 * *`required` so the budget cannot drop it*: a call that lost this block would
 * silently become an ordinary narration and hand somebody the narrator's prose
 * as their own words, which is the one failure this feature must not have.
 */
export function impersonationInstruction(name: string): Candidate {
  return {
    id: 'se.impersonate',
    source: { kind: 'schema' },
    reason: `a draft of ${name}’s next message, asked for by the person who plays them`,
    role: 'system',
    text: [
      `Write ${name}’s next message, as ${name}, in their own voice.`,
      'One message only. No narration of anyone else, no scene description, no commentary.',
      'Do not resolve what happens next — this is what they say and do, nothing more.',
    ].join('\n'),
    required: true,
  };
}

export async function impersonate(
  context: ImpersonateContext,
  request: ImpersonateRequest,
): Promise<ImpersonateResult> {
  const inputs = await gatherAssemblyInputs(
    { sessions: context.sessions, accounts: context.accounts },
    {
      account: request.account,
      sessionId: request.sessionId,
      parentTurnId: request.parentTurnId,
    },
  );

  const step = previewStepFor(inputs.mode);
  if (step === null) return { ok: false, reason: 'no-prose-step' };

  /**
   * ***Only a member the person authors***, which is what makes this an
   * override rather than a way to make anybody say anything. §3.1 defines
   * impersonation as *a `player`-controlled member being model-authored for one
   * turn*; a draft in a companion's voice is not that, it is the narrator's job
   * with the narrator removed.
   */
  const wanted = request.actorId ?? inputs.cast.persona?.actor.id;
  const speaker =
    wanted === undefined
      ? null
      : ([inputs.cast.persona, ...inputs.cast.actors].find(
          (one) => one !== null && one.actor.id === wanted,
        ) ?? null);
  /**
   * `readParty` is the one reader of who authors whom, and it is reused rather
   * than re-derived: it already knows that a session's `persona` is `player` by
   * default without a channel write, which is [06 §8]'s *"default is one member,
   * `control: 'player'`"* and the case every ordinary session is in.
   */
  if (speaker === null || wanted === undefined) return { ok: false, reason: 'not-a-player' };
  const control = readParty(inputs.channels, wanted, inputs.cast.persona?.actor.id ?? null);
  if (control !== 'player') return { ok: false, reason: 'not-a-player' };

  /**
   * The retriever runs and its effects are discarded — `preview.ts`'s rule, and
   * it matters more here than there: a draft that advanced a lorebook's
   * cooldowns would change the turn the person then sends, which is the turn
   * they wanted the draft *for*.
   */
  const lore = retrieve({
    lore: inputs.lore,
    preset: inputs.preset,
    history: inputs.history,
    channels: inputs.channels,
    persona: inputs.cast.persona,
    actors: inputs.cast.actors,
    callKind: step.callKind,
    rng: new Rng(),
  });
  loreReport({
    books: inputs.lore.books,
    scan: lore.scan,
    shelf: lore.shelf,
    unplaced: lore.unplaced,
  });

  const collected = collectCandidates({
    preset: inputs.preset,
    callKind: step.callKind,
    history: inputs.windowed,
    persona: inputs.cast.persona,
    actors: inputs.cast.actors,
    channels: inputs.channels,
    lore: lore.blocks,
    carriers: { treatment: inputs.lore.treatment, books: inputs.lore.books },
    ...(inputs.goals.current === null
      ? {}
      : { goal: { id: inputs.goals.current.id, statement: inputs.goals.current.statement } }),
    dials: inputs.dials,
  });

  try {
    const outcome = await performCall(
      {
        definition: step,
        bindings: inputs.bindings,
        defaults: inputs.defaults,
        usable: inputs.usable,
        cast: inputs.cast,
        providers: context.providers,
        config: context.config,
        preset: { params: inputs.preset.params, budget: inputs.preset.budget },
        notFilled: collected.notFilled,
        refused: lore.refused,
        signal: request.signal,
        // Nothing is committed, so there is nothing for a checkpoint to be
        // about: both seams are the runner's, and this has no job to attach to.
        onCallAssembled: () => undefined,
        onProgress: () => undefined,
      },
      /**
       * ***The candidates go in the third argument and the request stays
       * empty***, which is the seam `performCall` draws and which decides what
       * the record says. `StepCallRequest.candidates` means *this step
       * assembled its own and never consulted the preset* — true of a
       * structured extraction, false here: the preset's producers ran, their
       * refusals are real, and `notFilled` above is an honest list. So the
       * instruction is appended to what the collector produced rather than
       * replacing it, and the request declares nothing.
       */
      {},
      [...collected.candidates, impersonationInstruction(speaker.actor.name)],
    );
    return { ok: true, text: outcome.text };
  } catch (error) {
    if (error instanceof RoleUnresolved) {
      return { ok: false, reason: error.reason === 'unbound' ? 'role-unbound' : 'role-dangling' };
    }
    throw error;
  }
}
