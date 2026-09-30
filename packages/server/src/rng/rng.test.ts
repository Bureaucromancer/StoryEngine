// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { DiceNotationError, parseDice } from './dice.js';
import { Rng, swipeReplay, type Tape } from './rng.js';
import { cryptoSource, seededSource } from './source.js';

/**
 * The RNG service — [19 §14](../../../../docs/design/19-tech-stack.md).
 *
 * Two things are being asserted here, and the second is the one that matters
 * later: that the draws are *uniform and complete*, so nobody has a reason to
 * reach for `Math.random()`; and that the tape replays **by site**, so a
 * rewrite reproduces the same mechanical outcome rather than handing a lore
 * probability's number to a skill check.
 */

function seeded(seed = 1234): Rng {
  return new Rng({ source: seededSource(seed) });
}

describe('the draws', () => {
  it('covers the whole documented surface, because a gap is a bypass', () => {
    // If the service does not offer what a caller needs they will reach for
    // `Math.random()` and the replay invariant is gone silently.
    const rng = seeded();
    const site = rng.at('step', 'purpose');

    expect(typeof site.int(1, 6)).toBe('number');
    expect(typeof site.float()).toBe('number');
    expect(typeof site.bool()).toBe('boolean');
    expect(typeof site.chance(0.5)).toBe('boolean');
    expect(site.pick(['a', 'b'])).toMatch(/a|b/);
    expect(site.weightedPick([{ id: 'only', value: 'only', weight: 1 }])).toBe('only');
    expect(site.shuffle([1, 2, 3])).toHaveLength(3);
    expect(typeof site.dice('1d20')).toBe('number');
  });

  it('stays inside its range, at both ends', () => {
    const rng = seeded();
    const site = rng.at('step', 'range');

    for (let i = 0; i < 500; i += 1) {
      const value = site.int(3, 5);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(5);
    }
  });

  it('is uniform enough that a bias would show', () => {
    // Not a statistics suite — the point is that `Math.floor(Math.random()*n)`
    // is subtly non-uniform and this is not, and a gross skew is what a bad
    // implementation actually produces.
    const rng = new Rng({ source: cryptoSource });
    const counts = new Map<number, number>();
    const site = rng.at('step', 'uniformity');

    for (let i = 0; i < 6000; i += 1) {
      const value = site.int(1, 6);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });

  it('never chooses a zero-weight entry', () => {
    const rng = seeded();
    const site = rng.at('step', 'loot');
    const table = [
      { id: 'common', value: 'common', weight: 10 },
      { id: 'impossible', value: 'impossible', weight: 0 },
    ];

    for (let i = 0; i < 200; i += 1) {
      expect(site.weightedPick(table)).toBe('common');
    }
  });

  it('shuffles into a permutation, and leaves the input alone', () => {
    const rng = seeded();
    const original = [1, 2, 3, 4, 5];
    const shuffled = rng.at('step', 'deck').shuffle(original);

    expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
    expect(original).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuses a range or a probability that is not one', () => {
    const site = seeded().at('step', 'bad');

    expect(() => site.int(5, 1)).toThrow(RangeError);
    expect(() => site.chance(1.5)).toThrow(RangeError);
    expect(() => site.pick([])).toThrow(RangeError);
    expect(() => site.weightedPick([{ id: 'x', value: 'x', weight: 0 }])).toThrow(RangeError);
  });
});

describe('dice notation', () => {
  it('reads the forms the rules vocabulary uses', () => {
    expect(parseDice('1d20')).toMatchObject({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice('d20')).toMatchObject({ count: 1, sides: 20 });
    expect(parseDice('2d6+3')).toMatchObject({ count: 2, sides: 6, modifier: 3 });
    expect(parseDice('4d8-2')).toMatchObject({ count: 4, sides: 8, modifier: -2 });
    expect(parseDice('d%')).toMatchObject({ count: 1, sides: 100 });
  });

  it('refuses what it does not understand rather than rolling something else', () => {
    // Quietly rolling 1d6 because `2d6kh1` did not parse is a game that is
    // wrong in a way nobody can see.
    for (const bad of ['2d6kh1', 'd', '0d6', '1d1', 'twenty', '1d20+', '10000d6']) {
      expect(() => parseDice(bad), bad).toThrow(DiceNotationError);
    }
  });

  it('rolls within the notation, modifier included', () => {
    const site = seeded().at('step', 'attack');
    for (let i = 0; i < 200; i += 1) {
      const total = site.dice('2d6+3');
      expect(total).toBeGreaterThanOrEqual(5);
      expect(total).toBeLessThanOrEqual(15);
    }
  });
});

describe('the tape', () => {
  it('records every draw, keyed by site and legible', () => {
    const rng = seeded();
    rng.at('skill-check', 'persuasion').dice('1d20');
    rng.at('lore', 'probability').chance(0.3);

    expect(rng.tape).toHaveLength(2);
    expect(rng.tape[0]).toMatchObject({
      key: 'skill-check:persuasion#0',
      site: 'skill-check',
      purpose: 'persuasion',
      index: 0,
      kind: 'dice',
      // `skill-check:persuasion d20 → 7` rather than an anonymous number.
      detail: '1d20',
      replayed: false,
    });
    expect(rng.tape[1]?.key).toBe('lore:probability#0');
  });

  it('indexes within a site, so two draws at one site are distinguishable', () => {
    const rng = seeded();
    const site = rng.at('skill-check', 'persuasion');
    site.dice('1d20');
    site.dice('1d20');

    expect(rng.tape.map((draw) => draw.key)).toEqual([
      'skill-check:persuasion#0',
      'skill-check:persuasion#1',
    ]);
  });

  it('survives a round trip through JSON, because it is part of the turn record', () => {
    const rng = seeded();
    rng.at('step', 'shuffle').shuffle(['a', 'b', 'c']);
    rng.at('step', 'pick').pick(['x', 'y']);

    const parsed = JSON.parse(JSON.stringify(rng.tape)) as Tape;
    expect(parsed).toEqual(rng.tape);
  });
});

describe('rewrite: replaying the tape', () => {
  /** A turn that draws in two places, the way a real one does. */
  function playTurn(rng: Rng): { roll: number; lore: boolean; order: string[] } {
    return {
      roll: rng.at('skill-check', 'persuasion').dice('1d20'),
      lore: rng.at('lore', 'probability').chance(0.5),
      order: rng.at('step', 'deck').shuffle(['a', 'b', 'c']),
    };
  }

  it('reproduces the same mechanical outcome from a different source', () => {
    // The point of the tape: same setup, same result, different words. The
    // replaying Rng is given a *different* seed, so anything that matched by
    // luck rather than by tape would show.
    const first = seeded(1);
    const before = playTurn(first);

    const rewrite = new Rng({ source: seededSource(999), replay: first.tape });
    const after = playTurn(rewrite);

    expect(after).toEqual(before);
    expect(rewrite.replayedAny).toBe(true);
    expect(rewrite.diverged).toBe(false);
    expect(rewrite.tape.every((draw) => draw.replayed)).toBe(true);
  });

  it('draws fresh where the path diverged, and says that it did', () => {
    // Partial replay is well-defined *because* the key is a site: the skill
    // check still replays even though a new draw appeared before it.
    const first = seeded(1);
    playTurn(first);

    const rewrite = new Rng({ source: seededSource(999), replay: first.tape });
    rewrite.at('new-step', 'appeared').int(1, 100);
    const after = playTurn(rewrite);

    expect(after.roll).toBe(playTurn(new Rng({ replay: first.tape })).roll);
    expect(rewrite.diverged).toBe(true);
    const fresh = rewrite.tape.filter((draw) => !draw.replayed);
    expect(fresh.map((draw) => draw.site)).toEqual(['new-step']);
  });

  it('is keyed by site rather than by position', () => {
    // The failure this prevents: a positional tape hands the value drawn for a
    // lore probability to a skill check the moment an earlier draw appears.
    const first = seeded(1);
    const originalRoll = first.at('skill-check', 'persuasion').dice('1d20');
    first.at('lore', 'probability').chance(0.5);

    const rewrite = new Rng({ source: seededSource(999), replay: first.tape });
    rewrite.at('earlier', 'inserted').int(1, 6);
    const replayedRoll = rewrite.at('skill-check', 'persuasion').dice('1d20');

    expect(replayedRoll).toBe(originalRoll);
  });

  it('will not hand a recorded value to a different question', () => {
    // Same key, different draw: the tape has `1d20` and the caller now asks for
    // `1d6`. Replaying the old number would be the positional failure wearing a
    // key, so it draws fresh instead.
    const first = seeded(1);
    first.at('skill-check', 'persuasion').dice('1d20');

    const rewrite = new Rng({ source: seededSource(7), replay: first.tape });
    const value = rewrite.at('skill-check', 'persuasion').dice('1d6');

    expect(value).toBeLessThanOrEqual(6);
    expect(rewrite.tape[0]?.replayed).toBe(false);
  });

  it('is not the same thing as a reroll', () => {
    // Reroll is the explicit second action: no tape, fresh draws, new outcome.
    // Which is also why rewrite is the default — otherwise swiping is
    // save-scumming by accident.
    const first = seeded(1);
    const before = playTurn(first);

    const reroll = new Rng({ source: seededSource(999) });
    const after = playTurn(reroll);

    expect(reroll.replayedAny).toBe(false);
    expect(after).not.toEqual(before);
  });
});

describe('the source', () => {
  it('is deterministic when seeded, which is what fixtures need', () => {
    const a = seeded(42);
    const b = seeded(42);
    const draw = (rng: Rng) => rng.at('step', 'x').int(1, 1_000_000);

    expect(draw(a)).toBe(draw(b));
  });
});

describe('a group contest replays to an entry, not to a position', () => {
  /**
   * The fault [P6 §0.1a] found and [P6.2] fixed, from both sides.
   *
   * `weightedPick` recorded an *index* into the candidate list, guarded on
   * replay by `detail = total=<summed weight>` alone. A group whose membership
   * changed without changing the sum therefore replayed the old index onto a
   * **different entry** — and reported `replayed: true` while doing it, so
   * `diverged` said the rewrite had reproduced the turn.
   *
   * Nothing could reach it before this stage: no production code constructed a
   * replaying `Rng`. [P6.2] is the stage that does, which is why the fix came
   * first — gate step 3 asks that *the record marks replayed vs fresh draws*,
   * and that sentence was satisfiable by a draw that replayed to the wrong
   * entry.
   */
  function contest(members: { id: string; weight: number }[]) {
    return members.map((member) => ({ id: member.id, value: member.id, weight: member.weight }));
  }

  const original = contest([
    { id: 'ferryman', weight: 1 },
    { id: 'lighthouse', weight: 1 },
    { id: 'omen', weight: 1 },
  ]);

  /** The first run, and the winner it recorded. */
  function firstRun(seed: number): { rng: Rng; won: string } {
    const rng = new Rng({ source: seededSource(seed) });
    return { rng, won: rng.at('lore.group', 'weather').weightedPick(original) };
  }

  it('replays the same winner when the contest is the same', () => {
    const { rng, won } = firstRun(1);

    const rewrite = new Rng({ source: seededSource(999), replay: rng.tape });
    expect(rewrite.at('lore.group', 'weather').weightedPick(original)).toBe(won);
    expect(rewrite.tape[0]?.replayed).toBe(true);
    expect(rewrite.diverged).toBe(false);
  });

  it('records the winner rather than where it stood', () => {
    // The record is legible for the same reason it is safe: *this entry won*,
    // rather than *index two won* of a list nobody kept.
    const { rng, won } = firstRun(1);
    expect(rng.tape[0]?.value).toBe(won);
    expect(typeof rng.tape[0]?.value).toBe('string');
  });

  it('still replays when the same members are in a different order', () => {
    // A reorder is not a different contest: the same entry is still there to
    // win. Recording the position would have replayed onto whoever now stands
    // where the winner used to; putting the members into `detail` instead would
    // have missed and drawn fresh, which is safe but loses a rewrite that
    // should have held.
    const { rng, won } = firstRun(1);
    const reordered = [...original].reverse();

    const rewrite = new Rng({ source: seededSource(999), replay: rng.tape });
    expect(rewrite.at('lore.group', 'weather').weightedPick(reordered)).toBe(won);
    expect(rewrite.tape[0]?.replayed).toBe(true);
  });

  it('draws fresh when the winner is no longer in the contest', () => {
    // **The falsifying case**, and it is built so the weight sum is unchanged:
    // one member swapped for another of equal weight. Under the old record this
    // replayed the winner's index onto whoever inherited it, and said
    // `replayed: true`.
    const { rng, won } = firstRun(1);
    const without = contest([
      ...original.filter((item) => item.id !== won).map((item) => ({ ...item })),
      { id: 'stranger', weight: 1 },
    ]);
    expect(without.reduce((sum, item) => sum + item.weight, 0)).toBe(
      original.reduce((sum, item) => sum + item.weight, 0),
    );

    const rewrite = new Rng({ source: seededSource(999), replay: rng.tape });
    const winner = rewrite.at('lore.group', 'weather').weightedPick(without);

    expect(winner).not.toBe(won);
    expect(without.some((item) => item.id === winner)).toBe(true);
    // And it says so, which is the half gate step 3 leans on.
    expect(rewrite.tape[0]?.replayed).toBe(false);
    expect(rewrite.diverged).toBe(true);
  });

  it('draws fresh when the winner is still there with its weight zeroed', () => {
    // *Zero-weight entries are never chosen* is this method's promise, and a
    // replay is where it would quietly stop being true.
    //
    // **The weight the winner lost is given to somebody else**, so the total is
    // unchanged and `detail` still matches. Without that this test passes for
    // the wrong reason — the mutation pass found exactly that, since zeroing a
    // weight ordinarily moves the sum and the guard refuses on the sum before
    // it ever asks about the winner.
    const { rng, won } = firstRun(1);
    const other = original.find((item) => item.id !== won)?.id;
    const silenced = original.map((item) =>
      item.id === won
        ? { ...item, weight: 0 }
        : { ...item, weight: item.id === other ? item.weight + 1 : item.weight },
    );
    expect(silenced.reduce((sum, item) => sum + item.weight, 0)).toBe(
      original.reduce((sum, item) => sum + item.weight, 0),
    );

    const rewrite = new Rng({ source: seededSource(999), replay: rng.tape });
    const winner = rewrite.at('lore.group', 'weather').weightedPick(silenced);

    expect(winner).not.toBe(won);
    expect(rewrite.tape[0]?.replayed).toBe(false);
  });
});

/**
 * ***A rewrite swipe replays call k's draws*** — `swipeReplay` and
 * `Rng.speaking`, 2026-09-29 at the [P14.4] review. A swipe from message *k*
 * makes call *k* first, so its keys count from 0 where the original's call *k*
 * counted from wherever calls `0..k-1` left them.
 */
describe('a rewrite swipe from message k', () => {
  /** A round of three speaking calls, each rolling the same entry, after a turn-wide draw. */
  function aRound(): Rng {
    const rng = seeded(7);
    rng.at('se.hooks', 'entrance').float();
    for (const message of [0, 1, 2]) {
      rng.speaking(message, () => rng.at('lore.probability', 'ferry').float());
    }
    return rng;
  }

  it('tags the draws a speaking call makes, and nothing else', () => {
    const rng = aRound();
    expect(rng.tape.map((draw) => draw.message)).toEqual([undefined, 0, 1, 2]);
  });

  it('gives call k the draw the original call k made, re-keyed from 0', () => {
    const original = aRound();
    const rolledFor = (message: number): unknown =>
      original.tape.find((draw) => draw.message === message)?.value;

    const swipe = new Rng({
      source: seededSource(999),
      replay: swipeReplay(original.tape, 1),
    });
    swipe.at('se.hooks', 'entrance').float();
    const first = swipe.speaking(1, () => swipe.at('lore.probability', 'ferry').float());
    const second = swipe.speaking(2, () => swipe.at('lore.probability', 'ferry').float());

    expect([first, second]).toEqual([rolledFor(1), rolledFor(2)]);
    expect(swipe.tape.every((draw) => draw.replayed)).toBe(true);
    expect(swipe.tape.map((draw) => [draw.key, draw.message])).toEqual([
      ['se.hooks:entrance#0', undefined],
      ['lore.probability:ferry#0', 1],
      ['lore.probability:ferry#1', 2],
    ]);
  });

  it('drops lore draws from a tape recorded before the tag, and keeps it whole from 0', () => {
    const untagged: Tape = aRound().tape.map((draw) => {
      const copy = { ...draw };
      delete copy.message;
      return copy;
    });
    expect(swipeReplay(untagged, 1).map((draw) => draw.site)).toEqual(['se.hooks']);
    expect(swipeReplay(untagged, 0)).toBe(untagged);
  });
});
