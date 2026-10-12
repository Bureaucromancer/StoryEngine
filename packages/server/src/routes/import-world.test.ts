// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACTOR_SCHEMA,
  firstLocalEntry,
  type ImportPreview,
  type ImportPreviewWorld,
  LOREBOOK_SCHEMA,
  newActor,
  newLorebook,
  newTreatment,
  newWorld,
  SESSION_SCHEMA,
  TREATMENT_SCHEMA,
  uuidv7,
  WORLD_FILE_MANIFEST,
  WORLD_SCHEMA,
  type World,
} from '@storyengine/shared';

import { findById } from '../index-db/query.js';
import { create, list } from '../library.js';
import {
  appendTurnToSession,
  listSessionFiles,
  readSession,
  readTurns,
} from '../sessions/store.js';
import { makePng } from '../storage/card/test-png.js';
import { readZipDirectory, readZipEntry } from '../storage/zip.js';
import { writeStoredZip } from '../storage/zip-writer.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***The look before a World lands*** —
 * [P16.3f](../../../../docs/design/workplan/34-p16-world.md),
 * [16 §5.1](../../../../docs/design/16-publish.md),
 * [10 §5](../../../../docs/design/10-ui-surfaces.md).
 *
 * **Through the door a client calls**, `POST /api/import/file/preview`, with
 * the bytes it sends: the head of the file — the manifest's local header and
 * its bytes, which is all `worldHeadOf` slices — or a whole small archive, or
 * a legacy `.sepack.json`. Every file is one Ned published through
 * `POST /api/publish` on the same install, so every id in it is held, by Ned,
 * when Amy looks: the one rule this preview must keep is that she cannot tell.
 */

const PASSWORD = 'another long password';

let server: TestServer;
let scratch: string;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
  await server.services.accounts.create({ handle: 'amy', password: PASSWORD, role: 'user' });
  scratch = await mkdtemp(join(tmpdir(), 'se-import-world-'));
});

