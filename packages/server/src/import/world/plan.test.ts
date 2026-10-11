// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  LOREBOOK_SCHEMA,
  newActor,
  newLorebook,
  newTreatment,
  newWorld,
  PRESET_SCHEMA,
  type Provenance,
  TREATMENT_SCHEMA,
  WORLD_SCHEMA,
  type World,
} from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contentHashOf } from '../../index-db/ingest.js';
import { create, list, read, remove, update } from '../../library.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import type { ConflictPolicy } from '../identity.js';
import { arrivalKey, asLanded, type ArrivalObject, planArrivals } from './plan.js';

/**
 * ***One test per row of the identity table*** —
 * [P16.3e](../../../../../docs/design/workplan/35-p16-world.md), [P16.3]'s plan
 * §2. Each row is asked against a real library on a real install, because the
 * question each one answers — *who holds this id* — is a question about the
 * install, not about the file.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

const library = () => server.services.library;

function object(
  body: { id: string; schema: string; [field: string]: unknown },
  contentHash?: string,
): ArrivalObject {
  return {
    id: body.id,
    schemaId: body.schema as ArrivalObject['schemaId'],
    body: structuredClone(body),
    ...(contentHash === undefined ? {} : { contentHash }),
  };
}

function plan(objects: ArrivalObject[], handle: string, policy: ConflictPolicy = 'replace') {
  return planArrivals(objects, { library: library(), handle, policy, tags: null });
}

describe('the identity table', () => {
  it('here: this account holds the id in the same kind — it lands as itself', async () => {
    const book = newLorebook('Harbour');
    await create(library(), 'ned', book, LOREBOOK_SCHEMA);

    const planned = await plan([object(book)], 'ned');

    expect(planned.byFileId.get(book.id)).toEqual({
      landedId: book.id,
      decision: 'here',
      keptBoth: false,
      local: { source: 'manual', originalFilename: null, tagging: { tags: [] } },
    });
  });

  it('here, keep-both: a copy under a fresh id only when the file’s differs', async () => {
    const same = newLorebook('Same');
    const differs = newLorebook('Differs');
    await create(library(), 'ned', same, LOREBOOK_SCHEMA);
    await create(library(), 'ned', differs, LOREBOOK_SCHEMA);

    const planned = await plan(
      [object(same), object({ ...differs, description: 'Not what is here.' })],
      'ned',
      'keep-both',
    );

    expect(planned.byFileId.get(same.id)).toMatchObject({ landedId: same.id, keptBoth: false });
    const copy = planned.byFileId.get(differs.id);
    expect(copy).toMatchObject({ decision: 'here', keptBoth: true });
    expect(copy?.landedId).not.toBe(differs.id);
  });

  it('prior: this account landed the id from a World file before — that object', async () => {
    const theirs = newLorebook('Harbour');
    const earlier = {
      ...newLorebook('Harbour'),
      provenance: {
        ...theirs.provenance,
        source: 'import' as const,
        originalFilename: arrivalKey(theirs.id),
      },
    };
    await create(library(), 'amy', earlier, LOREBOOK_SCHEMA);

    const planned = await plan([object(theirs)], 'amy');

    expect(planned.byFileId.get(theirs.id)).toEqual({
      landedId: earlier.id,
      decision: 'prior',
      keptBoth: false,
      local: { source: 'import', originalFilename: arrivalKey(theirs.id), tagging: { tags: [] } },
    });
  });

  it('system: the built-in library’s own, unchanged — not written, the same id', async () => {
    const system = list(library(), 'ned', PRESET_SCHEMA).find((row) => row.owner === 'system');
    if (system === undefined) throw new Error('the test server ships no system preset');

    const planned = await plan([object(system.body as never, system.contentHash)], 'ned');

    expect(planned.byFileId.get(system.id)).toMatchObject({
      landedId: system.id,
      decision: 'system',
    });
  });

  it('system, changed: a copy of its own — the built-in one is read-only and the id is taken', async () => {
    const system = list(library(), 'ned', PRESET_SCHEMA).find((row) => row.owner === 'system');
    if (system === undefined) throw new Error('the test server ships no system preset');
    const changed = { ...(system.body as object), blurb: 'Tuned by somebody else.' } as never;

    const planned = await plan([object(changed, contentHashOf(new Uint8Array([1])))], 'ned');

    const arrival = planned.byFileId.get(system.id);
    expect(arrival?.decision).toBe('remint');
    expect(arrival?.landedId).not.toBe(system.id);
  });

  it('remint: another account holds the id — a fresh one, never theirs', async () => {
    const book = newLorebook('Harbour');
    await create(library(), 'ned', book, LOREBOOK_SCHEMA);

    const planned = await plan([object(book)], 'amy');

    const arrival = planned.byFileId.get(book.id);
    expect(arrival).toMatchObject({ decision: 'remint', keptBoth: false, local: null });
    expect(arrival?.landedId).not.toBe(book.id);
    expect(planned.ids.get(book.id)).toBe(arrival?.landedId);
  });

  it('remint: this account holds the id as another kind', async () => {
    const book = newLorebook('Harbour');
    await create(library(), 'ned', book, LOREBOOK_SCHEMA);
    const treatment = { ...newTreatment('Harbour'), id: book.id };

    const planned = await plan([object(treatment)], 'ned');

    expect(planned.byFileId.get(book.id)?.decision).toBe('remint');
  });

  it('new: nothing holds the id — it lands as itself', async () => {
    const book = newLorebook('Harbour');

    const planned = await plan([object(book)], 'amy');

    expect(planned.byFileId.get(book.id)).toEqual({
      landedId: book.id,
      decision: 'new',
      keptBoth: false,
      local: null,
    });
  });

  /**
   * ***A re-mint is never reported per object*** — so the body a re-mint and a
   * new arrival land with differ only in the id: both stamped as arrivals
   * under the file's id, neither saying which ids exist elsewhere.
   */
  it('stamps new and remint alike, and copies the local account of origin for here', async () => {
    const held = newLorebook('Held');
    await create(library(), 'ned', held, LOREBOOK_SCHEMA);
    const fresh = newLorebook('Fresh');

    const planned = await plan([object(held), object(fresh)], 'amy');

    for (const one of [held, fresh]) {
      const arrival = planned.byFileId.get(one.id);
      if (arrival === undefined) throw new Error('not planned');
      const { body } = asLanded(object(one), arrival, planned.ids, null);
      expect((body['provenance'] as Provenance).source).toBe('import');
      expect((body['provenance'] as Provenance).originalFilename).toBe(arrivalKey(one.id));
      expect(body['id']).toBe(arrival.landedId);
    }

    const mine = await plan(
      [object({ ...held, provenance: { ...held.provenance, source: 'generated' } })],
      'ned',
    );
    const arrival = mine.byFileId.get(held.id);
    if (arrival === undefined) throw new Error('not planned');
    const { body } = asLanded(
      object({ ...held, provenance: { ...held.provenance, source: 'generated' } }),
      arrival,
      mine.ids,
      null,
    );
    expect((body['provenance'] as Provenance).source).toBe('manual');
    expect((body['provenance'] as Provenance).originalFilename).toBeNull();
  });

  /**
   * ***Tags are the account's own*** (the P16.3e review): an arrival whose tag
   * ids this registry does not all hold lands un-adopted — no `tagIds`, its
   * names the truth — never with the two parallel arrays out of step; and one
   * that holds them all keeps them.
   */
  it('lands a new object un-adopted when the registry lacks a tag id, saying which', async () => {
    const book = {
      ...newLorebook('Harbour'),
      tags: ['Here', 'Theirs'],
      tagIds: ['tag-here', 'tag-theirs'],
    };

    const planned = await plan([object(book)], 'amy');
    const arrival = planned.byFileId.get(book.id);
    if (arrival === undefined) throw new Error('not planned');

    const lacking = asLanded(object(book), arrival, planned.ids, new Set(['tag-here']));
    expect(lacking.droppedTags).toEqual(['tag-theirs']);
    expect(lacking.body['tags']).toEqual(['Here', 'Theirs']);
    expect('tagIds' in lacking.body).toBe(false);

    const holding = asLanded(
      object(book),
      arrival,
      planned.ids,
      new Set(['tag-here', 'tag-theirs']),
    );
    expect(holding).toMatchObject({
      body: { tagIds: ['tag-here', 'tag-theirs'] },
      droppedTags: [],
    });
    expect(asLanded(object(book), arrival, planned.ids, null).droppedTags).toEqual([]);
  });

  /**
   * *Onto an object here, the one here's tags* — the registry is this
   * account's, so a tag the file does not carry, or one it carries that this
   * registry has since lost, is not a difference.
   */
  it('keeps the tags of the object it lands onto, whatever the file says', async () => {
    const book = { ...newLorebook('Harbour'), tags: ['Mine'], tagIds: ['tag-mine'] };
    await create(library(), 'amy', book, LOREBOOK_SCHEMA);

    const file = object({ ...book, tags: ['Coast'], tagIds: ['tag-coast'] });
    const planned = await plan([file], 'amy');
    const arrival = planned.byFileId.get(book.id);
    if (arrival === undefined) throw new Error('not planned');

    const { body, droppedTags } = asLanded(file, arrival, planned.ids, new Set());
    expect(body).toMatchObject({ tags: ['Mine'], tagIds: ['tag-mine'] });
    expect(droppedTags).toEqual([]);
  });
});

