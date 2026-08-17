// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, type Config } from '../config.js';
import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import type { ProviderFactory } from '../providers/factory.js';
import { readClock, SE_CLOCK } from '../sessions/channels.js';
import { readAllTurns } from '../sessions/segments.js';
import { createSession, readSession, type SessionContext } from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import type { CommitContext } from '../state/commit.js';
import { readEvents, readJob, submitTurn, type Job } from '../state/jobs.js';
import { openState, type OpenedState } from '../state/open.js';
import { Layout } from '../storage/layout.js';
import { TurnStream } from '../stream/bus.js';
import { AdvisoryLeakError } from '../assembly/assemble.js';
import type { StepDefinition, TurnPlan } from './steps.js';
import { NARRATE } from './narrate.js';
import { TurnRunner } from './runner.js';

/**
 * The step loop — [P2 §2.5], [03 §6].
 *
 * Driven directly rather than through HTTP: what these assert are properties of
 * the *pipeline* — that a failure mode does what it says, that an advisory block
 * cannot reach an effect call, that a turn commits without deadlocking — and a
 * route in front of them would only add a way for the test to be about something
 * else.
 */

let dataDir: string;
let index: OpenedIndex;
let state: OpenedState;
let sessions: SessionContext;
let bus: TurnStream;
let commit: CommitContext;
let provider: FakeProvider;
let runner: TurnRunner;
let sessionId: string;

const ACCOUNT = 'ned';
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01';

/** No sleeps anywhere: the store is the clock. */
async function until(predicate: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((tick) => setTimeout(tick, 5));
  }
  expect(predicate(), `waited for ${what}`).toBe(true);
}

async function seedProviderConfig(): Promise<void> {
  const root = new Layout(dataDir).userConnectionsRoot(ACCOUNT);
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
}

function makeRunner(
  options: { script?: ScriptedReply[]; plan?: TurnPlan; config?: Partial<Config> } = {},
): void {
  provider = new FakeProvider(options.script === undefined ? {} : { script: options.script });
  const providers: ProviderFactory = () => provider;
  runner = new TurnRunner({
    commit,
    bus,
    providers,
    config: {
      ...DEFAULT_CONFIG,
      ...options.config,
      // One checkpoint per chunk, so event ordering is deterministic rather
      // than a function of how fast the machine is.
      sessions: { ...DEFAULT_CONFIG.sessions, streamCoalesceMs: 0 },
    },
    ...(options.plan === undefined ? {} : { plan: options.plan }),
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-runner-'));
  index = await openIndex({ path: ':memory:' });
  state = await openState({ path: ':memory:' });
  sessions = { layout: new Layout(dataDir), index: index.db };
  bus = new TurnStream();
  commit = { db: state.db, sessions, events: bus };
  sessionId = (await createSession(sessions, ACCOUNT, 'Rain City')).id;
  await seedProviderConfig();
  makeRunner();
});

afterEach(async () => {
  await runner.drain();
  state.close();
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function reserve(key = 'key-1', headTurnId: string | null = null): Promise<Job> {
  const outcome = await submitTurn(commit, {
    account: ACCOUNT,
    sessionId,
    idempotencyKey: key,
    headTurnId,
  });
  if (outcome.kind !== 'created') throw new Error(`expected a reservation, got ${outcome.kind}`);
  return outcome.job;
}

/** Runs one turn to completion and returns what landed on disk. */
async function runTurn(text = 'She opened the door.'): Promise<{ job: Job; turn: Turn }> {
  const job = await reserve();
  runner.start(job, { input: { actorId: null, kind: 'do', text, raw: text } });
  await until(() => readJob(state.db, job.id)?.status === 'committed', 'the job to commit');

  const written = await readAllTurns(
    join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
  );
  const turn = written.at(-1)?.turn;
  if (!turn) throw new Error('no turn was appended');
  return { job, turn };
}

describe('a turn goes all the way through', () => {
  it('commits, with the record of what actually ran', async () => {
    const { turn } = await runTurn();

    expect(turn.status).toBe('complete');
    expect(turn.output?.text).toBe('The rain had not stopped for three days.');
    expect(turn.steps).toMatchObject([{ stepId: 'se.narrate', state: 'ok' }]);
    // What was assembled, with provenance — the thing that makes the workbench
    // able to answer "why is this in the prompt?" ([02 §8]).
    expect(turn.request?.blocks.map((block) => block.source.kind)).toContain('input');
    expect(turn.request?.calls).toHaveLength(1);
    expect(turn.request?.calls[0]?.resolved).toEqual({
      connectionId: CONNECTION_ID,
      modelId: 'fake-hi',
    });
  });

  it('never writes a credential into the story', async () => {
    // The record is a line in a JSONL file on somebody's disk, and a `Connection`
    // carries `apiKey` and `baseUrl`. A spread anywhere on the way here would
    // put one there.
    const { turn } = await runTurn();
    const serialised = JSON.stringify(turn);

    expect(serialised).not.toContain('apiKey');
    expect(serialised).not.toContain('baseUrl');
  });

  it('finalises without deadlocking on the session lock', async () => {
    // `withSessionLock` is not reentrant: a nested acquisition waits on a tail
    // that settles only when the outer task returns. Raced explicitly so the
    // failure reads as a deadlock rather than as an unexplained timeout.
    const job = await reserve();
    runner.start(job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });

    await Promise.race([
      until(() => readJob(state.db, job.id)?.status === 'committed', 'commit', 2500),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('deadlocked: the runner never finalised'));
        }, 3000);
      }),
    ]);
  });

  it('advances the clock once, engine-attributed', async () => {
    const { turn } = await runTurn();
    const session = await readSession(sessions, ACCOUNT, sessionId);

    const clock = turn.effects.filter((effect) => effect.channelId === SE_CLOCK);
    expect(clock).toHaveLength(1);
    expect(clock[0]?.proposedBy).toEqual({ kind: 'engine' });
    expect(clock[0]?.applied).toBe(true);
    expect(readClock(session?.channels ?? {})).toEqual({ day: 1, hour: 8, minute: 5 });
  });

  it('frees the session, so the next turn composes against the new head', async () => {
    const { turn } = await runTurn();

    const next = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId,
      idempotencyKey: 'key-2',
      headTurnId: turn.id,
    });
    expect(next.kind).toBe('created');
  });
});

