// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLorebook, uuidv7 } from '@storyengine/shared';

import { appendTurnToSession, createSession } from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * `GET /api/search` — F10's answer.
 *
 * The finding was an FTS index maintained on every write with **no caller**:
 * `search()` existed, was tested, and nothing could query it. This route is its
 * first one, and the second consumer that makes the shape honest — a person
 * looking for "the cathedral" does not know whether they wrote it in a lorebook
 * or said it in a turn.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

async function aTurnSaying(said: string, handle = 'ned'): Promise<string> {
  const session = await createSession(server.services.sessions, handle, 'Rain City');
  const turn: Turn = {
    id: uuidv7(),
    sessionId: session.id,
    parentTurnId: null,
    createdAt: new Date(Date.UTC(2026, 7, 16, 12)).toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'say', text: 'And then?', raw: '' },
    output: { text: said },
    effects: [],
    tape: [],
  };
  await appendTurnToSession(server.services.sessions, handle, session.id, turn);
  return turn.id;
}

describe('search', () => {
  it('answers with both objects and turns', async () => {
    await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: newLorebook('The Cathedral District'),
    });
    const turnId = await aTurnSaying('The cathedral was three streets east.');

    const found = await server.request({ method: 'GET', url: '/api/search?q=cathedral' });

    expect(found.status).toBe(200);
    expect(found.body.objects.map((row: { name: string }) => row.name)).toEqual([
      'The Cathedral District',
    ]);
    expect(found.body.turns.map((row: { turnId: string }) => row.turnId)).toEqual([turnId]);
  });

  it('never reaches another account', async () => {
    await aTurnSaying('The cathedral was three streets east.');
    await server.services.accounts.create({
      handle: 'sister',
      password: 'correct horse battery',
      role: 'user',
    });
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'sister', password: 'correct horse battery' },
    });

    const theirs = await server.request({ method: 'GET', url: '/api/search?q=cathedral' });
    expect(theirs.body).toEqual({ objects: [], turns: [] });
  });

  it('needs a session', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const found = await server.request({ method: 'GET', url: '/api/search?q=cathedral' });
    expect(found.status).toBe(401);
  });

  it('rejects an empty query rather than returning everything', async () => {
    const found = await server.request({ method: 'GET', url: '/api/search?q=' });
    expect(found.status).toBe(400);
  });

  it('answers 400 to a query FTS cannot parse, not 500', async () => {
    // FTS5 has a syntax and a person typing into a search box does not know it.
    // An unbalanced quote is their problem to fix, not a server fault.
    const found = await server.request({ method: 'GET', url: '/api/search?q=%22unbalanced' });
    expect(found.status).toBe(400);
    expect(found.body.error).toBe('invalid');
  });
});

describe('a querystring number', () => {
  it('is accepted, because the validator does not coerce', async () => {
    // This route shipped with `Type.Integer()` on `limit` and answered
    // *must be integer* to its own documented parameter: a query string carries
    // text, and this app's validator has `coerceTypes: false` on purpose (F2).
    // The rule generalises to every route added after this one.
    await aTurnSaying('The cathedral was three streets east.');

    const found = await server.request({ method: 'GET', url: '/api/search?q=cathedral&limit=10' });
    expect(found.status).toBe(200);
    expect(found.body.turns).toHaveLength(1);
  });

  it('is refused when it is not a number at all', async () => {
    const found = await server.request({ method: 'GET', url: '/api/search?q=x&limit=lots' });
    expect(found.status).toBe(400);
  });

  it('clamps rather than trusting the caller about how much to return', async () => {
    const found = await server.request({ method: 'GET', url: '/api/search?q=x&limit=999' });
    expect(found.status).toBe(200);
  });
});
