// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImportItemReport, ImportReport } from '@storyengine/shared';

import { openImportScratch } from '../../storage/import-scratch.js';
import { Layout } from '../../storage/layout.js';
import { openLocalSource, type LocalSource } from '../../storage/local-source.js';
import { SnapshotSpaceError, type SnapshotTaskOutcome } from '../../storage/sqlite-snapshot.js';
import { makeZip } from '../../storage/test-zip.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../../test-server.js';
import {
  AVENTURAS_DB_VARIANTS,
  aventurasBackupMetadata,
  aventurasDatabaseBytes,
  buildAventurasDatabase,
  FIXTURE_API_KEY,
  openAventurasWithUnsavedFrames,
  SETTINGS,
  STORIES,
  STORY_COW_ROWS,
  UNSAVED,
  VAULT_CHARACTERS,
  writeAventurasBackupFolder,
  writeAventurasDatabase,
  type AventurasDbOptions,
} from '../fixtures/test-aventuras-db.js';
import { MemoryFileSource } from '../memory-source.js';
import { AVENTURAS_DISPOSITIONS, AVENTURAS_TABLES } from '../registries/aventuras.js';
import type { FileSource, ImportCandidate, SourceItem } from '../source.js';
import { sweep } from '../sweep.js';
import { ZipFileSource } from '../zip-source.js';
import { AventurasReader, CONVERTED_TABLES } from './reader.js';
import { AVENTURAS_KNOWN_SCHEMA } from './schema.js';

/**
 * ***The kind, the probe, and a reader that converts nothing yet*** —
 * [P13.2](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * *Ends at: a sweep of a real database produces a complete review and writes
 * nothing.* So the tests are in three kinds: the survey refuses what it must
 * and leaves scratch empty when it does; what it accepts, it describes — every
 * table, every story, the log, the version, the backup's own note — without a
 * key from `settings` reaching anything; and the copy of somebody's install is
 * let go of however the reading ends.
 *
 * *Since P13.3* the characters are written, so *writes nothing* became
 * *writes the characters and nothing else*, and a converted table is counted
 * by its rows rather than by a row of its own; the characters themselves are
 * `vault-character.test.ts`'s.
 *
 * The databases are built by `fixtures/test-aventuras-db.ts` from hand-written
 * DDL, never from Aventuras' migrations (§3).
 */

let root: string;
let layout: Layout;
/** Writers a test held open, closed afterwards whatever the test did. */
let writers: DatabaseSync[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'se-aventuras-reader-'));
  layout = new Layout(join(root, 'data'));
  // There, so the snapshot's room check asks a real filesystem.
  await mkdir(layout.dataRoot, { recursive: true });
  writers = [];
});

afterEach(async () => {
  for (const db of writers) if (db.isOpen) db.close();
  await rm(root, { recursive: true, force: true });
});

async function scratchIn(of: Layout): Promise<string[]> {
  try {
    return await readdir(of.importScratchRoot);
  } catch {
    return [];
  }
}

/** A config directory holding `aventura.db`, opened as a server-path sweep opens one. */
async function configDirectory(
  options: AventurasDbOptions = {},
  dataRoot = layout.dataRoot,
): Promise<{ directory: string; files: LocalSource }> {
  const directory = join(root, 'com.karelian.aventura');
  await mkdir(directory, { recursive: true });
  writeAventurasDatabase(join(directory, 'aventura.db'), options);
  return { directory, files: await opened(directory, dataRoot) };
}

async function opened(directory: string, dataRoot = layout.dataRoot): Promise<LocalSource> {
  const result = await openLocalSource(directory, dataRoot);
  if (!result.ok) throw new Error(`could not open ${directory}: ${result.refusal}`);
  return result.source;
}

async function everything(reader: AventurasReader): Promise<ImportItemReport[]> {
  return (await both(reader)).rows;
}

/** The review's rows and the candidates beside them, from one pass. */
async function both(
  reader: AventurasReader,
): Promise<{ rows: ImportItemReport[]; candidates: ImportCandidate[] }> {
  const rows: ImportItemReport[] = [];
  const candidates: ImportCandidate[] = [];
  for await (const item of reader.items()) {
    if (item.outcome === 'observed') rows.push(item.report);
    else candidates.push(item.candidate);
  }
  return { rows, candidates };
}

/** Every character a pass offered the Writer, by source. */
function characterSources(candidates: readonly ImportCandidate[]): string[] {
  return candidates
    .filter((candidate) => candidate.format === 'aventuras.character')
    .map((candidate) => candidate.source);
}

