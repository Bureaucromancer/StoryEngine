// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import type { ImportNote } from '@storyengine/shared';

import { DEFAULT_ZIP_LIMITS } from '../../storage/zip.js';
import type { SourceItem } from '../source.js';
import { VISUAL_KEYS, type VisualKey } from './character.js';
import { AVENTURAS_REQUIRED, quoted } from './schema.js';
import { isRecord } from './shapes.js';
import { integer, jsonColumn, listColumn, stringOr, vaultRows } from './vault-row.js';

/**
 * ***A `character_vault` row, as the object Aventuras' own mapper makes of
 * it*** — [P13.3](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * [§0.1]'s whole argument is that the vault exports [P4 §1.5] wrote converters
 * for are *the rows of three tables run through Aventuras' row mappers*, so a
 * reader that produces the mapped object from the row hands the existing
 * converter exactly what it already takes. This is that, for characters:
 * `mapVaultCharacter` (`src/lib/services/database.ts`), re-implemented from
 * what it does rather than copied — snake_case columns to camelCase fields,
 * the four JSON columns parsed, `favorite` from an integer to a flag, `source`
 * defaulted to `manual` — and then `convertCharacter` runs unchanged.
 *
 * ***Three places this is deliberately not the mapper.***
 *
 * - **A JSON column that will not parse is a note, never a crash.** Aventuras'
 *   mapper calls `JSON.parse` bare, so one bad row fails its whole vault. A
 *   row here is somebody's character with one unreadable field; it imports
 *   without that field, and `import.aventuras.columnUnreadable` names it. The
 *   same holds for a `traits` or `tags` that parses and is not a list, which
 *   the mapper would pass through and `isVaultCharacter` would then refuse —
 *   costing the character over the field.
 * - **The portrait is not in the payload.** It is carried beside it
 *   ([§1.6]): decoded here, handed over as bytes, and sniffed by the Writer as
 *   it sniffs any picture. Left in the payload it would make the converter say
 *   `portraitNotCarried` about a portrait that was carried.
 * - **Integers are read as integers, however large.** `node:sqlite` throws
 *   out of a read that meets an integer past 2^53, which in a `created_at`
 *   somebody's tool wrote would throw out of the sweep after earlier rows were
 *   written. So the statement reads big integers as `bigint`, and a value past
 *   the safe range is simply not a timestamp.
 *
 * ***The portrait's size is asked of SQLite before its bytes are asked for.***
 * A portrait is base64 text inside a row, and Aventuras stores whatever the
 * image provider returned; one is usually a few hundred kilobytes and nothing
 * stops one being hundreds of megabytes. `octet_length` reads the length from
 * the record header without loading the value, and a portrait past the bound
 * is never selected at all — so the heap never holds it, and the person is
 * told (`import.aventuras.portraitTooLarge`). The bound is the one every other
 * road for a card already has (see {@link DEFAULT_MAX_PORTRAIT_BYTES}).
 *
 * ***And rows are read one at a time, by id.*** Ordered by name so the review
 * reads as a list, which needs a sort — and a sort over the whole row would
 * hand every portrait to SQLite's sorter at once. So the sort is over the ids
 * alone, and each row is fetched by its key as the sweep asks for it; the
 * sweep writes one character before it asks for the next, so one portrait is
 * held at a time.
 */

/** The table, and the middle of every candidate's `source` (§1.5). */
export const CHARACTER_TABLE = 'character_vault';

/** What the reader recognised: the format `#aventurasCharacter` answers. */
export const CHARACTER_FORMAT = 'aventuras.character';

/**
 * ***The largest portrait carried, decoded*** — the per-file ceiling every
 * other road a card takes already has: a zip entry (`DEFAULT_ZIP_LIMITS`), a
 * file read from a folder (`DEFAULT_LOCAL_LIMITS.maxFileBytes`), and the text
 * the PNG codec will inflate out of one card are all sixty-four megabytes, and
 * the upload limit defaults to the same. A portrait past it is a picture no
 * other door would have let in as a card, and this one is the door with no
 * upload limit in front of it — the server-path sweep ([§1.11]).
 */
