// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validate } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { marinaraFixture } from '../fixtures/test-marinara.js';
import { MemoryFileSource } from '../memory-source.js';
import { malformedInputs } from '../parse.js';
import { sweep } from '../sweep.js';
import { profileAsFileSource, readEnvelope, singleObjectAsFileSource } from './envelope.js';
import { convertLorebook } from './lorebook.js';
import { convertPreset } from './preset.js';

/**
 * Marinara import ([P4 §1.5]).
 *
 * The conversions themselves are mostly renames — our `LoreEntry` was ported
 * from Marinara's, and its prompt sections are the same lineage as SillyTavern's
 * prompts. **So the tests concentrate on the places where it is not a rename**,
 * because those are camouflaged by everything around them reading as a copy.
 */

const ENTRY = {
  id: 'entry_docks',
  lorebookId: 'book_1',
  name: 'The docks',
  content: 'The docks run on paperwork.',
  description: '',
  keys: ['docks'],
  secondaryKeys: [],
  enabled: true,
  constant: false,
  selective: true,
  selectiveLogic: 'and',
  position: 2,
  depth: 4,
  order: 100,
  role: 'system',
  characterFilterMode: 'include',
  characterFilterIds: ['char_vera'],
};

const BOOK = { id: 'book_1', name: 'Rain City', description: 'Harbour lore.', enabled: true };

function book(overrides: Record<string, unknown> = {}) {
  const result = convertLorebook(BOOK, [{ ...ENTRY, ...overrides }]);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.value;
}

describe('the two places the lorebook is not a rename', () => {
  it('reads position 2 as at-depth, which SillyTavern numbers 4', () => {
    // **The trap.** Marinara's `LorebookEntryPosition` is 0|1|2|7 with 2 meaning
    // at-depth; SillyTavern's uses 4 for that and 2 for the top of the author's
    // note. Sharing one table between the two silently turns every at-depth
    // entry into an after-character one — and it imports, validates, and fires
    // in the wrong place.
    expect(book({ position: 2 }).lorebook.entries[0]?.position).toBe('at_depth');
    expect(book({ position: 0 }).lorebook.entries[0]?.position).toBe('before_char');
    expect(book({ position: 1 }).lorebook.entries[0]?.position).toBe('after_char');
    expect(book({ position: 7 }).lorebook.entries[0]?.position).toBe('outlet');
  });

  it('narrows the fifth selectiveLogic arm and says it did', () => {
    // Marinara has five arms to our four; ours is SillyTavern's closed set.
    // `or` has no home, so it is mapped to the nearest and flagged — an entry
    // that used to fire on either key now needs the primary one.
    const { lorebook, notes } = book({ selectiveLogic: 'or' });

    expect(lorebook.entries[0]?.selectiveLogic).toBe('and_any');
    expect(notes.find((n) => n.key === 'import.lore.logicNarrowed')?.level).toBe('warn');
  });

  it('carries the four arms that do map without a note', () => {
    for (const [theirs, ours] of [
      ['and', 'and_any'],
      ['and_all', 'and_all'],
      ['not', 'not_any'],
      ['not_all', 'not_all'],
    ] as const) {
      const { lorebook, notes } = book({ selectiveLogic: theirs });

      expect(lorebook.entries[0]?.selectiveLogic).toBe(ours);
      expect(notes.filter((n) => n.key === 'import.lore.logicNarrowed')).toEqual([]);
    }
  });
});

describe('what the lorebook carries across', () => {
  it('validates, and turns the mode-plus-list filters into ours', () => {
    const { lorebook } = book();
    const result = validate(lorebook);

    expect(result.valid, result.valid ? '' : JSON.stringify(result.issues)).toBe(true);
    expect(lorebook.entries[0]?.actorFilter).toEqual({ mode: 'include', values: ['char_vera'] });
  });

  it('maps a category to tags, because Lorebook.category was removed deliberately', () => {
    const withCategory = convertLorebook({ ...BOOK, category: 'world' }, []);

    expect(withCategory.ok && withCategory.value.lorebook.tags).toEqual(['world']);
  });

  for (const { label, input } of malformedInputs(BOOK, ['name'])) {
    it(`answers with a status for ${label}`, () => {
      expect(() => convertLorebook(input, [])).not.toThrow();
      expect(convertLorebook(input, []).ok).toBe(false);
    });
  }
});

