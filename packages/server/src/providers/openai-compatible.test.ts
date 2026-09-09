// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/require-await -- the stub transports below
   are `fetch` implementations: async is their signature, not a choice. */

import type { GenerationParams } from '@storyengine/shared';

import type { Connection } from './connections.js';
import { FORWARDED_SAMPLER_PARAMS, FORWARDED_WIRE_NAMES, inertParams } from './forwarded-params.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { ProviderError, type GenerationResult, type RenderedMessage } from './types.js';

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

  /**
   * **Two gates, and the second is the one that was never tested.**
   *
   * This used to assert that the default reported nothing, which was true and
   * was the defect: the one provider this build can construct was also the one
   * declared not to count, so every turn recorded no usage whatever the endpoint
   * sent. The default is now true — that is what the wire format specifies and
   * what the SDK is asked for.
   *
   * The pessimism did not go anywhere. It moved to where it can be checked: an
   * endpoint that claims the format and sends no numbers still reports null,
   * because the second gate asks what actually arrived rather than what was
   * promised.
   */
  it('reports the numbers an endpoint sends', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => completion('ok', { prompt: 11, completion: 5 }),
    });

    const result = await provider.generate({ modelId: 'llama-local', messages, params: {} });

    expect(provider.capabilities.reportsUsage).toBe(true);
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 5 });
  });

  it('reports null when the endpoint sends none, whatever it claims', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      // The same 200, without a usage block — which is what a local runtime
      // that has not implemented it actually returns.
      fetch: async () => completion('ok'),
    });

    const result = await provider.generate({ modelId: 'llama-local', messages, params: {} });

    expect(result.usage).toBeNull();
  });

  it('reports null when the install says this endpoint does not count', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith({ capabilities: { reportsUsage: false } }),
      fetch: async () => completion('ok', { prompt: 11, completion: 5 }),
    });

    const result = await provider.generate({ modelId: 'llama-local', messages, params: {} });

    // The override is where a genuinely silent runtime belongs, and it still
    // wins over numbers that did arrive.
    expect(result.usage).toBeNull();
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
 * [manual gate §4.1](../../../../docs/design/workplan/11-p2-manual-gate.md)'s *"a stub agrees with
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
function sse(
  chunks: unknown[],
  options: { cut?: boolean; silent?: boolean; model?: string } = {},
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        // A chunk carries the model that answered, and a test can say it is
        // not the one that was asked for.
        const named =
          options.model === undefined ? chunk : { ...(chunk as object), model: options.model };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(named)}

