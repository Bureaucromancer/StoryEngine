// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import type { ImportNote } from '@storyengine/shared';

import { avtDocument, avtFromDatabase, PIN_AVT_VERSION } from '../fixtures/test-aventuras-avt.js';
import {
  buildAventurasDatabase,
  INLINE_PICTURES,
  LANTERN_FORK,
  QUIET_HARBOUR,
  STORIES,
  STORY_TREES,
} from '../fixtures/test-aventuras-db.js';
import { AVT_FIELDS } from '../registries/aventuras.js';
import { readUpload } from '../upload.js';
import { AVT_FORMAT, mayBeAvt, readAvt, type AvtStory } from './avt.js';
import { planPictures } from './pictures.js';
import { tablesIn } from './schema.js';
import { produceStory } from './story.js';
import { readStoryRows, type AventurasStoryRows } from './story-rows.js';
import { produceWorld } from './world.js';

/**
 * ***A story from its `.avt` is the story from the database*** —
 * [P13.15](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The file is written from the fixture database by Aventuras' own steps
 * (`fixtures/test-aventuras-avt.ts`), so the two are one story by
 * construction, and what is tested is the reader: that the producer makes the
 * same document, world and pictures from either — the database's backdrops
 * apart, which a `.avt` does not carry — under the same key; that the version
 * is gated as Aventuras' own importer reads it; and that the file is read once,
 * with its pictures left in it until they are asked for. What a person meets
 * through the doors is `routes/import-aventuras-avt.test.ts`.
 */

let open: DatabaseSync[] = [];

afterEach(() => {
  for (const db of open) if (db.isOpen) db.close();
  open = [];
});

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  open.push(db);
  buildAventurasDatabase(db, { storyTrees: [...STORY_TREES, INLINE_PICTURES] });
  return db;
}

function fromDatabase(db: DatabaseSync, id: string): AventurasStoryRows {
  const rows = readStoryRows(db, id, tablesIn(db));
  if (rows === null) throw new Error(`no story ${id}`);
  return rows;
}

function story(bytes: Uint8Array, file = 'story.avt'): AvtStory {
  const read = readAvt(bytes, { file });
  if (read.kind !== 'story') throw new Error(`not read as a story: ${JSON.stringify(read)}`);
  return read.story;
}

function encode(document: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(document));
}

/** What a production is, less the ids a store mints — an actor's and a book's are minted on write. */
function world(rows: AventurasStoryRows, key: string): unknown {
  const made = produceWorld(rows, key);
  const unminted = <T extends { id: string; provenance: object }>(object: T): T => ({
    ...object,
    id: '',
    provenance: { ...object.provenance, createdAt: '', updatedAt: '' },
  });
  return {
    ...made,
    cast: made.cast.map(({ actor, ...member }) => ({ ...member, actor: unminted(actor) })),
    lorebook: made.lorebook === null ? null : unminted(made.lorebook),
  };
}

const KEY = (id: string): string => `aventura.db/stories/${id}`;

describe('the same story, from the database and from its file', () => {
  const cases = [LANTERN_FORK, QUIET_HARBOUR, INLINE_PICTURES, STORIES[0]!];

  it.each(cases.map((one) => [one.title, one.id] as const))(
    '%s: the same key, document, world and pictures',
    (_title, id) => {
      const db = database();
      const rows = fromDatabase(db, id);
      const file = story(avtFromDatabase(db, id));

      expect(file.key).toBe(KEY(id));
      expect(file.version).toBe(PIN_AVT_VERSION);

      const fromDb = produceStory(rows, { handle: 'ned', origin: KEY(id) });
      const fromFile = produceStory(file.rows, { handle: 'ned', origin: file.key });
      expect(fromFile).toEqual(fromDb);
      expect(world(file.rows, file.key)).toEqual(world(rows, KEY(id)));

      if (fromDb.ok && fromFile.ok) {
        const planned = (from: AventurasStoryRows, placement: typeof fromDb.placement) =>
          planPictures(from, placement, from.story.title);
        const db2 = planned(rows, fromDb.placement);
        const file2 = planned(file.rows, fromFile.placement);
        // The illustrations are the same records; the database's backdrops
        // are the one thing its file never had (`AVT_FIELDS.currentBgImage`).
        const illustrations = (plan: ReturnType<typeof planPictures>) =>
          plan.planned.filter((picture) => picture.rendition.purpose === 'illustration');
        expect(illustrations(file2)).toEqual(illustrations(db2));
        expect(file2.planned.some((one) => one.rendition.purpose === 'background')).toBe(false);

        // And each picture reads to the same bytes, or the same refusal.
        for (const picture of file.rows.pictures.illustrations) {
          const twin = rows.pictures.illustrations.find((one) => one.id === picture.id)!;
          expect(picture.octets).toBe(twin.octets);
          expect(file.rows.pictures.read(picture)).toEqual(rows.pictures.read(twin));
        }
      }

      // Every portrait reads to the same bytes, and says the same when it will not.
      for (const character of rows.world.characters) {
        const fileNotes: ImportNote[] = [];
        const dbNotes: ImportNote[] = [];
        expect(file.rows.world.portrait(character.id, 'X', 'k', fileNotes)).toEqual(
          rows.world.portrait(character.id, 'X', 'k', dbNotes),
        );
        expect(fileNotes).toEqual(dbNotes);
      }
    },
  );

  it('counts what the story holds as the database reader does, edits and tombstones left out', () => {
    const db = database();
    const bell = STORIES[0]!;
    const file = story(avtFromDatabase(db, bell.id));
    expect(file.tally).toEqual({
      entries: bell.rows.story_entries,
      branches: bell.rows.branches,
      characters: bell.rows.characters,
      locations: bell.rows.locations,
      items: bell.rows.items,
      beats: bell.rows.story_beats,
      lore: bell.rows.entries,
      chapters: bell.rows.chapters,
      checkpoints: bell.rows.checkpoints,
      // The illustrations: the file carries no backdrop table.
      images: bell.rows.embedded_images,
    });
  });
});

