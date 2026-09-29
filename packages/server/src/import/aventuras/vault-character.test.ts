// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ACTOR_SCHEMA,
  CONVENTIONAL_SECTION_IDS,
  type Actor,
  type ImportItemReport,
  type ImportNote,
  type ImportReport,
} from '@storyengine/shared';

import { blankCardPixels, read, update } from '../../library.js';
import { pngCardCodec } from '../../storage/card/index.js';
import { pixelBytes } from '../../storage/card/test-png.js';
import { Layout } from '../../storage/layout.js';
import { openLocalSource } from '../../storage/local-source.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../../test-server.js';
import {
  aventurasDatabaseBytes,
  AVENTURAS_DB_VARIANTS,
  AWKWARD_CHARACTERS,
  FIXTURE_PORTRAITS,
  LOREBOOK_IDS,
  VAULT_CHARACTERS,
  VAULT_SCENARIO_NPCS,
  writeAventurasDatabase,
  type AventurasDbOptions,
} from '../fixtures/test-aventuras-db.js';
import type { ConflictPolicy } from '../identity.js';
import { MemoryFileSource } from '../memory-source.js';
import type { ImportCandidate, SourceItem } from '../source.js';
import { sweep } from '../sweep.js';
import { AventurasReader } from './reader.js';
import { decodePortrait, mapVaultCharacter, repairVisualDescriptors } from './vault-character.js';

/**
 * ***Characters and their portraits*** —
 * [P13.3](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * Three layers, each held on its own: the port of Aventuras' row mapper and
 * its legacy-descriptor repair, as pure functions against what the original
 * makes of a row; the reader, which turns rows into candidates and carries
 * their portraits beside them (§1.6); and a sweep of a whole database into a
 * real library, read back off disk — the card's own pixels, its embedded
 * pictures, its provenance — because *a PNG portrait is the card* is a claim
 * about a file, and only the file can answer it.
 *
 * The databases are `fixtures/test-aventuras-db.ts`'s, hand-written DDL; the
 * rows this stage has to read around are its `AWKWARD_CHARACTERS`.
 */

const INES = VAULT_CHARACTERS[0]!;
const DOCKMASTER = VAULT_CHARACTERS[1]!;
const MARA = VAULT_CHARACTERS[2]!;

const sourceOf = (row: Readonly<Record<string, unknown>>): string =>
  `aventura.db/character_vault/${String(row['id'])}`;

const keys = (notes: readonly ImportNote[]): string[] => notes.map((note) => note.key);

describe('the legacy descriptors, repaired as Aventuras repairs them', () => {
  it('keeps today’s record as it is', () => {
    const record = { hair: 'grey', eyes: 'green', pronouns: 'she/her' };
    expect(repairVisualDescriptors(record)).toBe(record);
  });

  it('reads a record with none of the seven keys, or anything else, as none at all', () => {
    expect(repairVisualDescriptors({ pronouns: 'she/her' })).toEqual({});
    expect(repairVisualDescriptors(null)).toEqual({});
    expect(repairVisualDescriptors(undefined)).toEqual({});
    expect(repairVisualDescriptors('Hair: grey')).toEqual({});
    expect(repairVisualDescriptors(7)).toEqual({});
  });

  it('lands each label on its key, by any of its names and in any case', () => {
    expect(
      repairVisualDescriptors([
        'Skin: pale',
        'HAIR: long brown',
        'eye: one green, one grey',
        'Physique: slight',
        'Outfit: a salt-stained coat',
        'Accessory: a brass stamp',
        'Tattoo: an anchor, faded',
      ]),
    ).toEqual({
      face: 'pale',
      hair: 'long brown',
      eyes: 'one green, one grey',
      build: 'slight',
      clothing: 'a salt-stained coat',
      accessories: 'a brass stamp',
      distinguishing: 'an anchor, faded',
    });
  });

  it('appends a second line for the same key, and files an unknown label as distinguishing', () => {
    expect(
      repairVisualDescriptors([
        'Height: tall',
        'Body: broad',
        'Voice: gravel',
        'Scar: over one eye',
      ]),
    ).toEqual({
      build: 'tall, broad',
      distinguishing: 'gravel, over one eye',
    });
  });

  it('drops what is not a `Label: text` line, as the original does', () => {
    expect(
      repairVisualDescriptors([
        'no colon at all',
        'Hair2: a digit in the label',
        ': no label',
        'Hair: runs over\na line break',
        42,
        null,
        { hair: 'a record inside the array' },
        'Eyes:   green   ',
      ]),
    ).toEqual({ eyes: 'green' });
  });

  it('files a label spelled like an object’s own property as distinguishing, not as that property', () => {
    // The original looks labels up in a plain object, where `constructor` finds
    // a function; a `Map` finds nothing, which is what the label means.
    expect(repairVisualDescriptors(['constructor: a stranger', 'toString: odd'])).toEqual({
      distinguishing: 'a stranger, odd',
    });
  });
});