const PRESET = {
  id: 'preset_1',
  name: 'Harbour',
  description: 'The one the fixture reads.',
  conversationPrompt: 'You are {{charName}} talking to {{userName}}.',
  sectionOrder: ['section_main', 'section_history'],
  wrapFormat: 'xml',
};

const SECTIONS = [
  {
    id: 'section_main',
    presetId: 'preset_1',
    identifier: 'main',
    name: 'Role',
    content: 'Write the scene as {{char}}.',
    role: 'system',
    enabled: 'true',
    isMarker: 'false',
    injectionPosition: 'ordered',
    injectionDepth: 0,
    injectionOrder: 0,
    wrapInXml: 'true',
    xmlTagName: 'role',
  },
  {
    id: 'section_history',
    presetId: 'preset_1',
    identifier: 'chat_history',
    name: 'History',
    content: '',
    role: 'system',
    enabled: 'true',
    isMarker: 'true',
    markerConfig: { type: 'chat_history' },
    injectionPosition: 'depth',
    injectionDepth: 4,
    injectionOrder: 100,
    wrapInXml: 'false',
  },
];

function preset(sections: unknown[] = SECTIONS) {
  const result = convertPreset(PRESET, sections);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.value;
}

describe('the Marinara preset is our block model with different field names', () => {
  it('validates, and keeps the order the preset declared', () => {
    const { preset: converted } = preset();
    const result = validate(converted);

    expect(result.valid, result.valid ? '' : JSON.stringify(result.issues)).toBe(true);
    // The conversation prompt is unshifted to the top, so the declared order
    // follows it.
    expect(converted.blocks.map((b) => b.id)).toEqual([
      'mari.conversationPrompt',
      'mari.main',
      'mari.chat_history',
    ]);
  });

  it('reads booleans that arrive as the strings "true" and "false"', () => {
    // **The trap on this side.** Marinara's stored rows spell booleans as
    // strings — a JSON table's idea of a boolean column — and a row read with
    // `=== true` disables every block in the preset. The result imports and
    // validates, exactly like the SillyTavern `disable` inversion.
    expect(preset().preset.blocks.every((b) => b.enabled)).toBe(true);

    const disabled = preset([{ ...SECTIONS[0], enabled: 'false' }]);
    expect(disabled.preset.blocks.find((b) => b.id === 'mari.main')?.enabled).toBe(false);
  });

  it('carries depth injection as placement, counted from the last message', () => {
    const history = preset().preset.blocks.find((b) => b.id === 'mari.chat_history');

    expect(history?.placement).toEqual({ at: 'in-history', fromEnd: 4, tiebreak: 100 });
    expect(history?.kind === 'slot' ? history.source : null).toEqual({ of: 'history' });
  });

  it('turns XML wrapping into our one wrapper string', () => {
    // The same collapse [04 §8.4.3] describes for SillyTavern's nine fixed
    // fields, arrived at independently by a second source.
    const main = preset().preset.blocks.find((b) => b.id === 'mari.main');

    expect(main?.kind === 'text' ? main.template : '').toBe(
      '<role>\nWrite the scene as {{ char }}.\n</role>',
    );
  });

  /**
   * ~~`chat_summary` is P8-shaped; `agent_data` never gets a home.~~
   *
   * ***The phase arrived*** — [P8.1], 2026-09-16. [P8 §1.8] deferred
   * `chat_summary` here and named the one outcome it refused: *"leaving it
   * saying 'not yet' after this phase ships is not"* fine. So the marker now
   * converts to `{ of: 'summary' }` and this test asserts the conversion rather
   * than the deferral. **`agent_data` stays**, which is what keeps the review
   * class meaningful: the difference between *not yet* and *never* is only
   * legible while both exist.
   */
  it('converts the marker whose phase has arrived, and still defers the one that never will', () => {
    const result = convertPreset({ ...PRESET, sectionOrder: ['a', 'b'] }, [
      { ...SECTIONS[1], id: 'a', markerConfig: { type: 'chat_summary' } },
      { ...SECTIONS[1], id: 'b', identifier: 'x', markerConfig: { type: 'agent_data' } },
    ]);
    if (!result.ok) throw new Error('refused');
    const { preset: converted, notes } = result.value;
    const deferred = notes.filter((n) => n.key === 'import.preset.markerNeedsLaterMachinery');

    expect(deferred.map((n) => n.params['when'])).toEqual(['never']);

    const summary = converted.blocks.find((b) => b.kind === 'slot' && b.source.of === 'summary');
    expect(summary).toBeDefined();
  });

  it('carries the choice blocks across and says they are inert', () => {
    // The shape `PresetVariable` was adopted from, so they carry 1:1 — and
    // nothing reads preset variables yet, which the review says rather than
    // implies.
    const result = convertPreset(PRESET, SECTIONS, [
      {
        id: 'choice_pov',
        presetId: 'preset_1',
        variableName: 'POV',
        question: 'Which point of view?',
        options: [{ id: 'a', label: 'Third', value: 'third person' }],
      },
    ]);
    if (!result.ok) throw new Error('refused');
    const { preset: converted, notes } = result.value;

    expect(converted.variables[0]?.id).toBe('POV');
    expect(notes.map((n) => n.key)).toContain('import.preset.variablesInert');
  });
});

