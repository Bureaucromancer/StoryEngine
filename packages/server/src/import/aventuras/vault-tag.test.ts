// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TAG_SWATCHES,
  type ImportItemReport,
  type ImportReport,
  type TagEntry,
} from '@storyengine/shared';

import { Layout } from '../../storage/layout.js';
import { openLocalSource } from '../../storage/local-source.js';
import { MAX_TAG_NAME_LENGTH, MAX_TAGS, TagStore } from '../../tags/store.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../../test-server.js';
import {
  aventurasDatabaseBytes,
  AWKWARD_TAGS,
  VAULT_TAGS,
  writeAventurasDatabase,
  type AventurasDbOptions,
} from '../fixtures/test-aventuras-db.js';
import type { ConflictPolicy } from '../identity.js';
import { MemoryFileSource } from '../memory-source.js';
import type { ImportCandidate, SourceItem } from '../source.js';
import { sweep } from '../sweep.js';
import { AventurasReader } from './reader.js';
import { swatchForColour, VAULT_TAG_FORMAT, VaultTagMerge } from './vault-tag.js';

/**
 * ***Vault tags*** —
 * [P13.6](../../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * on §1.8's *tags merge and are never adopted*.
 *
 * Four layers: the colour, as a pure function — every swatch finds itself,
 * greys are `stone`, and the whole of Aventuras' palette is pinned so its
 * mapping can be read; the merge, against a real registry on disk — a new
 * name minted, one already here left exactly as it was, one name from two
 * kinds one tag, and a colour the two disagreed on said; the reader, which
 * turns rows into candidates ahead of every book; and a sweep of a whole
 * database into a real account, which stamps no object and, swept again,
 * mints nothing.
 */

const tagRow = (
  over: Partial<{ id: string; name: string; type: string; color: string }> = {},
): ImportCandidate => {
  const payload = { id: 'tag-x', name: 'noir', type: 'character', color: 'indigo-500', ...over };
  return {
    source: `aventura.db/vault_tags/${payload.id}`,
    format: VAULT_TAG_FORMAT,
    payload,
  };
};

