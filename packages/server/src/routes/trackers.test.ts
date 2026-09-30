// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, uuidv7, type Turn } from '@storyengine/shared';

import { FakeProvider, type RecordedRequest, type ScriptedReply } from '../providers/fake.js';
import { isStoryTurn } from '../sessions/depth.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type SseFrame, type TestServer } from '../test-server.js';

/**
 * ***Scene's trackers, through the server*** —
 * [P13 §1.9.2](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13.5a]'s *ends at*: *"with world, character and inventory switched on, a
 * turn whose prose moves a character to the docks and hands the player a key
 * proposes all three; a locked location stays put; a swipe of that turn has
 * its own tracker state; the next prompt shows the established state once."*
 * And the two that make the feature usable: **manual mode** and **Update
 * trackers**, the on-demand engine turn.
 *
 * *Through the routes rather than the runner*, because every switch, lock and
 * edit is a person's write through `PUT /sessions/:id/channels/:key` — the
 * scoped key for a character's tracker among them — and the route is what the
 * tracker panel will call. `tracking.test.ts` holds the step to its own claims;
 * this holds the engine to its half: the effect on the turn, the state block,
 * the tree.
 */

let server: TestServer;
let provider: FakeProvider;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a77';
const TURN_FINISHES_MS = 8_000;
const STATE_HEADING = 'What the story has established';

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

/** A Scene chat: Ned is the player, Vera the one member who answers. */
async function aScene(): Promise<{ sessionId: string; vera: string }> {
  const ned = await anActor('Ned');
  const vera = await anActor('Vera');
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Harbour', cast: { persona: ned, actors: [vera] } },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return { sessionId: created.body.session.id as string, vera };
}

/** A person's write to one channel — the tracker panel's only verb. */
async function put(sessionId: string, key: string, value: unknown): Promise<any> {
  const written = await server.request({
    method: 'PUT',
    url: `/api/sessions/${sessionId}/channels/${encodeURIComponent(key)}`,
    payload: { value },
  });
  expect(written.status, JSON.stringify(written.body)).toBe(200);
  return written.body;
}

async function switchOn(sessionId: string, ...trackers: string[]): Promise<void> {
  for (const tracker of trackers) await put(sessionId, `se.track.${tracker}.on`, true);
}

async function channels(sessionId: string): Promise<Record<string, { value: unknown }>> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  return read.body.session.channels as Record<string, { value: unknown }>;
}

async function head(sessionId: string): Promise<string | null> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  return read.body.session.headTurnId as string | null;
}

