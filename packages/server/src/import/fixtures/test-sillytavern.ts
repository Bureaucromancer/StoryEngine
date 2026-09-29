// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  base64TextChunk,
  base64ZTextChunk,
  makePng,
  withChunks,
} from '../../storage/card/test-png.js';

/**
 * A synthesised SillyTavern user directory
 * ([P4 §1.2](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Synthesised, and this is the whole corpus the phase gets.** Character cards
 * are other people's authored content and generally not redistributable
 * ([testing §5](../../../../../docs/design/workplan/03-testing.md)), and there is
 * no used SillyTavern install on hand either — so the in-repo set carries P4,
 * and walking a real library is a named outstanding task owned by
 * [P5 §1.6](../../../../../docs/design/workplan/17-p5-implementation.md).
 *
 * **Content, not files.** The tree is a map of relative path to bytes, which a
 * `MemoryFileSource` reads directly and a materialiser writes to disk when a
 * test needs a real directory. Card images are built rather than committed: a
 * binary in a diff is a binary nobody reviews, and everything interesting about
 * these cards is in the chunk payload, which is text.
 *
 * Every structural oddity below is one a real corpus is known to contain, and
 * each says what it is for. A fixture nobody can explain is a fixture that gets
 * deleted in the next cleanup.
 */

const VERA = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Vera Solano',
    description: 'A dock inspector who notices what the manifests leave out.',
    personality: 'wry, patient, unbribable',
    scenario: 'The rain has not stopped in eleven days and the harbour is behind on inspections.',
    first_mes: 'You again. Third time this week.',
    mes_example: '<START>\n{{user}}: Anything unusual?\n{{char}}: Define unusual.',
    alternate_greetings: ['The gate is closed. Come back when the tide turns.'],
    system_prompt: '',
    post_history_instructions: '',
    creator_notes: '',
    tags: ['noir', 'harbour'],
    extensions: { talkativeness: '0.6', depth_prompt: { prompt: '', depth: 4 } },
  },
};

/** V3 beside V2, which the reader must prefer — the upgraded-card case. */
const MARIS = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: 'Maris Okonkwo',
    description: 'Runs the night ferry and asks no questions worth answering.',
    personality: 'Terse. Watches the water.',
    scenario: '',
    first_mes: 'Pay at the rail.',
    mes_example: '',
    alternate_greetings: [],
    extensions: {},
  },
};

/**
 * The chat-completion preset the fixture *pair* assertion needs
 * ([testing §5.1]): a card importer and a preset importer convert opposite ends
 * of one format and can each be correct while disagreeing. Its slots are the
 * ones the assertion names — persona, description, personality, history — so a
 * mapping that sends `personality` somewhere the preset does not read shows up
 * as an `empty-source` row rather than as silence.
 */
const OPENAI_PRESET = {
  chat_completion_source: 'openai',
  openai_model: 'gpt-4',
  openai_max_context: 8192,
  openai_max_tokens: 512,
  temperature: 0.9,
  frequency_penalty: 0.1,
  // Dropped unconditionally and named in the review ([04 §8.4.4]). Present here
  // because gate step 3 is a property over the imported corpus, and a corpus
  // with no credential in it cannot fail that test.
  reverse_proxy: 'https://example.invalid/v1',
  proxy_password: 'this must never reach disk',
  prompts: [
    {
      identifier: 'main',
      name: 'Main Prompt',
      system_prompt: true,
      role: 'system',
      content: 'Write the scene.',
    },
    { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
    { identifier: 'charPersonality', name: 'Char Personality', system_prompt: true, marker: true },
    {
      identifier: 'personaDescription',
      name: 'Persona Description',
      system_prompt: true,
      marker: true,
    },
    { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
    {
      identifier: 'worldInfoBefore',
      name: 'World Info (before)',
      system_prompt: true,
      marker: true,
    },
    // Depth injection, which gate step 4 measures in **messages** — the fixture
    // has to contain one or the assertion has nothing to look at.
    {
      identifier: 'atDepth4',
      name: 'A note four messages back',
      role: 'system',
      content: 'Keep the rain in frame.',
      injection_position: 1,
      injection_depth: 4,
      injection_order: 100,
    },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'personaDescription', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'charPersonality', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'atDepth4', enabled: true },
      ],
    },
  ],
};

const RAIN_CITY_BOOK = {
  name: 'Rain City',
  entries: {
    '0': {
      uid: 0,
      key: ['docks', 'harbour'],
      keysecondary: [],
      comment: 'The docks',
      content: 'The docks run on paperwork and nobody reads it.',
      constant: false,
      selective: true,
      selectiveLogic: 0,
      order: 100,
      position: 0,
      disable: false,
      depth: 4,
      probability: 100,
    },
    '1': {
      uid: 1,
      key: ['council'],
      keysecondary: [],
      comment: 'The council',
      content: 'The harbour council meets on the first of the month and settles nothing.',
      constant: false,
      selective: true,
      selectiveLogic: 0,
      order: 100,
      // An author's-note position, which has no arm of ours: it collapses to the
      // nearest sequence arm **with a review flag naming the original**, never
      // silently reinterpreted ([P4 §1.11]).
      position: 4,
      disable: false,
      depth: 4,
      probability: 100,
    },
  },
};

const json = (value: unknown): string => JSON.stringify(value, null, 2);

/**
 * The tree, as paths to bytes.
 *
 * Directory names are SillyTavern's own, from the vendored registry — including
 * the two with spaces in them, which are the ones a path bug finds first.
 */
export function sillyTavernFixture(): Record<string, Uint8Array | string> {
  return {
    'settings.json': json({
      power_user: {
        personas: { 'inspector.png': 'The Inspector' },
        persona_descriptions: {
          'inspector.png': { description: 'You are the one who signs the forms.', position: 0 },
        },
      },
    }),

    // An ordinary V2 card.
    'characters/Vera Solano.png': withChunks(makePng(), [base64TextChunk('chara', VERA)]),
    // A card whose newer payload sits in a **compressed** chunk, which nothing
    // here could read before P4.0 — Character Tavern writes them this way, and a
    // reader handling `tEXt` alone does not see them as cards at all.
    'characters/Maris Okonkwo.png': withChunks(makePng(), [
      base64TextChunk('chara', { ...MARIS, spec: 'chara_card_v2' }),
      base64ZTextChunk('ccv3', MARIS),
    ]),
    // Deliberately corrupt: gate step 8 says one poisoned file never aborts a
    // sweep, and a corpus without one cannot prove it.
    'characters/broken.png': 'this is not a PNG and never was',

    'worlds/Rain City.json': json(RAIN_CITY_BOOK),
    'OpenAI Settings/Harbour.json': json(OPENAI_PRESET),

    // Personas: the image here, the text in `settings.json` ([survey §3]).
    'User Avatars/inspector.png': makePng(),

    // One file per remaining disposition class, so the review's counts are
    // exercised rather than assumed.
    'backgrounds/harbour.png': makePng(),
    'instruct/Alpaca.json': json({ name: 'Alpaca', wrap: true }),
    'chats/Vera Solano/2026-01-01.jsonl': '{"name":"You","mes":"hello"}\n',
    'QuickReplies/greetings.json': json({ name: 'greetings', qrList: [] }),
    'vectors/rain-city/index.json': json({ vectors: [] }),
  };
}
