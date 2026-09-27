// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Rendition } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { jobForRendition, pendingRenditionJobs } from '../renditions/jobs.js';
import { readRenditions, writeRendition } from '../renditions/store.js';
import { Layout } from '../storage/layout.js';
import {
  eventually,
  makeTestServer,
  settled,
  setUpAdmin,
  type TestServer,
} from '../test-server.js';

/**
 * ***Gate steps 4, 8, 12 and 14*** —
 * [P9 §3](../../../../docs/design/workplan/26-p9-implementation.md), [P9.4].
 *
 * 4. *Illustrate a turn from forty turns back: a **second** rendition appears
 *    beside the first and the first is still selectable.*
 * 8. *With no `image` binding, the controls say plainly that nothing can serve
 *    them — the dangling posture, not an obscure turn failure.*
 * 12. *Turn the backdrop off: Play is pixel-identical to a text-only session,
 *     and no `image` call was made.*
 * 14. *Edit that message so the quote no longer occurs in it: the image renders
 *     at the end of the message, the unresolved anchor is recorded, and the
 *     rendition is still `ready`.*
 *
 * ***Row 12's real assertion is a count of zero on a log***, not a screenshot.
 * *Pixel-identical to a text-only session* is what a person checks — that half
 * is C2, blocked on [R10](../../../../docs/design/workplan/05-manual-testing.md) and
 * recorded as blocked — and *no `image` call was made* is the half a test can
 * hold exactly, because the step is kept **out of the plan** rather than idled.
 * A build that idled it instead would pass every visual check and fail here.
 *
 * ***Row 14's claim is that nothing throws***, which is why it is a server test
 * and a client test both. The record keeps the anchor it was given whether or
 * not the words still occur, because resolving happens at render time
 * ([06 §10.4a]) — so *the message was edited* must not be able to reach back and
 * invalidate a rendition. `Rendition.test.tsx` holds the other half: an anchor
 * that no longer resolves puts the picture at the end of the message.
 */

const PASSWORD = 'correct horse battery';
const CHAT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a11';
const IMAGE = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a12';

const MOMENT = JSON.stringify({ subject: 'a lantern on a wet quay', anchor: 'The road went on' });

let dataDir: string;
let server: TestServer;
let sessionId: string;
let fake: FakeProvider;
let counter = 0;
let head: string | null = null;

/**
 * Brings a server up with the connections a picture needs — or without them.
 *
 * `bindImage: false` is gate row 8's whole setup: the connections exist and the
 * `image` role is **unset**, which is the state [19 §5.1] leaves every install
 * in *"because there is no sensible text-model fallback for it"*.
 */
async function boot(options: { bindImage: boolean }): Promise<void> {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p9-controls-'));
  counter = 0;
  head = null;
  fake = new FakeProvider({
    script: [{ text: MOMENT, object: JSON.parse(MOMENT) as unknown }],
    images: [{}],
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
      ...(options.bindImage ? { image: { connectionId: IMAGE, modelId: 'fake-image' } } : {}),
    }),
  );

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'The harbour' },
  });
  sessionId = created.body.session.id;
  head = null;
}

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

async function takeATurn(): Promise<string> {
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

  const before = head;
  await eventually(async () => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const now = (read.body as { session: { headTurnId: string | null } }).session.headTurnId;
    return now !== null && now !== before;
  });
  // Not when the head moves: when the turn, and what it dispatched, are done.
  await settled(server);

  const transcript = await server.request({
    method: 'GET',
    url: `/api/sessions/${sessionId}/turns`,
  });
  const turns = (transcript.body as { turns: { id: string }[] }).turns;
  head = turns.at(-1)?.id ?? null;
  return head ?? '';
}

async function renditionsOf(): Promise<Rendition[]> {
  const all = await readRenditions(server.services.sessions.layout, 'ned', sessionId);
  return [...all.values()];
}

