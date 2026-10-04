// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { EffectProposal } from '@storyengine/sdk';
import { uuidv7, type EffectRefusal } from '@storyengine/shared';

import { schemaFailure } from '../sessions/channel-schema.js';
import { channelDefinition, channelKey } from '../sessions/channels.js';
import type { ChannelEffect, ChannelState } from '../sessions/types.js';

/**
 * Turning a proposal into a recorded effect — [22 §1.2](../../../../docs/design/22-internal-contracts.md).
 *
 * A step or a model *proposes*; the engine decides. The decision is recorded
 * either way, because [22 §1.2] is explicit that a refused effect stays in the
 * record: the model tried to give itself forty gold and the engine said no, and
 * a system that dropped the attempt would leave the workbench unable to explain
 * why nothing happened.
 */

/**
 * What a step hands back. It cannot stamp `before`, `applied` or an id — moved
 * to `@storyengine/sdk` at [P7.0] and re-exported here, because a step proposes
 * and only the engine can record a decision.
 */
export type { EffectProposal } from '@storyengine/sdk';

/**
 * Decides one proposal against the channel state as it stands *within this turn*.
 *
 * **`before` comes from the running map, not the pre-turn one.** Two effects on
 * one channel in a single turn have to chain, or the second one's inverse
 * restores a value that was already superseded — and replay-from-zero then
 * diverges from the head snapshot, which is the assertion `channels.test.ts`
 * already makes about a different path.
 */
export function acceptEffect(
  turnId: string,
  proposal: EffectProposal,
  running: Record<string, ChannelState>,
  supersedes: string | null = null,
): ChannelEffect {
  /**
   * **Only a whole-value set.** `applyEffects` (`sessions/store.ts`) reads
   * `op.path` for nothing but `delete` and replaces the entire channel value
   * with `after`, so an `increment` carrying a sub-value would silently clobber
   * the channel rather than adding to it. Refusing here is a programmer error
   * rather than a rejected effect: nothing produces one, and the day something
   * does, `applyEffects` is what has to change first.
   *
   * ~~*at P2.5*~~ — **a decision rather than a stage's leftover since
   * [P7 §0.2](../../../../docs/design/workplan/23-p7-implementation.md) item 6,
   * 2026-09-11.** The first candidate for a partial op was P7.2's party
   * membership, *"a timeline that grows"*, and it turned out not to need one:
   * `scopeKey` already partitions a channel's value, so an actor-scoped party
   * carries one actor's records per effect rather than the party's history.
   *
   * **And the reason to keep it this way is correctness rather than economy.**
   * Whole-value replacement is what makes replay-from-zero equal
   * snapshot-plus-replay *by construction* — the P6 gate — and what makes an
   * inverse a swap rather than a computation. Every partial op is a reducer: a
   * second implementation of the value's semantics that the gate has to be
   * re-proved against and that `before` has to be able to invert. So an arm is
   * implemented when a channel genuinely needs it, and that channel first has to
   * say why its value cannot be scoped instead.
   */
  if (proposal.op.type !== 'set' || proposal.op.path !== '/') {
    throw new Error(
      `Only a whole-value set is applicable; got ${proposal.op.type} at ` +
        `${'path' in proposal.op ? proposal.op.path : '?'}. See sessions/store.ts applyEffects.`,
    );
  }

  const definition = channelDefinition(proposal.channelId);
  // The same composite key `applyEffects` writes under. Keyed on the channel id
  // alone, a scoped effect's `before` would be some *other* entry's value — and
  // `before` is the inverse an undo replays, so the mistake would surface as a
  // restore that put the wrong entry's timing back.
  const before = running[channelKey(proposal.channelId, proposal.scopeKey)]?.value ?? null;

  const refusal = refuse(definition, proposal);
  return {
    id: uuidv7(),
    turnId,
    channelId: proposal.channelId,
    scopeKey: proposal.scopeKey ?? null,
    op: proposal.op,
    before,
    /**
     * ***The value that was proposed, whether or not it was applied*** —
     * corrected at [P7.2], 2026-09-11.
     *
     * This stamped `before` into `after` on a refusal, so a rejected effect
     * recorded that *something* was refused and not *what*. That contradicts the
     * sentence [22 §1.2](../../../../docs/design/22-internal-contracts.md) uses
     * to justify recording refusals at all — *"the model tried to give itself
     * forty gold and the engine said no, and a system that dropped the attempt
     * would leave the workbench unable to explain why nothing happened"* — since
     * the forty gold was exactly what got dropped. The workbench's effect list
     * rendered `08:00 → 08:00` and said *Rejected* beside it.
     *
     * **`applied` is what says whether it happened**, and every reader already
     * honours it: `applyEffects` and `undoTurn` both skip an unapplied effect
     * before touching `after`. So the field can mean *proposed* without changing
     * a single replay — checked rather than assumed, and it is what lets P7.2's
     * cast panel say *the narrator says Vera died* rather than merely *something
     * was refused*.
     */
    after: proposal.after,
    proposedBy: proposal.proposedBy,
    applied: refusal === null,
    rejectedReason: refusal,
    supersedes,
    channelVersion: definition?.version ?? 1,
    /**
     * ~~P2 writes only `session` ([P2 §2.7]); the field exists so P6 needs a
     * field rather than a migration.~~
     *
     * ***From the declaration, since [P8.2].*** That comment was true and then
     * stopped being the whole story: P6 shipped `ChannelEffect.scope`, the four
     * readers that skip an escaped effect on replay, and `moveHead`'s count of
     * how many are still out in the world — and then this line meant **nothing
     * could ever be one**, so the count was structurally zero and the banner had
     * nothing to say. [P8 §1.9] is the finding, and [07 §7] is the class: *"a
     * lorebook entry promoted to the shared library"* is exactly what a memory
     * write is.
     *
     * **A fact about the channel, never about the proposal.** A step that could
     * say its own writes were session-local would be one honest declaration away
     * from making a branch look reversible when it is not, which is the same
     * failure `callPurposeFor` refuses one file over. So it is read off
     * `ChannelDefinition.escapes`, and a channel nobody declared falls to
     * `'session'` — the state every channel written before this is in.
     */
    scope: definition?.escapes === true ? 'escaped' : 'session',
  };
}

