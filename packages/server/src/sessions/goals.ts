// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChannelDefinition } from '@storyengine/sdk';
import type { Goal } from '@storyengine/shared';

import { channelKey } from './channels.js';
import type { Turn } from './types.js';

/**
 * What a session is trying to do, and how far it has got —
 * [06 §7.3.3](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [06 §7.3.4], built at
 * [P7.6](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***The chain, not a field — and it was already the chain in schema.*** `Goal`
 * has shipped with `next`, `thenDefault`, `completion` and `visibility` since
 * [04 §7.1], and `Setup.goals` has been ordered with *"`goals[0]` is where play
 * begins"*. **The whole gap this stage closes is runtime**: a cursor for which
 * goal is current, achieved state that branches, the link to the completing
 * turn, a goal written *now* at Advance, and *concluded* as a session state.
 *
 * **Pure, and imported by `mode-loader.ts` to register channels** — so, like
 * `hooks.ts` beside it, this module does no I/O. The build error that rule
 * exists for has been hit three times in this phase ([P7.3]'s `Binding`,
 * [P7.5]'s `PooledHook`, and [P7.5]'s pool builder).
 */

/**
 * `storyengine.goals`, a **package** rather than a mode — the same answer
 * `storyengine.hooks`, `storyengine.cast` and `storyengine.lore` get, and for
 * the same reason: a goal comes from a **Setup**, which is authored content, so
 * *"the condition belongs to whoever wrote the game rather than to the mode
 * running it"* ([06 §7.3.3]). A mode that declared these would make every other
 * mode either import it or declare a second copy.
 */
const GOAL_OWNER = 'storyengine.goals';

/**
 * Which goal play is on — the cursor [06 §7.3.4] needs and nothing had.
 *
 * ***`engine-computed`, which is the policy that refuses a model and a step and
 * admits a person.*** Moving the cursor is *Advance*, and [06 §7.3.4] is
 * explicit that *"the choice is made at completion, not only at setup — a player
 * who did not know at setup whether they wanted an ending is the normal case"*.
 * A narrator that could move it would be a story choosing its own next
 * objective, which is the thing the three offers exist to ask about.
 *
 * *Absent is **the first goal**, not *no goal**, and the reader below is what
 * makes that true: `Setup.goals` is ordered and `goals[0]` is where play begins,
 * so a session that has never written this is on its first goal rather than on
 * none. **Null written deliberately is `continue-open`** — the offer that
 * retains the achievement and carries on with no driving objective — which is
 * why the two cannot be the same value and why `init` cannot express it.
 */
export const SE_GOAL_CURRENT = 'se.goal.current';

export const GOAL_CURSOR_CHANNEL: ChannelDefinition = {
  id: SE_GOAL_CURRENT,
  owner: GOAL_OWNER,
  version: 1,
  scope: 'session',
  update: 'engine-computed',
  /**
   * **Hidden, and that is about the HUD rather than about secrecy.**
   * `channelSurfaces` reads `visibility` as *not in the strip above the story*,
   * and a goal's surface is its own panel with the three offers on it — a line
   * saying `g-ledger` over the transcript would be an id where a sentence
   * belongs. The statement reaches the **prompt** through the preset's own
   * `{ of: 'goal' }` slot, which is [04 §8.2]'s arm for exactly this and which
   * returned nothing until now.
   */
  visibility: 'hidden',
  schema: { type: ['string', 'null'] },
  init: { kind: 'literal', value: null },
  budget: null,
};

/**
 * What has happened to one goal — [06 §7.3.3]'s *"progress is a channel"*.
 *
 * ***`model-proposed`, and it is the build's first.*** That section settles the
 * policy in one sentence: *"`update: 'model-proposed'` in Freeform, where there
 * is nothing to compute from and the narrator's judgement is the only signal
 * available; `update: 'engine-computed'` in Campaign, where quest state is real
 * data. Same declaration, different policy, and the proposal-versus-decision
 * seam is already specified."* Campaign is [work plan §5]'s and not here, so the
 * declaration this build ships is Freeform's.
 *
 * **One value and not a percentage.** A progress *number* would be a field with
 * no reader — nothing budgets against it, nothing renders it, and no offer turns
 * on it — which is the placeholder shape this phase keeps refusing. What the
 * design actually asks the channel to carry is whether the goal is met, and the
 * evaluation step at `post` is what proposes it.
 *
 * *The completing **turn** is not stored*, because it does not need to be: the
 * effect that wrote `achieved` lands on that turn, so [06 §7.3.4]'s *"completed
 * goals are retained with the turn that completed them"* is a walk of the path
 * rather than a field — and a walk is the version that survives a rewind, which
 * a stored turn id on a branch that no longer contains it does not.
 */
export const SE_GOAL = 'se.goal';

export const GOAL_STATES = ['achieved'] as const;
export type GoalState = (typeof GOAL_STATES)[number];

export const GOAL_CHANNEL: ChannelDefinition = {
  id: SE_GOAL,
  owner: GOAL_OWNER,
  version: 1,
  scope: 'goal',
  update: 'model-proposed',
  /**
   * **Hidden for the HUD's sake, and *not* because a hidden goal is secret from
   * the narrator.** [04 §7.1]'s `Goal.visibility` is a different field about a
   * different audience: a `hidden` goal is *the GM's arc*, which the narrator is
   * told and the player is not. This one governs the strip above the story, and
   * per-goal achievement belongs on the goal panel beside the offers it raises.
   */
  visibility: 'hidden',
  /**
   * `null` is in the enum, which is the invariant `mode-loader.test.ts` holds
   * every channel to since [P7.5] — two shipped channels declared an `init` their
   * own schema refused, and the state a goal **starts** in has to be writable or
   * a rewound completion could never be undone.
   */
  schema: { type: ['string', 'null'], enum: [...GOAL_STATES, null] },
  init: { kind: 'literal', value: null },
  budget: null,
};

