// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

import { ownEntry } from '../parse.js';
import { AVT_FIELDS } from '../registries/aventuras.js';
import { JsonCount, LazyText, lazyText, readJson, type JsonTreatment } from './avt-json.js';
import { AVENTURAS_DATABASE } from './reader.js';
import { isRecord } from './shapes.js';
import type {
  AventurasBackground,
  AventurasBeat,
  AventurasBranch,
  AventurasCharacter,
  AventurasEntry,
  AventurasIllustration,
  AventurasItem,
  AventurasLocation,
  AventurasLoreEntry,
  AventurasPicture,
  AventurasStoryRows,
  AventurasWorldRow,
  PictureRead,
  PortraitReader,
} from './story-rows.js';
import {
  decodePortrait,
  DEFAULT_MAX_PORTRAIT_BYTES,
  portraitOf,
  textLimit,
} from './vault-character.js';

/**
 * ***One Aventuras story, from its `.avt`*** —
 * [P13.15](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * **The second row source**, which is what `story-rows.ts` was split out for
 * at P13.11. A `.avt` is `gatherStoryData()` — every row one story owns, on
 * every branch, run through Aventuras' own row mappers — serialised, and
 * `story-rows.ts` already reads the database into *those mapped shapes*. So
 * this fills the same {@link AventurasStoryRows} from JSON, and the producer
 * (`story.ts`, `world.ts`, `pictures.ts`) never learns which it was handed:
 * the same story makes the same session from either. What had to be decided
 * here, and nowhere else, is below.
 *
 * ***The same story is the same key.*** Aventuras writes the story's own row
 * into the file — its `id` is the database's — and every row under it keeps
 * its database id too (`exportToAventura` copies them; only Aventuras'
 * *import* mints new ones, `import/idMaps.ts`). So the key is
 * `aventura.db/stories/<id>` from the file's `story.id`, exactly the key the
 * database reader gives the story's row, and every turn, actor and entry id
 * derived from it — `producedTurnId` over the entry ids, the cast's keys over
 * the character ids, the book's over the story's — comes out the same. A story
 * brought across from the database and then from its `.avt`, or the other way
 * round, is `already-here` the second time and not a copy.
 *
 * *What that does not reach, and should not.* A `.avt` imported **into**
 * another Aventuras is a new story there: `buildIdMaps` gives it and every row
 * under it a fresh id, and marks the title `(Imported)`. Aventuras itself
 * holds the two as two stories — its own sync finds a story to replace by
 * *title*, never by id — so a later sweep of that second install makes a
 * second session here too. That is Aventuras' answer to *is this the same
 * story*, and this build gives the same one rather than guessing across
 * installs by title.
 *
 * ***The version is gated as the database's columns are*** (§1.4), by what
 * Aventuras' own importer does with it — which is to read any version: it
 * requires `version`, `story` and a non-empty `entries`, and otherwise reads
 * whichever sections are present, warning (to its console) about what an
 * older file lacked. Every version from 1.1.0 to 1.10.0 added fields and
 * changed none (`import/types.ts`), so:
 *
 * - **1.x at or below the pin's 1.10.0** reads as it is. An older file lacks
 *   what its version predates — no lorebook before 1.1.0, no pictures before
 *   1.4.0, no portraits before 1.5.0, no branches before 1.6.0 — and reads as
 *   Aventuras' importer reads it, those sections empty and every entry on the
 *   main line; `import.aventuras.avtOlderFormat` says it is older.
 * - **1.x past it** reads too, with `import.aventuras.avtNewerFormat` at
 *   `warn`: the same bargain as a newer schema, since a minor version there is
 *   a field added and every field this build reads is still where it was.
 * - **Any other major, or a version that is not one**, is refused
 *   (`import.aventuras.avtUnknownFormat`) and writes nothing. A 2.0.0 would be
 *   Aventuras saying the shape changed, and a best-effort read of a shape we
 *   have not seen is the plausible, wrong session §1.4's own comment warns
 *   against — the one place the gate is Marinara's rather than the columns'.
 *
 * ***The pictures stay in the file until they are carried*** — P13.13's rule
 * from the database, kept with the bytes. The file is read once
 * (`avt-json.ts`), each `imageData` and `portrait` left as a span of it, so a
 * picture's stored length is known without reading it and the bound is held
 * before anything is decoded; {@link AventurasPictures.read} and the portrait
 * reader decode one at a time, as the Writer asks. The bytes the file arrived
 * as are the only copy held, and the candidate holds them until the Writer is
 * done with it.
 *
 * ***What the file carries that the database reader never reads is not read
 * here either***: checkpoints and chapters are counted (the chapters' reason
 * is P13.14's), a story's translations, world-state deltas, retry, style and
 * memory state are skipped, and the pack binding is skipped as packs are
 * recorded. ***One thing the database has and the file does not***: the
 * backdrops. `background_images` is not in `gatherStoryData()`; the file's
 * `currentBgImage` is one picture with no branch, which Aventuras' own import
 * drops, so a story from its `.avt` comes with its illustrations and no
 * backdrop, and the row says so.
 */

