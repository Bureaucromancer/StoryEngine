// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { importNotesFor } from './jobs.js';

/**
 * **Gate step 11, as written**: *fetch the review report over the API*
 * ([P4 §7.4](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * The substance of that step held from P4.4 — the report is `{key, params}` and
 * the sentences are composed client-side — but the word *fetch* was not true of
 * anything: the report existed only in the POST response, so it answered once
 * and was gone when the page closed. `import_job` and `import_event` were
 * created in the same stage and nothing wrote them.
 *
 * The tests below are the two halves of *addressable*: it can be fetched back by
 * id, and it can be asked the question a person will actually have — **what did
 * the import say about this object** — which is the lookup [P5 §1.8] needs and
 * the reason the item table carries an `object_id` at all.
 */

let server: TestServer;
let root: string;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);

  // A real directory, because the sweep route is the one that records a job and
  // it takes a path rather than bytes.
  root = await mkdtemp(join(tmpdir(), 'se-jobs-'));
  await mkdir(join(root, 'cards'), { recursive: true });
  await writeFile(
    join(root, 'cards', 'Vera.png'),
    Buffer.from(
      withChunks(makePng(), [
        base64TextChunk('chara', {
          name: 'Vera Solano',
          description: 'A harbourmaster.',
          first_mes: 'You are late.',
        }),
      ]),
    ),
  );
  await writeFile(join(root, 'notes.txt'), 'buy milk');
});

afterEach(async () => {
  await server.dispose();
});

/** The sweep needs the capability [10 §4.2.2] widened. */
async function grantFileAccess(): Promise<void> {
  const accounts = await server.request({ method: 'GET', url: '/api/admin/accounts' });
  const handle = (accounts.body.accounts as { handle: string }[])[0]?.handle ?? 'ned';
  await server.request({
    method: 'PATCH',
    url: `/api/admin/accounts/${handle}`,
    payload: { capabilities: { fileAccess: 'read' } },
  });
}

async function sweepRoot() {
  await grantFileAccess();
  return server.request({ method: 'POST', url: '/api/import/sweep', payload: { root } });
}

describe('the review has an address', () => {
  it('comes back by id, in the shape the panel already renders', async () => {
    const swept = await sweepRoot();
    expect(swept.status).toBe(200);

    const jobId = swept.body.report.jobId as string;
    expect(jobId).not.toBe('unsaved');

    const fetched = await server.request({ method: 'GET', url: `/api/import/jobs/${jobId}` });

    expect(fetched.status).toBe(200);
    // The same report, not an adjacent summary of it — which is what makes one
    // client renderer correct for both.
    expect(fetched.body.report.items).toEqual(swept.body.report.items);
    expect(fetched.body.report.counts).toEqual(swept.body.report.counts);
    expect(fetched.body.report.source).toBe(swept.body.report.source);
  });

  it('lists past imports with their counts, not their rows', async () => {
    await sweepRoot();
    await sweepRoot();

    const listed = await server.request({ method: 'GET', url: '/api/import/jobs' });

    expect(listed.status).toBe(200);
    const jobs = listed.body.jobs as {
      root: string;
      status: string;
      counts: Record<string, number>;
    }[];
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.status).toBe('finished');
    // The absolute root lives here and only here ([22 §4.1.1]) — the person who
    // typed it can see it, and no per-item row repeats it.
    expect(jobs[0]?.root).toBe(root);

    // **Newest first, and the two say different things** — which is the point of
    // keeping them rather than only the last. The second run of the same root is
    // a re-import: nothing converts, everything reads `unchanged`, and a ledger
    // that could not show that would not be worth having.
    expect(jobs[1]?.counts['converted']).toBeGreaterThan(0);
    expect(jobs[0]?.counts['converted']).toBe(0);
    expect(jobs[0]?.counts['unchanged']).toBeGreaterThan(0);
  });

  it('records a refused root as a job, because that is an answer too', async () => {
    await grantFileAccess();
    const refused = await server.request({
      method: 'POST',
      url: '/api/import/sweep',
      payload: { root: join(root, 'nowhere-at-all') },
    });
    expect(refused.status).toBe(422);

    const listed = await server.request({ method: 'GET', url: '/api/import/jobs' });
    const jobs = listed.body.jobs as { status: string; source: string }[];
    expect(jobs[0]?.status).toBe('refused');
    expect(jobs[0]?.source).toBe('unreadable-root');
  });

  it('is 404 for somebody else’s import, not 403', async () => {
    // [09 §4.4]'s posture: an id must not be a probe for what other people have
    // imported, so missing and forbidden are the same answer.
    const swept = await sweepRoot();
    const jobId = swept.body.report.jobId as string;

    const other = await makeTestServer();
    await setUpAdmin(other);
    const fetched = await other.request({ method: 'GET', url: `/api/import/jobs/${jobId}` });

    expect(fetched.status).toBe(404);
    await other.dispose();
  });
});

describe('what the import said about one object', () => {
  it('answers by object id, which is the lookup P5 needs', async () => {
    // §1.8 of the P5 plan decides that an import's consequences belong on the
    // object's own page — a clamped entry limit, a collapsed position — because
    // that is where somebody asks six months later. This is the query behind it,
    // and the reason `import_item` carries `object_id` rather than only a source.
    const swept = await sweepRoot();
    const converted = (swept.body.report.items as { objectId?: string }[]).find(
      (item) => item.objectId !== undefined,
    );
    expect(converted?.objectId).toBeDefined();

    const rows = importNotesFor(server.services.state.db, 'ned', converted!.objectId!);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('cards/Vera.png');
  });

  it('says nothing about an object no import produced', () => {
    expect(importNotesFor(server.services.state.db, 'ned', 'not-an-id')).toEqual([]);
  });
});

