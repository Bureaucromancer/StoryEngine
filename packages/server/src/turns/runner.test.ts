// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { DEFAULT_CONFIG, type Config } from '../config.js';
import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import type { ProviderFactory } from '../providers/factory.js';
import { readClock, SE_CLOCK } from '../sessions/channels.js';
import { readAllTurns } from '../sessions/segments.js';
import {
  appendTurnToSession,
  createSession,
  readSession,
  type SessionContext,
} from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import type { CommitContext, Logger } from '../state/commit.js';
import { readEvents, readJob, submitTurn, type Job } from '../state/jobs.js';
import { openState, type OpenedState } from '../state/open.js';
import { Layout } from '../storage/layout.js';
import { Accounts } from '../auth/accounts.js';
import { TurnStream } from '../stream/bus.js';
import { AdvisoryLeakError } from '../assembly/assemble.js';
import { callOnRecord, onRecord } from '../test-record.js';
import type { StepDefinition, TurnPlan } from './steps.js';
import { NARRATE } from '../modes/scene/mode.js';
import { SCENE_PRESET } from '../modes/scene/preset.js';
import { create, type LibraryContext } from '../library.js';
import { newLorebook, newLoreEntry } from '@storyengine/shared';
import { SE_LORE_TIMING } from '../sessions/channels.js';
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
let library: LibraryContext;
/**
 * A real account store over the same layout — [P2A §2.1].
 *
 * The runner reads `privateConnections` through this, so a fake would make
 * every capability test assert about the fake. The account is created here for
 * the same reason: a turn run by an account that does not exist resolves to no
 * capabilities, which is correct and is *not* the case most of these tests are
 * about.
 */
let accounts: Accounts;

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
      // **There has to be something to leak.** Without these two fields the
      // containment test below could not fail: it asserted that a record with
      // no credential in scope contained no credential.
      apiKey: 'sk-test-must-never-appear',
      baseUrl: 'https://secret-host.invalid/v1',
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
    accounts,
    config: {
      ...DEFAULT_CONFIG,
      ...options.config,
      // One checkpoint per chunk, so event ordering is deterministic rather
      // than a function of how fast the machine is.
      sessions: { ...DEFAULT_CONFIG.sessions, streamCoalesceMs: 0 },
    },
    ...(options.plan === undefined ? {} : { plan: options.plan }),
  });
  // The runner's own logger seam, so a test reads what an operator would.
  logLines = [];
  runner.setLogger(recorder(logLines, {}));
}

/** Structured lines the runner emitted for the turn under test. */
let logLines: Record<string, unknown>[] = [];

/**
 * A `Logger` that keeps its lines, bindings merged in.
 *
 * Structural rather than a pino instance writing to a stream: `Logger` is four
 * methods ([13 §4.1] keeps it that small on purpose), and going through a real
 * logger would mean asserting against a serialiser instead of against what the
 * runner passed. The bindings matter — `child()` is how a job id reaches every
 * line — so they are merged rather than dropped.
 */
/**
 * The runner's logger seam, recording **which level** as well as what.
 *
 * All three used to share one writer, which made the level unobservable — and
 * [13 §4.1] draws a boundary there that matters: `error` is what the server
 * could not do, `warn` what it refused. A user pressing Stop is neither, and
 * logging it at `error` was most of what a session's log contained.
 */
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

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-runner-'));
  index = await openIndex({ path: ':memory:' });
  state = await openState({ path: ':memory:' });
  sessions = { layout: new Layout(dataDir), index: index.db };
  library = { db: index.db, layout: sessions.layout, keepHistoryPerObject: 0 };
  bus = new TurnStream();
  commit = { db: state.db, sessions, events: bus };
  accounts = new Accounts(sessions.layout);
  await accounts.create({ handle: ACCOUNT, password: 'a long enough password', role: 'user' });
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

/**
 * Runs the *next* turn, and can be called repeatedly.
 *
 * `runTurn` reserves with a fixed key against a null head, so calling it twice
 * is an idempotent retry rather than a second turn — correct for what it tests
 * and wrong for anything asserting that a change took effect on the turn after
 * it. This chains from the session's current head with a fresh key each time.
 */
let nextKey = 0;
async function runNextTurn(): Promise<Turn> {
  nextKey += 1;
  const session = await readSession(sessions, ACCOUNT, sessionId);
  const outcome = await submitTurn(commit, {
    account: ACCOUNT,
    sessionId,
    idempotencyKey: `next-${String(nextKey)}`,
    headTurnId: session?.headTurnId ?? null,
  });
  if (outcome.kind !== 'created') throw new Error(`expected a reservation, got ${outcome.kind}`);

  const text = 'She opened the door.';
  runner.start(outcome.job, { input: { actorId: null, kind: 'do', text, raw: text } });
  await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'the job to commit');

  const written = await readAllTurns(
    join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
  );
  const turn = written.at(-1)?.turn;
  if (!turn) throw new Error('no turn was appended');
  return turn;
}

