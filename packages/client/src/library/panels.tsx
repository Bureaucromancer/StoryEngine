// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

import { kindOfSchema, LIBRARY_KINDS, type LibraryKind, type LibraryObject } from '../api.js';
import { SESSION_MEMBER_SCHEMA } from '../editor/members-form.js';
import { formatCount, formatTimestamp, timestampsOf } from '../format.js';
import { labels } from '../i18n/catalogue.js';
import { Badge } from '../ui/Badge.js';
import { KIND_LABELS, KIND_PLURALS, KIND_WORDS, SourceBadge } from './labels.js';

/**
 * What each kind's panel supplies, which is
 * [polish §4](../../../../docs/design/workplan/06-polish.md)'s rule stated as a
 * type: *one list component, one set of badges, filters, sorting and actions,
 * one detail route. What each panel supplies is its columns, its sort and its
 * empty state.*
 *
 * **This is the first of that item's six, and it is here rather than there
 * because one kind's panel is a correction rather than a preference.**
 * [10 §5.3](../../../../docs/design/10-ui-surfaces.md) settles the Lorebooks
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
  /**
   * `hidden` is the case-folded names the registry says to keep off cards.
   * Passed rather than looked up, because a column that fetched the registry
   * would be a column that could be pending.
   */
  cell: (
    object: LibraryObject,
    locale: string | undefined,
    hidden?: ReadonlySet<string>,
  ) => ReactNode;
  /** A count. Right-aligned and tabular, so a column of them compares by eye. */
  numeric?: boolean;
}

export interface PanelSort {
  id: string;
  label: string;
  compare: (a: LibraryObject, b: LibraryObject) => number;
}

/**
 * One way to narrow the shelf.
 *
 * **The options come from the shelf rather than from a constant**, where the
 * values do — a tag filter offering tags nobody has used is a list of dead ends,
 * and one that misses a tag somebody added yesterday is worse. Where the values
 * are a closed set the schema already fixed (`scope`, `enabled`, `source`) the
 * options are fixed too, because those are worth offering even when every book
 * on the shelf happens to be on one side of them.
 *
 * The empty string is *any*, and it is a value rather than an absence so that
 * the control has something to be set to.
 */
