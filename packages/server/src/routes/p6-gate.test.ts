// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeProvider } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The two exit-gate steps that only exist through a running server —
 * [P6 §3](../../../../docs/design/workplan/18-p6-implementation.md) steps 7 and
 * 8, [P6.3].
 *
 * **Step 7** is *search finds text on an abandoned branch, labelled as such*.
 * The claim is a composition: the index keeps every turn whether or not it is
 * on anybody's path, and the route answers *is this current* against the head
 * the reader is on. Under [P6.1]'s decision that is computed rather than
 * stored, because a turn is on every path that passes through it — so the label
 * is a fact about the question, and the only place it can be produced is here.
 *
 * **Step 8** is *kill the server, delete `index.sqlite`, restart → the tree,
 * refs and head all survive; only derived things were lost.* The data directory
 * is **borrowed** rather than minted, which is the whole mechanism: a
 * `makeTestServer` that made its own would remove it on dispose and there would
 * be nothing for the second process to rebuild from.
 */

const PASSWORD = 'correct horse battery';
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a06';

/** One distinctive word, so a hit can only have come from the turn that has it. */
const NEEDLE = 'obsidian';

let dataDir: string;
let server: TestServer;
let provider: FakeProvider;

async function start(): Promise<TestServer> {
  provider = new FakeProvider({ script: [{ text: 'The rain kept on.' }] });
  return makeTestServer({ dataDir, providers: () => provider });
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p6-gate-'));
  server = await start();
  await setUpAdmin(server, 'ned', PASSWORD);

  const connections = new Layout(dataDir).userConnectionsRoot('ned');
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
    join(dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );
});

afterEach(async () => {
  // Tolerated: a test that failed early left its server holding the sqlite
  // files, and on Windows that is an `EBUSY` during cleanup which would bury
  // the real failure under a second one naming a file nobody wrote.
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

async function signIn(): Promise<void> {
  const response = await server.request({
    method: 'POST',
    url: '/api/auth/login',
    payload: { handle: 'ned', password: PASSWORD },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

async function createSession(name = 'Rain City'): Promise<string> {
  const created = await server.request({ method: 'POST', url: '/api/sessions', payload: { name } });
  return created.body.session.id as string;
}

async function takeTurn(
  sessionId: string,
  key: string,
  headTurnId: string | null,
  text: string,
  branch?: { parentTurnId: string | null },
): Promise<string> {
  const accepted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: key, headTurnId, input: { text }, ...(branch ?? {}) },
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(202);
  await server.services.runner.settle();
  return accepted.body.turnId as string;
}

describe('step 7 — a hit on an abandoned line is labelled, never hidden', () => {
  it('finds it, says it is not current, and says where current is', async () => {
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    // The line that gets abandoned, carrying the only copy of the needle.
    const abandoned = await takeTurn(sessionId, 'k2', first, `She took the ${NEEDLE} knife.`);
    // A sibling of the first turn, which takes the head with it.
    const current = await takeTurn(sessionId, 'k3', first, 'She left it where it was.', {
      parentTurnId: first,
    });

    const found = await server.request({ method: 'GET', url: `/api/search?q=${NEEDLE}` });
    expect(found.status, JSON.stringify(found.body)).toBe(200);

    const hits = found.body.turns as {
      turnId: string;
      onPath: boolean;
      headTurnId: string | null;
    }[];
    const hit = hits.find((one) => one.turnId === abandoned);

    // **Never hidden**: the text is on the record and somebody wrote it.
    expect(hit).toBeDefined();
    // **Never passed off as current**: the label is the whole of step 7, and
    // the falsifying mutation is returning the hits unlabelled.
    expect(hit?.onPath).toBe(false);
    // And with the head it is not on, so a client can offer to go there.
    expect(hit?.headTurnId).toBe(current);
  });

  it('labels a hit on the line the head is on as current', async () => {
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, `She read the ${NEEDLE} letter.`);

    const found = await server.request({ method: 'GET', url: `/api/search?q=${NEEDLE}` });
    const hits = found.body.turns as { turnId: string; onPath: boolean }[];

    // The other half of the same claim: without this the label could be a
    // constant `false` and the test above would still pass.
    expect(hits.find((one) => one.turnId === first)?.onPath).toBe(true);
  });
});

describe('step 8 — deleting the index costs a rescan and nothing else', () => {
  it('keeps the tree, the refs and the head across a restart with no index', async () => {
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const onward = await takeTurn(sessionId, 'k2', first, 'She stepped out.');
    const sibling = await takeTurn(sessionId, 'k3', first, 'She stayed in.', {
      parentTurnId: first,
    });

    // A name on the line the head is not on, and a head parked deliberately.
    const named = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/refs`,
      payload: { name: 'The way out', turnId: onward },
    });
    expect(named.status).toBe(200);
    const refId = named.body.session.branchRefs[0].id as string;

    const moved = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/head`,
      payload: { turnId: sibling },
    });
    expect(moved.status).toBe(200);

    // Kill it, and take the derived database with it — all three files,
    // because both stores run in WAL mode and deleting the main file alone
    // leaves a log SQLite would happily recover from.
    await server.dispose();
    const index = join(dataDir, 'index', 'index.sqlite');
    for (const suffix of ['', '-wal', '-shm']) await rm(`${index}${suffix}`, { force: true });

    server = await start();
    await signIn();

    // The head, where it was parked.
    const session = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(session.status, JSON.stringify(session.body)).toBe(200);
    expect(session.body.session.headTurnId).toBe(sibling);

    // The ref, by id and by name — a name is fifty bytes in `session.json` and
    // nothing about it was ever in the index.
    expect(session.body.session.branchRefs).toEqual([
      { id: refId, name: 'The way out', headTurnId: onward },
    ]);

    // The tree: this line, and the other one still reachable by moving to it.
    const path = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect((path.body.turns as { id: string }[]).map((turn) => turn.id)).toEqual([first, sibling]);

    const back = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/head`,
      payload: { turnId: onward },
    });
    expect(back.status).toBe(200);
    const other = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect((other.body.turns as { id: string }[]).map((turn) => turn.id)).toEqual([first, onward]);

    // And the state at the node it just moved to, which is the thing a rescan
    // cannot fake: it is replayed from the effect log on disk.
    expect(back.body.session.channels['se.clock']).toBeDefined();
  });

  /**
   * ***And a head parked on a turn with one child*** (2026-09-27). The case
   * above parks the head on a leaf, which is the one place the start-up walk
   * over unlinked turns cannot move it, so it passed while every other parked
   * head went back to the tip at each restart: *Continue from here* along a
   * line, and an undo, both leave the head on a turn with one child.
   */
  it('keeps a head moved back along a line across a restart', async () => {
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const second = await takeTurn(sessionId, 'k2', first, 'She stepped out.');
    await takeTurn(sessionId, 'k3', second, 'She walked on.');

    const moved = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/head`,
      payload: { turnId: first },
    });
    expect(moved.status).toBe(200);

    await server.dispose();
    server = await start();
    await signIn();

    const session = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(session.body.session.headTurnId).toBe(first);
  });
});