/**
 * The two things [P5 §1.8]'s first caller had to fix before it could be one.
 *
 * Both were invisible while `importNotesFor` had no callers, which is the
 * general shape worth remembering: a query nobody calls is a query nobody has
 * checked, and its first caller inherits whatever it got wrong.
 */
describe('the notes a book can actually find', () => {
  /**
   * **A card carrying a `character_book` makes two objects from one file**, and
   * the review is a row per file — so the book had no row of its own and
   * `importNotesFor(bookId)` answered nothing for what `ImportPanel` itself
   * calls "most of them". `recordImport` writes a row per produced object now,
   * sharing the item's `seq`.
   */
  /**
   * The card with the book is written *here* rather than into the shared
   * fixture, and that is a finding rather than tidiness: adding a
   * `character_book` to the fixture card made the "a second sweep converts
   * nothing" test fail, because **re-importing a card that carries a book
   * re-converts it** instead of reporting it unchanged. That is P4's
   * re-import-identity question ([P4 §7.14]) reached from a fourth direction —
   * the embedded book's identity is not stable across imports, so the actor's
   * link to it changes and the actor reads as changed. Not this stage's to fix,
   * and not a reason to weaken an assertion that is right.
   */
  async function cardCarryingABook(): Promise<void> {
    await writeFile(
      join(root, 'cards', 'Mira.png'),
      Buffer.from(
        withChunks(makePng(), [
          base64TextChunk('chara', {
            name: 'Mira Vance',
            description: 'A dock clerk.',
            first_mes: 'Sign here.',
            character_book: {
              name: 'Mira’s notes',
              entries: [
                { keys: ['harbour'], content: 'The cranes never stop.', comment: 'Harbour' },
              ],
            },
          }),
        ]),
      ),
    );
  }

  it('answers for a book that arrived inside a card', async () => {
    await cardCarryingABook();
    const swept = await sweepRoot();
    const card = (swept.body.report.items as { source: string; objectId?: string }[]).find(
      (item) => item.source === 'cards/Mira.png',
    );

    const books = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    const book = (books.body.objects as { id: string }[])[0];
    expect(book, 'the card carries a character_book').toBeDefined();
    expect(book!.id).not.toBe(card!.objectId);

    const rows = importNotesFor(server.services.state.db, 'ned', book!.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('cards/Mira.png');
  });

  /** And the review is unchanged by it: one item per file seen, not per object. */
  it('leaves the review a row per file rather than per object', async () => {
    await cardCarryingABook();
    const swept = await sweepRoot();
    const jobId = swept.body.report.jobId as string;

    const fetched = await server.request({ method: 'GET', url: `/api/import/jobs/${jobId}` });

    const sources = (fetched.body.report.items as { source: string }[]).map((item) => item.source);
    expect(sources).toEqual([...new Set(sources)]);
    expect(fetched.body.report.items).toEqual(swept.body.report.items);

    /**
     * **And the counts are files too.** Found by mutation: counting rows
     * instead of distinct `seq` left every other assertion green, because the
     * shared fixture card carries no book and so no `seq` has two rows. A
     * sweep of a hundred cards carrying books would have reported two hundred
     * conversions — the kind of wrong that reads as plausible.
     */
    const listed = await server.request({ method: 'GET', url: '/api/import/jobs' });
    const counts = (listed.body.jobs as { counts: Record<string, number> }[])[0]?.counts;
    expect(counts?.['converted']).toBe(
      (swept.body.report.items as { disposition: string }[]).filter(
        (item) => item.disposition === 'converted',
      ).length,
    );
  });

  /**
   * **Scoped by account**, which it was not when it was written. An object id is
   * a uuid and hard to guess, but *hard to guess* is not an access rule.
   */
  it('does not answer about another account’s import', async () => {
    const swept = await sweepRoot();
    const converted = (swept.body.report.items as { objectId?: string }[]).find(
      (item) => item.objectId !== undefined,
    );

    expect(importNotesFor(server.services.state.db, 'somebody-else', converted!.objectId!)).toEqual(
      [],
    );
  });

  it('serves them over a route, which is what the book page reads', async () => {
    const swept = await sweepRoot();
    const converted = (swept.body.report.items as { objectId?: string }[]).find(
      (item) => item.objectId !== undefined,
    );

    const fetched = await server.request({
      method: 'GET',
      url: `/api/import/objects/${converted!.objectId!}/notes`,
    });

    expect(fetched.status).toBe(200);
    expect((fetched.body.notes as { source: string }[])[0]?.source).toBe('cards/Vera.png');
  });

  /**
   * An object with nothing recorded gets an empty list rather than a 404: made
   * by hand, or brought in through a route that records no job, is not an
   * error, and the page has to tell "nothing recorded" from "no such thing".
   */
  it('answers an object with no import at all with nothing, not with a 404', async () => {
    const fetched = await server.request({
      method: 'GET',
      url: '/api/import/objects/01a008de-7e08-70d0-899c-f6869d6b9aeb/notes',
    });

    expect(fetched.status).toBe(200);
    expect(fetched.body.notes).toEqual([]);
  });
});
