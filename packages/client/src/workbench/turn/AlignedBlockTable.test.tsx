// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AssembledBlock, BudgetVerdict } from '@storyengine/shared';

import { AlignedBlockTable } from './AlignedBlockTable.js';

/**
 * The comparison's one rendering — [P3.6].
 *
 * `align.test.ts` proves the pairing; this proves what a reader is told about
 * it. The two claims worth a test are the ones a plausible-looking table gets
 * wrong silently: **absent is not zero**, and **a ruling that moved is not an
 * edit**. Both would render as a perfectly ordinary row.
 *
 * No router mock, unlike `views.test.tsx`: this table names a block's source
 * and never links it, because [address.ts]'s `history` arm is exactly the
 * source kind a comparison is most often about and it has no page to point at.
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

function historyBlock(id: string, over: Partial<AssembledBlock> = {}): AssembledBlock {
  return block(id, {
    source: { kind: 'history', turnId: 't-9', range: [0, 0], part: 'output' },
    reason: 'history',
    role: 'assistant',
    ...over,
  });
}

/** A verdict that rules on exactly the blocks it is given, and nothing else. */
function verdict(
  rulings: Record<string, string>,
  over: Partial<BudgetVerdict> = {},
): BudgetVerdict {
  return {
    limit: { tokens: 6144, ceiling: 8192, source: 'user', share: 0.75 },
    reserved: 800,
    spent: 20,
    decisions: Object.entries(rulings).map(([blockId, rule]) => ({
      blockId,
      tokens: 10,
      included: true,
      rule,
    })),
    nextToDrop: [],
    ...over,
  };
}

function rowFor(id: string): HTMLElement | undefined {
  // By the block id *cell*, not by the row's text: the header row reads
  // "Ruling after", which contains every short id a test might use.
  return screen.getAllByRole('row').find((row) => row.querySelector('code')?.textContent === id);
}

function cellsOf(row: HTMLElement | undefined): string[] {
  return [...(row?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent);
}

describe('the aligned block table', () => {
  it('says a block one side never had is absent, not that it cost nothing', () => {
    // The absent-versus-empty doctrine, at the one place a blank cell would
    // be read as a count. The falsifying mutation is rendering `0` — or an
    // empty string — where `absent` goes: the table still looks right, and it
    // tells the reader the block was free rather than missing.
    render(
      <AlignedBlockTable
        before={{
          blocks: [block('a'), block('b')],
          budget: verdict({ a: 'included', b: 'included' }),
        }}
        after={{ blocks: [block('a')], budget: verdict({ a: 'included' }) }}
        locale={undefined}
      />,
    );

    // The After column exactly, rather than the row's text: the Before cell
    // legitimately reads "10", and a substring assertion could not tell that
    // from a zero rendered in the empty side.
    const cells = cellsOf(rowFor('b'));
    expect(cells[2]).toBe('10');
    expect(cells[3]).toBe('absent');
    expect(cells[6]).toBe('Only before');
  });

  it('calls a ruling that moved a moved ruling, and does not claim an edit', () => {
    // Same text, same tokens, same included — only the rule differs. The
    // mutation is `changeOf` returning `changed` here (or the table reading
    // one side's rules for both), which would have the view assert that
    // somebody rewrote a block nobody touched.
    render(
      <AlignedBlockTable
        before={{ blocks: [block('a')], budget: verdict({ a: 'included — priority 90' }) }}
        after={{ blocks: [block('a')], budget: verdict({ a: 'included — priority 70' }) }}
        locale={undefined}
      />,
    );

    const row = rowFor('a');
    expect(row?.textContent).toContain('Ruling moved');
    expect(row?.textContent).toContain('included — priority 90');
    expect(row?.textContent).toContain('included — priority 70');
  });

  it('reports a rewritten block as changed', () => {
    render(
      <AlignedBlockTable
        before={{ blocks: [block('a')], budget: verdict({ a: 'included' }) }}
        after={{
          blocks: [block('a', { text: 'rewritten', tokens: 3 })],
          budget: verdict({ a: 'included' }),
        }}
        locale={undefined}
      />,
    );

    expect(rowFor('a')?.textContent).toContain('Changed');
  });

  it('fades the rows that are the same, so the differences are what the eye lands on', () => {
    render(
      <AlignedBlockTable
        before={{
          blocks: [block('a'), block('b')],
          budget: verdict({ a: 'included', b: 'included' }),
        }}
        after={{
          blocks: [block('a'), block('b', { text: 'moved on' })],
          budget: verdict({ a: 'included', b: 'included' }),
        }}
        locale={undefined}
      />,
    );

    expect(rowFor('a')?.className).toContain('text-ink-faint');
    expect(rowFor('b')?.className).not.toContain('text-ink-faint');
  });

  it('explains a history block’s moved ruling as the window sliding', () => {
    // The caveat exists because the drift is real and reads as somebody's
    // doing. The mutation is dropping the `source.kind === 'history'` half of
    // the guard, after which the next test — a preset block whose ruling
    // moved, which really is somebody's doing — starts reporting drift too.
    render(
      <AlignedBlockTable
        before={{ blocks: [historyBlock('h')], budget: verdict({ h: 'included — priority 20' }) }}
        after={{ blocks: [historyBlock('h')], budget: verdict({ h: 'included — priority 21' }) }}
        locale={undefined}
      />,
    );

    expect(screen.getByText(/once a session is longer than the window/)).toBeTruthy();
  });

  it('does not explain away a preset block whose ruling moved', () => {
    render(
      <AlignedBlockTable
        before={{ blocks: [block('a')], budget: verdict({ a: 'included — priority 90' }) }}
        after={{ blocks: [block('a')], budget: verdict({ a: 'included — priority 40' }) }}
        locale={undefined}
      />,
    );

    expect(rowFor('a')?.textContent).toContain('Ruling moved');
    expect(screen.queryByText(/once a session is longer than the window/)).toBeNull();
  });

  it('falls back to the block’s own droppedBy when the verdict ruled on nothing', () => {
    // A record whose verdict lost its decisions still knows why each block
    // was dropped, because the block carries it. The mutation is dropping the
    // `?? droppedBy` fallback, which turns the ruling column into a column of
    // dashes on exactly the turns somebody is comparing to find a drop.
    render(
      <AlignedBlockTable
        before={{
          blocks: [block('a', { included: false, droppedBy: 'over budget — priority 20' })],
          budget: verdict({}),
        }}
        after={{ blocks: [block('a')], budget: verdict({}) }}
        locale={undefined}
      />,
    );

    expect(rowFor('a')?.textContent).toContain('over budget — priority 20');
  });
});
