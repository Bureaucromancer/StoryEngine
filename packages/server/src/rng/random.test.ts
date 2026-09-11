// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { randomOver } from './random.js';
import { Rng } from './rng.js';
import { seededSource } from './source.js';

/**
 * The host's `random` — [P7.0], [22 §4].
 *
 * **The claim under test is that it is an adapter and not a second
 * implementation.** The whole argument for converting the seam rather than the
 * service is that the tape does not notice: same draws, same keys, same replay,
 * with the asynchrony belonging to the boundary instead of to `Rng`. If that
 * stops being true, the turn record quietly acquires two kinds of randomness
 * and `rng.ts`'s *one place random numbers come from* is no longer one place.
 */
describe('random over an Rng', () => {
  /** The same seed, so two runs differ only in how they were reached. */
  function rng(): Rng {
    return new Rng({ source: seededSource(42) });
  }

  it('writes the same tape as the Rng it wraps', async () => {
    const direct = rng();
    direct.at('se.dice', 'opening').int(1, 6);
    direct.at('se.dice', 'opening').int(1, 6);

    const viaHost = rng();
    await randomOver(viaHost).at('se.dice', 'opening').int(1, 6);
    await randomOver(viaHost).at('se.dice', 'opening').int(1, 6);

    // Keys and values both: a key that matched while the value drifted would be
    // the failure that reconstructs wrong much later.
    expect(viaHost.tape).toEqual(direct.tape);
  });

  it('keys a draw by the site and purpose it was asked for', async () => {
    const source = rng();
    await randomOver(source).at('se.hooks', 'entrance').int(1, 6);

    expect(source.tape[0]?.key).toContain('se.hooks');
    expect(source.tape[0]?.key).toContain('entrance');
  });

  it('numbers repeated draws at one site, so two are distinguishable', async () => {
    const source = rng();
    const at = randomOver(source).at('se.hooks', 'entrance');
    await at.int(1, 6);
    await at.int(1, 6);

    // The property a rewrite depends on: indices within a site are automatic,
    // so replay can tell the first draw from the second.
    expect(new Set(source.tape.map((draw) => draw.key)).size).toBe(2);
  });

  it('replays through the host exactly as it replays through the service', async () => {
    const first = rng();
    const recorded = first.at('se.dice', 'opening').int(1, 6);

    // A rewrite: the tape is handed back, and the same site must produce the
    // same value and say it was replayed.
    const second = new Rng({ source: seededSource(999), replay: first.tape });
    const again = await randomOver(second).at('se.dice', 'opening').int(1, 6);

    expect(again).toBe(recorded);
    expect(second.tape[0]?.replayed).toBe(true);
  });

  it('carries a refused replay through as a fresh draw, like the service does', async () => {
    // `weightedPick` refuses a replay whose winner is no longer a candidate —
    // its own promise, and one the adapter must not launder into a silent
    // substitution.
    const first = rng();
    first.at('se.hooks', 'choice').weightedPick([
      { id: 'a', value: 'a', weight: 1 },
      { id: 'b', value: 'b', weight: 1 },
    ]);

    const second = new Rng({ source: seededSource(999), replay: first.tape });
    await randomOver(second)
      .at('se.hooks', 'choice')
      .weightedPick([{ id: 'c', value: 'c', weight: 1 }]);

    expect(second.tape[0]?.replayed).toBe(false);
  });

  it('names a site without drawing from it', () => {
    // `at` is synchronous because it makes no draw, which is what keeps a step
    // that names a site and then declines to use it from paying a round trip.
    const source = rng();
    randomOver(source).at('se.dice', 'opening');

    expect(source.tape).toHaveLength(0);
  });
});
