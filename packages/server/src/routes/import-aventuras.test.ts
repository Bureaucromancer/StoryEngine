// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { FastifyReply } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AVENTURAS_DB_VARIANTS,
  FIXTURE_API_KEY,
  STORIES,
  VAULT_CHARACTERS,
  VAULT_LOREBOOKS,
  writeAventurasBackupFolder,
} from '../import/fixtures/test-aventuras-db.js';
import { AventurasReader } from '../import/aventuras/reader.js';
import { AVENTURAS_DISPOSITIONS, AVENTURAS_TABLES } from '../import/registries/aventuras.js';
import { makeZip } from '../storage/test-zip.js';
import {
  makeTestServer,
  ownObjects,
  setUpAdmin,
  tempRoot,
  type TestServer,
} from '../test-server.js';
import { answeredNoRoom } from './import.js';

/**
 * ***An Aventuras install, through the routes*** —
 * [P13.2](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The reader's own tests prove the review; these prove the doors to it: the
 * server-path sweep answers with that review and records it, a folder plan
 * names the kind and asks for the three files the reader reads, a folder
 * upload of a backup sweeps the same way, a database the gate refuses is a
 * `422` in the ledger, and **no room for the copy is a `507`** rather than the
 * error handler's bare `500`, on each of the three routes that can sweep one.
 *
 * *A full disk through the services' seam.* Nobody fills a disk to test that a
 * copy will not, and `AppServices.freeBytes` is on the services for exactly
 * that — the backup routes' tests answer *full* through it — so the routes
 * hand it to the sweep, and a test here sets it. (This file first mocked
 * `storage/files.ts` to get there, which the P13.2 review caught: it meant an
 * import copy was the one room check the services' seam could not reach.)
 */

/** What the disk has free: a test sets it, and makes the services answer it. */
function diskHas(bytes: number): void {
  server.services.freeBytes = () => Promise.resolve(bytes);
}

let server: TestServer;
let container: string;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
  container = await tempRoot('se-aventuras-routes-');
});

afterEach(async () => {
  await server.dispose();
  await rm(container, { recursive: true, force: true });
});

