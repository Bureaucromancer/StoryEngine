// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import type { ImportNote } from '@storyengine/shared';

import { columnsOf, quoted } from './schema.js';
import {
  decodePortrait,
  DEFAULT_MAX_PORTRAIT_BYTES,
  portraitOf,
  textLimit,
} from './vault-character.js';
import { integer } from './vault-row.js';

/**
 * ***One Aventuras story, as rows*** —
 * [P13.11](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * [18 §2.3.1](../../../../../docs/design/18-session-import.md).
 *
 * **The half of the story producer that knows where the rows came from**, and
 * the only half: `story.ts` turns these into a `storyengine.session-export/1`
 * document and never sees a database. The split is for
 * [P13.15](../../../../../docs/design/workplan/30-p13-aventuras-import.md): a
 * `.avt` file is `gatherStoryData()` serialised — every row of one story, run
 * through Aventuras' own row mappers — so the shapes below are **those mapped
 * shapes** (`mapStory`, `mapStoryEntry`, the branch row, camel-cased as
 * Aventuras' `database.ts` returns them), and reading a `.avt` is a second
 * function that fills the same three arrays from JSON. The producer does not
 * change.
 *
 * ***What is read, and what deliberately is not.*** Only the columns the tree
 * and the turns need, each gated in `schema.ts` on the migration that added it,
 * and read as `null` on a database older than that:
 *
 * - `stories`: the title, the two times, the settings blob (for the narrator
 *   prompt, see `story.ts`), the mode, and **`current_branch_id`** — which
 *   branch the person was on, and so where the imported session's head is.
 * - `story_entries`: the kind, the text, **`position`** and **`branch_id`**
 *   (the whole of the tree, below), the time, the generation metadata, the
 *   reasoning, the untranslated input, and the saved suggestions.
 * - `branches`: the name, the parent and **`fork_entry_id`**.
 *
 * **`parent_id` is never selected.** It is declared on `StoryEntry` and every
 * site in Aventuras that writes an entry writes `null` into it
 * ([18 §2.3.1](../../../../../docs/design/18-session-import.md)), so a reader
 * that trusted it would rebuild every story as a list of roots. The tree is
 * the branches and the positions, and that is all this reads it from.
 *
 * - *Since P13.12*, **the story's world** — every row of `characters`,
 *   `locations`, `items`, `story_beats` and `entries` the story has, on every
 *   branch, with the three columns that say which view each belongs to
 *   (`branch_id`, `overrides_id`, `deleted`), and `branches.snapshot_complete`.
 *   *Every branch's, and not the head's alone*: which rows the head sees is a
 *   resolution over all of them (`world.ts`), and what the other branches hold
 *   differently is said on the review, which needs theirs too. The shapes are
 *   `mapCharacter`'s, `mapLocation`'s, `mapItem`'s, `mapStoryBeat`'s and
 *   `mapEntry`'s, minus what `schema.ts` says is not read.
 *
 * *Not read at this stage:* the translation columns (a display cache of text
 * this does read), `world_state_delta` (a per-entry diff of the world this
 * reads whole), and the story's retry, style-review, memory and time-tracker
 * blobs, which are Aventuras' working state rather than the story.
 *
 * ***A character's portrait is not in the rows*** — only its stored length.
 * Every branch that copied the world holds its own copy of every portrait, so
 * reading them with the rows would hold a story's whole gallery once per
 * branch to import the head's; {@link AventurasWorld.portrait} reads one when
 * the Writer is about to store the actor it belongs to, bounded as a vault
 * portrait is ([P13.3]). A `.avt` reader answers the same question from its
 * JSON.
 *
 * - *Since P13.13*, **the story's pictures** — `embedded_images`, drawn into an
 *   entry's text, and `background_images`, the backdrop a branch (or a
 *   checkpoint) was showing — as `mapEmbeddedImage` and
 *   `getBackgroundForBranch` read them, *without the pixels*, for the
 *   portrait's reason and a larger one: a story's pictures are what an
 *   install's size is made of after its entries, and Aventuras itself keeps
 *   them off its hot paths (`getEmbeddedImageMetaForStory`, written after
 *   whole-story reads crashed Android builds). Each row carries its stored
 *   length instead, and {@link AventurasPictures.read} reads one picture's
 *   bytes when the Writer is about to carry it, bounded as a portrait is.
 */

