// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ACTOR_SCHEMA, LOREBOOK_SCHEMA, newActor, newLorebook } from '@storyengine/shared';

import { type LibraryContext, update } from '../library.js';
import { listVersions, patchVersion, snapshotReplaced } from '../storage/history.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The write path under a second writer — the P1-closeout regression suite for
 * the races the audit found (doc 20 Appendix A: F3, F5, F6, F7, F10-slug).
 * Every test here raced or lost data on the pre-closeout code.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

const NED = { kind: 'user', handle: 'ned' } as const;

describe('two writers through one server', () => {
  it('lets exactly one of two concurrent saves through', async () => {
    // F3: both writers present the same (valid) hash. Before the write queue,
    // both passed the check across the awaits and the loser silently won.
    const book = newLorebook('Rain City');
    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });
    const read = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}`,
    });
    const hash = read.body.contentHash as string;

    const [a, b] = await Promise.all([
      server.request({
        method: 'PUT',
        url: `/api/library/lorebooks/${book.id}`,
        payload: { object: { ...book, name: 'First writer' }, contentHash: hash },
      }),
      server.request({
        method: 'PUT',
        url: `/api/library/lorebooks/${book.id}`,
        payload: { object: { ...book, name: 'Second writer' }, contentHash: hash },
      }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 412]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;

    // The store holds the winner's write, whole.
    const after = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}`,
    });
    expect(after.body.object.name).toBe(winner.body.object.name);

    // The loser was told the truth: the 412 carries the state that beat it,
    // so its client can reconcile rather than guess.
    expect(loser.body.current.contentHash).toBe(winner.body.contentHash);
  });

  it('gives two concurrent creates of one name distinct slugs', async () => {
    // F10-slug: resolveFreeSlug reads the directory, the write claims the
    // name. Unserialized, both creates resolved `vera-solano` and one file
    // silently replaced the other.
    const [a, b] = await Promise.all([
      server.request({
        method: 'POST',
        url: '/api/library/actors',
        payload: newActor('Vera Solano'),
      }),
      server.request({
        method: 'POST',
        url: '/api/library/actors',
        payload: newActor('Vera Solano'),
      }),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.slug).not.toBe(b.body.slug);

    // Both objects are real files, not one file written twice.
    for (const created of [a, b]) {
      const path = server.services.layout.objectFile(NED, ACTOR_SCHEMA, created.body.slug);
      const bytes = await readFile(path);
      expect(bytes.length).toBeGreaterThan(0);
    }
  });
});

describe('the write→snapshot ordering', () => {
  it('records no version when the write itself fails', async () => {
    // F5's second half: snapshotting before the write left a history entry
    // for a change that never landed. The `write` seam injects the failure.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    const read = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}`,
    });
    const hash = read.body.contentHash as string;

    const failing: LibraryContext = {
      ...server.services.library,
      write: () => Promise.reject(new Error('disk full')),
    };
    await expect(
      update(failing, 'ned', book.id, { ...book, name: 'Never lands' }, hash),
    ).rejects.toThrow('disk full');

    const objectRoot = server.services.layout.objectRoot(
      NED,
      LOREBOOK_SCHEMA,
      created.body.slug as string,
    );
    expect(await listVersions(objectRoot)).toEqual([]);

    // And the stored object is untouched.
    const after = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}`,
    });
    expect(after.body.object.name).toBe('Rain City');
    expect(after.body.contentHash).toBe(hash);
  });
});

describe('server-side authorship stamping', () => {
  it('keeps authoredAt honest for a writer that never stamps', async () => {
    // F6: `authoredAt` used to trust the client's `provenance.updatedAt`,
    // which only the bundled editor set. A curl writer — or P4's importer —
    // must get correct history without knowing the convention exists.
    const book = newLorebook('Rain City');
    book.provenance.updatedAt = '2020-01-01T00:00:00.000Z';

    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });
    const created = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}`,
    });
    // Create does not stamp: an import must keep its original authorship.
    expect(created.body.object.provenance.updatedAt).toBe('2020-01-01T00:00:00.000Z');

    // A curl-style edit: the name changes, the provenance is not touched.
    const first = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: {
        object: { ...book, name: 'Rain City, after the fire' },
        contentHash: created.body.contentHash,
      },
    });
    expect(first.status).toBe(200);
    const stampedAt = first.body.object.provenance.updatedAt as string;
    expect(stampedAt).not.toBe('2020-01-01T00:00:00.000Z');

    // A second edit snapshots the first's state — whose authoredAt must be
    // the server's stamp, not the stale client value.
    const second = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: {
        object: { ...(first.body.object as object), name: 'Third title' },
        contentHash: first.body.contentHash,
      },
    });
    expect(second.status).toBe(200);

    const history = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}/history`,
    });
    // Newest first: [after-first-edit snapshot, created snapshot].
    expect(history.body.versions).toHaveLength(2);
    expect(history.body.versions[0].authoredAt).toBe(stampedAt);
    expect(history.body.versions[1].authoredAt).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('deletion is a move', () => {
  it('sends the folder to the trash, history and all, and frees the slug', async () => {
    // F7: DELETE used to erase the object folder *including its history* —
    // the one unrecoverable action in a design built on recoverability.
    const actor = newActor('Vera Solano');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: actor,
    });
    const slug = created.body.slug as string;

    // An edit first, so there is history worth preserving.
    const edited = await server.request({
      method: 'PUT',
      url: `/api/library/actors/${actor.id}`,
      payload: {
        object: { ...actor, name: 'Vera, renamed' },
        contentHash: created.body.contentHash,
      },
    });
    expect(edited.status).toBe(200);

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/actors/${actor.id}`,
      headers: { 'if-match': edited.body.contentHash as string },
    });
    expect(removed.status).toBe(204);

    const gone = await server.request({ method: 'GET', url: `/api/library/actors/${actor.id}` });
    expect(gone.status).toBe(404);

    // The folder landed in the trash with the card and the history intact.
    const trashKind = join(server.dataDir, 'users', 'ned', 'trash', 'actors');
    const entries = await readdir(trashKind);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.startsWith(`${slug}-`)).toBe(true);
    await readFile(join(trashKind, entries[0]!, 'card.png'));
    await readFile(join(trashKind, entries[0]!, 'history', 'index.jsonl'));

    // The slug is free again — the folder moved, it did not linger.
    const again = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: newActor('Vera Solano'),
    });
    expect(again.status).toBe(201);
    expect(again.body.slug).toBe(slug);
  });
});

describe('history under concurrent producers', () => {
  it('loses no record when a pin races a snapshot', async () => {
    // F5: `recordVersion` appends while `patchVersion` rewrites the whole
    // file from its own read — unserialized, the rewrite discards a
    // concurrent append. Both effects must land, every time.
    const root = await mkdtemp(join(tmpdir(), 'se-hist-race-'));
    try {
      const seeded = await snapshotReplaced({
        objectRoot: root,
        payload: { state: 'first' },
        source: { kind: 'manual' },
        reason: '',
        keepPerObject: 50,
      });
      expect(seeded).not.toBeNull();

      const [second] = await Promise.all([
        snapshotReplaced({
          objectRoot: root,
          payload: { state: 'second' },
          source: { kind: 'external' },
          reason: '',
          keepPerObject: 50,
        }),
        patchVersion(root, seeded!.id, { pinned: true }),
      ]);
      expect(second).not.toBeNull();

      const records = await listVersions(root);
      expect(records).toHaveLength(2);
      expect(records.find((record) => record.id === seeded!.id)?.pinned).toBe(true);
      expect(records.some((record) => record.id === second!.id)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