function row(rows: readonly ImportItemReport[], source: string): ImportItemReport {
  const found = rows.find((candidate) => candidate.source === source);
  if (found === undefined) throw new Error(`no row for ${source}`);
  return found;
}

/** The `rows` a table's own row reports. */
function rowCount(rows: readonly ImportItemReport[], table: string): unknown {
  return row(rows, `aventura.db/${table}`).notes[0]?.params['rows'];
}

describe('the survey refuses, and leaves nothing behind', () => {
  const REFUSALS: [string, () => Promise<FileSource>, string][] = [
    [
      'a required column missing',
      async () => (await configDirectory(AVENTURAS_DB_VARIANTS.broken)).files,
      'unknown-format',
    ],
    [
      'no _sqlx_migrations at all',
      async () => (await configDirectory({ migrations: 'none' })).files,
      'unknown-format',
    ],
    [
      'no migration that succeeded',
      async () => (await configDirectory({ migrations: 'failed' })).files,
      'unknown-format',
    ],
    [
      'a table its own version says it has, missing',
      async () => (await configDirectory({ omitTables: ['vault_tags'] })).files,
      'unknown-format',
    ],
    [
      // Found at the P13.2 review: only `lorebook_vault.entries` was ever
      // removed, so the single-column gates could all be switched off unseen —
      // and a story table without `story_id` passed the survey and threw out
      // of `items()` from its `group by`.
      'a story table without the story_id it is counted by',
      async () => (await configDirectory({ omitColumns: { story_entries: ['story_id'] } })).files,
      'unknown-format',
    ],
    [
      'a pack table without a column a later stage reads',
      async () =>
        (await configDirectory({ omitColumns: { pack_templates: ['content_hash'] } })).files,
      'unknown-format',
    ],
    [
      'a migrations table that cannot say which migrations succeeded',
      async () => (await configDirectory({ omitColumns: { _sqlx_migrations: ['success'] } })).files,
      'unknown-format',
    ],
    [
      'a migrations table with no versions in it',
      async () => (await configDirectory({ omitColumns: { _sqlx_migrations: ['version'] } })).files,
      'unknown-format',
    ],
    [
      // A folder upload that named the log and did not send it: the database
      // alone is the one as of its last checkpoint, older and looking whole.
      'a log the folder names and the upload did not carry',
      async () =>
        new MemoryFileSource({ 'aventura.db': await aventurasDatabaseBytes() }, [
          'aventura.db-wal',
        ]),
      'unreadable-root',
    ],
    [
      // Found at the P13.2 review: the directory case below cannot tell a
      // reader that went round by `read` from one that did not, since `read`
      // also answers `null` for a directory. Here `read` would answer a good
      // database, so only a reader that takes `realPath`'s answer as final
      // refuses.
      'a path the file source will not vouch for, whatever read would answer',
      async () => {
        const memory = new MemoryFileSource({ 'aventura.db': await aventurasDatabaseBytes() });
        const unvouched: FileSource = {
          read: (path) => memory.read(path),
          exists: (path) => memory.exists(path),
          list: () => memory.list(),
          realPath: () => Promise.resolve(null),
        };
        return unvouched;
      },
      'unreadable-root',
    ],
    [
      'a file that is not SQLite, by upload',
      () =>
        Promise.resolve(new MemoryFileSource({ 'aventura.db': 'this is not a database at all' })),
      'unreadable-root',
    ],
    [
      'a file that is not SQLite, by path',
      async () => {
        const directory = join(root, 'not-sqlite');
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'aventura.db'), 'SQLite? No.');
        return opened(directory);
      },
      'unreadable-root',
    ],
    [
      'a directory where the database should be',
      async () => {
        // `realPath` answers `null` for anything but a file, and that answer is
        // final: the reader does not go round by `read`.
        const directory = join(root, 'a-folder-named-like-it');
        await mkdir(join(directory, 'aventura.db'), { recursive: true });
        return opened(directory);
      },
      'unreadable-root',
    ],
  ];

  it.each(REFUSALS)('refuses %s', async (_case, files, refusal) => {
    const reader = new AventurasReader(await files(), layout);

    const survey = await reader.survey();

    expect(survey).toEqual({ ok: false, refusal, notes: [] });
    // Before `close()` is asked for anything: a refusal lets go by itself.
    expect(await scratchIn(layout)).toEqual([]);
    await reader.close();
    await reader.close();
    expect(await scratchIn(layout)).toEqual([]);
  });

  it('passes the snapshot’s own refusal through as it is', async () => {
    // A copy that failed `quick_check` is `live-install`, whose sentence tells
    // somebody to close Aventuras; flattened to `unreadable-root` it would say
    // there was nothing there. Found untested at the P13.2 review.
    const torn = (): Promise<SnapshotTaskOutcome> =>
      Promise.resolve({ ok: false, message: 'database disk image is malformed', errcode: 11 });
    const reader = new AventurasReader(
      new MemoryFileSource({ 'aventura.db': await aventurasDatabaseBytes() }),
      layout,
      { seams: { run: torn } },
    );

    expect(await reader.survey()).toEqual({ ok: false, refusal: 'live-install', notes: [] });
    expect(await scratchIn(layout)).toEqual([]);
    await reader.close();
  });

  it('will not give items without a survey that passed', async () => {
    const reader = new AventurasReader(
      (await configDirectory(AVENTURAS_DB_VARIANTS.broken)).files,
      layout,
    );
    await reader.survey();

    await expect(everything(reader)).rejects.toThrow(/survey/);
  });
});

