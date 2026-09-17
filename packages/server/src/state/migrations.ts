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

  /**
   * ***Rendition jobs — a second job shape beside the first, not a reuse of
   * it*** ([P9 §0.1]'s finding 9, built at [P9.2]).
   *
   * §5 of that plan claimed jobs *"reuse the operational store's job
   * vocabulary"*, and the audit found it wrong in the expensive direction:
   * `job` is **turn-shaped all the way down** — `parent_turn_id`, `turn_id`,
   * `commit_step`, and a partial unique index — and it exists to enforce
   * [P2 §2.10]'s *only one turn may advance a session*.
   *
   * **That invariant is the one a rendition must not inherit.** Several may be
   * in flight for one session, none blocks the turn, and none advances the head
   * ([06 §10.2]) — so there is no `job_one_active_per_session` here, and its
   * absence is the design rather than an omission. On the `job` table a second
   * concurrent picture would be a constraint violation rather than a queue.
   *
   * *`STEPS[1]` set the precedent for exactly this shape of question*, when
   * import needed a differently-shaped job and got sibling tables rather than a
   * nullable column. The argument it wrote out applies here unchanged.
   *
   * ***The record is not in this table, and that is the other half.*** A
   * rendition's prompt, seed and workflow parameters are never discarded
   * ([06 §10.7]) and they travel and delete with the session ([03 §10.3]), so
   * they live in `sessions/<id>/renditions/` where a person can read them. What
   * is here is the **dispatch** — queued, running, finished — which exists only
   * here and nowhere else, and that is [21 §5.1]'s own test for what belongs in
   * this store.
   */
  `
create table rendition_job (
  id            text primary key,
  session_id    text not null,
  account       text not null,

  -- The record this job is producing pixels for, and the turn it hangs off.
  --
  -- Not a foreign key: the record is a *file*, and a table that referenced it
  -- would be a second claim about what exists — one that a person deleting a
  -- session directory by hand could make wrong.
  rendition_id  text not null,
  turn_id       text not null,
  purpose       text not null,

  -- queued → running → done, or abandoned.
  --
  -- No 'failed', for the reason the turn job has none: a rendition that failed
  -- is a *rendition* whose own record says so, with its class and its recipe
  -- intact and a retry button in front of it. The job that produced it still
  -- finished. 'abandoned' is the different fact — a job that could not finish at
  -- all, which is what boot recovery finds and what [06 §10.2]'s placeholder is
  -- then showing.
  status        text not null,

  -- Which try this is. A retry is a **new job** with a higher number rather than
  -- a reset, so the store can say how many times a picture has been paid for.
  attempt       integer not null default 1,

  created_at    real not null,
  updated_at    real not null,
  finished_at   real,

  -- A class, never a provider's words ([21 §1.4]): the server does not know the
  -- reader's language, and the endpoint's own sentence goes to the log.
  error         text
) strict;

-- One live job per rendition, which is the only uniqueness a rendition wants.
-- It stops a double dispatch as a constraint rather than as a check-then-insert,
-- for the reason \`job_one_active_per_session\` is an index rather than a query.
create unique index rendition_job_by_rendition on rendition_job(rendition_id);
create index rendition_job_by_session on rendition_job(session_id, created_at);
`,

  /**
   * Notifications — [09 §3.4](../../../../docs/design/09-server-multiuser-deployment.md),
   * [09 §3.5](../../../../docs/design/09-server-multiuser-deployment.md), [P10.1].
   *
   * ***Keyed by account, which is the whole reason it is not the \`event\`
   * table.*** A progress event belongs to a **job** and is scoped to the session
   * anyone watching it is watching; a notification belongs to a **person** and
   * has to find them wherever they are — including in a session they do not have
   * open, and including when the thing that produced it has no session at all
   * (\`system.notice\`). [09 §3.2] splits the two for that reason, and this is the
   * split as a table rather than as a paragraph.
   *
   * **Durable, because the badge is.** [09 §3.6]'s first delivery channel
   * includes an *unread badge*, which is a claim that survives a page reload —
   * and \`system.notice\` carries admin warnings that must not evaporate because
   * nobody had a tab open. So this is the store and the stream is only delivery,
   * which is the same division \`bus.ts\` already draws for the durable half of
   * the session stream.
   *
   * ***The schema is the retrofit risk and that is why it is here rather than
   * later*** — [09 §3.4] states it outright: *"the retrofit cost is not in the
   * delivery channels — those are additive. It is in the notification event
   * schema, because every producer changes if it is wrong."* Every field below
   * is one that section names.
   */
  `
create table notification (
  id          text primary key,

  -- The **target user, resolved server-side** ([09 §3.4]). Never inferred by a
  -- client, which is the half of [09 §3.1] that cannot be got wrong: if the
  -- client decided, notifications would work only while a client was connected.
  account     text not null,

  -- The closed set in [09 §3.5]. A text column rather than a check constraint,
  -- for \`ProgressEvent.key\`'s reason: the union in TypeScript is what makes a
  -- typo a compile error, and a constraint here would only turn it into a
  -- runtime one that a migration then has to widen.
  class       text not null,

  -- [09 §3.4]'s one field rather than a doubling of the class list: *does the
  -- reader need to do something, or only to know?* It is the axis routing and
  -- presentation actually care about.
  actionable  integer not null,

  -- The params of a \`{ key, params }\` summary, composed at display time because
  -- the server does not know the reader's language ([19 §12.5]). **Params, not
  -- prose** — and [09 §3.4] warns this cuts both ways: they must carry
  -- everything the sentence needs, or a later composer produces the
  -- "New event in session 4f2a" school of notification.
  params      text not null,

  -- What this is about, when it is about something. Null for a \`system.notice\`,
  -- which is the class that exists precisely because several admin warnings have
  -- nowhere to be delivered and no session behind them.
  session_id  text,
  turn_id     text,

  -- [09 §3.4]'s dedupe key. *Five characters replying in a group chat is one
  -- notification, not five* — and the coalescing is a **fold into the newest row
  -- inside the window**, not a unique index, because two hours later the same
  -- key is a second notification rather than a duplicate. The window is the
  -- query's, so it can be tuned without a migration.
  dedupe_key  text not null,

  -- How many folded in. One row that says *3* is the thing a count of three rows
  -- is not, and it is what lets the summary say so.
  folded      integer not null default 1,

  created_at  real not null,
  -- Moved by a fold, so the window is measured from the most recent arrival
  -- rather than the first — which is what makes a steady trickle coalesce
  -- instead of restarting every window.
  updated_at  real not null,

  read_at     real
) strict;

-- The list a person reads, newest first.
create index notification_by_account on notification(account, created_at);

-- The coalescing lookup, and the unread count. Both are per-account and both
-- are hot enough to deserve the index that a badge polls.
create index notification_by_dedupe on notification(account, dedupe_key, updated_at);
create index notification_unread on notification(account, read_at);
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
