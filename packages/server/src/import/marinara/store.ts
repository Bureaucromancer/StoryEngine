// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { FileSource } from '../source.js';

import {
  INDIRECT_SHARD_TABLES,
  READ_TABLES,
  SHARD_OWNERS,
  TABLES,
  classifyTablePath,
  encodeShardKey,
  type ReadTable,
} from './store-format.js';

/**
 * A Marinara store, read the way Marinara reads it
 * ([P4 §7.18](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Every rule here is upstream's, and each one replaced a guess.** Which of a
 * single file and a directory of shards is the table, what to do when a file is
 * torn, which of two copies of a row to keep, when a table that looks empty is
 * really sitting in its pre-migration backup — Marinara's store answers all of
 * these on every boot (`file-backed-store.ts:1246`, `:2636-2756`, `:4944-4990`
 * at `459f8b85b`), and a reader that answers any of them differently imports a
 * library Marinara would not show. So this module ports the answers, and the
 * reader beside it only decides what to *say* about them.
 *
 * **Tables are found by name, never by walking the whole root.** A single-file
 * table is read directly at its path and a sharded one by listing its own
 * directory. The whole-root walk is bounded — a real directory source stops at
 * fifty thousand files and skips symlinks — and a store with years of chats
 * reaches that bound long before the walk reaches `personas.json`. The walk is
 * for the report of everything else; conversion does not depend on it.
 *
 * Nothing is cached across stores and nothing is written. One store is one
 * sweep's view of one root, loaded table by table as the reader asks.
 */

/** A row as it sits on disk: whatever the writer put there, keyed by column. */
export type Row = Record<string, unknown>;

/** What the manifest says, read the way Marinara's own gate reads it. */
export interface MarinaraManifest {
  /** Which file supplied it: the primary, or its `.bak` when the primary was torn. */
  path: string;
  /** The declared format, when it is a number. */
  version: number | null;
  /**
   * The declared format as written, when it is present and *not* a number.
   *
   * Kept apart from `version` because the two absences mean different things: a
   * manifest with no version at all is one Marinara would infer and open, and a
   * manifest whose version is `"8"` or `8.1-beta` is saying something we cannot
   * read — which the structural gate treats as newer than known.
   */
  unreadableVersion: string | null;
  /** Row counts per table, when `tables` is an object; only non-negative integers survive. */
  tables: Readonly<Record<string, number>> | null;
  /** The primary existed and could not be parsed. */
  tornPrimary: boolean;
}

export const MANIFEST = 'storage/manifest.json';

/**
 * The manifest, from the primary or from its `.bak` (upstream's own gate falls
 * back the same way, S:4596-4606), or null when neither parses to an object.
 *
 * Null is not a refusal. Marinara recovers a lost manifest from the tables
 * themselves, so a reader that required one would refuse a store its own
 * application opens.
 */
export async function readMarinaraManifest(
  files: Pick<FileSource, 'read'>,
): Promise<MarinaraManifest | null> {
  const primary = await files.read(MANIFEST);
  const parsed = parseObject(primary);
  if (parsed !== null) return manifestOf(MANIFEST, parsed, false);

  const backup = parseObject(await files.read(`${MANIFEST}.bak`));
  if (backup !== null) return manifestOf(`${MANIFEST}.bak`, backup, primary !== null);
  return null;
}

function manifestOf(path: string, value: Row, tornPrimary: boolean): MarinaraManifest {
  const raw = value['version'];
  const version = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  const unreadableVersion =
    version === null && Object.hasOwn(value, 'version') && raw !== null && raw !== undefined
      ? typeof raw === 'string'
        ? raw
        : JSON.stringify(raw)
      : null;

  const declared = value['tables'];
  let tables: Record<string, number> | null = null;
  if (isRecord(declared)) {
    tables = {};
    for (const [table, count] of Object.entries(declared)) {
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
        tables[table] = count;
      }
    }
  }
  return { path, version, unreadableVersion, tables, tornPrimary };
}

