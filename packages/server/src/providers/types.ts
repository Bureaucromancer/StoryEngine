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
   * ***Whether this endpoint takes a sampling seed for a picture*** —
   * [06 §10.7]'s load-bearing field, and the one fact about it that belongs to
   * the endpoint rather than to the recipe.
   *
   * **False in the conservative baseline, and so false everywhere until a
   * connection says otherwise** — `rendersImages`' posture, for the reason
   * `supportsStructuredOutput` is off for `openai-compatible`: the endpoint
   * behind the protocol could be anything. `seed` is not part of the OpenAI
   * images request, and an endpoint strict about its schema refuses a field it
   * does not know — OpenAI's own answers an unknown parameter with a 400 — so
   * sending it unasked would turn a picture that would have been made into a
   * `terminal` failure. Where the endpoint does take one, one line on the
   * connection says so.
   *
   * *What it decides is whether the seed leaves the process, which is all an
   * adapter can know.* Whether the endpoint then honours it, no response says;
   * the record keeps which one was **sent** (`RenditionProvenance.seedSent`),
   * and an ignored seed is the honest failure: [06 §10.7] makes the seed what
   * re-creation depends on, and the record still states what was sent.
   */
  supportsImageSeed: boolean;
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
   * The endpoint accepted the request and then went quiet past a limit the
   * transport kept (2026-09-27): terminal, and the opposite remedy to a
   * refusal, which the class alone cannot say — `CallFailed.stalled`'s case,
   * reported from below `performCall` instead of by its own timer.
   */
  readonly stalled: boolean;

  constructor(
    errorClass: ErrorClass,
    message: string,
    detail?: string,
    how: { stalled?: boolean } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.class = errorClass;
    this.detail = detail;
    this.stalled = how.stalled === true;
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
  /**
   * ***The bytes of every picture the messages name*** — [25 E15], R1. Keyed by
   * digest, as a message's image parts are, and present only when a message has
   * one. **Never persisted**: the record names pictures by digest and this is
   * where they are loaded for the wire, and nowhere else.
   *
   * *An adapter that cannot send a picture never receives one*, because the
   * caller decides per call from the connection's `imageModels` whether a
   * picture goes as pixels or as words; one that receives this is being told
   * the model it is calling sees.
   */
  images?: ReadonlyMap<string, { bytes: Uint8Array; mime: string }>;
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
   *
   * *Whether it leaves the process is the connection's to say*, not the
   * caller's — {@link ProviderCapabilities.supportsImageSeed}.
   */
  seed: number;
  /**
   * Everything else the endpoint is asked for — **minus the seed**, which is the
   * contract every producer writes to and the one `recipeDigest` enforces by
   * stripping a `seed` key before it hashes. An adapter strips it too: the
   * recipe has one seed, and it is {@link ImageRequest.seed}.
   */
  workflow: Readonly<Record<string, string | number | boolean>>;
  signal?: AbortSignal;
}

/** What came back. Bytes, and what it took to make them. */
export interface ImageResult {
  bytes: Uint8Array;
  mime: string;
  /** What the endpoint says answered, which may not be what was asked for. */
  modelId: string;
  /**
   * The seed the recipe asked for, echoed so the record states it from the
   * result rather than from the request. ***Not a claim that it ran*** — see
   * {@link ImageResult.seedSent} for how far that claim can go.
   */
  seed: number;
  /**
   * ***Whether the seed left the process*** — which is as far as an adapter can
   * see.
   *
   * `false` when the connection does not declare
   * {@link ProviderCapabilities.supportsImageSeed}, and then the endpoint made
   * the picture from a seed of its own that no response reports: re-creating it
   * will not reproduce it, and the record has to be able to say so rather than
   * showing a number the endpoint never saw. `true` means *sent*, never
   * *honoured* — nothing in an images response says which.
   */
  seedSent: boolean;
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
