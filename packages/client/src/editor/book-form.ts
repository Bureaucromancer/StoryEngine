// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newLoreEntry, type LoreEntry, type LoreFolder, type PlotHook } from '@storyengine/shared';

import { hooksOf } from './hook-form.js';

/**
 * The lorebook editor's edits, as functions over the object
 * ([10 §11.2d](../../../../docs/design/10-ui-surfaces.md),
 * [P5.1](../../../../docs/design/workplan/17-p5-implementation.md)).
 *
 * **The draft is the book, not a projection of it**, and that is the one
 * structural difference from [form.ts](./form.ts) beside it. `ActorForm` exists
 * because an actor's editor owns nearly every field an actor has and each wants
 * its own input state — a number that is mid-typing is not a number. This editor
 * owns six fields out of forty and renders the rest as they are, so a projection
 * would be a forty-field parallel copy of the object built to carry six of them,
 * and every field it forgot would be a field a save silently dropped.
 *
 * Holding the object itself makes [04 §2](../../../../docs/design/04-schemas.md)'s
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

/** The entry this id names, or undefined — ids are book-local ([04 §5.2]). */
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
 * `applyForm` spreads over a writing sample: an entry is an object, [04 §2]'s
 * promise is per-object, and an entry rebuilt from the fields this build knows
 * would strip whatever a newer one wrote into it. The array is copied rather
 * than spliced because a React state update that mutates in place is a render
 * that does not happen.
 */
