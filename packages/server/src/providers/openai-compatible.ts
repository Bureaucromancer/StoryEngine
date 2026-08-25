// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, streamText } from 'ai';

import { capabilitiesFor } from './capabilities.js';
import type { Connection } from './connections.js';
import {
  type ErrorClass,
  type GenerationChunk,
  type GenerationRequest,
  type GenerationResult,
  type Provider,
  ProviderError,
  type ProviderCapabilities,
  type RenderedMessage,
} from './types.js';

/**
 * The first real adapter — the AI SDK behind the thin interface
 * ([07 §5](../../../../docs/design/07-tech-stack.md)).
 *
 * **One adapter, not eight.** The supported surface is stated in a line:
 * *if it speaks OpenAI-compatible chat, it works; if it does not, it does not*
 * ([07 §5.5](../../../../docs/design/07-tech-stack.md)). That covers the hosted
 * providers and it covers a local model, which is a connection with a
 * `localhost` URL and no key — llama.cpp, Ollama, vLLM, LM Studio and KoboldCpp
 * all expose it. Provider-specific adapters can join later without changing
 * anything above this file, which is the point of there being a file.
 *
 * There is no completion path, no instruct templates and no stop-sequence
 * machinery, and that is a position rather than an omission —
 * [docs/api.md](../../../../docs/api.md) says so where a user will read it
 * rather than leaving it to be discovered.
 *
 * What this file is careful about is the seam: everything above it speaks
 * `RenderedMessage` and `ProviderCapabilities`, and the SDK's vocabulary stops
 * here. Swapping the SDK is a rewrite of this file and nothing else.
 */

export interface OpenAICompatibleOptions {
  connection: Connection;
  /** Overrides the connection's own, for a test that needs a stub transport. */
  fetch?: typeof globalThis.fetch;
}

export class OpenAICompatibleProvider implements Provider {
  readonly kind = 'openai-compatible';
  readonly capabilities: ProviderCapabilities;

  readonly #model: (modelId: string) => Parameters<typeof generateText>[0]['model'];

  constructor(options: OpenAICompatibleOptions) {
    const { connection } = options;
    this.capabilities = capabilitiesFor(connection.provider, connection.capabilities ?? {});

    const client = createOpenAICompatible({
      name: connection.provider,
      baseURL: connection.baseUrl ?? 'https://api.openai.com/v1',
      // Absent for a local endpoint that needs none, which is the ordinary
      // case for the local-model story and not an error.
      ...(connection.apiKey === undefined ? {} : { apiKey: connection.apiKey }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });

    this.#model = (modelId: string) => client(modelId);
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const prompt = splitForSdk(request.messages, this.capabilities.systemMessage);
    try {
      const result = await generateText({
        model: this.#model(request.modelId),
        messages: prompt.messages,
        ...(prompt.instructions === undefined ? {} : { instructions: prompt.instructions }),
        ...toSdkParams(request),
      });

      return {
        text: result.text,
        usage: this.#usage(result.usage),
        // Not priced here. Cost belongs to the turn record and depends on a
        // price table this build does not ship — reporting a fabricated number
        // would be worse than reporting none.
        cost: null,
        modelId: request.modelId,
      };
    } catch (error) {
      throw asProviderError(error);
    }
  }

  async *stream(
    request: GenerationRequest,
  ): AsyncGenerator<GenerationChunk, GenerationResult, undefined> {
    const prompt = splitForSdk(request.messages, this.capabilities.systemMessage);
    // Captured rather than thrown, because the SDK calls this instead of
    // failing the iterator — see the throw below the loop.
    let failure: unknown;
    const result = streamText({
      model: this.#model(request.modelId),
      messages: prompt.messages,
      ...(prompt.instructions === undefined ? {} : { instructions: prompt.instructions }),
      ...toSdkParams(request),
      onError: ({ error }) => {
        failure = error;
      },
    });

    let text = '';
    try {
      for await (const piece of result.textStream) {
        text += piece;
        yield { text: piece };
      }
    } catch (error) {
      // A mid-stream failure, with text already handed to the caller. Thrown
      // rather than swallowed: the caller has a partial answer and needs to
      // know it is partial.
      throw asProviderError(error);
    }

    /**
     * **A failure before the first chunk does not arrive as a throw**, and this
     * is the line that turns it back into one.
     *
     * `streamText` does not throw into the iterator when the request itself
     * fails: it hands the error to its own `onError` and ends the stream empty.
     * So the loop above completes normally, and the failure surfaces later —
     * previously as a bare `NoOutputGeneratedError` from `await result.usage`,
     * carrying no status, no class and none of the provider's words.
     *
     * Measured, before the fix: a 401, a 429, a 502 with an HTML body and a
     * refused connection produced **one identical error** reading *"No output
     * generated. Check the stream for errors."* Every deliberate breakage
     * [12 §2.2](../../../../docs/design/workplan/12-p2-manual-gate.md) asks a tester to make
     * returned the same wrong answer, and a 429 was never retried because
     * nothing could see it was a 429.
     */
    if (failure !== undefined) throw asProviderError(failure);

    return {
      text,
      usage: this.#usage(await result.usage),
      cost: null,
      modelId: request.modelId,
    };
  }

  /**
   * Usage, or null — never a guess.
   *
   * Two gates, and both matter: a provider that declares it does not report
   * usage must not appear to, and a provider that declares it does can still
   * answer with nothing. `ModelCall.usage` is *"provider-reported, not
   * estimated"* ([13 §1.4](../../../../docs/design/13-internal-contracts.md)),
   * and the budgeter's margin is what covers the gap.
   */
  #usage(
    usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined,
  ): { promptTokens: number; completionTokens: number } | null {
    if (!this.capabilities.reportsUsage) return null;
    if (usage?.inputTokens === undefined || usage.outputTokens === undefined) return null;
    return { promptTokens: usage.inputTokens, completionTokens: usage.outputTokens };
  }
}

