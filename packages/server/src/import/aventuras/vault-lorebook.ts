// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import type { ImportNote } from '@storyengine/shared';

import { parsed, refused, type ParseOutcome } from '../parse.js';
import type { SourceItem } from '../source.js';
import { convertAventurasEntries, type ConvertedAventurasLorebook } from './lorebook.js';
import { AVENTURAS_REQUIRED, quoted } from './schema.js';
import { isRecord, strings, text } from './shapes.js';
import { integer, jsonColumn, listColumn, stringOr, vaultRows } from './vault-row.js';

/**
 * ***A `lorebook_vault` row, as a lorebook*** —
 * [P13.4](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The same move P13.3 made for characters: produce the object Aventuras' own
 * row mapper makes (`mapVaultLorebook`, `src/lib/services/database.ts`) and hand
 * it to a converter P4 already wrote. **With one step between the two that the
 * plan first missed** ([§0.4]): a vault book's `entries` column is not the
 * `Entry[]` that `convertAventurasLorebook` reads. It is `VaultLorebookEntry[]`
 * — `{ name, type, description, keywords, aliases, injectionMode, priority }`,
 * flat — and the `Entry[]` is what Aventuras' *file* export makes of it,
 * through `vaultEntryToEntryLike` (`lorebookImportExport/export/vault.ts`).
 * Handed over as stored, every row would be `wrong-shape`, because
 * `isAventurasLorebook` wants an `injection.mode`. So that function is ported
 * too — re-implemented from what it does, not copied — and the book's own
 * fields, which the file export never carried, are set around the converter.
 *
 * ***Three places this is deliberately not Aventuras.***
 *
 * - **The port synthesises nothing.** `vaultEntryToEntryLike` has to make a
 *   whole `Entry` to hand its exporters, so it invents what a vault entry never
 *   had: a default tracked `state` per entry type, `createdAt` and `updatedAt`
 *   of *now*, an id, a story id. Every one of those would be a lie here — the
 *   invented `state` would make `import.aventuras.entryStateRecorded` say a book
 *   carried *"tracked state from a story in progress"* when a vault book never
 *   has any, and the clock would make the same row convert to different bytes
 *   on every sweep, so no re-import could ever be `unchanged`. So the port
 *   makes exactly the fields the converter reads, and nothing it would have to
 *   carry into `metadata` as if the source had said it.
 * - **An empty book imports as an empty book.** Aventuras' export throws on
 *   one (*"No entries to export"*) and `isAventurasLorebook([])` is false,
 *   both of which are about files. A row is a book somebody made and named, and
 *   it is already known to be a lorebook by the table it is in; so this asks
 *   `convertAventurasEntries` — the conversion without the file's recognition —
 *   and never the guard.
 * - **A column that will not read is a note, never a crash** (`vault-row.ts`)
 *   — ***and for `entries`, it is also nothing written.*** A `tags` or
 *   `metadata` that will not read costs the book that field, as a character's
 *   columns cost the character theirs. `entries` is not a field of the book;
 *   it is the book. One that will not parse, or parses to something that is
 *   not a list, makes the row an `unrecognised` item carrying
 *   `import.aventuras.columnUnreadable`, and no candidate at all. *An empty book
 *   imported in its place was the first answer, and it was wrong* (at the
 *   P13.4 review): identity is the row (§1.5), so a later sweep of an install
 *   whose column had gone bad would find the good book this row made before
 *   and, under the default `replace`, overwrite it with an empty one — silent
 *   data loss, with only a history version to recover it from. Writing nothing
 *   leaves that book as it was, and a genuinely empty list, `[]`, still imports
 *   as the empty book it is. An entry that is not a record costs that entry alone
 *   (`import.row.unreadable`, the converter's own rule), and an entry missing
 *   fields imports with what it has: the converter already reads every field
 *   as possibly absent.
 */

/** The table, and the middle of every candidate's `source` (§1.5). */
export const LOREBOOK_TABLE = 'lorebook_vault';

/** What the reader recognised: the format the Writer's `#aventurasVaultLorebook` answers. */
export const VAULT_LOREBOOK_FORMAT = 'aventuras.vault-lorebook';

