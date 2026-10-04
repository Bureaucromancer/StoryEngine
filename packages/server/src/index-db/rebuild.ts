// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { LIBRARY_DIRECTORIES, type PortableSchemaId } from '@storyengine/shared';

import {
  listSessions,
  reindexSession,
  type SessionContext,
  sessionStamp,
} from '../sessions/store.js';
import { listDirectoryNames } from '../storage/files.js';
import { type Layout, type LibraryOwner, SYSTEM_OWNER, userOwner } from '../storage/layout.js';
import { PathEscapeError } from '../storage/paths.js';
import { ingestFile, ownerKey, recordUnusableName } from './ingest.js';
import { markRebuildPending, markRebuilt } from './migrations.js';
import { removeSessionRows, writeSessionStamp } from './sessions.js';

/**
 * Full scan from disk — the startup option
 * ([03 §5.1](../../../../docs/design/03-data-model.md)).
 *
 * This is what makes deleting `index.sqlite` a non-event
 * ([22 §5](../../../../docs/design/22-internal-contracts.md)), and it is also half of this
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
  /** Session folders that could not be read, each one skipped rather than fatal. */
  sessionsSkipped: number;
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
  // Before anything is emptied, so a rebuild that does not reach its end is
  // asked for again at the next start rather than trusted (`migrate`).
  markRebuildPending(db);

  db.exec('delete from object');
  db.exec('delete from object_fts');
  db.exec('delete from lore_entry_fts');
  db.exec('delete from lore_entry');
  db.exec('delete from turn_fts');
  db.exec('delete from turn');
  db.exec('delete from session');
  // Cleared for the same reason as the rest, and it took until [P6B.1] to
  // notice: a `file_error` row is a claim about bytes that were on disk when
  // somebody last looked, and the file it names may have been fixed or deleted
  // since. Keeping it across a rebuild is keeping exactly the stale belief a
  // rebuild exists to discard — and every error still true is re-recorded
  // below, because this scan re-reads every object.
  db.exec('delete from file_error');
  /**
   * ***And the links*** (2026-09-27). The scan below rewrites every link that
   * is still true, and it only ever writes: an edge from an id no longer on
   * disk — a setup or a session deleted while the server was down — survived
   * every rebuild, so the one remedy for an index nobody trusts could not
   * repair *used by*. The migration path was spared only because it drops the
   * table.
   */
  db.exec('delete from object_link');
  // And what the last look saw, since this is a new look.
  db.exec('delete from session_stamp');

  const result: RebuildResult = {
    scanned: 0,
    indexed: 0,
    skipped: 0,
    sessions: 0,
    turns: 0,
    sessionsSkipped: 0,
  };

  for (const owner of await libraryOwners(layout)) {
    for (const schemaId of Object.keys(LIBRARY_DIRECTORIES) as PortableSchemaId[]) {
      const kindRoot = layout.kindRoot(owner, schemaId);
      for (const slug of await listDirectoryNames(kindRoot)) {
        result.scanned += 1;

        // A folder whose *name* this build refuses — `con`, a trailing space —
        // is one skipped object, not the end of the scan (F22). The names are
        // legal on the filesystem that produced them, and hand-made folders are
        // the point of this storage model, so a rebuild that aborted on one
        // would leave the whole library unindexed because of a single
        // directory.
        //
        // **It is recorded rather than merely counted** — [P6B.1]. The skip
        // used to be silent, and its only trace was a number in a return value
        // nobody stored, so the folder was indistinguishable from a folder that
        // was not there. That is the same complaint F20 answered for a file
        // that will not parse, and it takes the same answer: a `file_error`
        // row. The watcher now applies this rule too, through the same
        // function, so the two producers can no longer disagree about it.
        let objectFile: string;
        try {
          objectFile = layout.objectFile(owner, schemaId, slug);
        } catch (error) {
          if (!(error instanceof PathEscapeError)) throw error;
          recordUnusableName(db, layout, owner, schemaId, slug, error, now);
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
    // plays a turn ([22 §5]).
    if (owner.kind === 'user') {
      const found = await rebuildSessions(db, layout, owner.handle);
      result.sessions += found.sessions;
      result.turns += found.turns;
      result.sessionsSkipped += found.skipped;
    }
  }

  markRebuilt(db);
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
): Promise<{ sessions: number; turns: number; skipped: number }> {
  let sessions = 0;
  let turns = 0;
  let skipped = 0;

  for (const sessionId of await listSessions({ layout, index: db }, handle)) {
    const derived = await deriveSession(db, layout, handle, sessionId);
    if (derived.kind === 'indexed') {
      sessions += 1;
      turns += derived.turns;
    } else if (derived.kind === 'unreadable') {
      skipped += 1;
    }
  }

  return { sessions, turns, skipped };
}

export type DerivedSession =
  { kind: 'indexed'; turns: number } | { kind: 'not-a-session' } | { kind: 'unreadable' };

/**
 * ***One session's rows, and the record of what they were derived from***
 * (2026-09-27) — the rebuild's step, and the start-up check's.
 *
 * The stamp is taken before anything is read (`sessionStamp` says why), and
 * written once the rows are, so the next start's check can tell this session
 * has not changed since.
 *
 * ***One folder that cannot be read is one session skipped***, which is the
 * posture the objects take and `listSessionFiles` takes for the session list.
 * A `session.json` linked out of the data directory, one a root-owned copy left
 * unreadable, or a folder whose name the layout refuses used to throw out of
 * the whole scan, and a start that needed a rebuild then did not start. **Its
 * rows go**, which a rebuild never had anyway and the check has to do: a
 * session nothing can open is not one search should find, and with no stamp
 * left, the next start tries it again. A folder that is no session at all
 * keeps a stamp and no rows, so it is not read again until it changes.
 */
export async function deriveSession(
  db: DatabaseSync,
  layout: Layout,
  handle: string,
  sessionId: string,
): Promise<DerivedSession> {
  const context: SessionContext = { layout, index: db };
  const owner = ownerKey(userOwner(handle));
  try {
    const stamp = await sessionStamp(context, handle, sessionId);
    if (stamp === null) {
      removeSessionRows(db, sessionId);
      return { kind: 'not-a-session' };
    }

    const found = await reindexSession(context, handle, sessionId);
    // In this order, because clearing a session's rows clears its stamp.
    if (found === null) removeSessionRows(db, sessionId);
    writeSessionStamp(db, sessionId, owner, stamp);
    return found === null ? { kind: 'not-a-session' } : { kind: 'indexed', turns: found.turns };
  } catch {
    removeSessionRows(db, sessionId);
    return { kind: 'unreadable' };
  }
}

/**
 * Every library on disk: the system one, and one per user directory.
 *
 * Read from the filesystem rather than from `accounts.json`, because a rebuild
 * has to reflect what is *there*. A directory belonging to an account that was
 * removed still holds somebody's files, and an index that silently omitted them
 * would make the library look emptier than the disk is.
 */
export async function libraryOwners(layout: Layout): Promise<LibraryOwner[]> {
  return [SYSTEM_OWNER, ...(await layout.userHandlesOnDisk()).map((handle) => userOwner(handle))];
}
