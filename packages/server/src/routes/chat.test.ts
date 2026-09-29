// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, uuidv7, type Turn } from '@storyengine/shared';

import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type SseFrame, type TestServer } from '../test-server.js';

/**
 * ***The server half of the chat surface*** —
 * [P13 §1.8](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13.5]. What the play page reads and writes that no earlier stage served:
 *
 * - the session's effective chat settings on `GET /sessions/:id`, and a door to
 *   change them, `PUT /sessions/:id/chat`, which must never re-voice a pre-P13
 *   session by writing one field of three;
 * - which message each sibling is a swipe of, on the transcript;
 * - who is speaking, on `call.started`, and the round's order, on
 *   `speakers.picked`, so a round can be painted as it streams.
 *
 * Played on Scene itself, as `gestures.test.ts` is and for its reason.
 */

let server: TestServer;
let provider: FakeProvider;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a32';
const TURN_FINISHES_MS = 8_000;
/** The assistant: embodied, one card, and not a chat — so it has no chat settings. */
const ASSISTANT = 'storyengine.assistant';

const finished = (frame: SseFrame): boolean =>
  frame.event === 'progress' && (frame.data as { key: string }).key === 'turn.finished';

beforeEach(async () => {
  provider = new FakeProvider();
  server = await makeTestServer({
    providers: () => provider,
    config: {
      sessions: { snapshotEveryNTurns: 10, streamKeepaliveMs: 15000, streamCoalesceMs: 0 },
    },
  });
  await setUpAdmin(server, 'ned');
  const root = new Layout(server.dataDir).userConnectionsRoot('ned');
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
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );
});

afterEach(async () => {
  await server.dispose();
});

async function anActor(name: string): Promise<string> {
  const actor = newActor(name);
  const created = await server.request({
    method: 'POST',
    url: '/api/library/actors',
    payload: actor,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return actor.id;
}

async function aSession(actors: string[], mode?: string): Promise<string> {
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: {
      name: 'Harbour',
      cast: { persona: null, actors },
      ...(mode === undefined ? {} : { mode }),
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.session.id as string;
}

async function readChat(sessionId: string): Promise<Record<string, any> | undefined> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  return read.body.chat as Record<string, any> | undefined;
}

function putChat(sessionId: string, body: unknown): Promise<{ status: number; body: any }> {
  return server.request({ method: 'PUT', url: `/api/sessions/${sessionId}/chat`, payload: body });
}

function sessionFile(sessionId: string): string {
  return join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
}

async function head(sessionId: string): Promise<string | null> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  return read.body.session.headTurnId as string | null;
}

/** Plays a turn and hands back the turn and every progress frame it streamed. */
async function play(
  sessionId: string,
  body: Record<string, unknown>,
  script: ScriptedReply[],
): Promise<{ turn: Turn; progress: { key: string; params: Record<string, unknown> }[] }> {
  provider.setScript(script);
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: uuidv7(), headTurnId: await head(sessionId), ...body },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
  const stream = await server.stream({ url: submitted.body.stream as string });
  await stream.until(finished, TURN_FINISHES_MS);
  const progress = stream
    .frames()
    .filter((frame) => frame.event === 'progress')
    .map((frame) => frame.data as { key: string; params: Record<string, unknown> });
  await stream.abort();
  const read = await server.request({
    method: 'GET',
    url: `/api/sessions/${sessionId}/turns/${submitted.body.turnId as string}`,
  });
  return { turn: read.body.turn as Turn, progress };
}

