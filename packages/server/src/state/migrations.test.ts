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
 * ([22 §5.1]). The index can be thrown away and rebuilt; a job in flight and
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

  /**
   * ***The step that narrows a rendition job's uniqueness to its session***,
   * written at the version it leaves from — the rule the import-item test above
   * learned the hard way, because only a store at that version can hold a job
   * row for the step to carry.
   *
   * Two claims: the row an older build wrote survives, and a second session may
   * now hold a job for a record with the same id — which is what an imported
   * copy of a session on the install that exported it is.
   */
  it('keeps rendition jobs and lets two sessions share a rendition id', () => {
    const db = storeAtVersion(6);
    const insert = db.prepare(
      `insert into rendition_job (id, session_id, account, rendition_id, turn_id, purpose,
                                  status, attempt, created_at, updated_at)
       values (?, ?, 'ned', 'turn-1.0', 'turn-1', 'illustration', 'done', 1, 1, 1)`,
    );
    insert.run('job-1', 'session-original');

    expect(migrateState(db)).toEqual({ from: 6, to: STATE_SCHEMA_VERSION });

    const kept = db.prepare(`select id from rendition_job`).all() as { id: string }[];
    expect(kept).toEqual([{ id: 'job-1' }]);

    insert.run('job-2', 'session-copy');
    expect(() => {
      insert.run('job-3', 'session-copy');
    }).toThrow(/UNIQUE/);

    db.close();
  });

  /**
   * ***One live job per record, and as many finished ones as there were tries***
   * — the step that made a retry a new row. Written at the version it leaves
   * from, with a finished job in it, because the row an older build wrote is
   * the one a person's retry has to be allowed to follow.
   */
  it('lets a finished rendition job be followed by a retry, but not a live one', () => {
    const db = storeAtVersion(7);
    const insert = db.prepare(
      `insert into rendition_job (id, session_id, account, rendition_id, turn_id, purpose,
                                  status, attempt, created_at, updated_at, finished_at)
       values (?, 'session-1', 'ned', 'turn-1.0', 'turn-1', 'illustration', ?, ?, 1, 1, ?)`,
    );
    insert.run('job-1', 'done', 1, 1);

    expect(migrateState(db)).toEqual({ from: 7, to: STATE_SCHEMA_VERSION });

    insert.run('job-2', 'queued', 2, null);
    expect(() => {
      insert.run('job-3', 'queued', 3, null);
    }).toThrow(/UNIQUE/);
    const kept = db.prepare(`select id from rendition_job order by id`).all() as { id: string }[];
    expect(kept.map((row) => row.id)).toEqual(['job-1', 'job-2']);

    db.close();
  });

  /**
   * ***How an import arrived*** — the step of 2026-09-28. Every job written
   * before it was a sweep of a server path, so that is what it says of them,
   * and *Update from source* goes on finding the roots it could reopen.
   */
  it('says every import recorded before it came in by a path', () => {
    const before = STATE_SCHEMA_VERSION - 1;
    const db = storeAtVersion(before);
    db.prepare(
      `insert into import_job (id, account, root, source, status, created_at, updated_at, finished_at)
       values ('job-1', 'ned', '/srv/st', 'sillytavern', 'finished', 1, 1, 1)`,
    ).run();

    expect(migrateState(db)).toEqual({ from: before, to: STATE_SCHEMA_VERSION });
    const row = db.prepare(`select transport from import_job where id = 'job-1'`).get() as {
      transport: string;
    };
    expect(row.transport).toBe('path');

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

  /**
   * ***The step that makes a retry a new job*** — `STEPS[6]`, 2026-09-26.
   *
   * `STEPS[4]` made `rendition_id` unique with no condition, so a retry re-ran
   * the first try's finished row and left it `running` with `finished_at` still
   * set. The step replaces the index with the partial one its comment described,
   * and **heals the rows the bug already wrote** — without that, an install
   * that crashed mid-retry would keep a job boot recovery cannot see, on the
   * build that was supposed to fix it.
   *
   * Written at the version the step leaves *from*, for the reason the
   * import-item test above is: that is the only place the rows can exist.
   */
  describe('the step that makes a rendition retry a new job', () => {
    const BEFORE = 6;

    function renditionJob(
      db: DatabaseSync,
      row: {
        id: string;
        status: string;
        attempt: number;
        finishedAt: number | null;
        renditionId?: string;
      },
    ): void {
      db.prepare(
        `insert into rendition_job (id, session_id, account, rendition_id, turn_id, purpose,
                                    status, attempt, created_at, updated_at, finished_at)
         values (?, 'session-1', 'ned', ?, 'turn-1', 'illustration', ?, ?, 1, 1, ?)`,
      ).run(row.id, row.renditionId ?? 'turn-1.0', row.status, row.attempt, row.finishedAt);
    }

    function finishedAtOf(db: DatabaseSync, id: string): number | null {
      const row = db.prepare(`select finished_at from rendition_job where id = ?`).get(id) as {
        finished_at: number | null;
      };
      return row.finished_at;
    }

    it('heals a retry the old index left running with a finish time', () => {
      const db = storeAtVersion(BEFORE);
      // The defect's signature: a status that says in flight, and a column that
      // says finished. Only re-running a finished row produces it.
      renditionJob(db, { id: 'stuck', status: 'running', attempt: 1, finishedAt: 5 });

      migrateState(db);

      // Live again, so the next boot's recovery finds it and abandons it — which
      // is what it would have done on the day, had it been able to see it.
      expect(finishedAtOf(db, 'stuck')).toBeNull();
      db.close();
    });

    it('leaves a finished job finished', () => {
      const db = storeAtVersion(BEFORE);
      renditionJob(db, { id: 'done', status: 'done', attempt: 1, finishedAt: 5 });
      // A different picture: the old index allowed one row per rendition, ever.
      renditionJob(db, {
        id: 'gone',
        status: 'abandoned',
        attempt: 1,
        finishedAt: 6,
        renditionId: 'turn-2.0',
      });

      migrateState(db);

      expect(finishedAtOf(db, 'done')).toBe(5);
      expect(finishedAtOf(db, 'gone')).toBe(6);
      db.close();
    });

    it('keeps every finished try and allows only one live one', () => {
      const db = storeAtVersion(BEFORE);
      renditionJob(db, { id: 'first', status: 'done', attempt: 1, finishedAt: 5 });
      migrateState(db);

      // History: a second finished try of the same picture is ordinary now.
      renditionJob(db, { id: 'second', status: 'done', attempt: 2, finishedAt: 7 });
      renditionJob(db, { id: 'third', status: 'running', attempt: 3, finishedAt: null });

      // One in flight at a time, as the constraint rather than as a lookup.
      expect(() => {
        renditionJob(db, { id: 'fourth', status: 'queued', attempt: 4, finishedAt: null });
      }).toThrow(/UNIQUE/);
      // And a number is never issued twice, which is *never a reset* held by the
      // store rather than by the one function that assigns it.
      expect(() => {
        renditionJob(db, { id: 'again', status: 'done', attempt: 2, finishedAt: 9 });
      }).toThrow(/UNIQUE/);
      db.close();
    });
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