describe('nothing bound to the image role', () => {
  /**
   * ***Gate row 8, both halves.*** The dangling posture is *visible, named, and
   * never a turn that fails obscurely* — so the two assertions are that the turn
   * is untouched and that asking for a picture says so in a word a client can
   * render.
   */
  it('takes ordinary turns and makes no picture', async () => {
    await boot({ bindImage: false });
    await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/channels/se.illustrate`,
      payload: { value: 'each-turn' },
    });
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    head = (read.body as { session: { headTurnId: string | null } }).session.headTurnId;

    const turnId = await takeATurn();
    expect(turnId).not.toBe('');

    const transcript = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/turns`,
    });
    const turns = (transcript.body as { turns: { id: string; status: string }[] }).turns;
    expect(turns.at(-1)?.status).toBe('complete');
    expect(await renditionsOf()).toHaveLength(0);

    /**
     * **And no `fast` call either**, which is the gate that keeps the step out
     * of the plan rather than idling it. A build that ran the step and discarded
     * its answer would log one moment call per turn of every session — [19 §5.1]
     * says the binding already answers the question, so asking a model is paying
     * to be told what the configuration says.
     */
    const moments = fake.requests.filter((one) =>
      JSON.stringify(one.messages).includes('choosing one image'),
    );
    expect(moments).toHaveLength(0);
  });

  it('answers the Illustrate button with a reason rather than an error', async () => {
    await boot({ bindImage: false });
    const turnId = await takeATurn();

    const asked = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/${turnId}/illustrate`,
      payload: { purpose: 'illustration' },
    });

    // A 200 with a class, not a 4xx: **nothing is set up yet** is the ordinary
    // state of an install and an answer to *can you make a picture*, rather than
    // a refused request.
    expect(asked.status).toBe(200);
    expect((asked.body as { held?: string }).held).toBe('no-binding');
    expect(await renditionsOf()).toHaveLength(0);
  });
});

describe('the settings decide what is in the plan', () => {
  /**
   * ***Gate row 12's testable half.*** With the backdrop off and illustration
   * off, no image call is made — and the assertion is on the image log rather
   * than on the absence of a record, because a build that dispatched and
   * discarded would leave no record either.
   */
  it('makes no image call with both settings off', async () => {
    await boot({ bindImage: true });
    await takeATurn();

    expect(fake.images).toHaveLength(0);
    expect(await renditionsOf()).toHaveLength(0);
  });

  /**
   * ***The per-mode default, and [work plan §2.3]'s standing line.*** The
   * setting travels to the client so a control can show it — *"no phase exits
   * with configuration that has no surface"* — and what it says for a session
   * nobody has configured is the **mode's** default rather than the channel's.
   *
   * *`on-demand` rather than `each-turn` for Scene*, which is the most a default
   * can honestly claim: the **Illustrate** action works and nothing runs on its
   * own. A default of *every turn* would be the build deciding to spend
   * somebody's machine on their behalf, which is the argument `ILLUSTRATE_CHANNEL`
   * makes for shipping `off` in the first place.
   */
  it('tells the client the mode’s default until somebody chooses', async () => {
    await boot({ bindImage: true });
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect((read.body as { renditions: { illustration: string } }).renditions.illustration).toBe(
      'on-demand',
    );

    // And a choice wins over it, which is what makes the control mean what it
    // says: a default consulted *after* a person has answered would keep
    // overruling them.
    await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/channels/se.illustrate`,
      payload: { value: 'off' },
    });
    const again = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect((again.body as { renditions: { illustration: string } }).renditions.illustration).toBe(
      'off',
    );
  });
});