const entry = (over: Partial<TagEntry> = {}): TagEntry => ({
  id: 'mine',
  name: 'Noir',
  swatch: 'amber',
  sortOrder: 0,
  folder: 'open',
  hidden: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('an Aventuras colour, as a swatch', () => {
  it('finds every swatch from its own colour, as a token and as hex', () => {
    const own: Record<string, string> = {
      rose: '#f43f5e',
      amber: '#f59e0b',
      lime: '#84cc16',
      teal: '#14b8a6',
      sky: '#0ea5e9',
      violet: '#8b5cf6',
      fuchsia: '#d946ef',
      stone: '#78716c',
    };
    for (const swatch of TAG_SWATCHES) {
      expect(swatchForColour(`${swatch}-500`), swatch).toBe(swatch);
      expect(swatchForColour(own[swatch] ?? ''), swatch).toBe(swatch);
    }
  });

  it('pins where each of the seventeen colours Aventuras can store lands', () => {
    /**
     * The whole of the pin's palette (`TagManager.svelte`), nearest by hue.
     * Written out rather than derived, so a change to the rule shows as a
     * change here that somebody has to agree with — `green` to `teal` above
     * all, which is where the wheel puts it (31° from teal, 58° from lime).
     */
    expect(
      Object.fromEntries(
        [
          'red',
          'orange',
          'amber',
          'yellow',
          'lime',
          'green',
          'emerald',
          'teal',
          'cyan',
          'sky',
          'blue',
          'indigo',
          'violet',
          'purple',
          'fuchsia',
          'pink',
          'rose',
        ].map((family) => [family, swatchForColour(`${family}-500`)]),
      ),
    ).toEqual({
      red: 'rose',
      orange: 'amber',
      amber: 'amber',
      yellow: 'amber',
      lime: 'lime',
      green: 'teal',
      emerald: 'teal',
      teal: 'teal',
      cyan: 'sky',
      sky: 'sky',
      blue: 'sky',
      indigo: 'violet',
      violet: 'violet',
      purple: 'violet',
      fuchsia: 'fuchsia',
      pink: 'rose',
      rose: 'rose',
    });
  });

  it('calls a grey stone, however it is written', () => {
    for (const grey of [
      'slate-500',
      'gray-400',
      'zinc-700',
      'neutral-500',
      'stone-300',
      // Aventuras' own neutral, and `getColor`'s fallback.
      'surface-500',
      '#808080',
      '#777',
      '#a8a29e',
      '#ffffff',
      '#000000',
      // A tint so pale its hue is invisible, which HSL alone calls saturated.
      '#fef2f2',
    ]) {
      expect(swatchForColour(grey), grey).toBe('stone');
    }
  });

  it('reads the shapes a colour arrives in beside the pin’s own', () => {
    expect(swatchForColour('bg-red-500')).toBe('rose');
    expect(swatchForColour('  Red-500 ')).toBe('rose');
    expect(swatchForColour('violet')).toBe('violet');
    expect(swatchForColour('#E11D48')).toBe('rose');
    expect(swatchForColour('#63f')).toBe('violet');
    expect(swatchForColour('#6366f180')).toBe('violet');
    expect(swatchForColour('#16a34a')).toBe('teal');
  });

  it('answers null for anything that is not a colour', () => {
    for (const junk of ['', 'not a colour', '#12', '#ggg', 'accent-500', 'red-501', '6366f1']) {
      expect(swatchForColour(junk), junk).toBeNull();
    }
  });
});

describe('a vault tag, merged into the registry', () => {
  let dataDir: string;
  let layout: Layout;
  let store: TagStore;
  let merge: VaultTagMerge;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'se-aventuras-tags-'));
    layout = new Layout(dataDir);
    await mkdir(layout.userRoot('ned'), { recursive: true });
    store = new TagStore(layout);
    merge = new VaultTagMerge(store, 'ned');
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const tags = async (): Promise<TagEntry[]> => (await store.read('ned')).tags;

  it('mints a name the registry lacks, on the nearest swatch, after the person’s own', async () => {
    await store.write('ned', [entry({ name: 'city', swatch: 'sky' })]);

    const report = await merge.write(tagRow());

    expect(report).toEqual({
      source: 'aventura.db/vault_tags/tag-x',
      disposition: 'converted',
      notes: [
        {
          key: 'import.aventuras.tagMinted',
          params: { tag: 'noir', kind: 'character', colour: 'indigo-500', swatch: 'violet' },
          level: 'info',
        },
      ],
    });
    const [city, noir] = await tags();
    expect(city).toEqual(entry({ name: 'city', swatch: 'sky' }));
    expect(noir).toMatchObject({
      name: 'noir',
      swatch: 'violet',
      sortOrder: 1,
      folder: 'none',
      hidden: false,
    });
    expect(noir?.id).not.toBe('mine');
  });

  it('leaves a tag already here entirely alone — colour, case, folder and all — and writes nothing', async () => {
    const mine = entry();
    await store.write('ned', [mine]);
    const file = await readFile(layout.tagsFile('ned'));
    const mutate = vi.spyOn(store, 'mutate');

    const report = await merge.write(tagRow({ name: 'noir', color: 'indigo-500' }));

    expect(report.disposition).toBe('unchanged');
    expect(report.notes).toEqual([
      { key: 'import.aventuras.tagKept', params: { tag: 'Noir' }, level: 'info' },
      {
        key: 'import.aventuras.tagColourDiffers',
        params: { tag: 'Noir', kind: 'character', swatch: 'violet', kept: 'amber' },
        level: 'info',
      },
    ]);
    expect(await tags()).toEqual([mine]);
    expect(mutate).not.toHaveBeenCalled();
    expect(await readFile(layout.tagsFile('ned'))).toEqual(file);
  });

  it('joins a name that differs only in case and spacing, by sameTag', async () => {
    await merge.write(tagRow({ id: 'a', name: 'noir' }));
    const report = await merge.write(
      tagRow({ id: 'b', name: '  NOIR  ', type: 'lorebook', color: 'purple-500' }),
    );

    expect(await tags()).toHaveLength(1);
    expect((await tags())[0]).toMatchObject({ name: 'noir', swatch: 'violet' });
    // Minted by this sweep, so the second row is part of what it converted —
    // and its colour lands on the same swatch, so there is nothing to say
    // about colour.
    expect(report).toEqual({
      source: 'aventura.db/vault_tags/b',
      disposition: 'converted',
      notes: [
        {
          key: 'import.aventuras.tagShared',
          params: { tag: 'noir', kind: 'lorebook' },
          level: 'info',
        },
      ],
    });
  });

  it('makes one name from two kinds one tag, in the first one’s colour, and says the other differed', async () => {
    const first = await merge.write(tagRow({ id: 'tag-1', color: 'indigo-500' }));
    const second = await merge.write(tagRow({ id: 'tag-2', type: 'scenario', color: 'rose-500' }));

    expect(first.disposition).toBe('converted');
    expect(second).toEqual({
      source: 'aventura.db/vault_tags/tag-2',
      disposition: 'converted',
      notes: [
        {
          key: 'import.aventuras.tagShared',
          params: { tag: 'noir', kind: 'scenario' },
          level: 'info',
        },
        {
          key: 'import.aventuras.tagColourDiffers',
          params: { tag: 'noir', kind: 'scenario', swatch: 'rose', kept: 'violet' },
          level: 'info',
        },
      ],
    });
    expect((await tags()).map(({ name, swatch }) => ({ name, swatch }))).toEqual([
      { name: 'noir', swatch: 'violet' },
    ]);
  });

  it('says nothing about colour against a tag here that has none', async () => {
    await store.write('ned', [entry({ swatch: null })]);

    const report = await merge.write(tagRow());

    expect(report.notes.map((note) => note.key)).toEqual(['import.aventuras.tagKept']);
    expect((await tags())[0]?.swatch).toBeNull();
  });

  it('mints a tag whose colour will not read without one, and says so', async () => {
    const report = await merge.write(tagRow({ name: 'murk', color: 'not a colour' }));

    expect(report).toMatchObject({
      disposition: 'converted',
      notes: [
        {
          key: 'import.aventuras.tagColourUnreadable',
          params: { tag: 'murk', kind: 'character', colour: 'not a colour' },
          level: 'info',
        },
      ],
    });
    expect((await tags())[0]).toMatchObject({ name: 'murk', swatch: null });
  });

  it('refuses a row with no name, a name too long, or a full registry, and mints nothing', async () => {
    const blank = await merge.write(tagRow({ name: '   ' }));
    expect(blank).toMatchObject({
      disposition: 'unrecognised',
      notes: [{ key: 'import.aventuras.columnUnreadable', params: { column: 'name' } }],
    });

    const long = 'x'.repeat(MAX_TAG_NAME_LENGTH + 1);
    const tooLong = await merge.write(tagRow({ name: long }));
    expect(tooLong).toMatchObject({
      disposition: 'unrecognised',
      notes: [
        {
          key: 'import.aventuras.tagNameTooLong',
          params: { tag: `${'x'.repeat(MAX_TAG_NAME_LENGTH)}…`, limit: MAX_TAG_NAME_LENGTH },
        },
      ],
    });
    expect(await tags()).toEqual([]);

    const full = Array.from({ length: MAX_TAGS }, (_, n) =>
      entry({ id: `t${String(n)}`, name: `tag ${String(n)}`, sortOrder: n }),
    );
    await store.write('ned', full);
    const refused = await merge.write(tagRow());
    expect(refused).toMatchObject({
      disposition: 'unrecognised',
      notes: [{ key: 'import.aventuras.tagsFull', params: { tag: 'noir', limit: MAX_TAGS } }],
    });
    expect(await tags()).toHaveLength(MAX_TAGS);
  });

  it('refuses a payload that is not a row', async () => {
    const report = await merge.write({ ...tagRow(), payload: ['not', 'a', 'row'] });

    expect(report).toMatchObject({
      disposition: 'unrecognised',
      notes: [{ key: 'import.file.refused', params: { refusal: 'wrong-shape' } }],
    });
  });

  it('joins a tag made in another tab between its read and its write, rather than making two', async () => {
    const mine = entry();
    await store.write('ned', [mine]);
    // The read sees the registry as it was before the other tab's write.
    vi.spyOn(store, 'read').mockResolvedValueOnce({ schema: 'storyengine.tags/1', tags: [] });

    const report = await merge.write(tagRow());

    expect(report.disposition).toBe('unchanged');
    expect(await tags()).toEqual([mine]);
  });
});

