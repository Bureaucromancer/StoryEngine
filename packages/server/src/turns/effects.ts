// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7 } from '@storyengine/shared';

import { channelDefinition } from '../sessions/channels.js';
import type { ChannelEffect, ChannelState, EffectOp } from '../sessions/types.js';

/**
 * Turning a proposal into a recorded effect — [13 §1.2](../../../../docs/design/13-internal-contracts.md).
 *
 * A step or a model *proposes*; the engine decides. The decision is recorded
 * either way, because [13 §1.2] is explicit that a refused effect stays in the
 * record: the model tried to give itself forty gold and the engine said no, and
 * a system that dropped the attempt would leave the workbench unable to explain
 * why nothing happened.
 */

/** What a step hands back. It cannot stamp `before`, `applied` or an id. */
export interface EffectProposal {
  channelId: string;
  scopeKey?: string | null;
  op: EffectOp;
  after: unknown;
  proposedBy: ChannelEffect['proposedBy'];
}

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
  // **Only a whole-value set, at P2.5.** `applyEffects` (`sessions/store.ts`)
  // reads `op.path` for nothing but `delete` and replaces the entire channel
  // value with `after`, so an `increment` carrying a sub-value would silently
  // clobber the channel rather than adding to it. Refusing here is a programmer
  // error rather than a rejected effect: nothing in P2 produces one, and the day
  // something does, `applyEffects` is what has to change first.
  if (proposal.op.type !== 'set' || proposal.op.path !== '/') {
    throw new Error(
      `Only a whole-value set is applicable at P2.5; got ${proposal.op.type} at ` +
        `${'path' in proposal.op ? proposal.op.path : '?'}. See sessions/store.ts applyEffects.`,
    );
  }

  const definition = channelDefinition(proposal.channelId);
  const before = running[proposal.channelId]?.value ?? null;

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
  return null;
}