describe('a turn goes all the way through', () => {
  it('commits, with the record of what actually ran', async () => {
    const { turn } = await runTurn();

    expect(turn.status).toBe('complete');
    expect(turn.output?.text).toBe('The rain had not stopped for three days.');
    expect(turn.steps).toMatchObject([{ stepId: 'se.narrate', state: 'ok' }]);
    // What was assembled, with provenance — the thing that makes the workbench
    // able to answer "why is this in the prompt?" ([02 §8]).
    // Bound once, and read from that binding below. Two spellings of the same
    // call — a narrowed one here and `turn.request?.calls[0]?.` on the next
    // lines — both survive tsc, which is precisely why they drift: a reader has
    // to check whether the difference means anything, and here it never did.
    const call = callOnRecord(turn);
    const blocks = onRecord(call.blocks, 'the assembled blocks');
    expect(blocks.map((block) => block.source.kind)).toContain('input');
    // Still read off `request` rather than the binding: *how many calls the turn
    // made* is a claim about the request, and asserting it through a helper that
    // already picked call zero would be asserting it against itself.
    expect(onRecord(turn.request, 'the request on the committed turn').calls).toHaveLength(1);
    expect(call.resolved).toEqual({
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

    // The values, not the field names. A record could carry the key under any
    // spelling — what must never reach disk is the secret itself.
    expect(serialised).not.toContain('sk-test-must-never-appear');
    expect(serialised).not.toContain('secret-host.invalid');
    expect(serialised).not.toContain('apiKey');
    expect(serialised).not.toContain('baseUrl');
    // And the id, which is what [13 §1.4] says the record may carry, is there —
    // so this is not passing because nothing was recorded at all.
    expect(serialised).toContain(CONNECTION_ID);
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
    callKind: 'extract',
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

  /**
   * **A failing step logs a shape, not the error object** — F32.
   *
   * `err: error` serialises an error's own enumerable properties, and a
   * `CallFailed` carries `partialText` and `call` — so a failed step wrote **the
   * whole rendered prompt and the model's partial narration** into the log.
   * [13 §4.1] says portable object bodies never appear there: *a log is not a
   * backup and user prose is not diagnostic.*
   *
   * The assertion is on the *absence of prose*, which is the thing that has to
   * stay true. Listing the fields it should carry would pass just as well over a
   * line that carried the prose too.
   */
  it('keeps the prompt and the prose out of the log', async () => {
    makeRunner({
      script: [
        {
          error: {
            class: 'terminal',
            message: 'The provider call failed.',
            detail: 'Incorrect API key provided: sk-xx',
          },
        },
      ],
    });

    await runTurn();
    const line = logLines.find((entry) => entry['event'] === 'step.failed');

    expect(line).toBeDefined();
    const serialised = JSON.stringify(line);
    // The two fields a `CallFailed` carries that must never travel.
    expect(serialised).not.toContain('partialText');
    expect(serialised).not.toContain('fromBlocks');
    // And nothing that looks like an assembled prompt: the narrator instruction
    // is in every rendered message and in no honest log line.
    expect(serialised).not.toContain('You are a narrator');
  });

  /**
   * [13 §4.1]'s boundary: `error` is *"what the server could not do"*, `warn`
   * what it refused. **A user pressing Stop is neither** — it is the system
   * doing exactly what was asked — and Stop is the most-pressed button in a
   * session against real latency, so logging it at `error` was most of what a
   * phase's log would contain.
   */
  it('does not call a cancellation an error', async () => {
    makeRunner({ script: [{ text: 'a slow answer', chunks: 8, chunkDelayMs: 15 }] });
    const job = await reserve();
    runner.start(job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(
      () => readEvents(commit, job.id).some((e) => e.key === 'call.streaming'),
      'a chunk',
    );
    runner.cancel(job.id);
    await until(() => readJob(state.db, job.id)?.status === 'committed', 'the cancelled commit');

    const cancelled = logLines.filter(
      (entry) => entry['event'] === 'step.failed' && entry['reason'] === 'cancelled',
    );

    // Asserted non-empty first: a filter that matched nothing would satisfy the
    // loop below forever, which is the shape this suite keeps finding.
    expect(cancelled.length).toBeGreaterThan(0);
    for (const line of cancelled) expect(line['level']).toBe('info');
  });

  it('a step the author said to ignore is a warning, not an error', async () => {
    makeRunner({ plan: failing('ignore') });

    await runTurn();
    const line = logLines.find((entry) => entry['event'] === 'step.failed');

    expect(line?.['level']).toBe('warn');
  });

  it('an aborting step is an error, because the server could not do it', async () => {
    makeRunner({ plan: failing('abort') });

    await runTurn();
    const line = logLines.find((entry) => entry['event'] === 'step.failed');

    expect(line?.['level']).toBe('error');
  });

  /**
   * **The provider's own words, which were classified and then dropped.**
   * `message` is this system's sentence about the failure; `detail` is the
   * endpoint's, and it is the one thing that tells an operator what to change.
   * It reached `ProviderError`, was lost when `CallFailed` wrapped it, and so
   * never left the adapter.
   */
  it('carries the endpoint’s own explanation', async () => {
    makeRunner({
      script: [
        {
          error: {
            class: 'terminal',
            message: 'The provider call failed.',
            detail: 'Incorrect API key provided: sk-xx',
          },
        },
      ],
    });

    await runTurn();
    const line = logLines.find(
      (entry) => entry['event'] === 'step.failed' && entry['detail'] !== undefined,
    );

    expect(line?.['detail']).toContain('Incorrect API key provided');
    expect(line?.['class']).toBe('terminal');
  });

  /**
   * **A stalled endpoint ends the turn instead of holding the session open** —
   * [P2C §1.3], and `limits.providerTimeoutMs`.
   *
   * Nothing bounded a provider call. The person's Stop button was the only
   * exit, which requires somebody to be watching, and the only exit from an
   * unwatched hang was restarting the server — which destroys the state that
   * produced the finding. A turn that fails is a turn somebody can read.
   */
  it('gives up on an endpoint that accepts the request and says nothing', async () => {
    makeRunner({
      script: [{ stallMs: 5_000 }],
      config: { limits: { ...DEFAULT_CONFIG.limits, providerTimeoutMs: 60 } },
    });

    const { turn } = await runTurn();

    expect(turn.status).toBe('failed');
    // `terminal`, so it is not retried: the failure is transient in the ordinary
    // sense, but three attempts at the full timeout is three times the hang the
    // key exists to end.
    expect(turn.request?.calls.at(-1)).toMatchObject({ outcome: 'error', retries: 0 });
    expect(turn.request?.calls.at(-1)?.error?.class).toBe('terminal');
  });

  /**
   * **Silence, not length** — the half of the semantics that a wall-clock
   * ceiling would get wrong.
   *
   * A multi-minute first token is ordinary on a local runtime, and a generation
   * that is still arriving is not a hang. So the clock is re-armed by every
   * chunk. This stream runs to four times the timeout and finishes, which is
   * the assertion: without the re-arm it is killed a fifth of the way in.
   */
  it('does not interrupt a long answer that is still arriving', async () => {
    makeRunner({
      script: [{ text: 'One two three four five six seven eight.', chunks: 8, chunkDelayMs: 30 }],
      config: { limits: { ...DEFAULT_CONFIG.limits, providerTimeoutMs: 60 } },
    });

    const { turn } = await runTurn();

    expect(turn.status).toBe('complete');
    expect(turn.output?.text).toBe('One two three four five six seven eight.');
  });

  /**
   * **Zero means no bound**, for an endpoint whose operator knows it is slower
   * than any number the form would let them type. Refusing the case would only
   * move the workaround somewhere less visible than the config file.
   */
  it('leaves the call alone when the timeout is switched off', async () => {
    makeRunner({
      script: [{ stallMs: 80 }],
      config: { limits: { ...DEFAULT_CONFIG.limits, providerTimeoutMs: 0 } },
    });

    const { turn } = await runTurn();

    expect(turn.status).toBe('complete');
  });

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

  /**
   * **The interrupted call is on the record** — finding 2 in
   * [16](../../../../docs/design/workplan/16-p2c-log.md).
   *
   * Stop is the most-pressed button in a manual phase against real latency,
   * and the failure a tester produced most often was the one the record said
   * least about: `request.calls: []` — no connection id, no model, no wall
   * time. `CallFailed` had carried the record all along; `Cancelled` was
   * thrown one line earlier and carried nothing.
   */
  it('records which call the Stop interrupted', async () => {
    makeRunner({ script: [{ text: 'a slow answer', chunks: 8, chunkDelayMs: 15 }] });
    const job = await reserve();
    runner.start(job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });

    await until(
      () => readEvents(commit, job.id).some((e) => e.key === 'call.streaming'),
      'a chunk',
    );
    runner.cancel(job.id);
    await until(() => readJob(state.db, job.id)?.status === 'committed', 'the cancelled commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    const call = written[0]?.turn.request?.calls.at(-1);

    // The model that was *asked*, because nothing answered — and an outcome of
    // its own, because a cancellation is neither an error nor a clean answer.
    expect(call).toMatchObject({
      outcome: 'cancelled',
      resolved: { modelId: 'fake-hi' },
      error: null,
      // Never fabricated: the provider reported nothing, so nothing is there.
      usage: null,
      finishReason: null,
    });
    expect(call?.wallMs).toBeGreaterThan(0);
    // And the assembly rides on the interrupted call itself since [P3.0] —
    // blocks per call is what makes this assertable at all.
    expect(onRecord(call?.blocks, 'the cancelled call and its blocks').length).toBeGreaterThan(0);
    // The words that had already streamed survive as the turn's output rather
    // than silently never having happened.
    expect(written[0]?.turn.output?.text.length).toBeGreaterThan(0);
  });

  /**
   * **A Stop in the retry backoff keeps the assembly** — [P3.0]'s one
   * extension of finding 2's doctrine. The exception stays bare (there is
   * genuinely no attempt to name), but with blocks on the call, dropping the
   * checkpointed provisional would erase assembly the record used to keep at
   * turn level — so the runner restamps it: cancelled, nothing failed,
   * nothing answered.
   *
   * The window is deterministic in practice: the first attempt's throw and
   * the catch's stopped-check are one synchronous stretch, and the cancel
   * below arrives at least a poll cycle after the provider was asked — well
   * inside the fixed 250ms backoff that follows. The falsifying mutation is
   * deleting the runner's bare-Cancelled restamp: the record then commits the
   * provisional's server-stopped stamp from a process that never died.
   */
  it('a Stop between attempts keeps the assembly, restamped as cancelled', async () => {
    makeRunner({
      script: [{ text: '', error: { class: 'transient', message: 'flaky once' } }],
    });
    const job = await reserve();
    runner.start(job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });

    await until(() => provider.requests.length === 1, 'the first attempt');
    runner.cancel(job.id);
    await until(() => readJob(state.db, job.id)?.status === 'committed', 'the cancelled commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    const turn = onRecord(written[0], 'the cancelled turn on disk').turn;
    const calls = onRecord(turn.request, 'the request on the cancelled turn').calls;
    expect(calls).toHaveLength(1);
    const call = onRecord(calls[0], 'the restamped call');
    expect(call.outcome).toBe('cancelled');
    expect(call.error).toBeNull();
    expect(call.usage).toBeNull();
    expect(call.finishReason).toBeNull();
    // The assembly the restamp exists to keep. The `?? []` this binding used to
    // end in was the escape hatch: a record with no request at all turned every
    // line below into an assertion about an empty list, and only the length
    // check above stood between that and a green run over a turn that assembled
    // nothing. Narrowing removes the hatch rather than guarding it.
    expect(onRecord(call.blocks, 'the restamped blocks').length).toBeGreaterThan(0);
    expect(onRecord(call.budget, 'the restamped budget').decisions.length).toBeGreaterThan(0);
  });

  /**
   * **A live turn never commits the provisional** — the stamp's whole
   * safety argument, pinned. The final record shares the provisional's id and
   * replaces it; a push instead of a replacement would commit two calls for
   * one request, one of them claiming the server died. The falsifying
   * mutation is making `finalise` push unconditionally.
   */
  it('replaces the provisional in-flight call rather than committing it', async () => {
    const { turn } = await runTurn();

    expect(turn.request?.calls).toHaveLength(1);
    expect(turn.request?.calls[0]?.outcome).toBe('ok');
    expect(JSON.stringify(turn.request)).not.toContain('The server stopped');
  });
});

describe('the record says why a slot is empty', () => {
  /**
   * [P3.0] §7.5, end to end: Scene's preset positions twelve blocks and a
   * bare session fills two, so the call's `notFilled` carries the other ten
   * with their reason classes — the record's answer to *why is there no lore
   * in this prompt*. The falsifying mutation is stamping `notFilled: []` at
   * the success literal in `performCall`.
   */
  it('lands the not-filled slots on the call, reasons and all', async () => {
    const { turn } = await runTurn();

    const call = callOnRecord(turn);
    const notFilled = onRecord(call.notFilled, 'the not-filled slots on the call');
    const lore = notFilled.find((slot) => slot.source === 'lore');
    /**
     * ~~`no-producer`~~ **`empty-source` since [P5.6]**, and the change is the
     * point rather than a repair: lore acquired a producer, so an empty lore
     * slot no longer means *nothing can fill this*. This session links no book,
     * so the retriever ran over nothing and said so — which is exactly what
     * `empty-source` means everywhere else, and what an author reading the
     * record needs, because the fix is *link a lorebook* rather than *wait for
     * a later phase*.
     */
    expect(lore?.reason).toBe('empty-source');
    // Nothing filled is also nothing listed twice: the filled blocks and the
    // not-filled slots partition the preset's applicable blocks — which is a
    // claim about two *populated* lists. `new Set(undefined)` is an empty set
    // rather than an error, so the check below would have passed once per slot
    // while proving nothing, and the `?? []` on the loop let it run zero times
    // besides. Both sides are pinned non-empty first, and the guard that used to
    // sit underneath the loop now stands in front of it, where it can prevent a
    // zero-iteration pass rather than merely notice one afterwards.
    const filledIds = new Set(
      onRecord(call.blocks, 'the blocks the call filled').map((block) => block.id),
    );
    expect(filledIds.size).toBeGreaterThan(0);
    expect(notFilled.length).toBeGreaterThan(0);
    for (const slot of notFilled) {
      expect(filledIds.has(slot.blockId)).toBe(false);
    }
  });

  it('empties honestly when a step supplies its own candidates', async () => {
    // The preset was not consulted, so the list has nothing to say — a copy
    // of the preset's gaps here would describe a collection this call never
    // used.
    makeRunner({
      plan: {
        steps: [
          {
            definition: NARRATE,
            run: async (_input, host) => {
              const result = await host.call({
                candidates: [
                  {
                    id: 'step.own',
                    source: { kind: 'step', stepId: NARRATE.id },
                    reason: 'a step-authored block',
                    role: 'system',
                    text: 'Improvise.',
                  },
                ],
              });
              return { message: { text: result.text } };
            },
          },
        ],
      },
    });

    const { turn } = await runTurn();
    expect(turn.request?.calls[0]?.notFilled).toEqual([]);
  });
});

describe('the engine says what it overrode', () => {
  /**
   * [05 §3]'s third effect outcome, linked rather than inferred — [P3.0]. A
   * step proposes a clock value, the engine-computed policy refuses it, and
   * the engine's own advance then lands carrying the refusal's id. The
   * falsifying mutation is stamping `supersedes: null` unconditionally at the
   * clock write.
   */
  it('links the clock advance to the refusal it superseded', async () => {
    makeRunner({
      plan: {
        steps: [
          {
            definition: NARRATE,
            run: async (_input, host) => {
              const result = await host.call({});
              return {
                message: { text: result.text },
                effects: [
                  {
                    channelId: SE_CLOCK,
                    op: { type: 'set', path: '/' },
                    after: { day: 9, hour: 0, minute: 0 },
                    proposedBy: { kind: 'step', stepId: NARRATE.id },
                  },
                ],
              };
            },
          },
        ],
      },
    });

    const { turn } = await runTurn();

    const refused = turn.effects.find((effect) => !effect.applied);
    const clock = turn.effects.find((effect) => effect.proposedBy.kind === 'engine');
    expect(refused?.rejectedReason).toBe('engine-computed');
    expect(refused?.id).toBeDefined();
    expect(clock?.supersedes).toBe(refused?.id);
  });

  /**
   * **The live feed says the same thing the record does** — [P3.5]'s stated
   * precondition, and the reason `effect.applied` grew a third param.
   *
   * Before this, the event carried `{channelId, accepted}` only: a live reader
   * could say *refused* where the record said *refused because the engine
   * computes this channel*, which is exactly the disagreement the stage
   * predicted. The falsifying mutation is passing `null` at the call site —
   * the record still reads correctly, and only this notices.
   */
  it('publishes the refusal’s reason, not merely that it was refused', async () => {
    makeRunner({
      plan: {
        steps: [
          {
            definition: NARRATE,
            run: async (_input, host) => {
              const result = await host.call({});
              return {
                message: { text: result.text },
                effects: [
                  {
                    channelId: SE_CLOCK,
                    op: { type: 'set', path: '/' },
                    after: { day: 9, hour: 0, minute: 0 },
                    proposedBy: { kind: 'step', stepId: NARRATE.id },
                  },
                ],
              };
            },
          },
        ],
      },
    });

    const { job, turn } = await runTurn();

    const published = readEvents(commit, job.id).filter((event) => event.key === 'effect.applied');
    expect(published).toHaveLength(1);
    const params = published[0]?.params as { channelId: string; accepted: boolean; reason: string };
    expect(params.accepted).toBe(false);
    expect(params.channelId).toBe(SE_CLOCK);
    // The same class the record kept, so the two views cannot drift.
    expect(params.reason).toBe('engine-computed');
    expect(params.reason).toBe(turn.effects.find((effect) => !effect.applied)?.rejectedReason);
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

describe('the preset is what builds the prompt', () => {
  it('emits a block per preset block that has content, with its label as the reason', async () => {
    // Before P2.6 the candidate list was three hardcoded sources in
    // `narrate.ts`. Now it is a walk over `preset.blocks` — so the assertion
    // that matters is that the *preset* is visible in the record.
    const { turn } = await runTurn();

    const blocks = onRecord(callOnRecord(turn).blocks, 'the assembled blocks');
    const reasons = blocks.map((block) => block.reason);
    // The narrator instruction is a text block the preset author wrote.
    expect(reasons).toContain('instruction');
    // …and the player's action is a slot the preset positioned.
    expect(reasons).toContain('input');

    const instruction = blocks.find((block) => block.source.kind === 'preset');
    expect(instruction?.text).toContain('narrator');
  });

  it('drops a slot that resolves empty rather than emitting a heading', async () => {
    // `omitWhenEmpty`, read literally. A P2.6 session has no Treatment and no
    // lore, and those slots are *present* in the preset — which is what makes
    // P5 an activation change rather than a preset change.
    const { turn } = await runTurn();
    const kinds = onRecord(callOnRecord(turn).blocks, 'the assembled blocks').map(
      (block) => block.source.kind,
    );

    // **Two negatives cannot carry a test.** Narrowing makes an *absent* record
    // loud and says nothing whatever about an *empty* one: a list that was never
    // built contains no 'lore' just as happily as a real assembly does, and this
    // block held nothing but negatives, so `?? []` over a turn with no request
    // in it was a green run. The obvious repair — extending the chain to
    // `?.blocks?.map(…) ?? []` — would have widened exactly that hole while
    // silencing the compiler. So the kinds that must be here are asserted first,
    // and the drop `omitWhenEmpty` performs then reads as a *difference* rather
    // than as a void. Neither positive is a new claim: the sibling test above
    // pins a `source.kind === 'preset'` block on this same default `runTurn()`,
    // and the record test at the top of the file pins 'input'.
    expect(kinds).toContain('preset');
    expect(kinds).toContain('input');
    expect(kinds).not.toContain('lore');
    expect(kinds).not.toContain('treatment');
  });

  /**
   * **The player's words are the player's** — F36, end to end through the real
   * pipeline, which is where this belongs because it is the only level at which
   * the bug was visible.
   *
   * A completed turn became one block labelled `assistant` holding the input and
   * the output joined by a newline, so **every message the player had ever
   * typed was attributed to the model.** Invisible on screen, and visible only
   * on the wire or by reading the collector — which is how it survived a survey,
   * four phases and six audits, with a test right here that asserted the block
   * count and never looked at whose voice it was in.
   *
   * P2.4 promised history would be splittable from the start; one block for the
   * whole transcript would make the budgeter's only move dropping all of it.
   * Splitting by *speaker* keeps that and fixes the attribution.
   */
  it('attributes each half of a past turn to whoever said it', async () => {
    await runTurn('The first thing.');
    const head = (await readSession(sessions, ACCOUNT, sessionId))?.headTurnId ?? null;

    const second = await reserve('key-2', head);
    runner.start(second, { input: { actorId: null, kind: 'do', text: 'The second.', raw: '' } });
    await until(() => readJob(state.db, second.id)?.status === 'committed', 'the second turn');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    const latest = onRecord(written.at(-1), 'the second turn on disk').turn;
    const history = onRecord(callOnRecord(latest).blocks, 'the assembled blocks').filter(
      (b) => b.source.kind === 'history',
    );

    // Two blocks for one past turn, in the order they were said, each in its own
    // voice — and the player's line is *not* the model's.
    expect(history.map((block) => [block.role, block.text])).toEqual([
      ['user', 'The first thing.'],
      ['assistant', expect.any(String)],
    ]);
    expect(history[1]?.text).not.toContain('The first thing.');
  });
});

describe('a turn that cannot even be set up', () => {
  it('commits a failed turn rather than wedging the session forever', async () => {
    // **The failure mode the one-active-job index makes possible.** Everything
    // between `setJobStatus('running')` and the step loop — reading the session,
    // resolving the mode, resolving the cast, building the plan — used to sit
    // outside every `try`. A throw there left the job running with `finishedAt`
    // null, so `submitTurn` answered every later submission `409 busy` until the
    // process restarted, and it presented to a test as a well-behaved refusal.
    //
    // A hand-edited `accounts.json` reaches it, and hand-editing is a
    // first-class gesture in this project rather than a contrivance ([04 §4.3]).
    //
    // **It used to be a hand-edited `session.json`, and that stopped being
    // true.** The session reader and `resolveCast` both became tolerant of a
    // broken file — deliberately, and rightly — which quietly took this test
    // with them: a fixture the runner survives makes every assertion below
    // true of an ordinary successful turn, so the test kept passing while
    // testing nothing. Hence the line that pins the path itself.
    await writeFile(new Layout(dataDir).accountsFile, 'not json at all');

    const job = await reserve();
    runner.start(job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });

    await until(() => readJob(state.db, job.id)?.finishedAt !== null, 'the job to finish');

    // The failure landed where this test is about, and not somewhere the turn
    // shrugged off. Without this the rest is satisfied by a turn that worked.
    expect(logLines.map((entry) => entry['event'])).toContain('job.unstartable');
    // And the record says what happened by what it lacks — [P3.0], against the
    // record's own docstring: a turn that failed before assembly writes no
    // `request` at all, because an empty one claims a prompt was built. The
    // falsifying mutation is restoring `request: { calls: [] }` in
    // `initialDraft`, or the unconditional assignment in `write()`.
    const unstartable = (
      await readAllTurns(join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'))
    ).find((entry) => entry.turn.id === job.turnId)?.turn;
    expect(unstartable?.status).toBe('failed');
    expect(unstartable?.request).toBeUndefined();
    // Terminal, so the session is usable again…
    expect(readJob(state.db, job.id)?.status).toBe('committed');
    const next = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId,
      idempotencyKey: 'key-after',
      headTurnId: (await readSession(sessions, ACCOUNT, sessionId))?.headTurnId ?? null,
    });
    expect(next.kind).toBe('created');
  });

  /**
   * **The lines an operator chasing a lost turn searches for first** — F37.
   *
   * `job.unstartable` and both `job.lost` sites carried `jobId` alone, because
   * the child logger with the job's bindings was built inside `#body` and those
   * three are written outside it — before it, and after it. So the two lines
   * that say *a turn never started* and *a turn ended without finalising* named
   * neither the session nor the account.
   *
   * **The id a person actually has is the session's**, because it is the one in
   * the URL. [13 §4.1] asks for the bindings to be set once where the subject
   * comes into existence, and that is `start()` rather than `#body`.
   */
  it('names the session on the line that says a turn never started', async () => {
    // The same fixture as the wedge test above, for the same reason: it is the
    // one failure in the resolution region that is still reachable from a file
    // somebody can edit, so the line under test is written by the code path an
    // operator would actually be reading the log to understand.
    await writeFile(new Layout(dataDir).accountsFile, 'not json at all');
    const job = await reserve();

    runner.start(job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(() => readJob(state.db, job.id)?.finishedAt !== null, 'the job to finish');

    const line = logLines.find((entry) => entry['event'] === 'job.unstartable');

    expect(line).toMatchObject({
      jobId: job.id,
      sessionId,
      account: ACCOUNT,
      turnId: job.turnId,
    });
    // And a shape rather than the error object: the same `CallFailed` that
    // carries `partialText` and the rendered prompt can reach this path, and
    // [13 §4.1] says portable object bodies never appear in a log.
    expect(JSON.stringify(line)).not.toContain('partialText');
  });

  it('survives a cast that is not the shape it claims to be', async () => {
    // `resolveCast` says it never throws. It is handed whatever is in the file.
    const file = join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'session.json');
    const session = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...session, cast: null }));

    const { turn } = await runTurn();
    // Not merely "did not crash": the turn still ran and still narrated.
    expect(turn.status).toBe('complete');
  });

  it('finalises even when the failure is outside the step loop entirely', async () => {
    // The guarantee the wrapper exists for, exercised where the step loop's own
    // catch cannot reach: the `for` header itself. A malformed plan is the
    // cheapest honest way to produce that — the reachable *causes* in the
    // resolution region are guarded upstream now, so this is what keeps the
    // wrapper falsifiable rather than decorative, and what stops a future
    // addition to the body reintroducing the wedge unnoticed.
    makeRunner({ plan: { steps: null as unknown as TurnPlan['steps'] } });

    const job = await reserve();
    runner.start(job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(() => readJob(state.db, job.id)?.finishedAt !== null, 'the job to finish');

    expect(readJob(state.db, job.id)?.status).toBe('committed');
    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    // A turn, not an abandonment: the session was waiting on this id, and
    // abandoning writes nothing — the submission would look as though it had
    // never happened.
    expect(written).toHaveLength(1);
    expect(written[0]?.turn.status).toBe('failed');
    expect(written[0]?.turn.steps?.[0]?.stepId).toBe('se.setup');
  });
});

describe('a preset block can be scoped to a kind of call', () => {
  it('filters on the step declaration, not on a literal', () => {
    // `callKind` was hardcoded to `'narrate'` at the collect site, which made
    // `appliesTo` unable to filter anything — and the comment justifying
    // per-call collection false. Scene's own step declares `'narrate'`, so the
    // hardcode was invisible until a step declared something else.
    expect(NARRATE.callKind).toBe('narrate');
  });

  /**
   * **The retriever, through the runner, end to end** — [P5.6].
   *
   * The unit tests under `retrieval/` prove the scan, the budget and the
   * blocks separately; this proves the wiring between them and a real turn,
   * which is the join none of them can see: the session's link resolving, the
   * gather carrying it, the step running the scan against this turn's messages,
   * and the entry's own text arriving in the prompt with the reason that put it
   * there. Every one of those is a place where a correct piece can be attached
   * to the wrong thing and produce silence.
   */
  it('puts a matching lore entry in the prompt, with the reason that fired it', async () => {
    const book = newLorebook('Rain City');
    book.entries = [
      {
        ...newLoreEntry('The Ferryman'),
        keys: ['ferryman'],
        content: 'He works the crossing and remembers every face.',
      },
    ];
    await create(library, ACCOUNT, book);

    const withLore = await createSession(sessions, ACCOUNT, {
      name: 'With a world',
      preset: SCENE_PRESET,
      lore: [book.id],
    });

    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: withLore.id,
      idempotencyKey: 'lore-1',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    const said = 'She asked the ferryman about the bridge.';
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: said, raw: said } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', withLore.id, 'turns'),
    );
    const turn = onRecord(written[0], 'the turn on disk').turn;
    const blocks = onRecord(callOnRecord(turn).blocks, 'the assembled blocks');
    const lore = blocks.filter((block) => block.source.kind === 'lore');

    expect(lore.map((block) => block.text)).toEqual([
      'He works the crossing and remembers every face.',
    ]);
    // The words the workbench shows, on the record — a product feature rather
    // than a debug string, which is only true if something asserts on it.
    expect(lore[0]?.reason).toContain('ferryman');

    /**
     * And the slot is not *also* reported empty. The two lists partition the
     * preset's applicable blocks, so a lore block on the record beside a lore
     * row in `notFilled` would mean the collector counted it twice.
     */
    const notFilled = callOnRecord(turn).notFilled ?? [];
    expect(notFilled.find((slot) => slot.source === 'lore')).toBeUndefined();
  });

  /**
   * The counters are a channel ([P5.5]), so a turn that fires an entry has to
   * leave an effect behind — otherwise nothing reconstructs at a node and a
   * branch inherits the wrong stickiness. Asserted on the effect log rather
   * than on the session's snapshot, because the log is what [09 §4] replays.
   */
  it('records the timing of an entry that fired as an entry-scoped effect', async () => {
    const book = newLorebook('Rain City');
    book.entries = [
      {
        ...newLoreEntry('The Ferryman'),
        keys: ['ferryman'],
        content: 'He works the crossing.',
        cooldown: 3,
      },
    ];
    await create(library, ACCOUNT, book);

    const withLore = await createSession(sessions, ACCOUNT, {
      name: 'Cooling',
      preset: SCENE_PRESET,
      lore: [book.id],
    });
    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: withLore.id,
      idempotencyKey: 'lore-2',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    const said = 'The ferryman again.';
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: said, raw: said } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', withLore.id, 'turns'),
    );
    const turn = onRecord(written[0], 'the turn on disk').turn;
    const timing = turn.effects.filter((effect) => effect.channelId === SE_LORE_TIMING);

    expect(timing).toHaveLength(1);
    // Scoped to the entry, which is the widening P5.5 landed for exactly this:
    // keyed on the channel id alone, two entries would overwrite each other.
    expect(timing[0]?.scopeKey).toBe(book.entries[0]?.id);
    expect(timing[0]?.after).toEqual({ sticky: 0, cooldown: 3, fired: 1 });
  });

  it('drops a block whose appliesTo does not name this step kind', async () => {
    // Driven through the runner with a session whose preset scopes one block to
    // a call kind the step does not make.
    const scoped = await createSession(sessions, ACCOUNT, {
      name: 'Scoped',
      preset: {
        ...SCENE_PRESET,
        blocks: [
          {
            ...SCENE_PRESET.blocks[0]!,
            id: 'se.only-for-summaries',
            label: 'only for summaries',
            appliesTo: ['summarise'],
          },
          SCENE_PRESET.blocks.find((block) => block.id === 'se.input')!,
        ],
      },
    });

    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: scoped.id,
      idempotencyKey: 'k',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', scoped.id, 'turns'),
    );
    const scopedTurn = onRecord(written[0], 'the scoped turn on disk').turn;
    const reasons = onRecord(callOnRecord(scopedTurn).blocks, 'the assembled blocks').map(
      (block) => block.reason,
    );

    // The narrate step does not make a `summarise` call, so that block is out…
    expect(reasons).not.toContain('only for summaries');
    // …and the unscoped one is still in, so this is not passing on an empty list.
    // That guard is load-bearing and stays exactly where it is: narrowing makes
    // an *absent* record loud, but an assembly that ran and produced nothing
    // would still slip past the negative above on its own.
    expect(reasons).toContain('input');
  });
});

