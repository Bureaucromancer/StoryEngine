// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LOREBOOK_SCHEMA,
  type ImportItemReport,
  type ImportNote,
  type ImportReport,
  type LoreEntry,
  type Lorebook,
} from '@storyengine/shared';

import { read } from '../../library.js';
import { Layout } from '../../storage/layout.js';
import { openLocalSource } from '../../storage/local-source.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../../test-server.js';
import {
  aventurasDatabaseBytes,
  AWKWARD_LOREBOOKS,
  VAULT_LOREBOOKS,
  writeAventurasDatabase,
  type AventurasDbOptions,
} from '../fixtures/test-aventuras-db.js';
import { stableId } from '../identity.js';
import { MemoryFileSource } from '../memory-source.js';
import type { ImportCandidate, SourceItem } from '../source.js';
import { sweep } from '../sweep.js';
import { convertAventurasLorebook } from './lorebook.js';
import { AventurasReader } from './reader.js';
import {
  convertVaultLorebook,
  mapVaultLorebook,
  UNTITLED_LOREBOOK,
  vaultEntryToEntryLike,
} from './vault-lorebook.js';

/**
 * ***Vault lorebooks*** —
 * [P13.4](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * Three layers, as P13.3's characters are tested: the ports of Aventuras' row
 * mapper and of its export's entry mapping, as pure functions; the reader,
 * which turns rows into candidates; and a sweep of a whole database into a real
 * library, read back off disk. The books are `fixtures/test-aventuras-db.ts`'s
 * {@link VAULT_LOREBOOKS} — one with a repeated entry name, one empty — and,
 * where a test asks, its {@link AWKWARD_LOREBOOKS}.
 */

const HARBOUR = VAULT_LOREBOOKS[0]!;
const EMPTY = VAULT_LOREBOOKS[1]!;

const awkward = (name: string): Readonly<Record<string, unknown>> => {
  const found = AWKWARD_LOREBOOKS.find((row) => row['name'] === name && row['id'] !== null);
  if (found === undefined) throw new Error(`no awkward book called ${name}`);
  return found;
};
const TWIN = awkward('Ash Harbour');

const sourceOf = (row: Readonly<Record<string, unknown>>): string =>
  `aventura.db/lorebook_vault/${String(row['id'])}`;

const keys = (notes: readonly ImportNote[]): string[] => notes.map((note) => note.key);

/** A full `VaultLorebookEntry`, as the vault stores one. */
const GATE = {
  name: 'The Gate',
  type: 'location',
  description: 'Where every manifest is signed.',
  keywords: ['gate', 'gatehouse'],
  aliases: ['the gatehouse'],
  injectionMode: 'keyword',
  priority: 10,
};

describe('a row, as the mapper would hand it on', () => {
  const row = {
    id: 'b-1',
    name: 'Ash Harbour',
    description: 'The port.',
    entries: JSON.stringify([GATE]),
    tags: '["harbour"]',
    favorite: 1n,
    source: null,
    original_filename: 'ash-harbour.json',
    original_story_id: null,
    metadata: '{"format":"aventura"}',
    created_at: 1_758_000_000_000n,
    updated_at: 1_758_600_000_000n,
  };

  it('is the camelCase object, with its JSON columns parsed and its flag a flag', () => {
    const notes: ImportNote[] = [];

    expect(mapVaultLorebook(row, 'b-1', notes)).toEqual({
      id: 'b-1',
      name: 'Ash Harbour',
      description: 'The port.',
      entries: [GATE],
      tags: ['harbour'],
      favorite: true,
      // This mapper's `row.source || 'import'` — the character mapper's is `manual`.
      source: 'import',
      originalFilename: 'ash-harbour.json',
      originalStoryId: null,
      metadata: { format: 'aventura' },
      createdAt: 1_758_000_000_000,
      updatedAt: 1_758_600_000_000,
    });
    expect(notes).toEqual([]);
  });

  it('reads an empty column as absent, as the mapper’s truthiness does', () => {
    const notes: ImportNote[] = [];
    const mapped = mapVaultLorebook(
      { ...row, entries: '', tags: null, metadata: '' },
      'b-1',
      notes,
    );

    expect(mapped).toMatchObject({ entries: [], tags: [], metadata: null });
    expect(notes).toEqual([]);
  });

  it('reads around a column that will not parse, or is not a list, and says which', () => {
    const notes: ImportNote[] = [];
    const mapped = mapVaultLorebook(
      { ...row, entries: '[{"name": ', tags: '{"not": "a list"}', metadata: '{oops' },
      'b-1',
      notes,
    );

    // `entries` unreadable is `null`, not empty: the reader refuses the row over it.
    expect(mapped).toMatchObject({ entries: null, tags: [], metadata: null });
    expect(notes).toEqual(
      ['entries', 'tags', 'metadata'].map((column) => ({
        key: 'import.aventuras.columnUnreadable',
        params: { column },
        level: 'warn',
      })),
    );
  });
});

