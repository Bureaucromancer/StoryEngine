// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Rendition } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { readRenditions } from '../renditions/store.js';
import { Layout } from '../storage/layout.js';
import {
  eventually,
  makeTestServer,
  settled,
  setUpAdmin,
  type TestServer,
} from '../test-server.js';

/**
 * ***Gate steps 1 and 3*** —
 * [P9 §3](../../../../docs/design/workplan/26-p9-implementation.md), [P9.2].
 *
 * 1. *A turn completes on text with an image still pending, and the session is
 *    fully usable while it resolves.*
 * 3. *A failed rendition is a placeholder with a retry, and the turn is
 *    `complete` rather than `failed`.*
 *
 * ***The falsifying mutation is named here because it is the whole point of the
 * file.*** Make the rendition a **step** of the turn rather than a job beside
 * it, and every assertion about pixels still passes — the record lands, the
 * bytes land, the workbench shows them — while these go red. That is [06 §10.2]'s
 * claim in the only form a test can hold it: *"the turn completes on text…
 * this is not an optimisation, it is the only workable design."*
 *
 * ***Step 3 is written first, and [P9 §3.1] says why***: *"a provider that
 * refuses is cheaper to script than one that succeeds, so this row is walkable
 * **before** the endpoint exists and should be written first."* It also forces
 * the error to be a **class** on day one rather than whatever sentence an
 * endpoint happened to send.
 *
 * *What this file cannot reach is C1*, which is a person watching a picture
 * arrive in a browser they closed and reopened. That is blocked on
 * [manual testing](../../../../docs/design/workplan/05-manual-testing.md)'s R10 and recorded as blocked rather
 * than walked.
 */

const PASSWORD = 'correct horse battery';
const CHAT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a09';
const IMAGE = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a10';

/** What the scripted `fast` model answers when asked what the picture is of. */
const MOMENT = JSON.stringify({ subject: 'a lantern on a wet quay', anchor: 'The road went on' });

let dataDir: string;
let server: TestServer;
let sessionId: string;
let fake: FakeProvider;

/**
 * One double behind both connections.
 *
 * *The same instance for chat and for images*, so a single `requests` log and a
 * single `images` log answer **both** of the questions the gate rows ask — *was
 * a text call made* and *was an image call made* — without a test having to
 * know which provider object served which.
 */
function makeFake(images: FakeProvider['images'] extends never ? never : object[]): FakeProvider {
  return new FakeProvider({
    script: [{ text: MOMENT, object: JSON.parse(MOMENT) as unknown }],
    images,
    capabilities: { rendersImages: true, supportsStructuredOutput: true },
  });
}

async function boot(images: object[]): Promise<void> {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p9-gate-'));
  fake = makeFake(images);
  counter = 0;
  head = null;
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
      /**
       * **The capability a person sets, set here.** `capabilities.ts` ships no
       * invented numbers and `rendersImages` is false for every known provider,
       * because whether the URL behind `openai-compatible` also answers
       * `/images/generations` is a fact about *that endpoint*. A connection is
       * where somebody who knows says so, and this is a test saying so.
       */
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
  sessionId = created.body.session.id;

  // Illustration on. Off is the default, for the reason `se.illustrate`'s
  // docstring gives: an image is somebody's own machine.
  await server.request({
    method: 'PUT',
    url: `/api/sessions/${sessionId}/channels/se.illustrate`,
    payload: { value: 'each-turn' },
  });

  /**
   * **The head after the switch, not before it.** A channel write is an
   * *effect*, and an effect is carried by a turn — `writeChannel`'s *turn with
   * no model call and no tape*. So turning illustration on moves the head, and a
   * submission composed against `null` is stale by one.
   */
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  head = (read.body as { session: { headTurnId: string | null } }).session.headTurnId;
}

afterEach(async () => {
  // Tolerated for `p6-gate.test.ts`'s reason: a test that failed early left its
  // server holding the sqlite handles, and the cleanup error would bury the real
  // failure under a second one.
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

let counter = 0;
let head: string | null = null;

async function takeATurn(): Promise<{ turnId: string; status: string }> {
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: {
      idempotencyKey: `k-${String(counter++)}`,
      headTurnId: head,
      input: { text: 'Look around.' },
    },
  });
  expect(submitted.status).toBe(202);

  const jobId = (submitted.body as { jobId: string }).jobId;
  const before = head;
  // A predicate, not an assertion block: `eventually` polls a boolean and only
  // reports failure once the deadline passes.
  await eventually(async () => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const now = (read.body as { session: { headTurnId: string | null } }).session.headTurnId;
    return now !== null && now !== before;
  });
  /**
   * The turn's own body — its renditions recorded and dispatched, the person
   * told — and **not** the pictures themselves. This file's image provider
   * stalls on purpose, because gate row 1 is that a turn does not wait for its
   * picture; draining here would make every picture ready before the row could
   * see it pending. The negative rows drain it themselves, with `settled`.
   */
  await server.services.runner.settle();

  const transcript = await server.request({
    method: 'GET',
    url: `/api/sessions/${sessionId}/turns`,
  });
  const turns = (transcript.body as { turns: { id: string; status: string }[] }).turns;
  const last = turns.at(-1);
  expect(last).toBeDefined();
  expect(jobId).toBeTruthy();
  head = last?.id ?? null;
  return { turnId: last?.id ?? '', status: last?.status ?? '' };
}

