// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { readUpload, type ProbeConfidence } from './upload.js';

/**
 * What one uploaded file is, decided by its content
 * ([P4 §7.1](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **The probe had no test file of its own until this one**, which is how the
 * ordering claims in its comment stayed claims. It was exercised incidentally
 * through `routes/import.test.ts` and `loose-files.test.ts`, both of which ask
 * about a whole route or a whole walk — so *"order is load-bearing and the
 * reason is collisions on `name`"* was true and unchecked, and the three
 * template arms added beside it would have been three more of the same.
 *
 * The fixtures are the real thing rather than plausible ones:
 *   source  SillyTavern/default/content/presets/{instruct,context,reasoning}/
 *   commit  8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8 (2026-07-07)
 *   taken   2026-09-01
 * — the same snapshot commit `registries/sillytavern.ts` and
 * `sensitive-fields.ts` already vendor from, which is worth keeping true.
 */

function read(body: unknown, confidence: ProbeConfidence = 'any') {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return readUpload('Whatever.json', bytes, confidence);
}

/** `presets/instruct/ChatML.json`, trimmed to the fields that matter here. */
const INSTRUCT = {
  input_sequence: '<|im_start|>user\n',
  output_sequence: '<|im_start|>assistant\n',
  last_output_sequence: '',
  system_sequence: '<|im_start|>system\n',
  stop_sequence: '<|im_end|>',
  input_suffix: '<|im_end|>\n',
  output_suffix: '<|im_end|>\n',
  system_suffix: '<|im_end|>\n',
  wrap: false,
  macro: true,
  names_behavior: 'always',
  activation_regex: '',
  system_same_as_user: false,
  // The two that sit closest to the context template's own mark, and the reason
  // the context probe asks for `story_string` exactly.
  story_string_prefix: '',
  story_string_suffix: '',
  name: 'ChatML',
};

/** `presets/context/ChatML.json`. */
const CONTEXT = {
  story_string:
    '<|im_start|>system\n{{#if system}}{{system}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}<|im_end|>',
  example_separator: '',
  chat_start: '',
  use_stop_strings: false,
  names_as_stop_strings: true,
  story_string_position: 0,
  story_string_depth: 1,
  story_string_role: 0,
  always_force_name2: true,
  trim_sentences: false,
  single_line: false,
  name: 'ChatML',
};

/** `presets/reasoning/DeepSeek.json` — the whole format, all four fields. */
const REASONING = {
  name: 'DeepSeek',
  prefix: '<think>\n',
  suffix: '\n</think>',
  separator: '\n\n',
};

describe('a SillyTavern template, uploaded on its own', () => {
  const cases = [
    {
      label: 'an instruct template',
      body: INSTRUCT,
      disposition: 'by-position',
      key: 'import.template.instruct',
    },
    {
      label: 'a context template',
      body: CONTEXT,
      disposition: 'by-position',
      key: 'import.template.context',
    },
    {
      label: 'a reasoning template',
      body: REASONING,
      disposition: 'skipped',
      key: 'import.template.reasoning',
    },
  ] as const;

  for (const { label, body, disposition, key } of cases) {
    /**
     * The defect this closes: each of these came back `unrecognised` — *"Nothing
     * here recognised this file"* — about a file the sweep reads by position one
     * code path over.
     */
    it(`${label} is named rather than shrugged at`, () => {
      const result = read(body);

      expect(result.outcome).toBe('observed');
      if (result.outcome !== 'observed') throw new Error('unreachable');
      expect(result.report.disposition).toBe(disposition);
      expect(result.report.notes.map((n) => n.key)).toEqual([key]);
      expect(result.report.notes[0]?.level).toBe('info');
    });

    it(`${label} is never a candidate, because nothing converts one`, () => {
      // A candidate is *one thing a converter can act on*. Wrapping these would
      // mean an arm in `Writer`'s switch that exists to return nothing.
      expect(read(body).outcome).toBe('observed');
      expect(read(body, 'high').outcome).toBe('observed');
    });

    it(`${label} reads the same way in a folder sweep`, () => {
      // Above the confidence gate on purpose: each probe demands two or three
      // co-occurring names only SillyTavern uses, so a sweep may trust them.
      const swept = read(body, 'high');
      if (swept.outcome !== 'observed') throw new Error('unreachable');
      expect(swept.report.disposition).toBe(disposition);
    });
  }
});

