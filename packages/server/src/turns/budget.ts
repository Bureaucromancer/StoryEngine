// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { GenerationParams } from '@storyengine/shared';

import type { BudgetPolicy } from '../assembly/assemble.js';
import type { Config } from '../config.js';
import type { ProviderCapabilities } from '../providers/types.js';

/**
 * The window a turn gets to spend, and where the number came from — [13 §1.5].
 *
 * The `source` field is not decoration: [05 §7](../../../../docs/design/05-ui-surfaces.md)'s
 * budget panel says *why* something was dropped, and "your context limit" and
 * "this endpoint's limit" are different sentences with different remedies.
 *
 * **`user` is the honest label for a config ceiling.** No `KNOWN_PROVIDERS`
 * entry sets `maxContextTokens` — `capabilities.ts` refuses to invent numbers it
 * cannot verify — so without the config default every turn would be
 * unbudgetable. A per-connection override reads as `provider` instead, and that
 * is also true: it is a statement about *that endpoint*, which is what
 * [07 §5.3](../../../../docs/design/07-tech-stack.md) says a capability override is.
 */
export function budgetPolicyFor(
  capabilities: ProviderCapabilities,
  params: GenerationParams,
  config: Config,
): BudgetPolicy {
  const limit =
    capabilities.maxContextTokens === undefined
      ? { tokens: config.limits.contextTokens, source: 'user' as const }
      : { tokens: capabilities.maxContextTokens, source: 'provider' as const };

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
    reserved: params.maxTokens ?? config.limits.reservedCompletionTokens,
  };
}
