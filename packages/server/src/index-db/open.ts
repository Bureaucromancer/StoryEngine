// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ensureDirectory } from '../storage/files.js';
import { migrate, type MigrationResult } from './migrations.js';

/**
 * Opening the derived index.
 *
 * **`node:sqlite`, not `better-sqlite3`.** [07 §7](../../../../docs/design/07-tech-stack.md)
 * preferred it *if it held up*, and the live risk was FTS5 —
 * [P1 §1.4](../../../../docs/design/workplan/03-p1-implementation.md) verified it does, unflagged, on
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
  if (path !== ':memory:') {
    await ensureDirectory(dirname(path));
  }

  const db = new DatabaseSync(path);
  applyPragmas(db);
  const migration = migrate(db);

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
  // ([02 §5.1.1](../../../../docs/design/02-data-model.md)).
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
