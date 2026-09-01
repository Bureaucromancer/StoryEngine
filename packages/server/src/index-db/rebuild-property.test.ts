// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOREBOOK_SCHEMA, newLorebook, newLoreEntry, type Lorebook } from '@storyengine/shared';

import { SelfWriteRegistry } from '../storage/atomic.js';
import { matureTombstones, TOMBSTONE_TTL_MS } from './ingest.js';
import { snapshot } from './query.js';
import { openIndex } from './open.js';
import { rebuild } from './rebuild.js';
import { makeTestLibrary, type TestLibrary } from './test-library.js';
import { LibraryWatcher } from './watcher.js';
import { sillyTavernFixture } from '../import/fixtures/test-sillytavern.js';
import { MemoryFileSource } from '../import/memory-source.js';
import { sweep } from '../import/sweep.js';

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
  /**
   * **The bookkeeping is per-test, and it was module-scope.**
   *
   * `emptyTheLibrary` clears `ids` between the property's own iterations and
   * nothing cleared it between *tests*, so each fixed example below started
   * holding slugs the randomised run had left behind — against a fresh library
   * that had none of them on disk.
   *
   * That is not cosmetic, because `ids` is what `apply` guards on: `copy`
   * returns early when `ids.has(operation.to)`. So whenever the property's
   * last sequence happened to leave `delta` behind, the fixed example's
   * `copy alpha → delta` **silently did not happen**, and the assertion failed
   * with `delta` missing — which reads exactly like the watcher being late and
   * is nothing of the kind. About one run in eight, and seed-dependent through
   * the property that ran before it.
   */
  ids.clear();
  await mkdir(library.layout.kindRoot(library.owner, LOREBOOK_SCHEMA), { recursive: true });

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
  return library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, slugName);
}

/** The id a slug's object carries, so an edit keeps it and a copy duplicates it. */
const ids = new Map<string, string>();

/**
 * **A book with entries in it, because an empty one proves nothing about the
 * tables P5.2 added.**
 *
 * `newLorebook` sets `entries: []`, and every fixture in this file used it
 * unchanged — so widening `snapshot` to cover `lore_entry` and `lore_entry_fts`
 * would have compared two permanently empty tables and agreed, forever, about
 * nothing. That is §0.4's finding one table deeper: the property was extended
 * over a shape it could not generate.
 *
 * Two entries rather than one, so a `position` that renumbered or collapsed is
 * visible; short, because {@link quiesce} joins the whole snapshot up to sixty
 * times per operation and every character is paid for on each. Derived from the
 * name so an `edit` changes the entry text as well as the book's.
 */
function bookWith(name: string, id?: string): Lorebook {
  const book = newLorebook(name);
  if (id !== undefined) book.id = id;
  return {
    ...book,
    entries: [
      { ...newLoreEntry(`${name} harbour`), id: `${book.id}:0`, content: `${name} cranes` },
      { ...newLoreEntry(`${name} bridge`), id: `${book.id}:1`, keys: [name.toLowerCase()] },
    ],
  };
}