/**
 * What became of one file the store looked at.
 *
 * - `read` — parsed to a list of rows; `malformed` counts elements that were not
 *   rows and were dropped.
 * - `recovered` — this primary could not be used and its `.bak` was read instead.
 * - `backup-read` — this `.bak` supplied the rows, as a fallback or because the
 *   primary was gone.
 * - `unreadable` — no bytes, zero bytes, or nothing but NULs: what a torn write
 *   on Windows and a file an upload did not carry both look like.
 * - `not-json` — bytes, and not JSON.
 * - `not-rows` — JSON, and not a list of rows.
 * - `superseded` — a single-file table sitting beside shards, which lost.
 * - `restored` — the pre-migration backup the table was read from, as upstream
 *   would restore it.
 */
export type FileFate =
  | { kind: 'read'; malformed: number }
  | { kind: 'recovered' }
  | { kind: 'backup-read' }
  | { kind: 'unreadable' }
  | { kind: 'not-json' }
  | { kind: 'not-rows' }
  | { kind: 'superseded' }
  | { kind: 'restored'; table: string };

/** How a table was laid out on disk, as found. */
export interface TableLayout {
  table: string;
  /** `storage/tables/<t>.json`, when something is there. */
  monolith: string | null;
  /** Its `.bak`, when something is there. */
  monolithBackup: string | null;
  /** Shard stems holding data, listed primaries and bak-only ones, in load order. */
  shards: readonly string[];
  /** The untimestamped pre-shard backups upstream would restore from, when present. */
  preShard: readonly string[];
  /** Paths under the table's directory whose names upstream never writes. */
  unknown: readonly string[];
}

/** One structural finding: a read table whose shape this build does not know. */
export interface StructuralFinding {
  table: ReadTable;
  reason: 'unknown-file' | 'not-rows' | 'missing-column' | 'missing-data';
  /** The file or column the finding is about, for a message that can be acted on. */
  detail: string;
}

export interface StoreOptions {
  /**
   * The store declared a format newer than this build checked, so a primary
   * that parses to the wrong shape is **evidence** rather than damage.
   *
   * Below the known format, a primary that is not a list of rows is a torn or
   * hand-edited file, and upstream falls back to its `.bak`. Above it, the same
   * observation is exactly what a changed shard shape looks like — and every
   * `.bak` would still hold the old shape, so falling back would read the whole
   * store one save stale and call it a success.
   */
  strict?: boolean;
}

export interface MarinaraStore {
  /** A table's rows, loaded once. Any table, not only those the reader converts. */
  rows(table: string): Promise<readonly Row[]>;
  /** How a table was laid out; loads it if it has not been. */
  layout(table: string): Promise<TableLayout>;
  /** What became of a file, once the table it belongs to has been loaded. */
  fate(path: string): FileFate | undefined;
}

interface Loaded {
  layout: TableLayout;
  rows: readonly Row[];
}

/** Opens a store over a source. Nothing is read until a table is asked for. */
export function openStore(
  files: FileSource,
  manifest: MarinaraManifest | null,
  options: StoreOptions = {},
): MarinaraStore {
  const strict = options.strict === true;
  const fates = new Map<string, FileFate>();
  const loaded = new Map<string, Promise<Loaded>>();

  const load = (table: string): Promise<Loaded> => {
    const held = loaded.get(table);
    if (held !== undefined) return held;
    const pending = loadTable(files, table, manifest, strict, fates);
    loaded.set(table, pending);
    return pending;
  };

  return {
    async rows(table) {
      return (await load(table)).rows;
    },
    async layout(table) {
      return (await load(table)).layout;
    },
    fate(path) {
      return fates.get(path);
    },
  };
}

