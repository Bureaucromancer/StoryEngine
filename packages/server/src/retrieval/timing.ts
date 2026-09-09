// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { LoreEntry } from '@storyengine/shared';

/**
 * `sticky`, `cooldown`, `delay` and `ephemeral` — the four behaviours
 * [03 §3.1](../../../../docs/design/03-data-model.md) insists are four rather
 * than four takes on one, and where their counters live.
 *
 * **The state home is the decision [P5 §1.1] calls the one real design question
 * in the phase**, and this stage is where it gets answered rather than leaned
 * towards. The counters change as a result of turns, which is the definition of
 * a channel ([06 §4]) — so if they live anywhere else they do not reconstruct
 * at a node and a branch inherits the wrong stickiness, which is the same
 * argument that moved party membership into channels.
 *
 * So: an engine-owned channel, `scope: 'entry'`, one value per entry, written
 * through ordinary `ChannelEffect`s. That makes timing visible in the turn
 * record and correct under P6's branching for free, and the cost — every turn
 * with sticky entries writes effects — is bounded and legible.
 *
 * **Taking the lean literally cost a widening, and that was the finding.**
 * `ChannelDefinition.scope` has offered `'entry'` since the first channel was
 * written and `ChannelEffect.scopeKey` was declared for exactly this, but
 * `applyEffects` keyed on the channel id alone — so two entries' timing states
 * would have overwritten each other, silently. [P5 §0.4] found it,
 * [P6 §1.9](../../../../docs/design/workplan/18-p6-implementation.md) asked
 * which phase pays, and the phase order answers that it is this one: the
 * alternative was shipping a feature that clobbers itself and leaving P6 to
 * repair it. `channelKey` in `sessions/channels.ts` is the whole of the change.
 *
 * **The transitions are pure and the channel is where the result goes.** This
 * module decides *what a turn does to an entry's counters*; P5.6's retrieval
 * step turns that into effects, because a step is the only thing that may
 * propose one.
 */

/**
 * One entry's counters.
 *
 * **`delay` has no counter here**, deliberately: *do not fire until N messages
 * in* is a fact about the conversation's length rather than about the entry, so
 * storing it would be storing something already on the path — and a stored copy
 * is the thing that reconstructs wrong at a node. It is read from the history
 * instead, which is why {@link TimingContext} carries a count and this does not.
 */
export interface EntryTiming {
  /** Turns of stickiness left. Zero when the entry is not currently held on. */
  sticky: number;
  /** Turns before it may fire again. */
  cooldown: number;
  /** Firings so far, for `ephemeral`. A sticky window is one firing. */
  fired: number;
}

/** An entry nothing has yet recorded anything about. */
export const NO_TIMING: EntryTiming = { sticky: 0, cooldown: 0, fired: 0 };

export interface TimingContext {
  /**
   * Messages on the path before this turn — what `delay` counts. From the
   * history rather than from a counter, so a branch that rewinds four turns is
   * four messages shallower without anything having to be un-incremented.
   */
  messagesSoFar: number;
  /** Whether the entry's keys matched this turn. */
  matched: boolean;
}

/**
 * What this turn does with the entry.
 *
 * - `spent` — `ephemeral` is used up. Permanent, and checked first because no
 *   other state can revive it.
 * - `delayed` — the conversation is not long enough yet.
 * - `sticky` — a firing already in progress; it contributes without matching.
 * - `cooling` — it fired recently and is waiting.
 * - `fires` — it matched and nothing was holding it back.
 * - `idle` — eligible, and nothing matched.
 */
export type TimingVerdict = 'spent' | 'delayed' | 'sticky' | 'cooling' | 'fires' | 'idle';

/**
 * **The order of these checks is the design**, and every line of it was argued
 * from a case rather than chosen.
 *
 * **A running sticky window comes first, ahead of even `spent`.** A window is
 * one firing that has not finished, so an `ephemeral: 1` entry with
 * `sticky: 3` must get its three turns — the alternative disables it on the
 * turn *after* it fires, cutting its own window off at one, and makes the two
 * fields silently incompatible for anybody who set both. That is not a
 * hypothetical: this function was written with `spent` first and the test for
 * exactly that combination is what caught it.
 *
 * Then `spent`, because nothing revives an exhausted entry and reporting it as
 * `cooling` would leave an author waiting for a window that never ends.
 *
 * Then `delay`, which is a statement about the story rather than about the
 * entry: one that may not fire yet has no business accruing a cooldown it never
 * earned. (Its position relative to `sticky` is unobservable — an entry cannot
 * be sticky before it has ever fired, and it cannot fire while delayed — so it
 * sits where it reads best.)
 *
 * And `cooling` last of the refusals, because a cooldown is what comes *after*
 * a firing: tested before `sticky`, an entry with both goes quiet the moment it
 * fires, its own cooldown suppressing its own stickiness, and `sticky` becomes
 * unreachable for every entry that has the pair.
 */
