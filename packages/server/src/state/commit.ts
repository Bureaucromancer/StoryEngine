// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  advanceHead,
  childrenByParent,
  appendTurnOnly,
  readSession,
  readTurns,
  type SessionContext,
  withSessionLock,
} from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import { checkpoint, type Job, type JobContext, readDraft, readJob } from './jobs.js';

/**
 * Terminal commit and startup reconciliation —
 * [P2 §2.10](../../../../docs/design/workplan/08-p2-implementation.md).
 *
 * A turn ends across three stores: the operational draft, an append-only JSONL
 * segment, and `session.json`'s head. There is no transaction across those, and
 * pretending otherwise is how a system ends up with a head pointing at a turn
 * nobody wrote. So finalisation is **a recoverable protocol** instead:
 *
 * 1. checkpoint the terminal draft in the operational transaction;
 * 2. append the terminal turn, idempotently by `turnId`;
 * 3. apply accepted effects and advance the head snapshot;
 * 4. mark the job committed and publish `turn.finished`.
 *
 * Every step is idempotent and the job records how far it got, which is what
 * lets recovery be *the same code running forward* rather than a second
 * implementation that has to agree with this one. `advanceCommit` performs one
 * step; `finaliseTurn` loops it; `reconcile` calls the same loop at startup.
 *
 * **Recovery resumes finalisation, never generation.** A provider stream cannot
 * be resumed and nothing here claims otherwise: a job that died mid-generation
 * becomes a *failed* terminal turn carrying whatever was checkpointed — a
 * re-runnable record rather than a silent loss
 * ([09 §2](../../../../docs/design/09-server-multiuser-deployment.md)).
 */

/** The number of steps in the protocol above. A job at this step is committed. */
export const COMMIT_STEPS = 4;

export interface CommitContext extends JobContext {
  sessions: SessionContext;
  /**
   * Where recovery narrates itself.
   *
   * The recovering process is where the interesting half of a killed turn's
   * lifecycle happens, so a log filtered by that turn's job id has to contain
   * *these* lines too — otherwise the falsifiable claim P2.5 makes about
   * reconstructing a lifecycle from the log holds only for the process that
   * died.
   */
  log?: Logger;
}

/** The slice of the logger this module uses. Structurally typed, so pino fits. */
export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

/**
 * Performs the next step and returns the job as it now stands.
 *
 * One step per call, deliberately. It makes "interrupted after step N" something
 * a test can produce exactly rather than approximate, and it means the resume
 * path and the forward path are not merely equivalent — they are the same
 * statements in the same order.
 *
 * The caller holds the session's write lock.
 */
export async function advanceCommit(
  context: CommitContext,
  job: Job,
  turn: Turn,
  now: number = Date.now(),
  extras: CommitExtras = {},
): Promise<Job> {
  /**
   * **The draft must be the turn this job reserved.**
   *
   * `finaliseTurn` keys the session lock on `turn.sessionId` while the steps
   * below do their filesystem work with `job.account` and `job.sessionId`. If
   * those disagreed, the lock would be taken on one key and the writes made
   * against another — not a crash, but a turn appended with no mutual exclusion
   * at all, silently. So the identity fields come from the job row and never
   * from anything a client supplied, and this is where that is checked.
   *
   * Safe to throw here only because `reconcile` isolates each job: this runs in
   * the recovery path, over a `draft.turn` the store treats as opaque JSON.
   */
  if (turn.id !== job.turnId || turn.sessionId !== job.sessionId) {
    throw new Error(
      `Draft for job ${job.id} names turn ${turn.id} in session ${turn.sessionId}, ` +
        `but the job reserved ${job.turnId} in ${job.sessionId}.`,
    );
  }

  switch (job.commitStep) {
    case 0: {
      // **Step 1 — the draft becomes terminal.** After this the operational
      // store holds the exact turn that will be appended, so every later step
      // can be replayed from it without the generator that produced it.
      checkpoint(context, job.id, { turn }, now);
      return setStep(context, job, 1, 'finalising', now);
    }

    case 1: {
      // **Step 2 — append, idempotently by `turnId`.** The id is allocated at
      // reservation precisely so this check can be made: a crash between the
      // append and the step bump would otherwise append the turn twice, and a
      // duplicate in an append-only segment is not something a later pass can
      // tidy away.
      //
      // The check is a cold read of the session's turns. That is O(session) and
      // it is once per turn, against a file tree that a single turn's provider
      // call dwarfs — the cheaper version would be an index lookup, and an index
      // is derived, which is exactly what this step must not depend on.
      const written = await readTurns(context.sessions, job.account, job.sessionId);
      if (!written.has(turn.id)) {
        await appendTurnOnly(context.sessions, job.account, job.sessionId, turn);
      }
      return setStep(context, job, 2, 'finalising', now);
    }

    case 2: {
      // **Step 3 — effects and the head.** Idempotent because `advanceHead`
      // sets rather than advances and recomputes the channel map from the
      // turn's effects, so a head that already names this turn is the state
      // this step produces.
      await advanceHead(context.sessions, job.account, job.sessionId, turn, extras.hidden);
      return setStep(context, job, 3, 'finalising', now);
    }

    default: {
      // **Step 4 — the job is done and says so.** `turn.finished` is published
      // last, after the record it announces is durable in all three places: a
      // client that receives it and immediately re-reads the session must find
      // the turn there ([09 §3.3]).
      checkpoint(
        context,
        job.id,
        { turn, events: [{ key: 'turn.finished', params: { state: turn.status } }] },
        now,
      );
      /**
       * **The session and the account too** — [21 §4.1].
       *
       * This carried `jobId` and `turnId` alone, and the id a person can see is
       * the session's, because it is the one in the URL. So the line that says
       * *this turn is now durable* — the one somebody looks for when a turn
       * seems to have vanished — could not be found by the only id they had.
       */
      context.log?.info(
        {
          event: 'job.committed',
          jobId: job.id,
          sessionId: job.sessionId,
          account: job.account,
          turnId: turn.id,
          status: turn.status,
        },
        'Turn committed',
      );
      return setStep(context, job, COMMIT_STEPS, 'committed', now);
    }
  }
}