/**
 * ***A step's proposal, held to what the step declared*** (2026-09-30) —
 * [06 §6], and the SDK's own header: *"the declaration is what the engine
 * enforces, rather than a convention the step is trusted to follow"*.
 *
 * {@link acceptEffect} holds a proposal to its channel's policy against the
 * proposal's own stamp, and nothing held the channel or the stamp to the step
 * that returned it. So a step could write a channel its `writes` never named,
 * and could stamp `{ kind: 'user' }` — what `user-only` admits, and what the
 * workbench reads as *written by you* — or `{ kind: 'engine' }`, which
 * `engine-computed` admits: the dials, the staging switch and every one of
 * Scene's switches are `user-only`, and the clock is the engine's. **Latent**:
 * every shipped step writes what it declares and stamps a call it made. It is
 * the line an extension's step would cross, and [06 §5.2]'s guidance firewall
 * rests on steps being what they declare.
 *
 * ***Refused, and recorded as every refusal is*** ([22 §1.2]), before the
 * channel's own policy, because these are about the step rather than the
 * value. *Not the step's failure*, which is how the runner answers a
 * `revisions` it did not declare: an effect is decided one at a time, and the
 * rest of what the step returned — its text, its other effects — is not made
 * suspect by one proposal the engine can simply decline.
 *
 * - `undeclared-write` — a channel outside `writes`.
 * - `not-its-proposer` — any stamp but its own step id or a model call it
 *   made. **Recorded under the step's own stamp**, because the record's
 *   proposer says who proposed it, and the one the step named did not.
 */
export interface StepClaim {
  /** `StepDefinition.id`. */
  id: string;
  /** `StepDefinition.writes` — the channels it declared it writes. */
  writes: readonly string[];
  /** The ids of the model calls this step made, which it may stamp. */
  calls: ReadonlySet<string>;
}

export function acceptStepEffect(
  turnId: string,
  proposal: EffectProposal,
  running: Record<string, ChannelState>,
  step: StepClaim,
): ChannelEffect {
  const by = proposal.proposedBy;
  const its =
    (by.kind === 'step' && by.stepId === step.id) ||
    (by.kind === 'model' && step.calls.has(by.callId));
  const effect = acceptEffect(
    turnId,
    its ? proposal : { ...proposal, proposedBy: { kind: 'step', stepId: step.id } },
    running,
  );
  const refusal: EffectRefusal | null = !step.writes.includes(proposal.channelId)
    ? 'undeclared-write'
    : its
      ? null
      : 'not-its-proposer';
  return refusal === null ? effect : { ...effect, applied: false, rejectedReason: refusal };
}