/** A `stories` row, as `mapStory` returns the fields this reads. */
export interface AventurasStory {
  id: string;
  title: string;
  /** Milliseconds since the epoch, as Aventuras writes every time. */
  createdAt: number | null;
  updatedAt: number | null;
  /** `StorySettings`, parsed; `undefined` when the column is empty or does not parse. */
  settings: unknown;
  /** `'adventure'` or `'creative-writing'` at the pin; `null` before migration 2. */
  mode: string | null;
  /** The branch the person was on; `null` is Aventuras' implicit main line. */
  currentBranchId: string | null;
}

/** A `story_entries` row, as `mapStoryEntry` returns the fields this reads. */
export interface AventurasEntry {
  id: string;
  /** `user_action`, `narration` or `system` at the pin. Anything else is reported, not guessed at. */
  type: string;
  content: string;
  /** The entry's place in its branch's lineage — see the header of `story.ts`. */
  position: number;
  createdAt: number;
  /** `EntryMetadata`, parsed; `undefined` when empty or unreadable. */
  metadata: unknown;
  /** `null` is the main line, which has no `branches` row. */
  branchId: string | null;
  reasoning: string | null;
  /** What the person typed, when a translation replaced it in `content`. */
  originalInput: string | null;
  /** A JSON array of `{ text, type }`, as Aventuras stores it. */
  suggestedActions: string | null;
}

/** A `branches` row. */
export interface AventurasBranch {
  id: string;
  name: string;
  /** `null` for a branch off the main line. */
  parentBranchId: string | null;
  /** The last entry of the parent's lineage this branch shares. */
  forkEntryId: string;
  createdAt: number;
  /**
   * `snapshot_complete` (029): the branch owns a complete copy of the world
   * and needs no lineage to resolve it. `false` before 029, and for every
   * branch made since without Aventuras' experimental lightweight branches —
   * which is not the same as *owns only its edits*; `world.ts` says why.
   */
  snapshotComplete: boolean;
}

/**
 * ***What every row of a story's world carries***, besides what it describes:
 * which view it belongs to. `branchId` is `null` on the main line;
 * `overridesId` names the row this one is a branch's edit of (026), and
 * `deleted` makes it a tombstone (028). Both are `null` and `false` on a
 * database older than their migration, which had neither kind of row.
 */
export interface AventurasWorldRow {
  id: string;
  branchId: string | null;
  overridesId: string | null;
  deleted: boolean;
}

/** A `characters` row, as `mapCharacter` returns the fields this reads. */
export interface AventurasCharacter extends AventurasWorldRow {
  name: string;
  description: string | null;
  /** `self` is the protagonist — the person playing; anything else is prose. */
  relationship: string | null;
  traits: unknown[];
  /** Parsed and not repaired: `world.ts` repairs it as a vault row's is. */
  visualDescriptors: unknown;
  status: string | null;
  metadata: unknown;
  /** The stored portrait's length in bytes, or `null` for none — see the file header. */
  portraitOctets: number | null;
}

/** A `locations` row. */
export interface AventurasLocation extends AventurasWorldRow {
  name: string;
  description: string | null;
  visited: boolean;
  current: boolean;
  /** Other locations' ids — of this branch's rows, since a copy remaps them. */
  connections: unknown[];
  metadata: unknown;
}

/** An `items` row. */
export interface AventurasItem extends AventurasWorldRow {
  name: string;
  description: string | null;
  quantity: number | null;
  equipped: boolean;
  /** `inventory`, or a location's id. */
  location: string | null;
  metadata: unknown;
}

