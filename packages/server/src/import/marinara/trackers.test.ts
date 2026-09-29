// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChannelEffect, ImportItemReport, Turn } from '@storyengine/shared';

import { installBuiltIns } from '../../mode-loader.js';
import { channelDefinition, channelKey } from '../../sessions/channels.js';
import { schemaFailure } from '../../sessions/channel-schema.js';
import { exportSession } from '../../sessions/export.js';
import { SE_PRESENCE } from '../../sessions/cast.js';
import { applyEffects } from '../../sessions/store.js';
import type { SessionFile } from '../../sessions/types.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import type { ChatStateValue } from '../chat/types.js';
import { marinaraFixture } from '../fixtures/test-marinara.js';
import { MemoryFileSource } from '../memory-source.js';
import { sweep } from '../sweep.js';
import { SCENE_TRACKERS, snapshotStates, trackerSwitches, unreadKeys } from './trackers.js';

/**
 * ***Marinara's trackers, imported*** — [P13 §2.6]'s second table, built at
 * [P13.5a]. Three claims, each with the mutation that would falsify it:
 *
 * 1. **The spellings are Scene's.** `trackers.ts` spells the channel ids,
 *    versions and empty values rather than importing them (the SDK boundary),
 *    so they are pinned here to what the registry holds — and every value it
 *    builds is one the registered schema admits, or the session would
 *    quarantine what the import wrote.
 * 2. **A snapshot is effects on the turn holding its message's swipe**, only
 *    where it moves the state along that path, `proposedBy: engine`, applied,
 *    and the head cache agrees with the replay — so opening the session writes
 *    no hand-edit effect.
 * 3. **The locks and switches come across**: Marinara's lock keys as field
 *    paths (a character's by the actor it resolved to), `activeAgentIds` as the
 *    switches and `manualTrackers` as the cadence's `manual`.
 */

describe('the spellings', () => {
  it('names each channel as the registry declares it, version and empty value too', async () => {
    await installBuiltIns();
    for (const [name, spelled] of Object.entries(SCENE_TRACKERS)) {
      const definition = channelDefinition(spelled.id);
      expect(definition, name).not.toBeNull();
      expect(definition?.version, name).toBe(spelled.version);
      expect(definition?.init, name).toEqual({ kind: 'literal', value: spelled.init });
    }
    for (const tracker of ['world', 'character', 'persona', 'quests', 'inventory', 'custom']) {
      expect(channelDefinition(`se.track.${tracker}.on`)?.schema).toEqual({ type: 'boolean' });
    }
  });
});

/** Every value a set of state values carries, checked against its registered schema. */
function admitted(values: readonly ChatStateValue[]): void {
  for (const one of values) {
    const failure = schemaFailure(channelDefinition(one.channelId), one.value);
    expect(failure, `${one.channelId}: ${JSON.stringify(one.value)}`).toBeNull();
  }
}

