// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveConnections } from '../providers/connections.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * *Your* connections — [10 §15.1](../../../../docs/design/10-ui-surfaces.md),
 * [19 §5.1](../../../../docs/design/19-tech-stack.md),
 * [P2B §2.7](../../../../docs/design/workplan/10-p2b-provider-configuration.md),
 * [P10.3].
 *
 * ***The sentence this surface exists for*** is [19 §5.1]'s: *"anyone who wants
 * their own key overrides a role without the admin's involvement."* Until this
 * stage the only way to exercise it was to write a JSON file by hand into a
 * directory nothing in the UI mentioned — the reader has existed since P2A and
 * the writer did not, deliberately, because a personal surface built before the
 * `privateConnections` check was real would have been [09 §4.5]'s *"trivial
 * bypass, wearing a UI"*.
 *
 * ***What `connections.test.ts` proves about these routes is the guard***: that
 * they are refused without the capability, and that they are on its exemption
 * table with a probe rather than by having been forgotten. What this file proves
 * is that they **work**, that one person's directory is only ever their own, and
 * that a connection written here is one the resolver reaches.
 *
 * **The falsifying mutation is pointing the writer at `systemConnectionsRoot`.**
 * Every round-trip assertion still passes — the list reads back, the key stays
 * in — and the isolation test goes red, along with a household server quietly
 * sharing one person's API key with everybody.
 */

let server: TestServer;

const MINE = {
  label: 'My own key',
  provider: 'openai-compatible',
  apiKey: 'sk-mine-and-never-yours',
  baseUrl: 'https://api.mine.example/v1',
  models: ['local-hi'],
};

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

async function createMine(over: Record<string, unknown> = {}): Promise<{
  id: string;
  contentHash: string;
}> {
  const response = await server.request({
    method: 'POST',
    url: '/api/me/connections',
    payload: { ...MINE, ...over },
  });
  if (response.status !== 201) {
    throw new Error(`create failed: ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  return {
    id: response.body.connection.id as string,
    contentHash: response.body.connection.contentHash as string,
  };
}

describe('a person’s own connections', () => {
  it('round-trips without the key ever coming back', async () => {
    const { id } = await createMine();

    const listed = await server.request({ method: 'GET', url: '/api/me/connections' });

    expect(listed.body.connections).toHaveLength(1);
    expect(listed.body.connections[0]).toMatchObject({
      id,
      label: 'My own key',
      // **`user`, which is the load-bearing field.** It is what
      // `resolveConnections` uses to put personal ahead of system, and it is
      // written by the reader from the directory rather than by the body — so a
      // route pointed at the wrong root could not fake it.
      scope: 'user',
      hasKey: true,
    });
    expect(JSON.stringify(listed.body)).not.toContain('sk-mine-and-never-yours');
  });

  /**
   * ***The claim a household server rests on***, and the one the falsifying
   * mutation above breaks silently: two people, two directories, and neither
   * list is the other's.
   */
  it('never shows one person another person’s connections', async () => {
    await createMine();
    await asUser();

    const theirs = await server.request({ method: 'GET', url: '/api/me/connections' });
    expect(theirs.body.connections).toEqual([]);

    // And a create of their own does not reach back the other way.
    await createMine({ label: 'Hers' });
    const listed = await server.request({ method: 'GET', url: '/api/me/connections' });
    expect(listed.body.connections).toHaveLength(1);
    expect(listed.body.connections[0].label).toBe('Hers');
  });

  /**
   * **An id that exists in the *system* scope is a 404 here, not a route into
   * it.** Both scopes share one presenter and one body schema, which is what
   * makes the stale check worth proving is reading the right directory.
   */
  it('refuses to edit a connection that is not in this person’s scope', async () => {
    const systemOne = await server.request({
      method: 'POST',
      url: '/api/admin/connections',
      payload: { ...MINE, label: 'The house key' },
    });
    const id = systemOne.body.connection.id as string;

    const refused = await server.request({
      method: 'PUT',
      url: `/api/me/connections/${id}`,
      payload: { ...MINE, contentHash: systemOne.body.connection.contentHash as string },
    });

    expect(refused.status).toBe(404);
    // And the system one is untouched.
    const still = await server.request({ method: 'GET', url: '/api/admin/connections' });
    expect(still.body.connections[0].label).toBe('The house key');
  });

  it('edits under a hash, and refuses a stale one', async () => {
    const { id, contentHash } = await createMine();

    const edited = await server.request({
      method: 'PUT',
      url: `/api/me/connections/${id}`,
      payload: { ...MINE, label: 'Renamed', contentHash },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.connection).toMatchObject({ label: 'Renamed', hasKey: true });

    // The same hash a second time is the form saving twice from one read, which
    // is what the guard is for — [P2B §6], and here the other writer is a text
    // editor in the person's own directory.
    const stale = await server.request({
      method: 'PUT',
      url: `/api/me/connections/${id}`,
      payload: { ...MINE, label: 'Again', contentHash },
    });
    expect(stale.status).toBe(412);
    expect(stale.body.error).toBe('stale');
  });

  it('deletes, and says so for an id that is not there', async () => {
    const { id } = await createMine();

    expect(
      (await server.request({ method: 'DELETE', url: `/api/me/connections/${id}` })).status,
    ).toBe(204);
    expect(
      (await server.request({ method: 'GET', url: '/api/me/connections' })).body.connections,
    ).toEqual([]);

    const missing = await server.request({ method: 'DELETE', url: `/api/me/connections/${id}` });
    expect(missing.status).toBe(404);
  });
});

describe('what the resolver then sees', () => {
  /**
   * ***The point of the whole surface, asserted against the resolver rather
   * than against the route.*** A form that wrote a file the turn pipeline never
   * looked at would pass every test above — so this asks
   * `resolveConnections` the question a turn asks, and checks that what came
   * back is **first**, which is [19 §5.1]'s *"overrides a role"* in the only
   * form the code has: personal ahead of system in `usable`.
   */
  it('puts a personal connection ahead of the install’s', async () => {
    await server.request({
      method: 'POST',
      url: '/api/admin/connections',
      payload: { ...MINE, label: 'The house key' },
    });
    await createMine({ label: 'My own key' });

    const { usable } = await resolveConnections(server.services.layout, 'ned', {
      privateConnections: true,
    });

    expect(usable.map((one) => one.label)).toEqual(['My own key', 'The house key']);
    expect(usable[0]?.scope).toBe('user');
  });

  /**
   * ***And the capability is enforced where [09 §4.5] says it is.*** Withdrawing
   * it does not delete anything — [P2B]'s *"revoking disables, never deletes"* —
   * it stops the file resolving, which is the check a UI could not be trusted
   * with.
   */
  it('stops resolving it when the capability goes, without losing it', async () => {
    await createMine();

    const { usable, disabled } = await resolveConnections(server.services.layout, 'ned', {
      privateConnections: false,
    });

    expect(usable).toEqual([]);
    expect(disabled.map((one) => one.label)).toEqual(['My own key']);
  });
});
