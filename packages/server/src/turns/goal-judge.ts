// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Candidate, StepDefinition, StepImplementation } from '@storyengine/sdk';
import type { Goal } from '@storyengine/shared';

import { SE_GOAL } from '../sessions/goals.js';

/**
 * Did the turn that just happened meet the goal? —
 * [06 §7.3.3](../../../../docs/design/06-modes-and-turn-pipeline.md), built at
 * [P7.6](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * *"`kind: 'narrative'` means an evaluation step at `post` judges whether the
 * goal is met — the before-narration evaluation pass from [02 §4.3], pointed at
 * a different question."*
 *
 * **`post`, which is what makes it a different pass from the hook selector's.**
 * The selector runs at `pre` and asks about the turn that is *about* to happen;
 * this runs after the prose exists and asks about the turn that just did. It is
 * the second engine-owned step in the build — `planFor` builds neither, because
 * both read things a Setup carries and a Setup is authored content rather than a
 * mode.
 *
 * ***Bias toward under-firing, and it is written into three places rather than
 * hoped for.*** [06 §7.3.3]: *"Both error directions are bad and they are not
 * symmetric: a missed completion is an annoyance the player can resolve
 * manually, while a false completion ends the story on a turn that did not earn
 * it."* So the prompt says to answer no when unsure, the schema's answer is a
 * plain boolean whose absence reads false, and anything the reader cannot parse
 * is *not met*.
 *
 * *And manual completion is always available* — the same section's other half —
 * which is the channel write route, not this step.
 */

export const SE_GOALS_JUDGE = 'se.goals.judge';

export const GOAL_JUDGE_STEP: StepDefinition = {
  id: SE_GOALS_JUDGE,
  stage: 'post',
  reads: [SE_GOAL, 'history', 'output'],
  writes: [SE_GOAL],
  // No `contributes`: what this produces is an effect, and the words it sends
  // are its own candidates rather than anything the turn's prompt keeps.
  callKind: 'goal-judge',
  when: { when: 'cadence', everyNTurns: 1 },
  /**
   * **`warn`, never `abort`.** The turn's prose already exists by the time this
   * runs — it is a `post` step — so a judge that failed the turn would throw
   * away narration over a verdict the player can reach manually anyway.
   */
  failure: 'warn',
  /**
   * `prose`, for the reason [P7.5]'s selector records and [26 C15] generalises:
   * `resolveRole` has no cross-role fallback and nothing in this build binds any
   * role but this one, so asking for `fast` would make every goal-bearing
   * session log a failed step. An install that wants something cheaper says so
   * through the session's `stepRoles`.
   */
  role: 'prose',
};

export interface GoalJudgeReport {
  /** The goal the call was asked about, and whether it said yes. */
  goalId: string;
  met: boolean;
  /**
   * ***The call that answered, or null when nothing was asked*** (2026-09-27).
   *
   * The runner credited a completion to the turn's last call, and the judge is
   * not the last step that calls: the suggester, the memory extractor and an
   * illustration run after it. With any of them on, the record named *their*
   * call as the reasoning for the completion, which is the misattribution the
   * `{ kind: 'model', callId }` stamp exists to prevent. Only the judge knows
   * which call it judged in, so it says.
   */
  callId: string | null;
}

export interface GoalJudgeContext {
  goal: Goal;
  report: (report: GoalJudgeReport) => void;
}

/**
 * Builds the engine's `{ definition, run }` pair for a turn that has a goal to
 * judge.
 *
 * **The effect goes back through the runner rather than out of the step**, which
 * is the same route [P7.5]'s firing takes and for a related reason: what an
 * achievement means for the session — which offers to raise, whether anything
 * else moves — is the engine's to decide, and a step that wrote the channel
 * directly would be a `model-proposed` write attributed to a step rather than to
 * the model whose judgement it is.
 *
 * *Attribution matters here more than it did for hooks.* `se.goal` is not the
 * build's first `model-proposed` channel — `se.presence`, `se.status` and
 * `se.party` have been since [P3.0] — but it is **the first one a model's own
 * judgement is written to**, and until this step nothing in the build stamped
 * an effect `{ kind: 'model' }` at all. The whole point of the policy is that a
 * **model** may propose; the runner stamps `{ kind: 'model', callId }`, so the
 * record says a model judged this and the workbench can show the call.
 */
export function goalJudge(context: GoalJudgeContext): {
  definition: StepDefinition;
  run: StepImplementation;
} {
  return {
    definition: GOAL_JUDGE_STEP,
    run: async (input, host) => {
      const prose = input.output?.text ?? '';
      // Nothing was narrated, so nothing can have met anything. Saves a call on
      // a turn that failed upstream, and answers the same way it would have.
      if (prose.trim() === '') {
        context.report({ goalId: context.goal.id, met: false, callId: null });
        return {};
      }

      const result = await host.call({
        candidates: [
          block('se.goals.judge.task', 'system', TASK),
          block('se.goals.judge.goal', 'system', goalText(context.goal)),
          block('se.goals.judge.turn', 'user', prose),
        ],
        schema: {
          type: 'object',
          properties: {
            met: { type: 'boolean' },
            why: { type: 'string' },
          },
          required: ['met'],
          additionalProperties: false,
        },
      });

      context.report({
        goalId: context.goal.id,
        met: answered(result.object ?? result.text),
        callId: result.callId,
      });
      return {};
    },
  };
}

/**
 * The instruction, in the engine rather than in the prompt pack — the same line
 * [P7.5]'s selector draws and for the same reason: this is the question that
 * makes the call's **schema** answerable, which is protocol rather than prose,
 * and a pack able to edit it could make the answer not parse.
 *
 * *The difficulty **levels'** prose is the pack's, and that is [P7.8]'s.* What
 * is here is only the verdict question.
 */
const TASK = [
  'You are judging whether a story objective has just been met.',
  'Answer met=true only if the passage below shows it actually achieved.',
  'Answer false if it is merely closer, likely, promised, or about to happen.',
  'When you are unsure, answer false: a missed completion is corrected in one',
  'click, and a false one ends a story on a turn that did not earn it.',
].join('\n');

function goalText(goal: Goal): string {
  /**
   * **The `detail` is sent here and nowhere else**, which is exactly what
   * [04 §7.1] reserves it for: *"available to steps; not injected by default, so
   * a long one costs nothing per turn."* This is a step, it runs at most once a
   * turn, and a judge given only the one-line statement would be ruling on less
   * than the author wrote down.
   */
  return goal.detail === null || goal.detail === ''
    ? `The objective: ${goal.statement}`
    : `The objective: ${goal.statement}\n\nWhat it means: ${goal.detail}`;
}

/** A verdict, or *not met* — the safe direction for anything unreadable. */
function answered(from: unknown): boolean {
  if (typeof from === 'object' && from !== null && 'met' in from) {
    return from.met === true;
  }
  // The degraded path's answer is a string the endpoint was asked to shape
  // ([P7.4]: `openai-compatible` declares no structured output by default). A
  // reply that is not JSON we can read is *not met*, which is the direction
  // [06 §7.3.3] chooses for every error here.
  if (typeof from !== 'string') return false;
  try {
    return answered(JSON.parse(from) as unknown);
  } catch {
    return false;
  }
}

function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_GOALS_JUDGE },
    // Author-facing English, as P2.5 established for `reason`.
    reason: 'goal completion check',
    role,
    text,
    required: true,
  };
}
