// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { validate } from '@storyengine/shared';

import { MACRO_NOTE_LIMIT } from '../macros.js';
import { malformedInputs } from '../parse.js';
import { convertSyspromptPreset } from './sysprompt.js';
import { convertTextCompletionPreset } from './text-completion.js';

/**
 * The two preset kinds that are not chat-completion: the easy case and the one
 * that looks like it worked ([04 §8.4.2]).
 */

const SYSPROMPT = {
  name: 'Harbour',
  content: 'You are {{char}}. Write the scene.',
  post_history: 'Stay in third person.',
};

/** A realistic local-backend sampler panel: a lot of fields, few of them ours. */
const TEXT_COMPLETION = {
  temp: 0.85,
  top_p: 0.92,
  top_k: 40,
  rep_pen: 1.1,
  // As SillyTavern saves a text-generation panel: the reply in `genamt`, the
  // context in `max_length`.
  genamt: 400,
  max_length: 8192,
  dry_multiplier: 0.8,
  dry_base: 1.75,
  dry_allowed_length: 2,
  dry_sequence_breakers: '["\\n"]',
  smoothing_factor: 0.3,
  smoothing_curve: 1,
  mirostat_mode: 2,
  mirostat_tau: 5,
  mirostat_eta: 0.1,
  xtc_threshold: 0.1,
  xtc_probability: 0.5,
  tfs: 1,
  eta_cutoff: 0,
  epsilon_cutoff: 0,
  num_beams: 1,
  encoder_rep_pen: 1,
  no_repeat_ngram_size: 0,
};

describe('a sysprompt preset', () => {
  const result = convertSyspromptPreset(SYSPROMPT, 'Harbour');
  if (!result.ok) throw new Error('refused');
  const { preset, notes } = result.value;

  it('validates', () => {
    const result = validate(preset);
    expect(result.valid, result.valid ? '' : JSON.stringify(result.issues)).toBe(true);
  });

  it('puts the content first and the post-history instruction after the history slot', () => {
    expect(preset.blocks.map((b) => b.id)).toEqual([
      'st.sysprompt.content',
      'st.sysprompt.history',
      'st.sysprompt.postHistory',
    ]);
  });

  it('pins the post-history block *after* history rather than at depth zero', () => {
    // The obvious conversion reads the same in English and is wrong: depth zero
    // puts the block inside the history run, where it moves as the window
    // slides and comes under trimming with the messages around it.
    const post = preset.blocks.find((b) => b.id === 'st.sysprompt.postHistory');

    expect(post?.placement).toEqual({ at: 'sequence' });
    expect(notes.map((n) => n.key)).toContain('import.preset.postHistoryIsAfterNotAtDepth');
  });

  it('names a bounded number of macros across both of its fields', () => {
    const many = (prefix: string) =>
      Array.from({ length: MACRO_NOTE_LIMIT }, (_, at) => `{{${prefix}_${String(at)}}}`).join(' ');
    const result = convertSyspromptPreset(
      { name: 'Harbour', content: many('first'), post_history: many('second') },
      'Harbour',
    );
    if (!result.ok) throw new Error('refused');

    expect(result.value.notes.filter((n) => n.key === 'import.macro.unrecognised')).toHaveLength(
      MACRO_NOTE_LIMIT,
    );
    expect(result.value.notes.find((n) => n.key === 'import.macro.unlisted')?.params).toEqual({
      count: MACRO_NOTE_LIMIT,
    });
  });

  it('converts the macros in it', () => {
    const content = preset.blocks[0];

    expect(content?.kind === 'text' ? content.template : '').toBe(
      'You are {{ char }}. Write the scene.',
    );
  });

  /**
   * ***A macro taken out is said*** (2026-09-27): this converter reported the
   * unrecognised ones only, so a `{{date}}` left the prompt without a word.
   */
  it('says which macros it took out, and why', () => {
    const result = convertSyspromptPreset(
      { ...SYSPROMPT, content: 'Today is {{date}}. Mood: {{mood}}.' },
      'Dated',
    );
    if (!result.ok) throw new Error('refused');
    const { preset: converted, notes } = result.value;

    const content = converted.blocks[0];
    expect(content?.kind === 'text' ? content.template : '').toBe('Today is . Mood: {{mood}}.');
    expect(notes.find((n) => n.key === 'import.macro.refused')?.params).toEqual({
      macro: 'date',
      block: 'st.sysprompt.content',
      because: 'time-is-not-reproducible',
    });
    expect(notes.find((n) => n.key === 'import.macro.unrecognised')?.params['macro']).toBe('mood');
  });

  for (const { label, input } of malformedInputs(SYSPROMPT, ['content'])) {
    it(`answers with a status for ${label}`, () => {
      expect(() => convertSyspromptPreset(input, 'x')).not.toThrow();
    });
  }
});

