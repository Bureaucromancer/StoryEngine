// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { migrateState, STATE_SCHEMA_VERSION, STEPS } from './migrations.js';

/**
 * **The migration chain's own rule, tested rather than asserted in a comment.**
 *
 * This file's doctrine is that steps are *stepwise and preserving* — each
 * version is a function from the previous one and none may drop a table —
 * because nothing in this store is a restatement of anything on disk
 * ([21 §5.1]). The index can be thrown away and rebuilt; a job in flight and
 * the draft of a turn cannot.
 *
 * Until P4.0 there was exactly one step, so the rule had never been exercised:
 * every store this build had ever opened was created at the current version by
 * `STEPS[0]`, and an upgrade path that has never run is an upgrade path nobody
 * knows the state of. `STEPS` is exported for this, because building a store at
 * an earlier version is the only way to test the step that leaves it.
 */

/** A store at exactly `version`, built the way that version's build would have. */
function storeAtVersion(version: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('pragma foreign_keys = on');
  for (let index = 0; index < version; index += 1) {
    const step = STEPS[index];
    if (step === undefined) throw new Error(`no step ${String(index)}`);
    db.exec(step);
  }
  db.exec(`pragma user_version = ${String(version)}`);
  return db;
}

function tableNames(db: DatabaseSync): string[] {
  const rows = db.prepare(`select name from sqlite_master where type = 'table'`).all() as {
    name: string;
  }[];
  return rows.map((row) => row.name).sort();
}

describe('the operational store upgrades without losing anything', () => {
  it('carries a job in flight across the step that adds import', () => {
    const db = storeAtVersion(1);
    db.prepare(
      `insert into job (id, session_id, account, parent_turn_id, turn_id, status, commit_step,
                        created_at, updated_at, finished_at)
       values (?, ?, ?, null, ?, 'running', 0, 1, 1, null)`,
    ).run('job-1', 'session-1', 'ned', 'turn-1');
    db.prepare(`insert into draft (job_id, turn, updated_at) values (?, ?, 1)`).run(
      'job-1',
      '{"text":"half a turn"}',
    );

    const result = migrateState(db);

    expect(result).toEqual({ from: 1, to: STATE_SCHEMA_VERSION });
    // The point of the whole discipline: an uncommitted draft is the thing
    // [P2 §2.10] costed explicitly, and an upgrade is not allowed to spend it.
    const draft = db.prepare(`select turn from draft where job_id = 'job-1'`).get() as {
      turn: string;
    };
    expect(draft.turn).toBe('{"text":"half a turn"}');

    db.close();
  });

  it('adds the import tables and drops none of the turn ones', () => {
    const before = tableNames(storeAtVersion(1));

    const db = storeAtVersion(1);
    migrateState(db);
    const after = tableNames(db);

    for (const table of before) {
      expect(after, `${table} was dropped by a migration`).toContain(table);
    }
    expect(after).toContain('import_job');
    expect(after).toContain('import_event');

    db.close();
  });

  /**
   * **The one step that drops a table, and nothing watched it carry its rows
   * over** — [P5 §0.5]'s critic finding, tested at [P6B.1].
   *
   * `STEPS[3]` does the create-copy-drop-rename dance SQLite needs to remove a
   * primary key, so it *does* drop a table while this file's doctrine says none
   * may. The doctrine test above cannot see it: it compares the tables of a **v1**
   * store, and a v1 store has no `import_item` to observe being dropped.
   *
   * So **deleting the `insert into import_item_new … select` left the entire
   * suite green** while every upgrading install silently lost every import
   * review and note it had ever recorded — which is exactly the data
   * [P4 §3](../../../../docs/design/workplan/16-p4-implementation.md)'s gate
   * step 16 is walked against, and exactly what a walk on a fresh store would
   * never notice.
   *
   * Written at the version the step leaves *from*, because that is the only
   * place the rows can exist to be carried.
   */
  it('carries every import item across the step that rebuilds its table', () => {
    const db = storeAtVersion(3);
    db.prepare(
      `insert into import_job (id, account, root, source, status, created_at, updated_at)
       values ('import-1', 'ned', '/somewhere/SillyTavern/data', 'sillytavern', 'done', 1, 1)`,
    ).run();
    db.prepare(
      `insert into import_item (job_id, seq, source, disposition, object_id, notes)
       values ('import-1', 0, 'characters/Vera.png', 'created', 'obj-1', '{"lost":["depth"]}')`,
    ).run();

    expect(migrateState(db)).toEqual({ from: 3, to: STATE_SCHEMA_VERSION });

    const rows = db
      .prepare(`select source, disposition, object_id, notes from import_item`)
      .all() as { source: string; disposition: string; object_id: string; notes: string }[];
    // Every column, not a count: a copy that dropped `notes` would pass a count
    // and lose the half of the review a person actually reads.
    expect(rows).toEqual([
      {
        source: 'characters/Vera.png',
        disposition: 'created',
        object_id: 'obj-1',
        notes: '{"lost":["depth"]}',
      },
    ]);

    db.close();
  });

  it('is a no-op on a store already at the current version', () => {
    const db = storeAtVersion(STATE_SCHEMA_VERSION);

    expect(migrateState(db)).toEqual({ from: STATE_SCHEMA_VERSION, to: STATE_SCHEMA_VERSION });

    db.close();
  });

  it('refuses a store from a newer build rather than migrating it down', () => {
    const db = storeAtVersion(STATE_SCHEMA_VERSION);
    db.exec(`pragma user_version = ${String(STATE_SCHEMA_VERSION + 1)}`);

    expect(() => migrateState(db)).toThrow(/written by a newer StoryEngine/);

    db.close();
  });

  it('cascades import events with their job, the way turn events do', () => {
    const db = storeAtVersion(STATE_SCHEMA_VERSION);
    db.prepare(
      `insert into import_job (id, account, root, source, status, created_at, updated_at)
       values ('import-1', 'ned', '/somewhere/SillyTavern/data', 'sillytavern', 'running', 1, 1)`,
    ).run();
    db.prepare(
      `insert into import_event (job_id, seq, key, params, at)
       values ('import-1', 0, 'job.progress', '{}', 1)`,
    ).run();

    db.prepare(`delete from import_job where id = 'import-1'`).run();

    const left = db.prepare(`select count(*) as n from import_event`).get() as { n: number };
    expect(left.n).toBe(0);

    db.close();
  });
});
