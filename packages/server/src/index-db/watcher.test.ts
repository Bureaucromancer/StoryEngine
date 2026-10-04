// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { NodeFsHandler } from 'chokidar/handler.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LOREBOOK_SCHEMA,
  newActor,
  newLorebook,
  newTreatment,
  TREATMENT_SCHEMA,
} from '@storyengine/shared';

import { SelfWriteRegistry } from '../storage/atomic.js';
import { listVersions, readVersionPayload } from '../storage/history.js';
import { listFileErrors, ownerKey } from './ingest.js';
import { findById, listObjects } from './query.js';
import { makeTestLibrary, type TestLibrary } from './test-library.js';
import { LibraryWatcher, type WatcherOptions, type WatchEvent } from './watcher.js';

/**
 * The watcher, driven by real filesystem events.
 *
 * Slower than the rest of the suite and worth it: **this is the path the P1
 * demo's central gesture runs through** — hand-edit a file on disk, watch the
 * change appear without a restart. [10 §4.1](../../../../docs/design/10-ui-surfaces.md) is
 * blunt about the stakes: *if editing a file on disk does not reflect, the
 * storage design has already failed on its own terms.* Testing the ingest
 * function alone would leave the half that actually notices untested.
 */

let library: TestLibrary;
let registry: SelfWriteRegistry;
let watcher: LibraryWatcher;
let events: WatchEvent[];
/**
 * The watcher's own options object, kept so a test can change a setting
 * *underneath* a running watcher — which is what a live config reload does.
 */
let options: WatcherOptions;

beforeEach(async () => {
  registry = new SelfWriteRegistry();
  library = await makeTestLibrary({ registry });
  events = [];

  // The library root must exist before chokidar starts, or the first write
  // creates the tree and the events arrive as directory adds.
  await mkdir(library.layout.kindRoot(library.owner, LOREBOOK_SCHEMA), { recursive: true });

  options = {
    db: library.db,
    layout: library.layout,
    registry,
    stabilityThresholdMs: 20,
    onChange: (event) => events.push(event),
  };
  watcher = new LibraryWatcher(options);
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

/**
 * Waits for a condition, because filesystem events are not synchronous.
 *
 * The check may be async: `watcher.settled()` drains the *event* queue, which
 * is not the same as every file the handler touched having been rewritten — so
 * a condition that has to read one back needs to be able to await.
 */
async function eventually(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await watcher.settled();
    if (await check()) return;
    await new Promise((tick) => setTimeout(tick, 25));
  }
  await watcher.settled();
  expect(await check(), `condition never held. Events: ${JSON.stringify(events)}`).toBe(true);
}

describe('a hand edit on disk reflects without a restart', () => {
  it('indexes a foreign create', async () => {
    const path = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'rain-city');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(newLorebook('Rain City')));

    await eventually(() => listObjects(library.db, { owners: [library.owner] }).length === 1);
    expect(listObjects(library.db, { owners: [library.owner] })[0]?.name).toBe('Rain City');
  });

  it('reflects a foreign edit to a file it already knows', async () => {
    // The demo, precisely: change the title in a text editor, save, and see it.
    const book = newLorebook('Rain City');
    const path = await library.saveObject(book, 'rain-city');
    await seenBy(path);

    await writeFile(path, JSON.stringify({ ...book, name: 'Rain City, after the fire' }));

    await eventually(
      () =>
        listObjects(library.db, { owners: [library.owner] })[0]?.name ===
        'Rain City, after the fire',
    );
  });

  it('removes an object deleted on disk', async () => {
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    await seenBy(path);
    await rm(dirname(path), { recursive: true });

    await eventually(() => listObjects(library.db, { owners: [library.owner] }).length === 0);
  });
});

