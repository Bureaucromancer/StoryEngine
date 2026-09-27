// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { FakeProvider } from '../providers/fake.js';
import { readDraft } from '../state/jobs.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***The operational store's prune, as the server runs it*** (2026-09-27).
 *
 * `state/prune.test.ts` holds the rules. This holds the one thing the server
 * adds to them: whether a session is still there, asked of its file. A session
 * deleted to the trash has no `session.json` where it lived, so its last turn's
 * prompts and prose go with the rest, and a session still there keeps its last
 * turn for the next attach.
 */

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a35';
const DAY = 24 * 60 * 60 * 1000;

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer({
    providers: () => new FakeProvider({ script: [{ text: 'The rain kept on.' }] }),
  });
  await setUpAdmin(server);
  const connections = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(connections, { recursive: true });
  await writeFile(
    join(connections, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );
});

afterEach(async () => {
  await server.dispose();
});

/** A session with one finished turn, and that turn's job id. */
async function aPlayedSession(name: string): Promise<{ sessionId: string; jobId: string }> {
  const created = await server.request({ method: 'POST', url: '/api/sessions', payload: { name } });
  const sessionId = created.body.session.id as string;
  const accepted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: 'k1', headTurnId: null, input: { text: 'She opened the door.' } },
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(202);
  await server.services.runner.settle();
  return { sessionId, jobId: accepted.body.jobId as string };
}

it('collects a deleted session’s last turn, and keeps a live one’s', async () => {
  const kept = await aPlayedSession('Rain City');
  const deleted = await aPlayedSession('Elsewhere');
  const gone = await server.request({
    method: 'DELETE',
    url: `/api/sessions/${deleted.sessionId}`,
  });
  expect(gone.status).toBeLessThan(300);

  // Both turns finished two days ago, as far as the store knows.
  server.services.state.db.prepare('update job set finished_at = ?').run(Date.now() - 2 * DAY);
  await server.services.prune.runOnce();

  const jobs = { db: server.services.state.db, sessions: server.services.sessions };
  expect(readDraft(jobs, kept.jobId)).not.toBeNull();
  expect(readDraft(jobs, deleted.jobId)).toBeNull();
});
