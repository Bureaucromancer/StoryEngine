// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, type Actor, type OutputMessage } from '@storyengine/shared';

import { Accounts } from '../auth/accounts.js';
import { DEFAULT_CONFIG } from '../config.js';
import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { create, type LibraryContext } from '../library.js';
import { installBuiltIns } from '../mode-loader.js';
import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { SE_PRESENCE } from '../sessions/cast.js';
import { readAllTurns } from '../sessions/segments.js';
import {
  createSession,
  readSession,
  writeChannel,
  type SessionContext,
} from '../sessions/store.js';
import type { SessionFile, Turn } from '../sessions/types.js';
import type { CommitContext } from '../state/commit.js';
import { readDraft, readJob, submitTurn } from '../state/jobs.js';
import { callOnRecord } from '../test-record.js';
import { openState, type OpenedState } from '../state/open.js';
import { Layout } from '../storage/layout.js';
import { TurnStream } from '../stream/bus.js';
import { TurnRunner } from './runner.js';

/**
 * ***Per-actor dispatch, run through the pipeline*** —
 * [P13 §1.4](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13.2](../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * A file of its own rather than more of `runner.test.ts`, which is past four
 * thousand lines and about everything; what is here is one mechanism — a call
 * that speaks for somebody — and the Scene step that fans it out.
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
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61';

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
      // One checkpoint per chunk, so what the draft held at each is observable.
      sessions: { ...DEFAULT_CONFIG.sessions, streamCoalesceMs: 0 },
    },
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-runner-dispatch-'));
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
      // Two, so a card's model hint has something to choose between.
      models: ['fake-hi', 'fake-lo'],
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

/** A card with a summary and a voice, so the actor blocks have something to say. */
async function actor(
  name: string,
  summary: string,
  voice = '',
  over: Partial<Actor> = {},
): Promise<Actor> {
  const made = newActor(name);
  const card: Actor = {
    ...made,
    ...over,
    profile: {
      ...made.profile,
      sections: made.profile.sections.map((section) =>
        section.id === 'se.summary'
          ? { ...section, body: summary }
          : section.id === 'se.voice'
            ? { ...section, body: voice }
            : section,
      ),
    },
  };
  await create(library, ACCOUNT, card);
  return card;
}

/** Runs the next turn on a session and returns what landed on disk. */
let nextKey = 0;
async function play(
  sessionId: string,
  text: string | null,
  options: { replay?: Turn['tape']; parentTurnId?: string | null } = {},
): Promise<Turn> {
  nextKey += 1;
  const head = (await readSession(sessions, ACCOUNT, sessionId))?.headTurnId ?? null;
  const outcome = await submitTurn(commit, {
    account: ACCOUNT,
    sessionId,
    idempotencyKey: `dispatch-${String(nextKey)}`,
    headTurnId: head,
    ...(options.parentTurnId === undefined ? {} : { parentTurnId: options.parentTurnId }),
  });
  if (outcome.kind !== 'created') throw new Error(`expected a reservation, got ${outcome.kind}`);
  runner.start(outcome.job, {
    ...(text === null ? {} : { input: { actorId: null, kind: 'do', text, raw: text } }),
    ...(options.replay === undefined ? {} : { replay: options.replay }),
  });
  await until(() => readJob(state.db, outcome.job.id)?.status === 'committed', 'the job to commit');

  const written = await readAllTurns(
    join(dataDir, 'users', ACCOUNT, 'sessions', sessionId, 'turns'),
  );
  const turn = written.find((entry) => entry.turn.id === outcome.job.turnId)?.turn;
  if (turn === undefined) throw new Error('no turn was appended');
  return turn;
}

