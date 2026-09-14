// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  ErrorClass,
  FinishReason,
  GenerationParams,
  RenderedMessage,
  TokenUsage,
} from '@storyengine/shared';

/**
 * The provider layer's contracts — [22 §2, §3](../../../../docs/design/22-internal-contracts.md)
 * and [20 §5](../../../../docs/design/20-tech-stack.md), as code.
 *
 * **The wrapper is not ceremony.** It is where model-hint resolution happens,
 * where role bindings resolve to connections, where per-call cost is captured
 * for the turn record, and where capability negotiation lives — *"this model
 * has no tool calling, degrade to prompted JSON with validation"*. The AI SDK
 * sits behind it, and swapping the SDK is a change to one adapter rather than
 * to the engine.
 *
 * It is **not** where a raw-completion adapter attaches, because there is not
 * one ([20 §5.5](../../../../docs/design/20-tech-stack.md)): if it speaks
 * OpenAI-compatible chat it works, and if it does not it does not. That is a
 * position, and it is stated in `docs/api.md` rather than left to be
 * discovered.
 */

/**
 * The eight roles a step may ask for.
 *
 * **Steps never name a model.** They name a role, and the install binds roles
 * to connections ([20 §5.1](../../../../docs/design/20-tech-stack.md)) — which
 * is what makes an install portable, an extension safe to share, and an actor's
 * `modelHint` resolvable as a *request* rather than as a binding.
 */
// The role vocabulary and the wire-adjacent record shapes moved to
// `@storyengine/shared` at [P3.0] — they are fields of the turn record, and
// the record's shapes live together (`packages/shared/src/turn.ts`).
// Re-exported so this module stays the provider layer's one import site.
export { MODEL_ROLES } from '@storyengine/shared';
export type {
  ErrorClass,
  FinishReason,
  ModelRole,
  RenderedMessage,
  TokenUsage,
} from '@storyengine/shared';

/**
 * What an endpoint can do, and where it stops.
 *
 * Verbatim from [22 §3](../../../../docs/design/22-internal-contracts.md) — the
 * discipline this phase is under is that the contracts become code *as
 * written*, and a deviation goes into the doc first because five later phases
 * are specified against it.
 */
export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  /** Whether consecutive same-role messages are acceptable. [22 §2] */
  mergeSameRole: 'required' | 'preferred' | 'never';
  /**
   * Whether a leading system message is supported at all — some endpoints want
   * it folded into the first user message.
   */
  systemMessage: 'supported' | 'fold-into-first-user';
  /** Hard: what the endpoint accepts. */
  maxPromptChars?: number;
  /** Soft: where quality degrades. */
  usefulPromptChars?: number;
  maxContextTokens?: number;
  /**
   * Whether the provider reports token usage. When false, the record's `usage`
   * is null and the budgeter's margin is the only signal.
   */
  reportsUsage: boolean;
}

export class ProviderError extends Error {
  readonly class: ErrorClass;
  /** The provider's own words, for the log. Never rendered as UI copy. */
  readonly detail: string | undefined;

  constructor(errorClass: ErrorClass, message: string, detail?: string) {
    super(message);
    this.name = 'ProviderError';
    this.class = errorClass;
    this.detail = detail;
  }
}

/** One request to one model. Everything a provider needs and nothing it does not. */
export interface GenerationRequest {
  /** Resolved by the caller from a role — the provider never resolves. */
  modelId: string;
  messages: RenderedMessage[];
  params: GenerationParams;
  /**
   * Structured output, when the caller wants it and the provider can do it.
   * Where it cannot, the caller degrades to prompted JSON — which is a decision
   * the caller makes with the capabilities in hand, not a silent fallback here.
   *
   * ***Honoured since [P7.4]*** (2026-09-12), and with one thing the sentence
   * above does not say: **the adapter does not validate.** Measured against the
   * SDK — `jsonSchema()` is a carrier that puts the document on the wire so the
   * model is told what to write, and `{"nom":"Vera"}` comes back as a successful
   * object against a schema requiring `name` with `additionalProperties: false`.
   * So {@link GenerationResult.object} means *the endpoint returned parseable
   * JSON*, never *the JSON fits*, and validating is the engine's.
   *
   * *The degrade is still owed: `openai-compatible` declares
   * `supportsStructuredOutput: false` by default, so out of the box the schema
   * is dropped and the endpoint is asked for bare JSON.*
   */
  schema?: object;
  signal?: AbortSignal;
}

export interface GenerationResult {
  text: string;
  /** Null when the provider does not report it — never estimated to fill a gap. */
  usage: TokenUsage | null;
  /** Null when the provider does not price the call. */
  cost: { amount: number; currency: string } | null;
  /** What the model actually was, which is not always what was asked for. */
  modelId: string;
  /**
   * Why the model stopped — the difference between an answer and an
   * interruption.
   *
   * `length` is a completion ceiling reached, which is a *truncated* reply
   * wearing a finished one's clothes: same shape, same absence of an error, and
   * the only thing that tells them apart. `unknown` is a stream that ended
   * without saying, which is the local runtime's characteristic failure and is
   * not a success either.
   *
   * Never null. A provider that says nothing gets `unknown`, because *the
   * provider did not say* and *nobody asked* must not look alike.
   */
  finishReason: FinishReason;
  /**
   * Present when the caller asked for structured output — **`undefined` when
   * the reply would not parse**, which is different from absent.
   *
   * The key is the adapter saying *you asked for a shape*; its value is whether
   * one arrived. A call nobody asked a schema of carries no key at all, so
   * *nobody asked* and *asked and missed* are distinguishable by the caller,
   * which is what lets a miss be retried without retrying every prose call that
   * happened to return nothing.
   *
   * **Parsed, not validated** — see {@link GenerationRequest.schema}.
   */
  object?: unknown;
}

/** A streamed chunk. Text only — everything structural arrives with the result. */
export interface GenerationChunk {
  text: string;
}

/**
 * The thin internal interface.
 *
 * Deliberately small: two calls and a capability record. Anything that grows
 * this interface is either a capability (which belongs above) or engine work
 * that has drifted into the adapter.
 */
export interface Provider {
  /** Stable identifier for the adapter kind — `openai-compatible`, `fake`. */
  readonly kind: string;
  readonly capabilities: ProviderCapabilities;

  generate(request: GenerationRequest): Promise<GenerationResult>;

  /**
   * Streams text, then resolves the same result `generate` would have.
   *
   * Present only when `capabilities.supportsStreaming`. The caller checks;
   * a provider that cannot stream does not pretend to by yielding once.
   */
  stream?(request: GenerationRequest): AsyncGenerator<GenerationChunk, GenerationResult>;
}

/**
 * A resolved model: which connection, and which of its models.
 *
 * **Here rather than in `roles.ts`, where it was, because the session record
 * needs it** — [P7.3]. `SessionFile.roles` carries per-session overrides
 * ([20 §5.1](../../../../docs/design/20-tech-stack.md)), and importing them from
 * `roles.ts` would pull `connections.ts` and the whole storage layer into the
 * session record's type graph for the sake of two strings. This module is the
 * leaf both sides already depend on.
 */
export interface Binding {
  connectionId: string;
  modelId: string;
}
