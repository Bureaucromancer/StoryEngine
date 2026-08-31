// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { isKnownSchema, schemaIdOf, validate } from '@storyengine/shared';

import { malformedInputs } from '../parse.js';
import { convertChatCompletionPreset } from './preset.js';
import { SILLYTAVERN_SENSITIVE_FIELDS } from './sensitive-fields.js';

/**
 * SillyTavern chat-completion presets → `Preset` ([10 §8.4]).
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
      character_id: 100000,
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

  it('falls back to the group default when there is no global order, and says so', () => {
    // The half §8.4.2 left unstated, decided at [P4 §1.1].
    const { notes, preset } = convert({
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    });

    expect(keys(notes)).toContain('import.preset.groupOrderUsed');
    expect(preset.blocks[0]?.id).toBe('st.main');
  });

  it('flags an unrecognised macro and leaves it in the template', () => {
    const { preset, notes } = convert({
      prompts: [{ identifier: 'main', content: 'Hello {{fictitious}}' }],
      prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }],
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
        { character_id: 100000, order: [{ identifier: 'smartContext', enabled: true }] },
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
    // [10 §2]'s preservation rule: unrecognised fields survive in `compat`, so
    // nothing is lost even where nothing reads it.
    expect(preset.compat?.['chat_completion_source']).toBe('openai');
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
