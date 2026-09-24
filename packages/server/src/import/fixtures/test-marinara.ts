// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { makePng } from '../../storage/card/test-png.js';
import { encodeShardKey } from '../marinara/store-format.js';

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

/**
 * The same library as a storage format 5–7 store
 * ([P4 §7.18](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Every table sharded, and every file a real store leaves lying about beside
 * the shards**, because each of those files is a way the old reader was wrong:
 * the `.bak` beside most shards that doubled the library, the automatic
 * `.pre-shard` backups a migration keeps for ever, a torn `.tmp-`, a quarantined
 * `.corrupt-`, the launcher's `.post-unshard-` directory, a monolith an older
 * build wrote back after the migration, a shard that survives only as its
 * backup, a torn primary with a good backup, a row stranded in the wrong file,
 * and the orphan shard.
 *
 * Several of those carry *distinct, valid* rows on purpose. A decoy that holds
 * the same row as the real file is removed by the dedupe and proves nothing
 * about the filename filter; one holding `char_ghost_tmp` shows up in the
 * library the moment a reader stops filtering names.
 *
 * File names come from the production `encodeShardKey`, but **the owner column
 * each table shards by is spelled here, from upstream's map** (`file-backed-
 * store.ts:442-485` at `459f8b85b`), rather than read from `store-format.ts` —
 * a fixture that asked the reader which file a row belongs in would agree with
 * the reader by construction.
 */
export function marinaraShardedFixture({ version = 7 }: { version?: number } = {}): Record<
  string,
  Uint8Array | string
> {
  const tables = 'storage/tables';
  const at = (table: string, owner: string): string =>
    `${tables}/${table}/${encodeShardKey(owner)}.json`;
  const stamp = '2026-09-01T10-00-00-000Z';

  const maris = {
    id: 'char_maris',
    data: JSON.stringify({
      name: 'Maris Okonkwo',
      description: 'Ferry pilot.',
      first_mes: 'Aboard.',
    }),
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
  // A copy of Vera stranded in Maris's file, older, and named so a wrong pick
  // shows. Upstream keeps the copy in the file Vera's own id names.
  const strandedVera = {
    ...CHARACTER_ROW,
    data: JSON.stringify({ name: 'Vera Solano (stranded copy)', description: 'stale' }),
    createdAt: '2026-07-01T00:00:00.000Z',
  };
  const ghost = (id: string, name: string) => ({
    id,
    data: JSON.stringify({ name, description: 'Only in a file no reader should open.' }),
    createdAt: '2026-06-01T00:00:00.000Z',
  });
  const orphan = {
    id: 'entry_orphan',
    lorebookId: null,
    keys: ['nowhere'],
    content: 'An entry whose book was deleted.',
  };

  return {
    'storage/manifest.json': json({
      version,
      savedAt: '2026-09-20T12:00:00.000Z',
      backend: 'file-native',
      tables: {
        characters: 2,
        personas: 0,
        lorebooks: 1,
        lorebook_entries: 2,
        lorebook_folders: 0,
        lorebook_character_links: 1,
        prompt_presets: 1,
        prompt_sections: 2,
        prompt_groups: 0,
        choice_blocks: 0,
        messages: 2,
      },
    }),
    'storage/manifest.json.bak': json({ version, backend: 'file-native', tables: {} }),

    // characters, sharded by `id`. The stale backup is inserted before its
    // primary, so a reader that keeps the first copy it meets keeps the wrong one.
    [`${at('characters', 'char_vera')}.bak`]: json([
      { ...CHARACTER_ROW, data: JSON.stringify({ name: 'Vera Solano (one save ago)' }) },
    ]),
    [at('characters', 'char_vera')]: json([CHARACTER_ROW]),
    [at('characters', 'char_maris')]: json([maris, strandedVera]),
    [`${at('characters', 'char_maris')}.bak`]: json([maris]),
    [`${at('characters', 'char_vera')}.tmp-4242-1758000000000`]: json([
      ghost('char_ghost_tmp', 'Ghost from a torn write'),
    ]),
    [`${at('characters', 'char_vera')}.corrupt-${stamp}`]: json([
      ghost('char_ghost_corrupt', 'Ghost from quarantine'),
    ]),
    // What the migration kept, and what the launcher's unshard set aside.
    [`${tables}/characters.json.pre-shard`]: json([
      ghost('char_ghost_preshard', 'Ghost from before the migration'),
    ]),
    [`${tables}/characters.json.bak.pre-shard`]: json([]),
    [`${tables}/characters.post-unshard-${stamp}/${encodeShardKey('char_vera')}.json`]: json([
      {
        ...CHARACTER_ROW,
        data: JSON.stringify({ name: 'Vera Solano (unsharded)' }),
        createdAt: '2026-05-01T00:00:00.000Z',
      },
    ]),

    // lorebooks, sharded by `id`, surviving only as a backup.
    [`${at('lorebooks', 'book_rain_city')}.bak`]: json([LOREBOOK]),
    // lorebook_entries, sharded by `lorebookId` — and the orphan shard.
    [at('lorebook_entries', 'book_rain_city')]: json(LOREBOOK_ENTRIES),
    [`${at('lorebook_entries', 'book_rain_city')}.bak`]: json(LOREBOOK_ENTRIES),
    [`${tables}/lorebook_entries/orphaned-rows.json`]: json([orphan]),
    [at('lorebook_character_links', 'book_rain_city')]: json([
      { id: 'link_1', lorebookId: 'book_rain_city', characterId: 'char_vera' },
    ]),

    // prompt_presets by `id`, with a monolith an older build wrote back beside it.
    [at('prompt_presets', 'preset_harbour')]: json([PROMPT_PRESET]),
    [`${at('prompt_presets', 'preset_harbour')}.bak`]: json([PROMPT_PRESET]),
    [`${tables}/prompt_presets.json`]: json([{ ...PROMPT_PRESET, name: 'Harbour (downgrade)' }]),
    // prompt_sections by `presetId`: a torn primary and the good backup beside it.
    [at('prompt_sections', 'preset_harbour')]: '[{"id":"section_main","presetId":',
    [`${at('prompt_sections', 'preset_harbour')}.bak`]: json(PROMPT_SECTIONS),

    // Chat data, which import records rather than converts.
    [at('messages', 'chat_1')]: json([{ id: 'm1', chatId: 'chat_1', content: 'hi' }]),
    [`${at('messages', 'chat_1')}.bak`]: json([{ id: 'm1', chatId: 'chat_1', content: 'hi' }]),
    [`${tables}/messages/orphaned-rows.json`]: json([{ id: 'm2', chatId: null, content: '?' }]),
    [`${tables}/chats.json.post-downgrade-${stamp}`]: json([]),

    [at('api_connections', 'conn_1')]: json([
      { id: 'conn_1', name: 'local', apiKey: 'this must never reach disk' },
    ]),
    '.encryption-key': 'not a real key, and not one that should be read either',
    'avatars/char_vera.png': makePng(),
  };
}

/** Writes a fixture tree under `root`, for the tests that read from a real directory. */
export async function writeFixtureTree(
  root: string,
  tree: Record<string, Uint8Array | string>,
): Promise<void> {
  for (const [path, value] of Object.entries(tree)) {
    const full = join(root, ...path.split('/'));
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, value);
  }
}
