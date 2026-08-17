// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ensureDirectory } from '../storage/files.js';
import { migrateState, type StateMigrationResult } from './migrations.js';

/**
 * Opening `state/state.sqlite` — [13 §5.1](../../../../docs/design/13-internal-contracts.md).
 *
 * Same driver as the index and a different set of promises. The index is
 * derived, so it buys speed with `synchronous = normal` and pays for a crash
 * with a rescan. This store is authoritative: a lost transaction here is a lost
 * idempotency reservation, which is the one failure mode
 * [P2 §2.10](../../../../docs/design/workplan/04-p2-implementation.md) says must never happen —
 * a retry that makes a second provider call charges the user twice.
 */

export interface OpenedState {
  db: DatabaseSync;
  migration: StateMigrationResult;
  close: () => void;
}

export async function openState({ path }: { path: string }): Promise<OpenedState> {
  if (path !== ':memory:') {
    await ensureDirectory(dirname(path));
  }

  const db = new DatabaseSync(path);

  let migration: StateMigrationResult;
  try {
    applyPragmas(db);
    migration = migrateState(db);
  } catch (error) {
    // A failed open must not leave the handle behind. On Windows the leak is
    // not subtle — the `-shm` and `-wal` files stay locked, so the *next* thing
    // to touch that directory fails with `EBUSY` and the real error is two
    // layers away from where it is reported.
    db.close();
    throw error;
  }

  let closed = false;

  return {
    db,
    migration,
    close: () => {
      // Idempotent for the same reason the index's is: a signal handler and a
      // `finally` both reasonably close it, and `node:sqlite` throws on the
      // second call.
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

function applyPragmas(db: DatabaseSync): void {
  db.exec('pragma journal_mode = wal');

  // **`full`, not `normal`.** The difference is whether a commit is durable
  // across a power loss or only across a process crash, and the whole argument
  // for this store existing separately from the index is that its rows cannot be
  // reconstructed. A household server does a handful of these transactions per
  // turn, so the fsync cost is not on any hot path — coalescing is what keeps
  // streaming cheap ([P2 §2.10]), not weaker durability.
  db.exec('pragma synchronous = full');

  db.exec('pragma busy_timeout = 5000');

  // The draft and event tables reference `job(id)`, and the cascade on delete is
  // load-bearing: pruning a committed job's events is one delete rather than a
  // sequence somebody has to get right.
  db.exec('pragma foreign_keys = on');
}
