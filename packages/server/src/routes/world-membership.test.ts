// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLorebook, newWorld, WORLD_SCHEMA } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Membership is not ownership*** —
 * [P16 §1.2](../../../../docs/design/workplan/35-p16-world.md), [P16.1].
 *
 * **A World never blocks a delete, and deleting a World deletes no member.**
 * The first is [26 B2] one level up and was already true of the stored form; the
 * second is what makes membership not ownership — and **until this file no test
 * said so**, which is what P16 §1.2 asks P16.1 to add: *a test deletes a World
 * holding a lorebook and a session and asserts both are still readable, so a
 * later change that taught delete to follow members fails rather than ships.*
 *
 * The rest is the one door that adds a member from outside the World's own
 * editor (`POST /library/worlds/:id/members`): idempotent by id, refusing a
 * World inside a World, and seen from the member's side as *Used by* on a
 * library object and *In these Worlds* on a session.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

async function created(kind: string, payload: unknown): Promise<void> {
  const response = await server.request({ method: 'POST', url: `/api/library/${kind}`, payload });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function startSession(name: string): Promise<{ id: string; name: string }> {
  const response = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.session as { id: string; name: string };
}

async function readWorld(id: string) {
  const response = await server.request({ method: 'GET', url: `/api/library/worlds/${id}` });
  expect(response.status).toBe(200);
  return response.body as {
    contentHash: string;
    object: { contents: { schema: string; id: string; name?: string }[] };
  };
}

async function add(worldId: string, members: unknown[]) {
  return server.request({
    method: 'POST',
    url: `/api/library/worlds/${worldId}/members`,
    payload: { members },
  });
}

describe('adding members to a World', () => {
  it('adds library objects and sessions, as envelopes, at the end', async () => {
    const world = newWorld('Rain City');
    const book = newLorebook('The Docks');
    await created('worlds', world);
    await created('lorebooks', book);
    const session = await startSession('A night at the docks');

    const response = await add(world.id, [
      { schema: book.schema, id: book.id, name: book.name },
      { schema: 'storyengine.session/1', id: session.id, name: session.name },
    ]);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await readWorld(world.id)).object.contents).toEqual([
      { schema: book.schema, id: book.id, name: 'The Docks' },
      { schema: 'storyengine.session/1', id: session.id, name: 'A night at the docks' },
    ]);
  });

  it('adds a member once, and writes nothing when there is nothing new', async () => {
    const world = newWorld('Rain City');
    const book = newLorebook('The Docks');
    await created('worlds', world);
    await created('lorebooks', book);
    const envelope = { schema: book.schema, id: book.id, name: book.name };

    const first = await add(world.id, [envelope, envelope]);
    expect(first.status).toBe(200);
    const again = await add(world.id, [envelope]);
    expect(again.status).toBe(200);
    // The same bytes, so the same hash: no write and no history entry.
    expect(again.body.contentHash).toBe(first.body.contentHash);
    expect((await readWorld(world.id)).object.contents).toHaveLength(1);

    const history = await server.request({
      method: 'GET',
      url: `/api/library/worlds/${world.id}/history`,
    });
    expect(history.body.versions).toHaveLength(1);
  });

  it('refuses a World as a member, and the World itself', async () => {
    const world = newWorld('Rain City');
    const other = newWorld('Dry County');
    await created('worlds', world);
    await created('worlds', other);

    const nested = await add(world.id, [{ schema: WORLD_SCHEMA, id: other.id, name: other.name }]);
    expect(nested.status).toBe(400);
    const itself = await add(world.id, [
      { schema: 'storyengine.lorebook/1', id: world.id, name: 'itself' },
    ]);
    expect(itself.status).toBe(400);
    expect((await readWorld(world.id)).object.contents).toEqual([]);
  });

  it('answers not-found for a World that is not there, and for a kind that is not a World', async () => {
    const book = newLorebook('The Docks');
    await created('lorebooks', book);
    const missing = await add('0199c000-0000-7000-8000-0000000000ff', [
      { schema: book.schema, id: book.id },
    ]);
    expect(missing.status).toBe(404);
    const notAWorld = await add(book.id, [
      { schema: book.schema, id: '0199c000-0000-7000-8000-0000000000fe' },
    ]);
    expect(notAWorld.status).toBe(404);
  });
});