async function loadTable(
  files: FileSource,
  table: string,
  manifest: MarinaraManifest | null,
  strict: boolean,
  fates: Map<string, FileFate>,
): Promise<Loaded> {
  const directory = `${TABLES}${table}`;
  const monolithPath = `${directory}.json`;
  const monolithBakPath = `${monolithPath}.bak`;

  // The table's own directory, listed on its own.
  const primaries = new Map<string, string>();
  const backups = new Map<string, string>();
  const unknown: string[] = [];
  for await (const path of files.list(directory)) {
    const found = classifyTablePath(path);
    if (found.table !== table) {
      // Litter lands here with no table, and is nobody's evidence.
      continue;
    }
    if (found.role === 'data' && found.shard !== null) primaries.set(found.shard, path);
    else if (found.role === 'backup' && found.shard !== null) backups.set(found.shard, path);
    else if (found.role === 'unknown') unknown.push(path);
  }

  // Bak-only shards count: a crash can take the primary and leave its backup,
  // and upstream loads those (S:1384-1392). Code-unit order, as upstream sorts.
  const stems = [...new Set([...primaries.keys(), ...backups.keys()])].sort(byCodeUnit);

  const monolith = (await files.exists(monolithPath)) ? monolithPath : null;
  const monolithBackup = (await files.exists(monolithBakPath)) ? monolithBakPath : null;
  const preShard: string[] = [];
  for (const candidate of [`${monolithPath}.pre-shard`, `${monolithBakPath}.pre-shard`]) {
    if (await files.exists(candidate)) preShard.push(candidate);
  }

  const layout: TableLayout = {
    table,
    monolith,
    monolithBackup,
    shards: stems,
    preShard,
    unknown,
  };

  // **Shards win.** A single file beside shard data is what an older build
  // writes when it runs against a sharded store, and upstream quarantines it
  // rather than merging, because the two sides forked (S:2729-2753).
  if (stems.length > 0) {
    if (monolith !== null) fates.set(monolith, { kind: 'superseded' });
    if (monolithBackup !== null) fates.set(monolithBackup, { kind: 'superseded' });

    const copies: { row: Row; stem: string }[] = [];
    for (const stem of stems) {
      const rows = await readWithFallback(
        files,
        primaries.get(stem) ?? null,
        backups.get(stem) ?? null,
        strict,
        fates,
      );
      for (const row of rows) copies.push({ row, stem });
    }
    return { layout, rows: dedupe(table, copies) };
  }

  if (monolith !== null || monolithBackup !== null) {
    const rows = await readWithFallback(files, monolith, monolithBackup, strict, fates);
    return { layout, rows };
  }

  // **Case 0.** No single file, no shards, and a manifest that says the table
  // has rows: upstream restores it from the automatic pre-migration backup on
  // its next boot, choosing by existence only and never falling through to the
  // other file if the chosen one is bad (S:2661-2677). We read what it would
  // restore, so the library is the one Marinara would show.
  const counted = manifest?.tables?.[table] ?? 0;
  const chosen = preShard[0];
  if (counted > 0 && chosen !== undefined) {
    const parsed = parseRows(await files.read(chosen));
    if (parsed.kind === 'rows') {
      fates.set(chosen, { kind: 'restored', table });
      return { layout, rows: parsed.rows };
    }
    fates.set(chosen, { kind: parsed.kind });
  }
  return { layout, rows: [] };
}

/**
 * One file's rows, falling back to its `.bak` where upstream would
 * (S:1246-1330).
 *
 * Below the known format, the fallback covers a missing, unparseable, or
 * wrongly-shaped primary, which is upstream's rule. Above it the wrong shape is
 * excluded — see {@link StoreOptions.strict} — and only damage falls back.
 */
