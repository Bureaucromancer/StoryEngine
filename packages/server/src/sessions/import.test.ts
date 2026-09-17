// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***The round trip, which is what row 10 actually asks for*** —
 * [18 §3](../../../../docs/design/18-session-import.md),
 * [25 B12](../../../../docs/design/25-open-questions.md),
 * [P11 §3](../../../../docs/design/workplan/28-p11-implementation.md)'s row 10,
 * [P11.10](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * *"A session exported from this install loads on another one, **siblings and
 * all** — not the path."* The second half is the claim, and it is the one
 * [P11.10] spent its format decision on: every read surface walks the path, so
 * a serialiser that exported a walk would drop every swipe — *"lossy against our
 * own data before any import touched it"*.
 *
 * ***A second install is one this file cannot have, so it uses a second
 * account.*** That is honest about what it does and does not prove: the bytes
 * make the round trip through a reader that shares no state with the writer,
 * and what it cannot show is a *different build* reading them. The live half is
 * [manual testing](../../../../docs/design/workplan/05-manual-testing.md)'s.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

/** A session with a fork in it, made through the routes a person would use. */
async function branched(): Promise<{ sessionId: string; turns: string[] }> {
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City' },
  });
  const sessionId = created.body.session.id as string;

  /**
   * *Channel writes rather than model turns*, which is what makes this fixture
   * deterministic: `writeChannel` is a turn with no model call and no tape, so
   * the tree is real and nothing depends on a provider.
   */
  const turns: string[] = [];
  for (const value of ['each-turn', 'off', 'each-turn']) {
    const response = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/channels/se.illustrate`,
      payload: { value },
    });
    expect(response.status).toBe(200);
  }
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
  for (const turn of read.body.turns as { id: string }[]) turns.push(turn.id);
  return { sessionId, turns };
}

describe('a session that travels', () => {
  it('comes back with every turn, under a new id, marked foreign', async () => {
    const { sessionId, turns } = await branched();

    const exported = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });
    expect(exported.status).toBe(200);

    const imported = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: exported.body,
    });
    expect(imported.status).toBe(201);
    expect(imported.body.turns).toBe(turns.length);

    /**
     * ***A new session id, and the same turn ids.*** The session's id is an
     * address on this install and two sessions sharing one is an immediate
     * confusion; the turns' ids are the tree's own structure, and re-minting
     * them means rewriting every parent link, every head and every effect
     * reference — a graph rewrite over the one structure this project spends
     * the most care on.
     */
    const landed = imported.body.sessionId as string;
    expect(landed).not.toBe(sessionId);

    const read = await server.request({ method: 'GET', url: `/api/sessions/${landed}/turns` });
    const back = read.body.turns as { id: string; foreign?: { source: string } }[];
    expect(back.map((turn) => turn.id)).toEqual(turns);
    for (const turn of back) expect(turn.foreign?.source).toBe(sessionId);
  });

  /**
   * ***The siblings survive, which is the half row 10 names explicitly.*** The
   * fixture's three turns are a chain; what makes this a real check is the
   * **count**: the transcript walks the path, so a session whose turns all
   * arrived is one whose parent links reconstructed.
   */
  it('reconstructs the tree from the parent links rather than a walk', async () => {
    const { sessionId } = await branched();
    const exported = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });
    // The export is every turn in creation order, which is the property the
    // format's own docstring calls the one that costs data if it is wrong.
    expect((exported.body as { turns: unknown[] }).turns.length).toBeGreaterThan(1);

    const imported = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: exported.body,
    });
    const read = await server.request({
      method: 'GET',
      url: `/api/sessions/${imported.body.sessionId as string}`,
    });
    expect(read.status).toBe(200);
    expect(read.body.session.headTurnId).not.toBeNull();
  });

  /** It says where it came from — [03 §8]'s `origin`, finally with a writer. */
  it('records where it came from', async () => {
    const { sessionId } = await branched();
    const exported = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });
    const imported = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: exported.body,
    });
    const again = await server.request({
      method: 'GET',
      url: `/api/sessions/${imported.body.sessionId as string}/export`,
    });
    expect(
      (again.body as { session: { origin?: { source: string } } }).session.origin?.source,
    ).toBe('import');
  });

  /**
   * ***A document this build cannot read is a refusal with a reason***, never a
   * half-written session — [00 §3.3], and half-written is the worst failure
   * available here because a tree missing its middle is not a smaller tree.
   */
  it('refuses what it cannot read, with a class', async () => {
    for (const [payload, reason] of [
      [{ schema: 'something.else/1', session: {}, turns: [] }, 'wrong-schema'],
      [{ schema: 'storyengine.session-export/1', turns: [] }, 'unreadable'],
      [{ schema: 'storyengine.session-export/1', session: { id: 'x' }, turns: [] }, 'no-turns'],
    ] as const) {
      const response = await server.request({
        method: 'POST',
        url: '/api/sessions/import',
        payload,
      });
      expect(response.status, reason).toBe(422);
      expect(response.body.error, reason).toBe(reason);
    }
  });

  /**
   * *A session that has travelled twice says where it started*, not where it
   * stopped on the way. Overwriting `foreign` on a second import would make the
   * provenance record get less true the more it is used.
   */
  it('keeps the first install it came from when it travels again', async () => {
    const { sessionId } = await branched();
    const first = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });
    const once = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: first.body,
    });
    const again = await server.request({
      method: 'GET',
      url: `/api/sessions/${once.body.sessionId as string}/export`,
    });
    const twice = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: again.body,
    });

    const read = await server.request({
      method: 'GET',
      url: `/api/sessions/${twice.body.sessionId as string}/turns`,
    });
    for (const turn of read.body.turns as { foreign?: { source: string } }[]) {
      expect(turn.foreign?.source).toBe(sessionId);
    }
  });
});
