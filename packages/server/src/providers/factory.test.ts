// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { type Connection } from './connections.js';
import { createProviderFactory } from './factory.js';

/**
 * The provider memo, and the invalidation the first writer owes it —
 * [P2B §2.4](../../../../docs/design/workplan/10-p2b-provider-configuration.md).
 *
 * The memo keys on `connection.id` rather than on the provider *string*, and
 * that reasoning is good: capabilities are per connection, so keying on the
 * string would hand one llama.cpp box's context window to another.
 *
 * **There was no invalidation and there had never needed to be one**, because
 * until P2B nothing could change a connection while the server ran. This is the
 * exact analogue of what P2A found in `applyLiveConfig`: a cache whose
 * staleness was unreachable while the surface that writes it did not exist.
 */

function connection(over: Partial<Connection> = {}): Connection {
  return {
    id: 'house',
    label: 'The house key',
    provider: 'openai-compatible',
    scope: 'system',
    models: ['gpt-hi'],
    baseUrl: 'https://first.example.invalid/v1',
    ...over,
  };
}

describe('the memo', () => {
  it('hands back the same provider for the same connection', () => {
    const factory = createProviderFactory();

    expect(factory(connection())).toBe(factory(connection()));
  });

  it('keys on the id, not the provider name', () => {
    const factory = createProviderFactory();

    // Two connections of the same kind are two endpoints with two sets of
    // limits. Sharing one provider between them would hand one box's context
    // window to another.
    expect(factory(connection({ id: 'a' }))).not.toBe(factory(connection({ id: 'b' })));
  });
});

describe('invalidate', () => {
  /**
   * Without this, changing a base URL leaves every subsequent turn talking to
   * the **old** endpoint with the **old** limits until a restart — which is the
   * thing P2B.1's ending sentence is about.
   */
  it('rebuilds against the new connection after a write', () => {
    const factory = createProviderFactory();
    const before = factory(connection());

    factory.invalidate?.('house');
    const after = factory(connection({ baseUrl: 'https://second.example.invalid/v1' }));

    expect(after).not.toBe(before);
  });

  /**
   * **Invalidate rather than clear**, because dropping the whole map would
   * throw away every *other* connection's memo — which on a household install
   * means one admin's edit re-creates every provider mid-turn for everybody.
   */
  it('leaves every other connection memoised', () => {
    const factory = createProviderFactory();
    const mine = factory(connection({ id: 'mine' }));
    factory(connection({ id: 'house' }));

    factory.invalidate?.('house');

    expect(factory(connection({ id: 'mine' }))).toBe(mine);
  });

  it('is harmless for an id the memo never held', () => {
    const factory = createProviderFactory();
    const held = factory(connection());

    // A delete of a connection nothing has called yet is the ordinary case.
    factory.invalidate?.('never-built');

    expect(factory(connection())).toBe(held);
  });
});

/**
 * ***The memo notices a connection that says something new*** (2026-09-27).
 *
 * Only the form's writes invalidated it, so a hand edit to a connection file
 * (a new base URL, a rotated key) was ignored by every turn until a restart,
 * and two files claiming one id in two accounts shared whichever provider was
 * built first, key and endpoint included. `wrapFetch` is called once per built
 * provider with the connection it was built from, which is what these read.
 */
describe('what the memo was built from', () => {
  function recording(): {
    factory: ReturnType<typeof createProviderFactory>;
    builtFrom: Connection[];
  } {
    const builtFrom: Connection[] = [];
    const factory = createProviderFactory({
      wrapFetch: (inner, from) => {
        builtFrom.push(from);
        return inner;
      },
    });
    return { factory, builtFrom };
  }

  it('builds from a hand-edited connection on the next call, without being told', () => {
    const { factory, builtFrom } = recording();
    const before = factory(connection());

    const after = factory(connection({ baseUrl: 'https://second.example.invalid/v1' }));

    expect(after).not.toBe(before);
    expect(builtFrom.at(-1)?.baseUrl).toBe('https://second.example.invalid/v1');
  });

  it('gives two connections sharing an id each a provider built from its own key', () => {
    const { factory, builtFrom } = recording();

    factory(connection({ apiKey: 'sk-mine', scope: 'user' }));
    factory(connection({ apiKey: 'sk-theirs', scope: 'user' }));

    expect(builtFrom.map((from) => from.apiKey)).toEqual(['sk-mine', 'sk-theirs']);
  });

  it('does not rebuild for the same connection read again in another key order', () => {
    const { factory, builtFrom } = recording();
    const first = factory(connection({ capabilities: { maxContextTokens: 4096 } }));
    const reordered = {
      capabilities: { maxContextTokens: 4096 },
      baseUrl: 'https://first.example.invalid/v1',
      models: ['gpt-hi'],
      scope: 'system' as const,
      provider: 'openai-compatible',
      label: 'The house key',
      id: 'house',
    };

    expect(factory(reordered)).toBe(first);
    expect(builtFrom).toHaveLength(1);
  });
});
