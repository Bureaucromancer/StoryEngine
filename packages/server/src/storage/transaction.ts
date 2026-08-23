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
 *
 * **The `PromiseLike` exclusion in the signature is the whole guarantee.** The
 * paragraph above says an `await` cannot be interleaved here, and other code now
 * *depends* on that: the SSE attach argues it needs no lock because a
 * checkpoint's write-and-publish is one indivisible block. But an unconstrained
 * `T` infers happily to `Promise<X>` for an `async` body — `commit` would run
 * before the body finished, and the `catch` could never see a rejection to roll
 * back. The conditional type makes that a compile error rather than a comment
 * somebody believed.
 */
export function inTransaction<T>(
  db: DatabaseSync,
  mutate: () => T extends PromiseLike<unknown> ? never : T,
): T {
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
