// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';

/**
 * ***The half of `sqlite-snapshot.ts` that blocks, on a thread of its own*** —
 * [P13 §1.2](../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * the paragraph added 2026-09-28.
 *
 * `node:sqlite` is synchronous. A `VACUUM INTO` of a database of several
 * hundred megabytes, or a `quick_check` over one, runs for seconds, and on the
 * main thread those seconds are **every** request's: other people's live turns
 * stop streaming, the health check stops answering, and a proxy in front of
 * the server starts closing connections. The server had no worker threads
 * before this one, and this is the smallest thing that needed one — the work
 * is a function of paths that returns a verdict, so nothing crosses the
 * boundary but strings, and there is no state to share.
 *
 * **One worker per task**, started and finished around it. An import takes a
 * snapshot once, and a pool kept alive for that would be a thread sitting idle
 * for the life of the process, and a thing the shutdown would have to know
 * about. Starting one costs tens of milliseconds against work that is only
 * worth moving off the main thread when it costs seconds.
 *
 * ***Self-contained, and that is a loading rule rather than a style.*** This
 * file imports `node:` built-ins and nothing of ours. It is started by path:
 * as `.js` from `dist`, and as `.ts` under vitest and `tsx`, where Node strips
 * the types itself — and Node's type stripping does not rewrite a `./x.js`
 * specifier to the `./x.ts` that exists, so an import of a sibling module
 * would load under the build and fail under the tests, or the other way round.
 * `sqlite-snapshot.ts` imports only *types* from here, which the compiler and
 * the stripper both erase. Anything this needs that lives elsewhere is
 * restated here instead, and that is the price of the rule.
 */

/** One piece of work, as the main thread describes it. */
export type SnapshotTask =
  /**
   * `VACUUM INTO` from `source`, opened read-only, to `target`, which must not
   * exist. The consistent route: SQLite's own locking gives the copy one point
   * in time, and committed frames still in the source's `-wal` are in it.
   */
  | { op: 'vacuum'; source: string; target: string }
  /**
   * Open `path` read-write — which replays a `-wal` beside it — then
   * `PRAGMA quick_check`, and on success fold the log in and leave one file.
   */
  | { op: 'check'; path: string };

/** What came of it. A SQLite failure is an outcome; only a broken worker throws. */
export type SnapshotTaskOutcome =
  | { ok: true }
  | {
      ok: false;
      /** SQLite's own words, or the first of `quick_check`'s complaints. */
      message: string;
      /**
       * SQLite's result code when SQLite raised one — possibly an extended
       * code, whose low byte is the primary one (`SQLITE_FULL` is 13) — and
       * `null` when the check ran and answered something other than `ok`. The
       * main thread decides what the code means for a refusal.
       */
      errcode: number | null;
    };

/**
 * How long to wait on a lock somebody else holds.
 *
 * The figure `index-db/open.ts` and `state/open.ts` use, for their reason: long
 * enough to outlast a writer's ordinary transaction, short enough that a
 * database somebody holds for good is a failure rather than a hang. A `VACUUM
 * INTO` from a WAL database waits for nobody in the ordinary case — readers
 * and a writer share it — so this is paid only on a rollback-journal database
 * mid-write, or while SQLite rebuilds the WAL index.
 */
const BUSY_TIMEOUT_MS = 5000;

/** *"Attempt to write a readonly database"* — the primary code, exactly; see `check`. */
const SQLITE_READONLY = 8;

/** `node:sqlite`'s error, which carries SQLite's result code beside its message. */
function failure(error: unknown): SnapshotTaskOutcome {
  const errcode = (error as { errcode?: unknown } | null)?.errcode;
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    errcode: typeof errcode === 'number' ? errcode : null,
  };
}