describe('the version', () => {
  it('reads an older file as Aventuras’ importer does: what it predates is simply absent', () => {
    const db = database();
    const file = story(avtFromDatabase(db, LANTERN_FORK.id, { version: '1.5.0' }));
    expect(file.notes).toContainEqual({
      key: 'import.aventuras.avtOlderFormat',
      params: { story: 'The Lantern Fork', version: '1.5.0' },
      level: 'info',
    });
    // Before branches: the main line alone, and the head on it.
    expect(file.rows.branches).toEqual([]);
    expect(file.rows.story.currentBranchId).toBeNull();
    expect(new Set(file.rows.entries.map((entry) => entry.branchId))).toEqual(new Set([null]));
    const produced = produceStory(file.rows, { handle: 'ned', origin: file.key });
    expect(produced.ok && produced.document.turns).toHaveLength(6);
    // Its pictures and portraits came with 1.4.0 and 1.5.0, so it has them.
    expect(file.rows.pictures.illustrations.length).toBeGreaterThan(0);
    expect(file.rows.world.characters.some((one) => (one.portraitOctets ?? 0) > 0)).toBe(true);

    // 1.3.0: no pictures, and no portraits; 1.0.0: no lorebook either.
    const older = story(avtFromDatabase(db, LANTERN_FORK.id, { version: '1.3.0' }));
    expect(older.rows.pictures.illustrations).toEqual([]);
    expect(older.rows.world.characters.every((one) => one.portraitOctets === null)).toBe(true);
    const first = story(avtFromDatabase(db, LANTERN_FORK.id, { version: '1.0.0' }));
    expect(first.rows.world.lore).toEqual([]);
    expect(first.rows.world.characters.length).toBeGreaterThan(0);
  });

  it('reads a newer 1.x, and says so', () => {
    const db = database();
    const document = avtDocument(db, LANTERN_FORK.id, {
      version: '1.11.0',
      override: { soundtrack: [{ id: 'song', data: 'la la' }] },
    });
    const file = story(encode(document));
    expect(file.notes).toContainEqual({
      key: 'import.aventuras.avtNewerFormat',
      params: { story: 'The Lantern Fork', version: '1.11.0', known: PIN_AVT_VERSION },
      level: 'warn',
    });
    expect(file.rows.entries).toHaveLength(LANTERN_FORK.entries.length);
  });

  it.each([['2.0.0'], ['0.9.0'], ['one point ten'], [''], [7]])(
    'refuses %j, writing nothing and saying why',
    (version) => {
      const db = database();
      const document = { ...avtDocument(db, LANTERN_FORK.id), version };
      const read = readAvt(encode(document), { file: 'lantern.avt' });
      expect(read.kind).toBe('refused');
      if (read.kind !== 'refused') return;
      expect(read.notes).toEqual([
        {
          key: 'import.aventuras.avtUnknownFormat',
          params: {
            file: 'lantern.avt',
            version: typeof version === 'string' && version !== '' ? version : '—',
            known: PIN_AVT_VERSION,
          },
          level: 'warn',
        },
      ]);
    },
  );
});

