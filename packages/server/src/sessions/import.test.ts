// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  newActor,
  outputFromMessages,
  RENDITION_SCHEMA,
  uuidv7,
  type OutputMessage,
  type Rendition,
  type SessionExport,
} from '@storyengine/shared';

import { rebuild } from '../index-db/rebuild.js';
import { sessionByOrigin, sessionSnapshot } from '../index-db/sessions.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { importSession, type ImportContext } from './import.js';
import { producedTurnId } from './producer.js';
import {
  appendTurnToSession,
  createSession,
  readSession,
  readTurns,
  sessionFilePath,
} from './store.js';
import type { Turn } from './types.js';

/**
 * ***The round trip, which is what row 10 actually asks for*** —
 * [19 §3](../../../../docs/design/19-session-import.md),
 * [26 B12](../../../../docs/design/26-open-questions.md),
 * [P11 §3](../../../../docs/design/workplan/28-p11-implementation.md)'s row 10,
 * [P11.10](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * *"A session exported from this install loads on another one, **siblings and
 * all** — not the path."* The second half is the claim, and it is the one
 * [P11.10] spent its format decision on: every read surface walks the path, so
 * a serialiser that exported a walk would drop every swipe — *"lossy against our
 * own data before any import touched it"*.
 *
 * ***A second install is a second test server***, with its own data directory
 * and its own index (corrected 2026-09-27). These tests used to import into the
 * install that exported, which is the one case the format's kept turn ids
 * cannot survive: the copy took the original's index rows. What this cannot
 * show is a *different build* reading the bytes. The live half is
 * [manual testing](../../../../docs/design/workplan/05-manual-testing.md)'s.
 */

let server: TestServer;
/** Every other install a test made, so each is disposed with it. */
const others: TestServer[] = [];

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
  for (const other of others.splice(0)) await other.dispose();
});

async function anotherInstall(): Promise<TestServer> {
  const other = await makeTestServer();
  await setUpAdmin(other, 'ned');
  others.push(other);
  return other;
}

/** A session holding one turn that says something, so search has words to find. */
async function aSessionSaying(said: string): Promise<{ sessionId: string; turnId: string }> {
  const session = await createSession(server.services.sessions, 'ned', 'Rain City');
  const turn: Turn = {
    id: uuidv7(),
    sessionId: session.id,
    parentTurnId: null,
    createdAt: new Date(Date.UTC(2026, 8, 27, 12)).toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'say', text: 'And then?', raw: '' },
    output: { text: said },
    effects: [],
    tape: [],
  };
  await appendTurnToSession(server.services.sessions, 'ned', session.id, turn);
  return { sessionId: session.id, turnId: turn.id };
}

async function exported(from: TestServer, sessionId: string): Promise<Record<string, unknown>> {
  const response = await from.request({ method: 'GET', url: `/api/sessions/${sessionId}/export` });
  expect(response.status).toBe(200);
  return response.body as Record<string, unknown>;
}

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
    const there = await anotherInstall();

    const imported = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: await exported(server, sessionId),
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

    const read = await there.request({ method: 'GET', url: `/api/sessions/${landed}/turns` });
    const back = read.body.turns as {
      id: string;
      sessionId: string;
      foreign?: { source: string };
    }[];
    expect(back.map((turn) => turn.id)).toEqual(turns);
    for (const turn of back) {
      expect(turn.foreign?.source).toBe(sessionId);
      // The session it is in now; where it came from is `foreign.source`.
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
    const document = await exported(server, sessionId);
    // The export is every turn in creation order, which is the property the
    // format's own docstring calls the one that costs data if it is wrong.
    expect((document as { turns: unknown[] }).turns.length).toBeGreaterThan(1);

    const there = await anotherInstall();
    const imported = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: document,
    });
    const read = await there.request({
      method: 'GET',
      url: `/api/sessions/${imported.body.sessionId as string}`,
    });
    expect(read.status).toBe(200);
    expect(read.body.session.headTurnId).not.toBeNull();
  });

  /** It says where it came from — [03 §8]'s `origin`, finally with a writer. */
  it('records where it came from', async () => {
    const { sessionId } = await branched();
    const there = await anotherInstall();
    const imported = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: await exported(server, sessionId),
    });
    const again = await there.request({
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
    const second = await anotherInstall();
    const once = await second.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: await exported(server, sessionId),
    });
    const third = await anotherInstall();
    const twice = await third.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: await exported(second, once.body.sessionId as string),
    });

    const read = await third.request({
      method: 'GET',
      url: `/api/sessions/${twice.body.sessionId as string}/turns`,
    });
    for (const turn of read.body.turns as { foreign?: { source: string } }[]) {
      expect(turn.foreign?.source).toBe(sessionId);
    }
  });
});