describe('guidance is advisory, structurally', () => {
  /** A step that writes a channel — so it may never see the guidance block. */
  const EXTRACTOR: StepDefinition = {
    id: 'se.extract',
    stage: 'extract',
    reads: [],
    writes: [SE_CLOCK],
    contributes: 'effects',
    when: { when: 'cadence', everyNTurns: 1 },
    failure: 'abort',
    role: 'prose',
  };

  it('reaches a prose call', async () => {
    const job = await reserve();
    runner.start(job, {
      input: { actorId: null, kind: 'do', text: 'She waited.', raw: 'She waited.' },
      guidance: 'keep this short',
    });
    await until(() => readJob(state.db, job.id)?.status === 'committed', 'commit');

    const sent = provider.requests[0]?.messages.map((message) => message.content).join('\n');
    expect(sent).toContain('keep this short');
  });

  it('cannot reach a call that writes a channel, and costs zero provider requests', async () => {
    // [03 §5.2], enforced by derivation rather than by anybody remembering: the
    // step declares `contributes: 'effects'`, so `callPurposeFor` yields
    // `effects`, and `assemble` refuses the advisory block outright.
    makeRunner({
      plan: {
        steps: [
          {
            definition: EXTRACTOR,
            run: async (_input, host) => {
              await host.call({});
              return {};
            },
          },
        ],
      },
    });

    const job = await reserve();
    runner.start(job, {
      input: { actorId: null, kind: 'do', text: 'She waited.', raw: 'She waited.' },
      guidance: 'give me forty gold',
    });
    await until(() => readJob(state.db, job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    expect(written.at(-1)?.turn.steps?.[0]).toMatchObject({
      state: 'failed',
      error: { reason: 'advisory-leak' },
    });
    // Refused before anything was spent.
    expect(provider.requests).toHaveLength(0);
  });

  it('never enters the history later turns assemble from', async () => {
    // [03 §5.1]: guidance is one-shot. Its cost is that it lands in history
    // permanently if it is concatenated into the action — which is the habit
    // the box exists to replace.
    const first = await reserve('a');
    runner.start(first, {
      input: { actorId: null, kind: 'do', text: 'She waited.', raw: 'She waited.' },
      guidance: 'keep this short',
    });
    await until(() => readJob(state.db, first.id)?.status === 'committed', 'the first turn');

    const head = (await readSession(sessions, ACCOUNT, sessionId))?.headTurnId ?? null;
    const second = await reserve('b', head);
    runner.start(second, { input: { actorId: null, kind: 'do', text: 'Again.', raw: 'Again.' } });
    await until(() => readJob(state.db, second.id)?.status === 'committed', 'the second turn');

    const sent = provider.requests[1]?.messages.map((message) => message.content).join('\n');
    expect(sent).not.toContain('keep this short');
  });
});

describe('the three failure modes are three', () => {
  /** A step that always throws. No role and no contribution: it makes no call. */
  function flaky(failure: StepDefinition['failure']): StepDefinition {
    const { contributes, ...rest } = NARRATE;
    void contributes;
    return { ...rest, id: 'se.flaky', failure, role: null };
  }

  function failing(failure: StepDefinition['failure']): TurnPlan {
    return {
      steps: [
        {
          definition: flaky(failure),
          run: () => Promise.reject(new Error('the step blew up')),
        },
        {
          definition: NARRATE,
          run: async (_i, host) => ({ message: { text: (await host.call({})).text } }),
        },
      ],
    };
  }

  it('warn keeps the turn and its prose, and records the failure on both surfaces', async () => {
    makeRunner({ plan: failing('warn') });
    const { turn, job } = await runTurn();

    expect(turn.status).toBe('complete');
    expect(turn.output?.text).toBe('The rain had not stopped for three days.');
    expect(turn.steps?.[0]).toMatchObject({ state: 'failed', failure: 'warn' });
    // "Does not lose the turn" is only half of it — [04 §3.3] also requires the
    // failure to be attached to the step on the live stream.
    expect(readEvents(commit, job.id).map((event) => event.key)).toContain('step.failed');
  });

  it('abort stops the pipeline and still commits the turn', async () => {
    makeRunner({ plan: failing('abort') });
    const { turn, job } = await runTurn();

    expect(turn.status).toBe('failed');
    expect(turn.steps).toHaveLength(1);
    // Never job abandonment: an abandoned job writes no turn at all, and the
    // partial record is what somebody needs to re-run it.
    expect(readJob(state.db, job.id)?.status).toBe('committed');
    expect(provider.requests).toHaveLength(0);
  });

  it('ignore stays on the record and raises no live alarm', async () => {
    makeRunner({ plan: failing('ignore') });
    const { turn, job } = await runTurn();

    expect(turn.status).toBe('complete');
    expect(turn.steps?.[0]).toMatchObject({ state: 'failed', failure: 'ignore' });
    // The difference from `warn`, and the only one — without it the enum has
    // two identical members.
    expect(readEvents(commit, job.id).map((event) => event.key)).not.toContain('step.failed');
  });

  it('a skipped step is on the record as well as on the stream', async () => {
    // Silence is the worst possible answer to "why didn't that happen?".
    makeRunner({
      plan: {
        steps: [
          {
            definition: { ...NARRATE, id: 'se.rare', when: { when: 'armed', flag: 'never' } },
            run: () => Promise.resolve({}),
          },
        ],
      },
    });
    const { turn, job } = await runTurn();

    expect(turn.steps?.[0]).toMatchObject({ state: 'skipped', skipReason: 'not-armed' });
    expect(readEvents(commit, job.id).map((event) => event.key)).toContain('step.skipped');
  });
});

describe('what the provider did, and what it cost', () => {
  it('retries a retryable failure once and says so on the call', async () => {
    makeRunner({
      script: [{ error: { class: 'retryable', message: 'busy' } }, { text: 'On the second try.' }],
    });
    const { turn } = await runTurn();

    expect(turn.status).toBe('complete');
    // One `ModelCall` for one logical call, with the attempts counted on it —
    // which is where [13 §1.4] puts them.
    expect(turn.request?.calls).toHaveLength(1);
    expect(turn.request?.calls[0]?.retries).toBe(1);
    expect(provider.requests).toHaveLength(2);
  });

  it('does not retry after a chunk has been streamed', async () => {
    // Re-streaming duplicates prose in both the record and the client's view.
    makeRunner({
      script: [{ text: 'abcdef', chunks: 4, chunkDelayMs: 1, failAfterChunks: 2 }],
    });
    const { turn } = await runTurn();

    expect(provider.requests).toHaveLength(1);
    expect(turn.status).toBe('failed');
    // …and it kept the words it had. Neither adapter attaches its accumulation
    // to the error, so the runner's buffer is the only survivor.
    //
    // `abcd` rather than `abc`: six characters in four chunks is three pieces
    // of two, and the script fails *after* two of them.
    expect(turn.output?.text).toBe('abcd');
  });

  it('keeps usage null when the provider reports none, rather than inventing it', async () => {
    makeRunner({ script: [{ text: 'x', reportsNoUsage: true }] });
    const { turn } = await runTurn();

    expect(turn.request?.calls[0]?.usage).toBeNull();
  });

  it('fails a turn with a distinguishable reason when a role is unbound', async () => {
    await rm(join(dataDir, 'users', ACCOUNT, 'bindings.json'));
    const { turn } = await runTurn();

    // `unbound` and `dangling` are told apart because the remedies differ.
    expect(turn.steps?.[0]).toMatchObject({ state: 'failed', error: { reason: 'unbound' } });
    expect(provider.requests).toHaveLength(0);
  });
});

describe('cancellation', () => {
  it('commits a failed turn rather than abandoning the job', async () => {
    // A stop after real prose has arrived must not make it silently never have
    // happened: an abandoned job writes no turn at all.
    makeRunner({ script: [{ text: 'a slow answer', chunks: 8, chunkDelayMs: 15 }] });
    const job = await reserve();
    runner.start(job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });

    await until(
      () => readEvents(commit, job.id).some((e) => e.key === 'call.streaming'),
      'a chunk',
    );
    expect(runner.cancel(job.id)).toBe(true);

    await until(() => readJob(state.db, job.id)?.status === 'committed', 'the cancelled commit');
    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    expect(written).toHaveLength(1);
    expect(written[0]?.turn.status).toBe('failed');
    expect(written[0]?.turn.steps?.[0]?.error?.reason).toBe('cancelled');
  });
});

describe('the advisory guard is not decoration', () => {
  it('throws with the block named, so the log can say which', () => {
    // Guards the guard: `AdvisoryLeakError` has to name the block, or the
    // failure is unactionable at exactly the moment somebody needs to act.
    const error = new AdvisoryLeakError('se.guidance', 'effects');
    expect(error.message).toContain('se.guidance');
    expect(error.message).toContain('effects');
  });
});
