// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, type LoreEntry } from '@storyengine/shared';

import type { Activation } from './activate.js';
import { loreBlocks, placementOf, priorityFor, reasonFor, refusalsFor } from './blocks.js';
import type { Shelved } from './shelf.js';

/**
 * Activated entries as prompt blocks — [P5.6].
 *
 * Placement is the half worth the most tests, because it is the one thing about
 * lore that does not work like every other slot: the *entry* decides where it
 * goes, so one preset slot emits blocks that belong in four different places.
 */

function entryOf(name: string, edits: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry(name), ...edits };
}

function firing(entry: LoreEntry, edits: Partial<Activation> = {}): Activation {
  return {
    bookId: 'book-1',
    book: newLorebook('Rain City'),
    entry,
    by: 'keyword',
    hit: { key: 'ferryman', source: 'message' },
    depth: 0,
    ...edits,
  };
}

function shelved(activation: Activation): Shelved {
  return { activation, tokens: 10 };
}

describe('placementOf', () => {
  it('puts before_char in the before phase', () => {
    expect(placementOf(entryOf('One', { position: 'before_char' }))).toEqual({ at: 'before' });
  });

  it('puts after_char in the after phase', () => {
    expect(placementOf(entryOf('One', { position: 'after_char' }))).toEqual({ at: 'after' });
  });

  it('turns at_depth into a history injection at that depth', () => {
    expect(placementOf(entryOf('One', { position: 'at_depth', depth: 4 }))).toEqual({
      at: 'in-history',
      fromEnd: 4,
    });
  });

  /**
   * `depth` is a plain number in the schema, so a negative one is reachable by
   * hand edit or by an importer's arithmetic. Spliced from the wrong end of the
   * history it would put a block before the conversation began.
   */
  it('clamps a negative depth rather than splicing from the wrong end', () => {
    expect(placementOf(entryOf('One', { position: 'at_depth', depth: -3 }))).toEqual({
      at: 'in-history',
      fromEnd: 0,
    });
  });

  it('takes the outlet an entry names', () => {
    expect(placementOf(entryOf('One', { position: 'outlet', outletName: 'rules' }))).toEqual({
      at: 'outlet',
      name: 'rules',
    });
  });

  /**
   * An outlet with no name would otherwise become an outlet called `''`, which
   * a preset slot that also left the field empty would match — two mistakes
   * finding each other. Landing in the ordinary before-run is visible and
   * harmless, which is what a half-configured field should cost.
   */
  it('degrades an unnamed outlet to the before phase', () => {
    expect(placementOf(entryOf('One', { position: 'outlet', outletName: null }))).toEqual({
      at: 'before',
    });
    expect(placementOf(entryOf('Two', { position: 'outlet', outletName: '' }))).toEqual({
      at: 'before',
    });
  });
});

describe('reasonFor', () => {
  it('names the key that fired a keyword match', () => {
    expect(reasonFor(firing(entryOf('One')))).toContain('ferryman');
  });

  it('says a constant is always on', () => {
    expect(reasonFor(firing(entryOf('One'), { by: 'constant', hit: null }))).toBe('always on');
  });

  it('says a sticky entry is held over from an earlier turn', () => {
    expect(reasonFor(firing(entryOf('One'), { by: 'sticky', hit: null }))).toContain('earlier');
  });

  /**
   * The distinction a reader most wants: *the player said this* against *another
   * entry said this*. Both are keyword hits, and collapsing them would leave
   * somebody looking through the conversation for a word that was never in it.
   */
  it('distinguishes a recursive hit from one the player made', () => {
    const recursive = reasonFor(firing(entryOf('One'), { by: 'recursive' }));
    const keyword = reasonFor(firing(entryOf('One')));

    expect(recursive).not.toBe(keyword);
    expect(recursive).toContain('another entry');
    expect(recursive).toContain('ferryman');
  });
});

describe('priorityFor', () => {
  it('gives a constant a higher priority than an ordinary match', () => {
    const constant = firing(entryOf('Always', { constant: true }));
    const ordinary = firing(entryOf('Ordinary'));

    expect(priorityFor(constant, '', 25)).toBeGreaterThan(priorityFor(ordinary, '', 25) ?? 0);
  });

  it('gives an entry the player just named a higher priority than one they did not', () => {
    const named = firing(entryOf('Named'));
    const stale = firing(entryOf('Stale'), { hit: { key: 'weather', source: 'message' } });

    expect(priorityFor(named, 'the ferryman', 25)).toBeGreaterThan(
      priorityFor(stale, 'the ferryman', 25) ?? 0,
    );
  });

  /**
   * Absent means *the preset did not say*, which the budgeter reads as the
   * middle. Inventing a number here would rank lore against blocks the preset
   * deliberately left unranked.
   */
  it('gives no priority when the preset gave none', () => {
    expect(priorityFor(firing(entryOf('One')), '', undefined)).toBeUndefined();
  });
});

