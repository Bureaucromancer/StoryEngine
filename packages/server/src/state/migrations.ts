// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

/**
 * Schema versioning for the operational store — the opposite discipline to the
 * index's.
 *
 * [13 §5.1](../../../../docs/design/13-internal-contracts.md) draws the line: the index is a
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
 * [P2 §2.10](../../../../docs/design/workplan/04-p2-implementation.md)'s explicitly-costed loss of an
 * uncommitted draft.
 */

/**
 * Each entry migrates *from* the version equal to its index. `STEPS[0]` creates
 * the schema from empty, `STEPS[1]` would take version 1 to version 2, and so
 * on. The current version is therefore the length of this array.
 */
const STEPS: string[] = [
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
-- terminal — rather than making a second provider call ([13 §5.1]).
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
-- A message key and its params, never prose ([01 §2](../../../../docs/design/workplan/01-work-plan.md)) — the
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