/** A `story_beats` row. */
export interface AventurasBeat extends AventurasWorldRow {
  title: string;
  description: string | null;
  /** `milestone`, `quest`, `revelation`, `event` or `plot_point` at the pin. */
  type: string | null;
  /** `pending`, `active`, `completed` or `failed` at the pin. */
  status: string | null;
  triggeredAt: number | null;
  resolvedAt: number | null;
  metadata: unknown;
}

/** An `entries` row — the story's own lorebook, Aventuras' `Entry`. */
export interface AventurasLoreEntry extends AventurasWorldRow {
  name: string;
  type: string;
  description: string | null;
  hiddenInfo: string | null;
  aliases: unknown;
  state: unknown;
  adventureState: unknown;
  creativeState: unknown;
  injection: unknown;
  createdBy: string | null;
}

/** A portrait, asked for: its bytes, or `null` with the reason in the caller's notes. */
export type PortraitReader = (
  characterId: string,
  /** Named in a note that says why the portrait did not come. */
  actor: string,
  /** The asset key the Writer hands the bytes over under. */
  key: string,
  notes: ImportNote[],
) => Uint8Array | null;

/** Every row of a story's world, on every branch — [P13.12]. */
export interface AventurasWorld {
  characters: AventurasCharacter[];
  locations: AventurasLocation[];
  items: AventurasItem[];
  beats: AventurasBeat[];
  lore: AventurasLoreEntry[];
  /**
   * JSON columns of the world that did not parse — counted as the tree's are,
   * each costing its own field (`worldFieldsUnreadable`).
   */
  unreadable: number;
  portrait: PortraitReader;
}

/**
 * ***A picture a story holds, before its bytes are read*** — [P13.13]. What
 * both tables share: the row, when it was made, and how long its stored
 * `image_data` is — the measure the bound is checked against before anything
 * is loaded, as a portrait's `octet_length` is.
 */
interface AventurasPictureRow {
  id: string;
  /** Milliseconds since the epoch; `0` for a row that has no time. */
  createdAt: number;
  /** `octet_length(image_data)`: `null` or `0` for a row with no picture in it. */
  octets: number | null;
}

/**
 * An `embedded_images` row — a picture Aventuras drew into one entry's text,
 * as `mapEmbeddedImageMeta` returns it, less `width` and `height`.
 */
export interface AventurasIllustration extends AventurasPictureRow {
  table: 'embedded_images';
  /** The entry whose text it illustrates — see `pictures.ts` for which turn that is. */
  entryId: string;
  /**
   * The text in the entry it belongs beside, matched case-insensitively by
   * Aventuras — or the whole `<pic …>` tag, for an image the model asked for
   * inline. Either way a quote of the entry, which is what an anchor is.
   */
  sourceText: string | null;
  /** *"Full generation prompt"*: what Aventuras sent its image model. */
  prompt: string;
  styleId: string | null;
  model: string | null;
  /** `pending`, `generating`, `complete` or `failed` at the pin. */
  status: string | null;
}

/**
 * A `background_images` row — the backdrop one branch was showing
 * (`checkpointId` null), or the one a checkpoint saved. `branchId` null is
 * the main line, as everywhere in Aventuras.
 */
export interface AventurasBackground extends AventurasPictureRow {
  table: 'background_images';
  branchId: string | null;
  checkpointId: string | null;
}

export type AventurasPicture = AventurasIllustration | AventurasBackground;

/**
 * One picture's bytes, asked for — or why there are none: `too-large` past
 * the bound, measured and never loaded; `unreadable` for a value that is not
 * base64 — a link, which is never fetched, or a data URL that is not base64 —
 * or that decodes to nothing; `absent` for a row that holds no picture at
 * all, which is what an unfinished one holds.
 */
export type PictureRead = Uint8Array | 'too-large' | 'unreadable' | 'absent';

