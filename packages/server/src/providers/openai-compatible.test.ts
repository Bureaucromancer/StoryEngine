// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/require-await -- the stub transports below
   are `fetch` implementations: async is their signature, not a choice. */

import type { Connection } from './connections.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { ProviderError, type RenderedMessage } from './types.js';

/**
 * The real adapter, driven against a stub transport.
 *
 * Not a conformance test — those make real calls, cost money, and run on a
 * schedule rather than per-commit ([testing §4.2]). What these assert is the
 * half that is *ours*: that a `RenderedMessage` becomes a chat message, that
 * usage is reported only when the capability says it is, and that a failure
 * arrives as a classified `ProviderError` rather than as whatever the SDK
 * happened to throw.
 *
 * The transport is a `fetch` the connection is constructed with, which is the
 * seam the adapter already needed for a local endpoint.
 */

const messages: RenderedMessage[] = [
  { role: 'system', content: 'You are a narrator.', fromBlocks: ['b1'] },
  { role: 'user', content: 'It is raining.', fromBlocks: ['b2'] },
];

function connectionWith(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'local',
    label: 'My laptop',
    provider: 'openai-compatible',
    scope: 'user',
    models: ['llama-local'],
    baseUrl: 'http://localhost:11434/v1',
    ...overrides,
  };
}

/** The request body the SDK sent, which is always a JSON string here. */
function bodyOf(init: RequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : '';
}

/** A chat completion, in the shape an OpenAI-compatible endpoint returns. */
function completion(text: string, usage?: { prompt: number; completion: number }): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 0,
      model: 'llama-local',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      ...(usage === undefined
        ? {}
        : {
            usage: {
              prompt_tokens: usage.prompt,
              completion_tokens: usage.completion,
              total_tokens: usage.prompt + usage.completion,
            },
          }),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('a call through the adapter', () => {
  it('sends the rendered messages as chat messages, and nothing else', async () => {
    let sent: unknown;
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async (_url, init) => {
        sent = JSON.parse(bodyOf(init));
        return completion('The rain had not stopped.');
      },
    });

    const result = await provider.generate({
      modelId: 'llama-local',
      messages,
      params: { temperature: 0.7, maxTokens: 256 },
    });

    const body = sent as { model: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe('llama-local');
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a narrator.' },
      { role: 'user', content: 'It is raining.' },
    ]);
    // `fromBlocks` is provenance for the record and the workbench. No provider
    // has a use for it, and it must not travel.
    expect(JSON.stringify(body)).not.toContain('fromBlocks');
    expect(result.text).toBe('The rain had not stopped.');
  });

  it('reports usage only when the capability says the endpoint does', async () => {
    // The conservative baseline for an unknown OpenAI-compatible endpoint says
    // it does not, so even a response that carries usage is reported as null —
    // `ModelCall.usage` is provider-reported, and the capability is the claim.
    const quiet = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => completion('ok', { prompt: 11, completion: 5 }),
    });
    const quietResult = await quiet.generate({ modelId: 'llama-local', messages, params: {} });
    expect(quiet.capabilities.reportsUsage).toBe(false);
    expect(quietResult.usage).toBeNull();

    // And a connection that declares otherwise gets the numbers through.
    const loud = new OpenAICompatibleProvider({
      connection: connectionWith({ capabilities: { reportsUsage: true } }),
      fetch: async () => completion('ok', { prompt: 11, completion: 5 }),
    });
    const loudResult = await loud.generate({ modelId: 'llama-local', messages, params: {} });
    expect(loudResult.usage).toEqual({ promptTokens: 11, completionTokens: 5 });
  });

  it('never invents a cost', async () => {
    // There is no price table in this build, and a fabricated number in the
    // turn record is worse than an honest null.
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => completion('ok'),
    });
    const result = await provider.generate({ modelId: 'llama-local', messages, params: {} });
    expect(result.cost).toBeNull();
  });
});