interface SdkMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Splits rendered messages into what the SDK actually takes.
 *
 * **The system prompt is not a message here.** AI SDK 7 refuses a `system` role
 * inside `messages` and wants `instructions` instead — which is the seam
 * `ProviderCapabilities.systemMessage` was written for, arriving one layer
 * earlier than expected. Above this file the engine keeps thinking in
 * `RenderedMessage`, including the system blocks, because that is what the
 * record and the workbench show; the translation stops here.
 *
 * `fold-into-first-user` is the other half of that capability: some endpoints
 * have nowhere to put a system prompt at all, and folding it into the first
 * user message is what they need. Both paths keep the text and its order —
 * what changes is where it is carried.
 *
 * `fromBlocks` stops here too. It is provenance for the record, and no provider
 * has a use for it.
 */
function splitForSdk(
  messages: RenderedMessage[],
  systemMessage: ProviderCapabilities['systemMessage'],
): { instructions: string | undefined; messages: SdkMessage[] } {
  const system = messages.filter((message) => message.role === 'system');
  const rest = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }));

  if (system.length === 0) return { instructions: undefined, messages: rest };

  // Joined in order, including a system block that appears mid-conversation:
  // the alternative is dropping it, and a preset that puts one there means it.
  const instructions = system.map((message) => message.content).join('\n\n');

  if (systemMessage === 'supported') {
    return { instructions, messages: rest };
  }

  const firstUser = rest.findIndex((message) => message.role === 'user');
  if (firstUser === -1) {
    // Nothing to fold into. A user message carrying only the system text is
    // still better than silently dropping it.
    return {
      instructions: undefined,
      messages: [{ role: 'user', content: instructions }, ...rest],
    };
  }

  const folded = [...rest];
  folded[firstUser] = {
    role: 'user',
    content: `${instructions}\n\n${folded[firstUser]?.content ?? ''}`,
  };
  return { instructions: undefined, messages: folded };
}

