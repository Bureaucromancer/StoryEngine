// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { marinaraGroupSettings, parseMarinaraChats, type MarinaraChat } from './chat.js';
import { marinaraFamilies } from './families.js';

/**
 * ***Marinara's chat tables, read*** —
 * [P13.10](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * The parser and the grouping, pure, over rows written here in the stored
 * shape: JSON columns as text, as `db/schema/chats.ts` keeps them. The sweep
 * over the shared fixture is `chat-sessions.test.ts` beside this.
 */

const at = (minute: number): string => new Date(Date.UTC(2026, 7, 2, 21, minute)).toISOString();

type Row = Record<string, unknown>;

function chat(id: string, fields: Row = {}, metadata: Row = {}): Row {
  return {
    id,
    name: 'Harbour Night',
    mode: 'roleplay',
    characterIds: JSON.stringify(['char_vera']),
    personaId: null,
    metadata: JSON.stringify({ tags: [], ...metadata }),
    createdAt: at(0),
    ...fields,
  };
}

function message(id: string, chatId: string, minute: number, fields: Row = {}): Row {
  return {
    id,
    chatId,
    role: 'assistant',
    characterId: 'char_vera',
    content: id,
    activeSwipeIndex: 0,
    extra: '{}',
    createdAt: at(minute),
    ...fields,
  };
}

const swipe = (messageId: string, index: number, content: string, extra: Row = {}): Row => ({
  id: `${messageId}_${String(index)}`,
  messageId,
  index,
  content,
  extra: JSON.stringify(extra),
  createdAt: at(index),
});

function only(read: ReturnType<typeof parseMarinaraChats>): MarinaraChat {
  const [first] = read.chats;
  if (first === undefined) throw new Error('no chat');
  return first;
}