async function readWithFallback(
  files: FileSource,
  primary: string | null,
  backup: string | null,
  strict: boolean,
  fates: Map<string, FileFate>,
): Promise<readonly Row[]> {
  if (primary === null) {
    if (backup === null) return [];
    const onlyBackup = parseRows(await files.read(backup));
    if (onlyBackup.kind === 'rows') {
      fates.set(backup, { kind: 'backup-read' });
      return onlyBackup.rows;
    }
    fates.set(backup, { kind: onlyBackup.kind });
    return [];
  }

  const parsed = parseRows(await files.read(primary));
  if (parsed.kind === 'rows') {
    fates.set(primary, { kind: 'read', malformed: parsed.malformed });
    return parsed.rows;
  }

  const mayFallBack = !strict || parsed.kind !== 'not-rows';
  if (backup !== null && mayFallBack) {
    const fallback = parseRows(await files.read(backup));
    if (fallback.kind === 'rows') {
      fates.set(primary, { kind: 'recovered' });
      fates.set(backup, { kind: 'backup-read' });
      return fallback.rows;
    }
  }
  fates.set(primary, { kind: parsed.kind });
  return [];
}

type Parsed =
  | { kind: 'rows'; rows: Row[]; malformed: number }
  | { kind: 'unreadable' }
  | { kind: 'not-json' }
  | { kind: 'not-rows' };

/**
 * A table file's bytes as rows, or why not.
 *
 * Empty and all-NUL files are `unreadable` rather than `not-json`: they are what
 * a power cut leaves on NTFS (upstream checks for exactly this, S:1020), and
 * they say nothing about the format. Treating them as a format signal would
 * refuse a store above the known format for a torn write.
 */
function parseRows(bytes: Uint8Array | null): Parsed {
  if (bytes === null || bytes.length === 0 || bytes.every((byte) => byte === 0)) {
    return { kind: 'unreadable' };
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { kind: 'not-json' };
  }
  if (!Array.isArray(value)) return { kind: 'not-rows' };
  const rows = value.filter(isRecord);
  return { kind: 'rows', rows, malformed: value.length - rows.length };
}

/**
 * One copy of each row, chosen as upstream chooses (S:4944-4990).
 *
 * Duplicates happen: a crash mid-flush can leave a row in two shard files until
 * the next load, and a hand edit can put one in the wrong file. Upstream sorts
 * candidates by `(createdAt, id)` and keeps the copy sitting in the file its
 * owner key names, else the first. **Output keeps file order** — sorting it
 * would reorder a lorebook's entries against upstream's own `order` and make
 * every previously imported book re-sweep as changed — and the losing copies
 * are dropped where they stood.
 */
function dedupe(table: string, copies: readonly { row: Row; stem: string }[]): Row[] {
  const owner = SHARD_OWNERS[table] ?? 'id';
  const indirect = INDIRECT_SHARD_TABLES.has(table);
  const canonical = (copy: { row: Row; stem: string }): boolean => {
    if (indirect) return false;
    const key = copy.row[owner];
    return encodeShardKey(typeof key === 'string' ? key : '') === copy.stem;
  };

  const byId = new Map<string, { row: Row; stem: string }[]>();
  for (const copy of copies) {
    const id = copy.row['id'];
    if (typeof id !== 'string' || id === '') continue;
    const list = byId.get(id);
    if (list === undefined) byId.set(id, [copy]);
    else list.push(copy);
  }

  const winners = new Set<Row>();
  for (const candidates of byId.values()) {
    const ordered = [...candidates].sort(
      (left, right) =>
        byCodeUnit(text(left.row['createdAt']), text(right.row['createdAt'])) ||
        byCodeUnit(text(left.row['id']), text(right.row['id'])),
    );
    const chosen = ordered.find(canonical) ?? ordered[0];
    if (chosen !== undefined) winners.add(chosen.row);
  }

  return copies
    .filter((copy) => {
      const id = copy.row['id'];
      return typeof id !== 'string' || id === '' || winners.has(copy.row);
    })
    .map((copy) => copy.row);
}

