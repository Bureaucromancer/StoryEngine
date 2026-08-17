// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Connection } from './connections.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { Provider } from './types.js';

/**
 * Connection → provider, memoised.
 *
 * **Keyed by connection id, never by the provider string.** Capability
 * overrides are per connection ([07 §5.3](../../../../docs/design/07-tech-stack.md)) — a limit is
 * a property of *this endpoint* — so a cache keyed by `'openai-compatible'`
 * would hand one machine's context window to another machine that happens to
 * speak the same protocol. Two llama.cpp boxes with different builds is the
 * ordinary case, not an exotic one.
 *
 * A function type rather than a class, because the only thing a test needs to
 * substitute is *which provider a connection produces* — and a seam that is one
 * function is one a test cannot get subtly wrong.
 */
export type ProviderFactory = (connection: Connection) => Provider;

export function createProviderFactory(): ProviderFactory {
  const cache = new Map<string, Provider>();

  return (connection: Connection): Provider => {
    const existing = cache.get(connection.id);
    if (existing) return existing;

    const provider = build(connection);
    cache.set(connection.id, provider);
    return provider;
  };
}

function build(connection: Connection): Provider {
  // One adapter kind ships at P2 ([07 §5.5]: if it speaks OpenAI-compatible
  // chat it works, and if it does not it does not). A connection naming
  // something else is a configuration error the user can fix, so it says which
  // rather than falling back to a protocol the endpoint may not speak.
  if (connection.provider !== 'openai-compatible') {
    throw new Error(
      `No adapter for provider ${JSON.stringify(connection.provider)}. ` +
        'This build speaks OpenAI-compatible chat only.',
    );
  }

  return new OpenAICompatibleProvider({ connection });
}
