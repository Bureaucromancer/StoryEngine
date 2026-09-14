// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { capabilitiesFor, CONSERVATIVE_CAPABILITIES, isKnownProvider } from './capabilities.js';
import { budgetFor, capPrompt, type PromptFragment } from './prompt-caps.js';

/**
 * Prompt caps and capability negotiation — [20 §5.3], [22 §3].
 *
 * The failure being prevented is silent truncation: the request succeeds, the
 * tail is discarded, and the output is quietly worse. So the assertions here
 * are mostly about *what was said about the drop*, not only about the length.
 */

const fragments: PromptFragment[] = [
  { id: 'subject', text: 'a woman in a rain-soaked alley', rank: 100, required: true },
  { id: 'style', text: 'noir, high contrast', rank: 50 },
  { id: 'quality', text: 'detailed, sharp focus', rank: 10 },
  { id: 'extra', text: 'volumetric lighting', rank: 10 },
];

describe('assembling a prompt from ranked parts', () => {
  it('keeps everything when it fits', () => {
    const result = capPrompt(fragments, { maxChars: 1000, usefulChars: 1000 });

    expect(result.dropped).toEqual([]);
    expect(result.overCap).toBe(false);
    expect(result.text).toContain('rain-soaked alley');
  });

  it('drops whole fragments, lowest rank first, rather than cutting a sentence', () => {
    // Room for the subject and the style, not the two rank-10 tags.
    const result = capPrompt(fragments, { maxChars: 60, usefulChars: undefined });

    expect(result.kept).toEqual(['subject', 'style']);
    // The text is not a prefix of the full prompt — it is the kept parts, whole.
    expect(result.text).toBe('a woman in a rain-soaked alley, noir, high contrast');
    expect(result.dropped.map((d) => d.id)).toEqual(['extra', 'quality']);
  });

  it('gives up the later of two equally ranked fragments first', () => {
    // An author who lists two style notes loses the second before the first.
    const result = capPrompt(fragments, { maxChars: 80, usefulChars: undefined });
    expect(result.dropped[0]?.id).toBe('extra');
  });

  it('says which limit caused each drop', () => {
    // Both caps in play: the useful one trims first, and only what the hard cap
    // forces is attributed to the hard cap. A record that showed both as "too
    // long" would lose the difference between trimmed-for-quality and
    // would-have-been-rejected.
    // 95 chars whole. Dropping `extra` brings it to 74, under the useful cap —
    // so that drop is a quality decision. The hard cap of 52 then forces
    // `quality` out as well, and that one would have been a rejected request.
    const result = capPrompt(fragments, { maxChars: 52, usefulChars: 75 });

    expect(result.dropped).toEqual([
      { id: 'extra', rank: 10, reason: 'over-useful-cap' },
      { id: 'quality', rank: 10, reason: 'over-hard-cap' },
    ]);
    expect(result.kept).toEqual(['subject', 'style']);
  });

  it('never drops a required fragment, and admits when it still does not fit', () => {
    // The honest failure. Cutting the subject in half would produce a prompt
    // that looks fine and means something else.
    const result = capPrompt(fragments, { maxChars: 10, usefulChars: 10 });

    expect(result.kept).toEqual(['subject']);
    expect(result.overCap).toBe(true);
    expect(result.text).toBe('a woman in a rain-soaked alley');
  });

  it('treats an undeclared cap as undeclared, not as zero and not as infinite', () => {
    const result = capPrompt(fragments, { maxChars: undefined, usefulChars: undefined });

    expect(result.dropped).toEqual([]);
    expect(result.overCap).toBe(false);
    // And the budget travels with the result, so a record can show what was
    // being aimed at — including that nothing was.
    expect(result.budget).toEqual({ maxChars: undefined, usefulChars: undefined });
  });
});

describe('the budget a step is told about before it writes', () => {
  it('carries both numbers, because they are different questions', () => {
    const budget = budgetFor(capabilitiesFor('openai-compatible', { usefulPromptChars: 300 }));
    expect(budget.usefulChars).toBe(300);
    expect(budget.maxChars).toBeUndefined();
  });
});

describe('capability defaults', () => {
  it('gives an unknown provider the conservative baseline rather than refusing it', () => {
    // Someone pointing at an endpoint this build has never heard of is a
    // supported case, not an error: the alternative is shipping a release to
    // accept each new endpoint.
    expect(isKnownProvider('some-new-thing')).toBe(false);
    expect(capabilitiesFor('some-new-thing')).toEqual(CONSERVATIVE_CAPABILITIES);
  });

  it('lets a connection override the provider default, because a limit is the endpoint’s', () => {
    // Two OpenAI-compatible URLs can be a frontier model and a laptop.
    const laptop = capabilitiesFor('openai-compatible', {
      maxContextTokens: 8192,
      supportsStructuredOutput: false,
    });
    expect(laptop.maxContextTokens).toBe(8192);
    expect(laptop.supportsStructuredOutput).toBe(false);
  });

  it('records same-role merging as a property of the endpoint', () => {
    // The decision [22 §2] makes: not a global setting, because providers
    // differ and some reject consecutive same-role messages outright.
    expect(capabilitiesFor('anthropic').mergeSameRole).toBe('required');
    expect(capabilitiesFor('openai').mergeSameRole).toBe('preferred');
  });

  it('defaults every unknown capability to the pessimistic answer', () => {
    // A caller that degrades unnecessarily writes a slightly worse prompt. The
    // reverse builds a request the endpoint rejects, or accepts and mangles.
    expect(CONSERVATIVE_CAPABILITIES.supportsTools).toBe(false);
    expect(CONSERVATIVE_CAPABILITIES.supportsStructuredOutput).toBe(false);
    expect(CONSERVATIVE_CAPABILITIES.reportsUsage).toBe(false);
  });
});
