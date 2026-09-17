// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  LOREBOOK_SCHEMA,
  uuidv7,
  type LoreEntry,
  type LoreFolder,
  type Lorebook,
} from '@storyengine/shared';

/**
 * ***Entries travel on their own*** —
 * [10 §11.2c](../../../../docs/design/10-ui-surfaces.md),
 * [04 §5.2](../../../../docs/design/04-schemas.md).
 *
 * ***The unit an author moves is smaller than the unit the library browses.***
 * §11.2c's argument is evidence rather than preference: *"copying one entry out
 * of one of your own books and into another means exporting a book, hand-editing
 * JSON, and importing it back. People do exactly that, which is evidence about
 * the unit rather than about the people."*
 *
 * ***An entry export is a lorebook***, and that one decision is most of this
 * file. The same `storyengine.lorebook/1` with `entries` holding the selection —
 * **no fragment schema, nothing new to version**, and the file opens in anything
 * that reads a lorebook, ours or otherwise. It also means the way *in* is the
 * way in for any book: *import entries* is how somebody cherry-picks four
 * entries out of a two-hundred-entry book they downloaded, foreign format
 * included, because the converters already produce a lorebook
 * ([P4](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * ***This module is the model and holds no React.*** The list, the checkboxes
 * and the review panel are `LorebookEditorPage`'s; what is here is *which
 * folders come with a selection* and *what a merge does with a collision*,
 * which are the two questions with answers that can be wrong in ways nobody
 * would see on a screen.
 */

/** Entries in `parentFolderId` order, outermost first — see {@link foldersFor}. */
function ancestry(folders: readonly LoreFolder[], id: string | null): LoreFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder] as const));
  const chain: LoreFolder[] = [];
  const guard = new Set<string>();
  let at = id;
  while (at !== null) {
    // A parent chain is author-supplied data, so a cycle is a file somebody
    // hand-edited rather than an impossibility. Stopping is the whole handling:
    // what has been collected is a real prefix of the ancestry either way.
    if (guard.has(at)) break;
    guard.add(at);
    const folder = byId.get(at);
    if (folder === undefined) break;
    chain.unshift(folder);
    at = folder.parentFolderId;
  }
  return chain;
}

/**
 * The folders above a set of entries, carrying **the entries taken and none of
 * the rest** — §11.2c's first rule about what goes with a selection.
 *
 * *"Folder structure is a shape the author gave the book, and a dozen entries
 * arriving flat at the root have lost it."* So a selected entry brings its
 * folder, and its folder's folder, all the way up — and a sibling folder holding
 * nothing that was selected does not come.
 *
 * **In the book's own folder order**, not in discovery order, because `order` is
 * a number the author set and re-deriving it from which entry happened to be
 * selected first would be this function inventing a shape.
 */
export function foldersFor(book: Lorebook, entries: readonly LoreEntry[]): LoreFolder[] {
  const wanted = new Set<string>();
  for (const entry of entries) {
    for (const folder of ancestry(book.folders, entry.folderId)) wanted.add(folder.id);
  }
  return book.folders.filter((folder) => wanted.has(folder.id));
}

/**
 * A selection of entries, as a lorebook file.
 *
 * ***What travels, and what does not, is the part worth reading.*** §11.2c names
 * three things that go — the folders above them, entry media in the book's own
 * container, and `stateSchema` but never state. The first is {@link foldersFor};
 * the second is free until [§11.2b](../../../../docs/design/10-ui-surfaces.md)
 * builds entry media at all, and is noted below; the third is free by
 * construction, because an entry carries its `stateSchema` as a field and the
 * **values** live in a session channel and were never in the book
 * ([03 §3.3](../../../../docs/design/03-data-model.md)). *That an export must
 * not carry somebody's playthrough is inherited here rather than re-decided*,
 * which is the same split paying off in a second place.
 *
 * **The book-level activation numbers travel because this is a book.** A
 * selection is not a fragment with a header bolted on: `scanDepth`, both
 * budgets and `recursiveScanning` are what the entries were tuned inside, so
 * sending them is sending the conditions the author tested against. What the
 * *destination* then does with them is the merge's business, and §11.2c is
 * explicit that the destination wins — which is why {@link bookDifferences}
 * exists and why this does not try to pre-empt it.
 *
 * **The book's gallery does not travel, and neither do its writing samples.**
 * `media` is *"the book's gallery — maps, establishing shots, style references
 * for the world as a whole"* and `writingSamples` is *"a fact about the book —
 * how this world reads"*. Neither is a fact about twelve entries, and a
 * selection that dragged the whole world's art along would be the *"book nobody
 * wanted arriving in the library to be cleaned up afterwards"* in a smaller
 * file. `hooks` are left for the same reason and one more: nothing links a hook
 * to an entry, so *which hooks came with these twelve* has no answer to give.
 *
 * **A fresh id and a name that says what it is.** Ids are book-local, so reusing
 * the source book's would make a selection and its parent indistinguishable in a
 * library; the name carries the source's so that the file on somebody's disk in
 * a month still says where it came from.
 */
