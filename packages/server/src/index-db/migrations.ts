// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

/**
 * Schema versioning for the index itself.
 *
 * **The index is derived and disposable, and that changes what a migration is.**
 * [22 §5](../../../../docs/design/22-internal-contracts.md) states the property plainly —
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
 *
 * **10 adds `session_stamp`** (2026-09-27), which the start-up consistency
 * check reads ([03 §5.1]). A new table, and 6's argument applies to it: an
 * index left at 9 would have no such table, and the check's first query would
 * fail every start. It also means 9's paragraph above is now half true — a file
 * that changed while the server was stopped *is* re-read at the next start —
 * and still true of what it was about: a change in what is derived from files
 * that have not changed needs a bump, because nothing re-reads an unchanged
 * file.
 *
 * **11 is 9's shape again** (2026-09-27): no table changed, and what a turn's
 * search text holds did. A move's pictures were indexed as the stand-ins a model
 * reads (*[Picture, not described]*) and are now indexed as their captions
 * only ([26 E15]), because search is read by a person. Turns written before
 * pictures index exactly as they did; the bump is for the ones written since.
 *
 * **12 adds `session.origin_filename`** (2026-09-29, [P13.10] and [P14.10a])
 * — `origin.originalFilename`, the key an imported session is found by again,
 * as the library's is an object's `provenance.originalFilename`. **Two
 * branches added it at once, at this one version, with the same column and the
 * same index**, and the merge kept one: a producer's re-import (an Aventuras
 * story, `aventura.db/stories/<id>`) is refused `already-here` by it, and a
 * chat's (its family's root path, [P14 §2.7]) extends the session it finds.
 * 6's shape and 9's argument, both: a new column, so an index left at 11 would
 * fail the first `indexSession` on an insert naming a column the table does
 * not have — every session write on the install, not only an import — and a
 * column over files that have not changed, so without the rebuild every
 * session imported before the upgrade would have it empty, and its source
 * would come in a second time instead of being found. *Why a column when the
 * library's own key is read out of `body` with `json_extract`*
 * (`findPriorImport`): a session row caches no body, so there is nothing to
 * extract from, and the alternative — opening every `session.json` an account
 * holds to answer *is this here* — is the walk this index exists to replace.
 *
 * **13 is 9's shape a third time** (2026-10-10, [P16.0]): no table changed, and
 * what a Package's file derives to did. Package is renamed World
 * ([P16 §1.1](../../../../docs/design/workplan/35-p16-world.md)), and a
 * `packages/<slug>/package.json` that an older build indexed as a row of kind
 * `storyengine.package/1`, with that id in its body, is now a row of kind
 * `storyengine.world/1` whose body the ingest has upgraded. **Nothing re-reads a
 * file that has not changed** — the start-up check compares size and time, and
 * a Package nobody has edited since the upgrade is exactly such a file — so
 * without the bump every one of them would stay a row of a kind no route names:
 * missing from the Worlds panel, its members' *Used by* still counting it under
 * the old kind, and the first edit refused because the row the write reads is
 * not in the kind its URL claims. One rescan is the whole cost, again.
 *
 * **14 is 9's shape a fourth time** (2026-10-10, [P16.3b]): no table changed,
 * and what files derive to in `object_link` did — **two *Used by* answers
 * grow**. `referencesIn` and `indexSession` now read
 * [04 §9.1](../../../../docs/design/04-schemas.md)'s table through the
 * publish walker's own reader (`library/references.ts`), and the table names
 * what the index never did. *An actor's `lore[]`* — so a lorebook's *Used by*
 * gains the actors that link it, which [10 §5.2] has always listed and this
 * index has never held. *A session's `treatment`, and the actors its hook pool
 * names* — every pooled hook's `involves`, and its `introduces.actor` ~~while the
 * hook has not fired~~ *fired or not* — so a treatment's *Used by* counts the
 * sessions played under it, and an actor's counts the sessions whose hooks name
 * them. *And, corrected 2026-10-10 in the commit after P16.3b, the actors who
 * arrived during play* — row 13's cast is the one a session plays with, so the
 * actors its head's channels hold state for are links too. 9's argument word
 * for word: an actor or a session nobody has saved since the upgrade is a file
 * nothing re-reads, and without the bump every lorebook on an upgraded install
 * would go on reporting no actors — and the delete confirmation
 * ([03 §10.1](../../../../docs/design/03-data-model.md)) counting fewer users
 * than it has — until each actor happened to be saved. One rescan is the whole
 * cost, a fourth time.
 *
 * ~~***14 carries the correction rather than a 15***~~ *(Overruled by the lead
 * the same day, in the same commit — see 15 below — and kept for its argument.)*
 * (2026-10-10, the commit
 * after [P16.3b]; *moved here by that commit's review*, which found it splitting
 * the paragraph above, so that 9's argument — the case **for** a bump — read as
 * though it followed the decision not to make one). 14 was committed at P16.3b
 * and pushed to `origin/p16`, and no tag holds it, so no release built an index
 * under the struck rule: only a developer who ran the server on that branch —
 * the owner walking the P16 gate among them — holds one. **That index needs
 * `index.rebuildOnStart` once, or `index.sqlite` deleted**, because the
 * argument above applies to it unchanged: a session nobody writes again keeps
 * the links the struck rule gave it, so the characters who arrived in it, and
 * its fired hooks' subjects, are missing from their *Used by* until the next
 * turn or edit rewrites `session.json`. A 15 is what would make that rescan
 * automatic; it would be owed had 14 shipped, and it was not taken here because
 * 14 has not.
 *
 * ***15 is 9's shape a fifth time, and carries the correction*** (2026-10-10, the
 * commit after [P16.3b]). The paragraph above is right that no release built an
 * index at 14, and wrong about who pays for leaving it: 14 is on `origin/p16`,
 * and the indexes built under it belong to exactly the people walking the P16
 * gate on that branch, for whom *remember to set `index.rebuildOnStart` once* is
 * the kind of step this file exists so nobody has to remember. A bump costs a
 * release nothing it was not already paying — an install from alpha 6 rescans
 * once, from 12, at 15 as it would have at 14 — and costs a `p16` index the one
 * rescan it needs, automatically. So the arrivals and the fired hooks' subjects
 * that 14's struck rule left out are links at 15 without anybody being told.
 */
