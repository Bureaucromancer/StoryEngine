// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ACTOR_SCHEMA,
  newActor,
  newLorebook,
  newLoreEntry,
  uuidv7,
  type Lorebook,
} from '@storyengine/shared';

import { create, readCardPixels } from '../library.js';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { SWEEP_GRACE_MS } from './assets.js';

/**
 * ***[10 §11.2b](../../../../docs/design/10-ui-surfaces.md)'s image slots, and
 * the container that had to exist first.***
 *
 * ***`assetsRoot` was declared at P1 and nothing ever wrote to it.***
 * `EmbeddedMedia` is *"a reference to bytes carried by the container, never the
 * bytes themselves"*, and this build has had one container that carries them: a
 * PNG's blob chunk. A lorebook is `lorebook.json` in a folder, so `codecFor`
 * returned null for one and `readMedia` ended at *"that object is not in a
 * container that carries media"* — which made §11.2b's gallery **unreachable**
 * rather than merely unbuilt.
 *
 * ***Three claims, and the middle one is the one nothing else would catch.***
 * That bytes go in and come back out; that a row on an **entry** is served as
 * readily as one on the book, because §11.2b puts pictures in two places and a
 * lookup reading `body.media` alone would serve half of them; and that a save
 * collects the bytes no row names, which is what makes *upload, then change
 * your mind* not leak.
 */

const PASSWORD = 'correct horse battery';

/** A one-pixel PNG. Small enough to inline, real enough for the sniffer. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/**
 * A second image, so the orphan sweep has two files to choose between.
 *
 * **A JPEG rather than the GIF this started as**: `sniff` accepts PNG, JPEG and
 * WebP, so the GIF was refused at the door and the test measured one file where
 * it meant two — which read as a broken sweep and was a broken fixture.
 */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

let server: TestServer;
let bookId: string;

/** The four computed fields the route hands back, which a manifest row needs. */
interface Stored {
  ref: string;
  digest: string;
  bytes: number;
  mime: string;
}

async function store(bytes: Buffer, filename: string): Promise<Stored> {
  const sent = await server.request({
    method: 'POST',
    url: `/api/library/lorebooks/${bookId}/assets`,
    ...upload(bytes, filename),
  });
  expect(sent.status).toBe(201);
  return (sent.body as { asset: Stored }).asset;
}

function upload(bytes: Buffer, filename: string) {
  const boundary = '----se';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([Buffer.from(head), bytes, Buffer.from(tail)]),
  };
}

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned', PASSWORD);
  const created = await server.request({
    method: 'POST',
    url: '/api/library/lorebooks',
    payload: newLorebook('Rain City'),
  });
  expect(created.status).toBe(201);
  bookId = (created.body as { id: string }).id;
});

afterEach(async () => {
  await server.dispose();
});

async function readBook(): Promise<{ object: Lorebook; contentHash: string }> {
  const response = await server.request({ method: 'GET', url: `/api/library/lorebooks/${bookId}` });
  expect(response.status).toBe(200);
  return response.body as { object: Lorebook; contentHash: string };
}

async function save(object: Lorebook, contentHash: string): Promise<string> {
  const response = await server.request({
    method: 'PUT',
    url: `/api/library/lorebooks/${bookId}`,
    payload: { object, contentHash },
  });
  expect(response.status).toBe(200);
  return (response.body as { contentHash: string }).contentHash;
}

function assetsDir(): Promise<string> {
  return Promise.resolve(
    server.services.layout.assetsRoot(
      { kind: 'user', handle: 'ned' },
      'storyengine.lorebook/1',
      'rain-city',
    ),
  );
}

async function assetFiles(): Promise<string[]> {
  try {
    return (await readdir(await assetsDir())).sort();
  } catch {
    return [];
  }
}

/**
 * Makes a file older than the sweep's grace, so the only thing that can keep
 * it is the rule a test is about. Without this every upload in a test is
 * minutes old, and kept for that reason alone.
 */
