// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

/**
 * Schema versioning for the index itself.
 *
 * **The index is derived and disposable, and that changes what a migration is.**
 * [21 §5](../../../../docs/design/21-internal-contracts.md) states the property plainly —
 * deleting `index.sqlite` costs time and nothing else — so when this schema
 * changes, the correct response is to throw the old one away and rescan rather
 * than to hand-write a migration.
 *
 * That is not laziness dressed up. A migration exists to preserve facts that
 * exist nowhere else; every fact in here is a restatement of something on disk
 * ([03 §5.1](../../../../docs/design/03-data-model.md)), so preserving it buys nothing and
 * costs a hand-written script per change that has to be correct forever. The
 * one thing this must never become is a place where a migration is *required*,
 * because that would mean the index had stopped being derived.
 *
 * The cost is honest and bounded: a schema bump makes the next start rescan the
 * library. At household scale that is seconds, and the rescan is the same code
 * path the startup rebuild option already uses.
 */

/**
 * Bump on any change below. There is no compatibility window, by design.
 *
 * **4 is not a change of shape but of what `path` contains** — F26. The column
 * has always held the native absolute path; it now holds the *real* one, so an
 * index written under a link, a different casing, or an 8.3 alias holds keys
 * nothing will match again. Those rows never expire on their own: the watcher
 * tombstones on `unlink` and nothing was unlinked, so ingest inserts a second
 * row under the new spelling and `resolveDuplicates` shadows one of each pair —
 * a library with no duplicates reporting every object twice. One rescan, seconds
 * at household scale, is what the bump buys.
 *
 * **5 renames the `scope` column to `owner`**, along with the three indexes
 * built over it. Pure vocabulary: `scope` meant tenancy here and *where a
 * lorebook applies* in the portable schemas, and one word for two axes was a
 * trap worth spending a rescan on. The index is derived, so the rename needs no
 * migration — only this bump.
 *
 * **6 adds the lore-entry pair** ([10 §14.5](../../../../docs/design/10-ui-surfaces.md)).
 * A genuine addition rather than a correction — nothing indexed before is
 * indexed differently — but *"it would just be missing some rows"* is the wrong
 * reading of what skipping the bump would cost, and the right one is sharper.
 * `migrate` returns early when the version already matches and never reaches
 * the schema, so an index left at 5 does not have an empty `lore_entry_fts`: it
 * has **no such table**. The first search would raise that from SQLite into the
 * route's blanket catch, which answers *"that search query could not be
 * parsed"* — a missing table reported to the user as a mistake in their own
 * typing, on every search, forever.
 *
 * **9 is 4's shape again: not a change of shape but of what is *derived*.**
 * `referencesIn` learned to read `hooks[].involves[]` and
 * `hooks[].introduces.actor` on a Treatment and a Setup, and `LOREBOOK_SCHEMA`
 * gained a real arm instead of returning `[]` — so `object_link` now holds
 * edges it did not hold before, from the same files. No table changed, which is
 * exactly why the bump has to be deliberate: `migrate` returns
 * `rebuildRequired: false` whenever `user_version` already matches, the watcher
 * starts with `ignoreInitial: true`, and nothing re-ingests a file that has not
 * changed. Without the bump an upgraded install would show *Used by* — and
 * [03 §10.1](../../../../docs/design/03-data-model.md)'s count-before-you-delete
 * — as **zero** for an actor a hook names, indefinitely, until somebody happened
 * to save the object for an unrelated reason. The index is derived and
 * disposable by design, so one rescan is the whole cost.
 */
export const INDEX_SCHEMA_VERSION = 9;

/**
 * `user_version` is a 32-bit integer SQLite stores in the database header for
 * exactly this. No table, no bootstrap problem, no chicken and egg.
 */
