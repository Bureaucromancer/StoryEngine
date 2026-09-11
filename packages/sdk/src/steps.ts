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
 * ([22 §4](../../../docs/design/22-extensions.md),
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
 * **The second divergence [22 §4] recorded, settled the same way**: a step
 * *proposes* and the engine decides, so the proposal carries no verdict. 22
 * described a step returning full effects; the engine's narrower shape is the
 * one that makes [21 §1.2](../../../docs/design/21-internal-contracts.md)'s
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
 * The omission is the design. [22 §3.1] gives the payload-filter rule this
 * implements — *a step that did not declare `history` does not receive it* — and
 * `reads` can name a channel, `history` or `output` and nothing else, so
 * guidance is not expressible there and could only arrive as an ungated extra.
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
export interface StepInput {
  turnId: string;
  sessionId: string;
  parentTurnId: string | null;
  input?: { actorId: string | null; kind: string; text: string; raw: string };
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