describe('the system prompt', () => {
  it('travels as instructions, not as a message', async () => {
    // Found by writing this suite: AI SDK 7 *refuses* a `system` role inside
    // `messages`. Above the adapter the engine keeps thinking in
    // `RenderedMessage` including its system blocks, because that is what the
    // record and the workbench show; the translation stops here.
    let sent: { messages: { role: string; content: string }[] } | undefined;
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async (_url, init) => {
        sent = JSON.parse(bodyOf(init)) as typeof sent;
        return completion('ok');
      },
    });

    await provider.generate({ modelId: 'llama-local', messages, params: {} });

    // On the wire it *is* a system message, because that is what an
    // OpenAI-compatible endpoint takes. What changed is the adapter's input:
    // the SDK refuses `role: 'system'` in `messages` and wants `instructions`,
    // and it renders that back out here. The round trip is the assertion —
    // the engine's `RenderedMessage` list arrives intact and in order.
    expect(sent?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(sent?.messages[0]?.content).toBe('You are a narrator.');
    expect(sent?.messages[1]?.content).toBe('It is raining.');
  });

  it('folds into the first user message when the endpoint has nowhere to put it', async () => {
    // The other half of the `systemMessage` capability, and the reason it is a
    // capability rather than an assumption.
    let sent: { messages: { role: string; content: string }[] } | undefined;
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith({ capabilities: { systemMessage: 'fold-into-first-user' } }),
      fetch: async (_url, init) => {
        sent = JSON.parse(bodyOf(init)) as typeof sent;
        return completion('ok');
      },
    });

    await provider.generate({ modelId: 'llama-local', messages, params: {} });

    expect(sent?.messages).toHaveLength(1);
    expect(sent?.messages[0]?.role).toBe('user');
    // Both texts, in order, in the one message.
    expect(sent?.messages[0]?.content).toBe('You are a narrator.\n\nIt is raining.');
  });
});

describe('failures', () => {
  it('arrive classified, with the provider’s own words kept for the log', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429 }),
    });

    const failure = await provider
      .generate({ modelId: 'llama-local', messages, params: {} })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderError);
    // Rate limiting is worth retrying; a 400 would not be.
    expect((failure as ProviderError).class).toBe('retryable');
    // The message is ours — the UI offers a recovery rather than surfacing a
    // provider string — and the provider's is kept where the log can use it.
    expect((failure as ProviderError).message).toBe('The provider call failed.');
    expect((failure as ProviderError).detail).toBeDefined();
  });

  it('treats a request that never got an answer as transient', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => {
        throw new Error('fetch failed: network unreachable');
      },
    });

    const failure = await provider
      .generate({ modelId: 'llama-local', messages, params: {} })
      .catch((error: unknown) => error);

    expect((failure as ProviderError).class).toBe('transient');
  });

  it('treats a refusal the endpoint answered with as terminal', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: 'no such model' } }), { status: 400 }),
    });

    const failure = await provider
      .generate({ modelId: 'llama-local', messages, params: {} })
      .catch((error: unknown) => error);

    expect((failure as ProviderError).class).toBe('terminal');
  });
});

describe('what the connection decides', () => {
  it('takes its capabilities from the endpoint, not from the adapter', async () => {
    // Two OpenAI-compatible URLs can be a frontier model and a laptop, so the
    // adapter has no business having an opinion about limits.
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith({
        capabilities: { maxContextTokens: 8192, supportsStructuredOutput: false },
      }),
      fetch: async () => completion('ok'),
    });

    expect(provider.capabilities.maxContextTokens).toBe(8192);
    expect(provider.capabilities.supportsStructuredOutput).toBe(false);
  });

  it('works with no key at all, which is what a local model is', async () => {
    let authorization: string | null = null;
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async (_url, init) => {
        authorization = new Headers(init?.headers).get('authorization');
        return completion('ok');
      },
    });

    await provider.generate({ modelId: 'llama-local', messages, params: {} });
    expect(authorization).toBeNull();
  });
});

/**
 * **The streaming path, which had no tests at all** — F27.
 *
 * Ten tests preceded these and every one drove `generate()`: the path a turn
 * never takes. So the boundary every turn actually crosses was covered by
 * nothing, and `FakeProvider.stream` throws a `ProviderError` from *inside* its
 * generator — a shape the real adapter does not have — which is
 * [12 §4.1](../../../../docs/design/workplan/12-p2-manual-gate.md)'s *"a stub agrees with
 * whatever wrote it"* in the one place it costs most.
 *
 * **The tests that matter here fail at the transport rather than in a
 * generator.** `streamText` does not throw into the iterator when the request
 * fails — it hands the error to `onError` and ends the stream empty — so a test
 * whose *generator* throws exercises a path the SDK never takes.
 *
 * Measured before the fix, all four of these produced one identical
 * `NoOutputGeneratedError` reading *"No output generated. Check the stream for
 * errors."*, with no class, no status and none of the provider's words.
 */