async function apply(operation: Operation): Promise<void> {
  switch (operation.kind) {
    case 'write': {
      const book = bookWith(operation.name);
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
      await writeFile(path, JSON.stringify(bookWith(operation.name, id), null, 2));
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
      // makes a duplicate id, and what the shadowing rule is for. The entries
      // travel too, and that is the half worth stating: a copy that minted
      // fresh entries would be a different book sharing an id, where what a
      // person actually does is duplicate the folder — so the two copies carry
      // the *same* entry ids, which is the case entry rows keyed by path and
      // not by entry id exist to survive.
      const to = fileFor(operation.to);
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, JSON.stringify(bookWith('Copied', id), null, 2));
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
 *
 * **This function was accused of a later flake and acquitted**, which is worth
 * a line because the accusation is the obvious one and it was wrong. The gate
 * went red about one run in eight, at the fixed example asserting a copy is
 * shadowed, and *the copy has not been indexed yet* is exactly what the
 * paragraph above is about — so waiting on the row count as well as on quiet
 * looked like the fix. It was not: with the real cause removed, quiet alone
 * passes twenty runs out of twenty, and the count condition on its own made
 * things worse. See `beforeEach`. Reaching for the timing explanation first is
 * what cost the detour, and the shape of it is worth remembering — the flake
 * was in the harness's *bookkeeping*, not in its waiting.
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

/**
 * Everything on disk, gone, so each case starts from nothing.
 *
 * **The watcher is stopped around it, and that is the whole point.** One watcher
 * serves all twelve cases, and `rm -rf` on the kind root emits an unlink for
 * every file in it. {@link quiesce} cannot wait those out reliably: it returns
 * once the *index* has been still for three samples, and an index that is
 * already empty is still from the first sample — so the teardown's unlinks were
 * free to arrive after the DB was cleared and after the next case had written
 * its first file. Under that ordering an unlink for the *previous* case's
 * `beta/lorebook.json` deletes the row the *current* case just made, and the
 * property fails with an incremental index missing a file the rebuild can see.
 *
 * Which is exactly how it failed: ubuntu CI, seed 352468989, one row in the
 * rebuild and none in the incremental. It reads as index corruption and it was
 * a shared watcher — [12 §4.4](../../../../docs/design/workplan/12-p2-manual-gate.md) named this
 * file as an unsound poll before it ever went red, and this is the sound
 * version rather than a longer sleep.
 *
 * Stopping the watcher discards chokidar's pending state with it, so nothing
 * from one case can reach the next. `ignoreInitial` means the restart re-indexes
 * nothing, so the empty index it starts against is the one it keeps.
 */
async function emptyTheLibrary(): Promise<void> {
  await watcher.stop();

  const kindRoot = library.layout.kindRoot(library.owner, LOREBOOK_SCHEMA);
  await rm(kindRoot, { recursive: true, force: true });
  await mkdir(kindRoot, { recursive: true });
  ids.clear();
  /**
   * **The third hand-maintained list of tables, and the one nothing gates.**
   * `migrations.ts` has `dropAll` and `rebuild.ts` has its own `delete`s;
   * missing a table in either turns a test red. Missing one *here* does
   * something worse: entry rows left behind by the previous iteration become
   * orphans the next one reports, so the gate goes red for a reason that is
   * entirely the harness's — which is the shape of both flakes this file has
   * already had to write up.
   */
  library.db.exec('delete from object');
  library.db.exec('delete from object_fts');
  library.db.exec('delete from lore_entry_fts');
  library.db.exec('delete from lore_entry');

  await watcher.start();
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
        matureTombstones(library.db, library.layout, Date.now() + TOMBSTONE_TTL_MS + 1);

        const incremental = snapshot(library.db);

        /**
         * **Three snapshots, because there are two different claims.**
         *
         * *Rebuild equals incremental* is a claim about two **independent
         * producers** reaching the same answer, and rebuilding in place cannot
         * show it — the second producer inherits the first one's rows. So the
         * comparison that carries it uses a fresh, empty database, which has
         * nothing of the first's state and therefore holds what the *files* say
         * and nothing else.
         *
         * But a fresh database is already empty, so it cannot show the other
         * claim: that `rebuild` **clears what it finds**. Deleting its five
         * `DELETE`s leaves a from-scratch rebuild identical and an in-place one
         * carrying every stale row forward — which is precisely the case those
         * lines exist for, and precisely what an in-place-only comparison
         * (upserting each row onto itself) also could not catch.
         *
         * Neither comparison alone is falsifiable for both. Both together are.
         */
        const fresh = await openIndex({ path: ':memory:' });
        let fromScratch: string[];
        try {
          await rebuild(fresh.db, library.layout);
          fromScratch = snapshot(fresh.db);
        } finally {
          fresh.close();
        }

        await rebuild(library.db, library.layout);
        const inPlace = snapshot(library.db);

        expect(fromScratch).toEqual(incremental);
        expect(inPlace).toEqual(fromScratch);
      }),
      // Small by default: this is the per-PR tier and every case pays the
      // settle window several times over. The nightly tier is where the same
      // property runs at a corpus size that would make this one slow
      // ([testing §6](../../../../docs/design/workplan/10-testing.md)).
      { numRuns: 12 },
    );
  }, 120_000);
});

describe('a row that changes its id releases the one it had', () => {
  it('unshadows the copy left holding the old id', async () => {
    /**
     * **The property found this and could not say what it was**, which is the
     * case for writing it down as an example beside it: it appeared as roughly
     * one full-suite run in five, on a randomised sequence, and a
     * seed-dependent gate is one nobody can act on.
     *
     * The mechanism. Two files may hold one id — a copy is how a person makes
     * that happen — and `resolveDuplicates` picks the winner by portable path,
     * lexicographically first. `ingestFile` calls it with the id it just
     * indexed, and **only** that one. So when a file's id *changes*, the set it
     * left behind is never re-resolved: the survivor keeps the `shadowed` flag
     * it was given when it had company, and there is no longer anybody to be
     * shadowed by.
     *
     * A rebuild cannot reproduce that, because it starts empty and never sees
     * the intermediate state — which is exactly why the two producers disagreed
     * and exactly what the gate exists to catch.
     */
    await apply({ kind: 'write', slug: 'alpha', name: 'Rain City' });
    await quiesce();

    // `delta` now holds `alpha`'s id. `alpha` sorts first, so `delta` shadows.
    await apply({ kind: 'copy', from: 'alpha', to: 'delta' });
    await quiesce();
    expect(shadowedFlags()).toEqual({ alpha: 0, delta: 1 });

    // `alpha` is rewritten with a *fresh* id, so nothing shares `delta`'s any
    // more. `delta` is the only holder and must stop being shadowed.
    await apply({ kind: 'write', slug: 'alpha', name: 'Rain City, revised' });
    await quiesce();

    expect(shadowedFlags(), 'delta holds its id alone and is still shadowed').toEqual({
      alpha: 0,
      delta: 0,
    });

    // And the gate's own claim, stated directly rather than left to the
    // property to stumble on.
    const fresh = await openIndex({ path: ':memory:' });
    try {
      await rebuild(fresh.db, library.layout);
      expect(snapshot(fresh.db)).toEqual(snapshot(library.db));
    } finally {
      fresh.close();
    }
  });
});