async function age(path: string): Promise<void> {
  const past = new Date(Date.now() - 2 * SWEEP_GRACE_MS);
  await utimes(path, past, past);
}

async function ageAsset(ref: string): Promise<void> {
  await age(join(await assetsDir(), basename(ref)));
}

describe('bytes beside a folder-backed object', () => {
  it('stores an upload and serves it back through the media route', async () => {
    const asset = await store(PNG, 'quay.png');
    expect(asset.mime).toBe('image/png');
    expect(asset.ref.startsWith('assets/')).toBe(true);

    // The manifest row travels in the ordinary save — the route stored bytes
    // and did not touch the object, which is the decision the route argues for.
    const { object, contentHash } = await readBook();
    expect(object.media).toEqual([]);
    await save({ ...object, media: [{ id: 'm1', role: 'map', tags: [], ...asset }] }, contentHash);

    const served = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${bookId}/media/m1`,
    });
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(Number(served.headers['content-length'])).toBe(PNG.length);
    // Keyed on the media's own digest, not the object's hash — a book edit must
    // not re-fetch every picture.
    expect(served.headers['etag']).toBe(asset.digest);

    // **The bytes, read off disk rather than out of the response.** The test
    // harness decodes a body as text, which mangles a PNG — so the assertion
    // that the *right* bytes landed is made where they landed, and the response
    // above carries the length and the type.
    const onDisk = await readFile(join(await assetsDir(), String((await assetFiles())[0])));
    expect(onDisk.equals(PNG)).toBe(true);
  });

  it('serves a picture on an entry, not only one on the book', async () => {
    const asset = await store(PNG, 'quay.png');

    const { object, contentHash } = await readBook();
    await save(
      {
        ...object,
        entries: [
          {
            ...newLoreEntry('The wet quay'),
            media: [{ id: 'e1', role: 'reference', tags: [], ...asset }],
          },
        ],
      },
      contentHash,
    );

    const served = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${bookId}/media/e1`,
    });
    // §11.2b gives every entry a strip; a lookup reading the book's own `media`
    // array would answer 404 here and look like a broken picture on screen.
    expect(served.status).toBe(200);
    expect(Number(served.headers['content-length'])).toBe(PNG.length);
  });

  it('refuses a file that is not an image, by what the bytes are', async () => {
    const refused = await server.request({
      method: 'POST',
      url: `/api/library/lorebooks/${bookId}/assets`,
      // Named `.png` and is not one — the name is what the user called it, the
      // magic is what it is.
      ...upload(Buffer.from('this is not a picture'), 'quay.png'),
    });
    expect(refused.status).toBe(415);
    expect((refused.body as { error: string }).error).toBe('not-an-image');
    expect(await assetFiles()).toEqual([]);
  });

  it('stores one file for the same bytes uploaded twice', async () => {
    await store(PNG, 'quay.png');
    await store(PNG, 'quay.png');
    // Content-addressed, so a re-upload is the same file — which is also what
    // makes an orphan detectable at all.
    expect(await assetFiles()).toHaveLength(1);
  });

  it('collects the bytes no manifest row names, on the next save', async () => {
    const kept = await store(PNG, 'quay.png');
    const orphan = await store(JPEG, 'orphan.jpg');
    expect(await assetFiles()).toHaveLength(2);
    // Past the grace an upload gets to be named in (below), which is what an
    // upload somebody abandoned yesterday is.
    await ageAsset(orphan.ref);

    const { object, contentHash } = await readBook();
    await save({ ...object, media: [{ id: 'm1', role: 'map', tags: [], ...kept }] }, contentHash);

    // The one the save named survives; the one nobody chose does not.
    const left = await assetFiles();
    expect(left).toHaveLength(1);
    expect(`assets/${String(left[0])}`).toBe(kept.ref);
  });

  it('keeps an upload that no save has named yet', async () => {
    /**
     * ***Stored first and named by the save after*** (2026-09-27), so a sweep
     * cannot tell an upload nobody saved from one whose save has not arrived.
     * It deleted both: a picture uploaded while another save of the book was
     * in flight, or in a second tab, was gone before its own save named it.
     */
    const { object, contentHash } = await readBook();
    const late = await store(JPEG, 'late.jpg');

    await save({ ...object, name: 'Rain City, wet' }, contentHash);

    expect(await assetFiles()).toEqual([basename(late.ref)]);
  });

  it('keeps the bytes a version still names, so restoring it brings the picture back', async () => {
    /**
     * ***History keeps JSON and never pixels*** ([03 §11.2]), and the sweep read
     * the current body alone. So removing a map and saving deleted the map,
     * and restoring the version before brought back a row naming bytes that
     * were gone for good (2026-09-27).
     */
    const asset = await store(PNG, 'quay.png');
    const first = await readBook();
    const withMap = await save(
      { ...first.object, media: [{ id: 'm1', role: 'map', tags: [], ...asset }] },
      first.contentHash,
    );
    await ageAsset(asset.ref);

    const { object } = await readBook();
    const withoutMap = await save({ ...object, media: [] }, withMap);
    expect(await assetFiles()).toEqual([basename(asset.ref)]);

    const listed = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${bookId}/history`,
    });
    const versions = (listed.body as { versions: { id: string }[] }).versions;
    let had: string | undefined;
    for (const version of versions) {
      const one = await server.request({
        method: 'GET',
        url: `/api/library/lorebooks/${bookId}/history/${version.id}`,
      });
      if ((one.body as { object: Lorebook }).object.media.some((row) => row.id === 'm1')) {
        had = version.id;
      }
    }
    expect(had, 'a version holds the map').toBeDefined();

    const restored = await server.request({
      method: 'POST',
      url: `/api/library/lorebooks/${bookId}/history/${had ?? ''}/restore`,
      payload: { contentHash: withoutMap },
    });
    expect(restored.status).toBe(200);
    const served = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${bookId}/media/m1`,
    });
    expect(served.status).toBe(200);
    expect(Number(served.headers['content-length'])).toBe(PNG.length);
  });

  it('collects bytes whose only version has lost its payload', async () => {
    // A version whose payload file is gone cannot be restored (`restoreVersion`
    // answers not-found), so it has nothing to keep bytes for.
    const asset = await store(PNG, 'quay.png');
    const first = await readBook();
    const withMap = await save(
      { ...first.object, media: [{ id: 'm1', role: 'map', tags: [], ...asset }] },
      first.contentHash,
    );
    await ageAsset(asset.ref);
    const { object } = await readBook();
    const withoutMap = await save({ ...object, media: [] }, withMap);
    expect(await assetFiles()).toHaveLength(1);

    const payloads = join(
      server.services.layout.objectRoot(
        { kind: 'user', handle: 'ned' },
        'storyengine.lorebook/1',
        'rain-city',
      ),
      'history',
      'v',
    );
    for (const name of await readdir(payloads)) await rm(join(payloads, name));

    const again = await readBook();
    await save({ ...again.object, name: 'Rain City, dry' }, withoutMap);
    expect(await assetFiles()).toEqual([]);
  });

  it('answers a ref that names the folder itself as a missing picture', async () => {
    await store(PNG, 'quay.png');
    const { object, contentHash } = await readBook();
    const row = { id: 'm1', role: 'map' as const, tags: [], ref: 'assets/.' };
    await save(
      {
        ...object,
        media: [{ ...row, digest: `sha256:${'0'.repeat(64)}`, bytes: 1, mime: 'image/png' }],
      },
      contentHash,
    );

    const served = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${bookId}/media/m1`,
    });
    expect(served.status).toBe(404);
  });

  it('leaves alone a file this build did not write', async () => {
    // A link `assets -> .` passes every containment check and makes the
    // sweep's listing the object folder, where `lorebook.json` is a name no
    // row carries. Only names the store writes are ever collected.
    const orphan = await store(PNG, 'quay.png');
    const notes = join(await assetsDir(), 'notes.txt');
    await writeFile(notes, 'the tide tables, by hand');
    await ageAsset(orphan.ref);
    await age(notes);

    const { object, contentHash } = await readBook();
    await save({ ...object, name: 'Rain City, wet' }, contentHash);

    expect(await assetFiles()).toEqual(['notes.txt']);
  });

  it('keeps a picture an entry names when the book itself has none', async () => {
    const asset = await store(PNG, 'quay.png');

    const { object, contentHash } = await readBook();
    await save(
      {
        ...object,
        entries: [
          {
            ...newLoreEntry('The wet quay'),
            media: [{ id: 'e1', role: 'reference', tags: [], ...asset }],
          },
        ],
      },
      contentHash,
    );

    // The falsifying mutation is a sweep that reads `body.media`: it would
    // delete every picture on every entry the first time anybody saved.
    expect(await assetFiles()).toHaveLength(1);
  });

  /**
   * **Refused against whatever this build ships as system-owned**, rather than
   * against a lorebook in particular.
   *
   * *An earlier draft looked for a system lorebook and returned early when there
   * was none, which is a test that passes by not running* — and there is none:
   * the only thing `system-library.ts` puts on the shelf is the assistant's
   * card. So it asks the kind that does have one, which is the same code path:
   * `storeAsset` refuses on `row.owner`, not on the kind.
   */
  it('refuses to store beside a system object', async () => {
    const shipped = await server.request({ method: 'GET', url: '/api/library/actors' });
    const system = (shipped.body as { objects: { id: string; source: string }[] }).objects.find(
      (one) => one.source === 'system',
    );
    expect(system, 'this build ships at least one system object').toBeDefined();

    const refused = await server.request({
      method: 'POST',
      url: `/api/library/actors/${system?.id ?? ''}/assets`,
      ...upload(PNG, 'quay.png'),
    });
    // `403 read-only`, which is what the library's own error map answers for
    // that class — the same status `update` gives, for the same reason: the app
    // ships these, and a release would overwrite whatever was put beside them.
    expect(refused.status).toBe(403);
    expect((refused.body as { error: string }).error).toBe('read-only');
  });
});

/**
 * ***An `assets` folder, or an object folder, that leads somewhere else***
 * (2026-09-27). Every path here is spelled inside the object, and nothing
 * checked where it landed: [03 §5.3]'s guard, `resolveAssetPath`, had no
 * callers. A read served what the link led to, a store wrote there, and a
 * sweep deleted there, which with `assets` pointing at the data root would
 * have been `accounts.json`'s neighbours.
 */
/**
 * ***A copy brings its pictures*** (2026-09-27).
 *
 * *Save my version as a copy* and *Copy to my library* write an object's JSON
 * under a new id, and a picture is bytes beside the object that JSON only
 * names — so every picture on a copy was broken from the moment it was made.
 * `copyOf` names the source, and the create puts the source's file for each
 * row the copy names beside the copy.
 */
describe('a copy made with copyOf', () => {
  it('brings the pictures it names, on the book and on its entries', async () => {
    const asset = await store(PNG, 'quay.png');
    const { object, contentHash } = await readBook();
    const quay = {
      ...newLoreEntry('Quay'),
      media: [{ id: 'e1', role: 'gallery' as const, tags: [], ...asset }],
    };
    await save(
      { ...object, media: [{ id: 'm1', role: 'map', tags: [], ...asset }], entries: [quay] },
      contentHash,
    );
    const source = (await readBook()).object;
    const copyId = uuidv7();

    const made = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: { object: { ...source, id: copyId, name: 'Rain City, a copy' }, copyOf: bookId },
    });
    expect(made.status).toBe(201);

    for (const mediaId of ['m1', 'e1']) {
      const served = await server.request({
        method: 'GET',
        url: `/api/library/lorebooks/${copyId}/media/${mediaId}`,
      });
      expect(served.status, mediaId).toBe(200);
    }
  });

  /**
   * An actor's pictures are its card: the portrait is the image and its
   * expressions ride inside it, so a copy written without it was a blank
   * square with none of them. A 2×2 source against the 1×1 a bare create
   * makes is what tells the two apart.
   */
  it('writes an actor copy into the source’s card', async () => {
    const card = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=',
      'base64',
    );
    const vera = newActor('Vera');
    await create(server.services.library, 'ned', vera, ACTOR_SCHEMA, { cardPixels: card });
    const copyId = uuidv7();

    const made = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: { object: { ...vera, id: copyId, name: 'Vera, a copy' }, copyOf: vera.id },
    });
    expect(made.status).toBe(201);

    const { bytes } = await readCardPixels(server.services.library, 'ned', copyId);
    // IHDR width, the four bytes after the signature, length and chunk type.
    expect(Buffer.from(bytes).readUInt32BE(16)).toBe(2);
  });

  it('refuses a copy of something this account cannot read, and writes nothing', async () => {
    const { object } = await readBook();
    const copyId = uuidv7();

    const made = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: { object: { ...object, id: copyId, name: 'Stray' }, copyOf: uuidv7() },
    });
    expect(made.status).toBe(404);

    const after = await server.request({ method: 'GET', url: `/api/library/lorebooks/${copyId}` });
    expect(after.status).toBe(404);
  });
});

describe('an assets folder that is a link', () => {
  let outside: string;

  beforeEach(async () => {
    outside = await mkdtemp(join(tmpdir(), 'se-assets-outside-'));
  });

  afterEach(async () => {
    await rm(outside, { recursive: true, force: true });
  });

  const nameOf = (bytes: Buffer, extension: string): string =>
    `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;

  it('is not read, written or swept through', async () => {
    const pictured = nameOf(PNG, 'png');
    const stranger = `${'b'.repeat(64)}.png`;
    await writeFile(join(outside, pictured), PNG);
    await writeFile(join(outside, stranger), 'somebody else’s');
    await age(join(outside, stranger));

    const dir = await assetsDir();
    await rm(dir, { recursive: true, force: true });
    await symlink(outside, dir, 'junction');

    // A save naming a file that is only there through the link. Its sweep
    // runs through the link too.
    const { object, contentHash } = await readBook();
    const row = {
      id: 'm1',
      role: 'map' as const,
      tags: [],
      ref: `assets/${pictured}`,
      digest: `sha256:${pictured.slice(0, 64)}`,
      bytes: PNG.length,
      mime: 'image/png',
    };
    await save({ ...object, media: [row] }, contentHash);
    expect((await readdir(outside)).sort()).toEqual([pictured, stranger].sort());

    const served = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${bookId}/media/m1`,
    });
    expect(served.status).toBe(422);

    const stored = await server.request({
      method: 'POST',
      url: `/api/library/lorebooks/${bookId}/assets`,
      ...upload(JPEG, 'quay.jpg'),
    });
    expect(stored.status).toBe(422);
    expect((await readdir(outside)).sort()).toEqual([pictured, stranger].sort());
  });

  it('is not written through when the whole object folder leads outside', async () => {
    // Rooting the check at the object folder cannot see this one, since the
    // folder and its assets move together. The data root's check can.
    const folder = server.services.layout.objectRoot(
      { kind: 'user', handle: 'ned' },
      'storyengine.lorebook/1',
      'rain-city',
    );
    const moved = join(outside, 'rain-city');
    await cp(folder, moved, { recursive: true });
    await rm(folder, { recursive: true, force: true });
    await symlink(moved, folder, 'junction');

    const stored = await server.request({
      method: 'POST',
      url: `/api/library/lorebooks/${bookId}/assets`,
      ...upload(PNG, 'quay.png'),
    });
    expect(stored.status).toBe(422);
    expect(await readdir(moved)).not.toContain('assets');
  });
});
