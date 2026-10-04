// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  VAULT_CHARACTERS,
  VAULT_LOREBOOKS,
  VAULT_SCENARIO_NPCS,
  VAULT_SCENARIOS,
  VAULT_TAGS,
  writeAventurasBackupFolder,
} from '../import/fixtures/test-aventuras-db.js';
import { makeZip } from '../storage/test-zip.js';
import {
  makeTestServer,
  ownObjects,
  setUpAdmin,
  tempRoot,
  type ListedObject,
  type TestServer,
} from '../test-server.js';

/**
 * ***One database, four doors, one library*** —
 * [P13.7](../../../../docs/design/workplan/30-p13-aventuras-import.md)'s end
 * condition, and [§1.1](../../../../docs/design/workplan/30-p13-aventuras-import.md)'s
 * claim put to the test: *one source kind, four transports*, every one of
 * which arrives at a root with `aventura.db` in it.
 *
 * The same fixture database is handed over as a server-path sweep of its
 * folder, as a browser folder upload, as a bare SQLite file under a name that
 * is not `aventura.db`, and as a backup zip — each into a server of its own,
 * so nothing one door wrote can make another look right. Then each is asked
 * two things:
 *
 * - **the same library** — every object's whole body, not a count of them:
 *   names, links (`actor.lore`, `treatment.lore`, the cast) resolved to the
 *   Aventuras row they came from rather than to ids minted per server, the
 *   portraits' bytes, and the tag registry. Two things are taken out, and only
 *   two: the ids each server minted for itself, and the provenance timestamps
 *   of *when* this server wrote the object. Anything else that differs is a
 *   difference between transports, and §1.5 says there are none — *the key is
 *   the same whether the database arrived as a directory, a zip or a bare
 *   file*.
 * - **a second import of the same bytes is all `unchanged`** — every row the
 *   first converted says `unchanged` the second time, under the same object
 *   id, nothing is `converted`, no object gains a version, and the library
 *   reads exactly as it did. For an upload, the second import is the same
 *   bytes uploaded again, which is what a person does.
 *
 * ***Why the uploads' answers carry the whole report.*** Until this stage a
 * zip or a database sent to `/import/file` answered as one file does: one
 * row, the first converted, and every note flattened beside it — so the
 * second upload of a backup answered one `recorded` row named for the zip,
 * and *all `unchanged`* could not be seen through that door at all, by this
 * test or by the person walking critical row 2. The sweep's report now rides
 * beside the one row (`routes/import.ts`, `reportAsUpload`), and this reads
 * it on all four doors alike.
 */

/** Everything each door hands over: the fixture, written once and read back as bytes. */
let container: string;
let folder: string;
let database: Uint8Array;
let metadata: Uint8Array;

/** One row of a review, as far as this file reads one. */
interface Row {
  source: string;
  disposition: string;
  objectId?: string;
}

/** A door: how the database is handed over, answering with the review's rows. */
interface Door {
  name: string;
  /** Anything the account needs before this door opens for it. */
  prepare?: (server: TestServer) => Promise<void>;
  send: (server: TestServer) => Promise<{ status: number; rows: Row[] }>;
}

const BOUNDARY = '----storyengineAventurasTransports';

/** One file part, as the client's `importFile` sends it. */
function oneFile(server: TestServer, filename: string, bytes: Uint8Array) {
  return server.request({
    method: 'POST',
    url: '/api/import/file',
    payload: Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  });
}

/** The rows an upload's answer carries, which is the report since P13.7. */
function uploadRows(response: { status: number; body: any }): { status: number; rows: Row[] } {
  const rows = (response.body?.report?.items ?? []) as Row[];
  return { status: response.status, rows };
}