/**
 * ***What the head move writes beside the turn*** — added 2026-09-29, at the
 * [P13.4] review. `hidden` is the new turn's `session.hidden` entry, which a
 * swipe, a continue or an edit carries from the turn it names
 * (`TurnPayload.hidden`); written by `advanceHead` in the same session write
 * as the head, under the lock this protocol already holds.
 *
 * *Not on the draft*, so startup recovery commits without it — see
 * `TurnPayload.hidden` for why that is accepted.
 */
export interface CommitExtras {
  hidden?: true | readonly number[];
}

/** Runs the protocol to completion from wherever the job currently is. */
export async function finaliseTurn(
  context: CommitContext,
  jobId: string,
  turn: Turn,
  now: number = Date.now(),
  extras: CommitExtras = {},
): Promise<Job> {
  return withSessionLock(turn.sessionId, () => finaliseLocked(context, jobId, turn, now, extras));
}

async function finaliseLocked(
  context: CommitContext,
  jobId: string,
  turn: Turn,
  now: number,
  extras: CommitExtras,
): Promise<Job> {
  let job = readJob(context.db, jobId);
  if (!job) throw new Error(`No job with id ${jobId}.`);

  while (job.commitStep < COMMIT_STEPS) {
    job = await advanceCommit(context, job, turn, now, extras);
  }
  return job;
}

function setStep(
  context: CommitContext,
  job: Job,
  step: number,
  status: Job['status'],
  now: number,
): Job {
  const terminal = status === 'committed' || status === 'abandoned';
  context.db
    .prepare(
      'update job set commit_step = ?, status = ?, updated_at = ?, finished_at = ? where id = ?',
    )
    .run(step, status, now, terminal ? now : null, job.id);

  return { ...job, commitStep: step, status, updatedAt: now, finishedAt: terminal ? now : null };
}

export interface Reconciliation {
  /** Jobs whose finalisation was resumed and completed. */
  finalised: string[];
  /** Jobs with nothing to commit, released so the session is not stuck. */
  abandoned: string[];
  /**
   * Jobs that could not be reconciled and are still active.
   *
   * Reported rather than swallowed or fatal. Their sessions stay busy, which is
   * a real cost — but a startup that refuses to boot over one malformed draft
   * costs the whole install, and a startup that pretended would lose a turn.
   */
  failed: string[];
}

/**
 * Startup reconciliation — the other half of the protocol.
 *
 * Every job still active at startup was interrupted, because nothing else can
 * leave one active across a restart. What to do with it depends only on how far
 * it got, which is the reason `commit_step` is a column rather than a thing to
 * infer:
 *
 * - **Interrupted during finalisation** (steps 1–3): resume. The draft is
 *   terminal, so the remaining steps need nothing that is gone.
 * - **Interrupted during generation, with a draft**: the draft is already
 *   terminal-ready with `status: "failed"` — that is why it is written that way
 *   from the first checkpoint — so it finalises as a failed turn carrying the
 *   blocks and calls that got that far.
 * - **Interrupted before the first checkpoint, or with its session gone**:
 *   abandoned. There is no record to write, and appending an empty failed turn
 *   would put a meaningless entry in somebody's story. The job is released so
 *   the session is not permanently blocked by a turn that never happened.
 *
 * Called once at startup, and safe to call again: a committed job is not active
 * and is not looked at.
 */
