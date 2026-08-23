// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newLorebook } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The exit-gate steps that were never automated — F11.
 *
 * P1 §3's footnote claimed automated equivalents of steps 4 and 7–19 and did
 * not have them: step 16 was split across two files and never asserted
 * together, and step 11's *login* half — the reason the step exists — was
 * untested. Both are here, through the app, with the watcher on.
 *
 * They live together because they share a shape the rest of the suite avoids:
 * a real watcher and a real restart, which is exactly what makes them the
 * expensive ones to write and the easy ones to keep putting off.
 */

/** Filesystem events are not synchronous; poll rather than guess a delay. */
async function eventually(check: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((tick) => setTimeout(tick, 50));
  }
  expect(await check(), 'condition never held before the timeout').toBe(true);
}

describe('step 16 — one object, both kinds of edit, told apart', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer({ watch: true });
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('records the app edit as manual and the disk edit as external, in one history', async () => {
    // The whole point of the step: *the same object*, both sources, one list.
    // Asserted separately in two files, this is a pair of half-claims — a
    // watcher that attributed everything to `external` would satisfy one and a
    // route that attributed everything to `manual` would satisfy the other.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    expect(created.status).toBe(201);
    const slug = created.body.slug as string;
    const file = join(
      server.dataDir,
      'users',
      'ned',
      'library',
      'lorebooks',
      slug,
      'lorebook.json',
    );

    // 1. Through the app.
    const edited = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: {
        object: { ...book, name: 'Rain City, edited in the app' },
        contentHash: created.body.contentHash,
      },
    });
    expect(edited.status).toBe(200);

    // 2. In a text editor, on the same object.
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(
      file,
      JSON.stringify({ ...onDisk, name: 'Rain City, edited on disk' }, null, 2),
    );

    // Waited on the *history*, not on the list. The watcher snapshots the
    // replaced state after it has re-indexed, so a poll on the listed name wins
    // the race and reads the history one entry early — which looks exactly like
    // the attribution being wrong.
    await eventually(async () => {
      const listed = await server.request({
        method: 'GET',
        url: `/api/library/lorebooks/${book.id}/history`,
      });
      return (listed.body.versions as unknown[]).length === 2;
    });

    const history = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}/history`,
    });
    const sources = (history.body.versions as { source: { kind: string } }[]).map(
      (version) => version.source.kind,
    );

    // Newest first: the external edit snapshotted the app's version, and the
    // app's edit snapshotted the original.
    expect(sources).toEqual(['external', 'manual']);
  });
});

describe('step 11 — deleting the index is a non-event, including for login', () => {
  it('rebuilds the library and still lets the admin in', async () => {
    // The half that was never tested, and the one the step is *for*: accounts
    // live in `accounts.json` and not in the index, so deleting the index must
    // not lock anybody out. A rebuild test at the database layer cannot say
    // anything about that — it has to go through login.
    // Both servers borrow one directory. A server that *made* its own removes
    // it on dispose, which is right for an ordinary test and fatal for this one.
    const dataDir = await mkdtemp(join(tmpdir(), 'se-gate-'));
    const first = await makeTestServer({ dataDir });
    await setUpAdmin(first);

    const actor = newActor('Vera Solano');
    await first.request({ method: 'POST', url: '/api/library/actors', payload: actor });
    const book = newLorebook('Rain City');
    await first.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });
    await first.dispose();

    // The step, literally: stop the server, delete the file, start again.
    await rm(join(dataDir, 'index', 'index.sqlite'), { force: true });
    await rm(join(dataDir, 'index', 'index.sqlite-wal'), { force: true });
    await rm(join(dataDir, 'index', 'index.sqlite-shm'), { force: true });

    const second = await makeTestServer({ dataDir });
    try {
      const login = await second.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'ned', password: 'correct horse battery' },
      });
      expect(login.status).toBe(200);
      expect(login.body.account.handle).toBe('ned');

      // And everything is still listed, rebuilt from what is on disk.
      const listed = await second.request({ method: 'GET', url: '/api/library' });
      expect((listed.body.objects as { id: string }[]).map((row) => row.id).sort()).toEqual(
        [actor.id, book.id].sort(),
      );
    } finally {
      await second.dispose();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('is not a non-event for the operational store, which is the other half', async () => {
    // The contrast P2 §4 item 15 will assert in full: the index is derived and
    // disposable, `state/` is not. Nothing operational exists yet beyond the
    // session key, so what is asserted here is exactly that — deleting it logs
    // people out, which is the same claim at the size it currently has.
    const dataDir = await mkdtemp(join(tmpdir(), 'se-gate-'));
    const first = await makeTestServer({ dataDir });
    await setUpAdmin(first);
    const cookie = first.cookies.get('se_session');
    expect(cookie).toBeDefined();
    await first.dispose();

    await rm(join(dataDir, 'state', 'session.key'), { force: true });

    const second = await makeTestServer({ dataDir });
    try {
      // The cookie the first server issued is no longer signed by anything the
      // second server knows.
      second.cookies.set('se_session', cookie!);
      const state = await second.request({ method: 'GET', url: '/api/auth/state' });
      expect(state.body.account).toBeNull();
    } finally {
      await second.dispose();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe('step 8 — a hand edit reaches the browser without a restart', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer({ watch: true });
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('serves the new title from the API the client polls', async () => {
    // The server half of the storage thesis, demonstrated rather than asserted.
    // The client half — the 2s poll — is a component concern and belongs with
    // the jsdom tier.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    const slug = created.body.slug as string;
    const file = join(
      server.dataDir,
      'users',
      'ned',
      'library',
      'lorebooks',
      slug,
      'lorebook.json',
    );

    const onDisk = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(
      file,
      JSON.stringify({ ...onDisk, name: 'Rain City, after the fire' }, null, 2),
    );

    await eventually(async () => {
      const read = await server.request({
        method: 'GET',
        url: `/api/library/lorebooks/${book.id}`,
      });
      return read.body.name === 'Rain City, after the fire';
    });
  });
});
