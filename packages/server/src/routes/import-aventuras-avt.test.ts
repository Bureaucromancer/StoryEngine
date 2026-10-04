// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ACTOR_SCHEMA, LOREBOOK_SCHEMA } from '@storyengine/shared';

import { read } from '../library.js';
import { pixelBytes } from '../storage/card/test-png.js';
import { avtDocument, avtFromDatabase } from '../import/fixtures/test-aventuras-avt.js';
import {
  buildAventurasDatabase,
  LANTERN_FORK,
  STORY_TREES,
  writeAventurasBackupFolder,
} from '../import/fixtures/test-aventuras-db.js';
import { readSession, readTurns } from '../sessions/store.js';
import {
  makeTestServer,
  ownObjects,
  setUpAdmin,
  tempRoot,
  type TestServer,
} from '../test-server.js';

/**
 * ***An Aventuras story file, through the doors*** —
 * [P13.15](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The stage's end condition, as a person meets it: **the Lantern Fork from its
 * `.avt` is the same session as from the database** — its turns, its cast
 * and their cards, its lorebook and its pictures, with only the ids a store
 * mints told apart — and **either after the other is `already-here`**, since
 * the file's story id is the database's and so is the key; and **a file of a
 * format this build does not know is refused with a note and writes
 * nothing**. Beside those: a hand-picked file needs no `stories` field, the
 * preview says what it is and whether it is here, and a folder of `.avt` files
 * is swept under the opt-in, while the ones beside a database are not read.
 * The reader's own claims are `import/aventuras/avt.test.ts`'s.
 */

let server: TestServer;
let container: string;
let spares: TestServer[] = [];

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
  container = await tempRoot('se-aventuras-avt-');
});

afterEach(async () => {
  await server.dispose();
  for (const spare of spares) await spare.dispose();
  spares = [];
  await rm(container, { recursive: true, force: true });
});

interface Row {
  source: string;
  disposition: string;
  objectId?: string;
  alsoProduced?: string[];
  notes: { key: string; params: Record<string, unknown>; level?: string }[];
}

const BOUNDARY = '----storyengineAventurasAvt';
const LANTERN_KEY = `aventura.db/stories/${LANTERN_FORK.id}`;

/** The Lantern Fork's `.avt`, written from the fixture database as Aventuras writes one. */
function lanternAvt(version?: string): Uint8Array {
  const db = new DatabaseSync(':memory:');
  try {
    buildAventurasDatabase(db, { storyTrees: STORY_TREES });
    return avtFromDatabase(db, LANTERN_FORK.id, version === undefined ? {} : { version });
  } finally {
    db.close();
  }
}