async function renditionsOf(): Promise<Rendition[]> {
  const all = await readRenditions(server.services.sessions.layout, 'ned', sessionId);
  return [...all.values()];
}

describe('a turn completes on text while its picture is still being made', () => {
  beforeEach(async () => {
    /**
     * A provider that takes its time, so *pending* is a state the turn can be
     * observed in rather than a race the test hopes to win.
     *
     * ***The number is a second and a half rather than the fifty milliseconds
     * it was, and the reason is the second half of the race fixed below.***
     * Fifty is plenty of head-room on an idle machine and none at all on one
     * running the whole suite, where fifty milliseconds of wall clock can pass
     * between two adjacent `await`s. A budget that has to be generous to be a
     * budget should be written generously; the stall costs the file three
     * seconds and buys both assertions a margin that does not depend on what
     * else the machine is doing. *Found 2026-09-17, the second race in this
     * file.*
     */
    await boot([{ stallMs: 1_500 }]);
  });

  it('commits the turn and leaves the rendition pending beside it', async () => {
    const turn = await takeATurn();

    /**
     * **Gate row 1.** The turn is `complete` and the head has moved — and the
     * picture has not arrived. If a rendition were a step of the turn, the turn
     * would not have committed until the provider's stall elapsed, and this
     * assertion would be a coin flip rather than a claim.
     */
    expect(turn.status).toBe('complete');

    /**
     * ***Awaited rather than read, and the ordering this file exists to prove
     * is exactly why.*** `#recordRenditions` runs **after** `finaliseTurn`,
     * deliberately — *"enqueuing first would let a fast provider land an asset
     * on a turn the store has not appended"* — and `takeATurn` returns the
     * moment the head moves, which is `finaliseTurn`. So there is a real window
     * in which the turn is committed and the record is not yet written, and a
     * bare read of it is a coin flip weighted by how loaded the machine is.
     *
     * **Waiting does not soften the claim, it is the claim.** What gate row 1
     * asserts is that the turn did not wait for the picture; the picture's
     * record arriving a beat later is that property, not a weakening of it. The
     * falsifying mutation — making the rendition a step of the turn — still
     * turns this red, because then `turn.status` would not be `complete` until
     * the stall elapsed and the state below would be `ready` rather than
     * `pending`. *Found 2026-09-17, under a full-suite run.*
     */
    await eventually(async () => (await renditionsOf()).length === 1);

    const pending = await renditionsOf();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.state).toBe('pending');
    // The recipe is on the record before the pixels exist, which is what makes
    // an interrupted job a placeholder with a retry rather than a dead end.
    expect(pending[0]?.prompt.text).toContain('a lantern on a wet quay');
    expect(pending[0]?.provenance.seed).toBeTypeOf('number');
  });

  it('is fully usable while the picture resolves', async () => {
    await takeATurn();

    // The session reads, the transcript reads, and a second turn can be taken —
    // none of which is true if the rendition holds the session's one active job.
    const second = await takeATurn();
    expect(second.status).toBe('complete');

    /**
     * **Settled before the teardown, which is this file's own design biting the
     * test that asserts it.** A rendition job is fire-and-forget ([P9.2]) — the
     * property the two turns above exist to prove — so leaving one in flight
     * means `afterEach`'s `rm` races the worker's asset write and the run dies
     * on `ENOTEMPTY` rather than on an assertion. *Found 2026-09-16, when the
     * race was lost for the first time under a loaded machine.*
     *
     * `p9-gate-controls.test.ts` carries the same wait for the same reason. It
     * is not a weakening of the claim: the assertions above have already passed
     * by the time this runs, and what it waits for is the **worker** finishing,
     * not the turn.
     */
    await eventually(async () => {
      const all = await renditionsOf();
      // Non-empty: `every` over an empty list is true, so this would otherwise
      // wait for nothing whenever the record has not landed yet — which is the
      // teardown race this wait exists to close, reopened by the wait itself.
      return all.length > 0 && all.every((one) => one.state !== 'pending');
    });
  });

  it('lands the picture on the record afterwards', async () => {
    await takeATurn();

    await eventually(async () => (await renditionsOf())[0]?.state === 'ready');

    const [ready] = await renditionsOf();
    expect(ready?.asset?.mime).toBe('image/png');
    expect(ready?.asset?.digest).toMatch(/^sha256:/);
    // The seed the step drew on the turn, echoed by the endpoint and recorded —
    // [06 §10.7]'s load-bearing field, end to end. A *number* rather than a
    // fixed value, because the draw is the engine's RNG and the point is that it
    // survives to the record rather than what it happened to be.
    expect(ready?.provenance.seed).toBeTypeOf('number');
    expect(ready?.provenance.at).not.toBeNull();
  });

  it('serves the bytes with the record’s own type and digest', async () => {
    await takeATurn();
    await eventually(async () => (await renditionsOf())[0]?.state === 'ready');

    const [ready] = await renditionsOf();
    const asset = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/renditions/${encodeURIComponent(ready?.id ?? '')}/asset`,
    });

    // `routes/library.ts`'s shape, which its own comment promised this phase.
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toBe('image/png');
    expect(asset.headers['etag']).toBe(ready?.asset?.digest);
  });
});

describe('a failed rendition is a placeholder, never a failed turn', () => {
  beforeEach(async () => {
    // [P9 §3.1]: cheaper to script than a success, and written first.
    await boot([{ error: { class: 'terminal', message: 'the endpoint said no' } }]);
  });

  it('leaves the turn complete and the record failed', async () => {
    const turn = await takeATurn();
    expect(turn.status).toBe('complete');

    await eventually(async () => (await renditionsOf())[0]?.state === 'failed');

    const [failed] = await renditionsOf();
    /**
     * **A class, never the endpoint's sentence** — [21 §1.4]. The provider said
     * *"the endpoint said no"*; what reaches the record is `terminal`, because
     * the server does not know the reader's language and the provider's own
     * words go to the log.
     */
    expect(failed?.error).toBe('terminal');
    expect(failed?.state).toBe('failed');
  });

  it('keeps the whole recipe, so the retry has something to run', async () => {
    await takeATurn();
    await eventually(async () => (await renditionsOf())[0]?.state === 'failed');

    const [failed] = await renditionsOf();
    expect(failed?.asset).toBeNull();
    // [06 §10.7]: *the recipe outlives the pixels*, and a failure is the first
    // place that has to be true.
    expect(failed?.prompt.fragments.length).toBeGreaterThan(0);
    expect(failed?.provenance.seed).toBeTypeOf('number');
    expect(failed?.digest).toBeTruthy();
  });

  it('404s the asset rather than serving a broken image', async () => {
    await takeATurn();
    await eventually(async () => (await renditionsOf())[0]?.state === 'failed');

    const [failed] = await renditionsOf();
    const asset = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/renditions/${encodeURIComponent(failed?.id ?? '')}/asset`,
    });

    // ~~Which is what the placeholder renders from.~~ It was not (2026-09-30):
    // the placeholder renders from the list's `asset: null`, which says so of
    // an evicted picture too since then. [10 §2.3]: *"the temptation this
    // feature brings is a placeholder where the picture would go"* — and this
    // 404 is for a page that read the list before the file went.
    expect(asset.status).toBe(404);
  });
});

describe('with nothing bound to the image role', () => {
  beforeEach(async () => {
    await boot([{}]);
    await writeFile(
      join(dataDir, 'users', 'ned', 'bindings.json'),
      JSON.stringify({
        prose: { connectionId: CHAT, modelId: 'fake-hi' },
        fast: { connectionId: CHAT, modelId: 'fake-hi' },
      }),
    );
  });

  it('takes the turn and asks for nothing, rather than failing obscurely', async () => {
    /**
     * ***The dangling posture, applied to a step*** — [P2B], [19 §5.1]. That
     * section leaves `image` unset on every install *"because there is no
     * sensible text-model fallback for it"*, so without the runner's gate every
     * turn of every session would log a failed step to discover what the binding
     * already says.
     *
     * **Asserted on the call log as well as on the record**, because *no picture
     * was made* and *no money was spent finding out* are different claims and
     * only the second one is about a bill.
     */
    const turn = await takeATurn();
    // Everything it could have set off has finished, so *nothing was asked
    // for* is a claim about the whole turn rather than about the moment it
    // returned.
    await settled(server);

    expect(turn.status).toBe('complete');
    expect(await renditionsOf()).toEqual([]);
    expect(fake.images).toEqual([]);
  });
});
