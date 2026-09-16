// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Renditions — [06 §10](../../../docs/design/06-modes-and-turn-pipeline.md),
 * [21 §7](../../../docs/design/21-internal-contracts.md), built at [P9.0].
 *
 * A **rendition** is a non-text artefact derived from a turn: an illustration
 * inside the prose, or the backdrop a scene is staged against. [06 §10.1] gives
 * the interface and is the only place in the corpus that had it — six phases of
 * design referred to this type and none wrote it down, which is why [P9 §1.1]
 * makes the contract a stage rather than the first line of a feature.
 *
 * ***Internal tier, and this file sits beside `turn.ts` because that is what
 * decides it.*** That module's header states the rule and its expiry: *"no
 * `schema` field, no `$id`, no entry in `PORTABLE_SCHEMAS`, no emitted JSON
 * Schema, no validation on import — changing any of it is a refactor, not a
 * compatibility event… **Session export ([25 B12]) is the event that ends this
 * freedom**."* A rendition hangs off a turn and travels with the session
 * directory, so it is governed by exactly that sentence. It lives in this
 * package for `turn.ts`'s other reason too: the client renders the placeholder,
 * the retry, the sibling picker and the workbench row, and would otherwise
 * re-declare all of it.
 *
 * **Which is also [P9 §1.1]'s answer to P11, and it owed one.** That section
 * leans *internal rather than portable* and then says the lean can no longer be
 * left indefinitely, because export ships at 1.0: *"P9 owes P11 an answer rather
 * than a lean: what a rendition contributes to an exported session, and whether
 * the recipe travels with it."* The answer is **the recipe travels and the
 * pixels do not** — `prompt` and `provenance` are bytes and an `asset` is
 * megabytes, which is §10.7's own arithmetic — and a rendition graduates to
 * `schema/` **when the turn record does**, by the same migration. Anything else
 * makes exporting a turn and exporting its pictures two events.
 *
 * *There is a `schema` tag on {@link Rendition} and it is not a contradiction.*
 * It marks the **file on disk**, so a reader can tell a rendition from whatever
 * else ends up in that directory — the discipline `Snapshot` and `SummaryLink`
 * already follow, and a different thing from a `$id` in a published registry.
 *
 * Pure types plus one constant, per this package's header rule: no I/O and no
 * runtime behaviour. Everything that *produces* one is in the server.
 */

/**
 * What a rendition file claims to be.
 *
 * Checked on read the way `readSummary` checks its own, and every failure is a
 * miss rather than an error: [03 §5.1] makes hand-editing a supported way to get
 * data in, so a stray file in that directory must not take a session down.
 */
export const RENDITION_SCHEMA = 'storyengine.rendition/1';

/**
 * How a rendition is produced — provider, latency, cost
 * ([06 §10.1](../../../docs/design/06-modes-and-turn-pipeline.md)).
 *
 * **Closed from the first commit with one value ever written**, which is
 * [06 §10.5]'s argument and [P9 §1.6]'s: the three kinds differ in provider,
 * latency and cost and *not in lifecycle*, so a union held open now costs one
 * line and a union widened later costs a migration over stored records. Nothing
 * in this build writes `video` or `speech`; the shape is general and the
 * implementation is images.
 */
export type RenditionKind = 'image' | 'video' | 'speech';

/**
 * What a rendition is *for* — where it renders and how long it lives
 * ([06 §10.1a](../../../docs/design/06-modes-and-turn-pipeline.md), [P9 §1.7]).
 *
 * ***Unlike {@link RenditionKind}, both values are built.*** This is not a field
 * reserved against a later feature; it is a distinction 1.0 makes, and keeping
 * it out of `kind` is what lets *"the three kinds differ in provider, latency
 * and cost — not in lifecycle"* stay true. An animated backdrop is
 * `{ kind: 'video', purpose: 'background' }` here and inexpressible in the
 * version that spent the `kind` union on it.
 */
export type RenditionPurpose = 'illustration' | 'background';

export type RenditionState = 'pending' | 'ready' | 'failed';

