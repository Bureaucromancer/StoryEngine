// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import type { ImportNote } from '@storyengine/shared';

import type { SourceItem } from '../source.js';
import { AVENTURAS_REQUIRED, columnsOf, quoted } from './schema.js';
import { integer, jsonColumn, listColumn, stringOr, vaultRows } from './vault-row.js';

/**
 * ***A `scenario_vault` row, as the object Aventuras' own mapper makes of
 * it*** — [P13.5](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The third table read the way P13.3 read characters and P13.4 read lorebooks:
 * produce what `mapVaultScenario` (`src/lib/services/database.ts`) makes of a
 * row — snake_case columns to camelCase fields, the five JSON columns parsed,
 * `favorite` from an integer to a flag, `source` defaulted to `import` — and
 * hand it to the converter P4 already wrote for the same object exported as a
 * file, `convertScenario`. **There is no second scenario converter**, and
 * there must not be: the file and the row are one `VaultScenario`, and two
 * readings of it would be free to disagree about what a scenario becomes.
 *
 * ***`starting_time` rides in the treatment's `metadata`***, which the
 * converter already did for a file that carried `startingTime`: it is not a
 * field the converter reads, so it is carried with everything else it does
 * not. Migration 039 added the column, so a database from before it has none;
 * the column gate made it optional (`schema.ts`), and this selects it only
 * where it is there. The mapper then reads it as `null` either way, exactly as
 * Aventuras' own `row.starting_time ? JSON.parse(…) : null` does for a row
 * that never had one.
 *
 * ***The link is not resolved here.*** `metadata.linkedLorebookId` names a
 * `lorebook_vault` row, and which object that row became in *this* library is
 * the Writer's to know — it stored the books, earlier in the same sweep (§1.7,
 * and the reader's `CONVERTED_TABLES` order). So the payload carries the id as
 * the mapper would, and the Writer turns it into `treatment.lore`.
 *
 * ***Which unreadable column refuses the row, and which only costs itself.***
 * P13.4 learned this the hard way for a lorebook's `entries`: identity is the
 * row (§1.5), so a row imported *degraded* is, on the next sweep of an install
 * whose column has since gone bad, the object that replaces the good one here
 * under the default `replace` — silent data loss, with only a history version
 * to recover it from. The question for each column is therefore not *can we
 * import around it* but *would what we imported around it be a worse copy of
 * the scenario than one already here*. Asked of each:
 *
 * - **`npcs` refuses the row.** It is the cast: a treatment imported without
 *   it replaces one that bills three people with one that bills nobody.
 * - **`alternate_greetings` refuses the row.** It is the openings after the
 *   first, and a scenario is half its openings; imported without them, the
 *   next sweep deletes every alternate a person may have been choosing among.
 * - **`metadata` refuses the row** — the one this stage made load-bearing. It
 *   is where `linkedLorebookId` lives, and that link is now the treatment's
 *   `lore`: [04 §6] makes a treatment *tone, framing and links*, and the link
 *   to the world it is told in is the one that matters. Imported without it,
 *   the next sweep unlinks the book — which is the loss `scenario.ts` already
 *   calls *"losing half a world"*, made silent.
 * - **`tags` and `starting_time` cost themselves**, noted, as a character's
 *   and a lorebook's `tags` do. A tag is a label, and a starting time is one
 *   inert value in `metadata` that nothing here reads; neither is what the
 *   scenario *is*, and refusing the whole scenario over either would cost a
 *   first import everything to protect a field a replace keeps in history.
 *
 * A refused row is an `unrecognised` item carrying every
 * `import.aventuras.columnUnreadable` it earned, and no candidate — so a
 * scenario imported from that row earlier is left exactly as it was. A text
 * column needs no such rule: it is text, and cannot fail to read.
 *
 * ***Two places this is deliberately not the mapper***, both P13.3's and
 * named in `vault-row.ts`: a JSON column that will not parse is a note or a
 * refusal and never a crash, and integers are read as integers however large.
 * And one smaller: `setting_seed` is `NOT NULL` in Aventuras' schema and the
 * mapper hands it on as it is, so a `NULL` somebody's tool wrote would reach
 * the converter as `null` and be refused as `wrong-shape`. Read as `''`, it is
 * refused as what it is — `missing-field`, `settingSeed` — by the converter's
 * own rule, which a file with an empty setting already meets.
 */

/** The table, and the middle of every candidate's `source` (§1.5). */
export const SCENARIO_TABLE = 'scenario_vault';

/** What the reader recognised: the format the Writer's `#aventurasVaultScenario` answers. */
export const VAULT_SCENARIO_FORMAT = 'aventuras.vault-scenario';

/**
 * ***The name a scenario with none is given*** — `lorebook_vault`'s reason
 * (`vault-lorebook.ts`'s `UNTITLED_LOREBOOK`): the column is `NOT NULL` and can still be
 * empty, and the fallback the file path uses, the source's stem, is a uuid for
 * a row.
 */
