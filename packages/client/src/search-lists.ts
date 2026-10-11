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
 * ***Ids in an address, each kept whole*** — the publish review's `?from=`
 * ([P16.3g](../../../docs/design/workplan/35-p16-world.md)).
 *
 * **Each id percent-encoded before the join, and decoded after the split**
 * (2026-10-11, the P16.3g review). An id is any string — `schema/common.ts`:
 * *ids are not pattern-constrained*, and commit 7e2cf68 kept one with a space
 * at either end byte for byte — so a comma inside one would split it in two,
 * and the review would publish a different object than the one on the page,
 * or a missing one. An ordinary id encodes as itself, so the address stays
 * readable. A part that will not decode (an address edited by hand) is
 * dropped, as this module drops what it cannot read.
 */
export function joinIds(ids: readonly string[]): string {
  return ids.map((id) => encodeURIComponent(id)).join(',');
}

export function splitIds(raw: unknown): string[] {
  return parseList(raw).flatMap((part) => {
    try {
      return [decodeURIComponent(part)];
    } catch {
      return [];
    }
  });
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
