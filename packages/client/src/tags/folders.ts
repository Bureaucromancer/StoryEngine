// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { folderOf, type TagEntry } from '@storyengine/shared';

import type { TagFilters } from './TagFilterBar.js';

/**
 * Tags used as folders over a shelf — [25 §5](../../../../docs/design/25-tagging.md).
 *
 * **Entering a folder is applying that tag's filter.** Not a second navigation
 * model with its own state and its own way of being wrong — the shelf already
 * has a filter, and a folder row is another control that drives it. That is
 * also what makes leaving one obvious: the tag chip in the bar is showing
 * selected, and clearing it is the way back.
 *
 * `closed` hides its members from the ungrouped list until it is entered;
 * `open` shows them in both places; `none` is an ordinary tag, which is nearly
 * all of them.
 */

export interface FolderRow {
  tag: TagEntry;
  /** Objects on this shelf carrying it, before any filtering. */
  count: number;
  /** Whether the shelf is currently inside it. */
  open: boolean;
}

/**
 * The folder rows this shelf should show, in registry order.
 *
 * **A folder nothing is in is not shown.** It is still a folder, and the manager
 * still says so; a row promising a way into an empty shelf is furniture.
 */
export function folderRows(
  tags: readonly TagEntry[],
  names: readonly string[][],
  filters: TagFilters,
): FolderRow[] {
  const counts = new Map<string, number>();
  for (const held of names) {
    for (const name of new Set(held.map((tag) => tag.toLowerCase()))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return tags
    .filter((tag) => folderOf(tag) !== 'none')
    .map((tag) => ({
      tag,
      count: counts.get(tag.name.toLowerCase()) ?? 0,
      open: filters.get(tag.name.toLowerCase()) === 'selected',
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => a.tag.sortOrder - b.tag.sortOrder);
}

/**
 * Whether a closed folder is keeping this object out of the ungrouped list.
 *
 * **Only `closed` hides anything**, and only while the shelf is outside it.
 * An `open` folder is a way *in* rather than a way of hiding: its members stay
 * where they were, which is the difference the two modes exist to draw.
 *
 * A folder tag that is currently excluded in the bar does not count as entered —
 * excluding a tag is saying *not these*, and answering it by showing exactly
 * those would be the surface arguing with the person using it.
 */
export function insideClosedFolder(
  held: readonly string[],
  tags: readonly TagEntry[],
  filters: TagFilters,
): boolean {
  const names = new Set(held.map((tag) => tag.toLowerCase()));
  return tags.some((tag) => {
    if (folderOf(tag) !== 'closed') return false;
    const key = tag.name.toLowerCase();
    if (!names.has(key)) return false;
    return filters.get(key) !== 'selected';
  });
}
