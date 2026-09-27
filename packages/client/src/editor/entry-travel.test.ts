// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  newLoreEntry,
  newLorebook,
  type LoreEntry,
  type LoreFolder,
  type Lorebook,
} from '@storyengine/shared';

import {
  bookDifferences,
  foldersFor,
  mergeEntries,
  readableAsEntries,
  selectionAsLorebook,
} from './entry-travel.js';

/**
 * ***[10 §11.2c](../../../../docs/design/10-ui-surfaces.md)'s two hard
 * questions***, which are the two a screen cannot answer: **which folders come
 * with a selection**, and **what a merge does with a collision**.
 *
 * Everything else §11.2c asks for is a control — a checkbox, a download, a file
 * picker — and is asserted where controls are. What is here is the part where a
 * wrong answer looks exactly like a right one: a dozen entries arriving flat, or
 * an edit quietly overwritten by a copy of its own ancestor.
 */

/**
 * The value, or a failed test rather than a cast.
 *
 * `entries[0]` is `LoreEntry | undefined` under `noUncheckedIndexedAccess`, and
 * a fixture this file built two lines above is not a place to be narrowing —
 * an assertion here says *the fixture is wrong* if it ever is, which is the
 * true statement, where `as LoreEntry` would say nothing and `!` would say it
 * silently.
 */
function must<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined) throw new Error('the fixture is missing a value');
  return value;
}

function folder(id: string, name: string, parentFolderId: string | null, order = 0): LoreFolder {
  return { id, name, parentFolderId, enabled: true, order };
}

function entry(name: string, folderId: string | null): LoreEntry {
  return { ...newLoreEntry(name), folderId };
}

/** A book with a two-deep folder tree and one entry in each of three places. */
function book(): Lorebook {
  const made = newLorebook('Rain City');
  return {
    ...made,
    folders: [
      folder('districts', 'Districts', null, 0),
      folder('harbour', 'Harbour', 'districts', 1),
      folder('uplands', 'Uplands', 'districts', 2),
      folder('factions', 'Factions', null, 3),
    ],
    entries: [
      entry('The wet quay', 'harbour'),
      entry('The signal tower', 'uplands'),
      entry('The Ledger House', 'factions'),
      entry('Rain', null),
    ],
  };
}

