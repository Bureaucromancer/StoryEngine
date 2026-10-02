// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Accounts } from '../auth/accounts.js';
import { DEFAULT_CONFIG } from '../config.js';
import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { installBuiltIns } from '../mode-loader.js';
import { FakeProvider } from '../providers/fake.js';
import { readClock } from '../sessions/channels.js';
import { readAllTurns } from '../sessions/segments.js';
import * as store from '../sessions/store.js';
import { createSession, readSession, type SessionContext } from '../sessions/store.js';
import { reconcile, type CommitContext, type Logger } from '../state/commit.js';
import { readDraft, readJob, submitTurn, type Job } from '../state/jobs.js';
import { openState, type OpenedState } from '../state/open.js';
import { Layout } from '../storage/layout.js';
import { TurnStream } from '../stream/bus.js';
import { TurnRunner } from './runner.js';

/**
 * ***A finished turn that cannot commit is not a turn that never started***
 * (2026-09-27).
 *
 * The runner's last checkpoint and `finaliseTurn` sat inside the `try` that
 * exists for a turn that cannot even be set up. So a disk that refused part of
 * the commit, a full volume or a scanner holding a file open, was handled as
 * a setup failure: a stand-in with no prose and no effects overwrote the saved
 * draft and was committed in the turn's place. Here the append lands and the
 * head step fails, which is the case where the damage is quietest: the segment
 * holds the real turn, and the session's channels were built from the
 * stand-in's none.
 *
 * `advanceHead` is wrapped rather than replaced, so every test here runs the
 * real one unless it says otherwise, and the failure is injected at the one
 * seam a real disk would fail at.
 */
vi.mock('../sessions/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sessions/store.js')>();
  return { ...actual, advanceHead: vi.fn(actual.advanceHead) };
});

const ACCOUNT = 'ned';
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a31';
const PROSE = 'The rain did not stop, and neither did she.';

let dataDir: string;
let index: OpenedIndex;
let state: OpenedState;
let sessions: SessionContext;
let commit: CommitContext;
let runner: TurnRunner;
let sessionId: string;
let logLines: Record<string, unknown>[];

function recorder(into: Record<string, unknown>[], bindings: Record<string, unknown>): Logger {
  const at = (level: string) => (object: Record<string, unknown>) => {
    into.push({ level, ...bindings, ...object });
  };
  return {
    child: (extra) => recorder(into, { ...bindings, ...extra }),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
  };
}

async function until(predicate: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((tick) => setTimeout(tick, 5));
  }
  expect(predicate(), `waited for ${what}`).toBe(true);
}

/** Refuses the next `count` head steps the way a busy disk refuses a write. */
function refuseHead(count: number): void {
  const busy = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
  for (let at = 0; at < count; at += 1) vi.mocked(store.advanceHead).mockRejectedValueOnce(busy);
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-runner-commit-'));
  await installBuiltIns();
  index = await openIndex({ path: ':memory:' });
  state = await openState({ path: ':memory:' });
  sessions = { layout: new Layout(dataDir), index: index.db };
  const bus = new TurnStream();
  commit = { db: state.db, sessions, events: bus };
  const accounts = new Accounts(sessions.layout);
  await accounts.create({ handle: ACCOUNT, password: 'a long enough password', role: 'user' });
  sessionId = (await createSession(sessions, ACCOUNT, 'Rain City')).id;

  const root = sessions.layout.userConnectionsRoot(ACCOUNT);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
    }),
  );
  await writeFile(
    join(dataDir, 'users', ACCOUNT, 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );

  const provider = new FakeProvider({ script: [{ text: PROSE }] });
  runner = new TurnRunner({
    commit,
    bus,
    providers: () => provider,
    accounts,
    config: DEFAULT_CONFIG,
  });
  logLines = [];
  runner.setLogger(recorder(logLines, {}));
});

afterEach(async () => {
  vi.mocked(store.advanceHead).mockReset();
  await runner.drain();
  state.close();
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function start(): Promise<Job> {
  const outcome = await submitTurn(commit, {
    account: ACCOUNT,
    sessionId,
    idempotencyKey: 'key-1',
    headTurnId: null,
  });
  if (outcome.kind !== 'created') throw new Error(`expected a reservation, got ${outcome.kind}`);
  runner.start(outcome.job, {
    input: { actorId: null, kind: 'do', text: 'She went on.', raw: 'She went on.' },
  });
  return outcome.job;
}

async function theTurn(job: Job) {
  const written = await readAllTurns(
    join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
  );
  return written.find((entry) => entry.turn.id === job.turnId)?.turn;
}

describe('a finished turn whose commit fails', () => {
  it('is committed as itself on the second try', async () => {
    refuseHead(1);
    const job = await start();
    await until(() => readJob(state.db, job.id)?.status === 'committed', 'the job to commit');

    const turn = await theTurn(job);
    expect(turn?.output?.text).toBe(PROSE);
    // The head was built from the turn's own effects, so the clock moved. From
    // a stand-in's empty effects it would still read eight o'clock.
    const session = await readSession(sessions, ACCOUNT, sessionId);
    expect(session?.headTurnId).toBe(job.turnId);
    expect(readClock(session?.channels ?? {})).toEqual({ day: 1, hour: 8, minute: 5 });
    // And the draft the job holds is still the turn, not a record of a setup
    // that failed.
    expect(readDraft(commit, job.id)?.steps?.map((step) => step.stepId)).not.toContain('se.setup');

    const events = logLines.map((line) => line['event']);
    expect(events).toContain('job.commitFailed');
    expect(events).not.toContain('job.unstartable');
  });

  it('is left for startup, which commits it as itself', async () => {
    refuseHead(2);
    const job = await start();
    await until(
      () => logLines.some((line) => line['event'] === 'job.lost'),
      'the commit to be given up on',
    );

    // Not finished, and not faked: the job still holds the turn it made.
    expect(readJob(state.db, job.id)?.finishedAt).toBeNull();
    expect(readDraft(commit, job.id)?.status).toBe('complete');
    expect(readDraft(commit, job.id)?.output?.text).toBe(PROSE);

    const recovered = await reconcile(commit);
    expect(recovered.finalised).toEqual([job.id]);
    const session = await readSession(sessions, ACCOUNT, sessionId);
    expect(session?.headTurnId).toBe(job.turnId);
    expect(readClock(session?.channels ?? {})).toEqual({ day: 1, hour: 8, minute: 5 });
  });
});
