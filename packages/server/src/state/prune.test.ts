// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { createSession, type SessionContext } from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import { Layout } from '../storage/layout.js';
import { eventually } from '../test-server.js';
import {
  checkpoint,
  type JobContext,
  readDraft,
  readEvents,
  setJobStatus,
  submitTurn,
} from './jobs.js';
import { openState, type OpenedState } from './open.js';
import { pruneOperationalStore, startOperationalPrune } from './prune.js';

/**
 * ***The operational store, collected*** (2026-09-27) — `state/prune.ts`.
 *
 * P2 §2.10 said a finished turn's draft *may be collected* and its events *may
 * be pruned*, and nothing ever deleted a row, so every turn anybody played
 * stayed in `state.sqlite` twice over, and outlived the purge of its session.
 * Each case below is one of the prune's rules, and the ages are given, not
 * waited for.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 27, 12);

let dataDir: string;
let index: OpenedIndex;
let state: OpenedState;
let context: JobContext;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-prune-'));
  index = await openIndex({ path: ':memory:' });
  const sessions: SessionContext = { layout: new Layout(dataDir), index: index.db };
  state = await openState({ path: ':memory:' });
  context = { db: state.db, sessions };
});

afterEach(async () => {
  state.close();
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function aSession(): Promise<string> {
  return (await createSession(context.sessions, 'ned', 'Rain City')).id;
}

/**
 * A turn submitted an hour before `finishedAt`, checkpointed with two events,
 * and finished (or not) at `finishedAt`.
 */
async function aTurn(
  sessionId: string,
  key: string,
  finishedAt: number | null,
  submittedAt = (finishedAt ?? NOW) - HOUR,
): Promise<string> {
  const submitted = await submitTurn(
    context,
    { account: 'ned', sessionId, idempotencyKey: key, headTurnId: null },
    submittedAt,
  );
  if (submitted.kind !== 'created')
    throw new Error(`expected a reservation, got ${submitted.kind}`);
  const turn: Turn = {
    id: submitted.job.turnId,
    sessionId,
    parentTurnId: null,
    createdAt: new Date(submittedAt).toISOString(),
    status: 'failed',
    effects: [],
    tape: [],
  };
  checkpoint(
    context,
    submitted.job.id,
    { turn, events: [{ key: 'turn.started' }, { key: 'turn.finished' }] },
    submittedAt,
  );
  if (finishedAt !== null) setJobStatus(context, submitted.job.id, 'committed', finishedAt);
  return submitted.job.id;
}

function kept(jobId: string): boolean {
  return readDraft(context, jobId) !== null && readEvents(context, jobId).length > 0;
}

function gone(jobId: string): boolean {
  return readDraft(context, jobId) === null && readEvents(context, jobId).length === 0;
}

function keys(): string[] {
  return (
    state.db.prepare('select key from idempotency order by key').all() as { key: string }[]
  ).map((row) => row.key);
}

const everySessionExists = () => Promise.resolve(true);

describe('a finished turn in the operational store', () => {
  it('loses its draft and events a day after it finished, and the job row stays', async () => {
    const sessionId = await aSession();
    const old = await aTurn(sessionId, 'k1', NOW - 3 * DAY);
    const latest = await aTurn(sessionId, 'k2', NOW - 2 * DAY);

    const pruned = await pruneOperationalStore(state.db, {
      sessionExists: everySessionExists,
      now: NOW,
    });

    expect(gone(old)).toBe(true);
    expect(pruned).toMatchObject({ jobs: 1, events: 2 });
    // A cursor or a repeated key still resolves against it.
    expect(state.db.prepare('select id from job where id = ?').get(old)).toEqual({ id: old });
    // The session's latest is what an attach between turns is sent.
    expect(kept(latest)).toBe(true);
  });

  it('keeps one that finished within the day', async () => {
    const sessionId = await aSession();
    const recent = await aTurn(sessionId, 'k1', NOW - 2 * HOUR);
    await aTurn(sessionId, 'k2', NOW - HOUR);

    await pruneOperationalStore(state.db, { sessionExists: everySessionExists, now: NOW });

    expect(kept(recent)).toBe(true);
  });

  it('keeps nothing for a session that has gone', async () => {
    // Deleted, and then purged from the trash: its prose must not outlive it here.
    const sessionId = await aSession();
    const latest = await aTurn(sessionId, 'k1', NOW - 2 * DAY);

    await pruneOperationalStore(state.db, {
      sessionExists: () => Promise.resolve(false),
      now: NOW,
    });

    expect(gone(latest)).toBe(true);
  });

  it('never touches a job that has not finished', async () => {
    const sessionId = await aSession();
    const running = await aTurn(sessionId, 'k1', null, NOW - 30 * DAY);

    await pruneOperationalStore(state.db, {
      sessionExists: () => Promise.resolve(false),
      now: NOW,
    });

    expect(kept(running)).toBe(true);
  });
});

describe('an idempotency key', () => {
  it('goes a week after its job finished, and not before', async () => {
    const sessionId = await aSession();
    await aTurn(sessionId, 'old', NOW - 8 * DAY);
    await aTurn(sessionId, 'recent', NOW - 2 * DAY);

    const pruned = await pruneOperationalStore(state.db, {
      sessionExists: everySessionExists,
      now: NOW,
    });

    expect(keys()).toEqual(['recent']);
    expect(pruned.keys).toBe(1);
  });

  it('stays while its job is running, however old', async () => {
    await aTurn(await aSession(), 'running', null, NOW - 30 * DAY);

    await pruneOperationalStore(state.db, { sessionExists: everySessionExists, now: NOW });

    expect(keys()).toEqual(['running']);
  });
});

describe('the prune, on its timer', () => {
  it('runs shortly after a start', async () => {
    const sessionId = await aSession();
    const old = await aTurn(sessionId, 'k1', Date.now() - 3 * DAY);
    await aTurn(sessionId, 'k2', Date.now() - 2 * DAY);

    const prune = startOperationalPrune(state.db, everySessionExists, {
      startDelayMs: 10,
      clock: { jumped: () => false },
    });
    try {
      await eventually(() => Promise.resolve(gone(old)));
    } finally {
      prune.stop();
    }
  });

  it('skips a pass when the wall clock has jumped', async () => {
    const sessionId = await aSession();
    const old = await aTurn(sessionId, 'k1', Date.now() - 3 * DAY);
    await aTurn(sessionId, 'k2', Date.now() - 2 * DAY);
    const warned: string[] = [];

    const prune = startOperationalPrune(state.db, everySessionExists, {
      startDelayMs: 10,
      clock: { jumped: () => true },
    });
    prune.setLogger({
      child: () => {
        throw new Error('unused');
      },
      info: () => undefined,
      warn: (fields) => warned.push(String(fields['event'])),
      error: () => undefined,
    });
    try {
      await eventually(() => Promise.resolve(warned.length > 0));
      expect(warned).toEqual(['state.clockJumped']);
      expect(kept(old)).toBe(true);
    } finally {
      prune.stop();
    }
  });
});
