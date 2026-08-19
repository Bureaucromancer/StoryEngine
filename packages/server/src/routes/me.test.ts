// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The user half of the settings surface — [05 §15.1](../../../../docs/design/05-ui-surfaces.md),
 * [P2A §3](../../../../docs/design/workplan/13-p2a-configuration-surface.md) stage P2A.2.
 *
 * The stage's ending is one sentence: *a signed-in person changes their display
 * name, locale and password through the API, cannot change their role by asking,
 * and a preference survives a move to another browser.* Each clause is a test
 * here, and the middle one is the sharp one.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

describe('PATCH /api/me', () => {
  it('changes the display name and the locale', async () => {
    const response = await server.request({
      method: 'PATCH',
      url: '/api/me',
      payload: { displayName: 'Ned C.', locale: 'en-GB' },
    });

    expect(response.status).toBe(200);
    expect(response.body.account).toMatchObject({ displayName: 'Ned C.', locale: 'en-GB' });

    // Read back through a second request, so the claim is that it persisted
    // rather than that one handler echoed its own input.
    const read = await server.request({ method: 'GET', url: '/api/me' });
    expect(read.body.account).toMatchObject({ displayName: 'Ned C.', locale: 'en-GB' });
  });

  it('accepts a null locale, which means no preference', async () => {
    await server.request({ method: 'PATCH', url: '/api/me', payload: { locale: 'en-GB' } });

    const cleared = await server.request({
      method: 'PATCH',
      url: '/api/me',
      payload: { locale: null },
    });

    // Distinct from `""`, and from omitting the field — this is the state a
    // person picks when they want the browser's.
    expect(cleared.body.account.locale).toBeNull();
  });

  /**
   * **Refused, not ignored** — the stage's own test, and gate step 3.
   *
   * Stripping the field and answering 200 would be worse than either accepting
   * or refusing it, because it teaches a client that the request worked. The
   * next version of that client sends the field on purpose, and the version
   * after that depends on it.
   *
   * The 400 has to *name* the field for the same reason: a bare "invalid" leaves
   * the client author guessing which of four keys was the problem.
   */
  it('refuses a role in the body, and names it', async () => {
    const response = await server.request({
      method: 'PATCH',
      url: '/api/me',
      payload: { displayName: 'Ned C.', role: 'admin' },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid');
    expect(JSON.stringify(response.body)).toContain('role');

    // And nothing landed — not even the valid field beside it, which would
    // leave the caller's view half-applied.
    const read = await server.request({ method: 'GET', url: '/api/me' });
    expect(read.body.account.role).toBe('admin');
    expect(read.body.account.displayName).toBe('ned');
  });

  it('refuses an enabled flag and a capability record the same way', async () => {
    for (const payload of [{ enabled: false }, { capabilities: { privateConnections: true } }]) {
      const response = await server.request({ method: 'PATCH', url: '/api/me', payload });
      expect(response.status).toBe(400);
    }
  });

  it('needs a session', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });

    const response = await server.request({
      method: 'PATCH',
      url: '/api/me',
      payload: { displayName: 'x' },
    });

    expect(response.status).toBe(401);
  });
});

describe('POST /api/me/password', () => {
  it('replaces the password: the new one logs in and the old one does not', async () => {
    const changed = await server.request({
      method: 'POST',
      url: '/api/me/password',
      payload: { currentPassword: 'correct horse battery', newPassword: 'a different long one' },
    });
    expect(changed.status).toBe(204);

    await server.request({ method: 'POST', url: '/api/auth/logout' });

    const stale = await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ned', password: 'correct horse battery' },
    });
    expect(stale.status).toBe(401);

    const fresh = await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ned', password: 'a different long one' },
    });
    expect(fresh.status).toBe(200);
  });

  /**
   * Gate step 4. **401 rather than 403**: the fact being reported is that a
   * credential did not check out, which is what 401 means — and
   * `invalid-credentials` is the same class login sends, because it is the same
   * event.
   */
  it('refuses the wrong current password, and does not change anything', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/me/password',
      payload: { currentPassword: 'not my password', newPassword: 'a different long one' },
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('invalid-credentials');

    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const login = await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ned', password: 'correct horse battery' },
    });
    expect(login.status).toBe(200);
  });

  it('will not accept a new password too short to be one', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/me/password',
      payload: { currentPassword: 'correct horse battery', newPassword: 'short' },
    });

    expect(response.status).toBe(400);
  });
});

/**
 * Preferences — [06 B13](../../../../docs/design/06-open-questions.md), through the route.
 *
 * The store's own tests cover the merge, the deletion and the queue. What is
 * only checkable here is the claim the stage ends on: **a preference survives a
 * move to another browser**, which is precisely the property `localStorage`
 * cannot have and the reason B13 chose a file.
 */
describe('/api/me/prefs', () => {
  it('is empty before anything is stored', async () => {
    const response = await server.request({ method: 'GET', url: '/api/me/prefs' });

    expect(response.status).toBe(200);
    expect(response.body.prefs).toEqual({});
  });

  it('stores a preference and hands it back to a different client', async () => {
    await server.request({
      method: 'PATCH',
      url: '/api/me/prefs',
      payload: { 'library.density': 'compact' },
    });

    // A second cookie jar against the same server — a different browser, which
    // is the whole claim. `localStorage` would have nothing to return here.
    const elsewhere = await makeTestServer({ dataDir: server.dataDir });
    try {
      const login = await elsewhere.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'ned', password: 'correct horse battery' },
      });
      expect(login.status).toBe(200);

      const read = await elsewhere.request({ method: 'GET', url: '/api/me/prefs' });
      expect(read.body.prefs).toEqual({ 'library.density': 'compact' });
    } finally {
      await elsewhere.dispose();
    }
  });

  /**
   * **B13's rot-quietly position, asserted rather than described.**
   *
   * The server does not know what a preference means, and a newer client must
   * be able to store one an older server has never heard of. A schema here is
   * the one answer B13 ruled out, and this is what would fail if somebody added
   * one.
   */
  it('stores a key it has never heard of, and returns it unchanged', async () => {
    const exotic = { 'workbench.blocktable.columns': ['source', { width: 3 }] };

    const response = await server.request({
      method: 'PATCH',
      url: '/api/me/prefs',
      payload: exotic,
    });

    expect(response.status).toBe(200);
    expect(response.body.prefs).toEqual(exotic);
  });

  it('refuses a key that is not a preference key, in the API vocabulary', async () => {
    const response = await server.request({
      method: 'PATCH',
      url: '/api/me/prefs',
      payload: { notNamespaced: 1 },
    });

    // The store's bounds reported as an ordinary 400 — bounds, not validation,
    // and the client cannot tell the difference from a mistyped key.
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid');
  });

  it('does not reach another account', async () => {
    await server.request({
      method: 'PATCH',
      url: '/api/me/prefs',
      payload: { 'library.density': 'compact' },
    });

    // No admin routes until P2A.4, so the second account is made through the
    // store and signed into the ordinary way.
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'mara', password: 'another long password' },
    });

    const theirs = await server.request({ method: 'GET', url: '/api/me/prefs' });
    expect(theirs.body.prefs).toEqual({});
  });
});
