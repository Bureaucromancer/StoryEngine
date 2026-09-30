// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';
import type { OutputMessage, PlotHook, StepOutcome } from '@storyengine/shared';

import { DEFAULT_CONFIG, type Config } from '../config.js';
import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import type { ProviderFactory } from '../providers/factory.js';
import { readClock, SE_CLOCK } from '../sessions/channels.js';
import { SE_PRESENCE } from '../sessions/cast.js';
import { readAllTurns } from '../sessions/segments.js';
import {
  appendTurnToSession,
  createSession,
  readSession,
  writeChannel,
  type SessionContext,
} from '../sessions/store.js';
import type { ChannelEffect, PooledHook, SessionFile, Turn } from '../sessions/types.js';
import type { CommitContext, Logger } from '../state/commit.js';
import { readDraft, readEvents, readJob, submitTurn, type Job } from '../state/jobs.js';
import { openState, type OpenedState } from '../state/open.js';
import { Layout } from '../storage/layout.js';
import { Accounts } from '../auth/accounts.js';
import { TurnStream } from '../stream/bus.js';
import { AdvisoryLeakError } from '../assembly/assemble.js';
import { callOnRecord, onRecord } from '../test-record.js';
import type { EffectProposal, StepDefinition, StepResult, TurnPlan } from './steps.js';
import { installBuiltIns } from '../mode-loader.js';
import { registerMode } from '../mode-registry.js';

import {
  ENSEMBLE_MODE,
  ENSEMBLE_MODE_ID,
  SHAPED_MODE,
  SHAPED_MODE_ID,
  TEST_PRESET,
  TEST_STEP,
} from '../test-mode.js';
import { create, type LibraryContext } from '../library.js';
import { convertCard } from '../import/sillytavern/card.js';
import { newActor, newLorebook, newLoreEntry, newTreatment } from '@storyengine/shared';
import { SE_LORE_TIMING } from '../sessions/channels.js';
import type { Occurrence } from '../notifications/router.js';
import { TurnRunner } from './runner.js';
import { keptSpeakers, SE_SPEAKERS_SMART } from './smart-speakers.js';

/**
 * The step loop — [P2 §2.5], [06 §6].
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
  options: {
    script?: ScriptedReply[];
    plan?: TurnPlan;
    config?: Partial<Config>;
    /**
     * What the last update check learned — [P11.6]. Omitted is `null`, *nothing
     * has looked*, which is what every test that is not about remedies wants
     * and is a state `remedyFor` handles rather than guesses at.
     */
    connectivity?: () => boolean | null;
    committed?: (job: Job, turn: Turn) => Promise<void>;
  } = {},
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
    notify: (occurrence) => {
      announced.push(occurrence);
    },
    ...(options.connectivity === undefined ? {} : { connectivity: options.connectivity }),
    ...(options.committed === undefined ? {} : { committed: options.committed }),
  });
  // The runner's own logger seam, so a test reads what an operator would.
  logLines = [];
  announced = [];
  runner.setLogger(recorder(logLines, {}));
}

/**
 * What the runner told the notification router — [09 §3.5], [P10.1].
 *
 * The seam rather than the store, deliberately: what the runner is responsible
 * for is *saying a turn ended and what it ended as*, and the routing beyond that
 * belongs to `notifications/router.test.ts`. A test here that read the
 * `notification` table would be asserting both, and would go red for a reason
 * that is not this file's.
 */
let announced: Occurrence[] = [];

/** Structured lines the runner emitted for the turn under test. */
let logLines: Record<string, unknown>[] = [];

/**
 * A `Logger` that keeps its lines, bindings merged in.
 *
 * Structural rather than a pino instance writing to a stream: `Logger` is four
 * methods ([21 §4.1] keeps it that small on purpose), and going through a real
 * logger would mean asserting against a serialiser instead of against what the
 * runner passed. The bindings matter — `child()` is how a job id reaches every
 * line — so they are merged rather than dropped.
 */
/**
 * The runner's logger seam, recording **which level** as well as what.
 *
 * All three used to share one writer, which made the level unobservable — and
 * [21 §4.1] draws a boundary there that matters: `error` is what the server
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
  // Registration is a call rather than an import since [P7.0], and this test
  // reaches the pipeline without going through `buildServices` — so it asks for
  // the built-ins the same way the composition root does. A test that needs a
  // mode now says so, which is the visibility the split was for.
  await installBuiltIns();

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
 * ***What waited for a turn is told once it has landed*** (2026-09-27) —
 * `RunnerOptions.committed`, which is how a backdrop that finished during the
 * turn gets shown on top of it. After the commit, so the head is the turn and
 * the session is free: anything applied then is a child of the turn rather
 * than a sibling its commit would abandon.
 */
describe('a committed turn', () => {
  it('is announced to what waited for it, with the head on it and the job finished', async () => {
    const seen: unknown[] = [];
    makeRunner({
      committed: async (job, turn) => {
        const session = await readSession(sessions, ACCOUNT, sessionId);
        seen.push({
          job: job.id,
          turn: turn.id,
          head: session?.headTurnId ?? null,
          finished: readJob(state.db, job.id)?.finishedAt !== null,
        });
      },
    });

    const { job, turn } = await runTurn();
    await runner.settle();

    expect(seen).toEqual([{ job: job.id, turn: turn.id, head: turn.id, finished: true }]);
  });
});

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

/**
 * ***What a Scene turn always runs*** — and the second one is [P7.12]'s cost,
 * named here once so that eight assertions about other features do not each
 * have to explain it.
 *
 * *The third is [P13.5a]'s trackers*, and the note applies to it word for word:
 * every tracker is off by default, so the step reads six booleans and returns.
 *
 * `se.scene.stage` is Scene's stager, and on every session in this file it does
 * nothing: staging defaults off, so the step reads one boolean and returns. It
 * is in the record anyway because **`planFor` zips every step a mode declares
 * and a mode has no way to say *not this turn***. The runner keeps its *own*
 * conditional steps out of the plan for exactly the reason this row is noise —
 * see the suggester's note below — and a mode cannot do the same.
 *
 * `StepCondition` is where it would go and its three arms are closed by explicit
 * design; two of them (`stage`, `armed`) have no producer at all, which is the
 * shape of the gap rather than a thing to fix under a stage. Recorded at
 * [25 C17].
 */
/*
 * *The fourth is [P13.5b]'s secret-plot pass*, and the note applies to it too —
 * the plot is off by default, so the step reads one boolean and returns. It is
 * first because it is `pre`, which moves the narrator off `steps[0]`: the
 * assertions below that meant *the narrator's outcome* read it by id
 * ({@link narrator}) rather than by position.
 */
/*
 * *And [P13.5c]'s editor and echo chamber make six*, both off by default and
 * both the same one-read `ok`: the editor after the narrator (first of the
 * `post` steps), the chorus last of Scene's. 25 C17's dead rows are now four.
 */
const SCENE_STEPS = [
  'se.scene.plot',
  'se.narrate',
  'se.scene.edit',
  'se.scene.stage',
  'se.scene.track',
  'se.scene.echo',
];

/** The narrator's outcome on a Scene turn — by id, since [P13.5b] put a `pre` step first. */
function narrator(turn: Turn | undefined): StepOutcome | undefined {
  return turn?.steps?.find((step) => step.stepId === 'se.narrate');
}

