// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import type { ImportNote } from '@storyengine/shared';

/**
 * ***Gate on the columns, not on the version number*** —
 * [P13 §1.4](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * Aventuras records its schema in the migration runner's own table, and at
 * the pin the highest migration that succeeded is 39. **That number is not
 * the gate.** Marinara's is, because its version stands in for an on-disk
 * layout nobody can inspect without guessing; SQL tables describe
 * themselves, and Aventuras' migrations have been additive for thirty-nine
 * revisions. So the gate asks the database what it has — `pragma_table_info`
 * for every column any Part 1 stage will select — and the version only
 * colours the answer:
 *
 * - no `_sqlx_migrations`, or none that succeeded, or a required column
 *   missing: **`unknown-format`**, before anything is read;
 * - newer than 39, with every column present: **read**, and
 *   `import.aventuras.newerSchema` at `warn` says so;
 * - late columns (`scenario_vault.starting_time` from 039,
 *   `pack_templates.baseline_hash` from 036): read when present.
 *
 * ***And a table the database predates is not a refusal*** — the one place
 * this goes past §1.4's letter, on its own argument. §1.4 says old versions are
 * *the more common case, and the reason for the rule*: a restored backup is
 * not migrated until Aventuras next starts, so backups in the wild carry
 * whatever version wrote them. Read strictly — *every column the reader will
 * select, or refuse* — a backup from before migration 030 has no `preset_packs`
 * at all, and would be refused with a sentence that says it was written by a
 * *newer* version. So each table below records the migration that created it,
 * and a database whose own version is older than that is read as having none
 * of those rows, which is exactly what it has. A table missing from a database
 * that claims to be at or past its migration is still `unknown-format`: that is
 * a layout nobody here has seen.
 *
 * `pack_variables.description` and `sort_order` are late columns by the same
 * rule — migration 031 added them one migration after the table, and
 * Aventuras' own row mapper reads both as possibly absent — so they are
 * optional as well, although §1.4 names only the two above.
 *
 * **Hand-written from the replayed schema, never copied from it.** The
 * migrations are another project's AGPL-3.0 text; a column's name is a fact
 * about the file somebody hands us.
 */

/** The highest migration this build was written against — the pin's. */
export const AVENTURAS_KNOWN_SCHEMA = 39;

/** The migration runner's bookkeeping table, which every database Aventuras has opened carries. */
export const MIGRATIONS_TABLE = '_sqlx_migrations';

/**
 * The two columns Aventuras' copy-on-write branches added to the five tables
 * of a story's world: `overrides_id` (026), naming the entity a branch's row
 * edits, and `deleted` (028), marking a row as a deletion's tombstone.
 */
export const COPY_ON_WRITE = ['overrides_id', 'deleted'] as const;

/** What one table must have for a reader here to select from it. */
export interface TableRequirement {
  /** The migration that created the table; a database older than it has no such table, rightly. */
  since: number;
  /** Every column a Part 1 stage selects. One missing refuses the database. */
  columns: readonly string[];
  /** Columns added after the table, read when present and never required. */
  optional?: readonly string[];
  /**
   * ***Columns added after the table, by the migration that added each*** —
   * [P13.11](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **Required from their migration on, and absent before it**, which is
   * stricter than {@link TableRequirement.optional} and deliberately. The
   * optional columns are ones whose absence costs a field: a scenario without
   * `starting_time`, a pack without a baseline. The story columns are not:
   * a database at migration 13 or later with no `story_entries.branch_id`
   * would put every branch's entries on the main line, and the story would
   * import as one long, plausible, wrong chain — the *torn* reading §1.4's
   * gate exists to refuse. So a column listed here is `unknown-format` when
   * the database claims to be past the migration that made it and does not
   * have it, and is read as `null` on a database older than that, which is
   * exactly what the database holds.
   */
  late?: Readonly<Record<string, number>>;
}

