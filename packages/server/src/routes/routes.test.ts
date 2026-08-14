// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newLorebook } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The HTTP surface — docs/design/19-p1-implementation.md §P1.5.
 *
 * The claims worth testing here are the ones that are properties of the *write
 * path* rather than of the UI: read-after-write, the stale-hash rejection, and
 * the fact that a route never takes a handle.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
});

afterEach(async () => {
  await server.dispose();
});

describe('first-run setup gates everything', () => {
  it('refuses the library until an admin exists', async () => {
    // [04 §5.1](docs/design/04-server-multiuser-deployment.md): until an admin
    // account exists, every route except setup reports that setup is needed.
    // Combined with the loopback default this closes the window in which anyone
    // on the network could claim the install.
    const response = await server.request({ method: 'GET', url: '/api/library' });
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('setup-required');
  });

  it('reports that setup is required without a session', async () => {
    const response = await server.request({ method: 'GET', url: '/api/auth/state' });
    expect(response.body).toMatchObject({ setupRequired: true, account: null });
  });

  it('creates the first admin and signs them in', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { handle: 'ned', password: 'correct horse battery' },
    });

    expect(response.status).toBe(201);
    expect(response.body.account).toMatchObject({ handle: 'ned', role: 'admin', enabled: true });
    // The Capabilities record is written now even though nothing enforces it —
    // it is a persisted shape, and adding one later is a migration over user
    // data ([15 §2.1](docs/design/15-work-plan.md)).
    expect(response.body.account.capabilities).toEqual({
      privateConnections: true,
      fileAccess: 'none',
      enableExtensions: false,
    });
    // Never over the wire, not even to the admin who just set the password.
    expect(response.body.account).not.toHaveProperty('passwordHash');
    expect(response.body.account).not.toHaveProperty('salt');
  });

  it('refuses a second setup', async () => {
    await setUpAdmin(server);
    const again = await server.request({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { handle: 'intruder', password: 'correct horse battery' },
    });
    expect(again.status).toBe(409);
  });

  it('creates the user library directory eagerly', async () => {
    // `ls data/users/ned/library/actors/` is step 3 of the P1 exit gate, and it
    // should not require having saved something first.
    await setUpAdmin(server);
    const listing = server.services.layout.libraryRoot({ kind: 'user', handle: 'ned' });
    await expect(
      readFile(listing).catch((error: unknown) => (error as NodeJS.ErrnoException).code),
    ).resolves.toBe('EISDIR');
  });
});

describe('login', () => {
  beforeEach(async () => {
    await setUpAdmin(server);
    await server.request({ method: 'POST', url: '/api/auth/logout' });
  });

  it('accepts the right password', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ned', password: 'correct horse battery' },
    });
    expect(response.status).toBe(200);
    expect(response.body.account.handle).toBe('ned');
  });

  it('gives one answer for a bad password and an unknown handle', async () => {
    // No handle oracle: the caller cannot tell which was wrong, which costs
    // nothing here.
    const wrongPassword = await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ned', password: 'wrong' },
    });
    const noSuchUser = await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'nobody', password: 'wrong' },
    });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(noSuchUser.body);
  });

  it('refuses the library without a session', async () => {
    const response = await server.request({ method: 'GET', url: '/api/library' });
    expect(response.status).toBe(401);
  });
});

describe('CSRF', () => {
  beforeEach(async () => {
    await setUpAdmin(server);
  });

  it('rejects a state-changing request with no token', async () => {
    // [04 §4.1] lists CSRF among the things whose absence is embarrassing
    // rather than defensible. Double-submit: a cross-site caller can make the
    // cookie be sent but cannot read it to set the header.
    const response = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: newActor('Vera Solano'),
      skipCsrf: true,
    });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('csrf');
  });

  it('rejects a token that does not match the cookie', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: newActor('Vera Solano'),
      headers: { 'x-csrf-token': 'not the token' },
    });
    expect(response.status).toBe(403);
  });

  it('does not require one for a read', async () => {
    const response = await server.request({ method: 'GET', url: '/api/library', skipCsrf: true });
    expect(response.status).toBe(200);
  });
});