/** The candidate format a `.avt` is emitted as. */
export const AVT_FORMAT = 'aventuras.avt';

/** `EXPORT_FORMAT_VERSION` at the pin: the newest `.avt` this build was written against. */
export const AVT_KNOWN_VERSION = '1.10.0';

/** How long a version string may be when it is named in a note: a real one is `1.10.0`. */
const VERSION_LENGTH = 32;

/** What a story row counts when a sweep does not ask for it — `import.aventuras.storyRecorded`'s params. */
export interface AvtTally {
  entries: number;
  branches: number;
  characters: number;
  locations: number;
  items: number;
  beats: number;
  lore: number;
  chapters: number;
  checkpoints: number;
  images: number;
}

/** One story, read from its file and ready for the producer. */
export interface AvtStory {
  /** `aventura.db/stories/<id>` — the database's key for the same story; see the file header. */
  key: string;
  title: string;
  /** The file's format version, clamped. */
  version: string;
  rows: AventurasStoryRows;
  /**
   * The same rows with the pictures held to another bound — the sweep's
   * `stories.maxPictureBytes`, which a test sets to meet the bound without a
   * sixty-four-megabyte fixture, and which reaches the file only after it has
   * been read.
   */
  withPictureBound: (maxPictureBytes: number) => AventurasStoryRows;
  tally: AvtTally;
  /** What the file itself says: its version, and a backdrop left behind. */
  notes: ImportNote[];
}

export type AvtRead =
  /** Not a `.avt` at all: some other JSON, or not JSON. The caller's other probes decide. */
  | { kind: 'not-avt' }
  /** A `.avt` this build will not read, and the notes that say why. Nothing is written. */
  | { kind: 'refused'; notes: ImportNote[] }
  | { kind: 'story'; story: AvtStory };

export interface AvtOptions {
  /** The file's name as it arrived, for the notes that name it. */
  file: string;
  /** A portrait's bound, decoded — `DEFAULT_MAX_PORTRAIT_BYTES` unless a test meets it. */
  maxPortraitBytes?: number;
  /** A picture's bound, decoded — the portrait's, unless a test meets it. */
  maxPictureBytes?: number;
}

/**
 * ***Whether these bytes could be a `.avt`, without reading them*** — the two
 * field names Aventuras' importer requires, and an object to hold them. A
 * `false` is final; a `true` is a question for {@link readAvt}. So every other
 * JSON a folder holds pays two searches of its bytes and not a second parse.
 */
export function mayBeAvt(bytes: Uint8Array): boolean {
  let first = 0;
  while (first < bytes.byteLength && isSpace(bytes[first])) first += 1;
  if (bytes[first] !== 0x7b) return false;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return buffer.includes('"story"') && buffer.includes('"entries"');
}

/**
 * ***The file, read as one story*** — or `not-avt`, or refused. See the file
 * header for the gate and the identity.
 *
 * **Recognised by content, never by name.** A `.avt` is a JSON object whose
 * `story` is an object and whose `entries` is an array — Aventuras'
 * `validateExport`, less the version it then checks — and no other format
 * this build reads has both: a SillyTavern world keeps `entries` as an object
 * keyed by uid, and nothing else names a `story`. A file that has them and
 * will not read is refused rather than passed on, since the probes after this
 * one would read it as a lorebook.
 */