export function withEntry(book: Draft, id: string, patch: Partial<LoreEntry>): Draft {
  /**
   * **The first match, not every match**, and that is a defence rather than a
   * micro-optimisation. [04 §5.2] says an entry id is unique within its book,
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
 * has nothing to do with reading order ([10 §5.3]); a new entry belongs where
 * the author will look for it, which is where they were.
 */
export function withNewEntry(book: Draft, name: string): { book: Draft; id: string } {
  const entry = newLoreEntry(name);
  return { book: { ...book, entries: [...entriesOf(book), entry] }, id: entry.id };
}

/**
 * The book without that entry — **the first with that id, and only it**.
 *
 * `withEntry`'s defence, extended to the two writes that lacked it
 * ([P13 §0.5](../../../../docs/design/workplan/30-p13-aventuras-import.md)).
 * Ids are not unique in practice, and this used to remove every entry with the
 * id: deleting one of two twins deleted both, on save, and the second had never
 * been on screen — the selection resolves an id to its first match, so the form
 * the person confirmed the removal from was showing the first. Removing the
 * first removes exactly what they were looking at.
 */
export function withoutEntry(book: Draft, id: string): Draft {
  const entries = entriesOf(book);
  const at = entries.findIndex((entry) => entry.id === id);
  if (at < 0) return book;
  return { ...book, entries: [...entries.slice(0, at), ...entries.slice(at + 1)] };
}

/**
 * The book with one folder's gate thrown.
 *
 * The gate and the entries beneath it stay independent: the schema says a shut
 * folder leaves each entry's own `enabled` *"preserved rather than mutated"*,
 * and [11 §2](../../../../docs/design/11-lorebooks-as-a-format.md) calls that
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
 * The book with one entry moved to sit immediately before another — the entry
 * list's reordering gesture ([10 §5.3], [10 §11.2c]).
 *
 * **This moves reading order, and it never touches `order`.** [10 §5.3] is
 * explicit that the list's default order is the file's array order and that
 * `order` is *injection* order — where an activated entry lands in the prompt —
 * and that conflating them *"is the kind of small lie that teaches a false model
 * of what the field means"*. Dragging a row is therefore an edit to the array
 * and to nothing else; an author who wants an entry to arrive earlier in the
 * prompt changes `order` in the form, where it is labelled.
 *
 * **Addressed by the entry it lands before, not by an index**, because the list
 * it is dragged in is filtered — by folder, and by the name box. A position
 * among visible rows is not a position in the array, while *before this entry*
 * is the same fact in both. `null` is the end of the book.
 *
 * A move that changes nothing returns the book **by identity**, so the editor's
 * change test stays false and a drag that landed where it started does not
 * light up Save. That covers dropping a row on itself without a guard of its
 * own: the entry is taken out before the target is looked for, so its own id is
 * never found. A separate check read as a guard and could not fail, which a
 * mutation pass is how you find out.
 */
export function moveEntryBefore(book: Draft, id: string, beforeId: string | null): Draft {
  const entries = entriesOf(book);
  const from = entries.findIndex((entry) => entry.id === id);
  const moving = entries[from];
  if (moving === undefined) return book;

  /**
   * ***Only the first entry with the id comes out*** — [P13 §0.5]. Filtering by
   * id took every twin out and put one back, so dragging one of two entries
   * sharing an id silently deleted the other on save.
   */
  const rest = [...entries.slice(0, from), ...entries.slice(from + 1)];
  const at = beforeId === null ? rest.length : rest.findIndex((entry) => entry.id === beforeId);
  /**
   * A target that does not resolve leaves the book alone rather than appending.
   * The caller named a row it was showing, so an id that is not there is a bug
   * in the caller — and appending would turn that bug into a silent move to the
   * end of a two-hundred-entry book.
   */
  if (at < 0) return book;

  const moved = [...rest.slice(0, at), moving, ...rest.slice(at)];
  // Judged on the whole order: with twins, the entry at the landing index is no
  // longer enough to say the book did not change.
  if (moved.every((entry, index) => entry === entries[index])) return book;
  return { ...book, entries: moved };
}

/**
 * Whether I moved anything, judged on the entries this draft and its pristine
 * copy both hold.
 *
 * Restricted to the shared ids on purpose: an entry I added or deleted changes
 * the sequence without being a *reorder*, and treating that as one would make
 * every ordinary edit claim a position the merge then has to honour.
 */
function reorderedByMe(pristine: Draft, draft: Draft): boolean {
  const mine = entriesOf(draft).map((entry) => entry.id);
  const before = entriesOf(pristine).map((entry) => entry.id);
  const held = new Set(mine);
  const was = new Set(before);
  return (
    JSON.stringify(before.filter((id) => held.has(id))) !==
    JSON.stringify(mine.filter((id) => was.has(id)))
  );
}

/**
 * The merged entries in the order my draft has them, with anything only they
 * have kept at the end.
 *
 * The mirror of the loss the ordinary case takes: their concurrent insertion
 * loses its position instead of my reordering losing all of them. It is the
 * cheaper loss in this direction for the same reason it was in the other — one
 * entry's position against an author's whole arrangement.
 */
function inMyOrder(merged: LoreEntry[], draft: Draft): LoreEntry[] {
  const rank = new Map(entriesOf(draft).map((entry, at) => [entry.id, at] as const));
  const known = merged
    .filter((entry) => rank.has(entry.id))
    .sort((left, right) => (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0));
  return [...known, ...merged.filter((entry) => !rank.has(entry.id))];
}

/**
 * The reload-and-reapply merge, for the 412 dialog
 * ([09 §4.4](../../../../docs/design/09-server-multiuser-deployment.md)).
 *
 * **Per entry, keyed on id, and resolved against `pristine`** — the draft as it
 * read when the stale base was loaded. That is finer than the coarse
 * take-one-side-whole that `reapplyEdits` uses for an actor's writing samples,
 * and what lets it be finer is a fact about lorebooks rather than a better idea:
 * an entry id is a uuid, book-local and never reused ([04 §5.2]), so *was this
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
 * **Unless I reordered, which the entry list can do since drag-and-drop landed.**
 * That sentence above was written when nothing in this editor could change the
 * array, and left alone it would make a reorder the one edit this merge drops
 * without saying so: rearrange forty entries, lose the race, reload-and-reapply,
 * and the arrangement is quietly theirs again. So the sequence gets the same
 * three-way treatment every field gets — `pristine` says whether I moved
 * anything, and if I did, my order wins for the entries I hold and theirs go to
 * the end. That is the mirror of the loss named above, taken in the direction
 * that costs one entry's position rather than an author's whole arrangement.
 *
 * ~~Everything outside `entries` and `folders` takes the newer object's value,
 * which is correct **only while this editor writes nothing else** — the book's
 * own name, description and budgets are read-only at this stage ([10 §11.2d]'s
 * minimum), so there is no edit of mine to those that could be lost here. An
 * editor that gains a writable book-level field gains a line in this function,
 * and that is the coupling to watch.~~
 *
 * ***The coupling it named arrived, and had already arrived when it was
 * written*** ([P7.14]). The book's own **name** has been writable since this
 * editor shipped — the create control owes a rename and §11.2d's minimum does
 * not — so *rename a book, lose the race, reload-and-reapply, and the rename is
 * silently theirs again*. [P7.14]'s retrieval fieldset makes it six more fields
 * rather than one, which is what turned an invisible loss into an obvious one.
 *
 * **So the book's own fields get the three-way treatment every entry field
 * gets**, through the same function: a field I changed from `pristine` is mine,
 * and anything else is theirs. `entries` and `folders` are merged above and are
 * excluded here, because their merge is finer than *did this change*.
 */
export function reapplyBookEdits(pristine: Draft, draft: Draft, fresh: Draft): Draft {
  const merged = mergeKeyed(
    entriesOf(pristine),
    entriesOf(draft),
    entriesOf(fresh),
    (was, held, theirs) => (was === undefined ? held : withMyFields(was, held, theirs)),
  );

  const book: Draft = {
    ...withMyBookFields(pristine, draft, fresh),
    entries: reorderedByMe(pristine, draft) ? inMyOrder(merged, draft) : merged,
    folders: mergedFolders(pristine, draft, fresh),
  };

  const hooks = mergedHooks(pristine, draft, fresh);
  return hooks.length > 0 || keepsHooksKey(pristine, draft, fresh) ? { ...book, hooks } : book;
}

/**
 * Whether the merged book should carry a `hooks` key at all, when the merge
 * produced no hooks.
 *
 * ***`Lorebook.hooks` is optional, so this is a question and not a formality.***
 * An absent key and `"hooks": []` are different claims — *this book carries no
 * hooks* against *this book carries a hook list that is empty* — and 03 §4.1
 * makes hooks-on-lorebooks deliberately secondary, so a book that gains an empty
 * list from **losing a save race** would be a book reclassified by a conflict
 * dialog. `withOptionalHooks` is what keeps the form's own writes out of that,
 * and this is the same rule for the one write the form does not make.
 *
 * **Presence follows the field rule rather than a preference**, which is what
 * makes the three empty-merge cases each come out right. *I emptied the fold*
 * leaves my draft with no key and takes mine, so the key goes. *They emptied it*
 * leaves mine untouched and takes theirs, so it goes too. And a book that
 * arrived carrying an explicit `"hooks": []` that neither of us touched keeps
 * it, because normalising somebody's file on the way through a conflict is not
 * this function's business.
 */
function keepsHooksKey(pristine: Draft, draft: Draft, fresh: Draft): boolean {
  const changedByMe = JSON.stringify(draft['hooks']) !== JSON.stringify(pristine['hooks']);
  return Object.hasOwn(changedByMe ? draft : fresh, 'hooks');
}

/**
 * Their list with mine put back — keyed on `id`, resolved against the list as it
 * read when I opened it.
 *
 * ***What makes the finer unit available is a fact about the items rather than
 * a better idea***: a `LoreEntry` and a `PlotHook` both carry an id that
 * survives a copy, so *was this here when I opened it* is answerable and the
 * three cases can each be given the answer they actually want. The per-item
 * resolution differs between the two callers and nothing else does, so that is
 * the parameter and the walk is shared.
 *
 * - **In both** — `resolve` decides, with `was` for the caller that wants to
 *   know which of us changed what.
 * - **In theirs and not in mine** — I removed it *if it was in `pristine`*, and
 *   otherwise they added it while I was editing. Those want opposite outcomes
 *   and `pristine` is the only thing that tells them apart: without it a merge
 *   either resurrects every deletion or discards every concurrent addition.
 * - **In mine and not in theirs** — I added it, and it stays; or they removed
 *   it, and it stays only if I had edited it, because keeping an untouched copy
 *   of something somebody deleted is undoing their delete rather than saving
 *   any work of mine.
 *
 * Order follows theirs with anything of mine they do not have appended, so a
 * concurrent insertion is not shuffled to the end of somebody else's list and an
 * item rescued from their delete loses its position, which is the cheaper of the
 * two losses. *A caller that also has to keep **my** ordering does that on the
 * result* — `reapplyBookEdits` does, through `inMyOrder`, because the entry list
 * can reorder and a hook list's order is for the person reading it.
 *
 * **One walk rather than two**, which is this repository's own threshold
 * arriving: it was written once for entries and copied for hooks, comment
 * included, and a fix to the `pristine`-distinguishes-delete-from-addition rule
 * would then have had two places to be made and one of them to be forgotten.
 */
export function mergeKeyed<T extends { id: string }>(
  pristine: readonly T[],
  mine: readonly T[],
  theirs: readonly T[],
  resolve: (was: T | undefined, held: T, theirs: T) => T,
): T[] {
  const held = new Map(mine.map((one) => [one.id, one]));
  const before = new Map(pristine.map((one) => [one.id, one]));

  const kept = theirs.flatMap((one) => {
    const ours = held.get(one.id);
    // Not in my draft at all: gone because I deleted it, or new because they
    // added it. `pristine` is what distinguishes the two.
    if (ours === undefined) return before.has(one.id) ? [] : [one];
    return [resolve(before.get(one.id), ours, one)];
  });

  const seen = new Set(theirs.map((one) => one.id));
  const rescued = mine.filter((one) => {
    if (seen.has(one.id)) return false;
    const was = before.get(one.id);
    // Not theirs any more, which is two different situations. I made it, and it
    // stays; or they deleted it, and it stays only if I had changed it — an
    // untouched copy kept here would be undoing their delete rather than saving
    // any work of mine. Spelled as two statements rather than one disjunction
    // because as one it is silently unfalsifiable: `JSON.stringify(undefined)`
    // is `undefined`, so the comparison below is already true for a created
    // item and the first arm could be deleted with nothing going red.
    if (was === undefined) return true;
    return JSON.stringify(one) !== JSON.stringify(was);
  });

  return [...kept, ...rescued];
}

/**
 * Their hooks with mine put back — the same three-way walk, resolved a **whole
 * hook at a time**.
 *
 * ***Here rather than in the page that needed it first, because both 412 merges
 * need it.*** A treatment's and a setup's `hooks` are merged by
 * `descriptorFor`'s `reapply` in [SimpleEditorPage](./SimpleEditorPage.tsx), and
 * a lorebook's by `reapplyBookEdits` above; without a shared one the third
 * carrier kept the coarse field rule it had before it could author hooks at all,
 * so a conflict took one side's **whole list** — mine if I had touched any hook,
 * theirs if I had not — and dropped the other's without a word, inside the
 * dialog whose entire offer is *reapply my edits*.
 *
 * ***The whole hook rather than field by field, which is where this is coarser
 * than the entry merge beside it.*** An entry is forty fields and a book is
 * usually opened to change one of them, so taking a whole entry from one side
 * would discard the other's edit to a field neither of us contested. A hook is
 * eight fields on one card, written and read as a unit, and the case a per-field
 * merge would improve is two people editing *different fields of the same hook*
 * at the same time — one conflict finer than the one this exists to stop.
 * `withMyFields` is right there if that turns out to be worth having.
 */
export function mergedHooks(pristine: Draft, draft: Draft, fresh: Draft): PlotHook[] {
  return mergeKeyed(hooksOf(pristine), hooksOf(draft), hooksOf(fresh), (was, held, theirs) =>
    was !== undefined && JSON.stringify(was) === JSON.stringify(held) ? theirs : held,
  );
}

/**
 * The book's own fields, merged the way an entry's are — [P7.14].
 *
 * **`withMyFields` reused rather than restated**, which is the whole reason this
 * is four lines: the question *did I change this from what I opened* is the same
 * question at both levels, and the answer has the same three cases. The
 * container fields are overwritten by the caller immediately after, so they are
 * stripped here rather than special-cased inside — a merge that ran over
 * `entries` would compare two forty-entry arrays by `JSON.stringify` to produce
 * a value nothing reads.
 *
 * ***`hooks` joined them when the fold that writes them did.*** It is a keyed
 * list like the other two, so *which one did I edit* is answerable for it and
 * the coarse field rule is only a loss: left here, a conflict would silently
 * take one side's whole hook list. The one asymmetry is that the caller writes
 * it back through `withOptionalHooks` rather than as a plain key, because on a
 * lorebook an emptied list and an absent one are different claims and a merge
 * must not be what puts `"hooks": []` on a book.
 */
function withMyBookFields(pristine: Draft, draft: Draft, fresh: Draft): Draft {
  const without = (book: Draft): Draft => {
    const rest: Draft = {};
    for (const [key, value] of Object.entries(book)) {
      if (key !== 'entries' && key !== 'folders' && key !== 'hooks') rest[key] = value;
    }
    return rest;
  };

  return withMyFields(without(pristine), without(draft), without(fresh));
}

/**
 * Their entry with my changes put back — field by field, so that a field
 * neither of us touched, and a field only they touched, both keep their value.
 *
 * The key set is the union of before and after so that a field I *removed*
 * (which a hand-edited file can have and this editor cannot, yet) is removed
 * here too rather than resurrected from their copy.
 */
function withMyFields<T extends object>(was: T, held: T, theirs: T): T {
  const mine = held as Record<string, unknown>;
  const original = was as Record<string, unknown>;
  const yours = theirs as Record<string, unknown>;

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

  return merged as T;
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
