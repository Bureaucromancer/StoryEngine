// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, type Lorebook } from '@storyengine/shared';

import { ensureMemoryBook, memoryBookFor, scopeOf } from '../memory/books.js';
import { resolveLore } from '../turns/lore.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***A memory book is an ordinary library object, and says it is not one*** —
 * [P8.2]'s proof obligation, in `p2-gate-storage.test.ts`'s manner.
 *
 * **Both halves are the decision.** [P8 §1.1] chose library lorebooks over a
 * second indexed root and over a bespoke reader, and everything that choice buys
 * — the index, the shelf, the ordinary editor, history on write, the address
 * [08 §7](../../../../docs/design/08-cross-session-memory.md) needs for its
 * *link to the memory book itself* — is only real if the book really is
 * ordinary. **And everything it costs** — a derived, personal, often
 * embarrassing book sitting beside authored ones — is only survivable if the
 * book says what it is, which after that decision is a *marking* rather than a
 * location.
 *
 * So the first test is that nothing about it is special, and the second is that
 * one thing about it is.
 *
 * ---
 *
 * ***The third test is the one §1.1 turned on.*** The deciding argument was
 * neither of the two that section makes: it is that a book reaches a session by
 * being **found**, so the resolver has to answer *"the memory book for this
 * user, this actor and this persona"* as a **query** — and only the library
 * already has a table to ask. A test that only proved the book existed would
 * have proved the storage decision's premise and not its reason.
 */

const PASSWORD = 'correct horse battery';