describe('reading the file', () => {
  it('is recognised by its shape, whatever it is called, before any other probe can take it', () => {
    const db = database();
    const bytes = avtFromDatabase(db, LANTERN_FORK.id);
    // Named as a lorebook would be: it has `entries`, which the probe below
    // it would have taken for a SillyTavern world.
    const item = readUpload('worlds.json', bytes, 'high');
    expect(item.outcome).toBe('candidate');
    if (item.outcome !== 'candidate') return;
    expect(item.candidate.format).toBe(AVT_FORMAT);
    expect(item.candidate.source).toBe('worlds.json');
  });

  it('leaves every other JSON to the probes it had', () => {
    expect(mayBeAvt(encode({ entries: { 0: { key: ['a'] } } }))).toBe(false);
    // A world whose entry mentions a story is still a world.
    const world = encode({ entries: { 0: { key: ['a'], content: 'the "story" so far' } } });
    expect(readAvt(world, { file: 'w.json' }).kind).toBe('not-avt');
    expect(readUpload('w.json', world).outcome).toBe('candidate');
    expect(readAvt(encode([1, 2]), { file: 'x' }).kind).toBe('not-avt');
    expect(
      readAvt(new TextEncoder().encode('{"story": {}, "entries": ['), { file: 'x' }).kind,
    ).toBe('not-avt');
  });

  it('refuses a story with no id, which it could not key, and a file nested past the bound', () => {
    const db = database();
    const document = avtDocument(db, LANTERN_FORK.id);
    const nameless = { ...document, story: { title: 'Nobody’s' } };
    expect(readAvt(encode(nameless), { file: 'a.avt' })).toEqual({
      kind: 'refused',
      notes: [
        {
          key: 'import.aventuras.avtUnreadable',
          params: { file: 'a.avt', reason: 'no-story' },
          level: 'warn',
        },
      ],
    });
    const deep = `{"story":{"id":"s"},"entries":[],"x":${'['.repeat(200)}${']'.repeat(200)}}`;
    expect(readAvt(new TextEncoder().encode(deep), { file: 'd.avt' })).toMatchObject({
      kind: 'refused',
      notes: [{ key: 'import.aventuras.avtUnreadable', params: { reason: 'too-deep' } }],
    });
  });

  it('holds a picture to its bound by its stored length, before reading it', () => {
    const db = database();
    const file = story(avtFromDatabase(db, LANTERN_FORK.id));
    const large = file.rows.pictures.illustrations.find((one) => one.id === 'lf-p-large')!;
    const small = file.rows.pictures.illustrations.find((one) => one.id === 'lf-p-opening')!;
    const decoded = file.rows.pictures.read(large);
    expect(decoded).toBeInstanceOf(Uint8Array);
    const bound = (decoded as Uint8Array).byteLength - 1;
    const bounded = file.withPictureBound(bound);
    expect(bounded.pictures.read(large)).toBe('too-large');
    expect(bounded.pictures.read(small)).toBeInstanceOf(Uint8Array);
    expect(bounded.pictures.maxBytes).toBe(bound);
  });

  it('keeps a backdrop the file carries out, and says so', () => {
    const db = database();
    const document = avtDocument(db, LANTERN_FORK.id);
    const story0 = document['story'] as Record<string, unknown>;
    const withBackdrop = {
      ...document,
      story: { ...story0, currentBgImage: 'data:image/png;base64,AAAA' },
    };
    const file = story(encode(withBackdrop));
    expect(file.rows.pictures.backgrounds).toEqual([]);
    expect(file.notes).toContainEqual({
      key: 'import.aventuras.avtBackdropNotCarried',
      params: { story: 'The Lantern Fork' },
      level: 'info',
    });
  });

  it('reads an entry state Aventuras’ mapper made up as the absent column it stands for', () => {
    const db = database();
    const file = story(avtFromDatabase(db, LANTERN_FORK.id));
    const guild = file.rows.world.lore.find((one) => one.id === 'lf-n-guild')!;
    const bay = file.rows.world.lore.find((one) => one.id === 'lf-n-bay')!;
    expect(guild.state).toBeUndefined();
    expect(bay.state).toEqual({ type: 'location', visited: true });
  });

  it('has a policy for every field the registry names, and none for a field it does not', () => {
    // Every field the registry converts arrives; a recorded one is a count.
    const db = database();
    const file = story(avtFromDatabase(db, LANTERN_FORK.id));
    expect(file.tally.chapters).toBe(2);
    expect(Object.keys(AVT_FIELDS).sort()).toEqual(
      [
        'branches',
        'chapters',
        'characters',
        'checkpoints',
        'currentBgImage',
        'embeddedImages',
        'entries',
        'items',
        'locations',
        'lorebookEntries',
        'packBinding',
        'story',
        'storyBeats',
        'styleReviewState',
        'timeAnchors',
      ].sort(),
    );
  });
});