/**
 * ***A folder made while its parent was still being looked at*** — 2026-09-27,
 * and the reason `patches/chokidar@5.0.0.patch` exists.
 *
 * chokidar met a new directory by **reading it, then watching it**. Anything
 * made inside it between the two was in neither the listing nor any event, and
 * a *folder* made there was never watched at all, so nothing written under it
 * was ever seen: not the next hand edit, not any after it, until a restart's
 * reconcile. A file made there was only late, since the directory's own watch
 * reports its next change. That is what `cp -r` or a checkout into the
 * library does, a tree created faster than it is discovered, and it was gate
 * step 16's intermittent timeout: `users/ned/library` was being read when the
 * first save made `lorebooks/` inside it.
 *
 * **The gap is forced rather than hoped for.** The directory's first read is
 * wrapped so the tree is made after the read has finished and before
 * `_handleDir` goes on. Unpatched, that is exactly the moment the watch did not
 * exist yet; patched, the watch came first and hears it.
 */
describe('a folder made while its parent is still being read', () => {
  it('is watched, and a new object inside it is indexed', async () => {
    const file = library.layout.objectFile(library.owner, TREATMENT_SCHEMA, 'harbour-job');
    const made = dirname(file);
    const parent = dirname(made);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- held to be put back, and only ever called with `.call(this, …)`
    const original = NodeFsHandler.prototype._handleRead;
    let forced = false;
    NodeFsHandler.prototype._handleRead = function (directory, ...rest) {
      const read = original.call(this, directory, ...rest);
      if (forced || join(directory, '') !== join(parent, '')) return read;
      forced = true;
      return (async () => {
        await read;
        await mkdir(made);
        await writeFile(file, JSON.stringify(newTreatment('The Harbour Job')));
      })();
    };

    try {
      await mkdir(parent);
      await eventually(() => forced);
      await eventually(() =>
        listObjects(library.db, { owners: [library.owner] }).some(
          (row) => row.name === 'The Harbour Job',
        ),
      );
    } finally {
      NodeFsHandler.prototype._handleRead = original;
    }
  });
});

describe("the watcher never watches the engine's own state", () => {
  it('produces no events for the index, the state store, accounts or config', async () => {
    // The pre-closeout predicate compared mixed path separators and never
    // matched on Windows — the development platform — so every SQLite write
    // fed the event queue (P2 Appendix A, F4). Ignored means *no event at
    // all*, so a real object write is the fence that proves the junk writes
    // had their chance to surface.
    await mkdir(library.layout.indexRoot, { recursive: true });
    await mkdir(library.layout.stateRoot, { recursive: true });
    await writeFile(join(library.layout.indexRoot, 'index.sqlite-wal'), 'not for the watcher');
    await writeFile(join(library.layout.stateRoot, 'state.sqlite'), 'not for the watcher');
    await writeFile(library.layout.accountsFile, '{"accounts": []}');
    await writeFile(library.layout.configFile, '{}');

    const fence = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'rain-city');
    await mkdir(dirname(fence), { recursive: true });
    await writeFile(fence, JSON.stringify(newLorebook('Rain City')));
    await seenBy(fence);

    const engineOwned = [
      library.layout.indexRoot,
      library.layout.stateRoot,
      library.layout.accountsFile,
      library.layout.configFile,
    ];
    const leaked = events.filter((event) =>
      engineOwned.some((root) => event.path.startsWith(root)),
    );
    expect(leaked).toEqual([]);
  });
});