describe('a vault entry, as the file export would make it — without what it invents', () => {
  it('moves the injection fields inside `injection`, and makes nothing else', () => {
    expect(vaultEntryToEntryLike(GATE)).toEqual({
      name: 'The Gate',
      type: 'location',
      description: 'Where every manifest is signed.',
      aliases: ['the gatehouse'],
      injection: { mode: 'keyword', keywords: ['gate', 'gatehouse'], priority: 10 },
    });
  });

  it('invents no state, no timestamps and no id', () => {
    const like = vaultEntryToEntryLike(GATE) as Record<string, unknown>;
    for (const key of ['state', 'adventureState', 'creativeState', 'createdAt', 'updatedAt']) {
      expect(Object.keys(like), key).not.toContain(key);
    }
    expect(Object.keys(like)).not.toContain('id');
    expect(Object.keys(like)).not.toContain('storyId');
  });

  it('defaults missing aliases and keywords to empty, as the original’s `?? []` does', () => {
    expect(vaultEntryToEntryLike({ name: 'Bare' })).toMatchObject({
      aliases: [],
      injection: { keywords: [] },
    });
  });

  it('carries a field the pin does not have, and never over a mapped one', () => {
    expect(
      vaultEntryToEntryLike({ ...GATE, pinned: true, injection: 'somebody else’s' }),
    ).toMatchObject({
      pinned: true,
      injection: { mode: 'keyword', keywords: ['gate', 'gatehouse'], priority: 10 },
    });
  });

  it('hands on an element that is not a record as it is', () => {
    expect(vaultEntryToEntryLike(null)).toBeNull();
    expect(vaultEntryToEntryLike('The Gate')).toBe('The Gate');
  });
});

