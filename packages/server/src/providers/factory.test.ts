// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { type Connection } from './connections.js';
import { createProviderFactory, type ProviderFactoryOptions } from './factory.js';
import type { Provider, RenderedMessage } from './types.js';

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
   * **What it is for now is letting go.** Since each slot checks what it was
   * built from (2026-09-27, *what the memo was built from* below), an edit
   * reaches a fresh provider on its own. What a write still owes the memo is
   * dropping the provider it replaced, and what a delete owes it is dropping
   * the one it orphaned — which would otherwise sit in its slot, key and all,
   * for as long as the process does.
   *
   * ***This replaced "rebuilds against the new connection after a write"***
   * (2026-10-03), which invalidated and then asked for a connection with a new
   * `baseUrl`. The fingerprint rebuilds for that whatever `invalidate` does, so
   * from 2026-09-27 it passed against an `invalidate` that did nothing — and so
   * did every other test in this file. Hence the *identical* connection here:
   * nothing about it changed, and the only reason the next call is not the
   * memo's instance is that the instance was released.
   */
  it('releases the provider, so the next call builds a fresh one', () => {
    const factory = createProviderFactory();
    const before = factory(connection());

    factory.invalidate?.('house');
    const after = factory(connection());

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

const messages: RenderedMessage[] = [{ role: 'user', content: 'It is raining.', fromBlocks: [] }];

/** A chat completion, in the shape an OpenAI-compatible endpoint returns. */
function completion(): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-hi',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/**
 * A transport that answers every request and remembers where it was sent.
 *
 * **Through the factory's own `wrapFetch` seam**, which is the cassette
 * recorder's, so the provider under test is the real adapter the factory
 * builds. What gets recorded is what the SDK actually put on the wire, not
 * which `Connection` the wrapper happened to be handed — the difference from
 * *what the memo was built from* above, and the reason this is a second test
 * of the same defect rather than a repeat of one.
 *
 * Not `async`: it has nothing to await, and a `fetch` only has to return a
 * promise.
 */
function recordingTransport(): {
  sent: { url: string; authorization: string | null }[];
  wrapFetch: NonNullable<ProviderFactoryOptions['wrapFetch']>;
} {
  const sent: { url: string; authorization: string | null }[] = [];
  return {
    sent,
    wrapFetch: () => (input, init) => {
      sent.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return Promise.resolve(completion());
    },
  };
}

/** Where one turn through this provider lands. */
async function destinationOf(
  provider: Provider,
  transport: ReturnType<typeof recordingTransport>,
): Promise<{ url: string; authorization: string | null } | undefined> {
  const before = transport.sent.length;
  await provider.generate({ modelId: 'gpt-hi', messages, params: {} });
  return transport.sent[before];
}

/**
 * ***A personal file claiming a system connection's id***, on the wire — the
 * collision the memo settled by build order while it was keyed on the id alone
 * ([P2B §1.5](../../../../docs/design/workplan/10-p2b-provider-configuration.md)'s
 * 2026-10-03 correction).
 *
 * `resolveConnections` puts personal connections first and `resolveRole` takes
 * the first id match, so within the author's own account their file wins. The
 * memo is the one piece of state every account shares, and keyed on the id it
 * served whichever claimant was built first to both:
 *
 * - **the personal file built first** → every account bound to the system
 *   connection was served the planter's provider, so their prompts went to the
 *   planter's endpoint;
 * - **the system connection built first** → the planter's own file was
 *   silently ignored, and their turns spent the install's key.
 *
 * Both orders, because the first is the exploit and the second is the same bug
 * seen from the other side — a fix that only reversed which one won would pass
 * one of these and fail the other. *What the memo was built from* covers two
 * user-scope files in one order at build time; this is the cross-scope case,
 * where the leak crossed accounts, asserted as the URL and key that were sent.
 */
describe('a personal file claiming a system id', () => {
  const system = connection({
    scope: 'system',
    baseUrl: 'https://house.example.invalid/v1',
    apiKey: 'sk-the-house-key',
  });
  const personal = connection({
    scope: 'user',
    label: 'Definitely the house key',
    baseUrl: 'https://elsewhere.example.invalid/v1',
    apiKey: 'sk-somebody-elses-key',
  });

  it.each([
    ['the personal file', [personal, system]],
    ['the system connection', [system, personal]],
  ] as const)(
    'sends each to its own endpoint with its own key, when %s is built first',
    async (_first, order) => {
      const transport = recordingTransport();
      const factory = createProviderFactory({ wrapFetch: transport.wrapFetch });
      for (const one of order) factory(one);

      const theirs = factory(system);
      const mine = factory(personal);

      expect(await destinationOf(theirs, transport)).toEqual({
        url: 'https://house.example.invalid/v1/chat/completions',
        authorization: 'Bearer sk-the-house-key',
      });
      expect(await destinationOf(mine, transport)).toEqual({
        url: 'https://elsewhere.example.invalid/v1/chat/completions',
        authorization: 'Bearer sk-somebody-elses-key',
      });
      expect(theirs).not.toBe(mine);
    },
  );
});