function upload(
  on: TestServer,
  url: string,
  filename: string,
  bytes: Uint8Array,
  fields: Record<string, string> = {},
) {
  const before = Object.entries(fields).map(([name, value]) =>
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ),
  );
  return on.request({
    method: 'POST',
    url,
    payload: Buffer.concat([
      ...before,
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  });
}

async function grantFileAccess(on: TestServer): Promise<void> {
  const response = await on.request({
    method: 'PATCH',
    url: '/api/admin/accounts/ned',
    payload: { capabilities: { fileAccess: 'read' } },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

async function sweepFolder(
  on: TestServer,
  root: string,
  extra: Record<string, unknown> = {},
): Promise<Row[]> {
  const response = await on.request({
    method: 'POST',
    url: '/api/import/sweep',
    payload: { root, ...extra },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body?.report?.items ?? []) as Row[];
}

async function databaseFolder(): Promise<string> {
  const root = join(container, 'aventura-backup');
  await writeAventurasBackupFolder(root, { storyTrees: STORY_TREES });
  return root;
}

async function sessionIds(on: TestServer = server): Promise<string[]> {
  const response = await on.request({ method: 'GET', url: '/api/sessions' });
  expect(response.status).toBe(200);
  return (response.body.sessions as { id: string }[]).map((session) => session.id).sort();
}

/** The Lantern Fork brought across from the database, by a server-path sweep. */
async function fromDatabase(on: TestServer): Promise<string> {
  await grantFileAccess(on);
  const rows = await sweepFolder(on, await databaseFolder(), { stories: true });
  const row = rows.find((one) => one.source === LANTERN_KEY);
  expect(row?.disposition, JSON.stringify(row)).toBe('converted');
  return row!.objectId!;
}

/** The Lantern Fork brought across from its file, hand-picked. */
async function fromFile(on: TestServer, version?: string): Promise<Row> {
  const response = await upload(
    on,
    '/api/import/file',
    'The_Lantern_Fork.avt',
    lanternAvt(version),
  );
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return response.body.item as Row;
}

/**
 * ***A session as a person meets it, less what a store mints*** — the session
 * id wherever it appears, and an actor's or a book's id and times. Turn ids
 * and picture ids are not minted: they derive from the account, the story's
 * key and Aventuras' own ids, which is what makes two imports one story.
 */
async function session(on: TestServer, sessionId: string): Promise<unknown> {
  const here = await readSession(on.services.sessions, 'ned', sessionId);
  if (here === null) throw new Error('no session');
  const turns = [...(await readTurns(on.services.sessions, 'ned', sessionId)).values()]
    .map((turn) => ({ ...turn, sessionId: '' }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const actor = async (id: string) => {
    const stored = read(on.services.library, 'ned', id, ACTOR_SCHEMA);
    const body = stored.body as Record<string, unknown>;
    const provenance = body['provenance'] as Record<string, unknown>;
    return {
      ...body,
      id: '',
      provenance: { ...provenance, createdAt: '', updatedAt: '' },
      pixels: pixelBytes(new Uint8Array(await readFile(stored.path))),
    };
  };
  const cast = {
    persona: here.cast?.persona == null ? null : await actor(here.cast.persona),
    actors: await Promise.all((here.cast?.actors ?? []).map(actor)),
  };
  const lore = (here.lore ?? []).map((id) => {
    const body = read(on.services.library, 'ned', id, LOREBOOK_SCHEMA).body as Record<
      string,
      unknown
    >;
    const provenance = body['provenance'] as Record<string, unknown>;
    return { ...body, id: '', provenance: { ...provenance, createdAt: '', updatedAt: '' } };
  });

  const listed = await on.request({ method: 'GET', url: `/api/sessions/${sessionId}/renditions` });
  expect(listed.status).toBe(200);
  const pictures = (listed.body.renditions as Record<string, unknown>[]).map((one) =>
    JSON.parse(JSON.stringify(one).replaceAll(sessionId, 'SESSION')),
  );

  return {
    name: here.name,
    origin: here.origin,
    headTurnId: here.headTurnId,
    branchRefs: here.branchRefs,
    turns,
    cast,
    lore,
    pictures,
  };
}

describe('the end condition', () => {
  it('makes the same session from the file as from the database, backdrops apart', async () => {
    const other = await makeTestServer();
    spares.push(other);
    await setUpAdmin(other);

    const viaDatabase = await session(server, await fromDatabase(server));
    const row = await fromFile(other);
    expect(row.disposition, JSON.stringify(row)).toBe('converted');
    const viaFile = await session(other, row.objectId!);

    // The database's two backdrops are the one thing its file never had —
    // `gatherStoryData()` does not read `background_images` — and the row
    // says a file's story comes without them.
    const { pictures: dbPictures, ...dbRest } = viaDatabase as { pictures: { purpose: string }[] };
    const { pictures: filePictures, ...fileRest } = viaFile as {
      pictures: { purpose: string }[];
    };
    expect(fileRest).toEqual(dbRest);
    expect(filePictures).toEqual(dbPictures.filter((one) => one.purpose !== 'background'));
    expect(dbPictures.filter((one) => one.purpose === 'background')).toHaveLength(2);
    expect(filePictures).toHaveLength(6);

    // The row is the file's, and the key is the story's.
    expect(row.source).toBe('The_Lantern_Fork.avt');
    const said = new Map(row.notes.map((note) => [note.key, note.params]));
    expect(said.get('import.aventuras.storyImported')).toEqual({
      story: 'The Lantern Fork',
      turns: 10,
      branches: 3,
      mode: 'adventure',
    });
    expect(said.get('import.aventuras.storyWorldRecorded')).toEqual({
      story: 'The Lantern Fork',
      chapters: 2,
      checkpoints: 0,
    });
    expect(said.get('import.aventuras.storyPictures')).toEqual({
      story: 'The Lantern Fork',
      illustrations: 6,
      backgrounds: 0,
    });
  });

  it('finds the story already here from its file, after the database brought it', async () => {
    const made = await fromDatabase(server);
    const before = await sessionIds();
    const actors = await ownObjects(server, 'actors');
    const lorebooks = await ownObjects(server, 'lorebooks');

    const row = await fromFile(server);
    expect(row.disposition).toBe('unchanged');
    expect(row.objectId).toBe(made);
    expect(row.notes.map((note) => note.key)).toContain('import.aventuras.storyAlreadyHere');
    // No copy, and nothing of its world written again.
    expect(await sessionIds()).toEqual(before);
    expect(await ownObjects(server, 'actors')).toEqual(actors);
    expect(await ownObjects(server, 'lorebooks')).toEqual(lorebooks);
  });

  it('finds the story already here from the database, after its file brought it', async () => {
    const row = await fromFile(server);
    expect(row.disposition).toBe('converted');
    const before = await sessionIds();
    const actors = await ownObjects(server, 'actors');

    await grantFileAccess(server);
    const rows = await sweepFolder(server, await databaseFolder(), { stories: true });
    const lantern = rows.find((one) => one.source === LANTERN_KEY)!;
    expect(lantern.disposition).toBe('unchanged');
    expect(lantern.objectId).toBe(row.objectId);
    // The other stories are new; the Lantern Fork is not doubled.
    const after = await sessionIds();
    expect(after.filter((id) => before.includes(id))).toEqual(before);
    expect(after.length).toBe(before.length + 3);
    const names = (await ownObjects(server, 'actors')).objects.map((one) => one['name']);
    expect(names.filter((name) => name === 'Mara')).toHaveLength(1);
    expect(actors.objects.length).toBeGreaterThan(0);
  });

  it.each([['2.0.0'], ['0.3.0'], ['latest']])(
    'refuses a file of format %s with a note, and writes nothing',
    async (version) => {
      const db = new DatabaseSync(':memory:');
      buildAventurasDatabase(db, { storyTrees: STORY_TREES });
      const document = { ...avtDocument(db, LANTERN_FORK.id), version };
      db.close();

      const response = await upload(
        server,
        '/api/import/file',
        'lantern.avt',
        new TextEncoder().encode(JSON.stringify(document)),
      );
      expect(response.status).toBe(200);
      const item = response.body.item as Row;
      expect(item.disposition).toBe('unrecognised');
      expect(item.notes).toEqual([
        {
          key: 'import.aventuras.avtUnknownFormat',
          params: { file: 'lantern.avt', version, known: '1.10.0' },
          level: 'warn',
        },
      ]);
      expect(await sessionIds()).toEqual([]);
      expect((await ownObjects(server, 'actors')).objects).toEqual([]);
      expect((await ownObjects(server, 'lorebooks')).objects).toEqual([]);
    },
  );
});

describe('a hand-picked file', () => {
  it('brings its story without being asked for stories, since picking it was the asking', async () => {
    const row = await fromFile(server);
    expect(row.disposition).toBe('converted');
    expect(await sessionIds()).toEqual([row.objectId]);
    const here = await readSession(server.services.sessions, 'ned', row.objectId!);
    expect(here?.origin).toMatchObject({ source: 'import', originalFilename: LANTERN_KEY });
  });

  it('reads an older format as far as it goes: the main line, before anybody forked it', async () => {
    const row = await fromFile(server, '1.5.0');
    expect(row.disposition, JSON.stringify(row)).toBe('converted');
    expect(row.notes.map((note) => note.key)).toContain('import.aventuras.avtOlderFormat');
    const turns = await readTurns(server.services.sessions, 'ned', row.objectId!);
    expect(turns.size).toBe(6);
  });

  it('is previewed as the story it is, and as already here once it is', async () => {
    const bytes = lanternAvt();
    const look = async () => {
      const response = await upload(server, '/api/import/file/preview', 'lantern.avt', bytes);
      expect(response.status).toBe(200);
      return response.body.preview as {
        disposition: string;
        reimport: string;
        object: unknown;
        notes: { key: string; params: Record<string, unknown> }[];
      };
    };

    const first = await look();
    expect(first.disposition).toBe('converted');
    expect(first.reimport).toBe('new');
    expect(first.object).toEqual({ kind: 'opaque', name: 'The Lantern Fork' });
    expect(first.notes[0]).toEqual({
      key: 'import.aventuras.avtStory',
      params: { story: 'The Lantern Fork', version: '1.10.0', entries: 15, branches: 3 },
      level: 'info',
    });
    // A look writes nothing.
    expect(await sessionIds()).toEqual([]);

    await fromFile(server);
    const second = await look();
    expect(second.disposition).toBe('unchanged');
    expect(second.reimport).toBe('unchanged');
    expect(second.notes.map((note) => note.key)).toContain('import.aventuras.storyAlreadyHere');
  });
});

describe('a folder', () => {
  it('sweeps a folder of `.avt` files under the opt-in: recorded unasked, sessions asked', async () => {
    await grantFileAccess(server);
    const root = join(container, 'old-backup', 'stories');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'the-lantern-fork.avt'), lanternAvt());

    const unasked = await sweepFolder(server, root);
    const recorded = unasked.find((one) => one.source === 'the-lantern-fork.avt')!;
    expect(recorded.disposition).toBe('recorded');
    expect(recorded.notes[0]).toMatchObject({
      key: 'import.aventuras.storyRecorded',
      params: { story: 'The Lantern Fork', entries: 15, branches: 3, chapters: 2 },
    });
    expect(await sessionIds()).toEqual([]);

    const asked = await sweepFolder(server, root, { stories: true });
    const converted = asked.find((one) => one.source === 'the-lantern-fork.avt')!;
    expect(converted.disposition).toBe('converted');
    expect(await sessionIds()).toEqual([converted.objectId]);

    const again = await sweepFolder(server, root, { stories: true });
    expect(again.find((one) => one.source === 'the-lantern-fork.avt')?.disposition).toBe(
      'unchanged',
    );
    expect(await sessionIds()).toEqual([converted.objectId]);
  });

  it('does not read the `.avt` files beside a database, which holds their stories', async () => {
    await grantFileAccess(server);
    const root = await databaseFolder();
    await mkdir(join(root, 'stories'), { recursive: true });
    await writeFile(join(root, 'stories', 'the-lantern-fork.avt'), lanternAvt());

    const rows = await sweepFolder(server, root, { stories: true });
    const file = rows.find((one) => one.source === 'stories/the-lantern-fork.avt')!;
    expect(file.disposition).toBe('skipped');
    expect(file.notes).toEqual([
      {
        key: 'import.aventuras.avtBesideDatabase',
        params: { file: 'stories/the-lantern-fork.avt' },
        level: 'info',
      },
    ]);
    // One Lantern Fork, from the database.
    const lantern = rows.find((one) => one.source === LANTERN_KEY)!;
    expect(lantern.disposition).toBe('converted');
    expect(await sessionIds()).toHaveLength(4);
  });
});