/**
 * ***What an import leaves in the index and beside the turns*** (2026-09-27).
 *
 * The import wrote `session.json` and the turns and stopped. The turns kept
 * the session id they were exported under, the session had no index row, and
 * the pictures' records were counted and never written. Search found nothing
 * of an imported story; a copy imported where its original still was took the
 * original's rows.
 */
describe('an imported session is a session here', () => {
  it('can be searched, under the session it landed in', async () => {
    const { sessionId } = await aSessionSaying('The cathedral was three streets east.');
    const there = await anotherInstall();

    const imported = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: await exported(server, sessionId),
    });
    expect(imported.status).toBe(201);

    const found = await there.request({ method: 'GET', url: '/api/search?q=cathedral' });
    expect(found.status).toBe(200);
    expect(found.body.turns.map((hit: { sessionId: string }) => hit.sessionId)).toEqual([
      imported.body.sessionId,
    ]);
  });

  /**
   * ***The same install, and the refusal is the fix.*** The turn ids are kept,
   * so a second session holding them would take the first one's rows; before
   * this the copy was made, and the original's search hits went to the copy.
   */
  it('refuses a session whose turns are already here, and the original keeps its rows', async () => {
    const { sessionId } = await aSessionSaying('The cathedral was three streets east.');

    const again = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: await exported(server, sessionId),
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already-here');

    const found = await server.request({ method: 'GET', url: '/api/search?q=cathedral' });
    expect(found.body.turns.map((hit: { sessionId: string }) => hit.sessionId)).toEqual([
      sessionId,
    ]);
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect((listed.body.sessions as unknown[]).length).toBe(1);
  });

  /**
   * ***The recipes come across; the pixels cannot.*** An export carries the
   * records and not the pictures (`SessionExport.renditions`), so a ready one
   * lands as one whose pixels were cleared — the recipe and a retry — and a
   * pending one as interrupted, which offers the retry a pending one never
   * will. A record of a turn that did not come, and one that is not a record,
   * are left out.
   */
  it('writes the pictures’ records under the new session', async () => {
    const { sessionId, turnId } = await aSessionSaying('The cathedral was three streets east.');
    const document = await exported(server, sessionId);
    document['renditions'] = [
      aRendition({ id: `${turnId}.0`, sessionId, turnId }),
      aRendition({ id: `${turnId}.1`, sessionId, turnId, state: 'pending', asset: null }),
      aRendition({ id: 'elsewhere.0', sessionId, turnId: 'elsewhere' }),
      { ...aRendition({ id: `${turnId}.2`, sessionId, turnId }), digest: undefined },
    ];

    const there = await anotherInstall();
    const imported = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: document,
    });
    expect(imported.status).toBe(201);
    expect(imported.body.renditions).toBe(2);

    const landed = imported.body.sessionId as string;
    const listed = await there.request({
      method: 'GET',
      url: `/api/sessions/${landed}/renditions`,
    });
    expect(listed.status).toBe(200);
    const records = (listed.body.renditions as Rendition[]).toSorted((left, right) =>
      left.id.localeCompare(right.id),
    );
    expect(records.map((record) => [record.id, record.sessionId])).toEqual([
      [`${turnId}.0`, landed],
      [`${turnId}.1`, landed],
    ]);
    expect(records[0]).toMatchObject({ state: 'ready', asset: null });
    expect(records[1]).toMatchObject({ state: 'failed', error: 'interrupted', asset: null });
    // The recipe, which is the part that must never be lost.
    expect(records[0]?.prompt.text).toBe('a lantern');
    // Marked foreign once, as its turn is.
    expect(records[0]?.foreign).toEqual({ source: sessionId, id: `${turnId}.0` });
  });
});