describe('what goes out with a selection', () => {
  it('brings the folders above the entries taken, and none of the rest', () => {
    const source = book();
    const carried = foldersFor(source, [must(source.entries[0])]);

    // Harbour **and** Districts: the chain all the way up, because a folder
    // whose parent is missing is a folder that arrives at the root.
    expect(carried.map((one) => one.id)).toEqual(['districts', 'harbour']);
  });

  it('keeps the book order of the folders rather than the order they were found', () => {
    const source = book();
    // Chosen bottom-up on purpose: the discovery order here is Factions first.
    const chosen = [must(source.entries[2]), must(source.entries[1])];

    expect(foldersFor(source, chosen).map((one) => one.id)).toEqual([
      'districts',
      'uplands',
      'factions',
    ]);
  });

  it('survives a parent chain that points at itself', () => {
    const source = book();
    const cyclic: Lorebook = {
      ...source,
      folders: [folder('a', 'A', 'b'), folder('b', 'B', 'a')],
      entries: [entry('Somewhere', 'a')],
    };

    // A hand-edited file rather than an impossibility, so the assertion is that
    // it returns at all — and returns a real prefix of the ancestry.
    expect(
      foldersFor(cyclic, cyclic.entries)
        .map((one) => one.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('is a lorebook, with a new id and the selection as its entries', () => {
    const source = book();
    const ids = new Set([must(source.entries[0]).id, must(source.entries[3]).id]);

    const out = selectionAsLorebook(source, ids);

    expect(out.schema).toBe(source.schema);
    expect(out.id).not.toBe(source.id);
    expect(out.name).toBe('Rain City — entries');
    expect(out.entries.map((one) => one.name)).toEqual(['The wet quay', 'Rain']);
    // Rain is at the root, so only the quay's chain travels.
    expect(out.folders.map((one) => one.id)).toEqual(['districts', 'harbour']);
  });

  it('leaves the book gallery, the writing samples and the hooks behind', () => {
    const source: Lorebook = {
      ...book(),
      media: [
        {
          id: 'm1',
          role: 'gallery',
          mime: 'image/png',
          digest: 'sha256:00',
          bytes: 1,
          ref: 'assets/cover.png',
          tags: [],
        },
      ],
      primaryMediaId: 'm1',
      writingSamples: [{ id: 'w1', enabled: true, title: 'A page', body: 'Rain.', note: '' }],
      hooks: [],
    };

    const out = selectionAsLorebook(source, new Set([must(source.entries[0]).id]));

    expect(out.media).toEqual([]);
    expect(out.primaryMediaId).toBeNull();
    expect(out.writingSamples).toEqual([]);
    expect(out.hooks).toEqual([]);
  });

  it('carries an entry whole, so its stateSchema travels and no state can', () => {
    const source = book();
    const first = must(source.entries[0]);
    const withSchema: Lorebook = {
      ...source,
      entries: [{ ...first, stateSchema: { type: 'object' } }, ...source.entries.slice(1)],
    };

    const out = selectionAsLorebook(withSchema, new Set([first.id]));

    expect(out.entries[0]?.stateSchema).toEqual({ type: 'object' });
    // And there is nowhere for a value to have come from: state lives in a
    // session channel ([03 §3.3]) and was never a field on the entry.
    expect(Object.keys(out.entries[0] ?? {})).not.toContain('state');
  });
});

describe('what a merge does on the way in', () => {
  const NOBODY = new Set<string>();

  it('appends in the file order and adds the folders this book lacks', () => {
    const into = book();
    const from: Lorebook = {
      ...newLorebook('A gift'),
      folders: [folder('markets', 'Markets', null)],
      entries: [entry('The fish market', 'markets'), entry('The salt road', null)],
    };

    const { book: after, report } = mergeEntries(into, from, NOBODY);

    expect(after.entries.map((one) => one.name).slice(4)).toEqual([
      'The fish market',
      'The salt road',
    ]);
    expect(report.foldersAdded.map((one) => one.id)).toEqual(['markets']);
    expect(after.folders.map((one) => one.id)).toContain('markets');
  });

  it('reuses a folder this book already has rather than adding a second one', () => {
    const into = book();
    const from: Lorebook = {
      ...newLorebook('A gift'),
      // The same id, because this file came out of this book.
      folders: [folder('harbour', 'Harbour', 'districts')],
      entries: [entry('The dry dock', 'harbour')],
    };

    const { book: after, report } = mergeEntries(into, from, NOBODY);

    expect(report.foldersAdded).toEqual([]);
    expect(after.folders.filter((one) => one.id === 'harbour')).toHaveLength(1);
    expect(after.entries.at(-1)?.folderId).toBe('harbour');
  });

  it('never overwrites an entry whose id it shares, and says that it did not', () => {
    const into = book();
    const mine = must(into.entries[0]);
    const edited: Lorebook = {
      ...into,
      entries: [{ ...mine, content: 'My own words.' }, ...into.entries.slice(1)],
    };
    // The same id and a different body — a copy of my own entry, come back.
    const from: Lorebook = {
      ...newLorebook('A gift'),
      entries: [{ ...mine, content: 'Somebody else’s words.' }],
    };

    const { book: after, report } = mergeEntries(edited, from, NOBODY);

    // My edit stands.
    expect(after.entries[0]?.content).toBe('My own words.');
    // Theirs arrived beside it, under an id of its own.
    expect(after.entries).toHaveLength(5);
    expect(after.entries.at(-1)?.id).not.toBe(mine.id);
    expect(after.entries.at(-1)?.content).toBe('Somebody else’s words.');
    // And the collision is *offered*, which is what makes replace a thing a
    // person can choose rather than a thing that happened to them.
    expect(report.entries[0]?.collidesWith?.id).toBe(mine.id);
  });

  /**
   * *Twins in the file* (2026-09-27): the clash was looked for only among the
   * destination's entries, never among the ones this merge had just added, so
   * a file carrying two entries with one id brought both in on it.
   */
  it('gives each of two entries sharing an id in the file an id of its own', () => {
    const from: Lorebook = {
      ...newLorebook('A gift'),
      entries: [
        { ...newLoreEntry('The lock keeper'), id: 'twin' },
        { ...newLoreEntry('The lock keeper’s daughter'), id: 'twin' },
      ],
    };

    const { book: after } = mergeEntries(book(), from, NOBODY);
    const arrived = after.entries.slice(-2).map((one) => one.id);

    expect(new Set(arrived).size).toBe(2);
    expect(arrived[0]).toBe('twin');
  });

  it('suffixes a name that is taken, and reports what it was called', () => {
    const into = book();
    const from: Lorebook = {
      ...newLorebook('A gift'),
      entries: [entry('Rain', null), entry('Rain', null)],
    };

    const { book: after, report } = mergeEntries(into, from, NOBODY);

    expect(after.entries.map((one) => one.name).slice(4)).toEqual(['Rain (2)', 'Rain (3)']);
    expect(report.entries.map((one) => one.wasNamed)).toEqual(['Rain', 'Rain']);
  });

  it('names an actorFilter that refers to nothing here', () => {
    const into = book();
    const filtered = {
      ...entry('The Ledger clerk', null),
      actorFilter: { mode: 'include' as const, values: ['vera', 'ilse'] },
    };
    const from: Lorebook = { ...newLorebook('A gift'), entries: [filtered] };

    const { report } = mergeEntries(into, from, new Set(['vera']));

    expect(report.dangling).toHaveLength(1);
    expect(report.dangling[0]?.actorIds).toEqual(['ilse']);
  });

  it('names the book-level settings the destination reads differently', () => {
    const into: Lorebook = { ...book(), scanDepth: 2, recursiveScanning: false };
    const from: Lorebook = { ...newLorebook('A gift'), scanDepth: 8, recursiveScanning: true };

    const rows = bookDifferences(into, from);

    expect(rows).toEqual([
      { field: 'Scan depth', from: '8', to: '2' },
      { field: 'Recursive scanning', from: 'true', to: 'false' },
    ]);
  });

  it('compares scope by its kind, because linked actor ids are install-local', () => {
    const into: Lorebook = { ...book(), scope: { kind: 'linked', actorIds: ['a'] } };
    const from: Lorebook = { ...newLorebook('A gift'), scope: { kind: 'linked', actorIds: ['b'] } };

    expect(bookDifferences(into, from).map((one) => one.field)).not.toContain('Scope');
  });
});

describe('reading the file somebody chose', () => {
  it('tells a broken file from the wrong file from an empty one', () => {
    expect(readableAsEntries(null)).toEqual({ problem: 'unreadable' });
    expect(readableAsEntries({ schema: 'storyengine.actor/1' })).toEqual({
      problem: 'wrong-schema',
    });
    expect(readableAsEntries({ ...newLorebook('Empty') })).toEqual({ problem: 'no-entries' });
    expect(
      readableAsEntries({ ...newLorebook('Full'), entries: [entry('One', null)] }),
    ).toHaveProperty('book');
  });
});
