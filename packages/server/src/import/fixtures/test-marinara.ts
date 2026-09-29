// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { makePng } from '../../storage/card/test-png.js';

/**
 * A synthesised Marinara data root
 * ([P4 §1.2](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **A data root rather than a folder of files**, because that is what a Marinara
 * library is: a relational store written as JSON, where one file holds many rows
 * and an object is a join across several
 * ([survey §1](../../../../../docs/design/01-source-survey.md)). Synthesising
 * this one meant reading the schema at the pinned commit and authoring rows
 * against it — the checkout is a **schema oracle, cited by commit, never
 * vendored content**. Copying an install's bundled default character into a
 * fixture would be redistributing somebody's authored card under cover of a
 * test, which is exactly what the corpus policy exists to prevent.
 *
 * **The message tables are sharded**, which is the point of having this at
 * all. At storage format 4 sixteen tables split into
 * `storage/tables/<table>/<key>.json` while the rest stay a single file, so a
 * reader tested against flat tables alone is a reader tested against half the
 * layouts a real install can be in.
 */

const json = (value: unknown): string => JSON.stringify(value);

/**
 * A character row, which carries its card as a **JSON string inside the JSON
 * row** — double-encoded, and the first thing a converter written against the
 * table shape gets wrong.
 */
const CHARACTER_ROW = {
  id: 'char_vera',
  data: JSON.stringify({
    name: 'Vera Solano',
    description: 'A dock inspector who notices what the manifests leave out.',
    personality: 'wry, patient, unbribable',
    scenario: 'Eleven days of rain and the harbour is behind on inspections.',
    first_mes: 'You again. Third time this week.',
    mes_example: '',
    // Marinara's cards are V2 plus fifteen engine fields, which ride to `compat`
    // verbatim ([00 §2.4]).
    extensions: { talkativeness: 0.6, convoBehavior: 'reactive' },
  }),
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/**
 * A preset and its sections, which are a separate table pointing back by id.
 *
 * ***As Marinara stores them*** (2026-09-27). This fixture was written in the
 * API's shape — `packages/shared/src/types/prompt.ts`, where `sectionOrder` is
 * an array and `markerConfig` an object — while what a store holds is
 * `packages/server/src/db/schema/prompts.ts`'s: text columns carrying JSON,
 * and booleans as `"true"` and `"false"`. The converter was written against
 * the fixture, so it read neither, and every real preset lost its order and
 * its markers without a test noticing. The rows below are the stored shape.
 */
const PROMPT_PRESET = {
  id: 'preset_harbour',
  name: 'Harbour',
  description: 'The one the fixture pair reads.',
  imagePath: null,
  conversationPrompt: 'You are {{charName}} talking to {{userName}}.',
  gamePrompt: '',
  sectionOrder: json(['section_main', 'section_history']),
  groupOrder: '[]',
  variableGroups: '[]',
  variableValues: '{}',
  parameters: json({ temperature: 0.8, maxTokens: 600, reasoningEffort: 'maximum' }),
  wrapFormat: 'xml',
  defaultChoices: '{}',
  isDefault: 'false',
  author: '',
  systemKey: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const PROMPT_SECTIONS = [
  {
    id: 'section_main',
    presetId: 'preset_harbour',
    identifier: 'main',
    name: 'Role',
    content: 'Write the scene.',
    role: 'system',
    enabled: 'true',
    isMarker: 'false',
    groupId: null,
    markerConfig: null,
    injectionPosition: 'ordered',
    injectionDepth: 0,
    injectionOrder: 0,
    wrapInXml: 'false',
    xmlTagName: '',
    forbidOverrides: 'false',
  },
  {
    id: 'section_history',
    presetId: 'preset_harbour',
    identifier: 'chat_history',
    name: 'History',
    content: '',
    role: 'system',
    // A marker section, which is our slot block ([P4 §1.5]).
    enabled: 'true',
    isMarker: 'true',
    groupId: null,
    markerConfig: json({ type: 'chat_history' }),
    // Depth injection, counted from the last message exactly as ours is.
    injectionPosition: 'depth',
    injectionDepth: 4,
    injectionOrder: 100,
    wrapInXml: 'false',
    xmlTagName: '',
    forbidOverrides: 'false',
  },
];

/** Booleans as text and lists as JSON text, as its schema has them (2026-09-27). */
const LOREBOOK = {
  id: 'book_rain_city',
  name: 'Rain City',
  description: 'Harbour lore.',
  category: 'uncategorized',
  enabled: 'true',
  isGlobal: 'false',
  tags: '[]',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const LOREBOOK_ENTRIES = [
  {
    id: 'entry_docks',
    lorebookId: 'book_rain_city',
    folderId: null,
    name: 'Docks',
    keys: json(['docks', 'harbour']),
    secondaryKeys: '[]',
    content: 'The docks run on paperwork and nobody reads it.',
    enabled: 'true',
    constant: 'false',
    selective: 'false',
    selectiveLogic: 'and',
    matchWholeWords: 'false',
    caseSensitive: 'false',
    useRegex: 'false',
    position: 0,
    depth: 4,
    order: 100,
  },
];

/**
 * ***The chats*** —
 * [P13.10](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * Rows in the stored shape (`db/schema/chats.ts` at the pin): `characterIds`,
 * `metadata` and every `extra` as JSON **text**, a `message_swipes` row for
 * every message — `createMessage` writes swipe 0 whether or not there is ever a
 * second (`chats.storage.ts:1065`) — and the messages **sharded by chat**, the
 * layout the table has at storage format 4.
 *
 * What each chat is here to prove:
 * - **`chat_1`**, a single-character roleplay whose third message was swiped
 *   and then **edited**: its message row holds the edit, and the active swipe's
 *   own row still holds the text from before it ([P13 §0.3], `setActiveSwipe`
 *   only syncs the row when switching away). One narrator line is hidden from
 *   the model (`hiddenFromAI`).
 * - **`chat_2`**, a **branch** of `chat_1` (`branchParentChatId`), copied as
 *   Marinara copies one: new message ids, the same times, the active swipe's row
 *   written from the message's current text (`chats.routes.ts:3818-3826`), and
 *   then played differently. One session with the prefix once, two refs.
 * - **`chat_group`**, a three-member roleplay played individually with manual
 *   order and names in history; its third member is inactive, as is a member
 *   no longer in the chat, whom nothing may mute ([P13 §2.6]). Its user line
 *   is a **conversation start**, so the two replies before it were never sent
 *   again and come in hidden. Its rolling summary (`hideSummarisedMessages`)
 *   hid one later reply, which comes in visible because the summary does not;
 *   the reply the person hid by hand stays hidden.
 * - **`chat_dm`**, a `conversation` chat, which stays recorded.
 * - An orphaned message in `orphaned-rows.json`, counted and not imported.
 * - A `.json.bak` beside a message shard and a swipe shard, as Marinara keeps
 *   one beside every shard: the same rows again, which must not double them.
 */
const at = (minute: number): string => new Date(Date.UTC(2026, 7, 2, 21, minute)).toISOString();

interface MessageSpec {
  id: string;
  minute: number;
  role: 'user' | 'assistant' | 'system' | 'narrator';
  characterId?: string;
  content: string;
  extra?: Record<string, unknown>;
  /** Alternatives beyond swipe 0's row, and which one is active. */
  swipes?: { rows: string[]; active: number };
}

function chatTables(chatId: string, specs: readonly MessageSpec[]) {
  const messages = specs.map((spec) => ({
    id: spec.id,
    chatId,
    role: spec.role,
    characterId: spec.characterId ?? null,
    content: spec.content,
    activeSwipeIndex: spec.swipes?.active ?? 0,
    extra: json({ isGenerated: spec.role !== 'user', ...spec.extra }),
    createdAt: at(spec.minute),
  }));
  const swipes = specs.flatMap((spec) =>
    (spec.swipes?.rows ?? [spec.content]).map((content, index) => ({
      id: `${spec.id}_s${String(index)}`,
      messageId: spec.id,
      index,
      content,
      extra: '{}',
      createdAt: at(spec.minute),
    })),
  );
  return { messages, swipes };
}

const INSPECTOR = { personaSnapshot: { personaId: 'persona_inspector', name: 'The Inspector' } };

/** The opening three messages, which the branch copies. */
function prefix(ids: [string, string, string], rows: string[]): MessageSpec[] {
  return [
    {
      id: ids[0],
      minute: 0,
      role: 'assistant',
      characterId: 'char_vera',
      content: 'You again. Third time this week.',
    },
    { id: ids[1], minute: 1, role: 'user', content: 'Manifests?', extra: INSPECTOR },
    {
      id: ids[2],
      minute: 2,
      role: 'assistant',
      characterId: 'char_vera',
      content: 'Define unusual.',
      extra: { thinking: 'She is stalling.' },
      swipes: { rows, active: 1 },
    },
  ];
}

const ROOT = chatTables('chat_1', [
  // Swipe 1's row is the text before the edit: the message row is the truth.
  ...prefix(['msg_01', 'msg_02', 'msg_03'], ['What about them?', 'Define unsual.']),
  { id: 'msg_04', minute: 3, role: 'user', content: 'Crates from the north.', extra: INSPECTOR },
  {
    id: 'msg_05',
    minute: 4,
    role: 'narrator',
    content: 'The rain gets heavier.',
    extra: { hiddenFromAI: true },
  },
  {
    id: 'msg_06',
    minute: 5,
    role: 'assistant',
    characterId: 'char_vera',
    content: 'Sealed, all of them.',
  },
]);

const BRANCH = chatTables('chat_2', [
  // Copied with the active swipe's row written from the message's own text.
  ...prefix(['msg_b1', 'msg_b2', 'msg_b3'], ['What about them?', 'Define unusual.']),
  {
    id: 'msg_b4',
    minute: 6,
    role: 'user',
    content: 'Anything with a false bottom?',
    extra: INSPECTOR,
  },
  { id: 'msg_b5', minute: 7, role: 'assistant', characterId: 'char_vera', content: 'Two.' },
]);

const GROUP = chatTables('chat_group', [
  { id: 'msg_g1', minute: 10, role: 'assistant', characterId: 'char_vera', content: 'You again.' },
  {
    id: 'msg_g2',
    minute: 11,
    role: 'assistant',
    characterId: 'char_maris',
    content: 'Pay at the rail.',
  },
  {
    id: 'msg_g3',
    minute: 12,
    role: 'user',
    content: 'Two tickets.',
    extra: { isConversationStart: true },
  },
  {
    id: 'msg_g4',
    minute: 13,
    role: 'assistant',
    characterId: 'char_vera',
    content: 'Who is the second for?',
    // Hidden by the summary entry below, not by the person.
    extra: { hiddenFromAI: true },
  },
  {
    id: 'msg_g5',
    minute: 14,
    role: 'assistant',
    characterId: 'char_maris',
    content: 'Cash only.',
    // Hidden by hand: no summary entry claims it.
    extra: { hiddenFromAI: true },
  },
]);

const DM = chatTables('chat_dm', [
  { id: 'msg_d1', minute: 20, role: 'assistant', characterId: 'char_vera', content: 'you up?' },
]);

/** A chat row as the store keeps one: lists and metadata as JSON text. */
function chatRow(
  id: string,
  name: string,
  mode: string,
  characterIds: string[],
  metadata: Record<string, unknown>,
  minute: number,
) {
  return {
    id,
    name,
    mode,
    characterIds: json(characterIds),
    groupId: 'thread_harbour',
    personaId: 'persona_inspector',
    promptPresetId: 'preset_harbour',
    connectionId: null,
    metadata: json({
      summary: null,
      tags: [],
      enableAgents: false,
      activeAgentIds: [],
      ...metadata,
    }),
    connectedChatId: null,
    folderId: null,
    sortOrder: 0,
    createdAt: at(minute),
    updatedAt: at(minute),
  };
}

const CHATS = [
  chatRow('chat_1', 'Harbour Night', 'roleplay', ['char_vera'], {}, 0),
  chatRow(
    'chat_2',
    'Harbour Night',
    'roleplay',
    ['char_vera'],
    { branchName: 'False bottoms', branchParentChatId: 'chat_1' },
    6,
  ),
  chatRow(
    'chat_group',
    'Night Crossing',
    'roleplay',
    ['char_maris', 'char_vera', 'char_lund'],
    {
      groupChatMode: 'individual',
      groupResponseOrder: 'manual',
      groupSpeakerNamesInHistory: true,
      inactiveCharacterIds: ['char_lund', 'char_gone'],
      hideSummarisedMessages: true,
      summaryEntries: [
        {
          id: 'summary_1',
          kind: 'rolling',
          content: 'Two tickets were asked for.',
          enabled: true,
          messageIds: ['msg_g3', 'msg_g4'],
          hiddenMessageIds: ['msg_g4'],
        },
      ],
    },
    10,
  ),
  chatRow('chat_dm', 'Vera (DMs)', 'conversation', ['char_vera'], {}, 20),
];

/** Two more characters for the group, stored as Vera is. */
function characterRow(id: string, name: string, description: string) {
  return { ...CHARACTER_ROW, id, data: JSON.stringify({ name, description, first_mes: '' }) };
}

const CHARACTERS = [
  CHARACTER_ROW,
  characterRow('char_maris', 'Maris Okonkwo', 'Runs the ferry, and the ferry’s prices.'),
  characterRow('char_lund', 'Lund Harrow', 'The harbourmaster.'),
];

/** A persona, which is its own row rather than a card in a `data` column. */
const PERSONA = {
  id: 'persona_inspector',
  name: 'The Inspector',
  description: 'Signs the forms.',
  isActive: 'true',
  createdAt: at(0),
  updatedAt: at(0),
};

/**
 * The tree, as paths to bytes.
 *
 * The manifest declares format 2 while `messages` is stored **sharded**, which
 * is format 4's layout. That is not a mistake in the fixture: Marinara's own
 * code records that a crash between the shard migration and its first flush
 * leaves sharded data under a version-2 manifest, so a reader that trusts the
 * manifest for the layout reads this install wrong. The fixture is the case that
 * proves the reader asks the filesystem instead.
 */
export function marinaraFixture(): Record<string, Uint8Array | string> {
  return {
    'storage/manifest.json': json({
      version: 2,
      savedAt: '2026-08-08T01:28:16.537Z',
      backend: 'file-native',
      tables: {
        characters: CHARACTERS.length,
        personas: 1,
        prompt_presets: 1,
        prompt_sections: 2,
        lorebooks: 1,
        chats: CHATS.length,
        messages: [ROOT, BRANCH, GROUP, DM].reduce((sum, chat) => sum + chat.messages.length, 1),
        message_swipes: [ROOT, BRANCH, GROUP, DM].reduce(
          (sum, chat) => sum + chat.swipes.length,
          0,
        ),
      },
    }),
    // A `.bak` beside the manifest, which holds the same rows rather than more
    // of them — reading both doubles the library, and gate step 15 says so.
    'storage/manifest.json.bak': json({ version: 2, backend: 'file-native', tables: {} }),

    'storage/tables/characters.json': json(CHARACTERS),
    'storage/tables/characters.json.bak': json(CHARACTERS),
    'storage/tables/personas.json': json([PERSONA]),
    'storage/tables/prompt_presets.json': json([PROMPT_PRESET]),
    'storage/tables/prompt_sections.json': json(PROMPT_SECTIONS),
    'storage/tables/prompt_groups.json': json([]),
    'storage/tables/choice_blocks.json': json([]),
    'storage/tables/lorebooks.json': json([LOREBOOK]),
    'storage/tables/lorebook_entries.json': json(LOREBOOK_ENTRIES),
    'storage/tables/lorebook_folders.json': json([]),
    'storage/tables/lorebook_character_links.json': json([
      { lorebookId: 'book_rain_city', characterId: 'char_vera' },
    ]),

    // Credentials, which must never land — not in the object and not in
    // `compat`. Gate step 3 runs as a property over the imported corpus, so the
    // corpus has to contain one.
    'storage/tables/api_connections.json': json([
      { id: 'conn_1', name: 'local', apiKey: 'this must never reach disk' },
    ]),
    '.encryption-key': 'not a real key, and not one that should be read either',

    // The chats ([P13.10]): the chat rows flat, and the messages and swipes in
    // the sharded layout, one shard per chat — which proves the reader handles
    // both — each with a `.bak` beside one shard, plus the shard of rows
    // Marinara could not place.
    'storage/tables/chats.json': json(CHATS),
    'storage/tables/message_swipes/chat_1.json': json(ROOT.swipes),
    'storage/tables/message_swipes/chat_1.json.bak': json(ROOT.swipes),
    'storage/tables/message_swipes/chat_2.json': json(BRANCH.swipes),
    'storage/tables/message_swipes/chat_group.json': json(GROUP.swipes),
    'storage/tables/message_swipes/chat_dm.json': json(DM.swipes),
    'storage/tables/messages/chat_1.json': json(ROOT.messages),
    'storage/tables/messages/chat_1.json.bak': json(ROOT.messages),
    'storage/tables/messages/chat_2.json': json(BRANCH.messages),
    'storage/tables/messages/chat_group.json': json(GROUP.messages),
    'storage/tables/messages/chat_dm.json': json(DM.messages),
    'storage/tables/messages/orphaned-rows.json': json([
      {
        id: 'msg_orphan',
        chatId: null,
        role: 'user',
        characterId: null,
        content: '?',
        activeSwipeIndex: 0,
        extra: '{}',
        createdAt: at(30),
      },
    ]),

    // Assets referenced by the rows above. A real PNG, so the happy path is
    // exercised rather than assumed…
    'avatars/char_vera.png': makePng(),
    // …and one that is not, because an avatar file that is not an image used to
    // cost the whole character. A bad portrait must cost the portrait.
    'avatars/char_broken.png': 'pretend this is a portrait',
  };
}
