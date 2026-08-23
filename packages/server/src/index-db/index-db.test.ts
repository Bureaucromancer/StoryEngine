// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ACTOR_SCHEMA, LOREBOOK_SCHEMA, newActor, newLorebook } from '@storyengine/shared';

import { SelfWriteRegistry } from '../storage/atomic.js';
import { SYSTEM_OWNER } from '../storage/layout.js';
import { ingestFile, matureTombstones, removeFile, TOMBSTONE_TTL_MS } from './ingest.js';
import { startMaturation } from './maturation.js';
import { openIndex } from './open.js';
import { findById, listObjects, search, snapshot } from './query.js';
import { rebuild } from './rebuild.js';
import { actorWithId, makeTestLibrary, type TestLibrary } from './test-library.js';

/**
 * The index — docs/design/workplan/03-p1-implementation.md §P1.4.
 *
 * The stage plan calls this *"the part of P1 most likely to be got subtly
 * wrong"*, and the six claims below are the ones it names. The first is this
 * phase's CI gate.
 */

let library: TestLibrary;

beforeEach(async () => {
  library = await makeTestLibrary();
});

afterEach(async () => {
  await library.dispose();
});

describe('rebuild-from-disk equals the incremental index', () => {
  it('agrees after a mixed sequence of writes, edits and deletes', async () => {
    // [work plan P1](../../../../docs/design/workplan/01-work-plan.md)'s CI assertion, and sharper than it
    // looks: two independent producers held to one answer, rather than one
    // producer agreeing with itself ([02 §5.1.1](../../../../docs/design/02-data-model.md)).
    const vera = newActor('Vera Solano');
    await library.saveObject(vera, 'vera-solano');
    await library.saveObject(newLorebook('Rain City'), 'rain-city');
    await library.saveObject(newActor('Marlow'), 'marlow');

    // An edit in place — same object, changed name and body. Both have to move,
    // or a stale column survives incrementally that a rebuild would not
    // reproduce. The name matters specifically because it is the one the list
    // sorts on.
    await library.saveObject(
      { ...vera, name: 'Vera Solano, the fixer', aliases: ['the fixer'] },
      'vera-solano',
    );

    // A delete, matured so it is a real absence rather than a pending rename.
    const doomed = library.layout.objectFile(library.owner, ACTOR_SCHEMA, 'marlow');
    await rm(dirname(doomed), { recursive: true });
    removeFile(library.db, library.layout, doomed);
    matureTombstones(library.db, library.layout, Date.now() + TOMBSTONE_TTL_MS + 1);

    const incremental = snapshot(library.db);
    await rebuild(library.db, library.layout);

    expect(snapshot(library.db)).toEqual(incremental);
    expect(incremental).toHaveLength(2);
  });

  it('agrees about which of two duplicate ids is shadowed', async () => {
    // The sharp case. Path order is deterministic and identical whichever way
    // the index was reached, which is what makes this hold by construction
    // rather than by luck — an mtime-ordered rule would not
    // ([P1 §1.2](../../../../docs/design/workplan/03-p1-implementation.md)).
    const shared = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    await library.saveObject(actorWithId('Vera Solano', shared), 'vera-solano');
    await library.saveObject(actorWithId('Vera Solano', shared), 'vera-draft');

    const incremental = snapshot(library.db);
    await rebuild(library.db, library.layout);

    expect(snapshot(library.db)).toEqual(incremental);
  });

  it('picks the same winner on every platform, even when one slug prefixes another', async () => {
    // F23, and it is the case nobody would think to try. The rule is "earliest
    // path wins", and ordering the *stored* absolute paths puts the separator
    // into the comparison: after `vera`, Linux compares `/` (0x2F) against `2`
    // and Windows compares `\` (0x5C) against `2`. So `vera` won on one platform
    // and `vera2` on the other — for the exact user action gate step 12
    // describes, copying a folder — and the two CI legs would have disagreed.
    const shared = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
    await library.saveObject(actorWithId('Vera Solano', shared), 'vera');
    await library.saveObject(actorWithId('Vera Solano', shared), 'vera2');

    const live = snapshot(library.db).filter((line) => line.includes(shared));
    const winner = live.find((line) => line.split(' | ').at(-2) === '0');

    // `vera`, on both platforms, because the portable path is what is ordered.
    expect(winner).toContain(`${sep}vera${sep}`);
    expect(winner).not.toContain(`${sep}vera2${sep}`);

    // And a rebuild agrees, which is the property that made this findable.
    const incremental = snapshot(library.db);
    await rebuild(library.db, library.layout);
    expect(snapshot(library.db)).toEqual(incremental);
  });

  it('agrees after a foreign rename', async () => {
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    const moved = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'rain-city-noir');

    await mkdir(dirname(moved), { recursive: true });
    await rename(path, moved);
    removeFile(library.db, library.layout, path);
    await ingestFile(library.db, library.layout, moved);

    const incremental = snapshot(library.db);
    await rebuild(library.db, library.layout);

    expect(snapshot(library.db)).toEqual(incremental);
  });
});

