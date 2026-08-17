// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { uuidv7 } from '@storyengine/shared';

import { readSession, type SessionContext, withSessionLock } from '../sessions/store.js';
import type { EventSink } from '../stream/bus.js';
import type { Turn } from '../sessions/types.js';
import { inTransaction } from '../storage/transaction.js';

/**
 * Turn jobs, idempotent submission, drafts and progress events —
 * [P2 §2.10](../../../../docs/design/workplan/04-p2-implementation.md).
 *
 * The section's argument in one line: **any number of clients may observe a
 * session; only one turn may advance it.** Two jobs starting from the same
 * `headTurnId` would both claim that parent, race the head snapshot, and apply
 * two sets of effects in an order neither record states — accidental branching,
 * five phases before branching has semantics.
 *
 * Everything here is the machinery for that sentence, plus the retry-safety that
 * makes it usable from a browser: a submission carries an idempotency key and
 * the head it composed against, and the three answers are *here is your existing
 * job*, *no, something else is happening*, and *reserved, go*.
 */

export type JobStatus = 'queued' | 'running' | 'finalising' | 'committed' | 'abandoned';

export interface Job {
  id: string;
  sessionId: string;
  account: string;
  parentTurnId: string | null;
  /** Allocated at reservation, because step 2 cannot be idempotent without it. */
  turnId: string;
  status: JobStatus;
  commitStep: number;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface SubmitRequest {
  account: string;
  sessionId: string;
  /** Scoped to `(account, session)`; a retry presents the same one. */
  idempotencyKey: string;
  /** The head the client composed against. Null for the first turn. */
  headTurnId: string | null;
}

/**
 * The three answers of [P2 §2.10], plus the two that are not about concurrency.
 *
 * `stale` and `busy` both carry what the client needs to recover — the current
 * head, the job that is already running — because a bare rejection would leave
 * a UI with nothing to say beyond "try again", and trying again against the same
 * stale head produces the same rejection.
 */
export type SubmitOutcome =
  | { kind: 'created'; job: Job }
  | { kind: 'existing'; job: Job }
  | { kind: 'busy'; job: Job }
  | { kind: 'stale'; head: string | null }
  | { kind: 'no-session' };

export interface JobContext {
  db: DatabaseSync;
  sessions: SessionContext;
  /** Where progress goes when anybody is watching. Absent in a store-only test. */
  events?: EventSink;
}

interface JobRow {
  id: string;
  session_id: string;
  account: string;
  parent_turn_id: string | null;
  turn_id: string;
  status: string;
  commit_step: number;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    sessionId: row.session_id,
    account: row.account,
    parentTurnId: row.parent_turn_id,
    turnId: row.turn_id,
    status: row.status as JobStatus,
    commitStep: row.commit_step,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

const JOB_COLUMNS = `id, session_id, account, parent_turn_id, turn_id, status, commit_step,
                     created_at, updated_at, finished_at`;

export function readJob(db: DatabaseSync, id: string): Job | null {
  const row = db.prepare(`select ${JOB_COLUMNS} from job where id = ?`).get(id) as
    JobRow | undefined;
  return row ? toJob(row) : null;
}

/** The job currently advancing a session, if any. At most one, by constraint. */
export function activeJob(db: DatabaseSync, sessionId: string): Job | null {
  const row = db
    .prepare(`select ${JOB_COLUMNS} from job where session_id = ? and finished_at is null`)
    .get(sessionId) as JobRow | undefined;
  return row ? toJob(row) : null;
}

/**
 * Submits a turn, idempotently, for a session that is not already advancing.
 *
 * **Under the session's write lock**, which the sessions store owns: the
 * sequence is re-read the head, decide, reserve, and it means nothing if another
 * writer can land between the read and the decision. That is the same lock a
 * turn append takes, so a submission cannot be deciding against a head that an
 * append is in the middle of moving.
 *
 * The reservation and the job are **one transaction** ([P2 §2.10]). A key
 * without its job would make the retry return a job id that does not exist; a
 * job without its key would let the retry start a second one.
 */
export async function submitTurn(
  context: JobContext,
  request: SubmitRequest,
  now: number = Date.now(),
): Promise<SubmitOutcome> {
  return withSessionLock(request.sessionId, async () => {
    const session = await readSession(context.sessions, request.account, request.sessionId);
    if (session === null) return { kind: 'no-session' };

    return inTransaction(context.db, (): SubmitOutcome => {
      // First, because a retry is the *expected* case and must be free of every
      // other check: a client that reconnects mid-turn resubmits, and the
      // stale-head branch would otherwise reject its own job.
      const reserved = reservationFor(context, request);
      if (reserved) {
        const job = readJob(context.db, reserved);
        // A reservation whose job vanished is not a thing the schema allows —
        // the foreign key sees to that — so this is a real inconsistency rather
        // than a case to paper over.
        if (!job) throw new Error(`Idempotency key names job ${reserved}, which is not there.`);
        return { kind: 'existing', job };
      }

      const active = activeJob(context.db, request.sessionId);
      if (active) return { kind: 'busy', job: active };

      // The head is re-read from the file above rather than from any cache: it
      // is what the append actually writes against.
      if ((session.headTurnId ?? null) !== request.headTurnId) {
        return { kind: 'stale', head: session.headTurnId };
      }

      const job: Job = {
        id: uuidv7(),
        sessionId: request.sessionId,
        account: request.account,
        parentTurnId: request.headTurnId,
        turnId: uuidv7(),
        status: 'queued',
        commitStep: 0,
        createdAt: now,
        updatedAt: now,
        finishedAt: null,
      };

      context.db
        .prepare(
          `insert into job (id, session_id, account, parent_turn_id, turn_id, status,
                            commit_step, created_at, updated_at, finished_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, null)`,
        )
        .run(
          job.id,
          job.sessionId,
          job.account,
          job.parentTurnId,
          job.turnId,
          job.status,
          job.commitStep,
          job.createdAt,
          job.updatedAt,
        );

      context.db
        .prepare(
          `insert into idempotency (account, session_id, key, job_id, created_at)
             values (?, ?, ?, ?, ?)`,
        )
        .run(request.account, request.sessionId, request.idempotencyKey, job.id, now);

      return { kind: 'created', job };
    });
  });
}

function reservationFor(context: JobContext, request: SubmitRequest): string | null {
  const row = context.db
    .prepare('select job_id from idempotency where account = ? and session_id = ? and key = ?')
    .get(request.account, request.sessionId, request.idempotencyKey) as
    { job_id: string } | undefined;
  return row?.job_id ?? null;
}

/** Moves a job along. Terminal statuses stamp `finished_at`, which frees the session. */
export function setJobStatus(
  context: JobContext,
  jobId: string,
  status: JobStatus,
  now: number = Date.now(),
): void {
  const terminal = status === 'committed' || status === 'abandoned';
  context.db
    .prepare('update job set status = ?, updated_at = ?, finished_at = ? where id = ?')
    .run(status, now, terminal ? now : null, jobId);
}

export interface ProgressEvent {
  seq: number;
  /** A message key, never prose ([01 §2]). */
  key: string;
  params: Record<string, unknown>;
  at: number;
}

/**
 * The session a job belongs to, read from the **job row**.
 *
 * Not from the draft. `checkpoint`'s only trustworthy input is `jobId`; the
 * draft is opaque JSON the runner assembled, and the bus is keyed by session id
 * — so a draft whose `sessionId` was wrong would fan one user's progress
 * frames, including the text in the snapshot path, to another user's
 * subscribers. The job row carries the authoritative value and the lookup is one
 * indexed read inside a transaction that is already open.
 */
function sessionOf(db: DatabaseSync, jobId: string): string | null {
  const row = db.prepare('select session_id from job where id = ?').get(jobId) as
    { session_id: string } | undefined;
  return row?.session_id ?? null;
}

export interface Checkpoint {
  /**
   * The turn as it would be written **if it ended now**.
   *
   * That is not a placeholder shape: startup reconciliation turns a job left
   * running into "a failed terminal draft with the blocks and calls checkpointed
   * so far" ([P2 §2.10]), so a draft that is always terminal-ready is exactly
   * what recovery needs to find. A job that succeeds flips `status` to
   * `complete` on its last checkpoint.
   */
  turn: Turn;
  /** Events describing this change, sequenced in the same transaction. */
  events?: { key: string; params?: Record<string, unknown> }[];
}

/**
 * Writes the draft and its events as one durable unit.
 *
 * The sequence number is allocated **inside** the transaction that writes the
 * draft change it describes, which is what makes `snapshot + cursor` reattach
 * exact: a reader that has seen sequence N has, by construction, seen every
 * draft state up to N. Allocating it outside — in the caller, or from a counter
 * in memory — would let an event be published for a draft change that had not
 * committed, which is the reattach race stated backwards.
 *
 * **Streaming deltas coalesce into these** rather than each being one ([P2
 * §2.10]): a durable transaction per token would be an fsync storm, and the
 * snapshot already carries the accumulated text. The guarantee is over durable
 * checkpoints, not over every delta that painted the screen.
 */
export function checkpoint(
  context: JobContext,
  jobId: string,
  change: Checkpoint,
  now: number = Date.now(),
): ProgressEvent[] {
  const { events, sessionId } = inTransaction(context.db, () => {
    context.db
      .prepare(
        `insert into draft (job_id, turn, updated_at) values (?, ?, ?)
           on conflict(job_id) do update set turn = excluded.turn,
                                             updated_at = excluded.updated_at`,
      )
      .run(jobId, JSON.stringify(change.turn), now);

    context.db.prepare('update job set updated_at = ? where id = ?').run(now, jobId);

    const written: ProgressEvent[] = [];
    for (const event of change.events ?? []) {
      const row = context.db
        .prepare('select coalesce(max(seq), 0) as last from event where job_id = ?')
        .get(jobId) as { last: number };
      const seq = row.last + 1;
      const params = event.params ?? {};

      context.db
        .prepare('insert into event (job_id, seq, key, params, at) values (?, ?, ?, ?, ?)')
        .run(jobId, seq, event.key, JSON.stringify(params), now);
      written.push({ seq, key: event.key, params, at: now });
    }
    return { events: written, sessionId: sessionOf(context.db, jobId) };
  });

  /**
   * **Published after the transaction commits, and still synchronously.**
   *
   * After, because publishing from inside the body would fan out a change that
   * a rollback then undid — a client shown a step that never happened. Still
   * synchronously, because the attach path's whole no-gap argument is that a
   * checkpoint's write-and-publish pair cannot be interleaved: `node:sqlite` is
   * synchronous and `inTransaction` forbids an `await` in its body, so every
   * event is either already in a reader's backlog or still in its buffer, never
   * in between.
   *
   * Fed from **inside** `checkpoint` rather than at its call sites because
   * `advanceCommit` discards this function's return value at both of its calls
   * — including the one that emits `turn.finished`. A bus wired at call sites
   * would silently never publish the stream's closing frame, and startup
   * reconciliation would publish nothing at all.
   */
  if (sessionId !== null) context.events?.publish(sessionId, jobId, events);
  return events;
}

/** The draft as last checkpointed. The SSE snapshot is a rendering of this. */
export function readDraft(context: JobContext, jobId: string): Turn | null {
  const row = context.db.prepare('select turn from draft where job_id = ?').get(jobId) as
    { turn: string } | undefined;
  return row ? (JSON.parse(row.turn) as Turn) : null;
}

/**
 * Events after a cursor — the subscribe half of reattach.
 *
 * `afterSeq` rather than `fromSeq` because the client's cursor is the last event
 * it *has*, and an inclusive read would redeliver it. Off-by-one here is a
 * duplicated event in a stream whose whole promise is exactly-once.
 */
export function readEvents(context: JobContext, jobId: string, afterSeq = 0): ProgressEvent[] {
  const rows = context.db
    .prepare('select seq, key, params, at from event where job_id = ? and seq > ? order by seq')
    .all(jobId, afterSeq) as { seq: number; key: string; params: string; at: number }[];

  return rows.map((row) => ({
    seq: row.seq,
    key: row.key,
    params: JSON.parse(row.params) as Record<string, unknown>,
    at: row.at,
  }));
}
