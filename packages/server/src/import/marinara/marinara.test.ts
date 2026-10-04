// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ImportItemReport, validate } from '@storyengine/shared';

import { exportSession } from '../../sessions/export.js';
import { openLocalSource } from '../../storage/local-source.js';
import {
  makeTestServer,
  setUpAdmin,
  tempRoot,
  type TestServer,
  ownObjects,
} from '../../test-server.js';
import {
  marinaraFixture,
  marinaraShardedFixture,
  writeFixtureTree,
} from '../fixtures/test-marinara.js';
import { MemoryFileSource } from '../memory-source.js';
import { malformedInputs } from '../parse.js';
import { MARINARA_DISPOSITIONS } from '../registries/marinara.js';
import type { FileSource } from '../source.js';
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

describe('a value named like a property of every object', () => {
  it('is a logic this does not know, narrowed with a note, and the book validates', () => {
    // A plain index found `Object` for `constructor`, and a function in the
    // entry cost the whole lorebook its validation (2026-09-27).
    const { lorebook, notes } = book({ selectiveLogic: 'constructor' });

    expect(lorebook.entries[0]?.selectiveLogic).toBe('and_any');
    expect(notes.find((n) => n.key === 'import.lore.logicNarrowed')?.params).toMatchObject({
      original: 'constructor',
    });
    expect(validate(lorebook).valid).toBe(true);
  });

  it('is a marker this does not know, and the preset validates', () => {
    const result = convertPreset({ ...PRESET, sectionOrder: ['a'] }, [
      { ...SECTIONS[1], id: 'a', markerConfig: { type: 'constructor' } },
    ]);
    if (!result.ok) throw new Error('refused');

    expect(result.value.notes.find((n) => n.key === 'import.preset.unknownMarker')?.params).toEqual(
      {
        identifier: 'constructor',
      },
    );
    expect(validate(result.value.preset).valid).toBe(true);
  });
});

