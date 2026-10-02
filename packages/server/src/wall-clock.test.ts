// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { WALL_CLOCK_TOLERANCE_MS, type WallClockWatch, watchWallClock } from './wall-clock.js';

/**
 * ***A jump, told from time passing*** (2026-09-27) — `wall-clock.ts`.
 *
 * Two hand-driven clocks: the wall clock that can be set, and the machine's
 * uptime, which only passes.
 */

const HOUR = 60 * 60 * 1000;

/** Both clocks, and a watch over them. `now` is moved by hand. */
function clocks(): { now: { wall: number; up: number }; watch: WallClockWatch } {
  const now = { wall: 1_790_000_000_000, up: 5 * HOUR };
  return { now, watch: watchWallClock({ wall: () => now.wall, elapsed: () => now.up }) };
}

describe('the wall clock', () => {
  it('has not jumped when it moved as far as time did', () => {
    const at = clocks();
    at.now.wall += 24 * HOUR;
    at.now.up += 24 * HOUR;
    expect(at.watch.jumped()).toBe(false);
  });

  it('has not jumped over a night asleep, which uptime counts', () => {
    // What `performance.now()` would have got wrong: the process's monotonic
    // clock stops while the machine sleeps, and uptime does not.
    const at = clocks();
    at.now.wall += 8 * HOUR;
    at.now.up += 8 * HOUR;
    expect(at.watch.jumped()).toBe(false);
  });

  it('has jumped when it was set forward, and is measured from there after', () => {
    const at = clocks();
    at.now.wall += 30 * 24 * HOUR;
    at.now.up += HOUR;
    expect(at.watch.jumped()).toBe(true);

    at.now.wall += HOUR;
    at.now.up += HOUR;
    expect(at.watch.jumped()).toBe(false);
  });

  it('has jumped when it was set back', () => {
    const at = clocks();
    at.now.wall -= 2 * HOUR;
    expect(at.watch.jumped()).toBe(true);
  });

  it('allows what a clock slewed into step drifts by', () => {
    const at = clocks();
    at.now.wall += 24 * HOUR + WALL_CLOCK_TOLERANCE_MS - 1;
    at.now.up += 24 * HOUR;
    expect(at.watch.jumped()).toBe(false);
  });
});