`),
        );
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

async function collect(provider: OpenAICompatibleProvider): Promise<{
  text: string;
  error: ProviderError | null;
  result: GenerationResult | null;
}> {
  let text = '';
  try {
    const stream = provider.stream({ modelId: 'llama-local', messages, params: {} });
    let next = await stream.next();
    while (next.done !== true) {
      text += next.value.text;
      next = await stream.next();
    }
    return { text, error: null, result: next.value };
  } catch (error) {
    return { text, error: error as ProviderError, result: null };
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

/**
 * **The difference between an answer and an interruption** — F29.
 *
 * A completion ceiling reached comes back with no error, a shorter reply and
 * the same shape as a finished one. So did a stream that simply stopped — no
 * finish reason, no `[DONE]`, which is the local runtime's characteristic
 * failure. Both were recorded as ordinary successes, and the only signal a
 * reader had was that the prose ended oddly.
 */
describe('why the model stopped', () => {
  it('tells a ceiling reached from a finished answer', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => sse([delta('It was a dark and'), delta(' stormy', 'length')]),
    });

    const { error, result } = await collect(provider);

    expect(error).toBeNull();
    expect(result?.finishReason).toBe('length');
  });

  it('does not call a stream that simply stopped a clean answer', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      // Content, then the stream closes: no finish reason, no `[DONE]`, no
      // error. The shape a local runtime produces when it gives up.
      fetch: async () => sse([delta('Half a sen')], { silent: true }),
    });

    const { text, result } = await collect(provider);

    expect(text).toBe('Half a sen');
    expect(result?.finishReason).toBe('unknown');
  });

  it('says stop when the provider says stop', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => sse([delta('Half a '), delta('sentence.', 'stop')]),
    });

    const { result } = await collect(provider);

    expect(result?.finishReason).toBe('stop');
  });

  /**
   * A content filter is a refusal, not a failure: the call worked and the
   * provider declined. [21 §1.4] gives `ModelCall.outcome` a `refused` value
   * that had no producer until this.
   */
  it('reads a content filter as a refusal', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => sse([delta('I cannot', 'content_filter')]),
    });

    const { result } = await collect(provider);

    expect(result?.finishReason).toBe('filtered');
  });
});

/**
 * **The model that answered, which is not always the one asked for** — F29.
 *
 * Both adapter paths returned `request.modelId`, so `ModelCall.resolved.modelId`
 * was a copy of the request and any check over it compared a value with itself.
 * An endpoint that serves an alias, a fallback, or routes to whatever is loaded
 * is exactly the thing *"why is this turn different"* has to be able to answer.
 */
describe('usage on the streaming path', () => {
  /**
   * **The way usage actually arrives during the phase** — gate step 2 reads
   * `usage.promptTokens` off a turn, every turn streams, and a streamed
   * response reports usage only as a final chunk with no choices in it, sent
   * because the request asked with `stream_options: { include_usage: true }`.
   * Every existing usage test drove `generate()`, so the one path a real
   * session takes was the one path nothing asserted.
   */
  it('reads the usage-only final chunk a streaming endpoint sends', async () => {
    let sent: Record<string, unknown> = {};
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async (_url, init) => {
        sent = JSON.parse(bodyOf(init)) as Record<string, unknown>;
        return sse([
          delta('The rain '),
          delta('had not stopped.', 'stop'),
          // What include_usage buys: one more chunk, empty choices, the count.
          {
            id: 'chatcmpl-1',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'llama-local',
            choices: [],
            usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
          },
        ]);
      },
    });

    const { result } = await collect(provider);

    // Both halves, because either alone can silently regress: the request has
    // to ask — remove `includeUsage` from the adapter and real endpoints stop
    // sending the chunk — and the answer has to be read rather than dropped.
    expect(sent['stream_options']).toEqual({ include_usage: true });
    expect(result?.usage).toEqual({ promptTokens: 42, completionTokens: 7 });
  });
});

describe('which model answered', () => {
  it('records what the endpoint said, not what was asked', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => sse([delta('ok', 'stop')], { model: 'qwen-2.5-7b-instruct' }),
    });

    const { result } = await collect(provider);

    expect(result?.modelId).toBe('qwen-2.5-7b-instruct');
  });

  it('falls back to what was asked when the endpoint says nothing', async () => {
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async () => sse([delta('ok', 'stop')], { model: '' }),
    });

    const { result } = await collect(provider);

    // Naming the request is better than naming nothing — and it is the case the
    // local-runtime story runs into, since many echo no model at all.
    expect(result?.modelId).toBe('llama-local');
  });
});

describe('which sampler settings reach the model', () => {
  /**
   * **The list is read off the wire, not off `toSdkParams`.**
   *
   * `FORWARDED_SAMPLER_PARAMS` exists so the import review can say which of a
   * converted preset's settings are inert ([polish §8]). A list maintained by
   * reading the adapter would have been wrong on the day it was written: an
   * earlier draft included `topK`, because `toSdkParams` passes it — and
   * `@ai-sdk/openai-compatible` drops it before the body, since `top_k` is not
   * in the OpenAI chat schema. Only the request body knows.
   *
   * So this drives the adapter with **every** `GenerationParams` field set and
   * asserts the body against the constant in both directions. It goes red if the
   * SDK starts or stops carrying one, which is the point: that is the day the
   * sentence the review shows a person stops being true.
   */
  const everyParam = {
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    topA: 0.1,
    minP: 0.05,
    frequencyPenalty: 0.1,
    presencePenalty: 0.2,
    repetitionPenalty: 1.1,
    seed: 42,
    n: 2,
    maxTokens: 256,
    stop: ['END'],
  } satisfies GenerationParams;

  async function bodyWithEveryParam(): Promise<Record<string, unknown>> {
    let sent: unknown;
    const provider = new OpenAICompatibleProvider({
      connection: connectionWith(),
      fetch: async (_url, init) => {
        sent = JSON.parse(bodyOf(init));
        return completion('ok');
      },
    });

    await provider.generate({ modelId: 'llama-local', messages, params: { ...everyParam } });
    return sent as Record<string, unknown>;
  }

  it('sends exactly the ones the constant names', async () => {
    const body = await bodyWithEveryParam();

    for (const name of FORWARDED_SAMPLER_PARAMS) {
      expect(body[FORWARDED_WIRE_NAMES[name]], `${name} should be on the wire`).toBeDefined();
    }
  });

  it('sends nothing else — the five inert settings appear nowhere', async () => {
    const body = await bodyWithEveryParam();

    // By wire name and by ours, because a future SDK carrying `topK` under some
    // third spelling must fail this rather than slip through it.
    for (const absent of ['top_k', 'topK', 'top_a', 'topA', 'min_p', 'minP']) {
      expect(JSON.stringify(body), `${absent} must not travel`).not.toContain(absent);
    }
    for (const absent of ['repetition_penalty', 'repetitionPenalty']) {
      expect(JSON.stringify(body), `${absent} must not travel`).not.toContain(absent);
    }
    // `n` is too short to search for as a substring, so it is asked as a key.
    expect(Object.keys(body)).not.toContain('n');
  });

  it('agrees with what `inertParams` tells the import review', async () => {
    const body = await bodyWithEveryParam();
    const inert = inertParams(everyParam);

    expect(inert.sort()).toEqual(['minP', 'n', 'repetitionPenalty', 'topA', 'topK']);

    // The claim the review makes, checked against the body rather than against
    // the constant the review was built from: the sampler keys that travelled
    // are exactly the forwarded ones, so every name `inertParams` returned is
    // absent by construction rather than by five separate searches.
    const structural = new Set(['model', 'messages', 'stream', 'stream_options']);
    const samplerKeys = Object.keys(body).filter((key) => !structural.has(key));
    expect(samplerKeys.sort()).toEqual(
      FORWARDED_SAMPLER_PARAMS.map((name) => FORWARDED_WIRE_NAMES[name]).sort(),
    );
  });
});
