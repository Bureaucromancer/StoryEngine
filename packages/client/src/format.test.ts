// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  formatCalendarDate,
  formatCount,
  formatDuration,
  formatEpochMs,
  formatTimestamp,
  timestampsOf,
} from './format.js';

/**
 * Date formatting, and the one input that used to take the page down with it.
 *
 * Written for [P2A §3](../../../docs/design/workplan/09-p2a-configuration-surface.md) stage
 * P2A.2, which makes a locale something **a person types into a form**. Until
 * then it could only arrive from `Accept-Language` at first-run setup — a header
 * a browser generates, and therefore always well formed.
 */

const NOON = Date.UTC(2026, 7, 16, 12);

describe('a locale the browser will not accept', () => {
  /**
   * `new Intl.DateTimeFormat('en_GB')` throws a `RangeError` — underscore rather
   * than hyphen, which is the single most likely thing for somebody to type.
   *
   * The failure that made this worth repairing is not the wrong date; it is that
   * the throw happened during render, so one bad value blanked **every date on
   * every page** — including the settings page holding the field that would fix
   * it. A person could lock themselves out of the repair with a typo.
   */
  it('falls back rather than throwing', () => {
    expect(() => formatTimestamp(new Date(NOON).toISOString(), 'en_GB')).not.toThrow();
    expect(() => formatEpochMs(NOON, 'en_GB')).not.toThrow();
  });

  it('still produces a readable date', () => {
    const formatted = formatEpochMs(NOON, 'en_GB');

    // A date in the wrong locale is legible; a page that will not render is not.
    // Asserted as "says 2026" rather than an exact string, because the fallback
    // is the *runtime's* locale and a test that pinned it would be asserting
    // about the machine.
    expect(formatted).toContain('2026');
  });

  it('is not repaired by validating the field, because it also comes off disk', () => {
    // `accounts.json` is hand-editable by design ([09 §4.3]), so the check has
    // to be where the value is *used*. This is that claim as a test: nothing
    // between the file and here is asked to have vetted it.
    expect(() => formatEpochMs(NOON, '')).not.toThrow();
    expect(() => formatEpochMs(NOON, 'zz-ZZ-nonsense-tag')).not.toThrow();
  });
});

describe('an ordinary locale', () => {
  it('is honoured', () => {
    // Two locales that order the parts differently, so the assertion is that the
    // argument reached `Intl` rather than that any string came back.
    const american = formatEpochMs(NOON, 'en-US');
    const british = formatEpochMs(NOON, 'en-GB');

    expect(american).not.toBe(british);
    expect(british).toContain('2026');
  });
});

describe('timestampsOf', () => {
  it('reads provenance when it is there', () => {
    expect(
      timestampsOf({ provenance: { createdAt: '2026-08-16T12:00:00Z', updatedAt: null } }),
    ).toEqual({ createdAt: '2026-08-16T12:00:00Z', updatedAt: null });
  });

  it('answers nulls for an object with no provenance rather than throwing', () => {
    expect(timestampsOf({})).toEqual({ createdAt: null, updatedAt: null });
    expect(timestampsOf({ provenance: 'not an object' })).toEqual({
      createdAt: null,
      updatedAt: null,
    });
  });
});

describe('an unparsable timestamp', () => {
  it('comes back unchanged, because the value is still information', () => {
    expect(formatTimestamp('whenever', 'en-GB')).toBe('whenever');
  });
});

/**
 * The number half, added at [P3.2] with the workbench's token and wall-time
 * columns — 07 §12.6 mandates `Intl` for numbers, and §12.6a classes a
 * hand-rolled duration as a rewrite if deferred. Locales are pinned to
 * `en-US` where an exact string is asserted, so the tests describe the
 * formatter and not the machine.
 */
describe('counts and durations', () => {
  it('groups a count the way the locale reads it', () => {
    expect(formatCount(128_000, 'en-US')).toBe('128,000');
    expect(formatCount(61, 'en-US')).toBe('61');
  });

  it('gives a duration the precision its magnitude deserves', () => {
    expect(formatDuration(999, 'en-US')).toBe('999 ms');
    // The real record's 59-second model call, as a person reads it.
    expect(formatDuration(59_029, 'en-US')).toBe('59 sec');
    expect(formatDuration(90_000, 'en-US')).toBe('1.5 min');
  });

  it('falls back rather than throwing on a typed locale', () => {
    // The same P2A stance as the dates: the value also arrives from a
    // hand-editable file, so the check lives where the value is used. The
    // falsifying mutation is rethrowing instead of falling back.
    expect(() => formatCount(1000, 'en_GB')).not.toThrow();
    expect(() => formatDuration(1000, 'en_GB')).not.toThrow();
  });
});

/**
 * The calendar half — [home, revised]. A CHANGELOG release heading's date has
 * no time and no zone, and the bug this guards is the one that only shows up
 * for readers in the wrong half of the world.
 */
describe('a calendar date', () => {
  it('renders the day that was written, not the one before it', () => {
    // **The falsifying mutation is dropping `timeZone: 'UTC'`.** Without it
    // this reads as the eighth in every zone behind Greenwich, because
    // `new Date('2026-09-09')` is UTC midnight. The day is asserted rather than
    // the whole ICU string, which moves between Node releases.
    expect(formatCalendarDate('2026-09-09', 'en-GB')).toContain('9');
    expect(formatCalendarDate('2026-09-09', 'en-GB')).not.toContain('8 Sep');
    expect(formatCalendarDate('2026-09-09', 'en-US')).toBe('Sep 9, 2026');
  });

  it('does not move the day whatever zone the machine is in', () => {
    // Pinned by construction rather than by trusting the runner's TZ: the two
    // zones furthest either side of UTC would disagree if the format did not
    // pin one. `Intl` reads the option, not the environment.
    const written = formatCalendarDate('2026-01-01', 'en-US');

    expect(written).toBe('Jan 1, 2026');
  });

  it('gives back anything that is not a calendar date, unchanged', () => {
    // `formatTimestamp`'s posture: the value is still information. An RFC 3339
    // instant is deliberately in this list — it belongs to the other function,
    // and quietly accepting it here is how the two stop being distinguishable.
    for (const input of ['', 'unknown', '2026-9-9', '2026-09-09T00:00:00Z', '9 September 2026']) {
      expect(formatCalendarDate(input, 'en-US'), input).toBe(input);
    }
  });

  it('refuses a well-formed date that is not a real one', () => {
    // `Date.UTC` rolls over instead of refusing: before the round-trip check
    // these rendered as *Feb 9, 2027* and *Mar 1, 2025* rather than as the
    // nonsense they are. Found by this test, which is why it is here.
    expect(formatCalendarDate('2026-13-40', 'en-US')).toBe('2026-13-40');
    expect(formatCalendarDate('2025-02-29', 'en-US')).toBe('2025-02-29');
    expect(formatCalendarDate('2026-00-10', 'en-US')).toBe('2026-00-10');
  });

  it('falls back rather than throwing on a typed locale', () => {
    expect(() => formatCalendarDate('2026-09-09', 'en_GB')).not.toThrow();
  });
});
