// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeProvider, type ScriptedReply } from '../providers/fake.js';
import { readAllTurns } from '../sessions/segments.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * What survives a kill, and what the log says about it — [P2 §2.10], gates 10
 * and 19.
 *
 * The stage makes two falsifiable claims and these are them: **a turn
 * interrupted mid-generation is recovered as a failed turn with what it had**,
 * and **a killed turn's whole lifecycle is reconstructable from the log by its
 * job id alone**. A claim like the second is a slogan until something fails when
 * it stops being true.
 */

let dataDir: string;
let logLines: string[];
let server: TestServer;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a03';

function capture(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      logLines.push(chunk.toString());
      done();
    },
  });
}

function parsedLog(): Record<string, unknown>[] {
  return logLines
    .join('')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * A server on the shared data directory, with a scripted provider behind it.
 *
 * Each one gets a **fresh cookie jar**, which is faithful — a restarted server
 * is a new process and the browser is a separate thing — so the caller signs in
 * again. Forgetting that is why the first draft of these tests read a `503` as
 * a missing session.
 */
async function start(script: ScriptedReply[]): Promise<TestServer> {
  const provider = new FakeProvider({ script });
  return makeTestServer({
    dataDir,
    providers: () => provider,
    logStream: capture(),
    config: {
      log: { level: 'info', format: 'json' },
      sessions: { snapshotEveryNTurns: 10, streamKeepaliveMs: 15000, streamCoalesceMs: 0 },
    },
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-recover-'));
  logLines = [];
});

afterEach(async () => {
  // Defensively, because a test that failed early left its server holding the
  // sqlite files — and on Windows that is an `EBUSY` on cleanup that buries the
  // real failure under a second one.
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/** Signs the client into a freshly started server. */
async function signIn(): Promise<void> {
  await server.request({
    method: 'POST',
    url: '/api/auth/login',
    payload: { handle: 'ned', password: 'correct horse battery' },
  });
}

async function seedAccount(): Promise<string> {
  await setUpAdmin(server, 'ned');
  const root = new Layout(dataDir).userConnectionsRoot('ned');
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
    join(dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City' },
  });
  return created.body.session.id as string;
}

describe('a turn killed mid-generation', () => {
  it('is recovered by the next start as a failed turn with what it had', async () => {
    // Gate 10, end to end through the routes.
    server = await start([{ text: 'a long slow answer', chunks: 12, chunkDelayMs: 20 }]);
    const sessionId = await seedAccount();

    const accepted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k', headTurnId: null, input: { text: 'She waited.' } },
    });
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    // Wait for real work to have happened, so the kill lands mid-generation
    // rather than before anything started.
    await stream.until((frame) => frame.event === 'delta', 4000);
    await stream.abort();

    /**
     * **A kill, not a shutdown.** `halt()` drops every run without finalising,
     * which is what a dead process leaves behind. Draining would let the runner
     * *finish*, and the test would then be asserting that a graceful shutdown
     * works — a different and much weaker claim.
     */
    server.services.runner.halt();
    await server.dispose();

    server = await start([{ text: 'unused' }]);
    await signIn();
    const reconciliation = server.services.reconciliation;
    expect(reconciliation.finalised).toEqual([accepted.body.jobId]);
    expect(reconciliation.failed).toEqual([]);

    const written = await readAllTurns(
      join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    expect(written).toHaveLength(1);
    const turn = written[0]?.turn;
    // Failed, because generation is never resumed — but *present*, with what it
    // managed, rather than a turn that silently never happened.
    expect(turn?.status).toBe('failed');
    expect(turn?.request?.blocks.length ?? 0).toBeGreaterThan(0);
    expect(turn?.input?.text).toBe('She waited.');

    // And the head advanced exactly once.
    const session = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(session.body.session.headTurnId).toBe(turn?.id);
  });

  it('leaves the session usable, not permanently busy', async () => {
    // The failure mode the one-active-job index makes possible: a job stuck
    // active means every later submission is refused, forever.
    server = await start([{ text: 'slow', chunks: 8, chunkDelayMs: 20 }]);
    const sessionId = await seedAccount();

    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k', headTurnId: null, input: { text: 'x' } },
    });
    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until((frame) => frame.event === 'delta', 4000);
    await stream.abort();
    server.services.runner.halt();
    await server.dispose();

    server = await start([{ text: 'the next one' }]);
    await signIn();
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.body.activeJob).toBeNull();

    const next = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'k2',
        headTurnId: read.body.session.headTurnId,
        input: { text: 'again' },
      },
    });
    expect(next.status).toBe(202);
  });
});

describe('the log alone reconstructs a killed turn', () => {
  it('spans both processes, filtered by job id and nothing else', async () => {
    // Gate 19. Both servers write into one capture, so the filter is over the
    // whole corpus — which is the point: the recovering process is where the
    // interesting half happens, and a log that only covered the dying one would
    // satisfy a weaker claim.
    server = await start([{ text: 'a long slow answer', chunks: 12, chunkDelayMs: 20 }]);
    const sessionId = await seedAccount();

    const accepted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k', headTurnId: null, input: { text: 'She waited.' } },
    });
    const jobId = accepted.body.jobId as string;

    const stream = await server.stream({ url: `/api/sessions/${sessionId}/stream` });
    await stream.until((frame) => frame.event === 'delta', 4000);
    await stream.abort();
    server.services.runner.halt();
    await server.dispose();

    server = await start([{ text: 'unused' }]);
    await signIn();
    await server.dispose();

    const mine = parsedLog().filter((line) => line['jobId'] === jobId);

    // Falsifiable in both directions: this job has a lifecycle…
    expect(mine.length).toBeGreaterThan(2);
    // …and a different one has none.
    expect(parsedLog().filter((line) => line['jobId'] === 'not-a-job')).toEqual([]);

    /**
     * **Asserted on a parsed `event` field, never a regex over `msg`.**
     * That is what "bindings, not prose" means operationally: a message is
     * developer-facing English that may be reworded, and a test that matched it
     * would be pinning the wording rather than the fact.
     */
    const events = mine.map((line) => line['event']);
    expect(events).toContain('job.running');
    expect(events).toContain('step.started');
    // The half that only the *recovering* process can write.
    expect(events).toContain('job.recovered');
    expect(events).toContain('job.committed');
  });

  it('carries no output text, no guidance and no absolute path', async () => {
    // [13 §4.1]'s three prohibitions. The first is one well-meant debug of the
    // draft away, and none of them was enforced or tested before this.
    server = await start([{ text: 'the-secret-narration' }]);
    const sessionId = await seedAccount();

    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'k',
        headTurnId: null,
        input: { text: 'x' },
        guidance: 'the-secret-guidance',
      },
    });
    await server.services.runner.settle();
    await server.dispose();

    const corpus = logLines.join('');
    expect(corpus).not.toContain('the-secret-narration');
    expect(corpus).not.toContain('the-secret-guidance');
    expect(corpus).not.toContain(dataDir);
  });
});