describe('a foreign write is picked up', () => {
  it('indexes a file the application never wrote', async () => {
    // Hand edits, `git checkout`, a restored backup. The forcing function from
    // [05 §4.1](../../../../docs/design/05-ui-surfaces.md): if editing a file on disk does
    // not reflect, the storage design has failed on its own terms.
    const path = await library.writeObject(newLorebook('Rain City'), 'rain-city');
    expect(listObjects(library.db, { owners: [library.owner] })).toHaveLength(0);

    await ingestFile(library.db, library.layout, path);

    const [row] = listObjects(library.db, { owners: [library.owner] });
    expect(row?.name).toBe('Rain City');
  });

  it('reflects a hand edit to an already-indexed file', async () => {
    const book = newLorebook('Rain City');
    const path = await library.saveObject(book, 'rain-city');

    // Same id, new name — a hand edit, not a different object.
    await writeFile(path, JSON.stringify({ ...book, name: 'Rain City, after the fire' }));
    await ingestFile(library.db, library.layout, path);

    const rows = listObjects(library.db, { owners: [library.owner] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Rain City, after the fire');
    expect(rows[0]?.id).toBe(book.id);
  });
});

describe('a self-write does not double-index', () => {
  it('is claimed by the token the write registered', async () => {
    // `write-file-atomic` does temp-then-rename, so chokidar reports an add and
    // an unlink for every save. Without suppression the index does every job
    // twice ([02 §5.1.1](../../../../docs/design/02-data-model.md)).
    const registry = new SelfWriteRegistry();
    const own = await makeTestLibrary({ registry });

    try {
      const path = await own.saveObject(newLorebook('Rain City'), 'rain-city');
      const { statSync } = await import('node:fs');
      const stats = statSync(path);

      expect(registry.claim({ path, mtimeMs: stats.mtimeMs, size: stats.size })).toBe(true);
      // Consumed, so a genuinely foreign change moments later is not swallowed.
      expect(registry.claim({ path, mtimeMs: stats.mtimeMs, size: stats.size })).toBe(false);
    } finally {
      await own.dispose();
    }
  });

  it('re-ingesting the same file is idempotent', async () => {
    // Belt and braces: even if a self-write slipped past suppression, the index
    // must land in the same place rather than growing a duplicate row.
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    const once = snapshot(library.db);

    await ingestFile(library.db, library.layout, path);
    await ingestFile(library.db, library.layout, path);

    expect(snapshot(library.db)).toEqual(once);
  });
});

describe('deleting index.sqlite is a non-event', () => {
  it('rebuilds from disk on the next open', async () => {
    // [13 §5](../../../../docs/design/13-internal-contracts.md). The index's defining
    // property: losing it costs time and nothing else.
    await library.saveObject(newActor('Vera Solano'), 'vera-solano');
    await library.saveObject(newLorebook('Rain City'), 'rain-city');
    const before = snapshot(library.db);

    library.index.close();
    await rm(library.layout.indexFile, { force: true });

    const reopened = await openIndex({ path: library.layout.indexFile });
    try {
      // A fresh file reports the rebuild rather than leaving the caller to guess.
      expect(reopened.migration.rebuildRequired).toBe(true);
      expect(snapshot(reopened.db)).toEqual([]);

      await rebuild(reopened.db, library.layout);
      expect(snapshot(reopened.db)).toEqual(before);
    } finally {
      reopened.close();
    }
  });

  it('asks for a rebuild when the schema version moves', async () => {
    const reopened = await openIndex({ path: library.layout.indexFile });
    try {
      expect(reopened.migration.rebuildRequired).toBe(false);
      reopened.db.exec('pragma user_version = 999');
    } finally {
      reopened.close();
    }

    const afterBump = await openIndex({ path: library.layout.indexFile });
    try {
      // Wiped and recreated rather than migrated: every fact in here is a
      // restatement of something on disk, so preserving it buys nothing.
      expect(afterBump.migration).toMatchObject({ from: 999, rebuildRequired: true });
    } finally {
      afterBump.close();
    }
  });
});

describe('a foreign rename is a move, not a delete plus a create', () => {
  /** Rows waiting to find out whether they were half of a rename. */
  function tombstoneCount(): number {
    const row = library.db
      .prepare('select count(*) c from object where tombstoned_at is not null')
      .get() as { c: number };
    return row.c;
  }

  it('keeps the row, its id and its identity, under a new path', async () => {
    // [P1 §1.1](../../../../docs/design/workplan/03-p1-implementation.md) calls this the part of P1
    // most likely to be got subtly wrong, and the only thing that exercises the
    // path-under-a-stable-id machinery — which is the argument for keeping it
    // the *single* way a path ever changes.
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    const original = findById(
      library.db,
      listObjects(library.db, { owners: [library.owner] })[0]!.id,
    )!;

    const moved = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'rain-city-renamed');
    await mkdir(dirname(moved), { recursive: true });
    await rename(path, moved);

    // The two halves arrive separately and with nothing connecting them.
    removeFile(library.db, library.layout, path);
    const outcome = await ingestFile(library.db, library.layout, moved);

    expect(outcome).toMatchObject({ kind: 'indexed', moved: true });

    const after = findById(library.db, original.id);
    expect(after?.id).toBe(original.id);
    expect(after?.path).toBe(moved);
    expect(listObjects(library.db, { owners: [library.owner] })).toHaveLength(1);
  });

  it('does not flicker through an absence', async () => {
    // The row must be findable at every point. A delete-then-create would make
    // the object vanish from the list in between, which is what a user would
    // see as their library flickering.
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    const id = listObjects(library.db, { owners: [library.owner] })[0]!.id;

    removeFile(library.db, library.layout, path);
    // Tombstoned, so it is out of the live list — but the row is still there,
    // which is what lets the add recognise itself as the other half.
    expect(findById(library.db, id)).toBeNull();
    expect(library.db.prepare('select count(*) c from object where id = ?').get(id)).toMatchObject({
      c: 1,
    });

    const moved = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'elsewhere');
    await mkdir(dirname(moved), { recursive: true });
    await rename(path, moved);
    await ingestFile(library.db, library.layout, moved);

    expect(findById(library.db, id)?.path).toBe(moved);
  });

  it('becomes a real deletion once the tombstone matures', async () => {
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    await rm(dirname(path), { recursive: true });
    removeFile(library.db, library.layout, path);

    expect(matureTombstones(library.db, library.layout, Date.now())).toBe(0);
    expect(matureTombstones(library.db, library.layout, Date.now() + TOMBSTONE_TTL_MS + 1)).toBe(1);
    expect(snapshot(library.db)).toEqual([]);
  });

  it('matures on a schedule of its own, with no watcher running (F9)', async () => {
    // The sweep used to be called only from the watcher's event handler, so
    // `watch: false` — every route test, and any deployment that turns the
    // watcher off — left tombstones in the index forever. Nothing reads a
    // matured tombstone, so the symptom was never a wrong answer: just a file
    // that grows and never shrinks.
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    await rm(dirname(path), { recursive: true });
    removeFile(library.db, library.layout, path, Date.now() - TOMBSTONE_TTL_MS - 1);

    // The raw table, not `snapshot` — a tombstoned row is already absent from
    // every query that hides them, so asserting on those would pass whether or
    // not the sweep ever ran. The whole point of maturation is the row itself.
    expect(tombstoneCount()).toBe(1);

    // Startup first, because a tombstone written before a restart has no
    // watcher and no timer coming for it — it is already past its TTL.
    const maturation = startMaturation(library.db, library.layout);
    try {
      expect(tombstoneCount()).toBe(0);
    } finally {
      maturation.stop();
    }
  });

  it('keeps sweeping while the process runs, without any filesystem event', async () => {
    const maturation = startMaturation(library.db, library.layout, 10);
    try {
      // Created *after* the startup pass, so only the timer can collect it.
      const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
      await rm(dirname(path), { recursive: true });
      removeFile(library.db, library.layout, path, Date.now() - TOMBSTONE_TTL_MS - 1);

      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && tombstoneCount() > 0) {
        await new Promise((tick) => setTimeout(tick, 10));
      }
      expect(tombstoneCount()).toBe(0);
    } finally {
      maturation.stop();
    }
  });

  it('treats a rewrite at the same path as a rewrite, not a move', async () => {
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    removeFile(library.db, library.layout, path);

    const outcome = await ingestFile(library.db, library.layout, path);
    expect(outcome).toMatchObject({ kind: 'indexed', moved: false });
    expect(listObjects(library.db, { owners: [library.owner] })).toHaveLength(1);
  });
});

