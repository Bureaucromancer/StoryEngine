// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACTOR_SCHEMA,
  type ImportNote,
  LOREBOOK_SCHEMA,
  newActor,
  newLorebook,
  newSetup,
  newTreatment,
  newWorld,
  PUBLISH_RECORD_SCHEMA,
  type PublishPreview,
  type PublishRecord,
  readWorldFileManifest,
  SESSION_SCHEMA,
  WORLD_FILE_MANIFEST,
  WORLD_SCHEMA,
  uuidv7,
  type World,
  type WorldFileManifest,
} from '@storyengine/shared';

import { create, list, read, update } from '../library.js';
import { digestOf } from '../library/assets.js';
import { appendTurnToSession, readSession, setName } from '../sessions/store.js';
import { makePng } from '../storage/card/test-png.js';
import { readZipDirectory, readZipEntry } from '../storage/zip.js';
import {
  eventually,
  makeTestServer,
  settled,
  setUpAdmin,
  type TestServer,
} from '../test-server.js';
import { PUBLISH_NOTES_HEADER_MAX } from './publish.js';

/**
 * ***Publish, through its routes*** — [16 §5](../../../../docs/design/16-publish.md),
 * [16 §3](../../../../docs/design/16-publish.md),
 * [16 §2](../../../../docs/design/16-publish.md), [P16.3d].
 *
 * **The stage's end clause is *the one-write rule holds in every origin's
 * test*,** so every origin is here with the library read whole before and
 * after: one object writes nothing at all, a snapshot nothing, a World start
 * nothing — the World's own hash included — and a selection kept as a World
 * exactly one object, which is that World. *The review writes one thing*
 * ([16 §5]) is held harder still: the preview is checked against the whole
 * data directory, the index's every row, the ledger and the scratch root.
 *
 * Then what the confirm promises beyond the file: refusals that keep nothing
 * (too large, no room, a bad name) because the World is created **after** the
 * plan; a change between plan and write that fails the file and keeps the
 * World; drift reported, never prevented; the ledger written when the
 * download finished and **not** when it was abandoned — the last over a real
 * socket, since `inject` cannot leave ([`disconnect.ts`] says why); and a
 * World published here passing P16.3c's layout and leak checks — the
 * unticked session's name and id nowhere in the bytes.
 */

/**
 * ***Two seams the route's failures need, and nothing else*** (2026-10-11, the
 * P16.3d review). Each passes through untouched unless a test sets it, and
 * every test starts with both unset:
 *
 * - `readGone` — the file the route sends cannot be opened (the scratch file
 *   gone, a process out of descriptors): the stream fails before its first
 *   byte, which fastify answers as a `500` that still *finishes*.
 * - `writeThrows` — the World file's write throws this instead of writing:
 *   the disk filling (`ENOSPC`) or failing (`EIO`) after a selection's World
 *   was kept, which no plan can see coming.
 */
const seams = vi.hoisted(() => ({
  readGone: false,
  writeThrows: null as Error | null,
}));

vi.mock('../storage/files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/files.js')>();
  return {
    ...actual,
    openFileRead: (path: string) => actual.openFileRead(seams.readGone ? `${path}.gone` : path),
  };
});

vi.mock('../packaging/world-file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../packaging/world-file.js')>();
  return {
    ...actual,
    writeWorldFile: async (...args: Parameters<typeof actual.writeWorldFile>) => {
      if (seams.writeThrows !== null) throw seams.writeThrows;
      return await actual.writeWorldFile(...args);
    },
  };
});

let server: TestServer;

