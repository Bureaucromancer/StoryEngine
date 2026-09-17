// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakeProvider } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { readRenditions } from './store.js';

/**
 * ***Shutdown waits for a picture that is still being made*** — the half
 * [P9.2](../../../../docs/design/workplan/26-p9-implementation.md)'s detached
 * dispatch never had.
 *
 * ***Two notes said the right thing and neither of them was about this.***
 * `dispatchRenditions` says the promise is *"deliberately not returned"* because
 * [06 §10.2](../../../../docs/design/06-modes-and-turn-pipeline.md) forbids a
 * turn waiting on an image; `TurnRunnerOptions.dispatch` says a runner owning
 * the worker would be *"a runner whose shutdown had to drain pictures, which is
 * exactly the coupling this phase exists to avoid."* **Both still hold.** What
 * fell between them is that *not waited for by a request* became *not waited for
 * by anything*, and `disposeServices` closed `DatabaseSync` under a job that was
 * still writing through it — the exact failure its own comment argues against
 * one line above where the gap was: *"a detached turn touching a closed
 * `DatabaseSync` is the failure that surfaces on Windows as `EBUSY` on a file
 * the caller never named."*
 *
 * ***Found from the other end***, 2026-09-17, while getting
 * [P11](../../../../docs/design/workplan/28-p11-implementation.md)'s row 8
 * green: a full-suite run went red in `p9-gate-selection.test.ts` with
 * `ENOTEMPTY` removing a session directory. The test's `rm` had raced an asset
 * write nothing had waited for. **It passed five times in isolation**, which is
 * what a race under load looks like and why the temptation to call it a flake is
 * worth naming: the reproduction was load-dependent, the defect was not.
 *
 * ***The falsifying mutation*** is removing `await services.drainRenditions()`
 * from `disposeServices`. The rendition is then still `pending` when `dispose()`
 * resolves, which is what this asserts, and it is a state nothing else in the
 * suite looks at — every other test either waits for the picture or does not
 * make one.
 */

const PASSWORD = 'correct horse battery';
const CHAT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a31';
const IMAGE = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a32';
const MOMENT = JSON.stringify({ subject: 'a lantern on a wet quay', anchor: 'The road went on' });

/**
 * **Long enough that the picture is unfinished when `dispose()` is called**, and
 * short enough that a suite waiting for it is not a suite anybody skips. The
 * whole test is the difference between this number being waited out and not, so
 * it has to be longer than the time between the turn landing and the next line
 * running — a second is two orders of magnitude clear of that.
 */
const STALL_MS = 1_000;

let dataDir: string;
let server: TestServer;
let sessionId: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-rendition-shutdown-'));
  const fake = new FakeProvider({
    script: [{ text: MOMENT, object: JSON.parse(MOMENT) as unknown }],
    images: [{ stallMs: STALL_MS }],
    capabilities: { rendersImages: true, supportsStructuredOutput: true },
  });
  server = await makeTestServer({ dataDir, providers: () => fake });
  await setUpAdmin(server, 'ned', PASSWORD);

  const connections = new Layout(dataDir).userConnectionsRoot('ned');
  await mkdir(connections, { recursive: true });
  await writeFile(
    join(connections, 'chat.json'),
    JSON.stringify({
      id: CHAT,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
    }),
  );
  await writeFile(
    join(connections, 'image.json'),
    JSON.stringify({
      id: IMAGE,
      label: 'The picture double',
      provider: 'openai-compatible',
      models: ['fake-image'],
      capabilities: { rendersImages: true },
    }),
  );
  await writeFile(
    join(dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({
      prose: { connectionId: CHAT, modelId: 'fake-hi' },
      fast: { connectionId: CHAT, modelId: 'fake-hi' },
      image: { connectionId: IMAGE, modelId: 'fake-image' },
    }),
  );

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'The harbour' },
  });
  sessionId = (created.body as { session: { id: string } }).session.id;

  await server.request({
    method: 'PUT',
    url: `/api/sessions/${sessionId}/channels/se.illustrate`,
    payload: { value: 'each-turn' },
  });
});

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

async function statesOnDisk(): Promise<string[]> {
  const all = await readRenditions(server.services.sessions.layout, 'ned', sessionId);
  return [...all.values()].map((one) => one.state);
}

describe('disposing the server', () => {
  it('waits for a picture that is still being made', async () => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const head = (read.body as { session: { headTurnId: string | null } }).session.headTurnId;

    const submitted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k-0', headTurnId: head, input: { text: 'Look around.' } },
    });
    expect(submitted.status).toBe(202);

    // **The record, not the turn.** `#recordRenditions` runs after
    // `finaliseTurn`, deliberately, so a head that moved does not yet mean a
    // rendition exists to wait for — the same window `p9-gate.test.ts` had to
    // learn about, and waiting for the record is what closes it.
    await eventually(async () => (await statesOnDisk()).length === 1);
    expect(await statesOnDisk(), 'the picture has not been made yet').toEqual(['pending']);

    await server.dispose();

    // **The assertion, and it is about `dispose` rather than about time.**
    // Nothing here sleeps: the only thing that could have moved this off
    // `pending` is the drain inside `disposeServices` waiting the stall out.
    expect(await statesOnDisk(), 'dispose returned with the job still running').not.toContain(
      'pending',
    );
  });
});
