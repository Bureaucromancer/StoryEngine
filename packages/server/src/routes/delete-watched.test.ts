// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOREBOOK_SCHEMA, newLorebook } from '@storyengine/shared';

import { blankCardPixels } from '../library.js';
import { storeAsset } from '../library/assets.js';
import { listDirectoryNames } from '../storage/files.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Delete, with the watcher running*** (2026-10-06).
 *
 * Every other route test builds its server with `watch: false`, and so did
 * every test of delete — which is how a delete that failed on the development
 * platform for most of what anybody would delete went unseen. The watcher
 * watched the whole data directory, and on Windows a watched folder is a
 * directory handle held open; a folder with a handle held inside it cannot be
 * renamed, and deletion is a rename into the trash ([03 §10.2]). So an object
 * that had ever been saved (the save makes `history/`), a lorebook with a
 * picture (`assets/`) and a session with turns (`turns/`) all answered a bare
 * 500, while a never-edited object deleted fine — which is why it read as
 * *unreliable* rather than as *broken*.
 *
 * **On Linux every test here passes either way**, because an inotify watch does
 * not pin a directory. The cross-platform half of the claim is
 * `layout.test.ts`'s *what the watcher looks at* and `watcher.test.ts`'s fence;
 * this file is the half that shows it was the delete that broke, and it is
 * the Windows leg that can fail it.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer({ watch: true });
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

/**
 * Long enough for chokidar to have met a folder that was just made — the
 * condition being tested is a watch *already held* when the delete arrives,
 * and a delete that raced ahead of the watch would pass without proving it.
 */
async function letTheWatcherLook(): Promise<void> {
  await new Promise((settle) => setTimeout(settle, 400));
}

async function trashed(kind: string): Promise<string[]> {
  return listDirectoryNames(join(server.services.library.layout.trashRoot('ned'), kind));
}

describe('delete, with the watcher running', () => {
  it('moves an object that has been saved, history and all', async () => {
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    const saved = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: {
        object: { ...book, name: 'Rain City, revised' },
        contentHash: created.body.contentHash,
      },
    });
    expect(saved.status).toBe(200);
    await letTheWatcherLook();

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${book.id}`,
      headers: { 'if-match': saved.body.contentHash as string },
    });

    expect(removed.status).toBe(204);
    expect((await ownObjects(server, 'lorebooks')).objects).toEqual([]);
    const [entry] = await trashed('lorebooks');
    expect(entry).toMatch(/^rain-city-/);
    // The history went with it, which is the reason the move is the folder.
    expect(
      await listDirectoryNames(
        join(server.services.library.layout.trashRoot('ned'), 'lorebooks', entry ?? ''),
      ),
    ).toContain('history');
  });

  it('moves a lorebook with a picture beside it', async () => {
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    await storeAsset(
      server.services.library,
      'ned',
      book.id,
      blankCardPixels(),
      'image/png',
      LOREBOOK_SCHEMA,
    );
    await letTheWatcherLook();

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${book.id}`,
      headers: { 'if-match': created.body.contentHash as string },
    });

    expect(removed.status).toBe(204);
    expect(await trashed('lorebooks')).toHaveLength(1);
  });

  it('puts a saved object back from the trash', async () => {
    // The restore is the same rename the other way, and the trash was
    // watched too: an entry with history in it could not be moved out.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    const saved = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: {
        object: { ...book, name: 'Rain City, revised' },
        contentHash: created.body.contentHash,
      },
    });
    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${book.id}`,
      headers: { 'if-match': saved.body.contentHash as string },
    });
    expect(removed.status).toBe(204);
    await letTheWatcherLook();

    const listed = await server.request({ method: 'GET', url: '/api/me/trash' });
    const [entry] = listed.body.entries as { id: string }[];
    const restored = await server.request({
      method: 'POST',
      url: '/api/me/trash/restore',
      payload: { id: entry?.id },
    });

    expect(restored.status).toBe(200);
    const read = await server.request({ method: 'GET', url: `/api/library/lorebooks/${book.id}` });
    expect(read.body.name).toBe('Rain City, revised');
  });

  it('moves a session that has a folder inside it', async () => {
    // `turns/` is made by hand rather than by playing a turn, which would need
    // a provider: the condition is a folder inside the session's, and a
    // session's turns are where one comes from.
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain' },
    });
    const sessionId = created.body.session.id as string;
    await mkdir(join(server.services.sessions.layout.sessionRoot('ned', sessionId), 'turns'));
    await letTheWatcherLook();

    const removed = await server.request({ method: 'DELETE', url: `/api/sessions/${sessionId}` });

    expect(removed.status).toBe(204);
    expect(
      (await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` })).status,
    ).toBe(404);
  });
});