/**
 * ***A field this build does not know survives the round trip*** — the one
 * test [26 E15] said 1.0 owed, and [04 §2]'s rule that a newer file must
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
    const document = await exported(server, sessionId);
    const future = { kind: 'hologram', notes: ['from a build that does not exist yet'] };
    /**
     * *Every turn is given a move.* The fixture's turns are channel writes,
     * which carry none, and a move is where the field has to be: `input` is
     * the part of the record [26 E15] widens, and the part a newer build's
     * next widening will land in.
     */
    const move = { actorId: null, kind: 'do', text: 'Knock.', raw: 'Knock.' };
    const turns = (document['turns'] as { input?: Record<string, unknown> }[]).map((turn) => ({
      ...turn,
      input: { ...(turn.input ?? move), future },
    }));

    const there = await anotherInstall();
    const landed = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: { ...document, turns },
    });
    expect(landed.status).toBe(201);

    const again = await exported(there, landed.body.sessionId as string);
    const carried = again['turns'] as { input?: Record<string, unknown> }[];
    expect(carried).toHaveLength(turns.length);
    for (const turn of carried) expect(turn.input?.['future']).toEqual(future);
  });
});

/**
 * ***A chat, and everything [P14.0] added to the record, from one install to
 * another*** —
 * [P14 §1.1](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P14 §1.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * and P14.0's own *Ends at*: *"a turn with three attributed messages and a
 * hidden index exports and imports unchanged."*
 *
 * **Unchanged by `importSession`'s own rules**, which are the only changes an
 * import makes: a new session id, each turn naming the session it is in now,
 * and provenance on both. Everything else — the messages with their speakers,
 * the carried mark and a cleaned message's `original`, the hide map keyed by a
 * turn id the import keeps, the speaker policy, the card switches and the
 * author's note — is asserted equal on the *re-export* from the second install,
 * because an install passing the session on is where a loss would travel.
 */
describe('a chat that travels', () => {
  it('keeps three attributed messages and every chat setting, hidden index included', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain City' },
    });
    const sessionId = created.body.session.id as string;

    const messages: OutputMessage[] = [
      { speaker: null, text: 'Rain on the tin roof.', original: 'Narrator: Rain on the tin roof.' },
      { speaker: { id: 'actor-marlow', name: 'Marlow' }, text: '"You came."', carried: true },
      {
        speaker: { id: 'actor-elena', name: 'Elena' },
        text: '"I said I would."',
        reasoning: 'She is tired.',
      },
    ];
    const turnId = uuidv7();
    await appendTurnToSession(server.services.sessions, 'ned', sessionId, {
      id: turnId,
      sessionId,
      parentTurnId: null,
      createdAt: new Date(Date.UTC(2026, 8, 29, 12)).toISOString(),
      status: 'complete',
      input: { actorId: null, kind: 'do', text: 'Knock.', raw: 'Knock.' },
      output: outputFromMessages(messages),
      effects: [],
      tape: [],
    });

    /**
     * *Written into the file*, as a hand edit or the settings panel would: the
     * routes that set these arrive with the stages that give them behaviour
     * ([P14.4]'s hide routes, [P14.5]'s panel), and what this proves is the
     * record, not a route.
     */
    const settings = {
      speakers: {
        policy: 'list' as const,
        allowSelfResponses: true,
        namesInHistory: 'always' as const,
        maxPerRound: 2,
      },
      note: { text: 'Keep it tense.', depth: 4, every: 2 },
      hidden: { [turnId]: [1] },
      prompts: {
        instruction: false as const,
        cards: { 'actor-marlow': false as const, 'actor-elena': ['system' as const] },
      },
    };
    const file = await readSession(server.services.sessions, 'ned', sessionId);
    if (file === null) throw new Error('the session was not written');
    await writeJsonAtomic(sessionFilePath(server.services.sessions.layout, 'ned', sessionId), {
      ...file,
      ...settings,
    });

    const there = await anotherInstall();
    const imported = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: await exported(server, sessionId),
    });
    expect(imported.status).toBe(201);
    const landed = imported.body.sessionId as string;

    const again = await exported(there, landed);
    const session = again['session'] as Record<string, unknown>;
    // Creation wrote these two, and they came across beside what was set by hand.
    expect(session['voice']).toBe(file.voice);
    expect(session['dispatch']).toBe(file.dispatch);
    for (const [field, value] of Object.entries(settings)) {
      expect(session[field], field).toEqual(value);
    }

    const [carried] = again['turns'] as Turn[];
    expect(carried?.id).toBe(turnId);
    expect(carried?.sessionId).toBe(landed);
    expect(carried?.output).toEqual({
      text: 'Rain on the tin roof.\n\n"You came."\n\n"I said I would."',
      reasoning: 'She is tired.',
      messages,
    });
  });
});

