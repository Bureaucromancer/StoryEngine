// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  StepCondition,
  StepDefinition,
  StepImplementation,
  StepInput,
} from '@storyengine/sdk';

import type { CallPurpose } from '../assembly/types.js';
import { keyBelongsTo } from '../sessions/channels.js';
import type { ChannelState, StepSkipReason, Turn } from '../sessions/types.js';

/**
 * Steps, and the boundary they run behind —
 * [06 §6](../../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * A turn is an ordered sequence of steps; the built-in stages are steps that
 * always exist. A step declares what it reads, what it writes, and where it may
 * run — and the declaration is what the engine enforces, rather than a
 * convention the step is trusted to follow.
 */

/**
 * **The step contract moved to `@storyengine/sdk` at [P7.0]**, and what stayed
 * here is everything that *decides*: the condition evaluator, the purpose
 * derivation, the payload filter, and the plan the runner walks.
 *
 * That split is the boundary in miniature — a mode declares and the engine
 * enforces ([06 §2]) — and it is why the move is a move rather than a rewrite.
 * Re-exported so the pipeline's import paths stay put.
 */
export type {
  Candidate,
  EffectProposal,
  StepCallRequest,
  StepCallResult,
  StepCondition,
  StepDefinition,
  StepHost,
  StepImplementation,
  StepInput,
  StepResult,
} from '@storyengine/sdk';

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
 * This is what makes [06 §5.2]'s refusal structural rather than remembered.
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
 * **The limit this used to name is half closed, at [P7.0].** §5.2's first
 * exclusion is *the RNG service and anything consuming it*, and this derivation
 * still does not cover it — but the thing it could not cover has changed shape.
 * A prose step is no longer handed an `Rng`: it is handed
 * [`RandomApi`](../rng/random.ts), so the draw is the engine's and there is a
 * seam to enforce the rule at. ~~Nothing at P2.5 draws inside a prose step~~ —
 * and that sentence was retired before this one was written: the retriever
 * draws inside a prose step's `call` at [P5.6], engine-side of the seam and
 * never from a mode's own body, which is the precision the rule turns on.
 * Enforcing it *structurally* still waits on the worker split ([22 §4]).
 */
export function callPurposeFor(step: StepDefinition): CallPurpose {
  return step.contributes === 'messages' && step.writes.length === 0 ? 'prose' : 'effects';
}

export interface TurnStep {
  definition: StepDefinition;
  run: StepImplementation;
}

/** Ordered. The runner executes in this order and never sorts. */
export interface TurnPlan {
  steps: readonly TurnStep[];
}

/**
 * Builds a step's payload from what it declared — [22 §3.1].
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
    speakers?: readonly string[];
    setup?: Readonly<Record<string, unknown>>;
    channels: Record<string, ChannelState>;
    history: readonly Turn[];
    output?: { text: string };
  },
): StepInput {
  /**
   * **A declared read takes the channel's scoped values too**, which a lookup
   * by bare id would miss entirely.
   *
   * A step asking for `se.lore.timing` wants every entry's timing, not the one
   * value that happens to sit under the unscoped key — and for an entry-scoped
   * channel there is no such value at all, so the step would read an empty map
   * and quietly behave as though nothing had ever fired. The declaration stays
   * the channel id, because that is what a step author knows; the widening is
   * here, where the map's key form is already a local concern.
   */
  const channels: Record<string, ChannelState> = {};
  for (const [key, state] of Object.entries(everything.channels)) {
    if (definition.reads.some((id) => keyBelongsTo(key, id))) channels[key] = state;
  }

  return {
    turnId: everything.turnId,
    sessionId: everything.sessionId,
    parentTurnId: everything.parentTurnId,
    ...(everything.input === undefined ? {} : { input: everything.input }),
    /**
     * **Unfiltered, like `input`** — [P7.3]. [22 §3.1]'s rule is about sources a
     * step might not be entitled to; this is the mode's own policy applied to
     * the mode's own turn, and `reads` has exactly two pseudo-sources ([06 §6])
     * rather than a growing list of them.
     */
    ...(everything.speakers === undefined ? {} : { speakers: everything.speakers }),
    // Unfiltered for `speakers`' reason: the mode's own declaration, answered
    // for the mode's own session.
    ...(everything.setup === undefined ? {} : { setup: everything.setup }),
    channels,
    ...(definition.reads.includes('history') ? { history: everything.history } : {}),
    ...(definition.reads.includes('output') && everything.output !== undefined
      ? { output: everything.output }
      : {}),
  };
}