describe('a row, as the mapper would hand it on', () => {
  const row = {
    id: 'c-1',
    name: 'Ines Vaur',
    description: 'A dock inspector.',
    traits: '["patient","unbribable"]',
    visual_descriptors: '["Hair: cropped grey"]',
    tags: '["noir"]',
    favorite: 1n,
    source: null,
    original_story_id: null,
    metadata: '{"linkedLorebookId":"book-1"}',
    created_at: 1_758_000_000_000n,
    updated_at: 1_758_600_000_000n,
  };

  it('is the camelCase object, with its JSON columns parsed and its flag a flag', () => {
    const notes: ImportNote[] = [];

    expect(mapVaultCharacter(row, 'c-1', notes)).toEqual({
      id: 'c-1',
      name: 'Ines Vaur',
      description: 'A dock inspector.',
      traits: ['patient', 'unbribable'],
      visualDescriptors: { hair: 'cropped grey' },
      tags: ['noir'],
      favorite: true,
      // The mapper's `row.source || 'manual'`.
      source: 'manual',
      originalStoryId: null,
      metadata: { linkedLorebookId: 'book-1' },
      createdAt: 1_758_000_000_000,
      updatedAt: 1_758_600_000_000,
    });
    expect(notes).toEqual([]);
  });

  it('has no portrait in it — that travels beside it', () => {
    const mapped = mapVaultCharacter({ ...row, portrait: 'data:image/png;base64,AAAA' }, 'c-1', []);
    expect(Object.keys(mapped)).not.toContain('portrait');
  });

  it('reads an empty column as absent, as the mapper’s truthiness does', () => {
    const notes: ImportNote[] = [];
    const mapped = mapVaultCharacter(
      { ...row, traits: '', tags: null, visual_descriptors: '', metadata: '' },
      'c-1',
      notes,
    );

    expect(mapped).toMatchObject({ traits: [], tags: [], visualDescriptors: {}, metadata: null });
    expect(notes).toEqual([]);
  });

  it('reads around a column that will not parse, and says which', () => {
    const notes: ImportNote[] = [];
    const mapped = mapVaultCharacter(
      {
        ...row,
        traits: '["patient", ',
        visual_descriptors: 'hair: none',
        tags: '{"not": "a list"}',
        metadata: '{oops',
      },
      'c-1',
      notes,
    );

    expect(mapped).toMatchObject({ traits: [], tags: [], visualDescriptors: {}, metadata: null });
    expect(notes).toEqual(
      ['traits', 'visual_descriptors', 'tags', 'metadata'].map((column) => ({
        key: 'import.aventuras.columnUnreadable',
        params: { column },
        level: 'warn',
      })),
    );
  });

  it('does not take an integer past what a number holds for a timestamp', () => {
    // `node:sqlite` would throw reading it as a number; read as a `bigint`,
    // it is simply not a time.
    const mapped = mapVaultCharacter({ ...row, created_at: 2n ** 62n }, 'c-1', []);
    expect(mapped.createdAt).toBeNull();
  });
});

describe('a stored portrait, as bytes', () => {
  const png = FIXTURE_PORTRAITS.png;
  const base64 = Buffer.from(png).toString('base64');

  it('reads a data URL whatever type it claims, and the bare base64 an older Aventuras kept', () => {
    expect(decodePortrait(`data:image/png;base64,${base64}`)).toEqual(png);
    // The label is not read: Aventuras calls everything `image/png`.
    expect(decodePortrait(`data:image/jpeg;base64,${base64}`)).toEqual(png);
    expect(decodePortrait(`DATA:image/png;charset=x;BASE64,${base64}`)).toEqual(png);
    expect(decodePortrait(base64)).toEqual(png);
    expect(decodePortrait(`  ${base64}\n`)).toEqual(png);
  });

  it('has none for a link, a data URL that is not base64, or nothing', () => {
    expect(decodePortrait('https://images.example.invalid/face.png')).toBeNull();
    expect(decodePortrait('data:image/svg+xml,%3Csvg%3E%3C/svg%3E')).toBeNull();
    expect(decodePortrait('data:image/png;base64')).toBeNull();
    expect(decodePortrait('data:image/png;base64,')).toBeNull();
  });
});

