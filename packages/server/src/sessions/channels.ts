// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uuidv7 } from '@storyengine/shared';

import type { ChannelEffect, ChannelState, Turn } from './types.js';

/**
 * `se.clock`, and the rule that a hand edit is an intent rather than corruption
 * — [P2 §2.7](../../../../docs/design/workplan/04-p2-implementation.md),
 * [02 §8.1](../../../../docs/design/02-data-model.md).
 *
 * **Why the clock and not the party.** [P2 §2.7] closed the skeleton's open
 * question here: in a fixed-participant P2 mode nothing ever writes a party
 * effect, so `se.party` would be a placeholder-shaped channel that exercises
 * nothing. The clock advances every turn, engine-computed, which puts real
 * traffic through effect application, replay-from-zero and the head snapshot.
 * `se.party` lands at P7 beside `ParticipantPolicy`, which is what gives it
 * semantics.
 */

/**
 * What a channel declares about itself — [13 §1.3](../../../../docs/design/13-internal-contracts.md).
 *
 * **Deliberately short of the documented type.** `init: InitPolicy` and
 * `surface?: WidgetSpec` are in that section and are named in
 * [13 §6](../../../../docs/design/13-internal-contracts.md) as *deliberately still absent* —
 * they want the mode contract built first, which is P2.6. Writing a guess at
 * them here would be the one thing worse than leaving them out: a shape other
 * code starts depending on before the section that owns it exists.
 */
export interface ChannelDefinition {
  id: string;
  /**
   * Who owns this channel — a mode, an extension, or a package
   * ([03 §4.1](../../../../docs/design/03-modes-and-turn-pipeline.md)).
   *
   * **Added with the first channel definition, which is what §4.1 asks for.**
   * That section names accepting a package id as one of two things 1.0 owes
   * *from the first channel definition written*, because widening it afterwards
   * is a migration over every stored channel. That definition is this one, so
   * the field costs nothing today and would cost a migration in a month.
   *
   * A literal rather than an import of `SCENE_ID`: `modes/scene` imports this
   * module for `CLOCK_CHANNEL`, so naming it the other way round would be a
   * `const` cycle — a TDZ `ReferenceError` at module load rather than a benign
   * one. A test in the mode pins the two together instead.
   */
  owner: string;
  version: number;
  scope: 'session' | 'actor' | 'entry';
  update: 'model-proposed' | 'engine-computed' | 'user-only';
  visibility: 'player' | 'hidden';
  /** Tokens the channel may spend when rendered into a prompt. Null for none. */
  budget: number | null;
}

/** The story clock's value. Normalised, so `hour` is 0–23 and `minute` 0–59. */
export interface ClockValue {
  day: number;
  hour: number;
  minute: number;
}

export const SE_CLOCK = 'se.clock';

export const CLOCK_CHANNEL: ChannelDefinition = {
  id: SE_CLOCK,
  owner: 'storyengine.scene',
  version: 1,
  scope: 'session',
  // Engine-computed: the model does not get to decide what time it is. That is
  // the property making this a useful first channel — an effect nobody proposed
  // still has to be recorded, attributed and reversible like any other.
  update: 'engine-computed',
  visibility: 'player',
  budget: null,
};

/**
 * Every channel this build knows — the thing `update` is enforced against.
 *
 * A registry with one entry looks like ceremony, and is not: `ChannelDefinition`
 * declares `update: 'model-proposed' | 'engine-computed' | 'user-only'`, and
 * until something can *look a channel up* that field is a comment. The clock is
 * `engine-computed`, so a model proposing a time change must be recorded and
 * refused rather than applied — which needs a definition to consult.
 *
 * P2.6's modes register their own ([03 §4]); this is the built-in set.
 */
export const CHANNELS: Readonly<Record<string, ChannelDefinition>> = {
  [SE_CLOCK]: CLOCK_CHANNEL,
};

export function channelDefinition(id: string): ChannelDefinition | null {
  return CHANNELS[id] ?? null;
}

/** Where a session's clock starts. Morning, because a story usually does. */
export const CLOCK_START: ClockValue = { day: 1, hour: 8, minute: 0 };

/**
 * How far the clock moves per turn.
 *
 * A placeholder with a name rather than a literal in the middle of a function:
 * the mode is what should decide this ([03 §4](../../../../docs/design/03-modes-and-turn-pipeline.md)),
 * and there is no mode configuration to read it from until P2.6. Named so the
 * day it becomes configurable is a change of source rather than a search.
 */
export const MINUTES_PER_TURN = 5;

export function readClock(channels: Record<string, ChannelState>): ClockValue {
  const state = channels[SE_CLOCK];
  return isClock(state?.value) ? state.value : CLOCK_START;
}

function isClock(value: unknown): value is ClockValue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ClockValue>;
  return (
    typeof candidate.day === 'number' &&
    typeof candidate.hour === 'number' &&
    typeof candidate.minute === 'number'
  );
}