describe('the gate is the columns, and the version only colours it', () => {
  it('reads a database newer than the pin, and says so at warn', async () => {
    const reader = new AventurasReader(
      (await configDirectory(AVENTURAS_DB_VARIANTS.newer)).files,
      layout,
    );
    try {
      const survey = await reader.survey();

      expect(survey.ok).toBe(true);
      expect(survey.notes).toContainEqual({
        key: 'import.aventuras.newerSchema',
        params: { version: 40, known: AVENTURAS_KNOWN_SCHEMA },
        level: 'warn',
      });
      // The note reaches the review on the database's own row.
      const rows = await everything(reader);
      expect(row(rows, 'aventura.db').notes.map((note) => note.key)).toContain(
        'import.aventuras.newerSchema',
      );
    } finally {
      await reader.close();
    }
  });

  it('reads a backup from before the late columns and tables, and does not call it newer', async () => {
    const reader = new AventurasReader(
      (await configDirectory(AVENTURAS_DB_VARIANTS.legacy)).files,
      layout,
    );
    try {
      const survey = await reader.survey();
      expect(survey).toEqual({ ok: true, kind: 'aventuras', notes: [] });

      const rows = await everything(reader);
      const tables = rows.filter((item) => /^aventura\.db\/[^/]+$/.test(item.source));
      // `kept_separate` (037) and `time_anchors` (038) postdate it: not
      // refused, and not listed, since the database has no such tables. A
      // converted table is listed by its rows, not by a row of its own.
      expect(tables).toHaveLength(AVENTURAS_TABLES.length - 2 - CONVERTED_TABLES.length);
      expect(tables.map((item) => item.source)).not.toContain('aventura.db/time_anchors');
      expect(row(rows, 'aventura.db').notes[0]?.params).toEqual({
        version: 35,
        tables: AVENTURAS_TABLES.length - 2,
      });
    } finally {
      await reader.close();
    }
  });

  it('counts only migrations that succeeded', async () => {
    // The runner records a failed migration and stops; that row is not the schema.
    const reader = new AventurasReader((await configDirectory({ failedNext: true })).files, layout);
    try {
      const survey = await reader.survey();
      expect(survey).toEqual({ ok: true, kind: 'aventuras', notes: [] });
    } finally {
      await reader.close();
    }
  });

  it('does not count SQLite’s own tables among Aventuras’', async () => {
    // `ANALYZE` makes `sqlite_stat1`; calling it an unrecognised table of
    // theirs would be a review describing the storage engine.
    const directory = join(root, 'analysed');
    await mkdir(directory, { recursive: true });
    const db = new DatabaseSync(join(directory, 'aventura.db'));
    try {
      buildAventurasDatabase(db);
      db.exec('analyze');
      expect(
        db.prepare("select 1 from sqlite_master where name = 'sqlite_stat1'").get(),
      ).toBeTruthy();
    } finally {
      db.close();
    }
    const reader = new AventurasReader(await opened(directory), layout);
    try {
      await reader.survey();
      const rows = await everything(reader);

      expect(rows.map((item) => item.source)).not.toContain('aventura.db/sqlite_stat1');
      expect(rows.filter((item) => item.disposition === 'unrecognised')).toEqual([]);
    } finally {
      await reader.close();
    }
  });
});

