// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Rendition } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { readRenditions } from '../renditions/store.js';
import { listNotifications } from '../state/notifications.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The producers, through a whole server — [09 §3.5](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P10.1].
 *
 * ***`router.test.ts` proves the routing and `runner.test.ts` proves the
 * runner's vocabulary; what neither can prove is the **wiring**.*** Every seam
 * this stage adds is optional by design — `dispatch` and `notify` on the runner,
 * `settled` on the rendition worker — so that existing test doubles stay
 * doubles. An optional seam nothing passes is a subsystem that is complete,
 * tested, and connected to nothing; `app.ts` is the only place that connects
 * them, and this is the only file that reads `app.ts`'s answer.
 *
 * ***The falsifying mutation is deleting a line from `buildServices`.*** Remove
 * `notify` from the `TurnRunner` options, or `settled` from the worker context,
 * and **every other test in this repository still passes** — including all
 * twenty-five in this directory. These go red.
 *
 * *`artifact.ready` is the interesting one*, because it is the producer
 * [P9 §1.5](../../../../docs/design/workplan/26-p9-implementation.md) specified
 * and [P9.2] did not write. The re-audit moved it here; this is where it is
 * shown to exist.
 */

const PASSWORD = 'correct horse battery';
const CHAT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a09';
const IMAGE = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a10';

/**
 * What the scripted `fast` model answers when asked what the picture is of.
 *
 * **Both fields are strings, and a null `anchor` is not the same thing as an
 * absent one** — `MOMENT_SCHEMA` declares `anchor: { type: 'string' }` with
 * `additionalProperties: false`, so `anchor: null` fails coercion, the subject
 * reads back empty, and the step holds with `no-moment`. *Measured: the first
 * draft of this file used `null` and every rendition assertion below was
 * vacuously true over an empty list.* The schema is right and the fixture was
 * wrong, which is worth a line here because the failure was silent.
 */
const MOMENT = JSON.stringify({ subject: 'a lantern on a wet quay', anchor: 'The road went on' });

let dataDir: string;
let server: TestServer;
let sessionId: string;
let counter = 0;
let head: string | null = null;

/** `p9-gate.test.ts`'s scaffolding, because a picture needs the same install. */
async function boot(images: object[]): Promise<void> {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p10-producers-'));
  counter = 0;
  head = null;
  const fake = new FakeProvider({
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

  // The head after the switch, not before it: a channel write is an effect and
  // an effect is carried by a turn, so turning illustration on moved the head.
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  head = (read.body as { session: { headTurnId: string | null } }).session.headTurnId;
}

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

async function takeATurn(): Promise<void> {
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

  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  head = (read.body as { session: { headTurnId: string | null } }).session.headTurnId;
}

async function renditionsOf(): Promise<Rendition[]> {
  const all = await readRenditions(server.services.sessions.layout, 'ned', sessionId);
  return [...all.values()];
}

function held(): ReturnType<typeof listNotifications> {
  return listNotifications(server.services.state.db, 'ned');
}

describe('a turn that ran through a whole server', () => {
  it('leaves a notification the person can come back to', async () => {
    await boot([{ stallMs: 20 }]);
    await takeATurn();

    // The turn's own, by class. The picture's arrives separately and is waited
    // for below rather than raced against here.
    //
    // **Waited for rather than read once**, because `takeATurn` returns when
    // the session's head has moved and this notification is written by a
    // producer reacting to the same completion — a different listener, so the
    // head moving does not mean the row is there yet. Reading once passed on an
    // unloaded machine and failed on the Windows runner and under a full-suite
    // run, which is the shape of every race this file has already paid for
    // twice below.
    await eventually(() => Promise.resolve(held().some((one) => one.class === 'turn.complete')));
    const completion = held().find((one) => one.class === 'turn.complete');
    expect(completion).toBeDefined();
    expect(completion?.params['sessionName']).toBe('The harbour');
    expect(completion?.sessionId).toBe(sessionId);
    expect(completion?.actionable).toBe(false);

    // Settled before teardown: a rendition job is fire-and-forget, so leaving
    // one in flight races `afterEach`'s `rm` — `p9-gate.test.ts`'s finding.
    await eventually(async () => {
      const all = await renditionsOf();
      // **Non-empty, and that clause is load-bearing**: `every` over an empty
      // list is true, which is how the first draft of this file waited
      // successfully for a picture that was never asked for.
      return all.length > 0 && all.every((one) => one.state !== 'pending');
    });
  });

  /**
   * ***The producer [P9] owed and did not write, arriving.*** A picture landing
   * is not the same news as a turn finishing: the turn's prose was there
   * seconds ago and the picture is what somebody has been waiting for.
   */
  it('tells the person when the picture lands, as its own notification', async () => {
    await boot([{ stallMs: 20 }]);
    await takeATurn();

    await eventually(async () => {
      const all = await renditionsOf();
      // **Non-empty, and that clause is load-bearing**: `every` over an empty
      // list is true, which is how the first draft of this file waited
      // successfully for a picture that was never asked for.
      return all.length > 0 && all.every((one) => one.state !== 'pending');
    });
    const tr = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    console.log(
      'STEPS',
      JSON.stringify((tr.body as { turns: { steps?: unknown }[] }).turns.map((x) => x.steps)),
    );
    console.log(
      'RENDITIONS',
      JSON.stringify((await renditionsOf()).map((r) => [r.state, r.purpose, r.error])),
    );
    console.log('NOTIFS', JSON.stringify(held().map((n) => [n.class, n.params])));
    await eventually(() => Promise.resolve(held().some((one) => one.class === 'artifact.ready')));

    const picture = held().find((one) => one.class === 'artifact.ready');
    expect(picture?.params['outcome']).toBe('ready');
    expect(picture?.params['purpose']).toBe('illustration');
    // A ready picture has nothing to do, so it is not actionable.
    expect(picture?.actionable).toBe(false);
    // Keyed on the turn rather than the session, so three pictures of one turn
    // would be one notification and two turns' pictures are two.
    expect(picture?.turnId).toBeTruthy();
  });

  /**
   * ***A picture that failed is the same subject in a different state*** —
   * which is why there is no fifth class, and why this one **is** actionable:
   * there is a retry button behind it.
   */
  it('says so when the picture fails, and makes that one actionable', async () => {
    await boot([{ error: { class: 'terminal', message: 'the endpoint said no' } }]);
    await takeATurn();

    await eventually(async () => {
      const all = await renditionsOf();
      return all.length > 0 && all.every((one) => one.state === 'failed');
    });
    await eventually(() => Promise.resolve(held().some((one) => one.class === 'artifact.ready')));

    const picture = held().find((one) => one.class === 'artifact.ready');
    expect(picture?.params['outcome']).toBe('failed');
    expect(picture?.actionable).toBe(true);

    // And the turn itself is still a completion: [06 §10.2]'s *a failed
    // rendition is a placeholder, never a failed turn*, now visible in the one
    // surface that could have got it wrong.
    expect(held().find((one) => one.class === 'turn.complete')).toBeDefined();
    expect(held().some((one) => one.class === 'turn.failed')).toBe(false);
  });
});
