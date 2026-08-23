// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../config.js';
import { CONSERVATIVE_CAPABILITIES } from '../providers/capabilities.js';
import { budgetPolicyFor, type PresetBudget } from './budget.js';

/**
 * Where the window comes from, and who may narrow it — [13 §1.5], [10 §8.3].
 *
 * This existed with no preset argument at all, so every shipped preset's
 * `contextShare` and `reserveOutputTokens` were written and read by nothing:
 * a pack declaring three quarters of the window got the whole config default.
 */

const config = DEFAULT_CONFIG;
const preset = (over: Partial<PresetBudget> = {}): PresetBudget => ({
  contextShare: 0.75,
  maxContextTokens: null,
  reserveOutputTokens: 1024,
  ...over,
});

describe('the window', () => {
  it('comes from the endpoint when it says, and the config when it does not', () => {
    // `capabilities.ts` refuses to invent a number it cannot verify, so without
    // the config default every turn would be unbudgetable.
    expect(budgetPolicyFor(CONSERVATIVE_CAPABILITIES, {}, config).limit).toEqual({
      tokens: config.limits.contextTokens,
      source: 'user',
    });

    const known = { ...CONSERVATIVE_CAPABILITIES, maxContextTokens: 32_000 };
    expect(budgetPolicyFor(known, {}, config).limit).toEqual({
      tokens: 32_000,
      source: 'provider',
    });
  });

  it('is narrowed by the share the preset is willing to spend', () => {
    const policy = budgetPolicyFor(CONSERVATIVE_CAPABILITIES, {}, config, preset());

    expect(policy.limit.tokens).toBe(Math.floor(config.limits.contextTokens * 0.75));
    // A first producer for a `source` the type has always had.
    expect(policy.limit.source).toBe('preset');
  });

  it('lets a preset cap the window but never raise it', () => {
    // [10 §8.3]'s whole argument: a preset written against a 4k window must not
    // silently misbehave at 200k. An absolute value that *won* would reproduce
    // exactly that, which is why it can only narrow.
    const big = { ...CONSERVATIVE_CAPABILITIES, maxContextTokens: 200_000 };

    const capped = budgetPolicyFor(
      big,
      {},
      config,
      preset({ maxContextTokens: 4_000, contextShare: 1 }),
    );
    expect(capped.limit.tokens).toBe(4_000);

    const cannotRaise = budgetPolicyFor(
      { ...CONSERVATIVE_CAPABILITIES, maxContextTokens: 8_000 },
      {},
      config,
      preset({ maxContextTokens: 500_000, contextShare: 1 }),
    );
    expect(cannotRaise.limit.tokens).toBe(8_000);
  });
});

describe('what is held back for the answer', () => {
  it('prefers the call, then the preset, then the config', () => {
    // A zero reserve is not "nothing was held back" — it is a budget that lets
    // assembly spend the window and leaves the answer no room.
    expect(
      budgetPolicyFor(CONSERVATIVE_CAPABILITIES, { maxTokens: 300 }, config, preset()).reserved,
    ).toBe(300);
    expect(
      budgetPolicyFor(CONSERVATIVE_CAPABILITIES, {}, config, preset({ reserveOutputTokens: 700 }))
        .reserved,
    ).toBe(700);
    expect(budgetPolicyFor(CONSERVATIVE_CAPABILITIES, {}, config).reserved).toBe(
      config.limits.reservedCompletionTokens,
    );
  });
});
