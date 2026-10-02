// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';

import multipartPlugin from '@fastify/multipart';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  aventurasDatabaseBytes,
  VAULT_CHARACTERS,
  VAULT_LOREBOOKS,
  VAULT_SCENARIO_NPCS,
  VAULT_SCENARIOS,
  writeAventurasBackupFolder,
} from '../import/fixtures/test-aventuras-db.js';
import { DEFAULT_ZIP_LIMITS, readZipDirectory } from '../storage/zip.js';
import { makeZip, type ZipInput } from '../storage/test-zip.js';
import {
  eventually,
  makeTestServer,
  ownObjects,
  setUpAdmin,
  tempRoot,
  type TestServer,
} from '../test-server.js';
import { receiveImportUpload } from './import-upload.js';

/**
 * ***Large uploads, landed on disk rather than held*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md), at the
 * door: `POST /api/import/file` with an Aventuras backup zip and with a bare
 * `aventura.db`, both of which are now written to the import scratch root as
 * they arrive (`routes/import-upload.ts`) and read from there.
 *
 * **Every refusal is asked the same two further questions**: did it close the
 * connection behind it — a browser still sending sees a reset otherwise, not
 * our answer — and is scratch empty afterwards. A landing that refused and left
 * half a gigabyte in `state/import-scratch/` until the next restart would be
 * the failure this stage is most likely to have, and the least likely to be
 * noticed.
 */

let server: TestServer;
let container: string;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
  container = await tempRoot('se-import-landing-');
});

afterEach(async () => {
  await server.dispose();
  await rm(container, { recursive: true, force: true });
});

async function scratch(): Promise<string[]> {
  try {
    return await readdir(server.services.library.layout.importScratchRoot);
  } catch {
    return [];
  }
}

function diskHas(bytes: number): void {
  server.services.freeBytes = () => Promise.resolve(bytes);
}

