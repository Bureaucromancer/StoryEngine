// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ACTOR_SCHEMA,
  fileSet,
  LOREBOOK_SCHEMA,
  newActor,
  newLorebook,
  newTreatment,
  newWorld,
  type PublishPreview,
  type PublishRecord,
  publishDiff,
  readWorldFileManifest,
  RENDITION_SCHEMA,
  type Rendition,
  SESSION_SCHEMA,
  TREATMENT_SCHEMA,
  WORLD_FILE_MANIFEST,
} from '@storyengine/shared';

import { create, update } from '../library.js';
import { digestOf } from '../library/assets.js';
import { FakeProvider } from '../providers/fake.js';
import { renditionIdFor, sessionAssetsRoot, writeRendition } from '../renditions/store.js';
import { makePng } from '../storage/card/test-png.js';
import { Layout } from '../storage/layout.js';
import { readZipDirectory, readZipEntry } from '../storage/zip.js';
import {
  eventually,
  makeTestServer,
  settled,
  setUpAdmin,
  type TestServer,
} from '../test-server.js';

/**
 * ***P16.3's third end clause, as a test*** —
 * [P16.3h](../../../../docs/design/workplan/35-p16-world.md),
 * [16 §5](../../../../docs/design/16-publish.md)'s *re-publishing opens on
 * the diff*, [16 §3](../../../../docs/design/16-publish.md),
 * [22 §9](../../../../docs/design/22-internal-contracts.md).
 *
 * *"Publishing an edited World again opens on what changed."* The plan's
 * steps, each the route a person's browser calls: publish a World with one
 * session ticked (`POST /api/publish`); **edit a member** (`PUT
 * /api/library/:kind/:id` — renamed and rewritten), **add one** (`POST
 * /api/library/worlds/:id/members`), **delete one** (`DELETE
 * /api/library/:kind/:id`), **play a turn** on the ticked session (`POST
 * /api/sessions/:id/turns`, against a scripted model); then ask the review
 * again (`POST /api/publish/preview`). Its `previous` is the ledger's line for
 * the first file, and the shared `publishDiff` — the function the review calls
 * on every tick — over that line and `fileSet` of the fresh closure names each
 * change, and nothing else.
 *
 * **The member nobody touched is the other half of the clause.** One of the
 * World's actors carries a card the writer re-splices — an expression removed
 * from the actor, its pixels still in the card — so the bytes that travelled
 * hash differently from the stored card. The diff must not call it changed:
 * the ledger keeps the **stored** hash ([22 §9]) and the walk reads the stored
 * hash again, and a diff that compared the file's bytes would open every
 * re-publish of a World with such a card on a change nobody made. *That card
 * is the one piece of setup made below the routes* — a card holding pixels no
 * row names is not a thing the routes let a person build in one step, which
 * is the point of the case; everything the clause names happens through them.
 */

const CONNECTION = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a78';

let server: TestServer;
let fake: FakeProvider;
let counter = 0;

beforeEach(async () => {
  fake = new FakeProvider({ script: [{ text: 'Rain on the quay, and a lantern going out.' }] });
  server = await makeTestServer({ providers: () => fake });
  await setUpAdmin(server, 'ned');
  // A connection and a prose binding, so a turn played through the route has
  // a model to answer it — the scripted one.
  const root = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'double.json'),
    JSON.stringify({
      id: CONNECTION,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-prose'],
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION, modelId: 'fake-prose' } }),
  );
  counter = 0;
});

