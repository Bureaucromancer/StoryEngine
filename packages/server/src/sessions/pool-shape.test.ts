// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { PlotHook } from '@storyengine/shared';

import { pooledId, readPool } from './pool-shape.js';

/**
 * ***What the engine may read of a pool, and what it may only show***
 * (2026-09-27). Every reader trusted the pool's type, so one hook without
 * `involves` stopped the session reading and every turn committing.
 */

const fine: PlotHook = {
  id: 'hook-fine',
  title: 'War',
  premise: 'The Flower Kingdom will declare war.',
  magnitude: 'sweeping',
  involves: [],
  weight: 1,
  delivery: 'guidance',
  once: true,
};

describe('reading a pool', () => {
  it('keeps a hook the schema takes, from a source it knows, for the engine', () => {
    const { usable, malformed } = readPool([{ hook: fine, source: { kind: 'session' } }]);

    expect(usable.map((entry) => entry.hook.id)).toEqual(['hook-fine']);
    expect(malformed).toEqual([]);
  });

  it('holds back what the schema refuses, for the panel to name', () => {
    const { usable, malformed } = readPool([
      { hook: { ...fine, involves: undefined }, source: { kind: 'session' } },
      { hook: { ...fine, blockedBy: 5 }, source: { kind: 'session' } },
      { hook: fine, source: { kind: 'lore' } },
      { hook: fine },
    ]);

    expect(usable).toEqual([]);
    expect(malformed).toHaveLength(4);
  });

  it('answers an empty pool for anything that is not a list, and skips what is not an entry', () => {
    expect(readPool({ hook: fine })).toEqual({ usable: [], malformed: [] });
    expect(readPool(undefined)).toEqual({ usable: [], malformed: [] });
    expect(readPool([null, 'hook', 7])).toEqual({ usable: [], malformed: [] });
  });

  it('finds the id an entry answers to, whatever else it lacks', () => {
    expect(pooledId({ hook: { id: 'broken' } })).toBe('broken');
    expect(pooledId({ hook: null })).toBeUndefined();
    expect(pooledId('hook')).toBeUndefined();
  });
});