/** Every picture of a story, on every branch — [P13.13]. */
export interface AventurasPictures {
  illustrations: AventurasIllustration[];
  backgrounds: AventurasBackground[];
  /** The bound {@link read} holds a picture to, decoded — for the note that names it. */
  maxBytes: number;
  /**
   * ***One picture's bytes, read now***, bounded before it is loaded — SQLite
   * is asked for the length first, and a value past the bound is never
   * selected. Asked once per picture by the Writer as it builds the record,
   * and again as `importSession` writes the bytes, so a story's gallery is
   * never in memory at once.
   */
  read: (picture: AventurasPicture) => PictureRead;
}

/** Everything the producer reads of one story. */
export interface AventurasStoryRows {
  story: AventurasStory;
  entries: AventurasEntry[];
  branches: AventurasBranch[];
  /** The story's world — [P13.12]. Empty on a database older than every table of it. */
  world: AventurasWorld;
  /** The story's pictures — [P13.13]. Empty on a database older than both tables. */
  pictures: AventurasPictures;
  /**
   * How many JSON fields did not parse — the settings blob, an entry's
   * metadata. Counted rather than refused: each costs its own field and
   * nothing else, and the producer says how many (`entryFieldsUnreadable`).
   */
  unreadable: number;
}

/**
 * ***One story's rows, or `null` when the database has no such story.***
 *
 * `tables` is the set the gate returned, so a database older than
 * `branches` (migration 13) reads as a story with no branches, which is what
 * it has. Every late column is selected only when present, for the same
 * reason; the gate has already refused a database past a column's migration
 * that lacks it.
 */
export function readStoryRows(
  db: DatabaseSync,
  storyId: string,
  tables: ReadonlySet<string>,
  options: { maxPortraitBytes?: number; maxPictureBytes?: number } = {},
): AventurasStoryRows | null {
  let unreadable = 0;
  const json = (value: SQLOutputValue | undefined): unknown => {
    if (typeof value !== 'string' || value === '') return undefined;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      unreadable += 1;
      return undefined;
    }
  };

  const storyColumns = columnsOf(db, 'stories');
  const row = db
    .prepare(
      `select id, title, created_at, updated_at, settings, ` +
        `${lateColumn(storyColumns, 'mode')}, ${lateColumn(storyColumns, 'current_branch_id')} ` +
        `from stories where id = ?`,
    )
    .get(storyId);
  if (row === undefined) return null;

  const story: AventurasStory = {
    id: storyId,
    title: text(row['title']) ?? '',
    createdAt: number(row['created_at']),
    updatedAt: number(row['updated_at']),
    settings: json(row['settings']),
    mode: text(row['mode']),
    currentBranchId: text(row['current_branch_id']),
  };

  const entryColumns = columnsOf(db, 'story_entries');
  const late = ['branch_id', 'reasoning', 'original_input', 'suggested_actions']
    .map((column) => lateColumn(entryColumns, column))
    .join(', ');
  /**
   * *In `position` order, and then by time and id*, which is Aventuras' own
   * `ORDER BY position` made total: sibling branches reuse positions after
   * their fork, so a position is unique only within one branch, and the
   * producer sorts within each branch again. The tie-breaks only decide
   * something for a database two writers raced on.
   */
  const entries: AventurasEntry[] = [];
  const statement = db.prepare(
    `select id, type, content, position, created_at, metadata, ${late} ` +
      `from story_entries where story_id = ? order by position, created_at, id`,
  );
  for (const entry of statement.iterate(storyId)) {
    const id = text(entry['id']);
    // A row with no id is one no branch and no turn can name, and Aventuras
    // itself could not have written it (`id TEXT PRIMARY KEY`, set by
    // `crypto.randomUUID()`). Left out; the count in the story's row still
    // has it, which is where a person would notice.
    if (id === null) continue;
    entries.push({
      id,
      type: text(entry['type']) ?? '',
      content: text(entry['content']) ?? '',
      position: number(entry['position']) ?? 0,
      createdAt: number(entry['created_at']) ?? 0,
      metadata: json(entry['metadata']),
      branchId: text(entry['branch_id']),
      reasoning: text(entry['reasoning']),
      originalInput: text(entry['original_input']),
      suggestedActions: text(entry['suggested_actions']),
    });
  }

  const branches: AventurasBranch[] = [];
  if (tables.has('branches')) {
    const complete = lateColumn(columnsOf(db, 'branches'), 'snapshot_complete');
    const listed = db.prepare(
      `select id, name, parent_branch_id, fork_entry_id, created_at, ${complete} ` +
        `from ${quoted('branches')} where story_id = ? order by created_at, id`,
    );
    for (const branch of listed.iterate(storyId)) {
      const id = text(branch['id']);
      const forkEntryId = text(branch['fork_entry_id']);
      if (id === null || forkEntryId === null) continue;
      branches.push({
        id,
        name: text(branch['name']) ?? '',
        parentBranchId: text(branch['parent_branch_id']),
        forkEntryId,
        createdAt: number(branch['created_at']) ?? 0,
        snapshotComplete: number(branch['snapshot_complete']) === 1,
      });
    }
  }

  const world = readWorld(db, storyId, tables, options.maxPortraitBytes);
  const pictures = readPictures(db, storyId, tables, options.maxPictureBytes);
  return { story, entries, branches, world, pictures, unreadable };
}