describe('Illustrate, pressed by hand', () => {
  /**
   * ***Gate row 4's testable half.*** *"Illustrating an old turn adds; it does
   * not overwrite"* ([06 §10.7]) — and it is true because the id is different
   * rather than because something checked, which is what makes the second
   * assertion here about **names** rather than about a flag.
   */
  it('adds a sibling rather than replacing what is there', async () => {
    await boot({ bindImage: true });
    const turnId = await takeATurn();

    const first = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/${turnId}/illustrate`,
      payload: { purpose: 'illustration' },
    });
    expect(first.status).toBe(202);

    const second = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/${turnId}/illustrate`,
      payload: { purpose: 'illustration' },
    });
    expect(second.status).toBe(202);

    await eventually(async () => {
      const all = await renditionsOf();
      // Non-empty: `every` over an empty list is true, so this would otherwise
      // wait for nothing whenever the record has not landed yet — which is the
      // teardown race this wait exists to close, reopened by the wait itself.
      return all.length > 0 && all.every((one) => one.state !== 'pending');
    });

    const held = await renditionsOf();
    expect(held).toHaveLength(2);
    expect(new Set(held.map((one) => one.id))).toEqual(new Set([`${turnId}.0`, `${turnId}.1`]));
    // Both are of the same turn and both keep their own recipe, which is what
    // makes the first still selectable.
    expect(held.every((one) => one.turnId === turnId)).toBe(true);
    expect(held.every((one) => one.prompt.text.length > 0)).toBe(true);
  });

  /**
   * ***Gate row 14's server half.*** The anchor is a **verbatim quote resolved
   * at render time**, so the record keeps what the model said whether or not the
   * message still says it — and a message edited afterwards must not be able to
   * reach back and make a rendition invalid.
   */
  it('records the anchor it was given and stays ready', async () => {
    await boot({ bindImage: true });
    const turnId = await takeATurn();

    const asked = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/${turnId}/illustrate`,
      payload: { purpose: 'illustration' },
    });
    expect(asked.status).toBe(202);

    await eventually(async () => (await renditionsOf())[0]?.state === 'ready');

    const [made] = await renditionsOf();
    expect(made?.scope?.anchor).toBe('The road went on');
    expect(made?.state).toBe('ready');
    expect(made?.asset).not.toBeNull();
  });

  /**
   * ***The moment call's figures go to the usage log*** — [10 §11.4]. It is on
   * no turn's tape because there is no turn, which is `illustrate.ts`'s *one
   * honest cost*; the account's log is where a call that makes no turn is
   * recorded.
   */
  it('records the moment call in the account’s usage log', async () => {
    await boot({ bindImage: true });
    const turnId = await takeATurn();

    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/${turnId}/illustrate`,
      payload: { purpose: 'illustration' },
    });
    await eventually(async () => (await renditionsOf())[0]?.state !== 'pending');

    const lines = (await readFile(join(dataDir, 'users', 'ned', 'usage.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ purpose: 'illustrate', sessionId });
  });

  /**
   * ***The backdrop branch makes no call at all*** — [06 §10.3]'s *"a backdrop
   * is a place and a place has no moment"*. So **Set the scene** is free, and
   * the assertion is a count on the text log rather than on what came back.
   */
  it('makes no moment call for Set the scene', async () => {
    await boot({ bindImage: true });
    const turnId = await takeATurn();
    const before = fake.requests.length;

    const asked = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/${turnId}/illustrate`,
      payload: { purpose: 'background' },
    });
    expect(asked.status).toBe(202);

    expect(fake.requests).toHaveLength(before);
    const [made] = await renditionsOf();
    expect(made?.purpose).toBe('background');

    // Settled before the teardown removes the directory: the job is
    // fire-and-forget by design ([P9.2]), so a test that walked away mid-write
    // would race its own `rm` rather than assert anything.
    await eventually(async () => (await renditionsOf())[0]?.state !== 'pending');
  });
});

describe('the recipe outlives the pixels', () => {
  /**
   * ***Gate steps 5 and 15, which only close together.***
   *
   * 5. *Set `asset` to null on both: the recipes remain, the placeholders render
   *    as regenerable, and re-running either produces the same request.*
   * 15. *Re-create an evicted rendition and **no text call is made**: the moment
   *     is replayed from `prompt`, not asked for again.*
   *
   * ***§3.1 says why they are one test.*** Step 5's byte-comparison *"passes
   * either way on the day it is written"* — an implementation that regenerates
   * the moment produces the same string from the same scripted model — and only
   * diverges a month later against a real endpoint, by which time the digest has
   * quietly stopped matching itself. Step 15 asserts in the direction that
   * cannot pass by luck: **on the call log**.
   *
   * ***And the claim it holds is structural rather than careful.***
   * `recreateRendition` has no assembly and no role to resolve — the record
   * already carries the fragments, the separator, the budget and the seed — so
   * what the call log proves is that a code path **does not exist**, not that
   * somebody remembered a flag. [06 §10.3] is emphatic that *"a second call is a
   * second answer"*, and a re-creation that went through the step would break
   * the recipe promise and the reuse key at once.
   */
  it('re-creates an evicted picture with no text call and the same request', async () => {
    await boot({ bindImage: true });
    const turnId = await takeATurn();

    const asked = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns/${turnId}/illustrate`,
      payload: { purpose: 'illustration' },
    });
    expect(asked.status).toBe(202);
    await eventually(async () => (await renditionsOf())[0]?.state === 'ready');
    /**
     * **And its job finished**, not only its file. The worker writes the record
     * and then marks the job, and the write awaits a `stat` after its rename —
     * so a retry pressed on the file alone can land while the first try is still
     * live, and a retry is claimed against live jobs: it would be answered by
     * the try that is finishing, and this test's retry would make no picture.
     * `renditions/retry.test.ts` states the window; this closes it here.
     */
    await eventually(() =>
      Promise.resolve(pendingRenditionJobs(server.services.state.db, sessionId).length === 0),
    );

    const [made] = await renditionsOf();
    expect(made).toBeDefined();
    if (made === undefined) return;
    const before = { text: made.prompt.text, digest: made.digest, seed: made.provenance.seed };

    /**
     * **Eviction, performed rather than simulated.** [25 E3]'s policy is *"evict
     * pixels, keep recipes, regenerate on demand"*, and nothing in this build
     * evicts yet — so the row is walked by doing to the record exactly what an
     * eviction policy would do to it, which is also the shape [P9 §1.4] says
     * must stay cheap.
     */
    await writeRendition(server.services.sessions.layout, 'ned', sessionId, {
      ...made,
      asset: null,
    });

    const textCalls = fake.requests.length;
    const images = fake.images.length;

    const again = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/renditions/${made.id}/retry`,
      payload: {},
    });
    expect(again.status).toBe(202);
    await eventually(async () => (await renditionsOf())[0]?.asset !== null);

    // **Step 15.** Not one more text call — the moment was replayed off the
    // record rather than asked for again.
    expect(fake.requests).toHaveLength(textCalls);
    // And the picture *was* remade, or the row above would pass for a build
    // that did nothing at all.
    expect(fake.images.length).toBe(images + 1);

    // **Step 5.** The request the second run made is the first one's, down to
    // the seed — which is the difference between *the same picture* and
    // *another picture of the same thing*.
    const sent = fake.images.at(-1);
    expect(sent?.prompt).toBe(before.text);
    expect(sent?.seed).toBe(before.seed);

    const [remade] = await renditionsOf();
    expect(remade?.digest).toBe(before.digest);
    expect(remade?.prompt.text).toBe(before.text);
    expect(remade?.provenance.seed).toBe(before.seed);
    expect(remade?.asset).not.toBeNull();

    /**
     * ***And the retry is on the books as a second try.*** Until 2026-09-27 the
     * finished job was run again under attempt 1, so the store could not say a
     * picture had been paid for twice — which is what the column is for.
     */
    expect(jobForRendition(server.services.state.db, sessionId, made.id)?.attempt).toBe(2);
  });
});