/**
 * **The columns the reader will ever select, and not one more.** Requiring a
 * column nothing reads would refuse a database for a difference that could
 * not have mattered.
 *
 * The vault and pack rows are what Aventuras' own row mappers read
 * (`mapVaultCharacter`, `mapVaultLorebook`, `mapVaultScenario`, `mapVaultTag`,
 * `mapPack`, `mapPackTemplate`, `mapPackVariable` in
 * `src/lib/services/database.ts`), because P13.3–P13.9 port those mappers and
 * hand the converters exactly what they already take (§0.1). The story tables
 * needed only what counting them per story needs until P13.11, which reads a
 * story's own row, its entries and its branches to rebuild the tree; the
 * world's tables are still only counted, until P13.12 reads them.
 *
 * **A table only counted as a whole is not here at all** — `settings`,
 * `templates`, and the three story tables the reader counts per table and not
 * per story (`STORY_COUNTS` in the reader: `time_anchors`, `kept_separate`,
 * `world_state_snapshots`). `count(*)` selects no column, so by the rule above
 * none is required; a database without one of them simply has no row for it
 * in the review. *Found at the P13.2 review:* those three were gated on a
 * `story_id` nothing selected, which is the refusal-for-no-reason this list
 * exists to prevent. `registries.test.ts` holds the other direction — every
 * table the reader groups by `story_id` is gated on it here — so a table moved
 * into the per-story counts cannot be counted ungated, which would throw out
 * of `items()` after a survey had passed.
 *
 * ***The copy-on-write columns are optional*** (`overrides_id` from 026,
 * `deleted` from 028). The per-story counts leave out a branch's edit of an
 * entity and a deletion's tombstone when the columns are there to say which
 * rows those are (see the reader's `storyRows`), and count every row of a
 * database from before them — which had neither kind of row to leave out.
 */
export const AVENTURAS_REQUIRED: Readonly<Record<string, TableRequirement>> = {
  character_vault: {
    since: 16,
    columns: [
      'id',
      'name',
      'description',
      'traits',
      'visual_descriptors',
      'portrait',
      'tags',
      'favorite',
      'source',
      'original_story_id',
      'metadata',
      'created_at',
      'updated_at',
    ],
  },
  lorebook_vault: {
    since: 17,
    columns: [
      'id',
      'name',
      'description',
      'entries',
      'tags',
      'favorite',
      'source',
      'original_filename',
      'original_story_id',
      'metadata',
      'created_at',
      'updated_at',
    ],
  },
  scenario_vault: {
    since: 18,
    columns: [
      'id',
      'name',
      'description',
      'setting_seed',
      'npcs',
      'primary_character_name',
      'first_message',
      'alternate_greetings',
      'tags',
      'favorite',
      'source',
      'original_filename',
      'metadata',
      'created_at',
      'updated_at',
    ],
    optional: ['starting_time'],
  },
  vault_tags: { since: 22, columns: ['id', 'name', 'type', 'color', 'created_at'] },
  preset_packs: {
    since: 30,
    columns: ['id', 'name', 'description', 'author', 'is_default', 'created_at', 'updated_at'],
  },
  pack_templates: {
    since: 30,
    columns: [
      'id',
      'pack_id',
      'template_id',
      'content',
      'content_hash',
      'created_at',
      'updated_at',
    ],
    optional: ['baseline_hash'],
  },
  pack_variables: {
    since: 30,
    columns: [
      'id',
      'pack_id',
      'variable_name',
      'display_name',
      'variable_type',
      'is_required',
      'default_value',
      'enum_options',
      'created_at',
    ],
    optional: ['description', 'sort_order'],
  },
  /**
   * *Since P13.9*, counted per pack for the pack's row of the review
   * (`packs.ts`) — which groups by this and selects nothing else of it, so it
   * is all this table is gated on. A per-entity variable definition is P7's
   * channel shape, and stays `recorded` (§1.10).
   */
  pack_runtime_variables: { since: 32, columns: ['pack_id'] },

  // ── The stories ───────────────────────────────────────────────────────────
  //
  // Counted per story since P13.2; ***since P13.11 the three that make a
  // story's tree are read in full*** — the columns Aventuras' own row mappers
  // read (`mapStory`, `mapStoryEntry` and the branch row, `database.ts`), and
  // not one more: `parent_id` is never selected, because nothing Aventuras
  // writes ever sets it ([18 §2.3.1]), and the translation, world-state and
  // retry columns are not read by this stage. Each column added after its
  // table is gated on the migration that added it (`late`, above).
  stories: {
    since: 1,
    columns: ['id', 'title', 'created_at', 'updated_at', 'settings'],
    late: { mode: 2, current_branch_id: 13 },
  },
  story_entries: {
    since: 1,
    columns: ['id', 'story_id', 'type', 'content', 'position', 'created_at', 'metadata'],
    late: { branch_id: 13, reasoning: 19, original_input: 21, suggested_actions: 27 },
  },
  characters: { since: 1, columns: ['story_id'], optional: COPY_ON_WRITE },
  locations: { since: 1, columns: ['story_id'], optional: COPY_ON_WRITE },
  items: { since: 1, columns: ['story_id'], optional: COPY_ON_WRITE },
  story_beats: { since: 1, columns: ['story_id'], optional: COPY_ON_WRITE },
  chapters: { since: 2, columns: ['story_id'] },
  checkpoints: { since: 2, columns: ['story_id'] },
  entries: { since: 3, columns: ['story_id'], optional: COPY_ON_WRITE },
  embedded_images: { since: 11, columns: ['story_id'] },
  branches: {
    since: 13,
    columns: ['id', 'story_id', 'name', 'parent_branch_id', 'fork_entry_id', 'created_at'],
  },
  background_images: { since: 24, columns: ['story_id'] },
};

