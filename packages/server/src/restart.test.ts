// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeProvider } from './providers/fake.js';
import { readJob } from './state/jobs.js';
import { Layout } from './storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from './test-server.js';

/**
 * *Restart now*, and the two things [09 §6.4](../../../docs/design/09-server-multiuser-deployment.md)
 * says it must not do naively — [P10 §1.6], [P10.3].
 *
 * ***The control is a trap or it is a feature, and the difference is entirely
 * in the preconditions.*** *"A bare `node server.js` will simply exit and the
 * admin who clicked the button now has no server and possibly no shell"* — so
 * the refusal is the first thing asserted here, and the surface not offering it
 * is deliberately **not** what makes it safe: `SettingsPage`'s *absent is
 * absent* is a courtesy, and this is the check.
 *
 * **The falsifying mutation is exiting before the drain.** Every assertion about
 * the route answering still passes; what goes red is *a turn in flight is waited
 * for*, which is the whole of §6.4's second precondition.
 *
 * *`exit` is a seam* for the reason every seam in `app.ts` exists: a test that
 * exercised this against `process.exit` would end the test runner.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

describe('where nothing would bring the process back', () => {
  it('says so, and says so as a state rather than a permission', async () => {
    // The default for a test harness, and for a bare `node server.js`.
    expect(server.services.supervision).toEqual({ supervised: false, how: 'none' });

    const refused = await server.request({ method: 'POST', url: '/api/admin/restart' });

    // 409 rather than 403: the caller is an admin and is permitted. What is
    // wrong is the install, and `forbidden` would send them looking for a
    // permission nobody can grant.
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('unsupervised');
  });

  it('tells the surface not to offer it', async () => {
    const notices = await server.request({ method: 'GET', url: '/api/admin/notices' });

    expect(notices.body.canRestart).toBe(false);
    expect(notices.body.supervision).toBe('none');
  });
});

describe('where something would', () => {
  beforeEach(() => {
    server.services.supervision = { supervised: true, how: 'declared' };
  });

  /**
   * **`exit` null is the other refusal**, and it is the honest answer for a
   * build that embeds the app rather than running it — every test harness, and
   * anything that calls `buildApp` itself.
   */
  it('still refuses when nothing can end the process', async () => {
    const refused = await server.request({ method: 'POST', url: '/api/admin/restart' });

    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('unavailable');
  });

  it('accepts, drains, and then exits', async () => {
    const exit = vi.fn();
    server.services.exit = exit;

    const accepted = await server.request({ method: 'POST', url: '/api/admin/restart' });

    // 202: the work is accepted rather than done, and this response is the last
    // thing the process sends.
    expect(accepted.status).toBe(202);
    await eventually(() => Promise.resolve(exit.mock.calls.length > 0));
  });

  /**
   * ***[09 §6.4]'s *"refuse new turns"*, at the one door it has to be refused
   * at.*** A drain waits for what is in flight, which is pointless if a turn
   * can start while it waits.
   */
  it('refuses a turn submitted while it is draining', async () => {
    server.services.exit = vi.fn();
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'The harbour' },
    });
    const sessionId = (created.body as { session: { id: string } }).session.id;

    await server.request({ method: 'POST', url: '/api/admin/restart' });

    const refused = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k-1', headTurnId: null, input: { text: 'Look around.' } },
    });

    expect(refused.status).toBe(503);
    expect(refused.body.error).toBe('restarting');
    // A client that reconnects is doing the right thing rather than retrying
    // into a wall, so it is told roughly when.
    expect(refused.headers['retry-after']).toBe('10');
  });

  /**
   * ***The claim the whole stage rests on***, and the one the falsifying
   * mutation above breaks: [09 §6.4]'s *"wait for in-flight ones within a
   * timeout"*. A restart that exited immediately would pass every other test in
   * this file and lose somebody's turn — which [C4] records as failed rather
   * than resumed, and §6.4 calls *"survivable but rude when self-inflicted"*.
   *
   * **Driven through a real turn rather than a stub**, because what is being
   * asserted is that the drain observes the runner: a slow provider means the
   * turn is genuinely still going when the button is pressed.
   */
  it('waits for a turn already running before it exits', async () => {
    const exit = vi.fn();
    const fake = new FakeProvider({
      script: [{ text: 'a slow answer', chunks: 6, chunkDelayMs: 40 }],
    });
    const slow = await makeTestServer({ providers: () => fake });
    try {
      await setUpAdmin(slow, 'ned');
      slow.services.supervision = { supervised: true, how: 'declared' };
      slow.services.exit = exit;

      const connections = new Layout(slow.dataDir).userConnectionsRoot('ned');
      await mkdir(connections, { recursive: true });
      await writeFile(
        join(connections, 'chat.json'),
        JSON.stringify({
          id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a09',
          label: 'The double',
          provider: 'openai-compatible',
          models: ['fake-hi'],
        }),
      );
      await writeFile(
        join(slow.dataDir, 'users', 'ned', 'bindings.json'),
        JSON.stringify({
          prose: { connectionId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a09', modelId: 'fake-hi' },
        }),
      );

      const created = await slow.request({
        method: 'POST',
        url: '/api/sessions',
        payload: { name: 'The harbour' },
      });
      const sessionId = (created.body as { session: { id: string } }).session.id;

      const submitted = await slow.request({
        method: 'POST',
        url: `/api/sessions/${sessionId}/turns`,
        payload: { idempotencyKey: 'k-1', headTurnId: null, input: { text: 'Look around.' } },
      });
      expect(submitted.status).toBe(202);
      const jobId = (submitted.body as { jobId: string }).jobId;

      // Running, not merely reserved: the drain has something to wait for.
      await eventually(() =>
        Promise.resolve(readJob(slow.services.state.db, jobId)?.status === 'running'),
      );

      await slow.request({ method: 'POST', url: '/api/admin/restart' });
      // Still going, and nothing has exited.
      expect(readJob(slow.services.state.db, jobId)?.finishedAt).toBeNull();
      expect(exit).not.toHaveBeenCalled();

      await eventually(() => Promise.resolve(exit.mock.calls.length > 0));
      // And the turn it waited for is committed rather than abandoned.
      expect(readJob(slow.services.state.db, jobId)?.status).toBe('committed');
    } finally {
      await slow.dispose().catch(() => undefined);
    }
  });

  it('refuses a second restart rather than draining twice', async () => {
    server.services.exit = vi.fn();
    await server.request({ method: 'POST', url: '/api/admin/restart' });

    const again = await server.request({ method: 'POST', url: '/api/admin/restart' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already-restarting');
  });
});

describe('what the confirmation is allowed to say', () => {
  /**
   * ***"2 other users have active sessions" is [09 §6.4]'s example*** and the
   * split is the point: an admin restarting during their **own** turn has made
   * an informed choice about their own story.
   *
   * **Counts, never contents** — [09 §4.5]'s rule, and the reason the body
   * carries two numbers rather than a list of handles.
   */
  it('counts what is in flight, mine apart from everybody else’s', async () => {
    const notices = await server.request({ method: 'GET', url: '/api/admin/notices' });

    expect(notices.body.interrupts).toEqual({ mine: 0, others: 0 });
    // And no names anywhere in it, which is the claim that would quietly stop
    // being true if somebody made this more helpful.
    expect(JSON.stringify(notices.body)).not.toContain('handle');
  });
});
