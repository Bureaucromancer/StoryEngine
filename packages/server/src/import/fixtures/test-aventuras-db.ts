// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { makePng } from '../../storage/card/test-png.js';

/**
 * ***A synthesised Aventuras install: one SQLite database*** —
 * [P13 §3](../../../../../docs/design/workplan/30-p13-aventuras-import.md)'s
 * test obligations, first met at P13.2 and reused by every Part 1 stage after.
 *
 * **Built from hand-written DDL, never from Aventuras' migrations.** Those are
 * AGPL-3.0 text from another project that would need their own attribution
 * beside our SPDX pair, and replaying thirty-nine of them would pin every test
 * to far more schema than the reader reads. So each table below has **the
 * columns a reader here selects** — the names checked against the schema
 * replayed at the pin (`c43da108`, migration 039), the types and constraints
 * written to hold the rows and no more — plus `_sqlx_migrations`, which is the
 * migration runner's and carries the version the gate reads. A column's name
 * is a fact about the file somebody hands us; none of the migrations' text is
 * here.
 *
 * ***The version decides the shape, as it does in a real install.*** Each
 * table and each late column records the migration that brought it, so a
 * database built at 35 has no `baseline_hash` (036), no `kept_separate` (037),
 * no `time_anchors` (038) and no `starting_time` (039), which is what a backup
 * from then holds. The options then bend that shape the ways a test needs:
 * a column or a table missing where it should be, one more of either, no
 * migrations recorded at all.
 *
 * ***The rows carry the awkward cases the later stages exist for***, named
 * where they are made: a PNG portrait as a data URL and a JPEG one; the legacy
 * string-array `visual_descriptors`; an empty vault lorebook and one with a
 * repeated entry name; a scenario and a character linked to a lorebook by id;
 * tags of one name in two kinds and two colours; a non-default pack with one
 * template somebody edited; a settings table with a provider key in it; and
 * two stories with different numbers of everything, and beside them the edits
 * and tombstones Aventuras' copy-on-write branches leave, which are rows and
 * not things a story holds. *Since P13.3*, the characters a reader has to read
 * around — a corrupt portrait, a truncated one, bare base64, a mislabelled
 * WebP, a link, unreadable JSON columns, a row with no id — are
 * {@link AWKWARD_CHARACTERS}, added only when a test asks for them; *since
 * P13.4*, the lorebooks — a twin of a book's name, entries that will not
 * parse or are not a list, entries missing their fields, a row with no id —
 * are {@link AWKWARD_LOREBOOKS}, on the same terms; *since P13.5*, the
 * scenarios — a cast, openings or metadata that will not read, tags and a
 * starting time that will not either, links to a book that is not there and to
 * one that is refused, no setting, a row with no id — are
 * {@link AWKWARD_SCENARIOS}; *since P13.6*, the tags — hex and grey colours,
 * one that is no colour, a name that is another's in other case, an empty
 * one, one too long, a row with no id — are {@link AWKWARD_TAGS}.
 *
 * Composable on purpose: {@link buildAventurasDatabase} works on any open
 * connection, so a later stage can add its own rows before or after, and the
 * row arrays are exported so its assertions read from the same source.
 */

/** One column: its DDL, and the migration that added it when that was after its table. */
type Column = string | { sql: string; since: number };

/** A table: the migration that created it, and its columns. */
interface TableSpec {
  since: number;
  columns: readonly Column[];
}

/**
 * The copy-on-write columns of the five tables of a story's world:
 * `overrides_id` (026) names the entity a branch's row edits, and `deleted`
 * (028) makes a row a tombstone. See {@link STORY_COW_ROWS}.
 */
const COPY_ON_WRITE: readonly Column[] = [
  { sql: 'overrides_id TEXT', since: 26 },
  { sql: 'deleted INTEGER NOT NULL DEFAULT 0', since: 28 },
];

/**
 * **The whole schema, as far as this project reads it.** Hand-written; see
 * the file header. Tables the reader only counts get an id, their `story_id`
 * where they have one, and whatever the rows below need to be told apart.
 */