/**
 * The `update` policy, enforced — the first consumer `ChannelDefinition` has.
 *
 * A channel declares who may change it, and until now nothing checked. The
 * clock is engine-computed, so a model that decides it is suddenly midnight is
 * recorded as having tried and refused; that is the visible-refusal posture
 * [00 §3.3](../../../../docs/design/00-stance.md) takes everywhere else.
 */
function refuse(
  definition: ReturnType<typeof channelDefinition>,
  proposal: EffectProposal,
): EffectRefusal | null {
  if (definition === null) {
    // Not fatal. An extension or a mode that is not loaded may own it, and a
    // turn that failed because of an unknown channel id would be a worse
    // outcome than a recorded refusal.
    return 'unknown-channel';
  }

  const by = proposal.proposedBy.kind;
  // Two policies, two reasons — [P3.0]. Both used to write one
  // 'update-policy' string, which left the panel unable to say *which* policy
  // refused: "the engine computes this" and "only a person may change this"
  // are different sentences with different remedies.
  if (definition.update === 'engine-computed' && (by === 'model' || by === 'step')) {
    return 'engine-computed';
  }
  if (definition.update === 'user-only' && by !== 'user') {
    return 'user-only';
  }

  /**
   * **The cause [22 §1.2](../../../../docs/design/22-internal-contracts.md)
   * lists first and nothing had ever produced** — `rejectedReason` is documented
   * as *"validation failure, an engine-computed rule overriding a model
   * proposal, or a policy refusal"*, and until [P7.1] gave `ChannelDefinition` a
   * `schema` the first of those three was unreachable. Policy refusals were the
   * whole vocabulary.
   *
   * **Checked last, after the policy rules, and the order is a decision.** A
   * model proposing a malformed value to a channel it is not allowed to touch
   * gets `engine-computed`, not `schema`: *who may write* is the more useful
   * sentence for the person reading the workbench, because the remedy differs —
   * a policy refusal means the proposal was never going to land however it was
   * shaped, while a schema refusal means this one nearly did.
   *
   * ~~**And this is what stops a hand edit from poisoning the log.**~~
   * ***Corrected the same day it was written: this function is not on that
   * path.*** `reconcileHandEdits` builds its effects in
   * `sessions/channels.ts`'s `divergenceEffects` and never calls
   * `acceptEffect`, so nothing here has ever seen a hand edit — not the schema
   * check and not the policy rules above it. The hand-edit path consults the
   * schema *there*, in the same commit that corrected this paragraph, and
   * `channel-schema.ts` takes a definition rather than an id precisely so that
   * module can import it without a cycle.
   *
   * *The policy rules were never the gap they look like, which is worth saying
   * so nobody "fixes" it: `engine-computed` refuses `model` and `step`, and
   * `user-only` refuses everything but `user` — so a person editing their own
   * file is permitted by both, deliberately. Only the schema check had anything
   * to say about a hand edit, and only there.*
   */
  /**
   * **The loaded values a model may not set on its own** — [06 §8.1], [26 C12],
   * [P7.2].
   *
   * Checked before the schema, because a proposal that is both loaded *and*
   * malformed is more usefully answered as the first: *this one needs a person*
   * is a sentence with a next step, and `schema` on a value the model was never
   * going to be allowed to set would send somebody looking for a typo.
   *
   * **Only `model` and `step`, which is the same line `engine-computed`
   * draws.** A person setting a status to `dead` is the manual path 25 C12
   * calls *always-available*, and the engine setting one is a computation that
   * has already been decided. What is under-fired is the model's casual
   * killing.
   */
  if (
    (by === 'model' || by === 'step') &&
    typeof proposal.after === 'string' &&
    definition.confirm?.includes(proposal.after) === true
  ) {
    return 'needs-confirmation';
  }

  if (schemaFailure(definition, proposal.after) !== null) {
    return 'schema';
  }

  return null;
}
