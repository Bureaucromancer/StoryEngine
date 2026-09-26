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
 * The provider layer's contracts — [21 §2, §3](../../../../docs/design/21-internal-contracts.md)
 * and [19 §5](../../../../docs/design/19-tech-stack.md), as code.
 *
 * **The wrapper is not ceremony.** It is where model-hint resolution happens,
 * where role bindings resolve to connections, where per-call cost is captured
 * for the turn record, and where capability negotiation lives — *"this model
 * has no tool calling, degrade to prompted JSON with validation"*. The AI SDK
 * sits behind it, and swapping the SDK is a change to one adapter rather than
 * to the engine.
 *
 * It is **not** where a raw-completion adapter attaches, because there is not
 * one ([19 §5.5](../../../../docs/design/19-tech-stack.md)): if it speaks
 * OpenAI-compatible chat it works, and if it does not it does not. That is a
 * position, and it is stated in `docs/api.md` rather than left to be
 * discovered.
 */

/**
 * The eight roles a step may ask for.
 *
 * **Steps never name a model.** They name a role, and the install binds roles
 * to connections ([19 §5.1](../../../../docs/design/19-tech-stack.md)) — which
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
 * Verbatim from [21 §3](../../../../docs/design/21-internal-contracts.md) — the
 * discipline this phase is under is that the contracts become code *as
 * written*, and a deviation goes into the doc first because five later phases
 * are specified against it.
 */
export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  /** Whether consecutive same-role messages are acceptable. [21 §2] */
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
  /**
   * ***Whether this endpoint makes pictures*** — [P9 §1.2], [P9.2].
   *
   * **False in the conservative baseline, and left false everywhere in
   * `KNOWN_PROVIDERS`.** `openai-compatible` is a name for a *chat* protocol,
   * and whether the URL behind it also answers `/images/generations` is a fact
   * about that endpoint rather than about the protocol. So this is set per
   * connection, which is where `capabilities.ts` says a limit belongs — *"a
   * limit is a property of that endpoint, and connections are private production
   * config"*.
   *
   * **It is what makes the `image` role honest.** [19 §5.1] leaves that role
   * unset until a matching connection exists *"because there is no sensible
   * text-model fallback for it"*, and without this field a person could bind
   * `image` to their chat endpoint and discover the mistake one turn later. The
   * binding surface reads it, the runner's gate reads it, and both say so
   * plainly rather than failing obscurely — [P2B]'s dangling posture, applied to
   * a capability.
   */
  rendersImages: boolean;
  /**
   * How many named subjects one picture can hold.
   *
   * ***A capability rather than a sentence in a prompt*** — [06 §10.3] is
   * explicit: *"it belongs beside `maxPromptChars` in [19 §5.3]'s block rather
   * than in prose to a model. Aventuras caps at one for consistency's sake;
   * Marinara derives both a visible-character limit and a reference-image limit
   * that runs from one to sixteen depending on the backend. **A number that
   * varies per endpoint is the definition of a capability.**"*
   *
   * Undeclared rather than defaulted, for the reason the two prompt caps are:
   * *a wrong cap is worse than no cap*, and this file ships no invented numbers.
   */
  maxNamedSubjects?: number;
}

export class ProviderError extends Error {
  readonly class: ErrorClass;
  /** The provider's own words, for the log. Never rendered as UI copy. */
  readonly detail: string | undefined;
  /**
   * The HTTP status the endpoint answered with, when it answered at all.
   *
   * ***Added for the connection test ([polish §13]), and for one distinction
   * the class cannot make.*** A refused key and a model the endpoint does not
   * serve are both `terminal` — correctly, since retrying either is pointless —
   * but they send a person to opposite fields of the form, which is finding 5
   * in [P2C log](../../../../docs/design/workplan/14-p2c-log.md) and the reason
   * the `/models` route already answers `unauthorized` apart from
   * `unreachable`. The class is the engine's vocabulary; this is the one fact
   * about the response a caller needs to say *which field*.
   *
   * **Safe to carry where `detail` is not**: a number cannot echo a key, so it
   * may reach a response body as a class-deciding input without the endpoint's
   * words coming with it. `undefined` is *nothing answered* — a refused port,
   * a timeout — and not a status of its own.
   */
  readonly status: number | undefined;