describe('the reader, with its tags as candidates', () => {
  let root: string;
  let layout: Layout;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'se-aventuras-tag-rows-'));
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

  it('offers one candidate per row, by name, keyed by the row, ahead of every book', async () => {
    const items = await itemsOf({});
    const candidates = items.flatMap((item) =>
      item.outcome === 'candidate' ? [item.candidate] : [],
    );
    const formats = candidates.map((one) => one.format);

    expect(
      candidates.filter((one) => one.format === VAULT_TAG_FORMAT).map((one) => one.source),
    ).toEqual(['tag-3', 'tag-1', 'tag-2', 'tag-4'].map((id) => `aventura.db/vault_tags/${id}`));
    expect(formats.lastIndexOf(VAULT_TAG_FORMAT)).toBeLessThan(
      formats.indexOf('aventuras.vault-lorebook'),
    );
    expect(candidates[0]?.payload).toEqual({
      id: 'tag-3',
      name: 'harbour',
      type: 'lorebook',
      color: 'emerald-500',
    });
    // The table's own row is gone: its rows are its count.
    expect(
      items.some(
        (item) => item.outcome === 'observed' && item.report.source === 'aventura.db/vault_tags',
      ),
    ).toBe(false);
  });

  it('names a row with no id by its place, and converts it not', async () => {
    const items = await itemsOf({ extraTags: AWKWARD_TAGS });
    const unkeyed = items.filter(
      (item) =>
        item.outcome === 'observed' && item.report.source.startsWith('aventura.db/vault_tags#'),
    );

    expect(unkeyed).toHaveLength(1);
    expect(unkeyed[0]).toMatchObject({
      outcome: 'observed',
      report: {
        disposition: 'unrecognised',
        notes: [{ key: 'import.row.unreadable', params: { table: 'vault_tags' } }],
      },
    });
  });
});

