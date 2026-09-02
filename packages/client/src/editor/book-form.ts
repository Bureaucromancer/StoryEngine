// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newLoreEntry, type LoreEntry, type LoreFolder } from '@storyengine/shared';

/**
 * The lorebook editor's edits, as functions over the object
 * ([05 §11.2d](../../../../docs/design/05-ui-surfaces.md),
 * [P5.1](../../../../docs/design/workplan/07-p5-implementation.md)).
 *
 * **The draft is the book, not a projection of it**, and that is the one
 * structural difference from [form.ts](./form.ts) beside it. `ActorForm` exists
 * because an actor's editor owns nearly every field an actor has and each wants
 * its own input state — a number that is mid-typing is not a number. This editor
 * owns six fields out of forty and renders the rest as they are, so a projection
 * would be a forty-field parallel copy of the object built to carry six of them,
 * and every field it forgot would be a field a save silently dropped.
 *
 * Holding the object itself makes [10 §2](../../../../docs/design/10-schemas.md)'s
 * promise structural rather than remembered: a field this build has never heard
 * of survives because nothing ever took it out. What the functions below
 * guarantee is narrower and is the part worth testing — that an edit to one
 * entry leaves the other entries, and the rest of *that* entry, byte-identical.
 *
 * Every function returns a new object and mutates nothing, so the caller can
 * hold drafts as ordinary state and compare them by value.
 */

/** The draft, at the honesty of the file rather than of the type. */
export type Draft = Record<string, unknown>;

/**
 * The entries of a book that has already passed `lorebookShape`.
 *
 * The cast is through `unknown` and it is the same one the book page makes: the
 * guard is what earns it, and this module must never be reached without it.
 */
function entriesOf(book: Draft): LoreEntry[] {
  return (book['entries'] ?? []) as unknown as LoreEntry[];
}

function foldersOf(book: Draft): LoreFolder[] {
  return (book['folders'] ?? []) as unknown as LoreFolder[];
}

/** The entry this id names, or undefined — ids are book-local ([10 §5.2]). */
export function entryOf(book: Draft, id: string): LoreEntry | undefined {
  return entriesOf(book).find((candidate) => candidate.id === id);
}

/** Every entry, for a caller that only wants to read them. */
export function entryList(book: Draft): LoreEntry[] {
  return entriesOf(book);
}

/**
 * The book with one entry's fields changed.
 *
 * **Spread over the entry rather than rebuilt from it**, for the same reason
 * `applyForm` spreads over a writing sample: an entry is an object, [10 §2]'s
 * promise is per-object, and an entry rebuilt from the fields this build knows
 * would strip whatever a newer one wrote into it. The array is copied rather
 * than spliced because a React state update that mutates in place is a render
 * that does not happen.
 */
export function withEntry(book: Draft, id: string, patch: Partial<LoreEntry>): Draft {
  /**
   * **The first match, not every match**, and that is a defence rather than a
   * micro-optimisation. [10 §5.2] says an entry id is unique within its book,
   * but that is an intent and not an enforced invariant: the importers derive
   * one as `stableId('entry', name, content)`
   * (`packages/server/src/import/sillytavern/lorebook.ts`), so two entries that
   * agree on both collide. The read view marks every match and that is harmless;
   * a write that hit every match would edit two entries from one form and save
   * both. Patching the first degrades to *one of the two is uneditable*, which
   * is visible, rather than to *both changed*, which is not.
   */
  let done = false;
  return {
    ...book,
    entries: entriesOf(book).map((entry) => {
      if (done || entry.id !== id) return entry;
      done = true;
      return { ...entry, ...patch };
    }),
  };
}

/**
 * The book with a new entry at the end, and that entry's id.
 *
 * `newLoreEntry` rather than a literal, which is the same argument
 * [entry-defaults.ts](../library/entry-defaults.ts) makes from the other side:
 * the entry created here and the entry measured against there have to be the
 * same object, or a freshly made entry would open with its sections announcing
 * non-defaults it has not got.
 *
 * **Appended rather than inserted by `order`.** `order` is injection order and
 * has nothing to do with reading order ([05 §5.3]); a new entry belongs where
 * the author will look for it, which is where they were.
 */
export function withNewEntry(book: Draft, name: string): { book: Draft; id: string } {
  const entry = newLoreEntry(name);
  return { book: { ...book, entries: [...entriesOf(book), entry] }, id: entry.id };
}

/** The book without that entry. */
export function withoutEntry(book: Draft, id: string): Draft {
  return { ...book, entries: entriesOf(book).filter((entry) => entry.id !== id) };
}

/**
 * The book with one folder's gate thrown.
 *
 * The gate and the entries beneath it stay independent: the schema says a shut
 * folder leaves each entry's own `enabled` *"preserved rather than mutated"*,
 * and [16 §2](../../../../docs/design/16-lorebooks-as-a-format.md) calls that
 * the format's variant switch. A control that also flipped the entries would
 * destroy the thing being switched.
 */
export function withFolderGate(book: Draft, folderId: string, enabled: boolean): Draft {
  return {
    ...book,
    folders: foldersOf(book).map((folder) =>
      folder.id === folderId ? { ...folder, enabled } : folder,
    ),
  };
}

/** True when saving this draft over that base would change something. */
export function bookChanges(base: Draft, draft: Draft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(base);
}