describe('the watcher ignores its own writes', () => {
  it('suppresses a write the application made', async () => {
    // Atomic writes are temp-then-rename, so chokidar reports an add and an
    // unlink for every save. Without suppression the index does every job twice
    // ([03 §5.1.1](../../../../docs/design/03-data-model.md)).
    await library.saveObject(newLorebook('Rain City'), 'rain-city');

    await eventually(() => events.some((event) => event.type === 'suppressed'));
    expect(events.filter((event) => event.type === 'indexed')).toHaveLength(0);
    expect(listObjects(library.db, { owners: [library.owner] })).toHaveLength(1);
  });

  it('still notices a foreign write to a file it wrote itself', async () => {
    // The reason the token is (path, mtime, size) and is consumed on match: our
    // own write must not swallow somebody else's change to the same file.
    const book = newLorebook('Rain City');
    const path = await library.saveObject(book, 'rain-city');
    await eventually(() => events.some((event) => event.type === 'suppressed'));

    await writeFile(path, JSON.stringify({ ...book, name: 'Edited by hand' }));

    await eventually(
      () => listObjects(library.db, { owners: [library.owner] })[0]?.name === 'Edited by hand',
    );
  });

  it('ignores files that are not library objects', async () => {
    const assets = library.layout.assetsRoot(library.owner, LOREBOOK_SCHEMA, 'rain-city');
    await mkdir(assets, { recursive: true });
    await writeFile(`${assets}/map.png`, 'not an object');

    await eventually(() => events.some((event) => event.path.endsWith('map.png')));
    expect(events.find((event) => event.path.endsWith('map.png'))?.type).toBe('ignored');
    expect(listObjects(library.db, { owners: [library.owner] })).toHaveLength(0);
  });
});

describe('a hand edit leaves history behind', () => {
  // [03 §11.2]: hand-edits get history for free, which is a promise a
  // database-backed history structurally cannot make — and the strongest
  // argument for building the mechanism in P1, while the watcher exists and no
  // editor does.
  /**
   * **The retention cap is read when a snapshot is taken, not when the watcher
   * was built** — [P2A §2.5].
   *
   * `history.keepPerObject` is tiered `live` ([22 §4]), and the watcher used to
   * copy it into a private field at construction — so on a running server the
   * routes' write path and the watcher's could be trimming one object's history
   * to two different depths, and a change to the setting reached neither. The
   * app now hands the watcher the same `LibraryContext` the routes use, and
   * `applyLiveConfig` assigns into that object.
   *
   * Driven here by mutating the options object the watcher was constructed
   * with, which is precisely what the fan-out does one layer up.
   *
   * The mutation this catches: reading a field captured in the constructor
   * instead of `this.#options` — three edits then leave three versions, because
   * the cap the watcher trims against is still the default.
   */
  it('trims against the retention cap as it is now, not as it was at construction', async () => {
    const book = newLorebook('Rain City');
    const path = await library.saveObject(book, 'rain-city');
    await seenBy(path);

    // The live change. One object, assigned into — a config reload, in miniature.
    options.keepHistoryPerObject = 1;

    for (const name of ['after the fire', 'after the rain', 'after the bells']) {
      await writeFile(path, JSON.stringify({ ...book, name: `Rain City, ${name}` }));
      await eventually(
        () =>
          listObjects(library.db, { owners: [library.owner] })[0]?.name === `Rain City, ${name}`,
      );
    }

    /**
     * **Settled on content, not asserted on a count the moment the index moves.**
     *
     * `handle()` calls `ingestFile` *before* `snapshotReplaced`, so the instant
     * an edit's name is queryable its history entry is still being written. The
     * loop above proves each edit was *seen*, not that its snapshot has landed,
     * and asserting the count here read two under full-suite load.
     *
     * Waiting for `length === 1` alone would be worse than racy — one version is
     * also what an *ignored* cap leaves after the first edit, so the condition
     * would be satisfied before the second and third edits had happened. What is
     * true only when the third snapshot has landed and the cap was honoured is
     * the pair: one surviving version, and its payload being the state the third
     * edit replaced.
     */
    await eventually(async () => {
      const versions = await listVersions(dirname(path));
      if (versions.length !== 1) return false;
      const kept = (await readVersionPayload(dirname(path), versions[0]!.digest)) as {
        name: string;
      };
      return kept.name === 'Rain City, after the rain';
    });
  });

  it('snapshots the replaced state with an external source', async () => {
    const book = newLorebook('Rain City');
    const path = await library.saveObject(book, 'rain-city');
    await seenBy(path);

    await writeFile(path, JSON.stringify({ ...book, name: 'Rain City, after the fire' }));
    await eventually(
      () =>
        listObjects(library.db, { owners: [library.owner] })[0]?.name ===
        'Rain City, after the fire',
    );

    const versions = await listVersions(dirname(path));
    expect(versions).toHaveLength(1);
    expect(versions[0]?.source).toEqual({ kind: 'external' });
    // The snapshot is the state *before* the hand edit.
    const payload = (await import('../storage/history.js')).readVersionPayload;
    const snapshotted = (await payload(dirname(path), versions[0]!.digest)) as { name: string };
    expect(snapshotted.name).toBe('Rain City');
  });

  it('snapshots the last good state when a hand edit breaks the file', async () => {
    // Exactly the person the last good state is being kept for: someone whose
    // text editor saved half a JSON file.
    const book = newLorebook('Rain City');
    const path = await library.saveObject(book, 'rain-city');
    await seenBy(path);

    await writeFile(path, '{ "name": "Rain City", truncated');
    await eventually(() =>
      events.some((event) => event.path === path && event.type !== 'suppressed'),
    );

    const versions = await listVersions(dirname(path));
    expect(versions).toHaveLength(1);
    expect(versions[0]?.source).toEqual({ kind: 'external' });
  });

  it('records nothing for a move', async () => {
    // A rename is the same content at a new path — not an edit, and a history
    // entry for it would be noise.
    const book = newLorebook('Rain City');
    const from = await library.saveObject(book, 'rain-city');
    await seenBy(from);

    const to = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'rain-city-noir');
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    await eventually(() => findById(library.db, book.id)?.path === to);

    expect(await listVersions(dirname(to))).toHaveLength(0);
  });
});

