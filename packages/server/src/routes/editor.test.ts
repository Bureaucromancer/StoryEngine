// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, uuidv7, type Turn } from '@storyengine/shared';

import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import {
  makeTestServer,
  settled,
  setUpAdmin,
  type SseFrame,
  type StreamHandle,
  type TestServer,
} from '../test-server.js';

/**
 * ***The editor and the echo chamber, through the server*** —
 * [P14 §1.9.4–§1.9.5](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14.5c]'s *ends at*: *"a banned word in a reply is edited out before the
 * turn is written, and the message offers the original; a continuity finding
 * applied from the checklist is a sibling."*
 *
 * Through the routes, because the switches are a person's channel writes, the
 * hold is what a watching client receives, and applying a finding is the edit
 * gesture. `modes/scene/src/edit.test.ts` holds the step to its own claims;
 * this holds the engine to its half — `StepDefinition.revises`, the text
 * replaced before commit, `original`, the outcome's record, and the hold.
 */

let server: TestServer;
let provider: FakeProvider;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a79';
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

/**
 * Plays a turn with a client already watching the session, and reads it back
 * with what that client was sent — the watcher attaches first, so every delta
 * the turn streamed reached it.
 */
async function play(
  sessionId: string,
  script: ScriptedReply[],
  body: Record<string, unknown> = { input: { kind: 'do', text: 'I sniff the air.' } },
): Promise<{ turn: Turn; streamed: string }> {
  provider.setScript(script);
  const watcher: StreamHandle = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
  await watcher.until((frame) => frame.event === 'snapshot');
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: uuidv7(), headTurnId: await head(sessionId), ...body },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
  await watcher.until(finished, TURN_FINISHES_MS);
  await watcher.abort();
  const streamed = watcher
    .frames()
    .filter((frame) => frame.event === 'delta')
    .map((frame) => (frame.data as { text: string }).text)
    .join('');
  const read = await server.request({
    method: 'GET',
    url: `/api/sessions/${sessionId}/turns/${submitted.body.turnId as string}`,
  });
  return { turn: read.body.turn as Turn, streamed };
}

/**
 * Plays a turn on its own turn's stream and reads it back — for a test that
 * plays several in a row, where a session watcher attached between turns could
 * read the last turn's finish as this one's.
 */
async function playTurn(
  sessionId: string,
  script: ScriptedReply[],
  body: Record<string, unknown> = { input: { kind: 'do', text: 'I wait.' } },
): Promise<Turn> {
  provider.setScript(script);
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: uuidv7(), headTurnId: await head(sessionId), ...body },
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

const RAW = 'The air smelled of ozone and old rope.';
const EDITED = 'The air smelled of rain and old rope.';
const EDIT = {
  editNeeded: true,
  editedText: EDITED,
  changes: [{ description: 'Removed the banned “ozone”.' }],
};