export const DEFAULT_MAX_PORTRAIT_BYTES = DEFAULT_ZIP_LIMITS.maxEntryBytes;

/**
 * Room for a data URL's header — `data:image/webp;base64,` and any parameters
 * somebody's tool added — on top of the base64 itself, when the bound is
 * checked against the stored text rather than the decoded bytes.
 */
const DATA_URL_HEADER_ALLOWANCE = 256;

/**
 * The longest stored portrait worth decoding: the base64 of
 * `maxPortraitBytes`, and the header allowance.
 */
function textLimit(maxPortraitBytes: number): number {
  return Math.ceil(maxPortraitBytes / 3) * 4 + DATA_URL_HEADER_ALLOWANCE;
}

/**
 * What the mapper would make of a row, **minus the portrait** — `VaultCharacter`
 * at the pin (`src/lib/types/index.ts`), field for field otherwise.
 *
 * Loosely typed where the row is somebody else's: a JSON column holds whatever
 * was written into it, and `convertCharacter` is the one that decides what a
 * field means.
 */
export interface MappedVaultCharacter {
  id: string;
  name: string;
  description: string | null;
  traits: unknown[];
  visualDescriptors: Record<string, unknown>;
  tags: unknown[];
  favorite: boolean;
  source: string;
  originalStoryId: string | null;
  metadata: unknown;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface CharacterReadOptions {
  /**
   * What every `source` begins with: the database's own name, which the
   * reader owns (`AVENTURAS_DATABASE`). Passed rather than imported, so this
   * module does not import the reader that imports it.
   */
  database: string;
  /** {@link DEFAULT_MAX_PORTRAIT_BYTES}, unless a test needs a smaller one. */
  maxPortraitBytes: number;
}

/**
 * ***Every `character_vault` row, one item each*** — a candidate, or, for a
 * row with no id to key it by, an `unrecognised` row that says so. So the
 * table's row count is the number of items under its name in the review, now
 * that the table has no row of its own (the reader's `tableRows`).
 *
 * A generator over two open statements: the ids, sorted, and the row by id.
 * Both close when the sweep stops asking, however it stops. The walk itself is
 * `vault-row.ts`'s since P13.4, shared with the lorebooks.
 */
export function* vaultCharacterItems(
  db: DatabaseSync,
  options: CharacterReadOptions,
): Generator<SourceItem> {
  const byId = db.prepare(`${selectCharacter()} where id = ?`);
  byId.setReadBigInts(true);
  const limit = textLimit(options.maxPortraitBytes);
  yield* vaultRows(
    db,
    { database: options.database, table: CHARACTER_TABLE },
    (id) => byId.get(limit, id),
    (row, id, source) => characterItem(row, id, source, options),
  );
}

/**
 * **The columns the gate checked, and not one more** (`schema.ts`), with the
 * portrait asked for only when it is small enough to hold, and its length
 * asked for always. The one `?` is that bound.
 */
function selectCharacter(): string {
  const columns = AVENTURAS_REQUIRED[CHARACTER_TABLE]?.columns ?? [];
  const list = columns.map((column) =>
    column === 'portrait'
      ? 'case when octet_length(portrait) <= ? then portrait end as portrait, ' +
        'octet_length(portrait) as portrait_octets'
      : quoted(column),
  );
  return `select ${list.join(', ')} from ${quoted(CHARACTER_TABLE)}`;
}

/** One row, as a candidate: the mapped object, and the portrait's bytes beside it. */
function characterItem(
  row: Record<string, SQLOutputValue>,
  id: string,
  source: string,
  options: CharacterReadOptions,
): SourceItem {
  const notes: ImportNote[] = [];
  const payload = mapVaultCharacter(row, id, notes);

  /**
   * ***Keyed beneath the row's own source***, which is beneath `aventura.db` —
   * a file, so nothing in the root can have this path, and a Writer that
   * missed the map could never read somebody's file in its place.
   */
  const key = `${source}/portrait`;
  const portrait = portraitOf(row, payload.name, key, options.maxPortraitBytes, notes);

  return {
    outcome: 'candidate',
    candidate: {
      source,
      format: CHARACTER_FORMAT,
      payload,
      ...(portrait === null ? {} : { assets: [key], inline: new Map([[key, portrait]]) }),
      ...(notes.length === 0 ? {} : { notes }),
    },
  };
}

/**
 * ***`mapVaultCharacter`, ported*** — see the file header for the three places
 * it departs from the original, each on purpose. Exported for the tests, which
 * hold it to what the original makes of a row.
 */
export function mapVaultCharacter(
  row: Readonly<Record<string, SQLOutputValue | undefined>>,
  id: string,
  notes: ImportNote[],
): MappedVaultCharacter {
  // A list column that parsed to something else would be handed on by the
  // mapper, and `isVaultCharacter` would refuse the character over it.
  const list = (column: string): unknown[] => listColumn(row[column], column, notes);

  return {
    id,
    name: stringOr(row['name'], ''),
    description: stringOr(row['description'], null),
    traits: list('traits'),
    visualDescriptors: repairVisualDescriptors(
      jsonColumn(row['visual_descriptors'], 'visual_descriptors', notes),
    ),
    tags: list('tags'),
    favorite: integer(row['favorite']) === 1,
    source: stringOr(row['source'], '') || 'manual',
    originalStoryId: stringOr(row['original_story_id'], null),
    metadata: jsonColumn(row['metadata'], 'metadata', notes) ?? null,
    createdAt: integer(row['created_at']),
    updatedAt: integer(row['updated_at']),
  };
}

/**
 * ***The legacy descriptor labels, by the key each lands on*** — the aliases
 * `migrateVisualDescriptors` (`database.ts`) accepts, which are facts about
 * rows an older Aventuras wrote. A label that is none of these lands on
 * `distinguishing`, as it does there.
 */
const LEGACY_LABELS: Readonly<Record<VisualKey, readonly string[]>> = {
  face: ['face', 'skin'],
  hair: ['hair'],
  eyes: ['eyes', 'eye'],
  build: ['build', 'height', 'body', 'physique'],
  clothing: ['clothing', 'clothes', 'outfit', 'attire'],
  accessories: ['accessories', 'accessory'],
  distinguishing: ['distinguishing', 'scar', 'scars', 'marks', 'mark', 'tattoo'],
};

/** Label → key. A `Map`, so a label spelled like an `Object.prototype` member finds nothing. */
const LEGACY_KEY_OF: ReadonlyMap<string, VisualKey> = new Map(
  VISUAL_KEYS.flatMap((key) => LEGACY_LABELS[key].map((label) => [label, key] as const)),
);

/**
 * One legacy descriptor: a label of letters and spaces, a colon, and one line
 * of text after any whitespace. Anything else — a label with a digit in it, a
 * value that runs over a line break — is not a descriptor the original reads,
 * and is dropped here as it is dropped there.
 */
const LEGACY_LINE = /^(?<label>[A-Za-z\s]+):\s*(?<text>[^\n\r\u2028\u2029]+)$/;

/**
 * ***`visual_descriptors`, in whichever of its two shapes the row kept*** —
 * `migrateVisualDescriptors` (`database.ts:105`), which Aventuras runs on
 * every row it loads, re-implemented here. A row an older Aventuras wrote
 * holds a string array — `["Hair: long brown", "Scar: over one eye"]` — and
 * `isVaultCharacter` wants the record, so without this every such character
 * would be `wrong-shape` from the database while loading fine in Aventuras.
 *
 * - **A record with any of the seven keys** is today's shape, returned as it is.
 * - **An array** is the legacy shape: each `Label: text` line lands on the key
 *   its label names, an unknown label on `distinguishing`, and a second line
 *   for a key already filled is appended after a comma.
 * - **Anything else** — a record with none of the seven, a string, nothing —
 *   is no descriptors at all, which is what the original makes of it.
 */
export function repairVisualDescriptors(data: unknown): Record<string, unknown> {
  if (isRecord(data)) {
    return VISUAL_KEYS.some((key) => Object.hasOwn(data, key)) ? data : {};
  }
  if (!Array.isArray(data)) return {};

  const repaired: Partial<Record<VisualKey, string>> = {};
  for (const line of data) {
    if (typeof line !== 'string') continue;
    const groups = LEGACY_LINE.exec(line)?.groups;
    const label = groups?.['label'];
    const text = groups?.['text'];
    if (label === undefined || text === undefined) continue;
    const key = LEGACY_KEY_OF.get(label.trim().toLowerCase()) ?? 'distinguishing';
    const held = repaired[key];
    // Truthiness, as the original tests it: a key holding an empty value is
    // written over rather than appended to.
    repaired[key] = held ? `${held}, ${text.trim()}` : text.trim();
  }
  return repaired;
}

/**
 * ***The portrait's bytes, or `null` with the reason noted*** — [§1.6].
 *
 * Nothing here decides what the bytes *are*; the Writer sniffs them, as it
 * sniffs a portrait read from a file, and a PNG becomes the card while a JPEG
 * or a WebP rides beside it. This only gets from the column to bytes, and says
 * so when it cannot: a portrait too large to hold, or one that is not base64
 * at all — a link, which is never fetched, or a data URL that is not base64.
 */
function portraitOf(
  row: Readonly<Record<string, SQLOutputValue | undefined>>,
  actor: string,
  key: string,
  maxPortraitBytes: number,
  notes: ImportNote[],
): Uint8Array | null {
  const octets = integer(row['portrait_octets']);
  // No portrait: a null column (whose length is null) or an empty one.
  if (octets === null || octets === 0) return null;

  const tooLarge = (): null => {
    notes.push({
      key: 'import.aventuras.portraitTooLarge',
      params: { actor, limit: Math.round(maxPortraitBytes / (1024 * 1024)) },
      level: 'warn',
    });
    return null;
  };
  if (octets > textLimit(maxPortraitBytes)) return tooLarge();

  const value = row['portrait'];
  if (typeof value === 'string' && value.trim().length === 0) return null;
  const bytes =
    typeof value === 'string'
      ? decodePortrait(value)
      : value instanceof Uint8Array && value.byteLength > 0
        ? value
        : null;
  if (bytes === null) {
    notes.push({
      key: 'import.card.portraitUnreadable',
      params: { file: key, actor },
      level: 'warn',
    });
    return null;
  }
  return bytes.byteLength > maxPortraitBytes ? tooLarge() : bytes;
}

/**
 * ***A stored portrait as bytes*** — a data URL, or the bare base64 an older
 * Aventuras kept (its own `normalizeImageDataUrl` reads both). `null` for what
 * is neither: a link, which Aventuras would load and this never fetches; a
 * data URL without `;base64`, which is percent-encoded text and never a
 * picture Aventuras drew; and anything that decodes to nothing.
 *
 * **The data URL's type is not read.** Aventuras labels what its image
 * providers return as `image/png` whatever it is, so the label is often wrong,
 * and the bytes are sniffed downstream instead. Base64 is decoded leniently —
 * whitespace and stray characters are skipped, as a browser would — because a
 * portrait that decodes to something that is not an image is caught by that
 * sniff anyway, and said the same way.
 */
export function decodePortrait(stored: string): Uint8Array | null {
  const text = stored.trim();
  let base64: string;
  if (/^data:/i.test(text)) {
    const comma = text.indexOf(',');
    if (comma === -1 || !/;base64$/i.test(text.slice(0, comma))) return null;
    base64 = text.slice(comma + 1);
  } else if (/^https?:\/\//i.test(text)) {
    return null;
  } else {
    base64 = text;
  }
  const bytes = Buffer.from(base64, 'base64');
  return bytes.byteLength === 0
    ? null
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
