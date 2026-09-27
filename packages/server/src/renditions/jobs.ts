// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { uuidv7, type RenditionError, type RenditionPurpose } from '@storyengine/shared';

import { inTransaction } from '../storage/transaction.js';

/**
 * Rendition jobs — [06 §10.2](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P9 §0.1]'s finding 9, built at [P9.2].
 *
 * ***A second job shape beside the first, and the plan was wrong about this in
 * the expensive direction.*** [P9 §5] claimed renditions *"reuse the operational
 * store's job vocabulary, which has existed since P2"*; the readiness audit found
 * `state/jobs.ts`'s `Job` is **turn-shaped all the way down** — `parentTurnId`,
 * `turnId`, `commitStep`, and a partial unique index — and exists to enforce
 * [P2 §2.10]'s *only one turn may advance a session*.
 *
 * **That is the one invariant a rendition must not inherit.** Several may be in
 * flight for one session, none blocks the turn, and none advances the head. On
 * the `job` table a second concurrent picture would be a constraint violation
 * rather than a queue.
 *
 * *So what is reused is the store, the status vocabulary and the event stream;
 * what is not is the reservation.* There is no idempotency table either: a
 * turn's renditions are enqueued once, by the runner, after the commit, and a
 * partial unique index — **one live job per record**, `(session_id,
 * rendition_id)` where `finished_at is null` — is what stops a double dispatch:
 * a constraint rather than a check-then-insert, for the reason
 * `job_one_active_per_session` is an index rather than a query. *Live* rather
 * than *ever*, because a retry is a new job with the next attempt number; the
 * finished ones stay as the count of what a picture has cost.
 *
 * ***Both columns, because an id alone does not name a record.*** Rendition ids
 * are `<turnId>.<n>` and an imported session keeps its turn ids, so a copy of a
 * session on the install it came from holds records whose ids are the
 * original's. Keyed by id alone, the copy's Illustrate found the original's job
 * and re-rendered the original — the migration that narrowed the index says
 * how that was found.
 */

export type RenditionJobStatus = 'queued' | 'running' | 'done' | 'abandoned';

export interface RenditionJob {
  id: string;
  sessionId: string;
  account: string;
  renditionId: string;
  turnId: string;
  purpose: RenditionPurpose;
  status: RenditionJobStatus;
  /** Which try this is. A retry is a new job with a higher number, never a reset. */
  attempt: number;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  error: RenditionError | null;
}

interface JobRow {
  id: string;
  session_id: string;
  account: string;
  rendition_id: string;
  turn_id: string;
  purpose: string;
  status: string;
  attempt: number;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
  error: string | null;
}

const COLUMNS = `id, session_id, account, rendition_id, turn_id, purpose, status, attempt,
                 created_at, updated_at, finished_at, error`;

function toJob(row: JobRow): RenditionJob {
  return {
    id: row.id,
    sessionId: row.session_id,
    account: row.account,
    renditionId: row.rendition_id,
    turnId: row.turn_id,
    purpose: row.purpose === 'background' ? 'background' : 'illustration',
    status: statusOf(row.status),
    attempt: row.attempt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    error: row.error === null ? null : (row.error as RenditionError),
  };
}

/** A column is a text column, so a value it should not hold is answered for. */
function statusOf(value: string): RenditionJobStatus {
  return value === 'running' || value === 'done' || value === 'abandoned' ? value : 'queued';
}

export interface EnqueueRequest {
  sessionId: string;
  account: string;
  renditionId: string;
  turnId: string;
  purpose: RenditionPurpose;
  /**
   * Which try. Absent means *the next one* — one past the highest attempt this
   * record has had, which is what a retry is and what the first dispatch is too.
   */
  attempt?: number;
}

/** What `enqueueRendition` found or made. */
export interface Enqueued {
  job: RenditionJob;
  /**
   * **Whether this call made the job.** False when a live one already existed,
   * and then the caller must not start it a second time: whoever made it is
   * already running it, and two workers on one record would race to write it.
   */
  fresh: boolean;
}

/**
 * Queues one picture, or returns the job still working on it.
 *
 * **Idempotent while a job is live, and a new job once it is not.** The partial
 * unique index means a second enqueue for a record whose job has not finished
 * cannot insert, so this reads that row and says it did not make it — which is
 * what makes the runner's dispatch safe to call from a commit path that may
 * itself be retried by `reconcile`. Once the job has finished, the same call is
 * a **retry**: a new row, the next attempt number, and the old row left where it
 * is as the record of what was already paid for. Until 2026-09-27 this returned
 * the finished row and the worker re-ran it under its old number.
 *
 * *No session lock.* The whole point of the second job shape is that a rendition
 * does not advance a head, so there is no head to be deciding against — and
 * taking the session's write lock here would put a picture in front of the next
 * turn, which is precisely what [06 §10.2] forbids.
 */
