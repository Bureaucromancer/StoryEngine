// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RENDITION_SCHEMA, type Rendition } from '@storyengine/shared';

import { ensureDirectory } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import {
  listRenditions,
  readRendition,
  readRenditions,
  renditionsOfTurn,
  renditionsRoot,
  reusableBackdrop,
  sessionAssetsRoot,
  writeRendition,
} from './store.js';

/**
 * The rendition store — [P9.0].
 *
 * **Two claims, and they pull in opposite directions.** A read must never fail a
 * caller, because the transcript walks this store and a session that cannot be
 * opened because one file went bad is the failure `snapshots.ts` refused first.
 * A **write** must fail a caller, because losing a record loses the recipe and
 * [06 §10.7] says a recipe is never discarded. Most of this file is the seam
 * between those two sentences.
 *
 * The third claim is the one [P9 §1.1] is actually about: a record carrying
 * `GeneratedFieldProvenance`'s fields is refused **on read**, where a
 * hand-edited file or an older build's output arrives. `rendition.test.ts` holds
 * the type-level half; this holds the bytes.
 */

const ACCOUNT = 'ned';
const SESSION = 's-1';

let dataDir: string;
let layout: Layout;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-renditions-'));
  layout = new Layout(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function aRendition(over: Partial<Rendition> = {}): Rendition {
  return {
    schema: RENDITION_SCHEMA,
    id: 'r-1',
    sessionId: SESSION,
    turnId: 't-1',
    createdAt: '2026-09-16T10:00:00.000Z',
    kind: 'image',
    purpose: 'illustration',
    scope: null,
    state: 'ready',
    prompt: {
      fragments: [{ id: 'moment', text: 'a lantern', rank: 100, required: true }],
      separator: ', ',
      budget: { maxChars: null, usefulChars: null },
      text: 'a lantern',
      kept: ['moment'],
      dropped: [],
      overCap: false,
    },
    asset: { path: 'r-1.png', mime: 'image/png', bytes: 11, digest: 'sha256:aa' },
    provenance: {
      at: '2026-09-16T10:00:02.000Z',
      binding: { connectionId: 'c-1', modelId: 'sdxl' },
      answeredAs: null,
      seed: 7,
      workflow: { steps: 20 },
    },
    error: null,
    digest: 'd-1',
    ordering: 0,
    ...over,
  };
}

describe('the round trip', () => {
  it('writes and reads a rendition whole', async () => {
    await writeRendition(layout, ACCOUNT, SESSION, aRendition());

    const read = await readRendition(layout, ACCOUNT, SESSION, 'r-1');
    expect(read).toEqual(aRendition());
  });

  it('reads back a pending rendition with its prompt intact', async () => {
    /**
     * **`prompt` is never null, and this is where the shape parts company with
     * [06 §10.1]'s sketch.** A `pending` rendition whose prompt were null would
     * be a record that cannot be re-run, so *the recipe outlives the pixels*
     * would be false during exactly the window in which the pixels do not exist
     * yet — which is the window an interrupted job leaves a record in.
     */
    const pending = aRendition({
      id: 'r-2',
      state: 'pending',
      asset: null,
      provenance: { at: null, binding: null, answeredAs: null, seed: null, workflow: {} },
    });
    await writeRendition(layout, ACCOUNT, SESSION, pending);

    const read = await readRendition(layout, ACCOUNT, SESSION, 'r-2');
    expect(read?.state).toBe('pending');
    expect(read?.asset).toBeNull();
    expect(read?.prompt.text).toBe('a lantern');
  });

  it('lists what it holds in one directory read', async () => {
    await writeRendition(layout, ACCOUNT, SESSION, aRendition({ id: 'r-1' }));
    await writeRendition(layout, ACCOUNT, SESSION, aRendition({ id: 'r-2' }));

    expect(await listRenditions(layout, ACCOUNT, SESSION)).toEqual(new Set(['r-1', 'r-2']));
  });

  it('answers an empty set for a session that has never made one', async () => {
    // `listEntryNames` returns [] on ENOENT, which is what keeps a first read
    // from being a special case every caller has to remember.
    expect(await listRenditions(layout, ACCOUNT, 'never-played')).toEqual(new Set());
  });
});

describe('every read failure is a miss', () => {
  it('misses an id nothing was written under', async () => {
    expect(await readRendition(layout, ACCOUNT, SESSION, 'nope')).toBeNull();
  });

  it('misses an id that does not name a path, rather than throwing', async () => {
    // A rendition id reaches this module from a route parameter as well as from
    // a record, so this is a shape somebody sends on purpose. It 404s, which is
    // what an id that simply did not exist would have done.
    expect(await readRendition(layout, ACCOUNT, SESSION, '../../session')).toBeNull();
  });

  it('misses a file whose id does not match its name', async () => {
    await ensureDirectory(renditionsRoot(layout, ACCOUNT, SESSION));
    await writeFile(
      join(renditionsRoot(layout, ACCOUNT, SESSION), 'r-9.json'),
      JSON.stringify(aRendition({ id: 'r-1' })),
      'utf8',
    );

    // Copied or renamed is refused rather than believed — `readSummary`'s check
    // and `readSnapshot`'s.
    expect(await readRendition(layout, ACCOUNT, SESSION, 'r-9')).toBeNull();
  });

  it('misses a stray file that is not a rendition at all', async () => {
    await ensureDirectory(renditionsRoot(layout, ACCOUNT, SESSION));
    await writeFile(
      join(renditionsRoot(layout, ACCOUNT, SESSION), 'notes.json'),
      '{"hello":"world"}',
      'utf8',
    );

    expect(await readRendition(layout, ACCOUNT, SESSION, 'notes')).toBeNull();
    // And it does not take the set down with it: a listing is names, and a read
    // is what decides whether a name is a rendition.
    expect(await listRenditions(layout, ACCOUNT, SESSION)).toEqual(new Set(['notes']));
    expect(await readRenditions(layout, ACCOUNT, SESSION)).toEqual(new Map());
  });

  it('misses a file that is not JSON', async () => {
    await ensureDirectory(renditionsRoot(layout, ACCOUNT, SESSION));
    await writeFile(join(renditionsRoot(layout, ACCOUNT, SESSION), 'r-3.json'), 'not json', 'utf8');

    expect(await readRendition(layout, ACCOUNT, SESSION, 'r-3')).toBeNull();
  });

  it('keeps one bad file from costing a transcript', async () => {
    await writeRendition(layout, ACCOUNT, SESSION, aRendition({ id: 'r-1' }));
    await ensureDirectory(renditionsRoot(layout, ACCOUNT, SESSION));
    await writeFile(join(renditionsRoot(layout, ACCOUNT, SESSION), 'r-bad.json'), '{', 'utf8');

    // The header's rule at the only place it can be observed: one bad file costs
    // one picture, never a page.
    const all = await readRenditions(layout, ACCOUNT, SESSION);
    expect([...all.keys()]).toEqual(['r-1']);
  });
});

describe('the wrong provenance is refused on read', () => {
  it('refuses a record carrying GeneratedFieldProvenance fields', async () => {
    /**
     * ***[P9 §1.1]'s warning, on bytes.*** *"An implementation would satisfy the
     * type, pass review, and quietly ship a rendition that cannot be
     * reproduced."* The type-level half is a compile error now
     * (`rendition.test.ts`); this is the half that catches a file written by
     * something that never compiled against our types — a hand edit, an older
     * build, an importer somebody wrote.
     *
     * The discriminator is `seed`: a string there is the *prompt an assist ran
     * against*, and a number is the sampling seed §10.7 calls load-bearing.
     */
    await ensureDirectory(renditionsRoot(layout, ACCOUNT, SESSION));
    const wrong = {
      ...aRendition({ id: 'r-4' }),
      provenance: {
        original: 'a lantern',
        at: '2026-09-16T10:00:02.000Z',
        model: 'sdxl',
        seed: 'a lantern on a wet quay',
        unreviewed: true,
      },
    };
    await writeFile(
      join(renditionsRoot(layout, ACCOUNT, SESSION), 'r-4.json'),
      JSON.stringify(wrong),
      'utf8',
    );

    expect(await readRendition(layout, ACCOUNT, SESSION, 'r-4')).toBeNull();
  });

  it('refuses a record with no recipe in it', async () => {
    await ensureDirectory(renditionsRoot(layout, ACCOUNT, SESSION));
    const wrong = { ...aRendition({ id: 'r-5' }), prompt: { text: 'a lantern' } };
    await writeFile(
      join(renditionsRoot(layout, ACCOUNT, SESSION), 'r-5.json'),
      JSON.stringify(wrong),
      'utf8',
    );

    // A prompt with no fragments is an outcome rather than a recipe, and a
    // record that cannot be re-run is the one thing §10.7 forbids.
    expect(await readRendition(layout, ACCOUNT, SESSION, 'r-5')).toBeNull();
  });
});

describe('a write failure reaches the caller', () => {
  it('throws on an id that does not name a path', async () => {
    /**
     * The one place this store parts company with the two it copies.
     * `writeSummary` and `writeSnapshot` return `false` because losing one costs
     * compute; losing a rendition record costs the recipe. The caller is a job
     * worker with a status column, so a throw it catches becomes a failed
     * rendition with a class — which is [06 §10.2]'s answer to every other way
     * this goes wrong.
     */
    await expect(
      writeRendition(layout, ACCOUNT, SESSION, aRendition({ id: '../escape' })),
    ).rejects.toThrow(/does not name a path/);
  });
});

describe('the roots', () => {
  it('resolve inside the session and nowhere else', () => {
    const session = layout.sessionRoot(ACCOUNT, SESSION);
    expect(renditionsRoot(layout, ACCOUNT, SESSION)).toBe(join(session, 'renditions'));
    expect(sessionAssetsRoot(layout, ACCOUNT, SESSION)).toBe(join(session, 'assets'));
  });
});

describe('the renditions of a turn', () => {
  it('come back oldest first', () => {
    const all = new Map([
      ['b', aRendition({ id: 'b', createdAt: '2026-09-16T11:00:00.000Z' })],
      ['a', aRendition({ id: 'a', createdAt: '2026-09-16T10:00:00.000Z' })],
      ['c', aRendition({ id: 'c', turnId: 't-2' })],
    ]);

    // Additive, never replacing ([06 §10.7]), so the order is the order they
    // were made in and a reader can see which came second.
    expect(renditionsOfTurn(all, 't-1').map((one) => one.id)).toEqual(['a', 'b']);
    expect(renditionsOfTurn(all, 't-2').map((one) => one.id)).toEqual(['c']);
    expect(renditionsOfTurn(all, 't-none')).toEqual([]);
  });
});

describe('a backdrop already paid for', () => {
  const backdrops = new Map([
    [
      'bg-old',
      aRendition({
        id: 'bg-old',
        purpose: 'background',
        digest: 'tavern',
        createdAt: '2026-09-16T10:00:00.000Z',
      }),
    ],
    [
      'bg-new',
      aRendition({
        id: 'bg-new',
        purpose: 'background',
        digest: 'tavern',
        createdAt: '2026-09-16T12:00:00.000Z',
      }),
    ],
    ['pic', aRendition({ id: 'pic', purpose: 'illustration', digest: 'tavern' })],
  ]);

  it('resolves to the sibling you chose, not the oldest', () => {
    /**
     * [06 §10.1a]'s clause and the difference between *a* backdrop for the
     * tavern and *the* one you picked for it: a manual regenerate adds a sibling
     * and selects it, so a digest with two renditions behind it has to answer
     * with the selected one.
     */
    expect(reusableBackdrop(backdrops, 'tavern', 'bg-old')?.id).toBe('bg-old');
    expect(reusableBackdrop(backdrops, 'tavern', 'bg-new')?.id).toBe('bg-new');
  });

  it('falls to the newest when nothing is selected', () => {
    // With no selection there is no choice to honour, and the newest is the one
    // a manual *Set the scene* just made. Falling to the oldest would make
    // regenerating a backdrop look like it had done nothing.
    expect(reusableBackdrop(backdrops, 'tavern', null)?.id).toBe('bg-new');
  });

  it('never answers with an illustration, however well its digest matches', () => {
    // `purpose` is the axis lifetimes differ on. An illustration reused as a
    // backdrop would be a picture of a moment shown across fifty turns.
    const onlyPictures = new Map([['pic', backdrops.get('pic')!]]);
    expect(reusableBackdrop(onlyPictures, 'tavern', null)).toBeNull();
  });

  it('never answers with one that has no pixels', () => {
    // A pending one is a job already in flight and a failed one is a
    // placeholder; reusing either would double-dispatch or show nothing, and
    // both read on screen as the feature being broken.
    const inFlight = new Map([
      [
        'bg-p',
        aRendition({ id: 'bg-p', purpose: 'background', digest: 'tavern', state: 'pending' }),
      ],
      [
        'bg-f',
        aRendition({ id: 'bg-f', purpose: 'background', digest: 'tavern', state: 'failed' }),
      ],
    ]);
    expect(reusableBackdrop(inFlight, 'tavern', null)).toBeNull();
  });

  it('misses a place it has not been', () => {
    expect(reusableBackdrop(backdrops, 'the harbour steps', null)).toBeNull();
  });
});
