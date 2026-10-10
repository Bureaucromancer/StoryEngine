// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLorebook, newWorld, uuidv7, WORLD_SCHEMA } from '@storyengine/shared';

import { INDEX_SCHEMA_VERSION } from '../index-db/migrations.js';
import { snapshotReplaced } from '../storage/history.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Package becomes World, on an install that had Packages*** —
 * [P16.0](../../../../docs/design/workplan/35-p16-world.md), §1.1.
 *
 * The stage ends when *a data directory holding a Package made before the stage
 * opened shows it in the Worlds panel with its members; editing it moves the
 * folder to `library/worlds/` with its history, and under a fresh slug when a
 * World made after the upgrade already holds its name*. **Each case here plants
 * the folder a pre-P16.0 build wrote** — `library/packages/<slug>/package.json`,
 * saying `storyengine.package/1`, with a history beside it — and then starts a
 * P16 server on that directory, because the claim is about what an upgrade
 * finds rather than about what this build writes.
 *
 * The slug-collision case is the one the plan names by name: it **fails if the
 * move reuses the taken slug**, which is the bug a move written from
 * `objectRoot(owner, kind, slug)` would have — writing straight over the World
 * that took the name.
 */

const PASSWORD = 'correct horse battery';

let dataDir: string;
let server: TestServer | null = null;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-world-migration-'));
  // The account first, on a server that is then stopped: the Package is
  // planted between the two starts, as an upgrade finds it.
  const first = await makeTestServer({ dataDir });
  await setUpAdmin(first, 'ned', PASSWORD);
  await first.dispose();
});

afterEach(async () => {
  await server?.dispose();
  server = null;
  await rm(dataDir, { recursive: true, force: true });
});

const library = (): string => join(dataDir, 'users', 'ned', 'library');

/** Starts the P16 build on the directory and logs in. */
async function upgrade(): Promise<TestServer> {
  server = await makeTestServer({ dataDir });
  const login = await server.request({
    method: 'POST',
    url: '/api/auth/login',
    payload: { handle: 'ned', password: PASSWORD },
  });
  expect(login.status).toBe(200);
  return server;
}

/**
 * A Package as a build before P16.0 left it: `package.json` under the kind's
 * old id, one version in its history, and members named by reference.
 */
async function plantPackage(
  slug: string,
  members: { schema: string; id: string; name: string }[],
): Promise<{ id: string; folder: string }> {
  const world = newWorld('Rain City');
  const body = { ...world, schema: 'storyengine.package/1', contents: members };
  const folder = join(library(), 'packages', slug);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'package.json'), `${JSON.stringify(body, null, 2)}\n`);
  await snapshotReplaced({
    objectRoot: folder,
    payload: { ...body, description: 'as it was before its last save' },
    source: { kind: 'manual' },
    reason: '',
    keepPerObject: 50,
  });
  return { id: world.id, folder };
}

async function readWorld(app: TestServer, id: string) {
  const response = await app.request({ method: 'GET', url: `/api/library/worlds/${id}` });
  expect(response.status).toBe(200);
  return response.body as {
    contentHash: string;
    slug: string;
    object: { schema: string; id: string; name: string; description: string; contents: unknown[] };
  };
}