describe('a mapped book, as a lorebook', () => {
  const mapped = {
    id: 'b-1',
    name: 'Ash Harbour',
    description: '  The port.  ',
    entries: [
      GATE,
      { ...GATE, name: 'Ines', keywords: [], aliases: [], injectionMode: 'always', priority: 20 },
      { ...GATE, name: 'Shut', aliases: [], injectionMode: 'never', priority: 5 },
    ],
    tags: ['harbour', 7, ' noir '],
    favorite: true,
    source: 'import',
    originalFilename: 'ash-harbour.json',
    originalStoryId: 'story-1',
    metadata: { format: 'aventura', entryCount: 3 },
    createdAt: 1,
    updatedAt: 2,
  };

  function converted(input: unknown = mapped): { lorebook: Lorebook; notes: ImportNote[] } {
    const outcome = convertVaultLorebook(input);
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
    return outcome.value;
  }

  it('takes the book’s own name, description and tags', () => {
    const { lorebook } = converted();

    expect(lorebook.name).toBe('Ash Harbour');
    expect(lorebook.description).toBe('The port.');
    expect(lorebook.tags).toEqual(['harbour', 'noir']);
  });

  it('carries what it did not read into metadata, and not the id or the timestamps', () => {
    expect(converted().lorebook.metadata).toEqual({
      favorite: true,
      source: 'import',
      originalFilename: 'ash-harbour.json',
      originalStoryId: 'story-1',
      metadata: { format: 'aventura', entryCount: 3 },
    });
  });

  it('maps keywords to keys, aliases to secondary keys, the mode and the priority', () => {
    const [gate, ines, shut] = converted().lorebook.entries as [LoreEntry, LoreEntry, LoreEntry];

    expect(gate).toMatchObject({
      name: 'The Gate',
      content: 'Where every manifest is signed.',
      keys: ['gate', 'gatehouse'],
      secondaryKeys: ['the gatehouse'],
      tag: 'location',
      constant: false,
      enabled: true,
      order: 990,
    });
    // No keywords: the name is what finds it.
    expect(ines).toMatchObject({ keys: ['Ines'], constant: true, enabled: true, order: 980 });
    expect(shut).toMatchObject({ constant: false, enabled: false, order: 995 });
    // Nothing carried beside the fields the converter read.
    for (const entry of [gate, ines, shut]) expect(entry.metadata, entry.name).toEqual({});
  });

  it('says how many entries, and never that any carried tracked state', () => {
    const { notes } = converted();

    expect(notes).toEqual([
      { key: 'import.aventuras.lorebookEntries', params: { count: 3 }, level: 'info' },
    ]);
  });

  it('converts the same row to the same bytes, entry ids and all', () => {
    expect(converted().lorebook.entries).toEqual(converted().lorebook.entries);
    expect(converted().lorebook.entries[0]?.id).toBe(
      stableId('aventuras-entry', 'Ash Harbour', 'The Gate'),
    );
  });

  it('makes an empty book of an empty row, where the file path refuses one', () => {
    const { lorebook, notes } = converted({ ...mapped, entries: [] });

    expect(lorebook.entries).toEqual([]);
    expect(lorebook.name).toBe('Ash Harbour');
    expect(notes).toEqual([
      { key: 'import.aventuras.lorebookEntries', params: { count: 0 }, level: 'info' },
    ]);
    // The file's guard is untouched: an empty array is still no lorebook at all.
    expect(convertAventurasLorebook([], 'book')).toEqual({ ok: false, refusal: 'wrong-shape' });
  });

  it('names a book with no name, rather than calling it by its row id', () => {
    expect(converted({ ...mapped, name: '   ' }).lorebook.name).toBe(UNTITLED_LOREBOOK);
  });

  it('refuses what is not a mapped book at all', () => {
    for (const input of [null, 'a book', [], { name: 'x' }, { name: 'x', entries: '[]' }]) {
      expect(convertVaultLorebook(input), JSON.stringify(input)).toEqual({
        ok: false,
        refusal: 'wrong-shape',
      });
    }
  });
});

describe('the reader, with its books as candidates', () => {
  let root: string;
  let layout: Layout;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'se-aventuras-lorebooks-'));
    layout = new Layout(join(root, 'data'));
    await mkdir(layout.dataRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function itemsOf(options: AventurasDbOptions): Promise<SourceItem[]> {
    const reader = new AventurasReader(
      new MemoryFileSource({ 'aventura.db': await aventurasDatabaseBytes(options) }),
      layout,
    );
    try {
      expect((await reader.survey()).ok).toBe(true);
      const items: SourceItem[] = [];
      for await (const item of reader.items()) items.push(item);
      return items;
    } finally {
      await reader.close();
    }
  }

  const candidatesIn = (items: readonly SourceItem[]): ImportCandidate[] =>
    items.flatMap((item) => (item.outcome === 'candidate' ? [item.candidate] : []));

  it('offers one candidate per row, keyed by the row, before any character', async () => {
    const candidates = candidatesIn(await itemsOf({}));

    // By name, then id — so the two books read as a list.
    expect(
      candidates
        .filter((one) => one.format === 'aventuras.vault-lorebook')
        .map((one) => one.source),
    ).toEqual([HARBOUR, EMPTY].map(sourceOf));
    // §1.7's order: a book is stored before anything that could link to it.
    const formats = candidates.map((one) => one.format);
    expect(formats.lastIndexOf('aventuras.vault-lorebook')).toBeLessThan(
      formats.indexOf('aventuras.vault-character'),
    );
    const harbour = candidates[0]!;
    expect(harbour.notes).toBeUndefined();
    expect(harbour.payload).toMatchObject({ name: 'Ash Harbour', favorite: true });
  });

  it('names a row with no id by its place, and converts it not', async () => {
    const items = await itemsOf({ extraLorebooks: AWKWARD_LOREBOOKS });
    const unkeyed = items.filter(
      (item) =>
        item.outcome === 'observed' && item.report.source.startsWith('aventura.db/lorebook_vault#'),
    );

    expect(unkeyed).toHaveLength(1);
    expect(unkeyed[0]).toMatchObject({
      outcome: 'observed',
      report: {
        disposition: 'unrecognised',
        notes: [{ key: 'import.row.unreadable', params: { table: 'lorebook_vault' } }],
      },
    });
    // Every row is an item under the table's name, which is its count now
    // that the table has no row of its own.
    const underTable = items.filter((item) =>
      (item.outcome === 'candidate' ? item.candidate.source : item.report.source).startsWith(
        'aventura.db/lorebook_vault',
      ),
    );
    expect(underTable).toHaveLength(VAULT_LOREBOOKS.length + AWKWARD_LOREBOOKS.length);
  });
});