describe('a backup says what it is', () => {
  it('notes the app version, the story count and the date, on metadata.json’s own row', async () => {
    const directory = join(root, 'aventura-backup-2026-09-20');
    await writeAventurasBackupFolder(directory);
    const reader = new AventurasReader(await opened(directory), layout);
    try {
      const survey = await reader.survey();
      const note = {
        key: 'import.aventuras.backupMetadata',
        params: {
          appVersion: '0.7.11',
          storyCount: STORIES.length,
          createdAt: '2026-09-20T18:04:11.000Z',
        },
        level: 'info',
      };

      expect(survey.notes).toEqual([note]);
      const rows = await everything(reader);
      expect(row(rows, 'metadata.json')).toEqual({
        source: 'metadata.json',
        disposition: 'skipped',
        notes: [note],
      });
    } finally {
      await reader.close();
    }
  });

  it('keeps what it notes short: the two strings are somebody else’s, on their way to the ledger', async () => {
    const long = 'x'.repeat(500);
    const reader = new AventurasReader(
      new MemoryFileSource({
        'aventura.db': await aventurasDatabaseBytes(),
        'metadata.json': JSON.stringify({
          ...aventurasBackupMetadata(1),
          appVersion: long,
          createdAt: long,
        }),
      }),
      layout,
    );
    try {
      const survey = await reader.survey();

      expect(survey.notes).toEqual([
        {
          key: 'import.aventuras.backupMetadata',
          params: {
            appVersion: 'x'.repeat(64),
            storyCount: STORIES.length,
            createdAt: 'x'.repeat(64),
          },
          level: 'info',
        },
      ]);
    } finally {
      await reader.close();
    }
  });

  it.each([
    ['a fraction', 2.5],
    ['a negative', -1],
    ['a string', '2'],
    ['nothing', null],
  ])('says nothing of a story count that is %s', async (_case, storyCount) => {
    const reader = new AventurasReader(
      new MemoryFileSource({
        'aventura.db': await aventurasDatabaseBytes(),
        'metadata.json': JSON.stringify({ ...aventurasBackupMetadata(1), storyCount }),
      }),
      layout,
    );
    try {
      expect((await reader.survey()).notes).toEqual([]);
      expect(row(await everything(reader), 'metadata.json').notes).toEqual([]);
    } finally {
      await reader.close();
    }
  });

  it('lists a metadata.json it cannot read, and says nothing about it', async () => {
    const reader = new AventurasReader(
      new MemoryFileSource({
        'aventura.db': await aventurasDatabaseBytes(),
        'metadata.json': '{ not json',
      }),
      layout,
    );
    try {
      expect((await reader.survey()).notes).toEqual([]);
      expect(row(await everything(reader), 'metadata.json').notes).toEqual([]);
    } finally {
      await reader.close();
    }
  });
});

describe('the log Aventuras has not checkpointed', () => {
  it('is in the copy of an upload that carried it, and the review says the app may have been open', async () => {
    const live = join(root, 'live');
    await mkdir(live, { recursive: true });
    writers.push(openAventurasWithUnsavedFrames(join(live, 'aventura.db')));
    const files = new MemoryFileSource({
      'aventura.db': new Uint8Array(await readFile(join(live, 'aventura.db'))),
      'aventura.db-wal': new Uint8Array(await readFile(join(live, 'aventura.db-wal'))),
    });
    const reader = new AventurasReader(files, layout);
    try {
      const survey = await reader.survey();
      expect(survey.notes.map((note) => note.key)).toEqual(['import.aventuras.walCopied']);

      const { rows, candidates } = await both(reader);
      expect(row(rows, 'aventura.db').notes.map((note) => note.key)).toContain(
        'import.aventuras.walCopied',
      );
      // The character saved only to the log is one of the characters offered.
      expect(characterSources(candidates)).toHaveLength(VAULT_CHARACTERS.length + 1);
      expect(characterSources(candidates)).toContain(
        `aventura.db/character_vault/${UNSAVED.character.id}`,
      );
      expect(row(rows, `aventura.db/stories/${STORIES[0]!.id}`).notes[0]?.params).toMatchObject({
        entries: STORIES[0]!.rows.story_entries + 1,
      });
      // The log is the database's, not a file beside it.
      expect(rows.map((item) => item.source)).not.toContain('aventura.db-wal');
    } finally {
      await reader.close();
    }
    expect(await scratchIn(layout)).toEqual([]);
  });

  it('is in the copy taken by path while the writer holds the database open, with no note', async () => {
    // Both side files are there, so the snapshot takes `VACUUM INTO`, which is
    // consistent under a live writer and needs no apology.
    const live = join(root, 'live');
    await mkdir(live, { recursive: true });
    writers.push(openAventurasWithUnsavedFrames(join(live, 'aventura.db')));
    const reader = new AventurasReader(await opened(live), layout);
    try {
      expect(await reader.survey()).toEqual({ ok: true, kind: 'aventuras', notes: [] });
      const { rows, candidates } = await both(reader);
      expect(characterSources(candidates)).toContain(
        `aventura.db/character_vault/${UNSAVED.character.id}`,
      );
      // The log and its index were beside the database, and are the database's:
      // neither is a row of its own.
      expect(await readdir(live)).toEqual(
        expect.arrayContaining(['aventura.db-wal', 'aventura.db-shm']),
      );
      expect(
        rows.map((item) => item.source).filter((source) => source.startsWith('aventura.db-')),
      ).toEqual([]);
    } finally {
      await reader.close();
    }
    expect(await scratchIn(layout)).toEqual([]);
  });
});

