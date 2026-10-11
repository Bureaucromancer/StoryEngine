// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLorebook, newWorld, uuidv7, WORLD_SCHEMA } from '@storyengine/shared';

import { findById } from '../index-db/query.js';
import { create } from '../library.js';
import { recordVersion } from '../storage/history.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The user half of the settings surface — [10 §15.1](../../../../docs/design/10-ui-surfaces.md),
 * [P2A §3](../../../../docs/design/workplan/09-p2a-configuration-surface.md) stage P2A.2.
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
    // The rule moved out of the TypeBox schema and into the handler, because
    // `auth.minPasswordLength` is `live` and Ajv compiles a schema once. The
    // published shape — `400 invalid` carrying `issues`, `{path, message}` per
    // field (docs/api.md) — is the thing that must not have moved with it, and
    // nothing else in the suite was watching it.
    expect(response.body.error).toBe('invalid');
    expect(response.body.issues[0].path).toBe('/newPassword');
  });
});

/**
 * Preferences — [26 B13](../../../../docs/design/26-open-questions.md), through the route.
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

/**
 * The role-binding editor's API — [10 §15.1](../../../../docs/design/10-ui-surfaces.md)'s
 * *role bindings* bullet, [P7.3], and the writer
 * [20 §5.1](../../../../docs/design/20-tech-stack.md) has been missing since P2.5.
 *
 * **What makes these two routes worth having is the layer, not the file.**
 * `resolveRole` has layered a personal binding over the install default since
 * P2B and `users/<handle>/bindings.json` had a reader and no writer, so the
 * layer was reachable only by hand-editing JSON. The claim under test is
 * [20 §5.1]'s: *"anyone who wants their own key overrides a role without the
 * admin's involvement"* — which means an **ordinary account**, which is why the
 * sharpest test here signs in as one.
 */
