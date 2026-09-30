// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, type Actor, type OutputMessage } from '@storyengine/shared';

import { CONTINUE_NUDGE } from '../assembly/collect.js';
import { Accounts } from '../auth/accounts.js';
import { DEFAULT_CONFIG } from '../config.js';
import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { create, type LibraryContext } from '../library.js';
import { installBuiltIns } from '../mode-loader.js';
import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { readAllTurns } from '../sessions/segments.js';
import { createSession, readSession, type SessionContext } from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import type { CommitContext } from '../state/commit.js';
import { readJob, submitTurn } from '../state/jobs.js';
import { openState, type OpenedState } from '../state/open.js';
import { Layout } from '../storage/layout.js';
import { TurnStream } from '../stream/bus.js';
import { callOnRecord } from '../test-record.js';
import { TurnRunner, type TurnPayload } from './runner.js';

/**
 * ***A swipe and a continue, run through the pipeline*** —
 * [P14 §1.6](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14.4].
 *
 * The route reads the record and hands the runner a `carry`
 * (`routes/gestures.ts`); this file hands it one directly and proves what the
 * runner does with it: **the round starts where the carried messages end**, the
 * regenerated speaker's prompt shows them as the round so far, and the turn's
 * output is them and then the fresh reply. For a continue, the one call is shown
 * the message it extends as the last assistant entry, ends on the nudge, and
 * writes into that message rather than after it. `routes/gestures.test.ts`
 * covers the route's half.
 */

let dataDir: string;
let index: OpenedIndex;
let state: OpenedState;
let sessions: SessionContext;
let library: LibraryContext;
let bus: TurnStream;
let commit: CommitContext;
let provider: FakeProvider;
let runner: TurnRunner;
let accounts: Accounts;

const ACCOUNT = 'ned';
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a62';

async function until(predicate: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((tick) => setTimeout(tick, 5));
  }
  expect(predicate(), `waited for ${what}`).toBe(true);
}

