// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { createSession, type SessionContext } from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import {
  checkpoint,
  type JobContext,
  readJob,
  submitTurn,
  type ProgressEvent,
} from '../state/jobs.js';
import { openState, type OpenedState } from '../state/open.js';
import { Layout } from '../storage/layout.js';
import { type Listener, TurnStream } from './bus.js';

/**
 * The fan-out — [09 §3.1], [19 §8].
 *
 * Two of these tests exist because a design review found the failures first:
 * a listener that throws must not be able to reach the commit protocol, and a
 * client that attaches from inside another client's delivery must not receive a
 * frame twice. Both are one line of implementation and neither is discoverable
 * from ordinary use.
 */

let dataDir: string;
let index: OpenedIndex;
let state: OpenedState;
let sessions: SessionContext;
let bus: TurnStream;
let context: JobContext;
let sessionId: string;

const ACCOUNT = 'ned';

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-bus-'));
  index = await openIndex({ path: ':memory:' });
  state = await openState({ path: ':memory:' });
  sessions = { layout: new Layout(dataDir), index: index.db };
  bus = new TurnStream();
  context = { db: state.db, sessions, events: bus };
  sessionId = (await createSession(sessions, ACCOUNT, 'Rain City')).id;
});

afterEach(async () => {
  state.close();
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

function collector(): Listener & { events: ProgressEvent[]; deltas: string[] } {
  const events: ProgressEvent[] = [];
  const deltas: string[] = [];
  return {
    events,
    deltas,
    onEvents: (_jobId, batch) => events.push(...batch),
    onDelta: (_jobId, text) => deltas.push(text),
  };
}

async function reserve(): Promise<{ id: string; turnId: string }> {
  const outcome = await submitTurn(context, {
    account: ACCOUNT,
    sessionId,
    idempotencyKey: 'key-1',
    headTurnId: null,
  });
  if (outcome.kind !== 'created') throw new Error('expected a reservation');
  return outcome.job;
}

function draft(turnId: string): Turn {
  return {
    id: turnId,
    sessionId,
    parentTurnId: null,
    createdAt: new Date(Date.UTC(2026, 7, 16, 12)).toISOString(),
    status: 'failed',
    effects: [],
    tape: [],
  };
}

describe('a checkpoint reaches everyone watching the session', () => {
  it('publishes the events it just made durable', async () => {
    const job = await reserve();
    const watcher = collector();
    bus.subscribe(sessionId, watcher);

    checkpoint(context, job.id, {
      turn: draft(job.turnId),
      events: [{ key: 'turn.started', params: { turnId: job.turnId } }],
    });

    expect(watcher.events).toMatchObject([{ seq: 1, key: 'turn.started' }]);
  });

  it('takes the session from the job row, never from the draft', async () => {
    // `checkpoint`'s only trustworthy input is the job id. A draft naming
    // another session would otherwise fan this turn's frames — including its
    // text — to that session's subscribers.
    const job = await reserve();
    const mine = collector();
    const theirs = collector();
    bus.subscribe(sessionId, mine);
    bus.subscribe('some-other-session', theirs);

    checkpoint(context, job.id, {
      turn: { ...draft(job.turnId), sessionId: 'some-other-session' },
      events: [{ key: 'turn.started' }],
    });

    expect(mine.events).toHaveLength(1);
    expect(theirs.events).toHaveLength(0);
  });

  it('does not publish what a rollback undid', async () => {
    const job = await reserve();
    const watcher = collector();
    bus.subscribe(sessionId, watcher);

    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() =>
      checkpoint(context, job.id, {
        turn: draft(job.turnId),
        events: [{ key: 'turn.started' }, { key: 'step.started', params: circular }],
      }),
    ).toThrow();

    // The transaction rolled back, so the first event is not durable either —
    // and a client shown a step that never happened would have no way back.
    expect(watcher.events).toEqual([]);
  });

  it('unsubscribes idempotently', () => {
    const watcher = collector();
    const release = bus.subscribe(sessionId, watcher);

    expect(bus.subscriberCount(sessionId)).toBe(1);
    release();
    release();
    expect(bus.subscriberCount(sessionId)).toBe(0);
  });
});

describe('a broken subscriber breaks only itself', () => {
  it('cannot wedge the commit protocol', async () => {
    // The blocking one. `checkpoint` is called by the commit protocol *before*
    // the step that marks a job committed, so a listener throwing out of the
    // fan-out would leave the job at `commit_step = 3` with `finished_at` null
    // — the turn on disk, the head advanced, and the session refused as busy by
    // every later submission until a restart.
    const job = await reserve();
    const seen: unknown[] = [];
    bus.onListenerError = (error) => seen.push(error);

    bus.subscribe(sessionId, {
      onEvents: () => {
        throw new Error('this socket is in a state nobody measured');
      },
      onDelta: () => undefined,
    });
    const healthy = collector();
    bus.subscribe(sessionId, healthy);

    expect(() =>
      checkpoint(context, job.id, { turn: draft(job.turnId), events: [{ key: 'turn.started' }] }),
    ).not.toThrow();

    // The failure is visible rather than swallowed, the other subscriber still
    // got its frame, and the job is untouched.
    expect(seen).toHaveLength(1);
    expect(healthy.events).toHaveLength(1);
    expect(readJob(state.db, job.id)?.finishedAt).toBeNull();
  });
});

describe('attaching during a delivery', () => {
  it('does not hand the newcomer a frame twice', () => {
    // `Set` iteration visits entries added *during* iteration, so a client that
    // subscribes from inside another's callback would receive the very frame
    // its own backlog read already contains — a duplicate in a stream whose
    // whole promise is exactly-once.
    const late = collector();
    const first: Listener = {
      onEvents: () => bus.subscribe(sessionId, late),
      onDelta: () => undefined,
    };
    bus.subscribe(sessionId, first);

    bus.publish(sessionId, 'job-1', [{ seq: 1, key: 'turn.started', params: {}, at: 0 }]);

    expect(late.events).toEqual([]);
    // …and it is subscribed for whatever comes next.
    bus.publish(sessionId, 'job-1', [{ seq: 2, key: 'step.started', params: {}, at: 0 }]);
    expect(late.events).toMatchObject([{ seq: 2 }]);
  });
});

describe('the live text cell', () => {
  it('accumulates deltas and is cleared by the closing frame', () => {
    // A client attaching between two coalescing checkpoints would otherwise see
    // a draft whose text stops at the last checkpoint and then deltas that
    // begin after it attached — a hole no offset scheme closes over SSE.
    bus.delta(sessionId, 'job-1', 'The rain ');
    bus.delta(sessionId, 'job-1', 'had not stopped.');
    expect(bus.live('job-1')).toBe('The rain had not stopped.');

    bus.publish(sessionId, 'job-1', [
      { seq: 9, key: 'turn.finished', params: { state: 'complete' }, at: 0 },
    ]);
    expect(bus.live('job-1')).toBeNull();
  });
});