describe('what the lorebook carries across', () => {
  it('validates, and turns the mode-plus-list filters into ours', () => {
    const { lorebook } = book();
    const result = validate(lorebook);

    expect(result.valid, result.valid ? '' : JSON.stringify(result.issues)).toBe(true);
    expect(lorebook.entries[0]?.actorFilter).toEqual({ mode: 'include', values: ['char_vera'] });
  });

  it('gives two entries of one name and content ids of their own', () => {
    // The id is derived from those two, as SillyTavern's is, and [04 §5.2]
    // makes it unique within the book (2026-09-27).
    const result = convertLorebook(BOOK, [ENTRY, { ...ENTRY, id: 'entry_docks_again' }]);
    const ids = result.ok ? result.value.lorebook.entries.map((entry) => entry.id) : [];

    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe(book().lorebook.entries[0]?.id);
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
    // fields, arrived at independently by a second source. *(The tag is the
    // section's name, by the preset's format, since 2026-09-27 — not the legacy
    // `xmlTagName`, which here happens to agree.)*
    const main = preset().preset.blocks.find((b) => b.id === 'mari.main');

    expect(main?.kind === 'text' ? main.template : '').toBe(
      '<role>\nWrite the scene as {{ char }}.\n</role>',
    );
  });

  it('keeps a section’s dollar signs as text when it wraps it', () => {
    // `String.prototype.replace` reads `$&`, `$$`, `` $` `` and `$'` in its
    // replacement as patterns, so a section's own text was rewritten the moment
    // it was wrapped (2026-09-27).
    const text = "Costs $$5, which is $& and $` and $' too.";
    const main = preset([{ ...SECTIONS[0], content: text }]).preset.blocks.find(
      (b) => b.id === 'mari.main',
    );

    expect(main?.kind === 'text' ? main.template : '').toBe(`<role>\n${text}\n</role>`);
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

/**
 * ***A preset as Marinara stores it*** (2026-09-27).
 *
 * Its schema keeps `sectionOrder`, `markerConfig`, a choice's `options` and
 * `parameters` as JSON **text**, booleans as `"true"`, and its preset export
 * carries the rows as stored — while the fixtures here were written in the
 * API's shape, which is the only one the converter could read. On a real
 * store the order fell back to table order, every marker was unknown, the
 * history slot was gone, and every choice had no options.
 */
describe('a Marinara preset as its store holds it', () => {
  const STORED = {
    ...PRESET,
    sectionOrder: JSON.stringify(['section_history', 'section_main']),
    parameters: JSON.stringify({ temperature: 0.7, maxTokens: 900, reasoningEffort: 'low' }),
  };
  const STORED_SECTIONS = [
    SECTIONS[0],
    { ...SECTIONS[1], markerConfig: JSON.stringify({ type: 'chat_history' }) },
  ];

  function stored(
    over: Record<string, unknown> = {},
    sections: unknown[] = STORED_SECTIONS,
    choices: unknown[] = [],
    groups: unknown[] = [],
  ) {
    const result = convertPreset({ ...STORED, ...over }, sections, choices, groups);
    if (!result.ok) throw new Error(`refused: ${result.refusal}`);
    return result.value;
  }

  it('keeps the declared order, and its history slot, from text columns', () => {
    const { preset: converted, notes } = stored();

    expect(converted.blocks.map((b) => b.id)).toEqual([
      'mari.conversationPrompt',
      'mari.chat_history',
      'mari.main',
    ]);
    expect(notes.map((n) => n.key)).not.toContain('import.preset.unknownMarker');
  });

  it('says so when the order will not parse, and keeps the stored order', () => {
    const { preset: converted, notes } = stored({ sectionOrder: '[section_main' });

    expect(converted.blocks.map((b) => b.id).slice(1)).toEqual(['mari.main', 'mari.chat_history']);
    expect(notes.find((n) => n.key === 'import.preset.sectionOrderUnreadable')?.level).toBe('warn');
  });

  it('reads a choice’s options from text', () => {
    const { preset: converted } = stored({}, STORED_SECTIONS, [
      {
        id: 'choice_pov',
        presetId: 'preset_1',
        variableName: 'POV',
        question: 'Which point of view?',
        options: JSON.stringify([{ id: 'a', label: 'Third', value: 'third person' }]),
      },
    ]);

    const pov = converted.variables[0];
    expect(pov?.type === 'enum' ? pov.options : []).toEqual([
      { value: 'third person', label: 'Third' },
    ]);
  });

  it('carries the generation settings with an equivalent, and keeps the rest', () => {
    const { preset: converted } = stored();

    expect(converted.params).toMatchObject({ temperature: 0.7, maxTokens: 900 });
    expect(converted.compat?.['parameters']).toEqual({ reasoningEffort: 'low' });
  });

  it('wraps every section in the preset’s format, by its name, and never the history', () => {
    const text = (format: string) => {
      const main = stored({ wrapFormat: format }, [
        { ...SECTIONS[0], name: 'World Rules (core)', wrapInXml: 'false', xmlTagName: '' },
        STORED_SECTIONS[1],
      ]).preset.blocks.find((b) => b.id === 'mari.main');
      return main?.kind === 'text' ? main.template : null;
    };

    // The legacy flag says no, and Marinara wraps it anyway: it reads the format.
    expect(text('xml')).toBe(
      '<world_rules_core>\nWrite the scene as {{ char }}.\n</world_rules_core>',
    );
    expect(text('markdown')).toBe('## World Rules core\nWrite the scene as {{ char }}.');
    expect(text('none')).toBe('Write the scene as {{ char }}.');

    const history = stored().preset.blocks.find((b) => b.id === 'mari.chat_history');
    expect(history?.kind === 'slot' ? history.wrapper : 'none').toBeUndefined();
  });

  it('switches off a section whose group is off, and says a group’s wrapper stays behind', () => {
    const { preset: converted, notes } = stored(
      {},
      [{ ...SECTIONS[0], groupId: 'group_style' }, STORED_SECTIONS[1]],
      [],
      [{ id: 'group_style', presetId: 'preset_1', name: 'Style', enabled: 'false' }],
    );

    expect(converted.blocks.find((b) => b.id === 'mari.main')?.enabled).toBe(false);
    expect(notes.find((n) => n.key === 'import.preset.groupWrappersDropped')?.params).toEqual({
      groups: 'Style',
    });
  });

  it('keeps one block per id, the first', () => {
    const { preset: converted, notes } = stored(
      { sectionOrder: JSON.stringify(['section_main', 'section_again']) },
      [SECTIONS[0], { ...SECTIONS[0], id: 'section_again', content: 'The second.' }],
    );

    expect(converted.blocks.filter((b) => b.id === 'mari.main')).toHaveLength(1);
    expect(notes.find((n) => n.key === 'import.preset.duplicatesDropped')?.params).toEqual({
      identifiers: 'main',
    });
  });
});

/**
 * ***A lorebook as Marinara stores it*** (2026-09-27): keys as JSON text,
 * switches as `"true"` and `"false"`. Only arrays and real booleans were
 * read, so on a real store no entry had a key — none could ever fire — and
 * every switch took its default.
 */
/**
 * ***A macro taken out is said, here too*** (2026-09-27). The sections
 * reported unrecognised macros only, and the conversation prompt reported
 * nothing at all.
 */
describe('what the review says about a Marinara preset’s macros', () => {
  it('names a macro a section lost, and one the conversation prompt kept', () => {
    const result = convertPreset({ ...PRESET, conversationPrompt: 'You are {{charName}}.' }, [
      { ...SECTIONS[0], content: 'Roll {{random::a::b}} today.' },
    ]);
    if (!result.ok) throw new Error('refused');
    const { notes } = result.value;

    expect(notes.find((n) => n.key === 'import.macro.refused')?.params).toEqual({
      macro: 'random',
      block: 'Role',
      because: 'randomness-must-be-drawn-and-recorded',
    });
    expect(notes.find((n) => n.key === 'import.macro.unrecognised')?.params).toEqual({
      macro: 'charname',
      block: 'Conversation prompt',
    });
  });
});

describe('a Marinara lorebook as its store holds it', () => {
  it('reads keys from text and switches from strings', () => {
    const { lorebook } = book({
      keys: JSON.stringify(['docks', 'harbour']),
      secondaryKeys: JSON.stringify(['rain']),
      enabled: 'false',
      constant: 'true',
      matchWholeWords: 'true',
      characterFilterIds: JSON.stringify(['char_vera']),
    });
    const entry = lorebook.entries[0];

    expect(entry?.keys).toEqual(['docks', 'harbour']);
    expect(entry?.secondaryKeys).toEqual(['rain']);
    expect(entry?.enabled).toBe(false);
    expect(entry?.constant).toBe(true);
    expect(entry?.matchWholeWords).toBe(true);
    expect(entry?.actorFilter).toEqual({ mode: 'include', values: ['char_vera'] });
  });

  it('reads the book’s own switch from a string', () => {
    const result = convertLorebook({ ...BOOK, enabled: 'false' }, [ENTRY]);
    if (!result.ok) throw new Error('refused');
    expect(result.value.lorebook.enabled).toBe(false);
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
      tags: server.services.tags,
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

  /**
   * ***The fixture is the stored shape now*** (2026-09-27), so this is the
   * claim a real store needed: the preset keeps the order it declared in a
   * text column and its history slot, and the lorebook's entry keeps the keys
   * it stored as text.
   */
  it('keeps the preset’s order and history slot, and the book’s keys, from a real store', async () => {
    const outcome = await run();
    expect(outcome.ok).toBe(true);

    const presets = await ownObjects(server, 'presets');
    const harbour = presets.objects.find((row) => row['name'] === 'Harbour');
    const stored = await server.request({
      method: 'GET',
      url: `/api/library/presets/${String(harbour?.id)}`,
    });
    const blocks = (stored.body.object as { blocks: { id: string }[] }).blocks;
    expect(blocks.map((block) => block.id)).toEqual([
      'mari.conversationPrompt',
      'mari.main',
      'mari.chat_history',
    ]);

    const books = await ownObjects(server, 'lorebooks');
    const rain = books.objects.find((row) => row['name'] === 'Rain City');
    const book = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${String(rain?.id)}`,
    });
    const entries = (book.body.object as { entries: { keys: string[] }[] }).entries;
    expect(entries[0]?.keys).toEqual(['docks', 'harbour']);
  });

  /**
   * ***A persona is its own row*** (2026-09-27). Characters keep a card in a
   * `data` column and personas do not have one, so every persona read nothing
   * and none imported.
   */
  it('imports a persona from its own columns', async () => {
    const outcome = await run({
      'storage/tables/personas.json': JSON.stringify([
        {
          id: 'persona_inspector',
          name: 'The Inspector',
          description: 'Signs the forms.',
          personality: 'tired',
          appearance: 'A wet coat.',
          backstory: 'Twenty years on the docks.',
          isActive: 'false',
        },
      ]),
    });
    expect(outcome.ok).toBe(true);

    const actors = await ownObjects(server, 'actors');
    const inspector = actors.objects.find((row) => row['name'] === 'The Inspector');
    expect(inspector).toBeDefined();
    const stored = await server.request({
      method: 'GET',
      url: `/api/library/actors/${String(inspector?.id)}`,
    });
    const summary = (
      stored.body.object as { profile: { sections: { id: string; body: string }[] } }
    ).profile.sections.find((section) => section.id === 'se.summary');
    // Description, appearance and backstory, each its own paragraph; the card
    // converter then does with the personality what it does with any card's.
    expect(
      summary?.body.startsWith('Signs the forms.\n\nA wet coat.\n\nTwenty years on the docks.'),
    ).toBe(true);
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

  it('reads every table the registry calls converted, and names the rest', async () => {
    /**
     * ***`converted` is a claim about the reader*** (2026-09-27). The review
     * leaves a converted table out, because the objects it produced stand for
     * it, so a table marked converted that nothing read vanished from the
     * review. Five did: the two image tables were loaded and thrown away, and
     * prompt groups, persona links and library folders were never opened. The
     * picture directories said `converted` and went nowhere either. This holds
     * the registry to what a sweep actually opens.
     */
    const inner = new MemoryFileSource({
      ...marinaraFixture(),
      'sprites/char_vera/happy.png': 'sprite',
    });
    const opened = new Set<string>();
    const files: FileSource = {
      list: () => inner.list(),
      exists: (path) => inner.exists(path),
      read: (path) => {
        const table = /^storage\/tables\/([^/]+?)(?:\.json$|\/)/.exec(path)?.[1];
        if (table !== undefined) opened.add(table);
        return inner.read(path);
      },
    };
    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      tags: server.services.tags,
      files,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const converted = Object.entries(MARINARA_DISPOSITIONS)
      .filter(([, disposition]) => disposition === 'converted')
      .map(([table]) => table);
    expect(converted.filter((table) => !opened.has(table))).toEqual([]);

    const disposition = (source: string) =>
      outcome.report.items.find((item) => item.source === source)?.disposition;
    // ~~`prompt_groups` is recorded~~ — read with its presets since 2026-09-27,
    // so it is converted, and stands in the review as the presets it shaped.
    expect(disposition('storage/tables/prompt_groups.json')).toBeUndefined();
    expect(disposition('sprites/char_vera/happy.png')).toBe('recorded');
  });

  it('names a table called `constructor` as one it does not recognise', async () => {
    // A plain index into the registry found `Object`, which travelled into the
    // report as a disposition and into the counts as a key (2026-09-27).
    const outcome = await run({ 'storage/tables/constructor.json': '[]' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(
      outcome.report.items.find((item) => item.source === 'storage/tables/constructor.json')
        ?.disposition,
    ).toBe('unrecognised');
    expect(Object.values(outcome.report.counts).every((count) => Number.isInteger(count))).toBe(
      true,
    );
  });

  it('refuses a live install before writing anything', async () => {
    // The refusal that must happen pre-flight: reading a store mid-write
    // produces a torn library, and it does it quietly.
    const outcome = await run({ 'storage/.writer-lease': 'held' });

    expect(outcome).toEqual({ ok: false, refusal: 'live-install' });
    // **`ownObjects`, not the bare list** — the system scope ships an assistant
    // card since [P11.3], so *the library is empty* was never the claim: it is
    // that **the user's** library is, which is what the refusal is about.
    expect((await ownObjects(server, 'actors')).objects).toEqual([]);
  });

  it('refuses a storage format it does not know, and writes nothing', async () => {
    const outcome = await run({
      'storage/manifest.json': JSON.stringify({ version: 99, tables: {} }),
    });

    expect(outcome).toEqual({ ok: false, refusal: 'unknown-format' });
    expect((await ownObjects(server, 'actors')).objects).toEqual([]);
  });
});

/**
 * **A storage format 5–7 store, which is what every recent Marinara writes**
 * ([P4 §7.18](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * Every table sharded, with everything a real store leaves beside the shards.
 * The assertions are on the report's items and on the library's own objects,
 * never on counts alone: two identical copies of a row reach the library as one
 * object marked `unchanged`, so a library count cannot see the doubling this
 * stage exists to stop, and only the items can.
 */
describe('sweeping a store every table of which is sharded', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  async function sweepTree(files: FileSource, sessions = false) {
    const outcome = await sweep({
      library: server.services.library,
      tags: server.services.tags,
      ...(sessions ? { sessions: server.services.sessions } : {}),
      handle: 'ned',
      files,
    });
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
    return outcome.report;
  }

  async function names(kind: string): Promise<string[]> {
    return (await ownObjects(server, kind)).objects
      .map((row) => (typeof row['name'] === 'string' ? row['name'] : ''))
      .sort();
  }

  async function assertTheLibrary(report: Awaited<ReturnType<typeof sweepTree>>) {
    const bySource = (suffix: string) =>
      report.items.filter((item) => item.source.endsWith(suffix));

    // One row per object, whatever else sat beside its shard.
    for (const suffix of [
      'characters.json#char_vera',
      'characters.json#char_maris',
      'lorebooks.json#book_rain_city',
      'prompt_presets.json#preset_harbour',
    ]) {
      expect(bySource(suffix), suffix).toHaveLength(1);
      expect(bySource(suffix)[0]?.disposition, suffix).toBe('converted');
    }
    expect(report.counts.unchanged).toBe(0);

    // The right copy of each: not the backup, not the stranded row, not a
    // ghost from a file no reader should open.
    expect(await names('actors')).toEqual(['Maris Okonkwo', 'Vera Solano']);
    expect(await names('presets')).toEqual(['Harbour']);
    expect(await names('lorebooks')).toEqual(['Rain City']);
  }

  it('imports each object once, and the right copy of it', async () => {
    await assertTheLibrary(await sweepTree(new MemoryFileSource(marinaraShardedFixture())));
  });

  /**
   * **Every file beside a shard is named, and none of them is a mystery.** The
   * backups, the migration's own backups, the torn and quarantined leftovers,
   * the launcher's directory and the monolith an older build wrote back are all
   * files Marinara writes on purpose, so each is `skipped` with its reason where
   * it has one — and nothing under `storage/tables/` is `unrecognised`.
   */
  it('reports every leftover for what it is', async () => {
    const report = await sweepTree(new MemoryFileSource(marinaraShardedFixture()));
    const at = (path: string) => report.items.find((item) => item.source === path);
    const T = 'storage/tables';

    const strange = report.items.filter(
      (item) => item.source.startsWith(`${T}/`) && item.disposition === 'unrecognised',
    );
    expect(strange.map((item) => item.source)).toEqual([]);

    for (const path of [
      `${T}/characters/char%5Fvera.json.bak`,
      `${T}/characters/char%5Fvera.json.tmp-4242-1758000000000`,
      `${T}/characters/char%5Fvera.json.corrupt-2026-09-01T10-00-00-000Z`,
      `${T}/characters.json.pre-shard`,
      `${T}/characters.post-unshard-2026-09-01T10-00-00-000Z/char%5Fvera.json`,
      `${T}/chats.json.post-downgrade-2026-09-01T10-00-00-000Z`,
    ]) {
      expect(at(path)?.disposition, path).toBe('skipped');
    }

    // The ones with something to say.
    expect(at(`${T}/prompt_sections/preset%5Fharbour.json`)?.notes.map((n) => n.key)).toEqual([
      'import.marinara.backupUsed',
    ]);
    expect(at(`${T}/lorebooks/book%5Frain%5Fcity.json.bak`)?.notes.map((n) => n.key)).toEqual([
      'import.marinara.backupUsed',
    ]);
    expect(at(`${T}/prompt_presets.json`)?.notes.map((n) => n.key)).toEqual([
      'import.marinara.monolithSuperseded',
    ]);
  });

  /** The same tree on a real disk, walked by the source a server path sweep uses. */
  it('reads the same store from a real directory', async () => {
    const root = await tempRoot('se-marinara-7-');
    try {
      await writeFixtureTree(root, marinaraShardedFixture());
      const opened = await openLocalSource(root, server.dataDir);
      if (!opened.ok) throw new Error(opened.refusal);

      await assertTheLibrary(await sweepTree(opened.source));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  /**
   * **Sharded tables under a version-2 manifest**, which is what a crash between
   * the shard migration and its first flush leaves. The manifest states a
   * version and does not establish the layout, so the reader asks the files.
   *
   * *This replaces a test that claimed the same thing and asserted only that the
   * fixture contained a path* — `messages`, which was recorded rather than read
   * when that test was written, so no reader ever opened it ([P4 §7.18]). Since
   * [P14.10] the reader does open it, and the shared fixture's sharded messages
   * under the same version-2 manifest now come in as sessions
   * (`chat-sessions.test.ts`); the replaced test still asserted nothing of that.
   */
  it('reads the files rather than trusting the version it is told', async () => {
    await assertTheLibrary(
      await sweepTree(new MemoryFileSource(marinaraShardedFixture({ version: 2 }))),
    );
  });

  it('refuses a table part-way through its shard migration, and writes nothing', async () => {
    const outcome = await sweep({
      library: server.services.library,
      tags: server.services.tags,
      handle: 'ned',
      files: new MemoryFileSource({
        ...marinaraShardedFixture(),
        'storage/tables/characters/.migrating': '2026-09-20T12:00:00.000Z',
      }),
    });

    expect(outcome).toEqual({ ok: false, refusal: 'live-install' });
    expect((await ownObjects(server, 'actors')).objects).toEqual([]);
  });

  it('imports past an unfinished offline unshard, and says so', async () => {
    const report = await sweepTree(
      new MemoryFileSource({
        ...marinaraShardedFixture(),
        'storage/tables/.unshard-in-progress': '',
      }),
    );

    const marker = report.items.find(
      (item) => item.source === 'storage/tables/.unshard-in-progress',
    );
    expect(marker?.notes.map((n) => n.key)).toEqual(['import.marinara.unshardUnfinished']);
    expect(await names('actors')).toEqual(['Maris Okonkwo', 'Vera Solano']);
  });

  /**
   * ***The chats come through the same store*** (2026-10-02).
   *
   * [P14.10], [P14.5a] and [P14.5b] read the chat tables with a loader of their
   * own, written against a store whose chats were one file and whose messages
   * were the only shards; this branch's store layer was written before there
   * were chats to read. Merged, there is one loader, and this is what holds it
   * to that: every chat table here is sharded and each carries a leftover the
   * old loader read wrong — a single `chats.json` written back beside the
   * shards (it read the single file and named the session after the decoy), a
   * swipe shard that survives only as its backup (it skipped every `.bak`, so
   * `msg_03` lost its second swipe), and a torn snapshot shard with a good
   * backup (it read the torn file as no rows, so no tracker moved).
   */
  it('reads the chat tables by the store’s rules, and the chat is one session', async () => {
    const report = await sweepTree(new MemoryFileSource(marinaraShardedFixture()), true);
    const at = (path: string) => report.items.find((item) => item.source === path);
    const T = 'storage/tables';

    const chat = at(`${T}/chats.json#chat_1`);
    expect(chat?.disposition).toBe('converted');
    const document = await exportSession(
      { sessions: server.services.sessions, build: null },
      'ned',
      chat?.objectId ?? '',
    );
    if (document === null) throw new Error('no session');

    // The shard's row, not the single file's.
    expect(document.session.name).toBe('Harbour Night');
    // The greeting, the first round once per swipe, and the second round — no
    // turn twice for the `.bak` beside the message shard.
    expect(document.turns).toHaveLength(4);
    const said = document.turns.flatMap((turn) => (turn.output?.messages ?? []).map((m) => m.text));
    expect(said).toContain('What about them?');
    // The trackers, from the backup of the torn shard, and the root's plot.
    const effects = document.turns.flatMap((turn) => turn.effects);
    expect(
      effects
        .filter((effect) => effect.channelId === 'se.track.world')
        .map((effect) => (effect.after as { location?: unknown } | null)?.location),
    ).toContain('the harbour office');
    expect(effects.filter((effect) => effect.channelId === 'se.plot.secret')).toHaveLength(1);

    // And the review says which file each came from.
    expect(at(`${T}/chats.json`)?.notes.map((n) => n.key)).toEqual([
      'import.marinara.monolithSuperseded',
    ]);
    expect(at(`${T}/message_swipes/chat%5F1.json.bak`)?.notes.map((n) => n.key)).toEqual([
      'import.marinara.backupUsed',
    ]);
    expect(at(`${T}/game_state_snapshots/chat%5F1.json`)?.notes.map((n) => n.key)).toEqual([
      'import.marinara.backupUsed',
    ]);
    expect(at(`${T}/messages/chat%5F1.json.bak`)).toEqual({
      source: `${T}/messages/chat%5F1.json.bak`,
      disposition: 'skipped',
      notes: [],
    });
  });
});

/**
 * **Every file that did not become something says why**
 * ([P4 §7.18](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * Before this stage each of these produced no row at all: a table file that
 * could not be read, or that was not a list of rows, simply was not in the
 * review — which is the silent drop *nothing is silently dropped* exists to
 * prevent, arriving by the one route nobody tested.
 */
describe('the rows a store gets for what it could not read', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
  });

  afterEach(async () => {
    await server.dispose();
  });

  async function report(files: FileSource) {
    const outcome = await sweep({
      library: server.services.library,
      tags: server.services.tags,
      handle: 'ned',
      files,
    });
    if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
    return outcome.report;
  }

  const item = (items: readonly ImportItemReport[], source: string) =>
    items.find((one) => one.source === source);

  it('names a table file an upload did not carry', async () => {
    const tree = { ...marinaraFixture() };
    delete tree['storage/tables/choice_blocks.json'];
    const { items } = await report(
      new MemoryFileSource(tree, ['storage/tables/choice_blocks.json']),
    );

    expect(item(items, 'storage/tables/choice_blocks.json')).toMatchObject({
      disposition: 'unrecognised',
      notes: [{ key: 'import.file.unreadable' }],
    });
  });

  it('names a table file that is not JSON', async () => {
    const { items } = await report(
      new MemoryFileSource({
        ...marinaraFixture(),
        'storage/tables/lorebook_entries.json': '{ torn',
      }),
    );

    expect(item(items, 'storage/tables/lorebook_entries.json')).toMatchObject({
      disposition: 'unrecognised',
      notes: [{ key: 'import.file.notJson' }],
    });
  });

  /** The prototype hole: a table named for a property of `Object` is still a stranger. */
  it('does not mistake a table named constructor for a known one', async () => {
    const { items } = await report(
      new MemoryFileSource({
        ...marinaraFixture(),
        'storage/tables/constructor.json': '[]',
        'storage/tables/toString.json': '[]',
      }),
    );

    for (const source of ['storage/tables/constructor.json', 'storage/tables/toString.json']) {
      expect(item(items, source)?.disposition, source).toBe('unrecognised');
    }
  });

  it('puts an unmet count on the manifest, which is the only signal left for it', async () => {
    // Nine declared against the fixture's three: ~~three against one~~ until the
    // 2026-10-02 merge, when [P14.10]'s group chat brought Maris and Lund into
    // the shared fixture beside Vera, and three stopped being a shortfall.
    const { items } = await report(
      new MemoryFileSource({
        ...marinaraFixture(),
        'storage/manifest.json': JSON.stringify({ version: 2, tables: { characters: 9 } }),
      }),
    );

    expect(item(items, 'storage/manifest.json')?.notes).toEqual([
      {
        key: 'import.marinara.rowsMissing',
        params: { table: 'characters', expected: 9, found: 3 },
        level: 'warn',
      },
    ]);
  });

  /**
   * ***And of the tables the chats are read from*** (2026-10-02). The merge
   * that read them through the store kept them beside `READ_TABLES`, and the
   * count went on checking that list alone — so a store whose `messages`
   * directory listed nothing imported its chats with no lines, and the review
   * was silent. The intact store's counts all match, chat tables included, so
   * its manifest still has nothing to say.
   */
  it('puts an unmet count of messages on the manifest too', async () => {
    const intact = await report(new MemoryFileSource(marinaraShardedFixture()));
    expect(item(intact.items, 'storage/manifest.json')).toBeUndefined();

    const withoutMessages = Object.fromEntries(
      Object.entries(marinaraShardedFixture()).filter(
        ([path]) => !path.startsWith('storage/tables/messages/'),
      ),
    );
    const { items } = await report(new MemoryFileSource(withoutMessages));

    expect(item(items, 'storage/manifest.json')?.notes).toMatchObject([
      { key: 'import.marinara.rowsMissing', params: { table: 'messages', found: 0 } },
    ]);
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
    return sweep({
      library: server.services.library,
      handle: 'ned',
      tags: server.services.tags,
      files: files!,
    });
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

  /**
   * ***The shapes Marinara actually exports*** (2026-09-27). A preset is
   * `{ preset, sections, groups, choiceBlocks }` with its rows as stored, a
   * lorebook `{ lorebook, entries, folders }`, and a profile keeps its tables
   * under `fileStorage` — its own importers read exactly those. The tests above
   * are hand-made flat shapes, still read; these are the real ones, which were
   * refused or imported nothing.
   */
  it('reads a preset envelope as Marinara exports one', async () => {
    const outcome = await importEnvelope({
      type: 'marinara_preset',
      version: 1,
      data: {
        preset: { ...PRESET, sectionOrder: JSON.stringify(['section_main', 'section_history']) },
        sections: [
          SECTIONS[0],
          { ...SECTIONS[1], markerConfig: JSON.stringify({ type: 'chat_history' }) },
        ],
        groups: [],
        choiceBlocks: [],
      },
    });
    expect(outcome.ok).toBe(true);

    const presets = await ownObjects(server, 'presets');
    const imported = presets.objects.find((row) => row['name'] === PRESET.name);
    const stored = await server.request({
      method: 'GET',
      url: `/api/library/presets/${String(imported?.id)}`,
    });
    const ids = (stored.body.object as { blocks: { id: string }[] }).blocks.map((b) => b.id);
    expect(ids).toContain('mari.chat_history');
  });

  it('reads a lorebook envelope as Marinara exports one', async () => {
    const outcome = await importEnvelope({
      type: 'marinara_lorebook',
      version: 1,
      data: {
        lorebook: { id: 'b1', name: 'Ferry lore', enabled: true },
        entries: [
          { id: 'e1', lorebookId: 'b1', name: 'The rail', content: 'Pay.', keys: ['rail'] },
        ],
        folders: [],
      },
    });
    expect(outcome.ok).toBe(true);

    const books = await ownObjects(server, 'lorebooks');
    expect(books.objects.map((row) => row['name'])).toContain('Ferry lore');
  });

  it('reads a profile export from the store snapshot under fileStorage', async () => {
    const outcome = await importEnvelope({
      type: 'marinara_profile',
      version: 1,
      data: {
        characters: [],
        fileStorage: {
          version: 1,
          tables: {
            characters: [{ id: 'c1', data: JSON.stringify({ name: 'Vera Solano' }) }],
            lorebooks: [{ id: 'b1', name: 'Rain City', enabled: 'true' }],
            lorebook_entries: [],
          },
          files: [],
        },
      },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.counts.converted).toBeGreaterThanOrEqual(2);
  });

  it('reads a profile export without a snapshot from the lists beside it', async () => {
    const outcome = await importEnvelope({
      type: 'marinara_profile',
      version: 1,
      data: {
        characters: [{ id: 'c1', data: JSON.stringify({ name: 'Maris Okonkwo' }) }],
        personas: [],
        lorebooks: [
          {
            id: 'b1',
            name: 'Ferry lore',
            enabled: true,
            folders: [],
            entries: [{ id: 'e1', lorebookId: 'b1', name: 'Rail', content: 'Pay.' }],
          },
        ],
        presets: [],
      },
    });
    expect(outcome.ok).toBe(true);

    const books = await ownObjects(server, 'lorebooks');
    expect(books.objects.map((row) => row['name'])).toContain('Ferry lore');
  });

  it('finds nothing to read in a profile archive’s manifest, whose rows are in the zip', () => {
    expect(
      profileAsFileSource({
        fileStorage: {
          version: 2,
          tables: { characters: { path: 'x', count: 1, size: 2 } },
          files: [],
        },
      }),
    ).toBeNull();
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