/** `{ slug: shadowed }` for the live rows, which is what this is all about. */
function shadowedFlags(): Record<string, number> {
  const rows = library.db
    .prepare('select slug, shadowed from object where tombstoned_at is null order by slug')
    .all() as { slug: string; shadowed: number }[];
  return Object.fromEntries(rows.map((row) => [row.slug, row.shadowed]));
}

describe('a rebuild agrees with the index a bulk import built', () => {
  it('matches, after the fixture corpus is swept in', async () => {
    /**
     * **P4 gate step 9**, which was never run
     * ([P4 §7.3](../../../../docs/design/workplan/06-p4-implementation.md)).
     *
     * The gate calls this *the best stress the [13 §5] assertion will ever get*,
     * and the reason is the shape of what import writes rather than its size. A
     * sweep is the only thing in this system that creates **many objects of many
     * kinds in one burst, through both `create` and `update`, with derived ids,
     * carried assets and a scenario deduplicated across several cards** — a
     * multi-object write where the second object's identity depends on the
     * first's having landed. The property above generates sequences of single
     * writes; it cannot produce that.
     *
     * Fixed rather than randomised, deliberately: the corpus is the fixture, and
     * what is being checked is not *which* sequence but that a real import
     * leaves the two producers agreeing. The randomised property remains the
     * general claim; this is the one case that exercises the writer P4 added.
     */
    const library = await makeTestLibrary();
    try {
      const outcome = await sweep({
        library: { db: library.db, layout: library.layout, keepHistoryPerObject: 10 },
        handle: 'ned',
        files: new MemoryFileSource(sillyTavernFixture()),
      });
      if (!outcome.ok) throw new Error(`the fixture root was refused: ${outcome.refusal}`);
      expect(outcome.report.counts.converted).toBeGreaterThan(2);

      const incremental = snapshot(library.db);
      expect(incremental.length).toBeGreaterThan(2);

      // A second index over the same disk, built the other way — in memory, as
      // the property above does it, because a second `makeTestLibrary` on the
      // same root opens the same index file and the two handles fight over it.
      const fresh = await openIndex({ path: ':memory:' });
      try {
        await rebuild(fresh.db, library.layout);
        expect(snapshot(fresh.db)).toEqual(incremental);
      } finally {
        fresh.close();
      }

      // And in place, which is the remedy a person actually runs.
      await rebuild(library.db, library.layout);
      expect(snapshot(library.db)).toEqual(incremental);
    } finally {
      await library.dispose();
    }
  }, 60_000);
});

describe('a rebuild forgets what the disk no longer has', () => {
  it('drops a row whose file vanished without the index being told', async () => {
    // **What `rebuild`'s five `DELETE`s are for**, and neither half of the
    // property above can show it: a from-scratch rebuild starts empty, and an
    // in-place one over a *consistent* index upserts every row onto itself. The
    // deletes only matter when the index holds something the disk does not
    // justify — which is what a foreign delete the watcher missed leaves behind,
    // and what somebody reaches for a rebuild to fix in the first place.
    const library = await makeTestLibrary();
    try {
      await library.saveObject(bookWith('Rain City'), 'rain-city');
      await library.saveObject(bookWith('Elsewhere'), 'elsewhere');
      expect(objectLines(library.db)).toHaveLength(2);

      // The file goes; nothing tells the index. This is the state a rebuild is
      // the documented remedy for ([02 §5.1]).
      await rm(dirname(library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'elsewhere')), {
        recursive: true,
      });

      await rebuild(library.db, library.layout);

      const after = objectLines(library.db);
      expect(after).toHaveLength(1);
      expect(after[0]).toContain('rain-city');

      /**
       * **And its entries go with it**, which is the half a rebuild's own
       * `DELETE`s are the only thing that can do. Nothing else covers this: the
       * property's two comparisons hold two producers to one answer and a
       * rebuild that kept stale entry rows would simply be *wrong in the same
       * way twice* — the in-place one inherits them and the from-scratch one
       * never had them, so only the case where the disk no longer justifies a
       * row can tell them apart.
       */
      const lore = snapshot(library.db).filter((line) => line.startsWith('lore'));
      expect(lore).not.toHaveLength(0);
      expect(lore.filter((line) => line.includes('elsewhere'))).toEqual([]);
    } finally {
      await library.dispose();
    }
  });
});

/** The object half of a snapshot, for a count that entry rows must not change. */
function objectLines(db: Parameters<typeof snapshot>[0]): string[] {
  return snapshot(db).filter((line) => line.startsWith('object'));
}
