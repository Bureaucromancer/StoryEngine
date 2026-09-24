// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { MemoryFileSource } from '../memory-source.js';
import type { FileSource } from '../source.js';

import {
  assessStructure,
  openStore,
  readMarinaraManifest,
  shortfalls,
  type MarinaraManifest,
} from './store.js';

/**
 * **Each rule here is one a real store exercises, and each test is the one that
 * fails when the rule is guessed instead of ported**
 * ([P4 §7.18](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * The trees are small and literal on purpose. The fixture that exercises all of
 * this at once lives with the reader; these are the rules one at a time, so a
 * failure names the rule rather than a symptom three conversions downstream.
 */

const T = 'storage/tables';
const json = (value: unknown): string => JSON.stringify(value);

function manifest(overrides: Partial<MarinaraManifest> = {}): MarinaraManifest {
  return {
    path: 'storage/manifest.json',
    version: 7,
    unreadableVersion: null,
    tables: null,
    tornPrimary: false,
    ...overrides,
  };
}

const vera = { id: 'char_vera', name: 'Vera', data: '{}', createdAt: '2026-08-01T00:00:00.000Z' };

describe('which of the layouts is the table', () => {
  /**
   * **Shards win, and the single file is superseded, not merged.** A monolith
   * beside shard data is what an older build writes into a sharded store, and
   * the two sides forked; upstream quarantines the file. Reading it first — which
   * is what this reader did — imports the older build's copy and ignores the
   * newer one.
   */
  it('reads the shards and sets the single file aside', async () => {
    const files = new MemoryFileSource({
      [`${T}/characters.json`]: json([{ ...vera, name: 'Vera (downgrade)' }]),
      [`${T}/characters/char%5Fvera.json`]: json([vera]),
    });
    const store = openStore(files, manifest());

    expect((await store.rows('characters')).map((row) => row['name'])).toEqual(['Vera']);
    expect(store.fate(`${T}/characters.json`)).toEqual({ kind: 'superseded' });
  });

  it('reads a single file when there are no shards, which is every table below format 5', async () => {
    const files = new MemoryFileSource({ [`${T}/characters.json`]: json([vera]) });
    const store = openStore(files, manifest({ version: 4 }));

    expect(await store.rows('characters')).toEqual([vera]);
  });

  /**
   * **A shard whose primary is gone still loads from its `.bak`.** A crash can
   * take the primary and leave its backup, and a directory listing never
   * surfaces a primary that is not there — so a reader that only looks for
   * `*.json` loses that row without a trace.
   */
  it('loads a shard that survives only as its backup', async () => {
    const files = new MemoryFileSource({
      [`${T}/lorebooks/book%5Frain.json.bak`]: json([{ id: 'book_rain', name: 'Rain' }]),
    });
    const store = openStore(files, manifest());

    expect(await store.rows('lorebooks')).toEqual([{ id: 'book_rain', name: 'Rain' }]);
    expect(store.fate(`${T}/lorebooks/book%5Frain.json.bak`)).toEqual({ kind: 'backup-read' });
  });

  /**
   * **The `.bak` beside a good shard is not a second copy of its rows.** This is
   * the defect the whole stage began with: at format 5 most shards have one, and
   * reading every file in the directory imported every object twice.
   */
  it('reads a shard once, however many backups sit beside it', async () => {
    const files = new MemoryFileSource({
      [`${T}/characters/char%5Fvera.json.bak`]: json([{ ...vera, name: 'Vera (one save ago)' }]),
      [`${T}/characters/char%5Fvera.json`]: json([vera]),
      [`${T}/characters/char%5Fvera.json.tmp-4242-1758000000000`]: json([{ id: 'char_ghost' }]),
    });
    const store = openStore(files, manifest());

    expect(await store.rows('characters')).toEqual([vera]);
  });
});

