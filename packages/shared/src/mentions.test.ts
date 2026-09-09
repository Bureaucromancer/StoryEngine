// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry } from './factories.js';
import { mentionIndex } from './mentions.js';
import type { Lorebook, LoreEntry } from './schema/lorebook.js';

/**
 * The mention rule — [10 §5.3] renders it and
 * [11 §6](../../../docs/design/11-lorebooks-as-a-format.md) counts it, so it is
 * one rule tested once.
 *
 * **What these assert is the shape of the rule rather than the shape of the
 * lists**, because the rule is the part a reading depends on: if the script
 * reports that real books produce absurd mention lists, the first question is
 * whether the matcher was too loose, and these are the answers to it.
 */

function entry(name: string, over: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry(name), ...over };
}

function book(entries: LoreEntry[]): Lorebook {
  return { ...newLorebook('Ardent'), entries };
}

/** The names an entry mentions, for an assertion that reads like the surface. */
function named(made: ReturnType<typeof mentionIndex>, from: LoreEntry): string[] {
  return (made.mentions.get(from) ?? []).map((row) => row.entry.name);
}

describe('what counts as a mention', () => {
  it('pairs an entry whose name occurs in another entry’s content', () => {
    const harbour = entry('Harbour', { content: 'Cranes over the water.' });
    const ferryman = entry('The Ferryman', { content: 'He crosses to the Harbour at dawn.' });
    const made = mentionIndex(book([harbour, ferryman]));

    expect(named(made, ferryman)).toEqual(['Harbour']);
    expect((made.mentionedBy.get(harbour) ?? []).map((row) => row.entry.name)).toEqual([
      'The Ferryman',
    ]);
    // Every row names what matched — §5.3, and the reason a list can survive the
    // ambiguity an underline could not.
    expect(made.mentions.get(ferryman)?.[0]?.terms).toEqual(['Harbour']);
  });

  it('matches a key as readily as a name, and reports which one hit', () => {
    const harbour = entry('Harbour District', { keys: ['the docks'], content: 'Cranes.' });
    const ferryman = entry('The Ferryman', { content: 'He works the docks in all weathers.' });
    const made = mentionIndex(book([harbour, ferryman]));

    expect(made.mentions.get(ferryman)?.[0]?.terms).toEqual(['the docks']);
  });

  it('reads secondary keys as surface forms too', () => {
    // [11 §2] makes its soft-indexing argument about the pair, and the book
    // page's own search already covers both.
    const harbour = entry('Harbour', { secondaryKeys: ['quayside'], content: 'Cranes.' });
    const ferryman = entry('The Ferryman', { content: 'The quayside is quiet at dawn.' });

    expect(mentionIndex(book([harbour, ferryman])).mentions.get(ferryman)?.[0]?.terms).toEqual([
      'quayside',
    ]);
  });

  /**
   * **The rule is whole-word, and this is the case that makes it worth being
   * one.** Substring matching pairs *art* with *harbour* and *the docks* with
   * *the dockside*, which is the "absurd lists" outcome 16 §6 is watching for —
   * arrived at by the matcher rather than by the books.
   */
  it('does not match inside a longer word', () => {
    const art = entry('Art', { content: 'Paintings.' });
    const harbour = entry('Harbour', { content: 'The harbour at dawn.' });

    expect(named(mentionIndex(book([art, harbour])), harbour)).toEqual([]);
  });

  it('ignores case, because keys are lowercase and prose is not', () => {
    const harbour = entry('Harbour', { content: 'Cranes.' });
    const ferryman = entry('The Ferryman', { content: 'He crosses to the HARBOUR.' });

    expect(named(mentionIndex(book([harbour, ferryman])), ferryman)).toEqual(['Harbour']);
  });

  it('matches across the punctuation between words', () => {
    const docks = entry('The Docks', { content: 'Cranes.' });
    const ferryman = entry('Ferryman', { content: 'Out past the  docks, at dawn.' });

    expect(named(mentionIndex(book([docks, ferryman])), ferryman)).toEqual(['The Docks']);
  });

  it('does not pair an entry with itself', () => {
    const harbour = entry('Harbour', { content: 'The Harbour is where it begins.' });

    expect(named(mentionIndex(book([harbour])), harbour)).toEqual([]);
  });

  it('lists both entries where two share a key, rather than picking one', () => {
    // §5.3: "two entries may share a key, so any winner is a rule the file does
    // not contain". A list needs no winner, which is why it can exist.
    const first = entry('Harbour, north', { keys: ['harbour'], content: 'Cranes.' });
    const second = entry('Harbour, south', { keys: ['harbour'], content: 'Silt.' });
    const ferryman = entry('Ferryman', { content: 'He crosses the harbour.' });

    expect(named(mentionIndex(book([first, second, ferryman])), ferryman)).toEqual([
      'Harbour, north',
      'Harbour, south',
    ]);
  });

  /**
   * **No stop-list and no length floor**, which is the one place this departs
   * from what a reader might expect. §5.3 rejects a stop-list because it is
   * *invisible* invented policy; a book whose keys are common words gets a long
   * list, and that is the file being what it is. It is also exactly the signal
   * 16 §6 is looking for, so suppressing it would break the instrument.
   */
  it('matches a one-letter key, because the alternative is invisible policy', () => {
    const vague = entry('A Place', { keys: ['a'], content: 'Somewhere.' });
    const ferryman = entry('Ferryman', { content: 'He is a boatman.' });

    expect(named(mentionIndex(book([vague, ferryman])), ferryman)).toEqual(['A Place']);
  });

  it('says nothing about an entry with no content to be named in', () => {
    const harbour = entry('Harbour', { content: '' });
    const ferryman = entry('Ferryman', { content: 'Past the Harbour.' });
    const made = mentionIndex(book([harbour, ferryman]));

    expect(named(made, harbour)).toEqual([]);
    expect(named(made, ferryman)).toEqual(['Harbour']);
  });

  it('gives every entry an answer, including an empty one', () => {
    // The maps are total over the book's entries, so a caller never has to
    // distinguish "no mentions" from "not computed".
    const only = entry('Alone', { content: 'Nothing here.' });
    const made = mentionIndex(book([only]));

    expect(made.mentions.has(only)).toBe(true);
    expect(made.mentionedBy.has(only)).toBe(true);
  });

  /**
   * Two entries can carry one id — nothing enforces uniqueness and the
   * importers derive ids by hashing name and content — so the index is keyed by
   * the entry object. Keyed by id, these two would share one list.
   */
  it('keeps two entries that share an id apart', () => {
    const twin = entry('Harbour', { content: 'Cranes.' });
    const other = { ...entry('Bridge', { content: 'Iron.' }), id: twin.id };
    const ferryman = entry('Ferryman', { content: 'Past the Harbour, over the Bridge.' });
    const made = mentionIndex(book([twin, other, ferryman]));

    expect((made.mentionedBy.get(twin) ?? []).map((row) => row.entry.name)).toEqual(['Ferryman']);
    expect((made.mentionedBy.get(other) ?? []).map((row) => row.entry.name)).toEqual(['Ferryman']);
  });
});

