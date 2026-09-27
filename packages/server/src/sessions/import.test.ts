// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RENDITION_SCHEMA, type Rendition } from '@storyengine/shared';

import { digestOf } from '../library/assets.js';
import { sessionAssetsRoot, writeRendition } from '../renditions/store.js';
import { writeFileBytes } from '../storage/files.js';
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

/**
 * A rendition record as the worker would have left it, hung off `turnId`.
 *
 * The id is the worker's own spelling, `<turnId>.<n>`, because that is the
 * property the import leans on: turn ids are kept, so rendition ids are too.
 */
function aRendition(sessionId: string, turnId: string, over: Partial<Rendition> = {}): Rendition {
  return {
    schema: RENDITION_SCHEMA,
    id: `${turnId}.0`,
    sessionId,
    turnId,
    createdAt: '2026-09-27T10:00:00.000Z',
    kind: 'image',
    purpose: 'illustration',
    scope: null,
    state: 'ready',
    prompt: {
      fragments: [{ id: 'moment', text: 'a lantern', rank: 100, required: true }],
      separator: ', ',
      budget: { maxChars: null, usefulChars: null },
      text: 'a lantern',
      kept: ['moment'],
      dropped: [],
      overCap: false,
    },
    asset: null,
    provenance: {
      at: '2026-09-27T10:00:02.000Z',
      binding: { connectionId: 'c-1', modelId: 'sdxl' },
      answeredAs: null,
      seed: 7,
      workflow: { steps: 20 },
    },
    error: null,
    digest: 'd-1',
    ordering: 0,
    ...over,
  };
}

const PIXELS = new TextEncoder().encode('not really a png');

/**
 * ***The recipe travels*** — [21 §7.1](../../../../docs/design/21-internal-contracts.md)'s
 * *"the recipe travels and the pixels do not"*, and the half of it this importer
 * dropped until 2026-09-27: it counted the records it was handed, reported the
 * number, and wrote none of them.
 */
