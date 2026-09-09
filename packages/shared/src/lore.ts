// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Lorebook, LoreEntry, LoreFolder } from './schema/lorebook.js';

/**
 * Why an entry is off — the one computation the reading surface and the
 * retriever must agree about.
 *
 * **It lives here rather than in the client, and that is the whole point.**
 * [P5 §3](../../../docs/design/workplan/17-p5-implementation.md)'s gate step 13
 * asks that where the keyword tester's answer is a gate or a disabled book
 * rather than a match, *it agrees with what the document half already showed*,
 * and P5.7 is told to honour the folder gate in activation "so that the reason
 * P5.0 renders is the reason the engine acts on". A test can compare two
 * implementations; only one implementation cannot disagree with itself.
 *
 * **Folders nest**, which is the part a surface written from the schema's
 * summary would get wrong: `LoreFolder.parentFolderId` means a gate can be
 * inherited from an ancestor several levels up, so `folders.find(f => f.id ===
 * entry.folderId)?.enabled` is not the check. Nor is the chain guaranteed
 * acyclic — these files are hand-edited and imported, and [00 §3.3] says a
 * broken reference degrades rather than throws — so the walk is bounded by the
 * folders it has already seen.
 *
 * **What this does not do is predict.** [P5 §1.6] draws the line the document
 * half may not cross: it renders *configuration*, and only the retriever
 * renders *behaviour*. So `active` here means *nothing switched off is
 * standing in this entry's way* — not *this will fire*, which additionally
 * depends on keys, timing, budget and a turn having happened.
 */

/** The three ways off, outermost first. */
export type GateReason =
  | { kind: 'book-off' }
  | { kind: 'folder-off'; folderId: string; folderName: string }
  | { kind: 'entry-off' };

export interface EntryGate {
  /** True when nothing switched off stands in the way. Never *will fire*. */
  active: boolean;
  /**
   * Every gate that is closed, **outermost first**.
   *
   * A list rather than one reason, because more than one can be shut at once
   * and picking a single winner would make the surface lie in whichever
   * direction it picked. Outermost first because that is the order they have to
   * be cleared in: naming an entry's own `enabled` while the book above it is
   * off sends somebody to flip a switch that changes nothing.
   */
  blockedBy: GateReason[];
}

/**
 * The folder chain above an entry, nearest first, stopping at a cycle.
 *
 * A `folderId` naming a folder that is not in the book is a dangling reference,
 * and it degrades to *no folder* rather than to an error — [00 §3.3]'s posture,
 * and the same one the route takes for an unknown entry address. It is not
 * silently equivalent to `folderId: null`, though: the tree shows such an entry
 * under **Ungrouped**, which is where a reader will notice the field says
 * something the book does not contain.
 */
export function folderChain(book: Lorebook, entry: LoreEntry): LoreFolder[] {
  const byId = new Map(book.folders.map((folder) => [folder.id, folder]));
  const chain: LoreFolder[] = [];
  const seen = new Set<string>();

  let id = entry.folderId;
  while (id !== null && !seen.has(id)) {
    seen.add(id);
    const folder = byId.get(id);
    if (folder === undefined) break;
    chain.push(folder);
    id = folder.parentFolderId;
  }

  return chain;
}

/**
 * Whether anything switched off stands in this entry's way, and what.
 *
 * The folder named is the **outermost** closed one in the chain, for the same
 * reason the list is ordered outermost first: it is the one that has to be
 * opened before any gate below it can matter.
 */
export function entryGate(book: Lorebook, entry: LoreEntry): EntryGate {
  const blockedBy: GateReason[] = [];

  if (!book.enabled) blockedBy.push({ kind: 'book-off' });

  // Nearest first out of `folderChain`, so the last closed one found walking
  // outwards is the outermost.
  const closed = folderChain(book, entry).filter((folder) => !folder.enabled);
  const outermost = closed[closed.length - 1];
  if (outermost !== undefined) {
    blockedBy.push({
      kind: 'folder-off',
      folderId: outermost.id,
      folderName: outermost.name,
    });
  }

  // Last, and read straight off the entry: [04 §5] is explicit that a folder
  // gate leaves this *preserved rather than mutated*, so an entry inside a
  // closed folder still says `enabled: true` here and the fold still shows it.
  if (!entry.enabled) blockedBy.push({ kind: 'entry-off' });

  return { active: blockedBy.length === 0, blockedBy };
}

/**
 * How many of a book's entries are off, for the count beside the book.
 *
 * *214 entries, 31 off* is the shape of a book's variants
 * ([10 §5.3](../../../docs/design/10-ui-surfaces.md)), and it is invisible at
 * every surface that exists without this.
 */
export function offCount(book: Lorebook): number {
  return book.entries.filter((entry) => !entryGate(book, entry).active).length;
}

/**
 * The folder an entry actually sits in, or null.
 *
 * Null covers two different files and deliberately renders as one node: an
 * entry that says `folderId: null`, and an entry whose `folderId` names a
 * folder the book does not contain. [10 §5.3] insists `folderId: null` gets a
 * real **Ungrouped** node rather than being quietly omitted, "because a
 * nullable field that renders as nothing hides entries" — and an entry pointing
 * at a folder that is not there would be hidden by exactly the same omission.
 */
export function resolvedFolderId(book: Lorebook, entry: LoreEntry): string | null {
  if (entry.folderId === null) return null;
  return book.folders.some((folder) => folder.id === entry.folderId) ? entry.folderId : null;
}

/** The entries filed directly in one folder, not counting its descendants. */
export function entriesInFolder(book: Lorebook, folderId: string | null): LoreEntry[] {
  return book.entries.filter((entry) => resolvedFolderId(book, entry) === folderId);
}

/**
 * The entries a folder's gate reaches — itself and everything beneath it.
 *
 * **Which is what *governs* means, and the direct count is the wrong number for
 * the panel that word appears in.** [10 §5.3](../../../docs/design/10-ui-surfaces.md)
 * asks for "each folder with its gate and the number of entries it governs",
 * beside a Gate column — and shutting a folder shuts every entry below it, not
 * only the ones filed in it directly. A parent holding sixty entries and one
 * child folder read as governing sixty when it governs sixty-one, which is the
 * number that changes when somebody flips the switch on that row.
 *
 * The counts therefore do not sum to the book's total, and should not: a nested
 * entry is governed by every gate above it. `Ungrouped` is the exception that
 * proves it, having nothing beneath it to reach.
 *
 * Cycle-safe, like every other walk over this tree.
 */
export function entriesGoverned(book: Lorebook, folderId: string | null): LoreEntry[] {
  if (folderId === null) return entriesInFolder(book, null);

  const reached = new Set<string>([folderId]);
  // Repeated passes rather than recursion: the parent links may be in any
  // order, and a file this build did not write is under no obligation to list a
  // folder after its parent. Each pass either reaches at least one more folder
  // or is the last, so this terminates in at most one pass per folder — and a
  // cycle cannot extend it, because `reached` is a set.
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of book.folders) {
      if (folder.parentFolderId === null || reached.has(folder.id)) continue;
      if (reached.has(folder.parentFolderId)) {
        reached.add(folder.id);
        grew = true;
      }
    }
  }

  return book.entries.filter((entry) => {
    const id = resolvedFolderId(book, entry);
    return id !== null && reached.has(id);
  });
}