const SCHEMA: Readonly<Record<string, TableSpec>> = {
  _sqlx_migrations: {
    since: 0,
    columns: [
      'version INTEGER PRIMARY KEY',
      'description TEXT NOT NULL',
      'success INTEGER NOT NULL',
    ],
  },
  settings: { since: 1, columns: ['key TEXT PRIMARY KEY', 'value TEXT NOT NULL'] },
  templates: { since: 1, columns: ['id TEXT PRIMARY KEY', 'name TEXT NOT NULL'] },
  stories: { since: 1, columns: ['id TEXT PRIMARY KEY', 'title TEXT NOT NULL'] },
  story_entries: {
    since: 1,
    columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'type TEXT', 'content TEXT'],
  },
  characters: {
    since: 1,
    columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'name TEXT', ...COPY_ON_WRITE],
  },
  locations: {
    since: 1,
    columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'name TEXT', ...COPY_ON_WRITE],
  },
  items: {
    since: 1,
    columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'name TEXT', ...COPY_ON_WRITE],
  },
  story_beats: {
    since: 1,
    columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'title TEXT', ...COPY_ON_WRITE],
  },
  chapters: {
    since: 2,
    columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'number INTEGER'],
  },
  checkpoints: {
    since: 2,
    columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'name TEXT'],
  },
  entries: {
    since: 3,
    columns: [
      'id TEXT PRIMARY KEY',
      'story_id TEXT NOT NULL',
      'name TEXT',
      'type TEXT',
      ...COPY_ON_WRITE,
    ],
  },
  embedded_images: {
    since: 11,
    columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'entry_id TEXT'],
  },
  branches: { since: 13, columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'name TEXT'] },
  character_vault: {
    since: 16,
    columns: [
      'id TEXT PRIMARY KEY',
      'name TEXT NOT NULL',
      'description TEXT',
      'traits TEXT',
      'visual_descriptors TEXT',
      'portrait TEXT',
      'tags TEXT',
      'favorite INTEGER',
      'source TEXT',
      'original_story_id TEXT',
      'metadata TEXT',
      'created_at INTEGER',
      'updated_at INTEGER',
    ],
  },
  lorebook_vault: {
    since: 17,
    columns: [
      'id TEXT PRIMARY KEY',
      'name TEXT NOT NULL',
      'description TEXT',
      'entries TEXT',
      'tags TEXT',
      'favorite INTEGER',
      'source TEXT',
      'original_filename TEXT',
      'original_story_id TEXT',
      'metadata TEXT',
      'created_at INTEGER',
      'updated_at INTEGER',
    ],
  },
  scenario_vault: {
    since: 18,
    columns: [
      'id TEXT PRIMARY KEY',
      'name TEXT NOT NULL',
      'description TEXT',
      'setting_seed TEXT',
      'npcs TEXT',
      'primary_character_name TEXT',
      'first_message TEXT',
      'alternate_greetings TEXT',
      'tags TEXT',
      'favorite INTEGER',
      'source TEXT',
      'original_filename TEXT',
      'metadata TEXT',
      'created_at INTEGER',
      'updated_at INTEGER',
      { sql: 'starting_time TEXT', since: 39 },
    ],
  },
  vault_tags: {
    since: 22,
    columns: [
      'id TEXT PRIMARY KEY',
      'name TEXT NOT NULL',
      'type TEXT NOT NULL',
      'color TEXT NOT NULL',
      'created_at INTEGER',
    ],
  },
  background_images: { since: 24, columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL'] },
  world_state_snapshots: {
    since: 25,
    columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'entry_id TEXT'],
  },
  preset_packs: {
    since: 30,
    columns: [
      'id TEXT PRIMARY KEY',
      'name TEXT NOT NULL',
      'description TEXT',
      'author TEXT',
      'is_default INTEGER',
      'created_at INTEGER',
      'updated_at INTEGER',
    ],
  },
  pack_templates: {
    since: 30,
    columns: [
      'id TEXT PRIMARY KEY',
      'pack_id TEXT NOT NULL',
      'template_id TEXT NOT NULL',
      'content TEXT NOT NULL',
      'content_hash TEXT NOT NULL',
      'created_at INTEGER',
      'updated_at INTEGER',
      { sql: 'baseline_hash TEXT', since: 36 },
    ],
  },
  pack_variables: {
    since: 30,
    columns: [
      'id TEXT PRIMARY KEY',
      'pack_id TEXT NOT NULL',
      'variable_name TEXT NOT NULL',
      'display_name TEXT',
      'variable_type TEXT',
      'is_required INTEGER',
      'default_value TEXT',
      'enum_options TEXT',
      'created_at INTEGER',
      { sql: 'description TEXT', since: 31 },
      { sql: 'sort_order INTEGER', since: 31 },
    ],
  },
  pack_runtime_variables: {
    since: 32,
    columns: ['id TEXT PRIMARY KEY', 'pack_id TEXT NOT NULL', 'variable_name TEXT'],
  },
  vault_assistant_conversations: {
    since: 33,
    columns: ['id TEXT PRIMARY KEY', 'title TEXT NOT NULL'],
  },
  model_health_cache: {
    since: 34,
    columns: ['provider_id TEXT NOT NULL', 'model_id TEXT NOT NULL'],
  },
  kept_separate: {
    since: 37,
    columns: ['story_id TEXT NOT NULL', 'pool TEXT NOT NULL', 'pair_key TEXT NOT NULL'],
  },
  time_anchors: {
    since: 38,
    columns: ['id TEXT PRIMARY KEY', 'story_id TEXT NOT NULL', 'entry_id TEXT'],
  },
};

/** How a test bends the shape. Every field is optional; none gives the pin, 039. */
export interface AventurasDbOptions {
  /** The highest migration recorded as succeeded, and so the shape. 39 by default. */
  version?: number;
  /** `record` is today's `visual_descriptors`; `legacy` is the string array older rows kept. */
  descriptors?: 'record' | 'legacy';
  /** Columns left out of a table that should have them — the broken variant. */
  omitColumns?: Readonly<Record<string, readonly string[]>>;
  /** Tables left out although the version says they should be there. */
  omitTables?: readonly string[];
  /** Columns a newer Aventuras added, as DDL. */
  extraColumns?: Readonly<Record<string, readonly string[]>>;
  /** Tables a newer Aventuras added: each an id, a `story_id`, and one row. */
  extraTables?: readonly string[];
  /** `none`: no `_sqlx_migrations` at all. `failed`: the table, and no migration that succeeded. */
  migrations?: 'recorded' | 'none' | 'failed';
  /** Record a failed migration one past `version`, as the runner does before it stops. */
  failedNext?: boolean;
  /** More `character_vault` rows after {@link VAULT_CHARACTERS} — {@link AWKWARD_CHARACTERS}, usually. */
  extraCharacters?: readonly FixtureRow[];
  /** More `lorebook_vault` rows after {@link VAULT_LOREBOOKS} — {@link AWKWARD_LOREBOOKS}, usually. */
  extraLorebooks?: readonly FixtureRow[];
  /** More `scenario_vault` rows after {@link VAULT_SCENARIOS} — {@link AWKWARD_SCENARIOS}, usually. */
  extraScenarios?: readonly FixtureRow[];
  /** More `vault_tags` rows after {@link VAULT_TAGS} — {@link AWKWARD_TAGS}, usually. */
  extraTags?: readonly FixtureRow[];
}

/**
 * The four shapes §3 names, beside `wal` and the backup folder, which are
 * functions below rather than options — a writer held open and a folder are
 * not properties of the database's bytes.
 */