describe('one copy per reader, and let go of however the survey stands', () => {
  // Found untested at the P13.2 review: both were claimed, and every test
  // awaited exactly one survey before closing.
  it('answers a second survey with the first, and never takes a second copy', async () => {
    const reader = new AventurasReader((await configDirectory()).files, layout);
    try {
      const first = reader.survey();
      const second = reader.survey();

      expect(second).toBe(first);
      expect((await first).ok).toBe(true);
      await reader.survey();
      expect(await scratchIn(layout)).toHaveLength(1);
    } finally {
      await reader.close();
    }
    expect(await scratchIn(layout)).toEqual([]);
  });

  it('waits for a survey still in flight, and lets go of what it took', async () => {
    const reader = new AventurasReader((await configDirectory()).files, layout);
    const surveying = reader.survey();

    await reader.close();

    expect(await scratchIn(layout)).toEqual([]);
    expect((await surveying).ok).toBe(true);
    // What that survey held is gone, not waiting for a close nobody will call.
    await expect(everything(reader)).rejects.toThrow(/survey/);
  });
});

describe('the keys in settings', () => {
  it('are counted by the one statement the reader runs on that table, and read by none', async () => {
    // [P4 §1.1], §1.9: the key must not appear in the output — which the
    // sweep tests below check — and no statement may select it, which only
    // watching the statements can check. Found at the P13.2 review, where a
    // reader that ran `select * from settings` passed every test.
    const reader = new AventurasReader((await configDirectory()).files, layout);
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
    const exec = vi.spyOn(DatabaseSync.prototype, 'exec');
    let statements: string[];
    try {
      await reader.survey();
      await everything(reader);
      // Read before the spies are restored, which clears what they saw.
      statements = [...prepare.mock.calls, ...exec.mock.calls].map(([sql]) => sql);
    } finally {
      prepare.mockRestore();
      exec.mockRestore();
      await reader.close();
    }

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((sql) => /settings/i.test(sql))).toEqual([
      'select count(*) as n from "settings"',
    ]);
  });
});

describe('a database the server already holds', () => {
  it('is read where it lies, and let go of on close', async () => {
    const space = await openImportScratch(layout);
    await writeFile(space.path('landed.sqlite'), await aventurasDatabaseBytes());
    const reader = new AventurasReader(new MemoryFileSource({}), layout, {
      owned: { space, name: 'landed.sqlite' },
    });

    expect((await reader.survey()).ok).toBe(true);
    expect(rowCount(await everything(reader), 'lorebook_vault')).toBe(2);
    await reader.close();

    expect(await scratchIn(layout)).toEqual([]);
  });

  it('is let go of by close even when nobody surveyed it', async () => {
    const space = await openImportScratch(layout);
    await writeFile(space.path('landed.sqlite'), await aventurasDatabaseBytes());
    const reader = new AventurasReader(new MemoryFileSource({}), layout, {
      owned: { space, name: 'landed.sqlite' },
    });
    expect(await scratchIn(layout)).toHaveLength(1);

    await reader.close();

    expect(await scratchIn(layout)).toEqual([]);
  });
});

describe('no room for the copy', () => {
  it('is the typed error the snapshot throws, with scratch left empty', async () => {
    // A disk nobody fills to test that the snapshot will not: the seam stands
    // in for it, as the snapshot's own tests do.
    const reader = new AventurasReader((await configDirectory()).files, layout, {
      seams: { freeBytes: () => Promise.resolve(0) },
    });

    await expect(reader.survey()).rejects.toBeInstanceOf(SnapshotSpaceError);
    await reader.close();
    expect(await scratchIn(layout)).toEqual([]);
  });
});

/**
 * ***The sweep, end to end*** — the stage's *ends at*: a complete review, and
 * nothing written.
 */
