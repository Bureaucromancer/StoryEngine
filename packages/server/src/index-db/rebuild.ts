// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { LIBRARY_DIRECTORIES, type PortableSchemaId } from '@storyengine/shared';

import { readAllTurns } from '../sessions/segments.js';
import { listSessions, readSession, type SessionContext } from '../sessions/store.js';
import { listDirectoryNames } from '../storage/files.js';
import { type Layout, type LibraryOwner, SYSTEM_OWNER, userOwner } from '../storage/layout.js';
import { PathEscapeError, resolveWithin } from '../storage/paths.js';
import { ingestFile } from './ingest.js';
import { indexSession, indexTurn } from './sessions.js';

/**
 * Full scan from disk — the startup option
 * ([02 §5.1](../../../../docs/design/02-data-model.md)).
 *
 * This is what makes deleting `index.sqlite` a non-event
 * ([13 §5](../../../../docs/design/13-internal-contracts.md)), and it is also half of this
 * phase's CI gate: **rebuild-from-disk equals the incrementally maintained
 * index**. Two producers held to one answer is a sharper assertion than one
 * producer agreeing with itself, and it is the reason the duplicate-id rule is
 * path order rather than anything time-dependent — a full scan and a live
 * session have to reach the same winner.
 */

export interface RebuildResult {
  scanned: number;
  indexed: number;
  skipped: number;
  /** Sessions found, with their turns. Counted separately; they are a different kind. */
  sessions: number;
  turns: number;
}

/**
 * Empties the index and repopulates it from the data directory.
 *
 * Deliberately not incremental-with-checks. A rebuild is what someone reaches
 * for when they do not trust the index, so it must not preserve anything it
 * finds there — including tombstones, which describe an in-flight rename that
 * by definition is not in flight any more.
 */
export async function rebuild(
  db: DatabaseSync,
  layout: Layout,
  now: number = Date.now(),
): Promise<RebuildResult> {
  db.exec('delete from object');
  db.exec('delete from object_fts');
  db.exec('delete from lore_entry_fts');
  db.exec('delete from lore_entry');
  db.exec('delete from turn_fts');
  db.exec('delete from turn');
  db.exec('delete from session');

  const result: RebuildResult = { scanned: 0, indexed: 0, skipped: 0, sessions: 0, turns: 0 };

  for (const owner of await owners(layout)) {
    for (const schemaId of Object.keys(LIBRARY_DIRECTORIES) as PortableSchemaId[]) {
      const kindRoot = layout.kindRoot(owner, schemaId);
      for (const slug of await listDirectoryNames(kindRoot)) {
        result.scanned += 1;

        // A folder whose *name* this build refuses — `con`, a trailing space —
        // is one skipped object, not the end of the scan (F22). The names are
        // legal on the filesystem that produced them, and hand-made folders are
        // the point of this storage model, so a rebuild that aborted on one
        // would leave the whole library unindexed because of a single
        // directory. The watcher does index these, and reconciling that
        // asymmetry is P2.7's, beside F20's invalid-file state — both are the
        // same question of how the index represents something it cannot open.
        let objectFile: string;
        try {
          objectFile = layout.objectFile(owner, schemaId, slug);
        } catch (error) {
          if (!(error instanceof PathEscapeError)) throw error;
          result.skipped += 1;
          continue;
        }

        const outcome = await ingestFile(db, layout, objectFile, now);
        if (outcome.kind === 'indexed') result.indexed += 1;
        else result.skipped += 1;
      }
    }

    // Sessions are a user's, never the system's — and a rebuild has to cover
    // them or *rebuild equals incremental* stops being true the moment anyone
    // plays a turn ([13 §5]).
    if (owner.kind === 'user') {
      const found = await rebuildSessions(db, layout, owner.handle);
      result.sessions += found.sessions;
      result.turns += found.turns;
    }
  }

  return result;
}

/**
 * Re-derives one user's session rows from their folders.
 *
 * A session whose `session.json` will not parse is skipped, and deliberately
 * *not* recorded as a file error: `file_error` is keyed by the library's
 * `(owner, kind, slug)` shape and a session has none of those. Making that table
 * carry two shapes to save a skip is the wrong trade — a broken session file is
 * P2.6's surface to report, when there is one.
 */
async function rebuildSessions(
  db: DatabaseSync,
  layout: Layout,
  handle: string,
): Promise<{ sessions: number; turns: number }> {
  const context: SessionContext = { layout, index: db };
  let sessions = 0;
  let turns = 0;

  for (const sessionId of await listSessions(context, handle)) {
    const session = await readSession(context, handle, sessionId);
    if (session === null) continue;

    indexSession(db, `user:${handle}`, session);
    sessions += 1;

    // The cold read, which is exactly what this is: every turn in creation
    // order with the location the index is supposed to hold.
    for (const { turn, location } of await readAllTurns(
      resolveWithin(layout.sessionRoot(handle, sessionId), 'turns'),
    )) {
      indexTurn(db, turn, location);
      turns += 1;
    }
  }

  return { sessions, turns };
}

/**
 * Every library on disk: the system one, and one per user directory.
 *
 * Read from the filesystem rather than from `accounts.json`, because a rebuild
 * has to reflect what is *there*. A directory belonging to an account that was
 * removed still holds somebody's files, and an index that silently omitted them
 * would make the library look emptier than the disk is.
 */
async function owners(layout: Layout): Promise<LibraryOwner[]> {
  const found: LibraryOwner[] = [SYSTEM_OWNER];
  for (const handle of await listDirectoryNames(layout.usersRoot)) {
    try {
      found.push(userOwner(handle));
    } catch {
      // A directory under `users/` that is not a valid handle. Not ours.
    }
  }
  return found;
}