/**
 * ***The story's pictures, without their pixels*** — [P13.13].
 *
 * `octet_length(image_data)` rather than the column, for the file header's
 * reason; SQLite answers it from the stored value's header for text, so a
 * gallery of large pictures costs a walk of its rows and not a read of them.
 * *In time order, then by id*, which is the order Aventuras shows an entry's
 * pictures in (`getEmbeddedImagesForEntry`) and so the order their ordinals
 * are given in (`pictures.ts`).
 */
function readPictures(
  db: DatabaseSync,
  storyId: string,
  tables: ReadonlySet<string>,
  maxBytes = DEFAULT_MAX_PORTRAIT_BYTES,
): AventurasPictures {
  const illustrations: AventurasIllustration[] = [];
  if (tables.has('embedded_images')) {
    const listed = db.prepare(
      'select id, entry_id, source_text, prompt, style_id, model, status, created_at, ' +
        'octet_length(image_data) as octets ' +
        'from embedded_images where story_id = ? order by created_at, id',
    );
    listed.setReadBigInts(true);
    for (const row of listed.iterate(storyId)) {
      const id = text(row['id']);
      const entryId = text(row['entry_id']);
      // No id, or no entry: nothing a turn could hold, and nothing Aventuras
      // could have drawn (both columns are `NOT NULL` at the pin).
      if (id === null || entryId === null) continue;
      illustrations.push({
        table: 'embedded_images',
        id,
        entryId,
        createdAt: number(row['created_at']) ?? 0,
        octets: integer(row['octets']),
        sourceText: text(row['source_text']),
        prompt: typeof row['prompt'] === 'string' ? row['prompt'] : '',
        styleId: text(row['style_id']),
        model: text(row['model']),
        status: text(row['status']),
      });
    }
  }

  const backgrounds: AventurasBackground[] = [];
  if (tables.has('background_images')) {
    const listed = db.prepare(
      'select id, branch_id, checkpoint_id, created_at, octet_length(image_data) as octets ' +
        'from background_images where story_id = ? order by created_at, id',
    );
    listed.setReadBigInts(true);
    for (const row of listed.iterate(storyId)) {
      const id = text(row['id']);
      if (id === null) continue;
      backgrounds.push({
        table: 'background_images',
        id,
        branchId: text(row['branch_id']),
        checkpointId: text(row['checkpoint_id']),
        createdAt: number(row['created_at']) ?? 0,
        octets: integer(row['octets']),
      });
    }
  }

  /**
   * One statement per table, prepared once, selecting the value only when its
   * stored length is under the bound — `portraitOf`'s rule, so a picture past
   * it is measured and never loaded. The length is asked again rather than
   * taken from the listing, because this is the read the bytes come from and
   * the two are one statement.
   */
  const statementFor = (table: AventurasPicture['table']) =>
    tables.has(table)
      ? db.prepare(
          'select case when octet_length(image_data) <= ? then image_data end as image_data, ' +
            `octet_length(image_data) as octets from ${quoted(table)} ` +
            'where id = ? and story_id = ?',
        )
      : null;
  const statements = {
    embedded_images: statementFor('embedded_images'),
    background_images: statementFor('background_images'),
  };
  for (const statement of Object.values(statements)) statement?.setReadBigInts(true);

  const read = (picture: AventurasPicture): PictureRead => {
    const row = statements[picture.table]?.get(textLimit(maxBytes), picture.id, storyId);
    if (row === undefined) return 'absent';
    const octets = integer(row['octets']);
    if (octets === null || octets === 0) return 'absent';
    if (octets > textLimit(maxBytes)) return 'too-large';
    const value = row['image_data'];
    if (typeof value === 'string' && value.trim().length === 0) return 'absent';
    // The stored text is a data URL or bare base64, as a portrait's is, and
    // is decoded by the same function; a blob somebody else's tool wrote is
    // taken as the bytes it is.
    const bytes =
      typeof value === 'string'
        ? decodePortrait(value)
        : value instanceof Uint8Array && value.byteLength > 0
          ? value
          : null;
    if (bytes === null) return 'unreadable';
    return bytes.byteLength > maxBytes ? 'too-large' : bytes;
  };

  return { illustrations, backgrounds, maxBytes, read };
}