/** What a request said, as a person would read it: role and words, no block ids. */
function wire(at: number): { role: string; content: string }[] {
  return (provider.requests[at]?.messages ?? []).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

/**
 * ***A narrator session is not touched by any of this*** — the byte-for-byte
 * half of the stage's proof.
 *
 * **The snapshot was taken before P13.2 changed a line**, against the build
 * that had no speaking call, no in-turn history and no new names in the
 * template namespace — and it is inline so a reader sees the prompt rather
 * than a hash of it. A Scene session with the persona and two cast members,
 * one turn of history and a second turn asked for: every slot the stock pack
 * positions that has anything to say says it. What P13.2 added can only
 * reach a call that names a speaker, and this session never names one; if
 * any of it leaked into the merged call, this is the assertion that goes red.
 */
describe('a narrator session', () => {
  it('sends the prompt it sent before per-actor dispatch existed', async () => {
    makeRunner([{ text: 'The door gave.' }, { text: 'Rain on the glass.' }]);
    const persona = await actor('Ned', 'A tired investigator.');
    const vera = await actor('Vera', 'A fence with a long memory.', 'Clipped. Never says please.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const session = await createSession(sessions, ACCOUNT, {
      name: 'Narrated',
      cast: { persona: persona.id, actors: [vera.id, lund.id] },
    } satisfies Partial<SessionFile> & { name: string });

    await play(session.id, 'I knock.');
    await play(session.id, 'I wait.');

    expect(wire(1)).toMatchInlineSnapshot(`
      [
        {
          "content": "You are the narrator of a scene. Write what happens next in third person, past tense. Describe only what the player could perceive. Never write the player's own dialogue, thoughts or decisions, and never end by asking what they do.

      The player's character, Ned:
      A tired investigator.

      Vera:
      A fence with a long memory.

      Lund:
      The harbourmaster.

      How Vera speaks:
      Clipped. Never says please.",
          "role": "system",
        },
        {
          "content": "I knock.",
          "role": "user",
        },
        {
          "content": "The door gave.",
          "role": "assistant",
        },
        {
          "content": "I wait.",
          "role": "user",
        },
      ]
    `);
  });
});

/**
 * A Scene session played as a chat — the session's own voice, dispatch and
 * policy written explicitly, which is what creation does and what overrides
 * Scene's still-narrator declaration until [P13.3] flips it.
 *
 * Scene does not declare `castIsPresent` yet, so a member is eligible when the
 * story says they are here: presence is written for each, as a cast panel
 * would write it.
 */
async function chat(
  members: readonly Actor[],
  settings: {
    voice?: SessionFile['voice'];
    dispatch?: SessionFile['dispatch'];
    policy?: NonNullable<SessionFile['speakers']>['policy'];
    persona?: Actor;
  } = {},
): Promise<string> {
  const session = await createSession(sessions, ACCOUNT, {
    name: 'Chat',
    cast: { persona: settings.persona?.id ?? null, actors: members.map((member) => member.id) },
    voice: settings.voice ?? 'embodied',
    dispatch: settings.dispatch ?? 'per-actor',
    speakers: {
      policy: settings.policy ?? 'list',
      allowSelfResponses: false,
      namesInHistory: 'groups',
      maxPerRound: 3,
    },
  });
  for (const member of members) {
    await writeChannel(sessions, ACCOUNT, session.id, `${SE_PRESENCE}#${member.id}`, true);
  }
  return session.id;
}

/** Who spoke each message, by name. */
function speakersOf(turn: Turn): (string | null)[] {
  return (turn.output?.messages ?? []).map((message) => message.speaker?.name ?? null);
}

/** Everything a request sent after the player's words, joined as a reader sees it. */
function afterInput(at: number, input: string): string {
  const sent = wire(at);
  const from = sent.findIndex((message) => message.role === 'user' && message.content === input);
  return sent
    .slice(from + 1)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n');
}

