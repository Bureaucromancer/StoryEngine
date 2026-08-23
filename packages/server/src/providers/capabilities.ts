// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ProviderCapabilities } from './types.js';

/**
 * Known-provider defaults, overridable per connection —
 * [07 §5.3](../../../../docs/design/07-tech-stack.md),
 * [13 §3](../../../../docs/design/13-internal-contracts.md).
 *
 * **Per connection is the right home for an override**, because a limit is a
 * property of *that endpoint*: two OpenAI-compatible URLs can be a hosted
 * frontier model and a laptop running llama.cpp, and the second has very
 * different numbers. Defaults exist so nobody has to discover CLIP's 77 tokens
 * themselves; the override exists because the default cannot be right for
 * everyone.
 *
 * **What is deliberately absent: invented numbers.** `maxPromptChars`,
 * `usefulPromptChars` and `maxContextTokens` are optional in the contract, and
 * they are left unset wherever this repository has not verified the value.
 * A wrong cap is worse than no cap — it either wastes headroom or truncates
 * silently, which is the exact failure [07 §5.3] exists to prevent — and a
 * confident-looking table of half-remembered limits is how that happens. What
 * is set below is the *shape* of each endpoint, which is what capability
 * negotiation actually needs.
 */

/**
 * The conservative baseline, and what an unknown provider gets.
 *
 * Every boolean is the *pessimistic* answer. An adapter that cannot do
 * something must say so, and a caller that degrades unnecessarily produces a
 * slightly worse prompt — where the reverse produces a request the endpoint
 * rejects, or worse, accepts and mangles.
 */
export const CONSERVATIVE_CAPABILITIES: ProviderCapabilities = {
  supportsTools: false,
  supportsStructuredOutput: false,
  supportsStreaming: true,
  // `preferred` rather than `required`: merging adjacent same-role blocks is
  // safe everywhere, and required is a claim about endpoints that reject the
  // unmerged form — which is a thing to know about a provider, not to assume.
  mergeSameRole: 'preferred',
  systemMessage: 'supported',
  reportsUsage: false,
};

/**
 * Per known provider. The keys are adapter-facing names, not display names.
 *
 * `openai-compatible` is the one that matters most: it is what a local model
 * is ([07 §5.2](../../../../docs/design/07-tech-stack.md)), and it is
 * deliberately the conservative baseline — the endpoint behind it could be
 * anything, and the connection is where someone who knows better says so.
 */
export const KNOWN_PROVIDERS: Record<string, Partial<ProviderCapabilities>> = {
  openai: {
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    mergeSameRole: 'preferred',
    systemMessage: 'supported',
    reportsUsage: true,
  },
  anthropic: {
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    // Anthropic takes the system prompt as its own parameter rather than as a
    // message, and rejects consecutive same-role turns in the conversation —
    // the case [13 §2] says varies by endpoint, and the reason it is a
    // capability rather than a global setting.
    mergeSameRole: 'required',
    systemMessage: 'supported',
    reportsUsage: true,
  },
  google: {
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    mergeSameRole: 'required',
    systemMessage: 'supported',
    reportsUsage: true,
  },
  'openai-compatible': { ...CONSERVATIVE_CAPABILITIES },
  fake: {
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    mergeSameRole: 'preferred',
    systemMessage: 'supported',
    reportsUsage: true,
  },
};

/**
 * The capabilities of one connection: baseline, then the provider's defaults,
 * then whatever that connection overrides.
 *
 * An unknown provider is not an error. Someone pointing at an endpoint this
 * build has never heard of gets the conservative baseline and can override it,
 * which is the difference between a system that accepts new endpoints and one
 * that has to ship a release to accept each.
 */
export function capabilitiesFor(
  provider: string,
  overrides: Partial<ProviderCapabilities> = {},
): ProviderCapabilities {
  return {
    ...CONSERVATIVE_CAPABILITIES,
    ...(KNOWN_PROVIDERS[provider] ?? {}),
    ...overrides,
  };
}

/** True when this build ships defaults for the named provider. */
export function isKnownProvider(provider: string): boolean {
  return Object.hasOwn(KNOWN_PROVIDERS, provider);
}