describe('the role bindings of the person asking', () => {
  const SYSTEM = {
    label: 'The house key',
    provider: 'openai-compatible',
    apiKey: 'sk-must-never-come-back',
    baseUrl: 'https://api.internal.example/v1',
    models: ['gpt-hi', 'gpt-lo'],
  };

  /** A system connection and an install default for `prose`, as P2B's surface writes them. */
  async function installed(): Promise<string> {
    const made = await server.request({
      method: 'POST',
      url: '/api/admin/connections',
      payload: SYSTEM,
    });
    const id = made.body.connection.id as string;
    const read = await server.request({ method: 'GET', url: '/api/admin/bindings' });
    await server.request({
      method: 'PUT',
      url: '/api/admin/bindings',
      payload: {
        bindings: { prose: { connectionId: id, modelId: 'gpt-hi' } },
        contentHash: read.body.contentHash,
      },
    });
    return id;
  }

  /**
   * A write that presents the hash the server just gave out, which is what a
   * page does. The read is inside the helper on purpose: a test spelling it
   * out would be a test about the guard, and there is one of those below.
   */
  async function write(bindings: unknown): ReturnType<TestServer['request']> {
    const read = await server.request({ method: 'GET', url: '/api/me/roles' });
    return server.request({
      method: 'PUT',
      url: '/api/me/bindings',
      payload: { bindings, contentHash: read.body.contentHash as string },
    });
  }

  function row(body: unknown, role: string): unknown {
    const rows = (body as { roles: { role: string }[] }).roles;
    return rows.find((one) => one.role === role);
  }

  it('answers the install default before anything personal is written', async () => {
    const id = await installed();

    const response = await server.request({ method: 'GET', url: '/api/me/roles' });

    expect(response.body.bindings).toEqual({});
    expect(row(response.body, 'prose')).toMatchObject({
      ok: true,
      // **The answer the editor exists to change.** `default` is the install's
      // layer; `binding` below is this account's.
      via: 'default',
      connectionId: id,
      modelId: 'gpt-hi',
    });
  });

  it('lets a personal binding win, and says which layer did', async () => {
    const id = await installed();

    const written = await write({ prose: { connectionId: id, modelId: 'gpt-lo' } });
    expect(written.status).toBe(200);

    const after = await server.request({ method: 'GET', url: '/api/me/roles' });
    expect(row(after.body, 'prose')).toMatchObject({ ok: true, via: 'binding', modelId: 'gpt-lo' });
    // And the raw document came back, because the editor edits that rather than
    // the resolved table.
    expect(after.body.bindings).toEqual({ prose: { connectionId: id, modelId: 'gpt-lo' } });
  });

  /**
   * **[20 §5.1]'s sentence, as a test with no admin in it.** This is the claim
   * the route's placement outside `/api/admin` rests on, and an admin doing it
   * would prove nothing about it.
   */
  it('belongs to an ordinary account, with no admin involved', async () => {
    const id = await installed();
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

    const written = await write({ prose: { connectionId: id, modelId: 'gpt-lo' } });

    expect(written.status).toBe(200);
    expect(written.body.bindings).toEqual({ prose: { connectionId: id, modelId: 'gpt-lo' } });
    // Theirs, not the admin's: ned's file is untouched by mara's write.
    const admin = await server.request({ method: 'GET', url: '/api/admin/accounts' });
    expect(admin.status).toBe(403);
  });

  /**
   * **Why the route needs no capability check of its own**, and the answer is
   * better than *inert* — measured 2026-09-12, against a first draft of this
   * test that asserted `dangling` and was wrong.
   *
   * A binding is two ids. `resolveRole` looks the `connectionId` up in the
   * capability-filtered `usable` list, so naming a connection this account may
   * not use cannot be access. What it also is not is a broken role: [P2B §1.2]
   * made the resolver take **the first layer that resolves, not the first that
   * exists**, precisely so [09 §4.5]'s promise that a removed system connection
   * *"falls back to system bindings"* describes something the code can do. So a
   * write nobody could use is not even destructive — the install default
   * answers and the turn keeps working.
   */
  it('drops a binding nobody can use through to the layer below', async () => {
    const id = await installed();

    const written = await write({ prose: { connectionId: 'not-a-connection', modelId: 'x' } });
    expect(written.status).toBe(200);

    const after = await server.request({ method: 'GET', url: '/api/me/roles' });
    expect(row(after.body, 'prose')).toMatchObject({
      ok: true,
      via: 'default',
      connectionId: id,
    });
  });

  /**
   * **And `dangling` is the honest remainder**, when there is no layer to drop
   * through to. It reports the strongest failing layer's connection id, because
   * that is the binding whose owner has to fix it — which is the whole reason it
   * stays distinct from `unbound`.
   */
  it('answers dangling when the personal layer is the only one that bound', async () => {
    // No `installed()`: no system connection and no install default, so the
    // personal binding is the only thing in the stack.
    const written = await write({ prose: { connectionId: 'not-a-connection', modelId: 'x' } });
    expect(written.status).toBe(200);

    const after = await server.request({ method: 'GET', url: '/api/me/roles' });
    expect(row(after.body, 'prose')).toMatchObject({
      ok: false,
      reason: 'dangling',
      connectionId: 'not-a-connection',
    });
  });

  it('refuses a write against a hash that has moved, and hands back what is there', async () => {
    const id = await installed();
    await write({ prose: { connectionId: id, modelId: 'gpt-lo' } });

    // A second write presenting the *first* read's hash — which is the shape a
    // hand edit between a page load and a save takes ([10 §4]).
    const stale = await server.request({
      method: 'PUT',
      url: '/api/me/bindings',
      payload: {
        bindings: { prose: { connectionId: id, modelId: 'gpt-hi' } },
        contentHash: 'sha256:whatever-this-page-read',
      },
    });

    expect(stale.status).toBe(412);
    expect(stale.body.error).toBe('stale');
    // Carrying the current document, so the client can offer *load what is on
    // disk* rather than only being told no.
    expect(stale.body.current).toEqual({ prose: { connectionId: id, modelId: 'gpt-lo' } });
  });

  /**
   * **A first write has no file to hash**, so an absent document and an empty
   * one have to present the same guard. `bindingsStateAt` is where that is
   * decided, and this is the case it exists for.
   */
  it('writes the first time, when there is no file to have read', async () => {
    const id = await installed();

    const written = await write({ prose: { connectionId: id, modelId: 'gpt-lo' } });

    expect(written.status).toBe(200);
  });

  it('drops a role this build does not know rather than refusing the write', async () => {
    const id = await installed();

    const written = await write({
      prose: { connectionId: id, modelId: 'gpt-lo' },
      divination: { connectionId: id, modelId: 'gpt-hi' },
    });

    // Not a 400: running an older server than the client is not an error, and
    // the narrowing is `pickBindings`' rather than the schema's.
    expect(written.status).toBe(200);
    expect(written.body.bindings).toEqual({ prose: { connectionId: id, modelId: 'gpt-lo' } });
  });

  it('refuses a binding carrying anything but two ids', async () => {
    const id = await installed();

    const refused = await write({
      prose: { connectionId: id, modelId: 'gpt-lo', apiKey: 'sk-nope' },
    });

    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body ?? null)).not.toContain('sk-nope');
  });

  it('offers the connections a binding may pick, and none of their secrets', async () => {
    await installed();

    const response = await server.request({ method: 'GET', url: '/api/me/roles' });

    expect(response.body.connections).toHaveLength(1);
    expect(response.body.connections[0]).toMatchObject({
      label: 'The house key',
      provider: 'openai-compatible',
      scope: 'system',
      // The model list, because that is what a binding picks from and a pane
      // that could not offer one would be a text box.
      models: ['gpt-hi', 'gpt-lo'],
    });
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('sk-must-never-come-back');
    expect(body).not.toContain('api.internal.example');
  });

  /**
   * ***An install connection one of yours hides is said, not offered as
   * though it worked*** — [polish §26](../../../../docs/design/workplan/06-polish.md),
   * 2026-10-04.
   *
   * Both connections share an id, so a binding naming it reaches the personal
   * file whichever of the two a picker said it was choosing. The route marks
   * the install's with the personal one's label — `shadowedBy` — so the pane
   * can leave its models out and say why. The falsifying mutation is the
   * mapping this route used before, `usable.map(presentConnection)`.
   */
  it('marks an install connection that a file of yours hides, with your file’s label', async () => {
    const id = await installed();
    const root = server.services.layout.userConnectionsRoot('ned');
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, 'restored-from-a-backup.json'),
      JSON.stringify({
        id,
        label: 'My own copy',
        provider: 'openai-compatible',
        baseUrl: 'https://api.mine.example/v1',
        models: ['local-hi'],
      }),
    );

    const response = await server.request({ method: 'GET', url: '/api/me/roles' });

    expect(
      (response.body.connections as { label: string; scope: string; shadowedBy?: unknown }[]).map(
        (one) => [one.scope, one.label, one.shadowedBy],
      ),
    ).toEqual([
      ['user', 'My own copy', undefined],
      ['system', 'The house key', { label: 'My own copy' }],
    ]);
    // And the install default for `prose`, which names the id, reaches the
    // personal file — which is what the mark is warning about.
    expect(row(response.body, 'prose')).toMatchObject({
      via: 'default',
      connectionLabel: 'My own copy',
    });
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('sk-must-never-come-back');
    expect(body).not.toContain('api.internal.example');
  });
});