/**
 * The book page's guard checks that `entries` is a list of objects and
 * deliberately no more — a hand-edited file is the storage thesis working, and
 * the one answer that surface may not give it is a white screen. So this is
 * reachable with entries that are not `LoreEntry`s whatever the type says, and
 * the first thing it met outside these tests was exactly that.
 */
describe('an entry that is not the shape the type promises', () => {
  function halfOf(over: Record<string, unknown>): LoreEntry {
    return over as unknown as LoreEntry;
  }

  it('reads a book whose entries have no key arrays at all', () => {
    const book = {
      ...newLorebook('Ardent'),
      entries: [
        halfOf({ id: 'e1', name: 'Harbour', content: 'Cranes.' }),
        halfOf({ id: 'e2', name: 'Ferryman', content: 'Past the Harbour at dawn.' }),
      ],
    };

    const made = mentionIndex(book);

    expect(named(made, book.entries[1]!)).toEqual(['Harbour']);
  });

  it('reads a book whose entries have no text at all', () => {
    const book = { ...newLorebook('Ardent'), entries: [halfOf({ id: 'e1' })] };

    expect(() => mentionIndex(book)).not.toThrow();
    expect(mentionIndex(book).mentions.size).toBe(1);
  });

  it('ignores a key that is not a string', () => {
    const book = {
      ...newLorebook('Ardent'),
      entries: [
        halfOf({ id: 'e1', name: 'Harbour', keys: [7, null, 'docks'], content: 'Cranes.' }),
        halfOf({ id: 'e2', name: 'Ferryman', content: 'Along the docks.' }),
      ],
    };

    expect(mentionIndex(book).mentions.get(book.entries[1]!)?.[0]?.terms).toEqual(['docks']);
  });
});