function toSdkParams(request: GenerationRequest): Record<string, unknown> {
  const { params } = request;
  return {
    /**
     * **The SDK does not retry. The engine does.**
     *
     * Left alone, the SDK retries a 429 with backoff, which quietly takes three
     * policy decisions on our behalf: whether to retry, how often, and how long
     * to block. `ModelCall` has a `retries` field and an error *class* precisely
     * so those are the engine's — a `retryable` that has already been retried
     * three times behind the adapter's back is a different fact from a fresh
     * one, and the turn record would have no way to tell them apart.
     */
    maxRetries: 0,
    ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
    ...(params.topP === undefined ? {} : { topP: params.topP }),
    ...(params.topK === undefined ? {} : { topK: params.topK }),
    ...(params.frequencyPenalty === undefined ? {} : { frequencyPenalty: params.frequencyPenalty }),
    ...(params.presencePenalty === undefined ? {} : { presencePenalty: params.presencePenalty }),
    ...(params.maxTokens === undefined ? {} : { maxOutputTokens: params.maxTokens }),
    ...(params.stop === undefined ? {} : { stopSequences: params.stop }),
    ...(params.seed === undefined || params.seed === null ? {} : { seed: params.seed }),
    ...(request.signal === undefined ? {} : { abortSignal: request.signal }),
  };
}

/**
 * Classifies a failure so the UI can offer the right recovery rather than
 * surfacing a provider string ([13 §1.4]).
 *
 * Deliberately coarse. Providers signal this inconsistently — a clear 400 from
 * one, a generic error from another — and a classifier that pretended to more
 * precision than the signals support would be guessing in a way that is hard to
 * notice. Three buckets, and the provider's own words go in `detail` for the
 * log.
 */
/**
 * The operating-system errors that mean *the connection did not work*, as
 * opposed to *the provider said no* — F27.
 *
 * Node reports these on a `cause` rather than in the message, and the message
 * they do carry is unhelpfully terse: a refused connection reads `fetch failed`
 * and a socket dying mid-response reads `terminated`. Neither matched the
 * message vocabulary this used to test, so **both classified `terminal` and the
 * retry ladder never fired** — measured across six deliberate failures in two
 * independent runs without a single retry.
 */
const TRANSIENT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** The first error code on the cause chain, which is where fetch buries it. */
function codeOf(error: unknown): string | undefined {
  for (let at = error, depth = 0; at !== undefined && at !== null && depth < 8; depth += 1) {
    const node = at as { code?: unknown; cause?: unknown; lastError?: unknown };
    if (typeof node.code === 'string') return node.code;
    // Two links, not one: `lastError` is what a `RetryError` carries instead of
    // a cause, and that wrapper appears whenever the SDK's own retry is on.
    at = node.cause ?? node.lastError;
  }
  return undefined;
}

function asProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const status =
    (error as { statusCode?: number; status?: number }).statusCode ??
    (error as { status?: number }).status;

  let errorClass: ErrorClass = 'terminal';
  if (status === 429 || (status !== undefined && status >= 500)) {
    errorClass = 'retryable';
  } else if (status === undefined && TRANSIENT_CODES.has(codeOf(error) ?? '')) {
    // The connection never worked. Nothing about the request was refused.
    errorClass = 'transient';
  } else if (status === undefined && (error as { isRetryable?: unknown }).isRetryable === true) {
    /**
     * **The SDK's own judgement, taken over a regex.** `APICallError` sets
     * `isRetryable` from its own taxonomy, and a status-less error it calls
     * retryable is a connection that did not work — a refused port arrives this
     * way, with its `ECONNREFUSED` buried under a message reading only *"Cannot
     * connect to API"*. Reading the flag is more durable than guessing at
     * wording that belongs to somebody else's library.
     */
    errorClass = 'transient';
  } else if (
    status === undefined &&
    /timeout|network|fetch failed|socket|abort|terminated/i.test(message)
  ) {
    // No status, no code and no flag: the message is all there is.
    // `terminated` is undici's word for a response that stopped arriving.
    errorClass = 'transient';
  }

  /**
   * **The provider's own words travel as `detail`, and a body is better than a
   * class name.** An `APICallError` carries the response body, which is where a
   * provider actually explains itself — *"Incorrect API key provided"* rather
   * than *"Bad Request"*. Bounded, because an HTML error page is a whole
   * document and a log line is not.
   */
  const body = (error as { responseBody?: unknown }).responseBody;
  const detail =
    typeof body === 'string' && body.length > 0 ? `${message} — ${body.slice(0, 500)}` : message;

  return new ProviderError(errorClass, 'The provider call failed.', detail);
}
