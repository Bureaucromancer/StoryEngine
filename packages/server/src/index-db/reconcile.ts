// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { LIBRARY_DIRECTORIES, type PortableSchemaId } from '@storyengine/shared';

import { listSessions, sessionStamp } from '../sessions/store.js';
import { type FileFacts, listDirectoryNames, statFile } from '../storage/files.js';
import { type Layout, userOwner } from '../storage/layout.js';
import { PathEscapeError } from '../storage/paths.js';
import { takeInForeignEdit } from './foreign-edit.js';
import {
  clearFileError,
  forgetFile,
  matureTombstones,
  ownerKey,
  recordUnusableName,
} from './ingest.js';
import { deriveSession, libraryOwners } from './rebuild.js';
import { indexedSessionIds, readSessionStamps, removeSessionRows } from './sessions.js';

/**
 * ***The start-up consistency check*** (2026-09-27) —
 * [03 §5.1](../../../../docs/design/03-data-model.md).
 *
 * §5.1 names three mitigations for the index and the disk drifting apart:
 * atomic replace, *"a startup consistency check (mtime/size against recorded
 * values) with automatic re-index of anything that does not match"*, and the
 * two writers of §5.1.1. The first and third were built at P1. The second never
 * was, though §5.1.1 leans on it (*"that is what the startup consistency check
 * above is for"*). A start that did not rebuild looked at nothing, and the
 * watcher starts with `ignoreInitial`, so:
 *
 * - a file edited while the server was stopped was served at its old content
 *   until it happened to change again;
 * - a file added was missing from lists and search, and one deleted was still
 *   listed, still counted in *used by*, and a 404 when opened;
 * - a crash between a write and its index update, which is the case §5.1.1
 *   names, stayed diverged;
 * - sessions, which the watcher never looks at, never caught up at all: a
 *   session folder copied in, or a turn appended just before a crash, was
 *   unsearchable for as long as the index lived.
 *
 * **Objects** are compared on the size and modification time their row already
 * records. A new file, a changed one, or one with an error on record (an error
 * row has no size to compare, and a file can be fixed by a `chmod` that changes
 * neither) is read again through the watcher's own path. So an edit made with
 * the server stopped gets the history version one made with it running gets. A
 * row whose file has gone is forgotten outright, since nothing is left to
 * complete a rename (`forgetFile`).
 *
 * **Sessions** are compared on a stamp over the files their rows come from
 * (`sessionStamp`), recorded by the rebuild and by this, and a session whose
 * stamp differs is derived again whole, the rebuild's way (`deriveSession`).
 *
 * **What it has to equal is a rebuild.** Everything here is either skipped
 * because the recorded values say nothing changed, or done by the function a
 * rebuild would use on the same file. The test holds the two to one answer
 * over randomised edits made while nothing was watching.
 *
 * *What it does not cover.* A file rewritten to the same length within one
 * tick of the filesystem's clock, or given back its old time by hand, is not
 * seen. That is the limit of the check §5.1 chose, and `make` and `rsync` share
 * it; `index.rebuildOnStart` is the remedy for somebody who doubts it. And the
 * check runs before the watcher starts, as a rebuild does, so an edit made in
 * the seconds between the two is seen at the next start rather than this one.
 * The other order would let the watcher and the check ingest one file at once,
 * and the older read could land last.
 */

export interface ReconcileResult {
  /** Object files found on disk. */
  scanned: number;
  /** Of those, the ones read again: new, changed, or with an error on record. */
  reread: number;
  /** Paths the index had rows or errors for that are no longer on disk. */
  forgotten: number;
  /** Sessions whose files had changed since the last look, derived again. */
  sessions: number;
  /** Sessions the index still described, whose folder had gone. */
  sessionsForgotten: number;
  /** Session folders that could not be read, whose rows were dropped. */
  sessionsSkipped: number;
  /**
   * Library files this found it could not read that were not already
   * recorded as such, by portable path: a file broken while the server was
   * stopped, for the start-up log to say what the watcher would have said.
   */
  broken: string[];
}

