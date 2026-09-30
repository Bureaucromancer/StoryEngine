// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

/**
 * ***A `.avt`, written from the fixture database as Aventuras writes one*** —
 * [P13.15](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * **Made from the database rather than written by hand**, so the file and the
 * database are the same story by construction: whatever the database fixture
 * holds — the Lantern Fork's tree, its world on every branch, its pictures —
 * the file holds too, and a test that the two make the same session is a test
 * of the reader, not of two fixtures agreeing.
 *
 * ***The steps are Aventuras' own, at the pin***, and each is named where it
 * is mirrored:
 *
 * 1. **`gatherStoryData()`** (`services/export/ExportCoordinationService.ts`):
 *    every row the story owns, by the statements its `database.ts` getters
 *    run — entries `ORDER BY position`, branches and lorebook entries by
 *    `created_at`, pictures as metadata by `created_at` — each through its row
 *    mapper (`mapStory`, `mapStoryEntry`, `mapCharacter`, …), which is where
 *    the database's `snake_case` becomes the file's `camelCase`, `0`/`1`
 *    becomes a boolean, and JSON text becomes JSON.
 * 2. **`exportToAventura`** (`services/export.ts`): the envelope — `version`,
 *    `exportedAt`, the sections, `styleReviewState` off the story,
 *    `currentBgImage: null` as the header's call passes it, and `packBinding`
 *    and `timeAnchors` only when there are any.
 * 3. **`export_story_avt`** (`src-tauri/src/backup.rs`): the native side fills
 *    each picture's `imageData` from `embedded_images` and writes the whole
 *    through `serde_json::Value`, which — without serde's `preserve_order`,
 *    and the pin's lockfile has none — **sorts every object's keys**. So a
 *    pin-version file begins `{"branches":`, never `{"version":`, and a reader
 *    that sniffed for the version first would miss every file Aventuras writes
 *    today.
 *
 * ***An older version is the same story, less what it predated***, written as
 * that era's JavaScript exporter wrote it — `JSON.stringify` in insertion
 * order, version first: no lorebook before 1.1.0, no pictures before 1.4.0,
 * no portraits before 1.5.0, and before 1.6.0 no branches and no checkpoints —
 * **and no branch's rows**, since a story from before branching had only its
 * main line, so a 1.5.0 file here is the Lantern Fork as it stood before
 * anybody forked it.
 */

export interface AvtFixtureOptions {
  /** The format version to write. The pin's, `1.10.0`, by default. */
  version?: string;
  /** Anything to put over the envelope's own fields — a test's edit of the file. */
  override?: Record<string, unknown>;
}

/** The format version at the pin. */
export const PIN_AVT_VERSION = '1.10.0';

/** When the fixture file says it was exported: a fixed moment, so two files of one story are one file. */
const EXPORTED_AT = 1_758_700_000_000;

/**
 * ***One story of `db`, as the `.avt` Aventuras would export of it*** — the
 * bytes, as a person would hand them over.
 */
export function avtFromDatabase(
  db: DatabaseSync,
  storyId: string,
  options: AvtFixtureOptions = {},
): Uint8Array {
  const document = avtDocument(db, storyId, options);
  return new TextEncoder().encode(JSON.stringify(document));
}