export async function reconcile(
  context: CommitContext,
  now: number = Date.now(),
): Promise<Reconciliation> {
  const active = context.db
    .prepare('select id from job where finished_at is null order by created_at')
    .all() as { id: string }[];

  const result: Reconciliation = { finalised: [], abandoned: [], failed: [] };

  for (const { id } of active) {
    const job = readJob(context.db, id);
    if (!job) continue;

    const log = context.log?.child({
      jobId: job.id,
      sessionId: job.sessionId,
      account: job.account,
      turnId: job.turnId,
    });

    /**
     * **One job's failure must not stop the rest.**
     *
     * This loop is the whole of recovery, and everything in it can reject: the
     * filesystem work in steps 2 and 3, a draft that will not parse, a session
     * folder that has been renamed under the server. Without isolation the
     * first rejection abandons every job after it in the ordering — and because
     * `job_one_active_per_session` is partial on `finished_at is null`, each of
     * those sessions then refuses every submission as busy, forever, with the
     * only remedy being another restart that hits the same bad row again.
     *
     * A job that cannot be reconciled is left active and reported. That is the
     * honest outcome: it is not committed and it is not abandoned, and saying so
     * is better than either lie.
     */
    try {
      const draft = readDraft(context, job.id);
      const session = await readSession(context.sessions, job.account, job.sessionId);

      if (draft === null || session === null) {
        setStep(context, job, job.commitStep, 'abandoned', now);
        result.abandoned.push(job.id);
        log?.warn(
          { event: 'job.abandoned', reason: draft === null ? 'no-draft' : 'no-session' },
          'Released a job with nothing to commit',
        );
        continue;
      }

      // A job that never reached step 1 has a draft that generation was still
      // writing into. Its status is whatever the last checkpoint said, and for an
      // interrupted turn that is `failed` — the value the draft is initialised
      // with, for exactly this moment.
      await finaliseTurn(context, job.id, draft, now);
      result.finalised.push(job.id);
      log?.info(
        { event: 'job.recovered', fromStep: job.commitStep, status: draft.status },
        'Resumed finalisation of an interrupted turn',
      );
    } catch (error) {
      result.failed.push(job.id);
      log?.error({ event: 'job.unreconciled', err: error }, 'Could not reconcile a job');
    }
  }

  return result;
}

/**
 * Reconciles turns that are on disk but not linked into the session.
 *
 * The case [P2 §2.10] names for a **deleted operational store**: an uncommitted
 * draft can be lost — that is the stated cost — but a terminal turn already
 * appended to JSONL must be "reconciled into the session rather than duplicated
 * or discarded". With `state.sqlite` gone there is no job to resume from, so the
 * evidence is the segments themselves.
 *
 * The rule is narrow on purpose: advance the head over turns whose parent *is*
 * the current head, one link at a time, and stop at the first ambiguity. A
 * session with two children of the head is a branch, and P2 has no semantics for
 * choosing between them ([07 §4](../../../../docs/design/07-branching.md)) — guessing there
 * would silently pick somebody's story for them.
 *
 * ***And only over turns appended after the session's last write, unless the
 * store is new*** (2026-09-27). Since [P6.1] a head can rest on a turn that
 * has one child: *Continue from here* moves it back along a line, and an undo
 * moves it to the parent of the turn it undid. The walk ran at every start,
 * for every session, and could not tell a head somebody parked from one a
 * crash left behind, so every restart put a parked head back at the tip and
 * the story the person chose was gone, with the next submission refused as
 * stale.
 *
 * With `sinceLastWrite`, a child counts only if it was created at or after the
 * session's `updatedAt`. Parking a head writes the session, so every child
 * that already existed is older than that. A turn a crash left unlinked was
 * appended after the session's last write, so it still counts. That is the
 * start-up pass with the operational store intact, where interrupted turn jobs
 * are finished by `reconcile` and this has only the unlocked appends left to
 * mend. With the store new (deleted, or never there) there are no jobs to
 * resume from, and the walk is the whole of [P2 §2.10]'s remedy, as before.
 */
export async function reconcileSession(
  sessions: SessionContext,
  handle: string,
  sessionId: string,
  options: { sinceLastWrite?: boolean } = {},
): Promise<number> {
  return withSessionLock(sessionId, async () => {
    const session = await readSession(sessions, handle, sessionId);
    if (session === null) return 0;
    // Captured before the walk, which writes the session as it advances.
    const since = options.sinceLastWrite === true ? session.updatedAt : null;

    const turns = await readTurns(sessions, handle, sessionId);
    // Shared with the navigation [P6.1] added, which asks the same question of
    // the same shape — and refuses to guess at a fork for the same reason.
    const byParent = childrenByParent(turns);

    let head = session.headTurnId;
    let advanced = 0;
    // A turn that is its own ancestor is not something the writer can produce,
    // but this walk reads whatever is in the file — and a hand-edited segment is
    // a supported way to get data in here. Walking it forever is the one
    // outcome that is worse than ignoring it.
    const seen = new Set<string>();
    for (;;) {
      const children = (byParent.get(head) ?? []).filter(
        (child) => since === null || child.createdAt >= since,
      );
      const only = children.length === 1 ? children[0] : undefined;
      if (!only || seen.has(only.id)) break;
      seen.add(only.id);
      await advanceHead(sessions, handle, sessionId, only);
      head = only.id;
      advanced += 1;
    }

    return advanced;
  });
}