/** Plays a turn — from the head, or as a sibling from `parentTurnId` — and reads it back. */
async function play(
  sessionId: string,
  text: string,
  script: ScriptedReply[],
  parentTurnId?: string | null,
): Promise<Turn> {
  provider.setScript(script);
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: uuidv7(),
      headTurnId: await head(sessionId),
      input: { kind: 'do', text },
      ...(parentTurnId === undefined ? {} : { parentTurnId }),
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

/** The requests that asked for a tracker answer — the only ones with a schema here. */
function trackerCalls(): RecordedRequest[] {
  return provider.requests.filter((request) => request.schema !== undefined);
}

function everything(request: RecordedRequest | undefined): string {
  return (request?.messages ?? []).map((message) => message.content).join('\n');
}

const TO_THE_DOCKS =
  'Vera led the way down to the docks and pressed a cold iron key into your palm.';
const MOVED = {
  world: { location: 'the docks', weather: 'fog' },
  characters: { Vera: { mood: 'wary' } },
  inventory: { inventory: [{ name: 'iron key', qty: 1 }] },
};

describe('a turn with trackers on', () => {
  it('proposes world, character and inventory in one call, each an effect on the turn', async () => {
    const { sessionId, vera } = await aScene();
    await switchOn(sessionId, 'world', 'character', 'inventory');

    const turn = await play(sessionId, 'I follow her.', [
      { text: TO_THE_DOCKS },
      { object: MOVED },
    ]);

    // One call for three trackers, whose schema is theirs side by side.
    expect(trackerCalls()).toHaveLength(1);
    expect(Object.keys((trackerCalls()[0]?.schema as { properties: object }).properties)).toEqual([
      'world',
      'characters',
      'inventory',
    ]);
    // The call's own candidates saw the turn's prose, not the scene prompt.
    expect(everything(trackerCalls()[0])).toContain(TO_THE_DOCKS);

    const tracked = turn.effects.filter((effect) => effect.channelId.startsWith('se.track.'));
    expect(tracked.map((effect) => [effect.channelId, effect.scopeKey, effect.applied])).toEqual([
      ['se.track.world', null, true],
      ['se.track.character', vera, true],
      ['se.track.inventory', null, true],
    ]);
    expect(turn.steps?.find((step) => step.stepId === 'se.scene.track')).toMatchObject({
      state: 'ok',
      contributed: { effects: 3 },
    });

    const now = await channels(sessionId);
    expect(now['se.track.world']?.value).toMatchObject({ location: 'the docks' });
    expect(now[`se.track.character#${vera}`]?.value).toMatchObject({ mood: 'wary' });
    expect(now['se.track.inventory']?.value).toMatchObject({
      inventory: [{ name: 'iron key', qty: 1 }],
    });
  });

  it('makes no tracker call while every tracker is off', async () => {
    const { sessionId } = await aScene();
    const turn = await play(sessionId, 'I follow her.', [{ text: TO_THE_DOCKS }]);
    expect(trackerCalls()).toHaveLength(0);
    expect(turn.effects.some((effect) => effect.channelId.startsWith('se.track.'))).toBe(false);
  });

  it('keeps a locked location where it was, and lets the rest land', async () => {
    const { sessionId } = await aScene();
    await switchOn(sessionId, 'world');
    const office = 'the harbourmaster’s office';
    await put(sessionId, 'se.track.world', {
      date: '',
      time: '',
      location: office,
      weather: '',
      temperature: '',
      fields: [],
      recent: [],
    });
    await put(sessionId, 'se.track.locks', ['se.track.world/location']);

    await play(sessionId, 'I follow her.', [
      { text: TO_THE_DOCKS },
      { object: { world: MOVED.world } },
    ]);

    expect((await channels(sessionId))['se.track.world']?.value).toMatchObject({
      location: office,
      weather: 'fog',
    });
  });

  it('edits a character’s tracker through the scoped key', async () => {
    // `#` in a key is URL-encoded like any other id; the route splits it back
    // into the channel and the actor, and the write is a person's effect.
    const { sessionId, vera } = await aScene();
    const written = await put(sessionId, `se.track.character#${vera}`, {
      mood: 'amused',
      appearance: '',
      outfit: '',
      thoughts: 'He is late again.',
      fields: { holding: 'a ledger' },
      stats: [{ name: 'Patience', value: 3, max: 10 }],
    });
    expect(written.effect).toMatchObject({
      channelId: 'se.track.character',
      scopeKey: vera,
      applied: true,
      proposedBy: { kind: 'user' },
    });
  });
});

describe('a muted member', () => {
  /**
   * ***Out of the room is out of the trackers*** (2026-09-29, the review). The
   * panel closes a muted member's card; the step and the state block read
   * presence the same way, so no call is spent on them and no prompt carries
   * them — and their value waits on the tree for when they are back.
   */
  it('is left out of the tracker call and the state block, and keeps their value', async () => {
    const ned = await anActor('Ned');
    const vera = await anActor('Vera');
    const oskar = await anActor('Oskar');
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Harbour', cast: { persona: ned, actors: [vera, oskar] } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const sessionId = created.body.session.id as string;
    await switchOn(sessionId, 'world', 'character');

    await play(sessionId, 'I follow them.', [
      { text: TO_THE_DOCKS },
      { object: { characters: { Vera: { mood: 'wary' }, Oskar: { mood: 'loud' } } } },
    ]);
    const asked = (request: RecordedRequest | undefined): string[] =>
      Object.keys(
        (request?.schema as { properties: { characters: { properties: object } } }).properties
          .characters.properties,
      );
    expect(asked(trackerCalls()[0])).toEqual(['Vera', 'Oskar']);

    await put(sessionId, `se.presence#${vera}`, false);
    const before = provider.requests.length;
    await play(sessionId, 'I look around.', [
      { text: 'Gulls.' },
      { object: { world: { location: 'the quay' } } },
    ]);
    const after = provider.requests.slice(before);
    const call = after.find((one) => one.schema !== undefined);
    expect(asked(call)).toEqual(['Oskar']);
    const shown = (call?.messages ?? []).find((one) => one.content.includes('tracked state now'));
    expect(shown?.content).toContain('Oskar');
    expect(shown?.content).not.toContain('Vera');

    const sent = everything(after.find((one) => one.schema === undefined));
    expect(sent).toContain(STATE_HEADING);
    expect(sent).toContain('— Oskar');
    expect(sent).not.toContain('— Vera');

    expect((await channels(sessionId))[`se.track.character#${vera}`]?.value).toMatchObject({
      mood: 'wary',
    });
  });
});

describe('the tree', () => {
  /** ***P13.5a's third claim***: *"a swipe of that turn has its own tracker state"*. */
  it('gives a swipe its own tracker state, and the next prompt the state of its line', async () => {
    const { sessionId } = await aScene();
    await switchOn(sessionId, 'world');
    const parent = await head(sessionId);

    const docks = await play(sessionId, 'I follow her.', [
      { text: TO_THE_DOCKS },
      { object: { world: { location: 'the docks' } } },
    ]);
    const chapel = await play(
      sessionId,
      'I follow her.',
      [
        { text: 'Vera slipped into the chapel.' },
        { object: { world: { location: 'the chapel' } } },
      ],
      parent,
    );
    expect(chapel.parentTurnId).toBe(docks.parentTurnId);
    expect((await channels(sessionId))['se.track.world']?.value).toMatchObject({
      location: 'the chapel',
    });

    // Back to the first swipe: its own state, because the state is its effects.
    const moved = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/head`,
      payload: { turnId: docks.id },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await channels(sessionId))['se.track.world']?.value).toMatchObject({
      location: 'the docks',
    });

    /** ***And the fourth***: *"the next prompt shows the established state once"*. */
    const before = provider.requests.length;
    await play(sessionId, 'I look around.', [{ text: 'Gulls.' }, { object: {} }]);
    const narration = provider.requests.slice(before).find((one) => one.schema === undefined);
    const sent = everything(narration);
    expect(sent.split(STATE_HEADING)).toHaveLength(2);
    expect(sent).toContain('Location: the docks');
    expect(sent).not.toContain('the chapel');
    // Placed straight before the move it precedes: the last user message
    // carries the state, then the player's words.
    const last = narration?.messages.at(-1);
    expect(last?.role).toBe('user');
    expect(last?.content.indexOf(STATE_HEADING)).toBeLessThan(
      last?.content.indexOf('I look around.') ?? -1,
    );
  });

  it('says nothing in the prompt about a tracker that has been switched off', async () => {
    const { sessionId } = await aScene();
    await switchOn(sessionId, 'world');
    await play(sessionId, 'I follow her.', [
      { text: TO_THE_DOCKS },
      { object: { world: { location: 'the docks' } } },
    ]);
    await put(sessionId, 'se.track.world.on', false);

    const before = provider.requests.length;
    await play(sessionId, 'I look around.', [{ text: 'Gulls.' }]);
    expect(everything(provider.requests.at(before))).not.toContain(STATE_HEADING);
  });
});

describe('manual mode, and Update trackers', () => {
  async function run(sessionId: string, stepId = 'se.scene.track'): Promise<any> {
    return server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/steps/${stepId}/run`,
    });
  }

  it('runs no tracker on a turn in manual mode, and writes an engine turn when asked', async () => {
    const { sessionId } = await aScene();
    await switchOn(sessionId, 'world', 'inventory');
    await put(sessionId, 'se.track.cadence', { everyNTurns: 1, manual: true });

    const turn = await play(sessionId, 'I follow her.', [{ text: TO_THE_DOCKS }]);
    expect(trackerCalls()).toHaveLength(0);
    expect(turn.steps?.find((step) => step.stepId === 'se.scene.track')?.contributed).toEqual({
      blocks: 0,
      effects: 0,
    });

    provider.setScript([{ object: { world: MOVED.world, inventory: MOVED.inventory } }]);
    const updated = await run(sessionId);
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const engine = updated.body.turn as Turn;

    // What the step saw is the last story turn — its move and its reply.
    expect(everything(trackerCalls()[0])).toContain(TO_THE_DOCKS);
    // A child of the head, carrying the call and the effects — and not a story
    // turn, so it is no transcript row and moves no cadence.
    expect(engine.parentTurnId).toBe(turn.id);
    expect(engine.request?.calls.map((call) => call.stepId)).toEqual(['se.scene.track']);
    expect(engine.steps).toBeUndefined();
    expect(isStoryTurn(engine)).toBe(false);
    expect(engine.effects.map((effect) => [effect.channelId, effect.applied])).toEqual([
      ['se.track.world', true],
      ['se.track.inventory', true],
    ]);
    expect(await head(sessionId)).toBe(engine.id);
    expect((await channels(sessionId))['se.track.world']?.value).toMatchObject({
      location: 'the docks',
    });

    // Undoable like any channel edit: the ordinary undo inverts it.
    const undone = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/${engine.id}/undo`,
    });
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    // Never set before the update, so the inverse is a delete: the tracker
    // reads its declared empty value again.
    expect((await channels(sessionId))['se.track.world']).toBeUndefined();
  });

  it('answers a run with nothing to do as a turnless 200, making no call', async () => {
    const { sessionId } = await aScene();
    await play(sessionId, 'I follow her.', [{ text: TO_THE_DOCKS }]);
    const before = await head(sessionId);
    const updated = await run(sessionId);
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ turn: null, callId: null });
    expect(trackerCalls()).toHaveLength(0);
    expect(await head(sessionId)).toBe(before);
  });

  it('runs only a step the mode declares on-demand', async () => {
    const { sessionId } = await aScene();
    for (const stepId of ['se.narrate', 'se.scene.stage', 'no.such.step']) {
      const refused = await run(sessionId, stepId);
      expect(refused.status, stepId).toBe(404);
      expect(refused.body.error).toBe('no-such-step');
    }
  });
});

/**
 * ***What the tracker panel reads*** — the client half of [P13.5a]. The panel
 * knows no tracker: it draws the `record` surfaces the session read hands it,
 * and offers the actions it lists. So the claims are about that read — a card
 * only for a tracker that is on, a character card per present member but the
 * persona, the locks and hidden fields beside the value, and *Update trackers*
 * only while it has something to update.
 */
describe('what the tracker panel reads', () => {
  interface Surface {
    region: string;
    key: string;
    channelId: string;
    scopeKey: string | null;
    kind: string;
    group?: string;
    on?: boolean;
    record?: {
      value: unknown;
      fields: { key: string; show: string }[];
      locks: { key: string; paths: string[] } | null;
      hidden: { key: string; paths: string[] } | null;
    };
  }

  async function read(sessionId: string): Promise<{ surfaces: Surface[]; actions: unknown[] }> {
    const got = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(got.status).toBe(200);
    return got.body as { surfaces: Surface[]; actions: unknown[] };
  }

  it('shows no card and offers no update while every tracker is off, and the switches in settings', async () => {
    const { sessionId } = await aScene();
    const { surfaces, actions } = await read(sessionId);
    expect(surfaces.filter((one) => one.kind === 'record' && one.region === 'panel')).toEqual([]);
    expect(actions).toEqual([]);
    // The trackers' six — the secret plot's switch beside them is [P13.5b]'s.
    const switches = surfaces.filter(
      (one) =>
        one.region === 'settings' && one.kind === 'toggle' && one.channelId.startsWith('se.track.'),
    );
    expect(switches).toHaveLength(6);
    for (const one of switches) {
      expect(one.group).toBe('Agents');
      expect(one.on).toBe(false);
    }
    // The cadence is a card of its own among them, whatever is on.
    expect(surfaces.find((one) => one.channelId === 'se.track.cadence')?.record?.value).toEqual({
      everyNTurns: 1,
      manual: false,
    });
  });

  it('draws a card per tracker that is on, with its locks and hidden fields', async () => {
    const { sessionId } = await aScene();
    await switchOn(sessionId, 'world', 'quests');
    await put(sessionId, 'se.track.locks', ['se.track.world/location']);
    await put(sessionId, 'se.track.hidden', ['se.track.world/weather']);

    const { surfaces, actions } = await read(sessionId);
    const cards = surfaces.filter((one) => one.region === 'panel' && one.kind === 'record');
    expect(cards.map((one) => one.channelId)).toEqual(['se.track.world', 'se.track.quests']);
    const world = cards[0]?.record;
    expect(world?.value).toMatchObject({ location: '', recent: [] });
    expect(world?.locks).toEqual({ key: 'se.track.locks', paths: ['se.track.world/location'] });
    expect(world?.hidden).toEqual({ key: 'se.track.hidden', paths: ['se.track.world/weather'] });
    expect(cards[1]?.record?.fields).toEqual([{ key: '', label: 'Quests', show: 'checklists' }]);
    expect(actions).toEqual([{ stepId: 'se.scene.track', label: 'Update trackers' }]);
  });

  it('draws a character card for each present member but the player, before the tracker reaches them', async () => {
    const { sessionId, vera } = await aScene();
    await switchOn(sessionId, 'character', 'persona');
    const { surfaces } = await read(sessionId);
    const characters = surfaces.filter((one) => one.channelId === 'se.track.character');
    expect(characters.map((one) => [one.key, one.scopeKey])).toEqual([
      [`se.track.character#${vera}`, vera],
    ]);
    expect(characters[0]?.record?.value).toMatchObject({ mood: '', stats: [] });
    // The player's own card is the persona tracker, unscoped.
    expect(surfaces.filter((one) => one.channelId === 'se.track.persona')).toHaveLength(1);

    // Muted, she leaves the room and her card closes; her value stays on the tree.
    await put(sessionId, `se.presence#${vera}`, false);
    const after = await read(sessionId);
    expect(after.surfaces.filter((one) => one.channelId === 'se.track.character')).toEqual([]);
  });
});