/**
 * ***The name a book with none is given*** — the column is `NOT NULL` and can
 * still be empty. A constant rather than the row's id, which is what
 * `nameOf(source)` would give: a uuid is stable too, and it is not a name
 * anybody would look for in a library.
 */
export const UNTITLED_LOREBOOK = 'Untitled lorebook';

/**
 * What the mapper would make of a row — `VaultLorebook` at the pin
 * (`src/lib/types/index.ts`), field for field.
 *
 * Loosely typed where the row is somebody else's: a JSON column holds whatever
 * was written into it, and the converter decides what a field means.
 */
export interface MappedVaultLorebook {
  id: string;
  name: string;
  description: string | null;
  /**
   * `VaultLorebookEntry[]` as stored — each element whatever was written — or
   * `null` for a column that held something and would not read as a list,
   * which the reader refuses the row over rather than hand on.
   */
  entries: unknown[] | null;
  tags: unknown[];
  favorite: boolean;
  source: string;
  originalFilename: string | null;
  originalStoryId: string | null;
  metadata: unknown;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface LorebookReadOptions {
  /** The database's own name (`AVENTURAS_DATABASE`); see `VaultTable.database`. */
  database: string;
}

/**
 * ***Every `lorebook_vault` row, one item each*** — a candidate, or, for a row
 * with no id, an `unrecognised` row that says so (`vault-row.ts`). The table
 * has no row of its own in the review since this stage; these are its count.
 */
export function* vaultLorebookItems(
  db: DatabaseSync,
  options: LorebookReadOptions,
): Generator<SourceItem> {
  const columns = AVENTURAS_REQUIRED[LOREBOOK_TABLE]?.columns ?? [];
  // The columns the gate checked, and not one more (`schema.ts`).
  const byId = db.prepare(
    `select ${columns.map(quoted).join(', ')} from ${quoted(LOREBOOK_TABLE)} where id = ?`,
  );
  byId.setReadBigInts(true);
  yield* vaultRows(
    db,
    { database: options.database, table: LOREBOOK_TABLE },
    (id) => byId.get(id),
    (row, id, source) => {
      const notes: ImportNote[] = [];
      const payload = mapVaultLorebook(row, id, notes);
      if (payload.entries === null) {
        // Refused, and nothing written — see the file header.
        return { outcome: 'observed', report: { source, disposition: 'unrecognised', notes } };
      }
      return {
        outcome: 'candidate',
        candidate: {
          source,
          format: VAULT_LOREBOOK_FORMAT,
          payload,
          ...(notes.length === 0 ? {} : { notes }),
        },
      };
    },
  );
}

/**
 * ***`mapVaultLorebook`, ported*** — snake_case columns to camelCase fields,
 * the three JSON columns parsed, `favorite` from an integer to a flag, and
 * `source` defaulted to `import`, which is this mapper's default where the
 * character mapper's is `manual`: each is what Aventuras would show for the
 * row. Departs from the original only in reading around a column that will not
 * parse (the file header), and in `entries` being `null` when that column is
 * the one. Exported for the tests.
 */
export function mapVaultLorebook(
  row: Readonly<Record<string, SQLOutputValue | undefined>>,
  id: string,
  notes: ImportNote[],
): MappedVaultLorebook {
  // Unreadable is not the same as empty here (the file header): an absent
  // column is `[]`, as the mapper's truthiness makes it, and one that held
  // something unreadable is `null`, which `listColumn` says by adding a note.
  const before = notes.length;
  const entries = listColumn(row['entries'], 'entries', notes);
  const entriesUnreadable = notes.length > before;
  return {
    id,
    name: stringOr(row['name'], ''),
    description: stringOr(row['description'], null),
    entries: entriesUnreadable ? null : entries,
    tags: listColumn(row['tags'], 'tags', notes),
    favorite: integer(row['favorite']) === 1,
    source: stringOr(row['source'], '') || 'import',
    originalFilename: stringOr(row['original_filename'], null),
    originalStoryId: stringOr(row['original_story_id'], null),
    metadata: jsonColumn(row['metadata'], 'metadata', notes) ?? null,
    createdAt: integer(row['created_at']),
    updatedAt: integer(row['updated_at']),
  };
}

/** A `VaultLorebookEntry`'s own fields: what the port reads, and so does not also carry. */
const VAULT_ENTRY_FIELDS = new Set([
  'name',
  'type',
  'description',
  'keywords',
  'aliases',
  'injectionMode',
  'priority',
]);

/**
 * ***`vaultEntryToEntryLike`, ported without what it invents*** — see the file
 * header for why it stops at the fields the converter reads.
 *
 * `keywords` and `injectionMode` and `priority` move inside `injection`, where
 * `Entry` keeps them and the converter looks: keywords become `keys`,
 * `always` becomes `constant` and `never` a disabled entry, and priority is
 * inverted into `order`, all by the converter's rules and none by a second
 * copy of them here. `aliases` and `keywords` default to empty, as the
 * original's `?? []` does.
 *
 * **A field the pin's `VaultLorebookEntry` does not have is carried, not
 * dropped** — a newer Aventuras's, or somebody's tool's. It rides beside the
 * mapped fields, and the converter keeps whatever it does not read in the
 * entry's `metadata`, as it does for a file's. The seven fields above are the
 * only ones not carried, since each is already somewhere; and a carried field
 * can never displace a mapped one, which are written after it.
 *
 * An element that is not a record is handed on as it is, so the converter
 * names it by its place (`import.row.unreadable`) rather than this guessing
 * what it was.
 */
export function vaultEntryToEntryLike(vaultEntry: unknown): unknown {
  if (!isRecord(vaultEntry)) return vaultEntry;
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(vaultEntry)) {
    if (!VAULT_ENTRY_FIELDS.has(key)) carried[key] = value;
  }
  return {
    ...carried,
    name: vaultEntry['name'],
    type: vaultEntry['type'],
    description: vaultEntry['description'],
    aliases: vaultEntry['aliases'] ?? [],
    injection: {
      mode: vaultEntry['injectionMode'],
      keywords: vaultEntry['keywords'] ?? [],
      priority: vaultEntry['priority'],
    },
  };
}

