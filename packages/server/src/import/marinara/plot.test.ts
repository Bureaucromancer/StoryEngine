// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ImportItemReport, Turn } from '@storyengine/shared';

import { installBuiltIns } from '../../mode-loader.js';
import { channelDefinition } from '../../sessions/channels.js';
import { schemaFailure } from '../../sessions/channel-schema.js';
import { exportSession } from '../../sessions/export.js';
import { applyEffects } from '../../sessions/store.js';
import type { SessionFile } from '../../sessions/types.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { marinaraFixture } from '../fixtures/test-marinara.js';
import { MemoryFileSource } from '../memory-source.js';
import { sweep } from '../sweep.js';
import { SCENE_PLOT, plotSwitches, secretPlotOf } from './plot.js';

/**
 * ***Marinara's secret plot, imported*** — [P14 §2.6]'s second table, built at
 * [P14.5b]: *"`agent_memory` `overarchingArc` → `se.plot.secret` on the root
 * chat's head turn"* and *"`narrativeDirectorSecretPlotEnabled` → the switch"*.
 *
 * 1. **The spellings are Scene's**, pinned to the registry, and every arc read
 *    is one the registered schema admits.
 * 2. **The switch is on only when Marinara ran the plot** — the director active
 *    and the chat's flag set — and its interval of messages is half as many
 *    story turns.
 * 3. **The arc is an applied engine effect on the root's head turn**, the head
 *    cache the head path's replay, so opening the session reconciles nothing.
 */

describe('the spellings', () => {
  it('names each channel as the registry declares it', async () => {
    await installBuiltIns();
    for (const [name, spelled] of Object.entries(SCENE_PLOT)) {
      const definition = channelDefinition(spelled.id);
      expect(definition, name).not.toBeNull();
      expect(definition?.version, name).toBe(spelled.version);
      expect(definition?.init, name).toEqual({ kind: 'literal', value: spelled.init });
    }
  });
});

describe('an arc, read', () => {
  const row = (chatId: string, value: string, updatedAt = '2026-08-01T00:00:00.000Z') => ({
    id: `mem_${chatId}_${updatedAt}`,
    agentConfigId: 'agent_director',
    chatId,
    key: 'overarchingArc',
    value,
    updatedAt,
  });

  it('reads the chat’s latest arc in the channel’s shape, clipped to what it takes', async () => {
    await installBuiltIns();
    const [arc] = secretPlotOf(
      [
        row('c1', JSON.stringify({ description: 'old', completed: false })),
        row(
          'c1',
          JSON.stringify({
            description: ` ${'x'.repeat(2000)} `,
            protagonistArc: 'grow',
            characterArc: '',
            completed: true,
          }),
          '2026-08-02T00:00:00.000Z',
        ),
        row('c2', JSON.stringify({ description: 'someone else’s' })),
        { ...row('c1', 'msg_9'), key: 'secretPlotLastAssistantMessageId' },
      ],
      'c1',
    );
    expect(arc?.channelId).toBe('se.plot.secret');
    expect(arc?.value).toEqual({
      description: 'x'.repeat(1500),
      protagonistArc: 'grow',
      completed: true,
    });
    expect(schemaFailure(channelDefinition('se.plot.secret'), arc?.value)).toBeNull();
  });

  it('takes a bare string as a description, and an arc with none as nothing', () => {
    expect(secretPlotOf([row('c1', 'The tide hides a wreck.')], 'c1')[0]?.value).toEqual({
      description: 'The tide hides a wreck.',
      protagonistArc: '',
      completed: false,
    });
    expect(secretPlotOf([row('c1', JSON.stringify({ completed: true }))], 'c1')).toEqual([]);
    expect(secretPlotOf([], 'c1')).toEqual([]);
  });
});

describe('the switch', () => {
  it('is on only when the director ran and the chat said so, its interval halved', () => {
    const on = {
      narrativeDirectorSecretPlotEnabled: true,
      narrativeDirectorSecretPlotRunInterval: 12,
    };
    expect(plotSwitches(on, ['director']).map((one) => [one.channelId, one.value])).toEqual([
      ['se.plot.secret.on', true],
      ['se.plot.secret.cadence', { everyNTurns: 6 }],
    ]);
    // Marinara's default of eight messages is this build's default of four turns.
    expect(
      plotSwitches(
        { narrativeDirectorSecretPlotEnabled: true, narrativeDirectorSecretPlotRunInterval: 8 },
        ['director'],
      ),
    ).toHaveLength(1);
    expect(plotSwitches(on, ['world-state'])).toEqual([]);
    expect(plotSwitches({ narrativeDirectorSecretPlotEnabled: false }, ['director'])).toEqual([]);
  });
});

describe('a Marinara roleplay whose director kept a plot, swept', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('writes the root’s arc on the head turn, and the session opens with it hidden', async () => {
    const outcome = await sweep({
      library: server.services.library,
      tags: server.services.tags,
      sessions: server.services.sessions,
      handle: 'ned',
      files: new MemoryFileSource(marinaraFixture()),
    });
    if (!outcome.ok) throw new Error(outcome.refusal);
    const root = outcome.report.items.find(
      (item: ImportItemReport) => item.source === 'storage/tables/chats.json#chat_1',
    );
    const document = await exportSession(
      { sessions: server.services.sessions, build: null },
      'ned',
      root?.objectId ?? '',
    );
    if (document === null) throw new Error('no session');
    const session = document.session as unknown as SessionFile;
    const turns: Turn[] = document.turns;

    const written = turns.flatMap((turn) =>
      turn.effects
        .filter((effect) => effect.channelId === 'se.plot.secret')
        .map((effect) => ({ turn, effect })),
    );
    // Once, on the head, and the root's arc — not the branch's.
    expect(written).toHaveLength(1);
    expect(written[0]?.turn.id).toBe(session.headTurnId);
    expect(written[0]?.effect).toMatchObject({
      proposedBy: { kind: 'engine' },
      applied: true,
      before: null,
      after: { description: expect.stringContaining('Lund Harrow') },
    });

    // The head cache is the replay, so the arc is state at the head…
    const byId = new Map(turns.map((turn) => [turn.id, turn]));
    const path: Turn[] = [];
    for (let at = byId.get(session.headTurnId ?? ''); at !== undefined;) {
      path.unshift(at);
      at = at.parentTurnId === null ? undefined : byId.get(at.parentTurnId);
    }
    expect(session.channels).toEqual(
      path.reduce<SessionFile['channels']>((state, turn) => applyEffects(state, turn.effects), {}),
    );
    expect(session.channels['se.plot.secret.on']?.value).toBe(true);

    // …and opening it writes nothing, shows the reveal, and not the plot.
    const read = await server.request({ method: 'GET', url: `/api/sessions/${session.id}` });
    expect(read.body.session.headTurnId).toBe(session.headTurnId);
    const surfaces = read.body.surfaces as { channelId: string }[];
    expect(surfaces.some((one) => one.channelId === 'se.plot.secret.reveal')).toBe(true);
    expect(surfaces.some((one) => one.channelId === 'se.plot.secret')).toBe(false);
  });
});