describe('a file that cannot be used falls back as upstream falls back', () => {
  it('reads the backup of a torn primary, and says it did', async () => {
    const files = new MemoryFileSource({
      [`${T}/characters/char%5Fvera.json`]: '[{"id":"char_ve',
      [`${T}/characters/char%5Fvera.json.bak`]: json([vera]),
    });
    const store = openStore(files, manifest());

    expect(await store.rows('characters')).toEqual([vera]);
    expect(store.fate(`${T}/characters/char%5Fvera.json`)).toEqual({ kind: 'recovered' });
    expect(store.fate(`${T}/characters/char%5Fvera.json.bak`)).toEqual({ kind: 'backup-read' });
  });

  it('reports a torn primary with nothing to fall back to', async () => {
    const files = new MemoryFileSource({ [`${T}/characters/char%5Fvera.json`]: '[{"id":' });
    const store = openStore(files, manifest());

    expect(await store.rows('characters')).toEqual([]);
    expect(store.fate(`${T}/characters/char%5Fvera.json`)).toEqual({ kind: 'not-json' });
  });

  /** Named by an upload and not carried reads as nothing, and is not called broken. */
  it('calls a declared file unreadable rather than malformed', async () => {
    const files = new MemoryFileSource({}, [`${T}/characters/char%5Fvera.json`]);
    const store = openStore(files, manifest());

    expect(await store.rows('characters')).toEqual([]);
    expect(store.fate(`${T}/characters/char%5Fvera.json`)).toEqual({ kind: 'unreadable' });
  });

  it('counts what was not a row without keeping it', async () => {
    const files = new MemoryFileSource({
      [`${T}/characters/char%5Fvera.json`]: json([vera, 'x', 3]),
    });
    const store = openStore(files, manifest());

    expect(await store.rows('characters')).toEqual([vera]);
    expect(store.fate(`${T}/characters/char%5Fvera.json`)).toEqual({ kind: 'read', malformed: 2 });
  });

  /**
   * **The one place the two modes differ.** Below the known format a primary
   * that parses to the wrong shape is damage and its `.bak` is read, which is
   * upstream's rule. Above it the same observation is what a new shard shape
   * looks like — and every `.bak` still holds the old shape, one save stale, so
   * falling back would read the entire store out of its backups and report
   * success.
   */
  it('falls back from the wrong shape below the known format, and not above it', async () => {
    const tree = {
      [`${T}/characters/char%5Fvera.json`]: json({ rows: [] }),
      [`${T}/characters/char%5Fvera.json.bak`]: json([vera]),
    };

    const known = openStore(new MemoryFileSource(tree), manifest());
    expect(await known.rows('characters')).toEqual([vera]);

    const newer = openStore(new MemoryFileSource(tree), manifest({ version: 8 }), { strict: true });
    expect(await newer.rows('characters')).toEqual([]);
    expect(newer.fate(`${T}/characters/char%5Fvera.json`)).toEqual({ kind: 'not-rows' });
  });

  /** Damage still falls back above the known format: it says nothing about the shape. */
  it('treats an empty or zeroed primary as damage in either mode', async () => {
    for (const torn of [new Uint8Array(0), new Uint8Array(64)]) {
      const files = new MemoryFileSource({
        [`${T}/characters/char%5Fvera.json`]: torn,
        [`${T}/characters/char%5Fvera.json.bak`]: json([vera]),
      });
      const store = openStore(files, manifest({ version: 8 }), { strict: true });

      expect(await store.rows('characters')).toEqual([vera]);
      expect(store.fate(`${T}/characters/char%5Fvera.json`)).toEqual({ kind: 'recovered' });
    }
  });
});

describe('two copies of one row', () => {
  /**
   * **The canonical copy wins even when it sorts second.** A crash mid-flush can
   * leave a row in two files, and upstream keeps the copy sitting in the file
   * its owner key names — here the older copy, in the right place, over a newer
   * one in the wrong place. Keep-first would pick by sort order alone.
   */
  it('keeps the copy in the file its owner names', async () => {
    const stray = { ...vera, name: 'Vera (stray)', createdAt: '2026-07-01T00:00:00.000Z' };
    const files = new MemoryFileSource({
      [`${T}/characters/aaa-elsewhere.json`]: json([stray]),
      [`${T}/characters/char%5Fvera.json`]: json([vera]),
    });
    const store = openStore(files, manifest());

    expect((await store.rows('characters')).map((row) => row['name'])).toEqual(['Vera']);
  });

  it('keeps the earliest when neither copy is canonical', async () => {
    const earlier = { ...vera, name: 'earlier', createdAt: '2026-07-01T00:00:00.000Z' };
    const later = { ...vera, name: 'later', createdAt: '2026-08-01T00:00:00.000Z' };
    const files = new MemoryFileSource({
      [`${T}/characters/zzz.json`]: json([earlier]),
      [`${T}/characters/aaa.json`]: json([later]),
    });
    const store = openStore(files, manifest());

    expect((await store.rows('characters')).map((row) => row['name'])).toEqual(['earlier']);
  });

  /**
   * Output keeps the order of the files, not the order of the sort: a lorebook's
   * entries are in upstream's `order` on disk, and reordering them would make
   * every previously imported book re-sweep as changed.
   */
  it('keeps the rows in the order the file holds them', async () => {
    const entries = [
      { id: 'e2', lorebookId: 'book', createdAt: '2026-08-02' },
      { id: 'e1', lorebookId: 'book', createdAt: '2026-08-01' },
    ];
    const files = new MemoryFileSource({ [`${T}/lorebook_entries/book.json`]: json(entries) });
    const store = openStore(files, manifest());

    expect((await store.rows('lorebook_entries')).map((row) => row['id'])).toEqual(['e2', 'e1']);
  });
});

