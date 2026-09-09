// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOREBOOK_SCHEMA, newLorebook, type Lorebook } from '@storyengine/shared';

import { userOwner } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * **P2C finding 8** — *a broken library file becomes permanently unwritable and
 * undeletable* ([P2C log](../../../../docs/design/workplan/14-p2c-log.md)).
 *
 * The log recorded three successive writes each answering `412 stale` with a
 * `current.contentHash` byte-identical to the hash just presented, so the
 * documented reload-and-reapply recovery could not terminate — and `DELETE`
 * answered the same way, so the file could not be removed either. *"The only
 * exit is a text editor."*
 *
 * [P4 §2](../../../../docs/design/workplan/16-p4-implementation.md)'s P4.0 asks
 * for it verified fixed or fixed here, because import walks this exact path in
 * bulk: a wild-corpus object that lands broken, or a re-import over one, goes
 * straight into it.
 *
 * The two claims below are the two halves of the finding, and the third test is
 * the invariant that makes the first one more than an example.
 */
let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

/**
 * Creates a lorebook and returns its id, hash and path on disk.
 *
 * A lorebook rather than an actor because the finding is about *a hand edit
 * into invalid JSON*, and a lorebook is stored as JSON. An actor's canonical
 * file is `card.png` ([03 §5.2]), so breaking one is a different kind of
 * damage; the code path under test is the same for both.
 */
async function createLorebook(
  name: string,
): Promise<{ id: string; hash: string; path: string; object: Lorebook }> {
  const book = newLorebook(name);
  const created = await server.request({
    method: 'POST',
    url: '/api/library/lorebooks',
    payload: { object: book },
  });
  expect(created.status).toBe(201);

  const row = await server.request({ method: 'GET', url: `/api/library/lorebooks/${book.id}` });
  expect(row.status).toBe(200);

  return {
    object: book,
    id: book.id,
    hash: created.headers['etag'] as string,
    path: server.services.layout.objectFile(userOwner('ned'), LOREBOOK_SCHEMA, row.body.slug),
  };
}

describe('a file broken behind the index does not trap the object', () => {
  it('refuses the write as diverged rather than stale, so the recovery can end', async () => {
    const book = await createLorebook('Vera Solano');

    // Exactly what the manual gate tells a tester to do, and what a half-written
    // import would leave behind: the bytes stop being the object.
    await writeFile(book.path, '{ this is not json', 'utf8');

    const first = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: { object: { ...book.object, name: 'Vera Solano renamed' } },
      headers: { 'if-match': book.hash },
    });

    expect(first.status).toBe(409);
    expect(first.body.error).toBe('diverged');
    // No envelope: handing back the stale row is what invited the retry.
    expect(first.body.current).toBeUndefined();
  });

  it('deletes it, because the file a person most needs to remove was the one refused', async () => {
    const book = await createLorebook('Vera Solano');
    await writeFile(book.path, 'not an actor at all', 'utf8');

    const deleted = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${book.id}`,
      headers: { 'if-match': book.hash },
    });

    expect(deleted.status).toBe(204);

    const after = await server.request({ method: 'GET', url: `/api/library/lorebooks/${book.id}` });
    expect(after.status).toBe(404);
  });

  /**
   * The invariant behind the first test, stated so a future 412 cannot
   * reintroduce the loop from somewhere else: **a 412 must never answer with
   * the hash the caller just presented.** That is the whole of what made the
   * finding non-terminating, and it is a property of the status code rather
   * than of this route.
   */
  it('never answers 412 with the hash the caller sent', async () => {
    const book = await createLorebook('Vera Solano');
    await writeFile(book.path, '{ broken', 'utf8');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await server.request({
        method: 'PUT',
        url: `/api/library/lorebooks/${book.id}`,
        payload: { object: { ...book.object, name: 'Vera Solano renamed' } },
        headers: { 'if-match': book.hash },
      });

      if (response.status === 412) {
        expect(response.body.current?.contentHash, 'a 412 that cannot be acted on').not.toBe(
          book.hash,
        );
      }
    }
  });

  /**
   * The fix must not swallow the real staleness case, and this is the line
   * between them: a *readable* edit landing underneath is still `412`, because
   * reload-and-reapply is the right move there. What changed is that the
   * envelope now describes the file rather than the stale index row — so the
   * hash differs from the one presented and the caller can act on it at once,
   * instead of retrying until the watcher settles.
   */
  it('still answers 412 for a readable edit, with the hash of what is actually there', async () => {
    const book = await createLorebook('Vera Solano');

    const stored = JSON.parse(await readFile(book.path, 'utf8')) as Record<string, unknown>;
    await writeFile(
      book.path,
      JSON.stringify({ ...stored, name: 'Vera Solano the second' }),
      'utf8',
    );

    const response = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: { object: { ...book.object, name: 'Vera Solano renamed' } },
      headers: { 'if-match': book.hash },
    });

    expect(response.status).toBe(412);
    expect(response.body.current.contentHash).not.toBe(book.hash);
    expect(response.body.current.object.name).toBe('Vera Solano the second');
  });

  /**
   * And the same line for delete, which is where refusing was the *more*
   * destructive option: a readable edit underneath is protected, damage is not.
   */
  it('refuses to delete over a readable edit, and allows it over damage', async () => {
    const readable = await createLorebook('Rain City');
    const stored = JSON.parse(await readFile(readable.path, 'utf8')) as Record<string, unknown>;
    await writeFile(
      readable.path,
      JSON.stringify({ ...stored, name: 'Rain City by hand' }),
      'utf8',
    );

    const refused = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${readable.id}`,
      headers: { 'if-match': readable.hash },
    });
    expect(refused.status).toBe(412);

    const damaged = await createLorebook('Ash Harbour');
    await writeFile(damaged.path, '{ not json', 'utf8');

    const allowed = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${damaged.id}`,
      headers: { 'if-match': damaged.hash },
    });
    expect(allowed.status).toBe(204);
  });
});
