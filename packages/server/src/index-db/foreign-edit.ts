// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import { snapshotReplaced } from '../storage/history.js';
import type { Layout, ParsedObjectPath } from '../storage/layout.js';
import { ingestFile, type IngestOutcome } from './ingest.js';
import { findByPath } from './query.js';

/**
 * ***A change nobody made through the app, taken in*** — [03 §5.1.1], [03 §11.2].
 *
 * Two callers and one rule. The watcher calls this for a change it sees happen.
 * The start-up check (2026-09-27) calls it for one made while nothing was
 * watching ([03 §5.1](../../../../docs/design/03-data-model.md)). Both re-read the
 * file, and both keep the version it replaced in the object's history when its
 * content changed. *Hand-edits get history for free* is a promise about the
 * edit, and somebody who edits a file with the server stopped has made the same
 * edit as somebody who edits it with the server running.
 *
 * The rule lived in the watcher alone until the check needed it. Lifted out
 * rather than copied, because a second copy of a rule eventually disagrees with
 * the first. What stays in the watcher is what only a live event has: the probe,
 * the name rule it applies on the way in, suppressing the server's own writes,
 * and the event it emits.
 */
export async function takeInForeignEdit(input: {
  db: DatabaseSync;
  layout: Layout;
  parsed: ParsedObjectPath;
  /** The history cap, read at the point of use for `history.keepPerObject`'s tier. */
  keepPerObject: number;
  now?: number;
}): Promise<IngestOutcome> {
  const { db, layout, parsed } = input;

  // The state the edit is replacing, read *before* the index moves on.
  const previous = findByPath(db, parsed.path);
  const outcome = await ingestFile(db, layout, parsed.path, input.now);

  // **Hand-edits get history for free** ([03 §11.2]), which is the strongest
  // argument for having built the mechanism while the watcher existed and no
  // editor did. Snapshot when the content really changed, and also when the new
  // content failed to parse at all: somebody breaking a file in a text editor is
  // exactly the person the last good state is being kept for. A move is neither
  // (same content, new path) and records nothing, and neither does a refusal.
  // `recordVersion` writes nothing when the newest version already holds this
  // state, which is what keeps a file that stays broken across several starts
  // from being recorded at each of them.
  const changed =
    outcome.kind === 'indexed'
      ? outcome.row.contentHash !== previous?.contentHash
      : outcome.reason === 'invalid';
  if (previous && changed) {
    await snapshotReplaced({
      objectRoot: layout.objectRoot(parsed.owner, parsed.schemaId, parsed.slug),
      payload: previous.body,
      source: { kind: 'external' },
      reason: '',
      keepPerObject: input.keepPerObject,
    });
  }

  return outcome;
}
