// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';

import type { Layout } from './storage/layout.js';

/**
 * ***One server per data directory*** (2026-09-27) — `Layout.instanceLockFile`
 * has what a second one did before this existed.
 *
 * **An operating-system lock, taken through SQLite**, because Node has no
 * `flock` of its own and SQLite's is the one this process already carries. An
 * exclusive transaction that is never committed, under `locking_mode =
 * exclusive`, holds the file's lock until the process lets go of it: when it
 * exits, however it exits, since the kernel releases a dead process's locks.
 * So there is no stale-lock file to clean up after a crash, which is the
 * problem every lock written as a pid file has, and the one it cannot solve.
 *
 * **The holder has to stay reachable.** A `DatabaseSync` the garbage collector
 * finishes closes its file, and the lock goes with it. `main.ts` keeps it in a
 * module-level variable for the life of the process.
 */
export interface InstanceLock {
  /** Lets it go. Only a test does this; a server holds it until it exits. */
  release(): void;
}

/** Another process holds the directory. */
export class InstanceLockHeld extends Error {}

/**
 * Takes the lock, or throws {@link InstanceLockHeld} naming the directory. Any
 * other failure (a directory this process cannot write) is thrown as it came,
 * for the caller's existing answer to it.
 */
export function holdInstanceLock(layout: Layout): InstanceLock {
  const db = new DatabaseSync(layout.instanceLockFile);
  try {
    db.exec('pragma locking_mode = exclusive');
    db.exec('begin exclusive');
  } catch (error) {
    db.close();
    if (isBusy(error)) {
      throw new InstanceLockHeld(
        `Another StoryEngine server is using ${layout.dataRoot}. Stop it first, or give this one its own data directory.`,
        { cause: error },
      );
    }
    throw error;
  }
  return {
    release: () => {
      db.close();
    },
  };
}

/** `SQLITE_BUSY`, in the primary code of whatever extended code came back. */
function isBusy(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === 'number' && (code & 0xff) === 5;
}
