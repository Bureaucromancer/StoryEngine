// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { AssembledBlock } from '@storyengine/shared';

import { alignBlocks, changeOf } from './align.js';

/**
 * The pairing the compare view rests on — [P3.6], [P3 §1.5].
 *
 * Pure, so it is asserted here rather than through a rendering: what can go
 * wrong is a statement about two arrays, and the failure mode the design names
 * is one a rendered test would show as a plausible table.
 */

function block(id: string, over: Partial<AssembledBlock> = {}): AssembledBlock {
  return {
    id,
    source: { kind: 'preset', blockId: id },
    reason: 'instruction',
    role: 'system',
    text: `the text of ${id}`,
    tokens: 10,
    included: true,
    ...over,
  };
}

describe('aligning two block tables', () => {
  it('pairs by id, not by position — the whole reason it exists', () => {
    // One block dropped from the middle of the left side. Aligned by index,
    // every row below it reports as changed; aligned by id, exactly one row
    // is absent on the right and the rest pair up untouched. The falsifying
    // mutation is `after[index]` in place of the id lookup.
    const before = [block('a'), block('b'), block('c')];
    const after = [block('a'), block('c')];

    const aligned = alignBlocks(before, after);

    expect(aligned.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(aligned[0]?.after?.id).toBe('a');
    expect(aligned[1]?.after).toBeUndefined();
    expect(aligned[2]?.after?.id).toBe('c');
  });

  it('keeps the left order, then appends what only the right has', () => {
    // Left's order is the order the budgeter considered, so it leads; a block
    // the right added cannot be slotted into an order it was never part of,
    // so it goes after rather than being invented a position.
    const aligned = alignBlocks([block('a'), block('b')], [block('b'), block('z')]);

    expect(aligned.map((row) => row.id)).toEqual(['a', 'b', 'z']);
    expect(aligned[2]?.before).toBeUndefined();
    expect(aligned[2]?.after?.id).toBe('z');
  });

  it('survives a history block whose position moved but whose id did not', () => {
    // The repair P3.0 made for this stage: a history block is keyed by the id
    // of the turn it came from, so a sliding window changes where it sits
    // without changing what it is. Aligned by position these would be two
    // different rows.
    const from9 = block('se.history.t-9.output', {
      source: { kind: 'history', turnId: 't-9', range: [4, 4], part: 'output' },
    });
    const from10 = block('se.history.t-10.output', {
      source: { kind: 'history', turnId: 't-10', range: [5, 5], part: 'output' },
    });

    const aligned = alignBlocks([from9, from10], [from10, from9]);

    expect(aligned).toHaveLength(2);
    // Asserted as *which* block each side holds, not merely that both sides
    // hold one: paired by position these two would still both be present,
    // just crossed over, and a test that only counted them would pass.
    for (const row of aligned) {
      expect(row.before?.id).toBe(row.id);
      expect(row.after?.id).toBe(row.id);
    }
  });

  it('is empty for two turns that assembled nothing', () => {
    expect(alignBlocks([], [])).toEqual([]);
  });
});

describe('what changed about a block', () => {
  const same = { id: 'a', before: block('a'), after: block('a') };

  it('calls an identical block with an identical ruling the same', () => {
    expect(changeOf(same, 'included — priority 90', 'included — priority 90')).toBe('same');
  });

  it('separates a moved ruling from an edited block', () => {
    /**
     * The case that would otherwise read as an edit nobody made: past the
     * history window's length the same block carries a different priority in
     * two adjacent turns, because its priority *is* its position. Folding
     * that into "changed" would have the view claim a change the reader did
     * not cause. The falsifying mutation is returning 'changed' here.
     */
    expect(changeOf(same, 'included — priority 20', 'included — priority 19')).toBe('ruling');
  });

  it('reports a block that was dropped on one side', () => {
    const dropped = {
      id: 'a',
      before: block('a', { included: true }),
      after: block('a', { included: false, droppedBy: 'over budget — priority 20' }),
    };
    expect(changeOf(dropped, 'included — priority 20', 'over budget — priority 20')).toBe(
      'changed',
    );
  });

  it('reports edited text and a changed token count', () => {
    expect(
      changeOf({ id: 'a', before: block('a'), after: block('a', { text: 'other' }) }, 'r', 'r'),
    ).toBe('changed');
    expect(
      changeOf({ id: 'a', before: block('a'), after: block('a', { tokens: 40 }) }, 'r', 'r'),
    ).toBe('changed');
  });

  it('names a block only one side has', () => {
    expect(changeOf({ id: 'a', before: undefined, after: block('a') }, undefined, 'r')).toBe(
      'added',
    );
    expect(changeOf({ id: 'a', before: block('a'), after: undefined }, 'r', undefined)).toBe(
      'removed',
    );
  });
});