describe('a snapshot, read', () => {
  const row = {
    id: 'gs_1',
    chatId: 'c1',
    messageId: 'm1',
    swipeIndex: 0,
    date: 'Day 3',
    time: 'Dusk',
    location: 'The mill',
    weather: null,
    temperature: '4°C',
    worldCustomFields: JSON.stringify([{ name: 'Tide', value: 'low', icon: 'waves' }]),
    presentCharacters: JSON.stringify([
      {
        characterId: 'char_vera',
        name: 'Vera',
        emoji: '⚓',
        mood: 'x'.repeat(900),
        appearance: null,
        outfit: 'Oilskin',
        customFields: { holding: 'a lamp' },
        stats: [{ name: 'Nerve', value: 3, max: 5, color: 'red' }],
        thoughts: null,
      },
    ]),
    recentEvents: JSON.stringify(Array.from({ length: 14 }, (_, at) => `event ${String(at)}`)),
    playerStats: JSON.stringify({
      stats: [{ name: 'Old bar', value: 1, max: 2 }],
      inventory: [
        { name: 'Rope', quantity: 2, description: '', location: 'on_person' },
        { name: 'Key', quantity: 1, description: '', location: 'on_person' },
      ],
      activeQuests: [
        {
          questEntryId: 'q_1',
          name: 'The mill',
          currentStage: 2,
          objectives: [
            { text: 'Find the miller', completed: true },
            { text: 'Ask about the grain', completed: false },
          ],
          completed: false,
        },
      ],
      status: 'Tired',
      customTrackerFields: [{ name: 'Suspicion', value: '2' }],
      inventoryTrackerCurrencies: [{ name: 'Crowns', qty: 12 }],
      inventoryTrackerEquipped: [],
      inventoryTrackerInventory: [{ name: 'Key' }],
    }),
    personaStats: JSON.stringify([{ name: 'Satiety', value: 60, max: 100, color: 'green' }]),
    fieldLocks: JSON.stringify({
      'world.location': true,
      'world.custom.name:Tide.value': true,
      'persona.stats.name:Satiety.value': true,
      'player.inventoryTracker.currencies.name:Crowns.qty': true,
      'player.inventory.index:0.quantity': true,
      'player.custom.name:Suspicion.value': true,
      'quests.id:q_1.name': true,
      'quests.id:q_1.completed': true,
      'quests.id:q_1.currentStage': true,
      'quests.id:q_1.objectives.text:Ask%20about%20the%20grain.completed': true,
      'characters.id:char_vera.mood': true,
      'characters.name:Vera.stats.name:Nerve.value': true,
      'characters.id:char_vera.custom.holding.value': true,
      'characters.id:char_vera.emoji': true,
      'quests.index:9.name': true,
      'world.date': false,
    }),
    hiddenTrackerFields: JSON.stringify({ 'characters.id:char_vera.thoughts': true }),
    committed: 1,
    createdAt: '2026-08-02T21:00:00.000Z',
  };

  function values(): ChatStateValue[] {
    const read = snapshotStates([row]).get('m1')?.get(0);
    if (read === undefined) throw new Error('no state');
    return read;
  }
  const value = (channelId: string): unknown =>
    values().find((one) => one.channelId === channelId)?.value;

  it('reads each tracker in its channel’s shape, clipped to what the channel takes', async () => {
    await installBuiltIns();
    admitted(values());

    expect(value('se.track.world')).toEqual({
      date: 'Day 3',
      time: 'Dusk',
      location: 'The mill',
      weather: '',
      temperature: '4°C',
      fields: [{ name: 'Tide', value: 'low' }],
      recent: Array.from({ length: 10 }, (_, at) => `event ${String(at + 4)}`),
    });
    const vera = values().find((one) => one.channelId === 'se.track.character');
    expect(vera?.member).toEqual({ key: 'char_vera', name: 'Vera' });
    expect(vera?.value).toMatchObject({
      mood: 'x'.repeat(500),
      appearance: '',
      outfit: 'Oilskin',
      fields: { holding: 'a lamp' },
      stats: [{ name: 'Nerve', value: 3, max: 5, color: 'red' }],
    });
    // The persona-stats agent's bars, not the older player bars.
    expect(value('se.track.persona')).toEqual({
      status: 'Tired',
      stats: [{ name: 'Satiety', value: 60, max: 100, color: 'green' }],
    });
    // No stage: an index into a quest's stages that did not come across.
    expect(value('se.track.quests')).toEqual([
      {
        name: 'The mill',
        objectives: [
          { text: 'Find the miller', completed: true },
          { text: 'Ask about the grain', completed: false },
        ],
        completed: false,
      },
    ]);
    // One place a thing can be: persona-stats' items fold into carrying, by name.
    expect(value('se.track.inventory')).toEqual({
      currencies: [{ name: 'Crowns', qty: 12 }],
      equipped: [],
      inventory: [{ name: 'Key' }, { name: 'Rope', qty: 2 }],
    });
    expect(value('se.track.custom')).toEqual([{ name: 'Suspicion', value: '2' }]);
  });

  it('reads Marinara’s lock keys as field paths, a character’s by their source key', () => {
    expect(value('se.track.locks')).toEqual([
      'se.track.world/location',
      'se.track.world/fields/Tide',
      'se.track.persona/stats/Satiety',
      'se.track.inventory/currencies/Crowns',
      'se.track.inventory/inventory/Rope',
      'se.track.custom/Suspicion',
      'se.track.quests/The mill',
      // A quest's `completed` lock stays on `completed`: a lock on the row
      // would freeze the objectives nested in it, which Marinara let move.
      'se.track.quests/The mill/completed',
      'se.track.quests/The mill/objectives/Ask about the grain',
      'se.track.character#char_vera/mood',
      'se.track.character#char_vera/stats/Nerve',
      'se.track.character#char_vera/fields/holding',
    ]);
    expect(values().find((one) => one.channelId === 'se.track.locks')?.paths).toBe(true);
    expect(value('se.track.hidden')).toEqual(['se.track.character#char_vera/thoughts']);
    // The emoji and the stage number are not kept, and the ninth quest does not exist.
    expect(unreadKeys([row])).toBe(3);
  });

  it('keeps the latest snapshot of a swipe, as Marinara shows it', () => {
    const older = {
      ...row,
      id: 'gs_0',
      location: 'The ford',
      createdAt: '2026-08-02T20:00:00.000Z',
    };
    const [first] = [snapshotStates([row, older]).get('m1')?.get(0)];
    expect(first?.find((one) => one.channelId === 'se.track.world')?.value).toMatchObject({
      location: 'The mill',
    });
  });
});

