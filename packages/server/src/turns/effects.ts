// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { EffectProposal } from '@storyengine/sdk';
import { uuidv7 } from '@storyengine/shared';

import { schemaFailure } from '../sessions/channel-schema.js';
import { channelDefinition, channelKey } from '../sessions/channels.js';
import type { ChannelEffect, ChannelState } from '../sessions/types.js';

/**
 * Turning a proposal into a recorded effect — [21 §1.2](../../../../docs/design/21-internal-contracts.md).
 *
 * A step or a model *proposes*; the engine decides. The decision is recorded
 * either way, because [21 §1.2] is explicit that a refused effect stays in the
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
    after: refusal === null ? proposal.after : before,
    proposedBy: proposal.proposedBy,
    applied: refusal === null,
    rejectedReason: refusal,
    supersedes,
    channelVersion: definition?.version ?? 1,
    // P2 writes only `session` ([P2 §2.7]); the field exists so P6 needs a
    // field rather than a migration.
    scope: 'session',
  };
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
): string | null {
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
   * **The cause [21 §1.2](../../../../docs/design/21-internal-contracts.md)
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
   * **And this is what stops a hand edit from poisoning the log.** A person
   * editing `session.json` has expressed an intent
   * ([03 §8.1](../../../../docs/design/03-data-model.md)), which
   * `divergenceEffects` turns into user-attributed effects — so before this,
   * `{"hour": 25}` typed into a file became an *applied* effect and an
   * impossible clock in the permanent record. Now it becomes a **recorded
   * refusal**: visible, attributed, reversible, and not in the state. That is
   * 03 §8.1's own posture rather than a departure from it — the edit is not
   * discarded, it is answered.
   */
  if (schemaFailure(proposal.channelId, proposal.after) !== null) {
    return 'schema';
  }

  return null;
}
