// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { isKnownSchema, newActor, schemaIdOf, validate } from '@storyengine/shared';

import { collectCandidates } from '../../assembly/collect.js';
import { DEFAULT_MODE_ID } from '../../mode-registry.js';
import { MACRO_NOTE_LIMIT } from '../macros.js';
import { malformedInputs } from '../parse.js';
import { convertChatCompletionPreset } from './preset.js';
import { SILLYTAVERN_SENSITIVE_FIELDS } from './sensitive-fields.js';

/**
 * SillyTavern chat-completion presets → `Preset` ([04 §8.4]).
 *
 * The assertions follow the conversion's own risk order: what must never
 * survive, what must survive exactly, and what must be *reported* rather than
 * silently done. The last is most of them, because §8.4.2's rule is that every
 * loss is a named consequence.
 */

const PRESET = {
  chat_completion_source: 'openai',
  openai_model: 'gpt-4',
  openai_max_context: 8192,
  openai_max_tokens: 512,
  temperature: 0.9,
  frequency_penalty: 0.1,
  reverse_proxy: 'https://example.invalid/v1',
  proxy_password: 'this must never reach disk',
  custom_url: '',
  wi_format: '[Lore: {0}]',
  scenario_format: 'Scenario: {{scenario}}',
  continue_nudge_prompt: 'Continue from where {{char}} left off.',
  impersonation_prompt: 'Write as {{user}}.',
  prompts: [
    { identifier: 'main', name: 'Main', role: 'system', content: 'You are {{char}}.' },
    { identifier: 'charDescription', name: 'Description', marker: true },
    { identifier: 'charPersonality', name: 'Personality', marker: true },
    { identifier: 'personaDescription', name: 'Persona', marker: true },
    { identifier: 'worldInfoBefore', name: 'Lore', marker: true },
    { identifier: 'chatHistory', name: 'History', marker: true },
    {
      identifier: 'atDepth4',
      name: 'Depth note',
      role: 'system',
      content: 'Keep the rain in frame.',
      injection_position: 1,
      injection_depth: 4,
      injection_order: 100,
    },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'personaDescription', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'charPersonality', enabled: false },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'atDepth4', enabled: true },
      ],
    },
  ],
};

function convert(overrides: Record<string, unknown> = {}) {
  const result = convertChatCompletionPreset({ ...PRESET, ...overrides }, 'Harbour');
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.value;
}

const keys = (notes: { key: string }[]): string[] => notes.map((n) => n.key);

/** The blocks an order produced, without the two fixed-field blocks `PRESET` adds. */
const FIXED = new Set(['st.continue_nudge_prompt', 'st.impersonation_prompt']);
const ordered = (blocks: { id: string; enabled: boolean }[]): [string, boolean][] =>
  blocks.filter((block) => !FIXED.has(block.id)).map((block) => [block.id, block.enabled]);

/**
 * ***The order SillyTavern sends*** (2026-09-27).
 *
 * `100001` since 1.10.0 — the order a generation reads and the toggles write —
 * and `100000` the one before it, which SillyTavern's own `Default.json` still
 * carries without a persona slot. This converter read `100000` first, on a
 * premise §8.4.2 and [P4 §1.1] shared, so the preset SillyTavern ships lost its
 * persona and every custom prompt and toggle came from the wrong list.
 */
