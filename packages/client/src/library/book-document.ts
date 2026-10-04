// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { resolvedFolderId, type Lorebook } from '@storyengine/shared';

/**
 * ***A lorebook as a document*** —
 * [10 §5.3](../../../../docs/design/10-ui-surfaces.md),
 * [11 §3](../../../../docs/design/11-lorebooks-as-a-format.md),
 * [P11.1](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **§12's argument on its second subject**: *"a setting should be readable as a
 * setting, without the machinery"*. The formats are §12.2's unchanged — HTML
 * with a print stylesheet, plus Markdown — which is why this file sits beside
 * [`reading/prose.ts`](../reading/prose.ts) in shape rather than importing it:
 * **the two documents share a format and not a model.** A session is a path
 * through a tree and a book is a collection with folders; one serialiser over
 * both would have a branch in every function.
 *
 * ***The governing rule, which every decision here obeys*** — [11 §3]:
 *
 * > **Raw is a claim about the words, not about the layout.** The reading view
 * > may re-arrange, and it may not re-word.
 *
 * So entries are grouped by folder and ordered, and **not one character of
 * `content` is touched**. An entry whose content is Markdown already stays as it
 * was written; an entry whose content contains a `#` is not escaped into
 * something else, because escaping is re-wording by another name and the person
 * pasting this is pasting *their own corpus*.
 *
 * ***And the fence, which §5.3 calls the whole design***: no search box, no
 * toggles, no collapse handlers — *"if it needs a script it is an application,
 * and the application is StoryEngine."* That fence is held by this being a
 * **string**: a function that produces text has nowhere to put a handler.
 */

/**
 * The activation facts worth printing beside an entry.
 *
 * ***A short list, and the shortness is the point.*** `LoreEntry` has twenty
 * fields and [11 §4](../../../../docs/design/11-lorebooks-as-a-format.md)'s
 * count of *eleven activation fields that ship, validate and round-trip while
 * nothing reads them* is exactly the population a document like this is tempted
 * to dump. What goes in is what answers *why did this fire, or why did it not*
 * without the reader opening the app — which is §5.3's own column test applied
 * one level down.
 */
function firingNotes(entry: Lorebook['entries'][number]): string[] {
  const notes: string[] = [];
  if (!entry.enabled) notes.push('disabled');
  if (entry.constant) notes.push('always active');
  if (entry.probability !== null) notes.push(`fires ${String(entry.probability)}% of the time`);
  if (entry.sticky !== null) notes.push(`stays for ${String(entry.sticky)} messages`);
  if (entry.cooldown !== null) notes.push(`waits ${String(entry.cooldown)} messages between`);
  return notes;
}

/**
 * Entries in the order a reader should meet them: by folder, then as the book
 * stores them.
 *
 * **The book's own order within a folder, never a sort.** [11 §3]'s *may
 * re-arrange* licenses the grouping — a folder is a structure the author made —
 * and an alphabetical sort inside one would be this program having an opinion
 * about an ordering the author already expressed.
 */
function grouped(book: Lorebook): { folder: string | null; entries: Lorebook['entries'] }[] {
  /**
   * ***By the folder the entry actually sits in*** (2026-09-28) —
   * `resolvedFolderId`, the book page's own reading. Keyed on the raw
   * `folderId`, an entry naming a folder the book does not hold made a group of
   * its own with no heading, and so did every unfiled entry that came after a
   * folder — a *New entry* is appended unfiled — so each read as the last
   * folder's. [10 §5.3] asks for *a real **Ungrouped** node, because a nullable
   * field that renders as nothing hides entries*, and this was that.
   */
  const seen = new Map<string | null, Lorebook['entries']>();
  for (const entry of book.entries) {
    const key = resolvedFolderId(book, entry);
    const into = seen.get(key) ?? [];
    into.push(entry);
    seen.set(key, into);
  }
  return [...seen.entries()].map(([key, entries]) => ({ folder: key, entries }));
}

/**
 * ***A folder's name as the page and the copy both say it*** — the word the
 * Ungrouped node goes by, or a folder's own name, or *Untitled folder* for one
 * with none. Moved here from the book page (2026-09-28), which imports it, so
 * the two surfaces cannot drift apart on three words.
 */
export function folderName(book: Lorebook, id: string | null): string {
  if (id === null) return 'Ungrouped';
  const found = book.folders.find((candidate) => candidate.id === id);
  return found === undefined || found.name === '' ? 'Untitled folder' : found.name;
}

/**
 * The book as Markdown — what somebody pastes elsewhere.
 *
 * *Headings rather than a table*, because an entry's content is prose of
 * arbitrary length and a table cell is the one container that cannot hold it.
 */
export function bookToMarkdown(book: Lorebook): string {
  const parts: string[] = [`# ${book.name}`];
  if (book.description.trim() !== '') parts.push(book.description);

  const groups = grouped(book);
  // A flat book stays flat: the Ungrouped heading is only a heading beside
  // others, where leaving it off would file its entries under the last one.
  const foldered = groups.some((group) => group.folder !== null);
  for (const group of groups) {
    if (foldered) parts.push(`## ${folderName(book, group.folder)}`);
    for (const entry of group.entries) {
      parts.push(`### ${entry.name}`);
      if (entry.keys.length > 0) parts.push(`*Keys: ${entry.keys.join(', ')}*`);
      const notes = firingNotes(entry);
      if (notes.length > 0) parts.push(`*${notes.join('; ')}*`);
      if (entry.content.trim() !== '') parts.push(entry.content);
    }
  }
  return `${parts.join('\n\n')}\n`;
}
