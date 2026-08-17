// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOREBOOK_SCHEMA, newLorebook } from '@storyengine/shared';

import { SelfWriteRegistry } from '../storage/atomic.js';
import { matureTombstones, TOMBSTONE_TTL_MS } from './ingest.js';
import { snapshot } from './query.js';
import { rebuild } from './rebuild.js';
import { makeTestLibrary, type TestLibrary } from './test-library.js';
import { LibraryWatcher } from './watcher.js';

/**
 * **The gate**: a rebuild from disk equals the incrementally maintained index —
 * as a property, over randomised sequences, through the watcher.
 *
 * [work plan P1](../../../../docs/design/workplan/01-work-plan.md) names this as the CI
 * assertion, and P1 shipped three fixed examples instead, two of which called
 * `ingestFile` directly (F11). Both gaps mattered. Fixed examples only cover the
 * sequences someone thought of, and the incremental producer that has to agree
 * with a rebuild is *the watcher* — the code path that decides what an add,
 * a change and an unlink mean, and the one that had the bug the audit found
 * (chokidar delivers add-before-unlink on a rename).
 *
 * Sharper than one producer agreeing with itself: two independent ways of
 * reaching the same index, held to one answer
 * ([02 §5.1.1](../../../../docs/design/02-data-model.md)). Anything order-dependent,
 * time-dependent or half-applied shows up as a difference.
 */

let library: TestLibrary;
let registry: SelfWriteRegistry;
let watcher: LibraryWatcher;

beforeEach(async () => {
  registry = new SelfWriteRegistry();
  library = await makeTestLibrary({ registry });
  await mkdir(library.layout.kindRoot(library.scope, LOREBOOK_SCHEMA), { recursive: true });

  watcher = new LibraryWatcher({
    db: library.db,
    layout: library.layout,
    registry,
    // Short, because this suite runs a sequence per case and the settle window
    // is paid on every step. It is the same window; only its length differs.
    stabilityThresholdMs: 20,
    // The events themselves are not the subject; the index they produce is.
    onChange: () => undefined,
  });
  await watcher.start();
});

afterEach(async () => {
  await watcher.stop();
  await library.dispose();
});

/**
 * One thing a person can do to a library folder, from outside the app.
 *
 * `copy` is here because it is how a duplicate id happens, and the duplicate
 * rule — earliest path wins — is the part most likely to be reached differently
 * by the two producers ([P1 §1.2](../../../../docs/design/workplan/03-p1-implementation.md)).
 */
type Operation =
  | { kind: 'write'; slug: string; name: string }
  | { kind: 'edit'; slug: string; name: string }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'copy'; from: string; to: string }
  | { kind: 'delete'; slug: string };

const SLUGS = ['alpha', 'beta', 'gamma', 'delta'] as const;
const slug = fc.constantFrom(...SLUGS);

const operation: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({
    kind: fc.constant('write' as const),
    slug,
    name: fc.constantFrom('Rain City', 'Neon Harbour', 'The Undercity'),
  }),
  fc.record({
    kind: fc.constant('edit' as const),
    slug,
    name: fc.constantFrom('Rain City, revised', 'Neon Harbour, revised'),
  }),
  fc.record({ kind: fc.constant('rename' as const), from: slug, to: slug }),
  fc.record({ kind: fc.constant('copy' as const), from: slug, to: slug }),
  fc.record({ kind: fc.constant('delete' as const), slug }),
);

function fileFor(slugName: string): string {
  return library.layout.objectFile(library.scope, LOREBOOK_SCHEMA, slugName);
}

/** The id a slug's object carries, so an edit keeps it and a copy duplicates it. */
const ids = new Map<string, string>();

