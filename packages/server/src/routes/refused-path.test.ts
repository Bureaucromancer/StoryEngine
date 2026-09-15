// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLorebook } from '@storyengine/shared';

import { rebuild } from '../index-db/rebuild.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * A folder name the filesystem allows and this server will not touch — F22.
 *
 * The index takes an object's slug from the name of the folder it was found in,
 * and hand-making folders is the headline feature of this storage model. So a
 * directory called `con` — legal on Linux, reserved on Windows — is indexed
 * happily, and then every route that rebuilds a path from that slug hits the
 * lexical guard. That used to be an unhandled throw: a 500 whose body carried
 * the absolute paths of both the candidate and the data root.
 *
 * The reads are where this surfaces. A write re-reads the bytes off disk inside
 * its critical section and compares hashes before it resolves anything else
 * (the F3 closeout), so a folder the server cannot open answers 412 on the hash
 * long before the name is refused — correct ordering, and the reason the cases
 * below are all reads.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

/**
 * The path a route will refuse, planted in the index as the watcher would have.
 *
 * Fabricated rather than made on disk, because the folder names that produce
 * this are precisely the ones Windows will not create — and the *response* has
 * to be right on both platforms. The row is exactly what an ingest of such a
 * folder writes: `parseObjectPath` takes the slug off the directory name and
 * never checks it, which is why the bad name reaches the index in the first
 * place. The rebuild tests below work from a real folder instead.
 */
async function indexALorebookUnder(slug: string): Promise<{ id: string; contentHash: string }> {
  const book = newLorebook('Rain City');
  const created = await server.request({
    method: 'POST',
    url: '/api/library/lorebooks',
    payload: book,
  });
  expect(created.status).toBe(201);

  const path = join(server.dataDir, 'users', 'ned', 'library', 'lorebooks', slug, 'lorebook.json');
  server.services.index.db
    .prepare('update object set slug = ?, path = ? where id = ?')
    .run(slug, path, book.id);

  return { id: book.id, contentHash: created.body.contentHash as string };
}

describe('a refused path', () => {
  it('is a 422 naming the segment, not a 500 naming the disk', async () => {
    const { id } = await indexALorebookUnder('con');

    const history = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}/history`,
    });

    expect(history.status).toBe(422);
    expect(history.body.error).toBe('refused-path');
    // The reason is the useful half — it says *why* the name is unusable.
    expect(history.body.message).toContain('reserved-device-name');
    expect(history.body.message).toContain('con');
    // And the message is safe to paste into an issue: no data root, no
    // absolute anything. This is the half that was leaking.
    expect(history.body.message).not.toContain(server.dataDir);
    expect(history.body.message).not.toContain('users');
  });

  it('names a trailing space the same way it names a device name', async () => {
    // The vocabulary is the point: `reason` is a closed set, so a client can
    // say something useful about a folder nobody can open.
    const { id } = await indexALorebookUnder('spaced ');

    const history = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}/history`,
    });

    expect(history.status).toBe(422);
    expect(history.body.message).toContain('trailing-dot-or-space');
  });

  it('costs one object in a rebuild, not the whole library', async () => {
    // The other half of F22, and the worse one. `rebuild` builds each path
    // through the same guard, so one hand-made folder used to throw out of the
    // scan entirely — every object after it unindexed, from a directory nobody
    // asked the server to open.
    const ordinary = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: ordinary,
    });
    expect(created.status).toBe(201);

    /**
     * What a rebuild does before the refused folder exists.
     *
     * ***Deltas rather than absolutes, changed at [P7B.0].*** These read `2`,
     * `1`, `1` when the only things on disk were this test's own two objects.
     * P7B.0 ships prompt packs in the system scope, so the absolutes moved —
     * but the claim never was *the whole install scans to three numbers*, it
     * was **one bad folder costs exactly one object**. That is a difference,
     * and writing it as one is what stops the next shipped object from
     * breaking a test about something else.
     */
    const before = await rebuild(server.services.index.db, server.services.layout);

    const kindRoot = join(server.dataDir, 'users', 'ned', 'library', 'lorebooks');
    const refused = newLorebook('Hand Made');
    await mkdir(join(kindRoot, 'con'), { recursive: true });
    await writeFile(join(kindRoot, 'con', 'lorebook.json'), JSON.stringify(refused, null, 2));

    const result = await rebuild(server.services.index.db, server.services.layout);

    // Scanned, counted, and stepped over — one more seen, none more indexed.
    expect(result.scanned).toBe(before.scanned + 1);
    expect(result.indexed).toBe(before.indexed);
    expect(result.skipped).toBe(before.skipped + 1);

    // And the library that has nothing to do with it is intact.
    const listed = await ownObjects(server, 'lorebooks');
    expect(listed.status).toBe(200);
    expect(listed.objects.map((row) => row.id)).toEqual([ordinary.id]);
  });

  it('is skipped by a rebuild and indexed by the watcher, which P2.3 owns', async () => {
    // Written down as an assertion rather than a comment, because it is a real
    // divergence between the two producers the rebuild-equals-incremental gate
    // holds to one answer (F11): `parseObjectPath` takes the slug off the
    // directory name without checking it, so the watcher indexes what a rebuild
    // steps over. Reconciling them is P2.7's, beside F20 — the same question of
    // how the index represents a file it cannot open. When that lands, this
    // test changes shape, and it should be found by failing.
    const kindRoot = join(server.dataDir, 'users', 'ned', 'library', 'lorebooks');
    const refused = newLorebook('Hand Made');
    await mkdir(join(kindRoot, 'con'), { recursive: true });
    await writeFile(join(kindRoot, 'con', 'lorebook.json'), JSON.stringify(refused, null, 2));

    await rebuild(server.services.index.db, server.services.layout);

    const listed = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect(listed.body.objects).toHaveLength(0);
  });
});

describe('the scope this does not have', () => {
  it('leaves an ordinary object alone', async () => {
    // The guard is on the segment, not on the route: a normal slug still works,
    // which is worth asserting beside a test that makes everything refuse.
    const book = newLorebook('Rain City');
    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });

    const history = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}/history`,
    });
    expect(history.status).toBe(200);
  });
});