/**
 * ***Restoring from the trash: a 400 means the address, and only that***
 * (2026-09-27).
 *
 * The route caught every throw from the restore and answered *That is not an
 * address in the trash*. A rename the disk refused, a folder a scanner holds on
 * Windows or a full disk, told the person their entry did not exist, and
 * nothing reached the log to say otherwise.
 */
describe('POST /api/me/trash/restore', () => {
  /** A lorebook in ned's trash, as a delete leaves one. */
  async function trashedBook(): Promise<string> {
    const layout = server.services.layout;
    const name = `rain-city-${uuidv7()}`;
    const folder = join(layout.trashRoot('ned'), 'lorebooks', name);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'lorebook.json'), JSON.stringify(newLorebook('Rain City')));
    return `lorebooks/${name}`;
  }

  it('answers 400 for an address that is not one', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/me/trash/restore',
      payload: { id: '../../etc' },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid');
  });

  it('answers a restore the disk refuses as the failure it is, not as a bad address', async () => {
    const id = await trashedBook();
    // Where the lorebook would go back to cannot be made: a file stands where
    // its kind's folder has to be.
    const library = join(server.dataDir, 'users', 'ned', 'library');
    await rm(join(library, 'lorebooks'), { recursive: true, force: true });
    await writeFile(join(library, 'lorebooks'), 'not a folder');

    const response = await server.request({
      method: 'POST',
      url: '/api/me/trash/restore',
      payload: { id },
    });

    expect(response.status).toBe(500);
    expect(response.body.error).not.toBe('invalid');
  });

  /**
   * ***A Package trashed before P16.0, whose id was landed again since***
   * (2026-10-11, the [P16 audit], safety finding 1) — the auditor's sequence:
   * the Package's id arrives live (as an import of its `.sepack.json` or a
   * pre-P16.0 backup lands it), the person starts a session in that World, and
   * then puts the trash entry back. It used to come back under the **same
   * id**, at `rain-city-2/`, which the index's tie-break by path put first —
   * so the stale copy answered every read by id and the World in use was
   * shadowed. It comes back under a new id now, as a World of its own, and the
   * answer says so in a note.
   */
  it('brings a legacy Package back under a new id when its own is held, and says so', async () => {
    const world = newWorld('Rain City');
    const entry = `rain-city-${uuidv7()}`;
    const folder = join(server.services.layout.trashRoot('ned'), 'packages', entry);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'package.json'),
      `${JSON.stringify(
        { ...world, schema: 'storyengine.package/1', description: 'trashed before the upgrade' },
        null,
        2,
      )}\n`,
    );
    const made = await server.request({
      method: 'POST',
      url: '/api/library/worlds',
      payload: { ...world, description: 'in use since the import' },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const started = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Night one', world: world.id },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);

    const restored = await server.request({
      method: 'POST',
      url: '/api/me/trash/restore',
      payload: { id: `packages/${entry}` },
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body).toEqual({
      restored: true,
      notes: [
        {
          key: 'trash.restore.reminted',
          params: { name: 'Rain City', id: expect.any(String) },
          level: 'warn',
        },
      ],
    });
    const fresh = restored.body.notes[0].params.id as string;
    expect(fresh).not.toBe(world.id);

    // The World in use still answers its id, with its session in it.
    const held = await server.request({ method: 'GET', url: `/api/library/worlds/${world.id}` });
    expect(held.body).toMatchObject({
      slug: 'rain-city',
      shadowed: false,
      object: { description: 'in use since the import' },
    });
    expect((held.body.object.contents as { id: string }[]).map((member) => member.id)).toContain(
      started.body.session.id,
    );
    // And the copy brought back is its own World, nobody's shadow.
    const back = await server.request({ method: 'GET', url: `/api/library/worlds/${fresh}` });
    expect(back.body).toMatchObject({
      slug: 'rain-city-2',
      shadowed: false,
      object: {
        id: fresh,
        schema: 'storyengine.world/1',
        description: 'trashed before the upgrade',
      },
    });
  });

  /**
   * ***A re-minted copy's own past restores*** (2026-10-11, the review of the
   * audit's fixes). The copy's history was written under the old id and is
   * not rewritten with it, and `update` refuses a body naming another id — so
   * every version was listed and none could be restored. A version restored
   * now takes the object's own id: it was read from the object's own folder.
   */
  it('restores an earlier version of a re-minted copy under the copy’s id', async () => {
    const world = newWorld('Rain City');
    const entry = `rain-city-${uuidv7()}`;
    const folder = join(server.services.layout.trashRoot('ned'), 'packages', entry);
    await mkdir(folder, { recursive: true });
    const legacy = { ...world, schema: 'storyengine.package/1' };
    await writeFile(
      join(folder, 'package.json'),
      `${JSON.stringify({ ...legacy, description: 'the last state' }, null, 2)}\n`,
    );
    await recordVersion(
      folder,
      { ...legacy, description: 'an earlier state' },
      { kind: 'manual' },
      '',
    );
    const made = await server.request({
      method: 'POST',
      url: '/api/library/worlds',
      payload: world,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);

    const restored = await server.request({
      method: 'POST',
      url: '/api/me/trash/restore',
      payload: { id: `packages/${entry}` },
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const fresh = restored.body.notes[0].params.id as string;
    expect(fresh).not.toBe(world.id);

    const history = await server.request({
      method: 'GET',
      url: `/api/library/worlds/${fresh}/history`,
    });
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    expect(history.body.versions).toHaveLength(1);
    const copy = await server.request({ method: 'GET', url: `/api/library/worlds/${fresh}` });
    const back = await server.request({
      method: 'POST',
      url: `/api/library/worlds/${fresh}/history/${history.body.versions[0].id as string}/restore`,
      payload: { contentHash: copy.body.contentHash },
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const now = await server.request({ method: 'GET', url: `/api/library/worlds/${fresh}` });
    expect(now.body.object).toMatchObject({
      id: fresh,
      schema: 'storyengine.world/1',
      description: 'an earlier state',
    });
    // And the World holding the old id is untouched by it.
    const held = await server.request({ method: 'GET', url: `/api/library/worlds/${world.id}` });
    expect(held.body.object.description).not.toBe('an earlier state');
  });

  /**
   * ***Held by another account, re-minted all the same*** (2026-10-11, the
   * review of the audit's fixes). Ids are one install's, not one account's —
   * an import re-mints an id another account holds (P16.3e) — so the look is
   * install-wide, and Ned's restore of an id Amy's import landed comes back
   * under a new one. What the note may not say is that *Ned* holds it: his
   * own list of Worlds is empty, and the answer's params name only the copy
   * (the client's sentence says *in use on this server*, `Trash.tsx`).
   */
  it('re-mints an id another account holds, and names nothing of whose it is', async () => {
    const world = newWorld('Rain City');
    const entry = `rain-city-${uuidv7()}`;
    const folder = join(server.services.layout.trashRoot('ned'), 'packages', entry);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'package.json'),
      `${JSON.stringify({ ...world, schema: 'storyengine.package/1' }, null, 2)}\n`,
    );
    // Amy's copy of the same id — as her import of Ned's old file would land it.
    await create(server.services.library, 'amy', world, WORLD_SCHEMA);
    const nedsWorlds = await server.request({ method: 'GET', url: '/api/library/worlds' });
    expect(nedsWorlds.status).toBe(200);
    expect(
      (nedsWorlds.body.objects as { owner: string }[]).filter((row) => row.owner === 'user:ned'),
    ).toEqual([]);

    const restored = await server.request({
      method: 'POST',
      url: '/api/me/trash/restore',
      payload: { id: `packages/${entry}` },
    });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body.notes).toEqual([
      {
        key: 'trash.restore.reminted',
        params: { name: 'Rain City', id: expect.any(String) },
        level: 'warn',
      },
    ]);
    const fresh = restored.body.notes[0].params.id as string;
    expect(fresh).not.toBe(world.id);
    // Amy's keeps its id, Ned's copy is his under the new one.
    expect(findById(server.services.index.db, world.id)?.owner).toBe('user:amy');
    expect(findById(server.services.index.db, fresh)?.owner).toBe('user:ned');
  });
});