export interface PanelFilter {
  id: string;
  label: string;
  optionsFor: (objects: LibraryObject[]) => readonly (readonly [string, string])[];
  matches: (object: LibraryObject, value: string) => boolean;
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
  /** Empty where a kind has not chosen any — the shelf is then unnarrowed. */
  filters: PanelFilter[];
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

export function tagsOf(object: LibraryObject): string[] {
  const tags = field(object, 'tags');
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [];
}

/** `global`, `linked`, or whatever a newer build wrote there. */
function scopeKindOf(object: LibraryObject): string | null {
  const scope = field(object, 'scope');
  if (typeof scope !== 'object' || scope === null) return null;
  const kind: unknown = (scope as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : null;
}

/**
 * ***Which of the scope filter's three a book is*** — [P16.2](../../../../docs/design/workplan/35-p16-world.md),
 * [26 §B15](../../../../docs/design/26-open-questions.md).
 *
 * **`linked` split in two at P16.2, because its meaning did.** Until then a
 * `linked` book had been linked *to somebody*: the factory wrote `global` and
 * so did the SillyTavern importer, and `linked` arrived only with actor ids in
 * it — a character's embedded book. 26 §B15's answer, built at P16.2, moves
 * both defaults to `{ kind: 'linked', actorIds: [] }`, so from now on most
 * `linked` books are linked to **nobody** — the narrowest value the union
 * holds, chosen because a field nobody sets should not default to the widest.
 * A filter that kept one *Linked* option would put every new book under it
 * beside the few authored for particular characters, and the one question the
 * option was worth asking — *which books belong to someone?* — would have no
 * answer.
 *
 * **Three values, not two**, and that is the decision: *Global*, *Linked to
 * characters* (`linked` with at least one actor id) and *Linked to nobody*
 * (`linked` with none). Folding *Global* into *Linked to nobody* would be
 * truer to what either does today — neither admits a book anywhere; selection
 * does that ([03 §3.4]) — but the filter's options are the stored values a
 * person can see in *As stored*, and a `global` that answered to *Linked to
 * nobody* would be the shelf and the file disagreeing about one word. A book
 * whose `actorIds` is not a list is counted as linked to nobody: it names no
 * one this build can read. A scope this build does not know matches none of
 * the three, as it always has.
 */
type ScopeShelf = 'global' | 'linked' | 'nobody';

function scopeShelfOf(object: LibraryObject): ScopeShelf | null {
  const kind = scopeKindOf(object);
  if (kind === 'global') return 'global';
  if (kind !== 'linked') return null;
  const actorIds: unknown = (field(object, 'scope') as { actorIds?: unknown }).actorIds;
  return Array.isArray(actorIds) && actorIds.length > 0 ? 'linked' : 'nobody';
}

/**
 * Where the object says it came from — `Provenance.source`, [P8.2].
 *
 * *Read defensively for `scopeKindOf`'s reason*: the client is handed whatever
 * the server read off disk, and a hand-edited file is a supported way to get
 * data in.
 */
export function provenanceSourceOf(object: LibraryObject): string | null {
  const provenance = field(object, 'provenance');
  if (typeof provenance !== 'object' || provenance === null) return null;
  const source: unknown = (provenance as { source?: unknown }).source;
  return typeof source === 'string' ? source : null;
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
  const linked = scopeShelfOf(object) === 'linked';
  const derived = provenanceSourceOf(object) === 'session';

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
       *
       * ***Since [P16.2], only when it names somebody*** — 26 §B15's default
       * moved to `{ kind: 'linked', actorIds: [] }` for every new book and
       * every standalone SillyTavern import, so the same argument now moves
       * the badge: *linked to nobody* is the new default, and badging it would
       * put *Linked* on nearly every book made from here on. The badge is for
       * the one case it ever described — a book authored as belonging to
       * particular characters (`scopeShelfOf`).
       */}
      {/*
       * ***The title said "Active only for the actors it links", which stopped
       * being true at [P6B.1] and stayed on the badge until [P8]'s readiness
       * audit read it* (2026-09-13).** `LoreScope.linked` decided which sessions
       * a book reached until P5.7's scope-based volunteering was reversed —
       * `turns/lore.ts` records why at length, and the short version is that
       * `global` is the factory default *and* the importer's fallback, so every
       * book anybody owned was in every prompt.
       *
       * **So the field now records an authored intent and gates nothing**, and
       * the badge has to say that rather than describe a mechanism: a reader who
       * believes this title will conclude their book is in play when it is not,
       * which is the worst direction for a retrieval claim to be wrong in.
       */}
      {linked ? (
        <Badge title="Authored as belonging to particular actors. A book is in play only if the session or its treatment names it.">
          Linked
        </Badge>
      ) : null}
      {/*
       * ***Derived from play, not written by hand*** —
       * [08 §2](../../../../docs/design/08-cross-session-memory.md), [P8.2].
       *
       * **The badge is half of what [P8 §1.1] priced the storage decision at.**
       * A memory book is an ordinary library lorebook, so it sits on the shelf
       * beside authored ones — and 08 §2 is explicit that it *"must not be
       * treated as authored content… derived, personal, and often full of things
       * you would not hand someone."* With the location gone as a signal, the
       * marking is what is left, and a marking nobody can see is not one.
       *
       * The same asymmetry `Off` argues for: authored is the default and gets no
       * badge, and the state a reader would be surprised by is the one that
       * does. Neutral rather than danger, because a memory book is working
       * correctly — the warning belongs on the way *out*, not on the shelf.
       */}
      {derived ? (
        <Badge title="Written by play rather than by hand. Editing an entry here is expected; a corrected entry is left alone afterwards.">
          Memories
        </Badge>
      ) : null}
    </>
  );
}

/**
 * The two sorts every shelf can answer, whatever kind it holds —
 * [polish §9](../../../../docs/design/workplan/06-polish.md).
 *
 * They exist because the control row is now unconditional: a *Sort by* that
 * appeared on one shelf out of six read as a lorebook feature rather than as
 * the library's. Every object has a name and a `provenance.updatedAt`, so
 * these two are the ones no panel has to opt into.
 *
 * The Lorebooks panel keeps its own list rather than extending this one — it
 * puts entry count in the middle, and a shared array with a per-panel insert
 * would be harder to read than two literals.
 */