describe('step 2 — swipes are siblings, and nothing is destroyed', () => {
  it('names every alternative, navigates among them, and promotes one without copying', async () => {
    // *Swipe a reply → a sibling; swipe again → a third; navigate among them;
    // the discarded ones still exist an hour later. Promote one to a named ref
    // — nothing copies.*
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const one = await takeTurn(sessionId, 'k2', first, 'She stepped out.');
    const two = await takeTurn(sessionId, 'k3', first, 'She stayed in.', {
      parentTurnId: first,
    });

    // **One swipe is already an alternative**, which is the count the rule is
    // about: the affordance appears where there is a choice, and two is the
    // smallest number of choices there can be. Asserted before the third
    // arrives, because a test that only ever looks at three would pass for a
    // threshold that hides the first swipe — which is the common case.
    const afterOne = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns`,
    });
    expect((afterOne.body.siblings as Record<string, string[]>)[two]).toEqual([one, two]);

    const three = await takeTurn(sessionId, 'k4', first, 'She looked back.', {
      parentTurnId: first,
    });

    // The transcript is the selected path, and the affordance is what makes the
    // other two reachable — **the falsifying mutation is reporting no
    // alternatives**, which leaves them on disk and unreachable, exactly the
    // state [18 §4.3] describes for an imported chat with swipes.
    const path = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect((path.body.turns as { id: string }[]).map((turn) => turn.id)).toEqual([first, three]);
    expect((path.body.siblings as Record<string, string[]>)[three]).toEqual([one, two, three]);
    // The fork point itself has no siblings, so it carries no affordance.
    expect((path.body.siblings as Record<string, string[]>)[first]).toBeUndefined();

    // Navigate among them: each is a head move, and each renders its own line.
    for (const sibling of [one, two, three]) {
      const moved = await server.request({
        method: 'PUT',
        url: `/api/sessions/${sessionId}/head`,
        payload: { turnId: sibling, resume: true },
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const view = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
      expect((view.body.turns as { id: string }[]).map((turn) => turn.id)).toEqual([
        first,
        sibling,
      ]);
    }

    // The discarded ones still exist — four turns on disk throughout, which is
    // the *nothing is destroyed* half.
    const before = await server.request({ method: 'GET', url: '/api/search?q=looked' });
    expect((before.body.turns as unknown[]).length).toBeGreaterThan(0);

    const named = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/refs`,
      payload: { name: 'The way out', turnId: one },
    });
    expect(named.status).toBe(200);
    expect(named.body.session.branchRefs[0].headTurnId).toBe(one);

    // **Nothing copies**: promoting wrote a name, and the head did not move to
    // the thing that was named.
    expect(named.body.session.headTurnId).toBe(three);
    const after = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    expect((after.body.turns as { id: string }[]).map((turn) => turn.id)).toEqual([first, three]);
  });
});