describe('the probe order, adversarially', () => {
  /**
   * The three arms above the templates must stay unreachable from below. Each
   * case here is a file that matches a template mark *and* something more
   * distinctive, and the more distinctive answer has to win.
   */
  it('a chat preset that also carries story_string is still a preset', () => {
    const result = read({ prompts: [{ identifier: 'main', content: 'x' }], story_string: 'x' });

    if (result.outcome !== 'candidate') throw new Error('expected a candidate');
    expect(result.candidate.format).toBe('sillytavern.preset.chat');
  });

  it('a lorebook that also carries the instruct pair is still a lorebook', () => {
    const result = read({ entries: {}, input_sequence: 'a', output_sequence: 'b' });

    if (result.outcome !== 'candidate') throw new Error('expected a candidate');
    expect(result.candidate.format).toBe('sillytavern.lorebook');
  });

  it('a card that also carries the reasoning triple is still a card', () => {
    const result = read({
      name: 'Vera',
      first_mes: 'Hello.',
      prefix: 'a',
      suffix: 'b',
      separator: 'c',
    });

    if (result.outcome !== 'candidate') throw new Error('expected a candidate');
    expect(result.candidate.format).toBe('sillytavern.card');
  });

  it('an instruct template is not read as a context one', () => {
    // `story_string_prefix` is a real instruct field and the near miss the
    // context probe is written narrowly to avoid.
    const result = read(INSTRUCT);
    if (result.outcome !== 'observed') throw new Error('unreachable');
    expect(result.report.notes[0]?.key).toBe('import.template.instruct');
  });

  it('a sysprompt preset still wins over nothing, and only below the gate', () => {
    // Unchanged behaviour, asserted because the new arms sit directly above it.
    const loose = read({ name: 'Harbour', content: 'You are a narrator.' });
    if (loose.outcome !== 'candidate') throw new Error('expected a candidate');
    expect(loose.candidate.format).toBe('sillytavern.preset.sysprompt');

    expect(read({ name: 'Harbour', content: 'You are a narrator.' }, 'high').outcome).toBe(
      'observed',
    );
  });
});

describe('the probe is not over-eager', () => {
  it('refuses a partial reasoning triple', () => {
    const result = read({ prefix: 'a', suffix: 'b' });

    if (result.outcome !== 'observed') throw new Error('unreachable');
    expect(result.report.notes[0]?.key).toBe('import.file.unrecognised');
  });

  it('refuses half the instruct pair', () => {
    const result = read({ input_sequence: 'x', name: 'Half' });

    if (result.outcome !== 'observed') throw new Error('unreachable');
    expect(result.report.notes[0]?.key).toBe('import.file.unrecognised');
  });

  it('refuses a non-string mark', () => {
    // `story_string: true` is not a context template, and a truthiness check
    // here would have said it was.
    const result = read({ story_string: true, name: 'Nope' });

    if (result.outcome !== 'observed') throw new Error('unreachable');
    expect(result.report.notes[0]?.key).toBe('import.file.unrecognised');
  });

  it('still refuses the config file that started all this', () => {
    // `appsettings.json` matched the `content` arm in review and was imported as
    // a preset. It has no template mark either, and must not gain one.
    const result = read({ name: 'my-app', version: '1.0.0', description: 'A thing.' }, 'high');

    if (result.outcome !== 'observed') throw new Error('unreachable');
    expect(result.report.disposition).toBe('unrecognised');
  });
});
