// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { uuidv7, type Turn } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { appendTurnToSession } from '../sessions/store.js';
import { listSummaries } from '../sessions/summaries.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***A summary cut off at its limit is not kept, and the next turn asks
 * again*** (2026-09-27).
 *
 * The step's half is `turns/summarise.test.ts`. This is the runner's: a step
 * could not see how its call ended, because the runner handed back the text
 * and nothing else. So the one reply a long session is most likely to produce,
 * a summary that ran into its length limit mid-sentence, was written as a link
 * and built on by every link after it. The provider here says `length` the way
 * a real endpoint does, and the step has to hear it.
 */

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a32';
const SUMMARISED = 'They had been walking north for some time.';

let dataDir: string;
let server: TestServer;
let sessionId: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-summary-links-'));
  /**
   * One provider for the server's life, so the replies run on from one turn
   * into the next: the first turn's summary is cut off, its narration is
   * ordinary, and every reply after that is a finished summary.
   */
  const provider = new FakeProvider({
    script: [
      { text: 'They had been walking nor', finishReason: 'length' },
      { text: 'The road went on.' },
      { text: SUMMARISED },
    ],
  });
  server = await makeTestServer({ dataDir, providers: () => provider });
  await setUpAdmin(server, 'ned');

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

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'The long road' },
  });
  sessionId = created.body.session.id;
});

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/** Forty-five turns written rather than played, as `p8-gate.test.ts` does. */
async function aPast(): Promise<void> {
  let parent: string | null = null;
  for (let at = 0; at < 45; at += 1) {
    const id = uuidv7();
    const turn: Turn = {
      id,
      sessionId,
      parentTurnId: parent,
      createdAt: new Date(Date.UTC(2026, 8, 2, 0, at)).toISOString(),
      status: 'complete',
      input: { actorId: null, kind: 'do', text: `Day ${String(at)}.`, raw: `Day ${String(at)}.` },
      output: { text: `On day ${String(at)} the road turned.` },
      effects: [],
      tape: [],
    };
    await appendTurnToSession(server.services.sessions, 'ned', sessionId, turn);
    parent = id;
  }
}

async function aTurn(key: string): Promise<{ steps: { stepId: string; state: string }[] }> {
  const session = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: key,
      headTurnId: session.body.session.headTurnId,
      input: { text: 'And then?' },
    },
  });
  await eventually(async () => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    return read.body.activeJob === null;
  });
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
  return read.body.turns.at(-1);
}

it('keeps no summary the provider cut off, and derives it on the next turn', async () => {
  await aPast();

  const first = await aTurn('summary-1');
  expect(first.steps.find((step) => step.stepId === 'se.summary')?.state).toBe('failed');
  expect((await listSummaries(server.services.layout, 'ned', sessionId)).size).toBe(0);

  const second = await aTurn('summary-2');
  expect(second.steps.find((step) => step.stepId === 'se.summary')?.state).toBe('ok');
  expect((await listSummaries(server.services.layout, 'ned', sessionId)).size).toBe(2);
});