/** Saves limits through the route a person uses, as `live-config.test.ts` does. */
async function setLimits(limits: Record<string, number>): Promise<void> {
  const response = await server.request({
    method: 'PUT',
    url: '/api/admin/config',
    payload: { config: { limits } },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

const BOUNDARY = '----storyengineLandingBoundary';
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;

/** One file part, and the fields before it, as the client sends them. */
function multipart(filename: string, bytes: Uint8Array, fields: Record<string, string> = {}) {
  const head = Object.entries(fields)
    .map(
      ([name, value]) =>
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    )
    .join('');
  return {
    head: Buffer.from(
      `${head}--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    body: Buffer.from(bytes),
    tail: Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  };
}

/** The upload with its length declared, as a browser sends one. */
function upload(filename: string, bytes: Uint8Array) {
  const { head, body, tail } = multipart(filename, bytes);
  return server.request({
    method: 'POST',
    url: '/api/import/file',
    payload: Buffer.concat([head, body, tail]),
    headers: { 'content-type': MULTIPART },
  });
}

/**
 * The upload as a stream with **no declared length**, in the chunks given —
 * which is how a test reaches the byte count behind the declared-length check,
 * and the sniff across chunks a network cut short.
 */
function uploadStreamed(chunks: readonly Buffer[]) {
  return server.request({
    method: 'POST',
    url: '/api/import/file',
    payload: Readable.from(chunks),
    headers: { 'content-type': MULTIPART },
  });
}

/** An Aventuras backup as Aventuras zips one: the database deflated, and `metadata.json`. */
let backups = 0;
async function backupZip(extra: readonly ZipInput[] = []): Promise<Uint8Array> {
  const root = join(container, `backup-${String((backups += 1))}`);
  await writeAventurasBackupFolder(root);
  return makeZip([
    { name: 'aventura.db', body: await readFile(join(root, 'aventura.db')), deflate: true },
    { name: 'metadata.json', body: await readFile(join(root, 'metadata.json')) },
    ...extra,
  ]);
}

/** What the fixture's vault becomes: its books, characters, scenarios, and the scenarios' npcs. */
const VAULT_OBJECTS =
  VAULT_CHARACTERS.length + VAULT_LOREBOOKS.length + VAULT_SCENARIOS.length + VAULT_SCENARIO_NPCS;

describe('an Aventuras backup zip, landed', () => {
  it('imports the vault, lists the old stories beside it, and leaves scratch empty', async () => {
    /**
     * An old backup carries `stories/*.avt` beside the database. Their sizes
     * are declared and never inflated: the reader lists them and skips them,
     * and the file-backed reader counts only what it inflates, so a pair of
     * large stories costs nothing.
     */
    const zip = await backupZip([
      { name: 'stories/the-drowned-bell.avt', body: '{"story":"x"}'.repeat(2000), deflate: true },
    ]);

    const response = await upload('aventura-backup.zip', zip);

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.item.source).toMatch(/^aventura\.db\//);
    expect((await ownObjects(server)).objects).toHaveLength(VAULT_OBJECTS);
    expect(await scratch()).toEqual([]);

    // A second upload of the same bytes writes nothing new.
    const again = await upload('aventura-backup.zip', zip);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await ownObjects(server)).objects).toHaveLength(VAULT_OBJECTS);
    expect(await scratch()).toEqual([]);
  });

  it('imports one whose database is past the 64 MB an in-memory entry was held to', async () => {
    /**
     * [§1.11]'s row, the reason for the stage: a zip of a few hundred kilobytes
     * holding a database past 64 MB. The in-memory reader refuses it at its
     * central directory (asserted first, so this test is about the bound it
     * says it is about); landed, the database is inflated to scratch and read
     * from there. The bulk is a table of zero-filled blobs, which deflate to
     * almost nothing — Aventuras' base64 pictures would not, but the bound is
     * on the inflated size.
     */
    const root = join(container, 'big');
    await mkdir(root, { recursive: true });
    await writeAventurasBackupFolder(root);
    const db = new DatabaseSync(join(root, 'aventura.db'));
    try {
      db.exec('create table gallery (id integer primary key, picture blob)');
      const insert = db.prepare('insert into gallery (picture) values (zeroblob(?))');
      for (let i = 0; i < 70; i += 1) insert.run(1024 * 1024);
      db.exec('pragma wal_checkpoint(truncate)');
    } finally {
      db.close();
    }
    const database = await readFile(join(root, 'aventura.db'));
    expect(database.byteLength).toBeGreaterThan(64 * 1024 * 1024);
    const zip = makeZip([
      { name: 'aventura.db', body: database, deflate: true },
      { name: 'metadata.json', body: await readFile(join(root, 'metadata.json')) },
    ]);
    expect(readZipDirectory(zip, DEFAULT_ZIP_LIMITS)).toEqual({ ok: false, refusal: 'too-large' });

    const response = await upload('aventura-backup.zip', zip);

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await ownObjects(server)).objects).toHaveLength(VAULT_OBJECTS);
    expect(await scratch()).toEqual([]);
  });

  it('refuses a zip cut short as a bad archive, and leaves nothing', async () => {
    const zip = await backupZip();
    const response = await upload('aventura-backup.zip', zip.subarray(0, zip.length - 30));

    expect(response.status).toBe(200);
    expect(response.body.item.disposition).toBe('unrecognised');
    expect(response.body.notes[0]).toMatchObject({
      key: 'import.file.badArchive',
      params: { refusal: 'malformed' },
    });
    expect(await scratch()).toEqual([]);
  });
});

describe('a bare aventura.db, landed', () => {
  it('imports as a root of one file, whatever it was called, and leaves scratch empty', async () => {
    // [§1.1]'s fourth transport, recognised by the SQLite header rather than
    // the name — a download renamed `my-library (1).db` is the same database.
    const response = await upload('my-library (1).db', await aventurasDatabaseBytes());

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await ownObjects(server)).objects).toHaveLength(VAULT_OBJECTS);
    expect(await scratch()).toEqual([]);
  });

  it('is sniffed from sixteen bytes gathered across chunks, however short the first', async () => {
    // One byte to a chunk through SQLite's header. A route that sniffed the
    // first chunk alone would buffer this as an ordinary file, and the upload
    // reader would call it unrecognised.
    const { head, body, tail } = multipart('aventura.db', await aventurasDatabaseBytes());
    const chunks = [head, ...[...body.subarray(0, 20)].map((byte) => Buffer.from([byte]))];
    chunks.push(body.subarray(20), tail);

    const response = await uploadStreamed(chunks);

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await ownObjects(server)).objects).toHaveLength(VAULT_OBJECTS);
    expect(await scratch()).toEqual([]);
  });

  it('refuses a SQLite file that is not Aventuras’, by its columns, and leaves nothing', async () => {
    const path = join(container, 'other.db');
    const db = new DatabaseSync(path);
    db.exec('create table notes (id integer primary key, body text)');
    db.close();

    const response = await upload('other.db', await readFile(path));

    expect(response.status).toBe(200);
    expect(response.body.item.disposition).toBe('unrecognised');
    expect(response.body.notes[0]).toMatchObject({
      key: 'import.file.refused',
      params: { refusal: 'unknown-format' },
    });
    expect(await scratch()).toEqual([]);
  });
});

