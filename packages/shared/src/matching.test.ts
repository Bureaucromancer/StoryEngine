// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLoreEntry } from './factories.js';
import type { LoreEntry } from './schema/lorebook.js';
import { containsTerm, entrySpans, literalSpans, mergeSpans } from './matching.js';

/**
 * The pure half of key matching, shared at [P5.8] so the retriever and the book
 * page's highlighting cannot answer differently.
 *
 * `match.test.ts` on the server already covers what `containsTerm` decides;
 * what is new here is **positions**, which a boolean could not express and
 * which the highlight is entirely made of.
 */

function entryOf(over: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry('One'), ...over };
}

const LOOSE = { wholeWords: false, caseSensitive: false };
const WHOLE = { wholeWords: true, caseSensitive: false };

describe('literalSpans', () => {
  it('finds each occurrence', () => {
    expect(literalSpans('the docks, past the docks', 'docks', LOOSE)).toEqual([
      { start: 4, end: 9 },
      { start: 20, end: 25 },
    ]);
  });

  it('slices the original text, not a folded copy', () => {
    const text = 'The DOCKS at dawn.';
    const [span] = literalSpans(text, 'docks', LOOSE);

    expect(text.slice(span?.start, span?.end)).toBe('DOCKS');
  });

  it('respects case when the entry asks it to', () => {
    expect(literalSpans('The DOCKS', 'docks', { wholeWords: false, caseSensitive: true })).toEqual(
      [],
    );
  });

  /**
   * The rule the whole boundary argument exists for: `docks` must not match
   * inside `dockside`, in any script, without escaping user text into a pattern.
   */
  it('does not match inside a longer word when whole words are asked for', () => {
    expect(literalSpans('the dockside road', 'docks', WHOLE)).toEqual([]);
    expect(literalSpans('the docks road', 'docks', WHOLE)).toHaveLength(1);
  });

  /**
   * `\b` is ASCII-only in a non-Unicode pattern, which is the second half of
   * why this is written out. A key in another script has to behave the same.
   */
  it('applies word boundaries outside ASCII', () => {
    expect(literalSpans('на пристани', 'пристан', WHOLE)).toEqual([]);
    expect(literalSpans('на пристань!', 'пристань', WHOLE)).toHaveLength(1);
  });

  /**
   * ***A combining mark is part of its word*** (2026-09-30) — UAX #29's WB4,
   * and the rule `turns/speakers.ts` reads names by. A Devanagari vowel sign
   * is a mark, not a letter, so *राम* (Ram) matched inside *रामायण* (the
   * Ramayana) — after it on one side, and *मायण* inside it on the other.
   */
  it('counts a combining mark as part of the word on either side', () => {
    expect(literalSpans('रामायण पढ़ो', 'राम', WHOLE)).toEqual([]);
    expect(literalSpans('रामायण', 'मायण', WHOLE)).toEqual([]);
    expect(literalSpans('राम ने कहा', 'राम', WHOLE)).toEqual([{ start: 0, end: 3 }]);
    // Latin written decomposed has the same seam: an acute on the next letter.
    expect(literalSpans('cafe\u0301s', 'caf', WHOLE)).toEqual([]);
  });

  /**
   * ***A letter outside the Basic Multilingual Plane is one character***
   * (2026-09-30): two UTF-16 units, either of which alone is no letter, so a
   * match beside one read as bounded.
   */
  it('reads the whole character on each side, astral letters included', () => {
    expect(literalSpans('\u{20000}abc', 'abc', WHOLE)).toEqual([]);
    expect(literalSpans('abc\u{20000}', 'abc', WHOLE)).toEqual([]);
    expect(literalSpans('\u{20000} abc', 'abc', WHOLE)).toEqual([{ start: 3, end: 6 }]);
  });

  /**
   * A rejected candidate must not stop the search: the *next* occurrence may
   * well be at a boundary, and a scan that gave up would report the whole text
   * as a miss because of its first false start.
   */
  it('keeps looking past a candidate the boundary rejected', () => {
    expect(literalSpans('dockside, then docks', 'docks', WHOLE)).toEqual([{ start: 15, end: 20 }]);
  });

  it('does not return overlapping spans', () => {
    expect(literalSpans('aaa', 'aa', LOOSE)).toEqual([{ start: 0, end: 2 }]);
  });

  it('finds nothing in an empty text or for an empty term', () => {
    expect(literalSpans('', 'docks', LOOSE)).toEqual([]);
    expect(literalSpans('the docks', '', LOOSE)).toEqual([]);
  });
});

