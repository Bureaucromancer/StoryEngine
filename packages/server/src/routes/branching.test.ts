// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeProvider } from '../providers/fake.js';
import { readClock } from '../sessions/channels.js';
import { walkPath } from '../sessions/segments.js';
import { readSession, readTurns, replayChannels } from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * Branching through the route — [P6.0c], and [08 §1.7]'s stale-head decision.
 *
 * **The decision, so a reader does not have to reconstruct it from the code:**
 * a submission names the node it attaches to, and naming one that is not the
 * head has to be deliberate. `parentTurnId` absent is every submission P2
 * through P5 makes and still refuses a moved head with `412`; `parentTurnId`
 * present says *I mean this node* and the head check does not apply. The two
 * answers [P2 §2.10] left open — *an explicit sibling* or *a refusal that
 * offers one* — turn out not to be alternatives: the refusal is for the client
 * that did not ask, the sibling for the client that did.
 *
 * **Why a route suite.** The claim is a composition — the gate in
 * `state/jobs.ts`, the runner gathering at a parent that is not the head
 * ([P6.0b]), and `advanceHead` folding onto that parent's map — and each of
 * those is separately tested. What only shows here is that a turn submitted
 * against an old node comes back as a sibling of it with the state that node
 * had, through the pipeline a person actually reaches.
 */

const PASSWORD = 'correct horse battery';
const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a05';

let server: TestServer;
let provider: FakeProvider;

beforeEach(async () => {
  provider = new FakeProvider({ script: [{ text: 'The rain kept on.' }] });
  server = await makeTestServer({ providers: () => provider });
  await setUpAdmin(server, 'ned', PASSWORD);

  // No connections API at P2, so the supported way to configure one is to write
  // the files the resolver reads — the same seam `p2-gate-storage.test.ts` uses.
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
  await server.dispose().catch(() => undefined);
});

async function createSession(name = 'Rain City'): Promise<string> {
  const created = await server.request({ method: 'POST', url: '/api/sessions', payload: { name } });
  return created.body.session.id as string;
}

/**
 * Submits a turn and waits for it to be **committed**, not merely finished:
 * `turn.finished` is published inside step 4 of the commit protocol and the job
 * is marked committed after it, so a test that resumed at the frame could read
 * a head that had not moved yet.
 */
async function takeTurn(
  sessionId: string,
  key: string,
  headTurnId: string | null,
  text: string,
  branchFrom?: { parentTurnId: string | null },
): Promise<{ status: number; body: any }> {
  const accepted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: key,
      headTurnId,
      input: { text },
      ...(branchFrom ?? {}),
    },
  });
  await server.services.runner.settle();
  return accepted;
}

/** Every turn of the session off disk, by id — the cold read, no index. */
async function turnsOnDisk(sessionId: string): Promise<Map<string, Turn>> {
  return readTurns(server.services.sessions, 'ned', sessionId);
}