export const AVENTURAS_DB_VARIANTS = {
  /** The pin: migration 039. */
  current: {},
  /** A backup from before 036: no late columns, no newer tables, descriptors as strings. */
  legacy: { version: 35, descriptors: 'legacy' },
  /** 040: a column and a table this build has never seen. Must import, and say so. */
  newer: {
    version: 40,
    extraColumns: { character_vault: ['pronouns TEXT'] },
    extraTables: ['story_soundtracks'],
  },
  /** A required column missing — must refuse `unknown-format`. */
  broken: { omitColumns: { lorebook_vault: ['entries'] } },
} as const satisfies Record<string, AventurasDbOptions>;

/**
 * ***A provider key, in plain text, where Aventuras keeps one.*** The review
 * and the ledger are searched for this string, and it must be in neither — nor
 * anywhere else, since the reader never selects a value from `settings`.
 */
export const FIXTURE_API_KEY = 'sk-fixture-aventuras-8f3a1c9e-this-must-never-leave';

const CREATED = 1_758_000_000_000;
const UPDATED = 1_758_600_000_000;

/** A picture's bytes as the data URL Aventuras stores. */
function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * A JPEG **by its magic**: start of image, a JFIF header, end of image. Not a
 * picture anybody could look at — nothing here decodes one — but what a
 * sniffer asks of a file, and what makes this portrait not a PNG.
 */
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

/**
 * A WebP by its magic, as the JPEG above is one: `RIFF`, a length, `WEBP`, and
 * the first bytes of a lossless chunk. What the sniffer asks, and no more.
 */
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
  0x0d, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe,
  0x07, 0x00,
]);

/**
 * ***The pictures the portraits are made of***, exported so a test can hold
 * what it reads back to the bytes that went in (P13.3: *a PNG portrait is the
 * card's pixels; a JPEG one is present as its source*).
 */
export const FIXTURE_PORTRAITS = {
  png: makePng(4, 3),
  jpeg: JPEG,
  webp: WEBP,
  /** The legacy row's: a different picture, so it cannot pass as the first. */
  bare: makePng(4, 7),
} as const;

export const LOREBOOK_IDS = {
  harbour: '7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e5f',
  empty: '7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e60',
} as const;

/** A row of a vault table, as columns; objects are stored as JSON, as Aventuras stores them. */
export type FixtureRow = Readonly<Record<string, unknown>>;

/**
 * `character_vault`: a PNG portrait, a JPEG portrait, and none — and one of
 * them linked to a lorebook (§1.7: characters carry `linkedLorebookId` too).
 */