export function readAvt(bytes: Uint8Array, options: AvtOptions): AvtRead {
  if (!mayBeAvt(bytes)) return { kind: 'not-avt' };
  const read = readJson(bytes, avtPolicy);
  if (!read.ok) {
    // Too deep to walk is a refusal only of a file that could be one; that it
    // could is all `mayBeAvt` knows, and a JSON file nested that deep is
    // nothing any other probe here reads either.
    return read.reason === 'too-deep'
      ? refusedAvt('import.aventuras.avtUnreadable', { file: options.file, reason: 'too-deep' })
      : { kind: 'not-avt' };
  }
  const root = read.value;
  if (!isRecord(root) || !isRecord(root['story']) || !Array.isArray(root['entries'])) {
    return { kind: 'not-avt' };
  }

  const rawVersion = typeof root['version'] === 'string' ? root['version'] : '';
  const version = rawVersion.slice(0, VERSION_LENGTH);
  const parsed = parseVersion(rawVersion);
  if (parsed?.[0] !== 1) {
    return refusedAvt('import.aventuras.avtUnknownFormat', {
      file: options.file,
      version: version === '' ? '—' : version,
      known: AVT_KNOWN_VERSION,
    });
  }

  const story = root['story'];
  const id = text(story['id']);
  if (id === null) {
    return refusedAvt('import.aventuras.avtUnreadable', { file: options.file, reason: 'no-story' });
  }
  const title = typeof story['title'] === 'string' ? story['title'] : '';

  const notes: ImportNote[] = [];
  const known = parseVersion(AVT_KNOWN_VERSION) ?? [1, 10, 0];
  const order = compareVersions(parsed, known);
  if (order > 0) {
    notes.push({
      key: 'import.aventuras.avtNewerFormat',
      params: { story: title, version, known: AVT_KNOWN_VERSION },
      level: 'warn',
    });
  } else if (order < 0) {
    notes.push({
      key: 'import.aventuras.avtOlderFormat',
      params: { story: title, version },
      level: 'info',
    });
  }
  // The backdrop the file carries — on the story, where Aventuras' importer
  // looks, or beside it, where its exporter's parameter puts one — is left.
  const backdrop = [story['currentBgImage'], root['currentBgImage']].some(
    (value) => value instanceof LazyText && value.octets > 0,
  );
  if (backdrop) {
    notes.push({
      key: 'import.aventuras.avtBackdropNotCarried',
      params: { story: title },
      level: 'info',
    });
  }

  const rows = storyRows(bytes, root, id, title, options);
  return {
    kind: 'story',
    story: {
      key: `${AVENTURAS_DATABASE}/stories/${id}`,
      title,
      version,
      rows,
      withPictureBound: (maxPictureBytes) =>
        storyRows(bytes, root, id, title, { ...options, maxPictureBytes }),
      tally: tallyOf(root),
      notes,
    },
  };
}

/**
 * ***What is kept of each field*** — the registry's disposition for a field
 * at the top ({@link AVT_FIELDS}: converted is read, recorded is counted,
 * skipped is not kept), and beneath them the few values that are pictures,
 * left in the bytes, or working state, left out. A field the registry lacks
 * is skipped, as a table the database reader does not know is only counted.
 */
function avtPolicy(path: readonly string[]): JsonTreatment {
  const [field, second, third] = path;
  if (field === undefined) return 'value';
  if (path.length === 1) {
    if (field === 'version' || field === 'exportedAt') return 'value';
    // Kept as a span, so whether it held a picture is known without reading it.
    if (field === 'currentBgImage') return 'lazy';
    const disposition = ownEntry(AVT_FIELDS, field);
    if (disposition === 'converted') return 'value';
    if (disposition === 'recorded') return 'count';
    return 'skip';
  }
  if (field === 'story' && path.length === 2 && second !== undefined) {
    if (second === 'currentBgImage') return 'lazy';
    return STORY_UNREAD.has(second) ? 'skip' : 'value';
  }
  if (path.length === 3 && second === '*' && third !== undefined) {
    if (field === 'embeddedImages' && third === 'imageData') return 'lazy';
    if (field === 'characters' && third === 'portrait') return 'lazy';
    if (field === 'entries' && ENTRY_UNREAD.has(third)) return 'skip';
    if (third.startsWith('translated')) return 'skip';
  }
  return 'value';
}

/**
 * The story's working state — `story-rows.ts`'s *"not read at this stage"*,
 * for the same reasons: Aventuras' own retry, style-review, memory and
 * time-tracker blobs, and the pack binding's answers.
 */