const COMMON_SORTS: PanelSort[] = [
  { id: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  {
    id: 'updated',
    label: 'Recently updated',
    // Newest first, and an object with no stamp sorts last rather than first:
    // "never updated" is not "updated a long time ago".
    compare: (a, b) => (updatedAt(b) ?? '').localeCompare(updatedAt(a) ?? ''),
  },
];

/**
 * What a live search reads — [polish §9].
 *
 * **Name and tags, and deliberately not the whole object.** The row shows a
 * name; the tags are what the shelf is organised by and what somebody is most
 * likely to be reaching for when the name will not come. Serialising the object
 * would pull a lorebook's entire entry array into every keystroke's haystack,
 * which is a different feature (finding a *book* by an entry inside it) with a
 * cost — memoising against a list that re-polls every two seconds — and it
 * should be chosen rather than arrived at.
 *
 * The scope is said in the control's own hint, because a search that quietly
 * reads less than a person assumes is one they stop trusting.
 */
export function searchText(object: LibraryObject): string {
  return [object.name, ...tagsOf(object)].join(' ');
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
  sorts: COMMON_SORTS,
  filters: [],
  /*
   * ~~*…or create the other kinds through the API*~~ (2026-10-01, polish 10):
   * every kind has had an editor and a *New* button above since P7B.6, and
   * import has been the *Import…* button rather than a panel *above* since the
   * dock took it (P4 §7.12). The sentence names what is there.
   */
  empty:
    'The library is empty. Make something with a New button above, or use Import… to bring in what you have from SillyTavern, Marinara or Aventuras. Anything dropped into the data directory appears here too.',
};

/**
 * Lorebooks — [10 §5.3](../../../../docs/design/10-ui-surfaces.md)'s table.
 *
 * `tags` gets its documented consumer at last: [04 §5] has called it *"what the
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
    {
      id: 'tags',
      header: 'Tags',
      /**
       * **Hidden tags are not drawn here, and nowhere else is affected** —
       * [05 §5](../../../../docs/design/05-tagging.md). The flag exists to quiet
       * bookkeeping tags (`imported-2026-08`, `wip`) that are worth filtering
       * by and not worth reading on every row. A flag that also hid them from
       * the filter bar would be a second, invisible filter state.
       */
      cell: (object, _locale, hidden) =>
        tagsOf(object)
          .filter((tag) => !(hidden ?? new Set<string>()).has(tag.toLowerCase()))
          .join(', '),
    },
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
  filters: [
    {
      id: 'scope',
      label: 'Scope',
      // `scopeShelfOf` says why there are three since [P16.2].
      optionsFor: () => [
        ['global', 'Global'],
        ['linked', 'Linked to characters'],
        ['nobody', 'Linked to nobody'],
      ],
      matches: (object, value) => scopeShelfOf(object) === value,
    },
    {
      id: 'enabled',
      label: 'Enabled',
      optionsFor: () => [
        ['on', 'On'],
        ['off', 'Off'],
      ],
      matches: (object, value) => (field(object, 'enabled') === false ? 'off' : 'on') === value,
    },
    {
      id: 'source',
      label: 'Source',
      optionsFor: () => [
        ['user', 'Yours'],
        ['system', 'System'],
      ],
      matches: (object, value) => object.source === value,
    },
  ],
  empty:
    'No lorebooks yet. Import brings them in — from a SillyTavern or Marinara folder, an archive, or a single world-info file.',
};

/**
 * A World's member envelopes, read defensively — `scopeKindOf`'s reason: the
 * list row is whatever the server read off disk, and a member whose `schema`
 * is not a string is counted as nothing rather than thrown on.
 */
function membersOfWorld(object: LibraryObject): { schema: string }[] {
  const contents = field(object, 'contents');
  if (!Array.isArray(contents)) return [];
  return contents.filter(
    (member): member is { schema: string } =>
      typeof member === 'object' &&
      member !== null &&
      typeof (member as { schema?: unknown }).schema === 'string',
  );
}

function sessionCount(object: LibraryObject): number {
  return membersOfWorld(object).filter((member) => member.schema === SESSION_MEMBER_SCHEMA).length;
}