/**
 * The reload-and-reapply merge, for the 412 dialog
 * ([04 §4.4](../../../../docs/design/04-server-multiuser-deployment.md)).
 *
 * **Per entry, keyed on id, and resolved against `pristine`** — the draft as it
 * read when the stale base was loaded. That is finer than the coarse
 * take-one-side-whole that `reapplyEdits` uses for an actor's writing samples,
 * and what lets it be finer is a fact about lorebooks rather than a better idea:
 * an entry id is a uuid, book-local and never reused ([10 §5.2]), so *was this
 * in the book when I opened it* is answerable here.
 *
 * The three cases, each of which wants a different answer and gets one:
 *
 * - **In both** — start from *their* entry and put back only the fields I
 *   actually changed. Taking my whole entry would be the coarse move, and it
 *   would discard their edit to a field I never touched on the very entry we
 *   both had open — which is the failure `reapplyEdits` records having shipped
 *   once already, one object up.
 * - **In mine and not in theirs** — I created it if it was not in `pristine`,
 *   and otherwise they deleted an entry I still hold. The first survives; the
 *   second survives *only if I edited it*, because keeping an untouched copy of
 *   something somebody deleted is undoing their delete rather than saving my
 *   work.
 * - **In theirs and not in mine** — I deleted it *if it was in `pristine`*, and
 *   otherwise they added it while I was editing. Those want opposite outcomes,
 *   and `pristine` is the only thing that tells them apart: without it a merge
 *   either resurrects every deletion or discards every concurrent addition.
 *
 * Order follows the newer object, with anything of mine it does not have
 * appended — so a concurrent insertion is not shuffled to the end of somebody
 * else's book, and an entry rescued from their delete loses its position, which
 * is the cheaper of the two losses.
 *
 * Everything outside `entries` and `folders` takes the newer object's value,
 * which is correct **only while this editor writes nothing else** — the book's
 * own name, description and budgets are read-only at this stage ([05 §11.2d]'s
 * minimum), so there is no edit of mine to those that could be lost here. An
 * editor that gains a writable book-level field gains a line in this function,
 * and that is the coupling to watch.
 */
export function reapplyBookEdits(pristine: Draft, draft: Draft, fresh: Draft): Draft {
  const mine = new Map(entriesOf(draft).map((entry) => [entry.id, entry]));
  const before = new Map(entriesOf(pristine).map((entry) => [entry.id, entry]));
  const theirs = entriesOf(fresh);

  const kept = theirs.flatMap((entry) => {
    const held = mine.get(entry.id);
    // Not in my draft at all: gone because I deleted it, or new because they
    // added it. `pristine` is what distinguishes the two.
    if (held === undefined) return before.has(entry.id) ? [] : [entry];

    const was = before.get(entry.id);
    return [was === undefined ? held : withMyFields(was, held, entry)];
  });

  const seen = new Set(theirs.map((entry) => entry.id));
  const rescued = entriesOf(draft).filter((entry) => {
    if (seen.has(entry.id)) return false;
    const was = before.get(entry.id);
    // Not theirs any more, which is two different situations. I made it, and it
    // stays; or they deleted it, and it stays only if I had changed it — an
    // untouched copy kept here would be undoing their delete rather than saving
    // any work of mine. Spelled as two statements rather than one disjunction
    // because as one it is silently unfalsifiable: `JSON.stringify(undefined)`
    // is `undefined`, so the comparison below is already true for a created
    // entry and the first arm could be deleted with nothing going red.
    if (was === undefined) return true;
    return JSON.stringify(entry) !== JSON.stringify(was);
  });

  return {
    ...fresh,
    entries: [...kept, ...rescued],
    folders: mergedFolders(pristine, draft, fresh),
  };
}

/**
 * Their entry with my changes put back — field by field, so that a field
 * neither of us touched, and a field only they touched, both keep their value.
 *
 * The key set is the union of before and after so that a field I *removed*
 * (which a hand-edited file can have and this editor cannot, yet) is removed
 * here too rather than resurrected from their copy.
 */
function withMyFields(was: LoreEntry, held: LoreEntry, theirs: LoreEntry): LoreEntry {
  const mine = held as unknown as Record<string, unknown>;
  const original = was as unknown as Record<string, unknown>;
  const yours = theirs as unknown as Record<string, unknown>;

  // Built up rather than cloned-and-deleted, so a field I removed is simply
  // never added — and so that key order follows theirs, which the no-op rule
  // depends on: the server's test is byte equality of the serialised object.
  const merged: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(yours), ...Object.keys(mine)])) {
    const changedByMe = JSON.stringify(mine[key]) !== JSON.stringify(original[key]);
    if (changedByMe) {
      if (Object.hasOwn(mine, key)) merged[key] = mine[key];
    } else if (Object.hasOwn(yours, key)) {
      merged[key] = yours[key];
    }
  }

  return merged as unknown as LoreEntry;
}

/**
 * The same three-way question one level up, narrowed to the one field this
 * editor writes.
 *
 * A folder carries a name, a parent and an order that nothing here can change,
 * so taking a whole folder from either side would carry across a rename this
 * editor never made. Only the gate is merged; the rest is the newer object's.
 */
function mergedFolders(pristine: Draft, draft: Draft, fresh: Draft): LoreFolder[] {
  const mine = new Map(foldersOf(draft).map((folder) => [folder.id, folder.enabled]));
  const before = new Map(foldersOf(pristine).map((folder) => [folder.id, folder.enabled]));

  return foldersOf(fresh).map((folder) => {
    const held = mine.get(folder.id);
    if (held === undefined || held === before.get(folder.id)) return folder;
    return { ...folder, enabled: held };
  });
}
