// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Connection } from './connections.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { Provider } from './types.js';

/**
 * Connection → provider, memoised.
 *
 * **Keyed by connection id, never by the provider string.** Capability
 * overrides are per connection ([20 §5.3](../../../../docs/design/20-tech-stack.md)) — a limit is
 * a property of *this endpoint* — so a cache keyed by `'openai-compatible'`
 * would hand one machine's context window to another machine that happens to
 * speak the same protocol. Two llama.cpp boxes with different builds is the
 * ordinary case, not an exotic one.
 *
 * A function type rather than a class, because the only thing a test needs to
 * substitute is *which provider a connection produces* — and a seam that is one
 * function is one a test cannot get subtly wrong.
 */
/**
 * **Callable, with one extra verb** — [P2B §2.4](../../../../docs/design/workplan/10-p2b-provider-configuration.md).
 *
 * A bare function type was right while nothing could change a connection. The
 * moment a form can, the memo below needs invalidating, and a function is not a
 * seam that carries a second verb.
 *
 * A hybrid rather than an object with a `build()` method, deliberately: every
 * call site in the codebase and in seven test files spells this
 * `providers(connection)` or `() => provider`, and `calls.ts` reads
 * `ReturnType<ProviderFactory>` twice. Keeping the call signature makes this an
 * addition rather than a rewrite of files P2B has no other business in.
 */
export interface ProviderFactory {
  (connection: Connection): Provider;
  /**
   * Forgets one connection's memoised provider.
   *
   * **Invalidate rather than clear.** Dropping the whole map on any write would
   * be simpler and would throw away every *other* connection's memo, which on a
   * household install means one admin's edit re-creates every provider
   * mid-turn for everybody. A provider that is gone is rebuilt on next use;
   * that is the entire cost.
   *
   * Optional on the type so a test double stays a one-line arrow — `() =>
   * provider` is how six test files build one, and requiring the method would
   * have made every one of them a two-line object for no assertion's benefit.
   */
  invalidate?: (connectionId: string) => void;
}

export interface ProviderFactoryOptions {
  /**
   * Wraps the transport every built provider speaks through — the cassette
   * recorder's seam ([P2C §2.2]), and deliberately a wrapper rather than a
   * replacement: the SDK keeps its own default fetch when nothing asks.
   * Called once per built provider, so per-connection state (the key to
   * redact) binds at build time rather than per request.
   */
  wrapFetch?: (inner: typeof globalThis.fetch, connection: Connection) => typeof globalThis.fetch;
}

export function createProviderFactory(options: ProviderFactoryOptions = {}): ProviderFactory {
  const cache = new Map<string, Provider>();

  const factory: ProviderFactory = (connection: Connection): Provider => {
    const existing = cache.get(connection.id);
    if (existing) return existing;

    const provider = build(connection, options);
    cache.set(connection.id, provider);
    return provider;
  };

  factory.invalidate = (connectionId: string): void => {
    cache.delete(connectionId);
  };

  return factory;
}

/**
 * Whether this build has an adapter for a provider name.
 *
 * Exported so the **save** can refuse what the **call** would, rather than
 * letting a connection naming `anthropic` store cleanly and fail at the next
 * turn — the worst place to find out ([P2B §2.5]). `build` below asks the same
 * question, so there is one answer rather than two that can drift.
 *
 * The other four names in `KNOWN_PROVIDERS` are capability defaults for adapters
 * this build does not have. That is a head start rather than a lie, and they
 * become buildable in the phase that writes an adapter.
 */
export function canBuild(provider: string): boolean {
  return provider === 'openai-compatible';
}

function build(connection: Connection, options: ProviderFactoryOptions): Provider {
  // One adapter kind ships at P2 ([20 §5.5]: if it speaks OpenAI-compatible
  // chat it works, and if it does not it does not). A connection naming
  // something else is a configuration error the user can fix, so it says which
  // rather than falling back to a protocol the endpoint may not speak.
  if (!canBuild(connection.provider)) {
    throw new Error(
      `No adapter for provider ${JSON.stringify(connection.provider)}. ` +
        'This build speaks OpenAI-compatible chat only.',
    );
  }

  return new OpenAICompatibleProvider({
    connection,
    ...(options.wrapFetch === undefined
      ? {}
      : { fetch: options.wrapFetch(globalThis.fetch, connection) }),
  });
}