/** Adds minutes, carrying into hours and days. */
export function advance(clock: ClockValue, minutes: number): ClockValue {
  const total = clock.hour * 60 + clock.minute + minutes;
  const dayShift = Math.floor(total / (24 * 60));
  const inDay = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    day: clock.day + dayShift,
    hour: Math.floor(inDay / 60),
    minute: inDay % 60,
  };
}

/**
 * The clock effect a turn carries.
 *
 * `before` is stored rather than derived, which is [13 §1.2]'s most load-bearing
 * decision: undoing the tip means applying `before`, not replaying 0..N−1.
 */
export function clockEffect(
  turnId: string,
  channels: Record<string, ChannelState>,
  minutes: number = MINUTES_PER_TURN,
): ChannelEffect {
  const before = readClock(channels);
  return {
    id: uuidv7(),
    turnId,
    channelId: SE_CLOCK,
    scopeKey: null,
    op: { type: 'set', path: '/' },
    before,
    after: advance(before, minutes),
    proposedBy: { kind: 'engine' },
    applied: true,
    rejectedReason: null,
    channelVersion: CLOCK_CHANNEL.version,
    scope: 'session',
  };
}

/**
 * The effects that reconcile a hand-edited `session.json` with the effect log —
 * [02 §8.1](../../../../docs/design/02-data-model.md).
 *
 * **A user who edits `channels` in the file has expressed an intent, not
 * corrupted a cache.** The snapshot is derived, so the naive responses are both
 * wrong: overwriting the edit throws away what somebody meant, and trusting it
 * makes the snapshot authoritative — which turns it into a mutable state blob
 * that switching branches has to rewrite, the exact failure [09 §5.1] rules out
 * for rolling summaries.
 *
 * So the divergence becomes **user-authored effects**, and the effect log stays
 * the single source of truth. It is also self-healing in the case nobody
 * intended: if the divergence came from a bug rather than a person, it lands as
 * a visible effect someone can inspect instead of silently persisting.
 *
 * `before` is the replayed value, because that is what the log says was true —
 * which is what makes the effect reversible into a state the log agrees with.
 */
export function divergenceEffects(
  turnId: string,
  replayed: Record<string, ChannelState>,
  onDisk: Record<string, ChannelState>,
): ChannelEffect[] {
  const effects: ChannelEffect[] = [];
  const channelIds = new Set([...Object.keys(replayed), ...Object.keys(onDisk)]);

  for (const channelId of [...channelIds].sort()) {
    const was = replayed[channelId];
    const now = onDisk[channelId];

    if (now === undefined) {
      // Removed from the file. A deletion is as much an intent as an edit, and
      // it is the one divergence that a re-derive-and-overwrite would treat as
      // "nothing changed".
      effects.push(
        effect(turnId, channelId, { type: 'delete', path: '/' }, was?.value ?? null, null, was),
      );
      continue;
    }

    if (was !== undefined && same(was.value, now.value)) continue;

    effects.push(
      effect(turnId, channelId, { type: 'set', path: '/' }, was?.value ?? null, now.value, now),
    );
  }

  return effects;
}

function effect(
  turnId: string,
  channelId: string,
  op: ChannelEffect['op'],
  before: unknown,
  after: unknown,
  state: ChannelState | undefined,
): ChannelEffect {
  return {
    id: uuidv7(),
    turnId,
    channelId,
    scopeKey: null,
    op,
    before,
    after,
    // The whole point of the mechanism: attributed to the person who opened the
    // file, not to the engine that noticed.
    proposedBy: { kind: 'user' },
    applied: true,
    rejectedReason: null,
    channelVersion: state?.version ?? 1,
    scope: 'session',
  };
}

/**
 * Structural comparison over JSON values.
 *
 * `JSON.stringify` rather than a deep-equal helper, and it is not laziness: a
 * channel value has *already* been through a file, so it is JSON by
 * construction — no undefined, no functions, no cycles. Key order is the one
 * hazard, and it is stable here because both sides are parsed from JSON text
 * written by this code or read from one.
 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The turn that carries a hand edit into the log.
 *
 * **A turn, rather than effects appended to the head turn.** [02 §8.1] says the
 * effect is "appended at the head", and a segment is append-only — rewriting the
 * head turn's line to add effects to it is precisely what the format forbids.
 * So the edit becomes its own turn: no model calls, no tape, `complete`, and its
 * effects attributed to the user. That is also the reading that keeps the
 * promise the section actually makes — *visible in the turn record* — because a
 * turn is the thing the workbench shows.
 */
export function divergenceTurn(
  sessionId: string,
  headTurnId: string | null,
  effects: ChannelEffect[],
  createdAt: string = new Date().toISOString(),
): Turn {
  const id = uuidv7();
  return {
    id,
    sessionId,
    parentTurnId: headTurnId,
    createdAt,
    status: 'complete',
    effects: effects.map((each) => ({ ...each, turnId: id })),
    tape: [],
  };
}
