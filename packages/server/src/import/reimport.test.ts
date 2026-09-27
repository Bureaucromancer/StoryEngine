// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLoreEntry, newLorebook } from '@storyengine/shared';

import { read } from '../library.js';
import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { sillyTavernFixture } from './fixtures/test-sillytavern.js';
import { MemoryFileSource } from './memory-source.js';
import { sweep } from './sweep.js';
import type { ConflictPolicy } from './identity.js';

/**
 * **Gate step 6: re-import the same directory, and nothing doubles silently**
 * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * Until P4.4 the sweep wrote through `create()` alone, so a second run over one
 * directory either collided on the global id check or — because import mints
 * fresh ids — quietly produced a second copy of everything. That is the failure
 * this stage exists to close, and it is invisible until somebody's library has
 * two of each card.
 *
 * The identity rule is **same owner, same kind, same
 * `Provenance.originalFilename`**, and it is not id-based because foreign files
 * have no id worth keying on: a V2 card carries none at all, and a world file's
 * identity *is* its name.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

async function run(tree: Record<string, Uint8Array | string>, onConflict?: ConflictPolicy) {
  const outcome = await sweep({
    library: server.services.library,
    handle: 'ned',
    files: new MemoryFileSource(tree),
    ...(onConflict === undefined ? {} : { onConflict }),
  });
  if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
  return outcome.report;
}

async function actors(): Promise<{ id: string; name: string }[]> {
  const listed = await server.request({ method: 'GET', url: '/api/library/actors' });
  return listed.body.objects as { id: string; name: string }[];
}

describe('sweeping the same directory twice', () => {
  it('leaves one of everything, not two', async () => {
    const tree = sillyTavernFixture();
    const first = await run(tree);
    const before = await actors();

    const second = await run(tree);

    expect(await actors()).toHaveLength(before.length);
    expect(before.length).toBeGreaterThan(0);
    // And the second run says so rather than reporting a fresh import.
    expect(second.counts.unchanged).toBeGreaterThan(0);
    expect(second.counts.converted).toBeLessThan(first.counts.converted);
  });

  it('keeps the same object, not a replacement that happens to match', async () => {
    // Ids are the test: a rule that deleted and recreated would pass a count
    // check and lose every link pointing at the object.
    const tree = sillyTavernFixture();
    await run(tree);
    const before = await actors();

    await run(tree);

    expect((await actors()).map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );
  });

  it('reports unchanged rather than skipped, because they are different answers', async () => {
    // `skipped` means *we chose not to take this*. `unchanged` means *we took it
    // and it was already right* — which is what somebody re-running a sweep
    // needs to see.
    const tree = sillyTavernFixture();
    await run(tree);
    const second = await run(tree);

    const vera = second.items.find((item) => item.source === 'characters/Vera Solano.png');
    expect(vera?.disposition).toBe('unchanged');
    expect(vera?.notes.map((note) => note.key)).toContain('import.object.unchanged');
  });
});

describe('when the source file has changed', () => {
  /** The same tree, with one card's description edited. */
  function edited(): Record<string, Uint8Array | string> {
    const tree = sillyTavernFixture();
    const world = JSON.parse(String(tree['worlds/Rain City.json'])) as {
      entries: Record<string, { content: string }>;
    };
    const entry = world.entries['0'];
    if (entry) entry.content = 'The docks are quiet now.';
    return { ...tree, 'worlds/Rain City.json': JSON.stringify(world) };
  }

  it('replaces by default, and the version history records what it replaced', async () => {
    // Replace is the default because it is the *safe* one: the write goes
    // through `update()`, so the state it replaced becomes a version rather
    // than a loss — and this is the `{ kind: 'import' }` attribution's first
    // writer, three phases after the type declared it.
    await run(sillyTavernFixture());
    const books = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    const book = (books.body.objects as { id: string }[])[0]?.id ?? '';

    const report = await run(edited());

    expect(report.items.some((i) => i.notes.some((n) => n.key === 'import.object.replaced'))).toBe(
      true,
    );

    const history = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book}/history`,
    });
    const versions = history.body.versions as { source: { kind: string } }[];
    expect(versions.some((version) => version.source.kind === 'import')).toBe(true);
  });

  it('keeps both when asked, and says which', async () => {
    await run(sillyTavernFixture());
    const before = await server.request({ method: 'GET', url: '/api/library/lorebooks' });

    const report = await run(edited(), 'keep-both');

    const after = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect((after.body.objects as unknown[]).length).toBe(
      (before.body.objects as unknown[]).length + 1,
    );
    expect(report.items.some((i) => i.notes.some((n) => n.key === 'import.object.keptBoth'))).toBe(
      true,
    );
  });

  it('writes nothing when asked to skip, and reports the difference', async () => {
    await run(sillyTavernFixture());
    const before = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    const book = (before.body.objects as { id: string }[])[0]?.id ?? '';

    const report = await run(edited(), 'skip');

    const after = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book}`,
    });
    expect(after.body.object.entries[0].content).toBe(
      'The docks run on paperwork and nobody reads it.',
    );
    expect(
      report.items.some((i) => i.notes.some((n) => n.key === 'import.object.differsAndKept')),
    ).toBe(true);
  });
});

/**
 * ***A card and the book it carries point at each other by the ids they have
 * here*** (2026-09-27). The converter linked them with ids it had just minted,
 * and `identify` moved each to its earlier id only as it was stored, so every
 * re-import wrote a book scoped to an actor that did not exist and an actor
 * linked to a book never stored. Neither compared `unchanged`, ever.
 */
describe('a card that carries its own lorebook', () => {
  const card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Vera Solano',
      description: 'A harbourmaster.',
      first_mes: 'You are late.',
      character_book: {
        name: 'The harbour',
        entries: [{ keys: ['tide'], content: 'The tide turns at six.', enabled: true }],
      },
    },
  };
  const tree = { 'Vera Solano.png': withChunks(makePng(), [base64TextChunk('chara', card)]) };

  it('comes back unchanged, and each names the other as it is', async () => {
    await run(tree);
    const second = await run(tree);

    expect(second.counts.converted).toBe(0);
    const actor = (await actors()).find((row) => row.name === 'Vera Solano');
    const actorBody = read(server.services.library, 'ned', actor?.id ?? '').body as {
      lore: { id: string }[];
    };
    const book = read(server.services.library, 'ned', actorBody.lore[0]?.id ?? '').body as {
      scope: { actorIds: string[] };
    };
    expect(book.scope.actorIds).toEqual([actor?.id]);
  });
});

/**
 * ***One of our own files, downloaded and brought back*** (2026-09-27). A
 * lorebook this build wrote has `entries`, and the probe gave it to the
 * SillyTavern converter, which reads `disable` for off: every entry its author
 * had switched off came back on.
 */
describe('a file this build wrote', () => {
  it('is read as ours: what was off stays off, and a second time is unchanged', async () => {
    const book = newLorebook('Rain City');
    const off = newLoreEntry('Closed for the season');
    off.keys = ['ferry'];
    off.content = 'The ferry does not run in winter.';
    off.enabled = false;
    book.entries = [off];
    const tree = { 'rain-city.json': JSON.stringify(book) };

    await run(tree);
    const second = await run(tree);

    const stored = read(server.services.library, 'ned', book.id).body as {
      entries: { enabled: boolean }[];
    };
    expect(stored.entries.map((entry) => entry.enabled)).toEqual([false]);
    expect(second.counts.unchanged).toBe(1);
  });
});