describe('a sweep of an Aventuras install', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  const serverLayout = (): Layout => server.services.library.layout;

  async function swept(files: FileSource): Promise<ImportReport> {
    const outcome = await sweep({ library: server.services.library, handle: 'ned', files });
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
    return outcome.report;
  }

  it('accounts for every table, every story and every file, and writes only the characters', async () => {
    const directory = join(root, 'aventura-backup');
    await writeAventurasBackupFolder(directory);
    // What an older backup and a hand-copied folder carry beside the database.
    await mkdir(join(directory, 'stories'), { recursive: true });
    await writeFile(join(directory, 'stories', 'the-drowned-bell.avt'), '{}');
    await writeFile(join(directory, 'notes.txt'), 'my aventuras stuff');

    const report = await swept(await opened(directory, server.dataDir));

    expect(report.source).toBe('aventuras');

    // Every table of the pin, once, under its registry disposition — or, for
    // a table that converts, not at all: it is its rows (P13.3).
    for (const table of AVENTURAS_TABLES) {
      const rows = report.items.filter((item) => item.source === `aventura.db/${table}`);
      if (AVENTURAS_DISPOSITIONS[table] === 'converted') {
        expect(rows, table).toEqual([]);
        continue;
      }
      expect(rows, table).toHaveLength(1);
      expect(rows[0]?.disposition, table).toBe(AVENTURAS_DISPOSITIONS[table]);
    }
    // And those rows are the table's count: one item per character, each one
    // imported.
    const characters = report.items.filter((item) =>
      item.source.startsWith('aventura.db/character_vault/'),
    );
    expect(characters.map((item) => item.source).sort()).toEqual(
      VAULT_CHARACTERS.map((one) => `aventura.db/character_vault/${String(one['id'])}`).sort(),
    );
    expect(new Set(characters.map((item) => item.disposition))).toEqual(new Set(['converted']));

    // Every story, with what Part 2 would bring from it — the entities, and
    // not the rows Aventuras' branches keep beside them: a branch's edit is
    // the same entity again, and a tombstone is a deletion (found at the P13.2
    // review, which had no such rows to count).
    for (const story of STORIES) {
      const params = row(report.items, `aventura.db/stories/${story.id}`).notes[0]?.params;
      expect(params, story.title).toEqual({
        story: story.title,
        entries: story.rows.story_entries,
        branches: story.rows.branches,
        characters: story.rows.characters,
        locations: story.rows.locations,
        items: story.rows.items,
        beats: story.rows.story_beats,
        lore: story.rows.entries,
        chapters: story.rows.chapters,
        checkpoints: story.rows.checkpoints,
        images: story.rows.embedded_images + story.rows.background_images,
      });
    }
    // The tables' own rows are rows, edits and tombstones included, so the
    // fixture's are counted there and the difference is visible in the review.
    for (const table of ['characters', 'locations', 'entries'] as const) {
      const cow = STORY_COW_ROWS.filter((extra) => extra.table === table).length;
      expect(cow, table).toBeGreaterThan(0);
      expect(rowCount(report.items, table), table).toBe(
        STORIES.reduce((sum, story) => sum + story.rows[table], 0) + cow,
      );
    }

    // The keys: counted as a credential, and the value nowhere.
    expect(row(report.items, 'aventura.db/settings')).toEqual({
      source: 'aventura.db/settings',
      disposition: 'credential',
      notes: [
        {
          key: 'import.aventuras.settingsDropped',
          params: { rows: SETTINGS.length },
          level: 'info',
        },
      ],
    });
    expect(JSON.stringify(report)).not.toContain(FIXTURE_API_KEY);

    // Every file beside the database, and the database itself.
    expect(row(report.items, 'aventura.db')).toEqual({
      source: 'aventura.db',
      disposition: 'recorded',
      notes: [
        {
          key: 'import.aventuras.database',
          params: { version: AVENTURAS_KNOWN_SCHEMA, tables: AVENTURAS_TABLES.length },
          level: 'info',
        },
      ],
    });
    for (const file of ['metadata.json', 'notes.txt', 'stories/the-drowned-bell.avt']) {
      expect(row(report.items, file).disposition, file).toBe('skipped');
    }
    const expected =
      1 +
      3 +
      (AVENTURAS_TABLES.length - CONVERTED_TABLES.length) +
      STORIES.length +
      VAULT_CHARACTERS.length;
    expect(report.items).toHaveLength(expected);
    expect(new Set(report.items.map((item) => item.source)).size).toBe(expected);

    // The characters converted and written, nothing else, and the copy gone.
    expect(report.counts.converted).toBe(VAULT_CHARACTERS.length);
    expect((await ownObjects(server)).objects).toHaveLength(VAULT_CHARACTERS.length);
    expect((await ownObjects(server, 'actors')).objects).toHaveLength(VAULT_CHARACTERS.length);
    expect(await scratchIn(serverLayout())).toEqual([]);
  });

  it('names a table the registry lacks as unrecognised, with its rows', async () => {
    const { files } = await configDirectory(AVENTURAS_DB_VARIANTS.newer, server.dataDir);

    const report = await swept(files);

    expect(row(report.items, 'aventura.db/story_soundtracks')).toEqual({
      source: 'aventura.db/story_soundtracks',
      disposition: 'unrecognised',
      notes: [
        {
          key: 'import.aventuras.tableRows',
          params: { table: 'story_soundtracks', rows: 1 },
          level: 'info',
        },
      ],
    });
    expect(report.counts.unrecognised).toBe(1);
  });

  it('reads the same database out of a zip, the same way', async () => {
    const directory = join(root, 'aventura-backup');
    await writeAventurasBackupFolder(directory);
    const zip = ZipFileSource.open(
      makeZip([
        {
          name: 'aventura.db',
          body: await readFile(join(directory, 'aventura.db')),
          deflate: true,
        },
        { name: 'metadata.json', body: await readFile(join(directory, 'metadata.json')) },
      ]),
    );
    if (!zip.ok) throw new Error(zip.refusal);

    const fromZip = await swept(zip.source);
    const fromFolder = await swept(await opened(directory, server.dataDir));

    // The same rows in the same order; everything but the characters word for
    // word, and the characters the same objects, which the second sweep found
    // already here — identity is the row, whichever way the database came
    // (§1.5).
    expect(fromFolder.items.map((item) => item.source)).toEqual(
      fromZip.items.map((item) => item.source),
    );
    const character = (item: ImportItemReport): boolean =>
      item.source.startsWith('aventura.db/character_vault/');
    expect(fromFolder.items.filter((item) => !character(item))).toEqual(
      fromZip.items.filter((item) => !character(item)),
    );
    const first = fromZip.items.filter(character);
    const second = fromFolder.items.filter(character);
    expect(first.map((item) => item.disposition)).toEqual(first.map(() => 'converted'));
    expect(second.map((item) => item.disposition)).toEqual(second.map(() => 'unchanged'));
    expect(second.map((item) => item.objectId)).toEqual(first.map((item) => item.objectId));
  });

  it('lets go of the copy when the survey refuses', async () => {
    const { files } = await configDirectory(AVENTURAS_DB_VARIANTS.broken, server.dataDir);
    // Watched as well as its effect, since a refusing survey lets go by itself
    // and the scratch check alone passes whether the sweep called it or not —
    // found at the P13.2 review.
    const close = vi.spyOn(AventurasReader.prototype, 'close');
    try {
      const outcome = await sweep({ library: server.services.library, handle: 'ned', files });

      expect(outcome).toEqual({ ok: false, refusal: 'unknown-format' });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      close.mockRestore();
    }
    expect(await scratchIn(serverLayout())).toEqual([]);
  });

  it('asks the services how full the disk is, through the request', async () => {
    const { files } = await configDirectory({}, server.dataDir);

    await expect(
      sweep({
        library: server.services.library,
        handle: 'ned',
        files,
        freeBytes: () => Promise.resolve(0),
      }),
    ).rejects.toBeInstanceOf(SnapshotSpaceError);
    expect(await scratchIn(serverLayout())).toEqual([]);
  });

  describe('when letting go itself fails', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- held to be put back, and only ever called with `.call(this)`
    const release = AventurasReader.prototype.close;
    const stuck = new Error('the handle would not close');

    function failingClose() {
      return vi.spyOn(AventurasReader.prototype, 'close').mockImplementation(async function (
        this: AventurasReader,
      ) {
        await release.call(this);
        throw stuck;
      });
    }

    it('is logged after a read that succeeded, and the report still returns', async () => {
      /**
       * *The contract P13.3 was told to weigh again, and weighed.* At P13.2 a
       * handle this process forgot was worth a failed request, because the
       * reader wrote nothing. Now the characters are in the library before
       * `close()` runs, and a throw would answer their import with a 500 and
       * no review of what landed — so the report wins, and the forgotten
       * handle is a `warn` on the request's log.
       */
      const { files } = await configDirectory({}, server.dataDir);
      const warnings: [Record<string, unknown>, string][] = [];
      const log = {
        warn: (object: Record<string, unknown>, message: string) => {
          warnings.push([object, message]);
        },
      };
      const close = failingClose();
      let outcome;
      try {
        outcome = await sweep({ library: server.services.library, handle: 'ned', files, log });
        expect(close).toHaveBeenCalledTimes(1);
      } finally {
        close.mockRestore();
      }

      if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
      expect(outcome.report.counts.converted).toBe(VAULT_CHARACTERS.length);
      expect((await ownObjects(server)).objects).toHaveLength(VAULT_CHARACTERS.length);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.[0]).toMatchObject({
        event: 'import.reader-close-failed',
        kind: 'aventuras',
        type: 'Error',
        message: stuck.message,
      });
      expect(await scratchIn(serverLayout())).toEqual([]);
    });

    it('is not heard at all by a caller that gave no log, and still returns the report', async () => {
      const { files } = await configDirectory({}, server.dataDir);
      const close = failingClose();
      try {
        const outcome = await sweep({ library: server.services.library, handle: 'ned', files });
        expect(outcome.ok).toBe(true);
      } finally {
        close.mockRestore();
      }
    });

    it('does not replace the error that explains a read that failed', async () => {
      const { files } = await configDirectory({}, server.dataDir);
      const failing: FileSource = {
        read: (path) => files.read(path),
        exists: (path) => files.exists(path),
        realPath: (path) => files.realPath(path),
        async *list() {
          await Promise.resolve();
          yield 'aventura.db';
          throw new Error('the disk went away');
        },
      };
      const close = failingClose();
      try {
        await expect(
          sweep({ library: server.services.library, handle: 'ned', files: failing }),
        ).rejects.toThrow('the disk went away');
        expect(close).toHaveBeenCalledTimes(1);
      } finally {
        close.mockRestore();
      }
    });
  });

  it('lets go of the copy when the items throw half way', async () => {
    const { files } = await configDirectory({}, server.dataDir);
    let heldWhileReading: string[] = [];
    // The walk of the root fails after the survey took its copy — a disk that
    // went away mid-sweep.
    const failing: FileSource = {
      read: (path) => files.read(path),
      exists: (path) => files.exists(path),
      realPath: (path) => files.realPath(path),
      async *list() {
        heldWhileReading = await scratchIn(serverLayout());
        yield 'aventura.db';
        throw new Error('the disk went away');
      },
    };

    await expect(
      sweep({ library: server.services.library, handle: 'ned', files: failing }),
    ).rejects.toThrow('the disk went away');

    // Held while it was reading, so its absence now is `close()` and not luck.
    expect(heldWhileReading).toHaveLength(1);
    expect(await scratchIn(serverLayout())).toEqual([]);
  });

  it('lets go of the copy when it finishes', async () => {
    const { files } = await configDirectory({}, server.dataDir);
    let heldWhileReading: string[] = [];
    const watching: FileSource = {
      read: (path) => files.read(path),
      exists: (path) => files.exists(path),
      realPath: (path) => files.realPath(path),
      async *list() {
        heldWhileReading = await scratchIn(serverLayout());
        yield* files.list();
      },
    };

    await swept(watching);

    expect(heldWhileReading).toHaveLength(1);
    expect(await scratchIn(serverLayout())).toEqual([]);
  });
});

