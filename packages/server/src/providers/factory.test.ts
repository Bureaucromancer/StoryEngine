// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { type Connection } from './connections.js';
import { createProviderFactory } from './factory.js';

/**
 * The provider memo, and the invalidation the first writer owes it —
 * [P2B §2.4](../../../../docs/design/workplan/14-p2b-provider-configuration.md).
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