describe('what a landing refuses', () => {
  it('follows a lowered import limit on the next upload, with no restart', async () => {
    // `maxUploadMb` stays at 64: the import limit is a cap of its own, and
    // lowering it below the other is the tightening it exists for.
    const zip = makeZip([{ name: 'aventura.db', body: new Uint8Array(2 * 1024 * 1024) }]);
    await setLimits({ maxUploadMb: 64, maxImportUploadMb: 1 });

    const response = await upload('aventura-backup.zip', zip);

    expect(response.status).toBe(413);
    expect(response.body.error).toBe('too-large');
    expect(response.body.message).toContain('1 MB import upload limit');
    expect(response.headers['connection']).toBe('close');
    expect(await scratch()).toEqual([]);

    // And raised again, the same file is taken — as a malformed database,
    // which is the point: it got as far as the reader.
    await setLimits({ maxUploadMb: 64, maxImportUploadMb: 8 });
    const again = await upload('aventura-backup.zip', zip);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(await scratch()).toEqual([]);
  });

  it('counts the bytes when no length was declared, and stops at the limit', async () => {
    await setLimits({ maxUploadMb: 64, maxImportUploadMb: 1 });
    const { head, body, tail } = multipart(
      'aventura.db',
      Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(3 * 1024 * 1024)]),
    );
    const chunks = [head];
    for (let at = 0; at < body.length; at += 64 * 1024)
      chunks.push(body.subarray(at, at + 64 * 1024));
    chunks.push(tail);

    const response = await uploadStreamed(chunks);

    expect(response.status).toBe(413);
    expect(response.body.message).toContain('1 MB import upload limit');
    expect(response.headers['connection']).toBe('close');
    expect(await scratch()).toEqual([]);
  });

  it('refuses before reading a body that declares itself past every limit', async () => {
    await setLimits({ maxUploadMb: 1, maxImportUploadMb: 1 });
    const zip = makeZip([{ name: 'aventura.db', body: new Uint8Array(3 * 1024 * 1024) }]);

    const response = await upload('aventura-backup.zip', zip);

    expect(response.status).toBe(413);
    expect(response.headers['connection']).toBe('close');
    expect(await scratch()).toEqual([]);
  });

  it('answers 507 when there is no room to receive it, before writing a byte', async () => {
    diskHas(1024);

    const response = await upload('aventura-backup.zip', await backupZip());

    expect(response.status, JSON.stringify(response.body)).toBe(507);
    expect(response.body.error).toBe('no-space');
    expect(response.body.message).toMatch(/receive this upload.*MB is free/);
    expect(response.headers['connection']).toBe('close');
    expect(await scratch()).toEqual([]);
  });

  it('answers 507 when the upload fits and the database it unpacks to does not', async () => {
    /**
     * The landing asks for 1.1× the upload; the database inflated out of it
     * asks for its own declared size. A backup whose database deflates well
     * passes the first and fails the second — which is the snapshot's room
     * check reached through the archive (`landEntryWithLog`), answered as the
     * same `507`, with the space the upload landed in removed too.
     */
    const zip = makeZip([
      { name: 'aventura.db', body: await aventurasDatabaseBytes(), deflate: true },
    ]);
    const declared = zip.byteLength + 1024;
    expect((await aventurasDatabaseBytes()).byteLength).toBeGreaterThan(2 * declared);
    diskHas(64 * 1024 * 1024 + Math.ceil(declared * 1.1) + declared);

    const response = await upload('aventura-backup.zip', zip);

    expect(response.status, JSON.stringify(response.body)).toBe(507);
    expect(response.body.error).toBe('no-space');
    expect(response.body.message).toMatch(/copy this database.*MB is free/);
    expect(await scratch()).toEqual([]);
  });

  it('takes one large upload at a time, and refuses the second while the first lands', async () => {
    /**
     * Two real requests, the first held open part way through its body. A
     * body with no declared length is *large* — nobody said it was not — so
     * the first takes the slot and the second, arriving meanwhile, is refused
     * with `retry-after` and the connection closed. When the first finishes,
     * the slot is free again.
     */
    diskHas(64 * 1024 * 1024 * 1024);
    const zip = await backupZip();
    const { head, body, tail } = multipart('aventura-backup.zip', zip);

    const held = new PassThrough();
    const first = server.request({
      method: 'POST',
      url: '/api/import/file',
      payload: held,
      headers: { 'content-type': MULTIPART },
    });
    held.write(head);
    held.write(body.subarray(0, 1024));
    await eventually(() => Promise.resolve(server.services.largeUploadInFlight));

    const second = await uploadStreamed([head, body, tail]);
    expect(second.status).toBe(503);
    expect(second.body.error).toBe('upload-busy');
    expect(second.headers['retry-after']).toBe('30');
    expect(second.headers['connection']).toBe('close');

    held.end(Buffer.concat([body.subarray(1024), tail]));
    const done = await first;
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(server.services.largeUploadInFlight).toBe(false);
    expect(await scratch()).toEqual([]);

    // Free again: the same upload now goes through.
    const third = await uploadStreamed([head, body, tail]);
    expect(third.status, JSON.stringify(third.body)).toBe(200);
  });

  it('leaves a small archive out of the slot, so two people’s cards do not queue', async () => {
    // Declared, and under `maxUploadMb`: not large, whatever is in flight.
    server.services.largeUploadInFlight = true;
    const response = await upload('aventura-backup.zip', await backupZip());
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    server.services.largeUploadInFlight = false;
  });

  it('still buffers everything else under the ordinary limit', async () => {
    // A preset is not an archive or a database: it goes the way it always did,
    // under `maxUploadMb`, even when the import limit is larger.
    await setLimits({ maxUploadMb: 1, maxImportUploadMb: 1024 });
    const big = new TextEncoder().encode(`{"padding":"${'x'.repeat(2 * 1024 * 1024)}"}`);

    const response = await upload('Harbour.json', big);

    expect(response.status).toBe(413);
    expect(response.body.message).toContain('1 MB upload limit');
    expect(response.headers['connection']).toBe('close');
  });
});

