// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, type Lorebook, type LoreEntry } from '@storyengine/shared';

import { feedsRecursion, mayRecurse, recursionVerdict } from './recursion.js';

/**
 * The three recursion flags and the two book limits — [P5.5], *unit tests on
 * the interactions, which are the part people actually get wrong.*
 *
 * The flags read as three similar switches and are three different kinds of
 * rule: one outbound (`preventRecursion` — my text triggers nothing), and two
 * inbound and **opposite** (`excludeRecursion` — not at depth; and
 * `delayUntilRecursion` — only at depth). The opposite pair is where the
 * interesting cases are, and the first `describe` is about the state an author
 * can reach by setting both.
 */

function entry(over: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry('Harbour'), ...over };
}

/** Recursion off is the *default* — `newLorebook` sets `recursiveScanning: false`. */
function book(over: Partial<Lorebook> = {}): Lorebook {
  return { ...newLorebook('Ardent'), recursiveScanning: true, ...over };
}

describe('the two inbound flags, which are opposites', () => {
  it('takes an ordinary entry at every depth the book allows', () => {
    const plain = entry();

    expect(recursionVerdict(book(), plain, 0)).toBe('consider');
    expect(recursionVerdict(book(), plain, 1)).toBe('consider');
    expect(recursionVerdict(book(), plain, 3)).toBe('consider');
  });

  it('keeps excludeRecursion out of every pass but the first', () => {
    const shy = entry({ excludeRecursion: true });

    expect(recursionVerdict(book(), shy, 0)).toBe('consider');
    expect(recursionVerdict(book(), shy, 1)).toBe('excluded-from-recursion');
  });

  it('keeps delayUntilRecursion out of the first pass only', () => {
    const late = entry({ delayUntilRecursion: true });

    expect(recursionVerdict(book(), late, 0)).toBe('awaiting-recursion');
    expect(recursionVerdict(book(), late, 1)).toBe('consider');
  });

  /**
   * **An entry with both can never fire**, and that is the interaction worth
   * having its own verdict. It is not a state to repair — repairing it would
   * mean choosing which of the author's two instructions to ignore — but it is
   * a state somebody has to be able to be *told about*, because from inside
   * either pass it looks like an ordinary refusal that a different depth would
   * have satisfied.
   */
  it('says so plainly when an entry has set both', () => {
    const impossible = entry({ excludeRecursion: true, delayUntilRecursion: true });

    expect(recursionVerdict(book(), impossible, 0)).toBe('never-fires');
    expect(recursionVerdict(book(), impossible, 1)).toBe('never-fires');
    expect(recursionVerdict(book(), impossible, 9)).toBe('never-fires');
  });

  /**
   * Checked before the depth so the answer does not depend on where it was
   * asked — *awaiting recursion* at depth zero would send an author looking for
   * the recursion that never comes, and *depth exhausted* at depth nine would
   * suggest a bigger limit would help.
   */
  it('says never-fires even where another rule would also have refused', () => {
    const impossible = entry({ excludeRecursion: true, delayUntilRecursion: true });

    expect(recursionVerdict(book({ recursiveScanning: false }), impossible, 1)).toBe('never-fires');
    expect(recursionVerdict(book({ maxRecursionDepth: 1 }), impossible, 5)).toBe('never-fires');
  });
});

describe('the book’s own two limits', () => {
  /**
   * `recursiveScanning` defaults to **false**, so this is the arm most books
   * are actually in — and reporting it as the book's refusal rather than the
   * entry's matters, because that is the setting somebody would have to change.
   */
  it('reports the book’s switch rather than the entry’s flags', () => {
    const off = book({ recursiveScanning: false });

    expect(recursionVerdict(off, entry(), 0)).toBe('consider');
    expect(recursionVerdict(off, entry(), 1)).toBe('recursion-off');
    expect(recursionVerdict(off, entry({ excludeRecursion: true }), 1)).toBe('recursion-off');
  });

  it('stops at the depth the book allows', () => {
    const shallow = book({ maxRecursionDepth: 2 });

    expect(recursionVerdict(shallow, entry(), 2)).toBe('consider');
    expect(recursionVerdict(shallow, entry(), 3)).toBe('depth-exhausted');
  });

  it('lets a book turn recursion off by allowing no depth at all', () => {
    expect(recursionVerdict(book({ maxRecursionDepth: 0 }), entry(), 1)).toBe('depth-exhausted');
  });
});

describe('whether another pass runs at all', () => {
  it('runs while the book allows the depth', () => {
    const three = book({ maxRecursionDepth: 3 });

    expect(mayRecurse(three, 1)).toBe(true);
    expect(mayRecurse(three, 3)).toBe(true);
    expect(mayRecurse(three, 4)).toBe(false);
  });

  it('never runs for a book with recursion off', () => {
    expect(mayRecurse(book({ recursiveScanning: false }), 1)).toBe(false);
  });

  /**
   * Depth zero is the scan over the conversation and is not a recursive pass,
   * so it is not something this function ever authorises — the loop is already
   * in it by the time this is asked.
   */
  it('does not authorise the first pass, which is not recursion', () => {
    expect(mayRecurse(book(), 0)).toBe(false);
  });
});

describe('the outbound flag', () => {
  it('lets an ordinary entry’s text feed the next pass', () => {
    expect(feedsRecursion(entry())).toBe(true);
  });

  it('stops preventRecursion from triggering anything further', () => {
    expect(feedsRecursion(entry({ preventRecursion: true }))).toBe(false);
  });

  /**
   * **Outbound and inbound are independent**, which is the pairing that reads
   * as a contradiction and is not: an entry can be perfectly findable by a
   * recursive pass and still contribute nothing to the next one. That is what
   * `preventRecursion` on an otherwise ordinary entry means, and a matcher that
   * conflated the two would silently drop one of the author's two settings.
   */
  it('is independent of whether the entry may be found', () => {
    const quiet = entry({ preventRecursion: true });

    expect(recursionVerdict(book(), quiet, 1)).toBe('consider');
    expect(feedsRecursion(quiet)).toBe(false);

    const loud = entry({ excludeRecursion: true });

    expect(recursionVerdict(book(), loud, 1)).toBe('excluded-from-recursion');
    expect(feedsRecursion(loud)).toBe(true);
  });
});