async function grantFileAccess(): Promise<void> {
  const response = await server.request({
    method: 'PATCH',
    url: '/api/admin/accounts/ned',
    payload: { capabilities: { fileAccess: 'read' } },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

async function scratch(): Promise<string[]> {
  try {
    return await readdir(server.services.library.layout.importScratchRoot);
  } catch {
    return [];
  }
}

/** Everything the ledger holds for this server, as one string to search. */
function ledger(): string {
  const db = server.services.state.db;
  return JSON.stringify([
    db.prepare('select * from import_job').all(),
    db.prepare('select * from import_item').all(),
  ]);
}

/** One object per vault row the fixture holds: its characters (P13.3) and its lorebooks (P13.4). */
const VAULT_OBJECTS = VAULT_CHARACTERS.length + VAULT_LOREBOOKS.length;

describe('pointing the server at an Aventuras folder', () => {
  it('answers with the review, records it, and writes the vault’s books and characters and nothing else', async () => {
    await grantFileAccess();
    const root = join(container, 'aventura-backup');
    await writeAventurasBackupFolder(root);

    const response = await server.request({
      method: 'POST',
      url: '/api/import/sweep',
      payload: { root },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const report = response.body.report;
    expect(report.source).toBe('aventuras');
    const sources = (report.items as { source: string }[]).map((item) => item.source);
    // A converted table is listed by its rows (P13.3); every other by its own.
    for (const table of AVENTURAS_TABLES) {
      if (AVENTURAS_DISPOSITIONS[table] === 'converted') continue;
      expect(sources).toContain(`aventura.db/${table}`);
    }
    for (const character of VAULT_CHARACTERS) {
      expect(sources).toContain(`aventura.db/character_vault/${String(character['id'])}`);
    }
    for (const book of VAULT_LOREBOOKS) {
      expect(sources).toContain(`aventura.db/lorebook_vault/${String(book['id'])}`);
    }
    for (const story of STORIES) expect(sources).toContain(`aventura.db/stories/${story.id}`);
    expect(report.counts.converted).toBe(VAULT_OBJECTS);
    expect(report.counts.credential).toBe(1);

    // Addressable, as every sweep's review is, and holding the same rows.
    const recorded = await server.request({
      method: 'GET',
      url: `/api/import/jobs/${String(report.jobId)}`,
    });
    expect(recorded.status).toBe(200);
    expect(recorded.body.report.items).toHaveLength(report.items.length);

    // The key in `settings` reached neither the answer nor the ledger.
    expect(JSON.stringify(response.body)).not.toContain(FIXTURE_API_KEY);
    expect(ledger()).not.toContain(FIXTURE_API_KEY);

    expect((await ownObjects(server)).objects).toHaveLength(VAULT_OBJECTS);
    expect((await ownObjects(server, 'actors')).objects).toHaveLength(VAULT_CHARACTERS.length);
    expect((await ownObjects(server, 'lorebooks')).objects).toHaveLength(VAULT_LOREBOOKS.length);
    expect(await scratch()).toEqual([]);
  });

  it('answers with the review of what it wrote even when the reader cannot let go', async () => {
    /**
     * *P13.3's half of the close contract, at the door.* The characters are in
     * the library before the reader's `close()` runs, so a `close()` that
     * throws must not become a 500 that hides them; the route hands the sweep
     * its logger and gets the report back.
     */
    await grantFileAccess();
    const root = join(container, 'aventura-backup');
    await writeAventurasBackupFolder(root);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- held to be put back, and only ever called with `.call(this)`
    const release = AventurasReader.prototype.close;
    const close = vi.spyOn(AventurasReader.prototype, 'close').mockImplementation(async function (
      this: AventurasReader,
    ) {
      await release.call(this);
      throw new Error('the handle would not close');
    });

    let response;
    try {
      response = await server.request({
        method: 'POST',
        url: '/api/import/sweep',
        payload: { root },
      });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      close.mockRestore();
    }

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.report.counts.converted).toBe(VAULT_OBJECTS);
    expect((await ownObjects(server, 'actors')).objects).toHaveLength(VAULT_CHARACTERS.length);
  });

  it('asks what the folder is without reading the database', async () => {
    await grantFileAccess();
    const root = join(container, 'aventura-backup');
    await writeAventurasBackupFolder(root);

    const response = await server.request({
      method: 'POST',
      url: '/api/import/inspect',
      payload: { root },
    });

    expect(response.status).toBe(200);
    expect(response.body.verdict).toBe('aventuras');
    expect(await scratch()).toEqual([]);
  });

  it('refuses a database the gate refuses, before anything, and records why', async () => {
    await grantFileAccess();
    const root = join(container, 'broken');
    await writeAventurasBackupFolder(root, AVENTURAS_DB_VARIANTS.broken);

    const response = await server.request({
      method: 'POST',
      url: '/api/import/sweep',
      payload: { root },
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('unknown-format');
    const jobs = await server.request({ method: 'GET', url: '/api/import/jobs' });
    expect(jobs.body.jobs[0]).toMatchObject({ status: 'refused', source: 'unknown-format' });
    expect(await scratch()).toEqual([]);
  });

  it('answers 507 with the numbers when there is no room for the copy', async () => {
    await grantFileAccess();
    const root = join(container, 'aventura-backup');
    await writeAventurasBackupFolder(root);
    diskHas(1024);

    const response = await server.request({
      method: 'POST',
      url: '/api/import/sweep',
      payload: { root },
    });

    expect(response.status).toBe(507);
    expect(response.body.error).toBe('no-space');
    expect(response.body.message).toMatch(/MB is free/);
    // Not a refusal of the folder, which is fine and imports once there is room.
    const jobs = await server.request({ method: 'GET', url: '/api/import/jobs' });
    expect(jobs.body.jobs).toEqual([]);
    expect(await scratch()).toEqual([]);
  });
});

describe('uploading an Aventuras folder from the browser', () => {
  const MANIFEST = [
    { path: 'aventura.db', bytes: 400_000 },
    { path: 'metadata.json', bytes: 180 },
    { path: 'stories/the-drowned-bell.avt', bytes: 90_000 },
  ];

  /** A backup folder on disk, and the two files of it a browser would carry. */
  async function backupToCarry(): Promise<Record<string, Uint8Array>> {
    const root = join(container, 'aventura-backup');
    await mkdir(root, { recursive: true });
    await writeAventurasBackupFolder(root);
    return {
      'aventura.db': await readFile(join(root, 'aventura.db')),
      'metadata.json': await readFile(join(root, 'metadata.json')),
    };
  }

  /** `POST /import/directory`: the files carried, and the manifest naming the whole folder. */
  function uploadFolder(carried: Record<string, Uint8Array>, manifest: readonly string[]) {
    const boundary = '----storyengineAventurasBoundary';
    const parts: Buffer[] = [];
    for (const [path, bytes] of Object.entries(carried)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${path}"; filename="${path}"\r\n` +
            'Content-Type: application/octet-stream\r\n\r\n',
        ),
        Buffer.from(bytes),
        Buffer.from('\r\n'),
      );
    }
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n` +
          `${JSON.stringify(manifest)}\r\n--${boundary}--\r\n`,
      ),
    );
    return server.request({
      method: 'POST',
      url: '/api/import/directory',
      payload: Buffer.concat(parts),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
  }

  it('plans it as Aventuras, and asks for only what the reader reads', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory/plan',
      payload: { entries: MANIFEST },
    });

    expect(response.status).toBe(200);
    expect(response.body.verdict).toBe('aventuras');
    expect(response.body.wanted).toEqual(['aventura.db', 'metadata.json']);
    expect(response.body.declared).toEqual(['stories/the-drowned-bell.avt']);
  });

  it('asks for the log with the database, and not for the log’s index', async () => {
    // Found at the P13.2 review: nothing held the log to the plan, and a plan
    // that dropped it passed every test.
    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory/plan',
      payload: {
        entries: [
          { path: 'aventura.db', bytes: 400_000 },
          { path: 'aventura.db-wal', bytes: 40_000 },
          { path: 'aventura.db-shm', bytes: 32_768 },
          { path: 'metadata.json', bytes: 180 },
        ],
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.wanted).toEqual(['aventura.db', 'aventura.db-wal', 'metadata.json']);
    expect(response.body.declared).toEqual(['aventura.db-shm']);
  });

  it('sweeps the uploaded backup into the same review', async () => {
    const response = await uploadFolder(
      await backupToCarry(),
      MANIFEST.map((entry) => entry.path),
    );

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const items = response.body.report.items as { source: string; disposition: string }[];
    expect(response.body.report.source).toBe('aventuras');
    expect(items.find((item) => item.source === 'aventura.db/settings')?.disposition).toBe(
      'credential',
    );
    // Named in the manifest and never sent: listed, and skipped.
    expect(items.find((item) => item.source === 'stories/the-drowned-bell.avt')?.disposition).toBe(
      'skipped',
    );
    expect(JSON.stringify(response.body)).not.toContain(FIXTURE_API_KEY);
    expect(await scratch()).toEqual([]);
  });

  it('refuses a database whose log the folder names and the upload left behind', async () => {
    // The database alone is the one as of its last checkpoint: older, and
    // looking whole. The plan never asks for one without the other; a client
    // that sent half is refused rather than believed.
    const response = await uploadFolder(await backupToCarry(), [
      'aventura.db',
      'aventura.db-wal',
      'metadata.json',
    ]);

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('unreadable-root');
    expect(await scratch()).toEqual([]);
  });

  it('answers 507 when there is no room for the copy', async () => {
    const carried = await backupToCarry();
    diskHas(1024);

    const response = await uploadFolder(
      carried,
      MANIFEST.map((entry) => entry.path),
    );

    expect(response.status).toBe(507);
    expect(response.body.error).toBe('no-space');
    expect(response.body.message).toMatch(/MB is free/);
    expect(await scratch()).toEqual([]);
  });
});

describe('uploading an Aventuras backup as one zip', () => {
  it('answers 507 when there is no room for the copy', async () => {
    const root = join(container, 'aventura-backup');
    await writeAventurasBackupFolder(root);
    const zip = makeZip([
      { name: 'aventura.db', body: await readFile(join(root, 'aventura.db')), deflate: true },
      { name: 'metadata.json', body: await readFile(join(root, 'metadata.json')) },
    ]);
    diskHas(1024);

    const boundary = '----storyengineAventurasZip';
    const response = await server.request({
      method: 'POST',
      url: '/api/import/file',
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="aventura-backup.zip"\r\n` +
            'Content-Type: application/zip\r\n\r\n',
        ),
        Buffer.from(zip),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });

    expect(response.status, JSON.stringify(response.body)).toBe(507);
    expect(response.body.error).toBe('no-space');
    expect(response.body.message).toMatch(/MB is free/);
    expect(await scratch()).toEqual([]);
  });
});

