// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Connection } from './connections.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { Provider } from './types.js';

/**
 * Connection → provider, memoised.
 *
 * **Keyed by connection id, never by the provider string.** Capability
 * overrides are per connection ([19 §5.3](../../../../docs/design/19-tech-stack.md)) — a limit is
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
  const cache = new Map<string, { fingerprint: string; provider: Provider }>();

  /**
   * ***A memo that checks it is still the same connection*** (2026-09-27).
   *
   * Keyed by id alone, the memo answered two questions wrongly. **A hand edit**
   * to a connection file — a new base URL, a rotated key, a context window —
   * was shown by the admin page, which reads the file, and ignored by every
   * turn, which asked the memo, until a restart. Only the form's writes
   * invalidated it. **And two files claiming one id**, in two accounts (a
   * `house.json` copied as a template, an account's connections imported into
   * another), shared whichever provider was built first, key and endpoint
   * included: one person's prompts went to another's endpoint on the other's
   * bill. Duplicate ids are surfaced and never blocked (`connections.ts`,
   * after [P1 §1.2]), which is right while each account resolves its own
   * connections and was not true of one memo every account shared.
   *
   * So each slot remembers what it was built from, and a connection that says
   * anything different gets a provider built from what it says. Two accounts
   * sharing an id take turns in the slot, rebuilding each time: correct, and
   * rare enough that correct is the whole requirement.
   */
  const factory: ProviderFactory = (connection: Connection): Provider => {
    const fingerprint = fingerprintOf(connection);
    const held = cache.get(connection.id);
    if (held?.fingerprint === fingerprint) return held.provider;

    const provider = build(connection, options);
    cache.set(connection.id, { fingerprint, provider });
    return provider;
  };

  factory.invalidate = (connectionId: string): void => {
    cache.delete(connectionId);
  };

  return factory;
}

/**
 * Everything a connection says, in an order that does not depend on how its
 * file was written — so the same connection read twice is the same string, and
 * any change to it, a label included, is a different one. Rebuilding for a
 * label is a few objects; missing a change that mattered is the fault above.
 */
function fingerprintOf(connection: Connection): string {
  return canonical(connection);
}

function canonical(value: unknown): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([one], [two]) => (one < two ? -1 : one > two ? 1 : 0));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
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
  // One adapter kind ships at P2 ([19 §5.5]: if it speaks OpenAI-compatible
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
