// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACTOR_SCHEMA,
  LOREBOOK_SCHEMA,
  newActor,
  newLorebook,
  newWorld,
  PACKAGE_EXPORT_SCHEMA,
  type PackageExport,
  PRESET_SCHEMA,
  TREATMENT_SCHEMA,
  WORLD_FILE_MANIFEST,
  WORLD_SCHEMA,
  type World,
} from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { blankCardPixels, create, list, read, readCardPixels, update } from '../../library.js';
import { storeAsset } from '../../library/assets.js';
import { DEFAULT_MODE_ID } from '../../mode-registry.js';
import { makePng, pixelBytes } from '../../storage/card/test-png.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { sweep } from '../sweep.js';
import { Folders, packageExportRoot, readPackageExport } from './legacy.js';

/**
 * ***A `.sepack.json` written before P16.3 imports as a World*** —
 * [P16.3e](../../../../../docs/design/workplan/35-p16-world.md),
 * [16 §5.1](../../../../../docs/design/16-publish.md): P16.3's second end
 * clause.
 *
 * **The fixture is P11.10's own output**, not a hand-made imitation of it:
 * `fixtures/package-export-1.sepack.json` was written at the start of this
 * stage by `GET /api/library/worlds/:id/export` on a test server — the route
 * and `packaging/export.ts` as alpha 5 and alpha 6 shipped them — over a World
 * named *Rain City*, version 1.2.0, holding an actor whose lore names a book,
 * the book (whose hook involves the actor), a treatment whose required lore
 * and cast name them, a preset, and a member deleted before the export, which
 * that writer reports as missing and leaves out of the file. Its bytes are the
 * response's, which is why `.prettierignore` keeps them as written.
 */

const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures', 'package-export-1.sepack.json'));
const exported = JSON.parse(FIXTURE.toString('utf8')) as PackageExport;
const idOf = (name: string) => exported.manifest.contents.find((entry) => entry.name === name)!.id;

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

