// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { spokenEnvelope } from './test-envelope.js';

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
     * ***A new session id, and new turn ids — the old ones kept in `foreign`.***
     * ~~The same turn ids~~ was [P11.10]'s decision, on the ground that a
     * collision needed two installs importing each other's sessions. It needed
     * one: this test *is* the collision — an export imported back onto the
     * install that wrote it — and every structure keyed by a turn id alone (the
     * index, the rendition jobs, the notification dedupe) then held two
     * sessions' turns under one key.
     * [P13.0](../../../../docs/design/workplan/30-p13-aventuras-import.md)
     * re-mints them, and the ids the source used travel as `foreign.id`, which
     * is the identity [18 §3] asked the format to carry.
     */
    const landed = imported.body.sessionId as string;
    expect(landed).not.toBe(sessionId);

    const read = await server.request({ method: 'GET', url: `/api/sessions/${landed}/turns` });
    const back = read.body.turns as {
      id: string;
      sessionId: string;
      foreign?: { source: string; id: string };
    }[];
    expect(back.map((turn) => turn.foreign?.id)).toEqual(turns);
    expect(back.filter((turn) => turns.includes(turn.id))).toEqual([]);
    for (const turn of back) {
      expect(turn.foreign?.source).toBe(sessionId);
      // The turn says which session it is in — the field the index trusts.
      expect(turn.sessionId).toBe(landed);
    }
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
    const back = read.body.turns as {
      sessionId: string;
      foreign?: { source: string; id: string };
    }[];
    for (const turn of back) {
      expect(turn.foreign?.source).toBe(sessionId);
      // …and the *first* session's turn ids, not the ids the middle copy was
      // given — a turn that already carried `foreign` keeps it, and the new
      // session id is written all the same.
      expect(turn.sessionId).toBe(twice.body.sessionId);
    }
    const original = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns`,
    });
    expect(back.map((turn) => turn.foreign?.id)).toEqual(
      (original.body.turns as { id: string }[]).map((turn) => turn.id),
    );
  });
});

/**
 * ***An import onto the install it came from*** —
 * [P13.0](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The collision [P11.10]'s kept turn ids made certain, asserted where it shows:
 * **search, delete, and another account**. The turn routes cannot show it —
 * `readTurns` walks the segments, and `readTurnById` checks the id on the line
 * it read and falls back to the walk — so a test that only re-read a session
 * after importing its copy passed against the defect and would have passed
 * against the wrong fix.
 */
describe('a session imported onto the install it came from', () => {
  async function importDocument(document: unknown): Promise<string> {
    const imported = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: document,
    });
    expect(imported.status).toBe(201);
    return imported.body.sessionId as string;
  }

  async function exportOf(sessionId: string): Promise<unknown> {
    const exported = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });
    expect(exported.status).toBe(200);
    return exported.body;
  }

  /** The sessions a search for `word` lands in, each hit read back through its own session. */
  async function foundIn(word: string): Promise<string[]> {
    const found = await server.request({ method: 'GET', url: `/api/search?q=${word}` });
    expect(found.status).toBe(200);
    const hits = found.body.turns as { sessionId: string; turnId: string }[];
    for (const hit of hits) {
      const turn = await server.request({
        method: 'GET',
        url: `/api/sessions/${hit.sessionId}/turns/${hit.turnId}`,
      });
      expect(turn.status, `${hit.sessionId}/${hit.turnId}`).toBe(200);
      expect((turn.body.turn as { output: { text: string } }).output.text).toContain(word);
    }
    return [...new Set(hits.map((hit) => hit.sessionId))].sort();
  }

  it('is searchable once it lands', async () => {
    // The half that fails even across installs: the importer wrote
    // `session.json` and never the session's index row, and search joins it.
    const landed = await importDocument(spokenEnvelope('obelisk').document);
    expect(await foundIn('obelisk')).toEqual([landed]);
  });

  it('is searchable in both, the original and the copy', async () => {
    const original = await importDocument(spokenEnvelope('obelisk').document);
    const copy = await importDocument(await exportOf(original));

    expect(await foundIn('obelisk')).toEqual([original, copy].sort());
  });

  it('can lose either without the other dropping out of search', async () => {
    const original = await importDocument(spokenEnvelope('obelisk').document);
    const first = await importDocument(await exportOf(original));
    const second = await importDocument(await exportOf(original));

    // Deleting a session clears its index rows by session id — and a copy
    // whose rows were filed under the original's id took the original's rows
    // with it, or left its own behind.
    await server.request({ method: 'DELETE', url: `/api/sessions/${first}` });
    expect(await foundIn('obelisk')).toEqual([original, second].sort());

    await server.request({ method: 'DELETE', url: `/api/sessions/${original}` });
    expect(await foundIn('obelisk')).toEqual([second]);
  });

  it('does not change what another account can find', async () => {
    // One file, two accounts: the shape a household shares a story in. The
    // second import must not take the first account's turns out of its search.
    const { document } = spokenEnvelope('obelisk');
    const neds = await importDocument(document);

    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'mara', password: 'another long password' },
    });
    const maras = await importDocument(document);
    expect(await foundIn('obelisk')).toEqual([maras]);

    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ned', password: 'correct horse battery' },
    });
    expect(await foundIn('obelisk')).toEqual([neds]);
  });
});