const STORY_UNREAD: ReadonlySet<string> = new Set([
  'retryState',
  'styleReviewState',
  'memoryConfig',
  'timeTracker',
  'customVariableValues',
]);

/** An entry's per-entry world diff and its translation cache — not read from the database either. */
const ENTRY_UNREAD: ReadonlySet<string> = new Set(['worldStateDelta', 'translatedContent']);

function refusedAvt(key: string, params: ImportNote['params']): AvtRead {
  return { kind: 'refused', notes: [{ key, params, level: 'warn' }] };
}

/**
 * ***The same rows the database reader makes***, field for field and in the
 * same order — which is what makes the same session. Each field is normalised
 * as `story-rows.ts` normalises its column (an empty string is absent, a
 * `null` JSON value is `undefined`), since a mapper's `null` and SQLite's
 * `NULL` are one fact about the story; and each list is sorted as its
 * statement orders it there, `collate nocase` included, because the order of
 * the cast and the book is what a second import compares.
 */
function storyRows(
  bytes: Uint8Array,
  root: Record<string, unknown>,
  id: string,
  title: string,
  options: AvtOptions,
): AventurasStoryRows {
  const story = isRecord(root['story']) ? root['story'] : {};
  let unreadable = 0;
  /** A list field: `[]` for absent, and for one that is not a list, which is counted. */
  const list = (value: unknown): unknown[] => {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value as unknown[];
    unreadable += 1;
    return [];
  };

  const entries: AventurasEntry[] = records(root['entries'])
    .filter((entry) => text(entry['id']) !== null)
    .map((entry) => ({
      id: text(entry['id']) ?? '',
      type: text(entry['type']) ?? '',
      content: text(entry['content']) ?? '',
      position: number(entry['position']) ?? 0,
      createdAt: number(entry['createdAt']) ?? 0,
      metadata: json(entry['metadata']),
      // Absent before 1.6.0, which had no branches: every entry on main.
      branchId: text(entry['branchId']),
      reasoning: text(entry['reasoning']),
      originalInput: text(entry['originalInput']),
      suggestedActions: suggestions(entry['suggestedActions']),
    }))
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt || binary(a.id, b.id));

  const branches: AventurasBranch[] = records(root['branches'])
    .filter((branch) => text(branch['id']) !== null && text(branch['forkEntryId']) !== null)
    .map((branch) => ({
      id: text(branch['id']) ?? '',
      name: text(branch['name']) ?? '',
      parentBranchId: text(branch['parentBranchId']),
      forkEntryId: text(branch['forkEntryId']) ?? '',
      createdAt: number(branch['createdAt']) ?? 0,
      snapshotComplete: flag(branch['snapshotComplete']),
    }))
    .sort((a, b) => a.createdAt - b.createdAt || binary(a.id, b.id));

  // ── The world, every branch's, in the database reader's order ───────────
  const place = (row: Record<string, unknown>): AventurasWorldRow => ({
    id: text(row['id']) ?? '',
    branchId: text(row['branchId']),
    overridesId: text(row['overridesId']),
    deleted: flag(row['deleted']),
  });
  const withId = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
    rows.filter((row) => text(row['id']) !== null);

  const portraits = new Map<string, LazyText | string>();
  const characters: AventurasCharacter[] = withId(records(root['characters'])).map((row) => {
    const portrait = row['portrait'];
    const stored =
      portrait instanceof LazyText ? portrait : typeof portrait === 'string' ? portrait : null;
    const rowId = text(row['id']) ?? '';
    // The first row of an id, as the database's `where id = ?` finds it.
    if (stored !== null && !portraits.has(rowId)) portraits.set(rowId, stored);
    return {
      ...place(row),
      name: text(row['name']) ?? '',
      description: text(row['description']),
      relationship: text(row['relationship']),
      traits: list(row['traits']),
      visualDescriptors: json(row['visualDescriptors']),
      status: text(row['status']),
      metadata: json(row['metadata']),
      portraitOctets: stored === null ? null : octetsOf(stored),
    };
  });
  sortByName(characters, (row) => row.name);

  const locations: AventurasLocation[] = withId(records(root['locations'])).map((row) => ({
    ...place(row),
    name: text(row['name']) ?? '',
    description: text(row['description']),
    visited: flag(row['visited']),
    current: flag(row['current']),
    connections: list(row['connections']),
    metadata: json(row['metadata']),
  }));
  sortByName(locations, (row) => row.name);

  const items: AventurasItem[] = withId(records(root['items'])).map((row) => ({
    ...place(row),
    name: text(row['name']) ?? '',
    description: text(row['description']),
    quantity: integer(row['quantity']),
    equipped: flag(row['equipped']),
    location: text(row['location']),
    metadata: json(row['metadata']),
  }));
  sortByName(items, (row) => row.name);

  const beats: AventurasBeat[] = withId(records(root['storyBeats'])).map((row) => ({
    ...place(row),
    title: text(row['title']) ?? '',
    description: text(row['description']),
    type: text(row['type']),
    status: text(row['status']),
    triggeredAt: integer(row['triggeredAt']),
    resolvedAt: integer(row['resolvedAt']),
    metadata: json(row['metadata']),
  }));
  sortByName(beats, (row) => row.title);

  const lore: AventurasLoreEntry[] = withId(records(root['lorebookEntries'])).map((row) => ({
    ...place(row),
    name: text(row['name']) ?? '',
    type: text(row['type']) ?? '',
    description: text(row['description']),
    hiddenInfo: text(row['hiddenInfo']),
    aliases: json(row['aliases']),
    state: stateOf(row['state'], row['type']),
    adventureState: json(row['adventureState']),
    creativeState: json(row['creativeState']),
    injection: json(row['injection']),
    createdBy: text(row['createdBy']),
  }));
  sortByName(lore, (row) => row.name);

  const maxPortraitBytes = options.maxPortraitBytes ?? DEFAULT_MAX_PORTRAIT_BYTES;
  /**
   * A portrait, asked for when its actor is about to be stored — and held to
   * its bound by its stored length before it is read, through the very
   * function the database's portraits go through, handed the row shape
   * SQLite would have handed it: the text only when under the bound.
   */
  const portrait: PortraitReader = (characterId, actor, key, notes) => {
    const stored = portraits.get(characterId);
    if (stored === undefined) return null;
    const octets = octetsOf(stored);
    const within = octets <= textLimit(maxPortraitBytes);
    const value = within ? textOf(bytes, stored) : undefined;
    return portraitOf(
      { portrait: value ?? undefined, portrait_octets: octets },
      actor,
      key,
      maxPortraitBytes,
      notes,
    );
  };

  // ── The pictures: the story's illustrations, and no backdrops ───────────
  const images = new Map<string, LazyText | string>();
  const illustrations: AventurasIllustration[] = records(root['embeddedImages'])
    .filter((row) => text(row['id']) !== null && text(row['entryId']) !== null)
    .map((row) => {
      const data = row['imageData'];
      const stored = data instanceof LazyText ? data : typeof data === 'string' ? data : null;
      const imageId = text(row['id']) ?? '';
      if (stored !== null && !images.has(imageId)) images.set(imageId, stored);
      return {
        table: 'embedded_images' as const,
        id: imageId,
        entryId: text(row['entryId']) ?? '',
        createdAt: number(row['createdAt']) ?? 0,
        octets: stored === null ? null : octetsOf(stored),
        sourceText: text(row['sourceText']),
        prompt: typeof row['prompt'] === 'string' ? row['prompt'] : '',
        styleId: text(row['styleId']),
        model: text(row['model']),
        status: text(row['status']),
      };
    })
    .sort((a, b) => a.createdAt - b.createdAt || binary(a.id, b.id));
  const backgrounds: AventurasBackground[] = [];

  const maxPictureBytes = options.maxPictureBytes ?? maxPortraitBytes;
  /** One picture's bytes, read now — `story-rows.ts`'s `read`, rule for rule. */
  const read = (picture: AventurasPicture): PictureRead => {
    if (picture.table !== 'embedded_images') return 'absent';
    const stored = images.get(picture.id);
    if (stored === undefined) return 'absent';
    const octets = octetsOf(stored);
    if (octets === 0) return 'absent';
    if (octets > textLimit(maxPictureBytes)) return 'too-large';
    const value = textOf(bytes, stored);
    if (value === null) return 'unreadable';
    if (value.trim().length === 0) return 'absent';
    const decoded = decodePortrait(value);
    if (decoded === null) return 'unreadable';
    return decoded.byteLength > maxPictureBytes ? 'too-large' : decoded;
  };

  return {
    story: {
      id,
      title,
      createdAt: number(story['createdAt']),
      updatedAt: number(story['updatedAt']),
      settings: json(story['settings']),
      mode: text(story['mode']),
      // Absent before 1.6.0: the main line, which is where every entry is.
      currentBranchId: text(story['currentBranchId']),
    },
    entries,
    branches,
    world: { characters, locations, items, beats, lore, unreadable, portrait },
    pictures: { illustrations, backgrounds, maxBytes: maxPictureBytes, read },
    // Every JSON value of the file was parsed once, whole, or the file was
    // refused: there is no column that failed on its own, as a database has.
    unreadable: 0,
  };
}

