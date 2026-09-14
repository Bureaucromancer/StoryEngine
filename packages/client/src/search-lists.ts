// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { isLibraryKind, LIBRARY_KINDS, type LibraryKind } from './api.js';

/**
 * Reading a comma-joined selection out of a search param — the Library's
 * `?kind=` and Play's `?mode=`, both written by `SelectorBar`.
 *
 * **Its own module rather than `router.tsx`**, because both the router (to
 * normalise an address on the way in) and the pages (to read it back) need
 * these, and a page importing the router that imports the page is a cycle
 * that works until the day module order changes.
 */

/** Split, de-duplicated, empty entries gone. The one tokeniser for both lists. */
export function parseList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return [...new Set(raw.split(',').filter((part) => part !== ''))];
}

/**
 * The kinds an address names, in `LIBRARY_KINDS` order.
 *
 * **Unknown entries are dropped one by one**, so `?kind=actors,widgets` is the
 * actors panel rather than the whole library: the entry that still means
 * something keeps meaning it. Every kind named is the whole library by another
 * name and reads as `[]`, which is how `toggleSelection` spells it too.
 */
export function parseKinds(raw: unknown): LibraryKind[] {
  const named = new Set(parseList(raw).filter(isLibraryKind));
  const kinds = LIBRARY_KINDS.filter((kind) => named.has(kind));
  return kinds.length === LIBRARY_KINDS.length ? [] : kinds;
}