export function timingVerdict(
  entry: LoreEntry,
  timing: EntryTiming,
  context: TimingContext,
): TimingVerdict {
  if (timing.sticky > 0) return 'sticky';
  if (entry.ephemeral !== null && timing.fired >= entry.ephemeral) return 'spent';
  if (entry.delay !== null && context.messagesSoFar < entry.delay) return 'delayed';
  if (timing.cooldown > 0) return 'cooling';
  return context.matched ? 'fires' : 'idle';
}

/** Whether this verdict puts the entry's text in the prompt. */
export function isActive(verdict: TimingVerdict): boolean {
  return verdict === 'fires' || verdict === 'sticky';
}

/**
 * The counters after the turn.
 *
 * **The sticky timer is never refreshed while it is running**, which is
 * [triage §5.2](../../../../docs/design/workplan/02-triage.md)'s carried
 * reasoning and the most consequential line in this file:
 *
 * > the timer is deliberately *not* refreshed while an entry is sticky, so an
 * > entry named every single turn still drops out when its window expires and
 * > is re-matched the turn after. That is a hard ceiling on continuous presence
 * > rather than a sliding window — a deliberate choice, made to stop a
 * > once-relevant entry pinning itself in the prompt forever.
 *
 * It falls out of the verdict rather than needing a rule of its own: while
 * `sticky > 0` the verdict is `sticky` and never `fires`, so there is no arm
 * here that could reset it. That is why the two functions are shaped this way —
 * a version that decided stickiness inside this one would have had to remember.
 *
 * **`fired` counts firings, not turns**, for the same reason: a sticky window
 * is one activation continuing, so an `ephemeral: 1` entry with `sticky: 4`
 * gets its four turns rather than being disabled after the first.
 */
export function advanceTiming(
  entry: LoreEntry,
  timing: EntryTiming,
  verdict: TimingVerdict,
): EntryTiming {
  switch (verdict) {
    case 'fires':
      return {
        sticky: entry.sticky ?? 0,
        /**
         * **Set unconditionally, because the window's own arm re-decides it.**
         * This began as `sticky > 0 ? 0 : cooldown`, on the reasoning that a
         * firing with a window should not start cooling until the window ends
         * — which is true, and which the `sticky` arm below already enforces by
         * zeroing the counter for every turn but the last. So the condition
         * here could never be observed: `timingVerdict` checks `sticky` before
         * `cooldown`, so nothing reads this value while a window is running,
         * and the next turn overwrites it either way. A mutation inverting it
         * changed no test, which is what an unfalsifiable branch looks like
         * from the outside.
         */
        cooldown: entry.cooldown ?? 0,
        fired: timing.fired + 1,
      };
    case 'sticky': {
      const left = timing.sticky - 1;
      return {
        sticky: left,
        cooldown: left === 0 ? (entry.cooldown ?? 0) : 0,
        fired: timing.fired,
      };
    }
    case 'cooling':
      return { ...timing, cooldown: timing.cooldown - 1 };
    // `spent`, `delayed` and `idle` change nothing: there is no counter running
    // and none to start. An idle entry accruing anything would be an entry
    // whose history depends on turns it took no part in.
    default:
      return timing;
  }
}

/** The stored value read back, tolerating anything the file is not. */
export function timingOf(value: unknown): EntryTiming {
  if (typeof value !== 'object' || value === null) return NO_TIMING;
  const held = value as Partial<EntryTiming>;
  return {
    sticky: typeof held.sticky === 'number' ? held.sticky : 0,
    cooldown: typeof held.cooldown === 'number' ? held.cooldown : 0,
    fired: typeof held.fired === 'number' ? held.fired : 0,
  };
}