describe('library CRUD', () => {
  beforeEach(async () => {
    await setUpAdmin(server);
  });

  it('is read-after-write consistent', async () => {
    // The guarantee [02 §5.1.1](docs/design/02-data-model.md) exists to protect,
    // and step 4 of the P1 exit gate: *if it needs a retry, P1.4 is wrong.*
    const actor = newActor('Vera Solano');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: actor,
    });
    expect(created.status).toBe(201);

    const listed = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(listed.body.objects.map((row: { id: string }) => row.id)).toContain(actor.id);
  });

  it('writes the actor as a card on disk', async () => {
    // `card.png` is canonical for an actor, not a mirror of a JSON file
    // ([02 §5.2](docs/design/02-data-model.md)).
    const actor = newActor('Vera Solano');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: actor,
    });

    const path = server.services.layout.objectFile(
      { kind: 'user', handle: 'ned' },
      'storyengine.actor/1',
      created.body.slug,
    );
    const bytes = await readFile(path);
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('handles every kind through one route shape', async () => {
    // One handler set, not six ([13 §9](docs/design/13-schemas.md)).
    await server.request({ method: 'POST', url: '/api/library/actors', payload: newActor('Vera') });
    await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: newLorebook('Rain City'),
    });

    const all = await server.request({ method: 'GET', url: '/api/library' });
    expect(all.body.objects).toHaveLength(2);

    const books = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect(books.body.objects).toHaveLength(1);
  });

  it('reports an unknown kind rather than guessing', async () => {
    const response = await server.request({ method: 'GET', url: '/api/library/widgets' });
    expect(response.status).toBe(404);
    expect(response.body.message).toContain('actors');
  });

  it('carries a content hash on every read', async () => {
    // [04 §4.4](docs/design/04-server-multiuser-deployment.md).
    const actor = newActor('Vera Solano');
    await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });

    const read = await server.request({ method: 'GET', url: `/api/library/actors/${actor.id}` });
    expect(read.body.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(read.headers['etag']).toBe(read.body.contentHash);
  });

  it('refuses a write with no hash at all', async () => {
    const actor = newActor('Vera Solano');
    await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });

    const response = await server.request({
      method: 'PUT',
      url: `/api/library/actors/${actor.id}`,
      payload: { object: { ...actor, name: 'Renamed' } },
    });
    expect(response.status).toBe(428);
  });
});

describe('the stale-hash rejection', () => {
  beforeEach(async () => {
    await setUpAdmin(server);
  });

  it('rejects a write over a change it has not seen, and returns the current object', async () => {
    // The harder half of the P1 demo, and the reason the editor exists at all:
    // hand-edit an object on disk while it is open, then save, and watch the
    // write be *rejected* rather than silently eat one of the two edits
    // ([04 §4.4](docs/design/04-server-multiuser-deployment.md)).
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    const staleHash = created.body.contentHash;

    // Somebody else — a second tab, the file browser, a text editor — saves.
    await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: { object: { ...book, name: 'Rain City, after the fire' } },
      headers: { 'if-match': staleHash },
    });

    // Our tab still holds the hash from before that.
    const rejected = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: { object: { ...book, name: 'Rain City, at dawn' } },
      headers: { 'if-match': staleHash },
    });

    expect(rejected.status).toBe(412);
    expect(rejected.body.error).toBe('stale');
    // The current object comes back with the rejection, so the UI can offer
    // reload-and-reapply or save-as-a-copy rather than guessing.
    expect(rejected.body.current.name).toBe('Rain City, after the fire');
    expect(rejected.body.current.contentHash).not.toBe(staleHash);
  });

  it('accepts a write presenting the current hash', async () => {
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });

    const response = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: { object: { ...book, name: 'Rain City, after the fire' } },
      headers: { 'if-match': created.body.contentHash },
    });

    expect(response.status).toBe(200);
    expect(response.body.contentHash).not.toBe(created.body.contentHash);
  });
});

describe('a rename is an ordinary write', () => {
  beforeEach(async () => {
    await setUpAdmin(server);
  });

  it('changes the name inside the file and leaves the folder alone', async () => {
    // [19 §1.1](docs/design/19-p1-implementation.md): the slug is derived at
    // creation and frozen. The engine never moves the user's directories — if
    // they want the folder tidied they rename it themselves and the watcher
    // follows. There is no rename route because there is no rename.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    expect(created.body.slug).toBe('rain-city');

    await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: { object: { ...book, name: 'Sunfall Harbour' } },
      headers: { 'if-match': created.body.contentHash },
    });

    const read = await server.request({ method: 'GET', url: `/api/library/lorebooks/${book.id}` });
    expect(read.body.name).toBe('Sunfall Harbour');
    expect(read.body.slug).toBe('rain-city');
    expect(read.body.id).toBe(book.id);
  });
});

describe('the path is the owner', () => {
  it('never lets one account reach another library', async () => {
    // There is no `:handle` in any route — every one resolves its root from the
    // session ([04 §4.3](docs/design/04-server-multiuser-deployment.md)). This
    // is the version of the P1.2 containment check that matters once there is
    // more than one root.
    await setUpAdmin(server, 'ned');
    const mine = newLorebook('Rain City');
    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: mine });

    await server.services.accounts.create({
      handle: 'sister',
      password: 'correct horse battery',
      role: 'user',
    });

    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'sister', password: 'correct horse battery' },
    });

    const theirList = await server.request({ method: 'GET', url: '/api/library' });
    expect(theirList.body.objects).toHaveLength(0);

    // Not-found rather than forbidden: confirming the id exists would leak the
    // one fact this separation exists to keep.
    const direct = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${mine.id}`,
    });
    expect(direct.status).toBe(404);
  });
});

describe('the system library merges into the list', () => {
  it('is a query rather than a special case', async () => {
    // Shipped empty at P1 ([19 §1.3]), so what is tested is the merge — the
    // source badge needs a second channel beyond colour ([05 §5]).
    await setUpAdmin(server);
    await server.request({ method: 'POST', url: '/api/library/actors', payload: newActor('Vera') });

    const listed = await server.request({ method: 'GET', url: '/api/library' });
    expect(listed.body.objects[0].source).toBe('user');
  });
});
