// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile, writeFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOREBOOK_SCHEMA, newActor, newLorebook } from '@storyengine/shared';

import { ingestFile } from '../index-db/ingest.js';
import { userOwner } from '../storage/layout.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The HTTP surface — docs/design/workplan/07-p1-implementation.md §P1.5.
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
    // [09 §5.1](../../../../docs/design/09-server-multiuser-deployment.md): until an admin
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
    // data ([work plan §2.1](../../../../docs/design/workplan/01-work-plan.md)).
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

  it('answers 401 rather than 400 for an empty password', async () => {
    // The direct guard against anyone reinstating `minLength: 1` on the login
    // schema. A 400 here would refuse the one account the console reset exists
    // to repair, and would publish this install's rule to anyone who bisected
    // it — the same no-oracle property the test above protects, at the boundary
    // that only exists now that the minimum can be zero.
    const response = await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ned', password: '' },
    });

    expect(response.status).toBe(401);
  });
});

describe('the password minimum is the operator’s', () => {
  it('refuses a short password at setup, naming the field', async () => {
    const fresh = await makeTestServer();
    try {
      const response = await fresh.request({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { handle: 'ned', password: 'short' },
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid');
      expect(response.body.issues[0].path).toBe('/password');
    } finally {
      await fresh.dispose();
    }
  });

  it('lets an install set no minimum, and sign in with nothing', async () => {
    /**
     * **The round trip the whole change is for** — `auth.minPasswordLength: 0`
     * means the empty string is a password, not that passwords are off.
     *
     * `makeTestServer` shallow-spreads `options.config`, so the whole `auth`
     * section has to be passed. That is complete today because the section has
     * one key, and it would silently stop being complete the moment a second
     * joins it.
     */
    const open = await makeTestServer({ config: { auth: { minPasswordLength: 0 } } });
    try {
      const setup = await open.request({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { handle: 'ned', password: '' },
      });
      expect(setup.status).toBe(201);

      await open.request({ method: 'POST', url: '/api/auth/logout' });

      const login = await open.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'ned', password: '' },
      });
      expect(login.status).toBe(200);
      expect(login.body.account.handle).toBe('ned');

      // And it did not become an install where anything authenticates.
      const wrong = await open.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'ned', password: 'wrong' },
      });
      expect(wrong.status).toBe(401);
    } finally {
      await open.dispose();
    }
  });

  it('publishes the rule to a caller with no session', async () => {
    // How the setup form states the rule before any account exists — the admin
    // config route is behind both `adminOnly` and the first-run gate, so it
    // cannot serve first run at all.
    const fresh = await makeTestServer();
    try {
      const response = await fresh.request({ method: 'GET', url: '/api/auth/state' });

      expect(response.status).toBe(200);
      expect(response.body.minPasswordLength).toBe(8);
    } finally {
      await fresh.dispose();
    }
  });
});

