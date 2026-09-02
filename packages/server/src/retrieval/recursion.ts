// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Lorebook, LoreEntry } from '@storyengine/shared';

/**
 * The three recursion flags and the two book-level limits, as predicates.
 *
 * **Recursion is a loop and this is not it.** An activated entry's text is
 * re-scanned, which can activate more, up to the book's depth limit — that loop
 * belongs to P5.6's retrieval step, because only a step may propose the effects
 * the result becomes ([P5 §1.3]). What lives here is the part that decides
 * *whether a given entry takes part in a given pass*, which is where the three
 * flags interact and therefore where they get tested.
 *
 * The flags read as a set of similar-sounding switches and are not:
 *
 * - `preventRecursion` — **my content triggers nothing further.** An outbound
 *   rule: this entry's text does not go into the next pass's haystack.
 * - `excludeRecursion` — **I cannot be triggered recursively.** An inbound
 *   rule: this entry is not considered at any depth past the first.
 * - `delayUntilRecursion` — **I fire only during recursion.** The inverse
 *   inbound rule: this entry is not considered at the first depth.
 *
 * Two of them are inbound and opposite, which is the interaction worth a name:
 * an entry carrying **both** `excludeRecursion` and `delayUntilRecursion` can
 * never fire at all — barred from the first pass by one and from every later
 * one by the other. That is not a state to repair, because repairing it would
 * mean choosing which of the author's two instructions to ignore. It is a state
 * to be able to *report*, which is why it has its own verdict.
 */

/**
 * Why an entry is or is not in this pass.
 *
 * - `consider` — take part.
 * - `recursion-off` — the book has `recursiveScanning: false`, so there is no
 *   pass past the first for anything.
 * - `depth-exhausted` — past the book's `maxRecursionDepth`.
 * - `excluded-from-recursion` — `excludeRecursion`, at a depth past the first.
 * - `awaiting-recursion` — `delayUntilRecursion`, at the first depth.
 * - `never-fires` — both inbound flags, so no depth admits it.
 */
export type RecursionVerdict =
  | 'consider'
  | 'recursion-off'
  | 'depth-exhausted'
  | 'excluded-from-recursion'
  | 'awaiting-recursion'
  | 'never-fires';

/**
 * Whether this entry takes part in the pass at `depth`, where **zero is the
 * scan over the conversation** and one and up are the recursive passes.
 *
 * `never-fires` is checked first and without reference to the depth, because it
 * is a property of the entry that no pass can satisfy — reporting it as
 * *awaiting recursion* at depth zero would send an author looking for the
 * recursion that never comes.
 */
export function recursionVerdict(
  book: Lorebook,
  entry: LoreEntry,
  depth: number,
): RecursionVerdict {
  if (entry.excludeRecursion && entry.delayUntilRecursion) return 'never-fires';

  if (depth === 0) {
    return entry.delayUntilRecursion ? 'awaiting-recursion' : 'consider';
  }

  // Everything below is a later pass, so the book's own switch comes first: a
  // book with recursion off has no later pass for any entry, whatever the entry
  // asked for. Reported as the book's refusal rather than the entry's, because
  // that is the setting somebody would have to change.
  if (!book.recursiveScanning) return 'recursion-off';
  if (depth > book.maxRecursionDepth) return 'depth-exhausted';
  return entry.excludeRecursion ? 'excluded-from-recursion' : 'consider';
}

/**
 * Whether an activated entry's text is scanned by the next pass.
 *
 * The outbound half, and separate from {@link recursionVerdict} because it is
 * asked about a *different* entry at a different moment: the verdict decides
 * who may be found, this decides who may do the finding. An entry can perfectly
 * well be admitted by one and refused by the other, which is exactly what
 * `preventRecursion` on an otherwise ordinary entry means.
 */
export function feedsRecursion(entry: LoreEntry): boolean {
  return !entry.preventRecursion;
}

/**
 * Whether the loop should run another pass at all.
 *
 * Depth-first rather than count-first: `maxRecursionDepth` bounds how far the
 * chain may go, and a book with recursion off never leaves the first pass.
 * Hoisted out of the loop so that P5.6's step reads as *while there is another
 * pass* rather than as two conditions somebody has to keep in step.
 */
export function mayRecurse(book: Lorebook, nextDepth: number): boolean {
  return book.recursiveScanning && nextDepth >= 1 && nextDepth <= book.maxRecursionDepth;
}