describe('the chat settings, read and written', () => {
  it('reads the effective settings of a Scene session, and none for the assistant', async () => {
    const vera = await anActor('Vera');
    const scene = await aSession([vera]);
    expect(await readChat(scene)).toMatchObject({
      voice: 'embodied',
      dispatch: 'per-actor',
      speakers: { policy: 'natural', allowSelfResponses: false, namesInHistory: 'groups' },
      note: null,
      hidden: {},
      prompts: { instruction: true, cards: {} },
    });

    const assistant = await aSession([vera], ASSISTANT);
    expect(await readChat(assistant)).toBeUndefined();
    const refused = await putChat(assistant, { voice: 'narrator' });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('not-a-chat');
  });

  it('writes one member of the policy and keeps the rest', async () => {
    const id = await aSession([await anActor('Vera')]);
    const written = await putChat(id, { speakers: { policy: 'smart' } });
    expect(written.status, JSON.stringify(written.body)).toBe(200);
    expect(written.body.chat.speakers).toEqual({
      policy: 'smart',
      allowSelfResponses: false,
      namesInHistory: 'groups',
      maxPerRound: 3,
    });
    expect((await readChat(id))?.['speakers'].policy).toBe('smart');
  });

  /**
   * ***The rule the write exists around.*** A session carrying none of the
   * three fields reads as the mode's legacy values; a write of `dispatch`
   * alone would make it modern and let its absent `voice` fall to Scene's
   * declared `embodied`. It must stay narrated.
   */
  it('never re-voices a pre-P13 session by writing one field of three', async () => {
    const id = await aSession([await anActor('Vera')]);
    const file = JSON.parse(await readFile(sessionFile(id), 'utf8')) as Record<string, unknown>;
    delete file['voice'];
    delete file['dispatch'];
    delete file['speakers'];
    await writeFile(sessionFile(id), JSON.stringify(file));
    expect(await readChat(id)).toMatchObject({
      voice: 'narrator',
      dispatch: 'merged',
      speakers: { policy: 'fixed' },
    });

    await putChat(id, { dispatch: 'per-actor' });

    const after = JSON.parse(await readFile(sessionFile(id), 'utf8')) as Record<string, any>;
    expect(after['voice']).toBe('narrator');
    expect(after['dispatch']).toBe('per-actor');
    expect(after['speakers'].policy).toBe('fixed');
  });

  it('sets, switches off and removes the author’s note', async () => {
    const id = await aSession([await anActor('Vera')]);
    await putChat(id, { note: { text: 'Keep it wet.', depth: 2, every: 3 } });
    expect((await readChat(id))?.['note']).toEqual({ text: 'Keep it wet.', depth: 2, every: 3 });

    await putChat(id, { note: { text: 'Keep it wet.', depth: 2, every: 0 } });
    expect((await readChat(id))?.['note']).toEqual({ text: 'Keep it wet.', depth: 2, every: 0 });

    await putChat(id, { note: null });
    expect((await readChat(id))?.['note']).toBeNull();
    const file = JSON.parse(await readFile(sessionFile(id), 'utf8')) as Record<string, unknown>;
    expect('note' in file).toBe(false);
  });

  it('merges prompt switches per card, and absent is send everything', async () => {
    const vera = await anActor('Vera');
    const lund = await anActor('Lund');
    const id = await aSession([vera, lund]);

    await putChat(id, { prompts: { instruction: false, cards: { [vera]: ['system'] } } });
    await putChat(id, { prompts: { cards: { [lund]: false } } });
    expect((await readChat(id))?.['prompts']).toEqual({
      instruction: false,
      cards: { [vera]: ['system'], [lund]: false },
    });

    await putChat(id, { prompts: { instruction: true, cards: { [vera]: true, [lund]: [] } } });
    expect((await readChat(id))?.['prompts']).toEqual({ instruction: true, cards: {} });
    const file = JSON.parse(await readFile(sessionFile(id), 'utf8')) as Record<string, unknown>;
    expect('prompts' in file).toBe(false);
  });

  it('refuses a request that asks for nothing, and a value the reader would not read', async () => {
    const id = await aSession([await anActor('Vera')]);
    expect((await putChat(id, {})).status).toBe(400);
    expect((await putChat(id, { voice: 'whisper' })).status).toBe(400);
    expect((await putChat(id, { speakers: { maxPerRound: 0 } })).status).toBe(400);
  });
});