export function enqueueRendition(
  db: DatabaseSync,
  request: EnqueueRequest,
  now: number = Date.now(),
): Enqueued {
  return inTransaction(db, () => {
    const live = db
      .prepare(
        `select ${COLUMNS} from rendition_job
         where session_id = ? and rendition_id = ? and finished_at is null`,
      )
      .get(request.sessionId, request.renditionId) as JobRow | undefined;
    if (live) return { job: toJob(live), fresh: false };

    const tried = db
      .prepare(
        `select coalesce(max(attempt), 0) as attempts from rendition_job
         where session_id = ? and rendition_id = ?`,
      )
      .get(request.sessionId, request.renditionId) as { attempts: number };

    const job: RenditionJob = {
      id: uuidv7(),
      sessionId: request.sessionId,
      account: request.account,
      renditionId: request.renditionId,
      turnId: request.turnId,
      purpose: request.purpose,
      status: 'queued',
      attempt: request.attempt ?? tried.attempts + 1,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      error: null,
    };

    db.prepare(
      `insert into rendition_job (${COLUMNS})
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      job.id,
      job.sessionId,
      job.account,
      job.renditionId,
      job.turnId,
      job.purpose,
      job.status,
      job.attempt,
      job.createdAt,
      job.updatedAt,
      null,
      null,
    );
    return { job, fresh: true };
  });
}

/**
 * Moves a job along.
 *
 * `done` and `abandoned` are terminal and stamp `finished_at`, which is what
 * makes *is this rendition still being worked on* a query rather than a guess.
 * An `error` class is stored beside the status rather than instead of it: a job
 * that abandoned and a rendition that failed are two facts, and the workbench
 * shows the second while recovery reads the first.
 */
export function setRenditionJobStatus(
  db: DatabaseSync,
  id: string,
  status: RenditionJobStatus,
  error: RenditionError | null = null,
  now: number = Date.now(),
): void {
  const terminal = status === 'done' || status === 'abandoned';
  db.prepare(
    `update rendition_job set status = ?, error = ?, updated_at = ?,
            finished_at = case when ? then ? else finished_at end
     where id = ?`,
  ).run(status, error, now, terminal ? 1 : 0, now, id);
}

export function readRenditionJob(db: DatabaseSync, id: string): RenditionJob | null {
  const row = db.prepare(`select ${COLUMNS} from rendition_job where id = ?`).get(id) as
    JobRow | undefined;
  return row ? toJob(row) : null;
}

/**
 * The latest job for one record, whatever state it is in — a record is its
 * session plus its id, never the id alone, and since retries became new jobs a
 * record can have several. The newest is the one that says what is happening.
 */
export function jobForRendition(
  db: DatabaseSync,
  sessionId: string,
  renditionId: string,
): RenditionJob | null {
  const row = db
    .prepare(
      `select ${COLUMNS} from rendition_job where session_id = ? and rendition_id = ?
       order by attempt desc, created_at desc limit 1`,
    )
    .get(sessionId, renditionId) as JobRow | undefined;
  return row ? toJob(row) : null;
}

/**
 * Everything still owed for a session, oldest first.
 *
 * **Several at once is the ordinary case**, which is the whole difference from
 * `activeJob` one module over: that one returns *the* job because only one turn
 * may advance a session, and this returns a list because a turn can ask for a
 * picture and a backdrop and nothing about either blocks the other.
 */
export function pendingRenditionJobs(db: DatabaseSync, sessionId: string): RenditionJob[] {
  const rows = db
    .prepare(
      `select ${COLUMNS} from rendition_job
       where session_id = ? and finished_at is null
       order by created_at asc`,
    )
    .all(sessionId) as unknown as JobRow[];
  return rows.map(toJob);
}

/**
 * What a restart found in flight — [P9.2].
 *
 * ***Abandoned rather than resumed, and `state/commit.ts` already argued the
 * shape of this answer***: *"recovery resumes finalisation, never generation."*
 * A provider call that died with the process cannot be picked up mid-flight, so
 * pretending otherwise would mean a job that waits forever for a socket nobody
 * holds.
 *
 * **What makes that acceptable here and not there is the placeholder.** An
 * interrupted *turn* becomes a failed turn because there is no other honest
 * thing to be; an interrupted *rendition* becomes a record with `asset: null`,
 * its recipe intact and a retry button in front of it — which is [06 §10.2]'s
 * answer to every other way this goes wrong, and the reason §1.4's *the hook
 * ships, the policy does not* is enough.
 *
 * Returns the rendition ids, so the caller can mark the records as well as the
 * jobs: a job row nobody can see is not what a person is looking at.
 */
export function reconcileRenditionJobs(
  db: DatabaseSync,
  now: number = Date.now(),
): { interrupted: RenditionJob[] } {
  const rows = db
    .prepare(`select ${COLUMNS} from rendition_job where finished_at is null`)
    .all() as unknown as JobRow[];
  const interrupted = rows.map(toJob);

  for (const job of interrupted) {
    setRenditionJobStatus(db, job.id, 'abandoned', 'interrupted', now);
  }
  return { interrupted };
}
