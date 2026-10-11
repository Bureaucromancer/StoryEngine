// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACTOR_SCHEMA,
  type Closure,
  type FoundNode,
  fileSet,
  LOREBOOK_SCHEMA,
  newActor,
  newLorebook,
  newSetup,
  newTreatment,
  newWorld,
  PUBLISH_RECORD_SCHEMA,
  type PublishPreview,
  type PublishRecord,
  RENDITION_SCHEMA,
  type Rendition,
  SESSION_SCHEMA,
  SETUP_SCHEMA,
  type SessionNode,
  TREATMENT_SCHEMA,
  type Turn,
  uuidv7,
  WORLD_SCHEMA,
  type World,
} from '@storyengine/shared';

import { rebuild } from '../index-db/rebuild.js';
import { create, list, read, update } from '../library.js';
import { digestOf, storeAsset } from '../library/assets.js';
import { ensureMemoryBook } from '../memory/books.js';
import { renditionIdFor, sessionAssetsRoot, writeRendition } from '../renditions/store.js';
import { storeAttachment } from '../sessions/attachments.js';
import { appendTurnOnly, createSession, sessionFilePath } from '../sessions/store.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { makePng } from '../storage/card/test-png.js';
import { readZipDirectory } from '../storage/zip.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { confirmPublish } from './confirm.js';
import { appendPublishRecord } from './ledger.js';
import { closureHash, type PublishContext, previewPublish } from './review.js';

/**
 * ***The review's answer*** — [16 §5](../../../../docs/design/16-publish.md),
 * [16 §2](../../../../docs/design/16-publish.md), [P16.3d].
 *
 * **The numbers beside a row are the file's**, which is the claim the facts
 * exist for: filled by the writer's own surveys, so a review that says *this
 * adds 40 KB* is describing the file the confirm writes. The first case holds
 * the sum of a review's facts to the members of a real file, entry for entry
 * and byte for byte; the rest are the answers about the publish as a whole —
 * *just the object*, the Worlds that already hold this selection, a missing
 * starting point, the name offered, the mode versions, the hash drift is
 * measured against, the previous record — and the half of [P16.3c]'s *an
 * object play wrote stays home* that the walker owed, over a real memory book.
 */

const AT = new Date('2026-10-10T12:00:00.000Z');

/**
 * ***A seam between the confirm's read of a World and the plan's***
 * (2026-10-11, the P16.3d review): the confirm opens its scratch space after
 * it has read the World it was asked for and before `planWorldFile` reads the
 * row again for its folder and pictures, so a hook there is a save in exactly
 * that window. Unset, it passes straight through.
 */
const seams = vi.hoisted(() => ({ beforeScratch: null as (() => Promise<void>) | null }));

vi.mock('../storage/import-scratch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/import-scratch.js')>();
  return {
    ...actual,
    openImportScratch: async (...args: Parameters<typeof actual.openImportScratch>) => {
      const hook = seams.beforeScratch;
      seams.beforeScratch = null;
      if (hook !== null) await hook();
      return await actual.openImportScratch(...args);
    },
  };
});

let server: TestServer;
let context: PublishContext;

beforeEach(async () => {
  seams.beforeScratch = null;
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
  context = {
    library: server.services.library,
    sessions: server.services.sessions,
    build: { version: '1.0.0-alpha.7', commit: 'abc1234' },
    freeBytes: () => Promise.resolve(null),
    now: () => AT,
  };
});

afterEach(async () => {
  await server.dispose();
});

const envelope = (object: { schema: string; id: string; name: string }) => ({
  schema: object.schema,
  id: object.id,
  name: object.name,
});

async function preview(
  start: { kind: 'world'; id: string } | { kind: 'objects'; ids: string[] },
): Promise<PublishPreview> {
  const answer = await previewPublish(context, 'ned', start);
  if ('refusal' in answer) throw new Error(`refused: ${answer.refusal}`);
  return answer;
}

