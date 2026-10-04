// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ImportItemReport, ImportNote } from '@storyengine/shared';

import { installBuiltIns } from '../../mode-loader.js';
import { channelDefinition } from '../../sessions/channels.js';
import { schemaFailure } from '../../sessions/channel-schema.js';
import { exportSession } from '../../sessions/export.js';
import type { SessionFile } from '../../sessions/types.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { marinaraFixture } from '../fixtures/test-marinara.js';
import { MemoryFileSource } from '../memory-source.js';
import { sweep } from '../sweep.js';
import { SCENE_EDITOR, editorSwitches } from './editor.js';

/**
 * ***Marinara's editor and echo chamber, imported*** — [P14 §2.6]'s second
 * table and [§1.9.6], built at [P14.5c].
 *
 * 1. **The spellings are Scene's**, pinned to the registry, and every value
 *    built is one the registered schema admits.
 * 2. **A switch is on only when the agent ran**; the prose guardian's settings
 *    come whenever the chat set them; continuity comes applying, and says so.
 * 3. **Immersive HTML and the card-evolution auditor are notes**, not silence.
 * 4. **Through the sweep**, the switches land on the opening turns and the
 *    session opens with them.
 */

describe('the spellings', () => {
  it('names each channel as the registry declares it', async () => {
    await installBuiltIns();
    for (const [name, spelled] of Object.entries(SCENE_EDITOR)) {
      const definition = channelDefinition(spelled.id);
      expect(definition, name).not.toBeNull();
      expect(definition?.version, name).toBe(spelled.version);
      expect(definition?.init, name).toEqual({ kind: 'literal', value: spelled.init });
    }
  });
});

describe('what a chat’s metadata switches on', () => {
  it('switches on each agent Marinara ran, and continuity applying', async () => {
    await installBuiltIns();
    const notes: ImportNote[] = [];
    const out = editorSwitches(
      {
        proseGuardianBannedWords: 'ozone',
        proseGuardianStyleInstructions: ` ${'x'.repeat(3000)} `,
        proseGuardianHoldForRewrite: false,
      },
      ['prose-guardian', 'continuity', 'echo-chamber'],
      'Harbour',
      notes,
    );
    expect(out.map((one) => [one.channelId, one.value])).toEqual([
      ['se.edit.style.on', true],
      ['se.edit.continuity.on', true],
      ['se.edit.continuity.apply', true],
      ['se.echo.on', true],
      [
        'se.edit.style',
        { banned: 'ozone', avoid: SCENE_EDITOR.style.init.avoid, prefer: 'x'.repeat(2000) },
      ],
      ['se.edit.hold', false],
    ]);
    for (const one of out) {
      expect(schemaFailure(channelDefinition(one.channelId), one.value), one.channelId).toBeNull();
    }
    expect(notes.map((note) => note.key)).toEqual([
      'import.chat.continuityApplies',
      'import.chat.echoChamberDiffers',
    ]);
  });

  it('writes nothing for an agent that did not run, or a setting nobody set', () => {
    const notes: ImportNote[] = [];
    expect(
      editorSwitches({ proseGuardianHoldForRewrite: true }, ['world-state'], 'c', notes),
    ).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('says why immersive HTML and the card-evolution auditor did not come', () => {
    const notes: ImportNote[] = [];
    expect(editorSwitches({}, ['html', 'card-evolution-auditor'], 'Harbour', notes)).toEqual([]);
    expect(notes).toEqual([
      { key: 'import.chat.immersiveHtmlNotBuilt', params: { chat: 'Harbour' }, level: 'info' },
      { key: 'import.chat.cardEvolutionNotBuilt', params: { chat: 'Harbour' }, level: 'info' },
    ]);
  });
});

describe('a Marinara roleplay with an editor and a chorus, swept', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('opens with the editor’s switches and rules, and notes the HTML agent', async () => {
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
    const channels = (document.session as unknown as SessionFile).channels;
    expect(channels['se.edit.style.on']?.value).toBe(true);
    expect(channels['se.echo.on']?.value).toBe(true);
    expect(channels['se.edit.hold']?.value).toBe(false);
    expect(channels['se.edit.style']?.value).toMatchObject({ banned: 'ozone, tapestry' });
    // Continuity did not run in this chat, so it is not switched on.
    expect(channels['se.edit.continuity.on']).toBeUndefined();

    const keys = (root?.notes ?? []).map((note) => note.key);
    expect(keys).toContain('import.chat.immersiveHtmlNotBuilt');
    expect(keys).toContain('import.chat.echoChamberDiffers');
    expect(keys).not.toContain('import.chat.agentsNotCarried');
  });
});