function makeRunner(script: ScriptedReply[]): void {
  provider = new FakeProvider({ script });
  runner = new TurnRunner({
    commit,
    bus,
    providers: () => provider,
    accounts,
    config: {
      ...DEFAULT_CONFIG,
      sessions: { ...DEFAULT_CONFIG.sessions, streamCoalesceMs: 0 },
    },
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-runner-gestures-'));
  await installBuiltIns();
  index = await openIndex({ path: ':memory:' });
  state = await openState({ path: ':memory:' });
  sessions = { layout: new Layout(dataDir), index: index.db };
  library = { db: index.db, layout: sessions.layout, keepHistoryPerObject: 0 };
  bus = new TurnStream();
  commit = { db: state.db, sessions, events: bus };
  accounts = new Accounts(sessions.layout);
  await accounts.create({ handle: ACCOUNT, password: 'a long enough password', role: 'user' });

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
  makeRunner([]);
});

afterEach(async () => {
  await runner.drain();
  state.close();
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function actor(name: string): Promise<Actor> {
  const card = newActor(name);
  await create(library, ACCOUNT, card);
  return card;
}

/** A Scene chat played `list`, per-actor, so a round's order is the cast's. */
async function chat(members: readonly Actor[]): Promise<string> {
  const session = await createSession(sessions, ACCOUNT, {
    name: 'Chat',
    cast: { persona: null, actors: members.map((member) => member.id) },
    voice: 'embodied',
    dispatch: 'per-actor',
    speakers: {
      policy: 'list',
      allowSelfResponses: false,
      namesInHistory: 'groups',
      maxPerRound: 3,
    },
  });
  return session.id;
}

let nextKey = 0;
/** Runs one turn with this payload, as a child of `parentTurnId`, and returns it from disk. */
async function run(
  sessionId: string,
  payload: TurnPayload,
  parentTurnId?: string | null,
): Promise<Turn> {
  nextKey += 1;
  const head = (await readSession(sessions, ACCOUNT, sessionId))?.headTurnId ?? null;
  const outcome = await submitTurn(commit, {
    account: ACCOUNT,
    sessionId,
    idempotencyKey: `gesture-${String(nextKey)}`,
    headTurnId: head,
    ...(parentTurnId === undefined ? {} : { parentTurnId }),
  });
  if (outcome.kind !== 'created') throw new Error(`expected a reservation, got ${outcome.kind}`);
  runner.start(outcome.job, payload);
  await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'the job to commit');
  const written = await readAllTurns(
    join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
  );
  const turn = written.find((entry) => entry.turn.id === outcome.job.turnId)?.turn;
  if (turn === undefined) throw new Error('no turn was appended');
  return turn;
}

const WELL = { actorId: null, kind: 'do', text: 'Well?', raw: 'Well?' };

function wire(at: number): { role: string; content: string }[] {
  return (provider.requests[at]?.messages ?? []).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

/** Everything a request sent after the player's words. */
function afterInput(at: number): { role: string; content: string }[] {
  const sent = wire(at);
  const from = sent.findIndex((message) => message.role === 'user' && message.content === 'Well?');
  return sent.slice(from + 1);
}

const carried = (message: OutputMessage): OutputMessage => ({ ...message, carried: true });

describe('a swipe — fromMessage', () => {
  it('starts the round at k, the carried messages as the round so far', async () => {
    makeRunner([{ text: '"You came."' }, { text: '"Owe you?"' }, { text: '"Aye."' }]);
    const vera = await actor('Vera');
    const marlow = await actor('Marlow');
    const lund = await actor('Lund');
    const sessionId = await chat([vera, marlow, lund]);
    const round = await run(sessionId, { input: WELL });
    const [first] = round.output?.messages ?? [];
    if (first === undefined) throw new Error('the round said nothing');

    makeRunner([{ text: '"I owe you nothing."' }, { text: '"Aye, then."' }]);
    const deltas: { text: string; message: number | undefined }[] = [];
    const detach = bus.subscribe(sessionId, {
      onEvents: () => undefined,
      onDelta: (_job, text, message) => deltas.push({ text, message }),
      onRendition: () => undefined,
    });
    const swiped = await run(
      sessionId,
      { input: WELL, carry: { messages: [carried(first)], speaker: marlow.id } },
      round.parentTurnId,
    );
    detach();

    // One call — Marlow's — and only the messages from k on are this turn's work.
    expect(provider.requests).toHaveLength(1);
    expect(swiped.request?.calls).toHaveLength(1);
    expect(swiped.output?.messages).toEqual([
      { speaker: { id: vera.id, name: 'Vera' }, text: '"You came."', carried: true },
      { speaker: { id: marlow.id, name: 'Marlow' }, text: '"I owe you nothing."' },
    ] satisfies OutputMessage[]);
    expect(swiped.output?.text).toBe('"You came."\n\n"I owe you nothing."');
    // Marlow is shown Vera's line after the move, as a live round would show it.
    expect(afterInput(0)).toEqual([{ role: 'assistant', content: '"You came."' }]);
    const blocks = callOnRecord(swiped, 0).blocks ?? [];
    expect(blocks.filter((block) => block.source.kind === 'round').map((b) => b.source)).toEqual([
      { kind: 'round', message: 0, actorId: vera.id },
    ]);
    // The regenerated speaker streams into message k, after the carried text,
    // so a reader appending every piece builds the turn's text.
    expect(deltas[0]).toEqual({ text: '"You came."', message: undefined });
    expect(
      deltas
        .filter((delta) => delta.message === 1)
        .map((d) => d.text)
        .join(''),
    ).toBe('"I owe you nothing."');
    expect(deltas.map((delta) => delta.text).join('')).toBe(swiped.output?.text);
    // The carried speaker is the selection and not force-talk on the record.
    expect(swiped.input?.speakers).toBeUndefined();
  });

  it('keeps the carried messages when the regenerated speaker fails', async () => {
    const vera = await actor('Vera');
    const lund = await actor('Lund');
    const sessionId = await chat([vera, lund]);
    makeRunner([{ error: { class: 'terminal', message: 'No.' } }]);
    const first: OutputMessage = { speaker: { id: vera.id, name: 'Vera' }, text: 'Hm.' };
    const failed = await run(sessionId, {
      input: WELL,
      carry: { messages: [carried(first)], speaker: lund.id },
    });
    expect(failed.status).toBe('failed');
    expect(failed.output?.messages).toEqual([carried(first)]);
  });
});

describe('a continue — continueOf', () => {
  async function aRound(): Promise<{ sessionId: string; vera: Actor; lund: Actor; round: Turn }> {
    makeRunner([{ text: '"You came."' }, { text: '"Aye."' }]);
    const vera = await actor('Vera');
    const lund = await actor('Lund');
    const sessionId = await chat([vera, lund]);
    const round = await run(sessionId, { input: WELL });
    return { sessionId, vera, lund, round };
  }

  function carryOf(round: Turn, speaker: string): NonNullable<TurnPayload['carry']> {
    const messages = round.output?.messages ?? [];
    return {
      messages: [
        ...messages.slice(0, -1).map(carried),
        // The continued one too, as the route carries it — marked until the
        // first streamed piece takes it over.
        ...messages.slice(-1).map(carried),
      ],
      speaker,
      continues: true,
    };
  }

  it('writes the continuation into the last message, the call ending on the nudge', async () => {
    const { sessionId, vera, lund, round } = await aRound();
    makeRunner([{ text: 'He looked away.', chunks: 3 }]);
    const deltas: { text: string; message: number | undefined }[] = [];
    const detach = bus.subscribe(sessionId, {
      onEvents: () => undefined,
      onDelta: (_job, text, message) => deltas.push({ text, message }),
      onRendition: () => undefined,
    });
    const continued = await run(
      sessionId,
      { input: WELL, carry: carryOf(round, lund.id) },
      round.parentTurnId,
    );
    detach();

    expect(provider.requests).toHaveLength(1);
    expect(continued.output?.messages).toEqual([
      { speaker: { id: vera.id, name: 'Vera' }, text: '"You came."', carried: true },
      { speaker: { id: lund.id, name: 'Lund' }, text: '"Aye." He looked away.' },
    ] satisfies OutputMessage[]);
    // The round so far, the message being continued last and named — two
    // speakers in the window — and then ST's nudge, which ends the call.
    expect(afterInput(0)).toEqual([
      { role: 'assistant', content: 'Vera: "You came."\n\nLund: "Aye."' },
      { role: 'system', content: CONTINUE_NUDGE },
    ]);
    const blocks = callOnRecord(continued, 0).blocks ?? [];
    expect(blocks.at(-1)).toMatchObject({ source: { kind: 'continue' }, included: true });
    // The joiner goes out under the continued message's index, so both
    // kinds of reader build the committed text.
    expect(deltas.map((delta) => delta.text).join('')).toBe(continued.output?.text);
    expect(
      deltas
        .filter((delta) => delta.message === 1)
        .map((d) => d.text)
        .join(''),
    ).toBe(' He looked away.');
  });

  it('cleans the continuation alone, and keeps what the model said', async () => {
    const { sessionId, lund, round } = await aRound();
    makeRunner([{ text: 'Lund: And left.' }]);
    const continued = await run(
      sessionId,
      { input: WELL, carry: carryOf(round, lund.id) },
      round.parentTurnId,
    );
    expect(continued.output?.messages?.[1]).toEqual({
      speaker: { id: lund.id, name: 'Lund' },
      text: '"Aye." And left.',
      original: '"Aye." Lund: And left.',
    });
  });

  it('keeps the old message as it was when the call fails before a word', async () => {
    const { sessionId, lund, round } = await aRound();
    makeRunner([{ error: { class: 'terminal', message: 'No.' } }]);
    const failed = await run(
      sessionId,
      { input: WELL, carry: carryOf(round, lund.id) },
      round.parentTurnId,
    );
    expect(failed.status).toBe('failed');
    expect(failed.output?.text).toBe('"You came."\n\n"Aye."');
    // Carried, and said so: this turn wrote none of it.
    expect(failed.output?.messages?.[1]?.carried).toBe(true);
  });

  it('keeps what streamed when the call fails mid-continuation', async () => {
    const { sessionId, lund, round } = await aRound();
    makeRunner([
      {
        text: 'one two three four',
        chunks: 4,
        failAfterChunks: 2,
        error: { class: 'terminal', message: 'Gone.' },
      },
    ]);
    const failed = await run(
      sessionId,
      { input: WELL, carry: carryOf(round, lund.id) },
      round.parentTurnId,
    );
    expect(failed.status).toBe('failed');
    const last = failed.output?.messages?.[1];
    expect(last?.speaker?.id).toBe(lund.id);
    expect(last?.text.startsWith('"Aye." one')).toBe(true);
    expect(last?.carried).toBeUndefined();
  });
});

describe('a turn written by hand — authored', () => {
  it('commits its input and lines with no call, no request and no effects', async () => {
    makeRunner([{ text: 'never asked' }]);
    const vera = await actor('Vera');
    const sessionId = await chat([vera]);
    const line: OutputMessage = { speaker: { id: vera.id, name: 'Vera' }, text: 'Written.' };
    const turn = await run(sessionId, { input: WELL, authored: { messages: [line] } });

    expect(provider.requests).toHaveLength(0);
    expect(turn.status).toBe('complete');
    expect(turn.request).toBeUndefined();
    expect(turn.effects).toEqual([]);
    expect(turn.input?.text).toBe('Well?');
    expect(turn.output?.messages).toEqual([line]);
    expect((await readSession(sessions, ACCOUNT, sessionId))?.headTurnId).toBe(turn.id);
  });
});