describe('the order a SillyTavern preset is read in', () => {
  const BOTH = {
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', content: 'You are the narrator.' },
      { identifier: 'nsfw', name: 'Auxiliary', role: 'system', content: 'Keep it dark.' },
      { identifier: 'rules', name: 'House rules', role: 'system', content: 'No dreams.' },
      { identifier: 'personaDescription', name: 'Persona', marker: true },
      { identifier: 'chatHistory', name: 'History', marker: true },
    ],
    prompt_order: [
      {
        character_id: 100000,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'nsfw', enabled: true },
          { identifier: 'chatHistory', enabled: true },
        ],
      },
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'personaDescription', enabled: true },
          { identifier: 'rules', enabled: true },
          { identifier: 'nsfw', enabled: false },
          { identifier: 'chatHistory', enabled: true },
        ],
      },
    ],
  };

  it('converts the order SillyTavern sends, not the legacy one beside it', () => {
    const { preset, notes } = convert(BOTH);

    // The persona and the custom prompt are there, and the toggle is the one
    // the person set.
    expect(ordered(preset.blocks)).toEqual([
      ['st.main', true],
      ['st.personaDescription', true],
      ['st.rules', true],
      ['st.nsfw', false],
      ['st.chatHistory', true],
    ]);
    expect(keys(notes)).not.toContain('import.preset.legacyOrderUsed');
  });

  it('falls back to the legacy order, and says so, for a file that has only that', () => {
    const { preset, notes } = convert({ ...BOTH, prompt_order: [BOTH.prompt_order[0]] });

    expect(ordered(preset.blocks).slice(0, 3)).toEqual([
      ['st.main', true],
      ['st.nsfw', true],
      ['st.chatHistory', true],
    ]);
    expect(keys(notes)).toContain('import.preset.legacyOrderUsed');
  });

  it('reads an entry that does not say it is on as off, as SillyTavern does', () => {
    const { preset } = convert({
      ...BOTH,
      prompt_order: [
        { character_id: 100001, order: [{ identifier: 'main' }, { identifier: 'chatHistory' }] },
      ],
    });

    expect(ordered(preset.blocks).slice(0, 2)).toEqual([
      ['st.main', false],
      ['st.chatHistory', false],
    ]);
  });

  it('keeps a prompt the order leaves out, switched off, and names it', () => {
    const { preset, notes } = convert({
      ...BOTH,
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'chatHistory', enabled: true },
          ],
        },
      ],
    });

    // The two written prompts come along off; the unused marker, which has
    // nothing written in it, does not.
    expect(ordered(preset.blocks)).toEqual([
      ['st.main', true],
      ['st.chatHistory', true],
      ['st.nsfw', false],
      ['st.rules', false],
    ]);
    expect(notes.find((one) => one.key === 'import.preset.unusedPromptsKept')?.params).toEqual({
      count: 2,
      names: 'Auxiliary, House rules',
    });
  });

  it('takes SillyTavern’s own default order for a preset that has none', () => {
    const { preset } = convert({ prompts: BOTH.prompts, prompt_order: undefined });

    expect(ordered(preset.blocks)).toEqual([
      ['st.main', true],
      ['st.worldInfoBefore', true],
      ['st.personaDescription', true],
      ['st.charDescription', true],
      ['st.charPersonality', true],
      ['st.scenario', true],
      ['st.nsfw', true],
      ['st.worldInfoAfter', true],
      ['st.dialogueExamples', true],
      ['st.chatHistory', true],
      // Not in the default order, so SillyTavern would hold it and not send it.
      ['st.rules', false],
    ]);
  });

  it('reads the first definition of an identifier, and one block for an id', () => {
    const { preset, notes } = convert({
      prompts: [
        { identifier: 'main', role: 'system', content: 'The first.' },
        { identifier: 'main', role: 'system', content: 'The second.' },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'main', enabled: true },
          ],
        },
      ],
    });

    const main = preset.blocks.filter((block) => block.id === 'st.main');
    expect(main).toHaveLength(1);
    expect(main[0]?.kind === 'text' ? main[0].template : '').toBe('The first.');
    expect(notes.find((one) => one.key === 'import.preset.duplicatesDropped')).toMatchObject({
      params: { identifiers: 'main' },
      level: 'warn',
    });
  });

  /**
   * *Before the prompt manager*, a chat preset kept its prompts in three
   * fields and had no `prompts`. SillyTavern still loads one, by migrating it
   * into its default set; this refused it in a folder, and took it for a
   * sampler panel uploaded on its own.
   */
  it('reads a preset from before the prompt manager the way SillyTavern upgrades one', () => {
    const result = convertChatCompletionPreset(
      {
        main_prompt: 'You are the narrator.',
        jailbreak_prompt: 'Stay in the scene.',
        temperature: 0.9,
      },
      'Old',
    );
    if (!result.ok) throw new Error(`refused: ${result.refusal}`);
    const { preset, notes } = result.value;
    const ids = preset.blocks.map((block) => block.id);

    expect(ids[0]).toBe('st.main');
    expect(ids.indexOf('st.jailbreak')).toBe(ids.indexOf('st.chatHistory') + 1);
    expect(preset.params.temperature).toBe(0.9);
    expect(preset.compat).not.toHaveProperty('main_prompt');
    expect(keys(notes)).toContain('import.preset.fromBeforePromptManager');
  });
});

