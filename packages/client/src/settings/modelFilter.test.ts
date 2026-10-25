// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { ModelModalities } from '../api.js';
import {
  NO_FILTER,
  filterOffered,
  hiddenUnknown,
  isFiltering,
  matchesQuery,
  modalityWords,
} from './modelFilter.js';

const OFFERED = [
  'meta-llama/llama-3.3-70b-instruct',
  'meta-llama/llama-3.2-11b-vision-instruct',
  'openai/gpt-4o',
  'black-forest-labs/flux-schnell',
  'mystery/model',
];

const KNOWN = new Map<string, ModelModalities>(
  [
    { id: 'meta-llama/llama-3.3-70b-instruct', input: ['text'], output: ['text'] },
    { id: 'meta-llama/llama-3.2-11b-vision-instruct', input: ['text', 'image'], output: ['text'] },
    { id: 'openai/gpt-4o', input: ['text', 'image', 'audio'], output: ['text'] },
    { id: 'black-forest-labs/flux-schnell', input: ['text'], output: ['image'] },
  ].map((each) => [each.id, each] as const),
);

describe('the model search', () => {
  /**
   * **Every word, in any order** — what a person remembers of
   * `vendor/family-size-variant` is two of the pieces, rarely in the order they
   * were joined.
   */
  it('matches every word anywhere in the id, ignoring case', () => {
    expect(matchesQuery('meta-llama/llama-3.3-70b-instruct', '70B llama')).toBe(true);
    expect(matchesQuery('meta-llama/llama-3.3-70b-instruct', 'llama 8b')).toBe(false);
    expect(matchesQuery('anything', '   ')).toBe(true);
  });
});

describe('filtering what an endpoint offers', () => {
  it('passes everything, in the endpoint’s order, with no filter', () => {
    expect(filterOffered(OFFERED, KNOWN, [], NO_FILTER)).toEqual(OFFERED);
    expect(isFiltering(NO_FILTER)).toBe(false);
  });

  /** All, not any: each extra tick narrows, as a capability filter should. */
  it('wants every modality ticked in a row, not any of them', () => {
    expect(filterOffered(OFFERED, KNOWN, [], { ...NO_FILTER, takes: ['image'] })).toEqual([
      'meta-llama/llama-3.2-11b-vision-instruct',
      'openai/gpt-4o',
    ]);
    expect(filterOffered(OFFERED, KNOWN, [], { ...NO_FILTER, takes: ['image', 'audio'] })).toEqual([
      'openai/gpt-4o',
    ]);
    expect(filterOffered(OFFERED, KNOWN, [], { ...NO_FILTER, gives: ['image'] })).toEqual([
      'black-forest-labs/flux-schnell',
    ]);
  });

  /**
   * **Unknown is not *text only*.** A model the endpoint said nothing about
   * fails a modality filter — passing it would put a possibly text-only model
   * in front of somebody who asked for vision — and is counted, so the page can
   * say it was hidden rather than imply it does not exist.
   */
  it('hides a model nothing was said about from a modality filter, and counts it', () => {
    const filter = { ...NO_FILTER, takes: ['text'] };
    expect(filterOffered(OFFERED, KNOWN, [], filter)).not.toContain('mystery/model');
    expect(hiddenUnknown(OFFERED, KNOWN, [], filter)).toBe(1);
    // The search still finds it, because the search is about the id.
    expect(filterOffered(OFFERED, KNOWN, [], { ...NO_FILTER, query: 'mystery' })).toEqual([
      'mystery/model',
    ]);
    expect(hiddenUnknown(OFFERED, KNOWN, [], { ...NO_FILTER, query: 'mystery' })).toBe(0);
  });

  it('narrows to the ticked ones, combined with the rest', () => {
    const chosen = ['openai/gpt-4o', 'meta-llama/llama-3.3-70b-instruct', 'typed/by-hand'];
    expect(filterOffered(OFFERED, KNOWN, chosen, { ...NO_FILTER, tickedOnly: true })).toEqual([
      'meta-llama/llama-3.3-70b-instruct',
      'openai/gpt-4o',
    ]);
    expect(
      filterOffered(OFFERED, KNOWN, chosen, { ...NO_FILTER, tickedOnly: true, query: 'llama' }),
    ).toEqual(['meta-llama/llama-3.3-70b-instruct']);
  });
});

describe('the modality words offered as filters', () => {
  it('offers the words the endpoint used, the familiar ones first in a fixed order', () => {
    const words = modalityWords([
      { id: 'a', input: ['video', 'image', 'text'], output: ['text'] },
      { id: 'b', input: ['zebra', 'audio'], output: ['image', 'text'] },
    ]);
    expect(words.input).toEqual(['text', 'image', 'audio', 'video', 'zebra']);
    expect(words.output).toEqual(['text', 'image']);
  });
});
