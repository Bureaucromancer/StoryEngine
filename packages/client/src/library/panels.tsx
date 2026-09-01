// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

import { kindOfSchema, type LibraryKind, type LibraryObject } from '../api.js';
import { formatCount, formatTimestamp, timestampsOf } from '../format.js';
import { Badge } from '../ui/Badge.js';
import { KIND_LABELS, SourceBadge } from './labels.js';

/**
 * What each kind's panel supplies, which is
 * [polish §4](../../../../docs/design/workplan/09-polish.md)'s rule stated as a
 * type: *one list component, one set of badges, filters, sorting and actions,
 * one detail route. What each panel supplies is its columns, its sort and its
 * empty state.*
 *
 * **This is the first of that item's six, and it is here rather than there
 * because one kind's panel is a correction rather than a preference.**
 * [05 §5.3](../../../../docs/design/05-ui-surfaces.md) settles the Lorebooks
 * columns in the design, on the grounds that a lorebook is the only library kind
 * whose object is a collection — so a surface addressing only the container is
 * off by one level for this kind and no other. The other five are still that
 * item's to choose, and until it makes those choices they share the panel the
 * merged list already had.
 *
 * **The test for a column is §5.3's**: does it answer a question you would
 * otherwise have to open the book to answer? That is what admits an entry count
 * and refuses `tokenBudget`, `scanDepth`, `entryLimit` and `recursiveScanning` —
 * tuning, which belongs on the book's own page, where §5's *near-raw*
 * commitment already puts it.
 */

export interface PanelColumn {
  /** Stable, and never the header: nothing branches on a displayed string. */
  id: string;
  header: string;
  cell: (object: LibraryObject, locale: string | undefined) => ReactNode;
  /** A count. Right-aligned and tabular, so a column of them compares by eye. */
  numeric?: boolean;
}

export interface PanelSort {
  id: string;
  label: string;
  compare: (a: LibraryObject, b: LibraryObject) => number;
}

export interface KindPanel {
  /**
   * The columns **after** the name, which the table owns.
   *
   * Not a stylistic split: the name cell carries the link, and the link carries
   * the shadowed-copy discriminator that decides *which* of two files with one
   * id is opened. A panel that supplied its own name cell would be a panel
   * building its own links from `{kind, id}`, which is F19 and which
   * [polish §4] names as the way to reintroduce it.
   */
  columns: PanelColumn[];
  /** Empty where a kind has expressed no opinion — the list keeps disk order. */
  sorts: PanelSort[];
  /** What an empty shelf says. Per kind, because the way in differs by kind. */
  empty: string;
}

/** Reads a field off an object whose shape this build may not fully know. */
function field(object: LibraryObject, key: string): unknown {
  return object.object[key];
}

function entryCount(object: LibraryObject): number {
  const entries = field(object, 'entries');
  return Array.isArray(entries) ? entries.length : 0;
}

function tagsOf(object: LibraryObject): string[] {
  const tags = field(object, 'tags');
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [];
}

function updatedAt(object: LibraryObject): string | null {
  return timestampsOf(object.object).updatedAt;
}

/**
 * The name cell, which every panel shares and each may add badges to.
 *
 * The link is deliberately not built here from `{kind, id}` alone — see
 * `ObjectTable`, which owns it, because a panel that builds its own links
 * reintroduces F19 and [polish §4] says so by name.
 */
function nameBadges(object: LibraryObject): JSX.Element {
  const enabled = field(object, 'enabled');
  const scope = field(object, 'scope');
  const linked =
    typeof scope === 'object' && scope !== null && (scope as { kind?: unknown }).kind === 'linked';

  return (
    <>
      {/*
       * **Off is badged and on is not**, and the asymmetry is the point.
       * §5.3 calls a disabled book that renders identically to an enabled one
       * "the *my lorebook never fires* diagnosis arriving one surface too
       * late", so the state that costs somebody an afternoon is the one that
       * gets a badge. A badge on every enabled book would say nothing and
       * would make the one that matters harder to see.
       *
       * Neutral rather than danger: switching a book off is a thing an author
       * does on purpose, and colouring it as a fault would be the surface
       * arguing with them. §5.3 asks for text first and colour second, and the
       * word is what carries it.
       */}
      {enabled === false ? <Badge title="This book is switched off.">Off</Badge> : null}
      {/*
       * Scope is badged only when it is not `global`, for the same reason:
       * global is the default, almost every imported book is one, and a badge
       * that appears on everything is furniture.
       */}
      {linked ? <Badge title="Active only for the actors it links.">Linked</Badge> : null}
    </>
  );
}