/**
 * ***Keep-both is a fixed point*** — a copy's references follow it, which
 * makes what names it differ, which makes that a copy too.
 */
describe('keep-both, followed through', () => {
  it('copies what names a copy, and leaves what does not where it is', async () => {
    const book = newLorebook('Harbour');
    const vera = { ...newActor('Vera'), lore: [{ id: book.id, name: 'Harbour' }] };
    const quiet = newLorebook('Quiet');
    const world: World = {
      ...newWorld('Rain City'),
      contents: [
        { schema: vera.schema, id: vera.id, name: 'Vera' },
        { schema: book.schema, id: book.id, name: 'Harbour' },
        { schema: quiet.schema, id: quiet.id, name: 'Quiet' },
      ],
    };
    await create(library(), 'ned', book, LOREBOOK_SCHEMA);
    await create(library(), 'ned', vera);
    await create(library(), 'ned', quiet, LOREBOOK_SCHEMA);
    await create(library(), 'ned', world, WORLD_SCHEMA);
    // The book here moves on after the file was made.
    const stored = read(library(), 'ned', book.id);
    await update(
      library(),
      'ned',
      book.id,
      { ...(stored.body as object), description: 'Edited since.' },
      stored.contentHash,
    );

    // The dependent first, so a single pass in file order would compare Vera
    // before her book had moved — only following what names a copy finds her.
    const planned = await plan(
      [object(vera), object(world), object(quiet), object(book)],
      'ned',
      'keep-both',
    );

    const landed = (id: string) => planned.byFileId.get(id);
    expect(landed(book.id)?.keptBoth).toBe(true);
    // Vera names the book; in the file she names the file's book, which is now
    // the copy — so she differs from the Vera here, and is a copy too.
    expect(landed(vera.id)?.keptBoth).toBe(true);
    // Nothing names a copy from the quiet book: it is the one here.
    expect(landed(quiet.id)).toMatchObject({ landedId: quiet.id, keptBoth: false });
    // The World's merged list would gain the copies: a copy of the World.
    expect(landed(world.id)?.keptBoth).toBe(true);

    const veraArrival = landed(vera.id);
    if (veraArrival === undefined) throw new Error('not planned');
    const { body } = asLanded(object(vera), veraArrival, planned.ids, null);
    expect(body['lore']).toEqual([{ id: landed(book.id)?.landedId, name: 'Harbour' }]);
  });

  it('copies nothing when the file is what is here', async () => {
    const book = newLorebook('Harbour');
    const world: World = {
      ...newWorld('Rain City'),
      contents: [{ schema: book.schema, id: book.id, name: 'Harbour' }],
    };
    await create(library(), 'ned', book, LOREBOOK_SCHEMA);
    await create(library(), 'ned', world, WORLD_SCHEMA);

    const planned = await plan([object(book), object(world)], 'ned', 'keep-both');

    expect([...planned.byFileId.values()].map((one) => one.keptBoth)).toEqual([false, false]);
  });

  it('is the treatment’s too: a required link to a copied book makes a copied treatment', async () => {
    const book = newLorebook('Harbour');
    const rain = {
      ...newTreatment('Rain'),
      lore: [{ ref: { id: book.id, name: 'Harbour' }, required: true }],
    };
    await create(library(), 'ned', book, LOREBOOK_SCHEMA);
    await create(library(), 'ned', rain, TREATMENT_SCHEMA);

    const planned = await plan(
      [object({ ...book, description: 'The file’s.' }), object(rain)],
      'ned',
      'keep-both',
    );

    expect(planned.byFileId.get(rain.id)?.keptBoth).toBe(true);
  });
});

/**
 * ***The trash's ids are not the index's*** — the fact check of 2026-10-10,
 * named in the risks and pinned here rather than fixed: an id whose object is
 * in another account's trash reads as free, so the arrival keeps it.
 */
describe('an id in another account’s trash', () => {
  it('reads as free', async () => {
    const book = newLorebook('Harbour');
    const made = await create(library(), 'ned', book, LOREBOOK_SCHEMA);
    await remove(library(), 'ned', book.id, made.contentHash, LOREBOOK_SCHEMA);

    const planned = await plan([object(book)], 'amy');

    expect(planned.byFileId.get(book.id)).toMatchObject({ decision: 'new', landedId: book.id });
  });
});