/** What the gate decided. */
export type SchemaVerdict =
  | {
      ok: true;
      /** The highest migration that succeeded. */
      version: number;
      /** Every table the database has, SQLite's own excepted. */
      tables: ReadonlySet<string>;
      /** `import.aventuras.newerSchema` when the version is past the pin; else none. */
      notes: readonly ImportNote[];
    }
  | {
      ok: false;
      refusal: 'unknown-format';
      /**
       * What was missing, as `table` or `table.column` — for a test or a log
       * line to say which, never for the person: the refusal's own sentence
       * is the answer to them, and a column name is not.
       */
      missing: string;
    };

/**
 * The gate — §1.1's `aventurasPreflight`, which runs in the reader's
 * `survey()` against the snapshot and only there (see the probe's comment in
 * `detect.ts` for why `classifyRoot` does not call it).
 *
 * Reads nothing but the schema and `_sqlx_migrations`' highest version: no
 * row of the person's is selected before this has answered.
 */
export function aventurasPreflight(db: DatabaseSync): SchemaVerdict {
  const tables = tablesIn(db);
  const refuse = (missing: string): SchemaVerdict => ({
    ok: false,
    refusal: 'unknown-format',
    missing,
  });

  if (!tables.has(MIGRATIONS_TABLE)) return refuse(MIGRATIONS_TABLE);
  const bookkeeping = columnsOf(db, MIGRATIONS_TABLE);
  for (const column of ['version', 'success']) {
    if (!bookkeeping.has(column)) return refuse(`${MIGRATIONS_TABLE}.${column}`);
  }
  // A database with the table and no migration that succeeded is one no
  // Aventuras finished opening, whatever else it holds.
  const version = highestVersion(db);
  if (version === null) return refuse(`${MIGRATIONS_TABLE}.version`);

  for (const [table, need] of Object.entries(AVENTURAS_REQUIRED)) {
    if (!tables.has(table)) {
      if (version < need.since) continue;
      return refuse(table);
    }
    const have = columnsOf(db, table);
    for (const column of need.columns) {
      if (!have.has(column)) return refuse(`${table}.${column}`);
    }
    for (const [column, since] of Object.entries(need.late ?? {})) {
      if (version >= since && !have.has(column)) return refuse(`${table}.${column}`);
    }
  }

  const notes: ImportNote[] = [];
  if (version > AVENTURAS_KNOWN_SCHEMA) {
    notes.push({
      key: 'import.aventuras.newerSchema',
      params: { version, known: AVENTURAS_KNOWN_SCHEMA },
      level: 'warn',
    });
  }
  return { ok: true, version, tables, notes };
}

/**
 * Every table the database has, by name — **SQLite's own excepted**.
 *
 * `sqlite_sequence` appears the first time anything uses `AUTOINCREMENT` and
 * `sqlite_stat1` the first time anybody runs `ANALYZE`; neither is Aventuras',
 * and reporting either as an unrecognised table of theirs would be a review
 * describing the storage engine.
 */
export function tablesIn(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\'",
    )
    .all();
  return new Set(rows.map((row) => String(row['name'])));
}

/**
 * A table's columns, by name.
 *
 * Through `pragma_table_info` with the name **bound** rather than spliced,
 * since a table name here came out of somebody else's `sqlite_master` and may
 * be spelled any way at all.
 */
export function columnsOf(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare('select name from pragma_table_info(?)').all(table);
  return new Set(rows.map((row) => String(row['name'])));
}

/**
 * The highest migration that succeeded, or `null` when none did.
 *
 * The runner records a failed migration with `success = 0` and stops, so the
 * failed row is not the database's schema and is not counted.
 */
function highestVersion(db: DatabaseSync): number | null {
  const row = db
    .prepare(`select max(version) as version from ${MIGRATIONS_TABLE} where success = 1`)
    .get();
  const version = row?.['version'];
  if (typeof version === 'bigint') return Number(version);
  return typeof version === 'number' && Number.isInteger(version) ? version : null;
}

/**
 * A name as an SQL identifier: double-quoted, any quote inside it doubled —
 * for the one statement no parameter can stand in for, a table named in a
 * `from` clause. Every name that reaches it came from `sqlite_master`.
 */
export function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