describe('a file that cannot be read says so', () => {
  // F20. The skip was correct and silent, which for the one gesture this design
  // is built around — open the file, edit it, save — is the wrong half of the
  // trade: the user gets no error, no toast and a stale object, and the only
  // record of what happened was a return value the caller discarded.

  it('surfaces a broken hand edit as a path-scoped error, and clears it when fixed', async () => {
    const book = newLorebook('Rain City');
    const path = await library.saveObject(book, 'rain-city');
    await seenBy(path);

    await writeFile(path, '{ "name": "Rain City", truncated');
    await eventually(() => listFileErrors(library.db, [ownerKey(library.owner)]).length === 1);

    const [error] = listFileErrors(library.db, [ownerKey(library.owner)]);
    expect(error?.path).toBe(path);
    expect(error?.reason).toBe('unparsable');
    expect(error?.slug).toBe('rain-city');
    // The detail is the parser's own complaint, which is the only thing anyone
    // can act on — "invalid" alone does not find the missing brace.
    expect(error?.detail).toBeTruthy();

    // And the last good row is still there: the object did not disappear from
    // the library because its file briefly stopped being JSON.
    expect(findById(library.db, book.id)?.name).toBe('Rain City');

    await writeFile(path, JSON.stringify({ ...book, name: 'Rain City, repaired' }));
    await eventually(() => listFileErrors(library.db, [ownerKey(library.owner)]).length === 0);
    expect(findById(library.db, book.id)?.name).toBe('Rain City, repaired');
  });

  it('clears the error when the broken file is deleted rather than fixed', async () => {
    // The other way out, and the one that would otherwise leave a permanent
    // complaint about a file that no longer exists.
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    await seenBy(path);

    await writeFile(path, 'not json at all');
    await eventually(() => listFileErrors(library.db, [ownerKey(library.owner)]).length === 1);

    await rm(dirname(path), { recursive: true });
    await eventually(() => listFileErrors(library.db, [ownerKey(library.owner)]).length === 0);
  });

  it('reports a file whose contents are valid JSON but not the kind it sits in', async () => {
    // Distinct from unparsable, and worth its own reason: the file is fine, it
    // is in the wrong folder — which is a mistake a person makes by dragging.
    const path = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'misfiled');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ ...newActor('Vera'), schema: 'storyengine.actor/1' }));

    await eventually(() => listFileErrors(library.db, [ownerKey(library.owner)]).length === 1);
    expect(listFileErrors(library.db, [ownerKey(library.owner)])[0]?.reason).toBe('wrong-kind');
  });
});

