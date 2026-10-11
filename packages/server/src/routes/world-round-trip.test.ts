// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACTOR_SCHEMA,
  firstLocalEntry,
  type ImportPreviewWorld,
  LOREBOOK_SCHEMA,
  newActor,
  newLorebook,
  newWorld,
  RENDITION_SCHEMA,
  type Rendition,
  SESSION_SCHEMA,
  type Turn,
  WORLD_FILE_MANIFEST,
  WORLD_SCHEMA,
  type World,
} from '@storyengine/shared';

import { create, list, read, update } from '../library.js';
import { FakeProvider } from '../providers/fake.js';
import {
  readRenditions,
  renditionIdFor,
  sessionAssetsRoot,
  writeRendition,
} from '../renditions/store.js';
import { readableGoals, readCurrentGoal } from '../sessions/goals.js';
import {
  listSessionFiles,
  readSession,
  readTurns,
  sessionFilePath,
  type SessionContext,
} from '../sessions/store.js';
import { makePng } from '../storage/card/test-png.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***P16.3's first end clause, as a test*** —
 * [P16.3f](../../../../docs/design/workplan/35-p16-world.md),
 * [16 §5.1](../../../../docs/design/16-publish.md),
 * [16 §5.2](../../../../docs/design/16-publish.md).
 *
 * *"A World published with one session ticked imports on a second account as a
 * World naming exactly what landed, with the session opening."* Every step is
 * the route a person's browser would call: Ned — the first account — plays a
 * session in his World through `POST /sessions/:id/turns` against a scripted
 * model, shows the narrator a picture, sends his character out of the room,
 * hides a line, and publishes the World with that session ticked through
 * `POST /api/publish`; Amy — a second account on the **same install**, where
 * every one of Ned's ids is taken — imports the bytes the download carried
 * through `POST /api/import/file`, and opens the session with
 * `GET /api/sessions/:id`.
 *
 * **What makes this the hard case** is the install it runs on. On another
 * install every id is free and lands as itself; here the library refuses each
 * of Ned's object ids and the turn index each of his turn ids, so Amy's
 * objects are re-minted and her turns re-keyed — and every place the session
 * names either, in values and in keys (`se.presence#<Vera>`, `hidden` by
 * turn), has to follow, or opening it records *hand edits* that delete her
 * Vera's state (the fact check's one *false*, 2026-10-10).
 */

const CONNECTION = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a77';
const PASSWORD = 'another long password';
/** A PNG by its signature, which is all the attachment store checks. */
const SNAPSHOT = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 1, 4, 1, 5]);

let server: TestServer;
let fake: FakeProvider;
let counter = 0;

beforeEach(async () => {
  fake = new FakeProvider({ script: [{ text: 'Rain on the quay, and a lantern going out.' }] });
  server = await makeTestServer({ providers: () => fake });
  await setUpAdmin(server, 'ned');
  const root = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'double.json'),
    JSON.stringify({
      id: CONNECTION,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-vision'],
      imageModels: ['fake-vision'],
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION, modelId: 'fake-vision' } }),
  );
  await server.services.accounts.create({ handle: 'amy', password: PASSWORD, role: 'user' });
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

async function signInAs(handle: 'ned' | 'amy'): Promise<void> {
  await server.request({ method: 'POST', url: '/api/auth/logout' });
  const signed = await server.request({
    method: 'POST',
    url: '/api/auth/login',
    payload: { handle, password: handle === 'ned' ? 'correct horse battery' : PASSWORD },
  });
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
}

function multipart(
  name: string,
  filename: string,
  bytes: Uint8Array,
  fields: Record<string, string> = {},
): { headers: Record<string, string>; payload: Buffer } {
  const boundary = '----storyengineRoundTrip';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      // Fields before the file, as the client sends them (`api.ts`).
      ...Object.entries(fields).map(([field, value]) =>
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${value}\r\n`,
        ),
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

/** The download `POST /api/publish` sends, as bytes. */
async function publish(worldId: string, sessionId: string): Promise<Buffer> {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/publish',
    headers: { ...cookies(), 'content-type': 'application/json' },
    payload: JSON.stringify({
      start: { kind: 'world', id: worldId },
      choices: { ticked: { [sessionId]: true }, history: false, keep: 'world' },
    }),
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers['content-type']).toBe('application/zip');
  return response.rawPayload;
}

/** `POST /api/import/file` with those bytes, as the panel's word sends them. */
async function importFile(bytes: Uint8Array, onConflict?: 'replace' | 'keep-both'): Promise<any> {
  const form = multipart(
    'file',
    'rain-city.seworld',
    bytes,
    onConflict === undefined ? {} : { onConflict },
  );
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/import/file',
    headers: { ...cookies(), ...form.headers },
    payload: form.payload,
  });
  expect([200, 201], response.body).toContain(response.statusCode);
  return response.json();
}

/** The head of a file — the manifest's local header and its bytes, as the panel slices it. */
function headOf(file: Uint8Array): Uint8Array {
  const entry = firstLocalEntry(file.subarray(0, 64 * 1024));
  if (entry?.name !== WORLD_FILE_MANIFEST) throw new Error('no manifest first');
  return file.subarray(0, entry.dataStart + entry.size);
}

/** `POST /api/import/file/preview` with a head, as the panel's look sends it. */
async function lookAt(head: Uint8Array): Promise<ImportPreviewWorld> {
  const form = multipart('file', 'rain-city.seworld', head);
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/import/file/preview',
    headers: { ...cookies(), ...form.headers },
    payload: form.payload,
  });
  expect(response.statusCode, response.body).toBe(200);
  const preview = response.json<{ preview: { object: ImportPreviewWorld } }>().preview;
  expect(preview.object.kind).toBe('world');
  return preview.object;
}

async function attach(sessionId: string): Promise<string> {
  const form = multipart('file', 'snapshot.png', SNAPSHOT);
  const response = await server.app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/attachments`,
    headers: { ...cookies(), ...form.headers },
    payload: form.payload,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ attachment: { digest: string } }>().attachment.digest;
}