export function selectionAsLorebook(book: Lorebook, ids: ReadonlySet<string>): Lorebook {
  const entries = book.entries.filter((entry) => ids.has(entry.id));
  return {
    ...book,
    id: uuidv7(),
    name: book.name === '' ? 'Entries' : `${book.name} — entries`,
    folders: foldersFor(book, entries),
    entries,
    /**
     * Cleared rather than carried, per the paragraph above. `primaryMediaId`
     * goes with `media` because it names one of them: a cover id pointing into
     * an array that is no longer there is the dangling reference the schema
     * tolerates and nobody wants to have created deliberately.
     */
    media: [],
    primaryMediaId: null,
    ...(book.writingSamples === undefined ? {} : { writingSamples: [] }),
    ...(book.hooks === undefined ? {} : { hooks: [] }),
  };
}

/** One entry's fate on the way in — the rows §11.2c's review step shows. */
export interface MergedEntry {
  /** The entry as it landed, with whatever id and name it ended up with. */
  entry: LoreEntry;
  /** What it was called in the file, when the name had to change. */
  wasNamed?: string;
  /**
   * The entry already in this book under the incoming entry's id.
   *
   * **Present means *offer replace*, never *do replace*.** §11.2c: *"two books
   * hold entries under the same id precisely because one was copied from the
   * other, which makes id equality a sign of shared ancestry rather than
   * permission to overwrite an edit."*
   */
  collidesWith?: LoreEntry;
}

/** What a merge did, which is what the review step renders. */
export interface MergeReport {
  entries: MergedEntry[];
  /** Folders the incoming file brought that this book did not have. */
  foldersAdded: LoreFolder[];
  /**
   * `actorFilter` values naming an actor this install does not have — §11.2c's
   * *"what now refers to nothing"*, and *"the common case"*.
   */
  dangling: { entry: LoreEntry; actorIds: string[] }[];
  /**
   * Book-level settings the destination reads differently from the source —
   * {@link bookDifferences}.
   */
  differences: BookDifference[];
}

/** One book-level setting the two books disagree about. */
export interface BookDifference {
  field: string;
  from: string;
  to: string;
}

/**
 * What fired there may not fire here — §11.2c's last rule.
 *
 * *"`scanDepth`, `recursiveScanning`, both budgets and the book's `LoreScope`
 * belong to the destination, so an entry tuned inside a book that scans eight
 * messages deep can go quiet in one that scans two, having itself changed in no
 * way."* **Naming the differences is the whole remedy offered here**, and
 * deliberately: §11.2c leaves the real answer to the keyword test against real
 * text, on the grounds that *"a warning that is checkable beats a warning that
 * is merely worrying"*.
 *
 * `scope` is compared by its `kind` rather than by its contents, because a
 * `linked` scope's actor ids are install-local and two books being linked to
 * different actors is not a fact about whether these entries will fire.
 */
export function bookDifferences(into: Lorebook, from: Lorebook): BookDifference[] {
  const rows: BookDifference[] = [];
  const say = (field: string, before: unknown, after: unknown): void => {
    if (before === after) return;
    rows.push({ field, from: String(before), to: String(after) });
  };
  say('Scan depth', from.scanDepth, into.scanDepth);
  say('Token budget', from.tokenBudget, into.tokenBudget);
  say('Entry limit', from.entryLimit, into.entryLimit);
  say('Recursive scanning', from.recursiveScanning, into.recursiveScanning);
  say('Scope', from.scope.kind, into.scope.kind);
  return rows;
}