function found(closure: Closure, id: string): FoundNode {
  const node = closure.nodes.find((one) => one.key === id);
  if (node?.state !== 'found') throw new Error(`no found node ${id}`);
  return node;
}

function session(closure: Closure, id: string): SessionNode {
  const node = closure.nodes.find((one) => one.key === id);
  if (node?.state !== 'session') throw new Error(`no session node ${id}`);
  return node;
}

function turn(over: Partial<Turn> & { id: string; parentTurnId: string | null }): Turn {
  return { createdAt: AT.toISOString(), status: 'complete', ...over } as Turn;
}

/**
 * A World with something of every measured kind: an actor whose card holds an
 * expression; a book with a gallery picture and two versions; a treatment
 * casting the actor; and a session member with two turns, a picture and an
 * attachment.
 */
async function rainCity(): Promise<{
  world: World;
  vera: { id: string };
  harbour: { id: string };
  rain: { id: string };
  night: string;
  cardBytes: number;
  /** The expression in Vera's card, and the picture in Harbour's gallery — what each row's pictures weigh. */
  smileBytes: number;
  galleryBytes: number;
}> {
  const library = server.services.library;
  const sessions = server.services.sessions;
  const layout = server.services.layout;

  const smile = makePng(9, 2);
  const vera = {
    ...newActor('Vera'),
    media: [
      {
        id: 'e1',
        role: 'expression' as const,
        label: 'smiling',
        mime: 'image/png',
        digest: digestOf(smile),
        bytes: smile.length,
        ref: 'smiling',
        tags: [],
      },
    ],
  };
  const madeVera = await create(library, 'ned', vera, ACTOR_SCHEMA, {
    cardPixels: makePng(8, 1),
    media: new Map([['smiling', smile]]),
  });

  const harbour = newLorebook('Harbour');
  const madeHarbour = await create(library, 'ned', harbour, LOREBOOK_SCHEMA);
  const galleryPng = makePng(6, 3);
  const gallery = await storeAsset(library, 'ned', harbour.id, galleryPng, 'image/png');
  const second = await update(
    library,
    'ned',
    harbour.id,
    { ...harbour, media: [{ id: 'm1', role: 'map', tags: [], ...gallery }] },
    madeHarbour.contentHash,
  );
  await update(
    library,
    'ned',
    harbour.id,
    {
      ...harbour,
      description: 'Wet.',
      media: [{ id: 'm1', role: 'map', tags: [], ...gallery }],
    },
    second.contentHash,
  );

  const rain = {
    ...newTreatment('Rain'),
    cast: [{ ref: { id: vera.id, name: 'Vera' }, billing: 'npc' as const, note: '' }],
  };
  await create(library, 'ned', rain, TREATMENT_SCHEMA);

  const night = await createSession(sessions, 'ned', {
    name: 'Night one',
    mode: { id: 'chat', config: {} },
    cast: { persona: null, actors: [vera.id] },
  });
  const attachment = await storeAttachment(layout, 'ned', night.id, makePng(5, 5));
  if (attachment === null) throw new Error('the attachment did not store');
  const t1 = uuidv7();
  const t2 = uuidv7();
  await appendTurnOnly(
    sessions,
    'ned',
    night.id,
    turn({
      id: t1,
      parentTurnId: null,
      sessionId: night.id,
      input: {
        text: 'Look.',
        attachments: [
          { id: 'a1', kind: 'image', digest: attachment.digest, mime: attachment.mime },
        ],
      },
    } as Partial<Turn> & { id: string; parentTurnId: string | null }),
  );
  await appendTurnOnly(
    sessions,
    'ned',
    night.id,
    turn({ id: t2, parentTurnId: t1, sessionId: night.id }),
  );
  const pixels = makePng(7, 6);
  const shown = renditionIdFor(t1, 0);
  const assets = sessionAssetsRoot(layout, 'ned', night.id);
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, `${shown}.png`), pixels);
  await writeRendition(layout, 'ned', night.id, {
    schema: RENDITION_SCHEMA,
    id: shown,
    sessionId: night.id,
    turnId: t1,
    createdAt: AT.toISOString(),
    kind: 'image',
    purpose: 'illustration',
    scope: { anchor: 'the lantern' },
    state: 'ready',
    prompt: {
      fragments: [{ id: 'moment', text: 'a lantern', rank: 100, required: true }],
      separator: ', ',
      budget: { maxChars: 320, usefulChars: 180 },
      text: 'a lantern',
      kept: ['moment'],
      dropped: [],
      overCap: false,
    },
    asset: { path: `${shown}.png`, mime: 'image/png', bytes: pixels.length, digest: 'sha256:00' },
    provenance: {
      at: AT.toISOString(),
      binding: { connectionId: 'c-1', modelId: 'sdxl' },
      answeredAs: null,
      seed: 1,
      workflow: {},
    },
    error: null,
    digest: 'd-1',
    ordering: 0,
  } as unknown as Rendition);
  await writeJsonAtomic(sessionFilePath(layout, 'ned', night.id), { ...night, headTurnId: t2 });

  const world: World = {
    ...newWorld('Rain City'),
    contents: [
      envelope(rain),
      envelope(harbour),
      { schema: SESSION_SCHEMA, id: night.id, name: 'Night one' },
    ],
  };
  await create(library, 'ned', world, WORLD_SCHEMA);
  return {
    world,
    vera,
    harbour,
    rain,
    night: night.id,
    cardBytes: (await readFile(madeVera.path)).byteLength,
    smileBytes: smile.length,
    galleryBytes: galleryPng.length,
  };
}