/** A sweep of a whole database into a real account, read back through the routes. */
describe('a sweep of an Aventuras vault’s tags', () => {
  let server: TestServer;
  let root: string;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
    root = await mkdtemp(join(tmpdir(), 'se-aventuras-vault-tags-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.dispose();
    await rm(root, { recursive: true, force: true });
  });

  async function install(options: AventurasDbOptions = {}): Promise<string> {
    const directory = join(root, 'com.karelian.aventura');
    await mkdir(directory, { recursive: true });
    writeAventurasDatabase(join(directory, 'aventura.db'), options);
    return directory;
  }

  async function swept(directory: string, onConflict?: ConflictPolicy): Promise<ImportReport> {
    const opened = await openLocalSource(directory, server.dataDir);
    if (!opened.ok) throw new Error(`could not open ${directory}: ${opened.refusal}`);
    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      tags: server.services.tags,
      files: opened.source,
      ...(onConflict === undefined ? {} : { onConflict }),
    });
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
    return outcome.report;
  }

  const tagRows = (report: ImportReport): ImportItemReport[] =>
    report.items.filter((one) => one.source.startsWith('aventura.db/vault_tags'));

  const row = (report: ImportReport, id: string): ImportItemReport => {
    const found = report.items.find((one) => one.source === `aventura.db/vault_tags/${id}`);
    if (found === undefined) throw new Error(`no row for ${id}`);
    return found;
  };

  const registry = async (): Promise<TagEntry[]> => (await server.services.tags.read('ned')).tags;

  it('mints each name once, on its swatch, and reads around what it cannot', async () => {
    const report = await swept(await install({ extraTags: AWKWARD_TAGS }));

    expect(tagRows(report)).toHaveLength(VAULT_TAGS.length + AWKWARD_TAGS.length);
    // `  NOIR ` sorts first and mints the tag, so the fixture's two `noir`s
    // join it — one name, three kinds, one tag.
    expect((await registry()).map(({ name, swatch }) => ({ name, swatch }))).toEqual([
      { name: 'NOIR', swatch: 'violet' },
      { name: 'ashen', swatch: 'stone' },
      { name: 'harbour', swatch: 'teal' },
      { name: 'murk', swatch: null },
      { name: 'quiet', swatch: 'sky' },
      { name: 'salt', swatch: 'rose' },
    ]);
    expect(row(report, 'tag-1').notes.map((note) => note.key)).toEqual([
      'import.aventuras.tagShared',
    ]);
    expect(row(report, 'tag-2').notes.map((note) => note.key)).toEqual([
      'import.aventuras.tagShared',
      'import.aventuras.tagColourDiffers',
    ]);
    for (const id of ['tag-blank', 'tag-long']) {
      expect(row(report, id).disposition, id).toBe('unrecognised');
    }
    expect(row(report, 'tag-junk').notes[0]?.key).toBe('import.aventuras.tagColourUnreadable');
  });

  it('stamps no imported object with tagIds, which stay the person’s to adopt', async () => {
    await swept(await install());

    const bodies = (await ownObjects(server)).objects.map(
      (listed) => listed['object'] as { tags?: string[]; tagIds?: unknown },
    );
    expect(bodies.filter((body) => (body.tags ?? []).length > 0).length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.tagIds).toBeUndefined();
  });

  it('swept again, reports every tag unchanged, mints nothing and writes nothing', async () => {
    const directory = await install({ extraTags: AWKWARD_TAGS });
    const first = await swept(directory);
    const before = await registry();
    const mutate = vi.spyOn(TagStore.prototype, 'mutate');

    const second = await swept(directory);

    expect(tagRows(second).map((one) => one.source)).toEqual(
      tagRows(first).map((one) => one.source),
    );
    for (const one of tagRows(second)) {
      // What was refused is refused again; everything else was here.
      const expected =
        one.source.includes('#') || /tag-(?:blank|long)$/.test(one.source)
          ? 'unrecognised'
          : 'unchanged';
      expect(one.disposition, one.source).toBe(expected);
    }
    expect(await registry()).toEqual(before);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('recolours nothing under replace or keep-both, since a merge never overwrites', async () => {
    const mine = { name: 'noir', swatch: 'amber' };
    const made = await server.request({ method: 'POST', url: '/api/tags', payload: mine });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    const directory = await install();

    for (const policy of ['replace', 'keep-both'] as const) {
      const report = await swept(directory, policy);
      expect(row(report, 'tag-1').disposition, policy).toBe('unchanged');
      const noir = (await registry()).filter((tag) => tag.name === 'noir');
      expect(
        noir.map(({ name, swatch }) => ({ name, swatch })),
        policy,
      ).toEqual([mine]);
    }
  });
});
