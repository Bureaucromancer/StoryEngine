// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, uuidv7, type Turn } from '@storyengine/shared';

import { FakeProvider, type RecordedRequest, type ScriptedReply } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type SseFrame, type TestServer } from '../test-server.js';

/**
 * ***The narrative director and the secret plot, through the server*** —
 * [P13 §1.9.3](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13.5b]'s *ends at*: *"a pushed turn's record shows the direction it was
 * given; a failed direction call falls back to the fixed text and says so; the
 * secret plot is in the prompt and not in the transcript until revealed."*
 *
 * Through the routes, because a push is a submission field and the plot's
 * switch and reveal are a person's channel writes. `turns/direct.test.ts` holds
 * the step to its own claims and `plot.test.ts` the plot's pass; this holds the
 * engine to its half — the armed flag, the guidance slot, the outcome, the
 * slot and the reveal.
 */

let server: TestServer;
let provider: FakeProvider;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a78';
const TURN_FINISHES_MS = 8_000;

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

async function aScene(): Promise<string> {
  const ned = await anActor('Ned');
  const vera = await anActor('Vera');
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Harbour', cast: { persona: ned, actors: [vera] } },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.session.id as string;
}

async function put(sessionId: string, key: string, value: unknown): Promise<void> {
  const written = await server.request({
    method: 'PUT',
    url: `/api/sessions/${sessionId}/channels/${encodeURIComponent(key)}`,
    payload: { value },
  });
  expect(written.status, JSON.stringify(written.body)).toBe(200);
}

async function head(sessionId: string): Promise<string | null> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  return read.body.session.headTurnId as string | null;
}

/** Plays a turn with whatever else the body carries, and reads it back. */
async function play(
  sessionId: string,
  script: ScriptedReply[],
  extra: Record<string, unknown> = {},
): Promise<Turn> {
  provider.setScript(script);
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: uuidv7(),
      headTurnId: await head(sessionId),
      input: { kind: 'do', text: 'I wait by the bollard.' },
      ...extra,
    },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
  const stream = await server.stream({ url: submitted.body.stream as string });
  await stream.until(finished, TURN_FINISHES_MS);
  await stream.abort();
  const read = await server.request({
    method: 'GET',
    url: `/api/sessions/${sessionId}/turns/${submitted.body.turnId as string}`,
  });
  return read.body.turn as Turn;
}

function everything(request: RecordedRequest | undefined): string {
  return (request?.messages ?? []).map((message) => message.content).join('\n');
}

/** The narrator's call — the one that streamed the reply. */
function narration(turn: Turn): NonNullable<Turn['request']>['calls'][number] | undefined {
  return turn.request?.calls.find((call) => call.stepId === 'se.narrate');
}

const DIRECTION = 'A courier from the Guild arrives with a sealed letter for Vera.';
const NATURAL_FALLBACK = 'The scene has been standing still.';

describe('push story', () => {
  it('arms the director, whose direction fills the guidance slot and is on the record', async () => {
    const sessionId = await aScene();
    const turn = await play(sessionId, [{ text: DIRECTION }, { text: 'Vera breaks the seal.' }], {
      push: 'natural',
    });

    // The director's call came first and was its own: no scene prompt in it.
    expect(provider.requests).toHaveLength(2);
    expect(everything(provider.requests[0])).toContain('move it on');
    expect(everything(provider.requests[0])).toContain('I wait by the bollard.');
    // The narrator was handed the direction.
    expect(everything(provider.requests[1])).toContain(DIRECTION);

    const outcome = turn.steps?.find((step) => step.stepId === 'se.scene.direct');
    expect(outcome).toMatchObject({
      stage: 'pre',
      state: 'ok',
      direction: { push: 'natural', by: 'model', text: DIRECTION },
    });
    // Through the guidance slot, as a step's words — never the user's box.
    const block = narration(turn)?.blocks?.find((one) => one.id === 'se.guidance.direction');
    expect(block).toMatchObject({
      text: DIRECTION,
      included: true,
      advisory: true,
      source: { kind: 'guidance', producer: 'step' },
    });
  });

  it('falls back to the pack’s text for the flavour when the call fails, and says so', async () => {
    const sessionId = await aScene();
    const turn = await play(
      sessionId,
      [{ error: { class: 'terminal', message: 'the endpoint said no' } }, { text: 'Gulls.' }],
      { push: 'natural' },
    );

    const outcome = turn.steps?.find((step) => step.stepId === 'se.scene.direct');
    expect(outcome).toMatchObject({
      state: 'failed',
      failure: 'warn',
      direction: { push: 'natural', by: 'fallback' },
    });
    expect(outcome?.direction?.text).toContain(NATURAL_FALLBACK);
    // The turn went on, and the narrator was given the fixed text.
    expect(turn.status).toBe('complete');
    expect(everything(provider.requests.at(-1))).toContain(NATURAL_FALLBACK);
  });

  it('plans no director on a turn nobody pushed', async () => {
    const sessionId = await aScene();
    const turn = await play(sessionId, [{ text: 'Gulls.' }]);
    expect(provider.requests).toHaveLength(1);
    expect(turn.steps?.some((step) => step.stepId === 'se.scene.direct')).toBe(false);
  });

  it('is kept by a rewrite, which asks the director again', async () => {
    const sessionId = await aScene();
    const pushed = await play(sessionId, [{ text: DIRECTION }, { text: 'Vera reads.' }], {
      push: 'random',
    });
    const rewritten = await play(
      sessionId,
      [{ text: 'A fire starts on the quay.' }, { text: 'Smoke.' }],
      { rewriteOf: pushed.id, parentTurnId: pushed.parentTurnId },
    );
    expect(rewritten.steps?.find((step) => step.stepId === 'se.scene.direct')).toMatchObject({
      direction: { push: 'random', by: 'model', text: 'A fire starts on the quay.' },
    });
  });

  it('is kept by a guided redo that does not send it', async () => {
    const sessionId = await aScene();
    const pushed = await play(sessionId, [{ text: DIRECTION }, { text: 'Vera reads.' }], {
      push: 'random',
    });
    const redone = await play(
      sessionId,
      [{ text: 'A fire starts on the quay.' }, { text: 'Smoke.' }],
      { redoOf: pushed.id, guidance: 'Shorter.', parentTurnId: pushed.parentTurnId },
    );
    expect(redone.steps?.find((step) => step.stepId === 'se.scene.direct')).toMatchObject({
      direction: { push: 'random', by: 'model', text: 'A fire starts on the quay.' },
    });
  });

  it('refuses a flavour it does not know, and a push on a turn written by hand', async () => {
    const sessionId = await aScene();
    const unknown = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: uuidv7(),
        headTurnId: await head(sessionId),
        input: { kind: 'do', text: 'x' },
        push: 'chaos',
      },
    });
    expect(unknown.status).toBe(400);

    const edit = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: uuidv7(),
        headTurnId: await head(sessionId),
        authored: { messages: [{ speaker: null, text: 'Fog.' }] },
        push: 'natural',
      },
    });
    expect(edit.status).toBe(422);
    expect(edit.body.error).toBe('conflicting-gesture');
  });
});