/**
 * ***A disk that filled while the copy was written*** — the late arm of
 * `answeredNoRoom`, which no route test can make happen: the services' seam
 * answers the room check made before the copy, and this is what the copy's own
 * write, or SQLite's (`SQLITE_FULL`, thrown with this code by the snapshot),
 * runs into after it. Found untested at the P13.2 review.
 */
describe('a disk that filled part way', () => {
  interface Recorded {
    code(status: number): Recorded;
    send(body: unknown): Recorded;
  }

  function recorder(): { sent: { status?: number; body?: unknown }; reply: FastifyReply } {
    const sent: { status?: number; body?: unknown } = {};
    const reply: Recorded = {
      code(status) {
        sent.status = status;
        return reply;
      },
      send(body) {
        sent.body = body;
        return reply;
      },
    };
    return { sent, reply: reply as unknown as FastifyReply };
  }

  it('is answered 507, as no room found first is', () => {
    const { sent, reply } = recorder();
    const late = Object.assign(new Error('database or disk is full'), { code: 'ENOSPC' });

    expect(answeredNoRoom(late, reply)).toBe(true);
    expect(sent).toEqual({
      status: 507,
      body: {
        error: 'no-space',
        message: 'There is not enough free space on the disk to read this import.',
      },
    });
  });

  it('leaves every other error to be thrown', () => {
    const { sent, reply } = recorder();

    expect(answeredNoRoom(new Error('something else'), reply)).toBe(false);
    expect(answeredNoRoom(Object.assign(new Error('a disk failing'), { code: 'EIO' }), reply)).toBe(
      false,
    );
    expect(sent).toEqual({});
  });
});
