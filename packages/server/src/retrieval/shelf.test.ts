// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, type Lorebook, type LoreEntry } from '@storyengine/shared';

import { estimateTokens } from '../assembly/assemble.js';
import type { Activation } from './activate.js';
import { inTrimOrder, shelve, trimRank } from './shelf.js';

/**
 * The per-book budget and its trim order — [P5.6], [03 §3.2].
 *
 * The order is copied out of a design note word for word, so these tests are
 * mostly *the note said this*: constants first, then latest-message matches,
 * then injection order, and the scan continues past a skip.
 */

function bookOf(edits: Partial<Lorebook> = {}): Lorebook {
  return { ...newLorebook('Rain City'), tokenBudget: 2048, entryLimit: 100, ...edits };
}

/** Text of a known size, so a budget can be stated in entries rather than guessed. */
function words(count: number): string {
  return Array.from({ length: count }, (_, at) => `word${String(at)}`).join(' ');
}

function firing(
  name: string,
  edits: Partial<LoreEntry> = {},
  at: { book?: Lorebook; hit?: string } = {},
): Activation {
  const book = at.book ?? bookOf();
  return {
    bookId: book.id,
    book,
    entry: { ...newLoreEntry(name), content: words(10), ...edits },
    by: 'keyword',
    hit: at.hit === undefined ? null : { key: at.hit, source: 'message' },
    depth: 0,
  };
}

function keptNames(result: ReturnType<typeof shelve>): string[] {
  return result.kept.map((one) => one.activation.entry.name);
}

describe('trimRank', () => {
  it('puts a constant entry first', () => {
    expect(trimRank(firing('Always', { constant: true }), '')).toBe(0);
  });

  it('puts an entry that matched the latest message second', () => {
    expect(trimRank(firing('Named', {}, { hit: 'ferryman' }), 'the ferryman')).toBe(1);
  });

  it('puts everything else last', () => {
    expect(trimRank(firing('Ordinary', {}, { hit: 'ferryman' }), 'a quiet evening')).toBe(2);
  });

  /**
   * A key found three messages ago is not a key in the latest message. The scan
   * searches a `scanDepth` of messages and cannot say which one hit, so the
   * promotion is re-checked here against the one message it is about.
   */
  it('does not promote an entry that matched an older message', () => {
    expect(trimRank(firing('Older', {}, { hit: 'ferryman' }), 'we talked about the weather')).toBe(
      2,
    );
  });

  it('promotes without regard to case', () => {
    expect(trimRank(firing('Named', {}, { hit: 'Ferryman' }), 'THE FERRYMAN')).toBe(1);
  });

  /**
   * Stickiness is *already in the prompt and staying*, and a recursive hit
   * matched another entry's text rather than the player's words. Neither is a
   * claim about the latest message, so neither is promoted by it.
   */
  it('does not promote a sticky activation, which never matched anything', () => {
    const sticky: Activation = { ...firing('Held'), by: 'sticky', hit: null };

    expect(trimRank(sticky, 'anything at all')).toBe(2);
  });

  it('does not promote a hit that came from an additional source', () => {
    const fromSource: Activation = {
      ...firing('Carded'),
      hit: { key: 'ferryman', source: 'persona' },
    };

    expect(trimRank(fromSource, 'the ferryman')).toBe(2);
  });
});

describe('inTrimOrder', () => {
  it('walks constants, then latest-message matches, then the rest', () => {
    const order = inTrimOrder(
      [
        firing('Ordinary', { order: 1 }),
        firing('Constant', { order: 2, constant: true }),
        firing('Recent', { order: 3 }, { hit: 'ferryman' }),
      ],
      'the ferryman',
    );

    expect(order.map((one) => one.entry.name)).toEqual(['Constant', 'Recent', 'Ordinary']);
  });

  it("breaks a rank tie on the author's own order", () => {
    const order = inTrimOrder(
      [firing('Later', { order: 20 }), firing('Earlier', { order: 10 })],
      '',
    );

    expect(order.map((one) => one.entry.name)).toEqual(['Earlier', 'Later']);
  });

  /**
   * Total, not partial. An unstable tie-break means a prompt that differs
   * between two runs over identical inputs, and a diff nobody can explain.
   */
  it('breaks a remaining tie on the id', () => {
    const first = firing('A', { order: 1, id: 'aaa' });
    const second = firing('B', { order: 1, id: 'bbb' });

    expect(inTrimOrder([second, first], '').map((one) => one.entry.id)).toEqual(['aaa', 'bbb']);
  });

  it('does not touch the array it was given', () => {
    const activated = [firing('B', { order: 2 }), firing('A', { order: 1 })];
    inTrimOrder(activated, '');

    expect(activated.map((one) => one.entry.name)).toEqual(['B', 'A']);
  });
});