describe('a foreign rename through the watcher', () => {
  it('is a move, and the row keeps its id', async () => {
    // The end-to-end form of [P1 §1.1](../../../../docs/design/workplan/07-p1-implementation.md).
    // Renaming a folder in a file manager reaches the watcher as an unlink and
    // an add with nothing connecting them, and the tombstone is what connects
    // them — including across the ordering chokidar happens to deliver.
    const book = newLorebook('Rain City');
    const from = await library.saveObject(book, 'rain-city');
    await seenBy(from);

    const to = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'rain-city-noir');
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);

    await eventually(() => findById(library.db, book.id)?.path === to);

    expect(listObjects(library.db, { owners: [library.owner] })).toHaveLength(1);
    expect(findById(library.db, book.id)?.slug).toBe('rain-city-noir');
  });
});

/**
 * **A watcher on an aliased root still indexes** — F26, and the quiet half of it.
 *
 * The loud half is a native `abort()` that CI found on Windows. This is the one
 * that does not crash: point the root at a link and chokidar reports the
 * *target's* paths while the layout holds the *link's*, so `isContained` fails,
 * `parseObjectPath` returns null, and every event is filed as `ignored`. The
 * watcher runs, reports healthy, and indexes nothing — which is
 * [10 §4.1](../../../../docs/design/10-ui-surfaces.md)'s central gesture failing silently.
 *
 * A separate watcher rather than the shared one, because the root has to differ.
 * Runs on both platforms: `junction` is ignored on POSIX, where Node makes an
 * ordinary symlink instead, so this is the leg that gives the Linux CI job real
 * teeth rather than a skip.
 *
 * *`followSymlinks: false` is untouched by this* (F1) — that governs links found
 * *inside* the tree, and the root is not inside itself.
 */

/**
 * **A file somebody broke by hand is said out loud** — F34.
 *
 * The index recorded it and `GET /api/library/errors` exposed it, and nothing
 * logged it while no client read the route — so a hand-edit that failed to
 * parse was invisible to the person who made it *and* invisible afterwards.
 * [manual gate §2.1](../../../../docs/design/workplan/11-p2-manual-gate.md) step 8 tells a tester to do
 * exactly this, which is how it would have been met.
 *
 * The card is [P2 §4] step 7 and still unbuilt; this is the half that makes
 * the failure findable rather than the half that makes it visible.
 */
it('says so when a hand-edited file cannot be read', async () => {
  const lines: Record<string, unknown>[] = [];
  const write = (object: Record<string, unknown>) => lines.push(object);
  watcher.setLogger({
    child: () => ({ child: () => null as never, info: write, warn: write, error: write }),
    info: write,
    warn: write,
    error: write,
  });

  const path = await library.writeObject(newLorebook('Rain City'), 'rain-city');
  await seenBy(path);
  await writeFile(path, '{ not json at all');
  await eventually(async () => {
    await watcher.settled();
    return lines.some((line) => line['event'] === 'library.invalid');
  });

  const line = lines.find((entry) => entry['event'] === 'library.invalid');
  // Relative to the data root, which is what [22 §4.1] requires of a path in
  // a log — the log is the thing people paste into issues.
  expect(String(line?.['path'])).not.toContain(library.layout.dataRoot);
  expect(String(line?.['path'])).toContain('rain-city');
});