  constructor(errorClass: ErrorClass, message: string, detail?: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.class = errorClass;
    this.detail = detail;
    this.status = status;
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
/**
 * One request for one picture — [06 §10](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P9.2].
 *
 * **A prompt and scalars, and the restriction is the recipe's.** These values
 * are re-sent verbatim when a rendition is re-created and are hashed into its
 * reuse digest, so a nested object would need canonicalising before either was
 * byte-stable. A provider wanting structure flattens it, where somebody can see
 * the flattening.
 */
export interface ImageRequest {
  /** Resolved by the caller from the `image` role — the provider never resolves. */
  modelId: string;
  /** The assembled, capped prompt. [19 §5.3]'s ranked fragments, as sent. */
  prompt: string;
  /**
   * ***The caller's, not the adapter's***, which is what makes the recipe a
   * recipe. [06 §10.7] calls the seed *"the load-bearing field here, and the one
   * an implementation is most likely to drop as uninteresting"* — and an adapter
   * that chose its own would be choosing the one value the record has to be able
   * to state.
   */
  seed: number;
  workflow: Readonly<Record<string, string | number | boolean>>;
  signal?: AbortSignal;
}

/** What came back. Bytes, and what it took to make them. */
export interface ImageResult {
  bytes: Uint8Array;
  mime: string;
  /** What the endpoint says answered, which may not be what was asked for. */
  modelId: string;
  /** Echoed back, so the record states what ran rather than what was requested. */
  seed: number;
  cost: { amount: number; currency: string } | null;
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

  /**
   * ***Pixels*** — [P9 §1.2], decided at [P9.2] **and decided under that
   * document's own warning.**
   *
   * §1.2 is the one decision [P9](../../../../docs/design/workplan/26-p9-implementation.md)
   * deliberately declined to make: it wanted *"one real image endpoint in hand,
   * not another paragraph"*, and this was written without one. So the answer is
   * recorded here with what would reverse it, which is the only honest form a
   * decision taken early can take.
   *
   * ***A second arm rather than a second provider kind***, and three things
   * decide it:
   *
   * - **The capability record already straddles both shapes.** It carries
   *   `maxPromptChars` and `usefulPromptChars`, whose own docstring is about
   *   CLIP's 77-token window, beside `supportsTools` and `mergeSameRole`. One
   *   record is already answering two questions, and splitting the interface
   *   would not split that.
   * - **[19 §5.5] makes a second *kind* the larger claim.** It says the chat bet
   *   is reversible at a single seam *because rendering is isolated as one
   *   step*, which is an argument for a second renderer rather than for a second
   *   protocol vocabulary.
   * - **`Connection`, role binding and the five-layer override order are worth
   *   reusing whichever answer wins** (§1.2 says so in as many words), and a
   *   second kind would fork all three.
   *
   * ***What would reverse it***, stated so a later phase can act rather than
   * re-derive: **an image endpoint whose request is not prompt-plus-scalars** —
   * a ComfyUI graph, an img2img mask, a multi-stage pipeline.
   * {@link ImageRequest.workflow} is scalar-only because the recipe has to be
   * byte-reproducible, so the first endpoint that needs structure is the one
   * that makes this a second kind. That is one field's failure, visible at one
   * seam, which is the property being bought.
   *
   * **Present only when `capabilities.rendersImages`.** The caller checks — the
   * rule `stream` above already states, and here it is what keeps an `image`
   * binding from looking bound when nothing can serve it.
   */
  renderImage?(request: ImageRequest): Promise<ImageResult>;
}

/**
 * A resolved model: which connection, and which of its models.
 *
 * **Here rather than in `roles.ts`, where it was, because the session record
 * needs it** — [P7.3]. `SessionFile.roles` carries per-session overrides
 * ([19 §5.1](../../../../docs/design/19-tech-stack.md)), and importing them from
 * `roles.ts` would pull `connections.ts` and the whole storage layer into the
 * session record's type graph for the sake of two strings. This module is the
 * leaf both sides already depend on.
 */
export interface Binding {
  connectionId: string;
  modelId: string;
}
