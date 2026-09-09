// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOREBOOK_SCHEMA, newLorebook, type PortableSchemaId } from '@storyengine/shared';

import { SelfWriteRegistry } from '../storage/atomic.js';
import { Layout, type LibraryOwner } from '../storage/layout.js';
import { PathEscapeError } from '../storage/paths.js';
import { listFileErrors, ownerKey } from './ingest.js';
import { listObjects, snapshot } from './query.js';
import { rebuild } from './rebuild.js';
import { makeTestLibrary, type TestLibrary } from './test-library.js';
import { LibraryWatcher } from './watcher.js';

/**
 * **A folder this build will not open, met by both producers — F22, settled at
 * [P6B.1].**
 *
 * The index has two producers and one gate holding them to a single answer: a
 * full rebuild from disk, and the watcher maintaining it live
 * ([03 §5.1](../../../../docs/design/03-data-model.md)). They disagreed about
 * exactly one thing, in opposite directions, for six phases.
 *
 * `resolveWithin` refuses a set of *names* — `con`, `lpt1`, anything ending in
 * a dot or a space — because they are unopenable or mean something else on
 * Windows, and this storage model's whole premise is that a person makes these
 * folders by hand. A rebuild asked the layout to build the path, caught the
 * refusal, and counted a silent skip. The watcher was handed the path by
 * chokidar and parsed it back with `parseObjectPath`, which takes a slug apart
 * without asking whether the slug is one `objectFile` would put back together —
 * so it indexed a row pointing at a file **no read in this build can open**,
 * because every read goes back through `objectFile` and throws.
 *
 * Neither the gate nor any unit test could see it, and both reasons are worth
 * keeping:
 *
 * 1. `snapshot` compared what got indexed. The disagreement was about something
 *    that did *not* get indexed, which lived in a table the comparison never
 *    read. An absence has to be in the comparison or it is not compared.
 * 2. The names cannot be created on the machine this repository is developed
 *    on. `mkdir('con')` fails on Windows and a trailing space is stripped, so a
 *    test that made the folder would be a test that never ran here.
 *
 * So **the layout is the seam**: these subclass it to refuse one ordinary,
 * portable slug. That is deliberate rather than a dodge — *which* names are
 * refused is `paths.test.ts`'s subject and is covered there in detail. What was
 * never tested, and is the whole of the defect, is what the two producers **do**
 * when a name is refused.
 */

/** A layout that refuses one slug, standing in for `con` on a POSIX disk. */
class RefusingLayout extends Layout {
  readonly #refused: string;

  constructor(dataRoot: string, refused: string) {
    super(dataRoot);
    this.#refused = refused;
  }

  override objectFile(owner: LibraryOwner, schemaId: PortableSchemaId, slug: string): string {
    if (slug === this.#refused) {
      throw new PathEscapeError('reserved-device-name', slug);
    }
    return super.objectFile(owner, schemaId, slug);
  }
}

let library: TestLibrary;
let registry: SelfWriteRegistry;

beforeEach(async () => {
  registry = new SelfWriteRegistry();
  library = await makeTestLibrary({ registry });
  await mkdir(library.layout.kindRoot(library.owner, LOREBOOK_SCHEMA), { recursive: true });
});

afterEach(async () => {
  await library.dispose();
});

describe('a rebuild meeting a folder it cannot name', () => {
  it('records it and keeps scanning', async () => {
    // Three books, the refused one sorting in the middle: whichever order
    // `readdir` hands them back, a scan that aborted on the refusal would leave
    // one of the other two unindexed.
    await library.writeObject(newLorebook('Alpha'), 'alpha-book');
    await library.writeObject(newLorebook('Middle'), 'middle-book');
    await library.writeObject(newLorebook('Zeta'), 'zeta-book');

    const refusing = new RefusingLayout(library.layout.dataRoot, 'middle-book');
    const result = await rebuild(library.db, refusing);

    expect(result.scanned).toBe(3);
    expect(result.indexed).toBe(2);
    expect(result.skipped).toBe(1);

    const slugs = listObjects(library.db, { owners: [library.owner] })
      .map((row) => row.slug)
      .sort();
    expect(slugs).toEqual(['alpha-book', 'zeta-book']);

    // The half F22 left undone: the skip used to be a number in a return value
    // nobody stored, which made the folder indistinguishable from a folder that
    // was not there.
    const errors = listFileErrors(library.db, [ownerKey(library.owner)]);
    expect(errors.map((error) => [error.slug, error.reason])).toEqual([
      ['middle-book', 'unusable-name'],
    ]);
    expect(errors[0]?.detail).toContain('reserved-device-name');
  });

  it('does not carry the error into a later rebuild that no longer meets it', async () => {
    await library.writeObject(newLorebook('Middle'), 'middle-book');

    await rebuild(library.db, new RefusingLayout(library.layout.dataRoot, 'middle-book'));
    expect(listFileErrors(library.db, [ownerKey(library.owner)])).toHaveLength(1);

    // A rebuild is what somebody reaches for when they do not trust the index,
    // so it must not preserve anything it finds there — and a `file_error` row
    // is a claim about bytes somebody last looked at, which is exactly the kind
    // of stale belief that outlives the file it describes.
    await rebuild(library.db, library.layout);
    expect(listFileErrors(library.db, [ownerKey(library.owner)])).toEqual([]);
    expect(listObjects(library.db, { owners: [library.owner] })).toHaveLength(1);
  });
});

describe('the watcher meeting the same folder', () => {
  it('refuses it, and lands where a rebuild lands', async () => {
    const refusing = new RefusingLayout(library.layout.dataRoot, 'middle-book');
    const seen: string[] = [];
    const watcher = new LibraryWatcher({
      db: library.db,
      layout: refusing,
      registry,
      stabilityThresholdMs: 20,
      onChange: (event) => seen.push(event.type),
    });
    await watcher.start();

    try {
      await library.writeObject(newLorebook('Middle'), 'middle-book');
      await eventually(async () => {
        await watcher.settled();
        return seen.includes('refused');
      });

      // Before this, the watcher indexed it — a row whose file every read in
      // the build refuses to open.
      expect(listObjects(library.db, { owners: [library.owner] })).toEqual([]);
      const errors = listFileErrors(library.db, [ownerKey(library.owner)]);
      expect(errors.map((error) => [error.slug, error.reason])).toEqual([
        ['middle-book', 'unusable-name'],
      ]);

      /**
       * **The divergence itself, in the gate's own words.** Not two hand-written
       * expectations that happen to agree: the same `snapshot` the P1 gate
       * compares, taken from the live index and then from a full scan of the
       * same disk. Before the fix these differed by an `object` row — and the
       * comparison could not have said so, because `snapshot` did not read
       * `file_error` either.
       */
      const live = snapshot(library.db);
      // Stated on its own, because equality alone would hold just as well if
      // `snapshot` still said nothing about either side's refusals.
      expect(live.some((line) => line.startsWith('file-error |'))).toBe(true);
      await rebuild(library.db, refusing);
      expect(snapshot(library.db)).toEqual(live);
    } finally {
      await watcher.stop();
    }
  });
});

/** Polls until `check` holds, because a filesystem event has no completion. */
async function eventually(check: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('condition never held');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
