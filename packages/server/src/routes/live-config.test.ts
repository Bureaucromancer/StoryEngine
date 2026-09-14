// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { listSnapshots, snapshotsRoot } from '../sessions/snapshots.js';
import { appendTurnToSession, createSession } from '../sessions/store.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * **A `live` key the running server does not actually read** — the failure
 * [22 §4.3](../../../../docs/design/22-internal-contracts.md)'s applier table exists to make
 * impossible, arriving through the one door the table cannot watch.
 *
 * `LIVE_APPLIERS` says of every `live` key whether anything reads it. Four rows
 * said `applied` and were wrong, for one reason: `buildServices` hands the
 * runner `options.config` — the caller's object — while `services.config` is a
 * `structuredClone` of it, and `applyLiveConfig` assigns into the clone. Two
 * objects, one of them updated, and the turn path holding the other.
 *
 * **Every existing test of a live save asserted against `services.config`**, so
 * every one of them passed: the value really did change, in the object the
 * route writes and the settings form reads back. Nothing had ever asked the
 * component that *consumes* the key. That is what makes this a behavioural test
 * rather than an identity assertion — an identity assertion is the shape that
 * was already there and already green.
 *
 * **One key stands for four**, and that is a claim rather than a shortcut: the
 * other three — `limits.contextTokens`, `limits.reservedCompletionTokens` and
 * `sessions.streamCoalesceMs` — were wrong for this one reason and are right
 * again for this one fix, because all four are read off the runner's single
 * config reference. `limits.providerTimeoutMs` is the one exercised because its
 * effect is unambiguous from outside: a turn either gives up on a stalled
 * endpoint or it does not. The other three are visible only as a budget figure
 * or a checkpoint cadence, and a test of those would be asserting the fix
 * through a narrower window, not a second window.
 */

const CONNECTION_ID = '0192b7c0-0000-7000-8000-00000000c0de';

let server: TestServer;
let provider: FakeProvider;
let sessionId: string;

afterEach(async () => {
  await server.dispose().catch(() => undefined);
});

/** An install that can take a turn, against a double that answers slowly. */
async function standUp(stallMs: number, providerTimeoutMs: number): Promise<void> {
  provider = new FakeProvider({ script: [{ stallMs }] });
  server = await makeTestServer({
    providers: () => provider,
    config: {
      limits: {
        maxUploadMb: 64,
        extensionStorageQuotaMb: 32,
        contextTokens: 8192,
        reservedCompletionTokens: 1024,
        providerTimeoutMs,
      },
    },
  });
  await setUpAdmin(server, 'ned');

  const root = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'fake.json'),
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

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City' },
  });
  sessionId = created.body.session.id as string;
}

