// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Turn } from '@storyengine/shared';

import { walkPath } from '../../sessions/segments.js';
import { buildSession } from '../chat/build.js';
import { roundsOf } from '../chat/rounds.js';
import type { ChatFamily, ChatMessage, ChatResolution } from '../chat/types.js';
import {
  parseSillyTavernChat,
  parseTimestamp,
  SPEAKER_BY_NAME,
  type SillyTavernChat,
} from './chat.js';

/**
 * ***One SillyTavern chat file, read*** —
 * [P13.7](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * **Every line below is shaped as SillyTavern writes it**, field for field, and
 * says which function wrote it — `saveReply`, `sendMessageAsUser`,
 * `getFirstMessage`, the slash commands — because the parser's rules are
 * readings of those writers, and a fixture shaped by guesswork would test the
 * guess. The fixtures live here rather than in `fixtures/test-sillytavern.ts`,
 * ~~whose one chat file is a sweep-counting prop that other tests depend on
 * being exactly one line~~ — whose one chat is, since [P13.8], a small whole
 * chat that the sweep turns into a session end to end; the cases here are each
 * one writer's shape, which a single swept chat could not hold.
 *
 * The last `describe` is the stage's point: a parsed chat fed through the P13.6
 * builder comes out as the tree [P13 §2.3] describes.
 */

const PATH = 'chats/Vera Solano/Vera Solano - 2024-07-12@01h00m00s000ms.jsonl';
const T0 = Date.UTC(2024, 6, 12, 1, 0, 0);
const iso = (ms: number): string => new Date(ms).toISOString();

/** What `saveChat` writes as line 0 today (`script.js:7370`). */
const HEADER = {
  chat_metadata: { integrity: '5a1b7c44-2f0e-4b8e-9d6a-8d1f0c3e2b71', tainted: true },
  user_name: 'unused',
  character_name: 'unused',
};

function jsonl(...lines: unknown[]): string {
  return lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n');
}

function read(text: string, path = PATH): SillyTavernChat {
  const outcome = parseSillyTavernChat(new TextEncoder().encode(text), path);
  if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
  return outcome.value;
}

function only(text: string, path = PATH): ChatMessage {
  const [message, ...rest] = read(text, path).chat.messages;
  expect(rest).toEqual([]);
  if (message === undefined) throw new Error('no message');
  return message;
}

/** A character's reply as `saveReply` leaves it (`script.js:6660-6750`). */
function reply(mes: string, at: number, more: Record<string, unknown> = {}) {
  return {
    name: 'Vera Solano',
    is_user: false,
    is_system: false,
    send_date: iso(at),
    mes,
    gen_started: iso(at - 4000),
    gen_finished: iso(at),
    extra: { api: 'openai', model: 'gpt-4o' },
    swipe_id: 0,
    swipes: [mes],
    swipe_info: [
      { send_date: iso(at), gen_started: iso(at - 4000), gen_finished: iso(at), extra: {} },
    ],
    ...more,
  };
}

/** A player's line as `sendMessageAsUser` writes it (`script.js:5818`). */
function player(mes: string, at: number, more: Record<string, unknown> = {}) {
  return {
    name: 'Ned',
    is_user: true,
    is_system: false,
    send_date: iso(at),
    mes,
    extra: { isSmallSys: false },
    force_avatar: '/thumbnail?type=persona&file=ned%20harbour.png',
    ...more,
  };
}

// ---------------------------------------------------------------------------