export const VAULT_CHARACTERS: readonly FixtureRow[] = [
  {
    id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f8091',
    name: 'Ines Vaur',
    description: 'A dock inspector who notices what the manifests leave out.',
    traits: ['patient', 'unbribable'],
    visual_descriptors: { hair: 'cropped grey', eyes: 'green, tired', clothing: 'an oilskin coat' },
    portrait: dataUrl('image/png', FIXTURE_PORTRAITS.png),
    tags: ['noir'],
    favorite: 1,
    source: 'manual',
    original_story_id: null,
    metadata: { linkedLorebookId: LOREBOOK_IDS.harbour },
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f8092',
    name: 'The Dockmaster',
    description: 'Has signed everything for nine years and read none of it.',
    traits: ['affable', 'incurious'],
    visual_descriptors: { build: 'broad, slow', accessories: 'a brass stamp on a chain' },
    portrait: dataUrl('image/jpeg', FIXTURE_PORTRAITS.jpeg),
    tags: ['noir', 'quiet'],
    favorite: 0,
    source: 'import',
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f8093',
    name: 'Mara Quell',
    description: 'Carries messages up the salt road for whoever pays.',
    traits: [],
    visual_descriptors: {},
    portrait: null,
    tags: [],
    favorite: 0,
    source: 'story',
    original_story_id: '5b8e0d1c-2f3a-4b5c-8d6e-7f8091a2b3c1',
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
];

/**
 * ***The rows P13.3 has to read around*** — each an ordinary character but for
 * one thing, added only when a test asks ({@link AventurasDbOptions.extraCharacters}),
 * so the three rows above stay the whole vault for every stage that does not.
 *
 * - a portrait that decodes to bytes which are not an image;
 * - a PNG portrait cut short, which still starts like a PNG;
 * - the legacy bare base64 an older Aventuras stored, with no `data:` prefix;
 * - a WebP labelled `image/png`, as Aventuras labels whatever its image
 *   providers return — the bytes decide, not the label;
 * - a portrait that is a link, which is never fetched;
 * - four JSON columns that will not read as Aventuras writes them, two not
 *   parsing at all and two parsing to the wrong shape;
 * - and a row with no id, which a `TEXT PRIMARY KEY` in SQLite allows.
 */
export const AWKWARD_CHARACTERS: readonly FixtureRow[] = [
  {
    id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f80a1',
    name: 'Corrupt Portrait',
    description: 'Somebody’s tool wrote text where the picture was.',
    traits: ['unlucky'],
    visual_descriptors: { face: 'hard to make out' },
    portrait: dataUrl('image/png', new TextEncoder().encode('this is not an image at all')),
    tags: [],
    favorite: 0,
    source: 'manual',
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f80a2',
    name: 'Cut Short',
    description: 'The picture stops half way down.',
    traits: [],
    visual_descriptors: {},
    portrait: dataUrl('image/png', makePng(4, 5)).slice(0, 80),
    tags: [],
    favorite: 0,
    source: 'manual',
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f80a3',
    name: 'Bare Base64',
    description: 'Saved by an Aventuras old enough to keep the base64 alone.',
    traits: ['old'],
    visual_descriptors: {},
    portrait: Buffer.from(FIXTURE_PORTRAITS.bare).toString('base64'),
    tags: [],
    favorite: 0,
    source: 'manual',
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f80a4',
    name: 'Mislabelled WebP',
    description: 'Drawn by a provider that returns WebP, stored as if it were PNG.',
    traits: [],
    visual_descriptors: {},
    portrait: dataUrl('image/png', FIXTURE_PORTRAITS.webp),
    tags: [],
    favorite: 0,
    source: 'manual',
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f80a5',
    name: 'Linked Face',
    description: 'Her portrait is somewhere else on the internet.',
    traits: [],
    visual_descriptors: {},
    portrait: 'https://images.example.invalid/linked-face.png',
    tags: [],
    favorite: 0,
    source: 'manual',
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f80a6',
    name: 'Broken Columns',
    description: 'Everything about him was saved by hand, badly.',
    // Stored as they are, not as JSON: `insert` passes a string through.
    traits: '["patient", ',
    visual_descriptors: 'hair: none',
    portrait: null,
    tags: '{"not": "a list"}',
    favorite: 0,
    source: null,
    original_story_id: null,
    metadata: '{oops',
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: null,
    name: 'Nobody Keyed',
    description: 'A row with no id to import by.',
    traits: [],
    visual_descriptors: {},
    portrait: null,
    tags: [],
    favorite: 0,
    source: 'manual',
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
];

/**
 * The same characters' descriptors **as a legacy row kept them**: a string
 * array of `Category: text`, which `migrateVisualDescriptors` reads into a
 * record every time the vault loads. By character id.
 */
const LEGACY_DESCRIPTORS: Readonly<Record<string, readonly string[]>> = {
  '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f8091': [
    'Hair: cropped grey',
    'Eyes: green, tired',
    'Clothing: an oilskin coat',
  ],
  '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f8092': ['Build: broad, slow', 'Accessories: a brass stamp'],
  '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f8093': [],
};

/**
 * `lorebook_vault`, whose `entries` column is `VaultLorebookEntry[]` — flat,
 * `{ name, type, description, keywords, aliases, injectionMode, priority }` —
 * and not the `Entry[]` of a file export (§0.4). One book repeats an entry
 * name, which nothing in Aventuras forbids; the other is empty, and exists.
 */
export const VAULT_LOREBOOKS: readonly FixtureRow[] = [
  {
    id: LOREBOOK_IDS.harbour,
    name: 'Ash Harbour',
    description: 'The port, its gate and the people who keep it.',
    entries: [
      {
        name: 'The Gate',
        type: 'location',
        description: 'Where every manifest is signed and none is read.',
        keywords: ['gate', 'gatehouse'],
        aliases: [],
        injectionMode: 'keyword',
        priority: 10,
      },
      {
        name: 'The Gate',
        type: 'event',
        description: 'The night the gate was shut and nobody said why.',
        keywords: ['shut'],
        aliases: ['the closing'],
        injectionMode: 'keyword',
        priority: 5,
      },
      {
        name: 'Ines Vaur',
        type: 'character',
        description: 'The inspector. Writes it down anyway.',
        keywords: ['Ines'],
        aliases: ['the inspector'],
        injectionMode: 'always',
        priority: 20,
      },
    ],
    tags: ['harbour'],
    favorite: 1,
    source: 'import',
    original_filename: 'ash-harbour.png',
    original_story_id: null,
    metadata: { format: 'aventura', entryCount: 3 },
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: LOREBOOK_IDS.empty,
    name: 'Unwritten',
    description: null,
    entries: [],
    tags: [],
    favorite: 0,
    source: 'manual',
    original_filename: null,
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
];

/**
 * ***The rows P13.4 has to read around*** — each an ordinary book but for one
 * thing, added only when a test asks ({@link AventurasDbOptions.extraLorebooks}),
 * so the two books above stay the whole vault for every stage that does not.
 *
 * - a second *Ash Harbour*: a different row with the same name, which
 *   derives the same entry ids and must still be a book of its own;
 * - an `entries` column that will not parse, beside a `metadata` that will not
 *   either;
 * - an `entries` column that parses to something that is not a list;
 * - entries missing their fields, one of them not a record at all, and one
 *   carrying a field the pin's `VaultLorebookEntry` does not have;
 * - and a row with no id, which a `TEXT PRIMARY KEY` in SQLite allows.
 */
export const AWKWARD_LOREBOOKS: readonly FixtureRow[] = [
  {
    id: '7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e61',
    name: 'Ash Harbour',
    description: 'A copy somebody kept, and then changed.',
    entries: [
      {
        name: 'The Gate',
        type: 'location',
        description: 'Rebuilt after the fire.',
        keywords: ['gate'],
        aliases: [],
        injectionMode: 'never',
        priority: 0,
      },
    ],
    tags: [],
    favorite: 0,
    source: 'manual',
    original_filename: null,
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e62',
    name: 'Torn Pages',
    description: 'Somebody’s tool wrote half a list.',
    entries: '[{"name": "The Gate", ',
    tags: ['damaged'],
    favorite: 0,
    source: 'manual',
    original_filename: null,
    original_story_id: null,
    metadata: '{oops',
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e63',
    name: 'Not A List',
    description: null,
    entries: { name: 'The Gate', injectionMode: 'always' },
    tags: [],
    favorite: 0,
    source: null,
    original_filename: null,
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e64',
    name: 'Half Written',
    description: 'Entries as a careless tool left them.',
    entries: [
      {},
      { name: 'Only a Name' },
      null,
      {
        name: 'Wrong Types',
        type: 7,
        description: ['not', 'prose'],
        keywords: 'gate',
        aliases: 'the gate',
        injectionMode: 3,
        priority: 'high',
      },
      {
        name: 'From Later',
        type: 'concept',
        description: 'A newer Aventuras wrote this.',
        keywords: ['later'],
        aliases: [],
        injectionMode: 'keyword',
        priority: 1,
        pinned: true,
      },
    ],
    tags: [],
    favorite: 0,
    source: 'manual',
    original_filename: null,
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: null,
    name: 'No Id',
    description: null,
    entries: [],
    tags: [],
    favorite: 0,
    source: 'manual',
    original_filename: null,
    original_story_id: null,
    metadata: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
];

/** `scenario_vault`: one linked to a lorebook by id, with a starting time; one bare. */
export const VAULT_SCENARIOS: readonly FixtureRow[] = [
  {
    id: '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c21',
    name: 'Ash Harbour',
    description: 'A working port under permanent rain.',
    setting_seed:
      'Ash Harbour has been wet for eleven days. The cranes run on a skeleton crew and every ' +
      'manifest that clears the gate has been signed by somebody who did not look.',
    npcs: [
      {
        name: 'Ines Vaur',
        role: 'Dock inspector',
        description: 'Notices what the manifests leave out.',
        relationship: 'Wary of you, and not yet against you',
        traits: ['patient'],
      },
      {
        name: 'The Dockmaster',
        role: 'Runs the gate',
        description: 'Signs everything.',
        relationship: 'Owes you a favour he has forgotten',
        traits: ['affable'],
      },
    ],
    primary_character_name: 'Ines Vaur',
    first_message: 'The rain finds your collar before the gatehouse does.',
    alternate_greetings: ['The gate is shut, and the light in the office is on.'],
    tags: ['noir'],
    favorite: 1,
    source: 'import',
    original_filename: 'ash-harbour.png',
    metadata: { cardVersion: 'chara_card_v2', npcCount: 2, linkedLorebookId: LOREBOOK_IDS.harbour },
    starting_time: { years: 0, days: 11, hours: 21, minutes: 40 },
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c22',
    name: 'Salt Road',
    description: 'Three days of flats between two towns that do not trust each other.',
    setting_seed: 'The salt road is the only road, and everybody on it is carrying something.',
    npcs: [],
    primary_character_name: '',
    first_message: null,
    alternate_greetings: [],
    tags: [],
    favorite: 0,
    source: 'wizard',
    original_filename: null,
    metadata: null,
    starting_time: null,
    created_at: CREATED,
    updated_at: UPDATED,
  },
];

/**
 * ***How many actors the scenarios above bring with them*** — each npc is an
 * actor of its own, beside the treatment (`scenario.ts`). Since P13.5 a sweep
 * of the fixture writes these beside {@link VAULT_CHARACTERS}, so a test
 * counting the library's actors counts both.
 */
export const VAULT_SCENARIO_NPCS = VAULT_SCENARIOS.reduce(
  (count, row) => count + (Array.isArray(row['npcs']) ? row['npcs'].length : 0),
  0,
);

/** A `scenario_vault` row with everything a plain one has; each awkward row overrides one thing. */
function scenarioRow(id: string, name: string, overrides: FixtureRow): FixtureRow {
  return {
    id,
    name,
    description: null,
    setting_seed: `${name}: somewhere, and somebody in it.`,
    npcs: [],
    primary_character_name: '',
    first_message: null,
    alternate_greetings: [],
    tags: [],
    favorite: 0,
    source: 'manual',
    original_filename: null,
    metadata: null,
    starting_time: null,
    created_at: CREATED,
    updated_at: UPDATED,
    ...overrides,
  };
}

/**
 * ***The rows P13.5 has to read around*** — each an ordinary scenario but for
 * one thing, added only when a test asks ({@link AventurasDbOptions.extraScenarios}),
 * so the two above stay the whole vault for every stage that does not.
 *
 * - a cast that will not parse, beside tags that will not either — the cast
 *   refuses the row, and both are named;
 * - a cast that parses to something that is not a list;
 * - alternate greetings that will not parse;
 * - metadata that will not parse, which is where the link lives;
 * - tags and a starting time that will not parse, which cost only themselves;
 * - a link to a lorebook no row of the database holds;
 * - a link to *Torn Pages*, the {@link AWKWARD_LOREBOOKS} book whose entries
 *   will not read — refused when those books are there, and absent when not;
 * - no setting at all, which the scenario converter refuses by its own rule;
 * - and a row with no id, which a `TEXT PRIMARY KEY` in SQLite allows.
 */
export const AWKWARD_SCENARIOS: readonly FixtureRow[] = [
  scenarioRow('9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c31', 'Torn Cast', {
    npcs: '[{"name": "Ines',
    tags: '{oops',
  }),
  scenarioRow('9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c32', 'Cast Not A List', {
    npcs: { name: 'Ines Vaur', role: 'Dock inspector' },
  }),
  scenarioRow('9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c33', 'Torn Openings', {
    first_message: 'It starts.',
    alternate_greetings: '["It starts again", ',
  }),
  scenarioRow('9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c34', 'Torn Metadata', {
    metadata: '{"linkedLorebookId": ',
  }),
  scenarioRow('9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c35', 'Loose Ends', {
    tags: '["noir", ',
    starting_time: '{"days": ',
  }),
  scenarioRow('9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c36', 'Lost Link', {
    metadata: { linkedLorebookId: '7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4eff' },
  }),
  scenarioRow('9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c37', 'Torn Link', {
    metadata: { linkedLorebookId: '7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e62' },
  }),
  scenarioRow('9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c38', 'No Setting', { setting_seed: '' }),
  scenarioRow('', 'No Id', { id: null }),
];

/**
 * `vault_tags`, **as the pin writes them** — a Tailwind token, not a hex
 * colour (found at P13.6: §1.8 expected free hex, and Aventuras draws each
 * tag's colour at random from seventeen `<hue>-500` tokens). `noir` in two
 * kinds and two colours that land on two swatches (§1.8's *one name used by
 * two kinds becomes one tag*), and two more names, one used on a character
 * and one on a lorebook, so every kind is here.
 */
export const VAULT_TAGS: readonly FixtureRow[] = [
  { id: 'tag-1', name: 'noir', type: 'character', color: 'indigo-500', created_at: CREATED },
  { id: 'tag-2', name: 'noir', type: 'scenario', color: 'rose-500', created_at: CREATED },
  { id: 'tag-3', name: 'harbour', type: 'lorebook', color: 'emerald-500', created_at: CREATED },
  { id: 'tag-4', name: 'quiet', type: 'character', color: 'sky-500', created_at: CREATED },
];

/**
 * ***The tags a reader has to read around*** — P13.6, added only when a test
 * asks ({@link AventurasDbOptions.extraTags}): §1.8's own hex, and a grey one
 * that must be `stone`; a colour that is neither a token nor hex; a name
 * differing from a fixture tag only in case and spacing, in a third kind, and
 * in a colour that lands on the same swatch as the first `noir`; an empty
 * name; a name past the registry's sixty-four characters; and a row with no
 * id.
 */
export const AWKWARD_TAGS: readonly FixtureRow[] = [
  { id: 'tag-hex', name: 'salt', type: 'lorebook', color: '#e11d48', created_at: CREATED },
  { id: 'tag-grey', name: 'ashen', type: 'character', color: '#a8a29e', created_at: CREATED },
  { id: 'tag-junk', name: 'murk', type: 'scenario', color: 'not a colour', created_at: CREATED },
  { id: 'tag-case', name: '  NOIR ', type: 'lorebook', color: 'violet-500', created_at: CREATED },
  { id: 'tag-blank', name: '   ', type: 'character', color: 'red-500', created_at: CREATED },
  {
    id: 'tag-long',
    name: 'a tag name that goes on and on past anything a chip could hold in one line',
    type: 'lorebook',
    color: 'teal-500',
    created_at: CREATED,
  },
  { id: null, name: 'nameless', type: 'character', color: 'lime-500', created_at: CREATED },
];

export const PACK_IDS = { default: 'default-pack', rain: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e' };

/** The default pack, which every install has, and one somebody made. */
export const PRESET_PACKS: readonly FixtureRow[] = [
  {
    id: PACK_IDS.default,
    name: 'Default',
    description: 'The prompts Aventuras ships with.',
    author: 'Aventuras',
    is_default: 1,
    created_at: CREATED,
    updated_at: CREATED,
  },
  {
    id: PACK_IDS.rain,
    name: 'Rain',
    description: 'Everything is wet, and everybody is lying.',
    author: 'Ned',
    is_default: 0,
    created_at: CREATED,
    updated_at: UPDATED,
  },
];

/**
 * Templates: the default pack's, untouched, and the Rain pack's — one of which
 * somebody edited, so its `content_hash` differs from its `baseline_hash`
 * (§1.10: *only a template whose hash differs is something somebody wrote*).
 */
export const PACK_TEMPLATES: readonly FixtureRow[] = [
  {
    id: 'tpl-1',
    pack_id: PACK_IDS.default,
    template_id: 'adventure',
    content: 'You are the narrator of an adventure.',
    content_hash: 'hash-adventure-baseline',
    baseline_hash: 'hash-adventure-baseline',
    created_at: CREATED,
    updated_at: CREATED,
  },
  {
    id: 'tpl-2',
    pack_id: PACK_IDS.default,
    template_id: 'adventure-user',
    content: '{{ userInput }}',
    content_hash: 'hash-adventure-user-baseline',
    baseline_hash: 'hash-adventure-user-baseline',
    created_at: CREATED,
    updated_at: CREATED,
  },
  {
    id: 'tpl-3',
    pack_id: PACK_IDS.rain,
    template_id: 'adventure',
    content: 'You narrate a town where it has rained for eleven days. Nobody is honest.',
    content_hash: 'hash-adventure-edited',
    baseline_hash: 'hash-adventure-baseline',
    created_at: CREATED,
    updated_at: UPDATED,
  },
  {
    id: 'tpl-4',
    pack_id: PACK_IDS.rain,
    template_id: 'classifier',
    content: 'Classify the entities in the passage.',
    content_hash: 'hash-classifier-baseline',
    baseline_hash: 'hash-classifier-baseline',
    created_at: CREATED,
    updated_at: CREATED,
  },
];

export const PACK_VARIABLES: readonly FixtureRow[] = [
  {
    id: 'var-1',
    pack_id: PACK_IDS.rain,
    variable_name: 'tone',
    display_name: 'Tone',
    variable_type: 'enum',
    is_required: 0,
    default_value: 'wry',
    enum_options: ['grim', 'wry'],
    created_at: CREATED,
    description: 'How the narrator sounds.',
    sort_order: 0,
  },
];

/**
 * `settings`, keys and all — and window sizes and a theme beside them, which
 * is most of what the table is. The reader counts these rows and reads none.
 */
export const SETTINGS: readonly FixtureRow[] = [
  { key: 'openai_api_key', value: FIXTURE_API_KEY },
  {
    key: 'api_profiles',
    value: JSON.stringify([
      { name: 'Main', baseUrl: 'https://api.example.invalid/v1', apiKey: FIXTURE_API_KEY },
    ]),
  },
  { key: 'theme', value: 'dark' },
  { key: 'sidebar_width', value: '320' },
];

/** The per-story tables, and how many rows each story has in each. */
export type StoryTable =
  | 'story_entries'
  | 'branches'
  | 'characters'
  | 'locations'
  | 'items'
  | 'story_beats'
  | 'entries'
  | 'chapters'
  | 'checkpoints'
  | 'embedded_images'
  | 'background_images'
  | 'time_anchors'
  | 'kept_separate'
  | 'world_state_snapshots';

export interface FixtureStory {
  id: string;
  title: string;
  rows: Readonly<Record<StoryTable, number>>;
}

/**
 * Two stories with **different numbers of everything**, so a count that
 * landed on the wrong story, or summed across them, cannot pass.
 */
export const STORIES: readonly FixtureStory[] = [
  {
    id: '5b8e0d1c-2f3a-4b5c-8d6e-7f8091a2b3c1',
    title: 'The Drowned Bell',
    rows: {
      story_entries: 6,
      branches: 2,
      characters: 3,
      locations: 2,
      items: 1,
      story_beats: 2,
      entries: 4,
      chapters: 1,
      checkpoints: 1,
      embedded_images: 2,
      background_images: 1,
      time_anchors: 1,
      kept_separate: 1,
      world_state_snapshots: 2,
    },
  },
  {
    id: '5b8e0d1c-2f3a-4b5c-8d6e-7f8091a2b3c2',
    title: 'Salt Road',
    rows: {
      story_entries: 3,
      branches: 0,
      characters: 1,
      locations: 1,
      items: 2,
      story_beats: 0,
      entries: 1,
      chapters: 0,
      checkpoints: 0,
      embedded_images: 0,
      background_images: 1,
      time_anchors: 0,
      kept_separate: 0,
      world_state_snapshots: 1,
    },
  },
];

/**
 * ***What Aventuras' copy-on-write branches leave in a story's tables***
 * (026, 028) — rows **beyond** each story's {@link FixtureStory.rows}, which
 * count what the story holds. A row with an `overrides_id` is a branch's edit
 * of an entity that has a row already; a row with `deleted` is a tombstone.
 * Neither is something the story holds, so the per-story counts must leave
 * them out while the per-table counts, which are rows, keep them. Written only
 * into a table that has both columns.
 */
export interface FixtureCowRow {
  table: 'characters' | 'locations' | 'items' | 'story_beats' | 'entries';
  /** Which of {@link STORIES}, by index. */
  story: number;
  /** The `n` of the story's own row it edits, or `null` for a row of its own. */
  overrides: number | null;
  deleted: boolean;
}

export const STORY_COW_ROWS: readonly FixtureCowRow[] = [
  // "characters 1", edited on a branch: the same character, counted once.
  { table: 'characters', story: 0, overrides: 1, deleted: false },
  // "characters 2", deleted on a branch that inherited it: a tombstone override.
  { table: 'characters', story: 0, overrides: 2, deleted: true },
  // A location of its own, deleted in place on the branch that owned it.
  { table: 'locations', story: 0, overrides: null, deleted: true },
  // A lorebook entry of the second story, edited on a branch.
  { table: 'entries', story: 1, overrides: 1, deleted: false },
];

/** One row of each table that is only ever counted. */
const ONE_EACH: Readonly<Record<string, FixtureRow>> = {
  templates: { id: 'legacy-template', name: 'Fantasy (before packs)' },
  pack_runtime_variables: { id: 'rt-1', pack_id: PACK_IDS.rain, variable_name: 'mood' },
  vault_assistant_conversations: { id: 'conv-1', title: 'Help me name a harbour' },
  model_health_cache: { provider_id: 'openai', model_id: 'gpt-fixture' },
};

/**
 * ***What a running Aventuras committed and has not checkpointed*** — the
 * rows {@link openAventurasWithUnsavedFrames} writes after its checkpoint, so
 * they live only in `aventura.db-wal`. A character, and one more entry in the
 * first story: a copy that missed the log misses both.
 */
export const UNSAVED = {
  character: {
    id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f8099',
    name: 'Only In The Log',
    description: 'Saved a moment ago, and not yet anywhere but the log.',
    traits: [],
    visual_descriptors: {},
    portrait: null,
    tags: [],
    favorite: 0,
    source: 'manual',
    original_story_id: null,
    metadata: null,
    created_at: UPDATED,
    updated_at: UPDATED,
  },
  entry: {
    id: 'unsaved-entry',
    story_id: '5b8e0d1c-2f3a-4b5c-8d6e-7f8091a2b3c1',
    type: 'narration',
    content: 'The bell rings once, under the water.',
  },
} as const;

/** A column's name, from its DDL. */
function nameOf(column: Column): string {
  const sql = typeof column === 'string' ? column : column.sql;
  return sql.split(' ')[0] ?? sql;
}

/**
 * **Builds the whole database on an open connection**: every table the
 * version has, shaped as the options say, and every row above. Composable —
 * a caller may add rows before closing, and a later stage will.
 */
export function buildAventurasDatabase(db: DatabaseSync, options: AventurasDbOptions = {}): void {
  const version = options.version ?? 39;
  const migrations = options.migrations ?? 'recorded';
  const omitTables = new Set(options.omitTables ?? []);

  for (const [table, spec] of Object.entries(SCHEMA)) {
    if (spec.since > version || omitTables.has(table)) continue;
    if (table === '_sqlx_migrations' && migrations === 'none') continue;
    const omit = new Set(options.omitColumns?.[table] ?? []);
    const columns = spec.columns
      .filter((column) => typeof column === 'string' || column.since <= version)
      .filter((column) => !omit.has(nameOf(column)))
      .map((column) => (typeof column === 'string' ? column : column.sql));
    columns.push(...(options.extraColumns?.[table] ?? []));
    db.exec(`create table ${table} (${columns.join(', ')})`);
  }
  for (const table of options.extraTables ?? []) {
    db.exec(`create table ${table} (id TEXT PRIMARY KEY, story_id TEXT)`);
    insert(db, table, { id: `${table}-1`, story_id: STORIES[0]?.id ?? '' });
  }

  if (migrations !== 'none') {
    // Through `insert`, so a bookkeeping table missing a column — an
    // `omitColumns` on `_sqlx_migrations` — is still built and filled.
    const record = (at: number, description: string, success: 0 | 1): void => {
      insert(db, '_sqlx_migrations', { version: at, description, success });
    };
    for (let at = 1; at <= version; at += 1) {
      record(at, `migration ${String(at)}`, migrations === 'failed' ? 0 : 1);
    }
    if (options.failedNext === true) record(version + 1, 'the one that failed', 0);
  }

  const legacy = options.descriptors === 'legacy';
  for (const row of VAULT_CHARACTERS) {
    const id = String(row['id']);
    insert(
      db,
      'character_vault',
      legacy ? { ...row, visual_descriptors: LEGACY_DESCRIPTORS[id] ?? [] } : row,
    );
  }
  for (const row of options.extraCharacters ?? []) insert(db, 'character_vault', row);
  for (const row of VAULT_LOREBOOKS) insert(db, 'lorebook_vault', row);
  for (const row of options.extraLorebooks ?? []) insert(db, 'lorebook_vault', row);
  for (const row of VAULT_SCENARIOS) insert(db, 'scenario_vault', row);
  for (const row of options.extraScenarios ?? []) insert(db, 'scenario_vault', row);
  for (const row of VAULT_TAGS) insert(db, 'vault_tags', row);
  for (const row of options.extraTags ?? []) insert(db, 'vault_tags', row);
  for (const row of PRESET_PACKS) insert(db, 'preset_packs', row);
  for (const row of PACK_TEMPLATES) insert(db, 'pack_templates', row);
  for (const row of PACK_VARIABLES) insert(db, 'pack_variables', row);
  for (const row of SETTINGS) insert(db, 'settings', row);
  for (const [table, row] of Object.entries(ONE_EACH)) insert(db, table, row);

  for (const story of STORIES) {
    insert(db, 'stories', { id: story.id, title: story.title });
    for (const [table, count] of Object.entries(story.rows)) {
      for (let n = 1; n <= count; n += 1) insert(db, table, storyRow(story.id, table, n));
    }
  }

  // Only where both columns are there: an edit or a tombstone written into a
  // table without them would be an ordinary row, and a database from before
  // 026 or 028 has no such rows to hold.
  STORY_COW_ROWS.forEach((cow, at) => {
    const have = columnsOf(db, cow.table);
    if (!have.has('overrides_id') || !have.has('deleted')) return;
    const story = STORIES[cow.story]?.id ?? '';
    insert(db, cow.table, {
      ...storyRow(story, cow.table, 100 + at),
      overrides_id:
        cow.overrides === null ? null : `${story}:${cow.table}:${String(cow.overrides)}`,
      deleted: cow.deleted ? 1 : 0,
    });
  });
}

function columnsOf(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    db
      .prepare('select name from pragma_table_info(?)')
      .all(table)
      .map((column) => String(column['name'])),
  );
}

/**
 * One row of a per-story table: everything any of them might want, of which
 * {@link insert} keeps what the table has.
 */
function storyRow(story: string, table: string, n: number): FixtureRow {
  return {
    id: `${story}:${table}:${String(n)}`,
    story_id: story,
    type: n === 1 ? 'narration' : 'user_action',
    content: `Line ${String(n)} of ${table}.`,
    name: `${table} ${String(n)}`,
    title: `${table} ${String(n)}`,
    number: n,
    entry_id: `${story}:story_entries:${String(n)}`,
    pool: 'character',
    pair_key: `a|b${String(n)}`,
  };
}

/**
 * Inserts the columns of `row` that `table` has, and no others — so one row
 * serves every shape, and a legacy database simply lacks what it lacks.
 * Objects and arrays are stored as JSON, as Aventuras stores them.
 */
function insert(db: DatabaseSync, table: string, row: FixtureRow): void {
  const have = columnsOf(db, table);
  if (have.size === 0) return;
  const names = Object.keys(row).filter((name) => have.has(name));
  const values = names.map((name) => stored(row[name]));
  db.prepare(
    `insert into ${table} (${names.join(', ')}) values (${names.map(() => '?').join(', ')})`,
  ).run(...values);
}

function stored(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  return JSON.stringify(value);
}

/**
 * **Writes the database at `path` and closes it** — in WAL mode, as Aventuras
 * runs, so the file is left as a cleanly closed app leaves it: one file and
 * nothing beside it.
 */
export function writeAventurasDatabase(path: string, options: AventurasDbOptions = {}): void {
  const db = new DatabaseSync(path);
  try {
    db.exec('pragma journal_mode = wal');
    buildAventurasDatabase(db, options);
  } finally {
    db.close();
  }
}

/**
 * ***A database as a running Aventuras leaves it between checkpoints*** —
 * everything above in the file, {@link UNSAVED} only in the log, and the
 * writer's connection **returned open**, because closing the last connection
 * checkpoints the log into the file. The caller closes it when the test ends.
 */
export function openAventurasWithUnsavedFrames(
  path: string,
  options: AventurasDbOptions = {},
): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = wal');
  db.exec('pragma wal_autocheckpoint = 0');
  buildAventurasDatabase(db, options);
  db.exec('pragma wal_checkpoint(truncate)');
  insert(db, 'character_vault', UNSAVED.character);
  insert(db, 'story_entries', UNSAVED.entry);
  return db;
}

/** The database as bytes, as an upload or a zip entry carries it. */
export async function aventurasDatabaseBytes(
  options: AventurasDbOptions = {},
): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), 'se-aventuras-bytes-'));
  try {
    const path = join(directory, 'aventura.db');
    writeAventurasDatabase(path, options);
    return new Uint8Array(await readFile(path));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * `metadata.json`, as `backupService.ts` writes it beside the database in a
 * backup zip — `BackupMetadata`, field for field.
 */
export function aventurasBackupMetadata(databaseSizeBytes: number): Record<string, unknown> {
  return {
    version: 1,
    createdAt: '2026-09-20T18:04:11.000Z',
    appVersion: '0.7.11',
    storyCount: STORIES.length,
    hasDatabaseSnapshot: true,
    databaseSizeBytes,
  };
}

/**
 * ***An unzipped backup***: `aventura.db` and `metadata.json` in `directory`,
 * and nothing else — which is what Aventuras' backup zip holds.
 */
export async function writeAventurasBackupFolder(
  directory: string,
  options: AventurasDbOptions = {},
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const database = join(directory, 'aventura.db');
  writeAventurasDatabase(database, options);
  const { size } = await stat(database);
  await writeFile(
    join(directory, 'metadata.json'),
    JSON.stringify(aventurasBackupMetadata(size), null, 2),
  );
}
