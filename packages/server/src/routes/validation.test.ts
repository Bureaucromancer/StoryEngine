// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newLorebook } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer, ownObjects } from '../test-server.js';

/**
 * Request validation and the `:kind` segment — F2.
 *
 * P1.5 said the routes would validate against the same schemas the storage
 * layer uses and shipped params-only, which left two holes. The `:kind` in the
 * URL was read, resolved, and never compared to anything: posting an actor to
 * `/lorebooks` made an actor, and `/actors/<lorebook-id>` returned the
 * lorebook. And the framework's own validator, once schemas *are* attached,
 * rewrites the body in place — which matters here more than in most services,
 * because that body is what gets written to disk.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

describe('the :kind segment decides something', () => {
  it('refuses an actor posted to lorebooks', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: newActor('Vera Solano'),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid');
    // Both halves came from the caller, so naming them discloses nothing and
    // saves a round of confusion.
    expect(response.body.message).toContain('storyengine.actor');
    expect(response.body.message).toContain('storyengine.lorebook');

    // And nothing was written: the user's list is still empty.
    // **`ownObjects`, not the bare list** — the system scope ships an assistant
    // card since [P11.3], so *the library is empty* was never the claim: it is
    // that **the user's** library is, which is what the refusal is about.
    expect((await ownObjects(server, 'actors')).objects).toHaveLength(0);
  });

  it('will not read a lorebook through the actors collection', async () => {
    const book = newLorebook('Rain City');
    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });

    const wrongKind = await server.request({
      method: 'GET',
      url: `/api/library/actors/${book.id}`,
    });

    // Not-found rather than a mismatch error: that collection genuinely does
    // not hold that id, and saying "wrong kind" would confirm it exists.
    expect(wrongKind.status).toBe(404);
    expect(wrongKind.body.error).toBe('not-found');
  });

  it('will not write, delete or read history through the wrong collection', async () => {
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    const hash = created.body.contentHash as string;

    const written = await server.request({
      method: 'PUT',
      url: `/api/library/actors/${book.id}`,
      payload: { object: { ...book, name: 'Renamed' }, contentHash: hash },
    });
    expect(written.status).toBe(404);

    const history = await server.request({
      method: 'GET',
      url: `/api/library/actors/${book.id}/history`,
    });
    expect(history.status).toBe(404);

    const deleted = await server.request({
      method: 'DELETE',
      url: `/api/library/actors/${book.id}`,
      headers: { 'if-match': hash },
    });
    expect(deleted.status).toBe(404);

    // Still there, through its own kind.
    const intact = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}`,
    });
    expect(intact.status).toBe(200);
    expect(intact.body.contentHash).toBe(hash);
  });
});

describe('the validator does not rewrite what it validates', () => {
  it('refuses a missing required field instead of filling it in', async () => {
    // `provenance.source` is both required and has a default. Under Fastify's
    // stock Ajv — `useDefaults` on, mutating in place — this POST was accepted
    // and the object reached the disk carrying an authorship claim nobody made.
    // `assertValidObject` could not catch it, because it validates the same
    // mutated reference.
    const actor = newActor('Vera Solano') as unknown as Record<string, any>;
    delete actor['provenance'].source;

    const response = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: actor,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid');
    expect(JSON.stringify(response.body.issues)).toContain('source');
  });

  it('refuses a wrongly-typed field instead of coercing it', async () => {
    const actor = newActor('Vera Solano') as unknown as Record<string, any>;
    actor['aliases'] = 'vee';

    const response = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: actor,
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('aliases');
  });

  it('keeps an unknown field on the way in and on the way out', async () => {
    // The other direction: nothing may *strip* either. This is gate step 14's
    // guarantee at the route layer, and it is why the library routes carry no
    // response schema — serialisation emits only declared properties.
    const actor = newActor('Vera Solano') as unknown as Record<string, any>;
    actor['fromTheFuture'] = { note: 'keep me' };

    const created = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: actor,
    });
    expect(created.status).toBe(201);

    const read = await server.request({
      method: 'GET',
      url: `/api/library/actors/${actor['id'] as string}`,
    });
    expect(read.body.object.fromTheFuture).toEqual({ note: 'keep me' });
  });
});

describe('the envelope', () => {
  it('answers a null body in the documented shape', async () => {
    // Fastify's own is `{statusCode, code: "FST_ERR_VALIDATION", …}`; the API
    // doc says a bad body is `400 invalid` with a message, which is what every
    // hand-written 400 in these routes already sends.
    const response = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: null,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid');
    expect(response.body.code).toBeUndefined();
  });

  it('refuses a contentHash that is not a string', async () => {
    const book = newLorebook('Rain City');
    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });

    const response = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: { object: book, contentHash: 12345 },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid');
  });

  it('still accepts a bodyless delete, which is the documented spelling', async () => {
    // The reason restore and delete carry no body schema: an absent body is the
    // *ordinary* request to both, and Fastify validates absent bodies.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${book.id}`,
      headers: { 'if-match': created.body.contentHash as string },
    });
    expect(removed.status).toBe(204);
  });
});
