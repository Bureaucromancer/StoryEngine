// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Rendition } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { readRenditions } from '../renditions/store.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***The Illustrate button answers once its record is on disk*** (2026-09-27).
 *
 * The dispatch writes a rendition's record now, after claiming its job, so that
 * no `pending` record is ever on disk without a job row behind it
 * (`dispatchRenditions`). The route used to write the record itself and then
 * dispatch without waiting; now the write is the dispatch's, and the route
 * waits for it, so a client that refetches on the `202` finds the picture it
 * was just promised.
 *
 * A pending record's write is slowed here, so a route that stopped waiting for
 * it would answer first, every time.
 */
vi.mock('../renditions/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../renditions/store.js')>();
  return {
    ...actual,
    writeRendition: async (...args: Parameters<typeof actual.writeRendition>) => {
      if (args[3].state === 'pending') await new Promise((done) => setTimeout(done, 200));
      await actual.writeRendition(...args);
    },
  };
});

const CHAT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a36';
const IMAGE = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a37';
const MOMENT = JSON.stringify({ subject: 'a lantern on a wet quay', anchor: 'The road went on' });

let dataDir: string;
let server: TestServer;
let sessionId: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-illustrate-record-'));
  const fake = new FakeProvider({
    script: [{ text: MOMENT, object: JSON.parse(MOMENT) as unknown }],
    images: [{}],
    capabilities: { rendersImages: true, supportsStructuredOutput: true },
  });
  server = await makeTestServer({ dataDir, providers: () => fake });
  await setUpAdmin(server);
  const connections = new Layout(dataDir).userConnectionsRoot('ned');
  await mkdir(connections, { recursive: true });
  await writeFile(
    join(connections, 'chat.json'),
    JSON.stringify({
      id: CHAT,
      label: 'Words',
      provider: 'openai-compatible',
      models: ['fake-hi'],
    }),
  );
  await writeFile(
    join(connections, 'image.json'),
    JSON.stringify({
      id: IMAGE,
      label: 'Pictures',
      provider: 'openai-compatible',
      models: ['fake-image'],
      capabilities: { rendersImages: true },
    }),
  );
  await writeFile(
    join(dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({
      prose: { connectionId: CHAT, modelId: 'fake-hi' },
      fast: { connectionId: CHAT, modelId: 'fake-hi' },
      image: { connectionId: IMAGE, modelId: 'fake-image' },
    }),
  );
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'The harbour' },
  });
  sessionId = created.body.session.id as string;
});

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

it('answers once the pending record is on disk', async () => {
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: 'k1', headTurnId: null, input: { text: 'Look around.' } },
  });
  expect(submitted.status).toBe(202);
  const turnId = submitted.body.turnId as string;
  await eventually(async () => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    return read.body.session.headTurnId === turnId;
  });

  const asked = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns/${turnId}/illustrate`,
    payload: { purpose: 'illustration' },
  });
  expect(asked.status, JSON.stringify(asked.body)).toBe(202);

  const promised = (asked.body as { rendition: Rendition }).rendition.id;
  const onDisk = await readRenditions(server.services.sessions.layout, 'ned', sessionId);
  expect([...onDisk.keys()]).toContain(promised);
  await server.services.drainRenditions();
});