export const UNTITLED_SCENARIO = 'Untitled scenario';

/**
 * The JSON columns that refuse the row when they will not read — see the file
 * header for why these three and not the other two.
 */
export const REFUSING_COLUMNS: ReadonlySet<string> = new Set([
  'npcs',
  'alternate_greetings',
  'metadata',
]);

/**
 * What the mapper would make of a row — `VaultScenario` at the pin
 * (`src/lib/types/index.ts`), field for field.
 *
 * Loosely typed where the row is somebody else's: a JSON column holds whatever
 * was written into it, and `convertScenario` decides what a field means.
 */
export interface MappedVaultScenario {
  id: string;
  name: string;
  description: string | null;
  settingSeed: string;
  npcs: unknown[];
  primaryCharacterName: string;
  firstMessage: string | null;
  alternateGreetings: unknown[];
  /** `TimeTracker` as stored, or `null` — for a database before 039 too. */
  startingTime: unknown;
  tags: unknown[];
  favorite: boolean;
  source: string;
  originalFilename: string | null;
  /** `VaultScenarioMetadata` as stored, `linkedLorebookId` and all, or `null`. */
  metadata: unknown;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface ScenarioReadOptions {
  /** The database's own name (`AVENTURAS_DATABASE`); see `VaultTable.database`. */
  database: string;
}

/**
 * ***Every `scenario_vault` row, one item each*** — a candidate; an
 * `unrecognised` row for one with no id (`vault-row.ts`); or an
 * `unrecognised` row for one whose cast, openings or metadata will not read,
 * which the file header explains. The table has no row of its own in the
 * review since this stage; these are its count.
 */
export function* vaultScenarioItems(
  db: DatabaseSync,
  options: ScenarioReadOptions,
): Generator<SourceItem> {
  const requirement = AVENTURAS_REQUIRED[SCENARIO_TABLE];
  const have = columnsOf(db, SCENARIO_TABLE);
  // The columns the gate checked, and the late ones only where this database
  // has them (`schema.ts`): selecting `starting_time` from a backup made
  // before 039 would throw, where a missing value is simply no value.
  const columns = [
    ...(requirement?.columns ?? []),
    ...(requirement?.optional ?? []).filter((column) => have.has(column)),
  ];
  const byId = db.prepare(
    `select ${columns.map(quoted).join(', ')} from ${quoted(SCENARIO_TABLE)} where id = ?`,
  );
  byId.setReadBigInts(true);
  yield* vaultRows(
    db,
    { database: options.database, table: SCENARIO_TABLE },
    (id) => byId.get(id),
    (row, id, source) => {
      const notes: ImportNote[] = [];
      const payload = mapVaultScenario(row, id, notes);
      const refusing = notes.some(
        (note) =>
          note.key === 'import.aventuras.columnUnreadable' &&
          REFUSING_COLUMNS.has(String(note.params['column'])),
      );
      if (refusing) {
        // Refused, and nothing written — see the file header.
        return { outcome: 'observed', report: { source, disposition: 'unrecognised', notes } };
      }
      return {
        outcome: 'candidate',
        candidate: {
          source,
          format: VAULT_SCENARIO_FORMAT,
          payload,
          ...(notes.length === 0 ? {} : { notes }),
        },
      };
    },
  );
}

/**
 * ***`mapVaultScenario`, ported*** — see the file header for where it
 * departs from the original, each on purpose. Every column that will not read
 * adds its own `import.aventuras.columnUnreadable`, so a row with two bad
 * columns names both, and the reader decides from those notes whether the row
 * is refused. Exported for the tests, which hold it to what the original makes
 * of a row.
 */
export function mapVaultScenario(
  row: Readonly<Record<string, SQLOutputValue | undefined>>,
  id: string,
  notes: ImportNote[],
): MappedVaultScenario {
  return {
    id,
    name: stringOr(row['name'], ''),
    description: stringOr(row['description'], null),
    settingSeed: stringOr(row['setting_seed'], ''),
    npcs: listColumn(row['npcs'], 'npcs', notes),
    // `row.primary_character_name || ''`, as the mapper has it.
    primaryCharacterName: stringOr(row['primary_character_name'], ''),
    firstMessage: stringOr(row['first_message'], null),
    alternateGreetings: listColumn(row['alternate_greetings'], 'alternate_greetings', notes),
    startingTime: jsonColumn(row['starting_time'], 'starting_time', notes) ?? null,
    tags: listColumn(row['tags'], 'tags', notes),
    favorite: integer(row['favorite']) === 1,
    source: stringOr(row['source'], '') || 'import',
    originalFilename: stringOr(row['original_filename'], null),
    metadata: jsonColumn(row['metadata'], 'metadata', notes) ?? null,
    createdAt: integer(row['created_at']),
    updatedAt: integer(row['updated_at']),
  };
}
