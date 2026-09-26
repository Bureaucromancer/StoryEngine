// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/require-await -- the stub transports below
   are `fetch` implementations: async is their signature, not a choice. */

import { type Connection } from './connections.js';
import { createProviderFactory, type ProviderFactoryOptions } from './factory.js';
import type { Provider, RenderedMessage } from './types.js';

/**
 * The provider memo, and what it is keyed on.
 *
 * ***It keyed on `connection.id`, and an id is a claim rather than an
 * identity.*** The reasoning it started from is still good — capabilities are
 * per connection, so keying on the provider *string* would hand one llama.cpp
 * box's context window to another — but it stopped one step short. An id is
 * only unique when `writeConnection` mints it; `parseConnection` takes it
 * verbatim from a file anybody with `fileAccess: "write"` can edit, and every
 * system connection's id is on the wire to every account through
 * `/api/me/roles`. So a personal file claiming a system id shared the system
 * connection's memo slot, and whichever of the two was built first was served
 * to both — including to every *other* account whose role resolves to the
 * system one. That is the describe block below, and it is why the key is now
 * the connection's content.
 *
 * The invalidation half is [P2B §2.4](../../../../docs/design/workplan/10-p2b-provider-configuration.md):
 * the exact analogue of what P2A found in `applyLiveConfig`, a cache whose
 * staleness was unreachable while the surface that writes it did not exist.
 * Under a content key it stops being what makes an edit take effect and
 * becomes what lets go of the provider an edit replaced.
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
 * which `Connection` the wrapper happened to be handed. The claim these tests
 * make is *whose endpoint a prompt reaches, with whose key*, and only the
 * request itself can answer that.
 */
function recordingTransport(): {
  sent: { url: string; authorization: string | null }[];
  wrapFetch: NonNullable<ProviderFactoryOptions['wrapFetch']>;
} {
  const sent: { url: string; authorization: string | null }[] = [];
  return {
    sent,
    wrapFetch: () => async (input, init) => {
      sent.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return completion();
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

describe('the memo', () => {
  it('hands back the same provider for the same connection', () => {
    const factory = createProviderFactory();

    // Two separately parsed objects, which is the ordinary case: every turn
    // reads its connections from disk afresh, so identity of the *object* was
    // never what made this hit.
    expect(factory(connection())).toBe(factory(connection()));
  });

  it('keys on the connection, not the provider name', () => {
    const factory = createProviderFactory();

    // Two connections of the same kind are two endpoints with two sets of
    // limits. Sharing one provider between them would hand one box's context
    // window to another.
    expect(factory(connection({ id: 'a' }))).not.toBe(factory(connection({ id: 'b' })));
  });

  /**
   * **A hand edit reaches the next turn without anybody telling the memo.**
   *
   * Only the routes in `routes/connections.ts` ever called `invalidate`, and a
   * connections directory is hand-editable by design ([P2B §2.3]) — so under an
   * id key, somebody who fixed a typo in a `baseUrl` with a text editor went on
   * talking to the old endpoint until a restart, with nothing anywhere saying
   * why.
   */
  it('reaches a hand edit without being told', () => {
    const factory = createProviderFactory();
    const before = factory(connection());

    const after = factory(connection({ baseUrl: 'https://second.example.invalid/v1' }));

    expect(after).not.toBe(before);
  });
});

/**
 * ***A personal file claiming a system connection's id*** — the collision the
 * memo used to resolve by build order.
 *
 * `resolveConnections` puts personal connections first, and `resolveRole`
 * takes the first id match, so within the author's own account their file wins
 * — P2B §1.5's *"at least the safe direction"*. What that sentence did not
 * see is the memo, which is the one piece of state every account shares:
 *
 * - **the personal file built first** → every account bound to the system
 *   connection was served the planter's provider, so their prompts went to
 *   the planter's endpoint;
 * - **the system connection built first** → the planter's own file was
 *   silently ignored, and their turns spent the install's key.
 *
 * Both orders, because the first is the exploit and the second is the same bug
 * seen from the other side — a fix that only reversed which one won would pass
 * one of these and fail the other.
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

describe('invalidate', () => {
  /**
   * **What it does now is let go.** An edit changes the content and so reaches
   * a fresh provider on its own; what the form's write still owes the memo is
   * dropping the provider it replaced, which would otherwise live — key and
   * all — for as long as the process does.
   *
   * So the observable is a rebuild for the *identical* connection: nothing
   * about it changed, and the only reason it is not the memo's instance is
   * that the instance was released.
   */
  it('releases the provider, so the next call builds a fresh one', () => {
    const factory = createProviderFactory();
    const before = factory(connection());

    factory.invalidate?.('house');
    const after = factory(connection());

    expect(after).not.toBe(before);
  });

  /**
   * Every claimant of the id, in every scope — which in the collision case
   * above means a personal save also releases the system connection's
   * provider. That costs one rebuild on its next use, and it is the cheap
   * direction to be wrong in.
   */
  it('releases every provider claiming the id', () => {
    const factory = createProviderFactory();
    const system = factory(connection({ scope: 'system' }));
    const personal = factory(
      connection({ scope: 'user', baseUrl: 'https://mine.example.invalid/v1' }),
    );

    factory.invalidate?.('house');

    expect(factory(connection({ scope: 'system' }))).not.toBe(system);
    expect(
      factory(connection({ scope: 'user', baseUrl: 'https://mine.example.invalid/v1' })),
    ).not.toBe(personal);
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
