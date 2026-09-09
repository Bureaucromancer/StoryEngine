// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { GenerationParams } from '@storyengine/shared';

import type { BudgetPolicy } from '../assembly/assemble.js';
import type { Config } from '../config.js';
import type { ProviderCapabilities } from '../providers/types.js';

/**
 * The window a turn gets to spend, and where the number came from — [21 §1.5].
 *
 * The `source` field is not decoration: [10 §7](../../../../docs/design/10-ui-surfaces.md)'s
 * budget panel says *why* something was dropped, and "your context limit" and
 * "this endpoint's limit" are different sentences with different remedies.
 *
 * **`user` is the honest label for a config ceiling.** No `KNOWN_PROVIDERS`
 * entry sets `maxContextTokens` — `capabilities.ts` refuses to invent numbers it
 * cannot verify — so without the config default every turn would be
 * unbudgetable. A per-connection override reads as `provider` instead, and that
 * is also true: it is a statement about *that endpoint*, which is what
 * [19 §5.3](../../../../docs/design/19-tech-stack.md) says a capability override is.
 */
export interface PresetBudget {
  contextShare: number;
  maxContextTokens: number | null;
  reserveOutputTokens: number;
}

export function budgetPolicyFor(
  capabilities: ProviderCapabilities,
  params: GenerationParams,
  config: Config,
  preset?: PresetBudget,
): BudgetPolicy {
  /**
   * The ceiling, resolved in the order the design gives.
   *
   * The endpoint knows best, then the config's ceiling. **A preset's
   * `maxContextTokens` is a cap on that, not a substitute for it** — [04 §8.3]'s
   * whole argument is that a preset written against a 4k window must not
   * silently misbehave at 200k, which is what an absolute value from the preset
   * *winning* would reproduce. So it can only narrow.
   */
  const resolved =
    capabilities.maxContextTokens === undefined
      ? { tokens: config.limits.contextTokens, source: 'user' as const }
      : { tokens: capabilities.maxContextTokens, source: 'provider' as const };

  /**
   * `source` follows the side that won the min — [P3.0]. The old shape
   * relabelled `'preset'` whenever a cap was merely *declared*, so a 500k cap
   * that lost to an 8k endpoint still claimed the number. On equality the
   * preset keeps the label: both claims are true and the preset named the
   * figure explicitly.
   */
  const capped =
    preset?.maxContextTokens == null || preset.maxContextTokens > resolved.tokens
      ? resolved
      : { tokens: preset.maxContextTokens, source: 'preset' as const };

  /**
   * And the share the preset is willing to spend on context — [04 §8.3]'s
   * *shares and floors against the resolved window*, which is what makes a
   * preset portable across window sizes at all. Recorded as `share` beside the
   * untouched `ceiling` rather than by relabelling `source` — the relabel was
   * the lie [21 §1.5] existed to prevent: three-quarters of the live-editable
   * config default reading as the preset's own number, hiding the one remedy
   * a person can actually reach.
   */
  const limit =
    preset === undefined
      ? { tokens: capped.tokens, ceiling: capped.tokens, source: capped.source }
      : {
          tokens: Math.floor(capped.tokens * preset.contextShare),
          ceiling: capped.tokens,
          source: capped.source,
          share: preset.contextShare,
        };

  return {
    limit,
    /**
     * What the completion is allowed to need.
     *
     * A zero reserve is **not** a statement that nothing was held back — it lets
     * assembly spend the entire window and leaves the answer no room, which is
     * the configuration most likely to overflow a real provider. So a call that
     * did not say how long its answer may be gets the config's default rather
     * than nothing.
     */
    reserved:
      params.maxTokens ?? preset?.reserveOutputTokens ?? config.limits.reservedCompletionTokens,
  };
}