describe('a turn goes all the way through', () => {
  it('commits, with the record of what actually ran', async () => {
    const { turn } = await runTurn();

    expect(turn.status).toBe('complete');
    expect(turn.output?.text).toBe('The rain had not stopped for three days.');
    expect(turn.steps).toMatchObject([
      // The secret plot's pass, [P13.5b]: off, so the same one-read `ok`.
      { stepId: 'se.scene.plot', state: 'ok', contributed: { blocks: 0, effects: 0 } },
      { stepId: 'se.narrate', state: 'ok' },
      // The editor, [P13.5c]: off, and it revised nothing, so no `revisions`.
      { stepId: 'se.scene.edit', state: 'ok', contributed: { blocks: 0, effects: 0 } },
      // `ok` and contributing nothing, which is the whole of `SCENE_STEPS`'s note.
      { stepId: 'se.scene.stage', state: 'ok', contributed: { blocks: 0, effects: 0 } },
      // The trackers, [P13.5a]: all six off by default, so the same one-read
      // `ok` for the same reason.
      { stepId: 'se.scene.track', state: 'ok', contributed: { blocks: 0, effects: 0 } },
      // The echo chamber, [P13.5c]: off, the same.
      { stepId: 'se.scene.echo', state: 'ok', contributed: { blocks: 0, effects: 0 } },
    ]);
    expect(turn.steps?.find((step) => step.stepId === 'se.scene.edit')?.revisions).toBeUndefined();
    // What was assembled, with provenance — the thing that makes the workbench
    // able to answer "why is this in the prompt?" ([03 §8]).
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
    // And the id, which is what [21 §1.4] says the record may carry, is there —
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
    // [06 §5.2], enforced by derivation rather than by anybody remembering: the
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
    // [06 §5.1]: guidance is one-shot. Its cost is that it lands in history
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
    const { contributes, ...rest } = TEST_STEP;
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
          definition: TEST_STEP,
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
   * [21 §4.1] says portable object bodies never appear there: *a log is not a
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
   * [21 §4.1]'s boundary: `error` is *"what the server could not do"*, `warn`
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
   * the assertion: without the re-arm it is killed a quarter of the way in.
   *
   * ***The window is wide against the gap, 400 milliseconds against 50, and it
   * has to be.*** The gap a chunk is measured across is not only the fake's
   * delay: the fake starts waiting when the runner asks for the next chunk, so
   * the runner's own work on the last one (the stream event it writes) and the
   * timer's granularity land in it too. This test first had 30 against 60, and
   * on the Windows runner, loaded by a twenty-minute suite, one gap outgrew it
   * and the turn failed (CI run 64, 2026-09-27). Production windows are
   * minutes, so the margin is a fact about the test, not about the product.
   */
  it('does not interrupt a long answer that is still arriving', async () => {
    makeRunner({
      script: [{ text: 'One two three four five six seven eight.', chunks: 32, chunkDelayMs: 50 }],
      config: { limits: { ...DEFAULT_CONFIG.limits, providerTimeoutMs: 400 } },
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
    // "Does not lose the turn" is only half of it — [09 §3.3] also requires the
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

  /**
   * ***A window that holds nothing beside the reply fails the step, and asks
   * nobody*** (2026-09-27). It was sent with every unrequired block dropped,
   * which read as the model having forgotten the story.
   */
  it('refuses a call whose window has no room beside the reply, and sends nothing', async () => {
    makeRunner({ config: { limits: { ...DEFAULT_CONFIG.limits, contextTokens: 100 } } });

    const { turn } = await runTurn();

    expect(provider.requests).toHaveLength(0);
    expect(turn.status).toBe('failed');
    expect(narrator(turn)).toMatchObject({
      state: 'failed',
      error: { reason: 'window-too-small' },
    });
  });

  it('a skipped step is on the record as well as on the stream', async () => {
    // Silence is the worst possible answer to "why didn't that happen?".
    makeRunner({
      plan: {
        steps: [
          {
            definition: { ...TEST_STEP, id: 'se.rare', when: { when: 'armed', flag: 'never' } },
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

/**
 * ***A cadence counts the turns of the story*** (2026-09-27) —
 * `sessions/depth.ts`.
 *
 * `turnsOnPath` was the path's length, and a path holds turns nobody narrated:
 * the channel write a HUD edit or a dial change is, an undo, a backdrop choice.
 * So memory extraction *every eight turns* ran at whatever turn the bookkeeping
 * had shifted the modulus to, and a session that edited often could go a long
 * stretch without it.
 */
describe('a cadence counts the turns of the story', () => {
  const EVERY_OTHER: StepDefinition = {
    ...TEST_STEP,
    id: 'se.every-other',
    when: { when: 'cadence', everyNTurns: 2 },
  };

  it('is not moved by a channel write between two turns', async () => {
    makeRunner({
      plan: {
        steps: [
          { definition: EVERY_OTHER, run: () => Promise.resolve({}) },
          {
            definition: TEST_STEP,
            run: async (_i, host) => ({ message: { text: (await host.call({})).text } }),
          },
        ],
      },
    });

    const first = await runNextTurn();
    await writeChannel(sessions, ACCOUNT, sessionId, 'se.hook.pacing', 'sparse');
    const second = await runNextTurn();

    // The first turn of the story and the second: every other turn is the second,
    // with the dial change between them counted as nothing.
    expect(first.steps?.[0]).toMatchObject({ stepId: EVERY_OTHER.id, skipReason: 'cadence' });
    expect(second.steps?.[0]).toMatchObject({ stepId: EVERY_OTHER.id, state: 'ok' });
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
    // which is where [21 §1.4] puts them.
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
    expect(narrator(turn)).toMatchObject({ state: 'failed', error: { reason: 'unbound' } });
    expect(provider.requests).toHaveLength(0);
  });
});

/**
 * The producer end of [09 §3.5](../../../../docs/design/09-server-multiuser-deployment.md)
 * — [P10.1].
 *
 * ***A producer reports a fact and never a decision***, which is [09 §3.1]'s
 * rule at the only end that could break it: *"if the client decides what to
 * notify about, notifications only work while a client is connected."* So what
 * these assert is the **vocabulary** — that a committed turn says `complete`,
 * that a failed one says `failed` and carries a class rather than an endpoint's
 * sentence, and that a turn somebody stopped says nothing at all.
 *
 * **The falsifying mutation is announcing on `draft.status` alone.** Every
 * assertion about a completion and a failure still passes; what goes red is the
 * cancelled case, which is the only one of the three that needs a second fact.
 */
describe('a turn ending is news, and a turn you stopped is not', () => {
  it('says a committed turn completed, with the session by name', async () => {
    const { job } = await runTurn();

    /**
     * ***Waited for rather than assumed, and the reason is the ordering this
     * stage chose.*** `#announce` runs **after** `finaliseTurn`, which is what
     * marks the job committed — and `runTurn` returns on exactly that. So the
     * notification is genuinely still in flight when the turn is on disk, which
     * is correct (nothing below the commit may delay a turn) and makes a bare
     * assertion here a race. *Measured: it passed alone and failed under the
     * full suite's load, which is the worst way to find this out.*
     */
    await until(() => announced.length === 1, 'the turn to be announced');
    expect(announced[0]).toMatchObject({
      kind: 'turn.complete',
      account: ACCOUNT,
      sessionId,
      turnId: job.turnId,
    });
    // The name rather than the id — [09 §3.4] warns that params must carry
    // everything the sentence needs, or a composer produces "New event in
    // session 4f2a".
    expect(announced[0]).toHaveProperty('sessionName');
  });

  /**
   * ***A class, never a provider's words*** — [21 §1.4]. The endpoint's own
   * sentence goes to the log; what crosses this seam is something a client can
   * render in a language the server does not know.
   */
  it('says a failed turn failed, carrying the class and not the message', async () => {
    makeRunner({
      script: [{ stallMs: 5_000 }],
      config: { limits: { ...DEFAULT_CONFIG.limits, providerTimeoutMs: 60 } },
    });

    const { turn } = await runTurn();
    expect(turn.status).toBe('failed');

    await until(() => announced.length === 1, 'the failure to be announced');
    expect(announced[0]).toMatchObject({ kind: 'turn.failed', account: ACCOUNT, sessionId });
    const failure = announced[0] as Extract<Occurrence, { kind: 'turn.failed' }>;
    // One of the vocabulary's own words, and short enough that it cannot be a
    // sentence somebody pasted in.
    expect(failure.error).toBe('terminal');
    /**
     * ***And the remedy beside it*** — [P11.6]. The class is what the engine
     * did and the remedy is what a person could do, and this failure is the
     * case where the two disagree most: `terminal` reads as *we gave up*, while
     * the endpoint in fact accepted the request and then went quiet, which is
     * not something anybody should change a key over.
     */
    expect(failure.remedy).toBe('endpoint-stalled');
  });

  /**
   * ***The same remedy when the transport, not our timer, ran out of
   * patience*** (2026-09-27). undici's header and body limits sat beneath
   * `providerTimeoutMs`; a request they cut off was retried as transient and
   * then read as a refusal. It is a stall, asked once.
   */
  it('calls a transport that gave up on a quiet endpoint a stall, and asks once', async () => {
    makeRunner({
      script: [
        {
          error: {
            class: 'terminal',
            message: 'The provider call failed.',
            detail: 'Headers Timeout Error',
            stalled: true,
          },
        },
      ],
    });

    const { turn } = await runTurn();
    expect(turn.status).toBe('failed');
    expect(turn.request?.calls.at(-1)).toMatchObject({ outcome: 'error', retries: 0 });

    await until(() => announced.length === 1, 'the failure to be announced');
    const failure = announced[0] as Extract<Occurrence, { kind: 'turn.failed' }>;
    expect(failure.remedy).toBe('endpoint-stalled');
  });

  /**
   * ***[09 §6.5]'s sentence, reaching the seam it has to cross*** — [P11.6].
   *
   * `remedy.test.ts` owns the decision table; what this asserts is the **wiring**
   * — that the runner reads its connectivity seam at the moment a turn fails and
   * puts the answer where a notification can find it. A `remedyFor` that is
   * perfect and never called is the failure this covers, and it is the failure
   * an argument about the table would not.
   */
  it('reads connectivity when a turn fails, and says so in the announcement', async () => {
    makeRunner({
      script: [{ error: { class: 'transient', message: 'fetch failed' } }],
      connectivity: () => false,
    });

    const { turn } = await runTurn();
    expect(turn.status).toBe('failed');

    await until(() => announced.length === 1, 'the failure to be announced');
    const failure = announced[0] as Extract<Occurrence, { kind: 'turn.failed' }>;
    expect(failure.error).toBe('transient');
    expect(failure.remedy).toBe('endpoint-silent-offline');
  });

  /**
   * The same failure with the internet known to work blames the endpoint
   * instead — the distinction [P10.3] paid for and the one that makes the
   * sentence above trustworthy rather than a default.
   */
  it('blames the endpoint rather than the network when the internet works', async () => {
    makeRunner({
      script: [{ error: { class: 'transient', message: 'fetch failed' } }],
      connectivity: () => true,
    });

    await runTurn();
    await until(() => announced.length === 1, 'the failure to be announced');
    const failure = announced[0] as Extract<Occurrence, { kind: 'turn.failed' }>;
    expect(failure.remedy).toBe('endpoint-silent-online');
  });

  /**
   * ***Nothing at all, and that is the judgement this stage makes.*** The
   * person pressed **Stop**; a toast saying *your turn failed* reports their
   * own act back to them as a problem. `aborted` alone cannot tell the two
   * apart, which is why the runner tracks why it stopped.
   */
  it('says nothing about a turn somebody stopped', async () => {
    makeRunner({ script: [{ text: 'a slow answer', chunks: 8, chunkDelayMs: 15 }] });
    const job = await reserve();
    runner.start(job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });

    await until(
      () => readEvents(commit, job.id).some((e) => e.key === 'call.streaming'),
      'a chunk',
    );
    runner.cancel(job.id);
    await until(() => readJob(state.db, job.id)?.status === 'committed', 'the cancelled commit');

    /**
     * ***An absence needs a window, and this one is bought with a second turn
     * rather than with a sleep*** — which is this file's standing rule, *"no
     * sleeps anywhere: the store is the clock"*.
     *
     * `#announce` runs after `finaliseTurn`, so reading `announced` the instant
     * the cancelled job commits would prove only that nothing was announced
     * **synchronously** — weaker than the claim, and green on a build that
     * announced cancellations a tick later. So a second, ordinary turn follows
     * it: when *its* completion has been announced, anything the cancelled turn
     * was going to say has had its turn too, because both take the same path and
     * the cancelled one started first.
     */
    // **The same runner**, deliberately: `makeRunner` clears `announced`, which
    // would throw away the very thing this is checking for.
    await runNextTurn();
    await until(() => announced.length > 0, 'the next turn to be announced');

    // Exactly one, and it is the *second* turn's. A cancellation that announced
    // itself would appear ahead of it.
    expect(announced.map((one) => one.kind)).toEqual(['turn.complete']);
    expect(announced[0]).not.toMatchObject({ turnId: job.turnId });
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
    expect(narrator(written[0]?.turn)?.error?.reason).toBe('cancelled');
  });

  /**
   * **The interrupted call is on the record** — finding 2 in
   * [P2C log](../../../../docs/design/workplan/14-p2c-log.md).
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
            definition: TEST_STEP,
            run: async (_input, host) => {
              const result = await host.call({
                candidates: [
                  {
                    id: 'step.own',
                    source: { kind: 'step', stepId: TEST_STEP.id },
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
   * [10 §3]'s third effect outcome, linked rather than inferred — [P3.0]. A
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
            definition: TEST_STEP,
            run: async (_input, host) => {
              const result = await host.call({});
              return {
                message: { text: result.text },
                effects: [
                  {
                    channelId: SE_CLOCK,
                    op: { type: 'set', path: '/' },
                    after: { day: 9, hour: 0, minute: 0 },
                    proposedBy: { kind: 'step', stepId: TEST_STEP.id },
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
            definition: TEST_STEP,
            run: async (_input, host) => {
              const result = await host.call({});
              return {
                message: { text: result.text },
                effects: [
                  {
                    channelId: SE_CLOCK,
                    op: { type: 'set', path: '/' },
                    after: { day: 9, hour: 0, minute: 0 },
                    proposedBy: { kind: 'step', stepId: TEST_STEP.id },
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
    // first-class gesture in this project rather than a contrivance ([09 §4.3]).
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
   * the URL. [21 §4.1] asks for the bindings to be set once where the subject
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
    // [21 §4.1] says portable object bodies never appear in a log.
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
    expect(TEST_STEP.callKind).toBe('narrate');
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
  /**
   * **What [P5.9] ends at**, run rather than described: *a treatment's sample
   * and a character's sample in one prompt, each addressable in the block
   * table, each with its own cost and its own drop rule.*
   *
   * The unit tests prove the collector's three arms apart. This proves the join
   * — a session naming a treatment, the gather resolving it, the carriers
   * reaching the slot, and both objects' prose arriving in one assembled
   * record with the owner that carried each. Every step of that is a place a
   * correct piece can be attached to the wrong thing and produce silence.
   */
  it('puts a treatment’s sample and an actor’s in one prompt, each addressable', async () => {
    const noir = newTreatment('Rain City Noir');
    noir.writingSamples = [
      { id: 't-s1', title: 'Tone', body: 'The rain never lets up.', enabled: true, note: '' },
    ];
    await create(library, ACCOUNT, noir);

    const vera = newActor('Vera');
    vera.writingSamples = [
      {
        id: 'a-s1',
        title: 'Voice',
        body: 'She says less than she knows.',
        enabled: true,
        note: '',
      },
    ];
    await create(library, ACCOUNT, vera);

    const session = await createSession(sessions, ACCOUNT, {
      name: 'Samples',
      preset: TEST_PRESET,
      treatment: noir.id,
      cast: { persona: null, actors: [vera.id] },
    });

    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: session.id,
      idempotencyKey: 'samples-1',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', session.id, 'turns'),
    );
    const turn = onRecord(written[0], 'the turn on disk').turn;
    const blocks = onRecord(callOnRecord(turn).blocks, 'the assembled blocks');
    const samples = blocks.filter((one) => one.source.kind === 'samples');

    // Both carriers, in [04 §3.1]'s declared order: the stance, then the person.
    expect(samples.map((one) => one.text)).toEqual([
      'The rain never lets up.',
      'She says less than she knows.',
    ]);
    // Each addressable to the object that carried it, and each with its own
    // cost — which is what makes them two blocks rather than one.
    expect(samples.map((one) => one.source)).toEqual([
      {
        kind: 'samples',
        owner: { kind: 'treatment', id: noir.id, contentHash: expect.any(String) },
        sampleId: 't-s1',
      },
      {
        kind: 'samples',
        owner: { kind: 'actor', id: vera.id, contentHash: expect.any(String) },
        sampleId: 'a-s1',
      },
    ]);
    expect(new Set(samples.map((one) => one.id)).size).toBe(2);
    expect(samples.every((one) => one.tokens > 0)).toBe(true);
  });

  /**
   * ***[P7B §3.2] row 7, run rather than cited*** (2026-09-27). The row asks for
   * *a treatment's framing in the next turn's `se.treatment` block* and was
   * answered *yes* on the strength of the editor writing the field and the
   * assembler having read it since P5 — which it had not: the collector's arm
   * returned nothing, so the block was dropped as empty on every turn. This
   * takes the whole path the row names, from the object in the library to the
   * block on the turn's record.
   */
  it('puts a treatment’s framing into the turn’s treatment block', async () => {
    const noir = newTreatment('Rain City Noir');
    noir.framing = 'It always rains here, and nobody tells the whole truth.';
    await create(library, ACCOUNT, noir);

    const session = await createSession(sessions, ACCOUNT, {
      name: 'Framing',
      preset: TEST_PRESET,
      treatment: noir.id,
      cast: { persona: null, actors: [] },
    });

    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: session.id,
      idempotencyKey: 'framing-1',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', session.id, 'turns'),
    );
    const turn = onRecord(written[0], 'the turn on disk').turn;
    const blocks = onRecord(callOnRecord(turn).blocks, 'the assembled blocks');

    expect(
      blocks
        .filter((one) => one.source.kind === 'treatment')
        .map((one) => [one.id, one.text, one.source]),
    ).toEqual([
      [
        'se.treatment',
        'It always rains here, and nobody tells the whole truth.',
        { kind: 'treatment', part: 'framing' },
      ],
    ]);
  });

  /**
   * ***A card's own name reaches the wire, and its placeholder does not***
   * (2026-09-27). The join the converter's own tests cannot show: a real
   * SillyTavern card through the real converter, into the library, into a
   * cast, into a turn. Its example dialogue said `{{char}}`, which nothing
   * here renders in prose, so until the import wrote the name in, the braces
   * were what the model read. The player's placeholder is kept on purpose and
   * the review says so; see `inOwnName`.
   */
  it('sends an imported card’s own name where the card left a placeholder', async () => {
    const converted = convertCard(
      {
        spec: 'chara_card_v2',
        data: {
          name: 'Vera Solano',
          description: '{{char}} inspects the docks.',
          mes_example: '<START>\n{{user}}: Anything unusual?\n{{char}}: Define unusual.',
        },
      },
      'fallback',
    );
    if (!converted.ok) throw new Error(`refused: ${converted.refusal}`);
    const vera = converted.value.actor;
    await create(library, ACCOUNT, vera);

    const session = await createSession(sessions, ACCOUNT, {
      name: 'Imported',
      preset: TEST_PRESET,
      cast: { persona: null, actors: [vera.id] },
    });
    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: session.id,
      idempotencyKey: 'imported-1',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', session.id, 'turns'),
    );
    const turn = onRecord(written[0], 'the turn on disk').turn;
    const blocks = onRecord(callOnRecord(turn).blocks, 'the assembled blocks');

    expect(blocks.find((one) => one.source.kind === 'samples')?.text).toBe(
      '<START>\n{{user}}: Anything unusual?\nVera Solano: Define unusual.',
    );
    expect(blocks.find((one) => one.id === `se.actor.summary.${vera.id}`)?.text).toBe(
      'Vera Solano inspects the docks.',
    );
    expect(blocks.filter((one) => /\{\{\s*char\s*\}\}/i.test(one.text))).toEqual([]);
  });

  /**
   * **The book carrier, in a real turn, with nothing having matched.**
   *
   * Its own test rather than a third fixture in the one above, because it
   * proves the property that makes samples a *slot* rather than a feature of
   * the retriever: the book's prose is offered because the book is in play, and
   * the entry that would have matched is deliberately absent. A wiring that fed
   * the samples arm from the activated blocks would pass every test above and
   * fail this one.
   */
  it('offers a book’s sample with no entry of that book having fired', async () => {
    const book = newLorebook('Rain City');
    book.writingSamples = [
      { id: 'b-s1', title: 'Register', body: 'Nobody hurries here.', enabled: true, note: '' },
    ];
    // A key nothing in this turn will say, so the retriever activates nothing.
    book.entries = [{ ...newLoreEntry('Unrelated'), keys: ['a-word-nobody-types'] }];
    await create(library, ACCOUNT, book);

    const session = await createSession(sessions, ACCOUNT, {
      name: 'Book samples',
      preset: TEST_PRESET,
      lore: [book.id],
    });
    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: session.id,
      idempotencyKey: 'samples-2',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', session.id, 'turns'),
    );
    const call = callOnRecord(onRecord(written[0], 'the turn on disk').turn);
    const blocks = onRecord(call.blocks, 'the assembled blocks');

    expect(blocks.filter((one) => one.source.kind === 'samples').map((one) => one.text)).toEqual([
      'Nobody hurries here.',
    ]);
    // And nothing activated, which is the whole point of the fixture.
    expect(blocks.filter((one) => one.source.kind === 'lore')).toEqual([]);
  });

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
      preset: TEST_PRESET,
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
     * And the slot that was filled is not *also* reported empty. The two lists
     * partition the preset's applicable blocks, so a block on the record beside
     * its own row in `notFilled` would mean the collector counted it twice.
     *
     * **Asserted per slot rather than per source kind since [P6B.1]**, which is
     * the stage that gave the preset a second lore slot: lore has two phases
     * and had one slot, so every `after_char` entry activated, spent its book's
     * budget and vanished ([P5 §0.5]). With two slots, *a lore row in
     * `notFilled`* stopped meaning double-counting and started being the
     * ordinary state of the phase this turn's entry did not use — so the claim
     * is restated at the granularity it was always about, and `se.lore.after`
     * reporting `empty-source` here is correct rather than a regression.
     */
    const notFilled = callOnRecord(turn).notFilled ?? [];
    expect(notFilled.find((slot) => slot.blockId === 'se.lore')).toBeUndefined();
  });

  /**
   * The counters are a channel ([P5.5]), so a turn that fires an entry has to
   * leave an effect behind — otherwise nothing reconstructs at a node and a
   * branch inherits the wrong stickiness. Asserted on the effect log rather
   * than on the session's snapshot, because the log is what [07 §4] replays.
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
      preset: TEST_PRESET,
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

  /**
   * **The two budgets meeting in one verdict**, on a real record — [P5 §1.3]'s
   * *every skip lands in the `BudgetVerdict` with the rule that made it*.
   *
   * The per-book tier runs long before the chat-wide cut and its refusals are
   * not candidates, so nothing carries them to the record unless something is
   * made to. Without this, *four lore entries matched and their book had no
   * room* is a fact the record does not contain — and it has a different repair
   * from *the turn was too long*, which is the whole reason the tiers are
   * distinguished at all.
   */
  it("lands a book's own budget refusal in the turn's verdict, with its rule", async () => {
    const book = newLorebook('Rain City');
    book.tokenBudget = 1;
    book.entries = [
      {
        ...newLoreEntry('The Ferryman'),
        keys: ['ferryman'],
        content: 'He works the crossing and remembers every face that ever crossed it.',
      },
    ];
    await create(library, ACCOUNT, book);

    const withLore = await createSession(sessions, ACCOUNT, {
      name: 'A full book',
      preset: TEST_PRESET,
      lore: [book.id],
    });
    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: withLore.id,
      idempotencyKey: 'lore-3',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    const said = 'She asked the ferryman.';
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: said, raw: said } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', withLore.id, 'turns'),
    );
    const turn = onRecord(written[0], 'the turn on disk').turn;
    const call = callOnRecord(turn);
    const entryId = book.entries[0]?.id ?? '';
    const decisions = onRecord(call.budget, 'the budget verdict on the call').decisions;
    const row = decisions.find((one) => one.blockId.includes(entryId));

    expect(row?.included).toBe(false);
    // The rule names the setting to change, which is the point of it being a
    // sentence rather than an enum.
    expect(row?.rule).toContain('token budget');
    // And it is not in the prompt, nor counted against what the turn spent.
    expect(
      onRecord(call.blocks, 'the assembled blocks').filter((block) => block.source.kind === 'lore'),
    ).toEqual([]);
  });

  /**
   * ***And it has not fired*** (2026-09-27). The counters were proposed before
   * the book's own budget, the outlets or the chat-wide cut had had their say,
   * so the entry the record above shows refused was also recorded as having
   * fired — an `ephemeral: 1` entry spent on a turn it never reached, and never
   * read at all. They are settled now against what the assembled call carried.
   */
  it('leaves the counters of an entry its book had no room for where they were', async () => {
    const book = newLorebook('Rain City');
    book.tokenBudget = 1;
    book.entries = [
      {
        ...newLoreEntry('The Ferryman'),
        keys: ['ferryman'],
        content: 'He works the crossing and remembers every face that ever crossed it.',
        ephemeral: 1,
      },
    ];
    await create(library, ACCOUNT, book);

    const withLore = await createSession(sessions, ACCOUNT, {
      name: 'A full book, once',
      preset: TEST_PRESET,
      lore: [book.id],
    });
    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: withLore.id,
      idempotencyKey: 'lore-once',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    const said = 'She asked the ferryman.';
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: said, raw: said } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', withLore.id, 'turns'),
    );
    const turn = onRecord(written[0], 'the turn on disk').turn;

    expect(turn.effects.filter((effect) => effect.channelId === SE_LORE_TIMING)).toEqual([]);
  });

  it('drops a block whose appliesTo does not name this step kind', async () => {
    // Driven through the runner with a session whose preset scopes one block to
    // a call kind the step does not make.
    const scoped = await createSession(sessions, ACCOUNT, {
      name: 'Scoped',
      preset: {
        ...TEST_PRESET,
        blocks: [
          {
            ...TEST_PRESET.blocks[0]!,
            id: 'se.only-for-summaries',
            label: 'only for summaries',
            appliesTo: ['summarise'],
          },
          TEST_PRESET.blocks.find((block) => block.id === 'se.input')!,
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
      temperature: TEST_PRESET.params.temperature,
      maxTokens: TEST_PRESET.params.maxTokens,
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
    expect(limit.share).toBe(TEST_PRESET.budget.contextShare);
    expect(limit.tokens).toBe(
      Math.floor(DEFAULT_CONFIG.limits.contextTokens * TEST_PRESET.budget.contextShare),
    );
  });

  it('records the params it actually used on the call', async () => {
    // [21 §1.4]: the record answers "why is this turn different", which it
    // cannot do if the params it names are not the params that were sent.
    const { turn } = await runTurn();
    expect(turn.request?.calls[0]?.params).toEqual(provider.requests[0]?.params);
  });
});

describe('the turn record answers what actually ran — gate step 11', () => {
  it('gives every block a source and a reason, universally', async () => {
    // `toContain` on one kind passed while most blocks carried neither. The
    // record's whole job is answering *why is this in the prompt* ([03 §8]), and
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
    // ~~300~~ (2026-09-27): three-quarters of 300 is less than the 800 kept
    // for the reply, which is no window at all and is refused now (below).
    // 1200 leaves 100 tokens to spend: pressure, and a call to make.
    makeRunner({ config: { limits: { ...DEFAULT_CONFIG.limits, contextTokens: 1200 } } });
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
   * fabricating one, and [21 §1.4] is *provider-reported, not estimated* —
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
            definition: TEST_STEP,
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

  /**
   * ***Money follows the tokens' rule*** — the field added 2026-09-27. Null is
   * *not priced*, which is what every real adapter produces today; a figure
   * appears only when every call's provider gave one, in one currency.
   */
  it('says the turn was not priced when the provider priced nothing', async () => {
    const { turn } = await runTurn();
    expect(turn.cost?.money).toBeNull();
  });

  it('adds up what every call was priced at, in one currency', async () => {
    makeRunner({
      script: [
        { text: 'first', cost: { amount: 0.002, currency: 'USD' } },
        { text: 'second', cost: { amount: 0.001, currency: 'USD' } },
      ],
      plan: {
        steps: [
          {
            definition: TEST_STEP,
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
    expect(turn.cost?.money?.currency).toBe('USD');
    expect(turn.cost?.money?.amount).toBeCloseTo(0.003, 10);
  });

  /**
   * ***No exchange rate, and no partial sum.*** Dollars on one connection and a
   * provider's credits on another have no total this build can write without
   * estimating one, and a total missing a term is wrong rather than smaller —
   * the token rule's own argument, one test up.
   */
  it('gives no total across two currencies', async () => {
    makeRunner({
      script: [
        { text: 'first', cost: { amount: 0.002, currency: 'USD' } },
        { text: 'second', cost: { amount: 3, currency: 'credits' } },
      ],
      plan: {
        steps: [
          {
            definition: TEST_STEP,
            run: async (_input, host) => {
              await host.call({});
              await host.call({});
              return {};
            },
          },
        ],
      },
    });

    expect((await runTurn()).turn.cost?.money).toBeNull();
  });

  it('gives no total when one call went unpriced', async () => {
    makeRunner({
      script: [{ text: 'first', cost: { amount: 0.002, currency: 'USD' } }, { text: 'second' }],
      plan: {
        steps: [
          {
            definition: TEST_STEP,
            run: async (_input, host) => {
              await host.call({});
              await host.call({});
              return {};
            },
          },
        ],
      },
    });

    expect((await runTurn()).turn.cost?.money).toBeNull();
  });

  it('keeps every draw on the tape, keyed by site', async () => {
    // **The clause that was structurally vacuous**: `tape` was asserted as an
    // array while nothing in a P2 turn draws, so an empty array satisfied it
    // forever. A step that actually draws is what makes it mean something.
    makeRunner({
      plan: {
        steps: [
          {
            definition: { ...TEST_STEP, id: 'se.dice', role: null },
            run: async (_input, host) => {
              // Through the host's `random` since [P7.0] — awaited, because the
              // seam is async whether or not a worker is on the other side of
              // it yet, and the tape is the same tape.
              await host.random.at('se.dice', 'opening').int(1, 6);
              await host.random.at('se.dice', 'opening').int(1, 6);
              return {};
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
   * because there is no estimator — [21 §1.4] says `usage` is
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

    // …and the same numbers on the call itself, which is where [21 §1.4] puts
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
            // `TEST_STEP` minus its role: same stage, same `contributes:
            // 'messages'`, same empty `writes` — so `callPurposeFor` still
            // yields `prose` and the assembler behaves identically. The role is
            // the only difference, which is the difference under test.
            definition: { ...TEST_STEP, id: 'se.preflight', role: 'fast' },
            run: async (_input, host) => {
              await host.call({ stream: true });
              return {};
            },
          },
          {
            definition: TEST_STEP,
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
   *   `parentTurnId` is null by [03 §8], and the clock effect's `before` is
   *   null because the channel had no value yet. Walking turn two puts real
   *   data in both, so **neither needs a place on the allowlist** — which turns
   *   two excuses into two assertions: that a turn names its parent, and that
   *   the clock effect records the time it moved from. An effect that cannot
   *   state where it came from is not invertible, which is [21 §1.2.1].
   *
   * Mutation this catches: any production change that starts writing `null`
   * into the record — a `resolved` that stops carrying its `modelId`, a
   * `budget` verdict dropped from the request, a `before` that is not captured,
   * a block whose `source` is not filled in — including on a field added after
   * this test was written, which is the property a spot check cannot have.
   */
  it('carries no null where [21 §1] says data, on the record as it comes off disk', async () => {
    // Scripted, so `usage` and `cost` carry figures. They are *allowed* to be
    // null by [21 §1.4], and are therefore on the allowlist — which means the
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

    expect(offending, `null where [21 §1] says data: ${offending.join(', ')}`).toEqual([]);

    // The allowlist's two escape hatches, closed for this turn. [21 §1.4]
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
 * - `input.actorId` — [03 §8]: an input not attributed to an actor. Scene has
 *   a fixed participant and never attributes one.
 * - `effects[*].scopeKey` — [21 §1.2]: *which value, when the channel is scoped
 *   per actor or per entry*. `se.clock` declares `scope: 'session'`, so there
 *   is no key to name.
 * - `effects[*].rejectedReason` — [21 §1.2]: *present when `applied` is false*.
 *   The clock effect is engine-proposed against an `engine-computed` channel,
 *   so it is admitted and there is no refusal to state.
 * - `request.calls[*].usage` and `.cost` — [21 §1.4]: provider-*reported*, and
 *   a provider that reports nothing must be recorded as having reported nothing
 *   rather than as having reported zero. The turn under test scripts both, so
 *   the walk's caller closes these two by hand — an allowlist entry is a
 *   permission, not a place to hide a regression.
 * - `request.calls[*].error` — [21 §1.4]: the classified failure, null on a
 *   call that succeeded.
 * - `effects[*].supersedes` — [21 §1.2] via [P3.0]: the refusal an engine
 *   write replaced. Null is "this effect superseded nothing", which is the
 *   ordinary clock advance on a turn where nothing proposed against it —
 *   exactly this turn.
 *
 * **Two permissions the doc grants and this record does not need**, which is
 * why they are absent and each absence is an extra assertion. Both are granted
 * *for the first turn of a session*, and the walk deliberately runs on the
 * second: `parentTurnId` ([03 §8] — null for the first turn, every other turn
 * names its parent) and `effects[*].before` ([21 §1.2.1] — the state the effect
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
 * **Capability enforcement** — [P2A §2.1](../../../../docs/design/workplan/09-p2a-configuration-surface.md),
 * [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md), gate step 6.
 *
 * From P2.5 until P2A the runner passed `{ privateConnections: true }` into
 * `resolveConnections` as a **literal**, which defeated the one check
 * [09 §4.5] calls load-bearing. It calls it that precisely because the
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
    expect(narrator(turn)?.error?.reason).toBe('dangling');
  });

  /**
   * **The count, and only the count.**
   *
   * [09 §4.5] keeps a connection opaque, so the line says how many were ignored
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
   * this project rather than a contrivance ([09 §4.3]) — and the only way to
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
    expect(narrator(turn)?.error?.reason).toBe('dangling');
  });
});

/**
 * **The install default, through a real turn** — [P2B §3](../../../../docs/design/workplan/10-p2b-provider-configuration.md)
 * stage P2B.0's ending, and [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md)'s
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
 * [21 §1.4](../../../../docs/design/21-internal-contracts.md) specifies it that way. So these
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
   * **A dangling personal binding falls through** — the sentence [09 §4.5] has
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
    expect(narrator(turn)?.error?.reason).toBe('dangling');
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
    // **Across every call, not `calls[0]`** — corrected at [P8.1], which added a
    // `pre` step that makes one. The turn's first call has not been the
    // narration since the hook selector shipped; it was only ever this
    // fixture's, and a summariser in the plan is what made the difference
    // visible. What the test means is *the history blocks this turn sent*.
    const blocks = (written.at(-1)?.turn.request?.calls ?? []).flatMap((call) => call.blocks ?? []);
    const fromHistory = blocks.filter((block) => block.source.kind === 'history');
    const turnIds = new Set(
      fromHistory.map((block) => (block.source.kind === 'history' ? block.source.turnId : '')),
    );

    // Twenty turns of history, not twenty-five — and the newest ones.
    expect(turnIds.size).toBe(20);
    expect(turnIds.has(parent ?? '')).toBe(true);
  });
});

/**
 * **A mode whose `select` is not `fixed`, running** — [P7.3]'s own *Ends at*,
 * [06 §7.2]'s *"the policy selects speakers"*, and ***the arms as ST runs them
 * since [P13.1]***.
 *
 * The unit tests in `speakers.test.ts` say what each arm decides, row by row
 * against `group-chats.js`; what only a turn can say is that the decision is
 * **made once, before the loop, from the session's settings and the path, and
 * reaches a step** — and that a rewrite makes the same one. `ENSEMBLE_MODE`
 * declares `select: 'list'` and its step echoes what it was handed, which is
 * the one way a selection is observable from outside — downstream, a merged
 * call names nobody by design and `actorId` reaches `resolveRole` and stops.
 *
 * *The rotation tests this block used to hold went with the rotation*: ~~`list`
 * rotates one speaker per turn on the path's depth~~ was P7.3's reading, and
 * ST's LIST is everybody, once each, every round ([P13 §0.7]).
 */
describe('a mode that selects speakers', () => {
  /**
   * ***The ensemble fixture under `castIsPresent`*** — [P13 §1.3]. A variant
   * rather than a change to the fixture, because the tests below that write
   * presence are about the old reading, which is still every mode's that does
   * not ask for the new one.
   */
  const CHAT_MODE_ID = `${ENSEMBLE_MODE_ID}.chat`;

  beforeEach(() => {
    /**
     * Process-wide and not cleared afterwards, which is safe rather than
     * sloppy: nothing else in the build names these ids, and `installBuiltIns`
     * re-registers the real modes on every `beforeEach` in this file. A
     * fixture that needed *removing* would be a reason to give the registry a
     * reset; this one does not.
     */
    registerMode(ENSEMBLE_MODE);
    registerMode({
      ...ENSEMBLE_MODE,
      definition: {
        ...ENSEMBLE_MODE.definition,
        id: CHAT_MODE_ID,
        participants: { ...ENSEMBLE_MODE.definition.participants, castIsPresent: true },
      },
    });
  });

  /**
   * A session playing the ensemble fixture, with the named actors in the room.
   *
   * *`speakers` is the session's own policy*, written the way creation writes
   * it — so a test that passes one is testing that the session's setting wins
   * over the mode's `list`.
   */
  async function ensemble(
    actors: string[],
    present: string[] | null = actors,
    speakers?: SessionFile['speakers'],
  ): Promise<string> {
    const session = await createSession(sessions, ACCOUNT, {
      name: 'Ensemble',
      mode: { id: present === null ? CHAT_MODE_ID : ENSEMBLE_MODE_ID, config: null },
      preset: TEST_PRESET,
      cast: { persona: null, actors },
      ...(speakers === undefined ? {} : { speakers }),
    });
    // Present, because under the old reading eligibility is presence and
    // status — which is the half of the taxonomy that could not have been
    // built before [P7.2]. `null` is the chat variant, where nobody needs to be
    // said to be here.
    for (const id of present ?? []) {
      await writeChannel(sessions, ACCOUNT, session.id, `${SE_PRESENCE}#${id}`, true);
    }
    return session.id;
  }

  /** The session's speaker settings, with one policy — what creation writes. */
  function policy(
    select: 'natural' | 'list' | 'pooled' | 'manual' | 'smart',
  ): NonNullable<SessionFile['speakers']> {
    return { policy: select, allowSelfResponses: false, namesInHistory: 'groups', maxPerRound: 3 };
  }

  /**
   * One turn, and who its step said it was speaking for — as a list, since a
   * round is several.
   */
  async function spoke(
    sessionId: string,
    key: string,
    options: {
      text?: string;
      speakers?: string[];
      parentTurnId?: string | null;
      replay?: Turn['tape'];
      /** What the route reads off a rewrite's redone turn — `TurnPayload.keptSpeakers`. */
      kept?: readonly string[];
    } = {},
  ): Promise<{ turn: Turn; chosen: string[] }> {
    const head = (await readSession(sessions, ACCOUNT, sessionId))?.headTurnId ?? null;
    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId,
      idempotencyKey: key,
      headTurnId: head,
      ...(options.parentTurnId === undefined ? {} : { parentTurnId: options.parentTurnId }),
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    const text = options.text ?? 'Well?';
    runner.start(outcome.job, {
      input: { actorId: null, kind: 'do', text, raw: text },
      ...(options.speakers === undefined ? {} : { speakers: options.speakers }),
      ...(options.replay === undefined ? {} : { replay: options.replay }),
      ...(options.kept === undefined ? {} : { keptSpeakers: options.kept }),
    });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    const turn = onRecord(
      written.find((record) => record.turn.id === outcome.job.turnId),
      'the turn on disk',
    ).turn;
    const said = turn.output?.text ?? '';
    const inside = said.slice(1, said.indexOf(']'));
    return { turn, chosen: inside === '' ? [] : inside.split(',') };
  }

  it('answers with everybody in the room, in cast order, every round', async () => {
    makeRunner();
    const vera = newActor('Vera');
    const lund = newActor('Lund');
    await create(library, ACCOUNT, vera);
    await create(library, ACCOUNT, lund);

    const sessionId = await ensemble([vera.id, lund.id]);

    const first = await spoke(sessionId, 'ensemble-1');
    expect(first.turn.status).toBe('complete');
    expect(first.chosen).toEqual([vera.id, lund.id]);

    // The same again: nothing rotates, and nobody is skipped for having just
    // spoken — ST's LIST bans nobody (`group-chats.js:1180`).
    const second = await spoke(sessionId, 'ensemble-2');
    expect(second.chosen).toEqual([vera.id, lund.id]);
  });

  it('skips somebody who is not in the room, so the policy reads the channels', async () => {
    // The same cast with Vera absent — so a selector that read `cast.actors`
    // rather than who is eligible would still answer Vera, and this is what
    // would notice.
    makeRunner();
    const vera = newActor('Vera');
    const lund = newActor('Lund');
    await create(library, ACCOUNT, vera);
    await create(library, ACCOUNT, lund);

    const sessionId = await ensemble([vera.id, lund.id], [lund.id]);

    expect((await spoke(sessionId, 'absent-1')).chosen).toEqual([lund.id]);
  });

  it('selects nobody when the room is empty, and still runs the turn', async () => {
    // The whole cast absent is the case a selector must not turn into a failure:
    // [00 §3.3] is resolve what you can, and a scene with nobody in it is a
    // scene the narrator answers.
    makeRunner();
    const vera = newActor('Vera');
    await create(library, ACCOUNT, vera);

    const sessionId = await ensemble([vera.id], []);
    const only = await spoke(sessionId, 'ensemble-empty');

    expect(only.turn.status).toBe('complete');
    expect(only.turn.output?.text.startsWith('[] ')).toBe(true);
  });

  /**
   * **`castIsPresent`: a cast nobody has said anything about is all here** —
   * [P13 §1.3]. Without it a chat is an empty room, because nothing in the
   * build writes presence; with it, presence `false` is *muted*.
   */
  it('counts the cast as present under castIsPresent, and leaves out the muted', async () => {
    makeRunner();
    const vera = newActor('Vera');
    const lund = newActor('Lund');
    await create(library, ACCOUNT, vera);
    await create(library, ACCOUNT, lund);

    const sessionId = await ensemble([vera.id, lund.id], null);
    expect((await spoke(sessionId, 'chat-1')).chosen).toEqual([vera.id, lund.id]);

    await writeChannel(sessions, ACCOUNT, sessionId, `${SE_PRESENCE}#${vera.id}`, false);
    expect((await spoke(sessionId, 'chat-2')).chosen).toEqual([lund.id]);
  });

  /**
   * ***The session's policy wins over the mode's*** — [P13 §1.2]. The fixture
   * declares `list`; a session created with `manual` answers an input with
   * nobody, which `list` never would.
   */
  it('plays the session’s policy rather than the mode’s declaration', async () => {
    makeRunner();
    const vera = newActor('Vera');
    await create(library, ACCOUNT, vera);

    const sessionId = await ensemble([vera.id], null, policy('manual'));
    expect((await spoke(sessionId, 'manual-1')).chosen).toEqual([]);
  });

  /**
   * **Force-talk overrides the policy** — [P13 §1.3], `group-chats.js:1006`.
   * `manual` replying to an input is nobody, so a forced turn answering at all
   * is the override working; and a muted member is who the button reaches.
   */
  it('answers with whoever a submission forced, muted or not', async () => {
    makeRunner();
    const vera = newActor('Vera');
    const lund = newActor('Lund');
    await create(library, ACCOUNT, vera);
    await create(library, ACCOUNT, lund);

    const sessionId = await ensemble([vera.id, lund.id], null, policy('manual'));
    await writeChannel(sessions, ACCOUNT, sessionId, `${SE_PRESENCE}#${lund.id}`, false);

    const forced = await spoke(sessionId, 'forced-1', { speakers: [lund.id, vera.id] });
    expect(forced.chosen).toEqual([lund.id, vera.id]);
  });

  /**
   * ***A rewrite picks the same speakers*** — [P13.1]'s proof obligation, and
   * [19 §14.5]'s *same mechanical outcome, different prose* reaching who
   * speaks. `natural` over three members draws a shuffle and a roll each, so
   * the first turn's tape carries the selector's draws; the rewrite is a
   * sibling handed that tape, and every one of those draws must come off it.
   */
  it('picks the same speakers when a turn is rewritten from its tape', async () => {
    makeRunner();
    const cast = [newActor('Vera'), newActor('Lund'), newActor('Abel')];
    for (const actor of cast) await create(library, ACCOUNT, actor);

    const sessionId = await ensemble(
      cast.map((actor) => actor.id),
      null,
      policy('natural'),
    );

    const original = await spoke(sessionId, 'natural-1', { text: 'The rain did not let up.' });
    const drawn = original.turn.tape.filter((draw) => draw.site === 'se.participants');
    // **Before anything about replay**: the selector actually drew. Without
    // this the rest holds just as well for a turn that drew nothing.
    expect(drawn.filter((draw) => draw.purpose.startsWith('talkativeness:'))).toHaveLength(3);
    expect(original.chosen.length).toBeGreaterThan(0);

    const rewrite = await spoke(sessionId, 'natural-2', {
      text: 'The rain did not let up.',
      parentTurnId: original.turn.parentTurnId,
      replay: original.turn.tape,
    });

    expect(rewrite.turn.parentTurnId).toBe(original.turn.parentTurnId);
    expect(rewrite.chosen).toEqual(original.chosen);
    const redrawn = rewrite.turn.tape.filter((draw) => draw.site === 'se.participants');
    expect(redrawn.map((draw) => draw.key)).toEqual(drawn.map((draw) => draw.key));
    expect(redrawn.every((draw) => draw.replayed)).toBe(true);
  });

  /**
   * ***A rewrite of a forced turn keeps who was forced*** — [P13.1], and the
   * one choice of speaker that is neither a draw on the tape nor a model's
   * answer, so neither `replay` nor `keptSpeakers` can carry it.
   *
   * The forced turn records its list on `input.speakers`, and the rewrite is
   * handed what the route hands it: the tape, `keptSpeakers`, and that list
   * read back off the record. **Lund is muted and his talkativeness is 0**, so
   * no policy would choose him on its own. The control is the same rewrite
   * handed the tape alone — the route before this fix — which under each
   * policy answers with somebody else: `manual` replying to an input is
   * nobody, and `natural`, like `smart`'s rewrite replaying the tape's pick,
   * is Vera, whose talkativeness is 1. Neither forced rewrite makes a smart
   * call: force-talk settles the turn before the rules could ask.
   */
  const forcedRewrites: ['manual' | 'natural' | 'smart', 'vera' | null][] = [
    ['manual', null],
    ['natural', 'vera'],
    ['smart', 'vera'],
  ];
  for (const [select, withoutIt] of forcedRewrites) {
    it(`keeps a forced speaker on a rewrite under ${select}, muted as he is`, async () => {
      makeRunner();
      const talk = (value: number): Record<string, unknown> => ({
        [CHAT_MODE_ID]: { talkativeness: value },
      });
      const vera = { ...newActor('Vera'), modeData: talk(1) };
      const lund = { ...newActor('Lund'), modeData: talk(0) };
      const abel = { ...newActor('Abel'), modeData: talk(0) };
      for (const actor of [vera, lund, abel]) await create(library, ACCOUNT, actor);
      const sessionId = await ensemble([vera.id, lund.id, abel.id], null, policy(select));
      await writeChannel(sessions, ACCOUNT, sessionId, `${SE_PRESENCE}#${lund.id}`, false);

      const original = await spoke(sessionId, `forced-${select}`, { speakers: [lund.id] });
      expect(original.chosen).toEqual([lund.id]);
      expect(original.turn.input?.speakers).toEqual([lund.id]);

      const rewrite = await spoke(sessionId, `forced-${select}-rewrite`, {
        parentTurnId: original.turn.parentTurnId,
        replay: original.turn.tape,
        kept: keptSpeakers(original.turn),
        speakers: onRecord(original.turn.input?.speakers, 'the force-talk on the forced turn'),
      });
      expect(rewrite.chosen).toEqual([lund.id]);
      // Recorded again, so a rewrite of the rewrite keeps him too.
      expect(rewrite.turn.input?.speakers).toEqual([lund.id]);
      expect(rewrite.turn.request?.calls.map((call) => call.stepId)).toEqual([TEST_STEP.id]);

      const tapeAlone = await spoke(sessionId, `forced-${select}-tape-alone`, {
        parentTurnId: original.turn.parentTurnId,
        replay: original.turn.tape,
        kept: keptSpeakers(original.turn),
      });
      expect(tapeAlone.chosen).toEqual(withoutIt === null ? [] : [vera.id]);
      expect(tapeAlone.turn.input).not.toHaveProperty('speakers');
    });
  }

  /**
   * ***Talkativeness is read through the session's mode id*** — never a
   * literal one, which `tools/repo-shape.test.ts` forbids engine code to name.
   * A card that says 0 for this mode, and 1 for another, stays quiet here:
   * the other mode's value is not this one's.
   */
  it('reads talkativeness from the card under the session’s own mode', async () => {
    makeRunner();
    const vera = {
      ...newActor('Vera'),
      modeData: { [CHAT_MODE_ID]: { talkativeness: 1 } },
    };
    const lund = {
      ...newActor('Lund'),
      modeData: { [CHAT_MODE_ID]: { talkativeness: 0 }, [ENSEMBLE_MODE_ID]: { talkativeness: 1 } },
    };
    await create(library, ACCOUNT, vera);
    await create(library, ACCOUNT, lund);

    const sessionId = await ensemble([vera.id, lund.id], null, policy('natural'));
    // Nobody named, so only the rolls decide: Vera's 1 beats any roll, and
    // Lund's 0 beats none (a roll of exactly 0 aside, which a 48-bit float
    // makes a one-in-2^48 flake rather than a real one).
    expect((await spoke(sessionId, 'talk-1', { text: 'Rain.' })).chosen).toEqual([vera.id]);
  });

  /**
   * ***Smart order, through a turn*** — [P13 §1.3a], and [P13.1]'s proof
   * obligation for `smart` *"with a stubbed provider"*.
   *
   * `speakers.test.ts` holds the rules to their table and `smart-speakers.test.ts`
   * holds the step to what it makes of an answer; **what only a turn can show is
   * the wiring between them**, which is where each of §1.3a's promises is
   * actually kept or broken. That a turn a rule settled *plans no step and makes
   * no call* — invisible to a unit test of either half, and the design's first
   * rule rather than a saving found afterwards. That an answer reaches the steps
   * after the smart step through the runner's cell, and that the fallback
   * reaches them when the answer is no good. And that a rewrite keeps the pick
   * while a reroll asks again, which is the one place the route, the record and
   * the runner have to agree.
   *
   * ***The room is rigged so `natural`'s pick can be stated without reading the
   * tape.*** Vera's talkativeness is 1 and Lund's and Abel's are 0, so on a turn
   * that names nobody `natural` answers Vera alone whatever the draws were (the
   * one-in-2^48 roll of exactly 0 aside, as the test above says). That makes
   * *"the tape's natural pick"* a value a test can write down, and it makes a
   * model's answer of Abel or Lund distinguishable from the fallback on sight —
   * a test whose model happened to agree with the rules could not tell a
   * substituted answer from an ignored one. **Mara is in the cast and muted**:
   * somebody the model can be tempted to name and may not choose.
   */
  describe('under smart order', () => {
    interface Room {
      sessionId: string;
      vera: string;
      lund: string;
      abel: string;
      mara: string;
    }

    async function room(): Promise<Room> {
      const talk = (value: number): Record<string, unknown> => ({
        [CHAT_MODE_ID]: { talkativeness: value },
      });
      const vera = { ...newActor('Vera'), modeData: talk(1) };
      const lund = { ...newActor('Lund'), modeData: talk(0) };
      const abel = { ...newActor('Abel'), modeData: talk(0) };
      const mara = newActor('Mara');
      for (const actor of [vera, lund, abel, mara]) await create(library, ACCOUNT, actor);

      const sessionId = await ensemble([vera.id, lund.id, abel.id, mara.id], null, policy('smart'));
      await writeChannel(sessions, ACCOUNT, sessionId, `${SE_PRESENCE}#${mara.id}`, false);
      return { sessionId, vera: vera.id, lund: lund.id, abel: abel.id, mara: mara.id };
    }

    /** An answer as a structured endpoint gives it: the object, and its JSON as the text. */
    function answer(value: unknown): ScriptedReply {
      return { object: value, text: JSON.stringify(value) };
    }

    /**
     * The same reply three times — **the validation ladder's length**. An answer
     * that fails the schema is re-asked twice before the step is handed the
     * text (`performCall`, [P7.4]), so a script that gave one bad answer and
     * then prose would hand the retry the prose and test the wrong thing.
     */
    function thrice(reply: ScriptedReply): ScriptedReply[] {
      return [reply, reply, reply];
    }

    const PROSE: ScriptedReply = { text: 'The lamp guttered.' };

    /** Which steps made the calls a turn records, in order. */
    function callers(turn: Turn): string[] {
      return (turn.request?.calls ?? []).map((call) => call.stepId);
    }

    function smartOutcome(turn: Turn): NonNullable<Turn['steps']>[number] | undefined {
      return turn.steps?.find((step) => step.stepId === SE_SPEAKERS_SMART);
    }

    /**
     * **Rules first, and most turns never make the call** — §1.3a point 1's
     * three rows that answer without a model. Each turn below makes exactly one
     * call, the ensemble step's own, and carries no `se.speakers.smart` outcome
     * at all: the step is kept out of the plan rather than idling in it, which
     * is the summariser's arrangement and the reason a smart session costs
     * nothing extra on a turn where somebody is named.
     */
    describe('makes no call when a rule decides', () => {
      it('when the input names somebody', async () => {
        makeRunner();
        const { sessionId, lund } = await room();

        const named = await spoke(sessionId, 'smart-named', { text: 'Lund, is the lamp lit?' });
        expect(named.chosen).toEqual([lund]);
        expect(callers(named.turn)).toEqual([TEST_STEP.id]);
        expect(smartOutcome(named.turn)).toBeUndefined();
      });

      it('when a submission forced somebody', async () => {
        makeRunner();
        const { sessionId, abel } = await room();

        const forced = await spoke(sessionId, 'smart-forced', { speakers: [abel] });
        expect(forced.chosen).toEqual([abel]);
        expect(callers(forced.turn)).toEqual([TEST_STEP.id]);
        expect(smartOutcome(forced.turn)).toBeUndefined();
      });

      it('when only one member can reply', async () => {
        makeRunner();
        const { sessionId, vera, lund, abel } = await room();
        for (const id of [vera, lund]) {
          await writeChannel(sessions, ACCOUNT, sessionId, `${SE_PRESENCE}#${id}`, false);
        }

        // Abel, whose talkativeness is 0: a room of one answers with them
        // whoever they are, which is ST's `natural` fallback too.
        const alone = await spoke(sessionId, 'smart-alone');
        expect(alone.chosen).toEqual([abel]);
        expect(callers(alone.turn)).toEqual([TEST_STEP.id]);
        expect(smartOutcome(alone.turn)).toBeUndefined();
      });
    });

    /**
     * ***The answer reaches the steps after it, and nothing else carries it***
     * — §1.3a point 6. The ensemble step echoes who it was handed, so Abel then
     * Lund in its output is the cell working: the selector's own answer before
     * the loop was Vera, and nothing but the smart step's report could have
     * changed it. And point 7: the pick and each `because` on the step's
     * outcome, the call an ordinary entry of `request.calls`.
     */
    it('hands the model’s answer to the steps after it, and records who and why', async () => {
      makeRunner();
      const { sessionId, vera, lund, abel } = await room();
      provider.setScript([
        answer({
          speakers: [{ id: abel, because: 'He was the one asked about the lamp.' }, { id: lund }],
        }),
        PROSE,
      ]);

      const picked = await spoke(sessionId, 'smart-model');

      expect(picked.turn.status).toBe('complete');
      expect(picked.chosen).toEqual([abel, lund]);
      // First of all, ahead of every step that reads who speaks.
      expect(picked.turn.steps?.[0]).toMatchObject({
        stepId: SE_SPEAKERS_SMART,
        stage: 'pre',
        state: 'ok',
        speakers: {
          by: 'model',
          picked: [
            { id: abel, name: 'Abel', because: 'He was the one asked about the lamp.' },
            { id: lund, name: 'Lund' },
          ],
        },
      });
      expect(smartOutcome(picked.turn)?.speakers?.picked[1]).not.toHaveProperty('because');

      // The call: its own, first, unstreamed, at 0.2, closed over who may reply.
      expect(callers(picked.turn)).toEqual([SE_SPEAKERS_SMART, TEST_STEP.id]);
      expect(picked.turn.request?.calls[0]?.params).toMatchObject({ temperature: 0.2 });
      expect(provider.requests[0]?.streamed).toBe(false);
      expect(provider.requests[0]?.schema).toMatchObject({
        properties: { speakers: { items: { properties: { id: { enum: [vera, lund, abel] } } } } },
      });
    });

    /**
     * ***Every failure lands on the tape's `natural` pick, and says so*** —
     * §1.3a point 4, and the obligation's four cases. *"A name"* is read as
     * point 3 reads it: a name is accepted when it matches exactly one eligible
     * member (the next test), so the name that must fall back is one that
     * matches nobody who may reply — Mara's, who is muted.
     *
     * **Warned, never silent**: the outcome is `failed` under `warn`, carrying
     * the error that says why *and* the pick that played instead, and the turn
     * still completes. The fallback is Vera, which the rigged talkativeness
     * makes `natural`'s answer, and the three rolls on the tape are the draws
     * that produced it — made before the call, so the fallback did not depend
     * on how the call went.
     */
    const unusable: [string, (room: Room) => ScriptedReply[], string][] = [
      [
        'an id nobody here may choose',
        ({ mara }) => thrice(answer({ speakers: [{ id: mara }] })),
        'named nobody who can reply here',
      ],
      [
        'a name matching nobody who may reply',
        () => thrice(answer({ speakers: [{ id: 'Mara' }] })),
        'named nobody who can reply here',
      ],
      ['an empty list', () => thrice(answer({ speakers: [] })), 'named nobody to reply'],
      [
        'a call that throws',
        () => [{ error: { class: 'terminal', message: 'The endpoint refused the request.' } }],
        'The endpoint refused the request.',
      ],
    ];

    for (const [what, script, says] of unusable) {
      it(`plays the tape’s natural pick, warned, for ${what}`, async () => {
        makeRunner();
        const here = await room();
        provider.setScript([...script(here), PROSE]);

        const played = await spoke(here.sessionId, `smart-${what}`);

        expect(played.turn.status).toBe('complete');
        expect(played.chosen).toEqual([here.vera]);
        expect(smartOutcome(played.turn)).toMatchObject({
          state: 'failed',
          failure: 'warn',
          speakers: { by: 'fallback', picked: [{ id: here.vera, name: 'Vera' }] },
        });
        expect(smartOutcome(played.turn)?.error?.message).toContain(says);
        // The call happened and is on the record, whatever became of it.
        expect(callers(played.turn)).toEqual([SE_SPEAKERS_SMART, TEST_STEP.id]);

        const rolls = played.turn.tape.filter(
          (draw) => draw.site === 'se.participants' && draw.purpose.startsWith('talkativeness:'),
        );
        expect(rolls.map((draw) => draw.purpose).sort()).toEqual(
          [here.vera, here.lund, here.abel].map((id) => `talkativeness:${id}`).sort(),
        );
      });
    }

    /**
     * **A timeout falls back too** — the first of point 4's list, and the one
     * a local model makes most often: an endpoint that accepts the request and
     * says nothing. `limits.providerTimeoutMs` ends the call as `terminal`, so
     * it is not retried; the rule-based pick plays and the outcome says the
     * endpoint went quiet, and the ensemble step's own call, which answers at
     * once, still runs.
     *
     * *Not an unbound role, which point 4 also names*, because that cannot
     * happen to this step alone: its role is `prose`, which the generate step
     * needs too, and a session's `stepRoles` pointing it at a connection that
     * is gone drops through to the next layer rather than failing
     * (`resolveRole`, [P2B §1.2]). The unbound case is a turn whose generate
     * step fails as well, which is the summariser's and the hook selector's
     * situation and not a new one.
     */
    it('plays the tape’s natural pick, warned, when the call times out', async () => {
      makeRunner({ config: { limits: { ...DEFAULT_CONFIG.limits, providerTimeoutMs: 60 } } });
      const here = await room();
      provider.setScript([{ stallMs: 5_000 }, PROSE]);

      const played = await spoke(here.sessionId, 'smart-timeout');

      expect(played.turn.status).toBe('complete');
      expect(played.chosen).toEqual([here.vera]);
      expect(smartOutcome(played.turn)).toMatchObject({
        state: 'failed',
        failure: 'warn',
        error: { reason: 'terminal' },
        speakers: { by: 'fallback', picked: [{ id: here.vera, name: 'Vera' }] },
      });
      expect(callers(played.turn)).toEqual([SE_SPEAKERS_SMART, TEST_STEP.id]);
    });

    /**
     * **A name that matches exactly one eligible member is an answer** —
     * §1.3a point 3, *"because Marinara found models do that"*. It fails the
     * enum, so the ladder re-asks and then hands the step the text; the reader
     * is what lets it through, and the turn says the model chose.
     */
    it('accepts a name that matches exactly one member who may reply', async () => {
      makeRunner();
      const { sessionId, lund } = await room();
      provider.setScript([...thrice(answer({ speakers: [{ id: 'Lund' }] })), PROSE]);

      const named = await spoke(sessionId, 'smart-by-name');

      expect(named.chosen).toEqual([lund]);
      expect(smartOutcome(named.turn)).toMatchObject({
        state: 'ok',
        speakers: { by: 'model', picked: [{ id: lund, name: 'Lund' }] },
      });
    });

    /**
     * ***Rewrite keeps the speakers, reroll asks again*** — §1.3a point 7, the
     * line [07] draws between *"not that sentence"* and *"not that outcome"*.
     *
     * The rewrite is handed what the route hands it: the redone turn's tape
     * and `keptSpeakers` of that turn, read off the record. The model is
     * scripted to answer Lund if asked, so a rewrite that asked would say so;
     * it answers Abel, the kept pick, and the only call is the ensemble's. The
     * reroll is the same gesture with neither, and asks.
     */
    it('keeps the speakers on a rewrite without a call, and asks again on a reroll', async () => {
      makeRunner();
      const { sessionId, lund, abel } = await room();
      provider.setScript([answer({ speakers: [{ id: abel }] }), PROSE]);
      const original = await spoke(sessionId, 'smart-original');
      expect(original.chosen).toEqual([abel]);

      const lundIfAsked = [answer({ speakers: [{ id: lund }] }), PROSE];

      provider.setScript(lundIfAsked);
      const before = provider.requests.length;
      const rewrite = await spoke(sessionId, 'smart-rewrite', {
        parentTurnId: original.turn.parentTurnId,
        replay: original.turn.tape,
        kept: keptSpeakers(original.turn),
      });
      expect(rewrite.turn.parentTurnId).toBe(original.turn.parentTurnId);
      expect(rewrite.chosen).toEqual([abel]);
      expect(provider.requests.length - before).toBe(1);
      expect(callers(rewrite.turn)).toEqual([TEST_STEP.id]);
      expect(smartOutcome(rewrite.turn)).toMatchObject({
        state: 'ok',
        speakers: { by: 'rewrite', picked: [{ id: abel, name: 'Abel' }] },
      });

      provider.setScript(lundIfAsked);
      const reroll = await spoke(sessionId, 'smart-reroll', {
        parentTurnId: original.turn.parentTurnId,
      });
      expect(reroll.chosen).toEqual([lund]);
      expect(callers(reroll.turn)).toEqual([SE_SPEAKERS_SMART, TEST_STEP.id]);
      expect(smartOutcome(reroll.turn)?.speakers?.by).toBe('model');
    });
  });
});

/**
 * **The retry ladder's validation arm** — [P7.4].
 *
 * P7.4 measured that the SDK does not check an object against the schema it put
 * on the wire, so the engine is the only validation there is — and a ladder that
 * retried a 429 and not a reply of the wrong shape was retrying the failure that
 * costs least. What a turn can say, and a unit test cannot, is that the retry
 * actually re-asks and that the record it leaves is the one a person reads.
 */
describe('a call that asked for a shape', () => {
  beforeEach(() => {
    registerMode(SHAPED_MODE);
  });

  async function shaped(script: ScriptedReply[]): Promise<Turn> {
    makeRunner({ script });
    const session = await createSession(sessions, ACCOUNT, {
      name: 'Shaped',
      mode: { id: SHAPED_MODE_ID, config: null },
      preset: TEST_PRESET,
    });
    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: session.id,
      idempotencyKey: `shaped-${session.id}`,
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', session.id, 'turns'),
    );
    return onRecord(written.at(-1), 'the turn on disk').turn;
  }

  it('takes an answer that fits, first time, and asks once', async () => {
    const turn = await shaped([{ object: { name: 'Vera' } }]);

    expect(callOnRecord(turn).outcome).toBe('ok');
    expect(callOnRecord(turn).retries).toBe(0);
    // The step got the object, which is what a step asking for a shape is for.
    expect(turn.output?.text).toBe('{"name":"Vera"}');
    expect(provider.requests).toHaveLength(1);
  });

  /**
   * **`{"nom":"Vera"}` is the measured value** — the one the SDK accepted
   * against a schema requiring `name` with `additionalProperties: false`. Here
   * it is caught, re-asked, and the second answer stands.
   */
  it('asks again when the answer does not fit, and takes the next one', async () => {
    const turn = await shaped([{ object: { nom: 'Vera' } }, { object: { name: 'Vera' } }]);

    expect(callOnRecord(turn).outcome).toBe('ok');
    expect(callOnRecord(turn).retries).toBe(1);
    expect(provider.requests).toHaveLength(2);
    expect(turn.output?.text).toBe('{"name":"Vera"}');
  });

  it('gives up after the ladder and says why, in the vocabulary the UI reads', async () => {
    const wrong = { object: { nom: 'Vera' } };
    const turn = await shaped([wrong, wrong, wrong, wrong]);

    const call = callOnRecord(turn);
    // `error`, not `ok`: the model stopped cleanly and answered in the wrong
    // shape, and a finish reason of `stop` would have recorded it as an answer.
    expect(call.outcome).toBe('error');
    // `retryable`, because asking again is the remedy — a `terminal` here would
    // tell a UI to stop offering the one thing that might work.
    expect(call.error?.class).toBe('retryable');
    expect(call.error?.message).toMatch(/did not match the shape/);
    // The ladder's own length, not a second number to keep in step.
    expect(call.retries).toBe(2);
    expect(provider.requests).toHaveLength(3);
  });

  /**
   * **A value that failed the check does not reach the step**, which is the half
   * only a turn can show: `CallOutcome.object` is what a step is handed, and a
   * step that forgot to look at `undefined` would otherwise write effects from
   * garbage.
   */
  it('hands the step nothing when nothing fit', async () => {
    const turn = await shaped([{ object: { nom: 'Vera' } }]);

    expect(turn.output?.text).toBe('null');
  });

  it('reports a reply that was not JSON at all the same way', async () => {
    // The adapter leaves `object` undefined when the reply would not parse, and
    // the engine reads that as a miss rather than as *nobody asked*.
    const turn = await shaped([{ text: 'I am afraid I cannot do that.' }]);

    expect(callOnRecord(turn).outcome).toBe('error');
    expect(callOnRecord(turn).error?.message).toMatch(/did not answer with JSON/);
  });

  it('sends the schema, so the endpoint was told what to write', async () => {
    await shaped([{ object: { name: 'Vera' } }]);

    // The fake declares `supportsStructuredOutput: true`, so this is the wire
    // path rather than the prompted one — `calls.test.ts` covers the other.
    expect(provider.requests[0]?.schema).toMatchObject({ required: ['name'] });
  });
});

/**
 * The plot-hook selector, through the pipeline — [06 §6.1], [P7.5].
 *
 * **Here rather than beside the selector's own unit tests** because what these
 * assert is the *wiring*: that the engine's one non-mode step joins the plan,
 * that its line lands on the turn, and that a fired hook's words reach the
 * prompt **in the slot the preset positioned** rather than after everything else
 * ([25 C13(c)], which [P7 §1.5] raised as the thing that had no answer).
 */
describe('a session with a hook pool', () => {
  /** Puts a pool on the session, which is what makes the selector join the plan. */
  async function seedPool(hooks: unknown[]): Promise<void> {
    const file = join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'session.json');
    const session = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...session, hooks }));
  }

  /** One hook in a pool, attributed to a treatment. */
  function war(over: Partial<PlotHook> = {}): PooledHook[] {
    return [
      {
        hook: {
          id: 'hook-war',
          title: 'War',
          premise: 'The Flower Kingdom will declare war.',
          magnitude: 'sweeping',
          involves: [],
          weight: 1,
          delivery: 'guidance',
          once: true,
          ...over,
        },
        source: { kind: 'treatment', id: 't1' },
      },
    ];
  }

  const WAR = war();

  it('runs the selector every turn and writes its line onto the record', async () => {
    await seedPool(WAR);
    // Two replies: the selector's judgement, then the narration. The selector is
    // prepended, so it is the first call of the turn.
    makeRunner({ script: [{ object: { hookId: null } }, { text: 'The door opened.' }] });

    const { turn } = await runTurn();

    expect(turn.hooks).toEqual({
      verdict: 'judged-none',
      pacing: 'normal',
      considered: [{ hookId: 'hook-war', refusal: null }],
    });
    // And it is a step like any other, so the record says it ran.
    expect(turn.steps?.map((step) => step.stepId)).toEqual(['se.hooks.select', ...SCENE_STEPS]);
  });

  /**
   * **The slot, not the end of the prompt.** A step's candidates are appended
   * after the preset's, so a hook returned as one would arrive last; the
   * selector hands its words to the runner and the *collector* fills
   * [06 §5.1]'s slot, which is the same route `attempt` takes.
   */
  it('sends a fired hook through the guidance slot', async () => {
    await seedPool(WAR);
    makeRunner({ script: [{ object: { hookId: 'hook-war' } }, { text: 'The door opened.' }] });

    const { turn } = await runTurn();
    expect(turn.hooks).toMatchObject({ verdict: 'fired', hookId: 'hook-war' });

    // The narrator's call is the second one; the first is the judgement.
    const narration = turn.request?.calls.at(-1);
    const hookBlock = narration?.blocks?.find(
      (block) => block.source.kind === 'guidance' && block.source.producer === 'step',
    );
    expect(hookBlock?.text).toContain('The Flower Kingdom will declare war.');
    // Advisory, forced by the collector rather than left to the author — a hook's
    // guidance is guidance ([06 §5.2]).
    expect(hookBlock?.advisory).toBe(true);
    // And the judgement call did not see the scene: its own candidates, which is
    // what makes it cheap.
    expect(turn.request?.calls[0]?.messages.length).toBeLessThan(narration?.messages.length ?? 0);
  });

  it('records the firing as an effect on the hook’s own channel', async () => {
    await seedPool(WAR);
    makeRunner({ script: [{ object: { hookId: 'hook-war' } }, { text: 'The door opened.' }] });

    const { turn } = await runTurn();
    const firing = turn.effects.find((effect) => effect.channelId === 'se.hook');

    expect(firing).toMatchObject({ scopeKey: 'hook-war', after: 'fired', applied: true });
    // Which is what takes it out of the pool on the next turn, rather than a
    // set on the session file that could not branch.
    const next = await runNextTurn();
    expect(next.hooks?.considered).toEqual([{ hookId: 'hook-war', refusal: 'fired' }]);
    expect(next.hooks?.verdict).toBe('nothing-eligible');
  });

  /**
   * **Absent means the selector did not run**, which is every session without a
   * pool — never *it ran and had nothing to say*. The distinction is the one
   * [03 §8] draws everywhere else in this record.
   */
  it('leaves the field off a turn with no pool at all', async () => {
    const { turn } = await runTurn();

    expect(turn.hooks).toBeUndefined();
    expect(turn.steps?.map((step) => step.stepId)).toEqual(SCENE_STEPS);
  });

  /**
   * ***A step that brings its own candidates does not move the retriever's
   * counters*** — [P5.6], [P7.5], and a correctness fix rather than a saving.
   *
   * `performCall` already knows what an explicit `candidates` means: it zeroes
   * `notFilled` and `refused` because *"the preset was not consulted, so it
   * honestly has nothing to say"*. The retriever ran anyway, so a scan whose
   * blocks were then discarded still spent every matched entry's cooldown — a
   * lorebook entry recorded as having fired on a turn where its text reached no
   * prompt. **Nothing hit it before the selector**, which is the first step in
   * the build to pass its own candidates.
   */
  it('does not spend a lorebook entry on the judgement call', async () => {
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

    const withBoth = await createSession(sessions, ACCOUNT, {
      name: 'Both',
      preset: TEST_PRESET,
      lore: [book.id],
      hooks: WAR,
    });
    // The judgement answers *none*, so the only call that assembles a prompt is
    // the narrator's — and the entry the input mentions belongs to that one.
    makeRunner({ script: [{ object: { hookId: null } }, { text: 'The door opened.' }] });

    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: withBoth.id,
      idempotencyKey: 'both-1',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    const said = 'The ferryman again.';
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: said, raw: said } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', withBoth.id, 'turns'),
    );
    const turn = onRecord(written[0], 'the turn on disk').turn;
    const timing = turn.effects.filter((effect) => effect.channelId === SE_LORE_TIMING);

    // One, not two: the entry fired for the narration and not for the judgement.
    expect(timing).toHaveLength(1);
    expect(timing[0]?.after).toEqual({ sticky: 0, cooldown: 3, fired: 1 });
    // And the judgement call assembled nothing from the preset at all, which is
    // what `cheap` means and what makes the claim above checkable.
    expect(turn.request?.calls[0]?.notFilled ?? []).toHaveLength(0);
  });

  /**
   * **Commit, end to end, through the route that already existed** — [06 §6.1],
   * [P7.5] stage four.
   *
   * *"I want this to happen — not necessarily on this turn."* It needed no new
   * route and no policy change: `se.hook` is `engine-computed`, which refuses a
   * `model` and a `step` and **admits a `user`**, and the channel write is
   * attributed to a person. The only thing that had to change was the enum, so
   * the channel's schema would accept the value.
   */
  it('lets a person commit a hook the filter had refused, and fires it', async () => {
    // `notBefore: { turn: 40 }` — forty turns away, and committed anyway.
    await seedPool(war({ notBefore: { turn: 40 } }));
    const written = await writeChannel(
      sessions,
      ACCOUNT,
      sessionId,
      'se.hook#hook-war',
      'committed',
    );
    expect(written.kind === 'written' && written.effect.applied).toBe(true);

    makeRunner({ script: [{ object: { hookId: 'hook-war' } }, { text: 'The door opened.' }] });
    const turn = await runNextTurn();

    expect(turn.hooks).toMatchObject({ verdict: 'fired', hookId: 'hook-war' });
    // And the record says what the commitment carried it past, which is [06
    // §6.1]'s first rule for keeping Commit honest.
    expect(turn.hooks?.considered).toEqual([
      { hookId: 'hook-war', refusal: null, committed: { overrode: 'too-early' } },
    ]);
    // The firing replaces the commitment on the same key — the states are
    // exclusive, which is what makes *absent is in the pool* readable.
    expect(turn.effects.find((effect) => effect.channelId === 'se.hook')).toMatchObject({
      scopeKey: 'hook-war',
      after: 'fired',
      applied: true,
    });
  });

  /**
   * **Force-fire, end to end** — [06 §6.1], [10 §10.1], [P7.5]. *"The hook is
   * delivered on the next turn with no judgement call at all."*
   *
   * Through the same channel route Commit uses, because the intent has to
   * survive between the click and the turn and a channel is the only home that
   * branches.
   */
  it('delivers a forced hook on the next turn without asking anybody', async () => {
    await seedPool(war({ notBefore: { turn: 40 } }));
    await writeChannel(sessions, ACCOUNT, sessionId, 'se.hook#hook-war', 'forced');
    // One reply, and the narrator is the only caller: a second would mean a
    // judgement call happened.
    makeRunner({ script: [{ text: 'The door opened.' }] });

    const turn = await runNextTurn();

    expect(turn.request?.calls).toHaveLength(1);
    expect(turn.hooks).toMatchObject({ verdict: 'fired', hookId: 'hook-war' });
    // The record says nobody was asked, and says what the force skipped.
    expect(turn.hooks?.considered).toEqual([
      { hookId: 'hook-war', refusal: null, forced: { overrode: 'too-early' } },
    ]);
    // And the words reached the slot the preset positioned, like any firing.
    const hookBlock = turn.request?.calls[0]?.blocks?.find(
      (block) => block.source.kind === 'guidance' && block.source.producer === 'step',
    );
    expect(hookBlock?.text).toContain('The Flower Kingdom will declare war.');
  });

  /**
   * **Patience runs out, and the deadline is a lapse rather than a firing** —
   * [06 §6.1], [P7.5]. *"One that fires anyway at the deadline delivers the
   * twist at the exact moment the selector has already rejected three times —
   * the worst available moment."* So the hook goes back in the pool, and the
   * turn record **says so**, because a silent lapse is worse than either
   * outcome.
   */
  it('lapses a commitment nobody found a moment for, and says so', async () => {
    await seedPool(WAR);
    await writeChannel(sessions, ACCOUNT, sessionId, 'se.hook#hook-war', 'committed');
    // One reply serves both calls of every turn: the judgement reads `object`
    // and says *not yet*, the narrator reads `text`. The script clamps to its
    // last entry, so this repeats for as many turns as the test runs.
    makeRunner({ script: [{ object: { hookId: null }, text: 'The door opened.' }] });

    // The commitment's own turn is the channel write; the three after it are the
    // chances the selector gets.
    for (let chance = 0; chance < 3; chance += 1) {
      const waiting = await runNextTurn();
      expect(waiting.hooks?.verdict, `chance ${String(chance + 1)}`).toBe('judged-none');
      expect(waiting.hooks?.lapsed).toBeUndefined();
    }

    const expired = await runNextTurn();
    expect(expired.hooks?.lapsed).toEqual(['hook-war']);
    // Cleared to null, which on this channel *is* back in the pool:
    // `se.hook`'s init is `{ kind: 'literal', value: null }`, so null is what an
    // unfired hook already reads as. `before` carries the commitment away, which
    // is what an undo of this turn would put back.
    const cleared = expired.effects.find((effect) => effect.channelId === 'se.hook');
    expect(cleared).toMatchObject({
      scopeKey: 'hook-war',
      before: 'committed',
      after: null,
      applied: true,
    });

    // And it really is back: the next turn considers it with no commitment on it.
    const after = await runNextTurn();
    expect(after.hooks?.considered).toEqual([{ hookId: 'hook-war', refusal: null }]);
  });

  /**
   * The dial is `user-only` and the route that turns it is the channel write —
   * so this is the first end-to-end proof that a person's setting reaches a
   * scheduling decision, and that the record says which setting it was.
   */
  it('holds when the dial has been turned down, and says so', async () => {
    await seedPool(WAR);
    await writeChannel(sessions, ACCOUNT, sessionId, 'se.hook.pacing', 'manual-only');
    makeRunner({ script: [{ text: 'The door opened.' }] });

    const turn = await runNextTurn();

    expect(turn.hooks).toEqual({
      verdict: 'held',
      pacing: 'manual-only',
      // The filter still runs and still reports; only the judgement is off,
      // which is what makes `manual-only` a coherent state rather than a dead
      // step ([06 §6.1]).
      considered: [{ hookId: 'hook-war', refusal: null }],
    });
    // One call, not two: nobody was asked.
    expect(turn.request?.calls).toHaveLength(1);
  });
});

/**
 * **Goals, through the pipeline** — [06 §7.3.3], [06 §7.3.4], [P7.6].
 *
 * *"An evaluation step at `post` judges whether the goal is met."* What these
 * assert is the wiring and the bias: that the judge runs after the prose exists,
 * that a met goal lands as a **model-proposed** effect on the goal's own key, and
 * that everything ambiguous answers *not met* — because *"a missed completion is
 * an annoyance the player can resolve manually, while a false completion ends the
 * story on a turn that did not earn it."*
 */
describe('a session with a goal', () => {
  async function seedGoals(goals: unknown[]): Promise<void> {
    const file = join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'session.json');
    const session = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...session, goals }));
  }

  function ledger(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'g-ledger',
      statement: 'Get the ledger out of the Foundry.',
      detail: null,
      visibility: 'player',
      completion: { kind: 'narrative' },
      thenDefault: 'advance',
      next: null,
      ...over,
    };
  }

  it('injects the goal it is on, and judges after the prose exists', async () => {
    await seedGoals([ledger()]);
    // Narration first, then the judge — the judge is a `post` step.
    makeRunner({
      script: [
        { text: 'She walked out with the ledger under her coat.' },
        { object: { met: true } },
      ],
    });

    const { turn } = await runTurn();

    expect(turn.steps?.map((step) => step.stepId)).toEqual([...SCENE_STEPS, 'se.goals.judge']);
    // [06 §7.3.3]: *"the goal statement is therefore always injected"* — through
    // the preset's own `{ of: 'goal' }` slot, which returned nothing until now.
    const narration = turn.request?.calls[0];
    const goalBlock = narration?.blocks?.find((block) => block.source.kind === 'goal');
    expect(goalBlock?.text).toContain('Get the ledger out of the Foundry.');
  });

  /**
   * ***Attributed to the model, which is the one thing that makes
   * `model-proposed` mean anything here.*** The policy exists because the
   * narrator's judgement is the only signal available — so the record has to
   * say a model judged it, with the call it judged it in. (`se.goal` is not the
   * first channel carrying the policy — three cast channels have since [P3.0] —
   * it is the first one a model's judgement is *written to*.)
   *
   * ***And it is refused, which is [25 C12]'s answer.*** `confirm: ['achieved']`
   * makes the judgement a **recorded, unapplied** proposal: the record says what
   * the narrator thought, the session has not moved, and the goal panel asks. A
   * false completion ending a story that did not earn it is the error the
   * asymmetry is about, and the refusal is where it is stopped.
   */
  it('records a met goal as a refused model proposal on the goal’s own key', async () => {
    await seedGoals([ledger()]);
    makeRunner({ script: [{ text: 'She walked out with it.' }, { object: { met: true } }] });

    const { turn } = await runTurn();
    const achieved = turn.effects.find((effect) => effect.channelId === 'se.goal');

    expect(achieved).toMatchObject({
      scopeKey: 'g-ledger',
      // `after` is the value the model *wanted* — the [P7.2] correction the
      // panel depends on, since a refusal stamping `before` back would record
      // that something was refused and not what.
      after: 'achieved',
      applied: false,
      rejectedReason: 'needs-confirmation',
      proposedBy: { kind: 'model' },
    });
    // The call it judged in, so the workbench can show the reasoning — *that*
    // call, not merely one of the turn's.
    const judge = turn.request?.calls.find((call) => call.stepId === 'se.goals.judge');
    expect(judge).toBeDefined();
    expect((achieved?.proposedBy as { callId?: string }).callId).toBe(judge?.id);
  });

  /**
   * ***The judge's call, not the turn's last one*** (2026-09-27). The credit
   * read `calls.at(-1)`, and the judge is not the last step that calls when
   * suggestions, the memory extractor or an illustration run after it: the
   * record named the suggester's call as the reasoning for a completion. Only
   * the id the judge reports can name the call it judged in.
   */
  it('credits the call the judge made, when a later step makes one too', async () => {
    await seedGoals([ledger()]);
    makeRunner({
      script: [
        { text: 'She walked out with it.' },
        { object: { met: true } },
        { object: { actions: ['Run.', 'Hide.', 'Wait.'] } },
      ],
    });
    await writeChannel(sessions, ACCOUNT, sessionId, 'se.suggest', true);

    const turn = await runNextTurn();
    const achieved = turn.effects.find((effect) => effect.channelId === 'se.goal');
    const judge = turn.request?.calls.find((call) => call.stepId === 'se.goals.judge');

    // The case is only the case if something called after the judge.
    expect(turn.request?.calls.at(-1)?.stepId).toBe('se.suggest');
    expect(judge).toBeDefined();
    expect(achieved?.proposedBy).toEqual({ kind: 'model', callId: judge?.id });
  });

  /**
   * *The state does not move on the proposal*, which is the half that matters
   * more than the record: [06 §7.3.4]'s three offers are raised off `achieved`,
   * so a story whose channel still reads `null` is a story that has not ended.
   */
  it('leaves the goal unachieved until a person rules on it', async () => {
    await seedGoals([ledger()]);
    makeRunner({ script: [{ text: 'She walked out with it.' }, { object: { met: true } }] });

    await runTurn();

    const file = join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'session.json');
    const session = JSON.parse(await readFile(file, 'utf8')) as {
      channels?: Record<string, { value: unknown }>;
    };

    expect(session.channels?.['se.goal#g-ledger']?.value ?? null).toBeNull();
  });

  it('writes nothing when the judge says not yet', async () => {
    await seedGoals([ledger()]);
    makeRunner({ script: [{ text: 'She got as far as the door.' }, { object: { met: false } }] });

    const { turn } = await runTurn();

    expect(turn.effects.find((effect) => effect.channelId === 'se.goal')).toBeUndefined();
  });

  /**
   * **Bias toward under-firing, at the one place a model can be ambiguous.** An
   * endpoint with no structured output answers in text ([P7.4] makes that the
   * ordinary path for a self-hosted install), and prose the reader cannot parse
   * is *not met* rather than a story ended on a turn that did not earn it.
   */
  it('treats an answer it cannot read as not met', async () => {
    await seedGoals([ledger()]);
    makeRunner({ script: [{ text: 'Maybe. Hard to say!' }] });

    const { turn } = await runTurn();

    expect(turn.effects.find((effect) => effect.channelId === 'se.goal')).toBeUndefined();
    expect(turn.steps?.at(-1)).toMatchObject({ stepId: 'se.goals.judge', state: 'ok' });
  });

  /**
   * *"The player says when"* — [04 §7.1]'s other completion arm. A call that
   * judged a manual goal would be the engine asking a question the author
   * reserved for a person, so the step does not join the plan at all.
   */
  it('does not judge a goal whose completion the author reserved for a person', async () => {
    await seedGoals([ledger({ completion: { kind: 'manual' } })]);
    makeRunner({ script: [{ text: 'She got as far as the door.' }] });

    const { turn } = await runTurn();

    expect(turn.steps?.map((step) => step.stepId)).toEqual(SCENE_STEPS);
    // The statement is still injected: it is what the story is about, whoever
    // rules on it.
    expect(turn.request?.calls[0]?.blocks?.some((block) => block.source.kind === 'goal')).toBe(
      true,
    );
  });

  /**
   * [06 §7.3.4]: *"Concluded is a state, not a deletion: the session stays
   * readable and branchable."* Readable and branchable is what the store already
   * gives; what this pins is that an ended session stops being **judged**.
   */
  it('stops judging once the story has been ended', async () => {
    await seedGoals([ledger()]);
    await writeChannel(sessions, ACCOUNT, sessionId, 'se.concluded', true);
    makeRunner({ script: [{ text: 'An epilogue.' }] });

    const turn = await runNextTurn();

    expect(turn.steps?.map((step) => step.stepId)).toEqual(SCENE_STEPS);
    // And the turn still happened, which is the readable-and-branchable half.
    expect(turn.status).toBe('complete');
  });

  it('leaves a session with no goals exactly as it was', async () => {
    const { turn } = await runTurn();

    expect(turn.steps?.map((step) => step.stepId)).toEqual(SCENE_STEPS);
    expect(turn.request?.calls[0]?.blocks?.some((block) => block.source.kind === 'goal')).toBe(
      false,
    );
  });
});

/**
 * **Mention resolution, through the pipeline** — [06 §8.2], [03 §8], [P7.7].
 *
 * ***And the property [P7.5] left open.*** [06 §6.1] leaves an introduction hook
 * *provisionally fired* until *"the extract stage confirms the subject present
 * on that turn; unconfirmed, it returns to the pool with the attempt on the
 * record."* This is the stage, and these are the two outcomes.
 */
describe('what the engine understood about a turn', () => {
  async function seedCast(): Promise<string> {
    const actor = { ...newActor('Vera Kohl'), aliases: ['Vera'] };
    await create(library, ACCOUNT, actor);
    return actor.id;
  }

  it('records who the prose named, as an overlay rather than a rewrite', async () => {
    const actorId = await seedCast();
    const withCast = await createSession(sessions, ACCOUNT, {
      name: 'Rain',
      preset: TEST_PRESET,
      cast: { persona: null, actors: [actorId] },
    });
    makeRunner({ script: [{ text: 'Vera opened the door.' }] });

    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId: withCast.id,
      idempotencyKey: 'spans-1',
      headTurnId: null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', withCast.id, 'turns'),
    );
    const turn = onRecord(written[0], 'the turn on disk').turn;

    expect(turn.spans).toEqual([
      {
        field: 'output',
        start: 0,
        end: 4,
        target: { kind: 'actor', ref: { id: actorId, name: 'Vera Kohl' } },
        method: 'matched',
        confidence: null,
      },
    ]);
    // *Never a rewrite of the message text* — the prose is exactly what the
    // model wrote, and the overlay sits beside it.
    expect(turn.output?.text).toBe('Vera opened the door.');
  });

  it('leaves the field off a turn with nobody to find', async () => {
    // **Absent rather than empty** — [03 §8]'s distinction: *empty* would claim a
    // pass ran and found nobody, which is a different fact from *nobody looked*.
    const { turn } = await runTurn();

    expect(turn.spans).toBeUndefined();
    expect(turn.steps?.map((step) => step.stepId)).toEqual(SCENE_STEPS);
  });
});

/**
 * ***An introduction hook's firing is provisional until somebody arrives*** —
 * [06 §6.1], and [P7.5]'s fourth property row, which that stage could not close
 * because the extract stage did not exist.
 *
 * *"Guidance is advisory; the narrator may decline it. For an event hook a
 * decline is a miss and the pool is none the worse. For an introduction hook it
 * is a silent permanent loss — marked fired, character never arrived, and
 * once-only. So the hook is recorded provisionally fired and becomes fired only
 * when the extract stage confirms the subject present on that turn;
 * unconfirmed, it returns to the pool with the attempt on the record."*
 */
describe('an introduction the narrator was asked to make', () => {
  async function aSessionIntroducing(): Promise<{ sessionId: string; actorId: string }> {
    const actor = { ...newActor('Vera Kohl'), aliases: ['Vera'] };
    await create(library, ACCOUNT, actor);
    const made = await createSession(sessions, ACCOUNT, {
      name: 'Rain',
      preset: TEST_PRESET,
      hooks: [
        {
          hook: {
            id: 'hook-vera',
            title: 'Vera arrives',
            premise: '',
            magnitude: 'personal',
            involves: [],
            weight: 1,
            delivery: 'guidance',
            once: true,
            introduces: {
              actor: { id: actor.id, name: 'Vera Kohl' },
              entrances: [{ id: 'e-rain', label: 'In the rain', text: 'Soaked to the skin.' }],
              primaryEntranceId: null,
            },
          },
          source: { kind: 'session' as const },
        },
      ],
    });
    return { sessionId: made.id, actorId: actor.id };
  }

  async function takeTurn(sessionId: string, key: string): Promise<Turn> {
    const outcome = await submitTurn(commit, {
      account: ACCOUNT,
      sessionId,
      idempotencyKey: key,
      headTurnId: (await readSession(sessions, ACCOUNT, sessionId))?.headTurnId ?? null,
    });
    if (outcome.kind !== 'created') throw new Error('expected a reservation');
    runner.start(outcome.job, { input: { actorId: null, kind: 'do', text: 'x', raw: 'x' } });
    await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'commit');

    const written = await readAllTurns(
      join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
    );
    const turn = written.at(-1)?.turn;
    if (!turn) throw new Error('no turn was appended');
    return turn;
  }

  it('becomes fired when the subject actually arrives', async () => {
    const { sessionId, actorId } = await aSessionIntroducing();
    makeRunner({
      script: [{ object: { hookId: 'hook-vera' } }, { text: 'Vera came in, soaked to the skin.' }],
    });

    const turn = await takeTurn(sessionId, 'intro-1');

    expect(turn.hooks).toMatchObject({ verdict: 'fired', hookId: 'hook-vera' });
    const firing = turn.effects.find((effect) => effect.channelId === 'se.hook');
    expect(firing).toMatchObject({ scopeKey: 'hook-vera', after: 'fired', applied: true });
    // And the overlay is what confirmed it — the same finding, not a second scan.
    expect(turn.spans?.some((span) => span.target.ref.id === actorId)).toBe(true);
  });

  /**
   * ***The decline, which is the whole reason the state exists.*** The narrator
   * was asked and wrote about something else; the hook goes back in the pool, and
   * the attempt stays on the record in the turn's own `hooks` line.
   */
  it('returns to the pool when the narrator declined, with the attempt on the record', async () => {
    const { sessionId } = await aSessionIntroducing();
    makeRunner({
      script: [{ object: { hookId: 'hook-vera' } }, { text: 'The rain kept on and nobody came.' }],
    });

    const turn = await takeTurn(sessionId, 'intro-2');

    // The attempt: the record says it fired and names the hook.
    expect(turn.hooks).toMatchObject({ verdict: 'fired', hookId: 'hook-vera' });
    // And the pool: nothing was written, so it is eligible again.
    expect(turn.effects.find((effect) => effect.channelId === 'se.hook')).toBeUndefined();

    makeRunner({ script: [{ object: { hookId: null } }, { text: 'Still raining.' }] });
    const next = await takeTurn(sessionId, 'intro-3');
    expect(next.hooks?.considered).toEqual([{ hookId: 'hook-vera', refusal: null }]);
  });

  /**
   * ***The recovery path, for a subject who is not in the cast*** (2026-09-27).
   * A firing its own turn could not settle — the extract step failed, or it
   * predates [P7.7] — stays `provisional`, and a later turn confirms it when
   * the narrator writes the subject in. The scan decided who was in flight by
   * reading an empty channel map, so a subject outside the cast was never
   * looked for and the arrival was recorded as declined.
   */
  it('confirms a firing an earlier turn left provisional, when the subject arrives', async () => {
    const { sessionId, actorId } = await aSessionIntroducing();
    await writeChannel(sessions, ACCOUNT, sessionId, 'se.hook#hook-vera', 'provisional');
    // Nothing is eligible — the one hook is pending — so nobody is asked, and
    // the only call is the narrator's.
    makeRunner({ script: [{ text: 'Vera Kohl stepped in out of the rain.' }] });

    const turn = await takeTurn(sessionId, 'intro-4');

    const settled = turn.effects.find((effect) => effect.channelId === 'se.hook');
    expect(settled).toMatchObject({ scopeKey: 'hook-vera', after: 'fired', applied: true });
    expect(turn.spans?.some((span) => span.target.ref.id === actorId)).toBe(true);
  });
});

/**
 * ***A turn several people spoke in*** —
 * [P13 §1.1](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13.0].
 *
 * A turn is one node however many messages it emits ([07 §3], [25 C11]), so
 * what these hold to account is the record rather than any dispatch: a step
 * hands back attributed messages, and the turn that lands on disk keeps them
 * **and** a `text` every older reader can read. *No mode ships a step that does
 * this yet* — per-actor dispatch is [P13.2]'s — which is why the step is a
 * fixture here rather than Scene's.
 */
describe('a turn that speaks with several voices', () => {
  const MARLOW = { id: 'actor-marlow', name: 'Marlow' };
  const ELENA = { id: 'actor-elena', name: 'Elena' };

  /** One streamed call, and whatever the test makes of what it said. */
  function voicing(answer: (said: string) => StepResult): TurnPlan {
    return {
      steps: [
        {
          definition: TEST_STEP,
          run: async (_input, host) => answer((await host.call({ stream: true })).text),
        },
      ],
    };
  }

  it('commits the messages, with the text and reasoning derived from them', async () => {
    const messages: OutputMessage[] = [
      { speaker: null, text: 'Rain on the tin roof.', original: 'Narrator: Rain on the tin roof.' },
      { speaker: MARLOW, text: '"You came."', carried: true },
      { speaker: ELENA, text: '"I said I would."', reasoning: 'She is tired.' },
    ];
    makeRunner({
      script: [{ text: 'Rain on the tin roof.' }],
      plan: voicing((said) => ({
        messages: messages.map((one, at) => (at === 0 ? { ...one, text: said } : one)),
      })),
    });

    const { job, turn } = await runTurn();

    expect(turn.status).toBe('complete');
    // The narrator's `original` rides on its message and stays out of `text`,
    // which is what the transcript shows and every older reader reads.
    expect(turn.output).toEqual({
      text: 'Rain on the tin roof.\n\n"You came."\n\n"I said I would."',
      reasoning: 'She is tired.',
      messages,
    });
    /**
     * *And the draft says the same*, because the draft is what a client
     * attaching to the stream is handed as its snapshot's `turn` — so the
     * speakers reach a watching transcript by the same road the text does.
     */
    expect(readDraft(commit, job.id)?.output).toEqual(turn.output);
  });

  /**
   * A proposal the record keeps whether or not it is admitted — `se.clock` is
   * engine-computed, so a step's proposal lands `applied: false` — which makes
   * it visible on `turn.effects` exactly when the runner let the result that
   * carried it that far.
   */
  function clockProposal(stepId: string): EffectProposal {
    return {
      channelId: SE_CLOCK,
      op: { type: 'set', path: '/' },
      after: { day: 9, hour: 0, minute: 0 },
      proposedBy: { kind: 'step', stepId },
    };
  }

  /**
   * ***Both is the step's failure, not a choice the runner makes for it.*** The
   * two are rival answers to what the turn said; the falsifying mutation is a
   * runner that prefers one, which would commit a `complete` turn missing
   * whatever the other held.
   *
   * **And refused before any of it is applied**, which is what the runner's
   * comment promises and what makes the refusal safe: the result also carries
   * an effect and a `message` that differs from what streamed, so a check moved
   * below the effect loop leaves the proposal on the failed turn, and one moved
   * below `draft.output = result.message` records the other text.
   */
  it('refuses a result carrying both message and messages, under the step’s policy', async () => {
    makeRunner({
      script: [{ text: 'Rain on the tin roof.' }],
      plan: voicing(() => ({
        message: { text: 'Something else entirely.' },
        messages: [{ speaker: MARLOW, text: '"You came."' }],
        effects: [clockProposal(TEST_STEP.id)],
      })),
    });

    const { turn } = await runTurn();

    // `TEST_STEP` declares `abort`, so the turn fails with it.
    expect(turn.status).toBe('failed');
    expect(turn.steps?.[0]).toMatchObject({
      stepId: TEST_STEP.id,
      state: 'failed',
      error: { reason: 'internal' },
      contributed: { effects: 0 },
    });
    expect(turn.steps?.[0]?.error?.message).toContain('both message and messages');
    // Neither answer was recorded — what streamed is what survives, as for any
    // step that failed after its words had arrived.
    expect(turn.output?.messages).toBeUndefined();
    expect(turn.output?.text).toBe('Rain on the tin roof.');
    // Nor anything else the result carried.
    expect(turn.effects.filter((effect) => effect.proposedBy.kind === 'step')).toEqual([]);
  });

  /**
   * ***A refused result under `warn` leaves no half of itself for the turn that
   * goes on*** — the case where a misplaced check would do the most harm,
   * because the turn completes and nothing marks what leaked into it: a
   * candidate reaching the next step's prompt, an effect on the committed
   * record.
   *
   * *With its control*: the same step returning only `messages` does
   * contribute both, so the refused arm cannot pass by the candidate or the
   * effect never having been able to get through at all.
   */
  describe('a refused result the turn goes on without', () => {
    const VOICES: StepDefinition = { ...TEST_STEP, id: 'se.voices', failure: 'warn' };

    /** A warned step voicing a round, and the narrator's call after it. */
    function voicesThenNarrates(both: boolean): TurnPlan {
      return {
        steps: [
          {
            definition: VOICES,
            run: async (_input, host) => {
              await host.call({ stream: true });
              return {
                ...(both ? { message: { text: 'Something else entirely.' } } : {}),
                messages: [{ speaker: MARLOW, text: '"You came."' }],
                candidates: [
                  {
                    id: 'step.refused',
                    source: { kind: 'step', stepId: VOICES.id },
                    reason: 'what the voices step contributed',
                    role: 'system',
                    text: 'Marlow is lying.',
                  },
                ],
                effects: [clockProposal(VOICES.id)],
              };
            },
          },
          {
            definition: TEST_STEP,
            run: async (_input, host) => ({ message: { text: (await host.call({})).text } }),
          },
        ],
      };
    }

    async function taken(both: boolean): Promise<Turn> {
      makeRunner({
        script: [{ text: 'Rain on the tin roof.' }, { text: 'Still raining.' }],
        plan: voicesThenNarrates(both),
      });
      const { turn } = await runTurn();
      expect(turn.status).toBe('complete');
      expect(turn.request?.calls).toHaveLength(2);
      return turn;
    }

    const reachedTheNarrator = (turn: Turn): boolean =>
      (turn.request?.calls[1]?.blocks ?? []).some((block) => block.id === 'step.refused');
    const proposedByVoices = (turn: Turn): ChannelEffect[] =>
      turn.effects.filter(
        (effect) => effect.proposedBy.kind === 'step' && effect.proposedBy.stepId === VOICES.id,
      );

    it('the control: an accepted result contributes its candidate and its effect', async () => {
      const turn = await taken(false);
      expect(reachedTheNarrator(turn)).toBe(true);
      expect(proposedByVoices(turn)).toHaveLength(1);
    });

    it('lets nothing of a refused result reach a later step or the record', async () => {
      const turn = await taken(true);
      expect(turn.steps?.[0]).toMatchObject({ stepId: VOICES.id, state: 'failed' });
      expect(reachedTheNarrator(turn)).toBe(false);
      expect(proposedByVoices(turn)).toEqual([]);
    });
  });

  /**
   * *An empty list spoke for nobody*, and the record's word for that is an
   * absent output rather than an empty one — the distinction every optional
   * field on a turn draws.
   */
  it('writes no output for a step that spoke for nobody', async () => {
    makeRunner({
      plan: {
        steps: [
          {
            definition: { ...TEST_STEP, role: null },
            run: () => Promise.resolve({ messages: [] }),
          },
        ],
      },
    });

    const { turn } = await runTurn();

    expect(turn.status).toBe('complete');
    expect(turn).not.toHaveProperty('output');
  });
});
