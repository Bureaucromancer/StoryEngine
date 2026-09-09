// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

/**
 * Schema versioning for the operational store — the opposite discipline to the
 * index's.
 *
 * [21 §5.1](../../../../docs/design/21-internal-contracts.md) draws the line: the index is a
 * restatement of what is on disk, so a schema change there throws the old file
 * away and rescans. **Nothing in here is a restatement of anything.** A job in
 * flight, the idempotency key that stops a retry charging twice, the draft of a
 * turn that has not been appended yet — these exist only here, and the rule the
 * document gives for telling them apart is *if losing it would surprise a user,
 * it is not derived.*
 *
 * So migrations here are **stepwise and preserving**: each version is a function
 * from the previous one, they run in order, and none of them may drop a table.
 * That is more expensive per change than the index's approach and it is the
 * price of holding authoritative state. The steps array below is the whole
 * mechanism — a new version is a new entry, never an edit to an old one.
 *
 * The one thing this file must never grow is a `dropAll`. The index has one
 * because deleting the index is a non-event; deleting this is
 * [P2 §2.10](../../../../docs/design/workplan/08-p2-implementation.md)'s explicitly-costed loss of an
 * uncommitted draft.
 */

/**
 * Each entry migrates *from* the version equal to its index. `STEPS[0]` creates
 * the schema from empty, `STEPS[1]` would take version 1 to version 2, and so
 * on. The current version is therefore the length of this array.
 */
