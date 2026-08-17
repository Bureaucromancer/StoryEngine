// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import {
  appendTurnToSession,
  createSession,
  type SessionContext,
  withSessionLock,
} from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { Layout } from '../storage/layout.js';
import {
  activeJob,
  checkpoint,
  type JobContext,
  readDraft,
  readEvents,
  readJob,
  setJobStatus,
  submitTurn,
} from './jobs.js';
import { openState, type OpenedState } from './open.js';

/**
 * The operational store — [13 §5.1], [P2 §2.10].
 *
 * What is being tested is a *concurrency contract*, so the tests are shaped
 * around the three answers submission can give rather than around the functions
 * that give them: your job already exists, something else is advancing this
 * session, or the head you composed against has moved.
 */

let dataDir: string;
let sessions: SessionContext;
let index: OpenedIndex;
let state: OpenedState;
let context: JobContext;
let sessionId: string;

const ACCOUNT = 'ned';

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-state-'));
  index = await openIndex({ path: ':memory:' });
  sessions = { layout: new Layout(dataDir), index: index.db };
  state = await openState({ path: ':memory:' });
  context = { db: state.db, sessions };
  sessionId = (await createSession(sessions, ACCOUNT, 'Rain City')).id;
});

afterEach(async () => {
  state.close();
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

function submission(overrides: Partial<Parameters<typeof submitTurn>[1]> = {}) {
  return {
    account: ACCOUNT,
    sessionId,
    idempotencyKey: 'key-1',
    headTurnId: null,
    ...overrides,
  };
}

function draftTurn(job: { turnId: string; parentTurnId: string | null }): Turn {
  return {
    id: job.turnId,
    sessionId,
    parentTurnId: job.parentTurnId,
    createdAt: new Date(Date.UTC(2026, 7, 16, 12)).toISOString(),
    // Terminal-ready from the first checkpoint, which is what makes a job that
    // dies mid-generation recoverable as a failed turn rather than as nothing.
    status: 'failed',
    effects: [],
    tape: [],
  };
}

describe('one turn advances a session at a time', () => {
  it('reserves a job, and returns the same one to a retry', async () => {
    const first = await submitTurn(context, submission());
    expect(first.kind).toBe('created');

    // The retry: same key, same everything. A browser that reconnects mid-turn
    // resubmits, and a second provider call is the thing that charges twice.
    const again = await submitTurn(context, submission());
    expect(again.kind).toBe('existing');
    expect(again.kind === 'existing' && first.kind === 'created' && again.job.id).toBe(
      first.kind === 'created' ? first.job.id : null,
    );

    const jobs = state.db.prepare('select count(*) c from job').get() as { c: number };
    expect(jobs.c).toBe(1);
  });

  it('refuses a second submission while one is active, and says which job', async () => {
    const first = await submitTurn(context, submission());
    const second = await submitTurn(context, submission({ idempotencyKey: 'key-2' }));

    expect(second.kind).toBe('busy');
    // The current job travels with the rejection, because a UI given a bare
    // "no" can only offer "try again" — which produces the same "no".
    expect(second.kind === 'busy' && second.job.id).toBe(first.kind === 'created' && first.job.id);
  });

  it('lets the next turn start once the first job is terminal', async () => {
    const first = await submitTurn(context, submission());
    if (first.kind !== 'created') throw new Error('expected a reservation');

    setJobStatus(context, first.job.id, 'committed');
    expect(activeJob(state.db, sessionId)).toBeNull();

    // The head has not moved — nothing appended a turn — so the next submission
    // composes against the same null head.
    const second = await submitTurn(context, submission({ idempotencyKey: 'key-2' }));
    expect(second.kind).toBe('created');
  });

  it('rejects a submission composed against a stale head', async () => {
    // Someone else's turn landed while this client was typing. Queuing the work
    // anyway would apply it to a context that has already changed.
    const first = await submitTurn(context, submission());
    if (first.kind !== 'created') throw new Error('expected a reservation');
    setJobStatus(context, first.job.id, 'committed');

    const turn = draftTurn(first.job);
    await appendTurnToSession(sessions, ACCOUNT, sessionId, { ...turn, status: 'complete' });

    const stale = await submitTurn(context, submission({ idempotencyKey: 'key-2' }));
    expect(stale.kind).toBe('stale');
    // With the head it should have used, so the client can rebase rather than
    // guess.
    expect(stale.kind === 'stale' && stale.head).toBe(turn.id);

    const rebased = await submitTurn(
      context,
      submission({ idempotencyKey: 'key-3', headTurnId: turn.id }),
    );
    expect(rebased.kind).toBe('created');
    expect(rebased.kind === 'created' && rebased.job.parentTurnId).toBe(turn.id);
  });

  it('answers a retry even when the head has since moved', async () => {
    // Order matters in the decision: the idempotency lookup comes first, or a
    // client reconnecting after its own turn landed would be told its own job
    // was composed against a stale head.
    const first = await submitTurn(context, submission());
    if (first.kind !== 'created') throw new Error('expected a reservation');

    await appendTurnToSession(sessions, ACCOUNT, sessionId, {
      ...draftTurn(first.job),
      status: 'complete',
    });

    const retry = await submitTurn(context, submission());
    expect(retry.kind).toBe('existing');
  });

  it('refuses a submission for a session that is not there', async () => {
    const gone = await submitTurn(context, submission({ sessionId: uuidv7() }));
    expect(gone.kind).toBe('no-session');
  });

  it('holds one active job per session in the database, not only in the code', async () => {
    const first = await submitTurn(context, submission());
    if (first.kind !== 'created') throw new Error('expected a reservation');

    // The check in `submitTurn` runs under a per-session lock, which is the
    // right place for it — but a constraint that exists only in code is one
    // refactor away from not existing. The partial unique index is the backstop,
    // so it gets asserted directly.
    expect(() =>
      state.db
        .prepare(
          `insert into job (id, session_id, account, parent_turn_id, turn_id, status,
                            commit_step, created_at, updated_at, finished_at)
             values (?, ?, ?, null, ?, 'queued', 0, 0, 0, null)`,
        )
        .run(uuidv7(), sessionId, ACCOUNT, uuidv7()),
    ).toThrow(/unique/i);
  });

  it('serialises two submissions that arrive at once', async () => {
    // The lock is the whole mechanism; without it both calls read "no active
    // job" before either inserts one.
    const [a, b] = await Promise.all([
      submitTurn(context, submission({ idempotencyKey: 'a' })),
      submitTurn(context, submission({ idempotencyKey: 'b' })),
    ]);

    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(['busy', 'created']);
  });
});

describe('the draft is checkpointed with its events', () => {
  it('sequences events in the transaction that writes the draft they describe', async () => {
    const submitted = await submitTurn(context, submission());
    if (submitted.kind !== 'created') throw new Error('expected a reservation');
    const { job } = submitted;

    const first = checkpoint(context, job.id, {
      turn: draftTurn(job),
      events: [{ key: 'turn.started', params: { turnId: job.turnId } }],
    });
    const second = checkpoint(context, job.id, {
      turn: { ...draftTurn(job), status: 'complete' },
      events: [{ key: 'turn.finished', params: { status: 'complete' } }],
    });

    expect(first.map((event) => event.seq)).toEqual([1]);
    expect(second.map((event) => event.seq)).toEqual([2]);

    // A reader that has seen sequence N has seen every draft state up to N —
    // which is only true because the two are written together.
    expect(readDraft(context, job.id)?.status).toBe('complete');
    expect(readEvents(context, job.id).map((event) => event.key)).toEqual([
      'turn.started',
      'turn.finished',
    ]);
  });

  it('reads strictly after a cursor, so a reattach does not redeliver', async () => {
    const submitted = await submitTurn(context, submission());
    if (submitted.kind !== 'created') throw new Error('expected a reservation');
    const { job } = submitted;

    checkpoint(context, job.id, {
      turn: draftTurn(job),
      events: [{ key: 'turn.started' }, { key: 'step.started' }, { key: 'step.finished' }],
    });

    expect(readEvents(context, job.id, 2).map((event) => event.seq)).toEqual([3]);
    expect(readEvents(context, job.id, 3)).toEqual([]);
  });

  it('carries params rather than prose', async () => {
    // [01 §2]: the server does not know the reader's language, and an event
    // carrying English is a string that cannot be translated later.
    const submitted = await submitTurn(context, submission());
    if (submitted.kind !== 'created') throw new Error('expected a reservation');

    checkpoint(context, submitted.job.id, {
      turn: draftTurn(submitted.job),
      events: [{ key: 'step.failed', params: { stepId: 'narrate', attempt: 2 } }],
    });

    expect(readEvents(context, submitted.job.id)[0]).toMatchObject({
      key: 'step.failed',
      params: { stepId: 'narrate', attempt: 2 },
    });
  });

  it('rolls back the whole checkpoint when one part of it fails', async () => {
    const submitted = await submitTurn(context, submission());
    if (submitted.kind !== 'created') throw new Error('expected a reservation');
    const { job } = submitted;

    checkpoint(context, job.id, { turn: draftTurn(job), events: [{ key: 'turn.started' }] });

    // Params that cannot be serialised. It stands in for anything that could
    // fail after the draft row is written: the draft must not advance without
    // the event that announces it, or a reattaching client would be handed a
    // snapshot whose last event never happened.
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(() =>
      checkpoint(context, job.id, {
        turn: { ...draftTurn(job), status: 'complete' },
        events: [{ key: 'turn.finished', params: circular }],
      }),
    ).toThrow();

    expect(readDraft(context, job.id)?.status).toBe('failed');
    expect(readEvents(context, job.id)).toHaveLength(1);
  });
});

describe('the store keeps what the index would throw away', () => {
  it('survives a reopen with its jobs, reservations and drafts intact', async () => {
    // The property the whole index/operational split exists for
    // ([13 §5.1]): deleting the index is a non-event, and this is the database
    // where that is emphatically not true.
    const path = join(dataDir, 'state', 'state.sqlite');
    const first = await openState({ path });
    const local: JobContext = { db: first.db, sessions };

    const submitted = await submitTurn(local, submission());
    if (submitted.kind !== 'created') throw new Error('expected a reservation');
    checkpoint(local, submitted.job.id, {
      turn: draftTurn(submitted.job),
      events: [{ key: 'turn.started' }],
    });
    first.close();

    const second = await openState({ path });
    try {
      const reopened: JobContext = { db: second.db, sessions };
      expect(readJob(second.db, submitted.job.id)?.turnId).toBe(submitted.job.turnId);
      expect(readDraft(reopened, submitted.job.id)).not.toBeNull();
      expect(readEvents(reopened, submitted.job.id)).toHaveLength(1);

      // And the retry still finds its reservation, which is the point of
      // durability here rather than a nice property of it.
      const retry = await submitTurn(reopened, submission());
      expect(retry.kind).toBe('existing');
    } finally {
      second.close();
    }
  });

  it('migrates forward without dropping anything', async () => {
    const path = join(dataDir, 'state', 'migrate.sqlite');
    const first = await openState({ path });
    expect(first.migration.from).toBe(0);
    const submitted = await submitTurn({ db: first.db, sessions }, submission());
    first.close();

    const second = await openState({ path });
    try {
      // Nothing to do, and — the part that matters — nothing dropped.
      expect(second.migration.from).toBe(second.migration.to);
      expect(
        readJob(second.db, submitted.kind === 'created' ? submitted.job.id : ''),
      ).not.toBeNull();
    } finally {
      second.close();
    }
  });

  it('refuses a store written by a newer build rather than migrating it down', async () => {
    const path = join(dataDir, 'state', 'future.sqlite');
    const opened = await openState({ path });
    opened.db.exec('pragma user_version = 99');
    opened.close();

    await expect(openState({ path })).rejects.toThrow(/newer StoryEngine/);
  });
});

describe('the session lock is shared, not merely similar', () => {
  it('makes a submission wait for an append that is already running', async () => {
    // Two locks with the same shape would let a submission read a head that an
    // append is in the middle of moving — which is the one interleaving [P2
    // §2.10] is written to prevent.
    const order: string[] = [];

    const held = withSessionLock(sessionId, async () => {
      order.push('append:start');
      await new Promise((tick) => setTimeout(tick, 20));
      order.push('append:end');
    });

    const submitted = submitTurn(context, submission()).then(() => order.push('submit'));

    await Promise.all([held, submitted]);
    expect(order).toEqual(['append:start', 'append:end', 'submit']);
  });
});