beforeEach(async () => {
  seams.readGone = false;
  seams.writeThrows = null;
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The cookie and CSRF headers `server.request` would have sent. */
function asTheBrowser(): Record<string, string> {
  const headers: Record<string, string> = {
    cookie: [...server.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
  };
  const csrf = server.cookies.get('se_csrf');
  if (csrf !== undefined) headers['x-csrf-token'] = csrf;
  return headers;
}

interface Published {
  status: number;
  headers: Record<string, unknown>;
  bytes: Buffer;
  body: any;
}

/** `POST /api/publish`, keeping the body as bytes — it is a zip. */
async function publish(body: unknown): Promise<Published> {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/publish',
    headers: { ...asTheBrowser(), 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
  let parsed: unknown = null;
  if (!(response.headers['content-type'] ?? '').startsWith('application/zip')) {
    try {
      parsed = response.json();
    } catch {
      parsed = response.body;
    }
  }
  return {
    status: response.statusCode,
    headers: response.headers,
    bytes: response.rawPayload,
    body: parsed,
  };
}

async function previewOf(
  start: { kind: 'world'; id: string } | { kind: 'objects'; ids: string[] },
): Promise<PublishPreview> {
  const answer = await server.request({
    method: 'POST',
    url: '/api/publish/preview',
    payload: { start },
  });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return answer.body as PublishPreview;
}

const choices = (
  over: Partial<{
    ticked: Record<string, boolean>;
    history: boolean;
    keep: 'world' | 'snapshot';
    name: string;
  }> = {},
) => ({ ticked: {}, history: false, keep: 'world' as const, ...over });

/** The archive's members, by name, in order. */
function unpack(bytes: Uint8Array): { names: string[]; entries: Map<string, Uint8Array> } {
  const directory = readZipDirectory(bytes);
  if (!directory.ok) throw new Error(`not a zip: ${directory.refusal}`);
  const entries = new Map<string, Uint8Array>();
  for (const entry of directory.entries) {
    const body = readZipEntry(bytes, entry);
    if (body === null) throw new Error(`unreadable: ${entry.name}`);
    entries.set(entry.name, body);
  }
  return { names: directory.entries.map((entry) => entry.name), entries };
}

function manifestOf(bytes: Uint8Array): WorldFileManifest {
  const { entries } = unpack(bytes);
  const raw = entries.get(WORLD_FILE_MANIFEST);
  if (raw === undefined) throw new Error('no manifest');
  const manifest = readWorldFileManifest(JSON.parse(new TextDecoder().decode(raw)));
  if ('refusal' in manifest) throw new Error(`manifest refused: ${manifest.refusal}`);
  return manifest;
}

/** `x-storyengine-export-notes`, decoded as the client decodes it. */
function notesOf(sent: Published): ImportNote[] {
  const header = sent.headers['x-storyengine-export-notes'];
  if (typeof header !== 'string') throw new Error('no notes header');
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as ImportNote[];
}

function worldJsonOf(bytes: Uint8Array): World {
  const { entries } = unpack(bytes);
  const name = [...entries.keys()].find(
    (one) => one.startsWith('library/worlds/') && one.endsWith('/world.json'),
  );
  const raw = name === undefined ? undefined : entries.get(name);
  if (raw === undefined) throw new Error('no world.json');
  return JSON.parse(new TextDecoder().decode(raw)) as World;
}

const contains = (bytes: Uint8Array, text: string): boolean =>
  Buffer.from(bytes).includes(Buffer.from(text, 'utf8'));

/** Every object this account can read, by id, with the hash of its stored file. */
function library(): Map<string, string> {
  return new Map(
    list(server.services.library, 'ned').map((row) => [row.id, row.contentHash] as const),
  );
}

function worlds(): number {
  return list(server.services.library, 'ned', WORLD_SCHEMA).length;
}

/** The ids `after` holds that `before` did not, and whether anything `before` held moved. */
function libraryDelta(
  before: Map<string, string>,
  after: Map<string, string>,
): { added: string[]; changed: string[]; removed: string[] } {
  return {
    added: [...after.keys()].filter((id) => !before.has(id)),
    changed: [...before]
      .filter(([id, hash]) => after.has(id) && after.get(id) !== hash)
      .map(([id]) => id),
    removed: [...before.keys()].filter((id) => !after.has(id)),
  };
}

async function ledger(): Promise<PublishRecord[]> {
  const text = await readFile(server.services.layout.publishLogFile('ned'), 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as PublishRecord);
}

async function scratch(): Promise<string[]> {
  return await readdir(server.services.layout.importScratchRoot).catch(() => []);
}

/**
 * The ledger once it holds `count` lines. The route appends on the response's
 * `finish`, after `inject` has its answer, so a read straight after a publish
 * races the append it is looking for.
 */
async function recorded(count: number): Promise<PublishRecord[]> {
  await eventually(async () => (await ledger()).length >= count, {
    describe: async () => `${String((await ledger()).length)} line(s)`,
  });
  return await ledger();
}

/** The scratch root once the response's `close` has let its space go. */
async function scratchGone(): Promise<void> {
  await eventually(async () => (await scratch()).length === 0, {
    describe: async () => JSON.stringify(await scratch()),
  });
}

/**
 * ***Every file under the data directory, by content*** — what *writes nothing*
 * is checked against. SQLite's `-shm` and `-wal` are left out: a reader takes
 * its read marks in the shared-memory file, so a query that writes nothing
 * still touches it, and the index's own rows are compared separately.
 *
 * ***Directories too*** (2026-10-11, the P16.3d review): a folder made and left
 * empty is a write, and a walk that recorded only files would not see it — a
 * measure that prepared an `assets/` or a `history/` would pass.
 */
async function tree(): Promise<Map<string, string>> {
  const root = server.dataDir;
  const out = new Map<string, string>();
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        out.set(`${relative(root, path)}/`, 'directory');
        await walk(path);
        continue;
      }
      if (entry.name.endsWith('-shm') || entry.name.endsWith('-wal')) continue;
      out.set(
        relative(root, path),
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      );
    }
  };
  await walk(root);
  return out;
}

/** Every row of every table in the index, as one digest. */
function indexRows(): string {
  const db = server.services.library.db;
  const tables = db
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all() as { name: string }[];
  const hash = createHash('sha256');
  for (const { name } of tables) {
    const rows = db.prepare(`select * from "${name}"`).all();
    hash.update(
      JSON.stringify([name, rows], (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  }
  return hash.digest('hex');
}

async function made<T extends { id: string; schema: string }>(object: T): Promise<T> {
  await create(server.services.library, 'ned', object);
  return object;
}

const envelope = (object: { schema: string; id: string; name: string }) => ({
  schema: object.schema,
  id: object.id,
  name: object.name,
});

/** A session started in a World through the route a person uses, so it is a member. */
async function started(
  world: string,
  name: string,
  actors: string[],
): Promise<{ id: string; name: string }> {
  const answer = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name, world, cast: { persona: null, actors } },
  });
  expect(answer.status, JSON.stringify(answer.body)).toBe(201);
  // Whatever starting a session set off has finished before anything is measured.
  await settled(server);
  return { id: answer.body.session.id as string, name };
}

/** A World of three members — a treatment casting an actor, a book — and nothing else. */
async function rainCity(): Promise<{
  world: World;
  vera: { id: string; name: string };
  harbour: { id: string; name: string };
  rain: { id: string; name: string };
}> {
  const vera = await made(newActor('Vera'));
  const harbour = await made(newLorebook('Harbour'));
  const rain = await made({
    ...newTreatment('Rain'),
    cast: [{ ref: { id: vera.id, name: 'Vera' }, billing: 'npc' as const, note: '' }],
  });
  const world = await made({
    ...newWorld('Rain City'),
    contents: [envelope(rain), envelope(harbour)],
  });
  return { world, vera, harbour, rain };
}

// ── The preview ─────────────────────────────────────────────────────────────

describe('the preview', () => {
  /**
   * ***The review writes nothing*** ([16 §5]) — not the library, not the index,
   * not the ledger, no scratch left behind, and nothing else under the data
   * directory either. A World start with a session member, so every
   * measurement runs — a card, a book, a transcript's export — and a
   * selection, which asks every World whether it is the same set.
   */
  it('writes nothing — library, index, ledger, scratch, or any other file', async () => {
    const city = await rainCity();
    await started(city.world.id, 'Night one', [city.vera.id]);
    // One authenticated request first, so whatever a request itself writes is
    // in the baseline rather than charged to the preview.
    await server.request({ method: 'GET', url: '/api/auth/state' });

    const files = await tree();
    const rows = indexRows();
    const objects = library();
    const count = worlds();

    await previewOf({ kind: 'world', id: city.world.id });
    await previewOf({ kind: 'objects', ids: [city.vera.id, city.harbour.id] });
    await previewOf({ kind: 'objects', ids: [city.rain.id] });

    expect(library()).toEqual(objects);
    expect(worlds()).toBe(count);
    expect(indexRows()).toBe(rows);
    expect(await ledger()).toEqual([]);
    expect(await scratch()).toEqual([]);
    expect(await tree()).toEqual(files);
  });

  it('refuses a World in a selection, and a start that is not there', async () => {
    const city = await rainCity();
    const inSelection = await server.request({
      method: 'POST',
      url: '/api/publish/preview',
      payload: { start: { kind: 'objects', ids: [city.vera.id, city.world.id] } },
    });
    expect(inSelection.status).toBe(422);
    expect(inSelection.body.error).toBe('world-in-selection');

    for (const start of [
      { kind: 'objects', ids: ['01900000-0000-7000-8000-000000000000'] },
      { kind: 'world', id: city.vera.id },
    ]) {
      const answer = await server.request({
        method: 'POST',
        url: '/api/publish/preview',
        payload: { start },
      });
      expect(answer.status, JSON.stringify(start)).toBe(404);
      expect(answer.body.error).toBe('not-found');
    }
  });

  /**
   * ***A selection in which nothing is there is nothing to publish***
   * (2026-10-11, the P16.3d review) — the lone missing id's answer, for the
   * same reason: both objects deleted in another tab while the review was
   * open. It kept an empty World and sent a file of nothing; now the preview
   * and the confirm say `404`, and nothing is kept.
   */
  it('refuses a selection none of whose ids is there, and keeps nothing', async () => {
    const ghosts = ['01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000002'];
    const start = { kind: 'objects', ids: ghosts };
    const looked = await server.request({
      method: 'POST',
      url: '/api/publish/preview',
      payload: { start },
    });
    expect(looked.status).toBe(404);
    expect(looked.body.error).toBe('not-found');

    for (const keep of ['world', 'snapshot'] as const) {
      const sent = await publish({ start, choices: choices({ keep, name: 'Ghosts' }) });
      expect(sent.status, keep).toBe(404);
      expect(sent.body.error, keep).toBe('not-found');
    }
    expect(worlds()).toBe(0);
    expect(await ledger()).toEqual([]);
    expect(await scratch()).toEqual([]);
  });

  it('holds the start to its bounds at the door', async () => {
    for (const start of [
      { kind: 'objects', ids: [] },
      { kind: 'objects', ids: Array.from({ length: 201 }, (_, at) => `id-${String(at)}`) },
      { kind: 'objects', ids: ['x'.repeat(201)] },
      { kind: 'world', id: '' },
    ]) {
      const answer = await server.request({
        method: 'POST',
        url: '/api/publish/preview',
        payload: { start },
      });
      expect(answer.status, JSON.stringify(start).slice(0, 80)).toBe(400);
    }
  });

  /**
   * ***A key the route does not read is refused, by name*** (2026-10-11, the
   * P16.3d review) — the house rule for JSON bodies (`routes/me.ts` says why):
   * a misspelt `reviewed` stripped and answered `200` would switch drift off
   * and teach the client that the request worked. `ticked` stays an open
   * record: its keys are the closure's, not the schema's.
   */
  it('refuses a key it does not read, and says which', async () => {
    const vera = await made(newActor('Vera'));
    const harbour = await made(newLorebook('Harbour'));
    const start = { kind: 'objects', ids: [vera.id, harbour.id] };
    const cases: { url: string; payload: unknown; path: string }[] = [
      { url: '/api/publish/preview', payload: { start, bogus: true }, path: '/bogus' },
      {
        url: '/api/publish',
        payload: { start, choices: choices({ name: 'Pair' }), reviewd: 'sha256:stale' },
        path: '/reviewd',
      },
      {
        url: '/api/publish',
        payload: { start, choices: { ...choices(), nmae: 'Pair' } },
        path: '/choices/nmae',
      },
    ];
    for (const { url, payload, path } of cases) {
      const answer = await server.request({ method: 'POST', url, payload });
      expect(answer.status, path).toBe(400);
      expect(answer.body.issues, path).toContainEqual(expect.objectContaining({ path }));
    }
    // Inside a start, the union answers for both arms — refused all the same.
    for (const [url, rest] of [
      ['/api/publish/preview', {}],
      ['/api/publish', { choices: choices({ name: 'Pair' }) }],
    ] as const) {
      for (const bad of [
        { ...start, bogus: 1 },
        { kind: 'world', id: vera.id, bogus: 1 },
      ]) {
        const answer = await server.request({
          method: 'POST',
          url,
          payload: { start: bad, ...rest },
        });
        expect(answer.status, `${url} ${bad.kind}`).toBe(400);
      }
    }
    // And nothing was kept by any of them.
    expect(worlds()).toBe(0);
    expect(await ledger()).toEqual([]);
  });
});

// ── The confirm, by origin ──────────────────────────────────────────────────

describe('publishing, by where it starts', () => {
  it('one object: a zip and a ledger line, and nothing written to the library', async () => {
    const vera = await made(newActor('Vera'));
    const before = library();

    const sent = await publish({ start: { kind: 'objects', ids: [vera.id] }, choices: choices() });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.headers['content-type']).toBe('application/zip');
    expect(sent.headers['content-length']).toBe(String(sent.bytes.length));
    expect(sent.headers['content-disposition']).toBe('attachment; filename="Vera.seworld"');
    expect(sent.headers['x-storyengine-world']).toBeUndefined();
    expect(sent.headers['x-storyengine-missing']).toBe('0');
    expect(sent.headers['x-storyengine-review-drift']).toBeUndefined();

    const manifest = manifestOf(sent.bytes);
    expect(manifest).toMatchObject({ origin: 'object', world: null });
    expect(manifest.objects.map((one) => one.id)).toEqual([vera.id]);

    // [16 §2]: one object writes nothing at all.
    expect(libraryDelta(before, library())).toEqual({ added: [], changed: [], removed: [] });
    const [record] = await recorded(1);
    expect(record).toMatchObject({
      schema: PUBLISH_RECORD_SCHEMA,
      origin: 'object',
      start: [vera.id],
      world: null,
      fileName: 'Vera.seworld',
      bytes: sent.bytes.length,
      justTheObject: true,
      drift: false,
    });
    expect(record?.objects.map((one) => one.id)).toEqual([vera.id]);
    await scratchGone();
  });

  /**
   * ***A selection of two is how a World gets made*** ([16 §3]) — exactly one,
   * holding the selection **as selected**: the start the person unticked is
   * left out of the file and kept in the set. The file's World names only what
   * travelled; the kept World names both.
   */
  it('a selection of two, kept: exactly one World, holding an unchecked start too', async () => {
    const vera = await made(newActor('Vera'));
    const harbour = await made(newLorebook('Harbour'));
    const before = library();

    const sent = await publish({
      start: { kind: 'objects', ids: [vera.id, harbour.id] },
      choices: choices({ ticked: { [harbour.id]: false }, name: '  The pair  ' }),
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    const delta = libraryDelta(before, library());
    expect(delta.changed).toEqual([]);
    expect(delta.removed).toEqual([]);
    expect(delta.added).toHaveLength(1);
    const [kept] = delta.added;
    expect(sent.headers['x-storyengine-world']).toBe(kept);
    const stored = read(server.services.library, 'ned', kept ?? '', WORLD_SCHEMA).body as World;
    expect(stored.name).toBe('The pair');
    expect(stored.contents).toEqual([envelope(vera), envelope(harbour)]);
    // `requires` is the author's, and nobody authored any ([P16.3]'s plan, R12).
    expect(stored.requires).toEqual({ modes: [], extensions: [], capabilities: [] });

    expect(sent.headers['content-disposition']).toBe('attachment; filename="The-pair.seworld"');
    const manifest = manifestOf(sent.bytes);
    expect(manifest.origin).toBe('selection');
    expect(manifest.world?.id).toBe(kept);
    expect(manifest.objects.map((one) => one.id)).toEqual([vera.id]);
    expect(worldJsonOf(sent.bytes).contents).toEqual([envelope(vera)]);

    const [record] = await recorded(1);
    expect(record).toMatchObject({
      origin: 'selection',
      start: [vera.id, harbour.id],
      world: { id: kept, name: 'The pair', kept: 'created' },
      unticked: [{ id: harbour.id, required: false }],
      ticked: [],
    });
  });

  /**
   * ***A snapshot keeps nothing*** — named or not. The client sends the name
   * field's value whichever way the person chose (it is the file's name
   * either way), so a snapshot that arrives *with* a name is the ordinary
   * case, and the one that would show a World kept by mistake (2026-10-11, the
   * P16.3d review: the unnamed case alone let that pass).
   */
  it('a snapshot keeps nothing, and is named for what it holds or what it was called', async () => {
    const vera = await made(newActor('Vera'));
    const harbour = await made(newLorebook('Harbour'));
    const before = library();

    for (const [name, fileName] of [
      [undefined, 'Vera-Harbour.seworld'],
      ['The shared pair', 'The-shared-pair.seworld'],
    ] as const) {
      const sent = await publish({
        start: { kind: 'objects', ids: [vera.id, harbour.id] },
        choices: choices(name === undefined ? { keep: 'snapshot' } : { keep: 'snapshot', name }),
      });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      expect(libraryDelta(before, library()), fileName).toEqual({
        added: [],
        changed: [],
        removed: [],
      });
      expect(sent.headers['x-storyengine-world']).toBeUndefined();
      expect(sent.headers['content-disposition']).toBe(`attachment; filename="${fileName}"`);
      expect(manifestOf(sent.bytes)).toMatchObject({ origin: 'selection', world: null });
    }
    expect(await recorded(2)).toMatchObject([
      { origin: 'selection', world: null },
      { origin: 'selection', world: null },
    ]);
  });

  /**
   * [16 §3]: *Publishing from a World creates nothing new* — and changes
   * nothing either. **Under both `keep` values** (2026-10-11, the P16.3d
   * review): `world` is `PublishChoices`' default and what the client will
   * most often send, and a World start that acted on it — a second copy kept,
   * the World stamped — passed a test that only sent `snapshot`.
   */
  it('a World start creates nothing, and the World’s contentHash is unchanged', async () => {
    const city = await rainCity();
    const before = library();
    const worldHash = read(server.services.library, 'ned', city.world.id).contentHash;

    for (const keep of ['world', 'snapshot'] as const) {
      const sent = await publish({
        start: { kind: 'world', id: city.world.id },
        // A World start reads neither of these: there is nothing to keep.
        choices: choices({ keep, name: 'Ignored' }),
      });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      expect(libraryDelta(before, library()), keep).toEqual({
        added: [],
        changed: [],
        removed: [],
      });
      expect(read(server.services.library, 'ned', city.world.id).contentHash, keep).toBe(worldHash);
      expect(sent.headers['x-storyengine-world'], keep).toBeUndefined();
      expect(sent.headers['content-disposition']).toBe('attachment; filename="Rain-City.seworld"');

      const manifest = manifestOf(sent.bytes);
      expect(manifest.world?.id).toBe(city.world.id);
      expect(manifest.objects.map((one) => one.id).sort()).toEqual(
        [city.rain.id, city.harbour.id, city.vera.id].sort(),
      );
    }
    const world = { id: city.world.id, name: 'Rain City', kept: 'existing' };
    expect(await recorded(2)).toMatchObject([
      { origin: 'world', start: [city.world.id], world },
      { origin: 'world', start: [city.world.id], world },
    ]);
  });
});

// ── What travels ────────────────────────────────────────────────────────────

describe('what the file carries', () => {
  /**
   * ***P16.3c's layout and leak checks, through the route*** — the stage's end
   * clause. A World with two sessions; one ticked. The ticked one travels as
   * its export, with the actor only it casts; the unticked one's name, its id,
   * and the actor only *it* casts appear nowhere in the bytes.
   */
  it('carries a ticked session and what it brings, and nothing of an unticked one', async () => {
    const city = await rainCity();
    const ash = await made(newActor('Ash Wren'));
    const bryn = await made(newActor('Bryn Quillfeather'));
    const night = await started(city.world.id, 'Night one', [ash.id]);
    const secret = await started(city.world.id, 'Zanzibar Midnight Confession', [bryn.id]);

    const sent = await publish({
      start: { kind: 'world', id: city.world.id },
      choices: choices({ ticked: { [night.id]: true } }),
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    const { names } = unpack(sent.bytes);
    expect(names[0]).toBe(WORLD_FILE_MANIFEST);
    expect(names).toContain(`sessions/${night.id}/session-export.json`);
    const manifest = manifestOf(sent.bytes);
    expect(manifest.sessions.map((one) => one.id)).toEqual([night.id]);
    expect(manifest.objects.map((one) => one.id)).toContain(ash.id);
    expect(worldJsonOf(sent.bytes).contents.map((one) => one.id)).toContain(night.id);

    for (const absent of [secret.id, secret.name, bryn.id, bryn.name]) {
      expect(contains(sent.bytes, absent), absent).toBe(false);
    }
    expect((await recorded(1))[0]).toMatchObject({
      sessions: [expect.objectContaining({ id: night.id, name: 'Night one' })],
      ticked: [night.id],
      offered: { sessions: 2 },
    });
  });

  /**
   * ***The record's hashes are the stored objects', and its sessions' times
   * the session files'*** (2026-10-11, the P16.3d review) — the two fields the
   * re-publish diff reads ([P16.3h]), which nothing held. The card is one the
   * writer re-splices (an expression removed, its pixels still in the card),
   * so the member in the zip hashes differently from the stored file and the
   * record's choice between them is pinned, not just present.
   */
  it('records what left by its stored hash, and each session by its updatedAt', async () => {
    const library = server.services.library;
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
    const first = await create(library, 'ned', vera, ACTOR_SCHEMA, {
      cardPixels: makePng(8, 1),
      media: new Map([['smiling', smile]]),
    });
    await update(library, 'ned', vera.id, { ...vera, media: [] }, first.contentHash);
    const world = await made({ ...newWorld('Rain City'), contents: [envelope(vera)] });
    const night = await started(world.id, 'Night one', [vera.id]);

    const sent = await publish({
      start: { kind: 'world', id: world.id },
      choices: choices({ ticked: { [night.id]: true } }),
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const stored = read(library, 'ned', vera.id).contentHash;
    const member = manifestOf(sent.bytes).objects.find((one) => one.id === vera.id)?.contentHash;
    // The premise: the card that travelled is not the stored file.
    expect(member).toBeDefined();
    expect(member).not.toBe(stored);

    const [record] = await recorded(1);
    expect(record?.objects).toEqual([
      { schema: ACTOR_SCHEMA, id: vera.id, name: 'Vera', contentHash: stored },
    ]);
    const session = await readSession(server.services.sessions, 'ned', night.id);
    expect(record?.sessions).toEqual([
      expect.objectContaining({ id: night.id, updatedAt: session?.updatedAt }),
    ]);
    expect(session?.updatedAt).toEqual(expect.any(String));
  });

  it('carries history only when it is asked for', async () => {
    const harbour = newLorebook('Harbour');
    const madeHarbour = await create(server.services.library, 'ned', harbour);
    await update(
      server.services.library,
      'ned',
      harbour.id,
      { ...harbour, description: 'Wet.' },
      madeHarbour.contentHash,
    );
    const vera = await made(newActor('Vera'));
    const start = { kind: 'objects', ids: [harbour.id, vera.id] };

    const without = await publish({ start, choices: choices({ keep: 'snapshot' }) });
    expect(unpack(without.bytes).names.some((name) => name.includes('/history/'))).toBe(false);
    expect(manifestOf(without.bytes).history).toBe(false);
    await recorded(1);

    const withHistory = await publish({
      start,
      choices: choices({ keep: 'snapshot', history: true }),
    });
    const names = unpack(withHistory.bytes).names;
    expect(names.some((name) => name.endsWith('/history/index.jsonl'))).toBe(true);
    expect(names.some((name) => /\/history\/v\/[0-9a-f]{64}\.json$/.test(name))).toBe(true);
    expect(manifestOf(withHistory.bytes).history).toBe(true);
    expect((await recorded(2)).map((one) => one.history)).toEqual([false, true]);
  });

  /** [16 §5]: unchecking a `required` link *is permitted and warned about* — and never blocks. */
  it('confirms with a required link unchecked, and says what stayed home', async () => {
    const tides = await made(newLorebook('Tides'));
    const rain = await made({
      ...newTreatment('Rain'),
      lore: [{ ref: { id: tides.id, name: 'Tides' }, required: true }],
    });
    const world = await made({ ...newWorld('Rain City'), contents: [envelope(rain)] });

    const sent = await publish({
      start: { kind: 'world', id: world.id },
      choices: choices({ ticked: { [tides.id]: false } }),
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const manifest = manifestOf(sent.bytes);
    expect(manifest.objects.map((one) => one.id)).toEqual([rain.id]);
    expect(manifest.leftBehind).toContainEqual({
      schema: LOREBOOK_SCHEMA,
      id: tides.id,
      name: 'Tides',
      reason: 'unchecked',
      required: true,
      from: [rain.id],
    });
    expect((await recorded(1))[0]?.unticked).toEqual([{ id: tides.id, required: true }]);
  });

  /**
   * ***What the file says about itself, beside it*** — the missing count, and
   * the notes. The fixture is one that *has* notes (2026-10-11, the P16.3d
   * review: the header decoded to `[]` here, so an empty header passed): a
   * Setup needing a mode this install does not have, which the file still
   * requires and the person is told about.
   */
  it('counts the missing, and says what the file does not carry', async () => {
    const ghost = '01900000-0000-7000-8000-00000000dead';
    const vera = await made(newActor('Vera'));
    const elsewhere = await made({
      ...newSetup('Elsewhere'),
      mode: { id: 'somebody.else', config: null },
    });
    const world = await made({
      ...newWorld('Rain City'),
      contents: [
        envelope(vera),
        envelope(elsewhere),
        { schema: ACTOR_SCHEMA, id: ghost, name: 'Ghost' },
      ],
    });
    const sent = await publish({ start: { kind: 'world', id: world.id }, choices: choices() });
    expect(sent.status).toBe(200);
    expect(sent.headers['x-storyengine-missing']).toBe('1');
    expect(notesOf(sent)).toContainEqual({
      key: 'publish.requires.modeNotHere',
      level: 'info',
      params: { mode: 'somebody.else' },
    });
    expect(manifestOf(sent.bytes).requires.modes).toContainEqual({
      id: 'somebody.else',
      minVersion: '0.0.0',
    });
    expect((await recorded(1))[0]?.missing).toBe(1);
  });

  /**
   * ***Missing is what the file would have followed*** — a reference only an
   * unticked thing names is not the file's to report (`missingCount`'s rule,
   * 2026-10-11, the P16.3d review: it had no test). A treatment linking a book
   * that is not there: ticked, one missing; unticked, none.
   */
  it('counts a missing link only when what names it travels', async () => {
    const rain = await made({
      ...newTreatment('Rain'),
      lore: [
        { ref: { id: '01900000-0000-7000-8000-0000000000aa', name: 'Gone' }, required: false },
      ],
    });
    const harbour = await made(newLorebook('Harbour'));
    const world = await made({
      ...newWorld('Rain City'),
      contents: [envelope(rain), envelope(harbour)],
    });
    const start = { kind: 'world', id: world.id };

    const ticked = await publish({ start, choices: choices() });
    expect(ticked.headers['x-storyengine-missing']).toBe('1');
    const unticked = await publish({ start, choices: choices({ ticked: { [rain.id]: false } }) });
    expect(unticked.status).toBe(200);
    expect(unticked.headers['x-storyengine-missing']).toBe('0');
    expect((await recorded(2)).map((one) => one.missing)).toEqual([1, 0]);
  });

  /**
   * ***The notes header has a budget*** (2026-10-11, the P16.3d review). Every
   * picture a book names and does not have is a note, and a header of all of
   * them passed 16 KiB at about fifty — which Node's own `fetch` refuses
   * outright and a reverse proxy in front for TLS ([docs/deploy.md]) answers
   * with a `502`. The header carries the warnings first, then what fits, and
   * one closing note counting the rest; the manifest's `omitted`, inside the
   * file, still names every one.
   */
  it('keeps the notes header within its budget, and counts what the manifest alone names', async () => {
    const vera = await made(newActor('Vera'));
    const atlas = newLorebook('Atlas of the Drowned Coast');
    const media = Array.from({ length: 300 }, (_, at) => {
      const bytes = new TextEncoder().encode(`absent ${String(at)}`);
      const digest = digestOf(bytes);
      return {
        id: `m${String(at)}`,
        role: 'map' as const,
        mime: 'image/png',
        digest,
        bytes: bytes.length,
        ref: `assets/${digest.replace('sha256:', '')}.png`,
        tags: [],
      };
    });
    await made({ ...atlas, media });

    const sent = await publish({
      start: { kind: 'objects', ids: [vera.id, atlas.id] },
      choices: choices({ keep: 'snapshot' }),
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const header = String(sent.headers['x-storyengine-export-notes']);
    expect(header.length).toBeLessThanOrEqual(PUBLISH_NOTES_HEADER_MAX);

    const omitted = manifestOf(sent.bytes).omitted;
    expect(omitted.filter((one) => one.key === 'publish.file.pictureMissing')).toHaveLength(300);
    const notes = notesOf(sent);
    const closing = notes.at(-1);
    expect(closing).toMatchObject({ key: 'publish.file.moreInManifest', level: 'info' });
    // What the header carried and what it counted are the manifest's, together.
    expect(notes.length - 1 + Number(closing?.params['count'])).toBe(omitted.length);
    expect(notes.slice(0, -1)).toEqual(omitted.slice(0, notes.length - 1));
  });
});

// ── Drift, refusals, and what each one keeps ────────────────────────────────

describe('drift and refusals', () => {
  /**
   * ***Reported, never prevented*** ([16 §5]: *the honest failure rather than a
   * prevented one*). The same library confirms quietly; an object saved
   * between the review and the confirm confirms too, with the header.
   */
  it('says the review drifted when the library changed between it and the confirm', async () => {
    const city = await rainCity();
    const start = { kind: 'world' as const, id: city.world.id };

    const quiet = await previewOf(start);
    const unchanged = await publish({ start, choices: choices(), reviewed: quiet.reviewed });
    expect(unchanged.status).toBe(200);
    expect(unchanged.headers['x-storyengine-review-drift']).toBeUndefined();
    await recorded(1);

    const looked = await previewOf(start);
    const stored = read(server.services.library, 'ned', city.vera.id);
    await update(
      server.services.library,
      'ned',
      city.vera.id,
      { ...(stored.body as object), description: 'Saved while the review was open.' },
      stored.contentHash,
    );
    const drifted = await publish({ start, choices: choices(), reviewed: looked.reviewed });
    expect(drifted.status).toBe(200);
    expect(drifted.headers['x-storyengine-review-drift']).toBe('1');
    expect((await recorded(2)).map((one) => one.drift)).toEqual([false, true]);
  });

  /**
   * ***Drift is the whole closure's, sessions and the World included***
   * (2026-10-11, the P16.3d review). `closureHash` hashes a session by its
   * head and its `updatedAt`, and the start World by its own hash, so a turn
   * played in another tab, a session renamed, and the World renamed while
   * the review was open each say so — and none of those parts was held by a
   * test: each could have been dropped from the hash with the suite green.
   */
  it('says the review drifted for a turn played, a session renamed, and the World renamed', async () => {
    const city = await rainCity();
    const night = await started(city.world.id, 'Night one', [city.vera.id]);
    const start = { kind: 'world' as const, id: city.world.id };
    const ticked = choices({ ticked: { [night.id]: true } });

    const edits: [string, () => Promise<unknown>][] = [
      [
        'a turn played',
        async () => {
          const session = await readSession(server.services.sessions, 'ned', night.id);
          await appendTurnToSession(server.services.sessions, 'ned', night.id, {
            id: uuidv7(),
            sessionId: night.id,
            parentTurnId: session?.headTurnId ?? null,
            createdAt: new Date().toISOString(),
            status: 'complete',
            effects: [],
            tape: [],
          });
        },
      ],
      [
        'a session renamed',
        () => setName(server.services.sessions, 'ned', night.id, 'Night one, again'),
      ],
      [
        'the World renamed',
        async () => {
          const stored = read(server.services.library, 'ned', city.world.id);
          await update(
            server.services.library,
            'ned',
            city.world.id,
            { ...(stored.body as World), name: 'Rain Town' },
            stored.contentHash,
          );
        },
      ],
    ];
    let lines = 0;
    for (const [what, edit] of edits) {
      const looked = await previewOf(start);
      await edit();
      const sent = await publish({ start, choices: ticked, reviewed: looked.reviewed });
      expect(sent.status, what).toBe(200);
      expect(sent.headers['x-storyengine-review-drift'], what).toBe('1');
      lines += 1;
      expect((await recorded(lines)).at(-1)?.drift, what).toBe(true);
    }
  });

  it('refuses a World in a selection, a missing start, and a name not worth keeping — keeping nothing', async () => {
    const city = await rainCity();
    const count = worlds();

    const inSelection = await publish({
      start: { kind: 'objects', ids: [city.vera.id, city.world.id] },
      choices: choices({ name: 'Mine' }),
    });
    expect(inSelection.status).toBe(422);
    expect(inSelection.body.error).toBe('world-in-selection');

    const missing = await publish({
      start: { kind: 'objects', ids: ['01900000-0000-7000-8000-000000000000'] },
      choices: choices(),
    });
    expect(missing.status).toBe(404);

    for (const name of [undefined, '', '   ', 'two\nlines', 'x'.repeat(201)]) {
      const refused = await publish({
        start: { kind: 'objects', ids: [city.vera.id, city.harbour.id] },
        choices: choices(name === undefined ? {} : { name }),
      });
      expect(refused.status, JSON.stringify(name)).toBe(422);
      expect(refused.body.error).toBe('invalid-name');
    }
    expect(worlds()).toBe(count);
    expect(await ledger()).toEqual([]);
    expect(await scratch()).toEqual([]);
  });

  /**
   * ***A refusal leaves no stray World*** ([P16.3]'s plan, R11) — the World is
   * created after the plan, so a file too large for its readers is told so
   * with the library as it was. A book of 4,100 pictures is past the readers'
   * 4,096 members by itself.
   */
  it('refuses a plan too large for its readers, and keeps no World', async () => {
    const vera = await made(newActor('Vera'));
    const book = newLorebook('Gallery');
    const madeBook = await create(server.services.library, 'ned', book);
    const assets = join(dirname(madeBook.path), 'assets');
    const media = [];
    await mkdir(assets, { recursive: true });
    for (let at = 0; at < 4100; at += 1) {
      const bytes = new TextEncoder().encode(`picture ${String(at)}`);
      const digest = digestOf(bytes);
      const ref = `assets/${digest.replace('sha256:', '')}.png`;
      await writeFile(join(dirname(madeBook.path), ref), bytes);
      media.push({
        id: `m${String(at)}`,
        role: 'map' as const,
        mime: 'image/png',
        digest,
        bytes: bytes.length,
        ref,
        tags: [],
      });
    }
    await update(server.services.library, 'ned', book.id, { ...book, media }, madeBook.contentHash);
    const count = worlds();
    const before = library();

    const refused = await publish({
      start: { kind: 'objects', ids: [vera.id, book.id] },
      choices: choices({ name: 'Too much' }),
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body).toMatchObject({ error: 'publish.tooLarge', reason: 'too-many-files' });
    expect(worlds()).toBe(count);
    expect(library()).toEqual(before);
    expect(await ledger()).toEqual([]);
    expect(await scratch()).toEqual([]);
  });

  it('answers 507 when the disk has no room for the file, and keeps no World', async () => {
    const vera = await made(newActor('Vera'));
    const harbour = await made(newLorebook('Harbour'));
    const count = worlds();
    server.services.freeBytes = () => Promise.resolve(1024);

    const refused = await publish({
      start: { kind: 'objects', ids: [vera.id, harbour.id] },
      choices: choices({ name: 'No room' }),
    });
    expect(refused.status).toBe(507);
    expect(refused.body.error).toBe('no-space');
    expect(worlds()).toBe(count);
    expect(await ledger()).toEqual([]);
    expect(await scratch()).toEqual([]);
  });

  /**
   * ***A change between the plan and the write fails the file whole, and the
   * kept World stays*** ([P16.3]'s plan, R11 and risk 6). The room check is
   * the seam between the two — after the plan, before the World and the file
   * — so an object saved there is exactly the edit this guards against.
   */
  it('answers 409 publish.changed for an edit between plan and write, and keeps the World', async () => {
    const vera = await made(newActor('Vera'));
    const harbour = await made(newLorebook('Harbour'));
    const count = worlds();
    server.services.freeBytes = async () => {
      const stored = read(server.services.library, 'ned', harbour.id);
      await update(
        server.services.library,
        'ned',
        harbour.id,
        { ...(stored.body as object), description: 'Saved mid-publish.' },
        stored.contentHash,
      );
      return null;
    };

    const changed = await publish({
      start: { kind: 'objects', ids: [vera.id, harbour.id] },
      choices: choices({ name: 'Mid-publish' }),
    });
    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({ error: 'publish.changed' });
    expect(changed.body.world).toMatchObject({ name: 'Mid-publish' });
    expect(worlds()).toBe(count + 1);
    expect(await ledger()).toEqual([]);
    await scratchGone();
  });

  /**
   * ***A write that fails for any other reason takes the World back***
   * (2026-10-11, the P16.3d review) — the disk filling while the file is
   * written, which no room check can see coming (`507`, in publish's own
   * words, not import's), or failing outright (`500`). R11's promise is that
   * only a member changing between plan and write leaves a World, and it is
   * named in that answer; these answers name none, so a World kept by either
   * would be one the person cannot find, and their retry a second. Scratch
   * goes, and no line is written: nothing was sent.
   */
  it('takes back the World it kept when the write then fails — 507 for a full disk, 500 otherwise', async () => {
    const vera = await made(newActor('Vera'));
    const harbour = await made(newLorebook('Harbour'));
    const before = library();
    const count = worlds();

    for (const [code, status] of [
      ['ENOSPC', 507],
      ['EIO', 500],
    ] as const) {
      seams.writeThrows = Object.assign(new Error(`write failed: ${code}`), { code });
      const failed = await publish({
        start: { kind: 'objects', ids: [vera.id, harbour.id] },
        choices: choices({ name: `Failed ${code}` }),
      });
      expect(failed.status, code).toBe(status);
      if (code === 'ENOSPC') {
        expect(failed.body.error).toBe('no-space');
        expect(String(failed.body.message)).not.toMatch(/import/);
      }
      expect(failed.headers['x-storyengine-world'], code).toBeUndefined();
      expect(worlds(), code).toBe(count);
      expect(library(), code).toEqual(before);
      expect(await scratch(), code).toEqual([]);
    }
    expect(await ledger()).toEqual([]);
  });

  /**
   * ***An error answer is not a delivery*** (2026-10-11, the P16.3d review).
   * The file is written, and then cannot be opened to send — gone from
   * scratch, or the process out of descriptors. fastify answers the stream's
   * error as a `500` that ends normally, so the response *finishes*, and a
   * ledger line on `finish` alone recorded a publish nobody received. The
   * line is for a file sent whole: a `200` whose stream reached its end.
   */
  it('writes no ledger line when the file could not be sent', async () => {
    const vera = await made(newActor('Vera'));
    const harbour = await made(newLorebook('Harbour'));
    seams.readGone = true;
    const failed = await publish({
      start: { kind: 'objects', ids: [vera.id] },
      choices: choices(),
    });
    expect(failed.status).toBe(500);
    await scratchGone();

    // The control, after it: appends are queued in order, so once this line
    // is there, one for the failed send would be there before it.
    seams.readGone = false;
    const whole = await publish({
      start: { kind: 'objects', ids: [harbour.id] },
      choices: choices(),
    });
    expect(whole.status).toBe(200);
    await recorded(1);
    expect((await ledger()).map((one) => one.start)).toEqual([[harbour.id]]);
  });
});

// ── The ledger and the download ─────────────────────────────────────────────

describe('the ledger', () => {
  it('GET /publish/records counts, newest first, by World or all', async () => {
    const city = await rainCity();
    for (const history of [false, true]) {
      const sent = await publish({
        start: { kind: 'world', id: city.world.id },
        choices: choices({ history }),
      });
      expect(sent.status).toBe(200);
      await recorded(history ? 2 : 1);
    }
    const one = await publish({
      start: { kind: 'objects', ids: [city.vera.id] },
      choices: choices(),
    });
    expect(one.status).toBe(200);
    await recorded(3);

    const mine = await server.request({
      method: 'GET',
      url: `/api/publish/records?world=${city.world.id}`,
    });
    expect(mine.status).toBe(200);
    expect(mine.body.count).toBe(2);
    expect(mine.body.records.map((record: PublishRecord) => record.history)).toEqual([true, false]);

    const all = await server.request({ method: 'GET', url: '/api/publish/records' });
    expect(all.body.count).toBe(3);
    expect(all.body.records[0].origin).toBe('object');

    const limited = await server.request({ method: 'GET', url: '/api/publish/records?limit=1' });
    expect(limited.body).toMatchObject({ count: 3 });
    expect(limited.body.records).toHaveLength(1);

    const bad = await server.request({ method: 'GET', url: '/api/publish/records?limit=many' });
    expect(bad.status).toBe(400);
  });
});

describe('an abandoned download', () => {
  async function listen(): Promise<number> {
    if (!server.app.server.listening) await server.app.listen({ port: 0, host: '127.0.0.1' });
    return (server.app.server.address() as AddressInfo).port;
  }

  /** One POST over loopback on its own connection, left at `leave`. */
  function post(
    port: number,
    body: unknown,
    leave: 'at-headers' | 'never',
  ): { left: Promise<void>; abandon: () => void } {
    let abandon = (): void => undefined;
    const left = new Promise<void>((settle) => {
      const outgoing = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/publish',
          agent: false,
          headers: { ...asTheBrowser(), 'content-type': 'application/json' },
        },
        (incoming) => {
          if (leave === 'at-headers') {
            // Headers arrived; the person closed the tab before the body did.
            incoming.destroy();
            outgoing.destroy();
            settle();
          }
        },
      );
      outgoing.on('error', () => {
        settle();
      });
      outgoing.end(JSON.stringify(body));
      abandon = () => {
        outgoing.destroy();
        settle();
      };
    });
    return { left, abandon };
  }

  async function connections(): Promise<number> {
    return await new Promise((settle) => {
      server.app.server.getConnections((_error, count) => {
        settle(count);
      });
    });
  }

  /** Past the response's `close` and anything an append behind it would do. */
  async function afterClose(): Promise<void> {
    await scratchGone();
    await new Promise((tick) => setTimeout(tick, 150));
  }

  /**
   * ***Left part way through the download*** — the ordinary abandoned tab. The
   * file is larger than any loopback socket buffers, so the response cannot
   * have finished when the client leaves at its headers; the ledger stays
   * empty, and the scratch the file sat in goes.
   */
  it('writes no ledger line when the person leaves mid-download, and lets the scratch go', async () => {
    const book = newLorebook('Large');
    const madeBook = await create(server.services.library, 'ned', book);
    // Larger than any loopback socket's buffers, so it cannot all be on its
    // way before the client leaves. Stored, not deflated, so the bytes need
    // not be noise.
    const bytes = new Uint8Array(24 * 1024 * 1024).fill(7);
    const digest = digestOf(bytes);
    const ref = `assets/${digest.replace('sha256:', '')}.png`;
    await mkdir(join(dirname(madeBook.path), 'assets'), { recursive: true });
    await writeFile(join(dirname(madeBook.path), ref), bytes);
    await update(
      server.services.library,
      'ned',
      book.id,
      {
        ...book,
        media: [
          { id: 'm1', role: 'map', mime: 'image/png', digest, bytes: bytes.length, ref, tags: [] },
        ],
      },
      madeBook.contentHash,
    );
    const port = await listen();

    await post(
      port,
      { start: { kind: 'objects', ids: [book.id] }, choices: choices() },
      'at-headers',
    ).left;
    await afterClose();
    expect(await ledger()).toEqual([]);

    // The control: the same publish, received whole, is recorded.
    const whole = await publish({ start: { kind: 'objects', ids: [book.id] }, choices: choices() });
    expect(whole.status).toBe(200);
    expect(await recorded(1)).toHaveLength(1);
  });

  /**
   * ***Left while the file was still being made*** — the response closed
   * before the route had anything to send. Nothing is sent, nothing recorded,
   * and the scratch goes; a World a selection kept stays (it was kept before
   * the file existed, and is cheap — the plan's risk 15 names the cost).
   */
  it('writes no ledger line when the person left before the file was ready', async () => {
    const vera = await made(newActor('Vera'));
    const harbour = await made(newLorebook('Harbour'));
    const count = worlds();
    let reached = (): void => undefined;
    const atRoomCheck = new Promise<void>((settle) => {
      reached = settle;
    });
    let release = (): void => undefined;
    const gate = new Promise<void>((settle) => {
      release = settle;
    });
    server.services.freeBytes = async () => {
      reached();
      await gate;
      return null;
    };
    const port = await listen();

    const call = post(
      port,
      {
        start: { kind: 'objects', ids: [vera.id, harbour.id] },
        choices: choices({ name: 'Gone' }),
      },
      'never',
    );
    await atRoomCheck;
    call.abandon();
    await call.left;
    await eventually(async () => (await connections()) === 0, { timeoutMs: 5_000 });
    release();

    await eventually(() => Promise.resolve(worlds() === count + 1), { timeoutMs: 5_000 });
    await afterClose();
    expect(await ledger()).toEqual([]);
  });
});

describe('a session nobody ticked', () => {
  /**
   * ***Left out of the file, kept in the set*** — the default for a session
   * ([16 §5]: *off until ticked*): the file's World does not name it and its
   * id is nowhere in the bytes, while the stored World still holds it.
   */
  it('is out of the file’s World and its bytes, and still in the stored World', async () => {
    const city = await rainCity();
    const night = await started(city.world.id, 'Night one', [city.vera.id]);
    const sent = await publish({ start: { kind: 'world', id: city.world.id }, choices: choices() });
    expect(sent.status).toBe(200);
    expect(worldJsonOf(sent.bytes).contents.some((one) => one.schema === SESSION_SCHEMA)).toBe(
      false,
    );
    expect(contains(sent.bytes, night.id)).toBe(false);
    const stored = read(server.services.library, 'ned', city.world.id).body as World;
    expect(stored.contents.some((one) => one.id === night.id)).toBe(true);
  });
});