const ARC = {
  description: 'The harbourmaster smuggles for the Guild, and Vera is his courier.',
  protagonistArc: 'Ned learns whom he can trust.',
  completed: false,
};

describe('the secret plot', () => {
  it('writes nothing and costs nothing while switched off', async () => {
    const sessionId = await aScene();
    const turn = await play(sessionId, [{ text: 'Gulls.' }]);
    expect(provider.requests).toHaveLength(1);
    expect(turn.effects.some((effect) => effect.channelId === 'se.plot.secret')).toBe(false);
  });

  it('is in the narrator’s prompt and not in the transcript, and shows only once revealed', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.plot.secret.on', true);
    const turn = await play(sessionId, [{ object: ARC }, { text: 'Vera glances at the ledger.' }]);

    // The pass came first, with a schema, and its arc is an effect on the turn.
    expect(provider.requests[0]?.schema).toBeDefined();
    expect(turn.effects.find((effect) => effect.channelId === 'se.plot.secret')).toMatchObject({
      applied: true,
      after: ARC,
      proposedBy: { kind: 'model' },
    });
    // The narrator was told, among the system blocks, and the transcript was not.
    const slot = narration(turn)?.blocks?.find((one) => one.id === 'se.plot.secret');
    expect(slot).toMatchObject({ included: true, role: 'system' });
    expect(slot?.text).toContain(ARC.description);
    expect(turn.output?.text).not.toContain(ARC.description);

    const surfaces = async (): Promise<{ channelId: string; kind: string; record?: unknown }[]> => {
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      return read.body.surfaces as { channelId: string; kind: string; record?: unknown }[];
    };
    // Hidden: no card, but the reveal is offered now the plot is on.
    expect((await surfaces()).some((one) => one.channelId === 'se.plot.secret')).toBe(false);
    expect(
      (await surfaces()).find((one) => one.channelId === 'se.plot.secret.reveal'),
    ).toMatchObject({ kind: 'toggle' });

    await put(sessionId, 'se.plot.secret.reveal', true);
    expect((await surfaces()).find((one) => one.channelId === 'se.plot.secret')).toMatchObject({
      kind: 'record',
      record: { value: ARC },
    });
  });

  it('is read by the director on the very turn the plot pass writes it', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.plot.secret.on', true);
    // No arc yet, so the pass runs first; the director, placed after it, must
    // read the arc just written rather than the empty plot the turn began with.
    await play(sessionId, [{ object: ARC }, { text: DIRECTION }, { text: 'Vera reads.' }], {
      push: 'natural',
    });
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[0]?.schema).toBeDefined();
    const director = provider.requests[1]?.messages ?? [];
    expect(director.some((message) => message.content.includes(ARC.description))).toBe(true);
    expect(everything(provider.requests[1])).toContain('secretly heading');
  });

  it('is read by the director, and silent in both prompts once switched off', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.plot.secret.on', true);
    await play(sessionId, [{ object: ARC }, { text: 'Gulls.' }]);

    // Not due (one story turn in, cadence four), so the director comes first.
    const before = provider.requests.length;
    await play(sessionId, [{ text: DIRECTION }, { text: 'Vera reads.' }], { push: 'natural' });
    expect(everything(provider.requests[before])).toContain(ARC.description);

    await put(sessionId, 'se.plot.secret.on', false);
    const after = provider.requests.length;
    const quiet = await play(sessionId, [{ text: DIRECTION }, { text: 'Fog.' }], {
      push: 'natural',
    });
    expect(everything(provider.requests[after])).not.toContain(ARC.description);
    expect(narration(quiet)?.blocks?.some((one) => one.id === 'se.plot.secret')).toBe(false);
  });
});
