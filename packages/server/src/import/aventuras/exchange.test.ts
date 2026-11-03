// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ACTOR_SCHEMA,
  CONVENTIONAL_SECTION_IDS,
  LOREBOOK_SCHEMA,
  TREATMENT_SCHEMA,
  type Actor,
  type ImportNote,
  type ImportReport,
  type Lorebook,
  type Treatment,
} from '@storyengine/shared';

import { read } from '../../library.js';
import { pixelBytes } from '../../storage/card/test-png.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import {
  aventurasExchange,
  exchangeCharacter,
  exchangeLorebook,
  exchangeScenario,
} from '../fixtures/test-aventuras.js';
import { FIXTURE_PORTRAITS } from '../fixtures/test-aventuras-db.js';
import { MemoryFileSource } from '../memory-source.js';
import type { SourceItem } from '../source.js';
import { sweep } from '../sweep.js';
import { readUpload } from '../upload.js';
import { convertCharacter } from './character.js';
import { EXCHANGE_LOREBOOK_FORMAT, readExchange } from './exchange.js';

/**
 * ***Aventuras' exchange envelope*** —
 * [P13.16](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * Three layers, as `vault-character.test.ts` has them: the read of one marked
 * document into a candidate or a refusal; the door it arrives by, at both
 * confidences, against the probes it sits above; and a sweep into a real
 * library, read back off disk, because *the portrait is carried* is a claim
 * about the card's pixels and only the card can answer it.
 */

const bytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value, null, 2));

const dataUrl = (mime: string, picture: Uint8Array): string =>
  `data:${mime};base64,${Buffer.from(picture).toString('base64')}`;

const keys = (notes: readonly ImportNote[] | undefined): string[] =>
  (notes ?? []).map((note) => note.key);

const PORTRAIT = dataUrl('image/png', FIXTURE_PORTRAITS.png);

function candidateOf(item: SourceItem) {
  if (item.outcome !== 'candidate') throw new Error(`refused: ${keys(item.report.notes).join()}`);
  return item.candidate;
}

function refusalOf(item: SourceItem): string[] {
  if (item.outcome !== 'observed') throw new Error(`read as ${item.candidate.format}`);
  expect(item.report.disposition).toBe('unrecognised');
  return keys(item.report.notes);
}

