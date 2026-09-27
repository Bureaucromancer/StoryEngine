// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LOREBOOK_SCHEMA,
  type Lorebook,
  newLorebook,
  newLoreEntry,
  newTreatment,
  TREATMENT_SCHEMA,
  type Treatment,
  uuidv7,
} from '@storyengine/shared';

import {
  appendTurnToSession,
  createSession,
  deleteSession,
  type SessionContext,
  setCast,
} from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import { listVersions } from '../storage/history.js';
import { Layout, userOwner } from '../storage/layout.js';
import { ingestFile, listFileErrors, ownerKey } from './ingest.js';
import { usedBy } from './links.js';
import { openIndex, type OpenedIndex } from './open.js';
import { listObjects, snapshot } from './query.js';
import { rebuild } from './rebuild.js';
import { reconcileIndex } from './reconcile.js';
import { listSessionRows, searchTurns, sessionSnapshot } from './sessions.js';
import { makeTestLibrary, type TestLibrary } from './test-library.js';

/**
 * ***The start-up consistency check*** (2026-09-27) —
 * [03 §5.1](../../../../docs/design/03-data-model.md)'s *"mtime/size against
 * recorded values, with automatic re-index of anything that does not match"*,
 * which a start that did not rebuild never ran.
 *
 * Every case here is a change made while nothing was watching, which is to say
 * with the server stopped: the index is left as the last process had it, the
 * disk moves on, and the check is what the next start runs. The last `describe`
 * holds it to a rebuild over randomised changes, which is the claim that makes
 * the fixed cases worth having.
 */

let library: TestLibrary;
let owners: string[];
let context: SessionContext;

beforeEach(async () => {
  library = await makeTestLibrary();
  owners = [ownerKey(library.owner)];
  context = { layout: library.layout, index: library.db };
});

afterEach(async () => {
  await library.dispose();
});

function check() {
  return reconcileIndex(library.db, library.layout, { keepHistoryPerObject: 10 });
}

function names(): string[] {
  return listObjects(library.db, { owners: [library.owner] })
    .map((row) => row.name)
    .sort();
}

function errors(): [string, string][] {
  return listFileErrors(library.db, owners).map((error) => [error.slug, error.reason]);
}

/** `{ slug: shadowed }` for the live rows. */
function shadowed(): Record<string, number> {
  const rows = library.db
    .prepare('select slug, shadowed from object where tombstoned_at is null order by slug')
    .all() as { slug: string; shadowed: number }[];
  return Object.fromEntries(rows.map((row) => [row.slug, row.shadowed]));
}

function bookAt(slug: string): string {
  return library.layout.objectFile(library.owner, LOREBOOK_SCHEMA, slug);
}

function spokenTurn(sessionId: string, parentTurnId: string | null, said: string): Turn {
  return {
    id: uuidv7(),
    sessionId,
    parentTurnId,
    createdAt: new Date(Date.UTC(2026, 8, 27, 12)).toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'say', text: 'And then?', raw: '' },
    output: { text: said },
    effects: [],
    tape: [],
  };
}

async function aSessionWith(
  name: string,
  lines: string[],
  through: SessionContext = context,
): Promise<{ sessionId: string; lastTurnId: string | null }> {
  const session = await createSession(through, 'ned', name);
  let parent: string | null = null;
  for (const line of lines) {
    const turn = spokenTurn(session.id, parent, line);
    await appendTurnToSession(through, 'ned', session.id, turn);
    parent = turn.id;
  }
  return { sessionId: session.id, lastTurnId: parent };
}

function found(term: string): string[] {
  return searchTurns(library.db, owners, term).map((hit) => hit.turnId);
}

/** The index a rebuild of the same disk holds, in a database of its own. */
async function rebuilt(): Promise<string[]> {
  const fresh = await openIndex({ path: ':memory:' });
  try {
    await rebuild(fresh.db, library.layout);
    return [...snapshot(fresh.db), ...sessionSnapshot(fresh.db)];
  } finally {
    fresh.close();
  }
}