/** A sweep of a whole database, read back off disk. */
describe('a sweep of an Aventuras vault’s lorebooks', () => {
  let server: TestServer;
  let root: string;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
    root = await mkdtemp(join(tmpdir(), 'se-aventuras-vault-books-'));
  });

  afterEach(async () => {
    await server.dispose();
    await rm(root, { recursive: true, force: true });
  });

  async function install(options: AventurasDbOptions = {}): Promise<string> {
    const directory = join(root, 'com.karelian.aventura');
    await mkdir(directory, { recursive: true });
    writeAventurasDatabase(join(directory, 'aventura.db'), options);
    return directory;
  }

  async function swept(directory: string): Promise<ImportReport> {
    const opened = await openLocalSource(directory, server.dataDir);
    if (!opened.ok) throw new Error(`could not open ${directory}: ${opened.refusal}`);
    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      files: opened.source,
    });
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
    return outcome.report;
  }

  function item(report: ImportReport, row: Readonly<Record<string, unknown>>): ImportItemReport {
    const found = report.items.find((one) => one.source === sourceOf(row));
    if (found === undefined) throw new Error(`no row for ${sourceOf(row)}`);
    return found;
  }

  const books = (report: ImportReport): ImportItemReport[] =>
    report.items.filter((one) => one.source.startsWith('aventura.db/lorebook_vault/'));

  function stored(id: string | undefined): Lorebook {
    return read(server.services.library, 'ned', id ?? '', LOREBOOK_SCHEMA).body as Lorebook;
  }

  it('makes one lorebook per vault row, with its entries, name, description and tags', async () => {
    const report = await swept(await install());

    expect((await ownObjects(server, 'lorebooks')).objects).toHaveLength(VAULT_LOREBOOKS.length);
    const row = item(report, HARBOUR);
    expect(row.disposition).toBe('converted');
    const book = stored(row.objectId);
    expect(book.name).toBe('Ash Harbour');
    expect(book.description).toBe(HARBOUR['description']);
    expect(book.tags).toEqual(['harbour']);
    expect(book.entries.map((entry) => entry.name)).toEqual(['The Gate', 'The Gate', 'Ines Vaur']);

    const [gate, shut, ines] = book.entries as [LoreEntry, LoreEntry, LoreEntry];
    expect(gate).toMatchObject({
      content: 'Where every manifest is signed and none is read.',
      keys: ['gate', 'gatehouse'],
      secondaryKeys: [],
      tag: 'location',
      constant: false,
      enabled: true,
      order: 990,
    });
    expect(shut).toMatchObject({ keys: ['shut'], secondaryKeys: ['the closing'], order: 995 });
    expect(ines).toMatchObject({
      keys: ['Ines'],
      secondaryKeys: ['the inspector'],
      constant: true,
      order: 980,
    });
  });

  it('keeps the vault’s own facts about the book in its metadata', async () => {
    const book = stored(item(await swept(await install()), HARBOUR).objectId);

    expect(book.metadata).toEqual({
      favorite: true,
      source: 'import',
      originalFilename: 'ash-harbour.png',
      originalStoryId: null,
      metadata: { format: 'aventura', entryCount: 3 },
    });
  });

  it('is keyed by its row, which is what a re-import finds it by', async () => {
    const report = await swept(await install());

    for (const row of VAULT_LOREBOOKS) {
      const book = stored(item(report, row).objectId);
      expect(book.provenance.source, String(row['name'])).toBe('import');
      expect(book.provenance.originalFilename, String(row['name'])).toBe(sourceOf(row));
    }
  });

  it('imports an empty book as an empty book', async () => {
    const report = await swept(await install());
    const row = item(report, EMPTY);

    expect(row.disposition).toBe('converted');
    const book = stored(row.objectId);
    expect(book.name).toBe('Unwritten');
    // A null description is none, not the string "null".
    expect(book.description).toBe('');
    expect(book.entries).toEqual([]);
    expect(row.notes).toContainEqual({
      key: 'import.aventuras.lorebookEntries',
      params: { count: 0 },
      level: 'info',
    });
  });

  it('gives a repeated entry name its own id, and the first keeps the one it derives', async () => {
    const book = stored(item(await swept(await install()), HARBOUR).objectId);
    const [first, second] = book.entries as [LoreEntry, LoreEntry];

    expect(first.id).toBe(stableId('aventuras-entry', 'Ash Harbour', 'The Gate'));
    expect(second.id).not.toBe(first.id);
    expect(new Set(book.entries.map((entry) => entry.id)).size).toBe(book.entries.length);
  });

  it('keeps two books of one name apart, each its own object with its own entries', async () => {
    const report = await swept(await install({ extraLorebooks: AWKWARD_LOREBOOKS }));
    const harbour = item(report, HARBOUR);
    const twin = item(report, TWIN);

    expect(twin.disposition).toBe('converted');
    expect(twin.objectId).not.toBe(harbour.objectId);
    const book = stored(twin.objectId);
    expect(book.name).toBe('Ash Harbour');
    expect(book.description).toBe(TWIN['description']);
    expect(book.entries).toHaveLength(1);
    expect(book.entries[0]).toMatchObject({ enabled: false, content: 'Rebuilt after the fire.' });
    // The same derived id as the other book's first entry, which [04 §5.2]
    // calls ordinary: an entry id is unique within its book.
    expect(book.entries[0]?.id).toBe(stored(harbour.objectId).entries[0]?.id);
  });

  it('never says a vault book carried tracked state', async () => {
    const report = await swept(await install({ extraLorebooks: AWKWARD_LOREBOOKS }));

    expect(books(report).length).toBeGreaterThan(0);
    const all = report.items.flatMap((one) => keys(one.notes));
    expect(all).not.toContain('import.aventuras.entryStateRecorded');
  });

  it('refuses a book whose entries column will not read, and writes nothing for it', async () => {
    const report = await swept(await install({ extraLorebooks: AWKWARD_LOREBOOKS }));

    for (const name of ['Torn Pages', 'Not A List']) {
      const row = item(report, awkward(name));
      expect(row.disposition, name).toBe('unrecognised');
      expect(row.objectId, name).toBeUndefined();
      expect(row.notes, name).toContainEqual({
        key: 'import.aventuras.columnUnreadable',
        params: { column: 'entries' },
        level: 'warn',
      });
    }
    // Every column that would not read is still named, not only the first.
    expect(
      item(report, awkward('Torn Pages'))
        .notes.filter((note) => note.key === 'import.aventuras.columnUnreadable')
        .map((note) => note.params['column']),
    ).toEqual(['entries', 'metadata']);
    // Neither became a book: the library holds the others and not these.
    const names = (await ownObjects(server, 'lorebooks')).objects.map((one) => one['name']);
    expect(names).not.toContain('Torn Pages');
    expect(names).not.toContain('Not A List');
  });

  it('leaves a book imported earlier whole when its entries column has since gone bad', async () => {
    const directory = await install();
    const first = await swept(directory);
    const id = item(first, HARBOUR).objectId;
    const entries = stored(id).entries;
    expect(entries).toHaveLength(3);

    // The same row, its entries now unreadable, as a later sweep would find it.
    const db = new DatabaseSync(join(directory, 'aventura.db'));
    try {
      db.prepare('update lorebook_vault set entries = ? where id = ?').run(
        '[{"name": ',
        String(HARBOUR['id']),
      );
    } finally {
      db.close();
    }

    const second = await swept(directory);

    const row = item(second, HARBOUR);
    expect(row.disposition).toBe('unrecognised');
    expect(row.objectId).toBeUndefined();
    expect(row.notes).toEqual([
      { key: 'import.aventuras.columnUnreadable', params: { column: 'entries' }, level: 'warn' },
    ]);
    // Under the default `replace`, and still the book it was.
    expect(stored(id).entries).toEqual(entries);
    expect((await ownObjects(server, 'lorebooks')).objects).toHaveLength(VAULT_LOREBOOKS.length);
  });

  it('imports entries missing their fields with what they have', async () => {
    const report = await swept(await install({ extraLorebooks: AWKWARD_LOREBOOKS }));
    const row = item(report, awkward('Half Written'));

    expect(row.disposition).toBe('converted');
    // The one that is not a record costs itself, named by its place.
    expect(row.notes).toContainEqual({
      key: 'import.row.unreadable',
      params: { table: 'Half Written', row: 3 },
      level: 'warn',
    });
    const book = stored(row.objectId);
    expect(book.entries.map((entry) => entry.name)).toEqual([
      'Entry',
      'Only a Name',
      'Wrong Types',
      'From Later',
    ]);
    const [blank, named, wrong, later] = book.entries as [
      LoreEntry,
      LoreEntry,
      LoreEntry,
      LoreEntry,
    ];
    expect(blank).toMatchObject({ keys: ['Entry'], content: '', enabled: true, constant: false });
    expect(named).toMatchObject({ keys: ['Only a Name'], secondaryKeys: [], tag: null });
    // Every field the wrong type: read as absent, one by one, and never a crash.
    expect(wrong).toMatchObject({
      keys: ['Wrong Types'],
      secondaryKeys: [],
      content: '',
      tag: null,
      enabled: true,
      constant: false,
      order: 100,
    });
    // A field the pin's entry does not have rides in the entry's metadata.
    expect(later.metadata).toEqual({ pinned: true });
    expect(later).toMatchObject({ keys: ['later'], tag: 'concept', order: 999 });
  });

  it('reports every book unchanged on a second sweep, and writes nothing', async () => {
    const directory = await install({ extraLorebooks: AWKWARD_LOREBOOKS });
    const first = await swept(directory);
    const before = await ownObjects(server, 'lorebooks');

    const second = await swept(directory);

    expect(books(second)).toHaveLength(books(first).length);
    // Every keyed row but the two whose entries will not read, which are
    // refused both times and so never compared.
    const written = (report: ImportReport): ImportItemReport[] =>
      books(report).filter((row) => row.objectId !== undefined);
    expect(written(first)).toHaveLength(VAULT_LOREBOOKS.length + AWKWARD_LOREBOOKS.length - 3);
    expect(written(second)).toHaveLength(written(first).length);
    for (const row of books(second).filter(
      (one) => !written(first).some((w) => w.source === one.source),
    )) {
      expect(row.disposition, row.source).toBe('unrecognised');
    }
    for (const row of written(second)) {
      expect(row.disposition, row.source).toBe('unchanged');
      expect(keys(row.notes), row.source).toContain('import.object.unchanged');
    }
    expect(written(second).map((row) => row.objectId)).toEqual(
      written(first).map((row) => row.objectId),
    );
    expect((await ownObjects(server, 'lorebooks')).objects).toEqual(before.objects);
  });
});
