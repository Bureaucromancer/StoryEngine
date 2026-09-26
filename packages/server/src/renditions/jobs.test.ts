// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateState } from '../state/migrations.js';
import {
  enqueueRendition,
  jobForRendition,
  pendingRenditionJobs,
  readRenditionJob,
  reconcileRenditionJobs,
  setRenditionJobStatus,
  type EnqueueRequest,
  type RenditionJob,
} from './jobs.js';

/**
 * ***The rendition job store's account of a retry*** — `RenditionJob.attempt`'s
 * promise, *"a retry is a new job with a higher number, never a reset"*, held
 * against the two readers that depend on it: `pendingRenditionJobs`, and boot
 * recovery.
 *
 * *In memory and through `migrateState`*, `migrations.test.ts`'s arrangement,
 * so the constraints under test are the ones a real store is built with rather
 * than a fixture's idea of them.
 *
 * **The sequence reads the store rather than `enqueueRendition`'s return
 * value**, deliberately: *what the store holds after a retry* is the claim, and
 * a test that trusted what the writer said it did would pass for a writer that
 * returned the right shape and stored the wrong row.
 */

const SESSION = 'session-1';
const RENDITION = 'turn-1.0';

const REQUEST: EnqueueRequest = {
  sessionId: SESSION,
  account: 'ned',
  renditionId: RENDITION,
  turnId: 'turn-1',
  purpose: 'illustration',
};

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  migrateState(db);
});

afterEach(() => {
  db.close();
});

/** Queues a try and returns it as the store now holds it. */
function queueATry(now: number): RenditionJob {
  enqueueRendition(db, REQUEST, now);
  const held = jobForRendition(db, RENDITION);
  if (held === null) throw new Error('enqueue stored nothing');
  return held;
}

/** The first try, run to the end — the state the retry button is pressed in. */
function aFinishedFirstTry(): RenditionJob {
  const first = queueATry(1);
  setRenditionJobStatus(db, first.id, 'running', null, 2);
  setRenditionJobStatus(db, first.id, 'done', 'retryable', 3);
  return first;
}

describe('a retry is a new job with the next number', () => {
  it('queues a second row rather than re-running the first', () => {
    const first = aFinishedFirstTry();
    expect(first.attempt).toBe(1);

    const retry = queueATry(10);
    expect(retry.id).not.toBe(first.id);
    expect(retry.attempt).toBe(2);
    expect(retry.status).toBe('queued');
    expect(retry.finishedAt).toBeNull();

    // **Running, and still owed** — the property the old index broke. The
    // finished row's `finished_at` rode along onto the retry, and this list,
    // which is `finished_at is null`, came back empty.
    setRenditionJobStatus(db, retry.id, 'running', null, 11);
    expect(pendingRenditionJobs(db, SESSION)).toEqual([
      expect.objectContaining({ id: retry.id, attempt: 2, status: 'running', finishedAt: null }),
    ]);

    // And the first try is history rather than a thing that was reset: its own
    // outcome and its own finish time, which is what *how many times was this
    // paid for, and what happened each time* is answered from.
    expect(readRenditionJob(db, first.id)).toEqual(
      expect.objectContaining({ status: 'done', error: 'retryable', finishedAt: 3, attempt: 1 }),
    );
  });

  /**
   * ***The restart case.*** A process that died holding the retry leaves it
   * live, and the next boot has to find it — or the job is `running` forever
   * and the record behind it is a placeholder nobody can press.
   */
  it('is what boot recovery finds when the process died holding it', () => {
    const first = aFinishedFirstTry();
    const retry = queueATry(10);
    setRenditionJobStatus(db, retry.id, 'running', null, 11);

    const { interrupted } = reconcileRenditionJobs(db, 20);

    expect(interrupted.map((job) => job.id)).toEqual([retry.id]);
    expect(readRenditionJob(db, retry.id)).toEqual(
      expect.objectContaining({ status: 'abandoned', error: 'interrupted', finishedAt: 20 }),
    );
    // Recovery touches what was in flight and nothing it had already finished.
    expect(readRenditionJob(db, first.id)).toEqual(
      expect.objectContaining({ status: 'done', error: 'retryable', finishedAt: 3 }),
    );
    expect(pendingRenditionJobs(db, SESSION)).toEqual([]);
  });

  it('never resets the number, whatever the last try came to', () => {
    aFinishedFirstTry();
    const second = queueATry(10);
    reconcileRenditionJobs(db, 20);

    // The abandoned second try still counts: it was dispatched, and a provider
    // may well have been paid for it before the process died.
    expect(readRenditionJob(db, second.id)?.status).toBe('abandoned');
    expect(queueATry(30).attempt).toBe(3);
  });
});

describe('one live job per rendition', () => {
  /**
   * ***Idempotent while live, and saying so.*** A second enqueue while a job
   * is in flight is the double dispatch the constraint exists to stop, and
   * `created` is how the caller tells *I queued this* from *somebody already
   * had* — the dispatcher runs only the first, which is what stops a second
   * image call on one job.
   */
  it('hands back the live job, and creates nothing', () => {
    const first = enqueueRendition(db, REQUEST, 1);
    expect(first.created).toBe(true);

    const again = enqueueRendition(db, REQUEST, 2);
    expect(again.created).toBe(false);
    expect(again.job.id).toBe(first.job.id);

    const rows = db
      .prepare(`select count(*) as n from rendition_job where rendition_id = ?`)
      .get(RENDITION) as { n: number };
    expect(rows.n).toBe(1);
  });

  it('creates the next one once the live one has finished', () => {
    const first = enqueueRendition(db, REQUEST, 1);
    setRenditionJobStatus(db, first.job.id, 'done', null, 2);

    const next = enqueueRendition(db, REQUEST, 3);
    expect(next.created).toBe(true);
    expect(next.job.id).not.toBe(first.job.id);
    expect(next.job.attempt).toBe(2);
  });

  /**
   * **Enforced by the store rather than by this module's care.** A writer that
   * skipped the live-row check would meet the constraint here, which is the
   * same arrangement as `job_one_active_per_session` for turns.
   */
  it('refuses a second live row for one rendition at the constraint', () => {
    enqueueRendition(db, REQUEST, 1);
    expect(() =>
      db
        .prepare(
          `insert into rendition_job (id, session_id, account, rendition_id, turn_id, purpose,
                                      status, attempt, created_at, updated_at)
           values ('sneaky', ?, 'ned', ?, 'turn-1', 'illustration', 'queued', 2, 5, 5)`,
        )
        .run(SESSION, RENDITION),
    ).toThrow(/UNIQUE/);
  });
});