describe('a turn submitted against an old node', () => {
  it('becomes a sibling of it, with that node’s state rather than the head’s', async () => {
    const sessionId = await createSession();

    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const firstId = first.body.turnId as string;
    const second = await takeTurn(sessionId, 'k2', firstId, 'She stepped out.');
    const secondId = second.body.turnId as string;

    // Composed against the first turn, deliberately, while the head is on the
    // second. Before [P6.0c] this was a 412 and there was no way to say it.
    const branched = await takeTurn(sessionId, 'k3', firstId, 'She stayed in.', {
      parentTurnId: firstId,
    });
    expect(branched.status).toBe(202);

    const siblingId = branched.body.turnId as string;
    expect(branched.body.parentTurnId).toBe(firstId);

    const byId = await turnsOnDisk(sessionId);
    expect(byId.size).toBe(3);

    // Two lines that share one turn and nothing else. The falsifying mutation
    // is taking `headTurnId` as the parent regardless, which makes this a third
    // turn on one line.
    expect(walkPath(byId, secondId).map((turn) => turn.id)).toEqual([firstId, secondId]);
    expect(walkPath(byId, siblingId).map((turn) => turn.id)).toEqual([firstId, siblingId]);

    /**
     * And the state each line reconstructs to. Two turns deep on either line,
     * so the clock is the same number by arithmetic — what is being asserted is
     * that the *sibling* is two turns deep rather than three, which is what a
     * turn assembled and committed against the head's state would have made it.
     * [P6.0b] is why this holds: the runner gathered at the parent and
     * `advanceHead` folded onto that parent's map.
     */
    expect(readClock(replayChannels(walkPath(byId, secondId)))).toEqual({
      day: 1,
      hour: 8,
      minute: 10,
    });
    expect(readClock(replayChannels(walkPath(byId, siblingId)))).toEqual({
      day: 1,
      hour: 8,
      minute: 10,
    });

    // The head follows the new line, and the snapshot is the replay at it —
    // [P6.0b]'s invariant, through the pipeline rather than at store level.
    const session = await readSession(server.services.sessions, 'ned', sessionId);
    expect(session?.headTurnId).toBe(siblingId);
    expect(session?.channels).toEqual(replayChannels(walkPath(byId, siblingId)));
  });

  it('is still refused when nobody asked for it — gate step 12', async () => {
    const sessionId = await createSession();

    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const firstId = first.body.turnId as string;
    const second = await takeTurn(sessionId, 'k2', firstId, 'She stepped out.');
    const secondId = second.body.turnId as string;

    // A second tab, composing against the head it last saw. Nothing here says
    // *branch*, so the answer is the refusal it has always been — and the
    // session still has two turns, not three.
    const stale = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k3', headTurnId: firstId, input: { text: 'She stayed in.' } },
    });

    expect(stale.status).toBe(412);
    expect(stale.body.error).toBe('stale-head');
    // The head it should have used, by name rather than by shape.
    expect(stale.body.head).toBe(secondId);
    expect((await turnsOnDisk(sessionId)).size).toBe(2);

    // The refusal carries what the client needs to make it a choice: rebase on
    // `head`, or resubmit naming the parent and keep the line it was on.
    const chosen = await takeTurn(sessionId, 'k4', firstId, 'She stayed in.', {
      parentTurnId: firstId,
    });
    expect(chosen.status).toBe(202);
    expect((await turnsOnDisk(sessionId)).size).toBe(3);
  });

  it('refuses a branch point that is not a turn of this session', async () => {
    const sessionId = await createSession();
    const other = await createSession('Another city');
    const theirs = await takeTurn(other, 'k1', null, 'Elsewhere entirely.');

    const crossed = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'k2',
        headTurnId: null,
        parentTurnId: theirs.body.turnId as string,
        input: { text: 'She stayed in.' },
      },
    });

    expect(crossed.status).toBe(404);
    expect(crossed.body.error).toBe('no-such-parent');
    expect((await turnsOnDisk(sessionId)).size).toBe(0);
  });

  it('charges once for a branch that is submitted twice', async () => {
    // [13 §5.1]: a retry must never make a second provider call. Branching does
    // not get its own path through the reservation, and this is what says so.
    const sessionId = await createSession();
    const first = await takeTurn(sessionId, 'k1', null, 'She opened the door.');
    const firstId = first.body.turnId as string;
    await takeTurn(sessionId, 'k2', firstId, 'She stepped out.');

    const calls = provider.requests.length;

    const branched = await takeTurn(sessionId, 'k3', firstId, 'She stayed in.', {
      parentTurnId: firstId,
    });
    const retry = await takeTurn(sessionId, 'k3', firstId, 'She stayed in.', {
      parentTurnId: firstId,
    });

    expect(retry.body.jobId).toBe(branched.body.jobId);
    expect(retry.body.turnId).toBe(branched.body.turnId);
    expect(provider.requests.length).toBe(calls + 1);
    expect((await turnsOnDisk(sessionId)).size).toBe(3);
  });
});