describe('the style editor', () => {
  it('edits a banned word out before the turn is written, and the message keeps the original', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.edit.style.on', true);
    const { turn, streamed } = await play(sessionId, [{ text: RAW, chunks: 4 }, { object: EDIT }]);

    // The turn's authored bytes are the edited ones.
    expect(turn.status).toBe('complete');
    expect(turn.output?.text).toBe(EDITED);
    expect(turn.output?.messages?.[0]).toMatchObject({ text: EDITED, original: RAW });
    // The editor's call was its own, asked with a schema, the banned word in its rules.
    const asked = provider.requests[1];
    expect(asked?.schema).toBeDefined();
    expect((asked?.messages ?? []).map((m) => m.content).join('\n')).toContain('ozone');
    // The outcome carries the changes.
    expect(turn.steps?.find((step) => step.stepId === 'se.scene.edit')).toMatchObject({
      state: 'ok',
      revisions: [{ index: 0, edited: true, changes: ['Removed the banned “ozone”.'] }],
    });
    // Held for the rewrite (the default): the watcher never read the banned word.
    expect(streamed).toBe(EDITED);
  });

  it('leaves an edited narrated reply text-only, the assistant’s line in the next prompt', async () => {
    const sessionId = await aScene();
    const narrated = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/chat`,
      payload: { voice: 'narrator' },
    });
    expect(narrated.status, JSON.stringify(narrated.body)).toBe(200);
    await put(sessionId, 'se.edit.style.on', true);
    const { turn: edited } = await play(sessionId, [{ text: RAW }, { object: EDIT }]);
    // Text-only, the original beside it — given `messages`, a lone narrator
    // message would be a `system` line in every later prompt.
    expect(edited.output?.text).toBe(EDITED);
    expect(edited.output?.messages).toBeUndefined();
    expect(edited.output?.original).toBe(RAW);
    const next = await playTurn(sessionId, [
      { text: 'Gulls.' },
      { object: { editNeeded: false, editedText: '', changes: [] } },
    ]);
    const narrate = next.request?.calls.find((call) => call.stepId === 'se.narrate');
    const fromEdited = (narrate?.blocks ?? []).filter(
      (block) =>
        block.source.kind === 'history' &&
        (block.source as { turnId?: string; part?: string }).turnId === edited.id &&
        (block.source as { part?: string }).part === 'output',
    );
    expect(fromEdited).toHaveLength(1);
    expect(fromEdited[0]).toMatchObject({ role: 'assistant', text: EDITED });
  });

  it('streams as it comes when the hold is off, and still commits the edit', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.edit.style.on', true);
    await put(sessionId, 'se.edit.hold', false);
    const { turn, streamed } = await play(sessionId, [{ text: RAW, chunks: 4 }, { object: EDIT }]);
    expect(streamed).toBe(RAW);
    expect(turn.output?.text).toBe(EDITED);
  });

  it('lets the round through unedited when the editor fails, and says so', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.edit.style.on', true);
    const { turn, streamed } = await play(sessionId, [
      { text: RAW, chunks: 4 },
      { error: { class: 'terminal', message: 'the endpoint said no' } },
    ]);
    expect(turn.status).toBe('complete');
    expect(turn.output?.text).toBe(RAW);
    expect(turn.output?.messages?.[0]?.original).toBeUndefined();
    expect(turn.steps?.find((step) => step.stepId === 'se.scene.edit')).toMatchObject({
      state: 'failed',
      failure: 'warn',
    });
    // Released after the failure, whole.
    expect(streamed).toBe(RAW);
  });

  it('edits each message of a round on its own, and releases the round by message', async () => {
    const ned = await anActor('Ned');
    const vera = await anActor('Vera');
    const marlow = await anActor('Marlow');
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Quay', cast: { persona: ned, actors: [vera, marlow] } },
    });
    const sessionId = created.body.session.id as string;
    await put(sessionId, 'se.edit.style.on', true);
    const { turn, streamed } = await play(
      sessionId,
      [
        { text: '"Late again."', chunks: 2 },
        { text: '"Ozone on the wind."', chunks: 2 },
        { object: { editNeeded: false, editedText: '', changes: [] } },
        { object: { editNeeded: true, editedText: '"Rain on the wind."', changes: [] } },
      ],
      { input: { kind: 'do', text: 'I nod.' }, speakers: [vera, marlow] },
    );
    // Two speaking calls, then one editor call per message, in order.
    expect(provider.requests).toHaveLength(4);
    expect(turn.output?.messages?.map((m) => [m.speaker?.name, m.text, m.original])).toEqual([
      ['Vera', '"Late again."', undefined],
      ['Marlow', '"Rain on the wind."', '"Ozone on the wind."'],
    ]);
    expect(streamed).toBe(turn.output?.text);
    expect(streamed).not.toContain('Ozone');
  });

  it('leaves a continued message alone, its opening already an earlier turn’s', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.edit.style.on', true);
    const first = await playTurn(sessionId, [{ text: RAW }, { object: EDIT }]);
    expect(first.output?.text).toBe(EDITED);

    const before = provider.requests.length;
    const continued = await playTurn(sessionId, [{ text: 'Then the gulls came.' }], {
      continueOf: first.id,
    });
    // One call, the continue's: the editor was not asked about the message.
    expect(provider.requests.length - before).toBe(1);
    expect(continued.status).toBe('complete');
    expect(continued.output?.text).toBe(`${EDITED} Then the gulls came.`);
    expect(continued.steps?.find((step) => step.stepId === 'se.scene.edit')).toMatchObject({
      state: 'ok',
    });
    expect(
      continued.steps?.find((step) => step.stepId === 'se.scene.edit')?.revisions,
    ).toBeUndefined();
  });

  it('makes no call and holds nothing while switched off', async () => {
    const sessionId = await aScene();
    const { turn, streamed } = await play(sessionId, [{ text: RAW, chunks: 4 }]);
    expect(provider.requests).toHaveLength(1);
    expect(turn.output?.text).toBe(RAW);
    expect(streamed).toBe(RAW);
  });
});

describe('continuity', () => {
  it('lists a finding on its message, and applying it is an authored sibling', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.edit.continuity.on', true);
    const said = 'Vera lit the lamp with her left hand.';
    const { turn } = await play(sessionId, [
      { text: said },
      {
        object: {
          editNeeded: false,
          editedText: '',
          changes: [],
          issues: [
            {
              issue: 'Vera’s left arm is in a sling.',
              quote: 'her left hand',
              fix: 'her right hand',
            },
          ],
        },
      },
    ]);
    // A notice, not an effect: the reply is as the model wrote it.
    expect(turn.output?.text).toBe(said);
    const finding = turn.steps?.find((step) => step.stepId === 'se.scene.edit')?.revisions?.[0];
    expect(finding).toEqual({
      index: 0,
      notices: [
        { issue: 'Vera’s left arm is in a sling.', quote: 'her left hand', fix: 'her right hand' },
      ],
    });

    // Applied from the checklist — the client's edit gesture with the one substitution.
    const notice = finding?.notices?.[0];
    const fixed = said.replace(notice?.quote ?? '', notice?.fix ?? '');
    const applied = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: uuidv7(),
        headTurnId: turn.id,
        editOf: turn.id,
        parentTurnId: turn.parentTurnId,
        authored: {
          messages: (turn.output?.messages ?? [{ speaker: null, text: said }]).map((m) => ({
            speaker: m.speaker?.id ?? null,
            text: fixed,
          })),
        },
      },
    });
    expect(applied.status, JSON.stringify(applied.body)).toBe(202);
    await settled(server);
    const sibling = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns/${applied.body.turnId as string}`,
    });
    expect(sibling.body.turn.parentTurnId).toBe(turn.parentTurnId);
    expect(sibling.body.turn.output.text).toBe('Vera lit the lamp with her right hand.');
    // The original stays on the tree.
    const original = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns/${turn.id}`,
    });
    expect(original.body.turn.output.text).toBe(said);
  });

  it('fixes the reply itself under apply, and lists nothing', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.edit.continuity.on', true);
    await put(sessionId, 'se.edit.continuity.apply', true);
    const { turn } = await play(sessionId, [
      { text: 'Vera lit the lamp with her left hand.' },
      {
        object: {
          editNeeded: true,
          editedText: 'Vera lit the lamp with her right hand.',
          changes: [{ description: 'Her left arm is in a sling.' }],
        },
      },
    ]);
    expect(turn.output?.text).toBe('Vera lit the lamp with her right hand.');
    const record = turn.steps?.find((step) => step.stepId === 'se.scene.edit')?.revisions;
    expect(record).toEqual([{ index: 0, edited: true, changes: ['Her left arm is in a sling.'] }]);
  });
});

describe('the echo chamber', () => {
  it('writes its reactions to its own channel and to no prompt', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.echo.on', true);
    const { turn } = await play(sessionId, [
      { text: 'The harbourmaster flinched.' },
      { object: { reactions: [{ characterName: 'Vera', reaction: 'About time.' }] } },
    ]);
    expect(turn.effects.find((effect) => effect.channelId === 'se.echo')).toMatchObject({
      applied: true,
      after: [{ name: 'Vera', value: 'About time.' }],
    });

    // The next narration is not told what the chorus said.
    await play(sessionId, [{ text: 'Gulls.' }, { object: { reactions: [] } }]);
    const narration = provider.requests.at(-2);
    expect((narration?.messages ?? []).map((m) => m.content).join('\n')).not.toContain(
      'About time.',
    );
    // And the panel shows it.
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const surfaces = read.body.surfaces as { channelId: string; kind: string }[];
    expect(surfaces.find((one) => one.channelId === 'se.echo')).toMatchObject({ kind: 'record' });
  });

  it('clears its panel on an empty answer, and writes nothing for a repeated one', async () => {
    const sessionId = await aScene();
    await put(sessionId, 'se.echo.on', true);
    const said = { reactions: [{ characterName: 'Vera', reaction: 'About time.' }] };
    const first = await playTurn(sessionId, [
      { text: 'The harbourmaster flinched.' },
      { object: said },
    ]);
    expect(first.effects.some((effect) => effect.channelId === 'se.echo')).toBe(true);

    // The same reactions again: the panel already holds them.
    const again = await playTurn(sessionId, [{ text: 'He flinched again.' }, { object: said }]);
    expect(again.effects.some((effect) => effect.channelId === 'se.echo')).toBe(false);

    // Nothing to say: the panel is emptied, not left holding the last turn's.
    const quiet = await playTurn(sessionId, [{ text: 'Gulls.' }, { object: { reactions: [] } }]);
    expect(quiet.effects.find((effect) => effect.channelId === 'se.echo')).toMatchObject({
      applied: true,
      after: [],
    });
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const surfaces = read.body.surfaces as { channelId: string; record?: { value?: unknown } }[];
    expect(surfaces.find((one) => one.channelId === 'se.echo')?.record?.value).toEqual([]);
  });
});