describe('the review’s numbers', () => {
  it('measures pictures, versions, a card and a session, as the file will hold them', async () => {
    const city = await rainCity();
    const answer = await preview({ kind: 'world', id: city.world.id });
    const { closure } = answer;

    // An actor's pictures ride inside her card: one expression, no file beside it.
    // What a picture weighs is held too (2026-10-11, the P16.3d review): the
    // review's rows say what each picture costs, and `fileSet`'s totals never
    // add `pictures.bytes`, so the sum test below cannot catch a wrong one.
    expect(found(closure, city.vera.id).facts).toMatchObject({
      entries: 1,
      bytes: city.cardBytes,
      pictures: { count: 1, bytes: city.smileBytes },
      omitted: [],
    });
    // A book carries its gallery beside it, and two saves made two versions.
    const harbour = found(closure, city.harbour.id).facts;
    expect(harbour).toMatchObject({
      entries: 2,
      pictures: { count: 1, bytes: city.galleryBytes },
    });
    expect(harbour?.history.versions).toBe(2);
    // The index and each version's payload.
    expect(harbour?.history.entries).toBe(3);
    // A session: its turns, its one picture on disk, and the attachment a move carried.
    expect(session(closure, city.night).facts).toMatchObject({
      turns: 2,
      pictures: 1,
      attachments: 1,
      missingPixels: 0,
      entries: 3,
    });
  });

  /**
   * ***The claim the facts are for*** — summed the way the review sums them
   * (`fileSet`'s totals over the same ticks), they are the file the confirm
   * writes: every member but the manifest and the World's own `world.json`,
   * and every byte of those members.
   */
  it('adds up to the file the confirm writes, entry for entry and byte for byte', async () => {
    const city = await rainCity();
    const answer = await preview({ kind: 'world', id: city.world.id });
    const choices = { ticked: { [city.night]: true }, history: true, keep: 'world' as const };
    const totals = fileSet(answer.closure, choices).totals;

    const confirmed = await confirmPublish(
      context,
      'ned',
      { kind: 'world', id: city.world.id },
      choices,
      answer.reviewed,
    );
    if ('refusal' in confirmed) throw new Error(`refused: ${confirmed.refusal}`);
    try {
      const directory = readZipDirectory(new Uint8Array(await readFile(confirmed.path)));
      if (!directory.ok) throw new Error(directory.refusal);
      const members = directory.entries.filter(
        (entry) =>
          entry.name !== 'storyengine-world.json' && !entry.name.startsWith('library/worlds/'),
      );
      expect(totals.entries).toBe(members.length);
      expect(totals.bytes).toBe(members.reduce((sum, entry) => sum + entry.uncompressedSize, 0));
      expect(confirmed.drift).toBe(false);
    } finally {
      await confirmed.space.dispose();
    }
  });
});

