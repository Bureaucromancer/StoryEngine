// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  BlockSource,
  ChannelEffect,
  ChannelState,
  EffectOp,
  GenerationParams,
  ModelRole,
  StepStage,
  TokenUsage,
  Turn,
} from '@storyengine/shared';

import type { RandomApi } from './random.js';

/**
 * Steps, and the boundary they run behind —
 * [06 §6](../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * A turn is an ordered sequence of steps; the built-in stages are steps that
 * always exist. A step declares what it reads, what it writes, and where it may
 * run — and the declaration is what the engine enforces, rather than a
 * convention the step is trusted to follow.
 *
 * **These moved here from `server` at [P7.0](../../../docs/design/workplan/23-p7-implementation.md),
 * and the move is what makes them a contract.** They were always written as
 * one — `modes/contract.ts` enumerated them so a mode reached for nothing else
 * — but a type list a mode is *asked* to respect and one it is *able* to reach
 * are different things, and the second needs a package the engine is not on the
 * other side of. What stays in the engine is everything that decides: the
 * condition evaluator, the payload filter, the purpose derivation, the runner.
 * What is here is what a step author writes against.
 */

/**
 * When a step runs — [06 §6]'s closed set, spelled out.
 *
 * Three arms and no more: *a cadence, a stage flag, an explicit arm by the
 * user*. Deliberately **not an expression language**, and deliberately not the
 * authored-rule predicate vocabulary either — the tempting move once rules
 * arrive is to let steps take rule predicates, and that quietly makes an
 * internal shape depend on a portable one.
 *
 * A step that runs every turn is `{ when: 'cadence', everyNTurns: 1 }`. There is
 * no `always` arm, because adding one would be a fourth member of a set the
 * design calls closed, and the cadence already says it.
 */
export type StepCondition =
  | { when: 'cadence'; everyNTurns: number }
  | { when: 'stage'; flag: string }
  | { when: 'armed'; flag: string };

export interface StepDefinition {
  id: string;
  stage: StepStage;
  /**
   * Channel ids, plus the two pseudo-sources [06 §6] names — `history` and
   * `output`.
   *
   * Typed as bare `string` rather than `string | 'history' | 'output'`: a
   * union with `string` in it collapses to `string` anyway, so the literals
   * would be documentation pretending to be types. A channel id is an open
   * vocabulary ([06 §4] lets a mode declare its own), so this cannot be closed.
   */
  reads: string[];
  /** Channel ids this step may propose effects on. */
  writes: string[];
  contributes?: 'blocks' | 'effects' | 'messages';
  /**
   * What kind of call this step makes — [04 §8.2]'s portable, open string, which
   * a preset block's `appliesTo` filters on.
   *
   * Distinct from the assembler's `CallPurpose`, which is *derived* from
   * `contributes` and `writes` and decides whether guidance is admitted. This
   * one is authored vocabulary: it is how a preset says *this block is for
   * narration and not for the summariser*.
   */
  callKind: string;
  when: StepCondition;
  failure: 'abort' | 'warn' | 'ignore';
  /** The role its call asks for, or null when it makes none. */
  role: ModelRole | null;
}

/**
 * One candidate, before the budgeter has ruled on it.
 *
 * **This is the shape a step returns, and publishing it settles a divergence
 * the boundary document recorded and left open**
 * ([23 §4](../../../docs/design/23-extensions.md),
 * [P7 §1.2](../../../docs/design/workplan/23-p7-implementation.md)). 22 has a
 * step handing back `blocks: AssembledBlock[]`; the engine has it handing back
 * candidates, and the engine is right — a *block* is what the assembler
 * produces once the budgeter has ruled, and a step cannot produce one because
 * it does not know what fits. So the contract takes the step's shape and 22 is
 * the document that gets corrected.
 */
export interface Candidate {
  id: string;
  source: BlockSource;
  /**
   * Why it is here, in the words the workbench shows: *"keyword match:
   * 'cathedral'"*, *"pinned by user"*, *"always"*. **A product feature, not a
   * debug string** — which is also why it is required rather than optional.
   */
  reason: string;
  role: 'system' | 'user' | 'assistant';
  text: string;
  /**
   * Lower drops first. Absent means "the preset did not say", which the
   * budgeter treats as the middle rather than as the most expendable.
   */
  priority?: number;
  /**
   * Never dropped by the budgeter. For the things a request is meaningless
   * without — the user's own message.
   */
  required?: boolean;
  /**
   * **Guidance, and anything else that may influence prose and nothing else.**
   *
   * [06 §5.2](../../../docs/design/06-modes-and-turn-pipeline.md) is a
   * specification rather than a preference: guidance must never be admissible
   * to a call whose output determines a systematic result. Enforced
   * structurally rather than by convention — the assembler refuses to admit an
   * advisory block to a call declared as producing effects or verdicts, and a
   * step declaring a non-empty `writes` is such a call.
   */
  advisory?: boolean;
}