describe('renditions that travel', () => {
  async function withPictures(): Promise<{ sessionId: string; turns: string[] }> {
    const made = await branched();
    const [first, second, third] = made.turns as [string, string, string];
    const layout = server.services.sessions.layout;

    const ready = aRendition(made.sessionId, first, {
      asset: {
        path: `${first}.0.png`,
        mime: 'image/png',
        bytes: PIXELS.byteLength,
        digest: digestOf(PIXELS),
      },
    });
    await writeRendition(layout, 'ned', made.sessionId, ready);
    await writeFileBytes(
      join(sessionAssetsRoot(layout, 'ned', made.sessionId), `${first}.0.png`),
      PIXELS,
    );
    await writeRendition(
      layout,
      'ned',
      made.sessionId,
      aRendition(made.sessionId, second, {
        state: 'pending',
        provenance: { ...ready.provenance, at: null },
      }),
    );
    await writeRendition(
      layout,
      'ned',
      made.sessionId,
      aRendition(made.sessionId, third, { state: 'failed', error: 'terminal' }),
    );
    return made;
  }

  async function roundTrip(document: unknown): Promise<{ sessionId: string; renditions: number }> {
    const imported = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: document,
    });
    expect(imported.status).toBe(201);
    return {
      sessionId: imported.body.sessionId as string,
      renditions: imported.body.renditions as number,
    };
  }

  async function renditionsOf(sessionId: string): Promise<Rendition[]> {
    const read = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/renditions`,
    });
    return (read.body.renditions as Rendition[]).sort((a, b) => a.id.localeCompare(b.id));
  }

  it('writes every record it counts, under the new session and the same ids', async () => {
    const { sessionId, turns } = await withPictures();
    const exported = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });

    const landed = await roundTrip(exported.body);
    expect(landed.renditions).toBe(3);

    const back = await renditionsOf(landed.sessionId);
    expect(back.map((one) => one.id)).toEqual(turns.map((turn) => `${turn}.0`).sort());
    for (const one of back) {
      // The record's own session is what a live frame is matched on.
      expect(one.sessionId).toBe(landed.sessionId);
      expect(one.foreign).toEqual({ source: sessionId, id: one.id });
      // The recipe came; the pixels did not, which is what an export carries.
      expect(one.prompt.text).toBe('a lantern');
      expect(one.provenance.seed).toBe(7);
      expect(one.asset).toBeNull();
    }
  });

  /**
   * ***A picture still being made arrives as one that was interrupted.*** No
   * job will ever run it — the one that owned it belongs to the session it came
   * from — and a `pending` record has no retry button, so left alone it would
   * say *making a picture of this* for good.
   */
  it('turns a pending record into an interrupted one, and leaves the others be', async () => {
    const { sessionId, turns } = await withPictures();
    const exported = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });
    const landed = await roundTrip(exported.body);

    const byTurn = new Map((await renditionsOf(landed.sessionId)).map((one) => [one.turnId, one]));
    expect(byTurn.get(turns[0] ?? '')).toMatchObject({ state: 'ready', error: null });
    expect(byTurn.get(turns[1] ?? '')).toMatchObject({ state: 'failed', error: 'interrupted' });
    expect(byTurn.get(turns[2] ?? '')).toMatchObject({ state: 'failed', error: 'terminal' });
  });

  /**
   * ***What does not belong is skipped, and not counted.*** A record for a turn
   * that did not arrive is a picture of nothing; one that is not a record is a
   * hand edit; one whose id would climb out of the directory is a shape
   * somebody will eventually send on purpose. None of them fails the import,
   * and none of them inflates the number the import reports.
   */
  it('skips what is not a record of a turn that arrived', async () => {
    const { sessionId, turns } = await branched();
    const exported = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });
    const document = {
      ...exported.body,
      renditions: [
        aRendition(sessionId, turns[0] ?? ''),
        aRendition(sessionId, 'a-turn-that-never-came'),
        { schema: RENDITION_SCHEMA, id: 'half-a-record' },
        aRendition(sessionId, turns[1] ?? '', { id: '../../session' }),
      ],
    };

    const landed = await roundTrip(document);
    expect(landed.renditions).toBe(1);
    expect((await renditionsOf(landed.sessionId)).map((one) => one.id)).toEqual([
      `${turns[0] ?? ''}.0`,
    ]);
  });

  it('keeps the first install a record came from when it travels again', async () => {
    const { sessionId } = await withPictures();
    const first = await roundTrip(
      (await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/export` })).body,
    );
    const second = await roundTrip(
      (await server.request({ method: 'GET', url: `/api/sessions/${first.sessionId}/export` }))
        .body,
    );

    for (const one of await renditionsOf(second.sessionId)) {
      expect(one.foreign?.source).toBe(sessionId);
    }
  });
});

/**
 * ***A field this build does not know survives the round trip*** — the one
 * test [25 E15] said 1.0 owed, and [04 §2]'s rule that a newer file must
 * survive a round trip through an older reader.
 *
 * Nested inside `input` on purpose: `input` is where a newer build puts things
 * about the player's move — pictures were the first — and an importer that
 * rebuilt it field by field would drop the next one in silence. The assertion
 * is on the re-export, because an older install passing a session on is the
 * case where a loss would travel.
 */
describe('what a newer build wrote', () => {
  it('carries an unknown field inside a move through import and export unchanged', async () => {
    const { sessionId } = await branched();
    const exported = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });
    const body = exported.body as { turns: { input?: Record<string, unknown> }[] };
    const future = { kind: 'hologram', notes: ['from a build that does not exist yet'] };
    /**
     * *Every turn is given a move.* The fixture's turns are channel writes,
     * which carry none, and a move is where the field has to be: `input` is
     * the part of the record [25 E15] widens, and the part a newer build's
     * next widening will land in.
     */
    const move = { actorId: null, kind: 'do', text: 'Knock.', raw: 'Knock.' };
    body.turns = body.turns.map((turn) => ({
      ...turn,
      input: { ...(turn.input ?? move), future },
    }));

    const landed = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: body,
    });
    expect(landed.status).toBe(201);

    const again = await server.request({
      method: 'GET',
      url: `/api/sessions/${landed.body.sessionId as string}/export`,
    });
    const carried = (again.body as { turns: { input?: Record<string, unknown> }[] }).turns;
    expect(carried).toHaveLength(body.turns.length);
    for (const turn of carried) expect(turn.input?.['future']).toEqual(future);
  });
});