describe('the fixture is what it claims to be', () => {
  it('writes metadata.json as Aventuras does', () => {
    expect(Object.keys(aventurasBackupMetadata(10)).sort()).toEqual(
      [
        'appVersion',
        'createdAt',
        'databaseSizeBytes',
        'hasDatabaseSnapshot',
        'storyCount',
        'version',
      ].sort(),
    );
  });

  it('keeps an API key in settings, so the tests above that look for it are looking for something', async () => {
    const bytes = await aventurasDatabaseBytes();
    const text = Buffer.from(bytes).toString('latin1');

    expect(text).toContain(FIXTURE_API_KEY);
  });

  it('gives an item for everything a reader sees and nothing it does not', async () => {
    // One observed item per row of the review — and, since P13.3, one
    // candidate per character, which are the only candidates there are.
    const reader = new AventurasReader(
      new MemoryFileSource({ 'aventura.db': await aventurasDatabaseBytes() }),
      layout,
    );
    try {
      await reader.survey();
      const items: SourceItem[] = [];
      for await (const item of reader.items()) items.push(item);

      const candidates = items.flatMap((item) =>
        item.outcome === 'candidate' ? [item.candidate] : [],
      );
      expect(candidates.map((candidate) => candidate.format)).toEqual(
        VAULT_CHARACTERS.map(() => 'aventuras.character'),
      );
      expect(new Set(items.map((item) => item.outcome))).toEqual(
        new Set(['observed', 'candidate']),
      );
    } finally {
      await reader.close();
    }
  });
});
