// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLoreEntry, type LoreEntry } from '@storyengine/shared';

import {
  advanceTiming,
  isActive,
  NO_TIMING,
  timingOf,
  timingVerdict,
  type EntryTiming,
  type TimingVerdict,
} from './timing.js';

/**
 * The four timing behaviours — [P5.5], whose own text says what these tests are
 * for: *unit tests on the interactions, which are the part people actually get
 * wrong.*
 *
 * So the shape of this file is deliberate. The single-behaviour cases are short
 * and exist to pin each rule; the long ones **run a session**, turn by turn,
 * and assert the whole sequence — because sticky-then-cooldown and
 * sticky-under-ephemeral are not properties of one call and cannot be seen in
 * one.
 */

function entry(over: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry('Harbour'), ...over };
}

/**
 * Plays turns and records what happened, which is the only way the sequences
 * below read as sequences.
 *
 * `matched` is a list rather than a flag so a case can say *matched on turns 1
 * and 4 and not in between* — which is exactly the shape of the stickiness
 * question triage §5.2 raises.
 */
function play(
  target: LoreEntry,
  matched: readonly boolean[],
  from: EntryTiming = NO_TIMING,
): { verdicts: TimingVerdict[]; timing: EntryTiming } {
  let timing = from;
  const verdicts: TimingVerdict[] = [];

  for (const [index, hit] of matched.entries()) {
    const verdict = timingVerdict(target, timing, { messagesSoFar: index, matched: hit });
    verdicts.push(verdict);
    timing = advanceTiming(target, timing, verdict);
  }
  return { verdicts, timing };
}

describe('an entry with no timing configured', () => {
  it('fires when it matches and is idle when it does not', () => {
    const plain = entry({ keys: ['harbour'] });

    expect(play(plain, [true, false, true]).verdicts).toEqual(['fires', 'idle', 'fires']);
  });

  it('accrues nothing, so a hundred idle turns leave it where it started', () => {
    expect(play(entry(), Array<boolean>(100).fill(false)).timing).toEqual(NO_TIMING);
  });
});

describe('sticky', () => {
  it('keeps the entry active for its window without matching again', () => {
    const held = entry({ sticky: 2 });

    expect(play(held, [true, false, false, false]).verdicts).toEqual([
      'fires',
      'sticky',
      'sticky',
      'idle',
    ]);
  });

  /**
   * **The line this whole file exists to hold** —
   * [triage §5.2](../../../../docs/design/workplan/02-triage.md): *the timer is
   * deliberately not refreshed while an entry is sticky, so an entry named
   * every single turn still drops out when its window expires and is re-matched
   * the turn after. That is a hard ceiling on continuous presence rather than a
   * sliding window.*
   *
   * Matched on every one of six turns, a `sticky: 2` entry must therefore go
   * `fires, sticky, sticky` and then **drop**, rather than staying on forever.
   */
  it('is a ceiling rather than a sliding window, even when matched every turn', () => {
    const held = entry({ sticky: 2 });

    expect(play(held, [true, true, true, true, true, true]).verdicts).toEqual([
      'fires',
      'sticky',
      'sticky',
      'fires',
      'sticky',
      'sticky',
    ]);
  });

  it('counts as active, so its text is in the prompt without a match', () => {
    const held = entry({ sticky: 1 });
    const { verdicts } = play(held, [true, false]);

    expect(verdicts.map(isActive)).toEqual([true, true]);
  });
});

describe('cooldown', () => {
  it('holds the entry back for its window after it fires', () => {
    const cooling = entry({ cooldown: 2 });

    expect(play(cooling, [true, true, true, true]).verdicts).toEqual([
      'fires',
      'cooling',
      'cooling',
      'fires',
    ]);
  });

  it('is not started by a turn the entry sat out', () => {
    const cooling = entry({ cooldown: 2 });

    expect(play(cooling, [false, false, true]).verdicts).toEqual(['idle', 'idle', 'fires']);
  });
});

describe('sticky and cooldown together', () => {
  /**
   * **The interaction the check order is arranged for.** A sticky window is a
   * firing that has not finished and a cooldown is what comes *after* one, so
   * the cooldown starts when the window ends rather than when the entry fires.
   * Tested the other way round — cooldown before sticky — the entry goes quiet
   * the moment it fires, its own cooldown suppressing its own stickiness, and
   * `sticky` becomes unreachable for any entry that has both.
   */
  it('cools only once the sticky window has run out', () => {
    const both = entry({ sticky: 2, cooldown: 2 });

    expect(play(both, [true, true, true, true, true, true, true]).verdicts).toEqual([
      'fires',
      'sticky',
      'sticky',
      'cooling',
      'cooling',
      'fires',
      'sticky',
    ]);
  });

  it('leaves the cooldown untouched while the window is running', () => {
    const both = entry({ sticky: 3, cooldown: 5 });
    const { timing } = play(both, [true, false]);

    expect(timing).toMatchObject({ sticky: 2, cooldown: 0 });
  });
});

