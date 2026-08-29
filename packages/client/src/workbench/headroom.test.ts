// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { BudgetVerdict } from '@storyengine/shared';

import { headroom } from './headroom.js';

/**
 * Gate step 5's guard: *"on a turn with plenty of headroom it does not claim
 * the system instruction is about to fall out."* The record's `nextToDrop`
 * is unconditionally the next survivor in sacrifice order — the first real
 * turn named the system instruction at 61 of 5,344 spent — so the pressure
 * judgement is the view's, and this is it. The falsifying mutation is
 * removing the ratio guard (imminent unconditionally true).
 */

function verdict(over: Partial<BudgetVerdict> = {}): BudgetVerdict {
  return {
    limit: { tokens: 6144, ceiling: 8192, source: 'user', share: 0.75 },
    reserved: 800,
    spent: 61,
    decisions: [],
    nextToDrop: ['se.instruction'],
    ...over,
  };
}

describe('headroom', () => {
  it('does not cry wolf on the real record shape', () => {
    // 61 spent of 5,344 available — the measured false alarm, defused.
    const roomy = headroom(verdict());
    expect(roomy.available).toBe(5344);
    expect(roomy.imminent).toBe(false);
    // The answer is still carried: what falls next is the verdict's promise,
    // and the phrasing — not the hiding — is what changes with pressure.
    expect(roomy.next).toEqual(['se.instruction']);
  });

  it('warns when spending crosses the ratio', () => {
    expect(headroom(verdict({ spent: 4543 })).imminent).toBe(true);
    expect(headroom(verdict({ spent: 4542 })).imminent).toBe(false);
  });

  it('treats a window with no room at all as imminent', () => {
    const crushed = headroom(
      verdict({ limit: { tokens: 500, ceiling: 500, source: 'provider' }, reserved: 800 }),
    );
    expect(crushed.available).toBe(0);
    expect(crushed.imminent).toBe(true);
  });

  it('carries an empty next-to-drop as it is', () => {
    expect(headroom(verdict({ nextToDrop: [] })).next).toEqual([]);
  });
});