const DOORS: readonly Door[] = [
  {
    name: 'a server-path sweep of the folder',
    prepare: async (server) => {
      const granted = await server.request({
        method: 'PATCH',
        url: '/api/admin/accounts/ned',
        payload: { capabilities: { fileAccess: 'read' } },
      });
      expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    },
    send: async (server) => {
      const response = await server.request({
        method: 'POST',
        url: '/api/import/sweep',
        payload: { root: folder },
      });
      return { status: response.status, rows: (response.body?.report?.items ?? []) as Row[] };
    },
  },
  {
    name: 'a folder upload',
    send: async (server) => {
      // What a browser sends for a picked backup folder: the two files the plan
      // asks for, each named by its path, and the manifest naming the folder.
      const carried: Record<string, Uint8Array> = {
        'aventura.db': database,
        'metadata.json': metadata,
      };
      const parts: Buffer[] = [];
      for (const [path, bytes] of Object.entries(carried)) {
        parts.push(
          Buffer.from(
            `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${path}"; filename="${path}"\r\n` +
              'Content-Type: application/octet-stream\r\n\r\n',
          ),
          Buffer.from(bytes),
          Buffer.from('\r\n'),
        );
      }
      parts.push(
        Buffer.from(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n` +
            `${JSON.stringify(Object.keys(carried))}\r\n--${BOUNDARY}--\r\n`,
        ),
      );
      const response = await server.request({
        method: 'POST',
        url: '/api/import/directory',
        payload: Buffer.concat(parts),
        headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      });
      return { status: response.status, rows: (response.body?.report?.items ?? []) as Row[] };
    },
  },
  {
    // Not called `aventura.db`: the database is recognised by its first
    // sixteen bytes, and the name a person's download gave it is theirs.
    name: 'a bare database upload',
    send: async (server) => uploadRows(await oneFile(server, 'my library.sqlite', database)),
  },
  {
    name: 'a backup zip upload',
    send: async (server) =>
      uploadRows(
        await oneFile(
          server,
          'aventura-backup-2026-09-29.zip',
          makeZip([
            { name: 'aventura.db', body: database, deflate: true },
            { name: 'metadata.json', body: metadata },
          ]),
        ),
      ),
  },
];

/** What one door did, both times. */
interface Arrival {
  first: { status: number; rows: Row[] };
  second: { status: number; rows: Row[] };
  library: unknown;
  after: unknown;
  versions: Record<string, number>;
  versionsAfter: Record<string, number>;
}

const arrivals = new Map<string, Arrival>();

beforeAll(async () => {
  container = await tempRoot('se-aventuras-transports-');
  folder = join(container, 'com.karelian.aventura');
  await writeAventurasBackupFolder(folder);
  database = await readFile(join(folder, 'aventura.db'));
  metadata = await readFile(join(folder, 'metadata.json'));

  for (const door of DOORS) {
    const server = await makeTestServer();
    try {
      await setUpAdmin(server);
      await door.prepare?.(server);
      const first = await door.send(server);
      const library = await libraryOf(server);
      const versions = await versionsOf(server);
      const second = await door.send(server);
      arrivals.set(door.name, {
        first,
        second,
        library,
        after: await libraryOf(server),
        versions,
        versionsAfter: await versionsOf(server),
      });
    } finally {
      await server.dispose();
    }
  }
}, 120_000);

afterAll(async () => {
  await rm(container, { recursive: true, force: true });
});

function arrived(door: Door): Arrival {
  const found = arrivals.get(door.name);
  if (found === undefined) throw new Error(`${door.name} never arrived`);
  return found;
}

/** Which Aventuras row an object came from: the key §1.5 makes identity of. */
function rowOf(listed: ListedObject): string {
  const object = listed['object'] as { provenance?: { originalFilename?: string } };
  return `${String(listed['schema'])} ${object.provenance?.originalFilename ?? String(listed['name'])}`;
}

/**
 * The library, with the two things each server mints for itself taken out.
 *
 * Every string anywhere in an object that is some object's library id is
 * replaced by the row that object came from, so a link reads as *the book made
 * from `lorebook_vault/7d2e…`* rather than as an id this server happened to
 * mint; and provenance's `createdAt` and `updatedAt`, which say when this
 * server wrote it, are dropped. Nothing else is touched.
 */
async function libraryOf(server: TestServer): Promise<unknown> {
  const listed = (await ownObjects(server)).objects;
  const named = new Map(listed.map((one) => [one.id, rowOf(one)]));

  const plain = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') return named.get(value) ?? value;
    if (Array.isArray(value)) return value.map((one) => plain(one));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [name, inner] of Object.entries(value)) {
        if (key === 'provenance' && (name === 'createdAt' || name === 'updatedAt')) continue;
        out[name] = plain(inner, name);
      }
      return out;
    }
    return value;
  };

  const objects: Record<string, unknown> = {};
  for (const one of listed) {
    const row = rowOf(one);
    expect(objects[row], `two objects from ${row}`).toBeUndefined();
    objects[row] = {
      name: one['name'],
      slug: one['slug'],
      object: plain(one['object']),
      ...(String(one['schema']).startsWith('storyengine.actor/')
        ? { card: await cardDigest(server, one.id) }
        : {}),
    };
  }

  const tags = await server.request({ method: 'GET', url: '/api/tags' });
  expect(tags.status).toBe(200);
  const registry = (tags.body.tags as { name: string; swatch: string | null }[]).map(
    ({ name, swatch }) => ({ name, swatch }),
  );

  return { objects, registry };
}

/**
 * The card's own pixels, by digest: a portrait that arrived differently would
 * differ here.
 *
 * **The image chunks only.** A card PNG carries the object itself in a text
 * chunk beside the picture — ids, timestamps and all — so the file's bytes
 * differ between two servers that stored the same portrait; the object is
 * compared above, field by field, and this is the picture.
 */
async function cardDigest(server: TestServer, id: string): Promise<string> {
  const cookie = [...server.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const response = await server.app.inject({
    method: 'GET',
    url: `/api/library/actors/${id}/avatar`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  const png = response.rawPayload;
  const hash = createHash('sha256');
  // Past the eight-byte signature, chunk by chunk: length, type, data, CRC.
  for (let at = 8; at + 8 <= png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    if (type === 'IHDR' || type === 'PLTE' || type === 'IDAT') {
      hash.update(type).update(png.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  return hash.digest('hex');
}

/** How many versions each object has, by the row it came from: a rewrite adds one. */
async function versionsOf(server: TestServer): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const one of (await ownObjects(server)).objects) {
    const kind = String(one['schema']).replace(/^storyengine\.(\w+)\/\d+$/, '$1s');
    const history = await server.request({
      method: 'GET',
      url: `/api/library/${kind}/${one.id}/history`,
    });
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    counts[rowOf(one)] = (history.body.versions as unknown[]).length;
  }
  return counts;
}

/** The rows of a review that name a vault row: objects and tags, not tables or stories. */
function vaultRows(rows: readonly Row[]): Row[] {
  return rows.filter((row) =>
    /^aventura\.db\/(?:character_vault|lorebook_vault|scenario_vault|vault_tags)\//.test(
      row.source,
    ),
  );
}

describe('one Aventuras database, handed over four ways', () => {
  for (const door of DOORS) {
    it(`imports the whole vault through ${door.name}`, () => {
      const { first } = arrived(door);

      expect(first.status, JSON.stringify(first.rows).slice(0, 400)).toBeLessThan(300);
      const converted = vaultRows(first.rows).filter((row) => row.disposition === 'converted');
      // Every vault row converts, and a tag two kinds share converts once.
      expect(converted.length).toBeGreaterThan(0);
      expect(
        vaultRows(first.rows).filter((row) => !row.source.includes('/vault_tags/')),
      ).toHaveLength(VAULT_CHARACTERS.length + VAULT_LOREBOOKS.length + VAULT_SCENARIOS.length);
      expect(
        vaultRows(first.rows).filter((row) => row.source.includes('/vault_tags/')),
      ).toHaveLength(VAULT_TAGS.length);
      const { objects } = arrived(door).library as { objects: Record<string, unknown> };
      expect(Object.keys(objects)).toHaveLength(
        VAULT_CHARACTERS.length +
          VAULT_LOREBOOKS.length +
          VAULT_SCENARIOS.length +
          VAULT_SCENARIO_NPCS,
      );
    });
  }

  for (const door of DOORS.slice(1)) {
    it(`makes the same library through ${door.name} as through the sweep`, () => {
      expect(arrived(door).library).toEqual(arrived(DOORS[0]!).library);
    });
  }

  for (const door of DOORS) {
    it(`finds everything unchanged when the same bytes come through ${door.name} again`, () => {
      const { first, second, library, after, versions, versionsAfter } = arrived(door);

      expect(second.status, JSON.stringify(second.rows).slice(0, 400)).toBe(200);
      expect(second.rows.filter((row) => row.disposition === 'converted')).toEqual([]);
      const before = vaultRows(first.rows);
      const again = vaultRows(second.rows);
      expect(again.map((row) => row.source)).toEqual(before.map((row) => row.source));
      for (const row of again) expect(row.disposition, row.source).toBe('unchanged');
      expect(again.map((row) => row.objectId)).toEqual(before.map((row) => row.objectId));

      // And the library agrees with the review: nothing rewritten, nothing added.
      expect(versionsAfter).toEqual(versions);
      expect(after).toEqual(library);
    });
  }
});
