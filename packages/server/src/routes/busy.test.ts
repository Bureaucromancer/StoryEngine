// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setJobStatus, submitTurn } from '../state/jobs.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***A turn in flight is one answer, at every door*** (2026-09-27): `409 busy`
 * with the job, which head moves and undo always sent. A dial change, a
 * *Remember this* and a delete answered `200` or `204` instead, and each left
 * something the turn's commit then undid: a setting on a line nobody sees, a
 * memory recorded on a dead turn, a session folder written back beside the
 * trashed one. `sessions/busy.test.ts` holds the store half; this is the wire.
 */

let server: TestServer;
let sessionId: string;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City' },
  });
  sessionId = (created.body as { session: { id: string } }).session.id;
});

afterEach(async () => {
  await server.dispose();
});

describe('a session with a turn in flight', () => {
  it('refuses the writes that would move its head, and names the job', async () => {
    // A reservation with no runner behind it: the session is busy until the
    // job is finished, which this test does by hand at the end.
    const submitted = await submitTurn(server.services.jobs, {
      account: 'ned',
      sessionId,
      idempotencyKey: 'k-busy',
      headTurnId: null,
    });
    if (submitted.kind !== 'created') throw new Error(submitted.kind);
    const job = submitted.job;

    const attempts = [
      {
        method: 'PUT' as const,
        url: `/api/sessions/${sessionId}/channels/se.illustrate`,
        payload: { value: 'off' },
      },
      {
        method: 'POST' as const,
        url: `/api/sessions/${sessionId}/remember`,
        payload: { turnId: 't-1', actorId: 'a-1', text: 'She lied.', keys: ['lie'] },
      },
      { method: 'DELETE' as const, url: `/api/sessions/${sessionId}` },
    ];
    for (const attempt of attempts) {
      const response = await server.request(attempt);
      expect(response.status, `${attempt.method} ${attempt.url}`).toBe(409);
      expect(response.body).toMatchObject({ error: 'busy', job: { id: job.id } });
    }

    // Still there, and once the turn is over the same write goes through.
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.status).toBe(200);
    setJobStatus(server.services.jobs, job.id, 'abandoned');
    const written = await server.request(attempts[0]!);
    expect(written.status).toBe(200);
  });
});
