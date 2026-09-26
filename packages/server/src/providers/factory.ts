// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { digest } from '../sessions/digest.js';
import type { Connection } from './connections.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { Provider } from './types.js';

/**
 * Connection → provider, memoised.
 *
 * **Never keyed by the provider string.** Capability overrides are per
 * connection ([19 §5.3](../../../../docs/design/19-tech-stack.md)) — a limit is
 * a property of *this endpoint* — so a cache keyed by `'openai-compatible'`
 * would hand one machine's context window to another machine that happens to
 * speak the same protocol. Two llama.cpp boxes with different builds is the
 * ordinary case, not an exotic one.
 *
 * ***And not by the connection id either, which is what this said until
 * 2026-09-26*** — see {@link memoKey} for what it is keyed on and why.
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
   * Forgets every memoised provider built from a connection claiming this id —
   * in every scope, since the id alone cannot say whose.
   *
   * ***Housekeeping now, not correctness***, and the difference is worth
   * stating because the two used to be the same thing. Under an id key this
   * was the only way an edit reached the next turn. Under the content key
   * ({@link memoKey}) an edit produces a different key and so a fresh
   * provider without anybody saying so — which is what makes a *hand* edit
   * work, since nothing but the routes in `routes/connections.ts` ever called
   * this. What a write through the form still owes the memo is **letting go of
   * the provider it replaced**, which would otherwise stay reachable, key and
   * all, for as long as the process runs.
   *
   * A hand edit leaves its predecessor in the map until the next form write
   * for that id, or a restart. That is a few kilobytes per edit, and the
   * price of never serving a stale provider.
   *
   * **Invalidate rather than clear.** Dropping the whole map on any write would
   * be simpler and would throw away every *other* connection's memo, which on a
   * household install means one admin's edit re-creates every provider
   * mid-turn for everybody. A provider that is gone is rebuilt on next use;
   * that is the entire cost — which is also why releasing every *scope's*
   * claimant of the id, rather than only the one written, is the right
   * direction to be imprecise in.
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
  /**
   * One map, carrying the id beside the provider, rather than a second
   * id-to-keys index for `invalidate` to consult. A household install holds a
   * handful of connections, so a scan costs nothing, and a single structure
   * cannot fall out of step with itself the way two that must be updated
   * together can.
   */
  const cache = new Map<string, { connectionId: string; provider: Provider }>();

  const factory: ProviderFactory = (connection: Connection): Provider => {
    const key = memoKey(connection);
    const existing = cache.get(key);
    if (existing) return existing.provider;

    const provider = build(connection, options);
    cache.set(key, { connectionId: connection.id, provider });
    return provider;
  };

  factory.invalidate = (connectionId: string): void => {
    for (const [key, entry] of cache) {
      if (entry.connectionId === connectionId) cache.delete(key);
    }
  };

  return factory;
}

/**
 * ***What the memo is keyed on: everything the connection says.***
 *
 * **Not its id**, which is what this was until a hole was found in it. An id is
 * only unique when `writeConnection` mints one. `parseConnection` takes it
 * verbatim from a file, a connections directory is hand-editable by design
 * ([P2B §2.3](../../../../docs/design/workplan/10-p2b-provider-configuration.md)),
 * and every system connection's id reaches every account through
 * `/api/me/roles`. So a personal file claiming a system id shared the system
 * connection's slot, and whichever of the two was built first was served to
 * both. Personal first meant **every other account whose role resolved to the
 * system connection sent its prompts to the planter's endpoint**; system first
 * meant the planter's file was silently ignored. The memo is the one piece of
 * state in the path from a turn to a provider that every account shares —
 * every caller resolves its `Connection` from disk afresh — so it is the one
 * place a collision could cross from one account into another, and the one
 * place fixing it covers every way of planting the file: by hand, through a
 * backup import that carries connections (`backup/import.ts` copies them
 * verbatim), or through anything written later.
 *
 * P2B §1.5 called this collision *"at least the safe direction"*. That was true
 * of `resolveRole`, where the author's own file wins for the author, and it
 * was false while this was keyed on the id.
 *
 * **Why content rather than scope plus owner plus id**, which was the other
 * candidate. `Connection` carries no owning handle, so that key would need one
 * plumbing through every reader; and it would still have missed the hand
 * edit, which under an id key never reached the memo at all until a restart.
 * Keying on content makes a shared slot *mean* something checkable: two
 * connections share a provider only when they would have built
 * indistinguishable ones. Two accounts holding byte-identical personal files
 * do share, and that is correct rather than tolerated — `build` and the
 * capture recorder's `wrapFetch` read only `id`, `provider`, `baseUrl`,
 * `apiKey` and `capabilities`, and all of them are in the key.
 *
 * **The whole connection rather than a list of those five fields**, which is
 * the opposite default to `presentConnection`'s `Pick` for the mirror-image
 * reason. A presenter must not leak a field by forgetting it; a cache key must
 * not *omit* one by forgetting it, because a field added to `Connection` later
 * and read by some later adapter would otherwise be exactly this defect again.
 * Over-distinguishing costs a rebuild — renaming a connection builds a new
 * client object — and under-distinguishing sends one account's prompts to
 * another's endpoint. There is only one of those worth risking.
 *
 * **No canonicaliser, for the same reason.** Capability overrides are taken as
 * written, so two files spelling the same overrides in a different key order
 * produce two keys and two providers — the harmless direction again.
 * `renditions/digest.ts` makes the matching argument against writing a
 * recursive canonicaliser for a key: *"a canonicaliser with a bug is a digest
 * that is stable until the day somebody nests something."*
 *
 * **Hashed rather than used raw**, so the map does not hold a second plaintext
 * copy of every key as a string, and so an entry stays small whatever size of
 * `baseUrl` or capability block a file carries. Through `sessions/digest.ts`
 * because that module exists so that there are not *"two hand-rolled hash
 * encodings in one codebase"*; the leading part is a domain tag, the idiom
 * `recipeDigest` uses.
 */
function memoKey(connection: Connection): string {
  return digest(['provider', JSON.stringify(connection)]);
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