export const INDEX_SCHEMA_VERSION = 15;

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

-- Search across cards, entries and turn text ([20 §7](../../../../docs/design/20-tech-stack.md)).
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
  updated_at    text not null,
  -- Where an imported session came from, in its source's own terms —
  -- \`origin.originalFilename\`: a producer's key, e.g.
  -- \`aventura.db/stories/<id>\` ([P13.10]), or a chat family's root path
  -- ([P14 §2.7]). Null for every session made here, and for an import that
  -- named no source. A re-import is found by it, per owner, as a library
  -- object's is by its provenance ([P4 §1.3]); derived from \`session.json\`
  -- like every other column here, so a rebuild writes it back.
  origin_filename text
) strict;

create index session_by_owner on session(owner, updated_at);
create index session_by_origin on session(owner, origin_filename);

-- ── What the last look at a session saw ──────────────────────────────────────
--
-- [03 §5.1]'s start-up consistency check compares *mtime/size against recorded
-- values*, and an object row has always carried both. A session had nothing to
-- compare: its rows are derived from \`session.json\` and every segment, and none
-- of them recorded what those files looked like. This is that record — one
-- digest over the files' sizes and times, and the account whose folder held
-- them — written by the rebuild and by the check, and **deliberately not by the
-- writes the server makes while it runs**. So it says *what the files were when
-- the rows were last derived whole*, and any change since, the server's own
-- included, is a session the next start derives again. A crash between a write
-- and its index update is one such change, and the case the check exists for.
-- The cost is a derivation in proportion to what was played since the last
-- start; keeping the stamp current instead would have put a stat beside every
-- index write the store makes, to save work only at start-up.
--
-- Bookkeeping about the files rather than a fact derived from them, so the
-- rebuild-equals-incremental gate does not compare it: a running server's
-- writes leave it behind by design.
create table session_stamp (
  session_id  text primary key,
  owner       text not null,
  stamp       text not null
) strict;

-- ── Turn text ────────────────────────────────────────────────────────────────
--
-- [20 §7.1](../../../../docs/design/20-tech-stack.md) makes three requirements that are
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
    'drop table if exists session_stamp',
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
