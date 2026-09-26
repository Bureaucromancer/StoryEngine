// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  generateImage,
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  streamText,
  type JSONSchema7,
} from 'ai';

import { capabilitiesFor } from './capabilities.js';
import type { Connection } from './connections.js';
import {
  ProviderError,
  type ErrorClass,
  type FinishReason,
  type GenerationChunk,
  type GenerationRequest,
  type GenerationResult,
  type ImageRequest,
  type ImageResult,
  type Provider,
  type ProviderCapabilities,
  type RenderedMessage,
} from './types.js';

/**
 * The first real adapter — the AI SDK behind the thin interface
 * ([19 §5](../../../../docs/design/19-tech-stack.md)).
 *
 * **One adapter, not eight.** The supported surface is stated in a line:
 * *if it speaks OpenAI-compatible chat, it works; if it does not, it does not*
 * ([19 §5.5](../../../../docs/design/19-tech-stack.md)). That covers the hosted
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
  readonly #imageModel: (modelId: string) => Parameters<typeof generateImage>[0]['model'];

  constructor(options: OpenAICompatibleOptions) {
    const { connection } = options;
    this.capabilities = capabilitiesFor(connection.provider, connection.capabilities ?? {});

    const client = createOpenAICompatible({
      name: connection.provider,
      baseURL: connection.baseUrl ?? 'https://api.openai.com/v1',
      /**
       * **Asked for, or it never arrives on the streaming path.** The SDK sends
       * `stream_options: {include_usage: true}` only when told to, and without
       * it the final chunk carries no usage block at all — so `usage` was null
       * on every streamed turn no matter what the capabilities said, and
       * [21 §1.4](../../../../docs/design/21-internal-contracts.md)'s
       * *provider-reported, not estimated* had nothing to report.
       *
       * Harmless where it is not supported: an endpoint that does not know the
       * option ignores it, and `#usage` still refuses to invent a number.
       */
      includeUsage: true,
      /**
       * **What decides whether the schema reaches the wire at all** — [P7.4].
       *
       * Measured against the SDK rather than assumed: with this on, a request
       * carrying a schema sends `response_format: {type: "json_schema",
       * json_schema: {...}}`; with it off, the SDK drops the schema, warns
       * *"JSON response format schema is only supported with structuredOutputs"*
       * and sends bare `{type: "json_object"}` — the endpoint is asked for JSON
       * and told nothing about its shape.
       *
       * So this is the capability, not a constant. `openai-compatible` declares
       * `supportsStructuredOutput: false` by default
       * ([`capabilities.ts`](./capabilities.ts)) because the endpoint behind it
       * could be anything, and a connection is where an operator who knows their
       * endpoint says otherwise. Both arms produce JSON; only one of them tells
       * the model what shape.
       */
      supportsStructuredOutputs: this.capabilities.supportsStructuredOutput,
      // Absent for a local endpoint that needs none, which is the ordinary
      // case for the local-model story and not an error.
      ...(connection.apiKey === undefined ? {} : { apiKey: connection.apiKey }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });

    this.#model = (modelId: string) => client(modelId);
    this.#imageModel = (modelId: string) => client.imageModel(modelId);
  }

  /**
   * Pixels — [P9 §1.2]'s second arm, against the same endpoint as chat.
   *
   * ***The same package, the same `baseUrl` and the same credential path***,
   * which is most of why §1.2 resolves as a second *verb* rather than a second
   * provider kind: `@ai-sdk/openai-compatible` already exposes `imageModel`, so
   * an endpoint that answers `POST /images/generations` needs no new connection
   * vocabulary, no second adapter and no change to `canBuild`. What it needs is
   * a person to say `rendersImages` on the connection, which is where
   * `capabilities.ts` puts every other fact about an endpoint.
   *
   * ***The seed is passed through and echoed back.*** It arrives from the
   * caller because [06 §10.7] makes it the load-bearing field of a recipe, and
   * an adapter that invented its own would be answering the one question the
   * record has to be able to state. An endpoint that ignores it produces a
   * different picture on re-creation and the record still says what was asked
   * for — which is the honest failure, and the one a workbench row makes
   * visible.
   *
   * *`n: 1` and nothing else.* [06 §10.4]'s variations are a *product* feature
   * built from siblings ([P9.3]), not from a batch parameter: two renditions
   * with two seeds are two records a person can choose between, and a provider
   * returning four images in one response would be one record with three
   * pictures nobody can name.
   */
  async renderImage(request: ImageRequest): Promise<ImageResult> {
    try {
      const result = await generateImage({
        model: this.#imageModel(request.modelId),
        prompt: request.prompt,
        n: 1,
        seed: request.seed,
        /**
         * Whatever this endpoint was configured with, under the provider's own
         * key — steps, sampler, guidance scale. Scalars only, which is
         * {@link ImageRequest}'s rule and the recipe's: these are re-sent
         * verbatim on re-creation and hashed into the reuse digest.
         */
        providerOptions: { [this.kind]: { ...request.workflow } },
        /**
         * **Not retried here either** — `toSdkParams` gives the reason, and it
         * holds for pixels unchanged.
         *
         * `generateImage` takes the same default as the chat calls, two retries
         * with backoff, and this call was written without the line that turns
         * it off. So a 429 was sent three times and recorded once — on an
         * endpoint that bills per request, requests the rendition record never
         * counted — and the last failure arrived wrapped in a `RetryError`
         * carrying no status, no body and no `isRetryable`, which
         * `asProviderError` could only read as `terminal`. A rate limit
         * reported as *do not try again* is the class inverted.
         *
         * *What to do about a `retryable` belongs to the caller*, and the
         * rendition worker's answer is written where it makes the call.
         */
        maxRetries: 0,
        ...(request.signal === undefined ? {} : { abortSignal: request.signal }),
      });

      const image = result.images[0];
      if (image === undefined) {
        // An endpoint that answered without a picture. A class rather than the
        // SDK's sentence, per [21 §1.4], and `terminal` because retrying a
        // request the endpoint accepted and answered emptily is not a retry.
        throw new ProviderError('terminal', 'The endpoint returned no image.');
      }

      return {
        bytes: image.uint8Array,
        mime: image.mediaType,
        modelId: request.modelId,
        seed: request.seed,
        // Image pricing is per-request and per-size rather than per-token, and
        // no OpenAI-compatible image response carries it. `null` is the same
        // refusal `#usage` makes for tokens: the record says nothing rather than
        // inventing a number.
        cost: null,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw asProviderError(error);
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const prompt = splitForSdk(request.messages, this.capabilities.systemMessage);
    try {
      const result = await generateText({
        model: this.#model(request.modelId),
        messages: prompt.messages,
        ...(prompt.instructions === undefined ? {} : { instructions: prompt.instructions }),
        ...toSdkParams(request),
        ...outputFor(request),
      });

      return {
        text: result.text,
        usage: this.#usage(result.usage),
        // Not priced here. Cost belongs to the turn record and depends on a
        // price table this build does not ship — reporting a fabricated number
        // would be worse than reporting none.
        cost: null,
        // `generateText` resolves its steps; `streamText` promises them.
        modelId: modelThatAnswered(result.finalStep.response, request.modelId),
        finishReason: finishReasonOf(result.finishReason),
        ...(request.schema === undefined ? {} : { object: result.output }),
      };
    } catch (error) {
      /**
       * **A reply that would not parse is a result, not a transport failure** —
       * [P7.4].
       *
       * The SDK throws `NoObjectGeneratedError` out of `generateText` when the
       * text will not parse as JSON, which would otherwise discard the model's
       * words, its usage and its finish reason on the way past. It does not:
       * the error carries all three (measured — `text`, `usage`,
       * `finishReason`, `response`), so this reassembles the ordinary result and
       * lets the engine decide.
       *
       * That division is the one {@link GenerationRequest.schema} draws: the
       * adapter says what the endpoint did, and whether a miss is worth asking
       * again is a policy the caller holds. Recovered here rather than there
       * because the error's fields are the SDK's vocabulary, which stops at this
       * file.
       */
      const recovered = recoverFromParseFailure(error, request);
      if (recovered !== null) return { ...recovered, usage: this.#usage(recovered.rawUsage) };
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
     * [manual gate §2.2](../../../../docs/design/workplan/11-p2-manual-gate.md) asks a tester to make
     * returned the same wrong answer, and a 429 was never retried because
     * nothing could see it was a 429.
     */
    if (failure !== undefined) throw asProviderError(failure);

    /**
     * **Awaited separately and allowed to fail**, which is the streaming half of
     * the rule `generate` states above: the text has already been handed to the
     * caller chunk by chunk, so a reply that will not parse cannot be allowed to
     * take it back. `undefined` reaches the engine as *asked for a shape and did
     * not get one*, with everything else about the call intact.
     *
     * *A caller asking for a schema **and** a stream gets JSON streamed a
     * character at a time, which is nobody's idea of progress — but the adapter
     * is not the place to refuse it. `invoke` decides whether to stream.*
     */
    const object =
      request.schema === undefined ? undefined : await result.output.then(asIs, asNothing);

    return {
      text,
      usage: this.#usage(await result.usage),
      cost: null,
      modelId: modelThatAnswered((await result.finalStep).response, request.modelId),
      finishReason: finishReasonOf(await result.finishReason),
      ...(request.schema === undefined ? {} : { object }),
    };
  }

  /**
   * Usage, or null — never a guess.
   *
   * Two gates, and both matter: a provider that declares it does not report
   * usage must not appear to, and a provider that declares it does can still
   * answer with nothing. `ModelCall.usage` is *"provider-reported, not
   * estimated"* ([21 §1.4](../../../../docs/design/21-internal-contracts.md)),
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

/**
 * The SDK's structured-output option, when the caller asked for one — [P7.4].
 *
 * **`Output.object` parses; it does not validate, and that is measured rather
 * than assumed.** Handed a schema requiring `name` with
 * `additionalProperties: false`, a reply of `{"nom":"Vera"}` comes back as a
 * successful object. `jsonSchema()` is a *carrier* — it is what puts the schema
 * on the wire so the model is told what to produce — and nothing on this side
 * checks that it did. So `GenerationResult.object` means **the endpoint returned
 * parseable JSON**, never *the JSON fits*, and the engine validates.
 *
 * Worth stating here in the adapter, because this is the file where somebody
 * would reasonably assume the SDK had done it.
 */
function outputFor(request: GenerationRequest): Record<string, unknown> {
  if (request.schema === undefined) return {};
  // The cast is the seam: `GenerationRequest.schema` is a plain `object`
  // because the engine's own vocabulary is JSON Schema documents, and
  // `jsonSchema()` wants the SDK's `JSONSchema7`. Same bytes, two names.
  return { output: Output.object({ schema: jsonSchema(request.schema as JSONSchema7) }) };
}

/** What `#usage` reads, named so the recovery path can carry one across. */
type SdkUsage = { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined;

/** Identity and its opposite, for `then(asIs, asNothing)`. */
function asIs(value: unknown): unknown {
  return value;
}

function asNothing(): undefined {
  return undefined;
}

/**
 * The ordinary result hiding inside a parse failure — [P7.4].
 *
 * `NoObjectGeneratedError` is the SDK saying *the text did not parse*, and it
 * carries what the call produced anyway: the model's words, the usage the
 * endpoint reported, and why it stopped. Everything except the object is a
 * perfectly good record of a call that happened, so throwing would lose four
 * true facts to report one absent one.
 *
 * Returns `null` for anything else, so a 429 and a refused connection still go
 * to `asProviderError` and still classify.
 *
 * *`rawUsage` rather than `usage`: the caller applies `#usage`, which is the
 * gate that refuses to report numbers a provider said it does not send. Doing
 * it here would be a second copy of that rule.*
 */
function recoverFromParseFailure(
  error: unknown,
  request: GenerationRequest,
): (Omit<GenerationResult, 'usage'> & { rawUsage: SdkUsage }) | null {
  if (!NoObjectGeneratedError.isInstance(error)) return null;

  return {
    text: error.text ?? '',
    rawUsage: error.usage,
    cost: null,
    // The error carries the response metadata, so the model that answered is
    // still knowable — and a model substitution is exactly the kind of thing
    // that might *explain* a reply that would not parse.
    modelId: modelThatAnswered(error.response, request.modelId),
    finishReason: finishReasonOf(error.finishReason),
    // Deliberately present and undefined: the caller asked for a shape, so the
    // field belongs in the answer, and its emptiness is the answer.
    object: undefined,
  };
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
 * surfacing a provider string ([21 §1.4]).
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

/**
 * The model that answered, falling back to the one that was asked for — F29.
 *
 * Both paths used to return `request.modelId`, which made
 * `ModelCall.resolved.modelId` a copy of the request and every check over it a
 * comparison of a value with itself. It matters for the ordinary reason a record
 * exists: an endpoint that silently serves a different model — an alias, a
 * fallback, a router picking for you — is exactly the thing *"why is this turn
 * different"* has to be able to answer.
 *
 * The fallback is not a formality: a local runtime often echoes nothing, and
 * naming the request is better than naming nothing. What it must never do is
 * *look* like a report when it is a guess, which is why the record keeps the
 * distinction the docstring on {@link GenerationResult.modelId} states.
 */
function modelThatAnswered(response: { modelId?: string } | undefined, asked: string): string {
  const answered = response?.modelId;
  return answered === undefined || answered.length === 0 ? asked : answered;
}

/**
 * The SDK's finish reason, narrowed to the vocabulary a record carries.
 *
 * `'other'` and `'error'` both become `unknown`, and so does an absent one. That
 * is the case worth naming: **a stream that simply stops** — no finish reason,
 * no error, no `[DONE]` — is the local runtime's characteristic failure, and it
 * used to be recorded as an ordinary success with a short answer.
 */
function finishReasonOf(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content-filter':
      return 'filtered';
    case 'tool-calls':
      return 'tool';
    default:
      return 'unknown';
  }
}
