// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ACTOR_SCHEMA,
  LOREBOOK_SCHEMA,
  TREATMENT_SCHEMA,
  type Actor,
  type ImportDestination,
  type ImportItemReport,
  type ImportNote,
  type ImportReport,
  type Lorebook,
  type Treatment,
} from '@storyengine/shared';

import { read, update } from '../../library.js';
import { Layout } from '../../storage/layout.js';
import { openLocalSource } from '../../storage/local-source.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../../test-server.js';
import {
  aventurasDatabaseBytes,
  AWKWARD_LOREBOOKS,
  AWKWARD_SCENARIOS,
  LOREBOOK_IDS,
  VAULT_CHARACTERS,
  VAULT_LOREBOOKS,
  VAULT_SCENARIO_NPCS,
  VAULT_SCENARIOS,
  writeAventurasDatabase,
  type AventurasDbOptions,
  type FixtureRow,
} from '../fixtures/test-aventuras-db.js';
import type { ConflictPolicy } from '../identity.js';
import { MemoryFileSource } from '../memory-source.js';
import type { ImportCandidate, SourceItem } from '../source.js';
import { sweep } from '../sweep.js';
import { AventurasReader } from './reader.js';
import { convertScenario } from './scenario.js';
import { mapVaultScenario, UNTITLED_SCENARIO } from './vault-scenario.js';

/**
 * ***Vault scenarios, and the links*** —
 * [P13.5](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The layers P13.3 and P13.4 were tested in: the port of Aventuras' row mapper
 * as a pure function; the reader, which turns rows into candidates or refuses
 * them; and sweeps of a whole database into a real library, read back off
 * disk. Then §1.7's links, which are the Writer's: a character's and a
 * scenario's `linkedLorebookId` resolved to the book that row became — on a
 * first sweep, on a re-sweep, under `skip` and `keep-both`, and when the book
 * is not there or was refused.
 */

const HARBOUR = VAULT_SCENARIOS[0]!;
const SALT_ROAD = VAULT_SCENARIOS[1]!;
const INES = VAULT_CHARACTERS[0]!;
const HARBOUR_BOOK = VAULT_LOREBOOKS[0]!;

const awkward = (name: string): FixtureRow => {
  const found = AWKWARD_SCENARIOS.find((row) => row['name'] === name && row['id'] !== null);
  if (found === undefined) throw new Error(`no awkward scenario called ${name}`);
  return found;
};

const sourceOf = (row: FixtureRow, table = 'scenario_vault'): string =>
  `aventura.db/${table}/${String(row['id'])}`;

const keys = (notes: readonly ImportNote[]): string[] => notes.map((note) => note.key);

const MISSING = 'import.aventuras.linkedLorebookMissing';