/**
 * What a step hands back when it wants to change channel state. It cannot stamp
 * `before`, `applied` or an id.
 *
 * **The second divergence [23 §4] recorded, settled the same way**: a step
 * *proposes* and the engine decides, so the proposal carries no verdict. 22
 * described a step returning full effects; the engine's narrower shape is the
 * one that makes [22 §1.2](../../../docs/design/22-internal-contracts.md)'s
 * *a refused effect stays in the record* enforceable, because only the engine
 * can record a refusal.
 */
export interface EffectProposal {
  channelId: string;
  scopeKey?: string | null;
  op: EffectOp;
  after: unknown;
  proposedBy: ChannelEffect['proposedBy'];
}

/**
 * What a step is given — plain data, and **no guidance**.
 *
 * The omission is the design. [23 §3.1] gives the payload-filter rule this
 * implements — *a step that did not declare `history` does not receive it* — and
 * `reads` names a channel or one of [06 §6]'s pseudo-sources and **nothing that
 * is not a source**, so guidance is not expressible there and could only arrive
 * as an ungated extra.
 *
 * *Was "`history` or `output` and nothing else", which `cast` made wrong 78
 * lines below at [P7.12] — the same sentence [06 §6] and [23 §3.1] carry, and
 * all three needed the same correction (2026-09-13). What matters to the
 * argument is unchanged, and is why the count was never load-bearing: every
 * member of that union is a **source**, and guidance is not one.*
 * A step handed the guidance text could re-emit it as an ordinary candidate, and
 * the assembler would admit it: the refusal keys on `Candidate.advisory`, not on
 * where the words came from. Guidance therefore reaches the prompt only as a
 * candidate the *runner* collects, marked advisory, and never passes through a
 * step at all.
 *
 * Serialisable both ways, because [01 §2](../../../docs/design/01-source-survey.md)
 * makes the step contract async and serialisable a day-one item — this is the
 * payload that crosses a worker hop, and the host below is what gets proxied
 * rather than cloned.
 */
/**
 * One person in the scene, as a step sees them — [P7.12].
 *
 * *Deliberately not an `Actor`.* The full card is prose, sections, provenance
 * and forty fields, and handing one to every step that wants a name would make
 * the payload filter meaningless. This is what a step can act on: who they are,
 * and what pictures travel with them.
 */
export interface CastEntry {
  actorId: string;
  name: string;
  /** The object kind that carries the media, for addressing it. Actors today. */
  kind: string;
  media: readonly { id: string; role: string; label?: string }[];
}

