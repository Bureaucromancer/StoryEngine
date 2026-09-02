// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, uuidv7 } from '@storyengine/shared';

import { appendTurnToSession, createSession } from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * `GET /api/search` — F10's answer.
 *
 * The finding was an FTS index maintained on every write with **no caller**:
 * `search()` existed, was tested, and nothing could query it. This route is its
 * first one, and the second consumer that makes the shape honest — a person
 * looking for "the cathedral" does not know whether they wrote it in a lorebook
 * or said it in a turn.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

async function aTurnSaying(said: string, handle = 'ned'): Promise<string> {
  const session = await createSession(server.services.sessions, handle, 'Rain City');
  const turn: Turn = {
    id: uuidv7(),
    sessionId: session.id,
    parentTurnId: null,
    createdAt: new Date(Date.UTC(2026, 7, 16, 12)).toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'say', text: 'And then?', raw: '' },
    output: { text: said },
    effects: [],
    tape: [],
  };
  await appendTurnToSession(server.services.sessions, handle, session.id, turn);
  return turn.id;
}

describe('search', () => {
  it('answers with both objects and turns', async () => {
    await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: newLorebook('The Cathedral District'),
    });
    const turnId = await aTurnSaying('The cathedral was three streets east.');

    const found = await server.request({ method: 'GET', url: '/api/search?q=cathedral' });

    expect(found.status).toBe(200);
    expect(found.body.objects.map((row: { name: string }) => row.name)).toEqual([
      'The Cathedral District',
    ]);
    expect(found.body.turns.map((row: { turnId: string }) => row.turnId)).toEqual([turnId]);
  });

  it('never reaches another account', async () => {
    await aTurnSaying('The cathedral was three streets east.');
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

    const theirs = await server.request({ method: 'GET', url: '/api/search?q=cathedral' });
    // Exhaustive equality rather than `toMatchObject`, deliberately: this is the
    // anti-leak assertion, and what makes it prove anything is that *nothing*
    // came back under any key — including keys added later.
    expect(theirs.body).toEqual({ objects: [], turns: [], entries: [] });
  });

  it('needs a session', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const found = await server.request({ method: 'GET', url: '/api/search?q=cathedral' });
    expect(found.status).toBe(401);
  });

  it('rejects an empty query rather than returning everything', async () => {
    const found = await server.request({ method: 'GET', url: '/api/search?q=' });
    expect(found.status).toBe(400);
  });

  it('answers 400 to a query FTS cannot parse, not 500', async () => {
    // FTS5 has a syntax and a person typing into a search box does not know it.
    // An unbalanced quote is their problem to fix, not a server fault.
    const found = await server.request({ method: 'GET', url: '/api/search?q=%22unbalanced' });
    expect(found.status).toBe(400);
    expect(found.body.error).toBe('invalid');
  });
});

/**
 * **Exit-gate step 4** — [P5 §3](../../../../docs/design/workplan/07-p5-implementation.md):
 * *"A search phrase occurring in exactly one entry returns **that entry** with
 * a snippet, across books."*
 *
 * The phrase is the point: before this, a match inside a three-hundred-entry
 * book returned *the book*, which [05 §14.5] calls "close to useless at book
 * scale". So every assertion here is about the two things that make a hit worth
 * returning — the **address** (`objectId` plus `entryId`, which is exactly what
 * the book page's `?entry=` takes) and the **snippet**.
 */
