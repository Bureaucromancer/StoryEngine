// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The two things a hand-reorderable list shares, lifted when the second one
 * arrived.
 *
 * They were spelled inline in the lorebook editor, with a comment saying so:
 * *only what a design decision shares is lifted, and a token used once is a
 * second place to look*. That was right while the entry list was the only list
 * anybody could drag. The tag manager ([05 §5](../../../../docs/design/05-tagging.md))
 * is the second, so this is the threshold `useFocusTrap`'s own extraction
 * records — two spellings of a gesture is how one of them ends up with a
 * different drop rule, and the drop rule is the part a person feels.
 *
 * **What is deliberately not here** is the drag wiring itself. Every list needs
 * its own `onDragStart` / `onDragOver` / `onDrop`, because what is being moved
 * and what it is being moved within differ — and a hook that tried to own that
 * would have to be told both, which is most of the code back again with an
 * indirection on top. Shared is the *decision* and the *look*, which is where
 * two lists actually agree.
 */

/**
 * Which edge of the row at `at` a row dragged from `from` lands on.
 *
 * Dropping on a row above puts the moved row in front of it; dropping on one
 * below puts it behind — the rule every list with this gesture uses, and the
 * only one where the row ends up where the pointer left it. It is decided by
 * where the drag *came from* and not by where in the row the pointer is: a row
 * one line tall has no room for two targets, and an edge that flipped as the
 * pointer crossed the middle would be a decision made by a tremor.
 *
 * One function for the drop and for the line drawn before it, so the two cannot
 * disagree: a change to this comparison moves the line and the drop together,
 * and the tests are written against the line because the line is the promise
 * the drop then has to keep.
 */
export function landing(from: number, at: number): 'before' | 'after' {
  return from > at ? 'before' : 'after';
}

/**
 * The nudge buttons — one row tall, no label text, and the keyboard half of a
 * gesture whose other half is a pointer.
 *
 * They are not a convenience. A list that can only be reordered by dragging is
 * a list somebody using a keyboard cannot reorder at all, which is the whole of
 * [work plan §2.1]'s day-one habit failing in one control.
 */
export const nudge =
  'rounded-control px-1 text-sm text-ink-muted hover:bg-surface-muted disabled:opacity-40';