export interface StepInput {
  turnId: string;
  sessionId: string;
  parentTurnId: string | null;
  input?: { actorId: string | null; kind: string; text: string; raw: string };
  /**
   * **Who the mode's participant policy says talks this turn** — [06 §7.2],
   * [P7.3].
   *
   * Actor ids, in the order the policy chose them, over whoever presence and
   * status say is available. A step that makes one merged call can ignore it; a
   * step that speaks for somebody passes one of these as
   * `StepCallRequest.actorId`, which is how an actor reaches `resolveRole`'s
   * last layer.
   *
   * **Not filtered by `reads`, and the exception is principled.** [23 §3.1]'s
   * payload filter is about *sources* — a channel, the history, the output —
   * things a step might not be entitled to. This is the mode's own declaration
   * applied to the mode's own turn, so every step of that mode is entitled to
   * it by construction, the same way `input` is. A `reads: ['speakers']` would
   * be a fourth pseudo-source in a set [06 §6] names as two.
   *
   * **Empty is a real answer**, and `manual` is where it happens: nobody was
   * named, so nobody in particular is speaking. It is not the same as absent,
   * which is a turn whose mode declares `fixed` and makes no selection at all.
   */
  speakers?: readonly string[];
  /**
   * ***Who is in the scene, and what they look like*** — declared by
   * `reads: ['cast']`, added at
   * [P7.12](../../../docs/design/workplan/23-p7-implementation.md).
   *
   * **A gap a mode found by needing it.** [06 §7.2] asks for *expression
   * selection* as a step writing a channel, and a step could not see an actor's
   * expression set at all: `speakers` above carries ids and nothing else, and
   * `StepHost` has no library reader until [23 §4]'s capability API. A mode that
   * had to be handed its own cast by the engine would be the back door [06 §2]
   * refuses — so the contract widens instead, which is what P7 is for.
   *
   * ***The manifest, never the bytes.*** [04 §3] makes `EmbeddedMedia` *"a
   * reference to bytes carried by the container"*, and this carries the
   * reference: an id, a role and a label. A step that wanted pixels would be a
   * step doing I/O, and nothing here does I/O.
   *
   * *Filtered like a channel*, so a step that does not declare `cast` is not
   * handed one — which is what `reads` is for, and what keeps a step's payload
   * the thing it said it needed.
   */
  cast?: readonly CastEntry[];
  /**
   * **What the mode's wizard was answered with** — [06 §7.3], [P7.4].
   *
   * Keyed by the field ids the mode declared, and validated against the schema
   * derived from that declaration before the session was written — so a key here
   * is one this mode asked for, and its value is the shape the widget implies.
   *
   * **Present on every turn, not only the setup one**, which is a choice worth
   * naming: a part generates from the answers, and a *step* may want them too —
   * a narrator that knows the premise, a difficulty dial the prompt pack keys
   * off. The alternative is a mode reading its own setup through a back door,
   * which [06 §2] is the section that refuses.
   *
   * **Not filtered by `reads`**, like `input` and `speakers` and for the same
   * reason: [23 §3.1]'s filter is about *sources* a step might not be entitled
   * to, and this is the mode's own declaration answered for the mode's own
   * session.
   *
   * Absent for a mode with no wizard, which is every mode with
   * `setup: { kind: 'none' }`.
   */
  setup?: Readonly<Record<string, unknown>>;
  /** Only the channels `reads` named. */
  channels: Record<string, ChannelState>;
  /** Present only when `reads` includes `history`. */
  history?: readonly Turn[];
  /** Present only when `reads` includes `output`. */
  output?: { text: string };
}

export interface StepResult {
  candidates?: Candidate[];
  effects?: EffectProposal[];
  message?: { text: string; reasoning?: string };
}

export interface StepCallRequest {
  /**
   * Which actor this call speaks for — [20 §5.1](../../../docs/design/20-tech-stack.md),
   * [P7 §1.9], added at [P7.3].
   *
   * **The last and weakest resolution layer had no way to be reached.** 19 §5.1
   * orders the layers *install default → role binding → session override → step
   * override → actor hint*, and `resolveRole` has applied a hint since P2B — but
   * §1.9 found it *"never passed either"*, and named the reason: *"today one
   * turn makes one merged call and an actor is not in the resolution at all."*
   * This is how an actor gets into it.
   *
   * **A step says who it is speaking for; the engine finds the card and applies
   * the hint.** Not the hint itself, because [04 §3]'s `ModelHint` is *"a
   * preference, never a binding — an imported card may express what it wants; it
   * can never repoint anyone's provider"*, and a step handed the preference
   * could pass one the card does not carry. Passing an *id* keeps the card the
   * only source.
   *
   * **Absent is a merged call**, which is what `dispatch: 'merged'` means and
   * what every shipped step does: one reply for the scene, spoken by nobody in
   * particular, resolved with no hint. `per-actor` dispatch is a mode fanning
   * this out — the mode half is [P7.9]'s, since no shipped mode declares it, but
   * the engine half is here and works for a single call just as well.
   */
  actorId?: string;
  params?: GenerationParams;
  /** Omitted means everything accumulated so far. */
  candidates?: readonly Candidate[];
  stream?: boolean;
  schema?: object;
}

export interface StepCallResult {
  callId: string;
  text: string;
  object?: unknown;
  usage: TokenUsage | null;
}

/**
 * The capability set a step is handed. Never the services, never a logger,
 * never a reply.
 *
 * `call` takes no role and no purpose: the runner derives both from the
 * definition. That is what stops a step choosing its own way past [06 §5.2],
 * and it is what keeps the boundary narrow enough to cross a worker hop.
 *
 * **None of these three is data, and that is the distinction worth holding.**
 * `StepInput` and `StepResult` cross the hop by being cloned; the host is
 * *proxied* — a function cannot be cloned at all, and an `AbortSignal` clones
 * to a detached object whose `aborted` never fires, which is worse. Every
 * member added here is another thing a worker has to bridge, which is the
 * argument for the set staying this small.
 */
export interface StepHost {
  call(request: StepCallRequest): Promise<StepCallResult>;
  /** Keyed and asynchronous — see [`random.ts`](./random.ts). */
  random: RandomApi;
  signal: AbortSignal;
}

export type StepImplementation = (input: StepInput, host: StepHost) => Promise<StepResult>;