/**
 * Whether the story is over — [06 §7.3.4]'s *End*.
 *
 * ***A state, not a deletion.*** That section says so in as many words and says
 * why: *"the session stays readable and branchable, because 'what if I had done
 * it differently' is a reasonable thing to want at exactly that moment."* A
 * channel is what makes both true for free — the session file is untouched, the
 * turn record carries the effect, and rewinding past the ending un-ends it.
 *
 * *`engine-computed`, like the cursor and for the same reason*: ending a story
 * is a person's decision, and a narrator that could write it would be a model
 * concluding a session it happened to feel finished with.
 */
export const SE_CONCLUDED = 'se.concluded';

export const CONCLUDED_CHANNEL: ChannelDefinition = {
  id: SE_CONCLUDED,
  owner: GOAL_OWNER,
  version: 1,
  scope: 'session',
  update: 'engine-computed',
  visibility: 'hidden',
  schema: { type: 'boolean' },
  init: { kind: 'literal', value: false },
  budget: null,
};

/**
 * The goal play is on, resolved — the channel's value, or `goals[0]`.
 *
 * **Absent and null are different answers here**, which is the one subtlety in
 * this module. A session that has never written the cursor is on its **first**
 * goal, because [04 §7.1] orders `Setup.goals` and says `goals[0]` is where play
 * begins; a session that has written `null` chose *continue open* at a
 * completion, and is deliberately on **none**. `init` carries one value and
 * cannot say both, so the distinction lives in the map: a key that is not there
 * versus a key holding null.
 */
export function readCurrentGoal(
  channels: Readonly<Record<string, { value: unknown }>>,
  goals: readonly Goal[],
): Goal | null {
  const held = channels[SE_GOAL_CURRENT];
  if (held === undefined) return goals[0] ?? null;
  return typeof held.value === 'string'
    ? (goals.find((goal) => goal.id === held.value) ?? null)
    : null;
}

/** What this session has done with one goal, at a node. Absent is *not yet*. */
export function readGoalState(
  channels: Readonly<Record<string, { value: unknown }>>,
  goalId: string,
): GoalState | null {
  const held = channels[channelKey(SE_GOAL, goalId)]?.value;
  return typeof held === 'string' && (GOAL_STATES as readonly string[]).includes(held)
    ? (held as GoalState)
    : null;
}

/** Whether the story has been ended — [06 §7.3.4]. */
export function readConcluded(channels: Readonly<Record<string, { value: unknown }>>): boolean {
  return channels[SE_CONCLUDED]?.value === true;
}

/**
 * Which turn each goal was completed on — [06 §7.3.4]'s *retained with the turn
 * that completed them*.
 *
 * **Derived rather than stored**, like every other *when* in this phase: the
 * answer has to change under a rewind, and a stored turn id would point at a
 * node this branch does not contain. *That retention is what [25 E1] wants for
 * the reading view — "an adventure's goal chain is a much better spine for
 * chapters than word count is" — and it is free the moment the state is an
 * effect rather than a field.*
 */
export function achievedOn(path: readonly Turn[]): Map<string, string> {
  const when = new Map<string, string>();
  for (const turn of path) {
    for (const effect of turn.effects) {
      if (!effect.applied || effect.channelId !== SE_GOAL || effect.scopeKey === null) continue;
      if (effect.after === 'achieved') when.set(effect.scopeKey, turn.id);
      else when.delete(effect.scopeKey);
    }
  }
  return when;
}

/**
 * One goal as the panel shows it — [06 §7.3.4], [10 §12].
 *
 * **The statement travels and `detail` does not.** [04 §7.1] calls `statement`
 * *"short, always injected"* and `detail` *"the author's fuller version,
 * available to steps; not injected by default, so a long one costs nothing per
 * turn"* — a panel row is the same trade, and the row a person reads is the
 * sentence they are playing toward.
 */
export interface GoalRow {
  goalId: string;
  statement: string;
  visibility: Goal['visibility'];
  completion: Goal['completion']['kind'];
  /** Whether play is on this one. Exactly one row is current, or none. */
  current: boolean;
  achieved: boolean;
  /** The turn it was completed on. */
  achievedOn?: string;
  /** The authored successor, if the chain names one. */
  next: string | null;
  /** What [06 §7.3.4] says *seeds the offer; it does not decide it*. */
  thenDefault: Goal['thenDefault'];
}

/** The goal panel's rows, at a node. */
export function goalRows(
  goals: readonly Goal[],
  channels: Readonly<Record<string, { value: unknown }>>,
  path: readonly Turn[],
): GoalRow[] {
  const current = readCurrentGoal(channels, goals);
  const when = achievedOn(path);

  return goals.map((goal) => {
    const completedOn = when.get(goal.id);
    return {
      goalId: goal.id,
      statement: goal.statement,
      visibility: goal.visibility,
      completion: goal.completion.kind,
      current: current?.id === goal.id,
      achieved: readGoalState(channels, goal.id) === 'achieved',
      ...(completedOn === undefined ? {} : { achievedOn: completedOn }),
      next: goal.next,
      thenDefault: goal.thenDefault,
    };
  });
}
