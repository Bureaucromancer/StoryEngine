// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, type Lorebook } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { mediaRowsIn } from './assets.js';

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
    await store(JPEG, 'orphan.jpg');
    expect(await assetFiles()).toHaveLength(2);

    const { object, contentHash } = await readBook();
    await save({ ...object, media: [{ id: 'm1', role: 'map', tags: [], ...kept }] }, contentHash);

    // The one the save named survives; the one nobody chose does not.
    const left = await assetFiles();
    expect(left).toHaveLength(1);
    expect(`assets/${String(left[0])}`).toBe(kept.ref);
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

describe('finding the rows', () => {
  it('walks both levels and ignores anything that is not a row', () => {
    const rows = mediaRowsIn({
      media: [{ id: 'a', ref: 'assets/a.png' }, 'nonsense', null],
      entries: [{ media: [{ id: 'b', ref: 'assets/b.png' }] }, { media: 'not an array' }],
    });
    expect(rows.map((one) => one.id)).toEqual(['a', 'b']);
  });

  it('stops rather than looping on a cycle', () => {
    const looped: Record<string, unknown> = { media: [{ id: 'a', ref: 'assets/a.png' }] };
    looped['self'] = looped;
    expect(mediaRowsIn(looped).map((one) => one.id)).toEqual(['a']);
  });
});