describe('a table that looks empty and is not', () => {
  /**
   * **Case 0.** No single file and no shards, while the manifest counts rows:
   * upstream restores the table from its automatic pre-migration backup on the
   * next boot. Reading nothing would import a library Marinara would show full.
   */
  it('reads the pre-migration backup upstream would restore', async () => {
    const files = new MemoryFileSource({ [`${T}/characters.json.pre-shard`]: json([vera]) });
    const store = openStore(files, manifest({ tables: { characters: 1 } }));

    expect(await store.rows('characters')).toEqual([vera]);
    expect(store.fate(`${T}/characters.json.pre-shard`)).toEqual({
      kind: 'restored',
      table: 'characters',
    });
  });

  it('restores only when the manifest says there is something to restore', async () => {
    const files = new MemoryFileSource({ [`${T}/characters.json.pre-shard`]: json([vera]) });

    expect(
      await openStore(files, manifest({ tables: { characters: 0 } })).rows('characters'),
    ).toEqual([]);
    expect(await openStore(files, manifest()).rows('characters')).toEqual([]);
  });

  /** Upstream picks by existence and never falls through to a timestamped copy. */
  it('ignores a timestamped backup, which upstream never restores from', async () => {
    const files = new MemoryFileSource({
      [`${T}/characters.json.pre-shard-2026-09-01T10-00-00-000Z`]: json([vera]),
    });

    expect(
      await openStore(files, manifest({ tables: { characters: 1 } })).rows('characters'),
    ).toEqual([]);
  });
});

describe('what the manifest says', () => {
  it('falls back to its backup when the primary is torn, and says so', async () => {
    const files = new MemoryFileSource({
      'storage/manifest.json': '{"version":',
      'storage/manifest.json.bak': json({ version: 7, tables: { characters: 2 } }),
    });

    expect(await readMarinaraManifest(files)).toEqual({
      path: 'storage/manifest.json.bak',
      version: 7,
      unreadableVersion: null,
      tables: { characters: 2 },
      tornPrimary: true,
    });
  });

  it('keeps a version it cannot read apart from a version that is absent', async () => {
    const stated = await readMarinaraManifest(
      new MemoryFileSource({ 'storage/manifest.json': json({ version: '8' }) }),
    );
    const absent = await readMarinaraManifest(
      new MemoryFileSource({ 'storage/manifest.json': json({}) }),
    );

    expect(stated?.version).toBeNull();
    expect(stated?.unreadableVersion).toBe('8');
    expect(absent?.unreadableVersion).toBeNull();
  });

  it('keeps only counts that are counts', async () => {
    const files = new MemoryFileSource({
      'storage/manifest.json': json({ version: 7, tables: { a: 3, b: -1, c: 1.5, d: '4' } }),
    });

    expect((await readMarinaraManifest(files))?.tables).toEqual({ a: 3 });
  });

  it('is nothing at all when neither file parses', async () => {
    expect(await readMarinaraManifest(new MemoryFileSource({}))).toBeNull();
  });
});