describe('a row, as the mapper would hand it on', () => {
  const row = {
    id: 's-1',
    name: 'Ash Harbour',
    description: 'A port.',
    setting_seed: 'It rains.',
    npcs: '[{"name":"Ines Vaur","role":"Inspector","description":"","relationship":"","traits":[]}]',
    primary_character_name: 'Ines Vaur',
    first_message: 'The rain finds you.',
    alternate_greetings: '["The gate is shut."]',
    starting_time: '{"years":0,"days":11,"hours":21,"minutes":40}',
    tags: '["noir"]',
    favorite: 1n,
    source: null,
    original_filename: 'ash-harbour.png',
    metadata: '{"linkedLorebookId":"b-1"}',
    created_at: 1_758_000_000_000n,
    updated_at: 1_758_600_000_000n,
  };

  it('is the camelCase object, with its JSON columns parsed and its flag a flag', () => {
    const notes: ImportNote[] = [];

    expect(mapVaultScenario(row, 's-1', notes)).toEqual({
      id: 's-1',
      name: 'Ash Harbour',
      description: 'A port.',
      settingSeed: 'It rains.',
      npcs: [
        { name: 'Ines Vaur', role: 'Inspector', description: '', relationship: '', traits: [] },
      ],
      primaryCharacterName: 'Ines Vaur',
      firstMessage: 'The rain finds you.',
      alternateGreetings: ['The gate is shut.'],
      startingTime: { years: 0, days: 11, hours: 21, minutes: 40 },
      tags: ['noir'],
      favorite: true,
      // This mapper's `row.source || 'import'`.
      source: 'import',
      originalFilename: 'ash-harbour.png',
      metadata: { linkedLorebookId: 'b-1' },
      createdAt: 1_758_000_000_000,
      updatedAt: 1_758_600_000_000,
    });
    expect(notes).toEqual([]);
  });

  it('reads a starting time a database before 039 never had as none, and says nothing', () => {
    const notes: ImportNote[] = [];
    const before039: Record<string, SQLOutputValue | undefined> = { ...row };
    delete before039['starting_time'];

    expect(mapVaultScenario(before039, 's-1', notes).startingTime).toBeNull();
    expect(notes).toEqual([]);
  });

  it('reads empty columns as absent, as the mapper’s truthiness does', () => {
    const notes: ImportNote[] = [];
    const mapped = mapVaultScenario(
      {
        ...row,
        npcs: '',
        alternate_greetings: null,
        starting_time: '',
        tags: null,
        metadata: null,
        setting_seed: null,
        primary_character_name: null,
      },
      's-1',
      notes,
    );

    expect(mapped).toMatchObject({
      npcs: [],
      alternateGreetings: [],
      startingTime: null,
      tags: [],
      metadata: null,
      // `NOT NULL` in Aventuras, and read as empty rather than handed on as
      // `null`, so the converter refuses it as what it is (the file header).
      settingSeed: '',
      primaryCharacterName: '',
    });
    expect(notes).toEqual([]);
  });

  it('names every column that will not read, or is not a list, and not only the first', () => {
    const notes: ImportNote[] = [];
    mapVaultScenario(
      {
        ...row,
        npcs: '{"name": "Ines"}',
        alternate_greetings: '[',
        starting_time: '{oops',
        tags: '"noir"',
        metadata: '{',
      },
      's-1',
      notes,
    );

    expect(notes.map((note) => note.params['column'])).toEqual([
      'npcs',
      'alternate_greetings',
      'starting_time',
      'tags',
      'metadata',
    ]);
    expect(new Set(keys(notes))).toEqual(new Set(['import.aventuras.columnUnreadable']));
  });
});

describe('the scenario converter, told the caller resolves the link', () => {
  const scenario = {
    name: 'Ash Harbour',
    settingSeed: 'It rains.',
    npcs: [],
    metadata: { linkedLorebookId: 'b-1' },
  };

  it('says nothing about the link, where a file still says it cannot follow it', () => {
    const asRow = convertScenario(scenario, UNTITLED_SCENARIO, 'treatment', {
      resolvesLinks: true,
    });
    const asFile = convertScenario(scenario, 'ash-harbour');

    expect(asRow.ok && keys(asRow.value.notes)).not.toContain(MISSING);
    expect(asFile.ok && keys(asFile.value.notes)).toContain(MISSING);
  });
});