/**
 * Why a rendition has no pixels — **a class, never the endpoint's sentence**.
 *
 * [21 §1.4]'s rule, which `ProviderError` already splits the same way: the
 * server does not know the reader's language, so what reaches a surface is
 * something the client can render and the provider's own words go to the log.
 *
 * `interrupted` is the one this subsystem adds and it is not a provider
 * outcome: it is what a job found `running` at boot becomes. `state/commit.ts`
 * says why that is the honest answer rather than a gap — *"recovery resumes
 * finalisation, never generation"* — and a provider call is not resumable while
 * a placeholder with a retry is pressable.
 */
export type RenditionError = 'transient' | 'retryable' | 'terminal' | 'interrupted' | 'no-binding';

/**
 * Which part of the turn a rendition renders, and where inside it.
 *
 * `messageId` is for [06 §10.5]'s per-actor dispatch — speech is per utterance
 * and a turn under `per-actor` holds several — and nothing writes it at 1.0.
 * `anchor` is written on the first turn this phase illustrates, which is what
 * makes it a different argument from the other reserved fields rather than a
 * longer version of the same one.
 *
 * ***The anchor is a verbatim quote and deliberately not a span***
 * ([06 §10.4a]). Mentions use `{ start, end }` because the scan that produced
 * them can be re-run when the text is edited; a rendition has no scan to re-run,
 * because the call that wrote the anchor *"is deliberately not made twice"*
 * (§10.3). So it holds a quote and resolves at render time against whatever the
 * text now says — and **a miss is ordinary**: the image renders at the end of
 * its message, the miss is recorded, and the rendition stays `ready`. A picture
 * in slightly the wrong place is a worse outcome than a picture and a far better
 * one than an error.
 */
export interface RenditionScope {
  messageId?: string;
  anchor?: string;
}

/**
 * One fragment as it was offered to the capper, kept whether or not it survived.
 *
 * ***Every fragment, not only the kept ones**, and that is what turns an outcome
 * into a recipe.* `CappedPrompt.kept` is a list of *ids*, so a record that
 * stored only the outcome could name what it dropped and could never reproduce
 * the input the cap ran over — which is the one thing re-creation needs.
 *
 * *Structurally `PromptFragment` from `providers/prompt-caps.ts`, restated
 * rather than imported, and the direction of the dependency is why.* That module
 * is server-side because `budgetFor` takes a `ProviderCapabilities`, and this
 * package is the leaf both sides import — a `shared` that reached into the
 * server would invert the graph for four fields. The server's assembler maps one
 * to the other in two lines, which is the cheaper of the two prices.
 */
export interface RecordedFragment {
  id: string;
  text: string;
  /** Lower goes first when something has to be dropped. */
  rank: number;
  /** A fragment the prompt is pointless without — the subject of an image. */
  required?: boolean;
}

/** What the cap dropped, and which of the two limits caused it. */
export interface DroppedFragmentRecord {
  id: string;
  rank: number;
  reason: 'over-hard-cap' | 'over-useful-cap';
}

/**
 * A rendition's prompt, as assembled and as sent —
 * [06 §10.1](../../../docs/design/06-modes-and-turn-pipeline.md)'s
 * `AssembledPrompt`.
 *
 * ***The type that field named did not exist anywhere.*** One grep hit in the
 * whole corpus, the line that names it — which is [P9 §1.1]'s point about this
 * phase in miniature: the interface refers to three types and only one of them
 * had been written down.
 *
 * **It is `CappedPrompt` plus the input the cap ran over plus the separator**,
 * and those three additions are what make the phase's central property
 * expressible. The property, stated here so the shape reads as the reason for
 * it: `capPrompt(fragments, budget, separator).text === text`, for every
 * rendition, forever. [06 §10.3] needs it because the moment — the one fragment
 * with an author — must be *"written once, stored in `prompt` as the fragment it
 * is, and **replayed** on re-creation, never asked for again"*, and [25 E3]
 * spells out the consequence: *"re-creating an evicted rendition makes no text
 * call at all."*
 *
 * It is also what [P9 §1.7]'s reuse digest hashes, so two requirements are one
 * field.
 *
 * *`budget` is `number | null` where `PromptBudget` is `number | undefined`,
 * because this is a stored record and `undefined` does not survive JSON. One
 * conversion function each way, so the two encodings cannot drift.*
 */
