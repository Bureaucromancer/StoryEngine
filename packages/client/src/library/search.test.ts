// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newLoreEntry } from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import { entryMatches, highlight, matches } from './search.js';

/**
 * Within-book search, where it is pure.
 *
 * **The runs are the part worth testing properly.** Splitting text around a
 * match is the kind of code that works on the example somebody wrote it against
 * and drops a character at one end — so the assertions here rebuild the
 * original from the runs, which is a property rather than an example and fails
 * for every off-by-one at once.
 */

describe('matching', () => {
  it('is a substring, and does not care about case', () => {
    expect(matches('The Harbour', 'harbour')).toBe(true);
    expect(matches('The Harbour', 'HARB')).toBe(true);
    expect(matches('The Harbour', 'docks')).toBe(false);
  });

  it('treats an empty query as no query rather than as a query nothing answers', () => {
    expect(matches('anything', '')).toBe(true);
  });

  /**
   * No regular expression anywhere: this runs on a keystroke, and a pattern
   * compiled from half-typed input is the hazard P5.4 puts a timeout in front
   * of. Characters that would be operators are just characters.
   */
  it('reads a pattern character as a character', () => {
    expect(matches('a.b', 'a.b')).toBe(true);
    expect(matches('axb', 'a.b')).toBe(false);
    expect(matches('cost: $5 (each)', '$5 (each)')).toBe(true);
  });

  it('searches the five fields §5.3 names and no others', () => {
    const entry = {
      ...newLoreEntry('Harbour'),
      keys: ['docks'],
      secondaryKeys: ['quay'],
      description: 'Where ships come in.',
      content: 'Cranes stand over the water.',
      tag: 'location',
    };

    expect(entryMatches(entry, 'harbour')).toBe(true);
    expect(entryMatches(entry, 'docks')).toBe(true);
    expect(entryMatches(entry, 'quay')).toBe(true);
    expect(entryMatches(entry, 'ships')).toBe(true);
    expect(entryMatches(entry, 'cranes')).toBe(true);
    // `tag` is a filter chip rather than a search field — §5.3 lists five.
    expect(entryMatches(entry, 'location')).toBe(false);
  });
});

describe('the runs a highlight is drawn from', () => {
  const rebuilt = (text: string, query: string): string =>
    highlight(text, query)
      .map((run) => run.text)
      .join('');

  it('never loses or invents a character', () => {
    for (const [text, query] of [
      ['the harbour and the harbour again', 'harbour'],
      ['harbour', 'harbour'],
      ['aaaa', 'aa'],
      ['nothing here', 'zzz'],
      ['', 'harbour'],
      ['harbour', ''],
      ['Harbour HARBOUR harbour', 'harbour'],
    ] as const) {
      expect(rebuilt(text, query), `${text} / ${query}`).toBe(text);
    }
  });

  it('marks every occurrence, and marks the text as written rather than as typed', () => {
    const runs = highlight('Harbour and HARBOUR', 'harbour');

    expect(runs.filter((run) => run.hit).map((run) => run.text)).toEqual(['Harbour', 'HARBOUR']);
  });

  it('marks the middle of a word as well as the start of one', () => {
    expect(highlight('shipyard', 'ipya')).toEqual([
      { text: 'sh', hit: false },
      { text: 'ipya', hit: true },
      { text: 'rd', hit: false },
    ]);
  });

  /**
   * One un-hit run rather than an empty list, so a caller can render through
   * this unconditionally instead of branching on whether a search is running.
   */
  it('answers with the whole text when there is nothing to mark', () => {
    expect(highlight('Harbour', '')).toEqual([{ text: 'Harbour', hit: false }]);
    expect(highlight('Harbour', 'docks')).toEqual([{ text: 'Harbour', hit: false }]);
  });
});