function aRendition(over: Partial<Rendition> = {}): Rendition {
  return {
    schema: RENDITION_SCHEMA,
    id: 'r-1',
    sessionId: 's-1',
    turnId: 't-1',
    createdAt: '2026-09-16T10:00:00.000Z',
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
    asset: { path: 'r-1.png', mime: 'image/png', bytes: 11, digest: 'sha256:aa' },
    provenance: {
      at: '2026-09-16T10:00:02.000Z',
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

/**
 * ***A picture is served from its own session's `assets/` and nowhere else***
 * (2026-09-27). The asset route joined the record's `path` on, and the only
 * other check asks whether a path stays inside the data directory, so a record
 * saying `../session.json` was served that file, and one reaching further up
 * would have served another account's. The importer checks the records it
 * writes; this is the door that does not depend on it.
 */
describe('a picture’s path', () => {
  it('cannot leave its session’s assets', async () => {
    const { writeRendition } = await import('../renditions/store.js');
    const { sessionId, turnId } = await aSessionSaying('The cathedral was three streets east.');
    await writeRendition(
      server.services.sessions.layout,
      'ned',
      sessionId,
      aRendition({
        id: `${turnId}.0`,
        sessionId,
        turnId,
        asset: { path: '../session.json', mime: 'application/json', bytes: 1, digest: 'sha256:aa' },
      }),
    );

    const served = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/renditions/${encodeURIComponent(`${turnId}.0`)}/asset`,
    });
    expect(served.status).toBe(404);
  });
});

/**
 * ***What the reader checks now that somebody else writes its input*** —
 * [P13.10](../../../../docs/design/workplan/30-p13-aventuras-import.md)
 * (2026-09-29). Our own exports never showed any of these, because the
 * exporter and the reader were written against the same records; a producer
 * is a second writer, and these are the ways it can be wrong.
 */
describe('a document somebody else wrote', () => {
  /** A turn with nothing in it but its place in the tree. */
  function bare(id: string, parentTurnId: string | null, over: Partial<Turn> = {}): Turn {
    return {
      id,
      sessionId: 'elsewhere',
      parentTurnId,
      createdAt: '2026-09-29T12:00:00.000Z',
      status: 'complete',
      effects: [],
      tape: [],
      ...over,
    };
  }

  function documentOf(
    turns: unknown[],
    session: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      schema: 'storyengine.session-export/1',
      exportedBy: { version: null, at: '2026-09-29T12:00:00.000Z' },
      session: {
        id: 'elsewhere',
        name: 'Somewhere else',
        createdAt: '2026-09-29T12:00:00.000Z',
        updatedAt: '2026-09-29T12:00:00.000Z',
        headTurnId: null,
        channels: {},
        ...session,
      },
      turns,
      renditions: [],
    };
  }

  const context = (): ImportContext => ({ sessions: server.services.sessions });

  /**
   * ***Out of order is put in order, not refused*** — the one departure from
   * the stage's wording, argued at `treeOf`: our own exporter sorts by id, and
   * an id minted on a slower clock sorts before its parent. What is appended
   * is parents first, so a forward walk never meets a dangling parent.
   */
  it('appends a child listed before its parent after it', async () => {
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()];
    const result = await importSession(
      context(),
      'ned',
      documentOf([bare(c, b), bare(b, a), bare(a, null)], { headTurnId: c }),
    );
    expect(result).toMatchObject({ ok: true, turns: 3 });
    if (!result.ok) return;

    const read = await readTurns(server.services.sessions, 'ned', result.sessionId);
    expect([...read.keys()]).toEqual([a, b, c]);
    const session = await server.request({
      method: 'GET',
      url: `/api/sessions/${result.sessionId}/turns`,
    });
    expect((session.body.turns as { id: string }[]).map((turn) => turn.id)).toEqual([a, b, c]);
  });

  /**
   * ***What no order can mend is refused, and nothing is written.*** A parent
   * the file does not hold is the tree missing its middle; a cycle has no
   * order; a head naming no turn leaves the session pointing at nothing.
   */
  it('refuses a tree it cannot build, before writing anything', async () => {
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()];
    for (const [label, document] of [
      ['a parent not in the file', documentOf([bare(a, null), bare(b, c)])],
      ['a cycle', documentOf([bare(a, null), bare(b, c), bare(c, b)])],
      ['a turn its own parent', documentOf([bare(a, null), bare(b, b)])],
      ['a head not in the file', documentOf([bare(a, null)], { headTurnId: c })],
      [
        'a parent that is not an id',
        documentOf([bare(a, null), { ...bare(b, a), parentTurnId: 7 }]),
      ],
    ] as const) {
      const result = await importSession(context(), 'ned', document);
      expect(result, label).toEqual({ ok: false, reason: 'broken-tree' });
    }
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect(listed.body.sessions).toEqual([]);
  });

  it('answers a broken tree through the route as a class', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: documentOf([bare(uuidv7(), uuidv7())]),
    });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe('broken-tree');
  });

  /**
   * *A repeated id is one turn, the last line of it* — what the segment reader
   * shows for a segment that holds a turn twice, which a re-run append makes
   * and a backup carries as it is.
   */
  it('keeps the last copy of a turn listed twice', async () => {
    const a = uuidv7();
    const result = await importSession(
      context(),
      'ned',
      documentOf([
        bare(a, null, { output: { text: 'first' } }),
        bare(a, null, { output: { text: 'second' } }),
      ]),
    );
    expect(result).toMatchObject({ ok: true, turns: 1 });
    if (!result.ok) return;
    const read = await readTurns(server.services.sessions, 'ned', result.sessionId);
    expect(read.get(a)?.output?.text).toBe('second');
  });

  /**
   * ***Links are reported, and refused only when a producer asks.*** An export
   * from another install names that install's cast, and play already survives
   * a link that resolves to nothing — so row 10's round trip still loads, and
   * says what did not come. A producer wrote the objects it links to, so for
   * it a missing one is its own defect.
   */
  it('reports the links that resolve to nothing here', async () => {
    const vera = newActor('Vera');
    await server.request({ method: 'POST', url: '/api/library/actors', payload: vera });
    const [ghost, book, treatment] = [uuidv7(), uuidv7(), uuidv7()];

    const response = await server.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: documentOf([bare(uuidv7(), null)], {
        cast: { persona: vera.id, actors: [vera.id, ghost, ghost] },
        lore: [book, vera.id],
        treatment,
      }),
    });
    expect(response.status).toBe(201);
    // An actor named as a lorebook is a link of the wrong kind, which play
    // misses exactly as it misses one that is not there.
    expect(response.body.missing).toEqual({
      cast: [ghost],
      lore: [book, vera.id],
      treatment: [treatment],
    });

    // Kept, not dropped: the objects may yet arrive, by package, under the
    // ids the session names.
    const read = await server.request({
      method: 'GET',
      url: `/api/sessions/${response.body.sessionId as string}`,
    });
    expect(read.body.session.cast.actors).toEqual([vera.id, ghost, ghost]);
  });

  it('refuses them instead when asked, and writes nothing', async () => {
    const ghost = uuidv7();
    const result = await importSession(
      context(),
      'ned',
      documentOf([bare(uuidv7(), null)], { cast: { persona: null, actors: [ghost] } }),
      { requireLinks: true },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'missing-links',
      missing: { cast: [ghost], lore: [], treatment: [] },
    });
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect(listed.body.sessions).toEqual([]);
  });

  /**
   * ***Another account's object is not a link this account can follow***,
   * which is `library.read`'s rule and so play's.
   */
  it('counts another account’s object as missing', async () => {
    const vera = newActor('Vera');
    await server.request({ method: 'POST', url: '/api/library/actors', payload: vera });
    const result = await importSession(
      context(),
      'amy',
      documentOf([bare(uuidv7(), null)], { cast: { persona: null, actors: [vera.id] } }),
    );
    expect(result).toMatchObject({ ok: true, missing: { cast: [vera.id] } });
  });
});

/**
 * ***A key to be found by again*** — [P13.10]'s `origin.originalFilename`,
 * [P13 §1.5]'s *identity is the row*, applied to a session.
 */
describe('a session a producer made', () => {
  const KEY = 'aventura.db/stories/0b5c1f36-story';

  function oneTurn(): Record<string, unknown> {
    const id = uuidv7();
    return {
      schema: 'storyengine.session-export/1',
      exportedBy: { version: null, at: '2026-09-29T12:00:00.000Z' },
      session: {
        id: 'story',
        name: 'The Salt Road',
        createdAt: '2026-09-29T12:00:00.000Z',
        updatedAt: '2026-09-29T12:00:00.000Z',
        headTurnId: id,
        channels: {},
      },
      turns: [
        {
          id,
          sessionId: 'story',
          parentTurnId: null,
          createdAt: '2026-09-29T12:00:00.000Z',
          status: 'complete',
          effects: [],
          tape: [],
        },
      ],
      renditions: [],
    };
  }

  const context = (): ImportContext => ({ sessions: server.services.sessions });

  it('carries its key, and a second import of the source is refused naming the first', async () => {
    const first = await importSession(context(), 'ned', oneTurn(), { originalFilename: KEY });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const stored = await readSession(server.services.sessions, 'ned', first.sessionId);
    expect(stored?.origin).toMatchObject({ source: 'import', originalFilename: KEY });

    /**
     * *Fresh turn ids*, so the turn check cannot be what refuses it: this is
     * a producer whose derivation changed between versions, and the key is
     * the half that still holds.
     */
    const second = await importSession(context(), 'ned', oneTurn(), { originalFilename: KEY });
    expect(second).toEqual({
      ok: false,
      reason: 'already-here',
      prior: { sessionId: first.sessionId, name: 'The Salt Road' },
    });
  });

  /** Per account, as the library's rule is — and nothing about ned is said to amy. */
  it('is another account’s to import as well', async () => {
    await importSession(context(), 'ned', oneTurn(), { originalFilename: KEY });
    const theirs = await importSession(context(), 'amy', oneTurn(), { originalFilename: KEY });
    expect(theirs.ok).toBe(true);
  });

  /**
   * ***Derived, so a rebuild writes it back*** — the column is a restatement
   * of `session.json`, and an index deleted and rebuilt must still refuse.
   */
  it('is found again after the index is rebuilt', async () => {
    const first = await importSession(context(), 'ned', oneTurn(), { originalFilename: KEY });
    const { index, layout } = server.services.sessions;
    const before = sessionSnapshot(index);
    await rebuild(index, layout);
    expect(sessionSnapshot(index)).toEqual(before);
    expect(sessionByOrigin(index, 'user:ned', KEY)).toMatchObject({
      sessionId: first.ok ? first.sessionId : null,
    });
  });

  /**
   * ***It travels with the session*** — the exporter writes `origin` as it is
   * on disk, so the key goes where the session goes, and the reader keeps it
   * as it keeps `foreign`: an export of a produced session, loaded on another
   * install, is still that source row's story there.
   */
  it('keeps the key an export carries', async () => {
    const first = await importSession(context(), 'ned', oneTurn(), { originalFilename: KEY });
    if (!first.ok) throw new Error('import failed');
    const there = await anotherInstall();
    const landed = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: await exported(server, first.sessionId),
    });
    expect(landed.status).toBe(201);
    const again = await exported(there, landed.body.sessionId as string);
    expect((again['session'] as { origin?: unknown }).origin).toMatchObject({
      source: 'import',
      originalFilename: KEY,
    });

    const twice = await importSession({ sessions: there.services.sessions }, 'ned', oneTurn(), {
      originalFilename: KEY,
    });
    expect(twice).toMatchObject({ ok: false, reason: 'already-here' });
  });

  /** A session made here has no key, and an export of one gives none. */
  it('gives a session with no source no key', async () => {
    const { sessionId } = await aSessionSaying('The cathedral was three streets east.');
    const there = await anotherInstall();
    const landed = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: await exported(server, sessionId),
    });
    const again = await exported(there, landed.body.sessionId as string);
    expect((again['session'] as { origin?: { originalFilename?: unknown } }).origin).toMatchObject({
      originalFilename: null,
    });
  });
});

/**
 * ***The consequence of `already-here` for a producer***, shown with one —
 * [P13.10]'s last sentence, and `producer.ts`'s header.
 *
 * A toy source, shaped like the rows P13.11 will read — entries with their own
 * ids and times, an action and its answer paired into a turn — and a producer
 * in a dozen lines that turns it into the format. Not a converter: it is here
 * to show what the id a producer chooses does to a second import.
 */
describe('a producer, importing one story twice', () => {
  interface Entry {
    id: string;
    at: number;
    action: string;
    answer: string;
  }
  const STORY = {
    id: 'c7d2-story',
    title: 'The Salt Road',
    entries: [
      { id: 'e-1', at: Date.UTC(2026, 4, 1, 9), action: 'Walk north.', answer: 'Salt flats.' },
      { id: 'e-2', at: Date.UTC(2026, 4, 1, 10), action: 'Rest.', answer: 'Night falls.' },
    ] satisfies Entry[],
  };

  function produce(idOf: (entry: Entry, origin: string) => string): {
    document: SessionExport;
    origin: string;
  } {
    const origin = `aventura.db/stories/${STORY.id}`;
    let parent: string | null = null;
    const turns: Turn[] = [];
    for (const entry of STORY.entries) {
      const id = idOf(entry, origin);
      turns.push({
        id,
        sessionId: STORY.id,
        parentTurnId: parent,
        createdAt: new Date(entry.at).toISOString(),
        status: 'complete',
        input: { actorId: null, kind: 'do', text: entry.action, raw: entry.action },
        output: { text: entry.answer },
        effects: [],
        tape: [],
        foreign: { source: 'aventuras', id: entry.id },
      });
      parent = id;
    }
    return {
      origin,
      document: {
        schema: 'storyengine.session-export/1',
        exportedBy: { version: null, at: new Date(0).toISOString() },
        session: {
          id: STORY.id,
          name: STORY.title,
          createdAt: new Date(STORY.entries[0]?.at ?? 0).toISOString(),
          updatedAt: new Date(STORY.entries[1]?.at ?? 0).toISOString(),
          headTurnId: parent,
        },
        turns,
        renditions: [],
      },
    };
  }

  const derived = (handle: string) => (entry: Entry, origin: string) =>
    producedTurnId({ handle, origin, sourceId: entry.id, at: entry.at });
  const context = (): ImportContext => ({ sessions: server.services.sessions });

  it('is refused the second time when its turn ids are derived from the source', async () => {
    const once = produce(derived('ned'));
    const twice = produce(derived('ned'));
    // The same story, the same ids: the whole of the property.
    expect(twice.document.turns.map((turn) => turn.id)).toEqual(
      once.document.turns.map((turn) => turn.id),
    );

    // Without the key, so it is the turn ids alone that refuse.
    expect((await importSession(context(), 'ned', once.document)).ok).toBe(true);
    expect(await importSession(context(), 'ned', twice.document)).toEqual({
      ok: false,
      reason: 'already-here',
    });
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect((listed.body.sessions as unknown[]).length).toBe(1);
  });

  /**
   * ***And a copy, every time, when they are minted*** — which is why the
   * producer derives them, and why it passes its key as well.
   */
  it('makes a copy when its turn ids are minted fresh, unless it passes its key', async () => {
    const minted = () => uuidv7();
    expect((await importSession(context(), 'ned', produce(minted).document)).ok).toBe(true);
    expect((await importSession(context(), 'ned', produce(minted).document)).ok).toBe(true);
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect((listed.body.sessions as unknown[]).length).toBe(2);

    const keyed = produce(minted);
    const options = { originalFilename: keyed.origin };
    expect((await importSession(context(), 'ned', keyed.document, options)).ok).toBe(true);
    expect(await importSession(context(), 'ned', produce(minted).document, options)).toMatchObject({
      ok: false,
      reason: 'already-here',
    });
  });

  /**
   * *The handle is in the derivation*, so two accounts on one install can each
   * import the same database — a turn id is one row on the install, and
   * without it the second person would be refused for the first one's turns.
   */
  it('lets a second account import the same story', async () => {
    const ned = produce(derived('ned'));
    const amy = produce(derived('amy'));
    expect((await importSession(context(), 'ned', ned.document)).ok).toBe(true);
    expect((await importSession(context(), 'amy', amy.document)).ok).toBe(true);
  });
});
