// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { newLoreEntry, newLorebook } from './factories.js';
import { entriesInFolder, entryGate, folderChain, offCount, resolvedFolderId } from './lore.js';
import type { LoreEntry, LoreFolder, Lorebook } from './schema/lorebook.js';

/**
 * The gate, which is the one computation P5's two halves must agree about —
 * the book page renders it and P5.7's retriever acts on it, and they agree
 * because there is one of it.
 *
 * **Three of these are about the cases a check written from the schema's
 * summary gets wrong**: that folders nest, that the chain may not be acyclic
 * because these files are hand-edited, and that a `folderId` naming a folder
 * the book does not contain has to degrade rather than throw or vanish.
 */

function folder(id: string, over: Partial<LoreFolder> = {}): LoreFolder {
  return { id, name: id, parentFolderId: null, enabled: true, order: 0, ...over };
}

function entry(name: string, over: Partial<LoreEntry> = {}): LoreEntry {
  return { ...newLoreEntry(name), ...over };
}

function book(over: Partial<Lorebook> = {}): Lorebook {
  return { ...newLorebook('Ardent'), ...over };
}

describe('an entry with nothing shut in its way', () => {
  it('is active, and says so without claiming it will fire', () => {
    const shelf = book({ entries: [entry('Harbour')] });

    expect(entryGate(shelf, shelf.entries[0]!)).toEqual({ active: true, blockedBy: [] });
  });
});

describe('the three ways off', () => {
  it('reports the entry’s own switch', () => {
    const shelf = book({ entries: [entry('Harbour', { enabled: false })] });

    expect(entryGate(shelf, shelf.entries[0]!).blockedBy).toEqual([{ kind: 'entry-off' }]);
  });

  it('reports the book’s', () => {
    const shelf = book({ enabled: false, entries: [entry('Harbour')] });

    expect(entryGate(shelf, shelf.entries[0]!).blockedBy).toEqual([{ kind: 'book-off' }]);
  });

  /**
   * The case [10 §5] is explicit about: a folder gate leaves each entry's own
   * `enabled` *preserved rather than mutated*. Exit-gate step 2 tests exactly
   * this, so the assertion is two-sided — the entry is off, and its own switch
   * is visibly still on.
   */
  it('reports a folder’s, and leaves the entry’s own switch alone', () => {
    const shelf = book({
      folders: [folder('timeline', { enabled: false })],
      entries: [entry('Harbour', { folderId: 'timeline' })],
    });
    const found = shelf.entries[0]!;

    expect(entryGate(shelf, found)).toEqual({
      active: false,
      blockedBy: [{ kind: 'folder-off', folderId: 'timeline', folderName: 'timeline' }],
    });
    expect(found.enabled).toBe(true);
  });
});

describe('folders nest, which is where a one-hop check is wrong', () => {
  const nested = (): Lorebook =>
    book({
      folders: [
        folder('era', { enabled: false }),
        folder('city', { parentFolderId: 'era' }),
        folder('docks', { parentFolderId: 'city' }),
      ],
      entries: [entry('Harbour', { folderId: 'docks' })],
    });

  it('inherits a gate from an ancestor several levels up', () => {
    const shelf = nested();

    expect(entryGate(shelf, shelf.entries[0]!).active).toBe(false);
  });

  it('walks the chain nearest first', () => {
    const shelf = nested();

    expect(folderChain(shelf, shelf.entries[0]!).map((found) => found.id)).toEqual([
      'docks',
      'city',
      'era',
    ]);
  });

  /**
   * Outermost, for the same reason the list is ordered outermost first: it is
   * the one that has to be opened before any gate below it can matter, and
   * naming the nearest would send somebody to open a folder that changes
   * nothing.
   */
  it('names the outermost shut folder when two are shut', () => {
    const shelf = book({
      folders: [
        folder('era', { enabled: false }),
        folder('city', { parentFolderId: 'era', enabled: false }),
      ],
      entries: [entry('Harbour', { folderId: 'city' })],
    });

    expect(entryGate(shelf, shelf.entries[0]!).blockedBy).toEqual([
      { kind: 'folder-off', folderId: 'era', folderName: 'era' },
    ]);
  });

  /**
   * These files are hand-edited and imported, and [00 §3.3] says a broken
   * reference degrades rather than throws. A cycle is the shape that turns a
   * naive walk into a hung tab.
   */
  it('does not hang on a folder that is its own ancestor', () => {
    const shelf = book({
      folders: [
        folder('a', { parentFolderId: 'b' }),
        folder('b', { parentFolderId: 'a', enabled: false }),
      ],
      entries: [entry('Harbour', { folderId: 'a' })],
    });

    expect(folderChain(shelf, shelf.entries[0]!).map((found) => found.id)).toEqual(['a', 'b']);
    expect(entryGate(shelf, shelf.entries[0]!).active).toBe(false);
  });
});

describe('more than one gate shut at once', () => {
  /**
   * A list rather than one winner: picking a single reason would make the
   * surface lie in whichever direction it picked, and both are true.
   */
  it('reports every one, outermost first', () => {
    const shelf = book({
      enabled: false,
      folders: [folder('timeline', { enabled: false })],
      entries: [entry('Harbour', { folderId: 'timeline', enabled: false })],
    });

    expect(entryGate(shelf, shelf.entries[0]!).blockedBy.map((found) => found.kind)).toEqual([
      'book-off',
      'folder-off',
      'entry-off',
    ]);
  });
});

describe('a folderId the book does not contain', () => {
  it('gates nothing, because there is no folder there to be shut', () => {
    const shelf = book({ entries: [entry('Harbour', { folderId: 'a-folder-that-left' })] });

    expect(entryGate(shelf, shelf.entries[0]!).active).toBe(true);
  });

  /**
   * And it lands in the same node as `folderId: null`. §5.3 wants a real
   * *Ungrouped* node rather than a quiet omission "because a nullable field
   * that renders as nothing hides entries" — and an entry pointing at a folder
   * that is not there would be hidden by exactly the same omission.
   */
  it('lands under Ungrouped rather than nowhere', () => {
    const shelf = book({
      folders: [folder('timeline')],
      entries: [entry('Harbour', { folderId: 'a-folder-that-left' }), entry('Docks')],
    });

    expect(resolvedFolderId(shelf, shelf.entries[0]!)).toBeNull();
    expect(entriesInFolder(shelf, null).map((found) => found.name)).toEqual(['Harbour', 'Docks']);
    expect(entriesInFolder(shelf, 'timeline')).toEqual([]);
  });
});

describe('the count beside the book', () => {
  it('is every entry a shut gate reaches, however it is shut', () => {
    const shelf = book({
      folders: [folder('timeline', { enabled: false })],
      entries: [
        entry('Harbour'),
        entry('Docks', { enabled: false }),
        entry('Bridge', { folderId: 'timeline' }),
      ],
    });

    expect(offCount(shelf)).toBe(2);
  });
});
