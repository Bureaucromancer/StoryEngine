// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateState } from '../state/migrations.js';
import { enqueueRendition, jobForRendition, setRenditionJobStatus } from './jobs.js';

/**
 * ***A rendition job is one per record, and a record is its session plus its
 * id*** — [06 §10.2](../../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * Rendition ids are `<turnId>.<n>`, and session import keeps turn ids, so a copy
 * of a session on the install that exported it holds records whose ids are the
 * original's. The falsifying mutation is keying the job by the id alone: the
 * copy's Illustrate would then be handed the original's job, and the worker —
 * which reads the record at the job's own session — would redraw the original
 * while the copy waited forever.
 */

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  migrateState(db);
});

afterEach(() => {
  db.close();
});

function ask(sessionId: string): ReturnType<typeof enqueueRendition> {
  return enqueueRendition(db, {
    sessionId,
    account: 'ned',
    renditionId: 'turn-1.0',
    turnId: 'turn-1',
    purpose: 'illustration',
  });
}

describe('queuing a picture', () => {
  /**
   * ***A job still working is returned, and said not to be new*** — the half
   * that makes a repeated dispatch safe. The caller that did not make the job
   * must not start it, or two workers race to write one record.
   */
  it('returns the live job for the same record, marked as not made here', () => {
    const first = ask('session-original');
    const again = ask('session-original');
    expect(first.fresh).toBe(true);
    expect(again.fresh).toBe(false);
    expect(again.job.id).toBe(first.job.id);
  });

  it('queues a separate job for the same id in another session', () => {
    const original = ask('session-original').job;
    const copy = ask('session-copy').job;

    expect(copy.id).not.toBe(original.id);
    expect(copy.sessionId).toBe('session-copy');
    expect(jobForRendition(db, 'session-copy', 'turn-1.0')?.id).toBe(copy.id);
    expect(jobForRendition(db, 'session-original', 'turn-1.0')?.id).toBe(original.id);
  });
});

/**
 * ***A retry is a new job with the next number*** — what the table's own
 * comment on `attempt` always said, and what the code did not do until
 * 2026-09-27: the finished row came back and was run again under attempt 1, so
 * every retry overwrote the only record of how often a picture had been paid
 * for.
 */
describe('trying again', () => {
  it('makes a new job once the last one has finished, one attempt higher', () => {
    const first = ask('session-original').job;
    setRenditionJobStatus(db, first.id, 'done');

    const retry = ask('session-original');
    expect(retry.fresh).toBe(true);
    expect(retry.job.id).not.toBe(first.id);
    expect(retry.job.attempt).toBe(2);

    setRenditionJobStatus(db, retry.job.id, 'abandoned', 'interrupted');
    expect(ask('session-original').job.attempt).toBe(3);
  });

  it('keeps the finished jobs, and names the newest as the record’s job', () => {
    const first = ask('session-original').job;
    setRenditionJobStatus(db, first.id, 'done');
    const retry = ask('session-original').job;

    expect(jobForRendition(db, 'session-original', 'turn-1.0')?.id).toBe(retry.id);
    const rows = db.prepare(`select attempt from rendition_job order by attempt`).all() as {
      attempt: number;
    }[];
    expect(rows.map((row) => row.attempt)).toEqual([1, 2]);
  });
});
