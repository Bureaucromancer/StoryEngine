// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { readAllTurns } from '../sessions/segments.js';
import {
  appendTurnOnly,
  appendTurnToSession,
  createSession,
  moveHead,
  readSession,
  readTurns,
  sessionRoot,
} from '../sessions/store.js';
import type { ChannelEffect, Turn } from '../sessions/types.js';
import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { Layout } from '../storage/layout.js';
import {
  advanceCommit,
  type CommitContext,
  COMMIT_STEPS,
  finaliseTurn,
  reconcile,
  reconcileSession,
} from './commit.js';
import { checkpoint, type Job, readEvents, readJob, submitTurn } from './jobs.js';
import { openState, type OpenedState } from './open.js';

/**
 * The terminal commit protocol — [P2 §2.10].
 *
 * The protocol exists because a turn ends across three stores with no
 * transaction between them, so the tests are about **interruption**: after each
 * step, does resuming produce exactly one turn, one head advance and one set of
 * effects? A protocol that is merely usually right is indistinguishable from no
 * protocol at all until the day it is not.
 */

let dataDir: string;
let index: OpenedIndex;
let state: OpenedState;
let context: CommitContext;
let sessionId: string;

const ACCOUNT = 'ned';

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-commit-'));
  index = await openIndex({ path: ':memory:' });
  const sessions = { layout: new Layout(dataDir), index: index.db };
  state = await openState({ path: ':memory:' });
  context = { db: state.db, sessions };
  sessionId = (await createSession(sessions, ACCOUNT, 'Rain City')).id;
});