afterEach(async () => {
  await server.dispose();
  await rm(scratch, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function cookies(on: TestServer = server): Record<string, string> {
  const headers: Record<string, string> = {
    cookie: [...on.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
  };
  const csrf = on.cookies.get('se_csrf');
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

/** One file part to a door, as the panel sends it — on this install, or another. */
async function send(
  url: string,
  filename: string,
  bytes: Uint8Array,
  on: TestServer = server,
): Promise<any> {
  const boundary = '----storyengineImportWorld';
  const response = await on.app.inject({
    method: 'POST',
    url,
    headers: { ...cookies(on), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  expect([200, 201], response.body).toContain(response.statusCode);
  return response.json();
}

async function preview(filename: string, bytes: Uint8Array): Promise<ImportPreview> {
  return ((await send('/api/import/file/preview', filename, bytes)) as { preview: ImportPreview })
    .preview;
}

function worldOf(answer: ImportPreview): ImportPreviewWorld {
  expect(answer.object?.kind).toBe('world');
  return answer.object as ImportPreviewWorld;
}

/** `POST /api/publish`, as the signed-in account. */
async function publish(start: object, ticked: Record<string, boolean> = {}): Promise<Buffer> {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/publish',
    headers: { ...cookies(), 'content-type': 'application/json' },
    payload: JSON.stringify({ start, choices: { ticked, history: false, keep: 'world' } }),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.rawPayload;
}

/** The head of a file — the first member's local header and its bytes — as `worldHeadOf` slices it. */
function headOf(file: Uint8Array): Uint8Array {
  const entry = firstLocalEntry(file.subarray(0, 64 * 1024));
  if (entry?.name !== WORLD_FILE_MANIFEST) throw new Error('no manifest first');
  return file.subarray(0, entry.dataStart + entry.size);
}

/** The same members, written again by the writer in another order. */
async function reordered(
  file: Uint8Array,
  order: (names: string[]) => string[],
  drop: (name: string) => boolean = () => false,
): Promise<Uint8Array> {
  const directory = readZipDirectory(file);
  if (!directory.ok) throw new Error(directory.refusal);
  const bytes = new Map(directory.entries.map((entry) => [entry.name, readZipEntry(file, entry)!]));
  const names = order(directory.entries.map((entry) => entry.name)).filter((name) => !drop(name));
  const to = join(scratch, `${uuidv7()}.zip`);
  await writeStoredZip(
    to,
    names.map((name) => ({ name, bytes: bytes.get(name)! })),
    { mtime: new Date('2026-10-11T09:00:00.000Z') },
  );
  return new Uint8Array(await readFile(to));
}

/**
 * The same members in the same order, written again with some of them changed
 * — a file somebody edited, or a writer other than this build's.
 */
async function rewritten(
  file: Uint8Array,
  change: Record<string, (bytes: Uint8Array) => Uint8Array>,
  extra: { name: string; bytes: Uint8Array }[] = [],
  order: (names: string[]) => string[] = (names) => names,
): Promise<Uint8Array> {
  const directory = readZipDirectory(file);
  if (!directory.ok) throw new Error(directory.refusal);
  const bytes = new Map(directory.entries.map((entry) => [entry.name, readZipEntry(file, entry)!]));
  for (const one of extra) bytes.set(one.name, one.bytes);
  const to = join(scratch, `${uuidv7()}.zip`);
  await writeStoredZip(
    to,
    order([...bytes.keys()]).map((name) => ({
      name,
      bytes: change[name]?.(bytes.get(name)!) ?? bytes.get(name)!,
    })),
    { mtime: new Date('2026-10-11T09:00:00.000Z') },
  );
  return new Uint8Array(await readFile(to));
}

/**
 * ***A zip as a folder-zipping tool writes one*** — the review of 2026-10-11:
 * Info-ZIP, Windows' *Compressed folder* and most libraries deflate a member
 * that compresses, and a library writing to a stream puts the sizes in a data
 * descriptor after the data. Written by hand, because this build's own writer
 * only ever stores.
 */
function zipAsATool(
  members: { name: string; bytes: Uint8Array }[],
  options: { descriptor?: boolean } = {},
): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const member of members) {
    const name = Buffer.from(member.name);
    const data = deflateRawSync(member.bytes);
    const crc = crc32(member.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(options.descriptor === true ? 0x0008 : 0, 6);
    local.writeUInt16LE(8, 8);
    if (options.descriptor !== true) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(member.bytes.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(options.descriptor === true ? 16 : 0);
    if (options.descriptor === true) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(data.length, 8);
      descriptor.writeUInt32LE(member.bytes.length, 12);
    }
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(options.descriptor === true ? 0x0008 : 0, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(member.bytes.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    parts.push(local, name, data, descriptor);
    central.push(record, name);
    offset += local.length + name.length + data.length + descriptor.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}

/** Every member of a file, in its order, as bytes — what a tool re-zipping it starts from. */
function membersOf(file: Uint8Array): { name: string; bytes: Uint8Array }[] {
  const directory = readZipDirectory(file);
  if (!directory.ok) throw new Error(directory.refusal);
  return directory.entries.map((entry) => ({
    name: entry.name,
    bytes: readZipEntry(file, entry)!,
  }));
}

/**
 * The manifest's local header and its compressed bytes, wherever it is — what
 * `worldHeadOf` slices by the archive's directory, which knows the sizes a
 * data descriptor keeps out of the header.
 */
function manifestSliceOf(file: Uint8Array): Uint8Array {
  const directory = readZipDirectory(file);
  if (!directory.ok) throw new Error(directory.refusal);
  const entry = directory.entries.find((one) => one.name === WORLD_FILE_MANIFEST)!;
  const header = firstLocalEntry(file.subarray(entry.offset))!;
  return file.subarray(entry.offset, entry.offset + header.dataStart + entry.compressedSize);
}

/** JSON in, JSON out — a member's bytes edited as the document it is. */
function editJson(edit: (document: any) => void): (bytes: Uint8Array) => Uint8Array {
  return (bytes) => {
    const document = JSON.parse(new TextDecoder().decode(bytes));
    edit(document);
    return new TextEncoder().encode(JSON.stringify(document));
  };
}

/** Every file and directory under the data directory, by content — `publish.test.ts`'s measure. */
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

function indexRows(): string {
  const db = server.services.library.db;
  const tables = db
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all() as { name: string }[];
  const hash = createHash('sha256');
  for (const { name } of tables) {
    hash.update(
      JSON.stringify([name, db.prepare(`select * from "${name}"`).all()], (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  }
  return hash.digest('hex');
}

interface Authored {
  world: World;
  vera: { id: string };
  harbour: { id: string };
  tides: { id: string };
  bell: { id: string };
  sessionId: string;
}

/**
 * ***Ned's Rain City***: Vera, the Harbour and the Drowned Bell as members;
 * the Bell requires the Tides, which Ned leaves out of the file — so the file
 * names it as left behind; and a session played in the World, two turns long.
 */
async function author(): Promise<Authored> {
  const library = server.services.library;
  const harbour = newLorebook('Harbour');
  await create(library, 'ned', harbour, LOREBOOK_SCHEMA);
  const tides = newLorebook('Tides');
  await create(library, 'ned', tides, LOREBOOK_SCHEMA);
  const vera = newActor('Vera');
  await create(library, 'ned', vera, ACTOR_SCHEMA, { cardPixels: makePng(8, 1) });
  const bell = {
    ...newTreatment('The Drowned Bell'),
    lore: [{ ref: { id: tides.id, name: 'Tides' }, required: true }],
  };
  await create(library, 'ned', bell, TREATMENT_SCHEMA);
  const world: World = {
    ...newWorld('Rain City'),
    description: 'A port that is always wet.',
    contents: [
      { schema: ACTOR_SCHEMA, id: vera.id, name: 'Vera' },
      { schema: LOREBOOK_SCHEMA, id: harbour.id, name: 'Harbour' },
      { schema: TREATMENT_SCHEMA, id: bell.id, name: 'The Drowned Bell' },
    ],
  };
  await create(library, 'ned', world, WORLD_SCHEMA);
  const started = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Night one', world: world.id, cast: { persona: null, actors: [vera.id] } },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const sessionId = started.body.session.id as string;
  let parent: string | null = null;
  for (const said of ['The quay is wet.', 'The bell rings under the water.']) {
    const id = uuidv7();
    await appendTurnToSession(server.services.sessions, 'ned', sessionId, {
      id,
      sessionId,
      parentTurnId: parent,
      createdAt: new Date().toISOString(),
      status: 'complete',
      input: { actorId: null, kind: 'say', text: 'And then?', raw: '' },
      output: { text: said },
      effects: [],
      tape: [],
    } as never);
    parent = id;
  }
  return { world, vera, harbour, tides, bell, sessionId };
}

/** The World file, with the session ticked and the Tides left behind. */
async function rainCity(ned: Authored): Promise<Buffer> {
  return publish(
    { kind: 'world', id: ned.world.id },
    { [ned.sessionId]: true, [ned.tides.id]: false },
  );
}

// ── From the head of the file ───────────────────────────────────────────────

describe('a World file looked at from its head', () => {
  it('answers by kind and name, what is here, what dangles and the sessions — and writes nothing', async () => {
    const ned = await author();
    const file = await rainCity(ned);
    // Amy has the Harbour already: an earlier arrival of Ned's book alone.
    const harbourAlone = await publish({ kind: 'objects', ids: [ned.harbour.id] });
    await signInAs('amy');
    await send('/api/import/file', 'harbour.seworld', harbourAlone);
    const before = await tree();
    const rows = indexRows();

    const head = headOf(file);
    expect(head.length).toBeLessThan(file.length);
    const answer = await preview('rain-city.seworld', head);

    expect(await tree()).toEqual(before);
    expect(indexRows()).toBe(rows);
    expect(answer).toMatchObject({ disposition: 'converted', reimport: 'unknown' });
    const world = worldOf(answer);
    expect(world).toMatchObject({
      format: 'world-file',
      origin: 'world',
      world: { id: ned.world.id, name: 'Rain City', description: 'A port that is always wet.' },
      history: false,
    });
    expect(world.world?.here).toBe(false);
    expect(world.objects.map((one) => [one.kind, one.name, one.member, one.here])).toEqual([
      ['actors', 'Vera', true, 'new'],
      ['lorebooks', 'Harbour', true, 'here'],
      ['treatments', 'The Drowned Bell', true, 'new'],
    ]);
    expect(world.sessions).toEqual([
      {
        id: ned.sessionId,
        name: 'Night one',
        turns: 2,
        pictures: 0,
        attachments: 0,
        mode: expect.any(String),
        here: false,
      },
    ]);
    expect(world.leftBehind).toEqual([
      expect.objectContaining({
        id: ned.tides.id,
        name: 'Tides',
        reason: 'unchecked',
        required: true,
        resolvesHere: false,
      }),
    ]);

    // A book of Amy's own called the Tides: the Bell's link resolves by name.
    await create(server.services.library, 'amy', newLorebook('Tides'), LOREBOOK_SCHEMA);
    const again = worldOf(await preview('rain-city.seworld', head));
    expect(again.leftBehind.map((one) => one.resolvesHere)).toEqual([true]);
  });

  /**
   * ***The anti-leak rule.*** Every id in the file is held — by Ned, on this
   * install — and Amy's look says `new` for each, exactly what it says for an
   * id nobody holds. Ned's look at the same bytes says `here` for all of it.
   */
  it('previews an id another account holds as new', async () => {
    const ned = await author();
    const head = headOf(await rainCity(ned));
    for (const id of [ned.world.id, ned.vera.id, ned.harbour.id, ned.bell.id]) {
      expect(findById(server.services.library.db, id)?.owner).toBe('user:ned');
    }

    const own = worldOf(await preview('rain-city.seworld', head));
    await signInAs('amy');
    const theirs = worldOf(await preview('rain-city.seworld', head));

    expect(own.world?.here).toBe(true);
    expect(own.objects.map((one) => one.here)).toEqual(['here', 'here', 'here']);
    expect(own.sessions.map((one) => one.here)).toEqual([true]);
    expect(theirs.world?.here).toBe(false);
    expect(theirs.objects.map((one) => one.here)).toEqual(['new', 'new', 'new']);
    expect(theirs.sessions.map((one) => one.here)).toEqual([false]);
    // The Tides is Ned's: it resolves for him, and for Amy it dangles.
    expect(own.leftBehind.map((one) => one.resolvesHere)).toEqual([true]);
    expect(theirs.leftBehind.map((one) => one.resolvesHere)).toEqual([false]);
  });

  it('says a session Amy already has is here, after her first import of the file', async () => {
    const ned = await author();
    const file = await rainCity(ned);
    await signInAs('amy');
    const committed = await send('/api/import/file', 'rain-city.seworld', file);
    expect(committed.world).toMatchObject({
      name: 'Rain City',
      members: 3,
      sessions: 1,
      dangling: 1,
    });

    const answer = worldOf(await preview('rain-city.seworld', headOf(file)));

    expect(answer.world?.here).toBe(true);
    expect(answer.objects.map((one) => one.here)).toEqual(['here', 'here', 'here']);
    expect(answer.sessions.map((one) => one.here)).toEqual([true]);
  });
});

// ── Not from the head ───────────────────────────────────────────────────────

describe('a World file the head does not answer for', () => {
  it('previews as a World when its manifest is not the first member', async () => {
    const ned = await author();
    const file = await rainCity(ned);
    const last = await reordered(file, (names) => [
      ...names.filter((name) => name !== WORLD_FILE_MANIFEST),
      WORLD_FILE_MANIFEST,
    ]);
    expect(firstLocalEntry(last)?.name).not.toBe(WORLD_FILE_MANIFEST);
    await signInAs('amy');

    const answer = worldOf(await preview('rain-city.zip', last));

    expect(answer.objects.map((one) => one.name)).toEqual(['Vera', 'Harbour', 'The Drowned Bell']);
    expect(answer.sessions.map((one) => one.name)).toEqual(['Night one']);
    // And the commit reads it as the World it is.
    const committed = await send('/api/import/file', 'rain-city.zip', last);
    expect(committed.report.source).toBe('storyengine-world');
    expect(committed.world).toMatchObject({ name: 'Rain City', members: 3, sessions: 1 });
  });

  /**
   * ***Zipped again by a tool, as a person would*** (2026-10-11, the review):
   * P16.3e's record calls a file unpacked and zipped again *the ordinary
   * course*, and every such tool deflates a JSON member and sorts the names,
   * so the manifest is neither first nor stored. ~~A head that was not
   * stored was not this arm's~~, and the panel, which never sends a zip whole,
   * fell back to the folder look. The slice is the manifest's local header and
   * its compressed bytes; the server inflates them, bounded by the manifest's
   * ceiling — with the sizes in a data descriptor too, which the slice ends
   * at the data's end by the archive's directory.
   */
  it('previews as a World a file zipped again by a tool — deflated, not first, sizes after', async () => {
    const ned = await author();
    const members = membersOf(await rainCity(ned)).sort((one, two) =>
      one.name < two.name ? -1 : 1,
    );
    expect(members.at(-1)?.name).toBe(WORLD_FILE_MANIFEST);
    await signInAs('amy');
    const before = await tree();

    for (const descriptor of [false, true]) {
      const file = zipAsATool(members, { descriptor });
      const slice = manifestSliceOf(file);
      expect(firstLocalEntry(slice)).toMatchObject({ name: WORLD_FILE_MANIFEST, method: 8 });

      const answer = worldOf(await preview('rain-city.zip', slice));

      expect(answer.world?.name).toBe('Rain City');
      expect(answer.objects.map((one) => one.name)).toEqual([
        'Vera',
        'Harbour',
        'The Drowned Bell',
      ]);
      expect(answer.sessions.map((one) => [one.name, one.turns])).toEqual([['Night one', 2]]);
      // And sent whole, the archive's own reader answers the same.
      expect(worldOf(await preview('rain-city.zip', file)).world?.name).toBe('Rain City');
    }
    expect(await tree()).toEqual(before);
    const committed = await send('/api/import/file', 'rain-city.zip', zipAsATool(members));
    expect(committed.world).toMatchObject({ name: 'Rain City', members: 3, sessions: 1 });
  });

  it('refuses at the look a deflated manifest that inflates past its ceiling', async () => {
    const huge = new TextEncoder().encode(
      JSON.stringify({ schema: 'storyengine.world-file/1', padding: ' '.repeat(5 * 1024 * 1024) }),
    );
    const file = zipAsATool([{ name: WORLD_FILE_MANIFEST, bytes: huge }]);
    expect(file.length).toBeLessThan(64 * 1024);

    const answer = await preview('rain-city.seworld', manifestSliceOf(file));

    expect(answer.object).toBeNull();
    expect(answer.notes.map((note) => note.params['refusal'])).toEqual(['unknown-format']);
  });

  /**
   * ***A whole archive is classified first***, as the commit classifies it
   * (the review): a manifest beside another probe's mark is a root the sweep
   * refuses as ambiguous, and the look says so rather than showing a World.
   */
  it('refuses at the look a whole archive whose root is ambiguous, wherever its manifest is', async () => {
    const ned = await author();
    const published = await rainCity(ned);
    await signInAs('amy');

    for (const last of [true, false]) {
      const file = await rewritten(
        published,
        {},
        [{ name: 'card.json', bytes: new TextEncoder().encode('{}') }],
        (names) =>
          last
            ? [...names.filter((name) => name !== WORLD_FILE_MANIFEST), WORLD_FILE_MANIFEST]
            : names,
      );
      expect(firstLocalEntry(file)?.name === WORLD_FILE_MANIFEST).toBe(!last);

      const answer = await preview('rain-city.zip', file);

      expect(answer.object, `manifest last: ${String(last)}`).toBeNull();
      expect(answer.notes).toEqual([
        {
          key: 'import.file.refused',
          params: { file: 'rain-city.zip', refusal: 'ambiguous-root' },
          level: 'warn',
        },
      ]);
    }
  });

  it('still sweeps a zip that holds no manifest', async () => {
    const tides = newLorebook('Tides');
    const zip = join(scratch, 'books.zip');
    await writeStoredZip(
      zip,
      [{ name: 'tides.json', bytes: new TextEncoder().encode(JSON.stringify(tides)) }],
      { mtime: new Date('2026-10-11T09:00:00.000Z') },
    );
    const bytes = new Uint8Array(await readFile(zip));

    const answer = await preview('books.zip', bytes);

    expect(answer.object).toEqual({ kind: 'sweep' });
    expect(answer.notes.map((note) => note.key)).toEqual(['import.file.importsAsFolder']);
    const committed = await send('/api/import/file', 'books.zip', bytes);
    expect(committed.report.source).toBe('loose-files');
    expect(committed.world).toBeUndefined();
    expect(
      list(server.services.library, 'ned', LOREBOOK_SCHEMA)
        .filter((row) => row.owner === 'user:ned')
        .map((row) => row.name),
    ).toEqual(['Tides']);
  });

  it('refuses at the look a manifest at the head that the commit would refuse', async () => {
    const ned = await author();
    const file = await rainCity(ned);
    const head = Uint8Array.from(headOf(file));
    const entry = firstLocalEntry(head)!;
    // The schema's version moved past what this build reads — `/2`, same length.
    const at = Buffer.from(head).indexOf('storyengine.world-file/1', entry.dataStart);
    head[at + 'storyengine.world-file/'.length] = '2'.charCodeAt(0);

    const answer = await preview('rain-city.seworld', head);

    expect(answer.object).toBeNull();
    expect(answer.notes).toEqual([
      {
        key: 'import.file.refused',
        params: { file: 'rain-city.seworld', refusal: 'unknown-format' },
        level: 'warn',
      },
    ]);
  });
});

// ── The legacy file ─────────────────────────────────────────────────────────

describe('a .sepack.json', () => {
  const FIXTURE = join(
    import.meta.dirname,
    '..',
    'import',
    'world',
    'fixtures',
    'package-export-1.sepack.json',
  );

  it('previews and commits as a World', async () => {
    const bytes = await readFile(FIXTURE);

    const answer = worldOf(await preview('rain-city.sepack.json', bytes));

    expect(answer).toMatchObject({
      format: 'package-export',
      origin: null,
      world: { name: 'Rain City', here: false },
      sessions: [],
    });
    expect(answer.objects.map((one) => [one.kind, one.name, one.here])).toEqual([
      ['actors', 'Vera', 'new'],
      ['lorebooks', 'Harbour', 'new'],
      ['treatments', 'The Drowned Bell', 'new'],
      ['presets', 'Wet Prose', 'new'],
    ]);
    expect(answer.omitted.map((note) => note.key)).toEqual([
      'import.world.legacyNoPictures',
      'import.world.noPortrait',
    ]);

    const committed = await send('/api/import/file', 'rain-city.sepack.json', bytes);
    expect(committed.world).toMatchObject({ name: 'Rain City', members: 4, sessions: 0 });
    const again = worldOf(await preview('rain-city.sepack.json', bytes));
    expect(again.world?.here).toBe(true);
    expect(again.objects.map((one) => one.here)).toEqual(['here', 'here', 'here', 'here']);
  });
});

// ── What landing a session does not do ──────────────────────────────────────

describe('a World’s session, landed', () => {
  /**
   * ***Quietly*** — the stage's decision (`SessionImportOptions.warm`): a
   * session somebody sent is not warmed on the recipient's connections.
   */
  it('asks for no summary warm', async () => {
    const ned = await author();
    const file = await rainCity(ned);
    const warmed = vi.fn();
    server.services.sessions.imported = warmed;
    await signInAs('amy');

    const committed = await send('/api/import/file', 'rain-city.seworld', file);

    expect(committed.world.sessions).toBe(1);
    expect(await listSessionFiles(server.services.sessions, 'amy')).toHaveLength(1);
    expect(warmed).not.toHaveBeenCalled();
  });

  it('names the landed session in the World, and the session row says it landed', async () => {
    const ned = await author();
    const file = await rainCity(ned);
    await signInAs('amy');

    const committed = await send('/api/import/file', 'rain-city.seworld', file);

    const [landed] = await listSessionFiles(server.services.sessions, 'amy');
    const row = committed.report.items.find((item: { source: string }) =>
      item.source.endsWith('session-export.json'),
    );
    expect(row).toEqual({
      source: `sessions/${ned.sessionId}/session-export.json`,
      disposition: 'converted',
      objectId: landed!.id,
      notes: [
        {
          key: 'import.world.sessionLanded',
          params: { session: 'Night one', turns: 2, pictures: 0 },
          level: 'info',
        },
      ],
    });
    const world = list(server.services.library, 'amy', WORLD_SCHEMA)[0]!.body as World;
    expect(world.contents.at(-1)).toEqual({
      schema: SESSION_SCHEMA,
      id: landed!.id,
      name: 'Night one',
    });
  });
});

// ── What a session landing does not take on trust (2026-10-11, the review) ──

describe('a World’s session, against what is already on the install', () => {
  /**
   * ***A turn row with no session row is a claim*** — the fact check's
   * correction to `sessionHolding`, asked here of the landing that reads it:
   * on an install where nobody holds the file's turns but one orphaned row
   * does, the session still lands — re-keyed, never refused, never under the
   * ids that row has.
   */
  it('re-keys turns an orphaned index row holds, and lands the session', async () => {
    const ned = await author();
    const file = await rainCity(ned);
    const nedTurns = [...(await readTurns(server.services.sessions, 'ned', ned.sessionId)).keys()];
    const other = await makeTestServer();
    try {
      await setUpAdmin(other, 'amy');
      other.services.sessions.index
        .prepare('insert into turn (turn_id, session_id, segment, offset) values (?, ?, ?, ?)')
        .run(nedTurns[0]!, uuidv7(), '000001', 0);

      const committed = await send('/api/import/file', 'rain-city.seworld', file, other);

      const row = committed.report.items.find((item: { source: string }) =>
        item.source.endsWith('session-export.json'),
      );
      expect(row).toMatchObject({
        disposition: 'converted',
        notes: [{ key: 'import.world.sessionLanded', params: { turns: 2 } }],
      });
      const [landed] = await listSessionFiles(other.services.sessions, 'amy');
      const turns = await readTurns(other.services.sessions, 'amy', landed!.id);
      expect(turns.size).toBe(2);
      for (const id of turns.keys()) expect(nedTurns).not.toContain(id);
    } finally {
      await other.dispose();
    }
  });

  /**
   * ***A World names exactly what landed*** — the half of it the round trip
   * cannot reach: a ticked session that is refused (one with no turns, which
   * `importSession` refuses) is said on its row and named nowhere.
   */
  it('names no session that did not land', async () => {
    const ned = await author();
    const started = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Night two', world: ned.world.id },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const empty = started.body.session.id as string;
    const file = await publish(
      { kind: 'world', id: ned.world.id },
      { [ned.sessionId]: true, [empty]: true, [ned.tides.id]: false },
    );
    await signInAs('amy');

    const committed = await send('/api/import/file', 'rain-city.seworld', file);

    const refusedRow = committed.report.items.find(
      (item: { source: string }) => item.source === `sessions/${empty}/session-export.json`,
    );
    expect(refusedRow).toMatchObject({
      disposition: 'unrecognised',
      notes: [
        {
          key: 'import.world.sessionRefused',
          params: { session: 'Night two', reason: 'no-turns' },
        },
      ],
    });
    const landed = await listSessionFiles(server.services.sessions, 'amy');
    expect(landed.map((one) => one.name)).toEqual(['Night one']);
    const world = list(server.services.library, 'amy', WORLD_SCHEMA)[0]!.body as World;
    expect(world.contents.filter((entry) => entry.schema === SESSION_SCHEMA)).toEqual([
      { schema: SESSION_SCHEMA, id: landed[0]!.id, name: 'Night one' },
    ]);
    expect(committed.world.sessions).toBe(1);
  });

  /**
   * ***A session left behind resolves only for the account whose it is*** —
   * the anti-leak rule for the one kind with no name to fall back on. A
   * hand-made manifest names one of Ned's sessions the file does not carry:
   * Ned's look finds it, Amy's does not — whoever's it is — and her commit
   * counts it as dangling.
   */
  it('resolves a left-behind session for its owner only', async () => {
    const ned = await author();
    const started = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Night two' },
    });
    const unsent = started.body.session.id as string;
    const file = await rewritten(await rainCity(ned), {
      [WORLD_FILE_MANIFEST]: editJson((manifest) => {
        manifest.leftBehind.push({
          schema: SESSION_SCHEMA,
          id: unsent,
          name: 'Night two',
          reason: 'unchecked',
          required: false,
          from: [ned.world.id],
        });
      }),
    });
    const head = headOf(file);
    const resolves = (world: ImportPreviewWorld) =>
      world.leftBehind.find((one) => one.id === unsent)?.resolvesHere;

    const own = worldOf(await preview('rain-city.seworld', head));
    await signInAs('amy');
    const theirs = worldOf(await preview('rain-city.seworld', head));

    expect(resolves(own)).toBe(true);
    expect(resolves(theirs)).toBe(false);
    const committed = await send('/api/import/file', 'rain-city.seworld', file);
    // The Tides, and Ned's session.
    expect(committed.world.dangling).toBe(2);
  });

  /**
   * ***An archive is the sender's housekeeping*** — the writer leaves
   * `archivedAt` out, and the reader drops it too, for a file a writer made
   * that kept it: the session lands where Amy can see it.
   */
  it('lands a session the file says is archived where Amy can see it', async () => {
    const ned = await author();
    const file = await rewritten(await rainCity(ned), {
      [`sessions/${ned.sessionId}/session-export.json`]: editJson((exported) => {
        exported.session.archivedAt = '2026-10-09T00:00:00.000Z';
      }),
    });
    await signInAs('amy');

    await send('/api/import/file', 'rain-city.seworld', file);

    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect((listed.body.sessions as { name: string }[]).map((one) => one.name)).toEqual([
      'Night one',
    ]);
    const [landed] = await listSessionFiles(server.services.sessions, 'amy');
    expect((await readSession(server.services.sessions, 'amy', landed!.id))?.archivedAt).toBe(
      undefined,
    );
  });
});