describe('parseTimestamp, as SillyTavern reads a send_date', () => {
  const at = Date.UTC(2024, 6, 12, 1, 31, 37, 123);
  const second = Date.UTC(2024, 6, 12, 1, 31, 37);

  it.each<[string, unknown, number]>([
    ['ISO 8601, as getMessageTimeStamp writes it today', '2024-07-12T01:31:37.123Z', at],
    ['ISO 8601 with an offset', '2024-07-12T03:31:37.123+02:00', at],
    ['ISO 8601 with no zone, read as UTC', '2024-07-12T01:31:37', second],
    ['ISO 8601 with a space and a comma fraction', '2024-07-12 01:31:37,123Z', at],
    ['ISO 8601 basic form', '20240712T013137Z', second],
    ['an ISO ordinal date', '2024-194', Date.UTC(2024, 6, 12)],
    ['an ISO week date', '2024-W28-5', Date.UTC(2024, 6, 12)],
    ['an ISO week date in the next calendar year', '2020-W53-5', Date.UTC(2021, 0, 1)],
    ['24:00, which is the next midnight', '2024-07-11T24:00:00Z', Date.UTC(2024, 6, 12)],
    ['epoch milliseconds, the oldest form', 1720747897123, at],
    ['epoch milliseconds written as digits', '1720747897123', at],
    ['a Date', new Date(at), at],
    ['June 19, 2023 2:20pm', 'June 19, 2023 2:20pm', Date.UTC(2023, 5, 19, 14, 20)],
    ['12:05am, just after midnight', 'July 12, 2024 12:05am', Date.UTC(2024, 6, 12, 0, 5)],
    ['a month named by its prefix', 'Sept 3, 2023 9:09AM', Date.UTC(2023, 8, 3, 9, 9)],
    [
      'the meridiem form inside other text',
      'sent June 19, 2023 2:20pm',
      Date.UTC(2023, 5, 19, 14, 20),
    ],
    ['humanized with milliseconds (humanizedDateTime)', '2024-07-12@01h31m37s123ms', at],
    ['humanized without milliseconds', '2024-7-12@01h31m37s', second],
    ['humanized with spaces (an old create_date)', '2024-7-12 @01h 31m 37s 123ms', at],
    ['humanized inside a chat file name', 'Vera Solano - 2024-07-12@01h31m37s123ms', at],
  ])('reads %s', (_, input, expected) => {
    expect(parseTimestamp(input)).toBe(expected);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['an empty string', ''],
    ['zero, which SillyTavern treats as unset', 0],
    ['a negative number', -5],
    ['a number past Date’s range, where SillyTavern throws', 8.64e15 + 1],
    ['words', 'yesterday'],
    ['a thirteenth month', '2024-13-12T00:00:00Z'],
    ['the thirty-first of June', 'June 31, 2023 2:20pm'],
    [
      'a month moment does not know, which SillyTavern dates in the current month',
      'Smarch 1, 2023 1:00pm',
    ],
    ['ISO with leading whitespace, which a strict parse leaves over', ' 2024-07-12'],
    ['ISO with a space before Z', '2024-07-12T01:31:37 Z'],
    ['an object', { at }],
    ['an array holding a time, which SillyTavern would coerce', [at]],
  ])('reads %s as no time', (_, input) => {
    expect(parseTimestamp(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('the header', () => {
  it('reads chat_metadata and never the names beside it', () => {
    const { meta, chat } = read(
      jsonl(
        {
          chat_metadata: {
            ...HEADER.chat_metadata,
            main_chat: 'Vera Solano - 2024-07-01@09h00m00s000ms',
            persona: 'ned harbour.png',
            world_info: 'Harbour District',
            note_prompt: '[Keep it rainy.]',
            note_depth: 2,
            note_interval: 3,
            note_position: 1,
            note_role: 0,
          },
          user_name: 'unused',
          character_name: 'unused',
        },
        reply('You again.', T0),
      ),
    );

    expect(meta).toEqual({
      source: 'sillytavern',
      group: false,
      mainChat: 'Vera Solano - 2024-07-01@09h00m00s000ms',
      integrity: HEADER.chat_metadata.integrity,
      persona: 'User Avatars/ned harbour.png',
      worldInfo: 'Harbour District',
      note: { text: '[Keep it rainy.]', depth: 2, every: 3 },
    });
    expect(chat.id).toBe(PATH);
    expect(chat.name).toBe('Vera Solano - 2024-07-12@01h00m00s000ms');
    expect(JSON.stringify(chat)).not.toContain('unused');
  });

  it('takes a header from before chat_metadata, which has no mes, and its create_date', () => {
    const { chat } = read(
      jsonl(
        { user_name: 'You', character_name: 'Vera', create_date: '2023-6-19 @14h 20m 50s 682ms' },
        reply('You again.', T0),
      ),
    );
    expect(chat.messages.map((message) => message.text)).toEqual(['You again.']);
    expect(chat.createdAt).toBe(Date.UTC(2023, 5, 19, 14, 20, 50, 682));
  });

  it('keeps a switched-off note switched off, and says where SillyTavern put it', () => {
    const { meta, notes } = read(
      jsonl(
        {
          ...HEADER,
          chat_metadata: { note_prompt: 'Rain.', note_interval: 0, note_position: 2, note_role: 1 },
        },
        reply('You again.', T0),
      ),
    );
    expect(meta.note).toEqual({ text: 'Rain.', depth: 4, every: 0 });
    expect(notes).toContainEqual({
      key: 'import.chat.noteOutsideHistory',
      params: { chat: 'Vera Solano - 2024-07-12@01h00m00s000ms', depth: 4 },
      level: 'warn',
    });
    expect(notes.map((note) => note.params['role'])).toContain('user');
  });

  it('has no note where the panel was opened and left empty', () => {
    const { meta } = read(
      jsonl({ ...HEADER, chat_metadata: { note_prompt: '' } }, reply('Hi.', T0)),
    );
    expect(meta.note).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('lines', () => {
  it('makes mes the active swipe when swipes[swipe_id] went stale after an edit', () => {
    const message = only(
      jsonl(
        HEADER,
        reply('Define “unusual”.', T0, {
          swipe_id: 1,
          swipes: ['Nothing worth your time.', 'Define unusual.', 'Ask the harbourmaster.'],
          swipe_info: [
            { send_date: iso(T0 - 2000), extra: { reasoning: 'Nothing to hide.' } },
            { send_date: iso(T0 - 1000), extra: {} },
            { send_date: iso(T0 + 1000), extra: {} },
          ],
          extra: { api: 'openai', model: 'gpt-4o', reasoning: 'She is stalling.' },
        }),
      ),
    );

    expect(message.text).toBe('Define “unusual”.');
    expect(message.activeSwipe).toBe(1);
    expect(message.swipes).toEqual([
      { text: 'Nothing worth your time.', reasoning: 'Nothing to hide.', at: T0 - 2000 },
      { text: 'Define “unusual”.', reasoning: 'She is stalling.', at: T0 },
      { text: 'Ask the harbourmaster.', at: T0 + 1000 },
    ]);
    expect(message.reasoning).toBe('She is stalling.');
  });

  it('reads a hidden line — is_system, which means not in the prompt', () => {
    // `/hide` (`chats.js:157`) flips `is_system` on an ordinary reply.
    const message = only(jsonl(HEADER, reply('A whispered aside.', T0, { is_system: true })));
    expect(message).toMatchObject({ role: 'character', hidden: true, text: 'A whispered aside.' });
  });

  it('reads a narrator line as unattributed, and not as a batch of its own', () => {
    // `/sys` (`slash-commands.js:6027`), gen_id and all.
    const message = only(
      jsonl(HEADER, {
        name: 'System',
        is_user: false,
        is_system: false,
        send_date: iso(T0),
        mes: 'The rain thickens.',
        force_avatar: 'img/five.png',
        extra: {
          type: 'narrator',
          bias: null,
          gen_id: T0,
          isSmallSys: false,
          api: 'manual',
          model: 'slash command',
        },
      }),
    );
    expect(message).toEqual({
      role: 'narrator',
      text: 'The rain thickens.',
      at: T0,
      foreignId: `${PATH}#1`,
    });
  });

  it('reads a comment as a hidden narrator line', () => {
    // `/comment` (`slash-commands.js:6114`).
    const message = only(
      jsonl(HEADER, {
        name: 'Note',
        is_user: false,
        is_system: true,
        send_date: iso(T0),
        mes: 'Remember the ledger.',
        force_avatar: 'img/quill.png',
        extra: {
          type: 'comment',
          gen_id: T0,
          isSmallSys: false,
          api: 'manual',
          model: 'slash command',
        },
      }),
    );
    expect(message).toMatchObject({ role: 'narrator', hidden: true });
    expect(message.speaker).toBeUndefined();
  });

  it('reads a line that says both narrator and player as SillyTavern does: narrator', () => {
    // Only a hand edit writes this; `messageRoleCallback` checks the type first.
    const message = only(
      jsonl(HEADER, player('The fog lifts.', T0, { extra: { type: 'narrator' } })),
    );
    expect(message.role).toBe('narrator');
  });

  it('reads the player’s persona from their thumbnail, decoded', () => {
    const message = only(jsonl(HEADER, player('Anything unusual?', T0)));
    expect(message).toMatchObject({
      role: 'user',
      persona: { key: 'User Avatars/ned harbour.png', name: 'Ned' },
      at: T0,
    });
    expect(message.speaker).toBeUndefined();
  });

  it('attributes a single chat’s own lines to its folder, and nobody else’s', () => {
    const { chat } = read(
      jsonl(
        HEADER,
        reply('You again.', T0),
        // `/sendas` to a card the library has (`getNameAndAvatarForMessage`).
        reply('Pay at the rail.', T0 + 1, {
          name: 'Maris Okonkwo',
          original_avatar: 'Maris.png',
          force_avatar: '/thumbnail?type=avatar&file=Maris.png',
        }),
        // `/sendas` to a name with no card: SillyTavern's placeholder image.
        reply('Oi!', T0 + 2, {
          name: 'Dockhand',
          original_avatar: 'img/ai4.png',
          force_avatar: 'img/ai4.png',
        }),
      ),
    );
    expect(chat.messages.map((message) => message.speaker)).toEqual([
      { key: 'Vera Solano.png', name: 'Vera Solano' },
      { key: 'Maris.png', name: 'Maris Okonkwo' },
      { key: `${SPEAKER_BY_NAME}Dockhand`, name: 'Dockhand' },
    ]);
  });

  it('keys a lone upload’s speakers by name, having no folder to say whose chat it is', () => {
    const message = only(jsonl(HEADER, reply('You again.', T0)), 'Vera Solano - exported.jsonl');
    expect(message.speaker).toEqual({ key: 'name:Vera Solano', name: 'Vera Solano' });
  });

  it('skips SillyTavern’s own screens, and says how many', () => {
    const { chat, notes } = read(
      jsonl(HEADER, reply('You again.', T0), {
        name: 'SillyTavern System',
        force_avatar: 'img/five.png',
        is_user: false,
        is_system: true,
        mes: '<h3>Hello there!</h3>',
        extra: { type: 'help', isSmallSys: false },
      }),
    );
    expect(chat.messages).toHaveLength(1);
    expect(notes).toContainEqual({
      key: 'import.chat.interfaceSkipped',
      params: { chat: 'Vera Solano - 2024-07-12@01h00m00s000ms', count: 1 },
      level: 'info',
    });
  });

  it('keeps a tool call’s record as hidden narration, and says so', () => {
    const { chat, notes } = read(
      jsonl(HEADER, {
        name: 'SillyTavern System',
        force_avatar: 'img/five.png',
        is_system: true,
        is_user: false,
        mes: 'Tool calls: Roll dice',
        extra: {
          isSmallSys: true,
          tool_invocations: [{ id: 'call_1', name: 'roll', result: '4' }],
          api: 'openai',
          model: 'gpt-4o',
        },
      }),
    );
    // Hidden by the import, not by the source: SillyTavern sent it.
    expect(chat.messages[0]).toMatchObject({ role: 'narrator', hiddenByImport: true });
    expect(chat.messages[0]?.hidden).toBeUndefined();
    expect(notes.map((note) => note.key)).toContain('import.chat.toolCallsHidden');
    // A tool call is not a reply, so it is not counted among the replies that named a model.
    expect(notes.map((note) => note.key)).not.toContain('import.chat.modelsNotCarried');
  });

  it('counts what the file cannot carry: attachments, models and variables', () => {
    const { notes } = read(
      jsonl(
        { ...HEADER, chat_metadata: { variables: { mood: 'wary', visits: '3' } } },
        player('Look at this.', T0, {
          extra: { files: [{ url: '/user/files/manifest.txt', size: 812, name: 'manifest.txt' }] },
        }),
        reply('Hm.', T0 + 1),
      ),
    );
    const byKey = new Map(notes.map((note) => [note.key, note.params['count']]));
    expect(byKey.get('import.chat.attachmentsNotCarried')).toBe(1);
    expect(byKey.get('import.chat.modelsNotCarried')).toBe(1);
    expect(byKey.get('import.chat.variablesNotCarried')).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('a headerless group file', () => {
  const GENERATION = 1720747900000;
  const FORCED = 1720747950000;
  /** A member's reply as `saveReply` writes it in a group (`script.js:6708`). */
  const member = (name: string, avatar: string, mes: string, at: number, genId: number) =>
    reply(mes, at, {
      name,
      force_avatar: `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`,
      original_avatar: avatar,
      extra: { api: 'openai', model: 'gpt-4o', gen_id: genId },
    });
  /** A greeting as `getFirstCharacterMessage` writes it (`group-chats.js:594`). */
  const greeting = (name: string, avatar: string, mes: string, genId: number) => ({
    is_user: false,
    is_system: false,
    name,
    send_date: iso(T0),
    original_avatar: avatar,
    extra: { gen_id: genId },
    mes,
    force_avatar: `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}`,
  });

  const FILE = jsonl(
    greeting('Vera Solano', 'Vera.png', 'You again.', 1.4629158214071e18),
    greeting('Maris Okonkwo', 'Maris.png', 'Pay at the rail.', 8.37211099305e17),
    player('Both of you, then.', T0 + 10_000),
    member('Vera Solano', 'Vera.png', 'Always.', T0 + 12_000, GENERATION),
    member('Maris Okonkwo', 'Maris.png', 'Not by choice.', T0 + 14_000, GENERATION),
    // A member made to speak after the round: a batch of its own.
    member('Vera Solano', 'Vera.png', 'And another thing.', T0 + 20_000, FORCED),
    // A line from before `original_avatar` existed: the thumbnail is all there is.
    {
      name: 'Maris Okonkwo',
      is_user: false,
      mes: 'Hm.',
      send_date: iso(T0 + 30_000),
      force_avatar: '/thumbnail?type=avatar&file=Maris.png',
      extra: { gen_id: FORCED + 1 },
    },
  );

  it('is a group, starts at line 0, and says who spoke by card file', () => {
    const { chat, meta } = read(FILE, 'group chats/1720747800000.jsonl');
    expect(meta.group).toBe(true);
    expect(chat.messages[0]?.foreignId).toBe('group chats/1720747800000.jsonl#0');
    expect(chat.messages.map((message) => message.speaker?.key)).toEqual([
      'Vera.png',
      'Maris.png',
      undefined,
      'Vera.png',
      'Maris.png',
      'Vera.png',
      'Maris.png',
    ]);
  });

  it('batches by gen_id, with the greetings as one', () => {
    const { chat } = read(FILE, 'group chats/1720747800000.jsonl');
    expect(chat.messages.map((message) => message.batch)).toEqual([
      'greetings',
      'greetings',
      undefined,
      String(GENERATION),
      String(GENERATION),
      String(FORCED),
      String(FORCED + 1),
    ]);
    // …which the builder's rounds read as [P13 §2.2] asks: one opening turn,
    // the round, the force-talked member alone, the old line alone.
    expect(
      roundsOf(chat.messages).map((round) => [
        round.input?.text ?? null,
        round.replies.map((line) => line.text),
      ]),
    ).toEqual([
      [null, ['You again.', 'Pay at the rail.']],
      ['Both of you, then.', ['Always.', 'Not by choice.']],
      [null, ['And another thing.']],
      [null, ['Hm.']],
    ]);
  });

  /**
   * *A greeting regenerated in place* — the last greeting of a group swiped:
   * `saveReply`'s `swipe` arm writes a generation record onto the line and
   * keeps its `gen_id`, and `swipe_info[0]` keeps the greeting's own.
   */
  const regenerated = (active: string, first: string, genId: number) => ({
    ...greeting('Maris Okonkwo', 'Maris.png', active, genId),
    send_date: iso(T0 + 5000),
    gen_started: iso(T0 + 4000),
    gen_finished: iso(T0 + 5000),
    extra: { gen_id: genId, api: 'openai', model: 'gpt-4o', reasoning: '' },
    swipe_id: 1,
    swipes: [first, active],
    swipe_info: [
      { send_date: iso(T0), extra: { gen_id: genId } },
      {
        send_date: iso(T0 + 5000),
        gen_started: iso(T0 + 4000),
        gen_finished: iso(T0 + 5000),
        extra: { gen_id: genId, api: 'openai', model: 'gpt-4o' },
      },
    ],
  });

  it('keeps a greeting in the opening turn when its regenerated swipe is showing', () => {
    const { chat } = read(
      jsonl(
        HEADER,
        greeting('Vera Solano', 'Vera.png', 'You again.', 1.4629158214071e18),
        regenerated('Pay at the rail, and be quick.', 'Pay at the rail.', 8.37211099305e17),
        player('Both of you, then.', T0 + 10_000),
      ),
      'group chats/1720747800000.jsonl',
    );

    expect(chat.messages.map((message) => message.batch)).toEqual([
      'greetings',
      'greetings',
      undefined,
    ]);
    expect(
      roundsOf(chat.messages).map((round) => [
        round.input?.text ?? null,
        round.replies.map((line) => line.text),
      ]),
    ).toEqual([
      [null, ['You again.', 'Pay at the rail, and be quick.']],
      ['Both of you, then.', []],
    ]);
  });

  it('still ends the greetings at a line generated from its first swipe', () => {
    const { chat } = read(
      jsonl(
        HEADER,
        greeting('Vera Solano', 'Vera.png', 'You again.', 1.4629158214071e18),
        member('Maris Okonkwo', 'Maris.png', 'Not by choice.', T0 + 14_000, GENERATION),
      ),
      'group chats/1720747800000.jsonl',
    );

    expect(chat.messages.map((message) => message.batch)).toEqual([
      'greetings',
      String(GENERATION),
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('a Marinara export', () => {
  const CREATED = Date.UTC(2026, 0, 5, 10, 0, 0);
  /** `chats.routes.ts:3541` and `:3584`, line for line. */
  const FILE = jsonl(
    {
      user_name: 'Ned',
      character_name: 'Vera Solano',
      create_date: iso(CREATED),
      chat_metadata: {
        mode: 'roleplay',
        groupChatMode: 'individual',
        branchName: 'main',
        marinara_metadata: {
          groupChatMode: 'individual',
          mode: 'roleplay',
          spatialContextHistory: [],
        },
      },
    },
    {
      name: 'System',
      is_user: false,
      is_system: true,
      role: 'system',
      character_id: null,
      mes: 'The harbour, at dusk.',
      swipes: ['The harbour, at dusk.'],
      swipe_id: 0,
      send_date: iso(CREATED + 1000),
      extra: {
        marinara_role: 'system',
        marinara_character_id: null,
        marinara_swipes: [{ index: 0, extra: {}, created_at: iso(CREATED + 1000) }],
      },
    },
    {
      name: 'User',
      is_user: true,
      is_system: false,
      role: 'user',
      character_id: null,
      mes: 'An aside, for me only.',
      swipes: ['An aside, for me only.'],
      swipe_id: 0,
      send_date: iso(CREATED + 2000),
      extra: {
        hiddenFromAI: true,
        marinara_role: 'user',
        marinara_character_id: null,
        marinara_swipes: [],
      },
    },
    {
      name: 'Vera Solano',
      is_user: false,
      is_system: false,
      role: 'assistant',
      character_id: 'chr_01HVZ3K9',
      mes: 'Always.',
      reasoning_content: 'Keep it short.',
      // Marinara numbers swipes itself; after a delete they need not be 0..n-1.
      swipes: ['Never.', 'Always.', 'Sometimes.'],
      swipe_id: 2,
      send_date: iso(CREATED + 3000),
      extra: {
        marinara_role: 'assistant',
        marinara_character_id: 'chr_01HVZ3K9',
        marinara_swipes: [
          { index: 0, extra: {}, created_at: iso(CREATED + 2500) },
          { index: 2, extra: {}, created_at: iso(CREATED + 3000) },
          { index: 3, extra: {}, created_at: iso(CREATED + 3500) },
        ],
      },
    },
  );

  it('reads Marinara’s roles, where is_system is a role and not hiding', () => {
    const { chat, meta } = read(FILE, 'Vera Solano__main__1a2b3c4d.jsonl');
    const [system, aside, answer] = chat.messages;

    expect(system).toMatchObject({ role: 'narrator', text: 'The harbour, at dusk.' });
    expect(system?.hidden).toBeUndefined();
    expect(aside).toMatchObject({ role: 'user', hidden: true });
    expect(answer).toMatchObject({
      role: 'character',
      speaker: { key: 'chr_01HVZ3K9', name: 'Vera Solano' },
      reasoning: 'Keep it short.',
    });
    expect(meta.source).toBe('marinara');
    expect(meta.marinara).toMatchObject({ groupChatMode: 'individual' });
    expect(chat.createdAt).toBe(CREATED);
  });

  it('finds the active swipe by Marinara’s own number, and each swipe’s time', () => {
    const answer = read(FILE, 'Vera Solano__main__1a2b3c4d.jsonl').chat.messages[2];
    expect(answer?.activeSwipe).toBe(1);
    expect(answer?.swipes).toEqual([
      { text: 'Never.', at: CREATED + 2500 },
      { text: 'Always.', reasoning: 'Keep it short.', at: CREATED + 3000 },
      { text: 'Sometimes.', at: CREATED + 3500 },
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('what cannot be read', () => {
  it('skips a malformed line with its line number, and keeps every other line where it was', () => {
    const { chat, notes } = read(
      [
        JSON.stringify(HEADER),
        JSON.stringify(player('Anything unusual?', T0)),
        '{"name":"Vera Solano","is_user":false,"mes":"Define unus',
        JSON.stringify({ name: 'Vera Solano', is_user: false, note: 'no text at all' }),
        JSON.stringify(reply('Those are sealed.', T0 + 2)),
        '',
      ].join('\r\n'),
    );
    expect(chat.messages.map((message) => message.foreignId)).toEqual([`${PATH}#1`, `${PATH}#4`]);
    expect(notes.filter((note) => note.key === 'import.chat.lineUnreadable')).toEqual([
      { key: 'import.chat.lineUnreadable', params: { chat: chat.name, line: 3 }, level: 'warn' },
      { key: 'import.chat.lineUnreadable', params: { chat: chat.name, line: 4 }, level: 'warn' },
    ]);
  });

  it('reads a single chat whose header is corrupted as a single chat, by where it lives', () => {
    const { chat, meta, notes } = read(
      [
        '{"chat_metadata":{"integrity":"5a1b7c44-2f0e',
        // `getFirstMessage` (`script.js:7651`): no generation record, no batch.
        JSON.stringify({
          name: 'Vera Solano',
          is_user: false,
          is_system: false,
          send_date: iso(T0),
          mes: 'You again.',
          extra: {},
        }),
        JSON.stringify(player('Anything unusual?', T0 + 60_000)),
      ].join('\n'),
      'chats/Vera/Vera - 2024-07-12@01h00m00s000ms.jsonl',
    );

    expect(meta.group).toBe(false);
    expect(chat.messages[0]?.batch).toBeUndefined();
    expect(notes.filter((note) => note.key === 'import.chat.lineUnreadable')).toEqual([
      { key: 'import.chat.lineUnreadable', params: { chat: chat.name, line: 1 }, level: 'warn' },
    ]);
  });

  it('finds the header after a corrupted first line, and reads past a byte-order mark', () => {
    const { chat } = read(`\u{FEFF}{garbage\n${jsonl(HEADER, reply('You again.', T0))}`);
    expect(chat.messages.map((message) => message.text)).toEqual(['You again.']);
  });

  it.each<[string, string]>([
    ['an empty file', ''],
    ['only whitespace', '\n  \n'],
    ['plain text', 'Vera: You again.\nNed: Anything unusual?'],
    ['a pretty-printed JSON object rather than lines', '{\n  "name": "Vera Solano"\n}'],
  ])('refuses %s as unreadable', (_, text) => {
    expect(parseSillyTavernChat(text, PATH)).toEqual({ ok: false, refusal: 'unreadable' });
  });

  it('refuses a chat with a header and no messages', () => {
    expect(parseSillyTavernChat(jsonl(HEADER), PATH)).toEqual({
      ok: false,
      refusal: 'missing-field',
      field: 'messages',
    });
  });

  /** Every field the parser reads, holding anything JSON can. */
  const lineLike = fc.record(
    {
      mes: fc.jsonValue(),
      name: fc.jsonValue(),
      is_user: fc.jsonValue(),
      is_system: fc.jsonValue(),
      role: fc.oneof(fc.constantFrom('user', 'assistant', 'system', 'narrator'), fc.jsonValue()),
      send_date: fc.oneof(fc.string(), fc.double(), fc.jsonValue()),
      swipes: fc.oneof(fc.array(fc.jsonValue()), fc.jsonValue()),
      swipe_id: fc.oneof(fc.integer({ min: -2, max: 5 }), fc.jsonValue()),
      swipe_info: fc.oneof(fc.array(fc.jsonValue()), fc.jsonValue()),
      force_avatar: fc.oneof(
        fc.string().map((file) => `/thumbnail?type=avatar&file=${file}`),
        fc.jsonValue(),
      ),
      original_avatar: fc.jsonValue(),
      chat_metadata: fc.jsonValue(),
      extra: fc.oneof(
        fc.record(
          {
            type: fc.oneof(fc.constantFrom('narrator', 'comment', 'help'), fc.jsonValue()),
            gen_id: fc.jsonValue(),
            reasoning: fc.jsonValue(),
            marinara_role: fc.jsonValue(),
            marinara_swipes: fc.oneof(fc.array(fc.jsonValue()), fc.jsonValue()),
            tool_invocations: fc.jsonValue(),
            files: fc.jsonValue(),
          },
          { requiredKeys: [] },
        ),
        fc.jsonValue(),
      ),
    },
    { requiredKeys: [] },
  );

  it('never throws, whatever the lines hold', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(lineLike, fc.jsonValue(), fc.string())),
        fc.string(),
        (lines, path) => {
          const outcome = parseSillyTavernChat(jsonl(...lines), path);
          expect(typeof outcome.ok).toBe('boolean');
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never throws on bytes that are not text', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        expect(typeof parseSillyTavernChat(bytes, PATH).ok).toBe('boolean');
      }),
    );
  });
});

// ---------------------------------------------------------------------------

describe('through the P13.6 builder', () => {
  /**
   * A single-character chat as SillyTavern leaves it: a greeting with an
   * alternate (`getFirstMessage`'s greetings-as-swipes, `script.js:7664`), a
   * question, a reply swiped twice and then edited — its `swipes[swipe_id]`
   * left stale — and one more exchange.
   */
  const CHAT = jsonl(
    HEADER,
    {
      name: 'Vera Solano',
      is_user: false,
      is_system: false,
      send_date: iso(T0),
      mes: 'You again. Third time this week.',
      extra: {},
      swipe_id: 0,
      swipes: [
        'You again. Third time this week.',
        'The gate is closed. Come back when the tide turns.',
      ],
      swipe_info: [
        { send_date: iso(T0), extra: {} },
        { send_date: iso(T0), extra: {} },
      ],
    },
    player('Anything unusual?', T0 + 60_000),
    reply('Define “unusual”.', T0 + 70_000, {
      swipe_id: 1,
      swipes: ['Nothing worth your time.', 'Define unusual.', 'Ask the harbourmaster.'],
      swipe_info: [
        { send_date: iso(T0 + 65_000), extra: { reasoning: 'Nothing to hide.' } },
        { send_date: iso(T0 + 70_000), extra: {} },
        { send_date: iso(T0 + 75_000), extra: {} },
      ],
    }),
    player('The crates on pier nine.', T0 + 120_000),
    reply('Those are sealed by customs.', T0 + 130_000),
  );

  const parsedChat = read(CHAT);
  const family: ChatFamily = {
    source: 'sillytavern',
    key: parsedChat.chat.id,
    name: 'Vera Solano',
    chats: [parsedChat.chat],
  };
  const resolution: ChatResolution = {
    speakers: new Map([['Vera Solano.png', { id: 'actor-vera', name: 'Vera Solano' }]]),
    persona: null,
    lore: [],
  };
  const { document, notes } = buildSession(family, resolution, {
    account: 'ned',
    now: '2026-09-29T12:00:00.000Z',
    modeId: 'storyengine.scene',
  });
  const turns = document.turns;
  const text = (turn: Turn | undefined): string | undefined => turn?.output?.text;
  const childrenOf = (id: string | null): Turn[] =>
    turns.filter((turn) => turn.parentTurnId === id);

  it('opens on the greeting and its alternate, as sibling opening turns', () => {
    expect(childrenOf(null).map(text).sort()).toEqual([
      'The gate is closed. Come back when the tide turns.',
      'You again. Third time this week.',
    ]);
  });

  it('makes each swipe of the reply a sibling of the round, the edit on the active one', () => {
    const greeting = childrenOf(null).find(
      (turn) => text(turn) === 'You again. Third time this week.',
    );
    const round = childrenOf(greeting?.id ?? null);
    expect(round.map(text).sort()).toEqual([
      'Ask the harbourmaster.',
      'Define “unusual”.',
      'Nothing worth your time.',
    ]);
    expect(round.every((turn) => turn.input?.text === 'Anything unusual?')).toBe(true);
    // The stale copy is nowhere: `mes` replaced it.
    expect(JSON.stringify(document)).not.toContain('Define unusual.');
    // A sibling keeps its own swipe's reasoning and names its swipe as its source.
    const nothing = round.find((turn) => text(turn) === 'Nothing worth your time.');
    expect(nothing?.output?.messages?.[0]?.reasoning).toBe('Nothing to hide.');
    expect(nothing?.foreign).toEqual({ source: 'sillytavern', id: `${PATH}#3:swipe:0` });
  });

  it('continues from the active swipe, and remembers it', () => {
    const byId = new Map(turns.map((turn) => [turn.id, turn]));
    const path = walkPath(byId, document.session.headTurnId);
    expect(path.map(text)).toEqual([
      'You again. Third time this week.',
      'Define “unusual”.',
      'Those are sealed by customs.',
    ]);
    const [greeting, active] = path;
    // Only the greeting has a choice beneath it; roots never have an entry.
    expect(document.session['lastSelectedChild']).toEqual({ [greeting?.id ?? '']: active?.id });
  });

  it('names the speaker the library knows, from the chat’s folder', () => {
    const speakers = new Set(
      turns.flatMap((turn) => (turn.output?.messages ?? []).map((message) => message.speaker?.id)),
    );
    expect([...speakers]).toEqual(['actor-vera']);
    expect(notes).toContainEqual({
      key: 'import.chat.swipes',
      params: { count: 3 },
      level: 'info',
    });
  });
});