describe('loreBlocks', () => {
  it('carries the entry text, role and reason onto the candidate', () => {
    const entry = entryOf('The Ferryman', {
      content: 'He works the crossing.',
      role: 'assistant',
    });
    const { blocks } = loreBlocks({
      kept: [shelved(firing(entry))],
      latestMessage: 'the ferryman',
      outlets: new Set(),
      basePriority: 25,
    });

    expect(blocks[0]?.candidate.text).toBe('He works the crossing.');
    expect(blocks[0]?.candidate.role).toBe('assistant');
    expect(blocks[0]?.candidate.reason).toContain('ferryman');
    expect(blocks[0]?.candidate.source).toEqual({
      kind: 'lore',
      entryId: entry.id,
      phase: 'before',
    });
  });

  it('records an after_char entry under the after phase', () => {
    const entry = entryOf('One', { position: 'after_char' });
    const { blocks } = loreBlocks({
      kept: [shelved(firing(entry))],
      latestMessage: '',
      outlets: new Set(),
      basePriority: 25,
    });

    expect(blocks[0]?.candidate.source).toMatchObject({ phase: 'after' });
  });

  /**
   * Two books can hold entries with the same id — importing the same source
   * twice is the ordinary way to get there — and a duplicate block id would
   * make the two indistinguishable in the record they exist to explain.
   */
  it('namespaces the block id by book as well as entry', () => {
    const entry = entryOf('Shared');
    const { blocks } = loreBlocks({
      kept: [shelved(firing(entry, { bookId: 'one' })), shelved(firing(entry, { bookId: 'two' }))],
      latestMessage: '',
      outlets: new Set(),
      basePriority: 25,
    });

    expect(new Set(blocks.map((one) => one.candidate.id)).size).toBe(2);
  });

  describe('outlets', () => {
    it('emits an entry whose outlet the preset positions', () => {
      const entry = entryOf('Rules', { position: 'outlet', outletName: 'rules' });
      const { blocks, unplaced } = loreBlocks({
        kept: [shelved(firing(entry))],
        latestMessage: '',
        outlets: new Set(['rules']),
        basePriority: 25,
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.placement).toEqual({ at: 'outlet', name: 'rules' });
      expect(unplaced).toEqual([]);
    });

    /**
     * The failure mode outlets add: an entry that fires perfectly, passes every
     * budget, and then does not appear, because two objects written by two
     * different people disagree about a string. Without a report the only
     * symptom is absence.
     */
    it('reports an entry whose outlet nobody positions', () => {
      const entry = entryOf('Rules', { position: 'outlet', outletName: 'rules' });
      const { blocks, unplaced } = loreBlocks({
        kept: [shelved(firing(entry))],
        latestMessage: '',
        outlets: new Set(['somewhere-else']),
        basePriority: 25,
      });

      expect(blocks).toEqual([]);
      expect(unplaced.map((one) => one.outletName)).toEqual(['rules']);
    });

    /** Exact and case-sensitive, as `outletName` says. */
    it('does not forgive a near miss in an outlet name', () => {
      const entry = entryOf('Rules', { position: 'outlet', outletName: 'Rules' });
      const { unplaced } = loreBlocks({
        kept: [shelved(firing(entry))],
        latestMessage: '',
        outlets: new Set(['rules']),
        basePriority: 25,
      });

      expect(unplaced).toHaveLength(1);
    });
  });
});

/**
 * The inner budget's refusals in the arbiter's vocabulary — [P5 §1.3]'s *every
 * skip lands in the `BudgetVerdict` with the rule that made it*.
 *
 * These are product strings: they name the **setting to change**, because *over
 * budget* is a shrug and *over the book's token budget of 2048* is a field
 * somebody can go and find.
 */
describe('refusalsFor', () => {
  const refusedBy = (rule: 'token-budget' | 'entry-limit'): Shelved => ({
    activation: firing(entryOf('Refused')),
    tokens: 40,
    refusedBy: rule,
  });

  it("names the book's token budget, with its number", () => {
    const shelvedOne = refusedBy('token-budget');
    shelvedOne.activation.book = { ...shelvedOne.activation.book, tokenBudget: 2048 };

    const [row] = refusalsFor([shelvedOne], []);

    expect(row?.rule).toContain('token budget');
    expect(row?.rule).toContain('2048');
    expect(row?.tokens).toBe(40);
  });

  it("names the book's entry limit, with its number", () => {
    const shelvedOne = refusedBy('entry-limit');
    shelvedOne.activation.book = { ...shelvedOne.activation.book, entryLimit: 7 };

    expect(refusalsFor([shelvedOne], [])[0]?.rule).toContain('7');
  });

  it('tells the two rules apart', () => {
    const budget = refusedBy('token-budget');
    const limit = refusedBy('entry-limit');

    expect(refusalsFor([budget], [])[0]?.rule).not.toBe(refusalsFor([limit], [])[0]?.rule);
  });

  /**
   * An unpositioned outlet is not a budget decision, so it carries no size:
   * nothing measured it, because nothing was ever going to send it. Reporting
   * an estimate would read as *this cost you tokens*, which is the opposite of
   * what happened.
   */
  it('reports an unpositioned outlet as costing nothing', () => {
    const [row] = refusalsFor([], [{ activation: firing(entryOf('Rules')), outletName: 'rules' }]);

    expect(row?.tokens).toBe(0);
    expect(row?.rule).toContain('rules');
    expect(row?.rule).toContain('outlet');
  });

  /**
   * The ids match the ones {@link loreBlocks} mints, or the verdict names
   * blocks nothing else in the record has heard of.
   */
  it('uses the same block ids the included blocks carry', () => {
    const entry = entryOf('One');
    const { blocks } = loreBlocks({
      kept: [shelved(firing(entry))],
      latestMessage: '',
      outlets: new Set(),
      basePriority: 25,
    });
    const [row] = refusalsFor(
      [{ activation: firing(entry), tokens: 1, refusedBy: 'token-budget' }],
      [],
    );

    expect(row?.blockId).toBe(blocks[0]?.candidate.id);
  });
});
