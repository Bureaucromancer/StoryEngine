// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLorebook, newSetup, newTreatment, type PlotHook } from '@storyengine/shared';

import type { ResolvedLore } from '../turns/lore.js';
import { poolFor } from './hooks.js';

/**
 * The hook pool and its four sources — [03 §4.1], [06 §6.1], [P7.5].
 *
 * **The sharp assertion here is an id.** [15 §5]'s first obligation is that *a
 * copied hook keeps the source hook's id*, because within a continuity a hook
 * that fired in session one must not fire again in session two — and
 * cross-session de-duplication is only possible if the copy preserved it. [P7.5]
 * calls that *free at this stage and unrecoverable after it*: **a corpus of
 * sessions whose hooks have unrelated ids cannot be retro-fitted into a
 * continuity, because the linking information was never written.**
 *
 * So it is pinned rather than left as a property of a `structuredClone`, which
 * is a thing somebody could reasonably replace with a factory call.
 */

function hook(id: string, title = id): PlotHook {
  return {
    id,
    title,
    premise: 'Something happens.',
    magnitude: 'local',
    involves: [],
    weight: 1,
    delivery: 'guidance',
    once: true,
  };
}

function lore(over: Partial<ResolvedLore> = {}): ResolvedLore {
  return { treatment: null, books: [], missing: [], ...over };
}

function treatmentSource(id: string, hooks: PlotHook[]): ResolvedLore['treatment'] {
  const made = newTreatment('Rain City, noir');
  return { treatment: { ...made, hooks }, id, contentHash: 'sha256:t' };
}

function bookSource(id: string, hooks: PlotHook[]): ResolvedLore['books'][number] {
  const made = newLorebook('Rain City');
  // `by` is which route admitted the book — the treatment's link or the
  // session's own list. The pool does not read it: a hook's eligibility keys on
  // whether the *book* is still active, not on how it got there.
  return { book: { ...made, hooks }, id, contentHash: 'sha256:b', required: false, by: 'session' };
}

describe('the pool a session starts with', () => {
  /**
   * ***The obligation.*** Not a general statement about copying — the specific
   * one [15 §5] needs, asserted on the value that carries it.
   */
  it('keeps the source hook’s id, which a continuity cannot be built without', () => {
    const pool = poolFor({ lore: lore({ treatment: treatmentSource('t1', [hook('hook-war')]) }) });

    expect(pool[0]?.hook.id).toBe('hook-war');
  });

  it('copies rather than referencing, so editing the treatment cannot reach the game', () => {
    const source = hook('hook-war');
    const pool = poolFor({ lore: lore({ treatment: treatmentSource('t1', [source]) }) });

    source.premise = 'Something else happens.';

    // [06 §6.1]'s *pulled, never pushed* over [00 §3.1] — the preset's
    // asymmetry, and the opposite of the cast's.
    expect(pool[0]?.hook.premise).toBe('Something happens.');
  });

  it('attributes each hook to whichever object owns it', () => {
    const setup = { ...newSetup('The Fixer’s Debt'), hooks: [hook('hook-debt')] };
    const pool = poolFor({
      lore: lore({
        treatment: treatmentSource('t1', [hook('hook-war')]),
        books: [bookSource('b1', [hook('hook-flower')])],
      }),
      setup,
      own: [hook('hook-mine')],
    });

    // 03 §4.1's mitigation for four sources: *every hook shows its source, and
    // editing navigates to whichever object owns it.*
    expect(pool.map((one) => [one.hook.id, one.source])).toEqual([
      ['hook-war', { kind: 'treatment', id: 't1' }],
      ['hook-debt', { kind: 'setup', id: setup.id }],
      ['hook-flower', { kind: 'lore', id: 'b1' }],
      ['hook-mine', { kind: 'session' }],
    ]);
  });

  /**
   * **The lorebook's id is mechanical, not navigational.** 03 §4.1: a hook
   * carried by a lorebook *"is only eligible while that lorebook is active in
   * the session"* — so the filter needs something to check the session's live
   * book list against, and without the id there would be nothing.
   */
  it('records which book a lorebook-borne hook came from', () => {
    const pool = poolFor({ lore: lore({ books: [bookSource('b1', [hook('hook-flower')])] }) });

    expect(pool[0]?.source).toEqual({ kind: 'lore', id: 'b1' });
  });

  it('reads a lorebook that carries no hooks at all, which is most of them', () => {
    // `Lorebook.hooks` is optional — 03 §4.1 calls carrying them *allowed,
    // secondary*, so absent is the ordinary state.
    const made = newLorebook('Rain City');
    const pool = poolFor({
      lore: lore({
        books: [{ book: made, id: 'b1', contentHash: 'sha256:b', required: false, by: 'session' }],
      }),
    });

    expect(pool).toEqual([]);
  });

  /**
   * *Deliberately no de-duplication.* The same hook reaching a session through
   * two sources is a real authoring situation — a treatment and one of its own
   * lorebooks — and collapsing them here would drop the attribution 03 §4.1
   * requires. The filter keys on the id, so a duplicate fires once regardless.
   */
  it('keeps a hook that arrives twice, with both attributions', () => {
    const pool = poolFor({
      lore: lore({
        treatment: treatmentSource('t1', [hook('hook-war')]),
        books: [bookSource('b1', [hook('hook-war')])],
      }),
    });

    expect(pool).toHaveLength(2);
    expect(pool.map((one) => one.source.kind)).toEqual(['treatment', 'lore']);
  });

  it('is empty when nothing carried any', () => {
    expect(poolFor({ lore: lore() })).toEqual([]);
  });
});