describe('CSRF', () => {
  beforeEach(async () => {
    await setUpAdmin(server);
  });

  it('rejects a state-changing request with no token', async () => {
    // [09 §4.1] lists CSRF among the things whose absence is embarrassing
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
    // The guarantee [03 §5.1.1](../../../../docs/design/03-data-model.md) exists to protect,
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
    // ([03 §5.2](../../../../docs/design/03-data-model.md)).
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
    // One handler set, not six ([04 §9](../../../../docs/design/04-schemas.md)).
    await server.request({ method: 'POST', url: '/api/library/actors', payload: newActor('Vera') });
    await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: newLorebook('Rain City'),
    });

    // The account's own — the merge with the system scope is the subject of
    // its own test below, and counting it here would make this one about two
    // things ([P7B.0]).
    expect((await ownObjects(server)).objects).toHaveLength(2);
    expect((await ownObjects(server, 'lorebooks')).objects).toHaveLength(1);
  });

  it('reports an unknown kind rather than guessing', async () => {
    const response = await server.request({ method: 'GET', url: '/api/library/widgets' });
    expect(response.status).toBe(404);
    expect(response.body.message).toContain('actors');
  });

  it('carries a content hash on every read', async () => {
    // [09 §4.4](../../../../docs/design/09-server-multiuser-deployment.md).
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
    // ([09 §4.4](../../../../docs/design/09-server-multiuser-deployment.md)).
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
    // [P1 §1.1](../../../../docs/design/workplan/07-p1-implementation.md): the slug is derived at
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
    // session ([09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md)). This
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

    // Nothing of the first account's. The shipped system objects are in this
    // list too and are *supposed* to be — [P7B.0] — which is why the claim is
    // about what the other user owns rather than about the list being bare.
    expect((await ownObjects(server)).objects).toHaveLength(0);

    // Not-found rather than forbidden: confirming the id exists would leak the
    // one fact this separation exists to keep.
    const direct = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${mine.id}`,
    });
    expect(direct.status).toBe(404);
  });
});

describe('a file that cannot be read is reported to the client', () => {
  // F20's other half. The index records the failure; this is where the person
  // who made the edit can actually find out about it.

  async function breakTheFile(): Promise<string> {
    const book = newLorebook('Rain City');
    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });
    const path = server.services.layout.objectFile(userOwner('ned'), LOREBOOK_SCHEMA, 'rain-city');

    // What a half-saved file looks like. Re-indexed directly rather than
    // through the watcher, which has its own suite and its own timing.
    await writeFile(path, '{ "name": "Rain City", truncated');
    await ingestFile(server.services.index.db, server.services.layout, path);
    return path;
  }

  it('names the file relative to the data root, never the disk (F22)', async () => {
    await setUpAdmin(server, 'ned');
    const absolute = await breakTheFile();

    const listed = await server.request({ method: 'GET', url: '/api/library/errors' });
    expect(listed.status).toBe(200);
    expect(listed.body.errors).toHaveLength(1);

    const [error] = listed.body.errors;
    expect(error.reason).toBe('unparsable');
    expect(error.slug).toBe('rain-city');
    expect(error.source).toBe('user');
    // The client needs to know *which file*, which the relative path answers.
    // Where the server keeps its disk is not part of that answer.
    expect(error.path).toBe(relative(server.dataDir, absolute).split(sep).join('/'));
    expect(error.path).not.toContain(server.dataDir);
  });

  it('is scoped like every other read', async () => {
    await setUpAdmin(server, 'ned');
    await breakTheFile();

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

    // A path is a fact about somebody else's library, and this route would be a
    // silly way to leak one.
    const theirs = await server.request({ method: 'GET', url: '/api/library/errors' });
    expect(theirs.body.errors).toEqual([]);
  });

  it('is not a kind', async () => {
    // `/library/errors` is static and `/library/:kind` is not, so the router
    // prefers it — and `errors` is not a directory in the registry, so the
    // collision cannot happen from the other direction either.
    await setUpAdmin(server);
    const notAKind = await server.request({ method: 'GET', url: '/api/library/sessions' });
    expect(notAKind.status).toBe(404);
  });
});

describe('the system library merges into the list', () => {
  /**
   * ***This is the first version of this test that can fail*** — [P7B.0].
   *
   * It used to say *"Shipped empty at [P1 §1.3], so what is tested is the
   * merge"*, and then assert that the one object in the list was the user's.
   * With nothing ever written to the system scope, that assertion held for a
   * build with no merge at all: it could not tell a query that unions two
   * scopes from one that reads a single directory. P7B.0 puts the built-in
   * prompt packs there, so both sides of the union exist and the claim becomes
   * checkable — which is worth more than the number that changed.
   */
  it('is a query rather than a special case', async () => {
    await setUpAdmin(server);
    await server.request({ method: 'POST', url: '/api/library/actors', payload: newActor('Vera') });

    const listed = await server.request({ method: 'GET', url: '/api/library' });
    const sources = new Set((listed.body.objects as { source: string }[]).map((row) => row.source));

    // Both scopes, through one route, in one list.
    expect(sources).toEqual(new Set(['user', 'system']));

    // And the badge has something to say about every row — [10 §5] wants a
    // second channel beyond colour, which needs the value to be there at all.
    for (const row of listed.body.objects as { source?: string }[]) {
      expect(row.source).toBeTypeOf('string');
    }
  });
});

describe('a hand edit is not eaten by a stale save', () => {
  beforeEach(async () => {
    await setUpAdmin(server);
  });

  /**
   * Writes bytes straight to the object file, the way a text editor would.
   *
   * Through the layout rather than a hand-built path: the filename per kind is
   * the layout's business, and a test that guessed it would fail for a reason
   * that has nothing to do with what it asserts.
   */
  function objectPath(slug: string): string {
    return server.services.layout.objectFile(userOwner('ned'), LOREBOOK_SCHEMA, slug);
  }

  async function editOnDisk(slug: string, object: Record<string, unknown>): Promise<void> {
    await writeFile(objectPath(slug), JSON.stringify(object));
  }

  it('refuses a PUT whose hash matches the index but not the disk', async () => {
    // **The central promise of the storage thesis, and it had no test at all.**
    // The hash is compared against the index row first; the index can be stale
    // by up to the watcher's settle window, so the write path re-hashes the
    // actual bytes inside the critical section. Every other stale test in this
    // suite reaches staleness through a second *API* write, which the index row
    // check alone already catches — so deleting the disk re-hash left the whole
    // suite green.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    const hash = created.body.contentHash as string;
    const slug = created.body.slug as string;

    // Somebody edits the file in a text editor. The index has not caught up.
    await editOnDisk(slug, { ...book, name: 'Rain City, edited by hand' });

    const write = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: { object: { ...book, name: 'Rain City, from the app' }, contentHash: hash },
    });

    expect(write.status).toBe(412);

    // …and the hand edit is still on disk. That is the whole point: the person
    // who typed into their editor does not lose it to a tab that was open.
    const onDisk = JSON.parse(await readFile(objectPath(slug), 'utf8')) as { name: string };
    expect(onDisk.name).toBe('Rain City, edited by hand');
  });

  it('refuses a DELETE the same way', async () => {
    // Deleting something a hand edit has since changed is the same mistake as
    // overwriting it, and rather more final.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });

    await editOnDisk(created.body.slug as string, {
      ...book,
      name: 'Rain City, edited by hand',
    });

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${book.id}`,
      headers: { 'if-match': created.body.contentHash as string },
    });

    expect(removed.status).toBe(412);
    const listed = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect(listed.body.objects).toHaveLength(1);
  });
});