afterEach(async () => {
  await server.dispose();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function cookies(): Record<string, string> {
  const headers: Record<string, string> = {
    cookie: [...server.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
  };
  const csrf = server.cookies.get('se_csrf');
  if (csrf !== undefined) headers['x-csrf-token'] = csrf;
  return headers;
}

/** `POST /api/library/:kind` — what the editor's *Save* does for a new object. */
async function created(kind: string, object: { id: string }): Promise<string> {
  const answer = await server.request({
    method: 'POST',
    url: `/api/library/${kind}`,
    payload: object,
  });
  expect(answer.status, JSON.stringify(answer.body)).toBe(201);
  return answer.body.contentHash as string;
}

/** `GET` then `PUT /api/library/:kind/:id` with the hash it read — an edit. */
async function edited(
  kind: string,
  id: string,
  change: (object: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const read = await server.request({ method: 'GET', url: `/api/library/${kind}/${id}` });
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  const written = await server.request({
    method: 'PUT',
    url: `/api/library/${kind}/${id}`,
    payload: { object: change(read.body.object as Record<string, unknown>) },
    headers: { 'if-match': read.body.contentHash as string },
  });
  expect(written.status, JSON.stringify(written.body)).toBe(200);
}

/** `DELETE /api/library/:kind/:id` with the hash it read — to the trash, as the library does. */
async function deleted(kind: string, id: string): Promise<void> {
  const read = await server.request({ method: 'GET', url: `/api/library/${kind}/${id}` });
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  const gone = await server.request({
    method: 'DELETE',
    url: `/api/library/${kind}/${id}`,
    headers: { 'if-match': read.body.contentHash as string },
  });
  expect(gone.status, JSON.stringify(gone.body)).toBe(204);
}

/** One turn played through the route, waited for until the head moves and the runner is quiet. */
async function play(sessionId: string, text: string): Promise<void> {
  const before = (await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` })).body
    .session.headTurnId as string | null;
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: `k-${String(counter++)}`, headTurnId: before, input: { text } },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
  await eventually(async () => {
    const now = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const head = now.body.session.headTurnId as string | null;
    return head !== null && head !== before;
  });
  await settled(server);
}

async function preview(worldId: string): Promise<PublishPreview> {
  const answer = await server.request({
    method: 'POST',
    url: '/api/publish/preview',
    payload: { start: { kind: 'world', id: worldId } },
  });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return answer.body as PublishPreview;
}

/** `POST /api/publish` for the World with these ticks — the download's bytes. */
async function publish(worldId: string, ticked: Record<string, boolean>): Promise<Buffer> {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/publish',
    headers: { ...cookies(), 'content-type': 'application/json' },
    payload: JSON.stringify({
      start: { kind: 'world', id: worldId },
      choices: { ticked, history: false, keep: 'world' },
    }),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.rawPayload;
}

async function ledger(): Promise<PublishRecord[]> {
  const text = await readFile(server.services.layout.publishLogFile('ned'), 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as PublishRecord);
}

/** The ledger once it holds `count` lines — appended on the response's `finish`, after `inject` answers. */
async function recorded(count: number): Promise<PublishRecord[]> {
  await eventually(async () => (await ledger()).length >= count, {
    describe: async () => `${String((await ledger()).length)} line(s)`,
  });
  return await ledger();
}

/** A World holding one session, played once — the setup the session cases share. */
async function aWorldWithOneSession(): Promise<{ world: string; night: string }> {
  const vera = newActor('Vera');
  await created('actors', vera);
  const world = { ...newWorld('Rain City'), contents: [] };
  await created('worlds', world);
  const started = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Night Market', world: world.id, cast: { persona: null, actors: [vera.id] } },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const night = started.body.session.id as string;
  await settled(server);
  await play(night, 'We walk down to the quay.');
  return { world: world.id, night };
}

/**
 * ***A picture of a turn, as the rendition worker leaves one*** — the pixels
 * under the session's `assets/` and the record beside them, and nothing
 * written to the session's own document (`renditions/worker.ts`).
 */
async function drawn(sessionId: string, turnId: string): Promise<void> {
  const layout = server.services.layout;
  const id = renditionIdFor(turnId, 0);
  const pixels = makePng(7, 6);
  const assets = sessionAssetsRoot(layout, 'ned', sessionId);
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, `${id}.png`), pixels);
  await writeRendition(layout, 'ned', sessionId, {
    schema: RENDITION_SCHEMA,
    id,
    sessionId,
    turnId,
    createdAt: new Date().toISOString(),
    kind: 'image',
    purpose: 'illustration',
    scope: { anchor: 'the lantern' },
    state: 'ready',
    prompt: {
      fragments: [{ id: 'moment', text: 'a lantern on a wet quay', rank: 100, required: true }],
      separator: ', ',
      budget: { maxChars: 320, usefulChars: 180 },
      text: 'a lantern on a wet quay',
      kept: ['moment'],
      dropped: [],
      overCap: false,
    },
    asset: {
      path: `${id}.png`,
      mime: 'image/png',
      bytes: pixels.length,
      digest: digestOf(pixels),
    },
    provenance: {
      at: new Date().toISOString(),
      binding: { connectionId: CONNECTION, modelId: 'fake-vision' },
      answeredAs: null,
      seed: 1,
      workflow: {},
    },
    error: null,
    digest: 'd-0',
    ordering: 0,
  } as unknown as Rendition);
}

/** A member's hash as the zip carried it — the manifest's, which is the file's bytes. */
function travelledHash(bytes: Uint8Array, id: string): string | undefined {
  const directory = readZipDirectory(bytes);
  if (!directory.ok) throw new Error(`not a zip: ${directory.refusal}`);
  const entry = directory.entries.find((one) => one.name === WORLD_FILE_MANIFEST);
  const raw = entry === undefined ? null : readZipEntry(bytes, entry);
  if (raw === null) throw new Error('no manifest');
  const manifest = readWorldFileManifest(JSON.parse(new TextDecoder().decode(raw)));
  if ('refusal' in manifest) throw new Error(`manifest refused: ${manifest.refusal}`);
  return manifest.objects.find((one) => one.id === id)?.contentHash;
}

// ── The clause ──────────────────────────────────────────────────────────────

describe('publishing an edited World again', () => {
  it('opens on what changed: the edit, the addition, the deletion and the turn — and nothing else', async () => {
    // ── A World, through the routes ──
    const vera = newActor('Vera');
    await created('actors', vera);
    const harbour = newLorebook('Harbour');
    await created('lorebooks', harbour);
    const pier = newLorebook('Old Pier');
    await created('lorebooks', pier);
    const rain = {
      ...newTreatment('The Drowned Bell'),
      cast: [{ ref: { id: vera.id, name: 'Vera' }, billing: 'npc' as const, note: '' }],
      lore: [{ ref: { id: harbour.id, name: 'Harbour' }, required: false }],
    };
    await created('treatments', rain);

    // The card the writer re-splices: an expression removed from the actor,
    // its pixels left in the card (see the docstring for why below the routes).
    const smile = makePng(9, 2);
    const ash = {
      ...newActor('Ash'),
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
    const first = await create(server.services.library, 'ned', ash, ACTOR_SCHEMA, {
      cardPixels: makePng(8, 1),
      media: new Map([['smiling', smile]]),
    });
    await update(server.services.library, 'ned', ash.id, { ...ash, media: [] }, first.contentHash);

    const world = {
      ...newWorld('Rain City'),
      contents: [
        { schema: TREATMENT_SCHEMA, id: rain.id, name: rain.name },
        { schema: LOREBOOK_SCHEMA, id: harbour.id, name: 'Harbour' },
        { schema: LOREBOOK_SCHEMA, id: pier.id, name: 'Old Pier' },
        { schema: ACTOR_SCHEMA, id: ash.id, name: 'Ash' },
      ],
    };
    await created('worlds', world);

    // One session, started in the World so it is a member, and played once.
    const started = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        name: 'Night Market',
        world: world.id,
        cast: { persona: null, actors: [vera.id] },
      },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const night = started.body.session.id as string;
    await settled(server);
    await play(night, 'We walk down to the quay.');

    // Never published: nothing to open on.
    expect((await preview(world.id)).previous).toBeNull();

    // ── Publish it with the session ticked ──
    const bytes = await publish(world.id, { [night]: true });
    const [line] = await recorded(1);
    expect(line?.sessions.map((one) => one.id)).toEqual([night]);
    // The premise of the untouched card: what travelled is not the stored file.
    const storedAsh = line?.objects.find((one) => one.id === ash.id)?.contentHash;
    expect(storedAsh).toBeDefined();
    expect(travelledHash(bytes, ash.id)).not.toBe(storedAsh);

    // ── Edit a member, add one, delete one, play a turn ──
    // Two edits: a book renamed and rewritten, and an actor whose name stays —
    // so *changed* is the stored hash's to say, and not the name's.
    await edited('lorebooks', harbour.id, (object) => ({
      ...object,
      name: 'Harbour Lights',
      description: 'Where the lamps are lit at dusk.',
    }));
    await edited('actors', vera.id, (object) => ({
      ...object,
      description: 'Keeps the lighthouse log.',
    }));
    const streets = newLorebook('Rain City streets');
    await created('lorebooks', streets);
    const added = await server.request({
      method: 'POST',
      url: `/api/library/worlds/${world.id}/members`,
      payload: { members: [{ schema: LOREBOOK_SCHEMA, id: streets.id, name: streets.name }] },
    });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    await deleted('lorebooks', pier.id);
    await play(night, 'And on, to the bell.');

    // ── The review again ──
    const again = await preview(world.id);
    // Its `previous` is the line the first file left — exactly.
    expect(again.previous).toEqual(line);

    // The review's ticks as they were: the session ticked, everything else its default.
    const ticked = { [night]: true };
    const diff = publishDiff(
      again.previous!,
      fileSet(again.closure, { ticked, history: false }),
      again.closure,
      false,
    );

    expect(diff.since).toEqual({ at: line?.at, fileName: line?.fileName });
    expect(diff.added).toEqual([
      { id: streets.id, schema: LOREBOOK_SCHEMA, name: 'Rain City streets' },
    ]);
    expect(diff.changed).toEqual([
      { id: harbour.id, schema: LOREBOOK_SCHEMA, name: 'Harbour Lights', renamedFrom: 'Harbour' },
      { id: vera.id, schema: ACTOR_SCHEMA, name: 'Vera' },
    ]);
    expect(diff.removed).toEqual([
      { id: pier.id, schema: LOREBOOK_SCHEMA, name: 'Old Pier', why: 'gone' },
    ]);
    // The treatment and Ash — Ash's card re-spliced in the file, and still
    // not changed.
    expect(diff.unchanged).toBe(2);
    expect(diff.changed.map((one) => one.id)).not.toContain(ash.id);
    expect(diff.sessions).toEqual({
      nowTicked: [],
      noLongerTicked: [],
      playedOn: [{ id: night, schema: SESSION_SCHEMA, name: 'Night Market', turnsSince: 1 }],
      changed: [],
      unchanged: 0,
    });
    expect(diff.history).toEqual({ then: false, now: false });
    // A member added moves the World's own row — its contents and its time —
    // and not its page: the World itself is as it was.
    expect(diff.world).toEqual({ changed: false });

    // At the review's defaults — sessions off — the same session is named as
    // no longer in the file, still a member: the diff follows the ticks.
    const atDefaults = publishDiff(
      again.previous!,
      fileSet(again.closure, { ticked: {}, history: false }),
      again.closure,
      false,
    );
    expect(atDefaults.sessions.noLongerTicked).toEqual([
      { id: night, schema: SESSION_SCHEMA, name: 'Night Market', why: 'left-out' },
    ]);
    expect(atDefaults.sessions.playedOn).toEqual([]);
  });

  /**
   * ***A picture is part of what a session sends*** (2026-10-11, the P16.3h
   * review). The rendition worker writes the picture's record and its pixels
   * and never the session's own document, so its head, its count of turns and
   * its `updatedAt` all stay where they were — and a diff that compared only
   * those said *as it was in the last file* of a session whose new picture
   * the file would carry. The picture is written here as the worker leaves it
   * (`renditions/worker.ts`: the pixels under `assets/`, the record beside
   * them), because the step that draws one is its own tests'; what this case
   * holds is that the diff sees it.
   */
  it('names a ticked session whose new picture would travel, though no turn was played', async () => {
    const { world, night } = await aWorldWithOneSession();
    await publish(world, { [night]: true });
    await recorded(1);

    const turn = (await server.request({ method: 'GET', url: `/api/sessions/${night}` })).body
      .session.headTurnId as string;
    await drawn(night, turn);

    const again = await preview(world);
    const diff = publishDiff(
      again.previous!,
      fileSet(again.closure, { ticked: { [night]: true }, history: false }),
      again.closure,
      false,
    );
    expect(diff.sessions).toEqual({
      nowTicked: [],
      noLongerTicked: [],
      playedOn: [],
      changed: [{ id: night, schema: SESSION_SCHEMA, name: 'Night Market' }],
      unchanged: 0,
    });
  });

  /**
   * ***What never leaves is not a change*** (2026-10-11, the P16.3h review).
   * Archiving a session and setting its model dials both write the session's
   * `updatedAt`, and the writer strips `archivedAt`, `roles` and `stepRoles`
   * from what travels (`world-file.ts`) — so the file would carry the same
   * transcript, and *has changed since the last file* would be a sentence
   * about nothing the person sends.
   */
  it('does not call a session changed for what the file never carries: archived, or its dials set', async () => {
    const { world, night } = await aWorldWithOneSession();
    await publish(world, { [night]: true });
    await recorded(1);

    const archived = await server.request({
      method: 'PATCH',
      url: `/api/sessions/${night}`,
      payload: { archived: true },
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const dials = await server.request({
      method: 'PUT',
      url: `/api/sessions/${night}/roles`,
      payload: { roles: { prose: { connectionId: CONNECTION, modelId: 'fake-prose' } } },
    });
    expect(dials.status, JSON.stringify(dials.body)).toBe(200);

    const again = await preview(world);
    const node = again.closure.nodes.find((one) => one.key === night);
    // The premise: the time the old comparison read did move.
    expect(node?.state === 'session' ? node.updatedAt : null).not.toBe(
      again.previous?.sessions[0]?.updatedAt,
    );
    const diff = publishDiff(
      again.previous!,
      fileSet(again.closure, { ticked: { [night]: true }, history: false }),
      again.closure,
      false,
    );
    expect(diff.sessions.changed).toEqual([]);
    expect(diff.sessions.unchanged).toBe(1);
  });

  /**
   * ***The World itself is part of the file*** (2026-10-11, the P16.3h
   * review). [16 §5]'s own example — *send them 1.2* — is an edit to the
   * World alone: its name, its version, its description. The diff compared
   * members and sessions only, and drew *nothing has changed* over a World
   * renamed and re-versioned with every member as it was.
   */
  it('names the World’s own changes: its name, its version and its description', async () => {
    const harbour = newLorebook('Harbour');
    await created('lorebooks', harbour);
    const rain = {
      ...newWorld('Rain City'),
      version: '1.0.0',
      contents: [{ schema: LOREBOOK_SCHEMA, id: harbour.id, name: 'Harbour' }],
    };
    await created('worlds', rain);
    await publish(rain.id, {});
    await recorded(1);

    await edited('worlds', rain.id, (object) => ({
      ...object,
      name: 'Rain City Redux',
      version: '1.2.0',
      description: 'Now with tides.',
    }));

    const again = await preview(rain.id);
    const diff = publishDiff(
      again.previous!,
      fileSet(again.closure, { ticked: {}, history: false }),
      again.closure,
      false,
    );
    expect(diff.world).toEqual({
      renamedFrom: 'Rain City',
      version: { then: '1.0.0', now: '1.2.0' },
      changed: true,
    });
    // And nothing else moved: the member is as it was.
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.unchanged).toBe(1);
  });

  it('opens on the newest file of this World, and not on another World’s', async () => {
    const harbour = newLorebook('Harbour');
    await created('lorebooks', harbour);
    const rain = {
      ...newWorld('Rain City'),
      contents: [{ schema: LOREBOOK_SCHEMA, id: harbour.id, name: 'Harbour' }],
    };
    await created('worlds', rain);
    const other = {
      ...newWorld('Dry Town'),
      contents: [{ schema: LOREBOOK_SCHEMA, id: harbour.id, name: 'Harbour' }],
    };
    await created('worlds', other);

    await publish(rain.id, {});
    await edited('lorebooks', harbour.id, (object) => ({ ...object, description: 'Wet.' }));
    await publish(rain.id, {});
    await publish(other.id, {});
    const lines = await recorded(3);

    const again = await preview(rain.id);
    expect(again.previous).toEqual(lines[1]);
    expect(again.previous?.world).toEqual({
      id: rain.id,
      name: 'Rain City',
      kept: 'existing',
      version: rain.version,
      // The ledger's hash of the World's own page is the walk's, unchanged.
      about: again.closure.world?.about,
    });
    const diff = publishDiff(
      again.previous!,
      fileSet(again.closure, { ticked: {}, history: false }),
      again.closure,
      false,
    );
    // The edit came before the second file, so against it nothing changed.
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toBe(1);
    expect(again.closure.world?.id).toBe(rain.id);
  });
});
