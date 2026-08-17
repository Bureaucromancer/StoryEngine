// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Tape } from '../rng/rng.js';

/**
 * Sessions and turns on disk — [02 §5.5](../../../../docs/design/02-data-model.md),
 * [13 §1](../../../../docs/design/13-internal-contracts.md).
 *
 * These are the shapes P2.3 persists. The rest of the turn record — blocks,
 * calls, the budget verdict — is filled in by P2.4 and P2.5 and lands in the
 * same JSONL line; the fields below are the ones storage itself depends on.
 */

/**
 * One effect on one channel — [13 §1.2](../../../../docs/design/13-internal-contracts.md).
 *
 * **The most load-bearing type in that document.** It carries reversibility, it
 * crosses the worker boundary, it is what a branch replays and what undo
 * inverts; an effect that cannot state its own inverse breaks all four at once.
 * Which is why `before` is stored rather than derived: undoing the tip means
 * applying `before`, not replaying 0..N−1.
 */
export interface ChannelEffect {
  id: string;
  turnId: string;
  channelId: string;
  /** Which value, when the channel is scoped per actor or per entry. */
  scopeKey: string | null;
  op: EffectOp;
  /** State before, for exactly the keys this effect touched. */
  before: unknown;
  after: unknown;
  /** Who proposed it, and who decided. */
  proposedBy:
    | { kind: 'model'; callId: string }
    | { kind: 'step'; stepId: string }
    | { kind: 'user' }
    | { kind: 'engine' };
  applied: boolean;
  /** Present when `applied` is false. */
  rejectedReason: string | null;
  channelVersion: number;
  /**
   * Whether the effect stayed inside the session or escaped it. Escaped effects
   * are recorded like everything else but never replayed or reverted. **P2
   * writes only `session`** — the field exists so P6 needs a field rather than
   * a migration.
   */
  scope: 'session' | 'escaped';
}

export type EffectOp =
  | { type: 'set'; path: string }
  | { type: 'merge'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'append'; path: string }
  | { type: 'increment'; path: string; by: number };

/** [13 §1.3](../../../../docs/design/13-internal-contracts.md). */
export interface ChannelState {
  /** Which schema version the value was written against. */
  version: number;
  value: unknown;
  /** Set when load-time validation failed and the value was quarantined. */
  degraded?: { reason: string; raw: unknown };
}

/**
 * One turn, as it is written to a segment.
 *
 * `parentTurnId` from the very first turn ([P2 §2.5]): the turn store is a tree
 * that P2 happens to use linearly, and retrofitting the edge at P6 would be a
 * migration where writing it now is a field.
 */
export interface Turn {
  id: string;
  sessionId: string;
  /** Null for the first turn of a session. Every other turn names its parent. */
  parentTurnId: string | null;
  createdAt: string;
  status: 'complete' | 'failed' | 'suspended';
  /** Applied and rejected alike — a rejected effect is part of the record. */
  effects: ChannelEffect[];
  /** Every draw the turn consumed, keyed by site ([07 §14.6]). */
  tape: Tape;
  /**
   * A removed turn is a tombstone the reader skips, not a rewritten segment.
   * Nothing removes turns at 1.0; pruning a branch subtree does, and
   * retrofitting deletion into a format that assumed pure append is a
   * migration rather than a feature ([02 §5.5]).
   */
  removed?: true;
}

/**
 * `session.json` — metadata, cast, branch refs, and the head channel snapshot.
 *
 * **The snapshot is derived, not authoritative** ([02 §8.1]). A session is a
 * tree, so "the channel state of a session" is not a thing that exists: state
 * exists *at a node*. A single `channels` map here can therefore only mean
 * state at `headTurnId`, and deleting it must cost a recomputation and nothing
 * else. It is in the file at all because somebody will open it, and a session
 * file that cannot tell you what time it is in the story fails the legibility
 * promise the whole storage design rests on.
 */
export interface SessionFile {
  schema: 'storyengine.session/1';
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Null before the first turn. */
  headTurnId: string | null;
  /** State at `headTurnId`. Derived. Hand-editing it writes an effect. */
  channels: Record<string, ChannelState>;
}