/**
 * The first read table whose shape this build does not know, or null.
 *
 * **Asked only of a store whose manifest is newer than checked**, and the four
 * questions are the ones a layout change would have to answer differently:
 *
 * - **(a)** a file in a read table's directory with a name upstream never writes;
 * - **(b)** a data file that is not a list of rows, where damage (empty, NULs,
 *   torn and recovered from `.bak`) does not count;
 * - **(c)** a row missing a column the reader joins on — string or null, since a
 *   legitimate orphan carries null — or a column a converter reads;
 * - **(d)** a table the manifest does not count, when it counts tables at all
 *   (every non-lazy table gets a count, and none we read is lazy), or counts
 *   rows that no data file, backup or pre-migration copy could hold.
 *
 * Declared paths — named by an upload and not carried — count as present, so a
 * truncated upload cannot trip (d).
 */
export async function assessStructure(
  store: MarinaraStore,
  manifest: MarinaraManifest | null,
): Promise<StructuralFinding | null> {
  for (const table of Object.keys(READ_TABLES) as ReadTable[]) {
    const spec = READ_TABLES[table];
    const layout = await store.layout(table);
    const rows = await store.rows(table);

    const strange = layout.unknown[0];
    if (strange !== undefined) return { table, reason: 'unknown-file', detail: strange };

    for (const path of dataPaths(layout)) {
      const fate = store.fate(path);
      if (fate === undefined) continue;
      if (fate.kind === 'not-rows' || fate.kind === 'not-json') {
        return { table, reason: 'not-rows', detail: path };
      }
      if (fate.kind === 'read' && fate.malformed > 0) {
        return { table, reason: 'not-rows', detail: path };
      }
    }

    for (const row of rows) {
      for (const column of spec.joins) {
        const value = row[column];
        if (!Object.hasOwn(row, column) || (typeof value !== 'string' && value !== null)) {
          return { table, reason: 'missing-column', detail: column };
        }
      }
      for (const column of spec.payload) {
        if (!Object.hasOwn(row, column)) {
          return { table, reason: 'missing-column', detail: column };
        }
      }
    }

    const counts = manifest?.tables;
    if (counts !== null && counts !== undefined) {
      const counted = counts[table];
      if (counted === undefined) return { table, reason: 'missing-data', detail: 'uncounted' };
      const held =
        layout.shards.length > 0 ||
        layout.monolith !== null ||
        layout.monolithBackup !== null ||
        layout.preShard.length > 0;
      if (counted > 0 && !held) {
        return { table, reason: 'missing-data', detail: String(counted) };
      }
    }
  }
  return null;
}

/**
 * Tables whose manifest count is more than the rows found, at any format.
 *
 * Not a refusal and not a finding: a count can be stale, and a store can be
 * read partially for reasons that are nobody's fault. It is a note, because it
 * is the only signal left when rows go missing in a way nothing else detected.
 */
export async function shortfalls(
  store: MarinaraStore,
  manifest: MarinaraManifest | null,
): Promise<{ table: ReadTable; expected: number; found: number }[]> {
  const counts = manifest?.tables;
  if (counts === null || counts === undefined) return [];
  const short: { table: ReadTable; expected: number; found: number }[] = [];
  for (const table of Object.keys(READ_TABLES) as ReadTable[]) {
    const expected = counts[table];
    if (expected === undefined) continue;
    const found = (await store.rows(table)).length;
    if (expected > found) short.push({ table, expected, found });
  }
  return short;
}

/** Every path that could have supplied a table's rows. */
function dataPaths(layout: TableLayout): string[] {
  const paths: string[] = [];
  if (layout.monolith !== null) paths.push(layout.monolith);
  if (layout.monolithBackup !== null) paths.push(layout.monolithBackup);
  for (const stem of layout.shards) {
    paths.push(
      `${TABLES}${layout.table}/${stem}.json`,
      `${TABLES}${layout.table}/${stem}.json.bak`,
    );
  }
  return paths;
}

function parseObject(bytes: Uint8Array | null): Row | null {
  if (bytes === null) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A sort key as upstream's `String(v ?? '')` gives it, for the values a row actually holds. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Code-unit order, which is what `Array.prototype.sort` gives upstream. */
function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
