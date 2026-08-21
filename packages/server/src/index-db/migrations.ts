// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

/**
 * Schema versioning for the index itself.
 *
 * **The index is derived and disposable, and that changes what a migration is.**
 * [13 §5](../../../../docs/design/13-internal-contracts.md) states the property plainly —
 * deleting `index.sqlite` costs time and nothing else — so when this schema
 * changes, the correct response is to throw the old one away and rescan rather
 * than to hand-write a migration.
 *
 * That is not laziness dressed up. A migration exists to preserve facts that
 * exist nowhere else; every fact in here is a restatement of something on disk
 * ([02 §5.1](../../../../docs/design/02-data-model.md)), so preserving it buys nothing and
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
 */
export const INDEX_SCHEMA_VERSION = 4;

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
-- [P1 §1.2](../../../../docs/design/workplan/03-p1-implementation.md): folders are copy-pasteable, so
-- the same uuid legitimately appears in two places, and a schema that made id
-- unique would have to refuse one of them — punishing a user for using the
-- filesystem the way the design explicitly invites.
create table object (
  path          text primary key,
  id            text not null,
  scope         text not null,
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
create index object_by_scope_kind on object(scope, schema_id);
create index object_tombstoned on object(tombstoned_at) where tombstoned_at is not null;

-- Search across cards, entries and turn text ([07 §7](../../../../docs/design/07-tech-stack.md)).
-- Not an external-content table: keeping it standalone costs a little space and
-- removes a whole class of desynchronisation bug, which is the right trade for a
-- store that can be rebuilt whenever it is doubted.
create virtual table object_fts using fts5(
  path unindexed,
  name,
  body,
  tokenize = 'unicode61'
);

-- ── Sessions ─────────────────────────────────────────────────────────────────
--
-- The hot path for a session list, and the only thing that gives a turn a
-- *scope*: search has to be scoped like every other read
-- ([04 §4.3](../../../../docs/design/04-server-multiuser-deployment.md)), and a turn row knows
-- its session rather than its owner.
--
-- Derived like everything else here: the session file on disk is the truth, and
-- deleting this database costs a rescan.
create table session (
  session_id    text primary key,
  scope         text not null,
  name          text not null,
  head_turn_id  text,
  -- Archived sessions stay indexed. They are hidden from the default list, not
  -- gone ([02 §10.3](../../../../docs/design/02-data-model.md)) — and a search that could not
  -- find them would make archiving a way to lose things.
  archived      integer not null default 0,
  updated_at    text not null
) strict;

create index session_by_scope on session(scope, updated_at);

-- ── Turn text ────────────────────────────────────────────────────────────────
--
-- [07 §7.1](../../../../docs/design/07-tech-stack.md) makes three requirements that are
-- cheap here and awkward later — turn text is indexed on write rather than
-- lazily, the row stores turn and session ids rather than an offset into a
-- rendered transcript, and records off the current path stay indexed but carry
-- their branch so a hit can be labelled rather than hidden
-- ([09 §7](../../../../docs/design/09-branching.md)).
create table turn (
  turn_id     text primary key,
  session_id  text not null,
  branch_id   text,
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
  scope       text not null,
  schema_id   text not null,
  slug        text not null,
  -- The vocabulary a client can act on, rather than a parser's words.
  reason      text not null,
  -- The parser's words, for a person reading the detail.
  detail      text,
  seen_at     real not null
) strict;

create index file_error_by_scope on file_error(scope, schema_id);
`;

/** Drops everything this module owns, leaving a database it can recreate into. */
function dropAll(db: DatabaseSync): void {
  for (const statement of [
    'drop table if exists object_fts',
    'drop table if exists object',
    'drop table if exists turn_fts',
    'drop table if exists turn',
    'drop table if exists session',
    'drop table if exists file_error',
  ]) {
    db.exec(statement);
  }
}

export interface MigrationResult {
  /** The version found on disk before anything was done. 0 for a fresh file. */
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
  writeVersion(db, INDEX_SCHEMA_VERSION);

  return { from, to: INDEX_SCHEMA_VERSION, rebuildRequired: true };
}