/** One turn played through the route, waited for until the head moves. */
async function play(sessionId: string, input: object): Promise<string> {
  const before = (await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` })).body
    .session.headTurnId as string | null;
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: `k-${String(counter++)}`, headTurnId: before, input },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
  let head: string | null = null;
  await eventually(async () => {
    const now = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    head = now.body.session.headTurnId as string | null;
    return head !== null && head !== before;
  });
  return head!;
}

const sessions = (): SessionContext => server.services.sessions;

/** Every string in a value, keys included — what *no old id remains* is checked over. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...strings(inner)]);
}

/** Every string but what sits under a `foreign` key, which is provenance and names the sender on purpose. */
function stringsOutsideForeign(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOutsideForeign);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key === 'foreign' ? [] : [key, ...stringsOutsideForeign(inner)],
  );
}

/** sha256 of every file under a directory, by path below it. */
async function fingerprint(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else
        out.set(
          full.slice(root.length),
          createHash('sha256')
            .update(await readFile(full))
            .digest('hex'),
        );
    }
  }
  await walk(root);
  return out;
}

/**
 * ***A picture of a turn***, its pixels on disk beside its record — what the
 * illustrate step leaves, written directly: the step's own path is its tests'.
 */
async function illustrate(
  handle: string,
  sessionId: string,
  turnId: string,
  index: number,
): Promise<string> {
  const layout = server.services.layout;
  const renditionId = renditionIdFor(turnId, index);
  const pixels = makePng(7, 6 + index);
  const assets = sessionAssetsRoot(layout, handle, sessionId);
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, `${renditionId}.png`), pixels);
  await writeRendition(layout, handle, sessionId, {
    schema: RENDITION_SCHEMA,
    id: renditionId,
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
      path: `${renditionId}.png`,
      mime: 'image/png',
      bytes: pixels.length,
      digest: `sha256:${createHash('sha256').update(pixels).digest('hex')}`,
    },
    provenance: {
      at: new Date().toISOString(),
      binding: { connectionId: CONNECTION, modelId: 'fake-vision' },
      answeredAs: null,
      seed: 1,
      workflow: {},
    },
    error: null,
    digest: `d-${String(index)}`,
    ordering: index,
  } as unknown as Rendition);
  return renditionId;
}

interface Played {
  world: World;
  vera: { id: string; name: string };
  harbour: { id: string; name: string };
  sessionId: string;
  turnIds: string[];
  pictured: string;
  renditionId: string;
  digest: string;
}

/**
 * ***Ned's World, played*** — Vera and the Harbour in Rain City; a session
 * started in it (so it is a member), cast with Vera and reading the Harbour;
 * two turns through the route, the first showing the narrator a picture; Vera
 * sent out of the room by hand, which is an effect keyed `se.presence#<Vera>`;
 * a picture of the first turn, on disk, and chosen; the second line hidden.
 */
async function nedPlays(): Promise<Played> {
  const library = server.services.library;
  const harbour = newLorebook('Harbour');
  await create(library, 'ned', harbour, LOREBOOK_SCHEMA);
  const vera = { ...newActor('Vera'), lore: [{ id: harbour.id, name: 'Harbour' }] };
  await create(library, 'ned', vera, ACTOR_SCHEMA, { cardPixels: makePng(8, 1) });
  const world: World = {
    ...newWorld('Rain City'),
    contents: [
      { schema: ACTOR_SCHEMA, id: vera.id, name: 'Vera' },
      { schema: LOREBOOK_SCHEMA, id: harbour.id, name: 'Harbour' },
    ],
  };
  await create(library, 'ned', world, WORLD_SCHEMA);

  const started = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: {
      name: 'Night one',
      world: world.id,
      cast: { persona: null, actors: [vera.id] },
    },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const sessionId = started.body.session.id as string;

  const digest = await attach(sessionId);
  const first = await play(sessionId, {
    text: 'Look at this.',
    attachments: [{ digest, caption: 'the quay at dusk' }],
  });
  const second = await play(sessionId, { text: 'We walk on.' });

  // Vera leaves the room — a person's write, keyed by her id.
  const left = await server.request({
    method: 'PUT',
    url: `/api/sessions/${sessionId}/channels/${encodeURIComponent(`se.presence#${vera.id}`)}`,
    payload: { value: false },
  });
  expect(left.status, JSON.stringify(left.body)).toBe(200);

  // A picture of the first turn, its pixels on disk, chosen as its picture.
  const renditionId = await illustrate('ned', sessionId, first, 0);
  const session = await readSession(sessions(), 'ned', sessionId);
  await writeJsonAtomic(sessionFilePath(server.services.layout, 'ned', sessionId), {
    ...session,
    renditionSelection: { [first]: renditionId },
    hidden: { [second]: true },
  });

  const turns = await readTurns(sessions(), 'ned', sessionId);
  return {
    world: read(library, 'ned', world.id).body as World,
    vera,
    harbour,
    sessionId,
    turnIds: [...turns.keys()],
    pictured: first,
    renditionId,
    digest,
  };
}

/** Amy's sessions, by the index. */
async function amysSessions(): Promise<{ id: string; name: string }[]> {
  return (await listSessionFiles(sessions(), 'amy')).map((one) => ({ id: one.id, name: one.name }));
}

// ── The end clause ──────────────────────────────────────────────────────────

describe('a World published with one session ticked, imported on a second account', () => {
  it('lands as a World naming exactly what landed, and the session opens as it was played', async () => {
    const ned = await nedPlays();
    const nedSessionRoot = server.services.layout.sessionRoot('ned', ned.sessionId);
    const nedLibrary = list(server.services.library, 'ned').map((row) => [row.id, row.contentHash]);
    const nedSessionBefore = await fingerprint(nedSessionRoot);
    const nedTurnsBefore = await readTurns(sessions(), 'ned', ned.sessionId);
    const file = await publish(ned.world.id, ned.sessionId);

    await signInAs('amy');
    // ── The look before it lands, from the head alone — the session counted
    // with its turns, its picture and the picture its move carried (2026-10-11,
    // the P16.3f review: a preview that dropped the counts passed) ──
    expect((await lookAt(headOf(file))).sessions).toEqual([
      {
        id: ned.sessionId,
        name: 'Night one',
        turns: ned.turnIds.length,
        pictures: 1,
        attachments: 1,
        mode: expect.any(String),
        here: false,
      },
    ]);
    const answer = await importFile(file);

    // ── The World, naming exactly what landed ──
    const report = answer.report;
    expect(report.source).toBe('storyengine-world');
    const landedSessions = await amysSessions();
    expect(landedSessions).toHaveLength(1);
    const landed = landedSessions[0]!;
    const amyOwn = list(server.services.library, 'amy').filter((row) => row.owner === 'user:amy');
    const amyVera = amyOwn.find((row) => row.name === 'Vera')!;
    const amyHarbour = amyOwn.find((row) => row.name === 'Harbour')!;
    const amyWorlds = amyOwn.filter((row) => row.schemaId === WORLD_SCHEMA);
    expect(amyWorlds).toHaveLength(1);
    const world = amyWorlds[0]!.body as World;
    expect(world.contents.map((entry) => [entry.schema, entry.id])).toEqual([
      [ACTOR_SCHEMA, amyVera.id],
      [LOREBOOK_SCHEMA, amyHarbour.id],
      [SESSION_SCHEMA, landed.id],
    ]);
    // Re-minted, every one: Ned holds each of his ids on this install.
    expect([amyVera.id, amyHarbour.id, amyWorlds[0]!.id, landed.id]).not.toContain(ned.vera.id);
    expect(amyWorlds[0]!.id).not.toBe(ned.world.id);
    // And the panel's line, off the World's own row.
    expect(answer.world).toEqual({
      id: amyWorlds[0]!.id,
      name: 'Rain City',
      members: 2,
      sessions: 1,
      dangling: 0,
    });

    // ── The session opens, with its turns and pictures ──
    const turnsBefore = await readTurns(sessions(), 'amy', landed.id);
    const opened = await server.request({ method: 'GET', url: `/api/sessions/${landed.id}` });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const session = await readSession(sessions(), 'amy', landed.id);
    expect(session?.cast?.actors).toEqual([amyVera.id]);
    // Stamped with the arrival key, per account, that a later import finds it by.
    expect(session?.origin?.originalFilename).toBe(`seworld:session/${ned.sessionId}`);
    expect(session?.lore).toContain(amyHarbour.id);
    const turns = await readTurns(sessions(), 'amy', landed.id);
    expect(turns.size).toBe(ned.turnIds.length);
    // Re-keyed: Ned's turns are his, and the index holds one row per id.
    for (const id of turns.keys()) expect(ned.turnIds).not.toContain(id);
    // ***Opening it recorded nothing*** — no hand-edit turn, the head where
    // the file left it: the channel keyed by Ned's Vera was renamed to Amy's.
    expect(turns.size).toBe(turnsBefore.size);
    expect(Object.keys(session!.channels)).toContain(`se.presence#${amyVera.id}`);
    expect(session!.channels[`se.presence#${amyVera.id}`]?.value).toBe(false);
    const transcript = await server.request({
      method: 'GET',
      url: `/api/sessions/${landed.id}/turns`,
    });
    expect(transcript.status).toBe(200);

    // The picture of the first turn, its pixels, and its selection by turn.
    const pictured = [...turns.values()].find(
      (turn) => (turn as Turn & { foreign?: { id: string } }).foreign?.id === ned.pictured,
    )!;
    expect(pictured).toBeDefined();
    expect(session!.renditionSelection).toEqual({ [pictured.id]: ned.renditionId });
    const picture = await server.app.inject({
      method: 'GET',
      url: `/api/sessions/${landed.id}/renditions/${encodeURIComponent(ned.renditionId)}/asset`,
      headers: cookies(),
    });
    expect(picture.statusCode, picture.body).toBe(200);
    // The picture shown on the first move, served from Amy's session.
    const attachment = await server.app.inject({
      method: 'GET',
      url: `/api/sessions/${landed.id}/attachments/${encodeURIComponent(ned.digest)}`,
      headers: cookies(),
    });
    expect(attachment.statusCode, attachment.body).toBe(200);
    expect(Buffer.compare(attachment.rawPayload, SNAPSHOT)).toBe(0);

    // No old turn id anywhere in what Amy holds, outside `foreign` — keys included.
    const document = await readFile(
      sessionFilePath(server.services.layout, 'amy', landed.id),
      'utf8',
    );
    const held = [JSON.parse(document), ...turns.values()];
    expect(held.flatMap(stringsOutsideForeign).filter((one) => ned.turnIds.includes(one))).toEqual(
      [],
    );
    expect(held.flatMap(strings).some((one) => one === ned.vera.id)).toBe(false);

    // ── Ned's session and turns are untouched ──
    expect(await fingerprint(nedSessionRoot)).toEqual(nedSessionBefore);
    expect([...(await readTurns(sessions(), 'ned', ned.sessionId)).keys()]).toEqual([
      ...nedTurnsBefore.keys(),
    ]);
    expect(
      list(server.services.library, 'ned')
        .filter((row) => row.owner === 'user:ned')
        .map((row) => [row.id, row.contentHash]),
    ).toEqual(
      nedLibrary.filter(([id]) => read(server.services.library, 'ned', id!).owner === 'user:ned'),
    );
  });

  it('doubles nothing when Amy imports the same file again', async () => {
    const ned = await nedPlays();
    const file = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    await importFile(file);
    const first = await amysSessions();
    const library = list(server.services.library, 'amy').map((row) => [row.id, row.contentHash]);
    const root = server.services.layout.sessionRoot('amy', first[0]!.id);
    const before = await fingerprint(root);

    const again = await importFile(file);

    expect(await amysSessions()).toEqual(first);
    expect(list(server.services.library, 'amy').map((row) => [row.id, row.contentHash])).toEqual(
      library,
    );
    expect(await fingerprint(root)).toEqual(before);
    const row = again.report.items.find((item: { source: string }) =>
      item.source.endsWith('session-export.json'),
    );
    expect(row).toMatchObject({ disposition: 'unchanged', objectId: first[0]!.id });
    expect(again.world.sessions).toBe(1);
  });

  it('reads as already here when Ned imports his own file', async () => {
    const ned = await nedPlays();
    const file = await publish(ned.world.id, ned.sessionId);
    const root = server.services.layout.sessionRoot('ned', ned.sessionId);
    const before = await fingerprint(root);

    const answer = await importFile(file);

    const row = answer.report.items.find((item: { source: string }) =>
      item.source.endsWith('session-export.json'),
    );
    expect(row).toMatchObject({
      disposition: 'unchanged',
      objectId: ned.sessionId,
      notes: [
        {
          key: 'import.world.sessionAlreadyHere',
          params: { session: 'Night one' },
          level: 'info',
        },
      ],
    });
    expect((await listSessionFiles(sessions(), 'ned')).map((one) => one.id)).toEqual([
      ned.sessionId,
    ]);
    expect(await fingerprint(root)).toEqual(before);
    const world = read(server.services.library, 'ned', ned.world.id).body as World;
    expect(world.contents.filter((entry) => entry.schema === SESSION_SCHEMA)).toEqual([
      { schema: SESSION_SCHEMA, id: ned.sessionId, name: 'Night one' },
    ]);
  });

  it('lands only the new turns of a session Ned played on and published again', async () => {
    const ned = await nedPlays();
    const first = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    await importFile(first);
    const [landed] = await amysSessions();
    const held = await readTurns(sessions(), 'amy', landed!.id);

    await signInAs('ned');
    // The head is Vera's departure; two more turns on from it.
    await play(ned.sessionId, { text: 'And then the bell.' });
    await play(ned.sessionId, { text: 'Under the water.' });
    const nedTurns = await readTurns(sessions(), 'ned', ned.sessionId);
    const second = await publish(ned.world.id, ned.sessionId);

    await signInAs('amy');
    // Quietly, when it grows as when it lands (2026-10-11, the P16.3f review).
    const warmed = vi.fn();
    server.services.sessions.imported = warmed;
    const answer = await importFile(second);

    expect(warmed).not.toHaveBeenCalled();
    const row = answer.report.items.find((item: { source: string }) =>
      item.source.endsWith('session-export.json'),
    );
    expect(row).toMatchObject({
      disposition: 'converted',
      objectId: landed!.id,
      notes: [{ key: 'import.world.sessionGrew', params: { session: 'Night one', turns: 2 } }],
    });
    // One session still, holding every turn it had and the two new ones.
    expect(await amysSessions()).toEqual([landed]);
    const now = await readTurns(sessions(), 'amy', landed!.id);
    expect(now.size).toBe(nedTurns.size);
    for (const [id, turn] of held) expect(now.get(id)).toEqual(turn);
    // Nobody played here, so the session opens where Ned's now does.
    const session = await readSession(sessions(), 'amy', landed!.id);
    const head = now.get(session!.headTurnId!) as Turn & { foreign?: { id: string } };
    expect(head.foreign?.id).toBe(
      (await readSession(sessions(), 'ned', ned.sessionId))!.headTurnId,
    );
    // And opening it records nothing: the channels were derived along the new path.
    await server.request({ method: 'GET', url: `/api/sessions/${landed!.id}` });
    expect((await readTurns(sessions(), 'amy', landed!.id)).size).toBe(now.size);
    // The World names it once.
    const world = list(server.services.library, 'amy', WORLD_SCHEMA)[0]!.body as World;
    expect(world.contents.filter((entry) => entry.schema === SESSION_SCHEMA)).toHaveLength(1);
  });

  /**
   * ***Whether to re-key depends on somebody else, so idempotency cannot***
   * (the fact check's third consequence). Ned deletes his session after Amy
   * imported it: his turn ids are free now, and an import that asked only
   * them would keep them and land a second copy of the story beside the one
   * Amy re-keyed. Asked for the ids Amy derives too, it is already here.
   */
  it('doubles nothing after Ned deletes the session the file came from', async () => {
    const ned = await nedPlays();
    const file = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    await importFile(file);
    const first = await amysSessions();
    const root = server.services.layout.sessionRoot('amy', first[0]!.id);
    const before = await fingerprint(root);

    await signInAs('ned');
    const deleted = await server.request({
      method: 'DELETE',
      url: `/api/sessions/${ned.sessionId}`,
    });
    expect(deleted.status, JSON.stringify(deleted.body)).toBeLessThan(300);
    await signInAs('amy');
    const again = await importFile(file);

    expect(await amysSessions()).toEqual(first);
    expect(await fingerprint(root)).toEqual(before);
    const row = again.report.items.find((item: { source: string }) =>
      item.source.endsWith('session-export.json'),
    );
    expect(row).toMatchObject({ disposition: 'unchanged', objectId: first[0]!.id });
  });

  /**
   * ***The arrival key finds the session, and the disk says how it is keyed***
   * (2026-10-11, the P16.3f review). Ned deletes his session *before* Amy
   * imports, so nobody holds the file's turn ids and hers keeps them; then he
   * restores it, and the index's rows for those ids go back to his session
   * (plan risk 10's duplicate ids). Amy importing the same file again finds
   * Ned holding the file's ids, re-keys, finds nothing under the ids she
   * derives — and her earlier arrival by its key. ~~That session was handed the
   * re-keyed document~~, and every turn of it was appended beside the ones it
   * holds under the file's ids: the whole story twice, in one session, with a
   * row saying it grew. The session the key finds is asked which ids it
   * actually holds, and is given the document keyed that way.
   */
  it('doubles nothing when Ned restores the session after Amy took the file’s ids', async () => {
    const ned = await nedPlays();
    const file = await publish(ned.world.id, ned.sessionId);
    const deleted = await server.request({
      method: 'DELETE',
      url: `/api/sessions/${ned.sessionId}`,
    });
    expect(deleted.status, JSON.stringify(deleted.body)).toBeLessThan(300);
    await signInAs('amy');
    await importFile(file);
    const first = await amysSessions();
    const held = await readTurns(sessions(), 'amy', first[0]!.id);
    // Nobody held them, so they arrived as they left.
    expect([...held.keys()].sort()).toEqual([...ned.turnIds].sort());
    const root = server.services.layout.sessionRoot('amy', first[0]!.id);
    const before = await fingerprint(root);

    await signInAs('ned');
    const trash = await server.request({ method: 'GET', url: '/api/me/trash' });
    const entry = (trash.body.entries as { id: string; kind?: string }[])[0];
    const restored = await server.request({
      method: 'POST',
      url: '/api/me/trash/restore',
      payload: { id: entry?.id },
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    await signInAs('amy');
    const again = await importFile(file);

    expect(await amysSessions()).toEqual(first);
    expect((await readTurns(sessions(), 'amy', first[0]!.id)).size).toBe(held.size);
    expect(await fingerprint(root)).toEqual(before);
    const row = again.report.items.find((item: { source: string }) =>
      item.source.endsWith('session-export.json'),
    );
    expect(row).toMatchObject({ disposition: 'unchanged', objectId: first[0]!.id });

    // ***And Ned plays on and publishes again.*** His new turns are his on
    // this install, and Amy's session holds the file's ids rather than any she
    // derives — risk 10's two claims on one id — so they can land under
    // neither: refused, said on the row, and nothing doubles.
    await signInAs('ned');
    await play(ned.sessionId, { text: 'And then the bell.' });
    const later = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    const third = await importFile(later);

    expect((await readTurns(sessions(), 'amy', first[0]!.id)).size).toBe(held.size);
    expect(await fingerprint(root)).toEqual(before);
    expect(
      third.report.items.find((item: { source: string }) =>
        item.source.endsWith('session-export.json'),
      ),
    ).toMatchObject({
      disposition: 'unrecognised',
      notes: [{ key: 'import.world.sessionRefused', params: { reason: 'already-here' } }],
    });
  });

  it('keeps the turn ids an install holds none of', async () => {
    const ned = await nedPlays();
    const file = await publish(ned.world.id, ned.sessionId);
    const other = await makeTestServer();
    try {
      await setUpAdmin(other, 'amy');
      const form = multipart('file', 'rain-city.seworld', file);
      const response = await other.app.inject({
        method: 'POST',
        url: '/api/import/file',
        headers: {
          cookie: [...other.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
          'x-csrf-token': other.cookies.get('se_csrf') ?? '',
          ...form.headers,
        },
        payload: form.payload,
      });
      expect(response.statusCode, response.body).toBe(201);
      const [landed] = await listSessionFiles(other.services.sessions, 'amy');
      const turns = await readTurns(other.services.sessions, 'amy', landed!.id);
      // P11.10's default: nobody here holds them, so they arrive as they left.
      expect([...turns.keys()].sort()).toEqual([...ned.turnIds].sort());
    } finally {
      await other.dispose();
    }
  });
});

// ── A session published again, and what the recipient did meanwhile ─────────

/**
 * ***The review of 2026-10-11*** (P16.3f): a session already here is handed
 * everything the file has that it lacks — turns, pictures, and what the
 * sender wrote without a turn — and nothing of the file's that would undo what
 * the recipient did with their copy, or put a second copy of an object into
 * the story.
 */
describe('a session Amy already has, published again', () => {
  /** Amy's turn that came from Ned's, by its `foreign` id. */
  async function amysTurnFor(sessionId: string, nedTurnId: string): Promise<string> {
    const turns = await readTurns(sessions(), 'amy', sessionId);
    const found = [...turns.values()].find(
      (turn) => (turn as Turn & { foreign?: { id: string } }).foreign?.id === nedTurnId,
    );
    expect(found, `Amy's copy of ${nedTurnId}`).toBeDefined();
    return found!.id;
  }

  it('lands the pictures of turns Amy already has', async () => {
    const ned = await nedPlays();
    const firstFile = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    await importFile(firstFile);
    const [landed] = await amysSessions();

    // Ned illustrates the second turn — no new turn — and publishes again.
    await signInAs('ned');
    const second = ned.turnIds.find((id) => id !== ned.pictured && id !== ned.turnIds.at(-1))!;
    const added = await illustrate('ned', ned.sessionId, second, 0);
    const file = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    const answer = await importFile(file);

    const row = answer.report.items.find((item: { source: string }) =>
      item.source.endsWith('session-export.json'),
    );
    expect(row).toMatchObject({
      disposition: 'converted',
      objectId: landed!.id,
      notes: [{ key: 'import.world.sessionPicturesAdded', params: { pictures: 1 } }],
    });
    const renditions = await readRenditions(server.services.layout, 'amy', landed!.id);
    expect([...renditions.keys()].sort()).toEqual([ned.renditionId, added].sort());
    const amySecond = await amysTurnFor(landed!.id, second);
    expect(renditions.get(added)?.turnId).toBe(amySecond);
    const picture = await server.app.inject({
      method: 'GET',
      url: `/api/sessions/${landed!.id}/renditions/${encodeURIComponent(added)}/asset`,
      headers: cookies(),
    });
    expect(picture.statusCode, picture.body).toBe(200);
    expect((await readTurns(sessions(), 'amy', landed!.id)).size).toBe(ned.turnIds.length);
  });

  it('brings the goal and the cast member Ned added since, when nobody played here', async () => {
    const ned = await nedPlays();
    const firstFile = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    await importFile(firstFile);
    const [landed] = await amysSessions();

    // Ned writes a goal mid-game and moves play onto it; Wren joins the World
    // and the cast; then one more turn.
    await signInAs('ned');
    const wren = newActor('Wren');
    await create(server.services.library, 'ned', wren, ACTOR_SCHEMA);
    const world = read(server.services.library, 'ned', ned.world.id);
    await update(
      server.services.library,
      'ned',
      ned.world.id,
      {
        ...(world.body as World),
        contents: [
          ...(world.body as World).contents,
          { schema: ACTOR_SCHEMA, id: wren.id, name: 'Wren' },
        ],
      },
      world.contentHash,
    );
    const goal = await server.request({
      method: 'POST',
      url: `/api/sessions/${ned.sessionId}/goals`,
      payload: {
        goal: {
          statement: 'Get the ledger out of the Foundry.',
          detail: null,
          visibility: 'player',
          completion: { kind: 'manual' },
          thenDefault: 'continue-open',
          next: null,
        },
      },
    });
    expect(goal.status, JSON.stringify(goal.body)).toBe(200);
    const goalId = (goal.body.session.goals as { id: string }[]).at(-1)!.id;
    const onto = await server.request({
      method: 'PUT',
      url: `/api/sessions/${ned.sessionId}/channels/${encodeURIComponent('se.goal.current')}`,
      payload: { value: goalId },
    });
    expect(onto.status, JSON.stringify(onto.body)).toBe(200);
    const cast = await server.request({
      method: 'PUT',
      url: `/api/sessions/${ned.sessionId}/cast`,
      payload: { persona: null, actors: [ned.vera.id, wren.id] },
    });
    expect(cast.status, JSON.stringify(cast.body)).toBe(200);
    await play(ned.sessionId, { text: 'To the Foundry.' });
    const file = await publish(ned.world.id, ned.sessionId);

    await signInAs('amy');
    await importFile(file);

    const session = (await readSession(sessions(), 'amy', landed!.id))!;
    const nedSession = (await readSession(sessions(), 'ned', ned.sessionId))!;
    expect(readCurrentGoal(nedSession.channels, readableGoals(nedSession.goals))?.statement).toBe(
      'Get the ledger out of the Foundry.',
    );
    // The head followed, and the goal it is on is one the session holds.
    expect(readCurrentGoal(session.channels, readableGoals(session.goals))?.statement).toBe(
      'Get the ledger out of the Foundry.',
    );
    const amyWren = list(server.services.library, 'amy', ACTOR_SCHEMA).find(
      (row) => row.owner === 'user:amy' && row.name === 'Wren',
    )!;
    expect(session.cast?.actors).toHaveLength(2);
    expect(session.cast?.actors).toContain(amyWren.id);
  });

  /**
   * Ned edits Vera and plays on, keyed by her; Amy keeps both. The World's
   * Vera lands beside hers as a copy — and the session, which plays her Vera,
   * keeps playing her: the appended turn names the Vera every earlier turn
   * names, never the copy, or the next turn would be cast with two.
   */
  it('keeps the session on the Vera it plays when Amy keeps both', async () => {
    const ned = await nedPlays();
    const firstFile = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    await importFile(firstFile);
    const [landed] = await amysSessions();
    const amyVera = list(server.services.library, 'amy', ACTOR_SCHEMA).find(
      (row) => row.owner === 'user:amy' && row.name === 'Vera',
    )!;

    await signInAs('ned');
    const vera = read(server.services.library, 'ned', ned.vera.id);
    await update(
      server.services.library,
      'ned',
      ned.vera.id,
      { ...(vera.body as object), description: 'Changed by Ned.' },
      vera.contentHash,
    );
    const back = await server.request({
      method: 'PUT',
      url: `/api/sessions/${ned.sessionId}/channels/${encodeURIComponent(`se.presence#${ned.vera.id}`)}`,
      payload: { value: true },
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const file = await publish(ned.world.id, ned.sessionId);

    await signInAs('amy');
    const answer = await importFile(file, 'keep-both');

    const veras = list(server.services.library, 'amy', ACTOR_SCHEMA).filter(
      (row) => row.owner === 'user:amy' && row.name === 'Vera',
    );
    expect(veras).toHaveLength(2);
    const copy = veras.find((row) => row.id !== amyVera.id)!;
    const row = answer.report.items.find((item: { source: string }) =>
      item.source.endsWith('session-export.json'),
    );
    expect(row).toMatchObject({ disposition: 'converted', objectId: landed!.id });
    const session = (await readSession(sessions(), 'amy', landed!.id))!;
    const turns = await readTurns(sessions(), 'amy', landed!.id);
    expect(turns.size).toBe(ned.turnIds.length + 1);
    const everything = [session, ...turns.values()].flatMap(strings);
    expect(everything.filter((one) => one.includes(copy.id))).toEqual([]);
    expect(session.channels[`se.presence#${amyVera.id}`]?.value).toBe(true);
  });

  /**
   * What Amy did with her copy is hers: she showed the hidden line, cleared
   * the chosen picture, re-described her picture, and went back to the first
   * turn to read. Ned plays on and publishes again — the new turns arrive,
   * and none of that is undone.
   */
  it('keeps what Amy did with her copy: her hides, her picture, and where she was', async () => {
    const ned = await nedPlays();
    const firstFile = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    await importFile(firstFile);
    const [landed] = await amysSessions();
    const first = await amysTurnFor(landed!.id, ned.pictured);
    const hiddenOne = ned.turnIds.find((id) => id !== ned.pictured && id !== ned.turnIds.at(-1))!;
    const second = await amysTurnFor(landed!.id, hiddenOne);
    expect((await readSession(sessions(), 'amy', landed!.id))!.hidden).toEqual({ [second]: true });

    const moved = await server.request({
      method: 'PUT',
      url: `/api/sessions/${landed!.id}/head`,
      payload: { turnId: first },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const mine = (await readSession(sessions(), 'amy', landed!.id))!;
    await writeJsonAtomic(sessionFilePath(server.services.layout, 'amy', landed!.id), {
      ...mine,
      hidden: {},
      renditionSelection: {},
    });
    const layout = server.services.layout;
    const record = (await readRenditions(layout, 'amy', landed!.id)).get(ned.renditionId)!;
    await writeRendition(layout, 'amy', landed!.id, {
      ...record,
      scope: { anchor: 'Amy’s own lantern' },
    });
    const pixels = await fingerprint(sessionAssetsRoot(layout, 'amy', landed!.id));

    await signInAs('ned');
    await play(ned.sessionId, { text: 'And then the bell.' });
    await play(ned.sessionId, { text: 'Under the water.' });
    const file = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    const answer = await importFile(file);

    const row = answer.report.items.find((item: { source: string }) =>
      item.source.endsWith('session-export.json'),
    );
    expect(row).toMatchObject({
      disposition: 'converted',
      notes: [{ key: 'import.world.sessionGrew', params: { turns: 2 } }],
    });
    const after = (await readSession(sessions(), 'amy', landed!.id))!;
    expect(after.headTurnId).toBe(first);
    expect(after.hidden ?? {}).not.toHaveProperty(second);
    expect(after.renditionSelection ?? {}).not.toHaveProperty(first);
    const kept = (await readRenditions(layout, 'amy', landed!.id)).get(ned.renditionId)!;
    expect(kept.scope).toEqual({ anchor: 'Amy’s own lantern' });
    expect(await fingerprint(sessionAssetsRoot(layout, 'amy', landed!.id))).toEqual(pixels);
  });

  it('lands an archived session where Amy can see it', async () => {
    const ned = await nedPlays();
    const archived = await server.request({
      method: 'PATCH',
      url: `/api/sessions/${ned.sessionId}`,
      payload: { archived: true },
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const file = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    const answer = await importFile(file);

    expect(answer.world.sessions).toBe(1);
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect((listed.body.sessions as { name: string }[]).map((one) => one.name)).toEqual([
      'Night one',
    ]);
    const [landed] = await amysSessions();
    expect((await readSession(sessions(), 'amy', landed!.id))!.archivedAt).toBeUndefined();
  });

  /**
   * ***A lock and a hidden field are paths under a channel key*** — the Scene
   * mode's `se.track.character#<actor>/mood`. Ned locks Vera's mood and hides
   * her thoughts; on Amy's copy the paths name her Vera, or the lock would
   * never match her Vera's key and the hidden field would show.
   */
  it('follows a lock and a hidden field to the Vera Amy has', async () => {
    const ned = await nedPlays();
    for (const [channel, field] of [
      ['se.track.locks', 'mood'],
      ['se.track.hidden', 'thoughts'],
    ] as const) {
      const put = await server.request({
        method: 'PUT',
        url: `/api/sessions/${ned.sessionId}/channels/${encodeURIComponent(channel)}`,
        payload: { value: [`se.track.character#${ned.vera.id}/${field}`] },
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
    }
    const file = await publish(ned.world.id, ned.sessionId);
    await signInAs('amy');
    await importFile(file);

    const [landed] = await amysSessions();
    const amyVera = list(server.services.library, 'amy', ACTOR_SCHEMA).find(
      (row) => row.owner === 'user:amy' && row.name === 'Vera',
    )!;
    const turnsBefore = (await readTurns(sessions(), 'amy', landed!.id)).size;
    await server.request({ method: 'GET', url: `/api/sessions/${landed!.id}` });
    const session = (await readSession(sessions(), 'amy', landed!.id))!;
    expect(session.channels['se.track.locks']?.value).toEqual([
      `se.track.character#${amyVera.id}/mood`,
    ]);
    expect(session.channels['se.track.hidden']?.value).toEqual([
      `se.track.character#${amyVera.id}/thoughts`,
    ]);
    // Opening it recorded nothing: the effects that set them say the same.
    const turns = await readTurns(sessions(), 'amy', landed!.id);
    expect(turns.size).toBe(turnsBefore);
    // Ned's Vera nowhere in what Amy holds — not even inside a string.
    const everything = [session, ...turns.values()].flatMap(stringsOutsideForeign);
    expect(everything.filter((one) => one.includes(ned.vera.id))).toEqual([]);
  });
});