/** The columns every panel has had since P1.6, for the five with no opinion. */
const GENERIC: KindPanel = {
  columns: [
    {
      id: 'kind',
      header: 'Kind',
      cell: (object) => {
        const kind = kindOfSchema(object.schema);
        return kind === null ? object.schema : KIND_LABELS[kind];
      },
    },
    { id: 'source', header: 'Source', cell: (object) => <SourceBadge source={object.source} /> },
  ],
  sorts: [],
  empty:
    'The library is empty. Import from SillyTavern or Marinara above, name an actor to make one, or create the other kinds through the API — anything dropped into the data directory appears here too.',
};

/**
 * Lorebooks — [05 §5.3](../../../../docs/design/05-ui-surfaces.md)'s table.
 *
 * `tags` gets its documented consumer at last: [10 §5] has called it *"what the
 * library's filters read"* since it was written, and nothing has ever read it.
 * The entry count earns its place because the generic table cannot tell a
 * three-entry book from a three-hundred-entry one, and almost everything a
 * person decides about a book depends on which of those it is.
 */
const LOREBOOKS: KindPanel = {
  columns: [
    {
      id: 'entries',
      header: 'Entries',
      numeric: true,
      cell: (object, locale) => formatCount(entryCount(object), locale),
    },
    { id: 'tags', header: 'Tags', cell: (object) => tagsOf(object).join(', ') },
    { id: 'source', header: 'Source', cell: (object) => <SourceBadge source={object.source} /> },
    {
      id: 'updated',
      header: 'Updated',
      cell: (object, locale) => {
        const stamp = updatedAt(object);
        return stamp === null ? null : formatTimestamp(stamp, locale);
      },
    },
  ],
  sorts: [
    { id: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
    {
      id: 'updated',
      label: 'Recently updated',
      // Newest first, and an object with no stamp sorts last rather than first:
      // "never updated" is not "updated a long time ago".
      compare: (a, b) => (updatedAt(b) ?? '').localeCompare(updatedAt(a) ?? ''),
    },
    { id: 'entries', label: 'Entry count', compare: (a, b) => entryCount(b) - entryCount(a) },
  ],
  empty:
    'No lorebooks yet. Import brings them in — from a SillyTavern or Marinara folder, an archive, or a single world-info file.',
};

/** The panel for a kind, or the shared one for a kind that has not chosen. */
export function panelFor(kind: LibraryKind | undefined): KindPanel {
  return kind === 'lorebooks' ? LOREBOOKS : GENERIC;
}

/** The badges a panel adds inside the shared name cell. */
export function panelNameBadges(
  kind: LibraryKind | undefined,
  object: LibraryObject,
): JSX.Element | null {
  return kind === 'lorebooks' ? nameBadges(object) : null;
}

/**
 * The sentence for an empty shelf.
 *
 * The unfiltered list keeps the one it has had since P4.4 — an empty library is
 * overwhelmingly a pre-import state, so import leads and the blank page follows.
 * A filtered one that has no panel of its own keeps the generic sentence rather
 * than inheriting the unfiltered list's, which names ways in that are not this
 * kind's.
 */
export function emptyMessage(kind: LibraryKind | undefined): string {
  if (kind === undefined) return GENERIC.empty;
  if (kind === 'lorebooks') return LOREBOOKS.empty;
  return 'There is nothing of this kind in the library yet. An import may bring some.';
}
