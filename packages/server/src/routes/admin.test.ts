// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeTestServer,
  type RouteEntry,
  routesUnder,
  setUpAdmin,
  type TestServer,
} from '../test-server.js';

/**
 * Administration — [10 §15.2](../../../../docs/design/10-ui-surfaces.md),
 * [P2A §3](../../../../docs/design/workplan/09-p2a-configuration-surface.md) stage P2A.4.
 *
 * The stage's ending is three clauses: *every account operation [10 §15.2] names
 * is reachable, admin-only **by prefix rather than by remembering**, and no
 * admin can lock the install out.* The middle one is what the route-table test
 * below is for, and it is the reason that test enumerates Fastify's own routing
 * table instead of a list written here — a list of admin routes maintained by
 * hand is wrong the first time somebody adds one in a hurry, and it is wrong
 * silently.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

/** Signs in as an ordinary account, leaving the cookie jar holding its session. */
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

/** Every admin route, from Fastify rather than from a list — see . */
function adminRoutes(): RouteEntry[] {
  return routesUnder(server.app, '/api/admin');
}

describe('the route table', () => {
  it('has admin routes to guard, which is what makes the next test mean anything', () => {
    // Without this the sweep below passes on an empty list — the classic way a
    // "every route is protected" test survives every route disappearing.
    const routes = adminRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(5);
    expect(routes.map((route) => route.url)).toContain('/api/admin/accounts');
  });

  it('refuses a signed-in non-admin on every one of them, without naming any', async () => {
    await asUser();

    for (const route of adminRoutes()) {
      const response = await server.request({
        method: route.method,
        // A parameterised path needs *a* value; which one does not matter,
        // because the guard runs before the handler ever sees it.
        url: route.url.replace(':handle', 'ned'),
      });
      expect(response.status, `${route.method} ${route.url}`).toBe(403);
      expect(response.body.error, `${route.method} ${route.url}`).toBe('forbidden');
    }
  });

  it('refuses an anonymous caller with 401 rather than 403', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });

    for (const route of adminRoutes()) {
      const response = await server.request({
        method: route.method,
        url: route.url.replace(':handle', 'ned'),
      });
      // A different fact, so a different code: *nobody is signed in* is not
      // *you are not an administrator*.
      expect(response.status, `${route.method} ${route.url}`).toBe(401);
    }
  });
});

/**
 * **The order of the root hooks is a security property**, so it is asserted
 * rather than described — [P2A §2.4].
 *
 * Identity, CSRF and the setup gate run on the root instance; `adminOnly` is a
 * hook on an encapsulated plugin, so it runs after all three. The consequences
 * are testable and each one is a different sentence a client has to be able to
 * read.
 */
describe('what runs before the admin guard', () => {
  it('answers csrf, not forbidden, to a state-changing call with no token', async () => {
    await asUser();

    const response = await server.request({
      method: 'DELETE',
      url: '/api/admin/accounts/ned',
      skipCsrf: true,
    });

    // A non-admin *and* no token. Reporting `forbidden` here would tell a
    // client to go and find an administrator, when the real problem is that its
    // own request was malformed — and would mean the CSRF check had moved
    // behind an authorisation check, which is the wrong way round.
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('csrf');
  });

  it('answers setup-required before anything else, on a fresh install', async () => {
    const fresh = await makeTestServer();
    try {
      const response = await fresh.request({ method: 'GET', url: '/api/admin/accounts' });

      // 503, not 401: nothing in P2A joins `survivesSetupGate`, because a
      // settings surface before an admin exists is meaningless.
      expect(response.status).toBe(503);
      expect(response.body.error).toBe('setup-required');
    } finally {
      await fresh.dispose();
    }
  });
});

describe('the account list', () => {
  it('returns every account, which nothing called before this stage', async () => {
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });

    const response = await server.request({ method: 'GET', url: '/api/admin/accounts' });

    expect(response.status).toBe(200);
    expect(response.body.accounts.map((row: { handle: string }) => row.handle).sort()).toEqual([
      'mara',
      'ned',
    ]);
  });

  it('never carries a password hash or a salt', async () => {
    const response = await server.request({ method: 'GET', url: '/api/admin/accounts' });

    // `toPublic` strips both, and this is the assertion that notices if a
    // future field is added to `Account` and forgotten there.
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('salt');
  });
});

