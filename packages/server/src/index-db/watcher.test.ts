// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOREBOOK_SCHEMA, newLorebook } from '@storyengine/shared';

import { SelfWriteRegistry } from '../storage/atomic.js';
import { findById, listObjects } from './query.js';
import { makeTestLibrary, type TestLibrary } from './test-library.js';
import { LibraryWatcher, type WatchEvent } from './watcher.js';

/**
 * The watcher, driven by real filesystem events.
 *
 * Slower than the rest of the suite and worth it: **this is the path the P1
 * demo's central gesture runs through** — hand-edit a file on disk, watch the
 * change appear without a restart. [05 §4.1](docs/design/05-ui-surfaces.md) is
 * blunt about the stakes: *if editing a file on disk does not reflect, the
 * storage design has already failed on its own terms.* Testing the ingest
 * function alone would leave the half that actually notices untested.
 */

let library: TestLibrary;
let registry: SelfWriteRegistry;
let watcher: LibraryWatcher;
let events: WatchEvent[];

beforeEach(async () => {
  registry = new SelfWriteRegistry();
  library = await makeTestLibrary({ registry });
  events = [];

  // The library root must exist before chokidar starts, or the first write
  // creates the tree and the events arrive as directory adds.
  await mkdir(library.layout.kindRoot(library.scope, LOREBOOK_SCHEMA), { recursive: true });

  watcher = new LibraryWatcher({
    db: library.db,
    layout: library.layout,
    registry,
    stabilityThresholdMs: 20,
    onChange: (event) => events.push(event),
  });
  await watcher.start();
});

afterEach(async () => {
  await watcher.stop();
  await library.dispose();
});

/**
 * Waits until the watcher has *seen* a path.
 *
 * Necessary before mutating a file the application just wrote, and the reason
 * is a chokidar behaviour rather than ours: `awaitWriteFinish` holds an add
 * until the file has been quiet for the stability threshold, and a file that is
 * renamed or deleted inside that window produces **no events at all** — the
 * pending add is cancelled and an unlink for a file chokidar never announced is
 * never announced either. Waiting on the index instead would prove nothing,
 * because the application's own writes are indexed synchronously and the row is
 * there before the watcher has drawn breath.
 */
async function seenBy(path: string, timeoutMs = 4000): Promise<void> {
  await eventually(() => events.some((event) => event.path === path), timeoutMs);
}

/** Waits for a condition, because filesystem events are not synchronous. */
async function eventually(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await watcher.settled();
    if (check()) return;
    await new Promise((tick) => setTimeout(tick, 25));
  }
  await watcher.settled();
  expect(check(), `condition never held. Events: ${JSON.stringify(events)}`).toBe(true);
}

describe('a hand edit on disk reflects without a restart', () => {
  it('indexes a foreign create', async () => {
    const path = library.layout.objectFile(library.scope, LOREBOOK_SCHEMA, 'rain-city');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(newLorebook('Rain City')));

    await eventually(() => listObjects(library.db, { scopes: [library.scope] }).length === 1);
    expect(listObjects(library.db, { scopes: [library.scope] })[0]?.name).toBe('Rain City');
  });

  it('reflects a foreign edit to a file it already knows', async () => {
    // The demo, precisely: change the title in a text editor, save, and see it.
    const book = newLorebook('Rain City');
    const path = await library.saveObject(book, 'rain-city');
    await seenBy(path);

    await writeFile(path, JSON.stringify({ ...book, name: 'Rain City, after the fire' }));

    await eventually(
      () =>
        listObjects(library.db, { scopes: [library.scope] })[0]?.name ===
        'Rain City, after the fire',
    );
  });

  it('removes an object deleted on disk', async () => {
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    await seenBy(path);
    await rm(dirname(path), { recursive: true });

    await eventually(() => listObjects(library.db, { scopes: [library.scope] }).length === 0);
  });
});

describe('the watcher ignores its own writes', () => {
  it('suppresses a write the application made', async () => {
    // Atomic writes are temp-then-rename, so chokidar reports an add and an
    // unlink for every save. Without suppression the index does every job twice
    // ([02 §5.1.1](docs/design/02-data-model.md)).
    await library.saveObject(newLorebook('Rain City'), 'rain-city');

    await eventually(() => events.some((event) => event.type === 'suppressed'));
    expect(events.filter((event) => event.type === 'indexed')).toHaveLength(0);
    expect(listObjects(library.db, { scopes: [library.scope] })).toHaveLength(1);
  });

  it('still notices a foreign write to a file it wrote itself', async () => {
    // The reason the token is (path, mtime, size) and is consumed on match: our
    // own write must not swallow somebody else's change to the same file.
    const book = newLorebook('Rain City');
    const path = await library.saveObject(book, 'rain-city');
    await eventually(() => events.some((event) => event.type === 'suppressed'));

    await writeFile(path, JSON.stringify({ ...book, name: 'Edited by hand' }));

    await eventually(
      () => listObjects(library.db, { scopes: [library.scope] })[0]?.name === 'Edited by hand',
    );
  });

  it('ignores files that are not library objects', async () => {
    const assets = library.layout.assetsRoot(library.scope, LOREBOOK_SCHEMA, 'rain-city');
    await mkdir(assets, { recursive: true });
    await writeFile(`${assets}/map.png`, 'not an object');

    await eventually(() => events.some((event) => event.path.endsWith('map.png')));
    expect(events.find((event) => event.path.endsWith('map.png'))?.type).toBe('ignored');
    expect(listObjects(library.db, { scopes: [library.scope] })).toHaveLength(0);
  });
});

describe('a foreign rename through the watcher', () => {
  it('is a move, and the row keeps its id', async () => {
    // The end-to-end form of [19 §1.1](docs/design/19-p1-implementation.md).
    // Renaming a folder in a file manager reaches the watcher as an unlink and
    // an add with nothing connecting them, and the tombstone is what connects
    // them — including across the ordering chokidar happens to deliver.
    const book = newLorebook('Rain City');
    const from = await library.saveObject(book, 'rain-city');
    await seenBy(from);

    const to = library.layout.objectFile(library.scope, LOREBOOK_SCHEMA, 'rain-city-noir');
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);

    await eventually(() => findById(library.db, book.id)?.path === to);

    expect(listObjects(library.db, { scopes: [library.scope] })).toHaveLength(1);
    expect(findById(library.db, book.id)?.slug).toBe('rain-city-noir');
  });
});
