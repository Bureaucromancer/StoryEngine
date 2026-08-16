// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { LIBRARY_DIRECTORIES, type PortableSchemaId } from '@storyengine/shared';

import { listDirectoryNames } from '../storage/files.js';
import { type Layout, type LibraryScope, SYSTEM_SCOPE, userScope } from '../storage/layout.js';
import { ingestFile } from './ingest.js';

/**
 * Full scan from disk — the startup option
 * ([02 §5.1](docs/design/02-data-model.md)).
 *
 * This is what makes deleting `index.sqlite` a non-event
 * ([18 §5](docs/design/18-internal-contracts.md)), and it is also half of this
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

  const result: RebuildResult = { scanned: 0, indexed: 0, skipped: 0 };

  for (const scope of await scopes(layout)) {
    for (const schemaId of Object.keys(LIBRARY_DIRECTORIES) as PortableSchemaId[]) {
      const kindRoot = layout.kindRoot(scope, schemaId);
      for (const slug of await listDirectoryNames(kindRoot)) {
        result.scanned += 1;
        const outcome = await ingestFile(db, layout, layout.objectFile(scope, schemaId, slug), now);
        if (outcome.kind === 'indexed') result.indexed += 1;
        else result.skipped += 1;
      }
    }
  }

  return result;
}

/**
 * Every library on disk: the system one, and one per user directory.
 *
 * Read from the filesystem rather than from `accounts.json`, because a rebuild
 * has to reflect what is *there*. A directory belonging to an account that was
 * removed still holds somebody's files, and an index that silently omitted them
 * would make the library look emptier than the disk is.
 */
async function scopes(layout: Layout): Promise<LibraryScope[]> {
  const found: LibraryScope[] = [SYSTEM_SCOPE];
  for (const handle of await listDirectoryNames(layout.usersRoot)) {
    try {
      found.push(userScope(handle));
    } catch {
      // A directory under `users/` that is not a valid handle. Not ours.
    }
  }
  return found;
}