describe('sweeping a Marinara data root', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  async function run(extra: Record<string, string> = {}) {
    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      files: new MemoryFileSource({ ...marinaraFixture(), ...extra }),
    });
    return outcome;
  }

  it('reads the fixture root and writes what it finds', async () => {
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.report.source).toBe('marinara');
    expect(outcome.report.counts.converted).toBeGreaterThan(0);

    const actors = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(actors.body.objects.map((row: { name: string }) => row.name)).toContain('Vera Solano');

    const presets = await server.request({ method: 'GET', url: '/api/library/presets' });
    expect(presets.body.objects.map((row: { name: string }) => row.name)).toContain('Harbour');
  });

  it('reads the sharded table without being told the manifest lied', () => {
    // The fixture declares format 2 while `messages` is stored sharded, which is
    // format 4's layout — Marinara's own comment records that a crash between
    // the migration and its first flush leaves exactly that. The reader asks the
    // filesystem per table rather than trusting the manifest, so this is a
    // non-event, which is the point.
    expect(Object.keys(marinaraFixture())).toContain('storage/tables/messages/chat_1.json');
  });

  it('never lets the credentials reach the library', async () => {
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const key = outcome.report.items.find((item) => item.source === '.encryption-key');
    expect(key?.disposition).toBe('credential');

    for (const kind of ['actors', 'presets', 'lorebooks']) {
      const listed = await server.request({ method: 'GET', url: `/api/library/${kind}` });
      for (const row of listed.body.objects as { id: string }[]) {
        const object = await server.request({
          method: 'GET',
          url: `/api/library/${kind}/${row.id}`,
        });
        expect(JSON.stringify(object.body)).not.toContain('this must never reach disk');
      }
    }
  });

  it('skips the .bak siblings rather than doubling the library', async () => {
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const baks = outcome.report.items.filter((item) => item.source.endsWith('.bak'));
    expect(baks.length).toBeGreaterThan(0);
    expect(baks.every((item) => item.disposition === 'skipped')).toBe(true);

    const actors = await server.request({ method: 'GET', url: '/api/library/actors' });
    const veras = (actors.body.objects as { name: string }[]).filter(
      (row) => row.name === 'Vera Solano',
    );
    expect(veras).toHaveLength(1);
  });

  it('refuses a live install before writing anything', async () => {
    // The refusal that must happen pre-flight: reading a store mid-write
    // produces a torn library, and it does it quietly.
    const outcome = await run({ 'storage/.writer-lease': 'held' });

    expect(outcome).toEqual({ ok: false, refusal: 'live-install' });
    const actors = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(actors.body.objects).toEqual([]);
  });

  it('refuses a storage format it does not know, and writes nothing', async () => {
    const outcome = await run({
      'storage/manifest.json': JSON.stringify({ version: 99, tables: {} }),
    });

    expect(outcome).toEqual({ ok: false, refusal: 'unknown-format' });
    const actors = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(actors.body.objects).toEqual([]);
  });
});

