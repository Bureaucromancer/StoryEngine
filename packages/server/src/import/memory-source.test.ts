// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { makeZip } from '../storage/test-zip.js';

import { MemoryFileSource } from './memory-source.js';
import type { FileSource } from './source.js';
import { ZipFileSource } from './zip-source.js';

/**
 * **Scoped listing, the same way over both sources whose directories are
 * implied** ([P4 §7.18](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * An archive and an uploaded folder hold files, not directories, and both answer
 * `exists` for a directory by prefix. Listing under a directory has to agree
 * with that — including the case the prefix rule is easiest to get wrong: a
 * prefix that names a file, which must yield nothing rather than the file
 * itself or every file whose name merely starts the same way.
 */

const tree = {
  'storage/tables/characters/a.json': '[]',
  'storage/tables/characters/b.json': '[]',
  'storage/tables/characters.json': '[]',
  'storage/tables/charactersheets/x.json': '[]',
  'OpenAI Settings/Default.json': '{}',
};

function zipOf(files: Record<string, string>): FileSource {
  const opened = ZipFileSource.open(
    makeZip(Object.entries(files).map(([name, text]) => ({ name, body: text }))),
  );
  if (!opened.ok) throw new Error(`zip refused: ${opened.refusal}`);
  return opened.source;
}

const SOURCES: readonly [string, () => FileSource][] = [
  [
    'an in-memory tree',
    () => new MemoryFileSource(tree, ['storage/tables/characters/declared.json']),
  ],
  ['an archive', () => zipOf(tree)],
];

async function listed(source: FileSource, under?: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const path of source.list(under)) paths.push(path);
  return paths.sort();
}

describe.each(SOURCES)('listing under a directory of %s', (_name, make) => {
  it('yields only what is under it, still relative to the root', async () => {
    const paths = await listed(make(), 'storage/tables/characters');

    expect(paths.filter((path) => !path.endsWith('declared.json'))).toEqual([
      'storage/tables/characters/a.json',
      'storage/tables/characters/b.json',
    ]);
  });

  /** `characters` is a prefix of `charactersheets`, and not its directory. */
  it('does not take a sibling whose name starts the same way', async () => {
    const paths = await listed(make(), 'storage/tables/characters');

    expect(paths.some((path) => path.includes('charactersheets'))).toBe(false);
    expect(paths).not.toContain('storage/tables/characters.json');
  });

  it('takes a directory with a space in its name', async () => {
    expect(await listed(make(), 'OpenAI Settings')).toEqual(['OpenAI Settings/Default.json']);
  });

  it('yields nothing for a file and nothing for a directory that is not there', async () => {
    expect(await listed(make(), 'storage/tables/characters.json')).toEqual([]);
    expect(await listed(make(), 'storage/tables/nothing')).toEqual([]);
  });

  it('is the whole tree when unscoped', async () => {
    expect((await listed(make())).length).toBeGreaterThanOrEqual(Object.keys(tree).length);
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