function readVersion(db: DatabaseSync): number {
  const row = db.prepare('pragma user_version').get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

function writeVersion(db: DatabaseSync, version: number): void {
  // Pragmas do not take bound parameters, and the value is a module constant
  // rather than anything a caller supplies.
  db.exec(`pragma user_version = ${String(version)}`);
}

const SCHEMA = `
-- ── The library index ────────────────────────────────────────────────────────
--
-- One row per portable object found on disk.
--
-- The primary key is the PATH, not the id. That is forced by
-- [P1 §1.2](../../../../docs/design/workplan/07-p1-implementation.md): folders are copy-pasteable, so
-- the same uuid legitimately appears in two places, and a schema that made id
-- unique would have to refuse one of them — punishing a user for using the
-- filesystem the way the design explicitly invites.
create table object (
  path          text primary key,
  id            text not null,
  owner         text not null,
  schema_id     text not null,
  slug          text not null,
  name          text not null,
  content_hash  text not null,
  mtime_ms      real not null,
  size          integer not null,

  -- The object as it was read. The index stays derived — this is a cache of the
  -- file, not a second home for it — and it is what makes a list query one
  -- statement instead of N file reads.
  body          text not null,

  -- [P1 §1.2] Lexicographically later duplicate of an id held elsewhere. Shown
  -- with a warning rather than hidden, and nothing blocks.
  shadowed      integer not null default 0,

  -- [P1 §1.1] An unlink tombstones rather than deletes, so that an add carrying
  -- the same uuid can be recognised as a move. Null for a live row.
  tombstoned_at real
) strict;

create index object_by_id on object(id);
create index object_by_owner_kind on object(owner, schema_id);
create index object_tombstoned on object(tombstoned_at) where tombstoned_at is not null;

-- Search across cards, entries and turn text ([19 §7](../../../../docs/design/19-tech-stack.md)).
-- Not an external-content table: keeping it standalone costs a little space and
-- removes a whole class of desynchronisation bug, which is the right trade for a
-- store that can be rebuilt whenever it is doubted.
create virtual table object_fts using fts5(
  path unindexed,
  name,
  body,
  tokenize = 'unicode61'
);

-- ── Lore entries ─────────────────────────────────────────────────────────────
--
-- [10 §14.5](../../../../docs/design/10-ui-surfaces.md) states the rule that
-- allows this table and bounds it: **a fragment is indexable when it has an
-- address.** LoreEntry.id is that address — it is what turns a hit inside a
-- three-hundred-entry book into a link rather than a place to start hunting —
-- and its absence is why an actor's greetings and a preset's block text get no
-- table of their own. The tidier-sounding alternative, indexing text-bearing
-- leaves wherever they occur, produces anonymous fragments that cannot be
-- labelled, navigated to, or told apart from their neighbours.
--
-- **Keyed by (path, position), and entry_id is deliberately not in the
-- key.** An entry id is unique within a book as a *format* rule
-- ([04 §5.2](../../../../docs/design/04-schemas.md)) and nothing enforces it:
-- Id carries no uniqueness constraint, validate does not walk the array
-- looking for collisions, and both importers derive one as
-- stableId('entry', name, content) — so two byte-identical entries in one
-- hand-maintained world file produce one id twice. Under a (path, entry_id)
-- key that book raises a constraint violation *inside* ingestFile's
-- transaction, which rolls the whole upsert back: a file that is on disk, valid
-- against its schema, and invisible to the library, with no file_error row to
-- explain it. The array index cannot collide, is read identically by both
-- producers because both producers are the same function, and degrades the
-- duplicate to *two rows whose links land on the same entry* — which is the
-- direction this codebase takes everywhere else.
--
-- Standalone rather than content=, for the reason object_fts gives above.
-- No foreign key onto object(path) either: a cascade would take the locator
-- rows and could not take the FTS rows, and half a pair cascading is exactly
-- the divergence the one-helper rule in ingest.ts exists to prevent.
create table lore_entry (
  path      text not null,
  position  integer not null,
  entry_id  text not null,
  name      text not null,

  primary key (path, position)
) strict;

-- The five fields [10 §5.3](../../../../docs/design/10-ui-surfaces.md) names,
-- in the order it names them — which is also the list the book page's own
-- within-book box already searches. Two surfaces disagreeing about which
-- entries answer one query is the failure [P3 §5] recorded for JSON viewers,
-- and this is the cheapest place to not repeat it.
create virtual table lore_entry_fts using fts5(
  path unindexed,
  position unindexed,
  name,
  keys,
  secondary_keys,
  description,
  content,
  tokenize = 'unicode61'
);

-- ── Sessions ─────────────────────────────────────────────────────────────────
--
-- The hot path for a session list, and the only thing that gives a turn a
-- *owner*: search has to be scoped like every other read
-- ([09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md)), and a turn row knows
-- its session rather than its owner.
--
-- Derived like everything else here: the session file on disk is the truth, and
-- deleting this database costs a rescan.
create table session (
  session_id    text primary key,
  owner         text not null,
  name          text not null,
  head_turn_id  text,
  -- Archived sessions stay indexed. They are hidden from the default list, not
  -- gone ([03 §10.3](../../../../docs/design/03-data-model.md)) — and a search that could not
  -- find them would make archiving a way to lose things.
  archived      integer not null default 0,
  updated_at    text not null
) strict;

create index session_by_owner on session(owner, updated_at);

-- ── Turn text ────────────────────────────────────────────────────────────────
--
-- [19 §7.1](../../../../docs/design/19-tech-stack.md) makes three requirements that are
-- cheap here and awkward later — turn text is indexed on write rather than
-- lazily, the row stores turn and session ids rather than an offset into a
-- rendered transcript, and records off the current path stay indexed so a hit
-- can be labelled rather than hidden ([07 §7](../../../../docs/design/07-branching.md)).
--
-- **There is no branch column, and [P6.1] removed the one that was here.** It
-- was written null by both call sites from P4 until then, and the reason is not
-- that nobody got round to filling it: under [07 §3]'s model a turn is not *on*
-- a branch. There is no Branch entity owning turns — a turn is on every path
-- that passes through it, and a BranchRef is a name bookmarking a node. So the
-- column was unpopulatable in principle rather than merely unpopulated, and it
-- was named for the model that section explicitly discarded.
--
-- **Labelling a hit is therefore a question about the reader**, not a fact
-- about the row: *is this turn on the head I am looking at* is answered at
-- query time against that head's path. [07 §3] notes the index may materialise
-- paths to make that fast, and [P6.1] settled the shape without building it —
-- as a string it is quadratic in depth, so a session eight hundred turns long
-- would store megabytes of repeated ancestry. If [P6.3]'s labelled search wants
-- it, the cheap forms are a parent link walked by a recursive query, or a path
-- materialised for the head alone.
create table turn (
  turn_id     text primary key,
  session_id  text not null,
  segment     text not null,
  offset      integer not null
) strict;


create index turn_by_session on turn(session_id);

create virtual table turn_fts using fts5(
  turn_id unindexed,
  session_id unindexed,
  text,
  tokenize = 'unicode61'
);

-- ── Files that could not be read as objects ──────────────────────────────────
--
-- F20. A file that fails to parse or validate used to be *skipped*: the ingest
-- returned a reason nobody stored, the previous valid row stayed live, and
-- every read went on serving believable stale content. The user had edited
-- their file, seen no error, and been shown the old version — which is the
-- visible-filesystem thesis failing quietly, in the one situation where it most
-- needs not to.
--
-- So the failure gets a row of its own. Keyed by path rather than by id,
-- because a file that will not parse has no id to key by — that is what is
-- wrong with it.
create table file_error (
  path        text primary key,
  owner       text not null,
  schema_id   text not null,
  slug        text not null,
  -- The vocabulary a client can act on, rather than a parser's words.
  reason      text not null,
  -- The parser's words, for a person reading the detail.
  detail      text,
  seen_at     real not null
) strict;

create index file_error_by_owner on file_error(owner, schema_id);

-- ── What points at what ──────────────────────────────────────────────────────
--
-- [03 §10.1](../../../../docs/design/03-data-model.md)'s reference counts and
-- [10 §5.2](../../../../docs/design/10-ui-surfaces.md)'s *Used by* panel, which
-- [P4 §6.6](../../../../docs/design/workplan/16-p4-implementation.md) recorded
-- as **one** debt — *"whichever phase builds that panel pays both"* — and which
-- [P11.7](../../../../docs/design/workplan/28-p11-implementation.md) pays.
--
-- **Derived, like every table here.** A reference is a field in a file on disk;
-- this is that field, denormalised so *who points at me* is a query rather than
-- a scan of every session and every object the account owns. Deleting this
-- database costs a rescan and nothing else.
--
-- **Keyed by the pointing thing rather than by the pointed-at one**, which is
-- what makes maintenance a delete-and-reinsert per file: a session that drops a
-- lorebook has one row fewer, and the producer does not have to know which row
-- it was. The index on \`to_id\` is what makes the read direction fast, and it is
-- the direction every consumer actually asks in.
--
-- \`from_name\` is denormalised on purpose. A *Used by* panel naming twelve
-- sessions has to render twelve names, and a session's name lives in a
-- different table from an object's — so the alternative is two joins and a
-- union for a panel, or one string per row. The staleness window is one write:
-- a rename re-ingests the file that holds the name.
create table object_link (
  -- \`session\`, or the schema id of the object doing the pointing.
  from_kind   text not null,
  from_id     text not null,
  from_name   text not null,
  owner       text not null,
  to_id       text not null,
  primary key (from_kind, from_id, to_id)
) strict;

create index object_link_to on object_link(to_id, owner);
`;

/** Drops everything this module owns, leaving a database it can recreate into. */
function dropAll(db: DatabaseSync): void {
  for (const statement of [
    'drop table if exists object_fts',
    'drop table if exists object',
    'drop table if exists lore_entry_fts',
    'drop table if exists lore_entry',
    'drop table if exists turn_fts',
    'drop table if exists turn',
    'drop table if exists session',
    'drop table if exists file_error',
    'drop table if exists object_link',
  ]) {
    db.exec(statement);
  }
}

export interface MigrationResult {
  /**
   * The version found on disk before anything was done. 0 for a fresh file, and
   * for one whose rebuild never finished ({@link PENDING_VERSION}).
   */
  from: number;
  to: number;
  /**
   * True when the caller must rescan the library to repopulate.
   *
   * Every schema change sets this, including the first creation — an empty
   * index and a stale one are the same situation from the caller's side, and
   * collapsing them means there is only one path to get wrong.
   */
  rebuildRequired: boolean;
}

export function migrate(db: DatabaseSync): MigrationResult {
  const from = readVersion(db);
  if (from === INDEX_SCHEMA_VERSION) {
    return { from, to: from, rebuildRequired: false };
  }

  dropAll(db);
  db.exec(SCHEMA);
  /**
   * ***Created, and not yet derived*** (2026-09-27).
   *
   * This wrote the current version here, before a single row existed, and the
   * rebuild that fills the tables runs later and elsewhere. So a first start
   * that died partway through its scan — killed by the stop timeout during a
   * long first scan, or one unreadable file throwing out of it — came back
   * with a version that said *current* over a fraction of the library. Nothing
   * rebuilds a current index, so it stayed that way: objects missing from
   * lists, search and retrieval, until somebody deleted the file by hand.
   *
   * The version now says what the file holds. {@link PENDING_VERSION} until a
   * rebuild has run to the end ({@link markRebuilt}), and a file opened at
   * that version is dropped and rebuilt again, which is exactly the retry the
   * interrupted scan needed.
   */
  writeVersion(db, PENDING_VERSION);

  return { from, to: INDEX_SCHEMA_VERSION, rebuildRequired: true };
}

/**
 * The version a file holds while its tables exist and their contents have not
 * been derived: a fresh file's own `user_version`, so that a file nobody ever
 * finished and a file nobody ever made are the same case.
 */
export const PENDING_VERSION = 0;

/**
 * Marks the contents as not derived, before anything is emptied — `rebuild`'s
 * first act, so a rebuild asked for by `index.rebuildOnStart` and killed
 * halfway is retried too, rather than leaving the half it got through.
 */
export function markRebuildPending(db: DatabaseSync): void {
  writeVersion(db, PENDING_VERSION);
}

/** Marks the contents as derived from the disk — `rebuild`'s last act. */
export function markRebuilt(db: DatabaseSync): void {
  writeVersion(db, INDEX_SCHEMA_VERSION);
}