/**
 * *What it holds, by kind* — `2 actors · 1 lorebook · 1 treatment`.
 *
 * **Sessions are left out because they have a column of their own**, and the
 * split is [15 §3.2]'s: a World published without its sessions is *the Rain
 * City setting* and with them *my six Rain City sessions*, which are two
 * different answers to *what is this*, and a person scanning the shelf for one
 * should not have to subtract.
 *
 * **Kinds with none are omitted**, and the order is the library's own kind
 * order rather than the counts', so the same kind sits in the same place on
 * every row. A member of a kind this build does not know is counted as
 * *other* rather than dropped: the World carries it verbatim (`world.ts`'s
 * envelope rule), so a line that hid it would undercount the set somebody is
 * about to export.
 *
 * *A string assembled here rather than in JSX* — `UsedBy.tsx`'s `list`
 * reason: the separator and the order are the sentence, and a sentence made of
 * children is one no catalogue can hold.
 */
export function membersLine(object: LibraryObject, locale: string | undefined): string {
  const counts = new Map<LibraryKind, number>();
  let other = 0;
  for (const member of membersOfWorld(object)) {
    if (member.schema === SESSION_MEMBER_SCHEMA) continue;
    const kind = kindOfSchema(member.schema);
    if (kind === null) other += 1;
    else counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = LIBRARY_KINDS.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    if (count === 0) return [];
    return [`${formatCount(count, locale)} ${count === 1 ? KIND_WORDS[kind] : KIND_PLURALS[kind]}`];
  });
  if (other > 0) parts.push(`${formatCount(other, locale)} ${WORLD_WORDS.other}`);
  return parts.join(' · ');
}

/** The words the Worlds panel says that are not a kind's. */
const WORLD_WORDS = labels('library.panel.worlds', {
  other: 'other',
  empty:
    'No worlds yet. A world is a named set of library objects and sessions that you keep together, so new sessions can start in it and it can travel as one file. Make one with New world above, then add its members in its editor — from every kind in your library, and your sessions too.',
});

/**
 * Worlds — [P16.1](../../../../docs/design/workplan/35-p16-world.md): the
 * Package's panel, renamed, and the first that answers what a World *holds*.
 *
 * **The two columns are §5.3's test passed by the kind's whole point.** A World
 * is a set, and the generic table showed its name and its kind, which is to
 * say nothing about the set: telling *five characters and a lorebook* from *my
 * six Rain City sessions* meant opening each one. *Members* answers the first,
 * *Sessions* the second, and they are two columns rather than one line for
 * [15 §3.2]'s reason, which `membersLine` gives.
 *
 * ***Most members* counts everything the World names**, sessions included and
 * missing members included — it sorts by the size of the set as written, which
 * is what an export would try to carry, rather than by what this library still
 * happens to hold.
 *
 * **The empty sentence is for somebody who never saw Packages** (AA10): what a
 * world is, in one clause, and how to make one, in the next. ~~*It does not
 * promise starting a session in one* — that is [P16.2]'s, not built yet, and a
 * shelf that invited it would be the blurb's mistake one surface over
 * (`kinds.tsx` has the argument).~~ ***It does since [P16.2]***, which built
 * the start — from the World's page and as a choice on the session form — so
 * the clause the struck sentence held back is now true and said. *Travel as
 * one file* was already true: the World's page exports it.
 */
const WORLDS: KindPanel = {
  columns: [
    { id: 'members', header: 'Members', cell: (object, locale) => membersLine(object, locale) },
    {
      id: 'sessions',
      header: 'Sessions',
      numeric: true,
      cell: (object, locale) => formatCount(sessionCount(object), locale),
    },
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
    ...COMMON_SORTS,
    {
      id: 'members',
      label: 'Most members',
      compare: (a, b) => membersOfWorld(b).length - membersOfWorld(a).length,
    },
  ],
  filters: [],
  get empty() {
    // A getter, so the catalogue is read when the shelf is drawn rather than
    // frozen into English when this module loads (`catalogue.test.ts`'s third
    // caveat).
    return WORLD_WORDS.empty;
  },
};

/** The panel for a kind, or the shared one for a kind that has not chosen. */
export function panelFor(kind: LibraryKind | undefined): KindPanel {
  if (kind === 'lorebooks') return LOREBOOKS;
  if (kind === 'worlds') return WORLDS;
  return GENERIC;
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
  if (kind === 'worlds') return WORLDS.empty;
  return 'There is nothing of this kind in the library yet. Make one above, or import some.';
}