export async function reconcileIndex(
  db: DatabaseSync,
  layout: Layout,
  options: { keepHistoryPerObject: number; now?: number },
): Promise<ReconcileResult> {
  const now = options.now ?? Date.now();
  const result: ReconcileResult = {
    scanned: 0,
    reread: 0,
    forgotten: 0,
    sessions: 0,
    sessionsForgotten: 0,
    sessionsSkipped: 0,
    broken: [],
  };

  // A rename the last process was in the middle of has had its window.
  matureTombstones(db, layout, now);

  const recorded = new Map(
    (
      db.prepare('select path, mtime_ms, size, tombstoned_at from object').all() as {
        path: string;
        mtime_ms: number;
        size: number;
        tombstoned_at: number | null;
      }[]
    ).map((row) => [row.path, row]),
  );
  const erred = new Set(
    (db.prepare('select path from file_error').all() as { path: string }[]).map((row) => row.path),
  );
  /** Every object file, and every refused folder, that is on disk now. */
  const present = new Set<string>();

  for (const owner of await libraryOwners(layout)) {
    for (const schemaId of Object.keys(LIBRARY_DIRECTORIES) as PortableSchemaId[]) {
      // Every folder the kind is read from, the legacy one included, for the
      // rebuild's reason ([P16 §1.1]) and with a sharper edge here: a row this
      // check did not find on disk is forgotten below, so walking only
      // `worlds/` would forget every Package made before P16.0 at the first
      // start after the upgrade.
      for (const kindRoot of layout.kindRoots(owner, schemaId)) {
        for (const slug of await listDirectoryNames(kindRoot)) {
          let candidates: string[];
          try {
            // The name rule, asked of the builder every other path into a
            // folder goes through — the watcher's way, so the two producers
            // refuse the same names ([P6B.1]) — and then the files this folder
            // could hold, which for a legacy one are not where `objectFile` points.
            layout.objectFile(owner, schemaId, slug);
            candidates = layout.objectFilesIn(kindRoot, schemaId, slug);
          } catch (error) {
            // The rebuild's rule for a folder whose name this build refuses,
            // through the same function, and its row stays while the folder does.
            if (!(error instanceof PathEscapeError)) throw error;
            recordUnusableName(db, layout, owner, schemaId, slug, error, now, kindRoot);
            present.add(join(kindRoot, slug));
            continue;
          }

          // A World's folder may hold its current name, its old one, or — the
          // move stopped between its two renames — both; each is its own file
          // and is checked as one.
          for (const path of candidates) {
            // A stat that fails for any reason but absence is a file to read,
            // and the read records why it could not be.
            let facts: FileFacts | null | 'unknown';
            try {
              facts = await statFile(path);
            } catch {
              facts = 'unknown';
            }
            // A folder with no object file in it holds nothing to index, and
            // whatever the index held for the path is forgotten below.
            if (facts === null) continue;
            present.add(path);
            result.scanned += 1;

            // A live row whose recorded size and time are the file's, and no
            // error on record: nothing to read.
            const row = recorded.get(path);
            const unchanged =
              facts !== 'unknown' &&
              row?.tombstoned_at === null &&
              row.mtime_ms === facts.mtimeMs &&
              row.size === facts.size;
            if (unchanged && !erred.has(path)) continue;

            result.reread += 1;
            const outcome = await takeInForeignEdit({
              db,
              layout,
              parsed: layout.parseObjectPath(path) ?? { owner, schemaId, slug, path },
              keepPerObject: options.keepHistoryPerObject,
              now,
            });
            if (
              outcome.kind === 'skipped' &&
              (outcome.reason === 'invalid' || outcome.reason === 'refused') &&
              !erred.has(path)
            ) {
              result.broken.push(layout.portablePath(path) ?? path);
            }
          }
        }
      }
    }
  }

  // After the scan, so a rename's new path has been read first and has taken
  // the old row with it as a vanished duplicate: the move is a move.
  for (const path of recorded.keys()) {
    if (!present.has(path) && forgetFile(db, layout, path)) result.forgotten += 1;
  }
  for (const path of erred) {
    if (!present.has(path) && clearFileError(db, path)) result.forgotten += 1;
  }

  await reconcileSessions(db, layout, result);
  return result;
}

async function reconcileSessions(
  db: DatabaseSync,
  layout: Layout,
  result: ReconcileResult,
): Promise<void> {
  const stamps = readSessionStamps(db);
  const onDisk = new Set<string>();

  for (const handle of await layout.userHandlesOnDisk()) {
    const owner = ownerKey(userOwner(handle));
    for (const sessionId of await listSessions({ layout, index: db }, handle)) {
      onDisk.add(sessionId);

      // Compared on the stamp *and* the account, because moving a folder from
      // one account to another keeps every file's size and time.
      const last = stamps.get(sessionId);
      if (last?.owner === owner) {
        let stamp: string | null;
        try {
          stamp = await sessionStamp({ layout, index: db }, handle, sessionId);
        } catch {
          stamp = null;
        }
        if (stamp === last.stamp) continue;
      }

      const derived = await deriveSession(db, layout, handle, sessionId);
      if (derived.kind === 'indexed') result.sessions += 1;
      else if (derived.kind === 'unreadable') result.sessionsSkipped += 1;
    }
  }

  // Everything the index describes whose folder is not on disk under any
  // account: deleted, or moved away, while nothing was watching.
  for (const sessionId of indexedSessionIds(db)) {
    if (onDisk.has(sessionId)) continue;
    removeSessionRows(db, sessionId);
    result.sessionsForgotten += 1;
  }
}