function vacuum(source: string, target: string): SnapshotTaskOutcome {
  let db: DatabaseSync | null = null;
  try {
    // Read-only, which is the whole promise the reader makes about somebody
    // else's *data*: it is opened for a copy and for nothing else, and a
    // read-only connection cannot checkpoint or rewrite a page. It is not a
    // promise about the directory — a reader of a WAL database reads through
    // the `-wal` and `-shm` and creates them when they are missing — which is
    // why `sqlite-snapshot.ts` sends a WAL database here only when both are
    // there already. SQLite permits `VACUUM INTO` on a read-only connection;
    // the target is a new database of its own.
    db = new DatabaseSync(source, { readOnly: true });
    db.exec(`pragma busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);
    // Bound rather than spliced into the statement, which SQLite allows for
    // `VACUUM INTO`'s argument. `backup/archive.ts` splices with the quotes
    // doubled, which is correct there; a parameter has nothing to get wrong.
    db.prepare('vacuum into ?').run(target);
    return { ok: true };
  } catch (error) {
    return failure(error);
  } finally {
    db?.close();
  }
}

function check(path: string): SnapshotTaskOutcome {
  let db: DatabaseSync | null = null;
  try {
    // Read-write, because replaying the log *is* a write: SQLite rebuilds the
    // WAL index from the `-wal` beside the file and reads through it. The file
    // is our own private copy, so there is nobody to write over.
    db = new DatabaseSync(path);
    db.exec(`pragma busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);
    const rows = db.prepare('pragma quick_check').all();
    const verdicts = rows.map((row) => String(row['quick_check']));
    if (verdicts.length !== 1 || verdicts[0] !== 'ok') {
      return { ok: false, message: verdicts.slice(0, 3).join('; '), errcode: null };
    }
    /**
     * ***Fold the log into the file, and leave one file.*** Closing the last
     * connection would checkpoint anyway; saying so means the path handed
     * back holds every replayed frame *in itself*, and a reader that opens it
     * read-only later needs no `-shm` and makes no side files. It is what
     * `VACUUM INTO` produces on the other route, so both routes hand the
     * reader the same kind of file.
     *
     * **Only for a copy in WAL mode**, since any other copy is one file
     * already — and **not for a copy SQLite may read and not write** (found at
     * review, 2026-09-29). A header whose file-format write version this
     * SQLite does not know — byte 18 above 2 — opens read-only whatever was
     * asked: SQLite replays the log in memory, reads, checks, and refuses to
     * write. The switch used to fail there as `SQLITE_READONLY`, which the
     * main thread rightly reads as a fault of ours and threw, for a copy the
     * check had just passed. So that one code, from this step, leaves the
     * copy as it lies, log and all: in our scratch, where the reader opens it
     * read-only, which is all it ever does. The extended `READONLY_*` codes
     * are other failures and are still reported.
     */
    const mode = db.prepare('pragma journal_mode').get()?.['journal_mode'];
    if (mode === 'wal') {
      try {
        db.exec('pragma wal_checkpoint(truncate)');
        db.exec('pragma journal_mode = delete');
      } catch (error) {
        if ((error as { errcode?: unknown } | null)?.errcode !== SQLITE_READONLY) throw error;
      }
    }
    return { ok: true };
  } catch (error) {
    return failure(error);
  } finally {
    db?.close();
  }
}

function runTask(task: SnapshotTask): SnapshotTaskOutcome {
  return task.op === 'vacuum' ? vacuum(task.source, task.target) : check(task.path);
}

/**
 * ***Only when started as this worker, with a task.*** Vitest can run a test
 * file on a worker thread of its own, where `isMainThread` is false and
 * `parentPort` is vitest's: a module that posted on import would answer a
 * question vitest never asked. So the task has to be in `workerData`, where
 * only `sqlite-snapshot.ts` puts one.
 */
const handed = (workerData as { snapshotTask?: SnapshotTask } | null)?.snapshotTask;
if (!isMainThread && parentPort !== null && handed !== undefined) {
  parentPort.postMessage(runTask(handed));
}
