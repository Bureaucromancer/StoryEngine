// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newActor, newLorebook, newLoreEntry } from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * Adoption and renaming — [05 §3](../../../../docs/design/05-tagging.md) and §1.
 *
 * **This is the riskiest code on the branch** and it is tested through the API
 * rather than against the functions, because what matters is what ends up on
 * disk. Adoption is a write across every object somebody owns; getting it wrong
 * loses tags or mints duplicates, and neither would be obvious.
 *
 * The claim the whole design rests on is the last one: after adoption, a rename
 * is **one registry write** and every carrier reads back under the new name
 * without being touched.
 */

let server: TestServer;

async function makeActor(name: string, tags: string[]): Promise<string> {
  const response = await server.request({
    method: 'POST',
    url: '/api/library/actors',
    payload: { object: { ...newActor(name), tags } },
  });
  if (response.status !== 201) throw new Error(`create failed: ${String(response.status)}`);
  return response.body.id as string;
}

async function readActor(id: string) {
  const response = await server.request({ method: 'GET', url: `/api/library/actors/${id}` });
  return response.body.object as { tags: string[]; tagIds?: string[] };
}

async function adopt() {
  return server.request({ method: 'POST', url: '/api/tags/adopt' });
}

async function tags() {
  return (await server.request({ method: 'GET', url: '/api/tags' })).body.tags as {
    id: string;
    name: string;
  }[];
}

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

describe('adoption', () => {
  it('mints an entry for every name in use and stamps the ids', async () => {
    const id = await makeActor('Vera', ['noir', 'city']);

    const report = await adopt();

    expect(report.status).toBe(200);
    expect([...(report.body.minted as string[])].sort()).toEqual(['city', 'noir']);

    const actor = await readActor(id);
    expect(actor.tags).toEqual(['noir', 'city']);
    expect(actor.tagIds).toHaveLength(2);

    // Index-aligned with the names, which is what lets a dangling id fall back
    // to the name beside it.
    const registry = await tags();
    const byName = new Map(registry.map((tag) => [tag.name, tag.id]));
    expect(actor.tagIds).toEqual([byName.get('noir'), byName.get('city')]);
  });

  /**
   * **Idempotent, and load-bearing rather than tidy.** A second run has to be
   * free, so a half-finished first run can simply be repeated — and so nobody
   * is punished for pressing the button twice.
   */
  it('mints nothing and writes nothing on a second run', async () => {
    await makeActor('Vera', ['noir']);
    await adopt();

    const second = await adopt();

    expect(second.body.minted).toEqual([]);
    expect(second.body.adopted).toEqual([]);
    expect(second.body.unchanged).toBe(1);
    expect((await tags()).length).toBe(1);
  });

  it('reuses an entry that already exists rather than minting a twin', async () => {
    await server.request({ method: 'POST', url: '/api/tags', payload: { name: 'Noir' } });
    await makeActor('Vera', ['noir']);

    const report = await adopt();

    expect(report.body.minted).toEqual([]);
    const registry = await tags();
    expect(registry.map((tag) => tag.name)).toEqual(['Noir']);
  });

  it('adopts an object with no tags as having none, not as unadopted', async () => {
    const id = await makeActor('Vera', []);

    await adopt();

    // `[]` rather than absent: the difference is what tells "no tags" from
    // "never adopted", and the adoption pass has to write the first.
    expect((await readActor(id)).tagIds).toEqual([]);
  });

  it('leaves the names on disk exactly as they were', async () => {
    const id = await makeActor('Vera', ['Noir', 'city']);

    await adopt();

    // The readable copy is the author's spelling and adoption is not a rename.
    expect((await readActor(id)).tags).toEqual(['Noir', 'city']);
  });
});

/**
 * **The claim the ids exist for.** After adoption a rename touches the registry
 * and nothing else, and every carrier reads back under the new name.
 */
