// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { LOREBOOK_SCHEMA, newLorebook } from '@storyengine/shared';

import { writeJsonAtomic } from '../storage/atomic.js';
import { Layout, userOwner } from '../storage/layout.js';
import { openIndex } from './open.js';
import { listObjects } from './query.js';
import { LibraryWatcher } from './watcher.js';

/**
 * The child half of `watcher-alias.test.ts` — F26.
 *
 * **A separate process because the failure it guards is `abort()`**, not a
 * throw. Run in-process, an un-normalised 8.3 root takes the whole vitest
 * worker down with it and the run reports *"Worker exited unexpectedly"* with
 * zero failed assertions — which is precisely how this shipped past a green
 * suite for three phases.
 *
 * Named `test-alias-child.ts`: vitest collects `*.test.ts` and not this, while
 * eslint's existing `test-*` category grants it the filesystem access every
 * other piece of test scaffolding here already has — no new hole in the rule
 * that keeps one audited path resolver the only door ([19 §9]).
 */

const root = process.argv[2];
if (root === undefined) throw new Error('usage: alias-child <root>');

const layout = new Layout(root);
const owner = userOwner('ned');
const index = await openIndex({ path: layout.indexFile });
await mkdir(layout.kindRoot(owner, LOREBOOK_SCHEMA), { recursive: true });

const watcher = new LibraryWatcher({
  db: index.db,
  layout,
  stabilityThresholdMs: 20,
  // The events are not the assertion — surviving to report a row is.
  onChange: () => undefined,
});
await watcher.start();

// A foreign write: straight to disk, nothing tells the index. This is the line
// that fires the assert — libuv aborts when it reports the event, not when the
// watch is opened, so a child that only started a watcher would exit 0 and
// prove nothing.
const file = layout.objectFile(owner, LOREBOOK_SCHEMA, 'rain-city');
await mkdir(dirname(file), { recursive: true });
await writeJsonAtomic(file, newLorebook('Rain City'), { suppressWatcher: false });

const deadline = Date.now() + 8000;
while (Date.now() < deadline) {
  await watcher.settled();
  if (listObjects(index.db, { owners: [owner] }).length === 1) {
    console.log('INDEXED');
    await watcher.stop();
    index.db.close();
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

console.log('NOT INDEXED');
await watcher.stop();
index.db.close();
process.exit(1);