export const STEPS: string[] = [
  `
-- ── Jobs ─────────────────────────────────────────────────────────────────────
--
-- One row per turn submission ([P2 §2.10]). A job is the unit that owns a
-- provider call, a draft, and eventually one appended turn.
create table job (
  id              text primary key,
  session_id      text not null,
  -- The account the submission came from. Idempotency keys are scoped to
  -- (account, session) so one user's retry cannot collide with another's.
  account         text not null,

  -- The head the client composed against, and the id the terminal turn will
  -- have. Both are decided at reservation: the turn id has to exist before the
  -- turn does, or step 2 of the commit protocol could not be idempotent.
  parent_turn_id  text,
  turn_id         text not null,

  -- queued → running → finalising → committed, or abandoned.
  --
  -- There is no 'failed' here, deliberately. A turn that failed is a *turn*
  -- whose own status says failed, appended and reconciled like any other; the
  -- job that produced it still committed. 'abandoned' is for the job that could
  -- not commit at all — the session is gone — which is a different fact.
  status          text not null,

  -- How far the four-step commit protocol got. Startup reconciliation resumes
  -- from here, and every step is idempotent so resuming from a step that
  -- actually completed is harmless ([P2 §2.10]).
  commit_step     integer not null default 0,

  created_at      real not null,
  updated_at      real not null,
  -- Null while the job is active. Set when it reaches a terminal status.
  finished_at     real
) strict;

-- **One active turn per session, enforced by the database** ([P2 §2.10]).
--
-- In code this is a check-then-insert, which is exactly the shape that races.
-- As a partial unique index it is a constraint: a second submission for a
-- session that already has an active job fails the insert, and the caller's
-- "another job is active" branch is reached by catching that rather than by
-- winning a lookup.
create unique index job_one_active_per_session on job(session_id) where finished_at is null;

create index job_by_session on job(session_id, created_at);

-- ── Idempotency reservations ─────────────────────────────────────────────────
--
-- A browser retry, a reconnect, a double-click. The key names the job it
-- created, so a repeat submission returns that job — queued, running or
-- terminal — rather than making a second provider call ([21 §5.1]).
create table idempotency (
  account     text not null,
  session_id  text not null,
  key         text not null,
  job_id      text not null references job(id),
  created_at  real not null,
  primary key (account, session_id, key)
) strict;

-- ── The in-flight draft ──────────────────────────────────────────────────────
--
-- An append-only segment cannot also be a document rewritten on every token, so
-- during execution the authoritative turn lives here ([P2 §2.10]). The SSE
-- snapshot is a rendering of this row.
create table draft (
  job_id      text primary key references job(id) on delete cascade,
  -- The terminal turn as far as it is known, as JSON. Whole-row rewrite rather
  -- than a column per field: the shape is P2.4's and P2.5's to fill in, and a
  -- schema that enumerated it would need a migration per turn-record change.
  turn        text not null,
  updated_at  real not null
) strict;

-- ── Progress events ──────────────────────────────────────────────────────────
--
-- Sequenced per job, in the same transaction as the draft change they describe,
-- which is what makes snapshot-plus-cursor reattach exact ([P2 §2.10]).
--
-- A message key and its params, never prose ([work plan §2](../../../../docs/design/workplan/01-work-plan.md)) — the
-- server does not know the reader's language and an event carrying English is a
-- string that cannot be translated later.
create table event (
  job_id  text not null references job(id) on delete cascade,
  seq     integer not null,
  key     text not null,
  params  text not null,
  at      real not null,
  primary key (job_id, seq)
) strict;
`,
  `
-- ── Import jobs ──────────────────────────────────────────────────────────────
--
-- **Sibling tables rather than a widening of \`job\`** ([P4 §1.3]). A sweep is a
-- job in every sense the vocabulary above means — it runs, it emits progress,
-- it finishes — but it has no session, and \`job\` is session-shaped all the way
-- down: \`session_id\` is \`not null\`, the one-active-per-session index is
-- partial on it, \`idempotency\`'s primary key includes it, and \`draft\` and
-- \`event\` both foreign-key to \`job\`. Making that column nullable would weaken
-- a uniqueness guarantee and two foreign keys that turns depend on, to spare
-- import one table. The migration chain is append-only by its own rule at the
-- top of this file, which is the shape this decision was written for.
create table import_job (
  id           text primary key,
  account      text not null,
  -- **Where the sweep was pointed, recorded once and here.**
  -- [21 §4.1](../../../../docs/design/21-internal-contracts.md)'s foreign-path
  -- doctrine: source files are named relative to this root everywhere else — in
  -- the review, in the log, in \`VersionRecord.from\` — because the log is the
  -- thing people paste into issues. The absolute path lives on the job record,
  -- where the person who typed it can see it and nobody else has to.
  root         text not null,
  -- Which source the probe decided this root is ([P4 §1.3]): the classification
  -- is stored because the review has to be able to say *what it thought it was
  -- looking at*, which is the difference between "found four cards" and "read
  -- your Marinara library".
  source       text not null,
  -- queued | running | finished | refused.
  --
  -- \`refused\` is the arm the turn vocabulary deliberately lacks, and import
  -- needs it for a reason turns do not have: a root can be rejected **before
  -- anything is written** — a live install, a storage format we do not know
  -- ([P4 §1.3]) — and that is not a failed run, it is a run that correctly did
  -- not start. A poisoned *file* never lands here; it is one row in the review
  -- and the sweep completes around it.
  status       text not null,
  created_at   real not null,
  updated_at   real not null,
  finished_at  real
) strict;

create index import_job_by_account on import_job(account, created_at);

-- Progress for a sweep, in the same shape and for the same reason as \`event\`:
-- a key and its params, never prose. Import occupies \`job.progress\`, which has
-- been declared in the progress vocabulary with no emitter since P2 and was
-- left open for exactly this.
create table import_event (
  job_id  text not null references import_job(id) on delete cascade,
  seq     integer not null,
  key     text not null,
  params  text not null,
  at      real not null,
  primary key (job_id, seq)
) strict;
`,
  `
-- ── The review, at its own address ───────────────────────────────────────────
--
-- Appended 2026-08-31, closing [P4 §7.4] and gate step 11. The import_job and
-- import_event tables landed at P4.4 and nothing ever wrote them: the
-- addressable report was the stage's second cut, and the migration went in
-- anyway. Two tables no code touches is the shape of a schema that gets
-- misremembered as load-bearing, so this is the writer arriving rather than the
-- tables leaving.
--
-- **A table rather than more import_event rows**, though the columns would have
-- fitted. That table is progress — key-and-params ticks, the shape the event
-- table has for turns — and a review item is not a tick: it is a row about a
-- *file*, with a disposition, and often an object it produced. Storing one as
-- the other would make the report reconstructible only by convention, and would
-- not answer the question [P5 §1.8] already needs answered: *what did the import
-- say about this book?* That is a lookup by object_id, which is why the column
-- is here and indexed.
create table import_item (
  job_id      text not null references import_job(id) on delete cascade,
  seq         integer not null,
  -- Relative to the sweep root, never absolute ([21 §4.1.1]). The root lives
  -- once on the job, where the person who typed it can see it.
  source      text not null,
  disposition text not null,
  -- The object this row produced, when it produced one. Null for everything
  -- skipped, recorded or unrecognised — which is most rows in a real sweep.
  object_id   text,
  -- An array of { key, params, level }, as JSON. Never prose ([P4 §1.4]): a
  -- report stored as English is a bug that surfaces when somebody changes
  -- language.
  notes       text not null,
  primary key (job_id, seq)
) strict;

create index import_item_by_object on import_item(object_id);
`,

  /**
   * **A review row can name more than one object, so `seq` stops being unique.**
   *
   * The table above was written on the assumption that one file makes one
   * object, and `primary key (job_id, seq)` says exactly that. It is not true:
   * a character card carrying a `character_book` makes an actor **and** a
   * lorebook, which `ImportPanel`'s own label calls "most of them". The book
   * therefore had no row of its own, and [P5 §1.8]'s question — *what did the
   * import say about this book* — came back empty for the commonest kind of
   * book there is.
   *
   * So the writer records one row per object produced, sharing the item's
   * `seq`, and `readImport` collapses them back into one item per file. The
   * review is unchanged; the notes become findable from either object. What
   * has to go is the constraint that was stating the old assumption — and it
   * goes rather than being widened, because "one row per (job, seq)" is now
   * deliberately false and a key that no longer means anything is worse than no
   * key.
   *
   * The rebuild dance rather than `alter table`: SQLite cannot drop a primary
   * key in place.
   */
  `
create table import_item_new (
  job_id      text not null references import_job(id) on delete cascade,
  seq         integer not null,
  source      text not null,
  disposition text not null,
  object_id   text,
  notes       text not null
) strict;

insert into import_item_new (job_id, seq, source, disposition, object_id, notes)
  select job_id, seq, source, disposition, object_id, notes from import_item;

drop table import_item;
alter table import_item_new rename to import_item;

create index import_item_by_object on import_item(object_id);
-- Ordering is a read every report does, and it is no longer served by a primary
-- key that happened to be on the same columns.
create index import_item_by_job on import_item(job_id, seq);
`,
];