describe('shelve', () => {
  it('keeps everything that fits', () => {
    const result = shelve({ activated: [firing('One'), firing('Two')], latestMessage: '' });

    expect(keptNames(result)).toEqual(['One', 'Two']);
    expect(result.refused).toEqual([]);
  });

  it("refuses the entries past a book's token budget and names the rule", () => {
    const book = bookOf({ tokenBudget: estimateTokens(words(10)) * 2 });
    const result = shelve({
      activated: [
        firing('One', { order: 1 }, { book }),
        firing('Two', { order: 2 }, { book }),
        firing('Three', { order: 3 }, { book }),
      ],
      latestMessage: '',
    });

    expect(keptNames(result)).toEqual(['One', 'Two']);
    expect(result.refused.map((one) => one.refusedBy)).toEqual(['token-budget']);
  });

  it("refuses the entries past a book's entry limit and names the rule", () => {
    const book = bookOf({ entryLimit: 1 });
    const result = shelve({
      activated: [firing('One', { order: 1 }, { book }), firing('Two', { order: 2 }, { book })],
      latestMessage: '',
    });

    expect(keptNames(result)).toEqual(['One']);
    expect(result.refused[0]?.refusedBy).toBe('entry-limit');
  });

  /**
   * The clause people get wrong. A first-fit that stopped at the first entry
   * too large would make one long entry silently delete every shorter entry
   * behind it, and the symptom — *most of my lorebook stopped working* — points
   * nowhere near the cause.
   */
  it('keeps looking after refusing an entry, so a small one still fits', () => {
    const book = bookOf({ tokenBudget: estimateTokens(words(20)) });
    const result = shelve({
      activated: [
        firing('Big', { order: 1, content: words(200) }, { book }),
        firing('Small', { order: 2, content: words(10) }, { book }),
      ],
      latestMessage: '',
    });

    expect(keptNames(result)).toEqual(['Small']);
    expect(result.refused.map((one) => one.activation.entry.name)).toEqual(['Big']);
  });

  it('spends the budget in trim order, so a constant survives a crowd', () => {
    const book = bookOf({ tokenBudget: estimateTokens(words(10)) });
    const result = shelve({
      activated: [
        firing('Ordinary', { order: 1 }, { book }),
        firing('Always', { order: 9, constant: true }, { book }),
      ],
      latestMessage: '',
    });

    expect(keptNames(result)).toEqual(['Always']);
  });

  it('lets an entry the player just named beat one they did not', () => {
    const book = bookOf({ tokenBudget: estimateTokens(words(10)) });
    const result = shelve({
      activated: [
        firing('Stale', { order: 1 }, { book, hit: 'weather' }),
        firing('Named', { order: 9 }, { book, hit: 'ferryman' }),
      ],
      latestMessage: 'ask the ferryman',
    });

    expect(keptNames(result)).toEqual(['Named']);
  });

  /**
   * The two tiers are separate budgets over separate books. One book filling up
   * must not spend another's allowance, or a person who added a second lorebook
   * would find the first one shrinking for no reason they could see.
   */
  it('gives each book its own budget', () => {
    const full = bookOf({ id: 'full', tokenBudget: 1 });
    const roomy = bookOf({ id: 'roomy', tokenBudget: 2048 });
    const result = shelve({
      activated: [firing('Refused', {}, { book: full }), firing('Kept', {}, { book: roomy })],
      latestMessage: '',
    });

    expect(keptNames(result)).toEqual(['Kept']);
    expect(result.refused.map((one) => one.activation.entry.name)).toEqual(['Refused']);
  });

  /** Over both limits: the count is the one an author can check without a tokeniser. */
  it('reports an entry over both limits against the entry limit', () => {
    const book = bookOf({ entryLimit: 1, tokenBudget: estimateTokens(words(10)) });
    const result = shelve({
      activated: [firing('One', { order: 1 }, { book }), firing('Two', { order: 2 }, { book })],
      latestMessage: '',
    });

    expect(result.refused[0]?.refusedBy).toBe('entry-limit');
  });

  describe('what it reports per book', () => {
    /**
     * Reported even when nothing was refused, because *this book used 90 of its
     * 2048 tokens* is the answer to **why the budget is not my problem**, and a
     * report that only appears on failure cannot give it.
     */
    it('accounts for a book that refused nothing', () => {
      const book = bookOf({ id: 'rain', tokenBudget: 2048, entryLimit: 100 });
      const result = shelve({ activated: [firing('One', {}, { book })], latestMessage: '' });

      expect(result.books).toEqual([
        {
          bookId: 'rain',
          tokenBudget: 2048,
          tokensSpent: estimateTokens(words(10)),
          entryLimit: 100,
          entriesKept: 1,
        },
      ]);
    });

    it('counts only what it kept, not what it considered', () => {
      const book = bookOf({ id: 'rain', entryLimit: 1 });
      const result = shelve({
        activated: [firing('One', { order: 1 }, { book }), firing('Two', { order: 2 }, { book })],
        latestMessage: '',
      });

      expect(result.books[0]?.entriesKept).toBe(1);
    });

    it('lists a book once however many entries it contributed', () => {
      const book = bookOf({ id: 'rain' });
      const result = shelve({
        activated: [firing('One', {}, { book }), firing('Two', {}, { book })],
        latestMessage: '',
      });

      expect(result.books).toHaveLength(1);
    });

    /**
     * The mirror of the case above, and the one the first draft of this suite
     * missed entirely: a book that kept **nothing**. Omitting it would make the
     * report silent about precisely the book somebody is asking about — *my
     * lorebook contributed nothing* is answered by a row reading 0 of 0, and
     * not at all by the absence of a row.
     */
    it('accounts for a book whose every entry was refused', () => {
      // A budget of one token rather than zero: zero is the format's
      // *unlimited* ([04 §5]), and using it here was how the inverted reading
      // came to be pinned by a test — [P5 §0.5]'s first contradiction, settled
      // at [P6B.1]. One token refuses everything just as thoroughly and says
      // what it means.
      const book = bookOf({ id: 'starved', tokenBudget: 1 });
      const result = shelve({ activated: [firing('One', {}, { book })], latestMessage: '' });

      expect(result.kept).toEqual([]);
      expect(result.books).toEqual([
        {
          bookId: 'starved',
          tokenBudget: 1,
          tokensSpent: 0,
          entryLimit: 100,
          entriesKept: 0,
        },
      ]);
    });

    /**
     * **Zero is unlimited** — [04 §5] and the schema both say so, and
     * `shelf.ts` read it as a ceiling of nothing until [P6B.1], so a book
     * carrying the convention refused every entry and blamed a budget.
     *
     * The books that carry it were written elsewhere — the importer leaves the
     * field unclamped where it clamps `entryLimit` — so this is the reading an
     * imported book depends on.
     */
    it('reads a token budget of zero as unlimited, the way the format means it', () => {
      const book = bookOf({ id: 'open', tokenBudget: 0 });
      const result = shelve({
        activated: [firing('One', {}, { book }), firing('Two', {}, { book })],
        latestMessage: '',
      });

      expect(result.kept).toHaveLength(2);
      expect(result.refused).toEqual([]);
      expect(result.books[0]?.tokensSpent).toBeGreaterThan(0);
    });

    it('reports nothing at all when nothing activated', () => {
      expect(shelve({ activated: [], latestMessage: '' })).toEqual({
        kept: [],
        refused: [],
        books: [],
      });
    });
  });
});
