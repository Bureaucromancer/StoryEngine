// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ensureDirectory, renamePath, unlinkFile } from '../storage/files.js';
import { migrate, type MigrationResult } from './migrations.js';

/**
 * Opening the derived index.
 *
 * **`node:sqlite`, not `better-sqlite3`.** [19 §7](../../../../docs/design/19-tech-stack.md)
 * preferred it *if it held up*, and the live risk was FTS5 —
 * [P1 §1.4](../../../../docs/design/workplan/07-p1-implementation.md) verified it does, unflagged, on
 * the pinned runtime. Removing the project's only unavoidable native dependency
 * materially simplifies the container build, and the derived-index design is
 * what makes the bet cheap: a driver bug costs a rebuild, not data.
 */

export interface OpenedIndex {
  db: DatabaseSync;
  /** What `migrate` decided. A caller that ignores `rebuildRequired` gets an empty index. */
  migration: MigrationResult;
  close: () => void;
}

export interface OpenIndexOptions {
  /** Pass `:memory:` for tests that do not care about the file. */
  path: string;
}

export async function openIndex({ path }: OpenIndexOptions): Promise<OpenedIndex> {
  if (path === ':memory:') return openAt(path);
  await ensureDirectory(dirname(path));

  try {
    return openAt(path);
  } catch (error) {
    /**
     * ***A file that is not an index is set aside, and the start goes on***
     * (2026-09-27).
     *
     * [21 §5] makes deleting this file a non-event, and a file whose header a
     * disk error or a bad copy has damaged is the same file with more steps:
     * everything in it is a restatement of what is on disk. It used to stop
     * the start instead — `pragma journal_mode` finds the damage and throws,
     * and nothing caught it, so the one file whose loss costs nothing was the
     * one that kept the server down until somebody with a shell deleted it.
     *
     * **Only damage**, which SQLite names (`SQLITE_NOTADB`, `SQLITE_CORRUPT`).
     * A file that is locked or unreadable is a live question about somebody
     * else's process or the disk's permissions, and setting it aside would be
     * answering it wrongly. It is kept beside the new one, under `.damaged`,
     * for whoever wants to know what happened to it, and the fresh file asks
     * for a rebuild like any new one.
     */
    if (!isDamage(error)) throw error;
    await renamePath(path, `${path}.damaged`);
    await unlinkFile(`${path}-wal`);
    await unlinkFile(`${path}-shm`);
    return openAt(path);
  }
}

/** What SQLite says when the bytes are not a database it can read. */
function isDamage(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  if (typeof code !== 'number') return false;
  // The primary result code is the low byte; the extended ones carry detail in
  // the rest (`SQLITE_CORRUPT_VTAB` is 267).
  const primary = code & 0xff;
  return primary === SQLITE_CORRUPT || primary === SQLITE_NOTADB;
}

const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

function openAt(path: string): OpenedIndex {
  const db = new DatabaseSync(path);
  let migration: MigrationResult;
  try {
    applyPragmas(db);
    migration = migrate(db);
  } catch (error) {
    // `openState`'s rule, which this had drifted from: a failed open must not
    // leave its handle behind. `new DatabaseSync` succeeds on any file; the
    // first pragma is what finds a file that is not a database — and a handle
    // abandoned there holds it, and its `-wal` and `-shm`, locked on Windows.
    db.close();
    throw error;
  }

  // Idempotent, because shutdown paths overlap: a signal handler and a `finally`
  // both reasonably close the index, and `node:sqlite` throws on the second.
  // Making the caller track whether it has already closed is a worse answer
  // than making close mean "ensure closed".
  let closed = false;

  return {
    db,
    migration,
    close: () => {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

function applyPragmas(db: DatabaseSync): void {
  // WAL: a reader is never blocked by the writer, which matters because the
  // watcher and the request path both touch this database and the watcher's
  // timing is not something a request should be able to feel
  // ([03 §5.1.1](../../../../docs/design/03-data-model.md)).
  db.exec('pragma journal_mode = wal');

  // `normal` rather than `full`. A crash can lose the last transaction, and for
  // a derived store that is a rescan of one object rather than a loss — paying
  // a full fsync per write to protect a restatement of what is already on disk
  // would be buying the wrong thing.
  db.exec('pragma synchronous = normal');

  // The watcher can fire while a request is mid-write. Waiting briefly is the
  // correct behaviour; failing immediately would surface as a spurious error.
  db.exec('pragma busy_timeout = 5000');

  db.exec('pragma foreign_keys = on');
}