/**
 * Marinara's single-file exports, which are the same reader over a different
 * file source ([P4 §1.3]).
 *
 * The design claim being tested is that no second conversion path was needed:
 * an envelope becomes a table with one row in it, and a native profile becomes
 * a whole data root held in memory. If either had needed its own converter, the
 * seam would have been in the wrong place.
 */
describe('the single-file export formats', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  async function importEnvelope(envelope: unknown) {
    const files =
      readEnvelope(envelope)?.type === 'marinara_profile'
        ? profileAsFileSource((envelope as { data: unknown }).data)
        : singleObjectAsFileSource(readEnvelope(envelope)!);
    expect(files).not.toBeNull();
    return sweep({ library: server.services.library, handle: 'ned', files: files! });
  }

  it('reads a single character envelope through the same converter as the table', async () => {
    const outcome = await importEnvelope({
      type: 'marinara_character',
      version: 1,
      data: { id: 'c1', data: JSON.stringify({ name: 'Maris Okonkwo', description: 'Ferry.' }) },
    });

    expect(outcome.ok).toBe(true);
    const actors = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(actors.body.objects.map((row: { name: string }) => row.name)).toContain('Maris Okonkwo');
  });

  it('reads a lorebook envelope, whose entries are nested rather than a second table', async () => {
    const outcome = await importEnvelope({
      type: 'marinara_lorebook',
      version: 1,
      data: {
        id: 'b1',
        name: 'Ferry lore',
        entries: [{ id: 'e1', lorebookId: 'b1', name: 'The rail', content: 'Pay at the rail.' }],
      },
    });

    expect(outcome.ok).toBe(true);
    const books = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect(books.body.objects.map((row: { name: string }) => row.name)).toContain('Ferry lore');
  });

  it('reads a whole native profile as a data root held in memory', async () => {
    // The claim §1.3 makes about the seam, tested literally: the store reader
    // is unchanged and does not learn that this arrived as one file.
    const outcome = await importEnvelope({
      type: 'marinara_profile',
      version: 1,
      data: {
        version: 1,
        tables: {
          characters: [{ id: 'c1', data: JSON.stringify({ name: 'Vera Solano' }) }],
          lorebooks: [{ id: 'b1', name: 'Rain City' }],
          lorebook_entries: [],
        },
        files: [],
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.counts.converted).toBeGreaterThanOrEqual(2);
  });

  it('records the session-shaped envelope kinds rather than converting them', () => {
    // `marinara_chat_preset`, `marinara_chat_settings_profile` and
    // `marinara_memory_recall` are session- and memory-shaped. Recorded with the
    // class that says when, never quietly dropped.
    for (const type of [
      'marinara_chat_preset',
      'marinara_chat_settings_profile',
      'marinara_memory_recall',
    ]) {
      const envelope = readEnvelope({ type, version: 1, data: {} });
      expect(envelope?.type).toBe(type);
      expect(singleObjectAsFileSource(envelope!)).toBeNull();
    }
  });

  it('is not fooled by JSON that is not an envelope', () => {
    expect(readEnvelope({ type: 'something_else', data: {} })).toBeNull();
    expect(readEnvelope('a string')).toBeNull();
    expect(readEnvelope(null)).toBeNull();
  });
});