describe('renaming an adopted tag', () => {
  it('changes what every carrier is called, without writing to any of them', async () => {
    const first = await makeActor('Vera', ['noir']);
    const second = await makeActor('Kohl', ['noir', 'city']);
    await adopt();

    const before = await server.request({ method: 'GET', url: `/api/library/actors/${first}` });
    const hashBefore = before.body.contentHash as string;

    const tag = (await tags()).find((row) => row.name === 'noir');
    const renamed = await server.request({
      method: 'POST',
      url: `/api/tags/${tag?.id ?? ''}/rename`,
      payload: { to: 'Noir Fiction' },
    });

    expect(renamed.status).toBe(200);
    expect((await readActor(first)).tags).toEqual(['Noir Fiction']);
    expect((await readActor(second)).tags).toEqual(['Noir Fiction', 'city']);

    // Not a write: the object's content hash is the one it had before.
    const after = await server.request({ method: 'GET', url: `/api/library/actors/${first}` });
    expect(after.body.contentHash).toBe(hashBefore);
  });

  it('refuses a name that is another tag, rather than merging quietly', async () => {
    await makeActor('Vera', ['noir', 'city']);
    await adopt();
    const tag = (await tags()).find((row) => row.name === 'noir');

    const response = await server.request({
      method: 'POST',
      url: `/api/tags/${tag?.id ?? ''}/rename`,
      payload: { to: 'City' },
    });

    expect(response.status).toBe(409);
    expect((await tags()).map((row) => row.name).sort()).toEqual(['city', 'noir']);
  });

  it('answers 404 for a tag that is not there', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/tags/nope/rename',
      payload: { to: 'Noir' },
    });

    expect(response.status).toBe(404);
  });

  /**
   * An object nobody adopted keeps its own names, because nothing connects the
   * name it holds to the registry row that changed. That is the state the
   * adoption button exists to leave behind, and it has to be harmless.
   */
  it('leaves an unadopted carrier under its old name', async () => {
    const id = await makeActor('Vera', ['noir']);
    await server.request({ method: 'POST', url: '/api/tags', payload: { name: 'noir' } });
    const tag = (await tags()).find((row) => row.name === 'noir');

    await server.request({
      method: 'POST',
      url: `/api/tags/${tag?.id ?? ''}/rename`,
      payload: { to: 'Noir Fiction' },
    });

    expect((await readActor(id)).tags).toEqual(['noir']);
  });
});

/**
 * **[05 §1]'s sharp edge.** A lore entry's `actorTagFilter` holds author-written
 * names and activation compares them exactly, so a rename that ignored them
 * would silently change which lore fires. Found always; rewritten only on ask.
 */
describe('the lore gates a rename would break', () => {
  async function makeGatedBook(gate: string): Promise<string> {
    const book = newLorebook('Ardent');
    const response = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: {
        object: {
          ...book,
          // The factory's shape, so the entry is the object the schema
          // describes rather than the subset this test happened to think of.
          entries: [
            {
              ...newLoreEntry('Harbour'),
              content: 'Cranes.',
              actorTagFilter: { mode: 'include', values: [gate] },
            },
          ],
        },
      },
    });
    if (response.status !== 201) {
      throw new Error(`book failed: ${String(response.status)} ${JSON.stringify(response.body)}`);
    }
    return response.body.id as string;
  }

  it('reports them without touching them by default', async () => {
    const bookId = await makeGatedBook('noir');
    await makeActor('Vera', ['noir']);
    await adopt();
    const tag = (await tags()).find((row) => row.name === 'noir');

    const response = await server.request({
      method: 'POST',
      url: `/api/tags/${tag?.id ?? ''}/rename`,
      payload: { to: 'Noir Fiction' },
    });

    expect(response.body.gatesFound).toEqual([{ book: 'Ardent', entry: 'Harbour' }]);
    expect(response.body.booksRewritten).toEqual([]);

    const book = await server.request({ method: 'GET', url: `/api/library/lorebooks/${bookId}` });
    const entries = book.body.object.entries as { actorTagFilter: { values: string[] } }[];
    expect(entries[0]?.actorTagFilter.values).toEqual(['noir']);
  });

  it('rewrites them when asked', async () => {
    const bookId = await makeGatedBook('noir');
    await makeActor('Vera', ['noir']);
    await adopt();
    const tag = (await tags()).find((row) => row.name === 'noir');

    const response = await server.request({
      method: 'POST',
      url: `/api/tags/${tag?.id ?? ''}/rename`,
      payload: { to: 'Noir Fiction', rewriteGates: true },
    });

    expect(response.body.booksRewritten).toEqual(['Ardent']);

    const book = await server.request({ method: 'GET', url: `/api/library/lorebooks/${bookId}` });
    const entries = book.body.object.entries as { actorTagFilter: { values: string[] } }[];
    expect(entries[0]?.actorTagFilter.values).toEqual(['Noir Fiction']);
  });

  /**
   * Compared exactly, because that is how activation compares them: a gate on
   * `Noir` is a different gate from one on `noir`, and rewriting both would be
   * the server deciding something the author did not.
   */
  it('leaves a gate that differs in case alone', async () => {
    const bookId = await makeGatedBook('Noir');
    await makeActor('Vera', ['noir']);
    await adopt();
    const tag = (await tags()).find((row) => row.name === 'noir');

    const response = await server.request({
      method: 'POST',
      url: `/api/tags/${tag?.id ?? ''}/rename`,
      payload: { to: 'Noir Fiction', rewriteGates: true },
    });

    expect(response.body.gatesFound).toEqual([]);
    const book = await server.request({ method: 'GET', url: `/api/library/lorebooks/${bookId}` });
    const entries = book.body.object.entries as { actorTagFilter: { values: string[] } }[];
    expect(entries[0]?.actorTagFilter.values).toEqual(['Noir']);
  });
});
