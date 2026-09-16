// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The notification surface, through HTTP — [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md), [P10.1].
 *
 * ***`router.test.ts` proves the routing and this proves the door***, which is
 * a different claim and the one a household server is actually exposed to.
 * There the account is an argument; here it comes from a session cookie, and
 * the property being asserted is that **there is no other way to name one**.
 * A route that took a handle would satisfy every test in the other file and
 * hand one person another person's inbox.
 *
 * **Two accounts throughout**, because a per-user claim asserted with one
 * account is a claim about nothing: an implementation that ignored the account
 * entirely would pass it.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

/** Signs in as a second, ordinary account — `admin.test.ts`'s helper. */
async function asUser(handle = 'mara'): Promise<void> {
  await server.services.accounts.create({
    handle,
    password: 'another long password',
    role: 'user',
  });
  await server.request({ method: 'POST', url: '/api/auth/logout' });
  await server.request({
    method: 'POST',
    url: '/api/auth/login',
    payload: { handle, password: 'another long password' },
  });
}

/**
 * The running config with one leaf changed — the shape the settings form
 * submits, borrowed from `config.test.ts`.
 */
function withChange(path: string, value: unknown): Record<string, unknown> {
  const config = structuredClone(server.services.config) as Record<string, unknown>;
  const parts = path.split('.');
  const last = parts.pop() ?? '';
  let node = config;
  for (const part of parts) node = node[part] as Record<string, unknown>;
  node[last] = value;
  return config;
}

/** A turn finished, said the way a producer says it. */
function finished(account: string, sessionId: string): void {
  server.services.notify({
    kind: 'turn.complete',
    account,
    sessionId,
    turnId: `t-${sessionId}`,
    sessionName: 'The harbour',
  });
}

describe('GET /api/me/notifications', () => {
  it('answers with this account’s notifications and its unread count', async () => {
    finished('ned', 's-1');
    finished('mara', 's-2');

    const response = await server.request({ method: 'GET', url: '/api/me/notifications' });

    expect(response.status).toBe(200);
    expect(response.body.notifications).toHaveLength(1);
    expect(response.body.unread).toBe(1);
    expect(response.body.notifications[0].class).toBe('turn.complete');
    expect(response.body.notifications[0].params).toEqual({ sessionName: 'The harbour' });
  });

  /**
   * ***The claim [P10 §0] names as this phase's CI obligation***, at the layer
   * where it can actually be violated: *user A's turn never produces an event
   * addressed to user B*.
   */
  it('never shows one person another person’s notifications', async () => {
    finished('ned', 's-1');
    finished('ned', 's-2');
    await asUser();

    const response = await server.request({ method: 'GET', url: '/api/me/notifications' });

    expect(response.body.notifications).toEqual([]);
    expect(response.body.unread).toBe(0);
  });

  it('filters to the unread when asked', async () => {
    finished('ned', 's-1');
    finished('ned', 's-2');
    const list = await server.request({ method: 'GET', url: '/api/me/notifications' });
    await server.request({
      method: 'POST',
      url: '/api/me/notifications/read',
      payload: { ids: [list.body.notifications[0].id] },
    });

    const unread = await server.request({
      method: 'GET',
      url: '/api/me/notifications?unread=true',
    });
    expect(unread.body.notifications).toHaveLength(1);
    expect(unread.body.unread).toBe(1);
  });

  it('refuses a signed-out caller', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const response = await server.request({ method: 'GET', url: '/api/me/notifications' });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/me/notifications/read', () => {
  it('marks them all when no ids are named', async () => {
    finished('ned', 's-1');
    finished('ned', 's-2');

    const response = await server.request({
      method: 'POST',
      url: '/api/me/notifications/read',
      payload: {},
    });

    expect(response.body).toEqual({ read: 2, unread: 0 });
  });

  /**
   * *A no-op rather than an error*, which is the posture every per-account
   * write here takes: the account is in the `where` clause, so a wrong id
   * changes nothing instead of changing the wrong row — and the answer does not
   * say whether that id exists.
   */
  it('cannot mark somebody else’s notification read', async () => {
    finished('ned', 's-1');
    const mine = await server.request({ method: 'GET', url: '/api/me/notifications' });
    const id = mine.body.notifications[0].id as string;

    await asUser();
    const response = await server.request({
      method: 'POST',
      url: '/api/me/notifications/read',
      payload: { ids: [id] },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ read: 0, unread: 0 });
  });

  it('refuses a body it does not recognise', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/me/notifications/read',
      payload: { account: 'mara' },
    });
    // `additionalProperties: false` is the refusal: stripping the field and
    // answering 200 would teach a client that naming an account worked.
    expect(response.status).toBe(400);
  });
});

describe('the restart notice reaches the admins', () => {
  /**
   * ***[09 §3.4]'s *"admin warnings specified with nowhere to be delivered"*,
   * delivered.*** The producer is the settings save, and the notice is
   * addressed to the **install's** admins rather than to whoever pressed Save:
   * the keys stay pending until somebody restarts, and an admin who was not at
   * the keyboard is exactly the person who needs telling.
   */
  it('notifies an admin when a saved key needs a restart', async () => {
    // `server.host` is a `restart` key; changing it can only take effect on one.
    const save = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('server.host', '0.0.0.0') },
    });
    expect(save.status).toBe(200);
    expect(save.body.pendingRestart).toContain('server.host');

    const held = await server.request({ method: 'GET', url: '/api/me/notifications' });
    const notice = held.body.notifications.find(
      (one: { class: string }) => one.class === 'system.notice',
    ) as { actionable: boolean; params: Record<string, unknown> } | undefined;

    expect(notice?.actionable).toBe(true);
    expect(notice?.params['notice']).toBe('restart-required');
    // The keys themselves, because [09 §6.3] says a bare "restart required"
    // invites people to restart and hope. Space-joined so a client re-joins
    // them in its own punctuation — a config key cannot contain a space.
    expect(String(notice?.params['keys']).split(' ')).toContain('server.host');
  });

  it('says nothing when a save changed only live keys', async () => {
    const save = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });
    expect(save.body.pendingRestart).toEqual([]);

    const held = await server.request({ method: 'GET', url: '/api/me/notifications' });
    expect(held.body.notifications).toEqual([]);
  });

  it('does not notify a non-admin', async () => {
    await asUser();
    // Back to the admin to make the save, then to the user to read.
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ned', password: 'correct horse battery' },
    });
    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('server.host', '0.0.0.0') },
    });

    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'mara', password: 'another long password' },
    });

    const held = await server.request({ method: 'GET', url: '/api/me/notifications' });
    expect(held.body.notifications).toEqual([]);
  });
});