describe('the reader, with its rows as candidates', () => {
  let root: string;
  let layout: Layout;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'se-aventuras-characters-'));
    layout = new Layout(join(root, 'data'));
    await mkdir(layout.dataRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function itemsOf(
    options: AventurasDbOptions,
    maxPortraitBytes?: number,
  ): Promise<SourceItem[]> {
    const reader = new AventurasReader(
      new MemoryFileSource({ 'aventura.db': await aventurasDatabaseBytes(options) }),
      layout,
      maxPortraitBytes === undefined ? {} : { maxPortraitBytes },
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

  it('offers one candidate per row, keyed by the row, with the portrait beside it and not in it', async () => {
    // The characters alone: the vault's lorebooks are candidates too since
    // P13.4, and come first (`vault-lorebook.test.ts`); its scenarios since
    // P13.5, and come after (`vault-scenario.test.ts`).
    const candidates = candidatesIn(await itemsOf({})).filter(
      (one) => one.format === 'aventuras.vault-character',
    );

    // By name, so a review of a vault reads as a list.
    expect(candidates.map((one) => one.source)).toEqual([INES, MARA, DOCKMASTER].map(sourceOf));
    const ines = candidates[0]!;
    // A row's own format since P13.5, not the file's: a row's link resolves.
    expect(ines.format).toBe('aventuras.vault-character');
    expect(Object.keys(ines.payload as object)).not.toContain('portrait');
    const key = `${sourceOf(INES)}/portrait`;
    expect(ines.assets).toEqual([key]);
    expect(ines.inline?.get(key)).toEqual(FIXTURE_PORTRAITS.png);
    // No portrait, nothing beside it, and nothing to say.
    const mara = candidates[1]!;
    expect(mara.assets).toBeUndefined();
    expect(mara.inline).toBeUndefined();
    expect(mara.notes).toBeUndefined();
  });

  it('leaves a portrait past the bound in the database, and says so', async () => {
    // A bound smaller than the fixture's pictures stands in for a portrait of
    // hundreds of megabytes, which is the case and is not worth building.
    const candidates = candidatesIn(await itemsOf({}, 8));
    const ines = candidates.find((one) => one.source === sourceOf(INES));

    expect(ines?.inline).toBeUndefined();
    expect(ines?.assets).toBeUndefined();
    expect(ines?.notes).toEqual([
      {
        key: 'import.aventuras.portraitTooLarge',
        params: { actor: 'Ines Vaur', limit: 0 },
        level: 'warn',
      },
    ]);
  });

  it('names a row with no id by its place, and converts it not', async () => {
    const items = await itemsOf({ extraCharacters: AWKWARD_CHARACTERS });
    const unkeyed = items.filter(
      (item) =>
        item.outcome === 'observed' &&
        item.report.source.startsWith('aventura.db/character_vault#'),
    );

    expect(unkeyed).toHaveLength(1);
    expect(unkeyed[0]).toMatchObject({
      outcome: 'observed',
      report: {
        disposition: 'unrecognised',
        notes: [{ key: 'import.row.unreadable', params: { table: 'character_vault' } }],
      },
    });
    // Every other row is a candidate, so the rows under the table's name are
    // its whole count.
    const underTable = items.filter((item) =>
      (item.outcome === 'candidate' ? item.candidate.source : item.report.source).startsWith(
        'aventura.db/character_vault',
      ),
    );
    expect(underTable).toHaveLength(VAULT_CHARACTERS.length + AWKWARD_CHARACTERS.length);
  });
});

/**
 * ***A sweep of a whole database, read back off disk*** — the stage's
 * critical-list row 3 as far as a fixture can take it: the PNG is the card,
 * the JPEG is its source image, and the second sweep changes nothing.
 */
describe('a sweep of an Aventuras vault', () => {
  let server: TestServer;
  let root: string;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
    root = await mkdtemp(join(tmpdir(), 'se-aventuras-vault-'));
  });

  afterEach(async () => {
    await server.dispose();
    await rm(root, { recursive: true, force: true });
  });

  /** A config directory holding the database, written once and swept as often as a test likes. */
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
      files: opened.source,
      ...(onConflict === undefined ? {} : { onConflict }),
    });
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
    return outcome.report;
  }

  function item(report: ImportReport, row: Readonly<Record<string, unknown>>): ImportItemReport {
    const found = report.items.find((one) => one.source === sourceOf(row));
    if (found === undefined) throw new Error(`no row for ${sourceOf(row)}`);
    return found;
  }

  /** The stored actor and its card, as they are on disk. */
  async function stored(id: string | undefined): Promise<{ actor: Actor; card: Uint8Array }> {
    const row = read(server.services.library, 'ned', id ?? '', ACTOR_SCHEMA);
    return { actor: row.body as Actor, card: new Uint8Array(await readFile(row.path)) };
  }

  const summaryOf = (actor: Actor): string | undefined =>
    actor.profile.sections.find((section) => section.id === CONVENTIONAL_SECTION_IDS.summary)?.body;

  it('makes one actor per vault character, with what the vault said about each', async () => {
    const report = await swept(await install());

    // With the scenarios' npcs beside them since P13.5, each an actor too.
    expect((await ownObjects(server, 'actors')).objects).toHaveLength(
      VAULT_CHARACTERS.length + VAULT_SCENARIO_NPCS,
    );
    const ines = await stored(item(report, INES).objectId);
    expect(ines.actor.name).toBe('Ines Vaur');
    expect(summaryOf(ines.actor)).toBe(INES['description']);
    expect(ines.actor.profile.traits).toEqual(['patient', 'unbribable']);
    expect(ines.actor.tags).toEqual(['noir']);
    expect(ines.actor.profile.visual).toEqual({
      hair: 'cropped grey',
      eyes: 'green, tired',
      clothing: 'an oilskin coat',
    });
    // §1.5: the row is the identity, and the key re-import turns on.
    expect(ines.actor.provenance.source).toBe('import');
    expect(ines.actor.provenance.originalFilename).toBe(sourceOf(INES));

    const dockmaster = await stored(item(report, DOCKMASTER).objectId);
    expect(dockmaster.actor.profile.traits).toEqual(['affable', 'incurious']);
    expect(dockmaster.actor.tags).toEqual(['noir', 'quiet']);
    expect(dockmaster.actor.profile.visual).toEqual({
      build: 'broad, slow',
      accessories: 'a brass stamp on a chain',
    });
  });

  it('repairs the legacy string-array descriptors on the way in', async () => {
    const report = await swept(await install(AVENTURAS_DB_VARIANTS.legacy));

    expect((await stored(item(report, INES).objectId)).actor.profile.visual).toEqual({
      hair: 'cropped grey',
      eyes: 'green, tired',
      clothing: 'an oilskin coat',
    });
    expect((await stored(item(report, DOCKMASTER).objectId)).actor.profile.visual).toEqual({
      build: 'broad, slow',
      accessories: 'a brass stamp',
    });
    // An empty legacy array is no descriptors, not a refusal.
    expect(item(report, MARA).disposition).toBe('converted');
    expect((await stored(item(report, MARA).objectId)).actor.profile.visual).toBeNull();
  });

  it('makes a PNG portrait the card’s own pixels', async () => {
    const report = await swept(await install());
    const { card } = await stored(item(report, INES).objectId);

    expect(pixelBytes(card)).toEqual(pixelBytes(FIXTURE_PORTRAITS.png));
    expect(keys(item(report, INES).notes)).not.toContain('import.card.portraitUnreadable');
  });

  it('keeps a JPEG portrait as the portrait’s source, on a blank card, and says so', async () => {
    const report = await swept(await install());
    const row = item(report, DOCKMASTER);
    const { actor, card } = await stored(row.objectId);

    // The card itself is the blank one: a card's image has to be a PNG.
    expect(pixelBytes(card)).toEqual(pixelBytes(blankCardPixels()));
    const source = actor.media.filter((media) => media.role === 'portrait-source');
    expect(source).toHaveLength(1);
    expect(source[0]).toMatchObject({
      mime: 'image/jpeg',
      bytes: FIXTURE_PORTRAITS.jpeg.byteLength,
    });
    // And the bytes are in the card, where the row says they are.
    const { blobs } = pngCardCodec.read(card);
    expect(blobs.get(source[0]!.ref)).toEqual(FIXTURE_PORTRAITS.jpeg);
    // Which the library serves as the picture it is.
    const served = await server.request({
      method: 'GET',
      url: `/api/library/actors/${actor.id}/media/${source[0]!.id}`,
    });
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');

    expect(row.notes).toContainEqual({
      key: 'import.card.portraitAsSource',
      params: { actor: 'The Dockmaster', format: 'JPEG' },
      level: 'info',
    });
    expect(keys(row.notes)).not.toContain('import.card.portraitUnreadable');
  });

  it('imports a character with no portrait portraitless, and says nothing about it', async () => {
    const report = await swept(await install());
    const row = item(report, MARA);
    const { actor, card } = await stored(row.objectId);

    expect(row.disposition).toBe('converted');
    expect(row.notes.filter((note) => note.level === 'warn')).toEqual([]);
    expect(actor.media).toEqual([]);
    expect(pixelBytes(card)).toEqual(pixelBytes(blankCardPixels()));
  });

  it('never says the portrait was not carried, about any row', async () => {
    const report = await swept(await install({ extraCharacters: AWKWARD_CHARACTERS }));

    const all = report.items.flatMap((one) => keys(one.notes));
    expect(all).not.toContain('import.aventuras.portraitNotCarried');
  });

  it('links the character to the lorebook its row names, and keeps the row’s own link', async () => {
    const report = await swept(await install());
    const { actor } = await stored(item(report, INES).objectId);
    const book = report.items.find(
      (one) => one.source === `aventura.db/lorebook_vault/${LOREBOOK_IDS.harbour}`,
    );

    // P13.5 (§1.7): the Aventuras id became the book it made here.
    expect(book?.objectId).toBeDefined();
    expect(actor.lore).toEqual([{ id: book?.objectId, name: 'Ash Harbour' }]);
    expect(keys(item(report, INES).notes)).not.toContain('import.aventuras.linkedLorebookMissing');
    // And the vault's own words stay where they were, verbatim.
    expect(actor.compat).toMatchObject({ metadata: { linkedLorebookId: LOREBOOK_IDS.harbour } });
  });

  describe('the rows it reads around', () => {
    const awkward = (name: string): Readonly<Record<string, unknown>> => {
      const found = AWKWARD_CHARACTERS.find((row) => row['name'] === name);
      if (found === undefined) throw new Error(`no awkward row called ${name}`);
      return found;
    };

    it('warns about a portrait that is not a picture, and imports the character without it', async () => {
      const report = await swept(await install({ extraCharacters: AWKWARD_CHARACTERS }));

      for (const name of ['Corrupt Portrait', 'Cut Short', 'Linked Face']) {
        const row = item(report, awkward(name));
        expect(row.disposition, name).toBe('converted');
        expect(
          row.notes.filter((note) => note.key === 'import.card.portraitUnreadable'),
          name,
        ).toEqual([
          expect.objectContaining({
            level: 'warn',
            params: expect.objectContaining({ actor: name }) as unknown,
          }),
        ]);
        const { actor, card } = await stored(row.objectId);
        expect(actor.media, name).toEqual([]);
        expect(pixelBytes(card), name).toEqual(pixelBytes(blankCardPixels()));
      }
    });

    it('reads the bare base64 an older Aventuras kept as the portrait it is', async () => {
      const report = await swept(await install({ extraCharacters: AWKWARD_CHARACTERS }));
      const { card } = await stored(item(report, awkward('Bare Base64')).objectId);

      expect(pixelBytes(card)).toEqual(pixelBytes(FIXTURE_PORTRAITS.bare));
    });

    it('believes the bytes over the data URL’s label', async () => {
      const report = await swept(await install({ extraCharacters: AWKWARD_CHARACTERS }));
      const row = item(report, awkward('Mislabelled WebP'));
      const { actor } = await stored(row.objectId);

      expect(actor.media).toEqual([
        expect.objectContaining({ role: 'portrait-source', mime: 'image/webp' }),
      ]);
      expect(row.notes).toContainEqual(
        expect.objectContaining({
          key: 'import.card.portraitAsSource',
          params: expect.objectContaining({ format: 'WebP' }) as unknown,
        }),
      );
    });

    it('imports a character whose JSON columns will not read, and names each column', async () => {
      const report = await swept(await install({ extraCharacters: AWKWARD_CHARACTERS }));
      const row = item(report, awkward('Broken Columns'));
      const { actor } = await stored(row.objectId);

      expect(row.disposition).toBe('converted');
      expect(
        row.notes
          .filter((note) => note.key === 'import.aventuras.columnUnreadable')
          .map((note) => note.params['column']),
      ).toEqual(['traits', 'visual_descriptors', 'tags', 'metadata']);
      expect(actor.profile.traits).toEqual([]);
      expect(actor.tags).toEqual([]);
      expect(summaryOf(actor)).toBe(awkward('Broken Columns')['description']);
    });
  });

  it('reports every character unchanged on a second sweep, and writes nothing', async () => {
    const directory = await install({ extraCharacters: AWKWARD_CHARACTERS });
    const first = await swept(directory);
    const before = await ownObjects(server, 'actors');

    const second = await swept(directory);

    const characters = (report: ImportReport): ImportItemReport[] =>
      report.items.filter((one) => one.source.startsWith('aventura.db/character_vault/'));
    expect(characters(second)).toHaveLength(characters(first).length);
    for (const row of characters(second)) {
      expect(row.disposition, row.source).toBe('unchanged');
      expect(keys(row.notes), row.source).toContain('import.object.unchanged');
    }
    // The same objects, named by the ids they were stored under.
    expect(characters(second).map((row) => row.objectId)).toEqual(
      characters(first).map((row) => row.objectId),
    );
    expect(second.counts.converted).toBe(0);
    expect((await ownObjects(server, 'actors')).objects).toEqual(before.objects);
  });

  describe('a character edited here, then swept again', () => {
    async function editedInes(directory: string): Promise<{ id: string; report: ImportReport }> {
      const report = await swept(directory);
      const id = item(report, INES).objectId ?? '';
      const current = read(server.services.library, 'ned', id, ACTOR_SCHEMA);
      const actor = structuredClone(current.body) as Actor;
      actor.profile.traits = ['changed her mind'];
      await update(server.services.library, 'ned', id, actor, current.contentHash);
      return { id, report };
    }

    it('is replaced by default, with the edit kept in its history', async () => {
      const directory = await install();
      const { id } = await editedInes(directory);

      const again = await swept(directory, 'replace');

      const row = item(again, INES);
      expect(row.disposition).toBe('converted');
      expect(keys(row.notes)).toContain('import.object.replaced');
      expect(row.objectId).toBe(id);
      const { actor, card } = await stored(id);
      expect(actor.profile.traits).toEqual(['patient', 'unbribable']);
      // The replace keeps the card on disk, which is the portrait.
      expect(pixelBytes(card)).toEqual(pixelBytes(FIXTURE_PORTRAITS.png));
      const history = await server.request({
        method: 'GET',
        url: `/api/library/actors/${id}/history`,
      });
      expect(history.status).toBe(200);
      const versions = (history.body as { versions: { source: { kind: string } }[] }).versions;
      expect(versions.some((version) => version.source.kind === 'import')).toBe(true);
    });

    it('is left alone under skip, and the difference said', async () => {
      const directory = await install();
      const { id } = await editedInes(directory);

      const again = await swept(directory, 'skip');

      const row = item(again, INES);
      expect(row.disposition).toBe('unchanged');
      expect(keys(row.notes)).toContain('import.object.differsAndKept');
      expect((await stored(id)).actor.profile.traits).toEqual(['changed her mind']);
    });

    it('is kept beside a second copy under keep-both, which has the portrait too', async () => {
      const directory = await install();
      const { id } = await editedInes(directory);

      const again = await swept(directory, 'keep-both');

      const row = item(again, INES);
      expect(row.disposition).toBe('converted');
      expect(keys(row.notes)).toContain('import.object.keptBoth');
      expect(row.objectId).not.toBe(id);
      expect((await stored(id)).actor.profile.traits).toEqual(['changed her mind']);
      const copy = await stored(row.objectId);
      expect(copy.actor.profile.traits).toEqual(['patient', 'unbribable']);
      expect(pixelBytes(copy.card)).toEqual(pixelBytes(FIXTURE_PORTRAITS.png));
      expect((await ownObjects(server, 'actors')).objects).toHaveLength(
        VAULT_CHARACTERS.length + VAULT_SCENARIO_NPCS + 1,
      );
    });

    it('keeps a JPEG source resolvable through a replace', async () => {
      const directory = await install();
      const first = await swept(directory);
      const id = item(first, DOCKMASTER).objectId ?? '';
      const current = read(server.services.library, 'ned', id, ACTOR_SCHEMA);
      const edited = structuredClone(current.body) as Actor;
      edited.tags = ['edited'];
      await update(server.services.library, 'ned', id, edited, current.contentHash);

      const again = await swept(directory, 'replace');

      expect(item(again, DOCKMASTER).objectId).toBe(id);
      const { actor, card } = await stored(id);
      const source = actor.media.find((media) => media.role === 'portrait-source');
      expect(pngCardCodec.read(card).blobs.get(source?.ref ?? '')).toEqual(FIXTURE_PORTRAITS.jpeg);
    });
  });
});