describe('the reader, with its scenarios as candidates', () => {
  let root: string;
  let layout: Layout;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'se-aventuras-scenarios-'));
    layout = new Layout(join(root, 'data'));
    await mkdir(layout.dataRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function readerFor(options: AventurasDbOptions): Promise<AventurasReader> {
    return new AventurasReader(
      new MemoryFileSource({ 'aventura.db': await aventurasDatabaseBytes(options) }),
      layout,
    );
  }

  async function itemsOf(options: AventurasDbOptions): Promise<SourceItem[]> {
    const reader = await readerFor(options);
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

  const observed = (items: readonly SourceItem[], source: string): ImportItemReport => {
    for (const item of items) {
      if (item.outcome === 'observed' && item.report.source === source) return item.report;
    }
    throw new Error(`no observed row for ${source}`);
  };

  it('offers one candidate per row, keyed by the row, after every book and character', async () => {
    const candidates = candidatesIn(await itemsOf({}));
    const formats = candidates.map((one) => one.format);

    expect(
      candidates
        .filter((one) => one.format === 'aventuras.vault-scenario')
        .map((one) => one.source),
    ).toEqual([HARBOUR, SALT_ROAD].map((one) => sourceOf(one)));
    // §1.7's order: lorebooks, characters, scenarios — the tags join at P13.6.
    expect(formats.lastIndexOf('aventuras.vault-lorebook')).toBeLessThan(
      formats.indexOf('aventuras.vault-character'),
    );
    expect(formats.lastIndexOf('aventuras.vault-character')).toBeLessThan(
      formats.indexOf('aventuras.vault-scenario'),
    );
    const harbour = candidates.find((one) => one.source === sourceOf(HARBOUR))!;
    expect(harbour.notes).toBeUndefined();
    // The link is carried as the mapper leaves it; the Writer resolves it.
    expect(harbour.payload).toMatchObject({
      name: 'Ash Harbour',
      metadata: { linkedLorebookId: LOREBOOK_IDS.harbour },
      startingTime: { years: 0, days: 11, hours: 21, minutes: 40 },
    });
  });

  it('refuses a row whose cast, openings or metadata will not read, naming every bad column', async () => {
    const items = await itemsOf({ extraScenarios: AWKWARD_SCENARIOS });
    const refused: [string, string[]][] = [
      ['Torn Cast', ['npcs', 'tags']],
      ['Cast Not A List', ['npcs']],
      ['Torn Openings', ['alternate_greetings']],
      ['Torn Metadata', ['metadata']],
    ];

    for (const [name, columns] of refused) {
      const report = observed(items, sourceOf(awkward(name)));
      expect(report.disposition, name).toBe('unrecognised');
      expect(report.objectId, name).toBeUndefined();
      expect(
        report.notes.map((note) => [note.key, note.params['column']]),
        name,
      ).toEqual(columns.map((column) => ['import.aventuras.columnUnreadable', column]));
    }
    const candidates = candidatesIn(items).map((one) => one.source);
    for (const [name] of refused) expect(candidates).not.toContain(sourceOf(awkward(name)));
  });

  it('reads around tags and a starting time that will not read, and says so', async () => {
    const candidate = candidatesIn(await itemsOf({ extraScenarios: AWKWARD_SCENARIOS })).find(
      (one) => one.source === sourceOf(awkward('Loose Ends')),
    );

    expect(candidate?.notes?.map((note) => note.params['column'])).toEqual([
      'starting_time',
      'tags',
    ]);
    expect(candidate?.payload).toMatchObject({ tags: [], startingTime: null });
  });

  it('names a row with no id by its place, and every row is an item under the table', async () => {
    const items = await itemsOf({ extraScenarios: AWKWARD_SCENARIOS });
    const unkeyed = items.filter(
      (item) =>
        item.outcome === 'observed' && item.report.source.startsWith('aventura.db/scenario_vault#'),
    );

    expect(unkeyed).toHaveLength(1);
    expect(unkeyed[0]).toMatchObject({
      report: {
        disposition: 'unrecognised',
        notes: [{ key: 'import.row.unreadable', params: { table: 'scenario_vault' } }],
      },
    });
    const underTable = items.filter((item) =>
      (item.outcome === 'candidate' ? item.candidate.source : item.report.source).startsWith(
        'aventura.db/scenario_vault',
      ),
    );
    expect(underTable).toHaveLength(VAULT_SCENARIOS.length + AWKWARD_SCENARIOS.length);
  });

  it('reads a database from before the starting time, with none', async () => {
    // 038: every scenario column but the one 039 added.
    const candidates = candidatesIn(await itemsOf({ version: 38 })).filter(
      (one) => one.format === 'aventuras.vault-scenario',
    );

    expect(candidates).toHaveLength(VAULT_SCENARIOS.length);
    for (const candidate of candidates) {
      expect(candidate.notes, candidate.source).toBeUndefined();
      expect(candidate.payload, candidate.source).toMatchObject({ startingTime: null });
    }
  });

  it('refuses a database missing a scenario column it reads, before reading anything', async () => {
    const reader = await readerFor({ omitColumns: { scenario_vault: ['npcs'] } });
    try {
      expect(await reader.survey()).toMatchObject({ ok: false, refusal: 'unknown-format' });
    } finally {
      await reader.close();
    }
  });

  it('reads a database from before the scenario vault, with no scenarios', async () => {
    // 017: the lorebook vault and not yet the scenario one.
    const candidates = candidatesIn(await itemsOf({ version: 17 }));

    expect(candidates.filter((one) => one.format === 'aventuras.vault-scenario')).toEqual([]);
  });
});