function sse(chunks: unknown[], options: { cut?: boolean } = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      if (options.cut === true) {
        /**
         * A response that stops arriving — undici's `terminated`, and the local
         * runtime's characteristic failure.
         *
         * **On a later tick, not this one.** Erroring synchronously inside
         * `start` tears the stream down before the chunks above are read, so
         * the caller sees no partial text — and the point of this case is that
         * the partial answer *survives* the failure.
         */
        setTimeout(() => {
          controller.error(new Error('terminated'));
        }, 0);
        return;
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function delta(content: string, finish?: string): unknown {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'llama-local',
    choices: [
      {
        index: 0,
        delta: { content },
        ...(finish === undefined ? {} : { finish_reason: finish }),
      },
    ],
  };
}

async function collect(
  provider: OpenAICompatibleProvider,
): Promise<{ text: string; error: ProviderError | null }> {
  let text = '';
  try {
    const stream = provider.stream({ modelId: 'llama-local', messages, params: {} });
    let next = await stream.next();
    while (next.done !== true) {
      text += next.value.text;
      next = await stream.next();
    }
    return { text, error: null };
  } catch (error) {
    return { text, error: error as ProviderError };
  }
}

describe('a streaming failure', () => {
  it('carries a class and the provider’s own words when the request is refused', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-xx' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    });

    const { error } = await collect(provider);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error?.class).toBe('terminal');
    // The body, not the status name: a provider explains itself in the body,
    // and `detail` is what reaches the log.
    expect(error?.detail).toContain('Incorrect API key provided');
  });

  it('is retryable when the provider says try later', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
    });

    const { error } = await collect(provider);

    // The one class the retry ladder exists for. Before the fix this was
    // `terminal`, so a rate limit ended the turn instead of waiting.
    expect(error?.class).toBe('retryable');
  });

  it('reads a gateway’s HTML page without mistaking it for an answer', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () =>
        new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
    });

    const { error } = await collect(provider);

    expect(error?.class).toBe('retryable');
    expect(error?.detail).toContain('502 Bad Gateway');
  });

  /**
   * **The shape that would have caught the original defect**, and the reason it
   * is worth its own test: the fetch itself rejects, so nothing inside a
   * generator throws and nothing has a status. A transport that never answered
   * is not the provider refusing.
   */
  it('is transient when the connection never worked', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
        code: 'ECONNREFUSED',
      }),
    });
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => {
        throw refused;
      },
    });

    const { error } = await collect(provider);

    expect(error?.class).toBe('transient');
  });

  /**
   * Mid-stream is the half that already reached the classifier — and landed
   * `terminal`, because `terminated` matched none of the words it tested. The
   * partial text is handed to the caller before the throw, which is the
   * behaviour the surrounding docstring commits to.
   */
  it('keeps the partial answer when the response stops arriving', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => sse([delta('Half a sen')], { cut: true }),
    });

    const { text, error } = await collect(provider);

    expect(text).toBe('Half a sen');
    expect(error?.class).toBe('transient');
  });

  it('streams an ordinary reply in pieces', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => sse([delta('Half a '), delta('sentence.', 'stop')]),
    });

    const { text, error } = await collect(provider);

    expect(error).toBeNull();
    expect(text).toBe('Half a sentence.');
  });
});

/**
 * **Three routes to `transient`, and each needs a case only it can answer.**
 *
 * The classifier tries an error code, then the SDK's own retryability flag,
 * then the message. They overlap on the shapes that matter most — a refused
 * connection carries `ECONNREFUSED` *and* reads `fetch failed` — so a test
 * written against a realistic error proves only that *something* classified it.
 * Deleting `ECONNREFUSED` from the code table left the suite green, which is
 * the tell.
 *
 * So these two are deliberately unrealistic: each strips away every route but
 * one. They are not here to describe a provider, they are here so a route
 * cannot be removed in silence.
 */
describe('classifying a failure with no status', () => {
  it('reads an error code the message does not mention', async () => {
    // Message chosen to match none of the wording the classifier tests, so the
    // code on the cause is the only thing left to go on.
    const dropped = Object.assign(new Error('upstream went away'), {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    });
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => {
        throw dropped;
      },
    });

    const { error } = await collect(provider);

    expect(error?.class).toBe('transient');
  });

  it('takes the SDK at its word when there is neither a code nor a phrase', async () => {
    const flagged = Object.assign(new Error('upstream went away'), { isRetryable: true });
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => {
        throw flagged;
      },
    });

    const { error } = await collect(provider);

    expect(error?.class).toBe('transient');
  });

  it('is terminal when nothing says otherwise', async () => {
    // The floor. Without this, a classifier that returned `transient` for
    // everything would satisfy every test above.
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => {
        throw new Error('upstream went away');
      },
    });

    const { error } = await collect(provider);

    expect(error?.class).toBe('terminal');
  });
});