/**
 * ***A prompt's triggers, as calls here*** (2026-09-27). SillyTavern's are its
 * generation types, and `normal` is every ordinary turn: carried through
 * verbatim, a block triggered on it skipped on every turn of every mode.
 */
describe('what a prompt’s triggers mean here', () => {
  function triggered(injection_trigger: string[]) {
    return convert({
      prompts: [{ identifier: 'main', role: 'system', content: 'Hi.', injection_trigger }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    });
  }

  it('applies a prompt triggered on an ordinary turn to every narration', () => {
    const { preset } = triggered(['normal']);
    expect(preset.blocks.find((block) => block.id === 'st.main')?.appliesTo).toEqual(['narrate']);

    // And the collector agrees: it is in a narration's candidates.
    const { candidates } = collectCandidates({
      preset,
      callKind: 'narrate',
      history: [],
      persona: null,
      actors: [],
      channels: {},
      modeId: DEFAULT_MODE_ID,
    });
    expect(candidates.map((candidate) => candidate.id)).toContain('st.main');
  });

  it('translates the kinds that have a call, and keeps the rest as written', () => {
    const { preset, notes } = triggered(['impersonate', 'swipe']);

    expect(preset.blocks.find((block) => block.id === 'st.main')?.appliesTo).toEqual([
      'impersonate',
      'swipe',
    ]);
    expect(keys(notes)).not.toContain('import.preset.triggerHasNoCall');
  });

  it('says when a prompt can never apply here', () => {
    const { preset, notes } = triggered(['swipe', 'quiet']);

    expect(preset.blocks.find((block) => block.id === 'st.main')?.appliesTo).toEqual([
      'swipe',
      'quiet',
    ]);
    expect(notes.find((one) => one.key === 'import.preset.triggerHasNoCall')?.params).toEqual({
      identifier: 'main',
      triggers: 'swipe, quiet',
    });
  });
});

describe('what must never survive', () => {
  it('drops every credential, from the object and from compat', () => {
    // §8.4.4, and the reason it is unconditional rather than a prompt: the
    // person importing is not the person at risk.
    const { preset } = convert();
    const serialised = JSON.stringify(preset);

    expect(serialised).not.toContain('this must never reach disk');
    expect(serialised).not.toContain('example.invalid');
    for (const field of SILLYTAVERN_SENSITIVE_FIELDS) {
      expect(serialised, `${field} survived`).not.toContain(field);
    }
  });

  it('names the credentials it removed, and only the ones that were there', () => {
    // Reporting matters as much as removing: a circulating file containing
    // somebody's credential is worth knowing about. But `custom_url` is present
    // and empty in this preset, and reporting eleven removals on a file that
    // carried two would train people to ignore the message.
    const { notes } = convert();
    const removal = notes.find((n) => n.key === 'import.preset.credentialsRemoved');

    expect(removal?.level).toBe('warn');
    expect(removal?.params['fields']).toBe('reverse_proxy, proxy_password');
  });
});

describe('what must survive exactly', () => {
  it('produces an object the shipped schema accepts', () => {
    // The converter's output is a portable file. If it does not validate, the
    // import writes something the library will refuse to read back.
    const { preset } = convert();
    const schemaId = schemaIdOf(preset);

    expect(schemaId).not.toBeNull();
    expect(isKnownSchema(schemaId ?? '')).toBe(true);
    const result = validate(preset);
    expect(result.valid, result.valid ? '' : JSON.stringify(result.issues)).toBe(true);
  });

  it('keeps the order the preset declared, and the disabled flag with it', () => {
    const { preset } = convert();

    expect(preset.blocks.slice(0, 6).map((b) => b.id)).toEqual([
      'st.main',
      'st.personaDescription',
      'st.charDescription',
      'st.charPersonality',
      'st.worldInfoBefore',
      'st.chatHistory',
    ]);
    expect(preset.blocks.find((b) => b.id === 'st.charPersonality')?.enabled).toBe(false);
  });

  it('maps the markers to the slots the card importer fills', () => {
    const { preset } = convert();
    const sources = new Map(
      preset.blocks.filter((b) => b.kind === 'slot').map((b) => [b.id, b.source]),
    );

    expect(sources.get('st.charDescription')).toEqual({ of: 'actor', sectionId: 'se.summary' });
    // The row an earlier draft got wrong: `se.voice` reads sensibly alone and
    // is broken against card import, which routes `personality` to `traits`.
    expect(sources.get('st.charPersonality')).toEqual({ of: 'actor', field: 'traits' });
    expect(sources.get('st.personaDescription')).toEqual({ of: 'persona' });
    expect(sources.get('st.worldInfoBefore')).toEqual({ of: 'lore', phase: 'before' });
    expect(sources.get('st.chatHistory')).toEqual({ of: 'history' });
  });

  it('carries depth through 1:1, in messages', () => {
    // Any table converting turns to messages would reintroduce the doubled-depth
    // bug F36 fixed. ST counts messages; so do we; so this is a copy.
    const { preset } = convert();
    const depth = preset.blocks.find((b) => b.id === 'st.atDepth4');

    expect(depth?.placement).toEqual({ at: 'in-history', fromEnd: 4, tiebreak: 100 });
  });

  it('converts the macros in authored prose, and leaves the prose', () => {
    const { preset } = convert();
    const main = preset.blocks.find((b) => b.id === 'st.main');

    expect(main?.kind).toBe('text');
    expect(main?.kind === 'text' ? main.template : '').toBe('You are {{ char }}.');
  });
});

describe('the nine fixed fields become two general properties', () => {
  it('turns the format strings into the wrapper of the slot they framed', () => {
    // §8.4.3's whole argument: an author can now wrap *any* slot, rather than
    // the combinations somebody anticipated.
    const { preset } = convert();
    const lore = preset.blocks.find((b) => b.id === 'st.worldInfoBefore');

    expect(lore?.kind === 'slot' ? lore.wrapper : null).toBe('[Lore: {{content}}]');
  });

  /**
   * ***Only the field's own placeholder is the content*** (2026-09-27).
   * SillyTavern's own `personality_format` in 1.11 and 1.12 is
   * `[{{char}}'s personality: {{personality}}]`, and every `{{…}}` was taken
   * for the content: the traits went out twice, with no name.
   */
  it('makes only the field’s own placeholder the content, and the name a name', () => {
    const { preset } = convert({ personality_format: "[{{char}}'s personality: {{personality}}]" });
    const personality = preset.blocks.find((b) => b.id === 'st.charPersonality');
    const wrapper = personality?.kind === 'slot' ? (personality.wrapper ?? '') : '';

    expect(wrapper).toBe("[{{ char }}'s personality: {{content}}]");

    // And the collector says it the way SillyTavern did.
    const vera = newActor('Vera');
    vera.profile.traits = ['watchful', 'dry'];
    const { candidates } = collectCandidates({
      preset: {
        ...preset,
        blocks: personality === undefined ? [] : [{ ...personality, enabled: true }],
      },
      callKind: 'narrate',
      history: [],
      persona: null,
      actors: [{ actor: vera, contentHash: 'h' }],
      channels: {},
      modeId: DEFAULT_MODE_ID,
    });
    expect(candidates.map((candidate) => candidate.text)).toEqual([
      "[Vera's personality: watchful, dry]",
    ]);
  });

  it('flags a macro in a format string it does not know, naming the field', () => {
    const { preset, notes } = convert({
      scenario_format: 'Scenario: {{scenario}} {{fictitious}}',
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'scenario', enabled: true }] }],
    });
    const scenario = preset.blocks.find((b) => b.id === 'st.scenario');

    expect(scenario?.kind === 'slot' ? scenario.wrapper : null).toBe(
      'Scenario: {{content}} {{fictitious}}',
    );
    expect(notes.find((n) => n.key === 'import.macro.unrecognised')?.params).toEqual({
      macro: 'fictitious',
      block: 'scenario_format',
    });
  });

  it('sends no seed for SillyTavern’s -1, which means random, and keeps a real one', () => {
    expect(convert({ seed: -1 }).preset.params).not.toHaveProperty('seed');
    expect(convert({ seed: 42 }).preset.params.seed).toBe(42);
  });

  it('turns the nudge prompts into blocks gated on a call kind', () => {
    // Worth converting rather than dropping: `continue_nudge_prompt` is why
    // *continue* works at all.
    const { preset } = convert();
    const continueBlock = preset.blocks.find((b) => b.id === 'st.continue_nudge_prompt');

    expect(continueBlock?.appliesTo).toEqual(['continue']);
    expect(continueBlock?.kind === 'text' ? continueBlock.template : '').toBe(
      'Continue from where {{ char }} left off.',
    );
    expect(preset.blocks.find((b) => b.id === 'st.impersonation_prompt')?.appliesTo).toEqual([
      'impersonate',
    ]);
  });
});