describe('a phrase inside one entry of one book', () => {
  /**
   * Two books, so "across books" is a claim the fixture can actually break —
   * and **one nonsense word per indexed field**, which is the part that took a
   * mutation to get right.
   *
   * The first version gave the entry `keys: ['ferryman']` and called it *The
   * Ferryman*, so the keyword assertion passed through the `name` column and
   * unindexing `keys` entirely changed nothing. A field is only proved
   * searchable by a term that occurs in **that field and nowhere else**, which
   * is what these five invented words are for.
   */
  async function twoBooks(): Promise<void> {
    const ardent = {
      ...newLorebook('Ardent Harbour'),
      entries: [
        {
          ...newLoreEntry('The Ferryman vaskible'),
          keys: ['grendipole'],
          secondaryKeys: ['thurrowmast'],
          description: 'Only a knowledge router reads this: quennelith.',
          content: 'He has worked the crossing for thirty years and has never been seen to eat.',
        },
        { ...newLoreEntry('The Rain'), content: 'It falls for nine days at a time.' },
      ],
    };
    const elsewhere = {
      ...newLorebook('Elsewhere'),
      entries: [{ ...newLoreEntry('A Bridge'), content: 'Iron, older than the town.' }],
    };
    for (const payload of [ardent, elsewhere]) {
      await server.request({ method: 'POST', url: '/api/library/lorebooks', payload });
    }
  }

  it('returns that entry, addressed, with the matched text in the snippet', async () => {
    await twoBooks();

    const found = await server.request({ method: 'GET', url: '/api/search?q=crossing' });

    expect(found.status).toBe(200);
    expect(found.body.entries).toHaveLength(1);
    const [hit] = found.body.entries as {
      entryId: string;
      entryName: string;
      objectId: string;
      objectName: string;
      snippet: string;
      source: string;
    }[];

    expect(hit?.entryName).toBe('The Ferryman vaskible');
    expect(hit?.objectName).toBe('Ardent Harbour');
    expect(hit?.source).toBe('user');

    /**
     * **The snippet has to contain the term, not merely be a string.** FTS5's
     * `snippet()` takes a column index, and one pinned to the wrong column
     * returns the head of *that* field with nothing of the match in it — a
     * failure no assertion about the snippet's type or length can see. This is
     * the assertion that distinguishes a working snippet from a plausible one.
     */
    expect(hit?.snippet).toContain('crossing');

    // And the address is the one the book page already takes: `?entry=` on the
    // object's own route ([05 §5.3]).
    const book = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${String(hit?.objectId)}`,
    });
    expect(book.status).toBe(200);
    expect((book.body.object.entries as { id: string }[]).map((entry) => entry.id)).toContain(
      hit?.entryId,
    );
  });

  /**
   * **All five fields [05 §5.3] names, each proved by a word only it holds.**
   *
   * The list is not decoration: it is the same one the book page's own
   * within-book box searches, and two surfaces disagreeing about which entries
   * answer one query is the failure [P3 §5] recorded for JSON viewers. A term
   * that appears in two fields proves nothing about either — which is exactly
   * how an earlier version of this test passed while `keys` went unindexed.
   */
  it.each([
    ['name', 'vaskible'],
    ['keys', 'grendipole'],
    ['secondary keys', 'thurrowmast'],
    ['description', 'quennelith'],
    ['content', 'crossing'],
  ])('finds an entry by its %s', async (_field, term) => {
    await twoBooks();

    const found = await server.request({ method: 'GET', url: `/api/search?q=${term}` });

    expect((found.body.entries as { entryName: string }[]).map((row) => row.entryName)).toEqual([
      'The Ferryman vaskible',
    ]);
    // And the excerpt is drawn from whichever field matched, which is what the
    // `-1` column argument buys — a snippet pinned to `content` would come back
    // as the head of the prose with none of these words in it.
    expect((found.body.entries as { snippet: string }[])[0]?.snippet).toContain(term);
  });

  it('does not return an entry of a book another account owns', async () => {
    await twoBooks();
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

    const theirs = await server.request({ method: 'GET', url: '/api/search?q=crossing' });
    // The snippet is why this matters more than the object case: an unscoped
    // entry hit would carry somebody else's prose, not just a name.
    expect(theirs.body.entries).toEqual([]);
  });

  /**
   * A delete is a move to trash and the index answers it with a **tombstone**,
   * not a deletion — the row survives so a foreign rename can still be
   * recognised as one. So the entry rows survive too, and what has to be true
   * is that the query does not return them: the same `tombstoned_at is null`
   * join `search` has carried since P1, one table along.
   */
  it('stops finding an entry once its book is deleted', async () => {
    await twoBooks();
    const before = await server.request({ method: 'GET', url: '/api/search?q=crossing' });
    const id = String((before.body.entries as { objectId: string }[])[0]?.objectId);

    // The hash the delete has to present, which is the whole point of the
    // route asking for one — a delete is refused if the object moved.
    const read = await server.request({ method: 'GET', url: `/api/library/lorebooks/${id}` });
    const gone = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${id}`,
      headers: { 'if-match': read.body.contentHash as string },
    });
    expect(gone.status).toBe(204);

    const after = await server.request({ method: 'GET', url: '/api/search?q=crossing' });
    expect(after.body.entries).toEqual([]);
  });
});

describe('a querystring number', () => {
  it('is accepted, because the validator does not coerce', async () => {
    // This route shipped with `Type.Integer()` on `limit` and answered
    // *must be integer* to its own documented parameter: a query string carries
    // text, and this app's validator has `coerceTypes: false` on purpose (F2).
    // The rule generalises to every route added after this one.
    await aTurnSaying('The cathedral was three streets east.');

    const found = await server.request({ method: 'GET', url: '/api/search?q=cathedral&limit=10' });
    expect(found.status).toBe(200);
    expect(found.body.turns).toHaveLength(1);
  });

  it('is refused when it is not a number at all', async () => {
    const found = await server.request({ method: 'GET', url: '/api/search?q=x&limit=lots' });
    expect(found.status).toBe(400);
  });

  it('clamps rather than trusting the caller about how much to return', async () => {
    const found = await server.request({ method: 'GET', url: '/api/search?q=x&limit=999' });
    expect(found.status).toBe(200);
  });
});
