// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

/**
 * Runs a mutation as one unit — F9.
 *
 * Synchronous by construction, and that is the point rather than an accident:
 * `node:sqlite` is synchronous, so a body with no `await` in it cannot be
 * interleaved by another writer on the same handle. Anything that needs the
 * filesystem does it before the transaction opens.
 *
 * `begin immediate` rather than plain `begin`: the write lock is taken up front,
 * so two writers contend at the start where `busy_timeout` can wait for them,
 * rather than at the first write inside a transaction that has already read —
 * which is where SQLite gives up with `SQLITE_BUSY_SNAPSHOT` instead of waiting.
 *
 * It returns the body's value rather than taking a `void` callback, because the
 * alternative is assigning to a `let` from inside a closure — which works and
 * which the type checker cannot follow, so the variable stays narrowed to its
 * initialiser and every use of it reads as dead.
 */
export function inTransaction<T>(db: DatabaseSync, mutate: () => T): T {
  db.exec('begin immediate');
  try {
    const result = mutate();
    db.exec('commit');
    return result;
  } catch (error) {
    db.exec('rollback');
    throw error;
  }
}