let dataDir: string;
let server: TestServer;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-p8-storage-'));
  server = await makeTestServer({ dataDir });
  await setUpAdmin(server, 'ned', PASSWORD);
});

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/** An actor in the library, so a memory book has somebody to be about. */
async function anActor(name: string): Promise<string> {
  const actor = newActor(name);
  const created = await server.request({
    method: 'POST',
    url: '/api/library/actors',
    payload: actor,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return actor.id;
}

describe('a memory book is an ordinary library object', () => {
  it('is listed, addressable and openable like any other lorebook', async () => {
    const vera = await anActor('Vera');
    const made = await ensureMemoryBook(
      server.services.library,
      'ned',
      { actor: vera, persona: null },
      { actor: 'Vera', persona: null },
    );

    // Listed by the ordinary shelf route, not a memory one — there is no memory
    // route, which is the point.
    const shelf = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    const listed = (shelf.body.objects as { id: string; name: string }[]).find(
      (one) => one.id === made.id,
    );
    expect(listed?.name).toBe('Memories — Vera');

    /**
     * ***And it opens at a library address***, which is what
     * [08 §7](../../../../docs/design/08-cross-session-memory.md)'s *"a link to
     * the memory book itself, opening the ordinary lorebook editor"* needs and
     * what the `memories/` root could never have provided: that folder is
     * outside everything the index walks, so a book under it would have been
     * unindexed, unsearchable and unaddressable.
     */
    const opened = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${made.id}`,
    });
    expect(opened.status).toBe(200);
    expect(opened.body.object.schema).toBe('storyengine.lorebook/1');
    expect(opened.body.source).toBe('user');

    // The lorebook defaults are the lorebook's, not a second set: a memory book
    // that quietly disagreed about scan depth or budget would be a second
    // lorebook shape wearing the first one's schema.
    const book = opened.body.object as Lorebook;
    expect(book.scanDepth).toBe(2);
    expect(book.tokenBudget).toBe(2048);
    expect(book.entries).toEqual([]);
  });

  it('says it is not authored content, through a field that had no writer', async () => {
    const vera = await anActor('Vera');
    const made = await ensureMemoryBook(
      server.services.library,
      'ned',
      { actor: vera, persona: 'persona-1' },
      { actor: 'Vera', persona: 'Kestrel' },
    );

    const opened = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${made.id}`,
    });
    const book = opened.body.object as Lorebook;

    /**
     * **`provenance.source = 'session'` — a field with a reader rather than a
     * new field** ([P8 §1.9]).
     * [11 §4](../../../../docs/design/11-lorebooks-as-a-format.md) refuses new
     * lorebook fields by name; this one already exists, already travels with
     * every portable object, and had **no writer anywhere** outside
     * `import/identity.ts`. This is its first.
     */
    expect(book.provenance.source).toBe('session');

    // And the persona is in the name, so the shelf can tell two books about the
    // same character apart without opening either.
    expect(book.name).toBe('Memories — Vera (with Kestrel)');

    // The scope is a record of *named* keys, not a tuple — [P8 §1.2]'s
    // constraint, which is what a fourth key (a World) has to be able to extend.
    expect(scopeOf(book)).toEqual({ actor: vera, persona: 'persona-1' });
  });

  it('is found by a query rather than by a link, which is why it lives here', async () => {
    const vera = await anActor('Vera');
    const tomas = await anActor('Tomas');
    const hers = await ensureMemoryBook(
      server.services.library,
      'ned',
      { actor: vera, persona: 'persona-1' },
      { actor: 'Vera', persona: 'Kestrel' },
    );

    const library = server.services.library;
    expect(memoryBookFor(library, 'ned', { actor: vera, persona: 'persona-1' })?.id).toBe(hers.id);
    // A different persona is a different book, which is [08 §3]'s *per persona
    // by default* — "she is talking to a different person, and she should know a
    // different history."
    expect(memoryBookFor(library, 'ned', { actor: vera, persona: 'persona-2' })).toBeNull();
    // And a different actor is a different book.
    expect(memoryBookFor(library, 'ned', { actor: tomas, persona: 'persona-1' })).toBeNull();

    /**
     * ***The third `LoreRoute`, reporting itself*** — [P8.2], [P5.8].
     *
     * A memory book reaches a session because the engine found it for somebody
     * in the declared cast, not because anything links it — and it arrives as
     * `by: 'memory'` so the keyword tester can say **memory intake for Vera**
     * rather than leaving *why is this book being scanned* blank. The three
     * routes have three different repairs, which is the whole reason the row
     * carries one.
     */
    const resolved = resolveLore(library, 'ned', {
      cast: { persona: 'persona-1', actors: [vera] },
    });
    expect(resolved.books.map((one) => ({ id: one.id, by: one.by }))).toEqual([
      { id: hers.id, by: 'memory' },
    ]);
    // Never required: a session with no history of this character is every first
    // session, and a required link would make that a loud failure.
    expect(resolved.books[0]?.required).toBe(false);

    // The same session under the other persona reaches nothing — the resolver
    // half of gate step 5, before the widening setting exists to turn on.
    expect(
      resolveLore(library, 'ned', { cast: { persona: 'persona-2', actors: [vera] } }).books,
    ).toEqual([]);

    // And a session that declares no cast reaches nothing, which is what keeps
    // a preview built before the cast resolves from scanning the shelf.
    expect(resolveLore(library, 'ned', {}).books).toEqual([]);
  });

  /**
   * **Lazily, on the first write** — [P8.2]. A session with four actors would
   * otherwise put four empty books on the shelf the moment it started, and the
   * cost [P8 §1.1] prices as *one filter row and one badge* is only that small
   * while the books that exist are books that hold something.
   */
  it('creates one book and then finds it, rather than a second one', async () => {
    const vera = await anActor('Vera');
    const scope = { actor: vera, persona: null };
    const names = { actor: 'Vera', persona: null };
    const library = server.services.library;

    const first = await ensureMemoryBook(library, 'ned', scope, names);
    const again = await ensureMemoryBook(library, 'ned', scope, names);

    expect(again.id).toBe(first.id);
    const shelf = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect(
      (shelf.body.objects as { id: string }[]).filter((one) => one.id === first.id),
    ).toHaveLength(1);
  });
});