/**
 * ***The story's world, every branch of it*** — [P13.12]. One statement per
 * table, each selecting the columns the gate checked (`schema.ts`) and the
 * late ones as `null` where the database predates them. Integers are read as
 * `bigint` and kept only in the safe range (`vault-row.ts`'s rule), since a
 * `triggered_at` somebody's tool wrote is as able to throw out of a read as a
 * vault row's.
 *
 * Ordered by name, then id, so the same database resolves to the same world in
 * the same order on every run — the cast's order and the book's are what a
 * second sweep compares.
 */
function readWorld(
  db: DatabaseSync,
  storyId: string,
  tables: ReadonlySet<string>,
  maxPortraitBytes = DEFAULT_MAX_PORTRAIT_BYTES,
): AventurasWorld {
  let unreadable = 0;
  const json = (value: SQLOutputValue | undefined): unknown => {
    if (typeof value !== 'string' || value === '') return undefined;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      unreadable += 1;
      return undefined;
    }
  };
  /** A list column: `[]` for absent, and for one that is not a list, which is counted. */
  const list = (value: SQLOutputValue | undefined): unknown[] => {
    const parsed = json(value);
    if (parsed === undefined) return [];
    if (Array.isArray(parsed)) return parsed as unknown[];
    unreadable += 1;
    return [];
  };

  const rowsOf = (
    table: string,
    columns: readonly string[],
    late: readonly string[],
    order: string,
    computed: readonly string[] = [],
  ): Record<string, SQLOutputValue>[] => {
    if (!tables.has(table)) return [];
    const have = columnsOf(db, table);
    const select = [
      ...columns.map(quoted),
      ...late.map((column) => lateColumn(have, column)),
      ...computed,
    ];
    const statement = db.prepare(
      `select ${select.join(', ')} from ${quoted(table)} where story_id = ? ` +
        `order by ${order} collate nocase, id`,
    );
    statement.setReadBigInts(true);
    return statement.all(storyId).filter((row) => text(row['id']) !== null);
  };
  const place = (row: Record<string, SQLOutputValue>): AventurasWorldRow => ({
    id: text(row['id']) ?? '',
    branchId: text(row['branch_id']),
    overridesId: text(row['overrides_id']),
    deleted: integer(row['deleted']) === 1,
  });
  const cow = ['branch_id', 'overrides_id', 'deleted'];

  // The portrait's length and never the portrait: see the file header.
  const hasPortrait = columnsOf(db, 'characters').has('portrait');
  const characters = rowsOf(
    'characters',
    ['id', 'name', 'description', 'relationship', 'traits', 'status', 'metadata'],
    ['visual_descriptors', ...cow],
    'name',
    [hasPortrait ? 'octet_length(portrait) as portrait_octets' : 'null as portrait_octets'],
  ).map((row) => ({
    ...place(row),
    name: text(row['name']) ?? '',
    description: text(row['description']),
    relationship: text(row['relationship']),
    traits: list(row['traits']),
    visualDescriptors: json(row['visual_descriptors']),
    status: text(row['status']),
    metadata: json(row['metadata']),
    portraitOctets: integer(row['portrait_octets']),
  }));

  const locations = rowsOf(
    'locations',
    ['id', 'name', 'description', 'visited', 'current', 'connections', 'metadata'],
    cow,
    'name',
  ).map((row) => ({
    ...place(row),
    name: text(row['name']) ?? '',
    description: text(row['description']),
    visited: integer(row['visited']) === 1,
    current: integer(row['current']) === 1,
    connections: list(row['connections']),
    metadata: json(row['metadata']),
  }));

  const items = rowsOf(
    'items',
    ['id', 'name', 'description', 'quantity', 'equipped', 'location', 'metadata'],
    cow,
    'name',
  ).map((row) => ({
    ...place(row),
    name: text(row['name']) ?? '',
    description: text(row['description']),
    quantity: integer(row['quantity']),
    equipped: integer(row['equipped']) === 1,
    location: text(row['location']),
    metadata: json(row['metadata']),
  }));

  const beats = rowsOf(
    'story_beats',
    ['id', 'title', 'description', 'type', 'status', 'triggered_at', 'metadata'],
    ['resolved_at', ...cow],
    'title',
  ).map((row) => ({
    ...place(row),
    title: text(row['title']) ?? '',
    description: text(row['description']),
    type: text(row['type']),
    status: text(row['status']),
    triggeredAt: integer(row['triggered_at']),
    resolvedAt: integer(row['resolved_at']),
    metadata: json(row['metadata']),
  }));

  const lore = rowsOf(
    'entries',
    [
      'id',
      'name',
      'type',
      'description',
      'hidden_info',
      'aliases',
      'state',
      'adventure_state',
      'creative_state',
      'injection',
      'created_by',
    ],
    cow,
    'name',
  ).map((row) => ({
    ...place(row),
    name: text(row['name']) ?? '',
    type: text(row['type']) ?? '',
    description: text(row['description']),
    hiddenInfo: text(row['hidden_info']),
    aliases: json(row['aliases']),
    state: json(row['state']),
    adventureState: json(row['adventure_state']),
    creativeState: json(row['creative_state']),
    injection: json(row['injection']),
    createdBy: text(row['created_by']),
  }));

  /**
   * One portrait, by the character's row id, asked for only when its actor is
   * about to be stored — and asked of SQLite by length first, so one past the
   * bound is never selected (`vault-character.ts`'s `portraitOf`).
   */
  const byId =
    hasPortrait && tables.has('characters')
      ? db.prepare(
          'select case when octet_length(portrait) <= ? then portrait end as portrait, ' +
            'octet_length(portrait) as portrait_octets from characters where id = ?',
        )
      : null;
  byId?.setReadBigInts(true);
  const portrait: PortraitReader = (characterId, actor, key, notes) => {
    const row = byId?.get(textLimit(maxPortraitBytes), characterId);
    return row === undefined ? null : portraitOf(row, actor, key, maxPortraitBytes, notes);
  };

  return {
    characters,
    locations,
    items,
    beats,
    lore,
    // Every column above is parsed by now, so the count is final.
    unreadable,
    portrait,
  };
}

/** A late column by name when the table has it, and `null` under its name when it does not. */
function lateColumn(have: ReadonlySet<string>, column: string): string {
  return have.has(column) ? column : `null as ${column}`;
}

function text(value: SQLOutputValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** An integer column, read however SQLite handed it over; a text one that is a number counts. */
function number(value: SQLOutputValue | undefined): number | null {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