/** The same, as the parsed document, for a test that edits it before encoding. */
export function avtDocument(
  db: DatabaseSync,
  storyId: string,
  options: AvtFixtureOptions = {},
): Record<string, unknown> {
  const version = options.version ?? PIN_AVT_VERSION;
  const at = (since: string): boolean => compare(version, since) >= 0;
  const all = (sql: string): Record<string, SQLOutputValue>[] =>
    tableExists(db, sql) ? db.prepare(sql).all(storyId) : [];

  const storyRow = db.prepare('select * from stories where id = ?').get(storyId);
  if (storyRow === undefined) throw new Error(`no story ${storyId} in the fixture`);
  const story = mapStory(storyRow);

  // Before branching there were no branches, so a story's file held its main line.
  const mainOnly = !at('1.6.0');
  const onMain = (row: Record<string, SQLOutputValue>): boolean =>
    !mainOnly || row['branch_id'] === null || row['branch_id'] === undefined;

  const entries = all('select * from story_entries where story_id = ? order by position asc')
    .filter(onMain)
    .map(mapStoryEntry);
  const characters = all('select * from characters where story_id = ?')
    .filter(onMain)
    .map((row) => mapCharacter(row, at('1.5.0')));
  const locations = all('select * from locations where story_id = ?')
    .filter(onMain)
    .map(mapLocation);
  const items = all('select * from items where story_id = ?').filter(onMain).map(mapItem);
  const storyBeats = all('select * from story_beats where story_id = ?')
    .filter(onMain)
    .map(mapStoryBeat);
  const lorebookEntries = all('select * from entries where story_id = ?')
    .filter(onMain)
    .map(mapEntry);
  const kept = new Set(entries.map((entry) => entry['id']));
  // `getEmbeddedImageMetaForStory`, then the native side's `imageData`.
  const embeddedImages = all(
    'select * from embedded_images where story_id = ? order by created_at asc',
  )
    .filter((row) => !mainOnly || kept.has(row['entry_id']))
    .map(mapEmbeddedImage);
  const branches = all('select * from branches where story_id = ? order by created_at asc').map(
    mapBranch,
  );
  const checkpoints = all('select * from checkpoints where story_id = ?').map((row) => ({
    id: row['id'],
    storyId: row['story_id'],
    name: row['name'],
    entriesSnapshot: [],
    charactersSnapshot: [],
    locationsSnapshot: [],
    itemsSnapshot: [],
    storyBeatsSnapshot: [],
    chaptersSnapshot: [],
    timeTrackerSnapshot: null,
  }));
  const chapters = all('select * from chapters where story_id = ?').map(mapChapter);
  const timeAnchors = all('select * from time_anchors where story_id = ?').map((row) => ({
    id: row['id'],
    storyId: row['story_id'],
    entryId: row['entry_id'],
  }));

  if (at('1.6.0')) {
    const exported: Record<string, unknown> = {
      version,
      exportedAt: EXPORTED_AT,
      story,
      entries,
      characters,
      locations,
      items,
      storyBeats,
      lorebookEntries,
      styleReviewState: story['styleReviewState'],
      embeddedImages,
      checkpoints,
      branches,
      ...(at('1.7.0') ? { chapters } : {}),
      ...(at('1.8.0') ? { currentBgImage: null } : {}),
      ...(at('1.10.0') && timeAnchors.length > 0 ? { timeAnchors } : {}),
      ...options.override,
    };
    // Written through `serde_json::Value`: every object's keys sorted.
    return sortedDeep(exported) as Record<string, unknown>;
  }

  // An older exporter, in JavaScript: insertion order, version first.
  return {
    version,
    exportedAt: EXPORTED_AT,
    story: without(story, ['currentBranchId']),
    entries: entries.map((entry) => without(entry, ['branchId'])),
    characters: characters.map(withoutBranch),
    locations: locations.map(withoutBranch),
    items: items.map(withoutBranch),
    storyBeats: storyBeats.map(withoutBranch),
    ...(at('1.1.0') ? { lorebookEntries: lorebookEntries.map(withoutBranch) } : {}),
    ...(at('1.2.0') ? { styleReviewState: null } : {}),
    ...(at('1.4.0') ? { embeddedImages } : {}),
    ...options.override,
  };
}

/** What a row carried about branches, which a file from before them never had. */
function withoutBranch(row: Record<string, unknown>): Record<string, unknown> {
  return without(row, ['branchId', 'overridesId', 'deleted']);
}