describe('containsTerm', () => {
  it('is the boolean the retriever asks for', () => {
    expect(containsTerm('the docks', 'docks', true)).toBe(true);
    expect(containsTerm('the dockside', 'docks', true)).toBe(false);
    expect(containsTerm('the dockside', 'docks', false)).toBe(true);
  });

  /** Case folding is the caller's, which is what the retriever has always done. */
  it('is case sensitive, leaving the folding to its caller', () => {
    expect(containsTerm('The DOCKS', 'docks', false)).toBe(false);
  });
});

describe('entrySpans', () => {
  it('finds an entry’s keys under its own flags', () => {
    const entry = entryOf({ keys: ['docks'], matchWholeWords: true, caseSensitive: false });

    expect(entrySpans(entry, 'Down at the Docks.')).toEqual([{ start: 12, end: 17 }]);
    expect(entrySpans(entry, 'Down at the dockside.')).toEqual([]);
  });

  /**
   * A secondary key is still a thing the scanner looks for, so a highlight
   * showing only the primaries would be a partial answer in a complete one's
   * clothes.
   */
  it('reads the secondary keys as well as the primaries', () => {
    const entry = entryOf({ keys: ['docks'], secondaryKeys: ['wharf'] });

    expect(entrySpans(entry, 'the wharf')).toHaveLength(1);
  });

  /**
   * **A pattern is never run here.** [P5.4] bounds one inside `node:vm`; a
   * browser cannot interrupt `RegExp.test`, so a catastrophic pattern would
   * hang the tab. Declining is the principled answer, and the surface reports
   * the count rather than letting an empty highlight read as *nothing links*.
   */
  it('evaluates no pattern at all', () => {
    /**
     * **The key is one that would also match as a literal**, which the first
     * version of this test got wrong: `do.ks` is absent from the text either
     * way, so deleting the guard changed nothing and the mutation survived. A
     * key that is a valid pattern *and* present verbatim is the only fixture
     * that can tell *declined to run it* from *ran it and missed*.
     */
    const entry = entryOf({ keys: ['docks'], useRegex: true });

    expect(entrySpans(entry, 'the docks')).toEqual([]);
  });
});

describe('mergeSpans', () => {
  /**
   * Two keys hitting the same words — `harbour` and `the harbour` — are one
   * highlight. Nested marks render as a darker patch that reads as a third kind
   * of match.
   */
  it('joins overlapping spans into one', () => {
    expect(
      mergeSpans([
        { start: 0, end: 11 },
        { start: 4, end: 11 },
      ]),
    ).toEqual([{ start: 0, end: 11 }]);
  });

  it('joins spans that merely touch', () => {
    expect(
      mergeSpans([
        { start: 0, end: 4 },
        { start: 4, end: 9 },
      ]),
    ).toEqual([{ start: 0, end: 9 }]);
  });

  it('keeps separate spans separate, in order', () => {
    expect(
      mergeSpans([
        { start: 20, end: 25 },
        { start: 4, end: 9 },
      ]),
    ).toEqual([
      { start: 4, end: 9 },
      { start: 20, end: 25 },
    ]);
  });

  it('does not touch the array it was given', () => {
    const spans = [
      { start: 20, end: 25 },
      { start: 4, end: 9 },
    ];
    mergeSpans(spans);

    expect(spans[0]).toEqual({ start: 20, end: 25 });
  });
});