export interface AssembledPrompt {
  /** Every fragment that went in, ranked. Includes the ones `dropped` names. */
  fragments: readonly RecordedFragment[];
  /** What `capPrompt` joined the survivors with. */
  separator: string;
  budget: { maxChars: number | null; usefulChars: number | null };
  /** The prompt as it was sent. Derivable, stored, and re-derived by the property test. */
  text: string;
  /** Fragment ids, in kept order. */
  kept: readonly string[];
  /** Never silently — [19 §5.3]'s rule, on the record. */
  dropped: readonly DroppedFragmentRecord[];
  /** True when the required fragments alone exceed the hard cap. */
  overCap: boolean;
}

/**
 * The recipe: what actually ran, and everything needed to run it again —
 * [06 §10.7](../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * ***A type of its own, and [P9 §1.1] is the argument for not reusing the one
 * the design names.*** [06 §10.1] types `Rendition.provenance` as
 * `GeneratedFieldProvenance`, which ships in `schema/common.ts` and **cannot
 * carry this**. Two reasons, different sizes:
 *
 * - *Its `seed` is the wrong seed.* That field is documented *"the input the
 *   generation ran from"* — a prompt string an assist ran against — and §10.7
 *   means the **sampling seed**, which it calls *"the load-bearing field here,
 *   and the one an implementation is most likely to drop as uninteresting"*. The
 *   two readings are one word apart, so an implementation that reused the type
 *   would satisfy it, pass review, and ship a rendition that cannot be
 *   reproduced. Typing this one `number` makes them unmixable at the type level
 *   rather than by memory.
 * - *There is no field for workflow parameters at all*, which the same paragraph
 *   says are never discarded.
 *
 * ***And widening `GeneratedFieldProvenance` would have been the worse repair.***
 * It is a **portable** type, reachable from five emitted schemas through
 * `GeneratedMap`, so a sampling seed and a parameter blob added to it would
 * travel inside every exported actor card — production settings crossing into
 * shareable content, which is the line [00 §3.2] draws and which [01 §1]
 * criticises `GameSetupConfig` for crossing.
 *
 * ***`workflow` holds scalars only, and the restriction is the recipe's.*** These
 * values are re-sent verbatim on re-creation and hashed into the digest, and a
 * nested object is a thing whose key order has to be canonicalised before either
 * is byte-stable. Scalars need no canonicaliser. A provider wanting structure
 * flattens it, where somebody can see the flattening.
 */