describe("the preset's own settings reach the call", () => {
  it('sends the temperature and token limit the preset declares', async () => {
    // Both were written into every shipped preset and read by nothing: a pack
    // declaring `temperature: 0.85` and `maxTokens: 800` reached the provider as
    // `{}`, and the budget used the config default rather than the preset's
    // three-quarter share.
    await runTurn();

    expect(provider.requests[0]?.params).toMatchObject({
      temperature: SCENE_PRESET.params.temperature,
      maxTokens: SCENE_PRESET.params.maxTokens,
    });
  });

  it('budgets against the share the preset asks for', async () => {
    const { turn } = await runTurn();

    const limit = onRecord(callOnRecord(turn).budget, 'the budget verdict').limit;
    // Three quarters of the config ceiling — and since [P3.0], labelled as
    // what it is: the config's number (`'user'`, the live-editable one),
    // narrowed by the preset's recorded share. The old `'preset'` stamp hid
    // the exact remedy the field exists to suggest.
    expect(limit.source).toBe('user');
    expect(limit.ceiling).toBe(DEFAULT_CONFIG.limits.contextTokens);
    // `share` is left unnarrowed on purpose: it is genuinely optional on
    // `BudgetLimit`, and absent versus wrong is a real distinction here —
    // [P3.0]'s invariant is that a present `share` means
    // `tokens === floor(ceiling × share)`, so an `undefined` reported by `toBe`
    // is precisely the mutation this line exists to catch.
    expect(limit.share).toBe(SCENE_PRESET.budget.contextShare);
    expect(limit.tokens).toBe(
      Math.floor(DEFAULT_CONFIG.limits.contextTokens * SCENE_PRESET.budget.contextShare),
    );
  });

  it('records the params it actually used on the call', async () => {
    // [13 §1.4]: the record answers "why is this turn different", which it
    // cannot do if the params it names are not the params that were sent.
    const { turn } = await runTurn();
    expect(turn.request?.calls[0]?.params).toEqual(provider.requests[0]?.params);
  });
});