describe('a round, as the play surface paints it', () => {
  it('names the speaker on call.started and the order on speakers.picked', async () => {
    const vera = await anActor('Vera');
    const lund = await anActor('Lund');
    const id = await aSession([vera, lund]);
    const { progress } = await play(id, { input: { text: 'Well?' }, speakers: [lund, vera] }, [
      { text: '"Aye."' },
      { text: '"You came."' },
    ]);

    const picked = progress.filter((event) => event.key === 'speakers.picked');
    expect(picked).toHaveLength(1);
    expect(picked[0]?.params).toEqual({
      speakers: [
        { id: lund, name: 'Lund' },
        { id: vera, name: 'Vera' },
      ],
      // Named by the submission, so the composer must not say the rules chose.
      by: 'forced',
    });

    const started = progress
      .filter((event) => event.key === 'call.started')
      .map((event) => ({ message: event.params['message'], speaker: event.params['speaker'] }));
    expect(started).toEqual([
      { message: 0, speaker: { id: lund, name: 'Lund' } },
      { message: 1, speaker: { id: vera, name: 'Vera' } },
    ]);
  });

  it("says a swipe kept its speaker, and a policy pick is the rules'", async () => {
    const vera = await anActor('Vera');
    const lund = await anActor('Lund');
    const id = await aSession([vera, lund]);
    const { turn: round, progress: first } = await play(
      id,
      { input: { text: 'Well?' }, speakers: [vera, lund] },
      [{ text: '"You came."' }, { text: '"Aye."' }],
    );
    expect(first.find((event) => event.key === 'speakers.picked')?.params['by']).toBe('forced');

    const { progress: swiped } = await play(
      id,
      { rewriteOf: round.id, fromMessage: 1, parentTurnId: round.parentTurnId },
      [{ text: '"Nay."' }],
    );
    expect(swiped.find((event) => event.key === 'speakers.picked')?.params).toEqual({
      speakers: [{ id: lund, name: 'Lund' }],
      by: 'rewrite',
    });

    const { progress: drawn } = await play(id, { input: { text: 'And?' } }, [
      { text: '"Hm."' },
      { text: '"Hm."' },
    ]);
    expect(drawn.find((event) => event.key === 'speakers.picked')?.params['by']).toBe('rules');
  });

  it('says nothing of an order when a narrator speaks for nobody', async () => {
    const vera = await anActor('Vera');
    const id = await aSession([vera]);
    await putChat(id, { voice: 'narrator' });
    const { progress } = await play(id, { input: { text: 'Well?' } }, [{ text: 'Rain.' }]);
    expect(progress.some((event) => event.key === 'speakers.picked')).toBe(false);
  });

  it('puts a swipe on the message it redid, and an edited move on the turn', async () => {
    const vera = await anActor('Vera');
    const lund = await anActor('Lund');
    const id = await aSession([vera, lund]);
    const { turn: round } = await play(id, { input: { text: 'Well?' }, speakers: [vera, lund] }, [
      { text: '"You came."' },
      { text: '"Aye."' },
    ]);
    const { turn: swipe } = await play(
      id,
      { rewriteOf: round.id, fromMessage: 1, parentTurnId: round.parentTurnId },
      [{ text: '"Nay."' }],
    );
    const edited = await server.request({
      method: 'POST',
      url: `/api/sessions/${id}/turns`,
      payload: {
        idempotencyKey: uuidv7(),
        headTurnId: await head(id),
        editOf: round.id,
        authored: { input: { text: 'Well, then?' } },
      },
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(202);
    const stream = await server.stream({ url: edited.body.stream as string });
    await stream.until(finished, TURN_FINISHES_MS);
    await stream.abort();

    // Back onto the swipe, and read the transcript from there.
    await server.request({
      method: 'PUT',
      url: `/api/sessions/${id}/head`,
      payload: { turnId: swipe.id },
    });
    const listed = await server.request({ method: 'GET', url: `/api/sessions/${id}/turns` });
    expect(listed.body.swipes[swipe.id]).toEqual({
      messages: [[], [round.id, swipe.id], []],
      turn: [swipe.id, edited.body.turnId as string],
    });
  });
});