/** A sweep of a whole database, read back off disk. */
describe('a sweep of an Aventuras vault’s scenarios', () => {
  let server: TestServer;
  let root: string;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
    root = await mkdtemp(join(tmpdir(), 'se-aventuras-vault-scenarios-'));
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

  async function swept(
    directory: string,
    onConflict?: ConflictPolicy,
    destination?: ImportDestination,
  ): Promise<ImportReport> {
    const opened = await openLocalSource(directory, server.dataDir);
    if (!opened.ok) throw new Error(`could not open ${directory}: ${opened.refusal}`);
    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      tags: server.services.tags,
      files: opened.source,
      ...(onConflict === undefined ? {} : { onConflict }),
      ...(destination === undefined ? {} : { destination }),
    });
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
    return outcome.report;
  }

  function item(report: ImportReport, source: string): ImportItemReport {
    const found = report.items.find((one) => one.source === source);
    if (found === undefined) throw new Error(`no row for ${source}`);
    return found;
  }

  const treatment = (id: string | undefined): Treatment =>
    read(server.services.library, 'ned', id ?? '', TREATMENT_SCHEMA).body as Treatment;
  const actor = (id: string | undefined): Actor =>
    read(server.services.library, 'ned', id ?? '', ACTOR_SCHEMA).body as Actor;

  /** The book the fixture's scenario and character both link to, as this sweep stored it. */
  const harbourBook = (report: ImportReport): string | undefined =>
    item(report, sourceOf(HARBOUR_BOOK, 'lorebook_vault')).objectId;

  /** Every row of the three vault tables a sweep converts. */
  const vault = (report: ImportReport): ImportItemReport[] =>
    report.items.filter((one) =>
      /^aventura\.db\/(?:character|lorebook|scenario)_vault\//.test(one.source),
    );

  async function editHarbourBook(id: string | undefined): Promise<void> {
    const current = read(server.services.library, 'ned', id ?? '', LOREBOOK_SCHEMA);
    const book = structuredClone(current.body) as Lorebook;
    book.description = 'Edited here.';
    await update(server.services.library, 'ned', id ?? '', book, current.contentHash);
  }

  it('makes a treatment of each row, with its cast, openings and the vault’s own facts', async () => {
    const report = await swept(await install());
    const row = item(report, sourceOf(HARBOUR));

    expect(row.disposition).toBe('converted');
    expect(row.alsoProduced).toHaveLength(2);
    const stored = treatment(row.objectId);
    expect(stored).toMatchObject({
      name: 'Ash Harbour',
      blurb: HARBOUR['description'],
      framing: HARBOUR['setting_seed'],
      tags: ['noir'],
    });
    expect(stored.openings.written.map((opening) => opening.text)).toEqual([
      'The rain finds your collar before the gatehouse does.',
      'The gate is shut, and the light in the office is on.',
    ]);
    expect(stored.cast.map((member) => [member.ref.name, member.billing, member.note])).toEqual([
      ['Ines Vaur', 'npc', 'Lead. Dock inspector — Wary of you, and not yet against you'],
      ['The Dockmaster', 'npc', 'Runs the gate — Owes you a favour he has forgotten'],
    ]);
    // `starting_time` rides in metadata, as the converter carries anything it
    // does not read; `id`, `favorite` and the timestamps do not.
    expect(stored.metadata).toEqual({
      startingTime: { years: 0, days: 11, hours: 21, minutes: 40 },
      source: 'import',
      originalFilename: 'ash-harbour.png',
      metadata: {
        cardVersion: 'chara_card_v2',
        npcCount: 2,
        linkedLorebookId: LOREBOOK_IDS.harbour,
      },
    });
    expect(stored.provenance.originalFilename).toBe(sourceOf(HARBOUR));
    // A cast member is keyed by the row and the name, as a file's is (§1.5).
    expect(actor(row.alsoProduced?.[0]).provenance.originalFilename).toBe(
      `${sourceOf(HARBOUR)}#npc:Ines Vaur`,
    );

    const salt = treatment(item(report, sourceOf(SALT_ROAD)).objectId);
    expect(salt.cast).toEqual([]);
    expect(salt.lore).toEqual([]);
    expect(salt.metadata).toMatchObject({ startingTime: null, source: 'wizard' });
    expect((await ownObjects(server, 'treatments')).objects).toHaveLength(VAULT_SCENARIOS.length);
  });

  it('links the scenario and the character to the book their rows name, and says nothing', async () => {
    const report = await swept(await install());
    const book = harbourBook(report);
    const scenario = item(report, sourceOf(HARBOUR));
    const ines = item(report, sourceOf(INES, 'character_vault'));

    expect(book).toBeDefined();
    expect(treatment(scenario.objectId).lore).toEqual([
      { ref: { id: book, name: 'Ash Harbour' }, required: false },
    ]);
    expect(actor(ines.objectId).lore).toEqual([{ id: book, name: 'Ash Harbour' }]);
    expect(report.items.flatMap((one) => keys(one.notes))).not.toContain(MISSING);
  });

  it('says a link is missing when it names a book the database does not hold', async () => {
    const lost = {
      ...VAULT_CHARACTERS[2]!,
      id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f80c1',
      name: 'Lost Link',
      metadata: { linkedLorebookId: 'no-such-book' },
    };
    const report = await swept(
      await install({ extraScenarios: AWKWARD_SCENARIOS, extraCharacters: [lost] }),
    );

    const scenario = item(report, sourceOf(awkward('Lost Link')));
    expect(scenario.disposition).toBe('converted');
    expect(scenario.notes).toContainEqual({ key: MISSING, params: {}, level: 'warn' });
    expect(treatment(scenario.objectId).lore).toEqual([]);

    const character = item(report, sourceOf(lost, 'character_vault'));
    expect(character.disposition).toBe('converted');
    expect(character.notes).toContainEqual({ key: MISSING, params: {}, level: 'warn' });
    expect(actor(character.objectId).lore).toEqual([]);

    // Once each, on the rows whose links went nowhere, and on no other.
    const missing = report.items.filter((one) => keys(one.notes).includes(MISSING));
    expect(missing.map((one) => one.source).sort()).toEqual(
      [
        sourceOf(lost, 'character_vault'),
        sourceOf(awkward('Lost Link')),
        sourceOf(awkward('Torn Link')),
      ].sort(),
    );
  });

  it('says a link is missing when the book it names was refused, and nothing is here from before', async () => {
    const report = await swept(
      await install({ extraScenarios: AWKWARD_SCENARIOS, extraLorebooks: AWKWARD_LOREBOOKS }),
    );

    // *Torn Pages*, whose entries will not read: refused, and written nowhere.
    const torn = AWKWARD_LOREBOOKS.find((row) => row['name'] === 'Torn Pages')!;
    expect(item(report, sourceOf(torn, 'lorebook_vault')).disposition).toBe('unrecognised');
    const scenario = item(report, sourceOf(awkward('Torn Link')));
    expect(scenario.disposition).toBe('converted');
    expect(scenario.notes).toContainEqual({ key: MISSING, params: {}, level: 'warn' });
    expect(treatment(scenario.objectId).lore).toEqual([]);
  });

  it('keeps the link to a book imported earlier whose entries have since gone bad', async () => {
    const directory = await install();
    const first = await swept(directory);
    const book = harbourBook(first);

    // The book's row, unreadable now: refused, and the book here left whole.
    const db = new DatabaseSync(join(directory, 'aventura.db'));
    try {
      db.prepare('update lorebook_vault set entries = ? where id = ?').run(
        '[{"name": ',
        LOREBOOK_IDS.harbour,
      );
    } finally {
      db.close();
    }

    const second = await swept(directory);

    expect(item(second, sourceOf(HARBOUR_BOOK, 'lorebook_vault')).disposition).toBe('unrecognised');
    // Under the default `replace`: still linked to the good copy, so unchanged,
    // and nothing said about a link that still works.
    for (const source of [sourceOf(HARBOUR), sourceOf(INES, 'character_vault')]) {
      const row = item(second, source);
      expect(row.disposition, source).toBe('unchanged');
      expect(keys(row.notes), source).not.toContain(MISSING);
    }
    expect(treatment(item(second, sourceOf(HARBOUR)).objectId).lore[0]?.ref.id).toBe(book);
  });

  it('refuses a row whose cast, openings or metadata will not read, and writes nothing for it', async () => {
    const report = await swept(await install({ extraScenarios: AWKWARD_SCENARIOS }));

    for (const name of ['Torn Cast', 'Cast Not A List', 'Torn Openings', 'Torn Metadata']) {
      const row = item(report, sourceOf(awkward(name)));
      expect(row.disposition, name).toBe('unrecognised');
      expect(row.objectId, name).toBeUndefined();
    }
    // And a row with no setting, by the converter's own rule for a file.
    const unset = item(report, sourceOf(awkward('No Setting')));
    expect(unset.disposition).toBe('unrecognised');
    expect(unset.notes).toContainEqual({
      key: 'import.file.refused',
      params: { file: sourceOf(awkward('No Setting')), refusal: 'missing-field' },
      level: 'warn',
    });
    const names = (await ownObjects(server, 'treatments')).objects.map((one) => one['name']);
    for (const name of ['Torn Cast', 'Cast Not A List', 'Torn Openings', 'Torn Metadata']) {
      expect(names).not.toContain(name);
    }
    expect(names).toContain('Loose Ends');
  });

  it('leaves a scenario imported earlier whole when its cast has since gone bad', async () => {
    const directory = await install();
    const first = await swept(directory);
    const id = item(first, sourceOf(HARBOUR)).objectId;
    const before = treatment(id);

    const db = new DatabaseSync(join(directory, 'aventura.db'));
    try {
      db.prepare('update scenario_vault set npcs = ? where id = ?').run(
        '[{"name": ',
        String(HARBOUR['id']),
      );
    } finally {
      db.close();
    }

    const second = await swept(directory);

    expect(item(second, sourceOf(HARBOUR)).disposition).toBe('unrecognised');
    // Under the default `replace`, and still the scenario it was.
    expect(treatment(id)).toEqual(before);
  });

  it('reports every row unchanged on a second sweep, the linked ones included', async () => {
    const lost = {
      ...VAULT_CHARACTERS[2]!,
      id: '3f6c1a2b-0c1d-4e2f-9a3b-4c5d6e7f80c1',
      name: 'Lost Link',
      metadata: { linkedLorebookId: 'no-such-book' },
    };
    const directory = await install({
      extraScenarios: AWKWARD_SCENARIOS,
      extraLorebooks: AWKWARD_LOREBOOKS,
      extraCharacters: [lost],
    });
    const first = await swept(directory);
    const before = await ownObjects(server);

    const second = await swept(directory);

    const written = (report: ImportReport): ImportItemReport[] =>
      vault(report).filter((row) => row.objectId !== undefined);
    expect(written(second).map((row) => row.source)).toEqual(
      written(first).map((row) => row.source),
    );
    for (const row of written(second)) {
      expect(row.disposition, row.source).toBe('unchanged');
      expect(keys(row.notes), row.source).toContain('import.object.unchanged');
    }
    expect(written(second).map((row) => row.objectId)).toEqual(
      written(first).map((row) => row.objectId),
    );
    expect(second.counts.converted).toBe(0);
    expect((await ownObjects(server)).objects).toEqual(before.objects);
  });

  it('still resolves the link under skip, to the book a person edited here', async () => {
    const directory = await install();
    const first = await swept(directory);
    const book = harbourBook(first);
    await editHarbourBook(book);

    const second = await swept(directory, 'skip');

    const bookRow = item(second, sourceOf(HARBOUR_BOOK, 'lorebook_vault'));
    expect(keys(bookRow.notes)).toContain('import.object.differsAndKept');
    expect(bookRow.objectId).toBe(book);
    // The book left alone is still the book the links mean.
    for (const source of [sourceOf(HARBOUR), sourceOf(INES, 'character_vault')]) {
      const row = item(second, source);
      expect(row.disposition, source).toBe('unchanged');
      expect(keys(row.notes), source).toContain('import.object.unchanged');
      expect(keys(row.notes), source).not.toContain(MISSING);
    }
  });

  it('links the copies keep-both makes to the copy of the book it made beside them', async () => {
    const directory = await install();
    const first = await swept(directory);
    const book = harbourBook(first);
    const scenario = item(first, sourceOf(HARBOUR)).objectId;
    const ines = item(first, sourceOf(INES, 'character_vault')).objectId;
    await editHarbourBook(book);

    const second = await swept(directory, 'keep-both');

    const copy = harbourBook(second);
    expect(keys(item(second, sourceOf(HARBOUR_BOOK, 'lorebook_vault')).notes)).toContain(
      'import.object.keptBoth',
    );
    expect(copy).not.toBe(book);
    // The link is to the new copy, so the scenario and the character differ,
    // and are kept beside the originals, which still link to the book here.
    const scenarioCopy = item(second, sourceOf(HARBOUR));
    expect(keys(scenarioCopy.notes)).toContain('import.object.keptBoth');
    expect(treatment(scenarioCopy.objectId).lore[0]?.ref.id).toBe(copy);
    expect(treatment(scenario).lore[0]?.ref.id).toBe(book);
    const inesCopy = item(second, sourceOf(INES, 'character_vault'));
    expect(keys(inesCopy.notes)).toContain('import.object.keptBoth');
    expect(actor(inesCopy.objectId).lore[0]?.id).toBe(copy);
    expect(actor(ines).lore[0]?.id).toBe(book);
    // A scenario whose book is not the one that moved is unchanged.
    expect(item(second, sourceOf(SALT_ROAD)).disposition).toBe('unchanged');
  });

  it('makes a lorebook of each row when asked, and says nothing of a link that resolved', async () => {
    const report = await swept(await install(), undefined, 'lorebook');
    const row = item(report, sourceOf(HARBOUR));

    const book = read(server.services.library, 'ned', row.objectId ?? '', LOREBOOK_SCHEMA)
      .body as Lorebook;
    expect(book.name).toBe('Ash Harbour');
    expect(keys(row.notes)).toContain('import.aventuras.scenarioAsLorebook');
    expect(keys(row.notes)).not.toContain(MISSING);
    // The row's own link rides in the book's metadata, verbatim.
    expect(book.metadata).toMatchObject({ metadata: { linkedLorebookId: LOREBOOK_IDS.harbour } });
    expect((await ownObjects(server, 'actors')).objects).toHaveLength(VAULT_CHARACTERS.length);
  });

  it('writes the scenarios’ casts beside the vault’s own characters', async () => {
    await swept(await install());

    expect((await ownObjects(server, 'actors')).objects).toHaveLength(
      VAULT_CHARACTERS.length + VAULT_SCENARIO_NPCS,
    );
  });
});
