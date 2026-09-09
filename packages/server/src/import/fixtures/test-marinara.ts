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
 * **One table is sharded**, which is the point of having this at all. At storage
 * format 4 sixteen tables split into `storage/tables/<table>/<key>.json` while
 * the rest stay a single file, so a reader tested against flat tables alone is a
 * reader tested against half the layouts a real install can be in.
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

/** A preset and its sections, which are a separate table pointing back by id. */
const PROMPT_PRESET = {
  id: 'preset_harbour',
  name: 'Harbour',
  description: 'The one the fixture pair reads.',
  imagePath: null,
  conversationPrompt: 'You are {{charName}} talking to {{userName}}.',
  gamePrompt: '',
  sectionOrder: ['section_main', 'section_history'],
  groupOrder: [],
  wrapFormat: 'xml',
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
    markerConfig: { type: 'chat_history' },
    // Depth injection, counted from the last message exactly as ours is.
    injectionPosition: 'depth',
    injectionDepth: 4,
    injectionOrder: 100,
    wrapInXml: 'false',
    xmlTagName: '',
    forbidOverrides: 'false',
  },
];

const LOREBOOK = {
  id: 'book_rain_city',
  name: 'Rain City',
  description: 'Harbour lore.',
  enabled: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const LOREBOOK_ENTRIES = [
  {
    id: 'entry_docks',
    lorebookId: 'book_rain_city',
    keys: ['docks', 'harbour'],
    content: 'The docks run on paperwork and nobody reads it.',
    enabled: 1,
    selectiveLogic: 'and',
    position: 0,
    depth: 4,
  },
];

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
      tables: { characters: 1, prompt_presets: 1, prompt_sections: 2, lorebooks: 1, messages: 1 },
    }),
    // A `.bak` beside the manifest, which holds the same rows rather than more
    // of them — reading both doubles the library, and gate step 15 says so.
    'storage/manifest.json.bak': json({ version: 2, backend: 'file-native', tables: {} }),

    'storage/tables/characters.json': json([CHARACTER_ROW]),
    'storage/tables/characters.json.bak': json([CHARACTER_ROW]),
    'storage/tables/personas.json': json([]),
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

    // The sharded half: chat data, which import does not take, in the layout
    // that proves the reader handles both.
    'storage/tables/messages/chat_1.json': json([{ id: 'm1', chatId: 'chat_1', content: 'hi' }]),
    'storage/tables/messages/orphaned-rows.json': json([{ id: 'm2', chatId: null, content: '?' }]),

    // Assets referenced by the rows above. A real PNG, so the happy path is
    // exercised rather than assumed…
    'avatars/char_vera.png': makePng(),
    // …and one that is not, because an avatar file that is not an image used to
    // cost the whole character. A bad portrait must cost the portrait.
    'avatars/char_broken.png': 'pretend this is a portrait',
  };
}