afterEach(async () => {
  state.close();
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

const CLOCK = 'se.clock';

function clockEffect(turnId: string, hour: number): ChannelEffect {
  return {
    id: uuidv7(),
    turnId,
    channelId: CLOCK,
    scopeKey: null,
    op: { type: 'set', path: '/' },
    before: { hour: hour - 1 },
    after: { hour },
    proposedBy: { kind: 'engine' },
    applied: true,
    rejectedReason: null,
    supersedes: null,
    channelVersion: 1,
    scope: 'session',
  };
}

function terminalTurn(job: Job, status: Turn['status'] = 'complete', hour = 9): Turn {
  return {
    id: job.turnId,
    sessionId: job.sessionId,
    parentTurnId: job.parentTurnId,
    createdAt: new Date(Date.UTC(2026, 7, 16, hour)).toISOString(),
    status,
    effects: [clockEffect(job.turnId, hour)],
    tape: [],
  };
}

async function reserve(key = 'key-1', headTurnId: string | null = null): Promise<Job> {
  const outcome = await submitTurn(context, {
    account: ACCOUNT,
    sessionId,
    idempotencyKey: key,
    headTurnId,
  });
  if (outcome.kind !== 'created') throw new Error(`expected a reservation, got ${outcome.kind}`);
  return outcome.job;
}

/**
 * Everything the commit is supposed to have produced, read from where it lives.
 *
 * **The turns come from `readAllTurns`, not `readTurns`.** The latter returns a
 * map keyed by turn id, which silently collapses a duplicate — and "was this
 * turn appended twice?" is the single most important question these tests ask.
 * Measured: with the step-2 idempotency check removed, the map-based version of
 * this helper still passed.
 */
async function stateOnDisk(): Promise<{
  turns: string[];
  head: string | null;
  clock: unknown;
}> {
  const written = await readAllTurns(
    join(sessionRoot(context.sessions.layout, ACCOUNT, sessionId), 'turns'),
  );
  const session = await readSession(context.sessions, ACCOUNT, sessionId);
  return {
    turns: written.map(({ turn }) => turn.id),
    head: session?.headTurnId ?? null,
    clock: session?.channels[CLOCK]?.value ?? null,
  };
}

describe('finalisation is a protocol, and it survives being interrupted', () => {
  it('commits a turn through all four steps', async () => {
    const job = await reserve();
    const turn = terminalTurn(job);

    const committed = await finaliseTurn(context, job.id, turn);

    expect(committed.status).toBe('committed');
    expect(committed.commitStep).toBe(COMMIT_STEPS);
    expect(await stateOnDisk()).toEqual({
      turns: [turn.id],
      head: turn.id,
      clock: { hour: 9 },
    });

    // Published last, after the record it announces is durable in all three
    // places.
    expect(readEvents(context, job.id).at(-1)).toMatchObject({
      key: 'turn.finished',
      params: { state: 'complete' },
    });
  });

  // The heart of it: stop after each step, resume, and assert the same end
  // state with nothing done twice.
  for (const stopAfter of [1, 2, 3]) {
    it(`recovers from an interruption after step ${String(stopAfter)}`, async () => {
      const job = await reserve();
      const turn = terminalTurn(job);

      let partial = job;
      for (let step = 0; step < stopAfter; step += 1) {
        partial = await advanceCommit(context, partial, turn);
      }
      expect(partial.commitStep).toBe(stopAfter);
      expect(partial.status).toBe('finalising');

      // The restart: nothing carried over but the job row and the draft.
      const resumed = await finaliseTurn(context, job.id, turn);

      expect(resumed.status).toBe('committed');
      expect(await stateOnDisk()).toEqual({ turns: [turn.id], head: turn.id, clock: { hour: 9 } });
      expect(
        readEvents(context, job.id).filter((event) => event.key === 'turn.finished'),
      ).toHaveLength(1);
    });
  }

  it('does not append the turn twice when step 2 ran but its bump did not', async () => {
    // The specific crash the `turnId`-at-reservation decision exists for: the
    // append succeeded, the process died before `commit_step` moved, and the
    // resume runs step 2 again.
    const job = await reserve();
    const turn = terminalTurn(job);

    await advanceCommit(context, job, turn); // step 1
    await appendTurnOnly(context.sessions, ACCOUNT, sessionId, turn); // step 2, unrecorded

    const resumed = await finaliseTurn(context, job.id, turn);

    expect(resumed.status).toBe('committed');
    expect((await stateOnDisk()).turns).toEqual([turn.id]);
  });

  it('applies the effects exactly once across a resumed commit', async () => {
    // The head is a *set* and the channel map is recomputed from the turn's
    // effects, so this holds by construction rather than by a guard — and this
    // test is what keeps it that way.
    const job = await reserve();
    const turn = terminalTurn(job);

    let partial = job;
    for (let step = 0; step < 3; step += 1) {
      partial = await advanceCommit(context, partial, turn);
    }
    expect(partial.commitStep).toBe(3);

    // Resuming re-runs nothing before step 4 — but if it ever did, applying
    // this turn's effects a second time is the failure that would show here.
    await finaliseTurn(context, job.id, turn);

    expect((await stateOnDisk()).clock).toEqual({ hour: 9 });
  });

  it('frees the session once the job commits', async () => {
    const job = await reserve();
    const turn = terminalTurn(job);
    await finaliseTurn(context, job.id, turn);

    const next = await submitTurn(context, {
      account: ACCOUNT,
      sessionId,
      idempotencyKey: 'key-2',
      headTurnId: turn.id,
    });
    expect(next.kind).toBe('created');
    expect(next.kind === 'created' && next.job.parentTurnId).toBe(turn.id);
  });
});

describe('startup reconciliation resumes finalisation, never generation', () => {
  it('commits a job that died mid-generation as a failed turn', async () => {
    // What the draft's terminal-ready `failed` status is for. The blocks and
    // calls checkpointed so far survive as a record somebody can re-run, rather
    // than as a turn that never happened.
    const job = await reserve();
    const draft = terminalTurn(job, 'failed');
    checkpoint(context, job.id, {
      turn: draft,
      events: [{ key: 'turn.started', params: { turnId: job.turnId } }],
    });

    const result = await reconcile(context);

    expect(result.finalised).toEqual([job.id]);
    expect(readJob(state.db, job.id)?.status).toBe('committed');

    const turns = await readTurns(context.sessions, ACCOUNT, sessionId);
    expect(turns.get(draft.id)?.status).toBe('failed');
    expect((await stateOnDisk()).head).toBe(draft.id);
  });

  it('resumes a job interrupted part-way through the protocol', async () => {
    const job = await reserve();
    const turn = terminalTurn(job);
    await advanceCommit(context, job, turn); // step 1 only

    const result = await reconcile(context);

    expect(result.finalised).toEqual([job.id]);
    expect((await stateOnDisk()).turns).toEqual([turn.id]);
  });

  it('abandons a job that never checkpointed anything', async () => {
    // Reserved, then died. There is nothing to write, and an empty failed turn
    // would be a meaningless entry in somebody's story — but the session must
    // not stay blocked by a turn that never happened.
    const job = await reserve();

    const result = await reconcile(context);

    expect(result.abandoned).toEqual([job.id]);
    expect(readJob(state.db, job.id)?.status).toBe('abandoned');
    expect((await stateOnDisk()).turns).toEqual([]);

    const next = await submitTurn(context, {
      account: ACCOUNT,
      sessionId,
      idempotencyKey: 'key-2',
      headTurnId: null,
    });
    expect(next.kind).toBe('created');
  });

  it('abandons a job whose session is gone', async () => {
    const job = await reserve();
    checkpoint(context, job.id, { turn: terminalTurn(job, 'failed') });
    await rm(context.sessions.layout.sessionRoot(ACCOUNT, sessionId), {
      recursive: true,
      force: true,
    });

    expect((await reconcile(context)).abandoned).toEqual([job.id]);
  });

  it('is safe to run twice', async () => {
    const job = await reserve();
    checkpoint(context, job.id, { turn: terminalTurn(job, 'failed') });

    await reconcile(context);
    const second = await reconcile(context);

    // A committed job is not active, so the second pass has nothing to look at.
    expect(second).toEqual({ finalised: [], abandoned: [], failed: [] });
    expect((await stateOnDisk()).turns).toHaveLength(1);
  });
});

describe('a turn on disk with no job is reconciled into the session', () => {
  /** A turn with no job behind it — which is the situation under test. */
  function orphanTurn(parentTurnId: string | null, hour: number): Turn {
    const id = uuidv7();
    return {
      id,
      sessionId,
      parentTurnId,
      createdAt: new Date(Date.UTC(2026, 7, 16, hour)).toISOString(),
      status: 'complete',
      effects: [clockEffect(id, hour)],
      tape: [],
    };
  }

  it('links an appended turn the head never caught up to', async () => {
    // [P2 §2.10]'s deleted-`state.sqlite` case: an uncommitted draft can be
    // lost, but a turn already in a segment must be reconciled rather than
    // duplicated or discarded. With the store gone there is no job to resume
    // from, so the segments are the evidence.
    const job = await reserve();
    const turn = terminalTurn(job);
    await appendTurnOnly(context.sessions, ACCOUNT, sessionId, turn);

    expect(await reconcileSession(context.sessions, ACCOUNT, sessionId)).toBe(1);

    expect(await stateOnDisk()).toEqual({ turns: [turn.id], head: turn.id, clock: { hour: 9 } });
  });

  it('walks a run of them in order', async () => {
    const first = orphanTurn(null, 9);
    const second = orphanTurn(first.id, 10);
    await appendTurnOnly(context.sessions, ACCOUNT, sessionId, first);
    await appendTurnOnly(context.sessions, ACCOUNT, sessionId, second);

    expect(await reconcileSession(context.sessions, ACCOUNT, sessionId)).toBe(2);
    const after = await stateOnDisk();
    expect(after.head).toBe(second.id);
    // Replayed in order, so the clock reads the later turn's value rather than
    // whichever effect happened to be applied last.
    expect(after.clock).toEqual({ hour: 10 });
  });

  it('stops at a fork rather than choosing a branch', async () => {
    // Two children of the same head is a branch, and P2 has no semantics for
    // picking one ([07 §4]). Guessing would silently choose somebody's story.
    await appendTurnOnly(context.sessions, ACCOUNT, sessionId, orphanTurn(null, 9));
    await appendTurnOnly(context.sessions, ACCOUNT, sessionId, orphanTurn(null, 10));

    expect(await reconcileSession(context.sessions, ACCOUNT, sessionId)).toBe(0);
    expect((await stateOnDisk()).head).toBeNull();
  });

  /**
   * ***A head somebody parked stays parked*** (2026-09-27). *Continue from
   * here* leaves the head on a turn with one child, which is exactly the shape
   * this walk advances over, and the walk ran at every start: every restart put
   * the story back at its tip.
   */
  describe('with the operational store intact', () => {
    /** A line of three turns, played, with the head moved back to the first. */
    async function parkedOnFirstOfThree(): Promise<string[]> {
      const played: string[] = [];
      for (const hour of [9, 10, 11]) {
        const turn = { ...orphanTurn(played.at(-1) ?? null, hour) };
        await appendTurnToSession(context.sessions, ACCOUNT, sessionId, turn);
        played.push(turn.id);
      }
      const moved = await moveHead(context.sessions, ACCOUNT, sessionId, played[0] ?? '');
      expect(moved.kind).toBe('moved');
      return played;
    }

    it('leaves a parked head where it was put', async () => {
      const [first] = await parkedOnFirstOfThree();

      const advanced = await reconcileSession(context.sessions, ACCOUNT, sessionId, {
        sinceLastWrite: true,
      });

      expect(advanced).toBe(0);
      expect((await stateOnDisk()).head).toBe(first);
    });

    it('still links a turn appended after the last write', async () => {
      // The crash case the walk is still for: an append whose head never
      // caught up, after the head was parked. It is a sibling of the old
      // child, and the only one the last write did not already know about.
      const [first] = await parkedOnFirstOfThree();
      const orphan: Turn = {
        ...orphanTurn(first ?? null, 12),
        createdAt: new Date(Date.now() + 1000).toISOString(),
      };
      await appendTurnOnly(context.sessions, ACCOUNT, sessionId, orphan);

      const advanced = await reconcileSession(context.sessions, ACCOUNT, sessionId, {
        sinceLastWrite: true,
      });

      expect(advanced).toBe(1);
      expect((await stateOnDisk()).head).toBe(orphan.id);
    });
  });
});