/** A name that is not already taken, by adding ` (2)`, ` (3)` and so on. */
function freeName(taken: ReadonlySet<string>, name: string): string {
  if (!taken.has(name)) return name;
  for (let at = 2; ; at += 1) {
    const candidate = `${name} (${String(at)})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Entries from a file, merged into an open book.
 *
 * ***Add, and never overwrite*** — §11.2c, and it is the rule the whole function
 * is shaped around. *"Ids are book-local, so the default is add and never
 * overwrite. An incoming entry whose id already exists takes a fresh one, and
 * its name takes a suffix if that collides too."* The collision is **reported**,
 * so *replace the existing entry* is a thing the reviewer can then do row by
 * row; it is never what happened while they were reading.
 *
 * ***A folder already here is reused rather than duplicated.*** The same
 * ancestry argument applies to folders and cuts the other way: two books hold a
 * folder under one id because one came from the other, and adding a second
 * *Districts* beside the first is not a merge, it is a mess. So a folder id this
 * book already knows keeps its existing folder, and the incoming entries point
 * at it.
 *
 * ***Appended, in the file's order.*** Reading order is the array's
 * ([10 §5.3]), and where twelve entries belong is a question only the author can
 * answer — so they land where the author will look for them, at the end, and
 * reorder is a drag away.
 *
 * **`knownActors` is how *refers to nothing* gets an answer.** An `actorFilter`
 * naming an actor this install does not have is §11.2c's common case, and
 * nothing in the file can tell: it takes the destination's own list. Passing an
 * empty set means every filtered entry is reported, which is the honest reading
 * of *nothing is known* rather than a reason to report none.
 */
export function mergeEntries(
  into: Lorebook,
  from: Lorebook,
  knownActors: ReadonlySet<string>,
): { book: Lorebook; report: MergeReport } {
  const heldIds = new Set(into.entries.map((entry) => entry.id));
  const heldNames = new Set(into.entries.map((entry) => entry.name));
  const heldFolders = new Set(into.folders.map((folder) => folder.id));

  const foldersAdded = from.folders.filter((folder) => !heldFolders.has(folder.id));

  const merged: MergedEntry[] = [];
  const dangling: MergeReport['dangling'] = [];

  for (const incoming of from.entries) {
    const clash = into.entries.find((entry) => entry.id === incoming.id);
    const id = clash === undefined ? incoming.id : uuidv7();
    const name = freeName(heldNames, incoming.name);
    const entry: LoreEntry = { ...incoming, id, name };

    heldIds.add(id);
    heldNames.add(name);
    merged.push({
      entry,
      ...(name === incoming.name ? {} : { wasNamed: incoming.name }),
      ...(clash === undefined ? {} : { collidesWith: clash }),
    });

    const missing = (entry.actorFilter?.values ?? []).filter((one) => !knownActors.has(one));
    if (missing.length > 0) dangling.push({ entry, actorIds: missing });
  }

  return {
    book: {
      ...into,
      folders: [...into.folders, ...foldersAdded],
      entries: [...into.entries, ...merged.map((one) => one.entry)],
    },
    report: {
      entries: merged,
      foldersAdded,
      dangling,
      differences: bookDifferences(into, from),
    },
  };
}

/**
 * The one guard between a file somebody chose and {@link mergeEntries}.
 *
 * **A sentence rather than a boolean**, for [P11.6]'s reason: *that file is not
 * a lorebook* and *that file is a lorebook with no entries in it* are different
 * situations with different next steps, and a caller handed `false` can only
 * say the vaguer one.
 *
 * **It checks the schema banner and the entry array, and nothing else.** Full
 * validation is the server's — this file is on its way to the ordinary save,
 * which validates like every other write — and a second, weaker validator here
 * would be a place for the two to disagree.
 */
export function readableAsEntries(value: unknown): { book: Lorebook } | { problem: string } {
  if (typeof value !== 'object' || value === null) {
    return { problem: 'unreadable' };
  }
  const read = value as Record<string, unknown>;
  if (read['schema'] !== LOREBOOK_SCHEMA) return { problem: 'wrong-schema' };
  if (!Array.isArray(read['entries'])) return { problem: 'unreadable' };
  if (read['entries'].length === 0) return { problem: 'no-entries' };
  return { book: read as unknown as Lorebook };
}