describe('a root reached through a link', () => {
  it('still notices a hand edit', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'se-link-'));
    const target = join(outer, 'real-root');
    const link = join(outer, 'root-via-link');
    await mkdir(target, { recursive: true });
    await symlink(target, link, 'junction');

    const aliased = await makeTestLibrary({ registry, root: link });
    const seen: WatchEvent[] = [];
    const linked = new LibraryWatcher({
      db: aliased.db,
      layout: aliased.layout,
      registry,
      stabilityThresholdMs: 20,
      onChange: (event) => seen.push(event),
    });
    await mkdir(aliased.layout.kindRoot(aliased.owner, LOREBOOK_SCHEMA), { recursive: true });
    await linked.start();

    try {
      await aliased.writeObject(newLorebook('Rain City'), 'rain-city');
      await eventually(async () => {
        await linked.settled();
        return listObjects(aliased.db, { owners: [aliased.owner] }).length === 1;
      });

      // Not merely "an event arrived": an event arrived and was *understood*.
      // Unfixed, `seen` fills with `ignored` and the index stays empty.
      expect(seen.every((event) => event.type === 'ignored')).toBe(false);
    } finally {
      await linked.stop();
      await aliased.dispose();
      await rm(outer, { recursive: true, force: true });
    }
  });
});

/**
 * ***One event's failure is that event's, and is said*** (2026-09-27).
 *
 * The queue ran the next event whether or not the last one failed, and left
 * the failure as a rejected promise nothing handled until the next event came.
 * Node's default for that is to end the process. So a card saved as a link to
 * a file outside the data directory, a file a scanner held locked, or a full
 * disk during the snapshot took the whole server down, and after the restart
 * the edit was never looked at again, because the watcher does not replay
 * what it has already seen. Unfixed, the first of these fails the run on an
 * unhandled rejection before any assertion is reached.
 */
describe('an event the watcher cannot handle', () => {
  function capture(): Record<string, unknown>[] {
    const lines: Record<string, unknown>[] = [];
    const write = (object: Record<string, unknown>) => lines.push(object);
    watcher.setLogger({
      child: () => ({ child: () => null as never, info: write, warn: write, error: write }),
      info: write,
      warn: write,
      error: write,
    });
    return lines;
  }

  it('is logged, and the next event is still handled', async () => {
    const lines = capture();
    // An observer that throws on the first event is the handler failing, the
    // way a locked file or a full disk fails it, on every platform.
    let thrown = false;
    const unsubscribe = watcher.observe(() => {
      if (thrown) return;
      thrown = true;
      throw new Error('no space left on device');
    });

    try {
      const first = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'rain-city');
      await mkdir(dirname(first), { recursive: true });
      await writeFile(first, JSON.stringify(newLorebook('Rain City')));
      await eventually(() => lines.some((line) => line['event'] === 'watcher.failed'));

      const second = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'the-harbour');
      await mkdir(dirname(second), { recursive: true });
      await writeFile(second, JSON.stringify(newLorebook('The Harbour')));
      await eventually(() =>
        listObjects(library.db, { owners: [library.owner] }).some(
          (row) => row.name === 'The Harbour',
        ),
      );
    } finally {
      unsubscribe();
    }
  });

  // A file link needs privileges on Windows. The code under test is the same
  // on both platforms, and the first test above holds the queue on both.
  it.skipIf(process.platform === 'win32')(
    'refuses a file that links out of the data directory, and says which',
    async () => {
      const lines = capture();
      const outside = await mkdtemp(join(tmpdir(), 'se-watched-outside-'));
      try {
        const target = join(outside, 'lorebook.json');
        await writeFile(target, JSON.stringify(newLorebook('Not Yours')));
        const linked = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'not-yours');
        await mkdir(dirname(linked), { recursive: true });
        await symlink(target, linked);

        await eventually(() =>
          events.some((event) => event.path === linked && event.type === 'refused'),
        );
        const line = lines.find((entry) => entry['event'] === 'library.refused');
        expect(String(line?.['path'])).toContain('not-yours');
        expect(listObjects(library.db, { owners: [library.owner] })).toEqual([]);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    },
  );
});
