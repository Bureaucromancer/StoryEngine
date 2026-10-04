// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { isUuidv7 } from '@storyengine/shared';

import { producedTurnId } from './producer.js';

/**
 * ***A derived turn id*** — [P13.10](../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * `producer.ts`. The property a producer relies on is that the same source turn
 * gives the same id on every run and nothing else gives it; the rest is shape,
 * because the id becomes a path and a route parameter.
 */

const PARTS = {
  handle: 'ned',
  origin: 'aventura.db/stories/0b5c1f36',
  sourceId: 'entry-1',
  at: Date.UTC(2026, 4, 1, 9, 30),
};

/** RFC 9562 version 8, variant 0b10, lower-case hex — a shape every path takes. */
const V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('producedTurnId', () => {
  it('gives the same source turn the same id every time', () => {
    expect(producedTurnId({ ...PARTS })).toBe(producedTurnId({ ...PARTS }));
  });

  it('is a version 8 UUID, and does not claim to be one of our own', () => {
    const id = producedTurnId(PARTS);
    expect(id).toMatch(V8);
    // `isUuidv7` is for our own writes, and this is not one.
    expect(isUuidv7(id)).toBe(false);
  });

  /**
   * ***Every part is identity***, the handle included: a turn id is one row on
   * the install, so two accounts importing one database must not meet.
   */
  it('differs when any identifying part does', () => {
    const base = producedTurnId(PARTS);
    for (const over of [
      { handle: 'amy' },
      { origin: 'aventura.db/stories/other' },
      { sourceId: 'entry-2' },
    ]) {
      expect(producedTurnId({ ...PARTS, ...over }), JSON.stringify(over)).not.toBe(base);
    }
  });

  /**
   * *Length-prefixed, not joined* — `stableId` joins with a space, so
   * `('a b', 'c')` and `('a', 'b c')` would hash one text.
   */
  it('does not confuse where one part ends and the next begins', () => {
    expect(producedTurnId({ ...PARTS, origin: 'story a', sourceId: 'b' })).not.toBe(
      producedTurnId({ ...PARTS, origin: 'story', sourceId: 'a b' }),
    );
  });

  /**
   * ***Sorted by the source's own time***, as our ids sort by mint time — so
   * the exporter's id sort lays a produced session out in the order it
   * happened.
   */
  it('carries the source time in its first 48 bits, so ids sort by it', () => {
    const earlier = producedTurnId({ ...PARTS, sourceId: 'zzz', at: PARTS.at });
    const later = producedTurnId({ ...PARTS, sourceId: 'aaa', at: PARTS.at + 1 });
    expect(earlier < later).toBe(true);
    const ms = Number.parseInt(earlier.slice(0, 8) + earlier.slice(9, 13), 16);
    expect(ms).toBe(PARTS.at);
  });

  /** A time no source meant moves where the id sorts, never whether it is stable. */
  it('clamps a time a source could not have meant', () => {
    for (const at of [-1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      const id = producedTurnId({ ...PARTS, at });
      expect(id, String(at)).toMatch(V8);
      expect(producedTurnId({ ...PARTS, at }), String(at)).toBe(id);
    }
    expect(producedTurnId({ ...PARTS, at: -1 }).slice(0, 13)).toBe('00000000-0000');
    expect(producedTurnId({ ...PARTS, at: 2 ** 60 }).slice(0, 13)).toBe('ffffffff-ffff');
  });

  it('does not collide across a story of many turns', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 5000; n += 1) {
      seen.add(producedTurnId({ ...PARTS, sourceId: `entry-${String(n)}`, at: PARTS.at }));
    }
    expect(seen.size).toBe(5000);
  });
});
