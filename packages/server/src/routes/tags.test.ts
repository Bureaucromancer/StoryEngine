// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestServer, routesUnder, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The tag registry through the API — [25](../../../../docs/design/25-tagging.md).
 *
 * The subject is the **verb split** ([25 §2], invariant 4). A `DELETE` here
 * removes a registry entry and nothing else; the objects carrying that tag are
 * untouched and go on filtering and gating lore, having lost a colour. Anything
 * that would rewrite the user's files is a `POST` with a verb in the path and
 * does not exist yet. A route that quietly acquired the destructive meaning
 * would pass every other test in the suite.
 */

let server: TestServer;

async function create(name: string, over: Record<string, unknown> = {}) {
  return server.request({ method: 'POST', url: '/api/tags', payload: { name, ...over } });
}

async function list() {
  return server.request({ method: 'GET', url: '/api/tags' });
}

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

describe('GET /api/tags', () => {
  it('is empty before anything is made', async () => {
    const response = await list();

    expect(response.status).toBe(200);
    expect(response.body.tags).toEqual([]);
  });
});

describe('POST /api/tags', () => {
  it('makes one, and it is there on a second request', async () => {
    const made = await create('noir', { swatch: 'rose' });
    expect(made.status).toBe(201);

    // Read back through a second request, so the claim is that it persisted
    // rather than that one handler echoed its own input.
    const read = await list();
    expect(read.body.tags).toHaveLength(1);
    expect(read.body.tags[0]).toMatchObject({ name: 'noir', swatch: 'rose', hidden: false });
    expect(read.body.tags[0].id).toBeTruthy();
  });

  it('normalises the name it was given', async () => {
    await create('  post   waterloo ');

    expect((await list()).body.tags[0].name).toBe('post waterloo');
  });

  it('numbers each new tag after the last', async () => {
    await create('noir');
    await create('city');

    expect((await list()).body.tags.map((tag: { sortOrder: number }) => tag.sortOrder)).toEqual([
      0, 1,
    ]);
  });

  /**
   * Named in the spelling that exists, because *noir is already a tag* is
   * unhelpful to somebody who has just typed `Noir` and can see no `noir`.
   */
  it('refuses a name that is an existing tag in another case, and says which', async () => {
    await create('Noir');

    const clash = await create('noir');

    expect(clash.status).toBe(409);
    expect(clash.body.message).toContain('Noir');
    expect((await list()).body.tags).toHaveLength(1);
  });

  it('refuses a nameless one', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/tags',
      payload: { name: '' },
    });

    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/tags/:id', () => {
  it('recolours without touching anything else', async () => {
    const made = await create('noir', { swatch: 'rose' });
    const id = made.body.tags[0].id as string;

    const patched = await server.request({
      method: 'PATCH',
      url: `/api/tags/${id}`,
      payload: { swatch: 'teal', hidden: true },
    });

    expect(patched.status).toBe(200);
    const read = (await list()).body.tags[0];
    expect(read).toMatchObject({ name: 'noir', swatch: 'teal', hidden: true });
  });

  it('clears a swatch back to the neutral chip', async () => {
    const made = await create('noir', { swatch: 'rose' });
    const id = made.body.tags[0].id as string;

    await server.request({ method: 'PATCH', url: `/api/tags/${id}`, payload: { swatch: null } });

    expect((await list()).body.tags[0].swatch).toBeNull();
  });

  /**
   * **Renaming is not a property edit**, and this is where that is enforced.
   * [25 §1]: an `actorTagFilter` naming the old spelling stops matching, so a
   * rename can change which lore fires. It gets its own verb and its own answer
   * about the gates it found; a `name` arriving here is refused with the field
   * named rather than quietly applied as if it were a colour.
   */
  it('refuses a name in the body rather than renaming quietly', async () => {
    const made = await create('noir');
    const id = made.body.tags[0].id as string;

    const response = await server.request({
      method: 'PATCH',
      url: `/api/tags/${id}`,
      payload: { name: 'Noir' },
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('name');
    expect((await list()).body.tags[0].name).toBe('noir');
  });

  it('answers 404 for a tag that is not there', async () => {
    const response = await server.request({
      method: 'PATCH',
      url: '/api/tags/nope',
      payload: { hidden: true },
    });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/tags/:id', () => {
  it('removes the entry', async () => {
    const made = await create('noir');
    const id = made.body.tags[0].id as string;

    const response = await server.request({ method: 'DELETE', url: `/api/tags/${id}` });

    expect(response.status).toBe(200);
    expect((await list()).body.tags).toEqual([]);
  });

  it('answers 404 for a tag that is not there', async () => {
    expect((await server.request({ method: 'DELETE', url: '/api/tags/nope' })).status).toBe(404);
  });
});

describe('PUT /api/tags/order', () => {
  it('takes the whole list and renumbers it densely', async () => {
    await create('noir');
    await create('city');
    await create('ronin');
    const ids = (await list()).body.tags.map((tag: { id: string }) => tag.id) as string[];

    const response = await server.request({
      method: 'PUT',
      url: '/api/tags/order',
      payload: { ids: [ids[2], ids[0], ids[1]] },
    });

    expect(response.status).toBe(200);
    const read = (await list()).body.tags as { name: string; sortOrder: number }[];
    expect(read.map((tag) => tag.name)).toEqual(['ronin', 'noir', 'city']);
    expect(read.map((tag) => tag.sortOrder)).toEqual([0, 1, 2]);
  });

  /**
   * A stale tab reordering a list somebody else has since pruned should not be
   * an error page — the tags it does not mention keep their relative places
   * after the ones it does.
   */
  it('ignores an id it does not know rather than refusing', async () => {
    await create('noir');
    const ids = (await list()).body.tags.map((tag: { id: string }) => tag.id) as string[];

    const response = await server.request({
      method: 'PUT',
      url: '/api/tags/order',
      payload: { ids: ['a-tag-that-left', ids[0]] },
    });

    expect(response.status).toBe(200);
    expect((await list()).body.tags.map((tag: { name: string }) => tag.name)).toEqual(['noir']);
  });
});

/*
 * **Per-account isolation is asserted one layer down**, in `tags/store.test.ts`,
 * because that is where it lives: the path is the owner ([04 §4.3]) and these
 * handlers do nothing with the handle but pass it to the store. Proving it again
 * here would need a second signed-in account, and `setUpAdmin` is first-run
 * setup — it can only be called once per server. Scaffolding a second identity
 * to re-test somebody else's claim is how a suite gets slow without getting
 * stronger.
 */

/**
 * **Enumerated, so a route added without a test fails rather than quietly
 * widening the surface** — the discipline `connections.test.ts` sets. It is
 * worth more here than usual: the safety property of this API is *which verbs
 * exist*, so a new one appearing unnoticed is the thing to catch.
 */
describe('the tag surface', () => {
  it('is exactly these routes', () => {
    const surface = routesUnder(server.app, '/api/tags').map(
      (route) => `${route.method} ${route.url}`,
    );

    expect(surface.sort()).toEqual(
      [
        'DELETE /api/tags/:id',
        'GET /api/tags',
        'PATCH /api/tags/:id',
        'POST /api/tags',
        'PUT /api/tags/order',
      ].sort(),
    );
  });
});
