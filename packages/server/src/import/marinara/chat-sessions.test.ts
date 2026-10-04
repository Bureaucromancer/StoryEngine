// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ImportItemReport, Turn } from '@storyengine/shared';

import { SE_PRESENCE } from '../../sessions/cast.js';
import { channelKey } from '../../sessions/channels.js';
import { exportSession } from '../../sessions/export.js';
import { listSessions } from '../../sessions/store.js';
import type { SessionFile } from '../../sessions/types.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { marinaraFixture } from '../fixtures/test-marinara.js';
import { MemoryFileSource } from '../memory-source.js';
import type { FileSource } from '../source.js';
import { parseSillyTavernChat } from '../sillytavern/chat.js';
import { convertOne, sweep } from '../sweep.js';
import { readUpload } from '../upload.js';
import { profileAsFileSource } from './envelope.js';

/**
 * ***A Marinara store, swept, comes out with its roleplay chats as sessions***
 * — [P14.10](../../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * The stage's claim, over the shared fixture (`fixtures/test-marinara.ts`): a
 * roleplay and its branch are **one** session whose prefix exists once; the
 * edited message comes in as its edit, not as the stale swipe row; the hidden
 * narrator line is hidden; the group's order, dispatch, names and mute are the
 * session's; a conversation chat and an orphaned message are rows that say
 * why they are not sessions. And the per-chat JSONL export, which is
 * SillyTavern's format ([P14 §0.4]), comes in through SillyTavern's parser and
 * meets the same library.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

const CHATS = 'storage/tables/chats.json#';

async function run(
  files: FileSource = new MemoryFileSource(marinaraFixture()),
  sessions = true,
): Promise<ImportItemReport[]> {
  const outcome = await sweep({
    library: server.services.library,
    tags: server.services.tags,
    ...(sessions ? { sessions: server.services.sessions } : {}),
    handle: 'ned',
    files,
  });
  if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
  return outcome.report.items;
}

function row(items: readonly ImportItemReport[], source: string): ImportItemReport {
  const found = items.find((item) => item.source === source);
  if (found === undefined) throw new Error(`no row for ${source}`);
  return found;
}

async function exported(id: string | undefined): Promise<{ session: SessionFile; turns: Turn[] }> {
  const document = await exportSession(
    { sessions: server.services.sessions, build: null },
    'ned',
    id ?? '',
  );
  if (document === null) throw new Error(`no session ${String(id)}`);
  return { session: document.session as unknown as SessionFile, turns: document.turns };
}

function pathTo(turns: readonly Turn[], id: string | null): Turn[] {
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const path: Turn[] = [];
  for (let turn = byId.get(id ?? ''); turn !== undefined;) {
    path.unshift(turn);
    turn = turn.parentTurnId === null ? undefined : byId.get(turn.parentTurnId);
  }
  return path;
}

const texts = (turn: Turn | undefined): string[] =>
  (turn?.output?.messages ?? []).map((message) => message.text);

describe('a Marinara roleplay and its branch', () => {
  it('is one session, the prefix once, the edit as the active swipe, the hidden line hidden', async () => {
    const items = await run();

    const root = row(items, `${CHATS}chat_1`);
    expect(root.disposition).toBe('converted');
    const branch = row(items, `${CHATS}chat_2`);
    expect(branch.disposition).toBe('converted');
    expect(branch.objectId).toBe(root.objectId);
    expect(branch.notes).toEqual([
      {
        key: 'import.chat.inFamily',
        params: { chat: 'False bottoms', family: 'Harbour Night' },
        level: 'info',
      },
    ]);
    // One row per chat, and none per message shard — only the `.bak` beside
    // one, skipped, whose rows are not read a second time (the counts below
    // are what doubling them would change: four turns more, and a phantom
    // second swipe on every reply).
    expect(items.filter((item) => item.source.startsWith('storage/tables/messages/'))).toEqual([
      { source: 'storage/tables/messages/chat_1.json.bak', disposition: 'skipped', notes: [] },
    ]);

    const vera = row(items, 'storage/tables/characters.json#char_vera').objectId;
    const inspector = row(items, 'storage/tables/personas.json#persona_inspector').objectId;
    const { session, turns } = await exported(root.objectId);
    expect(session.name).toBe('Harbour Night');
    expect(session.cast?.actors).toEqual([vera]);
    expect(session.cast?.persona).toBe(inspector);

    // The prefix once: one greeting, and the first round once per swipe — two
    // siblings, not four — then each chat's own second round.
    expect(turns.filter((turn) => turn.parentTurnId === null)).toHaveLength(1);
    expect(turns.filter((turn) => turn.input?.text === 'Manifests?')).toHaveLength(2);
    expect(turns).toHaveLength(5);
    expect((session.branchRefs ?? []).map((ref) => ref.name)).toEqual([
      'Harbour Night',
      'False bottoms',
    ]);
    expect(session.headTurnId).toBe(session.branchRefs?.[0]?.headTurnId);

    // The message row's text, never the stale row of the swipe it is on.
    const all = turns.flatMap(texts);
    expect(all).toContain('Define unusual.');
    expect(all).not.toContain('Define unsual.');
    const head = pathTo(turns, session.headTurnId);
    expect(head.map(texts)).toEqual([
      ['You again. Third time this week.'],
      ['Define unusual.'],
      ['The rain gets heavier.', 'Sealed, all of them.'],
    ]);
    expect(head[1]?.output?.messages?.[0]?.speaker?.id).toBe(vera);
    // The other swipe is a sibling of the round it belongs to.
    const siblings = turns.filter((turn) => turn.parentTurnId === head[0]?.id);
    expect(siblings.map((turn) => texts(turn)[0]).sort()).toEqual([
      'Define unusual.',
      'What about them?',
    ]);
    // Hidden from the model in Marinara, hidden here: the narrator line alone.
    expect(session.hidden?.[head[2]?.id ?? '']).toEqual([0]);

    const branchHead = pathTo(turns, session.branchRefs?.[1]?.headTurnId ?? null);
    expect(branchHead.map(texts).at(-1)).toEqual(['Two.']);
    expect(branchHead[1]?.id).toBe(head[1]?.id);
  });

  it('is unchanged when swept again', async () => {
    const first = await run();
    const second = await run();
    for (const chat of ['chat_1', 'chat_2', 'chat_group']) {
      expect(row(second, `${CHATS}${chat}`).disposition).toBe('unchanged');
    }
    expect(await listSessions(server.services.sessions, 'ned')).toHaveLength(2);
    expect(row(first, `${CHATS}chat_1`).objectId).toBeDefined();
  });
});

describe('a Marinara group', () => {
  it('takes its order, its dispatch, its names and its mute', async () => {
    const items = await run();
    const chat = row(items, `${CHATS}chat_group`);
    expect(chat.disposition).toBe('converted');

    const id = (key: string): string =>
      row(items, `storage/tables/characters.json#${key}`).objectId ?? '';
    const [maris, vera, lund] = [id('char_maris'), id('char_vera'), id('char_lund')];

    const { session, turns } = await exported(chat.objectId);
    expect(session.name).toBe('Night Crossing');
    // `characterIds`' order, Lund included, who never spoke.
    expect(session.cast?.actors).toEqual([maris, vera, lund]);
    expect(session.dispatch).toBe('per-actor');
    expect(session.speakers).toMatchObject({ policy: 'manual', namesInHistory: 'groups' });
    // Muted at the head; the member no longer in the chat mutes nobody.
    expect(session.channels[channelKey(SE_PRESENCE, lund)]?.value).toBe(false);
    expect(chat.notes.map((note) => note.key)).not.toContain('import.chat.mutedUnresolved');

    const path = pathTo(turns, session.headTurnId);
    expect(path.map((turn) => (turn.output?.messages ?? []).map((m) => m.speaker?.id))).toEqual([
      [vera, maris],
      [vera, maris],
    ]);

    // Before the conversation start, hidden — the whole opening round — as
    // Marinara never sent them again; after it, the reply the summary hid is
    // visible, since the summary did not come across, and the one hidden by
    // hand is not.
    expect(session.hidden?.[path[0]?.id ?? '']).toBe(true);
    expect(session.hidden?.[path[1]?.id ?? '']).toEqual([1]);
    expect(chat.notes).toEqual(
      expect.arrayContaining([
        {
          key: 'import.chat.conversationStartHidden',
          params: { chat: 'Night Crossing', count: 2 },
          level: 'info',
        },
        {
          key: 'import.chat.summaryHiddenRestored',
          params: { chat: 'Night Crossing', count: 1 },
          level: 'info',
        },
      ]),
    );
  });

  it('reads the root’s settings against the family’s roster when a branch made it a group', async () => {
    const tree = marinaraFixture();
    const chats = (
      JSON.parse(String(tree['storage/tables/chats.json'])) as Record<string, unknown>[]
    ).map((chat) =>
      chat['id'] === 'chat_2'
        ? { ...chat, characterIds: JSON.stringify(['char_vera', 'char_maris']) }
        : chat,
    );
    tree['storage/tables/chats.json'] = JSON.stringify(chats);

    const items = await run(new MemoryFileSource(tree));
    const root = row(items, `${CHATS}chat_1`);
    expect(row(items, `${CHATS}chat_2`).objectId).toBe(root.objectId);
    const { session } = await exported(root.objectId);
    expect(session.cast?.actors).toHaveLength(2);
    expect(session.dispatch).toBe('merged');
    expect(session.speakers).toMatchObject({ policy: 'list', namesInHistory: 'never' });
  });
});

describe('what is not a session', () => {
  it('records a conversation chat, and counts a message with no chat', async () => {
    const items = await run();
    expect(row(items, `${CHATS}chat_dm`)).toEqual({
      source: `${CHATS}chat_dm`,
      disposition: 'recorded',
      notes: [
        {
          key: 'import.chat.modeNotImported',
          params: { chat: 'Vera (DMs)', mode: 'conversation' },
          level: 'info',
        },
      ],
    });
    expect(row(items, 'storage/tables/messages')).toEqual({
      source: 'storage/tables/messages',
      disposition: 'skipped',
      notes: [
        {
          key: 'import.chat.orphanedMessages',
          params: { messages: 1, swipes: 0 },
          level: 'warn',
        },
      ],
    });
  });

  it('records every chat when the sweep writes no sessions', async () => {
    const items = await run(undefined, false);
    for (const chat of ['chat_1', 'chat_2', 'chat_group']) {
      expect(row(items, `${CHATS}${chat}`).notes.map((note) => note.key)).toEqual([
        'import.chat.notImportedHere',
      ]);
    }
  });
});

describe('the other doors', () => {
  /**
   * ***A profile's branches are not a family.*** Marinara's profile export
   * deletes the branch pointers from every chat's metadata and keeps
   * `branchName` (`sanitizeProfileTableRows`, `backup.routes.ts:586-600`), so
   * the snapshot is stripped here as Marinara strips it — the test used to
   * build it by hand with the pointers still in, and so proved a join no real
   * profile allows. A branch arrives as its own session, and says why.
   */
  it('reads a profile export’s store snapshot, its branches as sessions of their own', async () => {
    const tree = marinaraFixture();
    const stripped = (rows: unknown[]): unknown[] =>
      rows.map((row) => {
        const chat = row as Record<string, unknown>;
        const metadata = JSON.parse(String(chat['metadata'])) as Record<string, unknown>;
        delete metadata['branchParentChatId'];
        delete metadata['branchParentMessageId'];
        delete metadata['branchMessageId'];
        return { ...chat, metadata: JSON.stringify(metadata) };
      });
    const table = (name: string): unknown[] => {
      const flat = tree[`storage/tables/${name}.json`];
      if (flat !== undefined) return JSON.parse(String(flat)) as unknown[];
      return (
        Object.entries(tree)
          // The shards, not the `.bak` beside one: a snapshot holds each row once.
          .filter(([path]) => path.startsWith(`storage/tables/${name}/`) && path.endsWith('.json'))
          .flatMap(([, body]) => JSON.parse(String(body)) as unknown[])
      );
    };
    const files = profileAsFileSource({
      fileStorage: {
        version: 1,
        tables: Object.fromEntries(
          ['characters', 'personas', 'chats', 'messages', 'message_swipes'].map((name) => [
            name,
            name === 'chats' ? stripped(table(name)) : table(name),
          ]),
        ),
        files: [],
      },
    });
    if (files === null) throw new Error('not read as a profile');

    const items = await run(files);
    const root = row(items, `${CHATS}chat_1`);
    const branch = row(items, `${CHATS}chat_2`);
    expect(root.disposition).toBe('converted');
    expect(branch.disposition).toBe('converted');
    expect(branch.objectId).not.toBe(root.objectId);
    expect(branch.notes).toContainEqual({
      key: 'import.chat.branchLinkMissing',
      params: { chat: 'False bottoms' },
      level: 'info',
    });
    expect(await listSessions(server.services.sessions, 'ned')).toHaveLength(3);
  });

  /**
   * ***The per-chat export is SillyTavern's format*** ([P14 §0.4]), with
   * Marinara's own role, character id and swipes in `extra`, and its metadata
   * under `chat_metadata.marinara_metadata` (`chats.routes.ts:3530-3600`). So
   * it takes SillyTavern's door — `readUpload` knows it as a chat — and its
   * speakers are Marinara's ids, which meet the characters a store sweep
   * stamped; its group settings are read by the profile path's own mapping.
   */
  it('brings a JSONL export in through SillyTavern’s parser, onto the same characters', async () => {
    const items = await run();
    const vera = row(items, 'storage/tables/characters.json#char_vera').objectId;
    const maris = row(items, 'storage/tables/characters.json#char_maris').objectId;

    const line = (fields: Record<string, unknown>): string =>
      JSON.stringify({ is_user: false, is_system: false, swipe_id: 0, ...fields });
    const reply = (id: string, name: string, mes: string, minute: number): string =>
      line({
        name,
        role: 'assistant',
        character_id: id,
        mes,
        swipes: [mes],
        send_date: new Date(Date.UTC(2026, 8, 1, 9, minute)).toISOString(),
        extra: { marinara_role: 'assistant', marinara_character_id: id, marinara_swipes: [] },
      });
    const text = [
      JSON.stringify({
        user_name: 'The Inspector',
        character_name: 'Maris Okonkwo',
        create_date: '2026-09-01T09:00:00.000Z',
        chat_metadata: {
          mode: 'roleplay',
          marinara_metadata: { mode: 'roleplay', groupChatMode: 'individual' },
        },
      }),
      line({
        name: 'System',
        is_system: true,
        role: 'system',
        mes: 'The ferry is late.',
        send_date: '2026-09-01T09:00:00.000Z',
        extra: { marinara_role: 'system' },
      }),
      reply('char_maris', 'Maris Okonkwo', 'Pay at the rail.', 1),
      // Swiped and edited: `mes` is the edit, the swipe list still the old text.
      line({
        name: 'Vera Solano',
        role: 'assistant',
        character_id: 'char_vera',
        mes: 'Define unusual.',
        swipes: ['What about them?', 'Define unsual.'],
        swipe_id: 1,
        send_date: '2026-09-01T09:02:00.000Z',
        extra: {
          marinara_role: 'assistant',
          marinara_character_id: 'char_vera',
          marinara_swipes: [
            { index: 0, created_at: '2026-09-01T09:02:00.000Z' },
            { index: 1, created_at: '2026-09-01T09:02:00.000Z' },
          ],
        },
      }),
    ].join('\n');
    const bytes = new TextEncoder().encode(text);

    const parsed = parseSillyTavernChat(bytes, 'Night Crossing.jsonl');
    if (!parsed.ok) throw new Error('refused');
    expect(parsed.value.meta.source).toBe('marinara');
    const [system, , edited] = parsed.value.chat.messages;
    // Marinara's `system` is narration, sent — not SillyTavern's hidden line.
    expect(system?.role).toBe('narrator');
    expect(system?.hidden).toBeUndefined();
    expect(edited?.speaker?.key).toBe('char_vera');
    expect(edited?.swipes?.[edited.activeSwipe ?? -1]?.text).toBe('Define unusual.');

    const read = readUpload('Night Crossing.jsonl', bytes);
    if (read.outcome !== 'candidate') throw new Error('not recognised as a chat');
    const [answer] = await convertOne(
      {
        library: server.services.library,
        tags: server.services.tags,
        sessions: server.services.sessions,
        handle: 'ned',
        files: new MemoryFileSource({ 'Night Crossing.jsonl': bytes }),
      },
      read.candidate,
    );
    expect(answer?.disposition).toBe('converted');
    const { session } = await exported(answer?.objectId);
    expect(session.cast?.actors).toEqual([maris, vera]);
    expect(session.dispatch).toBe('per-actor');
  });
});