/** An object less some of its keys. */
function without(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

// ── Aventuras' row mappers (`services/database.ts`), as far as the fixture has columns ──

function parsed(value: SQLOutputValue | undefined): unknown {
  return typeof value === 'string' && value !== '' ? (JSON.parse(value) as unknown) : null;
}

function or<T>(value: SQLOutputValue | undefined, fallback: T): SQLOutputValue | T {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function mapStory(row: Record<string, SQLOutputValue>): Record<string, unknown> {
  return {
    id: row['id'],
    title: row['title'],
    description: row['description'],
    genre: row['genre'],
    templateId: row['template_id'],
    mode: or(row['mode'], 'adventure'),
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
    settings: parsed(row['settings']),
    memoryConfig: parsed(row['memory_config']),
    retryState: parsed(row['retry_state']),
    styleReviewState: parsed(row['style_review_state']),
    timeTracker: parsed(row['time_tracker']),
    currentBranchId: or(row['current_branch_id'], null),
    // `mapStory`: "Loaded separately now".
    currentBgImage: null,
  };
}

function mapStoryEntry(row: Record<string, SQLOutputValue>): Record<string, unknown> {
  return {
    id: row['id'],
    storyId: row['story_id'],
    type: row['type'],
    content: row['content'],
    parentId: row['parent_id'],
    position: row['position'],
    createdAt: row['created_at'],
    metadata: parsed(row['metadata']),
    branchId: or(row['branch_id'], null),
    reasoning: or(row['reasoning'], undefined),
    translatedContent: or(row['translated_content'], null),
    translationLanguage: or(row['translation_language'], null),
    originalInput: or(row['original_input'], null),
    worldStateDelta: parsed(row['world_state_delta']),
    // Passed through as the JSON text it is stored as.
    suggestedActions: or(row['suggested_actions'], null),
  };
}

function mapCharacter(
  row: Record<string, SQLOutputValue>,
  portraits: boolean,
): Record<string, unknown> {
  const descriptors = parsed(row['visual_descriptors']);
  return {
    id: row['id'],
    storyId: row['story_id'],
    name: row['name'],
    description: row['description'],
    relationship: row['relationship'],
    traits: parsed(row['traits']) ?? [],
    // `migrateVisualDescriptors`: the object form as it is, anything else empty
    // — the fixture's story characters keep the object form.
    visualDescriptors:
      typeof descriptors === 'object' && descriptors !== null && !Array.isArray(descriptors)
        ? descriptors
        : {},
    ...(portraits ? { portrait: or(row['portrait'], null) } : {}),
    status: row['status'],
    metadata: parsed(row['metadata']),
    branchId: or(row['branch_id'], null),
    overridesId: or(row['overrides_id'], null),
    deleted: row['deleted'] === 1,
    translatedName: null,
    translatedDescription: null,
    translatedRelationship: null,
    translatedTraits: null,
    translatedVisualDescriptors: null,
    translationLanguage: null,
  };
}

function mapLocation(row: Record<string, SQLOutputValue>): Record<string, unknown> {
  return {
    id: row['id'],
    storyId: row['story_id'],
    name: row['name'],
    description: row['description'],
    visited: row['visited'] === 1,
    current: row['current'] === 1,
    connections: parsed(row['connections']) ?? [],
    metadata: parsed(row['metadata']),
    branchId: or(row['branch_id'], null),
    overridesId: or(row['overrides_id'], null),
    deleted: row['deleted'] === 1,
  };
}

function mapItem(row: Record<string, SQLOutputValue>): Record<string, unknown> {
  return {
    id: row['id'],
    storyId: row['story_id'],
    name: row['name'],
    description: row['description'],
    quantity: row['quantity'],
    equipped: row['equipped'] === 1,
    location: row['location'],
    metadata: parsed(row['metadata']),
    branchId: or(row['branch_id'], null),
    overridesId: or(row['overrides_id'], null),
    deleted: row['deleted'] === 1,
  };
}

function mapStoryBeat(row: Record<string, SQLOutputValue>): Record<string, unknown> {
  return {
    id: row['id'],
    storyId: row['story_id'],
    title: row['title'],
    description: row['description'],
    type: row['type'],
    status: row['status'],
    triggeredAt: row['triggered_at'],
    resolvedAt: row['resolved_at'] ?? null,
    metadata: parsed(row['metadata']),
    branchId: or(row['branch_id'], null),
    overridesId: or(row['overrides_id'], null),
    deleted: row['deleted'] === 1,
  };
}

function mapEntry(row: Record<string, SQLOutputValue>): Record<string, unknown> {
  return {
    id: row['id'],
    storyId: row['story_id'],
    name: row['name'],
    type: row['type'],
    description: or(row['description'], ''),
    hiddenInfo: row['hidden_info'],
    aliases: parsed(row['aliases']) ?? [],
    state: parsed(row['state']) ?? { type: row['type'] },
    adventureState: parsed(row['adventure_state']),
    creativeState: parsed(row['creative_state']),
    injection: parsed(row['injection']) ?? { mode: 'keyword', keywords: [], priority: 0 },
    createdBy: or(row['created_by'], 'user'),
    createdAt: row['created_at'],
    updatedAt: row['updated_at'],
    loreManagementBlacklisted: row['lore_management_blacklisted'] === 1,
    branchId: or(row['branch_id'], null),
    overridesId: or(row['overrides_id'], null),
    deleted: row['deleted'] === 1,
  };
}

function mapEmbeddedImage(row: Record<string, SQLOutputValue>): Record<string, unknown> {
  const sourceText = row['source_text'];
  return {
    id: row['id'],
    storyId: row['story_id'],
    entryId: row['entry_id'],
    sourceText,
    prompt: row['prompt'],
    styleId: row['style_id'],
    model: row['model'],
    width: row['width'] ?? undefined,
    height: row['height'] ?? undefined,
    status: row['status'],
    errorMessage: row['error_message'] ?? undefined,
    generationMode:
      typeof sourceText === 'string' && sourceText.trim().startsWith('<pic ')
        ? 'inline'
        : 'analyzed',
    createdAt: row['created_at'],
    // The native exporter's one addition: the stored text, as it is stored.
    imageData: row['image_data'],
  };
}

function mapBranch(row: Record<string, SQLOutputValue>): Record<string, unknown> {
  return {
    id: row['id'],
    storyId: row['story_id'],
    name: row['name'],
    parentBranchId: or(row['parent_branch_id'], null),
    forkEntryId: row['fork_entry_id'],
    checkpointId: or(row['checkpoint_id'], null),
    createdAt: row['created_at'],
    snapshotComplete: row['snapshot_complete'] === 1,
  };
}

function mapChapter(row: Record<string, SQLOutputValue>): Record<string, unknown> {
  return {
    id: row['id'],
    storyId: row['story_id'],
    number: row['number'],
    startEntryId: row['start_entry_id'],
    endEntryId: row['end_entry_id'],
    summary: row['summary'],
    keywords: parsed(row['keywords']) ?? [],
    branchId: or(row['branch_id'], null),
    createdAt: row['created_at'],
  };
}

/** Every object's keys in order, as `serde_json::Value` without `preserve_order` writes them. */
function sortedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedDeep);
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` is dropped by `JSON.stringify` before serde ever sees it.
    .filter(([, inner]) => inner !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, inner]) => [key, sortedDeep(inner)]));
}

function compare(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Whether the table a statement reads is in this database — an older one lacks some. */
function tableExists(db: DatabaseSync, sql: string): boolean {
  const table = /from (\w+)/.exec(sql)?.[1];
  if (table === undefined) return false;
  return (
    db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table) !==
    undefined
  );
}