/**
 * **"2 users have no usable connection"** — [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md),
 * which commissioned that sentence and named this screen as where it appears.
 *
 * This is the clause the phase's demo turns on: *create an account, sign in as
 * them, change their password — and watch the admin list say plainly that they
 * still have no usable connection, because they do.* The surface earns its place
 * by reporting the dead end rather than leaving it to arrive as a bug report
 * from somebody who cannot send a message.
 */
describe('the dead-end summary', () => {
  async function seedSystemConnection(): Promise<void> {
    const root = server.services.layout.systemConnectionsRoot;
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, 'house.json'),
      JSON.stringify({
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a09',
        label: 'The house model',
        provider: 'openai-compatible',
        models: ['fake-hi'],
        apiKey: 'sk-house',
        baseUrl: 'https://example.invalid/v1',
      }),
    );
  }

  /**
   * The install defaults — the half the old count forgot existed.
   *
   * A connection with nothing bound to it is a key sitting on disk that no turn
   * will ever reach, and the whole of [P2B §4]'s correction is that those two
   * states have to be told apart.
   */
  async function seedSystemBindings(connectionId: string): Promise<void> {
    const root = server.services.layout.systemRoot;
    await mkdir(root, { recursive: true });
    await writeFile(
      server.services.layout.systemBindingsFile,
      JSON.stringify({ prose: { connectionId, modelId: 'fake-hi' } }),
    );
  }

  async function seedPersonalBindings(handle: string, connectionId: string): Promise<void> {
    await mkdir(server.services.layout.userRoot(handle), { recursive: true });
    await writeFile(
      join(server.services.layout.userRoot(handle), 'bindings.json'),
      JSON.stringify({ prose: { connectionId, modelId: 'fake-hi' } }),
    );
  }

  async function seedPersonalConnection(handle: string): Promise<void> {
    const root = server.services.layout.userConnectionsRoot(handle);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, 'mine.json'),
      JSON.stringify({
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a0a',
        label: 'My own',
        provider: 'openai-compatible',
        models: ['fake-hi'],
        apiKey: 'sk-mine',
        baseUrl: 'https://example.invalid/v1',
      }),
    );
  }

  it('counts everybody on a fresh install, because nobody can play yet', async () => {
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });

    const response = await server.request({ method: 'GET', url: '/api/admin/accounts' });

    expect(response.body.withoutUsableConnection).toBe(2);
    // Inline on the row too: a count in a heading with nothing to point at
    // leaves an admin counting rows themselves ([10 §15.4]).
    for (const row of response.body.accounts as AccountRow[]) {
      expect(row.hasUsableConnection).toBe(false);
    }
  });

  /**
   * **A key on disk that nothing points at is still a dead end**, and this is
   * the test the old count could not have.
   *
   * `deadEnds` counted `.json` files in `system/connections/`, so this exact
   * install — one system connection, no bindings anywhere — reported *zero
   * dead ends* while every turn failed `unbound`. That made
   * [P2B](../../../../docs/design/workplan/10-p2b-provider-configuration.md).4's stated ending
   * unable to witness itself: it would have gone green over an install nobody
   * could send a message on.
   *
   * Found by walking the gate as a checklist rather than by a failure — there
   * was nothing to go red.
   */
  it('is not cleared by a connection nothing is bound to', async () => {
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });
    await seedSystemConnection();

    const response = await server.request({ method: 'GET', url: '/api/admin/accounts' });

    expect(response.body.withoutUsableConnection).toBe(2);
    // And the second number still reports what it says it reports: there *is*
    // a system connection. The two facts are different and the warning's
    // second sentence turns on which one is true.
    expect(response.body.systemConnectionCount).toBe(1);
  });

  it('clears for everyone the moment the install binds one', async () => {
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });
    await seedSystemConnection();
    await seedSystemBindings('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a09');

    const response = await server.request({ method: 'GET', url: '/api/admin/accounts' });

    // One fix rather than n, which is the fact the heading's second number is
    // there to make obvious.
    expect(response.body.withoutUsableConnection).toBe(0);
    expect(response.body.systemConnectionCount).toBe(1);
  });

  /**
   * **A binding pointing at a connection that is gone is a dead end too**, and
   * it is a different one: `resolveRole` answers `dangling` rather than
   * `unbound`, and an admin who removed the key is the person who can fix it.
   *
   * Counting files could not see this either — the file is gone, so the count
   * was right for the wrong reason on a fresh install and wrong the moment a
   * *second* connection existed.
   */
  it('is not cleared by a binding whose connection was removed', async () => {
    await seedSystemConnection();
    await seedSystemBindings('a-connection-that-is-not-there');

    const response = await server.request({ method: 'GET', url: '/api/admin/accounts' });

    expect(response.body.withoutUsableConnection).toBe(1);
    expect(response.body.systemConnectionCount).toBe(1);
  });

  it('counts a personal connection, but only if the account may use one', async () => {
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });
    await seedPersonalConnection('mara');
    await seedPersonalBindings('mara', '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a0a');

    const usable = await server.request({ method: 'GET', url: '/api/admin/accounts' });
    expect(rowFor(usable.body, 'mara').hasUsableConnection).toBe(true);
    expect(usable.body.withoutUsableConnection).toBe(1);

    // Revoked: the file is still there and is no longer usable, so the account
    // is a dead end again — which is the state [09 §4.5] wants named rather
    // than discovered.
    await server.services.accounts.update('mara', {
      capabilities: { privateConnections: false },
    });

    const revoked = await server.request({ method: 'GET', url: '/api/admin/accounts' });
    expect(rowFor(revoked.body, 'mara').hasUsableConnection).toBe(false);
    expect(revoked.body.withoutUsableConnection).toBe(2);
  });

  /**
   * **Counts, never contents.** A connection stays opaque ([09 §4.5]) — an admin
   * who can enumerate another account's connections is one step from the
   * disclosure that document declines, and the warning needs a number rather
   * than a list.
   *
   * Asserted as the row's **exact key set**, not as the absence of particular
   * strings. The first draft checked that the API key, the label and the host
   * did not appear, and a mutation that put the connection *filenames* on the
   * row sailed through it — a filename is not a credential and is still an
   * enumeration of what somebody has configured. A closed key set fails on any
   * field that arrives, which is the only form of this claim that holds up
   * against a leak nobody thought of.
   *
   * Adding a field here should therefore be a deliberate act with this test
   * edited alongside it, which is the point.
   */
  it('carries the flag and nothing else about what anyone has configured', async () => {
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });
    await seedPersonalConnection('mara');

    const response = await server.request({ method: 'GET', url: '/api/admin/accounts' });

    for (const row of response.body.accounts as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual([
        'capabilities',
        'createdAt',
        'displayName',
        'enabled',
        'handle',
        'hasUsableConnection',
        'locale',
        'role',
      ]);
    }

    // And the belt as well as the braces, since these are the specific values
    // that must never travel: the key, the label, the host.
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('sk-mine');
    expect(serialised).not.toContain('My own');
    expect(serialised).not.toContain('example.invalid');
  });

  /**
   * **The admin list must not go down because of one person's file** — found by a
   * P2B adversarial review, and new to this phase in every case: before P2B.4
   * this page counted filenames and opened nothing.
   */
  describe('a hand-written file somebody got wrong', () => {
    async function seedBindingsFor(handle: string, document: unknown): Promise<void> {
      await mkdir(server.services.layout.userRoot(handle), { recursive: true });
      await writeFile(
        join(server.services.layout.userRoot(handle), 'bindings.json'),
        JSON.stringify(document),
      );
    }

    it('does not answer 500 for every admin because one binding is null', async () => {
      await server.services.accounts.create({
        handle: 'mara',
        password: 'another long password',
        role: 'user',
      });
      await seedSystemConnection();
      await seedSystemBindings('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a09');
      await seedBindingsFor('mara', { prose: null });

      const response = await server.request({ method: 'GET', url: '/api/admin/accounts' });

      expect(response.status).toBe(200);
      // And the install default still rescues her, because a layer that bound
      // nothing usable bound nothing at all.
      expect(rowFor(response.body, 'mara').hasUsableConnection).toBe(true);
      expect(rowFor(response.body, 'ned').hasUsableConnection).toBe(true);
    });

    it('does not answer 500 because a directory is named like a connection', async () => {
      await seedSystemConnection();
      await seedSystemBindings('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a09');
      await mkdir(join(server.services.layout.systemConnectionsRoot, 'notes.json'), {
        recursive: true,
      });

      const response = await server.request({ method: 'GET', url: '/api/admin/accounts' });

      expect(response.status).toBe(200);
      expect(response.body.withoutUsableConnection).toBe(0);
    });
  });
});