describe('what must be reported rather than silently done', () => {
  it('says the context ceiling was absolute, because 8192 reads like a window', () => {
    const { preset, notes } = convert();

    expect(preset.budget.maxContextTokens).toBe(8192);
    expect(keys(notes)).toContain('import.preset.contextCeilingWasAbsolute');
  });

  it('warns and names the characters when per-character orders are dropped', () => {
    // §8.4.2: one preset plus a warning naming them, rather than a silent
    // choice among them.
    const { notes } = convert({
      prompt_order: [
        ...PRESET.prompt_order,
        { character_id: 42, order: [{ identifier: 'main', enabled: true }] },
      ],
    });
    const dropped = notes.find((n) => n.key === 'import.preset.perCharacterOrdersDropped');

    expect(dropped?.level).toBe('warn');
    expect(dropped?.params['characters']).toBe('42');
  });

  it('flags an unrecognised macro and leaves it in the template', () => {
    const { preset, notes } = convert({
      prompts: [{ identifier: 'main', content: 'Hello {{fictitious}}' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    });
    const main = preset.blocks[0];

    expect(main?.kind === 'text' ? main.template : '').toBe('Hello {{fictitious}}');
    expect(notes.find((n) => n.key === 'import.macro.unrecognised')?.level).toBe('warn');
  });

  it('warns rather than silently dropping a marker it does not know', () => {
    // A marker this build cannot map leaves a hole in the prompt. Dropping it
    // quietly is the failure mode the whole review exists to prevent.
    const { preset, notes } = convert({
      prompts: [{ identifier: 'smartContext', name: 'Smart Context', marker: true }],
      prompt_order: [
        { character_id: 100001, order: [{ identifier: 'smartContext', enabled: true }] },
      ],
    });

    expect(preset.blocks).toHaveLength(2); // the two call-kind blocks only
    expect(notes.find((n) => n.key === 'import.preset.unknownMarker')?.params['identifier']).toBe(
      'smartContext',
    );
  });
});

describe('conversions this build makes and the source did not', () => {
  it('gives every block the same priority, and does not pretend the source had one', () => {
    // [00 §2.6] requires every block budgeted; ST presets carry no priorities.
    // Inventing a ladder would imply a fidelity the file does not contain.
    const { preset } = convert();

    expect(new Set(preset.blocks.map((b) => b.priority))).toEqual(new Set([50]));
  });

  it('never marks a converted block advisory', () => {
    // Nothing in ST's format is guidance-shaped, and an advisory block reaching
    // a future effects-purpose call aborts the turn.
    const { preset } = convert();

    expect(preset.blocks.every((b) => !b.advisory)).toBe(true);
  });

  it('takes the model as a wish and preserves the rest verbatim', () => {
    const { preset } = convert();

    expect(preset.modelHint?.preferredModelIds).toEqual(['gpt-4']);
    // [04 §2]'s preservation rule: unrecognised fields survive in `compat`, so
    // nothing is lost even where nothing reads it.
    expect(preset.compat?.['chat_completion_source']).toBe('openai');
  });
});

/**
 * ***A prompt's fields are read as the types they have to be*** (2026-09-27).
 *
 * The table below tries the preset's own shape; these try one prompt inside
 * it. A `content` that was not a string reached `String.prototype.replace` and
 * threw out of the sweep, and a `name`, trigger or depth of the wrong kind made
 * a block the schema refused, which lost the whole preset.
 */
describe('one prompt of the wrong shape', () => {
  function withPrompt(prompt: Record<string, unknown>) {
    return convert({
      prompts: [{ identifier: 'main', name: 'Main', content: 'You are here.' }, prompt],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: String(prompt['identifier']), enabled: true },
          ],
        },
      ],
    });
  }

  for (const content of [5, {}, [], true]) {
    it(`answers, and keeps the rest of the preset, for content ${JSON.stringify(content)}`, () => {
      const { preset, notes } = withPrompt({ identifier: 'odd', name: 'Odd', content });

      expect(validate(preset).valid).toBe(true);
      // The two the order lists; the nudge fields add their own after them.
      expect(preset.blocks.slice(0, 2).map((block) => block.id)).toEqual(['st.main', 'st.odd']);
      expect(notes).toContainEqual({
        key: 'import.preset.promptFieldsIgnored',
        params: { identifier: 'odd', fields: 'content' },
        level: 'warn',
      });
    });
  }

  it('reads a name, a trigger and a depth of the wrong kind as absent', () => {
    const { preset, notes } = withPrompt({
      identifier: 'odd',
      name: 5,
      content: 'Mind the tide.',
      injection_trigger: 'normal',
      injection_position: 1,
      injection_depth: -1,
    });

    expect(validate(preset).valid).toBe(true);
    expect(notes).toContainEqual({
      key: 'import.preset.promptFieldsIgnored',
      params: { identifier: 'odd', fields: 'name, injection_depth, injection_trigger' },
      level: 'warn',
    });
  });

  it('takes a prompt called `constructor` as the text it is', () => {
    // A plain lookup of the marker table found `Object` for it, and a block
    // whose source was a function lost the whole preset its validation.
    const { preset } = withPrompt({ identifier: 'constructor', content: 'Built to last.' });

    expect(validate(preset).valid).toBe(true);
    expect(preset.blocks.find((block) => block.id === 'st.constructor')).toMatchObject({
      kind: 'text',
      template: 'Built to last.',
    });
  });
});

