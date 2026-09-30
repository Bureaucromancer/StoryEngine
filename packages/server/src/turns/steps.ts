// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  CastEntry,
  StepCondition,
  StepDefinition,
  StepImplementation,
  StepInput,
  TranscriptTurn,
} from '@storyengine/sdk';

import type { CallPurpose } from '../assembly/types.js';
import { keyBelongsTo } from '../sessions/channels.js';
import { storyTurns } from '../sessions/depth.js';
import type { ChannelState, StepSkipReason, Turn, TurnAttachment } from '../sessions/types.js';

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
  CastEntry,
  EffectProposal,
  StepCallRequest,
  StepCallResult,
  StepCondition,
  StepDefinition,
  StepHost,
  StepImplementation,
  StepInput,
  StepResult,
  TranscriptTurn,
} from '@storyengine/sdk';

/** What the runner knows about the turn when it evaluates a condition. */
export interface ConditionContext {
  /**
   * How many story turns are on the path to the head, before this one — a
   * channel write or a backdrop choice is on the path and is not one
   * (`sessions/depth.ts`).
   */
  turnsOnPath: number;
  /** Stage flags the mode has raised. Empty until P2.6 supplies a mode. */
  stages: ReadonlySet<string>;
  /**
   * Flags the user armed for this turn — ***produced at last*** ([P14.5b],
   * [25 C17]): a submission's `push` arms `push`, which the director's step
   * waits on (`turns/direct.ts`). Empty on every other turn.
   */
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
    input?: {
      actorId: string | null;
      kind: string;
      text: string;
      raw: string;
      attachments?: TurnAttachment[];
    };
    speakers?: readonly string[];
    voice?: StepInput['voice'];
    dispatch?: StepInput['dispatch'];
    setup?: Readonly<Record<string, unknown>>;
    channels: Record<string, ChannelState>;
    history: readonly Turn[];
    output?: StepInput['output'];
    cast?: readonly CastEntry[];
    /** A person's run between turns ([P14.5a]) — see `StepInput.onDemand`. */
    onDemand?: true;
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
     * the mode's own turn.
     *
     * *~~and `reads` has exactly two pseudo-sources ([06 §6]) rather than a
     * growing list of them.~~* **The count was wrong when it was written and is
     * wronger now** (2026-09-16): `cast` made three at [P7.12] and `transcript`
     * makes four at [P8.1], so the list did grow. **The argument does not depend
     * on the count and never did** — what matters is that every member is a
     * *source a step might not be entitled to*, and the mode's own policy
     * applied to the mode's own turn is not one. `transcript` is the sharpest
     * case for the rule rather than against it: it was added precisely so a step
     * could be denied something, which is the first widening of this union that
     * makes a payload smaller.
     */
    ...(everything.speakers === undefined ? {} : { speakers: everything.speakers }),
    /**
     * ***How the session speaks, unfiltered for `speakers`' reason*** —
     * [P14.2]. The session's own settings applied to the session's own turn,
     * which every step of its mode is entitled to; and without them a step
     * could not decide whether to make one call or one per speaker, which is
     * the decision [P14 §1.4] leaves to the mode.
     */
    ...(everything.voice === undefined ? {} : { voice: everything.voice }),
    ...(everything.dispatch === undefined ? {} : { dispatch: everything.dispatch }),
    // Unfiltered for `speakers`' reason: the mode's own declaration, answered
    // for the mode's own session.
    ...(everything.setup === undefined ? {} : { setup: everything.setup }),
    /**
     * **Filtered like a channel, and by the same field** — [P7.12]. A step that
     * does not declare `cast` is not handed one, which is what `reads` is for:
     * a payload is the thing the step said it needed, and a scene's whole cast
     * is not a small thing to hand somebody who did not ask.
     */
    ...(everything.cast === undefined || !definition.reads.includes('cast')
      ? {}
      : { cast: everything.cast }),
    channels,
    ...(definition.reads.includes('history') ? { history: everything.history } : {}),
    /**
     * ***The narrow half of `history`, and it is a projection rather than a
     * slice*** — [P8 §1.5], [P8.1]. `history` above hands over whole `Turn`s,
     * and a `Turn` carries `request.calls[].blocks[].text`: a hook's premise, an
     * unfired entrance's finished prose and a hidden channel's rendered value,
     * verbatim. [08 §6] asks that memory never be extracted from those and says
     * the mitigation must be *refuse at the source* rather than a filter,
     * *"because the extraction has already written the sentence down"* — and
     * against this contract there was no source to refuse at.
     *
     * So the projection: what was said, what came back, and the node it was on.
     * **Derived here rather than by the caller**, so there is exactly one
     * statement anywhere of what a transcript is; a runner that built its own
     * would be a second such statement, and the two would drift on the first
     * field somebody added to `Turn`.
     */
    ...(definition.reads.includes('transcript')
      ? { transcript: transcriptOf(everything.history) }
      : {}),
    ...(definition.reads.includes('output') && everything.output !== undefined
      ? { output: everything.output }
      : {}),
    // Unfiltered, like `speakers`: not a read of anything, but the engine
    // saying why the step is running at all.
    ...(everything.onDemand === true ? { onDemand: true as const } : {}),
  };
}

/**
 * A path as `reads: ['transcript']` sees it — [P8.1].
 *
 * **`raw` is dropped along with the record**, which is worth naming because it
 * is the one field a reader might expect to survive: it is the player's text
 * *before* mention resolution, and a step entitled to the resolved text has no
 * claim on the unresolved one. Everything else here is the smallest thing that
 * still lets a consumer attribute what it found to a node ([P8 §1.4]).
 */
export function transcriptOf(path: readonly Turn[]): TranscriptTurn[] {
  /**
   * ***The story's turns, not the path's*** (2026-09-27). A channel write, an
   * undo or a backdrop choice is a turn on the path with nothing said in it,
   * and it took a place in the summary chain's stretches and in the window
   * beside it — each HUD edit shifted the in-progress link and re-derived it,
   * and each one pushed a turn of the story out of the window without a word
   * of it being in the prompt. `storyTurns` is the one reading the window and
   * the chain share.
   */
  return storyTurns(path).map((turn) => ({
    turnId: turn.id,
    ...(turn.input === undefined
      ? {}
      : {
          input: {
            actorId: turn.input.actorId,
            kind: turn.input.kind,
            text: turn.input.text,
            // Kind and caption only — a transcript is *what was said*, and the
            // bytes and their address are not ([25 E15]).
            ...(turn.input.attachments === undefined || turn.input.attachments.length === 0
              ? {}
              : {
                  attachments: turn.input.attachments.map((attachment) => ({
                    kind: attachment.kind,
                    ...(attachment.caption === undefined ? {} : { caption: attachment.caption }),
                  })),
                }),
          },
        }),
    ...(turn.output === undefined ? {} : { output: { text: turn.output.text } }),
  }));
}