describe('a text-completion preset', () => {
  const result = convertTextCompletionPreset(TEXT_COMPLETION, 'Local');
  if (!result.ok) throw new Error('refused');
  const { preset, notes } = result.value;

  it('validates, and carries only what a chat endpoint understands', () => {
    expect(validate(preset).valid).toBe(true);
    expect(preset.params.temperature).toBe(0.85);
    expect(preset.params.maxTokens).toBe(400);
  });

  /**
   * ***`max_length` is whichever length the backend means*** (2026-09-27). It
   * was read as the reply beside `genamt`, so a panel's context size went
   * nowhere; and a NovelAI panel, where it *is* the reply, must not become a
   * 150-token context.
   */
  it('reads max_length as the context size when genamt is beside it', () => {
    expect(preset.budget.maxContextTokens).toBe(8192);
    expect(preset.compat).not.toHaveProperty('max_length');
    expect(notes.find((n) => n.key === 'import.preset.contextCeilingWasAbsolute')?.params).toEqual({
      tokens: 8192,
    });
  });

  it('reads it as the reply when the panel is NovelAI’s, with max_context beside it', () => {
    const nai = convertTextCompletionPreset(
      { temperature: 1, max_length: 150, max_context: 8000 },
      'N',
    );
    if (!nai.ok) throw new Error('refused');

    expect(nai.value.preset.params.maxTokens).toBe(150);
    expect(nai.value.preset.budget.maxContextTokens).toBe(8000);
  });

  it('keeps it aside, and says so, when nothing says which it is', () => {
    const alone = convertTextCompletionPreset({ temperature: 1, max_length: 2048 }, 'Alone');
    if (!alone.ok) throw new Error('refused');

    expect(alone.value.preset.params.maxTokens).toBeUndefined();
    expect(alone.value.preset.budget.maxContextTokens).toBeNull();
    expect(alone.value.preset.compat?.['max_length']).toBe(2048);
    expect(
      alone.value.notes.find((n) => n.key === 'import.preset.maxLengthUnclear')?.params,
    ).toEqual({ tokens: 2048 });
  });

  it('sends no seed for SillyTavern’s -1, which means random', () => {
    const random = convertTextCompletionPreset({ temp: 0.8, seed: -1 }, 'Random');
    const fixed = convertTextCompletionPreset({ temp: 0.8, seed: 42 }, 'Fixed');
    if (!random.ok || !fixed.ok) throw new Error('refused');

    expect(random.value.preset.params).not.toHaveProperty('seed');
    expect(fixed.value.preset.params.seed).toBe(42);
  });

  it('keeps a field named like a property of every object in compat', () => {
    // A plain index found `Object` for `constructor` and `Object.prototype`'s
    // method for `toString`, read them as fields of ours, and so dropped them
    // from `compat` without a word (2026-09-27).
    const odd = convertTextCompletionPreset(
      { ...TEXT_COMPLETION, constructor: 'kept', toString: 'kept too' },
      'Local',
    );
    if (!odd.ok) throw new Error('refused');
    const kept = (key: string): unknown =>
      Object.hasOwn(odd.value.preset.compat ?? {}, key)
        ? odd.value.preset.compat?.[key]
        : undefined;

    expect(kept('constructor')).toBe('kept');
    expect(kept('toString')).toBe('kept too');
  });

  it('keeps the backend-specific samplers in compat rather than dropping them', () => {
    // §8.4.2 said these "drop"; `GenerationParams`' own comment says `compat`.
    // The code comment wins, because it is the reading consistent with [04 §2]'s
    // preservation rule and [00 §2.4]'s *nothing is lost*.
    expect(preset.compat?.['mirostat_tau']).toBe(5);
    expect(preset.compat?.['dry_multiplier']).toBe(0.8);
    expect(preset.compat?.['xtc_threshold']).toBe(0.1);
  });

  it('reports the ratio, and warns when almost nothing carried', () => {
    // Without this the import looks like it worked: the object exists, it
    // validates, and almost nothing about it survived.
    const ratio = notes.find((n) => n.key === 'import.preset.samplerRatio');

    expect(ratio?.level).toBe('warn');
    expect(ratio?.params['carried']).toBe(5);
    expect(ratio?.params['total']).toBe(Object.keys(TEXT_COMPLETION).length);
  });

  it('counts our fields filled, not theirs read', () => {
    // `temp` and `temperature` both map to `temperature`; a file setting both
    // must not report two.
    const both = convertTextCompletionPreset({ temp: 0.8, temperature: 0.9 }, 'Local');
    if (!both.ok) throw new Error('refused');

    expect(
      both.value.notes.find((n) => n.key === 'import.preset.samplerRatio')?.params['carried'],
    ).toBe(1);
  });

  it('says out loud that it converted no blocks, because that looks like a bug', () => {
    expect(preset.blocks).toHaveLength(0);
    expect(notes.map((n) => n.key)).toContain('import.preset.noBlocksInSamplerPreset');
  });

  for (const { label, input } of malformedInputs(TEXT_COMPLETION, ['temp'])) {
    it(`answers with a status for ${label}`, () => {
      expect(() => convertTextCompletionPreset(input, 'x')).not.toThrow();
    });
  }
});