describe('a library changed while nothing was watching', () => {
  it('reads a file edited since, and keeps the version it replaced', async () => {
    const book = newLorebook('Rain City');
    const path = await library.saveObject(book, 'rain-city');

    await writeFile(path, JSON.stringify({ ...book, name: 'Rain City, revised' }));
    const result = await check();

    expect(names()).toEqual(['Rain City, revised']);
    expect(result).toMatchObject({ scanned: 1, reread: 1 });
    // What the watcher records for the same edit made with the server running.
    const versions = await listVersions(
      library.layout.objectRoot(library.owner, LOREBOOK_SCHEMA, 'rain-city'),
    );
    expect(versions.map((version) => version.source)).toEqual([{ kind: 'external' }]);
  });

  it('indexes a file added since, and forgets one deleted, with what it pointed at', async () => {
    await library.saveObject(newLorebook('Rain City'), 'rain-city');
    const treatment: Treatment = {
      ...newTreatment('Harbour'),
      lore: [{ ref: { id: 'book-harbour', name: 'Harbour' }, required: false }],
    };
    const treatmentPath = library.layout.objectFile(library.owner, TREATMENT_SCHEMA, 'harbour');
    await mkdir(dirname(treatmentPath), { recursive: true });
    await writeFile(treatmentPath, JSON.stringify(treatment));
    await ingestFile(library.db, library.layout, treatmentPath);
    expect(usedBy(library.db, 'book-harbour', owners)).toHaveLength(1);

    await rm(dirname(treatmentPath), { recursive: true });
    await library.writeObject(newLorebook('Elsewhere'), 'elsewhere');
    const result = await check();

    expect(names()).toEqual(['Elsewhere', 'Rain City']);
    // The delete confirmation's count is about now.
    expect(usedBy(library.db, 'book-harbour', owners)).toEqual([]);
    expect(result).toMatchObject({ reread: 1, forgotten: 1 });
    expect([...snapshot(library.db), ...sessionSnapshot(library.db)]).toEqual(await rebuilt());
  });

  it('takes a folder renamed since as a move, and records no version for it', async () => {
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');
    await rename(dirname(path), dirname(bookAt('rain')));

    await check();

    const rows = listObjects(library.db, { owners: [library.owner] });
    expect(rows.map((row) => [row.slug, row.shadowed])).toEqual([['rain', false]]);
    expect(
      await listVersions(library.layout.objectRoot(library.owner, LOREBOOK_SCHEMA, 'rain')),
    ).toEqual([]);
    expect([...snapshot(library.db), ...sessionSnapshot(library.db)]).toEqual(await rebuilt());
  });

  it('lets a copy stop being shadowed once the file it copied is gone', async () => {
    // A folder copied by hand holds the original's id, and loses to it by path
    // (P1 §1.2). Delete the original with the server stopped, and the copy is
    // the id's only file. The randomised case below rarely makes this: it needs
    // the copy before the last look and the delete after it.
    const book = newLorebook('Rain City');
    await library.saveObject(book, 'alpha');
    await library.saveObject(book, 'beta');
    expect(shadowed()).toEqual({ alpha: 0, beta: 1 });

    await rm(dirname(bookAt('alpha')), { recursive: true });
    await check();

    expect(shadowed()).toEqual({ beta: 0 });
  });

  it('reads nothing a second time when nothing changed', async () => {
    await library.saveObject(newLorebook('Rain City'), 'rain-city');
    await library.saveObject(newLorebook('Elsewhere'), 'elsewhere');
    await aSessionWith('Harbour', ['The cranes were still.']);

    // A session played since the last look has no stamp for its files yet —
    // the running server does not keep one — so the first start derives it.
    expect(await check()).toMatchObject({ scanned: 2, reread: 0, sessions: 1 });
    // And the next start has nothing to do at all.
    expect(await check()).toMatchObject({
      scanned: 2,
      reread: 0,
      forgotten: 0,
      sessions: 0,
      sessionsForgotten: 0,
    });
  });
});