async function apply(operation: Operation): Promise<void> {
  switch (operation.kind) {
    case 'write': {
      const book = newLorebook(operation.name);
      ids.set(operation.slug, book.id);
      const path = fileFor(operation.slug);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(book, null, 2));
      return;
    }
    case 'edit': {
      const path = fileFor(operation.slug);
      const id = ids.get(operation.slug);
      if (id === undefined) return;
      await writeFile(path, JSON.stringify({ ...newLorebook(operation.name), id }, null, 2));
      return;
    }
    case 'rename': {
      if (operation.from === operation.to) return;
      const from = fileFor(operation.from);
      const to = fileFor(operation.to);
      if (!ids.has(operation.from) || ids.has(operation.to)) return;
      await mkdir(dirname(to), { recursive: true });
      if (!(await renameWithRetry(dirname(from), dirname(to)))) return;
      ids.set(operation.to, ids.get(operation.from)!);
      ids.delete(operation.from);
      return;
    }
    case 'copy': {
      if (operation.from === operation.to) return;
      const id = ids.get(operation.from);
      if (id === undefined || ids.has(operation.to)) return;
      // Copied *contents*, so the id travels — which is exactly how a person
      // makes a duplicate id, and what the shadowing rule is for.
      const to = fileFor(operation.to);
      await mkdir(dirname(to), { recursive: true });
      const book = { ...newLorebook('Copied'), id };
      await writeFile(to, JSON.stringify(book, null, 2));
      ids.set(operation.to, id);
      return;
    }
    case 'delete': {
      const path = fileFor(operation.slug);
      if (!ids.has(operation.slug)) return;
      await rm(dirname(path), { recursive: true, force: true });
      ids.delete(operation.slug);
      return;
    }
  }
}

/**
 * Renames a directory the watcher is currently watching.
 *
 * On Windows this transiently fails with EPERM: chokidar opens a handle per
 * watched path, and a rename issued while one is being established loses. It is
 * not a product bug — a rename after the watcher has quiesced succeeds first
 * time, which is what a person with a file manager is doing — but this suite
 * fires operations far faster than a person does, and an unretried rename makes
 * it flaky on the platform the Windows CI job exists to cover.
 *
 * A rename that never lands is treated as an operation that did not happen, so
 * disk and bookkeeping stay in step and the property still means something.
 */
async function renameWithRetry(from: string, to: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(from, to);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      await new Promise((tick) => setTimeout(tick, 50));
    }
  }
  return false;
}

/**
 * Waits until the watcher has finished reacting.
 *
 * `settled()` drains the queue of events chokidar has already emitted, and
 * `awaitWriteFinish` means the interesting one has not been emitted yet — a
 * write that has just landed is still inside its stability window. Draining an
 * empty queue and calling that "caught up" is how this test first failed: the
 * incremental index was empty, the rebuild found the file, and the property
 * looked broken when it was the harness that had not waited.
 *
 * So: quiet for two consecutive rounds, where a round is longer than the
 * window. Bounded, and it fails loudly rather than hanging.
 */
async function quiesce(): Promise<void> {
  let previous = '';
  let stableRounds = 0;

  for (let round = 0; round < 60; round += 1) {
    await new Promise((tick) => setTimeout(tick, 40));
    await watcher.settled();

    const current = snapshot(library.db).join('\n');
    stableRounds = current === previous ? stableRounds + 1 : 0;
    previous = current;
    if (stableRounds >= 2) return;
  }

  throw new Error('The index never stopped changing.');
}

/** Everything on disk, gone, so each case starts from nothing. */
async function emptyTheLibrary(): Promise<void> {
  const kindRoot = library.layout.kindRoot(library.scope, LOREBOOK_SCHEMA);
  await rm(kindRoot, { recursive: true, force: true });
  await mkdir(kindRoot, { recursive: true });
  ids.clear();
  await quiesce();
  library.db.exec('delete from object');
  library.db.exec('delete from object_fts');
}

describe('rebuild equals incremental, as a property', () => {
  it('holds for randomised sequences of writes, edits, renames, copies and deletes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(operation, { minLength: 1, maxLength: 6 }), async (operations) => {
        await emptyTheLibrary();

        for (const step of operations) {
          await apply(step);
          // Each step is absorbed before the next, so the sequence under test
          // is the one that was generated. Interleaving is a different property
          // and needs a different harness to say anything honest about.
          await quiesce();
        }

        // A delete leaves a tombstone that is deliberately not yet an absence:
        // it is how a rename is recognised as a move rather than as a
        // delete-and-create. Mature them, or the incremental index is mid-flight
        // and a rebuild — which has no such concept — is being compared against
        // a state that is still deciding what it is.
        matureTombstones(library.db, Date.now() + TOMBSTONE_TTL_MS + 1);

        const incremental = snapshot(library.db);
        await rebuild(library.db, library.layout);
        const fromDisk = snapshot(library.db);

        expect(fromDisk).toEqual(incremental);
      }),
      // Small by default: this is the per-PR tier and every case pays the
      // settle window several times over. The nightly tier is where the same
      // property runs at a corpus size that would make this one slow
      // ([testing §6](../../../../docs/design/workplan/10-testing.md)).
      { numRuns: 12 },
    );
  }, 120_000);
});