describe('a per-actor round', () => {
  const REPLIES = ['"You came." Vera did not look up.', '"I owe you nothing."', '"Aye."'] as const;

  /**
   * ***What P13.2 ends at***: *"a three-member `list` round produces three
   * messages, and the third prompt holds the first two replies."*
   */
  it('makes one call per member, each shown the replies before it', async () => {
    makeRunner(REPLIES.map((text) => ({ text })));
    const persona = await actor('Ned', 'A tired investigator.');
    const vera = await actor('Vera', 'A fence with a long memory.');
    const marlow = await actor('Marlow', 'Owes somebody money.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, marlow, lund], { persona });

    const turn = await play(sessionId, 'Well?');

    expect(turn.status).toBe('complete');
    expect(provider.requests).toHaveLength(3);
    // The first speaker answers the player and nothing else.
    expect(afterInput(0, 'Well?')).toBe('');
    // The second is shown the first reply after the input, as the model's own.
    expect(afterInput(1, 'Well?')).toBe(`assistant: ${REPLIES[0]}`);
    // The third is shown both, in order.
    expect(afterInput(2, 'Well?')).toBe(`assistant: ${REPLIES[0]}\n\n${REPLIES[1]}`);
    // And the record names each as a round block, which message and whose.
    const third = callOnRecord(turn, 2).blocks ?? [];
    expect(third.filter((block) => block.source.kind === 'round').map((b) => b.source)).toEqual([
      { kind: 'round', message: 0, actorId: vera.id },
      { kind: 'round', message: 1, actorId: marlow.id },
    ]);

    // Three messages, each under its speaker, and the text derived from them.
    expect(turn.output?.messages).toEqual([
      { speaker: { id: vera.id, name: 'Vera' }, text: REPLIES[0] },
      { speaker: { id: marlow.id, name: 'Marlow' }, text: REPLIES[1] },
      { speaker: { id: lund.id, name: 'Lund' }, text: REPLIES[2] },
    ] satisfies OutputMessage[]);
    expect(turn.output?.text).toBe(REPLIES.join('\n\n'));
    expect(turn.request?.calls.map((call) => call.stepId)).toEqual([
      'se.narrate',
      'se.narrate',
      'se.narrate',
    ]);
  });

  it("puts the speaker's card first and keeps every other card", async () => {
    makeRunner(REPLIES.map((text) => ({ text })));
    const vera = await actor('Vera', 'A fence with a long memory.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, lund]);

    await play(sessionId, 'Well?');

    const system = (at: number): string => wire(at)[0]?.content ?? '';
    // Vera's call: her card, then Lund's. Lund's call: his, then hers.
    expect(system(0).indexOf('Vera:\n')).toBeLessThan(system(0).indexOf('Lund:\n'));
    expect(system(1).indexOf('Lund:\n')).toBeLessThan(system(1).indexOf('Vera:\n'));
    expect(system(1)).toContain('A fence with a long memory.');
  });

  it("resolves each call's model for its speaker, as an actorId would", async () => {
    makeRunner(REPLIES.map((text) => ({ text })));
    // The hint is the card's — a step names the speaker and cannot pass a
    // preference the card does not hold ([P7.3]).
    const vera = await actor('Vera', 'A fence.', '', {
      modelHint: { role: 'prose', preferredModelIds: ['fake-lo'] },
    });
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, lund]);

    await play(sessionId, 'Well?');

    // Vera's call on the model her card prefers; Lund's, with no hint, on the
    // binding's.
    expect(provider.requests.map((request) => request.modelId)).toEqual(['fake-lo', 'fake-hi']);
  });

  /**
   * ***Streamed into a message of its own***, and the durable events and the
   * live frames both say which. The draft grows a message per speaker while
   * the round runs, and a reader that appends every delta to one text — every
   * client older than this stage — ends with the turn's `output.text`.
   */
  it('streams each speaker into its own message, and says which', async () => {
    makeRunner(REPLIES.map((text) => ({ text, chunks: 2 })));
    const vera = await actor('Vera', 'A fence.');
    const marlow = await actor('Marlow', 'Owes somebody money.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, marlow, lund]);

    const started: unknown[] = [];
    const streaming: unknown[] = [];
    const drafted: number[] = [];
    const deltas: { text: string; message: number | undefined }[] = [];
    const detach = bus.subscribe(sessionId, {
      onEvents: (jobId, events) => {
        for (const event of events) {
          if (event.key === 'call.started') started.push(event.params['message']);
          if (event.key === 'call.streaming') {
            streaming.push(event.params['message']);
            drafted.push(readDraft(commit, jobId)?.output?.messages?.length ?? 0);
          }
        }
      },
      onDelta: (_jobId, text, message) => deltas.push({ text, message }),
      onRendition: () => undefined,
    });
    const turn = await play(sessionId, 'Well?');
    detach();

    expect(started).toEqual([0, 1, 2]);
    expect(streaming).toEqual([0, 0, 1, 1, 2, 2]);
    // The draft a watcher attaches to grows a message per speaker.
    expect(drafted).toEqual([1, 1, 2, 2, 3, 3]);
    // Every piece of a speaker's text carries its index; the blank line
    // between two speakers carries none, and the pieces join to the turn.
    expect(deltas.map((one) => one.message)).toEqual([0, 0, undefined, 1, 1, undefined, 2, 2]);
    expect(deltas.map((one) => one.text).join('')).toBe(turn.output?.text);
  });

  it('cleans each reply, and keeps what the model said when that changed it', async () => {
    makeRunner([
      { text: 'Vera: "You came."' },
      { text: '"I owe you nothing."\nLund: "Aye, he does."\nNed: "Enough."' },
      { text: '"Aye."' },
    ]);
    const persona = await actor('Ned', 'A tired investigator.');
    const vera = await actor('Vera', 'A fence.');
    const marlow = await actor('Marlow', 'Owes somebody money.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, marlow, lund], { persona });

    const turn = await play(sessionId, 'Well?');

    expect(turn.output?.messages).toEqual([
      {
        speaker: { id: vera.id, name: 'Vera' },
        text: '"You came."',
        original: 'Vera: "You came."',
      },
      {
        speaker: { id: marlow.id, name: 'Marlow' },
        text: '"I owe you nothing."',
        original: '"I owe you nothing."\nLund: "Aye, he does."\nNed: "Enough."',
      },
      // Untouched, so no `original`: absent means *this is what it said*.
      { speaker: { id: lund.id, name: 'Lund' }, text: '"Aye."' },
    ]);
    // The next speaker is shown what the transcript shows, never the words
    // cleanup took out — Lund is not shown a line written for him.
    expect(afterInput(2, 'Well?')).toBe('assistant: "You came."\n\n"I owe you nothing."');
    expect(turn.output?.text).toBe('"You came."\n\n"I owe you nothing."\n\n"Aye."');
  });
});

/**
 * ***A round that loses a speaker keeps the others*** — [P13 §1.4]'s last
 * paragraph: *"a group round that loses its third speaker to a timeout is a
 * turn with two messages, not a lost turn."*
 */
describe('a partial round', () => {
  const FAILED = { class: 'terminal', message: 'The endpoint went away.' } as const;

  it('commits the messages it has, and the outcome names who was lost', async () => {
    makeRunner([{ text: '"You came."' }, { text: '"I owe you nothing."' }, { error: FAILED }]);
    const vera = await actor('Vera', 'A fence.');
    const marlow = await actor('Marlow', 'Owes somebody money.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, marlow, lund]);

    const turn = await play(sessionId, 'Well?');

    expect(turn.status).toBe('complete');
    expect(speakersOf(turn)).toEqual(['Vera', 'Marlow']);
    expect(turn.output?.text).toBe('"You came."\n\n"I owe you nothing."');
    const narrate = turn.steps?.find((step) => step.stepId === 'se.narrate');
    expect(narrate).toMatchObject({
      state: 'failed',
      // Scene declares `abort`; a partial round is handled as a warning.
      failure: 'warn',
      error: { reason: 'terminal' },
      round: { kept: 2, lost: { id: lund.id, name: 'Lund' } },
    });
    // The turn went on past the step: the stager ran after it, and the clock
    // moved — neither happens after an abort.
    expect(turn.steps?.map((step) => step.stepId)).toContain('se.scene.stage');
    expect(turn.effects.some((effect) => effect.channelId === 'se.clock')).toBe(true);
    // All three calls are on the record, the third as the failure it was.
    expect(turn.request?.calls.map((call) => call.outcome)).toEqual(['ok', 'ok', 'error']);
  });

  it('keeps what a speaker said before the failure cut them off', async () => {
    makeRunner([
      { text: '"You came."' },
      { text: '"The ship came in late, and nobody', chunks: 2, failAfterChunks: 1 },
    ]);
    const vera = await actor('Vera', 'A fence.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, lund]);

    const turn = await play(sessionId, 'Well?');

    expect(turn.status).toBe('complete');
    // The words that arrived, under the name they arrived under; `kept`
    // counts the finished ones.
    expect(speakersOf(turn)).toEqual(['Vera', 'Lund']);
    expect(turn.output?.messages?.[1]?.text.length).toBeGreaterThan(0);
    expect(turn.steps?.find((step) => step.stepId === 'se.narrate')?.round).toEqual({
      kept: 1,
      lost: { id: lund.id, name: 'Lund' },
    });
  });

  it('fails the turn as before when the first speaker fails', async () => {
    makeRunner([{ error: FAILED }]);
    const vera = await actor('Vera', 'A fence.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, lund]);

    const turn = await play(sessionId, 'Well?');

    expect(turn.status).toBe('failed');
    expect(provider.requests).toHaveLength(1);
    const narrate = turn.steps?.find((step) => step.stepId === 'se.narrate');
    expect(narrate?.failure).toBe('abort');
    expect(narrate?.round).toBeUndefined();
    expect(turn.output).toBeUndefined();
  });
});

describe('the other two ways Scene speaks', () => {
  /**
   * ***Merged, embodied*** — Marinara's merged mode: one call, for the first
   * selected member, with every card present; the reply may voice several
   * members, and nothing cuts it.
   */
  it('makes one speaking call under merged dispatch, and cuts nothing', async () => {
    const reply = 'Vera: "You came."\nLund: "Aye."';
    makeRunner([{ text: reply }]);
    const vera = await actor('Vera', 'A fence with a long memory.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, lund], { dispatch: 'merged' });

    const turn = await play(sessionId, 'Well?');

    expect(provider.requests).toHaveLength(1);
    expect(turn.output?.messages).toEqual([
      { speaker: { id: vera.id, name: 'Vera' }, text: reply },
    ]);
    const system = wire(0)[0]?.content ?? '';
    expect(system).toContain('A fence with a long memory.');
    expect(system).toContain('The harbourmaster.');
  });

  it('makes one call with no speaker in narrator voice, whoever was selected', async () => {
    makeRunner([{ text: 'Rain on the glass.' }]);
    const vera = await actor('Vera', 'A fence.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, lund], { voice: 'narrator' });

    const turn = await play(sessionId, 'Well?');

    expect(provider.requests).toHaveLength(1);
    expect(turn.output).toEqual({ text: 'Rain on the glass.' });
    expect(callOnRecord(turn).blocks?.some((block) => block.source.kind === 'round')).toBe(false);
  });

  /**
   * ***Nobody speaks, and no call is made*** — `manual` after an input
   * ([P13 §1.3]: *"nobody replies to an input"*). The turn is the player's
   * move and no reply, which is what an absent output has always meant.
   */
  it('makes no call and records the input alone when nobody was asked to reply', async () => {
    makeRunner([{ text: 'Should never be asked for.' }]);
    const vera = await actor('Vera', 'A fence.');
    const lund = await actor('Lund', 'The harbourmaster.');
    const sessionId = await chat([vera, lund], { policy: 'manual' });

    const turn = await play(sessionId, 'I say nothing to anybody.');

    expect(provider.requests).toHaveLength(0);
    expect(turn.status).toBe('complete');
    expect(turn.input?.text).toBe('I say nothing to anybody.');
    expect(turn.output).toBeUndefined();
    expect(turn.request).toBeUndefined();
    expect(turn.steps?.find((step) => step.stepId === 'se.narrate')?.state).toBe('ok');
  });
});

/**
 * ***A rewrite replays the round*** — the tape carries the policy's draws, so
 * the same members speak in the same order; the speaking calls themselves run
 * again, because a model call is never replayed.
 */
describe('a rewritten round', () => {
  it('speaks with the same members in the same order, and asks each again', async () => {
    makeRunner([{ text: 'One.' }]);
    const members = [
      await actor('Vera', 'A fence.'),
      await actor('Marlow', 'Owes somebody money.'),
      await actor('Lund', 'The harbourmaster.'),
      await actor('Iris', 'Keeps the ledger.'),
    ];
    // `natural`, so the order is a shuffle and the speakers are rolls: the
    // one policy where a rewrite that drew again would visibly differ.
    const sessionId = await chat(members, { policy: 'natural' });

    const first = await play(sessionId, 'Well?');
    const asked = provider.requests.length;
    const rewrite = await play(sessionId, 'Well?', {
      replay: first.tape,
      parentTurnId: first.parentTurnId,
    });

    expect(rewrite.parentTurnId).toBe(first.parentTurnId);
    expect(speakersOf(first).length).toBeGreaterThan(0);
    expect(speakersOf(rewrite)).toEqual(speakersOf(first));
    // Every speaking call ran again.
    expect(provider.requests.length - asked).toBe(asked);
  });
});