export const STATE_SCHEMA_VERSION = STEPS.length;

function readVersion(db: DatabaseSync): number {
  const row = db.prepare('pragma user_version').get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

export interface StateMigrationResult {
  from: number;
  to: number;
}

/**
 * Brings the store up to the current version, one step at a time.
 *
 * A version *ahead* of this build is refused rather than migrated down. It means
 * the data directory has been opened by a newer StoryEngine, and the honest
 * answer is to stop: the alternative is a build that does not understand a
 * column silently writing rows that the newer one will read as authoritative.
 */
export function migrateState(db: DatabaseSync): StateMigrationResult {
  const from = readVersion(db);

  if (from > STATE_SCHEMA_VERSION) {
    throw new Error(
      `The operational store is at schema version ${String(from)}, but this build understands ` +
        `${String(STATE_SCHEMA_VERSION)}. It was written by a newer StoryEngine.`,
    );
  }

  for (let version = from; version < STATE_SCHEMA_VERSION; version += 1) {
    const step = STEPS[version];
    if (step === undefined) throw new Error(`No migration step for version ${String(version)}.`);
    // Each step is its own transaction, so a crash mid-upgrade leaves the store
    // at a version that some step actually produced rather than half of one.
    db.exec('begin immediate');
    try {
      db.exec(step);
      db.exec(`pragma user_version = ${String(version + 1)}`);
      db.exec('commit');
    } catch (error) {
      db.exec('rollback');
      throw error;
    }
  }

  return { from, to: STATE_SCHEMA_VERSION };
}
