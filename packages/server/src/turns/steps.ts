// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { GenerationParams } from '@storyengine/shared';

import type { CallPurpose } from '../assembly/assemble.js';
import type { Candidate } from '../assembly/types.js';
import type { ModelRole, TokenUsage } from '../providers/types.js';
import type { Rng } from '../rng/rng.js';
import type {
  ChannelState,
  StepSkipReason,
  StepStage,
  Turn,
} from '../sessions/types.js';
import type { EffectProposal } from './effects.js';

/**
 * Steps, and the boundary they run behind —
 * [03 §6](../../../../docs/design/03-modes-and-turn-pipeline.md).
 *
 * A turn is an ordered sequence of steps; the built-in stages are steps that
 * always exist. A step declares what it reads, what it writes, and where it may
 * run — and the declaration is what the engine enforces, rather than a
 * convention the step is trusted to follow.
 */

/**
 * When a step runs — [03 §6]'s closed set, spelled out.
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
  /** Channel ids, plus the two pseudo-sources [03 §6] names. */
  reads: (string | 'history' | 'output')[];
  /** Channel ids this step may propose effects on. */
  writes: string[];
  contributes?: 'blocks' | 'effects' | 'messages';
  when: StepCondition;
  failure: 'abort' | 'warn' | 'ignore';
  /** The role its call asks for, or null when it makes none. */
  role: ModelRole | null;
}

/** What the runner knows about the turn when it evaluates a condition. */
export interface ConditionContext {
  /** How many turns are on the path to the head, before this one. */
  turnsOnPath: number;
  /** Stage flags the mode has raised. Empty until P2.6 supplies a mode. */
  stages: ReadonlySet<string>;
  /** Flags the user armed for this turn. */
  armed: ReadonlySet<string>;
}

export type ConditionDecision = { ok: true } | { ok: false; reason: StepSkipReason };

export function evaluateCondition(
  condition: StepCondition,
  context: ConditionContext,
): ConditionDecision {
  switch (condition.when) {
    case 'cadence': {
      // Counted over the path rather than over wall-clock or a stored counter:
      // a branch that rewinds four turns should get the cadence those four
      // turns had, which only holds if the count is derived from the path.
      const due = (context.turnsOnPath + 1) % condition.everyNTurns === 0;
      return due ? { ok: true } : { ok: false, reason: 'cadence' };
    }
    case 'stage':
      return context.stages.has(condition.flag) ? { ok: true } : { ok: false, reason: 'stage' };
    case 'armed':
      return context.armed.has(condition.flag) ? { ok: true } : { ok: false, reason: 'not-armed' };
  }
}

/**
 * What the assembler is told a call is for, **derived from the step's own
 * declaration and never chosen by it**.
 *
 * This is what makes [03 §5.2]'s refusal structural rather than remembered.
 * Guidance is advisory: it may shape prose and must never reach a systematic
 * outcome. If a step could pass its own purpose, honouring the rule would be one
 * honest declaration deep — a step could say `prose` and produce effects, and
 * `assemble` would admit the guidance block because `assemble` is told, not
 * asked.
 *
 * So the derivation fails closed. Guidance is admitted only to a step that
 * contributes to the visible message **and writes no channel**. That covers
 * every exclusion §5.2 enumerates: an extraction step contributes `effects`; an
 * engine-computed channel update has a non-empty `writes`; an
 * evaluate-before-narrate step contributes `blocks` and is refused, correctly.
 * Anything added later is refused until somebody argues otherwise here.
 *
 * **The honest limit:** §5.2's first exclusion is *the RNG service and anything
 * consuming it*, and this derivation does not cover that — a prose step is
 * handed both the guidance and an `Rng`. Nothing at P2.5 draws inside a prose
 * step, and the boundary that would enforce it is P7's worker split, where the
 * host supplies `random` rather than the step reaching for it ([12 §4]).
 */
export function callPurposeFor(step: StepDefinition): CallPurpose {
  return step.contributes === 'messages' && step.writes.length === 0 ? 'prose' : 'effects';
}

/**
 * What a step is given — plain data, and **no guidance**.
 *
 * The omission is the design. [12 §3.1] gives the payload-filter rule this
 * implements — *a step that did not declare `history` does not receive it* — and
 * `reads` can name a channel, `history` or `output` and nothing else, so
 * guidance is not expressible there and could only arrive as an ungated extra.
 * A step handed the guidance text could re-emit it as an ordinary candidate, and
 * `assemble` would admit it: the refusal keys on `Candidate.advisory`, not on
 * where the words came from. Guidance therefore reaches the prompt only as a
 * candidate the *runner* collects, marked advisory, and never passes through a
 * step at all.
 *
 * Serialisable both ways, because [01 §2] makes the step contract async and
 * serialisable a day-one item — the boundary P7 moves to a worker is this one,
 * and converting it later means touching every step.
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
 * definition. That is what stops a step choosing its own way past §5.2, and it
 * is what keeps the boundary narrow enough to cross a worker hop later.
 */
export interface StepHost {
  call(request: StepCallRequest): Promise<StepCallResult>;
  rng: Rng;
  signal: AbortSignal;
}

export type StepImplementation = (input: StepInput, host: StepHost) => Promise<StepResult>;

export interface TurnStep {
  definition: StepDefinition;
  run: StepImplementation;
}

/** Ordered. The runner executes in this order and never sorts. */
export interface TurnPlan {
  steps: readonly TurnStep[];
}

/**
 * Builds a step's payload from what it declared — [12 §3.1].
 *
 * A step that did not declare `history` does not receive it. The filter exists
 * now, with the first step, rather than as a retrofit when the boundary becomes
 * a worker: a payload built by subtraction later would have to guess which
 * fields were load-bearing.
 */
export function filterReads(
  definition: StepDefinition,
  everything: {
    turnId: string;
    sessionId: string;
    parentTurnId: string | null;
    input?: { actorId: string | null; kind: string; text: string; raw: string };
    channels: Record<string, ChannelState>;
    history: readonly Turn[];
    output?: { text: string };
  },
): StepInput {
  const channels: Record<string, ChannelState> = {};
  for (const id of definition.reads) {
    const state = everything.channels[id];
    if (state !== undefined) channels[id] = state;
  }

  return {
    turnId: everything.turnId,
    sessionId: everything.sessionId,
    parentTurnId: everything.parentTurnId,
    ...(everything.input === undefined ? {} : { input: everything.input }),
    channels,
    ...(definition.reads.includes('history') ? { history: everything.history } : {}),
    ...(definition.reads.includes('output') && everything.output !== undefined
      ? { output: everything.output }
      : {}),
  };
}