/** Saves one key through the route a person uses, and nothing else. */
async function save(path: string, value: unknown): Promise<void> {
  const config = structuredClone(server.services.config) as Record<string, unknown>;
  const parts = path.split('.');
  const last = parts.pop()!;
  let node = config;
  for (const part of parts) node = node[part] as Record<string, unknown>;
  node[last] = value;

  const response = await server.request({
    method: 'PUT',
    url: '/api/admin/config',
    payload: { config },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

/** Takes a turn and reads back what was committed. */
async function takeTurn(): Promise<Record<string, unknown>> {
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: 'key-1',
      headTurnId: null,
      input: { actorId: null, kind: 'do', text: 'She knocks.' },
    },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);

  const deadline = Date.now() + 20_000;
  for (;;) {
    const read = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns`,
    });
    const turns = (read.body as { turns?: Record<string, unknown>[] }).turns ?? [];
    const last = turns.at(-1);
    if (last !== undefined && last['status'] !== 'running') return last;
    if (Date.now() > deadline) throw new Error('the turn never finished');
    await new Promise((tick) => setTimeout(tick, 50));
  }
}

describe('a live key the turn path reads', () => {
  /**
   * The falsifying case. Booted with the timeout off and turned on through the
   * settings route — so the only way the turn can fail is if the runner read
   * the saved number rather than the one it started with.
   */
  it('bounds a stalled call using the value saved after the server started', async () => {
    await standUp(10_000, 0);

    await save('limits.providerTimeoutMs', 60);
    const turn = await takeTurn();

    expect(turn['status']).toBe('failed');
  }, 30_000);

  /**
   * The other direction, and it is not redundant: without it, a runner that
   * ignored the key entirely and failed every stalled turn would pass the test
   * above. This one only passes if the saved `0` is read and honoured.
   */
  it('stops bounding it when the value saved after the server started turns it off', async () => {
    await standUp(80, 40);

    await save('limits.providerTimeoutMs', 0);
    const turn = await takeTurn();

    expect(turn['status']).toBe('complete');
  }, 30_000);

  /**
   * **And the file, because a live key is still a saved key.** A fix that made
   * the runner read the live object by handing it the same reference the route
   * writes would be complete only if the route still wrote to disk — and the
   * clone exists precisely to stop a save reaching back into the caller's
   * object, so a careless fix could remove the reason it was cloned.
   */
  it('still writes the saved value to the file', async () => {
    await standUp(0, 300_000);

    await save('limits.providerTimeoutMs', 1234);

    const onDisk = JSON.parse(
      await readFile(join(server.dataDir, 'config.json'), 'utf8'),
    ) as Record<string, Record<string, unknown>>;
    expect(onDisk['limits']?.['providerTimeoutMs']).toBe(1234);
  }, 30_000);
});

/**
 * **The second key this file speaks for** — `sessions.snapshotEveryNTurns`,
 * flipped from `unread` to `applied` at [P6.0d], and [P6 §3] step 9's *write
 * the test, because there is not one*.
 *
 * The step asks for the cadence rather than the number, and the difference is
 * the whole point: an assertion that `services.config` holds what was saved is
 * the shape that was already there and already green for four keys that were
 * lying. What is asserted here is **which nodes end up with a snapshot** after
 * a reconstruction the route performs — a fact about the component that
 * consumes the key, produced by a save made after the server started.
 *
 * `GET /api/sessions/:id` is the reconstruction, and it is not a contrivance:
 * it reconciles hand edits before answering ([03 §8.1]), which means replaying
 * the head path, which is the read a person waits for when they open a session.
 */
describe('a live key the session read path reads', () => {
  const HANDLE = 'ned';

  /** A session of `count` turns, written through the store the server owns. */
  async function aSessionOf(count: number): Promise<{ sessionId: string; turns: string[] }> {
    server = await makeTestServer();
    await setUpAdmin(server, HANDLE);

    const sessions = server.services.sessions;
    const session = await createSession(sessions, HANDLE, 'Rain City');
    const turns: string[] = [];
    let parent: string | null = null;

    for (let hour = 1; hour <= count; hour += 1) {
      const id = uuidv7();
      await appendTurnToSession(sessions, HANDLE, session.id, {
        id,
        sessionId: session.id,
        parentTurnId: parent,
        createdAt: new Date(Date.UTC(2026, 8, 2, 8, hour)).toISOString(),
        status: 'complete',
        effects: [
          {
            id: uuidv7(),
            turnId: id,
            channelId: 'se.clock',
            scopeKey: null,
            op: { type: 'set', path: '/' },
            before: { hour: hour - 1 },
            after: { hour },
            proposedBy: { kind: 'engine' },
            applied: true,
            rejectedReason: null,
            supersedes: null,
            channelVersion: 1,
            scope: 'session',
          },
        ],
        tape: [],
      });
      turns.push(id);
      parent = id;
    }

    // Nothing has reconstructed yet: every append was a child of the head, and
    // that path folds one turn's effects without walking anything.
    expect(await snapshotIds(session.id)).toEqual(new Set());
    return { sessionId: session.id, turns };
  }

  async function snapshotIds(sessionId: string): Promise<Set<string>> {
    return listSnapshots(new Layout(server.dataDir), HANDLE, sessionId);
  }

  async function readSession(sessionId: string): Promise<void> {
    const response = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}`,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }

  it('changes the cadence of the next reconstruction, not the next restart', async () => {
    const { sessionId, turns } = await aSessionOf(6);

    await save('sessions.snapshotEveryNTurns', 2);
    await readSession(sessionId);

    // Every second turn of the six replayed. The falsifying mutation is reading
    // the number once — at construction, or into a constant — which leaves the
    // default of ten in force and this set empty.
    expect(await snapshotIds(sessionId)).toEqual(new Set([turns[1], turns[3], turns[5]]));

    // Deleting the cache is a supported gesture ([07 §4], gate step 6), and
    // here it is what makes the second reading a fresh one rather than a read
    // that starts from the snapshots the first left behind.
    await rm(snapshotsRoot(new Layout(server.dataDir), HANDLE, sessionId), {
      recursive: true,
      force: true,
    });

    await save('sessions.snapshotEveryNTurns', 5);
    await readSession(sessionId);

    expect(await snapshotIds(sessionId)).toEqual(new Set([turns[4]]));
  }, 30_000);

  it('still writes the saved value to the file', async () => {
    const { sessionId } = await aSessionOf(1);
    expect(sessionId).not.toBe('');

    await save('sessions.snapshotEveryNTurns', 7);

    const onDisk = JSON.parse(
      await readFile(join(server.dataDir, 'config.json'), 'utf8'),
    ) as Record<string, Record<string, unknown>>;
    expect(onDisk['sessions']?.['snapshotEveryNTurns']).toBe(7);
  }, 30_000);
});