describe('a marked document, read', () => {
  it('hands a character to the character converter, its portrait beside it and not in it', () => {
    const found = candidateOf(
      readExchange('Ines Vaur.json', aventurasExchange('character', exchangeCharacter(PORTRAIT))),
    );

    expect(found.format).toBe('aventuras.character');
    expect(found.assets).toEqual(['Ines Vaur.json/portrait']);
    expect(found.inline?.get('Ines Vaur.json/portrait')).toEqual(FIXTURE_PORTRAITS.png);
    expect(found.payload).not.toHaveProperty('portrait');

    // And the converter takes it as it takes a bare vault record — saying
    // nothing about a portrait it was never handed.
    const converted = convertCharacter(found.payload, 'fallback');
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    expect(converted.value.actor.profile.visual).toEqual({
      hair: 'grey, cropped, wet',
      eyes: 'pale grey',
      distinguishing: 'a burn scar across the left hand',
    });
    expect(keys(converted.value.notes)).not.toContain('import.aventuras.portraitNotCarried');
  });

  it('defaults what Aventuras’ schema defaults, so a hand-trimmed character still reads', () => {
    // `traits` and `visualDescriptors` are optional there; `isVaultCharacter`
    // would refuse the record without them.
    const found = candidateOf(
      readExchange('Bare.json', aventurasExchange('character', { name: 'Bare' })),
    );
    expect(found.payload).toMatchObject({ traits: [], visualDescriptors: {} });
    expect(convertCharacter(found.payload, 'fallback').ok).toBe(true);
    expect(found.assets).toBeUndefined();
  });

  it('says so, and carries no portrait, for a link or a portrait past the bound', () => {
    const link = candidateOf(
      readExchange(
        'Link.json',
        aventurasExchange(
          'character',
          exchangeCharacter('https://images.example.invalid/ines.png'),
        ),
      ),
    );
    expect(link.inline).toBeUndefined();
    expect(keys(link.notes)).toEqual(['import.card.portraitUnreadable']);

    const large = candidateOf(
      readExchange('Large.json', aventurasExchange('character', exchangeCharacter(PORTRAIT)), {
        maxPortraitBytes: 8,
      }),
    );
    expect(large.inline).toBeUndefined();
    expect(keys(large.notes)).toEqual(['import.aventuras.portraitTooLarge']);
  });

  it('hands a scenario to the scenario converter and a lorebook to the vault book’s', () => {
    expect(
      candidateOf(
        readExchange('Ash Harbour.json', aventurasExchange('scenario', exchangeScenario())),
      ).format,
    ).toBe('aventuras.scenario');

    const book = candidateOf(
      readExchange('Harbour lore.json', aventurasExchange('lorebook', exchangeLorebook())),
    );
    expect(book.format).toBe(EXCHANGE_LOREBOOK_FORMAT);
    // The entry that left its injection to the schema gets the schema's.
    expect(book.payload).toMatchObject({
      entries: [{}, { injectionMode: 'keyword', priority: 100, keywords: [], aliases: [] }],
    });
  });

  it('reads a newer minor with a warning, and refuses another major or no version at all', () => {
    const newer = candidateOf(
      readExchange('Ines.json', aventurasExchange('character', exchangeCharacter(null), '1.4.0')),
    );
    expect(keys(newer.notes)).toEqual(['import.aventuras.exchangeNewerFormat']);
    expect(newer.notes?.[0]).toMatchObject({ level: 'warn', params: { version: '1.4.0' } });

    for (const version of ['2.0.0', '0.9.0', '1.0', 'one', '']) {
      expect(
        refusalOf(
          readExchange(
            'Ines.json',
            aventurasExchange('character', exchangeCharacter(null), version),
          ),
        ),
      ).toEqual(['import.aventuras.exchangeUnknownFormat']);
    }
  });

  it('refuses an entity it does not know, and a payload that is not one', () => {
    expect(refusalOf(readExchange('Story.json', aventurasExchange('story', {})))).toEqual([
      'import.aventuras.exchangeUnknownEntity',
    ]);
    expect(refusalOf(readExchange('Ines.json', aventurasExchange('character', [])))).toEqual([
      'import.aventuras.exchangeUnreadable',
    ]);
  });
});

describe('the door it arrives by', () => {
  it('is answered at either confidence: the marker is a claim, not a shape', () => {
    const file = bytes(aventurasExchange('character', exchangeCharacter(null)));
    expect(candidateOf(readUpload('Ines Vaur.json', file)).format).toBe('aventuras.character');
    expect(candidateOf(readUpload('Ines Vaur.json', file, 'high')).format).toBe(
      'aventuras.character',
    );
  });

  it('never falls through to the card probe once it is marked', () => {
    /**
     * The terminal answer Aventuras gives an invalid exchange file, held
     * against the one probe that could take it: `looksLikeCard` unwraps
     * `data`, and this `data` has a greeting in it.
     */
    const marked = aventurasExchange(
      'character',
      { name: 'Vera', description: 'x', first_mes: 'hello' },
      '2.0.0',
    );
    expect(refusalOf(readUpload('vera.json', bytes(marked)))).toEqual([
      'import.aventuras.exchangeUnknownFormat',
    ]);
  });

  it('leaves an unmarked document to the probes it always went to', () => {
    // The pre-envelope export a person may still hold, and a card with a
    // `format` of its own that is not the marker.
    expect(
      candidateOf(readUpload('Ines.json', bytes({ ...exchangeCharacter(null), traits: ['x'] })))
        .format,
    ).toBe('aventuras.character');
    const card = { format: 'something-else', name: 'Vera', first_mes: 'hello' };
    expect(candidateOf(readUpload('vera.json', bytes(card))).format).toBe('sillytavern.card');
  });
});