describe('what the review says about the publish as a whole', () => {
  it('calls one object with nothing beside it just the object, and nothing else so', async () => {
    const vera = newActor('Vera');
    await create(server.services.library, 'ned', vera, ACTOR_SCHEMA);
    const rain = {
      ...newTreatment('Rain'),
      cast: [{ ref: { id: vera.id, name: 'Vera' }, billing: 'npc' as const, note: '' }],
    };
    await create(server.services.library, 'ned', rain, TREATMENT_SCHEMA);

    expect((await preview({ kind: 'objects', ids: [vera.id] })).justTheObject).toBe(true);
    expect((await preview({ kind: 'objects', ids: [rain.id] })).justTheObject).toBe(false);
    expect((await preview({ kind: 'objects', ids: [vera.id, rain.id] })).justTheObject).toBe(false);
  });

  it('names the Worlds that already hold exactly this selection, and only those', async () => {
    const library = server.services.library;
    const vera = newActor('Vera');
    const harbour = newLorebook('Harbour');
    const tides = newLorebook('Tides');
    for (const [object, kind] of [
      [vera, ACTOR_SCHEMA],
      [harbour, LOREBOOK_SCHEMA],
      [tides, LOREBOOK_SCHEMA],
    ] as const) {
      await create(library, 'ned', object, kind);
    }
    const same = { ...newWorld('The pair'), contents: [envelope(harbour), envelope(vera)] };
    const wider = {
      ...newWorld('The three'),
      contents: [envelope(vera), envelope(harbour), envelope(tides)],
    };
    await create(library, 'ned', same, WORLD_SCHEMA);
    await create(library, 'ned', wider, WORLD_SCHEMA);

    // Order is not identity: the same two ids, picked the other way round.
    expect((await preview({ kind: 'objects', ids: [vera.id, harbour.id] })).sameAs).toEqual([
      { id: same.id, name: 'The pair' },
    ]);
    expect((await preview({ kind: 'objects', ids: [vera.id, tides.id] })).sameAs).toEqual([]);
    // One object keeps nothing, so no World is the same as it ([16 §2]).
    expect((await preview({ kind: 'objects', ids: [vera.id] })).sameAs).toEqual([]);

    // A shadowed copy — the same World's file in a second folder, which the
    // index keeps as the winner's duplicate — is not a second World the same
    // as this selection (2026-10-11, the P16.3d review: the filter had no test).
    const folder = dirname(read(library, 'ned', same.id).path);
    const copy = join(dirname(folder), 'the-pair-copy');
    await mkdir(copy, { recursive: true });
    await writeFile(join(copy, 'world.json'), await readFile(join(folder, 'world.json')));
    await rebuild(server.services.index.db, server.services.layout);
    expect(list(library, 'ned', WORLD_SCHEMA).filter((row) => row.id === same.id)).toHaveLength(2);
    expect((await preview({ kind: 'objects', ids: [vera.id, harbour.id] })).sameAs).toEqual([
      { id: same.id, name: 'The pair' },
    ]);
  });

  /** [16 §4]: *reported, never dropped and never refused* — unless there is nothing at all. */
  it('makes a missing start in a selection a node, and a lone missing one a refusal', async () => {
    const vera = newActor('Vera');
    await create(server.services.library, 'ned', vera, ACTOR_SCHEMA);
    const ghost = uuidv7();

    const answer = await preview({ kind: 'objects', ids: [vera.id, ghost] });
    expect(answer.closure.origin).toBe('selection');
    expect(answer.closure.nodes).toContainEqual(
      expect.objectContaining({ state: 'missing', ref: { id: ghost, name: null } }),
    );
    expect(await previewPublish(context, 'ned', { kind: 'objects', ids: [ghost] })).toEqual({
      refusal: 'not-found',
    });
  });

  it('offers a name, the build, and this install’s version of every mode named', async () => {
    const library = server.services.library;
    const vera = newActor('Vera');
    const harbour = newLorebook('Harbour');
    const tides = newLorebook('Tides');
    const opening = {
      ...newSetup('Opening'),
      mode: { id: 'storyengine.scene', config: null },
    };
    const elsewhere = { ...newSetup('Elsewhere'), mode: { id: 'somebody.else', config: null } };
    for (const [object, kind] of [
      [vera, ACTOR_SCHEMA],
      [harbour, LOREBOOK_SCHEMA],
      [tides, LOREBOOK_SCHEMA],
      [opening, SETUP_SCHEMA],
      [elsewhere, SETUP_SCHEMA],
    ] as const) {
      await create(library, 'ned', object, kind);
    }

    expect((await preview({ kind: 'objects', ids: [vera.id] })).suggestedName).toBe('Vera');
    expect((await preview({ kind: 'objects', ids: [vera.id, harbour.id] })).suggestedName).toBe(
      'Vera, Harbour',
    );
    expect(
      (await preview({ kind: 'objects', ids: [vera.id, harbour.id, tides.id, opening.id] }))
        .suggestedName,
    ).toBe('Vera, Harbour, Tides, …');

    const answer = await preview({ kind: 'objects', ids: [opening.id, elsewhere.id] });
    expect(answer.build).toEqual({ version: '1.0.0-alpha.7' });
    expect(answer.modeVersions['storyengine.scene']).toMatch(/^\d+\.\d+\.\d+/);
    expect(answer.modeVersions['somebody.else']).toBeNull();
  });

  /**
   * ***The hash drift is measured against*** — the same library walks to the
   * same hash, and an edit to anything the walk reached changes it. Facts are
   * not in it, so measuring cannot move it.
   */
  it('hashes the same library the same way, and an edit differently', async () => {
    const city = await rainCity();
    const first = await preview({ kind: 'world', id: city.world.id });
    const again = await preview({ kind: 'world', id: city.world.id });
    expect(again.reviewed).toBe(first.reviewed);
    expect(first.reviewed).toBe(closureHash(first.closure));

    const stored = read(server.services.library, 'ned', city.vera.id);
    await update(
      server.services.library,
      'ned',
      city.vera.id,
      { ...(stored.body as object), description: 'Edited while the review was open.' },
      stored.contentHash,
    );
    expect((await preview({ kind: 'world', id: city.world.id })).reviewed).not.toBe(first.reviewed);
  });

  /**
   * ***A World saved while its file is planned fails the publish whole***
   * (2026-10-11, the P16.3d review; [P16.3]'s plan, risk 6). The confirm
   * holds the World to the walk's hash, then hands its body to the plan,
   * which reads the row again for the World's folder and pictures. A save
   * between the two — renamed, a picture replaced — answered `200` with the
   * old `world.json` beside the new row's pictures. Now the plan's read is
   * held to the same hash, and the answer is `publish.changed`.
   */
  it('refuses a World start whose World is saved between the confirm’s read and the plan’s', async () => {
    const city = await rainCity();
    seams.beforeScratch = async () => {
      const stored = read(server.services.library, 'ned', city.world.id);
      await update(
        server.services.library,
        'ned',
        city.world.id,
        { ...(stored.body as World), name: 'Rain Town' },
        stored.contentHash,
      );
    };
    const answer = await confirmPublish(
      context,
      'ned',
      { kind: 'world', id: city.world.id },
      { ticked: {}, history: false, keep: 'world' },
    );
    if (!('refusal' in answer)) await answer.space.dispose();
    expect(seams.beforeScratch).toBeNull();
    expect(answer).toEqual({ refusal: 'changed', path: city.world.id, world: null });
  });

  it('hands a World start its newest ledger record, and a selection none', async () => {
    const city = await rainCity();
    expect((await preview({ kind: 'world', id: city.world.id })).previous).toBeNull();

    const record: PublishRecord = {
      schema: PUBLISH_RECORD_SCHEMA,
      at: AT.toISOString(),
      build: null,
      origin: 'world',
      start: [city.world.id],
      world: { id: city.world.id, name: 'Rain City', kept: 'existing' },
      fileName: 'Rain-City.seworld',
      bytes: 1,
      entries: 1,
      objects: [],
      sessions: [],
      offered: { objects: 0, sessions: 0 },
      unticked: [],
      ticked: [],
      history: false,
      justTheObject: false,
      missing: 0,
      drift: false,
    };
    await appendPublishRecord(server.services.layout, 'ned', { ...record, bytes: 1 });
    await appendPublishRecord(server.services.layout, 'ned', { ...record, bytes: 2 });
    expect((await preview({ kind: 'world', id: city.world.id })).previous?.bytes).toBe(2);
    expect(
      (await preview({ kind: 'objects', ids: [city.vera.id, city.harbour.id] })).previous,
    ).toBeNull();
  });
});