/**
 * ***What the story holds, across all its branches*** — `storyRecorded`'s
 * numbers, counted as the database reader counts them: a branch's edit and a
 * deletion's tombstone are not things a story holds (`entitiesOnly`), and the
 * pictures are the illustrations, since the file carries no backdrops.
 */
function tallyOf(root: Record<string, unknown>): AvtTally {
  const held = (value: unknown): number =>
    records(value).filter((row) => text(row['overridesId']) === null && !flag(row['deleted']))
      .length;
  const counted = (value: unknown): number => (value instanceof JsonCount ? value.count : 0);
  return {
    entries: records(root['entries']).length,
    branches: records(root['branches']).length,
    characters: held(root['characters']),
    locations: held(root['locations']),
    items: held(root['items']),
    beats: held(root['storyBeats']),
    lore: held(root['lorebookEntries']),
    chapters: counted(root['chapters']),
    checkpoints: counted(root['checkpoints']),
    images: records(root['embeddedImages']).length,
  };
}

/** A version as numbers — Aventuras' `compareVersions` input — or `null` for one that is not. */
function parseVersion(version: string): number[] | null {
  if (!/^\d{1,6}(\.\d{1,6}){0,2}$/.test(version)) return null;
  return version.split('.').map(Number);
}

/** Aventuras' `compareVersions`: a missing part is zero. */
function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isSpace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/** `story-rows.ts`'s `text`: an empty string is no string. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** A JSON value as a parsed column is: `null` is absent. */
function json(value: unknown): unknown {
  return value === null ? undefined : value;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * ***An entry's tracked state, less the one `mapEntry` made up.*** For a
 * `NULL` column the mapper writes `{ type: row.type }`, and `world.ts` keeps
 * *absent* absent rather than carry that invention. Every state Aventuras
 * itself writes has more than its `type` (`EntryState` at the pin: a
 * character's presence, a place's visits, a faction's standing, …), so a state
 * that is exactly `{ type }`, naming the entry's own type, is the mapper's and
 * reads as the database's `NULL` does.
 */
function stateOf(value: unknown, type: unknown): unknown {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === 'type' && value['type'] === type) return undefined;
  }
  return json(value);
}