/**
 * ***The review names a bounded number of macros*** (2026-09-27). One note per
 * distinct macro per block had no limit, and a limit per block is beaten by
 * having many blocks — two thousand prompts of twenty made-up macros each was
 * forty thousand notes, and a file at the upload limit made more than one
 * string can hold.
 */
describe('a preset with more macros than a review can name', () => {
  it('names up to the limit and counts the rest in one note', () => {
    const prompts = Array.from({ length: 2000 }, (_, at) => ({
      identifier: `p${String(at)}`,
      content: Array.from(
        { length: 20 },
        (__, one) => `{{made_up_${String(at)}_${String(one)}}}`,
      ).join(' '),
    }));
    const { notes } = convert({
      prompts,
      prompt_order: [
        {
          character_id: 100001,
          order: prompts.map((prompt) => ({ identifier: prompt.identifier, enabled: true })),
        },
      ],
    });

    const named = notes.filter((one) => one.key === 'import.macro.unrecognised');
    expect(named).toHaveLength(MACRO_NOTE_LIMIT);
    expect(notes.filter((one) => one.key === 'import.macro.unlisted')).toEqual([
      {
        key: 'import.macro.unlisted',
        params: { count: 2000 * 20 - MACRO_NOTE_LIMIT },
        level: 'warn',
      },
    ]);
  });
});

describe('the parses-but-is-wrong table', () => {
  for (const { label, input } of malformedInputs(PRESET, ['prompts'])) {
    it(`answers with a status for ${label}`, () => {
      expect(() => convertChatCompletionPreset(input, 'Harbour')).not.toThrow();
      expect(convertChatCompletionPreset(input, 'Harbour').ok).toBe(false);
    });
  }
});