/**
 * ***A memory book, through the review*** — the walker's half of the
 * writtenByPlay pair ([P16.3d]; the rule's half is `publish.test.ts`). A real
 * book `ensureMemoryBook` made, as a World member and as a selected id: the
 * node says play wrote it, it measures as the nothing it carries, and the
 * review's `fileSet` names it as staying home — while an ordinary book beside
 * it carries no such mark.
 */
describe('what play wrote, in the review', () => {
  it('marks a memory book, measures it as nothing, and leaves it home in the rule', async () => {
    const library = server.services.library;
    const vera = newActor('Vera');
    await create(library, 'ned', vera, ACTOR_SCHEMA);
    const harbour = newLorebook('Harbour');
    await create(library, 'ned', harbour, LOREBOOK_SCHEMA);
    const memories = await ensureMemoryBook(
      library,
      'ned',
      { actor: vera.id, persona: null },
      { actor: 'Vera', persona: null },
    );
    const world: World = {
      ...newWorld('Rain City'),
      contents: [
        envelope(vera),
        envelope(harbour),
        { schema: LOREBOOK_SCHEMA, id: memories.id, name: memories.book.name },
      ],
    };
    await create(library, 'ned', world, WORLD_SCHEMA);

    for (const start of [
      { kind: 'world' as const, id: world.id },
      { kind: 'objects' as const, ids: [harbour.id, memories.id] },
    ]) {
      const { closure } = await preview(start);
      const book = found(closure, memories.id);
      expect(book.writtenByPlay).toBe(true);
      expect(book.facts).toMatchObject({ entries: 0, bytes: 0 });
      expect(found(closure, harbour.id).writtenByPlay).toBeUndefined();

      const set = fileSet(closure, { ticked: { [memories.id]: true }, history: true });
      expect(set.objects.map((one) => one.id)).not.toContain(memories.id);
      expect(set.leftBehind).toContainEqual({
        schema: LOREBOOK_SCHEMA,
        id: memories.id,
        name: memories.book.name,
        reason: 'not-portable',
        required: false,
        from: [],
      });
      expect(set.notes.map((one) => one.key)).toContain('publish.closure.writtenByPlay');
    }
  });
});