/** The upload door a person uses, with the file as P11.10 handed it out. */
async function upload(filename: string, bytes: Buffer) {
  const boundary = '----storyengineLegacyBoundary';
  const payload = Buffer.concat([
    Buffer.from(
      [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${filename}"`,
        'Content-Type: application/json',
        '',
        '',
      ].join('\r\n'),
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return server.request({
    method: 'POST',
    url: '/api/import/file',
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
}

describe('the frozen package export', () => {
  it('is the file P11.10 writes, and says what this test reads from it', () => {
    expect(exported.schema).toBe(PACKAGE_EXPORT_SCHEMA);
    expect(exported.manifest).toMatchObject({ name: 'Rain City', version: '1.2.0' });
    expect(exported.manifest.contents.map((entry) => entry.name)).toEqual([
      'Vera',
      'Harbour',
      'The Drowned Bell',
      'Wet Prose',
    ]);
  });

  it('imports through the upload door as a World named and versioned as its manifest says', async () => {
    const response = await upload('rain-city.sepack.json', FIXTURE);

    expect(response.status).toBe(201);
    const library = server.services.library;
    const world = read(library, 'ned', exported.manifest.id, WORLD_SCHEMA);
    const body = world.body as World;
    expect(body).toMatchObject({ name: 'Rain City', version: '1.2.0' });
    expect(body.contents).toEqual([
      { schema: ACTOR_SCHEMA, id: idOf('Vera'), name: 'Vera' },
      { schema: LOREBOOK_SCHEMA, id: idOf('Harbour'), name: 'Harbour' },
      { schema: TREATMENT_SCHEMA, id: idOf('The Drowned Bell'), name: 'The Drowned Bell' },
      { schema: PRESET_SCHEMA, id: idOf('Wet Prose'), name: 'Wet Prose' },
    ]);

    // Each object, landed under its own id and stamped as an arrival.
    for (const entry of exported.manifest.contents) {
      expect((read(library, 'ned', entry.id).body as any).provenance).toMatchObject({
        source: 'import',
        originalFilename: `seworld:${entry.id}`,
      });
    }

    // The actor on the blank card, and both rows say what the old file lacked.
    const { bytes } = await readCardPixels(library, 'ned', idOf('Vera'));
    const pixels = (png: Uint8Array) => pixelBytes(png).map((chunk) => [...chunk]);
    expect(pixels(bytes)).toEqual(pixels(blankCardPixels()));
    const rows = response.body.report.items as {
      source: string;
      notes: { key: string; params: any }[];
    }[];
    const vera = rows.find((row) => row.source.startsWith('library/actors/'));
    expect(vera?.notes).toContainEqual({
      key: 'import.world.noPortrait',
      params: { id: idOf('Vera'), actor: 'Vera' },
      level: 'info',
    });
    const landed = rows.find((row) => row.notes.some((note) => note.key === 'import.world.landed'));
    expect(landed?.notes.map((note) => note.key)).toEqual([
      'import.world.landed',
      'import.world.legacyNoPictures',
    ]);
  });

  /**
   * *Retitled 2026-10-11, the P16.3e review* — ~~"the synthesised World is the
   * same bytes"~~: what makes the second import `unchanged` is identity, not
   * determinism (`identifyNative` carries the stored timestamps over before it
   * compares). Determinism is pinned on its own, below.
   */
  it('reads unchanged the second time', async () => {
    await upload('rain-city.sepack.json', FIXTURE);
    const count = list(server.services.library, 'ned').filter(
      (row) => row.owner === 'user:ned',
    ).length;

    const again = await upload('rain-city.sepack.json', FIXTURE);

    const rows = again.body.report.items as { source: string; disposition: string }[];
    expect(
      rows.filter((row) => row.source.startsWith('library/')).map((row) => row.disposition),
    ).toEqual(['unchanged', 'unchanged', 'unchanged', 'unchanged', 'unchanged']);
    expect(
      list(server.services.library, 'ned').filter((row) => row.owner === 'user:ned'),
    ).toHaveLength(count);
  });

  /** *The same file synthesises the same root*, byte for byte — what `exportedBy.at` dates it by. */
  it('synthesises the same bytes from the same file every time', async () => {
    const bytesOf = async (root: ReturnType<typeof packageExportRoot>) => {
      const out = new Map<string, string>();
      for await (const path of root.list()) {
        out.set(path, Buffer.from((await root.read(path))!).toString('base64'));
      }
      return out;
    };
    const first = await bytesOf(packageExportRoot(exported));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await bytesOf(packageExportRoot(structuredClone(exported)));

    expect(second).toEqual(first);
  });

  /**
   * ***Your own old file, read back, leaves your World as it is*** — the
   * P16.3e review's finding, blocking: the old format carries a World's name,
   * version and members and nothing else, and the blanks synthesised for the
   * rest were written over the World here by the default *replace* —
   * description, gallery, requirements and metadata gone. Exported by P11.10's
   * own route, and read back through the upload door.
   */
  it('leaves the World that wrote it as it was, gallery and all', async () => {
    const library = server.services.library;
    const harbour = newLorebook('Harbour');
    await create(library, 'ned', harbour, LOREBOOK_SCHEMA);
    const vera = { ...newActor('Vera'), lore: [{ id: harbour.id, name: 'Harbour' }] };
    await create(library, 'ned', vera, ACTOR_SCHEMA, { cardPixels: makePng(8, 1) });
    const world: World = {
      ...newWorld('Rain City'),
      version: '1.2.0',
      description: 'A port that is always wet.',
      contents: [
        { schema: ACTOR_SCHEMA, id: vera.id, name: 'Vera' },
        { schema: LOREBOOK_SCHEMA, id: harbour.id, name: 'Harbour' },
      ],
      requires: {
        modes: [{ id: DEFAULT_MODE_ID, minVersion: '0.0.1' }],
        extensions: [],
        capabilities: ['cap.x'],
      },
      metadata: { 'x.note': 'kept' },
    };
    const made = await create(library, 'ned', world, WORLD_SCHEMA);
    const view = await storeAsset(library, 'ned', world.id, makePng(7, 7), 'image/png');
    await update(
      library,
      'ned',
      world.id,
      { ...world, media: [{ id: 'w1', role: 'gallery', tags: [], ...view }] },
      made.contentHash,
    );
    const before = read(library, 'ned', world.id, WORLD_SCHEMA);
    const exportedHere = await server.request({
      method: 'GET',
      url: `/api/library/worlds/${world.id}/export`,
    });
    expect(exportedHere.status).toBe(200);

    const response = await upload(
      'rain-city.sepack.json',
      Buffer.from(JSON.stringify(exportedHere.body)),
    );

    // 200, not 201: nothing was converted.
    expect(response.status).toBe(200);
    const rows = response.body.report.items as {
      source: string;
      disposition: string;
      notes: { key: string }[];
    }[];
    const objects = rows.filter((row) => row.source.startsWith('library/'));
    expect(objects.map((row) => [row.source, row.disposition])).toEqual(
      objects.map((row) => [row.source, 'unchanged']),
    );
    const after = read(library, 'ned', world.id, WORLD_SCHEMA);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.body).toEqual(before.body);
    // Vera kept her portrait, so nothing says she is on a blank card.
    const actor = objects.find((row) => row.source.startsWith('library/actors/'));
    expect(actor?.notes.map((note) => note.key)).not.toContain('import.world.noPortrait');
  });

  /** *The same reader*, so the same identity rules: a second account re-mints and follows. */
  it('lands on a second account of the same install with every reference followed', async () => {
    await upload('rain-city.sepack.json', FIXTURE);

    const outcome = await sweep({
      library: server.services.library,
      handle: 'amy',
      tags: server.services.tags,
      files: packageExportRoot(readPackageExport(exported)!),
    });

    expect(outcome.ok).toBe(true);
    const own = list(server.services.library, 'amy').filter((row) => row.owner === 'user:amy');
    const by = (name: string) => own.find((row) => row.name === name)!;
    expect(by('Vera').id).not.toBe(idOf('Vera'));
    expect((by('Vera').body as any).lore[0].id).toBe(by('Harbour').id);
    expect((by('Harbour').body as any).hooks[0].involves[0].id).toBe(by('Vera').id);
    expect((by('The Drowned Bell').body as any).cast[0].ref.id).toBe(by('Vera').id);
    expect((by('Rain City').body as World).contents.map((entry) => entry.id)).toEqual([
      by('Vera').id,
      by('Harbour').id,
      by('The Drowned Bell').id,
      by('Wet Prose').id,
    ]);
  });

  it('synthesises the root a World file is: the manifest first', async () => {
    const root = packageExportRoot(exported);
    const first: string[] = [];
    for await (const path of root.list()) first.push(path);

    expect(first[0]).toBe(WORLD_FILE_MANIFEST);
  });

  it('is not one when it says it is something else, or leaves out what a reader needs', () => {
    expect(readPackageExport({ ...exported, schema: 'storyengine.package-export/2' })).toBeNull();
    // A `null` among the members was a 500 from the upload door (the P16.3e review).
    expect(
      readPackageExport({
        ...exported,
        manifest: { ...exported.manifest, contents: [null, ...exported.manifest.contents] },
      }),
    ).toBeNull();
    expect(
      readPackageExport({ ...exported, manifest: { ...exported.manifest, version: 1 } }),
    ).toBeNull();
    expect(readPackageExport({ ...exported, objects: undefined })).toBeNull();
    expect(readPackageExport(null)).toBeNull();
    expect(readPackageExport(exported)).toBe(exported);
  });

  /** *And through the door*: refused, never a 500. */
  it('answers a member that is not a record with a refusal, not a 500', async () => {
    const torn = {
      ...exported,
      manifest: { ...exported.manifest, contents: [null, ...exported.manifest.contents] },
    };

    const response = await upload('rain-city.sepack.json', Buffer.from(JSON.stringify(torn)));

    expect(response.status).toBeLessThan(500);
    expect(list(server.services.library, 'ned').filter((row) => row.owner === 'user:ned')).toEqual(
      [],
    );
  });

  /**
   * ***Folder names cost one probe each, however many objects share a name***
   * (the P16.3e review): each name was probed from `-2` upwards, so a file of
   * N objects named alike probed N²/2 names, synchronously, in the request —
   * 16,000 held the event loop for 27 s. Counted, not timed.
   */
  it('names a run of same-named folders in one probe each', () => {
    const folders = new Folders();
    const names = Array.from({ length: 2000 }, () => folders.take('lorebooks', 'a'));

    expect(new Set(names).size).toBe(2000);
    expect(names.slice(0, 3)).toEqual(['a', 'a-2', 'a-3']);
    expect(folders.probes).toBeLessThan(2 * 2000);
    // A name taken as a name of its own is still skipped.
    expect(folders.take('lorebooks', 'b-2')).toBe('b-2');
    expect([folders.take('lorebooks', 'b'), folders.take('lorebooks', 'b')]).toEqual(['b', 'b-3']);
  });
});
