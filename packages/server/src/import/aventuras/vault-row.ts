// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import type { ImportNote } from '@storyengine/shared';

import type { SourceItem } from '../source.js';
import { quoted } from './schema.js';

/**
 * ***What every vault table's reader does the same way*** — split out of
 * `vault-character.ts` at
 * [P13.4](../../../../../docs/design/workplan/30-p13-aventuras-import.md), when
 * `lorebook_vault` became the second table read row by row and the rules below
 * would otherwise have been written twice and been free to drift.
 *
 * Each rule is here because of a row somebody else's tool could have written,
 * not because of one Aventuras writes today:
 *
 * - **Rows are walked by id, sorted by name** — a sort over the ids alone, and
 *   each row fetched by its key as the sweep asks for it, so a table whose rows
 *   carry a portrait or a long JSON column never hands them all to SQLite's
 *   sorter at once, and the review reads as a list.
 * - **A row with no id is named by its place and converted not.** SQLite lets
 *   a `TEXT PRIMARY KEY` be null and Aventuras' tables do not forbid it; such a
 *   row has no identity a re-import could find it by ([§1.5]), so it becomes
 *   an `unrecognised` row that says so — and a converted table's rows *are* its
 *   row count, so it is still counted.
 * - **A JSON column that will not parse is a note, never a crash** —
 *   `import.aventuras.columnUnreadable`, and the column read as absent.
 *   Aventuras' own mappers call `JSON.parse` bare, so one bad row fails its
 *   whole vault; here it costs the field.
 * - **Integers are read as integers, however large**, the statements reading
 *   big integers as `bigint`: `node:sqlite` throws out of a read that meets one
 *   past 2^53, which would throw out of the sweep after earlier rows were
 *   written. A value past the safe range is simply not a number here.
 */

export interface VaultTable {
  /**
   * What every `source` begins with: the database's own name, which the reader
   * owns (`AVENTURAS_DATABASE`). Passed rather than imported, so the table
   * modules do not import the reader that imports them.
   */
  database: string;
  /** The table, and the middle of every candidate's `source` (§1.5). */
  table: string;
}

/**
 * ***Every row of a vault table, one item each*** — `toItem`'s candidate for a
 * row with an id, and the `unrecognised` row for one without.
 *
 * `fetch` reads one row by its id, with whatever columns and bounds its table
 * wants; it answers `undefined` for a row that went between the two reads,
 * which on a read-only snapshot never happens and costs nothing to allow for.
 * A generator over the ids statement: it closes when the sweep stops asking,
 * however it stops.
 */
export function* vaultRows(
  db: DatabaseSync,
  table: VaultTable,
  fetch: (id: string) => Record<string, SQLOutputValue> | undefined,
  toItem: (row: Record<string, SQLOutputValue>, id: string, source: string) => SourceItem,
): Generator<SourceItem> {
  const ids = db.prepare(`select id from ${quoted(table.table)} order by name collate nocase, id`);
  ids.setReadBigInts(true);

  let position = 0;
  for (const { id } of ids.iterate()) {
    position += 1;
    if (typeof id !== 'string' || id.length === 0) {
      yield {
        outcome: 'observed',
        report: {
          source: `${table.database}/${table.table}#${String(position)}`,
          disposition: 'unrecognised',
          notes: [
            {
              key: 'import.row.unreadable',
              params: { row: String(position), table: table.table },
              level: 'warn',
            },
          ],
        },
      };
      continue;
    }
    const row = fetch(id);
    if (row === undefined) continue;
    yield toItem(row, id, `${table.database}/${table.table}/${id}`);
  }
}

/**
 * A JSON column, parsed — or `undefined` for one that holds nothing, which is
 * what the mappers' `row.x ? JSON.parse(row.x) : default` treats as absent
 * (`null` and the empty string both). One that holds something that will not
 * parse is noted and read as absent too.
 */
export function jsonColumn(
  value: SQLOutputValue | undefined,
  column: string,
  notes: ImportNote[],
): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string') {
    notes.push(columnUnreadable(column));
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    notes.push(columnUnreadable(column));
    return undefined;
  }
}

/**
 * A JSON column that should hold a list: `[]` for an absent one, and for one
 * that parsed to something else — which the mapper would hand on and the
 * converter would then refuse the whole object over, costing the object for
 * the field — with the column named.
 */
export function listColumn(
  value: SQLOutputValue | undefined,
  column: string,
  notes: ImportNote[],
): unknown[] {
  const parsed = jsonColumn(value, column, notes);
  if (parsed === undefined) return [];
  if (Array.isArray(parsed)) return parsed as unknown[];
  notes.push(columnUnreadable(column));
  return [];
}

export function columnUnreadable(column: string): ImportNote {
  return { key: 'import.aventuras.columnUnreadable', params: { column }, level: 'warn' };
}

export function stringOr<T extends string | null>(
  value: SQLOutputValue | undefined,
  fallback: T,
): string | T {
  return typeof value === 'string' ? value : fallback;
}

/** An integer column, or `null` for anything that is not one a JavaScript number can hold. */
export function integer(value: SQLOutputValue | undefined): number | null {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