describe('what the index says about files it could not read', () => {
  it('says a file broken since, and keeps its last good version, the watcher’s way', async () => {
    const path = await library.saveObject(newLorebook('Rain City'), 'rain-city');

    await writeFile(path, '{ "id": ');
    const result = await check();

    expect(errors()).toEqual([['rain-city', 'unparsable']]);
    // F20: the last good version is still the most useful thing to show.
    expect(names()).toEqual(['Rain City']);
    expect(result.broken).toEqual([library.layout.portablePath(path)]);
    // And the next start does not say it again.
    expect((await check()).broken).toEqual([]);
  });

  it('forgets the complaint about a file fixed since', async () => {
    const path = bookAt('rain-city');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{ "id": ');
    await ingestFile(library.db, library.layout, path);
    expect(errors()).toEqual([['rain-city', 'unparsable']]);

    await writeFile(path, JSON.stringify(newLorebook('Rain City')));
    await check();

    expect(errors()).toEqual([]);
    expect(names()).toEqual(['Rain City']);
  });

  it('reads again a file with an error on record, whatever its size and time say', async () => {
    // The last good version is restored with `cp -p`: the bytes the row was
    // read from, with the time they had. By size and time nothing changed, and
    // the error row has neither to compare. (A `chmod` that makes a file
    // readable again is the other way to fix one without changing either.) A
    // whole second, so the time the row recorded is one a file can be given
    // back exactly.
    const path = await library.writeObject(newLorebook('Rain City'), 'rain-city');
    const good = await readFile(path);
    await utimes(path, 1_800_000_000, 1_800_000_000);
    await ingestFile(library.db, library.layout, path);
    await writeFile(path, '{ "id": ');
    await ingestFile(library.db, library.layout, path);
    expect(errors()).toEqual([['rain-city', 'unparsable']]);

    await writeFile(path, good);
    await utimes(path, 1_800_000_000, 1_800_000_000);
    await check();

    expect(errors()).toEqual([]);
  });

  // A folder these names cannot be made on Windows, and the rule is lexical.
  it.skipIf(process.platform === 'win32')(
    'forgets a refused folder name once the folder has been renamed',
    async () => {
      const refused = join(library.layout.kindRoot(library.owner, LOREBOOK_SCHEMA), 'con');
      await mkdir(refused, { recursive: true });
      await writeFile(join(refused, 'lorebook.json'), JSON.stringify(newLorebook('Con City')));
      await rebuild(library.db, library.layout);
      expect(errors()).toEqual([['con', 'unusable-name']]);

      await rename(refused, dirname(bookAt('con-city')));
      await check();

      expect(errors()).toEqual([]);
      expect(names()).toEqual(['Con City']);
    },
  );
});

describe('sessions changed while nothing was watching', () => {
  it('finds a turn that reached its segment and not the index', async () => {
    // A crash between the append and its index update, which is the case
    // 03 §5.1.1 names for this check.
    const { sessionId, lastTurnId } = await aSessionWith('Harbour', ['The cranes were still.']);
    await check();
    const lost = spokenTurn(sessionId, lastTurnId, 'A gull landed on the crane.');
    const segment = join(library.layout.sessionRoot('ned', sessionId), 'turns', '000001.jsonl');
    await appendFile(segment, `${JSON.stringify(lost)}\n`);
    expect(found('gull')).toEqual([]);

    const result = await check();

    expect(found('gull')).toEqual([lost.id]);
    expect(result.sessions).toBe(1);
  });

  it('forgets a session deleted since, and finds one copied in', async () => {
    const gone = await aSessionWith('Gone', ['The rain had not stopped.']);
    await setCast(context, 'ned', gone.sessionId, { persona: null, actors: ['actor-vera'] });
    await aSessionWith('Harbour', ['The cranes were still.']);
    await check();
    expect(usedBy(library.db, 'actor-vera', owners)).toHaveLength(1);

    await rm(library.layout.sessionRoot('ned', gone.sessionId), { recursive: true });
    // Written by somebody else's index: the files are here and this one was
    // never told, which is a session folder copied in from another install.
    const elsewhere = await openIndex({ path: ':memory:' });
    try {
      await aSessionWith('Copied in', ['A lantern swung in the fog.'], {
        layout: library.layout,
        index: elsewhere.db,
      });
    } finally {
      elsewhere.close();
    }

    const result = await check();

    expect(
      listSessionRows(library.db, owners)
        .map((row) => row.name)
        .sort(),
    ).toEqual(['Copied in', 'Harbour']);
    expect(usedBy(library.db, 'actor-vera', owners)).toEqual([]);
    expect(found('lantern')).toHaveLength(1);
    expect(found('rain')).toEqual([]);
    expect(result).toMatchObject({ sessions: 1, sessionsForgotten: 1 });
  });

  it('finds a session put back from the trash by hand', async () => {
    // Moved out and moved back, so every file has the size and time it had
    // when the last look stamped it.
    const { sessionId } = await aSessionWith('Harbour', ['The cranes were still.']);
    await check();
    expect(await deleteSession(context, 'ned', sessionId)).toEqual({ kind: 'deleted' });
    const trash = join(library.layout.trashRoot('ned'), 'sessions');
    const [trashed] = await readdir(trash);
    if (trashed === undefined) throw new Error('the delete left nothing in the trash');

    await rename(join(trash, trashed), library.layout.sessionRoot('ned', sessionId));
    await check();

    expect(listSessionRows(library.db, owners).map((row) => row.sessionId)).toEqual([sessionId]);
    expect(found('cranes')).toHaveLength(1);
  });

  it('files a session moved to another account under that account', async () => {
    const { sessionId } = await aSessionWith('Harbour', ['The cranes were still.']);
    await check();

    // Every file keeps its size and time through a move.
    await mkdir(library.layout.sessionsRoot('ada'), { recursive: true });
    await rename(
      library.layout.sessionRoot('ned', sessionId),
      library.layout.sessionRoot('ada', sessionId),
    );
    await check();

    expect(listSessionRows(library.db, owners)).toEqual([]);
    expect(
      listSessionRows(library.db, [ownerKey(userOwner('ada'))]).map((row) => row.sessionId),
    ).toEqual([sessionId]);
  });
});

/**
 * ***The check equals a rebuild***, as a property — the claim the cases above
 * are instances of.
 *
 * Three phases, because the index a check starts from has two histories. It was
 * last rebuilt, or it was kept up by a running server's own writes since; a
 * session played since then has rows the server wrote and no stamp. Then the
 * server stops and the disk moves on, and the check runs. Its answer has to be
 * the one a rebuild of that disk gives, in a database of its own.
 *
 * *Every write is given a later time than the last*, because a file rewritten
 * to the same size within one tick of the filesystem's clock is the one change
 * the check cannot see (`reconcile.ts` says so), and this harness writes far
 * faster than a person does. Renames keep their time, as they do.
 */
describe('the check equals a rebuild', () => {
  type Change =
    | { kind: 'write'; slug: Slug; name: string }
    | { kind: 'edit'; slug: Slug; name: string }
    | { kind: 'rename'; from: Slug; to: Slug }
    | { kind: 'copy'; from: Slug; to: Slug }
    | { kind: 'delete'; slug: Slug }
    | { kind: 'begin'; story: Story; name: string }
    | { kind: 'play'; story: Story; said: string }
    | { kind: 'drop'; story: Story };

  const SLUGS = ['alpha', 'beta', 'gamma'] as const;
  type Slug = (typeof SLUGS)[number];
  const STORIES = [0, 1] as const;
  type Story = (typeof STORIES)[number];
  const slug = fc.constantFrom(...SLUGS);
  const story = fc.constantFrom(...STORIES);

  const change: fc.Arbitrary<Change> = fc.oneof(
    fc.record({
      kind: fc.constant('write' as const),
      slug,
      name: fc.constantFrom('Rain City', 'Neon Harbour'),
    }),
    fc.record({ kind: fc.constant('edit' as const), slug, name: fc.constantFrom('Revised', 'X') }),
    fc.record({ kind: fc.constant('rename' as const), from: slug, to: slug }),
    fc.record({ kind: fc.constant('copy' as const), from: slug, to: slug }),
    fc.record({ kind: fc.constant('delete' as const), slug }),
    fc.record({ kind: fc.constant('begin' as const), story, name: fc.constantFrom('Fog', 'Tide') }),
    fc.record({
      kind: fc.constant('play' as const),
      story,
      said: fc.constantFrom('A gull landed.', 'The tide turned.'),
    }),
    fc.record({ kind: fc.constant('drop' as const), story }),
  );

  /** One randomised run's disk, its index, and what it has put where. */
  interface World {
    root: string;
    layout: Layout;
    index: OpenedIndex;
    books: Map<Slug, string>;
    stories: Map<Story, { id: string; head: string | null }>;
    clock: number;
  }

  function bookWith(name: string, id: string): Lorebook {
    return {
      ...newLorebook(name),
      id,
      entries: [{ ...newLoreEntry(`${name} harbour`), id: `${id}:0`, content: `${name} cranes` }],
    };
  }

  /** A write, given a time later than every write before it. */
  async function put(world: World, path: string, book: Lorebook): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(book, null, 2));
    world.clock += 10;
    await utimes(path, world.clock, world.clock);
  }

  /**
   * Makes one change. `live` is a running server: its writes reach the index
   * as they land, the way a route's do. Otherwise the index is not told, which
   * is the server stopped.
   */
  async function apply(world: World, step: Change, live: boolean): Promise<void> {
    const owner = userOwner('ned');
    const at = (name: Slug) => world.layout.objectFile(owner, LOREBOOK_SCHEMA, name);
    const told = async (path: string) => {
      if (live) await ingestFile(world.index.db, world.layout, path);
    };
    // A stopped server's session writes go to an index nobody reads again.
    const scratch = live ? null : await openIndex({ path: ':memory:' });
    const sessions: SessionContext = {
      layout: world.layout,
      index: scratch?.db ?? world.index.db,
    };

    try {
      switch (step.kind) {
        case 'write': {
          const id = uuidv7();
          await put(world, at(step.slug), bookWith(step.name, id));
          world.books.set(step.slug, id);
          await told(at(step.slug));
          return;
        }
        case 'edit': {
          const id = world.books.get(step.slug);
          if (id === undefined) return;
          await put(world, at(step.slug), bookWith(step.name, id));
          await told(at(step.slug));
          return;
        }
        // Moving, copying and deleting folders by hand is what a running
        // server hears through its watcher; this harness has none, so those
        // happen only while it is stopped.
        case 'rename': {
          const id = world.books.get(step.from);
          if (live || id === undefined || world.books.has(step.to)) return;
          await rename(dirname(at(step.from)), dirname(at(step.to)));
          world.books.delete(step.from);
          world.books.set(step.to, id);
          return;
        }
        case 'copy': {
          const id = world.books.get(step.from);
          if (live || id === undefined || world.books.has(step.to)) return;
          await put(world, at(step.to), bookWith('Copied', id));
          world.books.set(step.to, id);
          return;
        }
        case 'delete': {
          if (live || !world.books.has(step.slug)) return;
          await rm(dirname(at(step.slug)), { recursive: true, force: true });
          world.books.delete(step.slug);
          return;
        }
        case 'begin': {
          if (world.stories.has(step.story)) return;
          const session = await createSession(sessions, 'ned', step.name);
          world.stories.set(step.story, { id: session.id, head: null });
          return;
        }
        case 'play': {
          const current = world.stories.get(step.story);
          if (current === undefined) return;
          const turn = spokenTurn(current.id, current.head, step.said);
          await appendTurnToSession(sessions, 'ned', current.id, turn);
          current.head = turn.id;
          return;
        }
        case 'drop': {
          const current = world.stories.get(step.story);
          if (live || current === undefined) return;
          await rm(world.layout.sessionRoot('ned', current.id), { recursive: true, force: true });
          world.stories.delete(step.story);
          return;
        }
      }
    } finally {
      scratch?.close();
    }
  }

  it('over randomised changes made before the last look, while running, and while stopped', async () => {
    const phase = fc.array(change, { maxLength: 6 });
    await fc.assert(
      fc.asyncProperty(phase, phase, phase, async (before, running, stopped) => {
        const root = await mkdtemp(join(tmpdir(), 'se-reconcile-'));
        const world: World = {
          root,
          layout: new Layout(root),
          index: await openIndex({ path: ':memory:' }),
          books: new Map(),
          stories: new Map(),
          clock: 1_800_000_000,
        };
        try {
          for (const step of before) await apply(world, step, false);
          await rebuild(world.index.db, world.layout);
          for (const step of running) await apply(world, step, true);
          for (const step of stopped) await apply(world, step, false);

          await reconcileIndex(world.index.db, world.layout, { keepHistoryPerObject: 10 });
          const checked = [...snapshot(world.index.db), ...sessionSnapshot(world.index.db)];

          const fresh = await openIndex({ path: ':memory:' });
          try {
            await rebuild(fresh.db, world.layout);
            expect(checked).toEqual([...snapshot(fresh.db), ...sessionSnapshot(fresh.db)]);
          } finally {
            fresh.close();
          }
        } finally {
          world.index.close();
          await rm(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});
