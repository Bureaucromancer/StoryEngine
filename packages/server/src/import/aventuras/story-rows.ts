// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import { columnsOf, quoted } from './schema.js';

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
 * *Not read at this stage:* the translation columns (a display cache of text
 * this does read), `world_state_delta` (P13.12's world), and the story's
 * retry, style-review, memory and time-tracker blobs, which are Aventuras'
 * working state rather than the story.
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
}

/** Everything the producer reads of one story. */
export interface AventurasStoryRows {
  story: AventurasStory;
  entries: AventurasEntry[];
  branches: AventurasBranch[];
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
    const listed = db.prepare(
      `select id, name, parent_branch_id, fork_entry_id, created_at ` +
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
      });
    }
  }

  return { story, entries, branches, unreadable };
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