describe('the switches', () => {
  it('switches on the trackers Marinara ran, and only while its agents were on', () => {
    const notes: Parameters<typeof trackerSwitches>[2] = [];
    const on = trackerSwitches(
      {
        enableAgents: true,
        activeAgentIds: ['quest', 'custom-tracker', 'director'],
        manualTrackers: true,
        manualTrackerAgentTypes: { quest: true },
      },
      'Harbour',
      notes,
    );
    expect(on.map((one) => [one.channelId, one.value])).toEqual([
      ['se.track.quests.on', true],
      ['se.track.custom.on', true],
      ['se.track.cadence', { everyNTurns: 1, manual: true }],
    ]);
    expect(notes.map((note) => note.key)).toEqual([
      'import.chat.manualTrackersPerAgent',
      'import.chat.agentsNotCarried',
      'import.chat.agentModelsNotCarried',
    ]);
    // Per-agent manual, for only some of the trackers that ran: those stay
    // off, the rest run on the usual cadence, and the note still says so.
    const some: Parameters<typeof trackerSwitches>[2] = [];
    expect(
      trackerSwitches(
        {
          enableAgents: true,
          activeAgentIds: ['quest', 'world-state'],
          manualTrackerAgentTypes: { quest: true },
        },
        'Harbour',
        some,
      ).map((one) => [one.channelId, one.value]),
    ).toEqual([['se.track.world.on', true]]);
    expect(some.map((note) => note.key)).toContain('import.chat.manualTrackersPerAgent');
    // Per-agent manual for every tracker that ran: the cadence is manual.
    const all: Parameters<typeof trackerSwitches>[2] = [];
    expect(
      trackerSwitches(
        {
          enableAgents: true,
          activeAgentIds: ['quest', 'world-state'],
          manualTrackerAgentTypes: { quest: true, 'world-state': true },
        },
        'Harbour',
        all,
      ).map((one) => [one.channelId, one.value]),
    ).toEqual([
      ['se.track.world.on', true],
      ['se.track.quests.on', true],
      ['se.track.cadence', { everyNTurns: 1, manual: true }],
    ]);
    expect(all.map((note) => note.key)).toContain('import.chat.manualTrackersPerAgent');
    // A stale list under agents switched off ran nothing, and switches nothing.
    expect(
      trackerSwitches({ enableAgents: false, activeAgentIds: ['world-state'] }, 'Harbour', []),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Through the sweep, over the shared fixture
// ---------------------------------------------------------------------------

describe('a Marinara roleplay with trackers, swept', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  async function imported(): Promise<{
    items: ImportItemReport[];
    session: SessionFile;
    turns: Turn[];
    vera: string;
  }> {
    const outcome = await sweep({
      library: server.services.library,
      sessions: server.services.sessions,
      handle: 'ned',
      files: new MemoryFileSource(marinaraFixture()),
    });
    if (!outcome.ok) throw new Error(outcome.refusal);
    const items = outcome.report.items;
    const find = (source: string): ImportItemReport => {
      const found = items.find((item) => item.source === source);
      if (found === undefined) throw new Error(source);
      return found;
    };
    const document = await exportSession(
      { sessions: server.services.sessions, build: null },
      'ned',
      find('storage/tables/chats.json#chat_1').objectId ?? '',
    );
    if (document === null) throw new Error('no session');
    return {
      items,
      session: document.session as unknown as SessionFile,
      turns: document.turns,
      vera: find('storage/tables/characters.json#char_vera').objectId ?? '',
    };
  }

  const tracked = (turn: Turn | undefined): ChannelEffect[] =>
    (turn?.effects ?? []).filter((effect) => effect.channelId !== SE_PRESENCE);
  const byForeign = (turns: readonly Turn[], id: string): Turn | undefined =>
    turns.find((turn) => turn.foreign?.id === id);

  it('writes each swipe’s snapshot on the turn holding it, only where the state moved', async () => {
    const { session, turns, vera } = await imported();

    // The opening turn: the three switches and manual mode, from the chat.
    const opening = turns.find((turn) => turn.parentTurnId === null);
    expect(tracked(opening).map((effect) => [effect.channelId, effect.after])).toEqual([
      ['se.track.world.on', true],
      ['se.track.character.on', true],
      ['se.track.inventory.on', true],
      ['se.track.cadence', { everyNTurns: 1, manual: true }],
    ]);

    // The first round is the active swipe's: the office, Vera and the ledger.
    const round = byForeign(turns, 'msg_02');
    expect(tracked(round).map((effect) => [effect.channelId, effect.scopeKey])).toEqual([
      ['se.track.world', null],
      ['se.track.character', vera],
      ['se.track.inventory', null],
    ]);
    expect(tracked(round)[0]?.after).toMatchObject({ location: 'the harbour office' });
    // The other swipe is a sibling with its own: the shed, nobody, nothing carried.
    const sibling = byForeign(turns, 'msg_03:swipe:0');
    expect(sibling?.parentTurnId).toBe(round?.parentTurnId);
    expect(tracked(sibling).map((effect) => [effect.channelId, effect.after])).toEqual([
      ['se.track.world', expect.objectContaining({ location: 'the customs shed' })],
    ]);

    // The next round moved the weather and Vera's mood, and the ledger stayed:
    // no inventory effect. Its locks and hidden fields came with it, Vera's
    // under her actor.
    const next = byForeign(turns, 'msg_04');
    expect(tracked(next).map((effect) => effect.channelId)).toEqual([
      'se.track.world',
      'se.track.character',
      'se.track.locks',
      'se.track.hidden',
    ]);
    expect(tracked(next)[0]?.after).toMatchObject({ weather: 'rain' });
    expect(tracked(next)[1]?.after).toMatchObject({ mood: 'curt' });
    expect(tracked(next)[2]?.after).toEqual([
      'se.track.world/location',
      `se.track.character#${vera}/mood`,
      // A row lock, and a row whose name carries a `#` — kept, not read as a member.
      `se.track.character#${vera}/stats/Patience`,
      'se.track.inventory/inventory/Crate #2',
    ]);
    expect(tracked(next)[3]?.after).toEqual([
      `se.track.character#${vera}/thoughts`,
      'se.track.inventory/inventory/Crate #2',
    ]);

    // The branch's copy of the first round is the root's round, and its own
    // next round went to the warehouse.
    expect(tracked(byForeign(turns, 'msg_b4'))[0]?.after).toMatchObject({
      location: 'the bonded warehouse',
    });

    for (const effect of turns.flatMap(tracked)) {
      expect(effect).toMatchObject({ proposedBy: { kind: 'engine' }, applied: true });
      expect(schemaFailure(channelDefinition(effect.channelId), effect.after)).toBeNull();
    }

    // The head cache is the replay of the head's path, so the session opens
    // with no hand edit to reconcile — and the head's state is the office in
    // the rain, the location locked.
    const byId = new Map(turns.map((turn) => [turn.id, turn]));
    const path: Turn[] = [];
    for (let at = byId.get(session.headTurnId ?? ''); at !== undefined;) {
      path.unshift(at);
      at = at.parentTurnId === null ? undefined : byId.get(at.parentTurnId);
    }
    const replayed = path.reduce<SessionFile['channels']>(
      (state, turn) => applyEffects(state, turn.effects),
      {},
    );
    expect(session.channels).toEqual(replayed);
    expect(session.channels['se.track.world']?.value).toMatchObject({
      location: 'the harbour office',
      weather: 'rain',
    });
    expect(session.channels[channelKey('se.track.character', vera)]?.value).toMatchObject({
      mood: 'curt',
    });
  });

  it('says what came across and what did not, on the chat’s row', async () => {
    const { items } = await imported();
    const notes = items.find((item) => item.source === 'storage/tables/chats.json#chat_1')?.notes;
    expect(notes).toEqual(
      expect.arrayContaining([
        {
          key: 'import.chat.trackersCarried',
          params: { chat: 'Harbour Night', count: 3 },
          level: 'info',
        },
        {
          key: 'import.chat.trackerKeysNotCarried',
          params: { chat: 'Harbour Night', count: 1 },
          level: 'info',
        },
        {
          key: 'import.chat.agentModelsNotCarried',
          params: { chat: 'Harbour Night' },
          level: 'info',
        },
      ]),
    );
  });

  it('opens with the trackers on, in manual mode, and a person can read them', async () => {
    const { session } = await imported();
    const read = await server.request({ method: 'GET', url: `/api/sessions/${session.id}` });
    expect(read.status).toBe(200);
    const surfaces = read.body.surfaces as { channelId: string; kind: string; region: string }[];
    expect(
      surfaces
        .filter((one) => one.region === 'panel' && one.kind === 'record')
        .map((one) => one.channelId),
    ).toEqual(['se.track.world', 'se.track.character', 'se.track.inventory']);
    expect(read.body.actions).toEqual([{ stepId: 'se.scene.track', label: 'Update trackers' }]);
    // Opening it wrote nothing: the cache already was the replay.
    expect(read.body.session.headTurnId).toBe(session.headTurnId);
  });
});
