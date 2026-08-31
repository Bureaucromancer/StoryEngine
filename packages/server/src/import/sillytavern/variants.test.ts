// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { validate } from '@storyengine/shared';

import { malformedInputs } from '../parse.js';
import { convertSyspromptPreset } from './sysprompt.js';
import { convertTextCompletionPreset } from './text-completion.js';

/**
 * The two preset kinds that are not chat-completion: the easy case and the one
 * that looks like it worked ([10 §8.4.2]).
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
  max_length: 400,
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

  it('converts the macros in it', () => {
    const content = preset.blocks[0];

    expect(content?.kind === 'text' ? content.template : '').toBe(
      'You are {{ char }}. Write the scene.',
    );
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

  it('keeps the backend-specific samplers in compat rather than dropping them', () => {
    // §8.4.2 said these "drop"; `GenerationParams`' own comment says `compat`.
    // The code comment wins, because it is the reading consistent with [10 §2]'s
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