describe('delay', () => {
  it('refuses until the conversation is long enough', () => {
    const late = entry({ delay: 3 });

    // `messagesSoFar` is the turn's index, so the first three turns are 0, 1, 2.
    expect(play(late, [true, true, true, true]).verdicts).toEqual([
      'delayed',
      'delayed',
      'delayed',
      'fires',
    ]);
  });

  /**
   * Checked before sticky and cooldown because it is a statement about the
   * story rather than about the entry: an entry that may not fire yet has no
   * business accruing a cooldown it never earned.
   */
  it('starts no counter while it is holding the entry back', () => {
    const late = entry({ delay: 2, cooldown: 5, sticky: 5 });

    expect(play(late, [true, true]).timing).toEqual(NO_TIMING);
  });
});

describe('ephemeral', () => {
  it('disables the entry after its allowance of firings', () => {
    const once = entry({ ephemeral: 2 });

    expect(play(once, [true, true, true, true]).verdicts).toEqual([
      'fires',
      'fires',
      'spent',
      'spent',
    ]);
  });

  /**
   * **A sticky window is one firing, not four.** `fired` counts activations, so
   * an `ephemeral: 1` entry with a sticky window gets the whole window — where
   * a count of turns would disable it after the first and make the two fields
   * silently incompatible.
   */
  it('gives a sticky entry its whole window for one of its firings', () => {
    const once = entry({ ephemeral: 1, sticky: 3 });

    expect(play(once, [true, true, true, true, true]).verdicts).toEqual([
      'fires',
      'sticky',
      'sticky',
      'sticky',
      'spent',
    ]);
  });

  it('is permanent — no later match revives it', () => {
    const once = entry({ ephemeral: 1 });
    const { timing } = play(once, [true, true]);

    expect(timingVerdict(once, timing, { messagesSoFar: 99, matched: true })).toBe('spent');
  });

  /**
   * Checked first because no other state can revive a spent entry, and
   * reporting it as `cooling` would send an author waiting for a window that
   * will never end.
   */
  it('outranks a cooldown that is still running', () => {
    const once = entry({ ephemeral: 1, cooldown: 10 });

    expect(play(once, [true, true, true]).verdicts).toEqual(['fires', 'spent', 'spent']);
  });
});

describe('all four at once', () => {
  /**
   * The case a person actually configures and then cannot explain: *hold off
   * for two messages, then fire; stay for two; wait two; and only ever twice.*
   * Written out turn by turn because the value of this file is the sequence.
   */
  it('reads as the sentence the author wrote', () => {
    const complicated = entry({ delay: 2, sticky: 2, cooldown: 2, ephemeral: 2 });

    expect(play(complicated, Array<boolean>(12).fill(true)).verdicts).toEqual([
      'delayed', // 0 messages so far
      'delayed', // 1
      'fires', // 2 — long enough at last
      'sticky',
      'sticky',
      'cooling',
      'cooling',
      'fires', // the second and last of its two firings
      'sticky',
      'sticky',
      // **And `spent` rather than `cooling`**, which is the tail worth reading
      // twice. The window ends and starts a cooldown exactly as it did the
      // first time — but the allowance is used up, so what the entry *is* from
      // here is finished rather than waiting. Reporting the cooldown would be
      // true about the counter and misleading about the entry: it says *back
      // shortly* for something that is never coming back.
      'spent',
      'spent',
    ]);
  });

  it('is spent afterwards, whatever else is running', () => {
    const complicated = entry({ delay: 2, sticky: 2, cooldown: 2, ephemeral: 2 });
    const { timing } = play(complicated, Array<boolean>(12).fill(true));

    expect(timingVerdict(complicated, timing, { messagesSoFar: 50, matched: true })).toBe('spent');
  });
});

describe('reading a stored value back', () => {
  it('takes what is there', () => {
    expect(timingOf({ sticky: 2, cooldown: 1, fired: 3 })).toEqual({
      sticky: 2,
      cooldown: 1,
      fired: 3,
    });
  });

  /**
   * A session file is hand-editable like everything else here, and a channel
   * value that is not the shape this expects must not crash a turn — the same
   * posture the book page takes to an entry that is not a `LoreEntry`.
   */
  it('falls back rather than throwing on anything it is not', () => {
    for (const value of [null, 'sticky', 42, [], { sticky: 'lots' }]) {
      expect(timingOf(value)).toEqual(NO_TIMING);
    }
  });

  it('keeps the fields it can read and defaults the rest', () => {
    expect(timingOf({ sticky: 2 })).toEqual({ sticky: 2, cooldown: 0, fired: 0 });
  });
});