describe('the turn record answers what actually ran — gate step 11', () => {
  it('gives every block a source and a reason, universally', async () => {
    // `toContain` on one kind passed while most blocks carried neither. The
    // record's whole job is answering *why is this in the prompt* ([02 §8]), and
    // one block without provenance is one the workbench cannot explain.
    const { turn } = await runTurn();
    const blocks = turn.request?.calls[0]?.blocks ?? [];

    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.source, `block ${block.id} has no source`).toBeDefined();
      expect(block.reason.length, `block ${block.id} has an empty reason`).toBeGreaterThan(0);
    }
  });

  it('carries a budget verdict that says what would go next', async () => {
    // `nextToDrop` is the clause the UI promises to answer *before* pressure
    // bites, so it has to be computed rather than inferred from a drop that has
    // not happened.
    const { turn } = await runTurn();
    const budget = turn.request?.calls[0]?.budget;

    expect(budget).toBeDefined();
    expect(budget?.limit.tokens).toBeGreaterThan(0);
    expect(budget?.spent).toBeGreaterThan(0);
    /**
     * **Named, not merely an array.** `Array.isArray([])` is true, so an
     * emptied `nextToDrop` satisfied the earlier version of this — which is the
     * whole clause: the UI promises to answer *what falls out next* before it
     * falls out, and an empty answer is the one it cannot render.
     *
     * There is always a sacrificial block here: history and the actor sections
     * are droppable, and only the player's action is required.
     */
    expect(budget?.nextToDrop.length).toBeGreaterThan(0);
    expect(budget?.nextToDrop).not.toContain('se.input');
  });

  it('names what would go next when the window is too small to hold it all', async () => {
    // Under real pressure, which is the only state where the answer is
    // interesting — and where a verdict that merely existed would not do.
    makeRunner({ config: { limits: { ...DEFAULT_CONFIG.limits, contextTokens: 300 } } });
    const { turn } = await runTurn('a'.repeat(400));

    const budget = turn.request?.calls[0]?.budget;
    const excluded = (budget?.decisions ?? []).filter((decision) => !decision.included);

    expect(excluded.length).toBeGreaterThan(0);
    // Every block appears in the decisions, included ones too — a verdict
    // listing only drops cannot answer what falls out next.
    expect(budget?.decisions.length).toBeGreaterThan(excluded.length);
    // The player's action is required, so it is never what goes.
    expect(excluded.map((decision) => decision.blockId)).not.toContain('se.input');
    // And each drop says which rule did it, in the words the workbench shows.
    for (const decision of excluded) expect(decision.rule.length).toBeGreaterThan(0);
  });

  it('records the cost the provider reported, not an estimate', async () => {
    const { turn } = await runTurn();

    expect(turn.cost).toBeDefined();
    expect(turn.cost?.model).toBe('fake-hi');
    expect(turn.cost?.wallMs).toBeGreaterThanOrEqual(0);
  });

  /**
   * **A total that nobody counted is null, not zero** — F30.
   *
   * `costOf` used to sum over the calls that happened to report, so a turn where
   * none did recorded `promptTokens: 0`. That is a fabricated total in a record
   * whose sibling `ModelCall.cost` is hard-coded null precisely to avoid
   * fabricating one, and [13 §1.4] is *provider-reported, not estimated* —
   * a zero is an estimate with a confident face.
   *
   * It went unnoticed because the only assertion over `turn.cost` read `model`
   * and `wallMs`, which were right.
   */
  it('says null rather than zero when nothing reported usage', async () => {
    makeRunner({ script: [{ text: 'x', reportsNoUsage: true }] });

    const { turn } = await runTurn();

    expect(turn.cost?.promptTokens).toBeNull();
    expect(turn.cost?.completionTokens).toBeNull();
    // Wall time is measured here rather than reported by anybody, so it stays a
    // real number — the nulls are about what the provider did not say.
    expect(turn.cost?.wallMs).toBeGreaterThanOrEqual(0);
  });

  it('adds the totals up when every call reported', async () => {
    makeRunner({ script: [{ text: 'x', usage: { promptTokens: 11, completionTokens: 5 } }] });

    const { turn } = await runTurn();

    expect(turn.cost?.promptTokens).toBe(11);
    expect(turn.cost?.completionTokens).toBe(5);
  });

  /**
   * **All-or-nothing rather than a partial sum**, and this is the case that
   * decides it. A total missing one of its terms is not a smaller total, it is
   * wrong, and a reader cannot see which term went missing.
   *
   * The partial truth is not lost: every `ModelCall` keeps its own `usage`, so a
   * surface that wants *what we do know* reads the calls. What it must not do is
   * present the sum of some of them as the turn's cost.
   */
  it('reports no total when only some of the calls counted', async () => {
    makeRunner({
      script: [
        { text: 'first', usage: { promptTokens: 11, completionTokens: 5 } },
        { text: 'second', reportsNoUsage: true },
      ],
      plan: {
        steps: [
          {
            definition: NARRATE,
            run: async (_input, host) => {
              await host.call({});
              await host.call({});
              return {};
            },
          },
        ],
      },
    });

    const { turn } = await runTurn();

    expect(turn.request?.calls).toHaveLength(2);
    expect(turn.request?.calls[0]?.usage).toEqual({ promptTokens: 11, completionTokens: 5 });
    expect(turn.request?.calls[1]?.usage).toBeNull();
    expect(turn.cost?.promptTokens).toBeNull();
  });

  it('keeps every draw on the tape, keyed by site', async () => {
    // **The clause that was structurally vacuous**: `tape` was asserted as an
    // array while nothing in a P2 turn draws, so an empty array satisfied it
    // forever. A step that actually draws is what makes it mean something.
    makeRunner({
      plan: {
        steps: [
          {
            definition: { ...NARRATE, id: 'se.dice', role: null },
            run: async (_input, host) => {
              host.rng.at('se.dice', 'opening').int(1, 6);
              host.rng.at('se.dice', 'opening').int(1, 6);
              return Promise.resolve({});
            },
          },
        ],
      },
    });

    const { turn } = await runTurn();

    expect(turn.tape.length).toBe(2);
    for (const draw of turn.tape) {
      expect(draw.key, 'a draw with no key cannot be replayed').toContain('se.dice');
    }
    // Indices within a site are automatic, so two draws at one site are
    // distinguishable — which is what makes a rewrite reproducible.
    expect(new Set(turn.tape.map((draw) => draw.key)).size).toBe(2);
  });

  /**
   * **"Cost captured", made falsifiable.**
   *
   * The clause was previously satisfied by a turn in which nothing cost
   * anything. `FakeProvider` answers `usage: {promptTokens: 0, completionTokens: 0}`
   * and `cost: null` when a script says nothing about either, so
   * `turn.cost.promptTokens === 0` was both the recorded value and the value a
   * regression that dropped usage off the `ModelCall` would produce — and
   * `wallMs >= 0` is true of a hardcoded zero. Nothing anywhere compared what
   * the record says against what the provider *said*.
   *
   * So the figures here are ones that cannot arise by accident. 137 and 42 are
   * not defaults, not lengths of anything in this file, and not derivable from
   * the prompt; 0.0012 USD is a price no estimator in this repo computes,
   * because there is no estimator — [13 §1.4] says `usage` is
   * *provider-reported, not estimated*, and `cost` is the field that says the
   * same about money. `cost` in particular had **nothing asserting it reached
   * the record**: the repository's only other mention of the field is
   * `openai-compatible.test.ts` checking that *that adapter* prices nothing, so
   * `performCall` could have written `cost: null` unconditionally and every
   * suite stayed green.
   *
   * Mutations this catches: `usage: null` or `usage: {promptTokens: 0, …}` in
   * `calls.ts`'s success record; `cost: null` there; `costOf` reading
   * `completionTokens` for both sums; `wallMs: 0` in place of
   * `Date.now() - startedAt`; and `costOf` summing nothing at all.
   */
  it('records the figures the provider reported, down to the price of the call', async () => {
    makeRunner({
      script: [
        {
          // Chunked *with a delay*, because `wallMs` is the one figure the fake
          // cannot supply: it is measured. Without a real `await` between
          // yields the whole stream drains inside one macrotask and a
          // hardcoded `0` is indistinguishable from a correct measurement —
          // which is exactly what `chunkDelayMs` exists to prevent.
          text: 'The rain kept on.',
          chunks: 4,
          chunkDelayMs: 12,
          usage: { promptTokens: 137, completionTokens: 42 },
          cost: { amount: 0.0012, currency: 'USD' },
        },
      ],
    });
    const { turn } = await runTurn();

    // The turn's totals are the provider's numbers, not zeros and not estimates.
    expect(turn.cost?.promptTokens).toBe(137);
    expect(turn.cost?.completionTokens).toBe(42);
    // Asymmetric on purpose: 137 and 42 are different numbers, so a `costOf`
    // that summed one field into both is caught by the pair rather than by
    // either half.
    expect(turn.cost?.model).toBe('fake-hi');
    expect(turn.cost?.wallMs).toBeGreaterThan(0);

    // …and the same numbers on the call itself, which is where [13 §1.4] puts
    // them. The turn total is a fold over these; asserting only the fold would
    // pass with the per-call record emptied.
    const call = turn.request?.calls[0];
    expect(call?.usage).toEqual({ promptTokens: 137, completionTokens: 42 });
    expect(call?.cost).toEqual({ amount: 0.0012, currency: 'USD' });
    expect(call?.wallMs).toBeGreaterThan(0);
  });

  /**
   * **Two calls, so the fold is a fold and the model is the last one.**
   *
   * `costOf` (`runner.ts`) reduces usage across every call and takes
   * `calls.at(-1)?.resolved.modelId` for the model. With one call per turn —
   * which is every other test in this file, because Scene has one step — a
   * `reduce` and a `calls[0]`, and an `.at(-1)` and an `.at(0)`, are the same
   * program. Both mutations ship green.
   *
   * Two steps on **two different roles** is what separates them. The roles must
   * differ rather than merely the steps: `resolved.modelId` comes from the
   * binding, so two calls on `prose` resolve to one model and the `.at(-1)`
   * stays unfalsifiable. `readBindings` is deliberately unvalidated
   * (`bindings.ts` — a nonsense binding deserves the same `dangling` answer a
   * missing one gets), so pointing `fast` at a second model id on the same
   * connection needs nothing more than the file.
   *
   * Mutations this catches: `calls[0]` or `calls.at(0)` where `costOf` reads
   * `.at(-1)`; a `reduce` replaced by the last call's usage; `wallMs` taken
   * from one call rather than summed.
   */
  it('sums usage across every call and names the model of the one that ran last', async () => {
    // A second role on the same connection. `usable` is resolved from the
    // connection file, which already exists; only the binding is new.
    await writeFile(
      join(dataDir, 'users', ACCOUNT, 'bindings.json'),
      JSON.stringify({
        prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' },
        fast: { connectionId: CONNECTION_ID, modelId: 'fake-lo' },
      }),
    );

    // Both calls stream, so both have a measurable `wallMs` — a first call of
    // duration zero would make "sum" and "last" agree again for that field.
    makeRunner({
      script: [
        {
          text: 'a preflight',
          chunks: 3,
          chunkDelayMs: 8,
          usage: { promptTokens: 137, completionTokens: 42 },
        },
        {
          text: 'the answer',
          chunks: 3,
          chunkDelayMs: 8,
          usage: { promptTokens: 211, completionTokens: 9 },
        },
      ],
      plan: {
        steps: [
          {
            // `NARRATE` minus its role: same stage, same `contributes:
            // 'messages'`, same empty `writes` — so `callPurposeFor` still
            // yields `prose` and the assembler behaves identically. The role is
            // the only difference, which is the difference under test.
            definition: { ...NARRATE, id: 'se.preflight', role: 'fast' },
            run: async (_input, host) => {
              await host.call({ stream: true });
              return {};
            },
          },
          {
            definition: NARRATE,
            run: async (_input, host) => ({
              message: { text: (await host.call({ stream: true })).text },
            }),
          },
        ],
      },
    });

    const { turn } = await runTurn();
    const calls = turn.request?.calls ?? [];

    expect(calls).toHaveLength(2);
    // The two calls really did resolve differently — without this the model
    // assertion below would be passing on a coincidence.
    expect(calls[0]?.resolved.modelId).toBe('fake-lo');
    expect(calls[1]?.resolved.modelId).toBe('fake-hi');

    // Sums, not the last call's figures (211 / 9) and not the first's.
    expect(turn.cost?.promptTokens).toBe(137 + 211);
    expect(turn.cost?.completionTokens).toBe(42 + 9);
    expect(turn.cost?.wallMs).toBe((calls[0]?.wallMs ?? 0) + (calls[1]?.wallMs ?? 0));
    expect(calls[0]?.wallMs).toBeGreaterThan(0);

    // The *last* model, because that is the one whose answer the reader is
    // looking at. `fake-lo` here would mean `.at(0)`.
    expect(turn.cost?.model).toBe('fake-hi');
  });

  /**
   * **"No nulls where [13] says data" — walked, not spot-checked.**
   *
   * The clause is a statement about *every* path in the record, and a spot
   * check is the one shape of test that cannot make it. A spot check keeps
   * passing when a field nobody thought to name starts arriving null: the
   * assertion list is a list of fields that existed when it was written, and a
   * record grows. So this walks the parsed turn and fails on any null at a path
   * that is not on an allowlist derived from the contract.
   *
   * **Off disk, and off the *second* turn.** Two reasons, both load-bearing:
   *
   * - `JSON.stringify` erases `undefined` and preserves `null`, so an in-memory
   *   draft and the line in the segment file are different objects. The record
   *   is read by the workbench from disk ([P2 §2.6]), so disk is where the
   *   question is asked. `readAllTurns` parses the JSONL, which is the same
   *   round trip.
   * - The first turn of a session has legitimately empty state:
   *   `parentTurnId` is null by [02 §8], and the clock effect's `before` is
   *   null because the channel had no value yet. Walking turn two puts real
   *   data in both, so **neither needs a place on the allowlist** — which turns
   *   two excuses into two assertions: that a turn names its parent, and that
   *   the clock effect records the time it moved from. An effect that cannot
   *   state where it came from is not invertible, which is [13 §1.2.1].
   *
   * Mutation this catches: any production change that starts writing `null`
   * into the record — a `resolved` that stops carrying its `modelId`, a
   * `budget` verdict dropped from the request, a `before` that is not captured,
   * a block whose `source` is not filled in — including on a field added after
   * this test was written, which is the property a spot check cannot have.
   */
  it('carries no null where [13 §1] says data, on the record as it comes off disk', async () => {
    // Scripted, so `usage` and `cost` carry figures. They are *allowed* to be
    // null by [13 §1.4], and are therefore on the allowlist — which means the
    // walk alone cannot notice them going missing. The explicit assertion below
    // is what stops the allowlist from becoming a place to hide a regression.
    makeRunner({
      script: [
        {
          text: 'The rain kept on.',
          usage: { promptTokens: 137, completionTokens: 42 },
          cost: { amount: 0.0012, currency: 'USD' },
        },
      ],
    });

    await runTurn('She opened the door.');
    const head = (await readSession(sessions, ACCOUNT, sessionId))?.headTurnId ?? null;
    const second = await reserve('key-2', head);
    runner.start(second, {
      input: { actorId: null, kind: 'do', text: 'And went through.', raw: 'And went through.' },
    });
    await until(() => readJob(state.db, second.id)?.status === 'committed', 'the second turn');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    expect(written).toHaveLength(2);
    const turn = written.at(-1)?.turn;
    if (!turn) throw new Error('the second turn was not appended');

    const found = leaves(turn);

    /**
     * **Guards its own vacuous pass.** A walk over `{}` finds no nulls and
     * passes, and so does a walk that stops at the first object it does not
     * recognise. These five paths are the deep ones — inside a call, inside a
     * rendered message, inside a budget decision, inside an effect's `unknown`
     * -typed `before`, inside a step's counters — so reaching all of them
     * proves the walk descended everywhere the assertion claims to cover.
     */
    const reached = new Set(found.map(([path]) => generalise(path)));
    for (const path of [
      'request.calls[*].resolved.modelId',
      'request.calls[*].messages[*].content',
      // Moved with the verdict when blocks and budget landed on each call
      // ([P3.0]) — a guard path pointing at the old turn-level home would let
      // the walk stop descending exactly where the new data lives.
      'request.calls[*].budget.decisions[*].rule',
      'request.calls[*].blocks[*].tokens',
      'request.calls[*].notFilled[*].reason',
      'effects[*].before.hour',
      'steps[*].contributed.blocks',
    ]) {
      expect(reached.has(path), `the walk never reached ${path}`).toBe(true);
    }

    const offending = found
      .filter(([, value]) => value === null)
      .map(([path]) => path)
      .filter((path) => !NULL_IS_DATA.has(generalise(path)));

    expect(offending, `null where [13 §1] says data: ${offending.join(', ')}`).toEqual([]);

    // The allowlist's two escape hatches, closed for this turn. [13 §1.4]
    // permits both to be null — that is what "provider-reported" means when a
    // provider reports nothing — but this provider reported, so a record that
    // dropped the figures would be a regression the allowlist would otherwise
    // absorb in silence.
    for (const call of turn.request?.calls ?? []) {
      expect(call.usage, `call ${call.id} lost the usage the provider reported`).not.toBeNull();
      expect(call.cost, `call ${call.id} lost the cost the provider reported`).not.toBeNull();
    }
  });
});