/** Read into the book's own fields, and so not also carried into its `metadata`. */
const CONSUMED = new Set([
  'id',
  'name',
  'description',
  'entries',
  'tags',
  'createdAt',
  'updatedAt',
]);

/**
 * ***A mapped vault book → `Lorebook`*** — the entries through
 * `convertAventurasEntries`, and the book's own name, description and tags,
 * which Aventuras' file export never carried and a row does.
 *
 * ***The name is the row's, and it namespaces the entries' ids.*** Entry ids
 * are derived from the book name and the entry name (`lorebook.ts`), so the
 * same row converts to the same bytes and a second sweep is `unchanged`
 * ([P4 §1.3]). Renaming the book in Aventuras re-derives every id, and the next
 * sweep replaces the book — which is what a rename is. **Two rows with the same
 * name derive the same entry ids**, and that is allowed rather than overlooked:
 * [04 §5.2] makes an entry id *"unique within one book"*, and says two books
 * holding the same id is *"ordinary rather than a conflict"*. The two books are
 * still two objects, because a book's identity is its row (§1.5), not its name.
 *
 * ***What travels into `metadata`*** — everything not read into a field:
 * `favorite`, `source`, `originalFilename`, `originalStoryId` and the row's own
 * `metadata` whole, verbatim, and whatever a newer row adds. `id` is dropped
 * (it names a row in somebody else's database, and P13.5 resolves links to it
 * through the reader rather than through anything stored), and the two
 * timestamps are dropped because the library keeps its own.
 */
export function convertVaultLorebook(input: unknown): ParseOutcome<ConvertedAventurasLorebook> {
  if (!isRecord(input)) return refused('wrong-shape');
  const entries = input['entries'];
  if (!Array.isArray(entries)) return refused('wrong-shape');

  const name = text(input['name']) || UNTITLED_LOREBOOK;
  const converted = convertAventurasEntries(entries.map(vaultEntryToEntryLike), name);
  const { lorebook } = converted;

  lorebook.description = text(input['description']);
  lorebook.tags = strings(input['tags']);
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!CONSUMED.has(key)) carried[key] = value;
  }
  lorebook.metadata = carried;

  return parsed(converted);
}
