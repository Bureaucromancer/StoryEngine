// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TAG_REGISTRY_SCHEMA, type TagEntry } from '@storyengine/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Layout } from '../storage/layout.js';
import { TagsError, TagStore } from './store.js';

/**
 * The tag registry on disk — [25 §4](../../../../docs/design/25-tagging.md).
 *
 * Three claims, and each of them is the store's rather than the shared module's:
 * that a **write is validated** where a read is tolerant, that **two writers do
 * not lose each other**, and that a file somebody hand-edited badly still opens.
 * The shared module's own tolerance is tested beside it in `tags.test.ts`.
 */

let dataDir: string;
let layout: Layout;
let store: TagStore;

function entry(over: Partial<TagEntry> = {}): TagEntry {
  return {
    id: 'tag-1',
    name: 'noir',
    swatch: null,
    sortOrder: 0,
    folder: 'none',
    hidden: false,
    createdAt: '2026-09-08T00:00:00Z',
    ...over,
  };
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-tags-'));
  layout = new Layout(dataDir);
  store = new TagStore(layout);
  await mkdir(layout.userRoot('ned'), { recursive: true });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('reading', () => {
  it('is empty before anything is stored', async () => {
    expect(await store.read('ned')).toEqual({ schema: TAG_REGISTRY_SCHEMA, tags: [] });
  });

  it('reads back what it wrote', async () => {
    await store.write('ned', [entry({ swatch: 'rose', sortOrder: 3 })]);

    const read = await store.read('ned');
    expect(read.tags).toEqual([entry({ swatch: 'rose', sortOrder: 3 })]);
  });

  /**
   * The asymmetry with `accounts.json`, and `prefs.ts`'s reasoning exactly: a
   * broken accounts file means the server cannot tell who anyone is, and a
   * broken tag file means somebody's chips are grey. Refusing to start over the
   * second would be treating them as the same event.
   */
  it('reads an unparseable file as empty rather than refusing', async () => {
    await writeFile(layout.tagsFile('ned'), '{ not json', 'utf8');

    expect((await store.read('ned')).tags).toEqual([]);
  });

  it('reads a file of the wrong shape as empty', async () => {
    await writeFile(layout.tagsFile('ned'), '["noir"]', 'utf8');

    expect((await store.read('ned')).tags).toEqual([]);
  });

  it('drops one unreadable row and keeps the others', async () => {
    await writeFile(
      layout.tagsFile('ned'),
      JSON.stringify({ schema: TAG_REGISTRY_SCHEMA, tags: [entry(), null, { id: 'x' }] }),
      'utf8',
    );

    expect((await store.read('ned')).tags.map((tag) => tag.id)).toEqual(['tag-1']);
  });

  it('keeps one account registry out of another', async () => {
    await mkdir(layout.userRoot('vera'), { recursive: true });
    await store.write('ned', [entry()]);

    expect((await store.read('vera')).tags).toEqual([]);
  });
});

/**
 * **Written strictly**, which is the difference from the preferences bag beside
 * it. That store documents at length that it does not interpret what it holds;
 * this one has a schema, and a document it produced should be one it would
 * accept back.
 */
describe('writing', () => {
  it('refuses a nameless tag', async () => {
    await expect(store.write('ned', [entry({ name: '   ' })])).rejects.toThrow(TagsError);
  });

  it('refuses an idless tag', async () => {
    await expect(store.write('ned', [entry({ id: '' })])).rejects.toThrow(TagsError);
  });

  it('refuses two tags that are one tag, whatever the case', async () => {
    await expect(
      store.write('ned', [entry({ id: 'a', name: 'noir' }), entry({ id: 'b', name: 'Noir' })]),
    ).rejects.toThrow(/already a tag/);
  });

  it('refuses two tags sharing an id', async () => {
    await expect(
      store.write('ned', [entry({ id: 'a', name: 'noir' }), entry({ id: 'a', name: 'city' })]),
    ).rejects.toThrow(/share the id/);
  });

  it('normalises a name on the way in', async () => {
    await store.write('ned', [entry({ name: '  post   waterloo  ' })]);

    expect((await store.read('ned')).tags[0]?.name).toBe('post waterloo');
  });

  it('leaves a swatch it does not recognise alone', async () => {
    // Open strings: an unknown value is the newer build's, and blanking it here
    // would lose somebody's choice on the way through an older one.
    await store.write('ned', [entry({ swatch: 'chartreuse' })]);

    expect((await store.read('ned')).tags[0]?.swatch).toBe('chartreuse');
  });

  it('writes a file a person can read', async () => {
    await store.write('ned', [entry()]);

    const text = await readFile(layout.tagsFile('ned'), 'utf8');
    expect(JSON.parse(text)).toEqual({ schema: TAG_REGISTRY_SCHEMA, tags: [entry()] });
  });
});

/**
 * The queue's whole reason. Every mutation is a read, a change and a write
 * across an `await`; without a critical section two tabs recolouring two
 * different tags both read the same registry and the second write drops the
 * first change, with nothing anywhere reporting it.
 */
describe('two writers at once', () => {
  it('does not lose either change', async () => {
    await store.write('ned', [entry({ id: 'a', name: 'noir' }), entry({ id: 'b', name: 'city' })]);

    await Promise.all([
      store.mutate('ned', (registry) =>
        registry.tags.map((tag) => (tag.id === 'a' ? { ...tag, swatch: 'rose' } : tag)),
      ),
      store.mutate('ned', (registry) =>
        registry.tags.map((tag) => (tag.id === 'b' ? { ...tag, swatch: 'teal' } : tag)),
      ),
    ]);

    const read = await store.read('ned');
    expect(read.tags.find((tag) => tag.id === 'a')?.swatch).toBe('rose');
    expect(read.tags.find((tag) => tag.id === 'b')?.swatch).toBe('teal');
  });

  it('serialises appends rather than interleaving them', async () => {
    await Promise.all([
      store.mutate('ned', (registry) => [...registry.tags, entry({ id: 'a', name: 'noir' })]),
      store.mutate('ned', (registry) => [...registry.tags, entry({ id: 'b', name: 'city' })]),
      store.mutate('ned', (registry) => [...registry.tags, entry({ id: 'c', name: 'ronin' })]),
    ]);

    expect((await store.read('ned')).tags.map((tag) => tag.id).sort()).toEqual(['a', 'b', 'c']);
  });
});