describe('a duplicate id is flagged rather than fatal', () => {
  const shared = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

  it('shows both, with the lexicographically later one shadowed', async () => {
    // The dangling-reference posture applied to a collision
    // ([00 §3.3](../../../../docs/design/00-stance.md)): survivable, visible, non-blocking.
    // Refusing to load either would punish a user for copying a folder, which
    // this design explicitly invites.
    await library.saveObject(actorWithId('Vera Solano', shared), 'vera-solano');
    await library.saveObject(actorWithId('Vera Solano', shared), 'vera-draft');

    const rows = listObjects(library.db, { owners: [library.owner] });
    expect(rows).toHaveLength(2);

    const bySlug = new Map(rows.map((row) => [row.slug, row.shadowed]));
    // `vera-draft` sorts before `vera-solano`, so it wins.
    expect(bySlug.get('vera-draft')).toBe(false);
    expect(bySlug.get('vera-solano')).toBe(true);
  });

  it('resolves to the winner by id', async () => {
    await library.saveObject(actorWithId('Vera Solano', shared), 'vera-solano');
    await library.saveObject(actorWithId('Vera Solano', shared), 'vera-draft');

    expect(findById(library.db, shared)?.slug).toBe('vera-draft');
  });

  it('promotes the survivor when the winner is deleted', async () => {
    await library.saveObject(actorWithId('Vera Solano', shared), 'vera-solano');
    const winner = await library.saveObject(actorWithId('Vera Solano', shared), 'vera-draft');

    await rm(dirname(winner), { recursive: true });
    removeFile(library.db, library.layout, winner);

    const rows = listObjects(library.db, { owners: [library.owner] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shadowed).toBe(false);
  });
});

describe('the library merge is a query', () => {
  it('reads a user library and the system one together', async () => {
    // [02 §5.1](../../../../docs/design/02-data-model.md): same structure means the same
    // loader, the same index code and the same UI — the merge is a query, not a
    // special case. Shipped empty at P1, which is why the query is what is
    // tested rather than the content.
    await library.saveObject(newActor('Vera Solano'), 'vera-solano');
    await library.saveObject(newActor('The Assistant'), 'the-assistant', SYSTEM_OWNER);

    const merged = listObjects(library.db, { owners: [library.owner, SYSTEM_OWNER] });
    expect(merged.map((row) => row.owner).sort()).toEqual(['system', 'user:ned']);

    const mineOnly = listObjects(library.db, { owners: [library.owner] });
    expect(mineOnly).toHaveLength(1);
  });

  it('filters by kind without enumerating kinds in the caller', async () => {
    await library.saveObject(newActor('Vera Solano'), 'vera-solano');
    await library.saveObject(newLorebook('Rain City'), 'rain-city');

    const actors = listObjects(library.db, {
      owners: [library.owner],
      schemaId: ACTOR_SCHEMA,
    });
    expect(actors.map((row) => row.name)).toEqual(['Vera Solano']);
  });
});

describe('what the index refuses to hold', () => {
  it('ignores a file that is not a library object', async () => {
    const stray = library.layout.assetsRoot(library.owner, ACTOR_SCHEMA, 'vera-solano');
    await mkdir(stray, { recursive: true });
    const asset = `${stray}/portrait.png`;
    await writeFile(asset, 'not an object');

    expect(await ingestFile(library.db, library.layout, asset)).toMatchObject({
      kind: 'skipped',
      reason: 'not-an-object',
    });
  });

  it('ignores a file whose schema does not match its folder', async () => {
    // A lorebook saved into `actors/` is not an actor. Left on disk and out of
    // the index rather than guessed at.
    const path = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'impostor');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(newActor('Vera Solano')));

    expect(await ingestFile(library.db, library.layout, path)).toMatchObject({
      kind: 'skipped',
      reason: 'invalid',
    });
  });

  it('ignores an object that fails validation', async () => {
    const path = library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, 'broken');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ ...newLorebook('Rain City'), entries: 'not an array' }));

    expect(await ingestFile(library.db, library.layout, path)).toMatchObject({
      kind: 'skipped',
      reason: 'invalid',
    });
  });

  it('ignores a card with no envelope of ours', async () => {
    // A V2 card waiting for import is not an error and is not indexable either.
    const { makePng } = await import('../storage/card/test-png.js');
    const path = library.layout.objectFile(library.owner, ACTOR_SCHEMA, 'legacy');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, makePng());

    expect(await ingestFile(library.db, library.layout, path)).toMatchObject({
      kind: 'skipped',
      reason: 'invalid',
    });
  });
});

describe('search', () => {
  it('finds an object by a word in its body', async () => {
    await library.saveObject(
      { ...newLorebook('Rain City'), description: 'A drowned harbour town.' },
      'rain-city',
    );
    await library.saveObject(newActor('Vera Solano'), 'vera-solano');

    expect(search(library.db, 'harbour').map((row) => row.name)).toEqual(['Rain City']);
  });

  it('does not return a deleted object', async () => {
    const path = await library.saveObject(
      { ...newLorebook('Rain City'), description: 'A drowned harbour town.' },
      'rain-city',
    );
    removeFile(library.db, library.layout, path);

    expect(search(library.db, 'harbour')).toEqual([]);
  });
});
