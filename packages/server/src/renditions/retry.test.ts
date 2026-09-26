// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Rendition } from '@storyengine/shared';

import { FakeProvider, type ScriptedImage } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { jobForRendition, pendingRenditionJobs } from './jobs.js';
import { readRenditions } from './store.js';

/**
 * ***The retry button, end to end*** — [06 §10.2](../../../../docs/design/06-modes-and-turn-pipeline.md)'s
 * *"a failed rendition is a placeholder with a retry button"*, and what the
 * operational store has to say while that retry is running.
 *
 * ***Found 2026-09-26, by reading rather than by a failure.*** The index that
 * made `enqueueRendition` idempotent was `unique (rendition_id)` with no
 * condition, although the comment above it said *"one live job per rendition"*.
 * So a retry was handed the first try's **finished** row, `runRendition` set it
 * back to `running` with its old `finished_at` still in place, and the one query
 * that asks *what is still being worked on* — `finished_at is null`, which both
 * `pendingRenditionJobs` and boot recovery read — could not see it. The attempt
 * never went past 1, which three comments said it would.
 *
 * **Every gate test that retries still passed**, because each one waits for the
 * *picture*, and the picture did arrive. What was wrong was the store's account
 * of the retry while it ran and after a crash, and nothing looked there. So the
 * assertions below are on the **job rows**, read through the functions recovery
 * reads them through, rather than on the record alone.
 */

const PASSWORD = 'correct horse battery';
const CHAT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a41';
const IMAGE = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a42';
const MOMENT = JSON.stringify({ subject: 'a lantern on a wet quay', anchor: 'The road went on' });

/** The first picture fails, so there is something to retry. */
const REFUSED: ScriptedImage = { error: { class: 'retryable', message: 'not now' } };

/**
 * **Long enough that the retry is observably running**, for `p9-gate.test.ts`'s
 * reason: under a full-suite run fifty milliseconds can pass between two
 * adjacent `await`s, and a stall that has to be generous to be a stall should be
 * written generously.
 */
const SLOW: ScriptedImage = { stallMs: 1_500 };

let dataDir: string;
let server: TestServer;
let sessionId: string;
let fake: FakeProvider;

afterEach(async () => {
  // Tolerated for `p6-gate.test.ts`'s reason: a test that failed early left its
  // server holding the sqlite handles, and a second error would bury the first.
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * A server whose `image` role is bound and whose session illustrates every turn.
 *
 * The data directory is made here and **borrowed** by the server, so a dispose
 * leaves it on disk — which is what lets the restart case boot a second server
 * against the first one's store.
 */
async function boot(images: ScriptedImage[]): Promise<void> {
  dataDir = await mkdtemp(join(tmpdir(), 'se-rendition-retry-'));
  fake = new FakeProvider({
    script: [{ text: MOMENT, object: JSON.parse(MOMENT) as unknown }],
    images,
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
}

async function renditionsOf(): Promise<Rendition[]> {
  const all = await readRenditions(server.services.sessions.layout, 'ned', sessionId);
  return [...all.values()];
}

/**
 * Takes one turn and waits until its picture has **failed and its job has
 * finished** — both, and the second is not a formality.
 *
 * `fail()` writes the record and then marks the job, and the record write is
 * `writeAtomic`, which awaits a `stat` *after* its rename. So there is a real
 * window in which the file already says `failed` and the job is still live, and
 * a retry pressed inside it is answered by the job that is finishing rather than
 * by a new one — correctly, and not what these tests are about. A wait on the
 * file alone would make every assertion below a coin flip weighted by load.
 */
async function aFailedPicture(): Promise<Rendition> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  const head = (read.body as { session: { headTurnId: string | null } }).session.headTurnId;
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: 'k-0', headTurnId: head, input: { text: 'Look around.' } },
  });
  expect(submitted.status).toBe(202);

  await eventually(
    async () =>
      (await renditionsOf())[0]?.state === 'failed' &&
      pendingRenditionJobs(server.services.state.db, sessionId).length === 0,
    {
      describe: async () =>
        JSON.stringify({
          records: (await renditionsOf()).map((one) => one.state),
          live: pendingRenditionJobs(server.services.state.db, sessionId).length,
        }),
    },
  );
  const [failed] = await renditionsOf();
  if (failed === undefined) throw new Error('no rendition was recorded');
  return failed;
}

function retry(renditionId: string): ReturnType<TestServer['request']> {
  return server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/renditions/${encodeURIComponent(renditionId)}/retry`,
    payload: {},
  });
}

describe('retrying a failed picture', () => {
  /**
   * ***The job the retry runs is a live job, with the next number.***
   *
   * *Live* is the property recovery depends on: a running job that
   * `pendingRenditionJobs` cannot see is a job boot reconciliation cannot see,
   * and a crash with it in flight leaves it `running` for good. *The next
   * number* is `RenditionJob.attempt`'s own promise — *"a retry is a new job
   * with a higher number, never a reset"* — which is the difference between the
   * store knowing a picture was paid for twice and believing it was paid for
   * once.
   *
   * **The falsifying mutation is the old index**, `unique (rendition_id)` with
   * no `where`: the retry is then handed the finished row, the status reads
   * `running`, and the list below is empty.
   */
  it('runs as a live job with the next attempt number', async () => {
    await boot([REFUSED, SLOW]);
    const failed = await aFailedPicture();

    const asked = await retry(failed.id);
    expect(asked.status).toBe(202);

    const db = server.services.state.db;
    await eventually(() => Promise.resolve(jobForRendition(db, failed.id)?.status === 'running'));

    const live = pendingRenditionJobs(db, sessionId);
    expect(live).toEqual([
      expect.objectContaining({
        renditionId: failed.id,
        status: 'running',
        attempt: 2,
        finishedAt: null,
      }),
    ]);

    // Settled before the teardown, for `p9-gate.test.ts`'s reason — and the
    // finished half of the claim: once the picture lands, the job that made it
    // says so, and nothing is left owed.
    await eventually(async () => (await renditionsOf())[0]?.state === 'ready');
    await eventually(() => Promise.resolve(pendingRenditionJobs(db, sessionId).length === 0));
    const done = jobForRendition(db, failed.id);
    expect(done?.attempt).toBe(2);
    expect(done?.status).toBe('done');
    expect(done?.finishedAt).not.toBeNull();
  });

  /**
   * ***Pressed twice, one picture.***
   *
   * The uniqueness guard exists to stop a double dispatch, and until this fix
   * it stopped a second **row** without stopping a second **run**: the
   * dispatcher ran whatever the store handed back, including a job that was
   * already running. Two requests therefore meant two image calls — on
   * somebody's own machine, or on their bill.
   *
   * **Sent together**, rather than the second after the first is seen running.
   * With a stall between them the first retry can finish on a loaded machine,
   * and a third try would then be a correct answer to a request that arrived
   * after the second one ended.
   *
   * **Counted after `dispose`**, which waits for every picture still being
   * made, so a stray second run cannot finish after the assertion and escape it.
   */
  it('makes one image call when the retry arrives twice', async () => {
    await boot([REFUSED, SLOW]);
    const failed = await aFailedPicture();

    const [first, second] = await Promise.all([retry(failed.id), retry(failed.id)]);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);

    expect(pendingRenditionJobs(server.services.state.db, sessionId)).toHaveLength(1);

    await server.dispose();
    // The refused first try, and exactly one retry.
    expect(fake.images).toHaveLength(2);
  });
});