describe('a Marinara chat, joined from its tables', () => {
  it('reads messages in Marinara’s own order: time, then id', () => {
    const read = parseMarinaraChats({
      chats: [chat('c1')],
      messages: [
        message('m3', 'c1', 2),
        message('m2b', 'c1', 1),
        message('m1', 'c1', 0),
        message('m2a', 'c1', 1),
      ],
      swipes: [],
    });
    expect(only(read).chat.messages.map((line) => line.foreignId)).toEqual([
      'm1',
      'm2a',
      'm2b',
      'm3',
    ]);
  });

  it('takes the active swipe from the message row, and the others from theirs', () => {
    // Swiped to index 2, then edited: the message holds the edit, swipe 2's row
    // what was there before it. Index 1 was removed, which leaves a gap.
    const read = parseMarinaraChats({
      chats: [chat('c1')],
      messages: [
        message('m1', 'c1', 0, {
          content: 'Define unusual.',
          activeSwipeIndex: 2,
          extra: JSON.stringify({ thinking: 'Stalling.' }),
        }),
      ],
      swipes: [
        swipe('m1', 2, 'Define unsual.', { thinking: 'stale' }),
        swipe('m1', 0, 'What about them?', { thinking: 'Curious.' }),
      ],
    });
    const line = only(read).chat.messages[0];
    expect(line?.text).toBe('Define unusual.');
    expect(line?.reasoning).toBe('Stalling.');
    expect(line?.swipes?.map((one) => one.text)).toEqual(['What about them?', 'Define unusual.']);
    expect(line?.swipes?.map((one) => one.reasoning)).toEqual(['Curious.', 'Stalling.']);
    expect(line?.activeSwipe).toBe(1);
  });

  it('has no swipes for a message with only the one row every message gets', () => {
    const read = parseMarinaraChats({
      chats: [chat('c1')],
      messages: [message('m1', 'c1', 0)],
      swipes: [swipe('m1', 0, 'm1')],
    });
    expect(only(read).chat.messages[0]?.swipes).toBeUndefined();
  });

  it('reads the roles, the speaker, the persona and hiding', () => {
    const read = parseMarinaraChats({
      chats: [chat('c1', { personaId: 'p_locked' })],
      messages: [
        message('m1', 'c1', 0, { characterId: null }),
        message('m2', 'c1', 1, {
          role: 'user',
          characterId: null,
          extra: JSON.stringify({ personaSnapshot: { personaId: 'p_ned', name: 'Ned' } }),
        }),
        message('m3', 'c1', 2, { role: 'user', characterId: null }),
        message('m4', 'c1', 3, { role: 'system', characterId: null }),
        message('m5', 'c1', 4, {
          role: 'narrator',
          characterId: null,
          extra: JSON.stringify({ hiddenFromAI: true }),
        }),
        message('m6', 'c1', 5, { role: 'tool' }),
      ],
      swipes: [],
      characters: [{ id: 'char_vera', data: JSON.stringify({ name: 'Vera Solano' }) }],
      personas: [{ id: 'p_locked', name: 'The Inspector' }],
    });
    const read1 = only(read);
    const lines = read1.chat.messages;
    expect(lines.map((line) => line.role)).toEqual([
      'character',
      'user',
      'user',
      'narrator',
      'narrator',
    ]);
    // No characterId is the chat's first member, as Marinara's display reads it.
    expect(lines[0]?.speaker).toEqual({ key: 'char_vera', name: 'Vera Solano' });
    expect(lines[1]?.persona).toEqual({ key: 'storage/tables/personas.json#p_ned', name: 'Ned' });
    expect(lines[2]?.persona).toEqual({
      key: 'storage/tables/personas.json#p_locked',
      name: 'The Inspector',
    });
    // `system` is narration and is sent; only `hiddenFromAI` hides.
    expect(lines[3]?.hidden).toBeUndefined();
    expect(lines[4]?.hidden).toBe(true);
    expect(read1.persona).toBe('storage/tables/personas.json#p_locked');
    expect(read1.notes).toContainEqual({
      key: 'import.chat.roleUnknown',
      params: { chat: 'Harbour Night', count: 1 },
      level: 'warn',
    });
  });

  it('reads columns stored as values as well as JSON text', () => {
    const read = parseMarinaraChats({
      chats: [
        chat('c1', {
          characterIds: ['char_a', 'char_b'],
          metadata: { branchName: 'Second try', groupChatMode: 'individual' },
        }),
      ],
      messages: [message('m1', 'c1', 0, { characterId: 'char_b', extra: { hiddenFromAI: true } })],
      swipes: [],
    });
    const read1 = only(read);
    expect(read1.chat.name).toBe('Second try');
    expect(read1.title).toBe('Harbour Night');
    expect(read1.members.map((member) => member.key)).toEqual(['char_a', 'char_b']);
    expect(read1.settings.dispatch).toBe('per-actor');
    expect(read1.chat.messages[0]?.hidden).toBe(true);
  });

  it('reads a message or swipe row once, however many copies the tables held', () => {
    // A shard's `.bak` read beside it is the same rows again.
    const rows = [message('m1', 'c1', 0, { activeSwipeIndex: 0 })];
    const swipes = [swipe('m1', 0, 'm1')];
    const read = parseMarinaraChats({
      chats: [chat('c1')],
      messages: [...rows, ...rows],
      swipes: [...swipes, ...swipes],
    });
    const lines = only(read).chat.messages;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.swipes).toBeUndefined();
  });

  it('hides what came before the latest conversation start, as Marinara stopped sending it', () => {
    const start = JSON.stringify({ isConversationStart: true });
    const read = parseMarinaraChats({
      chats: [chat('c1')],
      messages: [
        message('m1', 'c1', 0),
        message('m2', 'c1', 1, { extra: start }),
        message('m3', 'c1', 2),
        message('m4', 'c1', 3, { extra: start }),
        message('m5', 'c1', 4, {
          extra: JSON.stringify({ conversationStartForCharacterIds: ['char_b'] }),
        }),
      ],
      swipes: [],
    });
    const read1 = only(read);
    expect(read1.chat.messages.map((line) => line.hidden ?? false)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(read1.notes).toEqual([
      {
        key: 'import.chat.conversationStartHidden',
        params: { chat: 'Harbour Night', count: 3 },
        level: 'info',
      },
      {
        key: 'import.chat.conversationStartPerCharacter',
        params: { chat: 'Harbour Night', count: 1 },
        level: 'warn',
      },
    ]);
  });

  it('shows again what the dropped summary hid, and keeps what the person hid', () => {
    const hidden = JSON.stringify({ hiddenFromAI: true });
    const read = parseMarinaraChats({
      chats: [
        chat(
          'c1',
          {},
          {
            summary: 'They met.',
            hideSummarisedMessages: true,
            summaryEntries: [
              { id: 's1', messageIds: ['m1', 'm2'], hiddenMessageIds: ['m1', 'm2'] },
              { id: 's2', messageIds: ['m3'] },
            ],
          },
        ),
      ],
      messages: [
        message('m1', 'c1', 0, { extra: hidden }),
        message('m2', 'c1', 1, { extra: hidden }),
        message('m3', 'c1', 2, { extra: hidden }),
        message('m4', 'c1', 3),
      ],
      swipes: [],
    });
    const read1 = only(read);
    expect(read1.chat.messages.map((line) => line.hidden ?? false)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(read1.notes).toEqual([
      { key: 'import.chat.summaryNotCarried', params: { chat: 'Harbour Night' }, level: 'info' },
      {
        key: 'import.chat.summaryHiddenRestored',
        params: { chat: 'Harbour Night', count: 2 },
        level: 'info',
      },
    ]);
  });

  it('notes a branch whose link to its parent did not travel', () => {
    const read = parseMarinaraChats({
      chats: [chat('c2', {}, { branchName: 'False bottoms' })],
      messages: [],
      swipes: [],
    });
    expect(only(read).branchOf).toBeUndefined();
    expect(only(read).notes).toEqual([
      {
        key: 'import.chat.branchLinkMissing',
        params: { chat: 'False bottoms' },
        level: 'info',
      },
    ]);
  });

  it('keeps conversation and game chats apart, and counts rows that point at nothing', () => {
    const read = parseMarinaraChats({
      chats: [
        chat('c1'),
        chat('c2', { mode: 'conversation', name: 'DMs' }),
        chat('c3', { mode: 'game' }),
      ],
      messages: [
        message('m1', 'c1', 0),
        message('m2', 'c2', 0),
        message('m3', null as unknown as string, 0),
        message('m4', 'gone', 0),
      ],
      swipes: [swipe('m1', 0, 'm1'), swipe('m3', 0, 'm3'), swipe('nobody', 0, '?')],
    });
    expect(read.chats.map((one) => one.chat.id)).toEqual(['c1']);
    expect(read.other).toEqual([
      { id: 'c2', name: 'DMs', mode: 'conversation' },
      { id: 'c3', name: 'Harbour Night', mode: 'game' },
    ]);
    // A swipe of an orphaned message is part of that orphan.
    expect(read.orphans).toEqual({ messages: 2, swipes: 1 });
  });

  it('notes what a session does not keep', () => {
    const read = parseMarinaraChats({
      chats: [
        chat(
          'c1',
          {},
          {
            summary: 'They met.',
            enableAgents: true,
            activeAgentIds: ['world-state', 'director'],
          },
        ),
      ],
      messages: [
        message('m1', 'c1', 0, {
          extra: JSON.stringify({
            attachments: [{ type: 'image' }],
            generationInfo: { model: 'some-model' },
            hiddenFromAICharacterIds: ['char_b'],
            hiddenFromUser: true,
            proseGuardianOriginalText: 'before',
          }),
        }),
      ],
      swipes: [],
    });
    expect(only(read).notes.map((note) => note.key)).toEqual([
      'import.chat.attachmentsNotCarried',
      'import.chat.modelsNotCarried',
      'import.chat.hiddenPerCharacter',
      'import.chat.hiddenFromUserShown',
      'import.chat.rewriteOriginalsNotCarried',
      'import.chat.summaryNotCarried',
      // [P13.5a]: the world tracker's switch came across, the director's did
      // not, and the trackers' models are Marinara's global ones.
      'import.chat.agentsNotCarried',
      'import.chat.agentModelsNotCarried',
    ]);
    expect(only(read).state).toEqual([
      { channelId: 'se.track.world.on', version: 1, init: false, value: true },
    ]);
  });
});

describe('a Marinara group’s settings', () => {
  const members = ['a', 'b', 'c'].map((key) => ({ key, name: key }));

  it('maps each row onto the session’s, as Marinara reads them', () => {
    expect(
      marinaraGroupSettings(
        {
          groupChatMode: 'individual',
          groupResponseOrder: 'smart',
          groupSpeakerNamesInHistory: true,
          inactiveCharacterIds: ['c', 'removed'],
        },
        members,
      ),
    ).toEqual({
      dispatch: 'per-actor',
      speakers: { policy: 'smart', namesInHistory: 'groups' },
      muted: ['c'],
    });
    expect(marinaraGroupSettings({ groupResponseOrder: 'manual' }, members).speakers?.policy).toBe(
      'manual',
    );
  });

  it('prefixes names only in an individual group, whatever a merged one’s flag says', () => {
    for (const groupChatMode of [undefined, 'merged']) {
      expect(
        marinaraGroupSettings({ groupChatMode, groupSpeakerNamesInHistory: true }, members).speakers
          ?.namesInHistory,
      ).toBe('never');
    }
  });

  it('reads an absent mode as merged and an absent order as sequential, which Marinara does', () => {
    expect(marinaraGroupSettings({}, members)).toEqual({
      dispatch: 'merged',
      speakers: { policy: 'list', namesInHistory: 'never' },
    });
  });

  it('says nothing about a single-character chat', () => {
    const read = parseMarinaraChats({
      chats: [chat('c1', {}, { groupChatMode: 'individual' })],
      messages: [],
      swipes: [],
    });
    expect(only(read).settings).toEqual({});
  });
});

describe('Marinara families', () => {
  function chats(rows: Row[], messages: Row[] = []): MarinaraChat[] {
    return parseMarinaraChats({ chats: rows, messages, swipes: [] }).chats;
  }
  const branch = (id: string, parent: string, minute = 0): Row =>
    chat(id, { createdAt: at(minute) }, { branchParentChatId: parent, branchName: id });

  it('groups a branch of a branch under the root, the shallower first', () => {
    const plans = marinaraFamilies(
      chats([branch('c3', 'c2'), branch('c2', 'c1'), chat('c1'), chat('other')]),
    );
    expect(plans.map((plan) => plan.key)).toEqual([
      'storage/tables/chats.json#c1',
      'storage/tables/chats.json#other',
    ]);
    expect(plans[0]?.chats.map(({ chat: one, parentId }) => [one.chat.id, parentId])).toEqual([
      ['c1', undefined],
      ['c2', 'c1'],
      ['c3', 'c2'],
    ]);
  });

  it('orders the branches by earliest message, then depth, then id', () => {
    const plans = marinaraFamilies(
      chats(
        [chat('root'), branch('b_late', 'root'), branch('a_deep', 'b_late'), branch('z', 'root')],
        [
          message('r1', 'root', 0),
          message('l1', 'b_late', 0),
          message('d1', 'a_deep', 0),
          message('z0', 'z', -5),
        ],
      ),
    );
    expect(plans[0]?.chats.map(({ chat: one }) => one.chat.id)).toEqual([
      'root',
      'z',
      'b_late',
      'a_deep',
    ]);
  });

  it('is the same whichever order the rows came in', () => {
    const rows = [chat('c1'), branch('c2', 'c1'), branch('c3', 'c1'), branch('c4', 'c3')];
    const forwards = marinaraFamilies(chats(rows));
    const backwards = marinaraFamilies(chats([...rows].reverse()));
    expect(backwards).toEqual(forwards);
  });

  it('makes a chat whose parent is not here a root of its own, keeping the pointer', () => {
    const plans = marinaraFamilies(chats([branch('c2', 'deleted')]));
    expect(plans).toHaveLength(1);
    expect(plans[0]?.key).toBe('storage/tables/chats.json#c2');
    expect(plans[0]?.chats[0]?.parentId).toBe('deleted');
  });

  it('breaks a cycle at its earliest member, with a note', () => {
    const plans = marinaraFamilies(chats([branch('b', 'a', 1), branch('a', 'b', 0)]));
    expect(plans).toHaveLength(1);
    expect(plans[0]?.key).toBe('storage/tables/chats.json#a');
    expect(plans[0]?.notes).toEqual([
      { key: 'import.chat.familyCycle', params: { chat: 'a', parent: 'b' }, level: 'warn' },
    ]);
  });

  it('reads a chat that names itself as a root, with a note', () => {
    const plans = marinaraFamilies(chats([branch('a', 'a')]));
    expect(plans[0]?.chats[0]?.parentId).toBeUndefined();
    expect(plans[0]?.notes.map((note) => note.key)).toEqual(['import.chat.familySelfParent']);
  });
});