describe('the credential rule, on the two converters that were not applying it', () => {
  /**
   * **The gap this closes.** [04 §8.4.4] drops ST's `sensitiveFields` from every
   * preset unconditionally and offers no *"import as-is"* anywhere, but only
   * `convertChatCompletionPreset` was doing it — the other two copied every
   * unconsumed field into `compat` verbatim. `invariants.test.ts` walks schema
   * declarations and `compat` is `Record<string, unknown>`, so nothing denied it.
   *
   * The reachable path is short: `upload.ts`'s `SAMPLERISH` arm classifies any
   * object with a `temperature` number as a text-completion preset, so a single
   * uploaded file carrying a temperature and a proxy password was enough.
   */
  const CREDENTIALS = {
    reverse_proxy: 'https://proxy.example/v1',
    proxy_password: 'hunter2',
    custom_url: 'https://elsewhere.example',
  };

  it('strips them from a sampler panel, and says which', () => {
    const result = convertTextCompletionPreset({ ...TEXT_COMPLETION, ...CREDENTIALS }, 'Local');
    if (!result.ok) throw new Error('refused');
    const { preset, notes } = result.value;

    // The value must not survive anywhere in the object, `compat` included —
    // asserted over the whole serialised preset rather than field by field,
    // because the point is that there is no route by which it travels.
    expect(JSON.stringify(preset)).not.toContain('hunter2');
    expect(JSON.stringify(preset)).not.toContain('proxy.example');
    expect(preset.compat?.['proxy_password']).toBeUndefined();
    expect(preset.compat?.['reverse_proxy']).toBeUndefined();

    const removed = notes.find((n) => n.key === 'import.preset.credentialsRemoved');
    expect(removed?.level).toBe('warn');
    // Names, never values — a value read out to be reported is one that reaches
    // a log.
    expect(removed?.params['fields']).toBe('reverse_proxy, proxy_password, custom_url');
  });

  it('strips them from a sysprompt preset too', () => {
    const result = convertSyspromptPreset({ ...SYSPROMPT, ...CREDENTIALS }, 'Harbour');
    if (!result.ok) throw new Error('refused');
    const { preset, notes } = result.value;

    expect(JSON.stringify(preset)).not.toContain('hunter2');
    expect(preset.compat?.['proxy_password']).toBeUndefined();
    expect(notes.map((n) => n.key)).toContain('import.preset.credentialsRemoved');
  });

  it('says nothing when the file carried none', () => {
    // ST writes these keys into every preset, so a note per empty key would
    // train people to ignore the one that matters.
    const result = convertTextCompletionPreset({ ...TEXT_COMPLETION, proxy_password: '' }, 'Local');
    if (!result.ok) throw new Error('refused');

    expect(result.value.notes.map((n) => n.key)).not.toContain('import.preset.credentialsRemoved');
  });

  it('still counts the credential in the ratio, because it was in the file', () => {
    const result = convertTextCompletionPreset({ temp: 0.8, proxy_password: 'x' }, 'Local');
    if (!result.ok) throw new Error('refused');
    const ratio = result.value.notes.find((n) => n.key === 'import.preset.samplerRatio');

    // A denominator that shrank would make a credential-carrying preset report a
    // better score than the same file without one.
    expect(ratio?.params['carried']).toBe(1);
    expect(ratio?.params['total']).toBe(2);
  });
});