/**
 * ***A folder of exchange files, swept into a library and read back*** — the
 * person's case: three files out of Aventuras' vault, dropped in together.
 */
describe('a sweep of exchange files', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  async function swept(files: Record<string, unknown>): Promise<ImportReport> {
    const tree: Record<string, Uint8Array> = {};
    for (const [name, value] of Object.entries(files)) tree[name] = bytes(value);
    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      tags: server.services.tags,
      files: new MemoryFileSource(tree),
    });
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
    return outcome.report;
  }

  function objectOf(
    report: ImportReport,
    source: string,
    schema: Parameters<typeof read>[3],
  ): unknown {
    const row = report.items.find((one) => one.source === source);
    expect(row?.disposition).toBe('converted');
    return read(server.services.library, 'ned', row?.objectId ?? '', schema).body;
  }

  it('makes the character, the portrait its card, and keeps what the vault said', async () => {
    const report = await swept({
      'Ines Vaur.json': aventurasExchange('character', exchangeCharacter(PORTRAIT)),
    });
    const row = report.items.find((one) => one.source === 'Ines Vaur.json');
    const actor = objectOf(report, 'Ines Vaur.json', ACTOR_SCHEMA) as Actor;

    expect(actor.name).toBe('Ines Vaur');
    expect(
      actor.profile.sections.find((section) => section.id === CONVENTIONAL_SECTION_IDS.summary)
        ?.body,
    ).toBe('A dock inspector who notices what the manifests leave out.');
    expect(actor.profile.traits).toEqual(['patient', 'unbribable', 'tired']);
    expect(actor.tags).toEqual(['npc', 'harbour']);
    expect(actor.provenance.originalFilename).toBe('Ines Vaur.json');
    expect(keys(row?.notes)).not.toContain('import.aventuras.portraitNotCarried');
    expect(keys(row?.notes)).not.toContain('import.card.portraitUnreadable');

    const card = read(server.services.library, 'ned', actor.id, ACTOR_SCHEMA);
    const { readFile } = await import('node:fs/promises');
    expect(pixelBytes(new Uint8Array(await readFile(card.path)))).toEqual(
      pixelBytes(FIXTURE_PORTRAITS.png),
    );
  });

  it('makes the lorebook, story-side fields kept, and the scenario with its cast', async () => {
    const report = await swept({
      'Harbour lore.json': aventurasExchange('lorebook', exchangeLorebook()),
      'Ash Harbour.json': aventurasExchange('scenario', exchangeScenario()),
    });

    const book = objectOf(report, 'Harbour lore.json', LOREBOOK_SCHEMA) as Lorebook;
    expect(book.name).toBe('Harbour lore');
    expect(book.description).toBe('What the port knows about itself.');
    expect(book.tags).toEqual(['noir']);
    const [house, night] = book.entries;
    expect(house).toMatchObject({ name: 'The Customs House', tag: 'location', constant: true });
    expect(house?.metadata).toMatchObject({
      hiddenInfo: 'The ledgers in the cellar are the real ones.',
      loreManagementBlacklisted: true,
    });
    expect(night).toMatchObject({ name: 'The Night Shift', constant: false, enabled: true });

    const treatment = objectOf(report, 'Ash Harbour.json', TREATMENT_SCHEMA) as Treatment;
    expect(treatment.framing).toContain('wet for eleven days');
    expect(treatment.cast.map((member) => member.ref.name)).toEqual(['The Dockmaster']);
    expect(treatment.openings.written).toHaveLength(2);
    expect(treatment.metadata).toMatchObject({
      startingTime: { years: 0, days: 3, hours: 22, minutes: 15 },
    });
  });

  it('is unchanged the second time, by the file it came in', async () => {
    const files = { 'Ines Vaur.json': aventurasExchange('character', exchangeCharacter(PORTRAIT)) };
    await swept(files);
    const again = await swept(files);
    expect(again.items.find((one) => one.source === 'Ines Vaur.json')?.disposition).toBe(
      'unchanged',
    );
  });
});