/**
 * One account's row, typed for what the tests actually read off it.
 *
 * Named fields rather than an index signature: the row *is* a known shape, and a
 * bag of unknowns would let a typo in a key name read as `undefined` and pass
 * every assertion silently.
 */
interface AccountRow {
  handle: string;
  role: string;
  enabled: boolean;
  hasUsableConnection: boolean;
}

function rowFor(body: { accounts: AccountRow[] }, handle: string): AccountRow {
  const row = body.accounts.find((entry) => entry.handle === handle);
  if (!row) throw new Error(`no row for ${handle}`);
  return row;
}

describe('creating, patching and removing', () => {
  it('creates an account whose directory exists and whose capabilities are the ones asked for', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/admin/accounts',
      payload: {
        handle: 'mara',
        password: 'another long password',
        role: 'user',
        capabilities: { privateConnections: false },
      },
    });

    expect(created.status).toBe(201);
    expect(created.body.account.capabilities.privateConnections).toBe(false);
    // The other two keep their defaults rather than being cleared by a partial.
    expect(created.body.account.capabilities.fileAccess).toBe('none');

    // Gate step 8: the library directory exists the moment the account does.
    const listed = await server.request({ method: 'GET', url: '/api/admin/accounts' });
    expect(rowFor(listed.body, 'mara').handle).toBe('mara');

    // And they can sign in with what was set.
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const login = await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'mara', password: 'another long password' },
    });
    expect(login.status).toBe(200);
  });

  it('refuses a duplicate handle with 409 rather than overwriting', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/admin/accounts',
      payload: { handle: 'ned', password: 'another long password', role: 'user' },
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('exists');
  });

  it('grants and revokes a capability without touching the others', async () => {
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });

    const patched = await server.request({
      method: 'PATCH',
      url: '/api/admin/accounts/mara',
      payload: { capabilities: { fileAccess: 'read' } },
    });

    expect(patched.status).toBe(200);
    expect(patched.body.account.capabilities).toEqual({
      privateConnections: true,
      fileAccess: 'read',
      enableExtensions: false,
      scheduledBackups: false,
    });
  });

  /**
   * **Disabling is `PATCH { enabled: false }` and needs no route of its own** —
   * [P2A §2.3]. Two verbs rather than one verb with a flag: a `keepData` switch
   * that turned a delete into a not-delete is exactly the shape that makes a
   * dangerous control feel routine.
   */
  it('disables an account, and its next request is 401 with its data intact', async () => {
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });

    // A second cookie jar against the same install — mara's browser, with a
    // live session in it. `server`'s own jar cannot stand in: `request` always
    // sends the cookies it is holding, so an explicit header is overwritten.
    const theirs = await makeTestServer({ dataDir: server.dataDir });
    try {
      const login = await theirs.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'mara', password: 'another long password' },
      });
      expect(login.status).toBe(200);

      await server.request({
        method: 'PATCH',
        url: '/api/admin/accounts/mara',
        payload: { enabled: false },
      });

      /**
       * Gate step 9. The cookie is still valid and still correctly signed; what
       * changed is the account behind it, which the identity hook re-reads on
       * every request rather than trusting what the cookie asserts.
       */
      const stale = await theirs.request({ method: 'GET', url: '/api/me' });
      expect(stale.status).toBe(401);

      // And their data is untouched — disabling is a lockout, not a deletion.
      expect(await server.services.accounts.find('mara')).not.toBeNull();
    } finally {
      await theirs.dispose();
    }
  });

  it('removes an account, and the handle is free again immediately', async () => {
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });

    const removed = await server.request({
      method: 'DELETE',
      url: '/api/admin/accounts/mara',
    });
    expect(removed.status).toBe(204);

    const recreated = await server.request({
      method: 'POST',
      url: '/api/admin/accounts',
      payload: { handle: 'mara', password: 'a third long password', role: 'user' },
    });
    expect(recreated.status).toBe(201);
  });

  /**
   * **An admin reset does not re-enable**, and here that is reachable rather
   * than theoretical — the admin is acting on somebody else, so nothing about
   * the identity hook gets in the way.
   *
   * `resetPassword` re-enables, which is right for the break-glass CLI where a
   * disabled account is the same lockout wearing a different hat. It is wrong
   * here: an admin who disabled somebody and then reset their password would
   * have undone the disablement by accident. Re-enabling is
   * `PATCH { enabled: true }`, a separate thing to decide and therefore a
   * separate thing to do.
   */
  it('resets a password without re-enabling a disabled account', async () => {
    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'user',
    });
    await server.request({
      method: 'PATCH',
      url: '/api/admin/accounts/mara',
      payload: { enabled: false },
    });

    const reset = await server.request({
      method: 'POST',
      url: '/api/admin/accounts/mara/password',
      payload: { newPassword: 'a replacement password' },
    });
    expect(reset.status).toBe(204);

    const listed = await server.request({ method: 'GET', url: '/api/admin/accounts' });
    expect(rowFor(listed.body, 'mara').enabled).toBe(false);

    // And the new password does not let them in either, because the lockout is
    // what is stopping them rather than the credential.
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const login = await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'mara', password: 'a replacement password' },
    });
    expect(login.status).toBe(401);
  });

  /**
   * The create body is closed for the same reason `/api/me`'s is: a field this
   * build does not know is **refused, not ignored**, because ignoring teaches a
   * client that it worked and the next version sends it on purpose.
   */
  it('refuses a field it does not know, and names it', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/admin/accounts',
      payload: {
        handle: 'mara',
        password: 'another long password',
        role: 'user',
        isSuperuser: true,
      },
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('isSuperuser');

    // And nothing was created, so a client cannot half-succeed.
    const listed = await server.request({ method: 'GET', url: '/api/admin/accounts' });
    expect(listed.body.accounts.map((row: { handle: string }) => row.handle)).toEqual(['ned']);
  });

  it('refuses a password shorter than this install accepts', async () => {
    // Untested while it was a `minLength: 8` literal, and worth having now that
    // the rule moved into the handler: both admin routes have to consult the
    // same setting, and neither had anything watching it.
    const response = await server.request({
      method: 'POST',
      url: '/api/admin/accounts',
      payload: { handle: 'mara', password: 'short', role: 'user' },
    });

    expect(response.status).toBe(400);
    expect(response.body.issues[0].path).toBe('/password');

    const listed = await server.request({ method: 'GET', url: '/api/admin/accounts' });
    expect(listed.body.accounts.map((row: { handle: string }) => row.handle)).toEqual(['ned']);
  });

  it('refuses a short password on a reset too', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/admin/accounts/ned/password',
      payload: { newPassword: 'short' },
    });

    expect(response.status).toBe(400);
    expect(response.body.issues[0].path).toBe('/newPassword');
    // The old password still works, so a refusal did not half-apply.
    expect(
      await server.services.accounts.authenticate('ned', 'correct horse battery'),
    ).not.toBeNull();
  });

  it('refuses a capability it does not know the same way', async () => {
    const response = await server.request({
      method: 'PATCH',
      url: '/api/admin/accounts/ned',
      payload: { capabilities: { mayDoAnything: true } },
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('mayDoAnything');
  });

  it('answers 404 for a handle that is not there', async () => {
    const response = await server.request({
      method: 'PATCH',
      url: '/api/admin/accounts/nobody',
      payload: { displayName: 'x' },
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('not-found');
  });
});

/**
 * **No admin can lock the install out** — the stage's third ending clause, and
 * gate step 10.
 *
 * The store owns the predicate, one check covering all three gestures; what
 * these assert is that the route reports it as a state rather than as a
 * permission or a malformed request, and that nothing landed.
 */
describe('the last usable admin, through the API', () => {
  it('cannot be demoted, disabled or removed, and says why each time', async () => {
    const attempts: { method: 'PATCH' | 'DELETE'; payload?: unknown }[] = [
      { method: 'PATCH', payload: { role: 'user' } },
      { method: 'PATCH', payload: { enabled: false } },
      { method: 'DELETE' },
    ];

    for (const attempt of attempts) {
      const response = await server.request({
        method: attempt.method,
        url: '/api/admin/accounts/ned',
        ...(attempt.payload === undefined ? {} : { payload: attempt.payload }),
      });

      /**
       * **409, not 403 and not 400.** The request is well formed and the caller
       * is permitted — an admin may demote an admin, just not the last one — so
       * what refuses it is the state of the install. 403 would say *you may
       * not*, which is a different and wrong sentence to put in front of
       * somebody who is about to go and promote a second administrator.
       */
      expect(response.status, JSON.stringify(attempt)).toBe(409);
      expect(response.body.error).toBe('last-admin');
      expect(response.body.message).toContain('administrator');
    }

    // And after all three, nothing moved.
    const listed = await server.request({ method: 'GET', url: '/api/admin/accounts' });
    expect(rowFor(listed.body, 'ned')).toMatchObject({ role: 'admin', enabled: true });
  });

  it('steps aside once somebody else can administer', async () => {
    await server.request({
      method: 'POST',
      url: '/api/admin/accounts',
      payload: { handle: 'mara', password: 'another long password', role: 'admin' },
    });

    const demoted = await server.request({
      method: 'PATCH',
      url: '/api/admin/accounts/ned',
      payload: { role: 'user' },
    });

    expect(demoted.status).toBe(200);
    expect(demoted.body.account.role).toBe('user');
  });
});