export interface RenditionProvenance {
  /** When the pixels were made. Null while pending. */
  at: string | null;
  /**
   * The **resolved** binding, never the role —
   * [P8 §1.9](../../../docs/design/workplan/25-p8-implementation.md)'s rule
   * arriving at its second subject: *"the whole binding, not the model id. Two
   * connections serving what they both call `llama-3.1-8b` are not the same
   * model."*
   *
   * **The connection's id and never the connection**, which is
   * `ModelCall.resolved`'s argument verbatim: a `Connection` holds `apiKey` and
   * `baseUrl`, and this record is a file on somebody's disk.
   */
  binding: { connectionId: string; modelId: string } | null;
  /** What the endpoint said answered, when it is not what was asked for. */
  answeredAs: string | null;
  /**
   * The sampling seed — §10.7's load-bearing field, and the one this type
   * exists for.
   *
   * `null` when the provider neither took one nor reported one back, which is
   * honest rather than convenient: *"preserved"* would otherwise quietly mean
   * *"approximately re-creatable"*, and §10.7 says those are not the same
   * promise. A workbench row showing `null` here is telling somebody something
   * true about their endpoint.
   */
  seed: number | null;
  /** Everything else the endpoint was asked for. Never discarded (§10.7). */
  workflow: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Where the pixels are, when there are any.
 *
 * ***Not [04 §3]'s `AssetRef`, which is what [06 §10.1] names*** — and this is
 * [P9 §1.1]'s finding a second time, in a field one line below the first.
 * `AssetRef` is `{ path, role: MediaRole, label? }`, and three things are wrong
 * with it here:
 *
 * - **`MediaRole` has no `illustration`.** Its eight members are a vocabulary
 *   about *authored* media, in which an illustration is nothing; filing one as
 *   `gallery` to satisfy a required field is the half-fit that makes a union
 *   stop meaning anything, and filing it as `background` would duplicate
 *   `purpose` for one value and lie for the other.
 * - **It carries no `mime`**, which is the one thing the asset route must answer
 *   with.
 * - **It is portable**, reachable from five published schemas, so widening
 *   `MediaRole` for an internal record is a compatibility event bought with
 *   nothing.
 *
 * What is kept rather than inherited is its one genuinely good rule: `path` is
 * relative to the session's own directory and *"never absolute, never escaping
 * it"*. `digest` is the etag, for the reason `GET /library/:kind/:id/media/:mediaId`
 * gives — bytes that have not changed should not be re-fetched because a
 * neighbouring field did — and that route's own comment named this phase as the
 * next consumer of the shape.
 */
export interface RenditionAsset {
  /** Relative to `sessions/<id>/assets/`. Never absolute, never escaping it. */
  path: string;
  mime: string;
  bytes: number;
  /** `sha256:<hex>` over the bytes, as `EmbeddedMedia.digest` is. */
  digest: string;
}

/**
 * One rendition — [06 §10.1](../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * **`prompt` and `provenance` are not diagnostics; they are the durable half of
 * the object** (§10.7). The `asset` may be evicted and the record stays whole
 * with `asset: null`, which is what lets an eviction *policy* be a later
 * decision rather than a migration ([25 E3], [P9 §1.4]) — and that only holds if
 * both fields are written from the first commit and never dropped.
 *
 * ***One file per rendition, and concurrency is what decides it.*** The tempting
 * shape is one file per turn holding an array, which makes rendering a
 * transcript one read per visible turn instead of one directory listing. It also
 * makes two workers finishing two renditions of one turn a lost update, because
 * each rewrites the whole file. A rendition is written by exactly one worker and
 * read by everybody, so the file is the unit the writer owns — which is
 * `snapshots.ts`' and `summaries.ts`' shape for the same reason, and `readTurns`'
 * shape on the reading side.
 */
export interface Rendition {
  schema: typeof RENDITION_SCHEMA;
  id: string;
  sessionId: string;
  /**
   * The turn whose state produced it.
   *
   * ***This is the whole of the branching story*** ([06 §10.2]): a rendition is
   * **not** a channel effect and takes no part in state reconstruction, so a
   * branch inherits a turn's renditions by inheriting the turn, and a rewind
   * makes them unreachable because reachability is the path walk and nothing
   * else. [P9 §1.7]'s check is that the code written to make that work is empty.
   *
   * *A rendition names its turn; a turn does not name its renditions* — which is
   * also the only direction that works for one made by hand forty turns later.
   */
  turnId: string;
  createdAt: string;
  kind: RenditionKind;
  purpose: RenditionPurpose;
  scope: RenditionScope | null;
  state: RenditionState;
  /**
   * **Never null once the record exists**, and this is where the shape parts
   * company with [06 §10.1]'s sketch.
   *
   * A `pending` rendition whose prompt were null would be a record that cannot
   * be re-run, so *the recipe outlives the pixels* would be false during exactly
   * the window in which the pixels do not exist — which is the window an
   * interrupted job leaves a record in. The record is written **after** assembly
   * and before dispatch, so there is no moment at which it is `null`.
   */
  prompt: AssembledPrompt;
  /** Null while pending, and null once evicted — §10.7, [P9 §1.4]. */
  asset: RenditionAsset | null;
  provenance: RenditionProvenance;
  error: RenditionError | null;
  /**
   * The reuse key — [P9 §1.7], and the field that makes a backdrop cost one
   * image per *place* rather than one per turn.
   *
   * A hash over the assembled fragments **as sent**, excluding the sampling
   * seed, **and including the resolved binding**. That last clause is the
   * amendment [P9 §0.3] made to §1.7: without it, rebinding the `image` role
   * returns the old provider's backdrop for every place already visited,
   * permanently and with no way to ask for the new one.
   *
   * On every rendition rather than only on backgrounds: it costs nothing to
   * compute, it is what the exit gate's recipe-survives-eviction property
   * compares, and a field that exists for one purpose is a field somebody has to
   * remember is absent for the other.
   */
  digest: string;
  /**
   * What the count judgement will sort on — [06 §10.4], deferred at [P9 §4].
   *
   * ***A field with a home and no consumer, and §10.4 asks for exactly that***:
   * *"Salience is recorded, not merely used. If the engine sorts on a number,
   * that number is on the rendition."* [P9 §4] lists this among the three things
   * that keep the deferral cheap — *"the ordering field the judgement will sort
   * on has a home on the record"* — so it ships at `0` and the later phase starts
   * writing it without a migration.
   */
  ordering: number;
  /**
   * The anchor did not occur in the message — [06 §10.4a], and **absent means it
   * did**.
   *
   * Only ever `false`, which is the absent-rather-than-empty rule the turn record
   * holds every optional field to, applied to a boolean: a `true` would be a
   * second way to say what absence already says, and the two would drift.
   */
  anchorResolved?: false;
}

/**
 * What the rendition step asks for — [P9.1].
 *
 * ***A list from the first commit, with one element*** — [P9 §4]'s first of the
 * three things that keep the count judgement's deferral cheap: *"the step
 * contract emits a **list** of rendition requests from the first commit even
 * though the list has one element"*. The later phase widens the producer and not
 * this type, which is the whole of what *does not foreclose it* costs here.
 *
 * It is a {@link Rendition} minus everything only the worker can know — no id,
 * no state, no asset, no provenance. Which is the honest reading of why the two
 * are different types rather than one with optional halves.
 */
export interface RenditionRequest {
  kind: RenditionKind;
  purpose: RenditionPurpose;
  scope: RenditionScope | null;
  prompt: AssembledPrompt;
  workflow: Readonly<Record<string, string | number | boolean>>;
  digest: string;
  ordering: number;
}

/**
 * What the rendition step decided, on the turn — [06 §10], [P9.1].
 *
 * ***Ids and a verdict, never records***, and the split is forced. A
 * rendition's `state` changes after the turn is written and a segment is never
 * rewritten ([03 §5.5]), so the mutable half lives in
 * `sessions/<id>/renditions/` and the turn keeps the one thing that was true
 * when it committed: what it asked for.
 *
 * `turns/suggest.ts` argued the identical fork at [P7.9] — *"generate them
 * inside the turn as a `post` step, or store them on the mutable half beside
 * `lastSelectedChild`"* — and took the first arm because a suggestion is
 * produced **during** the turn. A rendition is the one thing in this build that
 * is not, so it takes neither: the *report* is on the turn and the *record* is
 * beside it.
 */
export interface RenditionReport {
  /** Requested on this turn, in the order the step emitted them. */
  requested: readonly string[];
  /**
   * A background resolved to an existing rendition rather than paid for —
   * [P9 §1.7]'s money row, on the record rather than only in a counter.
   */
  reused?: { renditionId: string; digest: string };
  /**
   * Why nothing was asked for. Absent when something was.
   *
   * **The empty list is a real answer** ([06 §10.4]) and this is what keeps it
   * distinguishable from *the step did not run*, which is `Turn.renditions`
   * being absent altogether. A quiet session and a session with renditions off
   * are different facts, and the hook selector's `nothing-eligible` draws the
   * same line for the same reason.
   */
  held?: 'place-unchanged' | 'no-moment' | 'no-binding';
}

/**
 * Whether a session illustrates, and how often —
 * [06 §10.6](../../../docs/design/06-modes-and-turn-pipeline.md), [P9.4].
 *
 * The value of the `se.illustrate` channel. Here rather than in the server
 * because the settings control reads and writes it, which is `preview.ts`'
 * reason for being in this package.
 *
 * **`each-turn` is written to survive a phase it does not implement.** §10.6's
 * third setting is *"each turn that has a moment worth one"* — conditional,
 * because the count judgement is permitted to answer none — and what P9 ships
 * behind that label is one image per turn. The label is the later phase's; the
 * behaviour is this one's; and saying so here is cheaper than a rename over
 * stored channel values.
 *
 * ***The backdrop has no per-turn setting and that is not an omission***: *on*
 * means when the place changes, and a backdrop that regenerated every turn is
 * the failure mode rather than the thorough option. So it is a boolean channel
 * of Scene's own and has no type here.
 */
export type IllustrationMode = 'off' | 'on-demand' | 'each-turn';