async function save(app: TestServer, id: string, change: (object: any) => void) {
  const { object, contentHash } = await readWorld(app, id);
  change(object);
  const response = await app.request({
    method: 'PUT',
    url: `/api/library/worlds/${id}`,
    payload: { object, contentHash },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as { contentHash: string };
}

async function present(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('a Package made before P16.0, on the first start after it', () => {
  it('is listed among the Worlds with its members, read under the new id', async () => {
    const book = { schema: 'storyengine.lorebook/1', id: uuidv7(), name: 'The Docks' };
    const planted = await plantPackage('rain-city', [book]);
    const app = await upgrade();

    const listed = await ownObjects(app, 'worlds');
    expect(listed.status).toBe(200);
    expect(listed.objects.map((row) => row.id)).toEqual([planted.id]);

    const read = await readWorld(app, planted.id);
    expect(read.object.schema).toBe(WORLD_SCHEMA);
    expect(read.object.contents).toEqual([book]);

    // Read where it lies: nothing is moved by a start, or by a read.
    expect(await present(join(planted.folder, 'package.json'))).toBe(true);
    expect(await present(join(library(), 'worlds'))).toBe(false);
  });

  it('shows its history, which is in the folder it is in', async () => {
    const planted = await plantPackage('rain-city', []);
    const app = await upgrade();

    const history = await app.request({
      method: 'GET',
      url: `/api/library/worlds/${planted.id}/history`,
    });
    expect(history.status).toBe(200);
    const versions = history.body.versions as { id: string }[];
    expect(versions).toHaveLength(1);

    // A version taken before the rename is served as the kind it is now.
    const version = await app.request({
      method: 'GET',
      url: `/api/library/worlds/${planted.id}/history/${versions[0]!.id}`,
    });
    expect(version.status).toBe(200);
    expect(version.body.object.schema).toBe(WORLD_SCHEMA);
    expect(version.body.object.description).toBe('as it was before its last save');
  });

  it('moves to library/worlds/ on its first edit, history and all, keeping its id', async () => {
    const planted = await plantPackage('rain-city', []);
    const app = await upgrade();

    await save(app, planted.id, (object) => {
      object.description = 'edited after the upgrade';
    });

    const moved = join(library(), 'worlds', 'rain-city');
    const body = JSON.parse(await readFile(join(moved, 'world.json'), 'utf8')) as {
      schema: string;
      id: string;
      description: string;
    };
    expect(body).toMatchObject({
      schema: WORLD_SCHEMA,
      id: planted.id,
      description: 'edited after the upgrade',
    });
    expect(await present(join(moved, 'package.json'))).toBe(false);
    expect(await present(planted.folder)).toBe(false);

    // The planted version and the one this save took, both in the new folder.
    const history = await app.request({
      method: 'GET',
      url: `/api/library/worlds/${planted.id}/history`,
    });
    expect(history.body.versions).toHaveLength(2);

    // One row for the id: the old path left the index with the folder.
    const listed = await ownObjects(app, 'worlds');
    expect(listed.objects.map((row) => row.id)).toEqual([planted.id]);
    expect((await readWorld(app, planted.id)).slug).toBe('rain-city');
  });

  it('takes a fresh slug when a World made after the upgrade already has its name', async () => {
    const planted = await plantPackage('rain-city', []);
    const app = await upgrade();

    // A World made after the upgrade, named alike: `worlds/rain-city`, while the
    // Package still waits in `packages/rain-city`. Two objects, not a conflict.
    const newer = newWorld('Rain City');
    const created = await app.request({
      method: 'POST',
      url: '/api/library/worlds',
      payload: newer,
    });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe('rain-city');
    const newerFile = join(library(), 'worlds', 'rain-city', 'world.json');
    const newerBytes = await readFile(newerFile, 'utf8');

    await save(app, planted.id, (object) => {
      object.description = 'the Package, edited';
    });

    // The newer World is untouched, byte for byte — the move did not land on it.
    expect(await readFile(newerFile, 'utf8')).toBe(newerBytes);
    expect((await readWorld(app, planted.id)).slug).toBe('rain-city-2');
    const moved = JSON.parse(
      await readFile(join(library(), 'worlds', 'rain-city-2', 'world.json'), 'utf8'),
    ) as { id: string; description: string };
    expect(moved).toMatchObject({ id: planted.id, description: 'the Package, edited' });

    const listed = await ownObjects(app, 'worlds');
    expect(listed.objects.map((row) => row.id).sort()).toEqual([planted.id, newer.id].sort());
  });

  it('is deleted from where it is, into the trash folder it came from, sparing a World of the same name', async () => {
    const planted = await plantPackage('rain-city', []);
    const app = await upgrade();

    const newer = newWorld('Rain City');
    expect(
      (await app.request({ method: 'POST', url: '/api/library/worlds', payload: newer })).status,
    ).toBe(201);

    const { contentHash } = await readWorld(app, planted.id);
    const removed = await app.request({
      method: 'DELETE',
      url: `/api/library/worlds/${planted.id}`,
      headers: { 'if-match': contentHash },
    });
    expect(removed.status).toBe(204);

    expect(await present(planted.folder)).toBe(false);
    expect(await present(join(library(), 'worlds', 'rain-city', 'world.json'))).toBe(true);
    const trashed = await readdir(join(dataDir, 'users', 'ned', 'trash', 'packages'));
    expect(trashed).toHaveLength(1);
    expect(trashed[0]?.startsWith('rain-city-')).toBe(true);

    // And it comes back as a World, where Worlds are.
    const restored = await app.request({
      method: 'POST',
      url: '/api/me/trash/restore',
      payload: { id: `packages/${String(trashed[0])}` },
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const back = await readWorld(app, planted.id);
    expect(back.slug).toBe('rain-city-2');
    expect(back.object.schema).toBe(WORLD_SCHEMA);
  });

  it('counts as a backlink on its members, as a Package did', async () => {
    const app = await upgrade();
    const book = newLorebook('The Docks');
    expect(
      (await app.request({ method: 'POST', url: '/api/library/lorebooks', payload: book })).status,
    ).toBe(201);
    await app.dispose();
    server = null;

    const planted = await plantPackage('rain-city', [
      { schema: book.schema, id: book.id, name: book.name },
    ]);
    const again = await upgrade();
    const usedBy = await again.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}/links`,
    });
    expect(usedBy.status, JSON.stringify(usedBy.body)).toBe(200);
    expect(JSON.stringify(usedBy.body)).toContain(planted.id);
  });

  /**
   * ***An index an older build wrote*** — the case an upgrade actually meets,
   * and the one the planted folders above do not: the Package is already a row,
   * under the old kind, and nothing re-reads a file whose size and time have not
   * changed. **Fails if `INDEX_SCHEMA_VERSION` is not bumped**: the start-up
   * check would find the row current and leave it a kind no route names.
   */
  it('is a World even where an older build had already indexed it as a Package', async () => {
    expect(INDEX_SCHEMA_VERSION).toBeGreaterThan(12);
    const planted = await plantPackage('rain-city', []);
    // Started once, so the row exists; then rewritten to what an alpha 6
    // index held for the same file — the old kind, the old id in the body, and
    // the old version — exactly as if the build before this one had written it.
    const before = await upgrade();
    await before.dispose();
    server = null;
    const db = new DatabaseSync(new Layout(dataDir).indexFile);
    try {
      db.prepare(
        `update object set schema_id = 'storyengine.package/1',
                           body = json_set(body, '$.schema', 'storyengine.package/1')
          where id = ?`,
      ).run(planted.id);
      // The version alpha 6 shipped, written as the number it was rather than
      // as one less than today's: one less than a constant nobody bumped would
      // still differ from it, and the test would pass without the bump it pins.
      db.exec('pragma user_version = 12');
    } finally {
      db.close();
    }

    const app = await upgrade();
    const listed = await ownObjects(app, 'worlds');
    expect(listed.objects.map((row) => row.id)).toEqual([planted.id]);
    expect((await readWorld(app, planted.id)).object.schema).toBe(WORLD_SCHEMA);
  });

  /**
   * ***A Package somebody downloaded before the rename, posted back*** — the
   * route's own *is this a schema I know* check stood in front of `create`'s
   * upgrade and answered *unrecognised*, while `PUT` took the same body. Both
   * doors read it as the World it is now.
   */
  it('takes a body in the old name through POST as well as PUT, and stores the new one', async () => {
    const app = await upgrade();
    const world = newWorld('Downloaded before the rename');
    const posted = await app.request({
      method: 'POST',
      url: '/api/library/worlds',
      payload: { ...world, schema: 'storyengine.package/1' },
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    const stored = JSON.parse(
      await readFile(
        join(library(), 'worlds', 'downloaded-before-the-rename', 'world.json'),
        'utf8',
      ),
    ) as { schema: string; id: string };
    expect(stored).toMatchObject({ schema: WORLD_SCHEMA, id: world.id });
  });

  /**
   * ***Two copies of one Package, and the edit stays where it is read*** —
   * every `packages/` path sorts before every `worlds/` one, so moving the
   * copy being edited while its twin stays behind would hand the win to the
   * twin and make the edit vanish from every read. With a duplicate on disk the
   * first write writes in place, and the duplicate is the person's to resolve.
   */
  it('does not move a Package whose id another copy also holds, so the edit is what reads', async () => {
    const planted = await plantPackage('rain-city', []);
    const twin = join(library(), 'packages', 'rain-city-copy');
    await mkdir(twin, { recursive: true });
    await writeFile(
      join(twin, 'package.json'),
      await readFile(join(planted.folder, 'package.json')),
    );
    const app = await upgrade();

    await save(app, planted.id, (object) => {
      object.description = 'edited beside a copy';
    });

    expect((await readWorld(app, planted.id)).object.description).toBe('edited beside a copy');
    expect(await present(join(library(), 'worlds'))).toBe(false);
  });

  /**
   * ***A move that fails does not unsave the edit.*** The bytes are on disk and
   * the old state in the history before the move is tried, so a refused move
   * leaves a World that reads under its old name, with the edit — not a 500
   * and an index describing bytes that are gone.
   */
  it('keeps the edit and the World where it was when the move cannot happen', async () => {
    const planted = await plantPackage('rain-city', []);
    // `library/worlds` as a file: nothing can be moved under it.
    await writeFile(join(library(), 'worlds'), 'not a folder');
    const app = await upgrade();

    await save(app, planted.id, (object) => {
      object.description = 'edited with nowhere to move';
    });

    const read = await readWorld(app, planted.id);
    expect(read.object.description).toBe('edited with nowhere to move');
    expect(read.object.schema).toBe(WORLD_SCHEMA);
    const onDisk = JSON.parse(await readFile(join(planted.folder, 'package.json'), 'utf8')) as {
      schema: string;
      description: string;
    };
    expect(onDisk).toMatchObject({
      schema: WORLD_SCHEMA,
      description: 'edited with nowhere to move',
    });

    // And the next save is not a 412 loop: the index holds the bytes it wrote.
    await save(app, planted.id, (object) => {
      object.description = 'and again';
    });
    expect((await readWorld(app, planted.id)).object.description).toBe('and again');
  });
});
