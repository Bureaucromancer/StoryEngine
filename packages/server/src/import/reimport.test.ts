// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
