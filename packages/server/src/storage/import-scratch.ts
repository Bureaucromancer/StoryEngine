// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { join } from 'node:path';

import { uuidv7 } from '@storyengine/shared';

import { ensureDirectory, listEntryNames, removeTree } from './files.js';
import type { Layout } from './layout.js';
import { resolveWithin } from './paths.js';

/**
 * ***Scratch for an import: one directory per use, removed as a whole*** —
 * [P13 §1.3](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * There was no scratch directory before P13. [P12]'s snapshot of the
 * operational store is a single file with a name its writer chose, removed in
 * a `finally` by that name. That does not stretch to what P13 makes: a copy of
 * somebody's SQLite database grows files **SQLite** names — a `-wal` while the
 * log is replayed, a `-shm`, a `-journal` if the journal mode is changed — and
 * a clean-up that has to know every one of those is a clean-up that will miss
 * the one nobody thought of, in a directory whose files are hundreds of
 * megabytes each.
 *
 * So a use takes a **directory**, and letting go of it removes the directory.
 * Whatever anything made inside it goes with it, named or not.
 *
 * ***Two users, one shape.*** `sqlite-snapshot.ts` takes a space for each
 * copy it makes. [P13.8]'s streamed upload takes one to land the upload in,
 * and then hands the space itself to the snapshot as an `owned` input — which
 * is how a file the server already holds reaches the reader without a second
 * copy.
 *
 * ***That departs from the stage text, which should follow.*** P13.1 records
 * the hand-over as *"an amendment to §1.3's `realPath`"*, and it cannot be
 * one: the landing is inside the data directory, and `realPath` refuses the
 * data directory by design — the carve-out that keeps a sweep out of other
 * people's libraries. Widening it for our own scratch would give that
 * carve-out its first exception, in the one method whose answer is handed to
 * something that follows it. So the hand-over is the space itself, as the
 * snapshot's `owned` input, and `realPath` stays a server-path source's alone.
 * The doc has not yet been amended to say so.
 */
export interface ScratchSpace {
  /** The space's own directory, `state/import-scratch/<uuidv7>/`. */
  readonly directory: string;
  /**
   * A path inside the space, through the audited resolver: a name that would
   * climb out, or that no platform can store, throws rather than resolving.
   */
  path(name: string): string;
  /**
   * Removes the directory and everything in it.
   *
   * Safe to call twice, and it throws only when the filesystem refuses —
   * which on Windows is what a SQLite handle somebody forgot to close looks
   * like, and is worth hearing about rather than swallowing. A caller already
   * unwinding from another error should `.catch()` it, as `backup/archive.ts`
   * does with its own snapshot, so the first cause is the one reported; the
   * sweep at the next start is the backstop either way.
   */
  dispose(): Promise<void>;
}

/**
 * A fresh space under {@link Layout.importScratchRoot}.
 *
 * **Named by a UUIDv7** rather than by anything the import knows, because two
 * imports of the same file at once must not share a directory — the second
 * one's clean-up would remove the first one's database from under it — and
 * because a name that sorts by time makes a directory listing of what a crash
 * left readable in the order it happened.
 */
export async function openImportScratch(layout: Layout): Promise<ScratchSpace> {
  const directory = resolveWithin(layout.importScratchRoot, uuidv7());
  await ensureDirectory(directory);
  return {
    directory,
    path: (name) => resolveWithin(directory, name),
    dispose: () => removeTree(directory),
  };
}

/**
 * ***Everything a previous process left in the scratch root, gone*** —
 * [P13 §1.3](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * `dispose` runs in a `finally`, and a `finally` does not run in a process
 * that was killed, lost its container, or ran out of memory half way through
 * inflating somebody's gallery. What it would have removed stays: invisible to
 * every listing, never in an archive, and as large as the database it copied.
 * So the start removes it, which is `sweepAbandonedBackups`' reasoning about a
 * `.part` applied to a whole directory.
 *
 * **Everything, not what looks like ours.** Nothing but this module writes
 * here, and a name it does not recognise is still something only a crash could
 * have left. Called from `buildApp` beside that sweep, after the instance lock
 * is held — never from `buildServices`, which a CLI action runs against a data
 * directory whose server may be mid-import.
 *
 * *`join` rather than `resolveWithin`* for the names, deliberately: they come
 * out of `readdir`, so each is one segment by construction, and the resolver's
 * portability rules — which refuse a name Windows could not store — would turn
 * one oddly named leftover into a sweep that removes nothing.
 */
export async function sweepImportScratch(layout: Layout): Promise<number> {
  const root = layout.importScratchRoot;
  const names = await listEntryNames(root);
  for (const name of names) await removeTree(join(root, name));
  return names.length;
}