describe('the structural questions a newer format has to answer', () => {
  const strict = (tree: Record<string, string>, counts: Record<string, number> | null = null) => {
    const m = manifest({ version: 8, tables: counts });
    return { store: openStore(new MemoryFileSource(tree), m, { strict: true }), m };
  };

  it('finds nothing wrong with a store in a shape it knows', async () => {
    const { store, m } = strict({ [`${T}/characters/char%5Fvera.json`]: json([vera]) });

    expect(await assessStructure(store, m)).toBeNull();
  });

  it('(a) names a file it does not recognise in a table it reads', async () => {
    const { store, m } = strict({ [`${T}/characters/char%5Fvera.jsonl`]: json([vera]) });

    expect(await assessStructure(store, m)).toEqual({
      table: 'characters',
      reason: 'unknown-file',
      detail: `${T}/characters/char%5Fvera.jsonl`,
    });
  });

  it('(b) names a data file that is not a list of rows', async () => {
    const { store, m } = strict({ [`${T}/lorebook_folders/book.json`]: json({ rows: [] }) });

    expect(await assessStructure(store, m)).toMatchObject({
      table: 'lorebook_folders',
      reason: 'not-rows',
    });
  });

  /**
   * **A power cut is not a new format.** A zeroed or empty shard with no backup
   * to fall back to costs its rows, and is reported — but it is not evidence
   * that the layout changed, and refusing a whole newer store over one torn
   * write would be the gate mistaking damage for design.
   */
  it('(b) does not count a zeroed file with no backup as a new shape', async () => {
    const m = manifest({ version: 8, tables: null });
    const files = new MemoryFileSource({
      [`${T}/characters/char%5Fvera.json`]: new Uint8Array(64),
    });
    const store = openStore(files, m, { strict: true });

    expect(await assessStructure(store, m)).toBeNull();
    expect(store.fate(`${T}/characters/char%5Fvera.json`)).toEqual({ kind: 'unreadable' });
  });

  it('(c) names a column a join needs that every row has lost', async () => {
    const { store, m } = strict({
      [`${T}/lorebook_entries/book.json`]: json([
        { id: 'e1', bookId: 'book', content: '', keys: '[]' },
      ]),
    });

    expect(await assessStructure(store, m)).toEqual({
      table: 'lorebook_entries',
      reason: 'missing-column',
      detail: 'lorebookId',
    });
  });

  /** A null join key is an orphan, which upstream writes on purpose. */
  it('(c) lets an orphan through', async () => {
    const { store, m } = strict({
      [`${T}/lorebook_entries/orphaned-rows.json`]: json([
        { id: 'e1', lorebookId: null, content: '', keys: '[]' },
      ]),
    });

    expect(await assessStructure(store, m)).toBeNull();
  });

  it('(d) names a table the manifest counts rows for and no file holds', async () => {
    const { store, m } = strict({}, { characters: 2 });

    expect(await assessStructure(store, m)).toMatchObject({
      table: 'lorebooks',
      reason: 'missing-data',
    });
  });

  it('(d) names a table the manifest does not count at all', async () => {
    const counts = Object.fromEntries(
      [
        'lorebooks',
        'lorebook_entries',
        'lorebook_folders',
        'lorebook_character_links',
        'prompt_presets',
        'prompt_sections',
        'prompt_groups',
        'choice_blocks',
        'personas',
      ].map((t) => [t, 0]),
    );
    const { store, m } = strict({ [`${T}/characters/char%5Fvera.json`]: json([vera]) }, counts);

    expect(await assessStructure(store, m)).toEqual({
      table: 'characters',
      reason: 'missing-data',
      detail: 'uncounted',
    });
  });

  /** An upload that did not carry a file has not lost it. */
  it('(d) counts a declared file as present', async () => {
    const files = new MemoryFileSource({}, [`${T}/lorebooks/book.json`]);
    const m = manifest({ version: 8, tables: { lorebooks: 1 } });
    const store = openStore(files, m, { strict: true });

    expect(await assessStructure(store, m)).not.toMatchObject({ table: 'lorebooks' });
  });

  it('reports a shortfall at any format, as a note rather than a finding', async () => {
    const m = manifest({ tables: { characters: 3 } });
    const store = openStore(
      new MemoryFileSource({ [`${T}/characters/char%5Fvera.json`]: json([vera]) }),
      m,
    );

    expect(await shortfalls(store, m)).toEqual([{ table: 'characters', expected: 3, found: 1 }]);
  });
});

describe('the store finds its tables without walking the root', () => {
  /**
   * **Conversion must not depend on the whole-root walk**, which a real source
   * bounds at fifty thousand files: a store with years of chats reaches that
   * long before it reaches `personas.json`. A source that throws on an unscoped
   * list proves every table was found by name or by its own directory.
   */
  it('never lists the whole root', async () => {
    const inner = new MemoryFileSource({
      [`${T}/characters.json`]: json([vera]),
      [`${T}/lorebooks/book.json`]: json([{ id: 'book', name: 'Rain' }]),
    });
    const scoped: FileSource = {
      list(under?: string) {
        if (under === undefined) throw new Error('walked the whole root');
        return inner.list(under);
      },
      read: (path) => inner.read(path),
      exists: (path) => inner.exists(path),
    };
    const store = openStore(scoped, manifest());

    expect(await store.rows('characters')).toEqual([vera]);
    expect(await store.rows('lorebooks')).toEqual([{ id: 'book', name: 'Rain' }]);
  });
});
