// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Layout } from '../storage/layout.js';
import { writeTarGz } from '../storage/tar-archive.js';
import { makeZip } from '../storage/test-zip.js';
import { DEFAULT_ZIP_FILE_LIMITS } from '../storage/zip-file.js';

import { BackupFileSource } from './backup-source.js';
import { LandedDatabaseSource, LandedZipSource } from './landed-source.js';
import { openStore } from './marinara/store.js';
import { MemoryFileSource } from './memory-source.js';
import type { FileSource } from './source.js';
import { ZipFileSource } from './zip-source.js';

/**
 * **Scoped listing, the same way over every source whose directories are
 * implied** ([P4 §7.18](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * An archive and an uploaded folder hold files, not directories, and both answer
 * `exists` for a directory by prefix. Listing under a directory has to agree
 * with that — including the case the prefix rule is easiest to get wrong: a
 * prefix that names a file, which must yield nothing rather than the file
 * itself or every file whose name merely starts the same way.
 *
 * ***Every one of them, not the three that existed when this was written***
 * (2026-10-02). The table held an in-memory tree and an in-memory archive; the
 * three sources origin's `main` added beside them — the landed archive every
 * zip sent to `POST /import/file` is swept through, a backup, and a landed
 * database — were written against the one-argument `list()` and yielded
 * everything whatever they were asked, which TypeScript cannot see because a
 * method may take fewer parameters than its interface. A table that names
 * every implementation is the check that can.
 */

const tree = {
  'storage/tables/characters/a.json': '[]',
  'storage/tables/characters/b.json': '[]',
  'storage/tables/characters.json': '[]',
  'storage/tables/charactersheets/x.json': '[]',
  'OpenAI Settings/Default.json': '{}',
};

let scratch = '';
/** What a test opened that holds a file handle, closed before the next. */
const opened: LandedZipSource[] = [];

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'se-memory-source-'));
});

afterEach(async () => {
  for (const source of opened.splice(0)) await source.close();
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function zipBytesOf(files: Record<string, string>): Uint8Array {
  return makeZip(Object.entries(files).map(([name, text]) => ({ name, body: text })));
}

function zipOf(files: Record<string, string>): FileSource {
  const result = ZipFileSource.open(zipBytesOf(files));
  if (!result.ok) throw new Error(`zip refused: ${result.refusal}`);
  return result.source;
}

let landings = 0;

/** The same archive, written to disk and opened the way the upload route opens it. */
async function landedZipOf(files: Record<string, string>): Promise<FileSource> {
  landings += 1;
  const path = join(scratch, `landed-${String(landings)}.zip`);
  await writeFile(path, zipBytesOf(files));
  const result = await LandedZipSource.open(path, {
    layout: new Layout(join(scratch, 'data')),
    limits: DEFAULT_ZIP_FILE_LIMITS,
  });
  if (!result.ok) throw new Error(`landed zip refused: ${result.refusal}`);
  opened.push(result.source);
  return result.source;
}

async function backupOf(files: Record<string, string>): Promise<FileSource> {
  landings += 1;
  const path = join(scratch, `backup-${String(landings)}.tar.gz`);
  await writeTarGz(
    path,
    Object.entries(files).map(([name, text]) => ({
      name,
      bytes: new TextEncoder().encode(text),
    })),
    0,
  );
  const result = await BackupFileSource.open(path);
  if (!result.ok) throw new Error(`backup refused: ${result.refusal}`);
  return result.source;
}

const SOURCES: readonly [string, () => Promise<FileSource>][] = [
  [
    'an in-memory tree',
    () => Promise.resolve(new MemoryFileSource(tree, ['storage/tables/characters/declared.json'])),
  ],
  ['an archive', () => Promise.resolve(zipOf(tree))],
  ['an archive landed on disk', () => landedZipOf(tree)],
  ['a backup', () => backupOf(tree)],
];

async function listed(source: FileSource, under?: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const path of source.list(under)) paths.push(path);
  return paths.sort();
}

describe.each(SOURCES)('listing under a directory of %s', (_name, make) => {
  it('yields only what is under it, still relative to the root', async () => {
    const paths = await listed(await make(), 'storage/tables/characters');

    expect(paths.filter((path) => !path.endsWith('declared.json'))).toEqual([
      'storage/tables/characters/a.json',
      'storage/tables/characters/b.json',
    ]);
  });

  /** `characters` is a prefix of `charactersheets`, and not its directory. */
  it('does not take a sibling whose name starts the same way', async () => {
    const paths = await listed(await make(), 'storage/tables/characters');

    expect(paths.some((path) => path.includes('charactersheets'))).toBe(false);
    expect(paths).not.toContain('storage/tables/characters.json');
  });

  it('takes a directory with a space in its name', async () => {
    expect(await listed(await make(), 'OpenAI Settings')).toEqual(['OpenAI Settings/Default.json']);
  });

  it('yields nothing for a file and nothing for a directory that is not there', async () => {
    const source = await make();
    expect(await listed(source, 'storage/tables/characters.json')).toEqual([]);
    expect(await listed(source, 'storage/tables/nothing')).toEqual([]);
  });

  it('is the whole tree when unscoped', async () => {
    expect((await listed(await make())).length).toBeGreaterThanOrEqual(Object.keys(tree).length);
  });
});

/**
 * ***A landed database is one file***, and a file is not a directory — so it is
 * the whole listing unscoped and nothing under any directory, its own name
 * included.
 */
describe('listing a landed database', () => {
  const space = {
    directory: '',
    path: (name: string) => name,
    dispose: () => Promise.resolve(),
  };

  it('is its one file unscoped, and nothing under anything', async () => {
    const source = new LandedDatabaseSource(space, 'aventura.db');

    expect(await listed(source)).toEqual(['aventura.db']);
    expect(await listed(source, 'aventura.db')).toEqual([]);
    expect(await listed(source, 'storage')).toEqual([]);
  });
});

/**
 * ***The reason it matters***: the Marinara store finds a table by listing its
 * directory, and an asset tree beside `storage/` whose first segment is a table
 * name — `lorebooks/images/` — was counted as an unknown file of that table
 * when the listing ignored `under`. The same store, zipped, then had a layout
 * the same folder by path did not.
 */
describe('a zipped Marinara store, laid out as the folder is', () => {
  it('keeps the pictures under lorebooks/ out of the lorebooks table', async () => {
    const files = await landedZipOf({
      'storage/tables/lorebooks/book%5F1.json': '[]',
      'lorebooks/images/book_1/cover.png': 'png',
    });

    const layout = await openStore(files, null).layout('lorebooks');

    expect(layout.unknown).toEqual([]);
    expect(layout.shards).toEqual(['book%5F1']);
  });
});

describe('a declared path is listed under its directory too', () => {
  /** An upload that named a file and did not carry it still reports it where it was. */
  it('lists what was named but not carried', async () => {
    const source = new MemoryFileSource(tree, ['storage/tables/characters/declared.json']);

    expect(await listed(source, 'storage/tables/characters')).toContain(
      'storage/tables/characters/declared.json',
    );
  });
});