describe('an upload that stops arriving', () => {
  it('is given up on after the idle window, with the slot and the scratch let go', async () => {
    /**
     * The route's own window is a minute, so this drives the same function
     * behind a bare route with a window of fifty milliseconds — the services
     * are the test server's, so the slot and the scratch root are the real
     * ones. A client that went away mid-upload must not hold the one
     * large-upload slot, or a half-written file, for as long as its socket
     * lingers.
     */
    const app = Fastify();
    await app.register(multipartPlugin);
    app.post('/landing', async (request, reply) => {
      const received = await receiveImportUpload(request, reply, server.services, 50);
      if (received === null) return reply;
      if (received.kind === 'landed') await received.release();
      return reply.code(200).send({ kind: received.kind });
    });
    await app.ready();

    try {
      diskHas(64 * 1024 * 1024 * 1024);
      const { head, body } = multipart('aventura.db', await aventurasDatabaseBytes());
      const stalled = new PassThrough();
      stalled.write(head);
      stalled.write(body.subarray(0, 4096));
      // …and nothing more, and no end.

      const response = await app.inject({
        method: 'POST',
        url: '/landing',
        payload: stalled,
        headers: { 'content-type': MULTIPART },
      });

      expect(response.statusCode).toBe(408);
      expect(response.json()).toMatchObject({ error: 'upload-stalled' });
      expect(response.headers.connection).toBe('close');
      expect(server.services.largeUploadInFlight).toBe(false);
      expect(await scratch()).toEqual([]);
      stalled.destroy();
    } finally {
      await app.close();
    }
  });
});