describe('seen from a member', () => {
  it('lists the World on a library member’s Used by, and names a session among its members', async () => {
    const world = newWorld('Rain City');
    const book = newLorebook('The Docks');
    await created('worlds', world);
    await created('lorebooks', book);
    const session = await startSession('A night at the docks');
    await add(world.id, [
      { schema: book.schema, id: book.id, name: book.name },
      { schema: 'storyengine.session/1', id: session.id, name: session.name },
    ]);

    const links = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}/links`,
    });
    expect(links.status).toBe(200);
    expect(links.body.usedBy).toEqual([
      { fromKind: WORLD_SCHEMA, fromId: world.id, fromName: 'Rain City' },
    ]);

    // A session's *In these Worlds* is the Worlds whose contents name it —
    // the client reads it off the list of Worlds, which carries their bodies.
    const worlds = await server.request({ method: 'GET', url: '/api/library/worlds' });
    const holding = (
      worlds.body.objects as { id: string; object: { contents: { id: string }[] } }[]
    ).filter((one) => one.object.contents.some((member) => member.id === session.id));
    expect(holding.map((one) => one.id)).toEqual([world.id]);
  });
});

describe('membership is not ownership', () => {
  /**
   * ***The test P16 §1.2 says nothing had.*** Deleting a World moves its folder
   * to the trash and nothing else; a change that taught delete to follow
   * `contents` would fail here rather than ship.
   */
  it('deletes a World and leaves every member it held readable', async () => {
    const world = newWorld('Rain City');
    const book = newLorebook('The Docks');
    await created('worlds', world);
    await created('lorebooks', book);
    const session = await startSession('A night at the docks');
    const added = await add(world.id, [
      { schema: book.schema, id: book.id, name: book.name },
      { schema: 'storyengine.session/1', id: session.id, name: session.name },
    ]);

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/worlds/${world.id}`,
      headers: { 'if-match': added.body.contentHash as string },
    });
    expect(removed.status).toBe(204);

    expect(
      (await server.request({ method: 'GET', url: `/api/library/lorebooks/${book.id}` })).status,
    ).toBe(200);
    expect(
      (await server.request({ method: 'GET', url: `/api/sessions/${session.id}` })).status,
    ).toBe(200);
  });

  /**
   * ***And a World never blocks a delete*** — [26 B2] one level up. The member
   * goes; the World keeps naming it, which is a dangling reference, visible and
   * non-blocking, and the correct outcome rather than a repair to make.
   */
  it('lets a member be deleted, and keeps naming it', async () => {
    const world = newWorld('Rain City');
    const book = newLorebook('The Docks');
    await created('worlds', world);
    await created('lorebooks', book);
    await add(world.id, [{ schema: book.schema, id: book.id, name: book.name }]);

    const read = await server.request({ method: 'GET', url: `/api/library/lorebooks/${book.id}` });
    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${book.id}`,
      headers: { 'if-match': read.body.contentHash as string },
    });
    expect(removed.status).toBe(204);

    expect((await readWorld(world.id)).object.contents).toEqual([
      { schema: book.schema, id: book.id, name: 'The Docks' },
    ]);
  });

  it('lets a session member be deleted, and keeps naming it', async () => {
    const world = newWorld('Rain City');
    await created('worlds', world);
    const session = await startSession('A night at the docks');
    await add(world.id, [{ schema: 'storyengine.session/1', id: session.id, name: session.name }]);

    const removed = await server.request({ method: 'DELETE', url: `/api/sessions/${session.id}` });
    expect(removed.status).toBeLessThan(300);
    expect((await readWorld(world.id)).object.contents.map((member) => member.id)).toEqual([
      session.id,
    ]);
  });
});