/**
 * Every leaf of a parsed record, as `[path, value]` — the machinery behind the
 * allowlist walk above.
 *
 * Leaves rather than nodes, and paths rather than a boolean, because the
 * failure has to say *which field*. "Something in the turn record is null" is
 * not an actionable failure on a structure this size; `request.calls[0].resolved`
 * is.
 *
 * An empty array or object is itself a leaf. It has no members to recurse into,
 * and reporting it as a leaf whose value is not null is correct: `[]` is a
 * record that legitimately holds nothing, which is a different claim from a
 * field that holds null.
 */
function leaves(value: unknown, path = ''): [string, unknown][] {
  if (value === null || typeof value !== 'object') return [[path, value]];

  if (Array.isArray(value)) {
    const items = value as unknown[];
    if (items.length === 0) return [[path, value]];
    return items.flatMap((item, index) => leaves(item, `${path}[${String(index)}]`));
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return [[path, value]];
  return entries.flatMap(([key, member]) => leaves(member, path === '' ? key : `${path}.${key}`));
}

/** `request.calls[0].usage` → `request.calls[*].usage`, so the allowlist is by field. */
function generalise(path: string): string {
  return path.replaceAll(/\[\d+\]/gu, '[*]');
}

/**
 * The paths a null is **data** at, derived from the contract rather than from
 * what happens to be null today.
 *
 * Each entry is a place a document explicitly writes `| null` and says what the
 * null means. Nothing else is allowed, which is the whole point: a new field
 * arriving null is a failure until somebody decides it is a contract and adds
 * it here, and adding it here is a visible act.
 *
 * - `input.actorId` — [02 §8]: an input not attributed to an actor. Scene has
 *   a fixed participant and never attributes one.
 * - `effects[*].scopeKey` — [13 §1.2]: *which value, when the channel is scoped
 *   per actor or per entry*. `se.clock` declares `scope: 'session'`, so there
 *   is no key to name.
 * - `effects[*].rejectedReason` — [13 §1.2]: *present when `applied` is false*.
 *   The clock effect is engine-proposed against an `engine-computed` channel,
 *   so it is admitted and there is no refusal to state.
 * - `request.calls[*].usage` and `.cost` — [13 §1.4]: provider-*reported*, and
 *   a provider that reports nothing must be recorded as having reported nothing
 *   rather than as having reported zero. The turn under test scripts both, so
 *   the walk's caller closes these two by hand — an allowlist entry is a
 *   permission, not a place to hide a regression.
 * - `request.calls[*].error` — [13 §1.4]: the classified failure, null on a
 *   call that succeeded.
 * - `effects[*].supersedes` — [13 §1.2] via [P3.0]: the refusal an engine
 *   write replaced. Null is "this effect superseded nothing", which is the
 *   ordinary clock advance on a turn where nothing proposed against it —
 *   exactly this turn.
 *
 * **Two permissions the doc grants and this record does not need**, which is
 * why they are absent and each absence is an extra assertion. Both are granted
 * *for the first turn of a session*, and the walk deliberately runs on the
 * second: `parentTurnId` ([02 §8] — null for the first turn, every other turn
 * names its parent) and `effects[*].before` ([13 §1.2.1] — the state the effect
 * inverts back to, which does not exist before the channel has a value).
 *
 * **And one that stopped being expressible at all** ([P3.0]): the old
 * turn-level `request.budget` was typed `| null` for a turn that assembled
 * nothing. The verdict now lives on each call and is non-null by
 * construction — a `ModelCall` exists only downstream of `assemble()` — so
 * the permission this note used to refuse has been removed from the shape
 * itself, which is the stronger form of refusing it.
 */
const NULL_IS_DATA = new Set([
  'input.actorId',
  'effects[*].scopeKey',
  'effects[*].rejectedReason',
  'effects[*].supersedes',
  'request.calls[*].usage',
  'request.calls[*].cost',
  'request.calls[*].error',
]);

/**
 * **Capability enforcement** — [P2A §2.1](../../../../docs/design/workplan/13-p2a-configuration-surface.md),
 * [04 §4.5](../../../../docs/design/04-server-multiuser-deployment.md), gate step 6.
 *
 * From P2.5 until P2A the runner passed `{ privateConnections: true }` into
 * `resolveConnections` as a **literal**, which defeated the one check
 * [04 §4.5] calls load-bearing. It calls it that precisely because the
 * alternative — hiding personal connections in the UI — is a trivial bypass for
 * anyone with `fileAccess: "write"`, and a turn is where a connection is
 * actually used.
 *
 * The stage's ending is one sentence: *revoking `privateConnections` stops the
 * next turn resolving a personal connection, with the file untouched on disk.*
 * Both halves are here, because *revoking disables, never deletes* is the part
 * a user has to be able to rely on before an admin will use the switch.
 */
describe('the privateConnections capability', () => {
  it('is read from the account rather than assumed', async () => {
    await accounts.update(ACCOUNT, { capabilities: { privateConnections: false } });

    const turn = await runNextTurn();

    // The only connection seeded is a personal one, so with the capability
    // revoked there is nothing for the prose binding to resolve to and the turn
    // fails rather than quietly using it.
    expect(turn.status).toBe('failed');
    /**
     * **`dangling`, not `unbound`**, and the distinction is load-bearing
     * rather than incidental. `resolveRole`'s own comment draws it: `unbound`
     * means nothing was ever configured and the remedy is setup, while
     * `dangling` means a binding points at a connection that is no longer
     * resolvable and the remedy is an administrator. A revocation is the second
     * — the binding is untouched and correct, and it is the *permission* that
     * moved — so a UI reading this record offers the right sentence.
     */
    expect(turn.steps?.[0]?.error?.reason).toBe('dangling');
  });

  /**
   * **The count, and only the count.**
   *
   * [04 §4.5] keeps a connection opaque, so the line says how many were ignored
   * rather than which — and that is the fact an operator needs when somebody
   * reports "my model stopped working". Without it the symptom is a turn that
   * fails with a role it cannot resolve, and nothing anywhere connecting that
   * to a permission somebody changed last week.
   */
  it('says how many personal connections it ignored, without naming them', async () => {
    await accounts.update(ACCOUNT, { capabilities: { privateConnections: false } });

    await runNextTurn();

    const line = logLines.find((entry) => entry['event'] === 'connections.disabled');
    expect(line).toBeDefined();
    expect(line?.['ignored']).toBe(1);
    // Nothing identifying: not the label, not the id, and above all not the key.
    expect(JSON.stringify(line)).not.toContain('sk-test-must-never-appear');
    expect(JSON.stringify(line)).not.toContain('The double');
  });

  it('says nothing when there is nothing to ignore', async () => {
    await runNextTurn();

    // A line every turn would train an operator to stop reading it.
    expect(logLines.filter((entry) => entry['event'] === 'connections.disabled')).toEqual([]);
  });

  it('leaves the connection file exactly where it was', async () => {
    const path = join(new Layout(dataDir).userConnectionsRoot(ACCOUNT), 'fake.json');
    const before = await readFile(path, 'utf8');

    await accounts.update(ACCOUNT, { capabilities: { privateConnections: false } });
    await runNextTurn();

    // Byte identity, not "the file exists": a revocation that rewrote or
    // truncated the file would satisfy a laxer check while destroying the thing
    // restoring the capability is supposed to bring back.
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('gives it back when the capability is restored, on the very next turn', async () => {
    await accounts.update(ACCOUNT, { capabilities: { privateConnections: false } });
    expect((await runNextTurn()).status).toBe('failed');

    await accounts.update(ACCOUNT, { capabilities: { privateConnections: true } });

    // **The next turn, not the next restart.** The runner reads through the
    // same `Accounts` instance the routes hold, so there is one cache rather
    // than two — which is the whole reason the store is injected instead of
    // constructed here.
    expect((await runNextTurn()).status).toBe('complete');
  });

  /**
   * An account that has vanished resolves to **no** capabilities rather than to
   * the defaults.
   *
   * Defaulting would mean an account nobody can find ran with more authority
   * than a live one whose capability had been revoked, which is the wrong way
   * round — and it is exactly what a `?? DEFAULT_CAPABILITIES` would have
   * written without anybody noticing, because that spelling reads as harmless.
   *
   * Reached by hand-editing `accounts.json`, which is a first-class gesture in
   * this project rather than a contrivance ([04 §4.3]) — and the only way to
   * reach it, since `Accounts.remove` takes the user's directory with it and
   * the turn would then fail earlier, for a different reason, at the session
   * read.
   */
  it('grants nothing to an account it cannot find', async () => {
    await writeFile(
      new Layout(dataDir).accountsFile,
      JSON.stringify({ schema: 'storyengine.accounts/1', accounts: [] }),
    );

    const turn = await runNextTurn();

    expect(turn.status).toBe('failed');
    expect(turn.steps?.[0]?.error?.reason).toBe('dangling');
  });
});

/**
 * **The install default, through a real turn** — [P2B §3](../../../../docs/design/workplan/14-p2b-provider-configuration.md)
 * stage P2B.0's ending, and [04 §4.5](../../../../docs/design/04-server-multiuser-deployment.md)'s
 * fallback finally happening rather than being described.
 *
 * The unit tests above pin `resolveRole`'s layering. What only a turn can show
 * is that the layer is *plumbed*: read from `system/bindings.json`, carried
 * through `performCall`'s context, and reaching the connection the call is made
 * against.
 *
 * **`via` is not on the record**, and it is worth saying so where somebody would
 * assume otherwise. `ModelCall` carries `resolved: { connectionId, modelId }` —
 * what the role became — and nothing about which layer decided it;
 * [13 §1.4](../../../../docs/design/13-internal-contracts.md) specifies it that way. So these
 * assert the connection, and the layer is a live answer the role table shows
 * rather than a recorded one. Putting `via` on the record is a contract change,
 * which means the document first.
 */
describe('the install default bindings', () => {
  /** The install's own file, with no personal one anywhere. */
  async function seedInstallDefaults(): Promise<void> {
    const layout = new Layout(dataDir);
    await mkdir(layout.systemRoot, { recursive: true });
    await writeFile(
      layout.systemBindingsFile,
      JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
    );
  }

  it('carries a turn for an account that has bound nothing', async () => {
    await rm(join(dataDir, 'users', ACCOUNT, 'bindings.json'));
    await seedInstallDefaults();

    const turn = await runNextTurn();

    expect(turn.status).toBe('complete');
    // On the record, so *"why did this turn use that model"* has an answer that
    // names the layer rather than only the model.
    expect(turn.request?.calls[0]?.resolved.connectionId).toBe(CONNECTION_ID);
  });

  /**
   * **A dangling personal binding falls through** — the sentence [04 §4.5] has
   * carried since P1 and the code could not perform, because there was nothing
   * to fall through *to*.
   */
  it('rescues a turn whose personal binding points at a connection that is gone', async () => {
    await writeFile(
      join(dataDir, 'users', ACCOUNT, 'bindings.json'),
      JSON.stringify({ prose: { connectionId: 'removed-last-week', modelId: 'gone' } }),
    );
    await seedInstallDefaults();

    const turn = await runNextTurn();

    // Before this stage the same fixture failed the turn with `dangling`.
    expect(turn.status).toBe('complete');
  });

  it('still fails, naming the role, when both layers dangle', async () => {
    await writeFile(
      join(dataDir, 'users', ACCOUNT, 'bindings.json'),
      JSON.stringify({ prose: { connectionId: 'removed-last-week', modelId: 'gone' } }),
    );
    const layout = new Layout(dataDir);
    await mkdir(layout.systemRoot, { recursive: true });
    await writeFile(
      layout.systemBindingsFile,
      JSON.stringify({ prose: { connectionId: 'also-removed', modelId: 'gone' } }),
    );

    const turn = await runNextTurn();

    // Both states are reachable and they are different, which is the whole
    // reason `resolveRole` tells them apart.
    expect(turn.status).toBe('failed');
    expect(turn.steps?.[0]?.error?.reason).toBe('dangling');
  });
});

describe('the history the runner hands the collector', () => {
  /**
   * The wiring half of [P3.4]'s gather split, and the reason it is asserted
   * here rather than in `gather.test.ts`: that test proves `windowed` *is* the
   * mode's window; only a turn through the real loop proves the runner hands
   * the collector **that** array and not the whole path. Both are `Turn[]`, so
   * swapping them typechecks, passes every other test in this file, and grows
   * every prompt for the rest of the session's life.
   *
   * The past is written straight to disk rather than run — the runner reads
   * history from the segments, and twenty-five real turns would buy the same
   * assertion for twenty-five times the wall clock.
   */
  it('cuts it to the mode’s window, however long the session is', async () => {
    let parent: string | null = null;
    for (let hour = 1; hour <= 25; hour += 1) {
      const past: Turn = {
        id: uuidv7(),
        sessionId,
        parentTurnId: parent,
        createdAt: new Date(Date.UTC(2026, 7, 16, hour)).toISOString(),
        status: 'complete',
        input: { actorId: null, kind: 'do', text: `Turn ${String(hour)}.`, raw: '' },
        output: { text: `The answer to turn ${String(hour)}.` },
        effects: [],
        tape: [],
      };
      await appendTurnToSession(sessions, ACCOUNT, sessionId, past);
      parent = past.id;
    }

    const job = await reserve('windowed-key', parent);
    runner.start(job, { input: { actorId: null, kind: 'do', text: 'And now?', raw: '' } });
    await until(() => readJob(state.db, job.id)?.status === 'committed', 'the job to commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    const blocks = written.at(-1)?.turn.request?.calls[0]?.blocks ?? [];
    const fromHistory = blocks.filter((block) => block.source.kind === 'history');
    const turnIds = new Set(
      fromHistory.map((block) => (block.source.kind === 'history' ? block.source.turnId : '')),
    );

    // Twenty turns of history, not twenty-five — and the newest ones.
    expect(turnIds.size).toBe(20);
    expect(turnIds.has(parent ?? '')).toBe(true);
  });
});
