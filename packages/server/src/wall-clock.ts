// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { uptime } from 'node:os';

/**
 * ***Has the wall clock jumped since the last look?*** (2026-09-27)
 *
 * Housekeeping that deletes by age trusts `Date.now()`, and the wall clock is
 * the one clock that can be wrong by years. A board with no battery for its
 * clock boots in 1970 or at whatever time it last saved, and steps when the
 * network comes up. A host whose clock is set by hand, a virtual machine
 * restored from a snapshot, or a GPS source with a bad day can move it a month
 * in either direction. The trash window and the operational store's age limits
 * are both measured against it, and a clock that leapt forward past the window
 * would empty the trash of everything that was still somebody's to restore.
 *
 * **What this compares it with is how long the machine has been up**, which
 * advances at the rate time actually passes and does not step when the wall
 * clock is set. Between two looks, the wall clock should have moved as far as
 * that has. A difference beyond the tolerance is a step, and the pass that
 * noticed it is skipped.
 *
 * ***Not `performance.now()`***, which was the obvious choice and the wrong
 * one. The process's monotonic clock stops while the machine sleeps, and the
 * wall clock does not, so a laptop that sleeps overnight would look as if its
 * clock had leapt eight hours at every daily pass and would never sweep at all.
 * Uptime keeps counting through sleep on Linux, which is where the server
 * mostly runs, and there only a real step reads as one. Elsewhere, where uptime
 * is derived from the wall clock, the two move together, and the check sees
 * nothing rather than seeing something false.
 *
 * **One skip, then a new baseline.** A jump is reported once, and the next look
 * measures from where the clock is now. So a clock that was wrong and is then
 * put right costs one pass, and a clock that is simply wrong from then on is,
 * after one pass, the time as far as anything here can know. That is a limit
 * rather than a remedy: nothing inside a process can tell a wrong clock that
 * never moves from the right one.
 */
export interface WallClockWatch {
  /** True when the wall clock moved unlike real time since the last look. */
  jumped(): boolean;
}

/** Wider than any drift NTP slews, and far narrower than any retention window. */
export const WALL_CLOCK_TOLERANCE_MS = 10 * 60 * 1000;

export function watchWallClock(
  options: {
    toleranceMs?: number;
    /** The clock that can be set: `Date.now`, unless a test says otherwise. */
    wall?: () => number;
    /** Real time passing, in milliseconds: the machine's uptime, unless a test says otherwise. */
    elapsed?: () => number;
  } = {},
): WallClockWatch {
  const tolerance = options.toleranceMs ?? WALL_CLOCK_TOLERANCE_MS;
  const wall = options.wall ?? Date.now;
  const elapsed = options.elapsed ?? (() => uptime() * 1000);
  let last = { wall: wall(), elapsed: elapsed() };

  return {
    jumped() {
      const now = { wall: wall(), elapsed: elapsed() };
      const drift = now.wall - last.wall - (now.elapsed - last.elapsed);
      last = now;
      return Math.abs(drift) > tolerance;
    },
  };
}