/** `vault-row.ts`'s `integer`: a number in the safe range, or nothing. */
function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/** A mapper's boolean — `row.x === 1` in Aventuras — or the `1` a hand-written file might hold. */
function flag(value: unknown): boolean {
  return value === true || value === 1;
}

/**
 * `suggested_actions` as the database holds it: JSON text, which
 * `mapStoryEntry` passes through unparsed. A file somebody's tool wrote with
 * the list itself is written back as the text it stands for.
 */
function suggestions(value: unknown): string | null {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  return null;
}

function octetsOf(stored: LazyText | string): number {
  return stored instanceof LazyText ? stored.octets : Buffer.byteLength(stored, 'utf8');
}

function textOf(bytes: Uint8Array, stored: LazyText | string): string | null {
  return stored instanceof LazyText ? lazyText(bytes, stored) : stored;
}

/**
 * ***`order by <name> collate nocase, id`***, as the database reader's world
 * statements order their rows: SQLite's `nocase` folds ASCII letters only, and
 * the id breaks a tie by its bytes.
 */
function sortByName<T extends { id: string }>(rows: T[], name: (row: T) => string): void {
  rows.sort((a, b) => binary(fold(name(a)), fold(name(b))) || binary(a.id, b.id));
}

function fold(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * Two strings by code unit — SQLite's `binary` compares UTF-8 bytes, and the
 * two orders differ only between a character past U+FFFF and one from U+E000
 * up, which no id Aventuras mints has.
 */
function binary(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
