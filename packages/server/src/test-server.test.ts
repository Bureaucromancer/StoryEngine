// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOREBOOK_SCHEMA, newLorebook } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, watchedIndex, type TestServer } from './test-server.js';

/**
 * The harness itself, because F11's gate tests are about to lean on it.
 *
 * `makeTestServer` took no arguments and hardcoded a fresh temporary directory
 * with the watcher off. Both of those are exactly what several exit-gate steps
 * need to vary — step 8 is a hand edit appearing without a restart, step 11 is
 * a *restart* against data that already exists — so the options are asserted
 * here rather than discovered to be broken inside a test that is trying to
 * prove something else. A harness that quietly ignored `watch: true` would give
 * step 8 a green run for the wrong reason.
 */

const NED = { kind: 'user', handle: 'ned' } as const;

describe('the watcher option', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer({ watch: true });
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('picks up a file written behind the server', async () => {
    // Gate step 8's mechanism, through the app rather than through the index:
    // nothing here calls ingest, and the object arrives over HTTP.
    expect(server.services.watcher).not.toBeNull();

    const book = newLorebook('Rain City');
    const path = server.services.layout.objectFile(NED, LOREBOOK_SCHEMA, 'rain-city');
    await mkdir(dirname(path), { recursive: true });

    // Subscribed before the write, and waited on the watcher's own signal
    // rather than polling the list — [P7.0]. The claim is that `watch: true`
    // wires a watcher that delivers, so waiting on delivery is the claim, and a
    // harness that quietly ignored the option now hangs with a message naming
    // the path instead of expiring a timer.
    const indexed = watchedIndex(server, path);
    await writeFile(path, JSON.stringify(book));
    await indexed;

    const listed = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect((listed.body.objects as { id: string }[]).some((row) => row.id === book.id)).toBe(true);
  });
});

describe('the borrowed data directory', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'se-restart-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('survives a restart with its data, and is not deleted underneath the second one', async () => {
    // Gate step 11's shape: stop the server, start another one on the same
    // directory, and find everything still there. The helper used to `rm` the
    // tree on every dispose, which made a second server impossible.
    const first = await makeTestServer({ dataDir });
    await setUpAdmin(first);
    const book = newLorebook('Rain City');
    const created = await first.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    expect(created.status).toBe(201);
    await first.dispose();

    const second = await makeTestServer({ dataDir });
    try {
      // The account survived, which is the half of step 11 that is about
      // accounts not living in the index.
      const login = await second.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'ned', password: 'correct horse battery' },
      });
      expect(login.status).toBe(200);

      const listed = await second.request({ method: 'GET', url: '/api/library/lorebooks' });
      expect((listed.body.objects as { id: string }[]).map((row) => row.id)).toEqual([book.id]);
    } finally {
      await second.dispose();
    }
  });
});

describe('the config option', () => {
  it('reaches the running app', async () => {
    const server = await makeTestServer({ config: { history: { keepPerObject: 3 } } });
    try {
      expect(server.services.config.history.keepPerObject).toBe(3);
      // And the level the harness sets by default is not clobbered by it.
      expect(server.services.config.log.level).toBe('silent');
    } finally {
      await server.dispose();
    }
  });
});
