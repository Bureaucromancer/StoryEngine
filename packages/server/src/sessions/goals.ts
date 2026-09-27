// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChannelDefinition } from '@storyengine/sdk';
import { createValidator, Goal } from '@storyengine/shared';

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
  /**
   * ***[25 C12]'s confirmation gate, settled here rather than left open***
   * (2026-09-13, [P7.6]). The question was *"whether narrative completion
   * should require confirmation before it fires"*, and the answer is **yes**,
   * for the reason C12 itself gives and nothing more: *"a missed completion is
   * an annoyance the player resolves manually, a false one ends the story on a
   * turn that did not earn it"*, and **that asymmetry is not a judgement about
   * how good the judge is** — it holds at every accuracy short of perfect.
   *
   * ***Declared, not built.*** The leaning said the gate *"wants real sessions
   * to judge"*, which would have been a reason to defer if answering it cost
   * anything. It costs a three-word field: {@link ChannelDefinition.confirm}
   * shipped at [P7.2] for terminal statuses and its docstring already named
   * this as its second consumer — *"building one status-shaped now is the
   * reinvention this phase keeps catching itself about"*. Leaving C12 open
   * while the mechanism sat built, unused, with a docstring pointing at goals,
   * would have been the deferral costing more than the decision.
   *
   * **What the refusal does and does not stop.** `refuse()` answers
   * `needs-confirmation` for `model` and `step` only, so the judge's proposal
   * lands on the turn **recorded and unapplied** — the value stays `null`, the
   * three offers do not raise, and the panel surfaces the proposal with two
   * buttons. A *person* writing `achieved` is untouched, which is [06 §7.3.3]'s
   * always-available manual completion arriving at the same channel by the
   * other door.
   *
   * *One string, because one state.* {@link GOAL_STATES} has a single member
   * and `confirm` names loaded values rather than all of them — so the two
   * lists being identical here is a coincidence of a one-state channel, not a
   * rule, and a second non-loaded state later would not join this list.
   */
  confirm: ['achieved'],
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

/**
 * ***The goals a session file holds that are goals*** (2026-09-27).
 *
 * The route checks a goal before it writes one now, but a file can hold one
 * that was never checked: a hand edit, an import, an older build. One goal
 * without a `completion` made every read of the session a 500, because the
 * panel's rows read `completion.kind`, and every turn a failure, because the
 * runner does. Read past rather than refused, so the rest of the chain still
 * plays; the file is left as it is, since it is somebody's writing.
 */
export function readableGoals(value: unknown): Goal[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is Goal => isGoal(candidate));
}

const isGoal = createValidator().compile<Goal>(Goal);

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
/**
 * Goals the narrator said were met and a person has not ruled on — [25 C12]'s
 * gate seen from the panel's side.
 *
 * ***Answered, not acknowledged***, which is the rule {@link pendingStatuses}
 * settled at [P7.2] and this is deliberately the same walk: a refusal stops
 * being outstanding when an **applied** effect lands on that goal afterwards,
 * and both of the panel's buttons produce one — *Yes* writes `achieved`, *Not
 * yet* writes the standing `null`. Nothing else clears it, so a completion the
 * player never looked at is still waiting next session, which is the entire
 * reason for surfacing it. A dismissed proposal is *not* remembered as
 * dismissed: the judge may propose again on a later turn, and it should, because
 * the second time it may be right.
 *
 * **A set rather than a map, unlike statuses.** `pendingStatuses` carries *which
 * value* was refused because `se.status` has several and *the narrator proposed
 * something* would be the quiet half of what [06 §8.1] rules out. This channel
 * has one loaded state, so the goal id **is** the proposal and a map would carry
 * the string `'achieved'` in every slot.
 *
 * *Oldest-first, so a later applied effect beats an earlier refusal.*
 */
export function pendingAchievement(path: readonly Turn[]): Set<string> {
  const pending = new Set<string>();
  for (const turn of path) {
    for (const effect of turn.effects) {
      if (effect.channelId !== SE_GOAL || effect.scopeKey === null) continue;
      if (effect.scope === 'escaped') continue;

      if (effect.applied) pending.delete(effect.scopeKey);
      else if (effect.rejectedReason === 'needs-confirmation') pending.add(effect.scopeKey);
    }
  }
  return pending;
}

export interface GoalRow {
  goalId: string;
  statement: string;
  visibility: Goal['visibility'];
  completion: Goal['completion']['kind'];
  /** Whether play is on this one. Exactly one row is current, or none. */
  current: boolean;
  achieved: boolean;
  /**
   * The narrator judged this met and it is waiting on a person — [25 C12].
   * Never true at the same time as {@link achieved}: confirming applies the
   * write, which clears this on the same walk.
   */
  proposed: boolean;
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
  const waiting = pendingAchievement(path);

  return goals.map((goal) => {
    const completedOn = when.get(goal.id);
    return {
      goalId: goal.id,
      statement: goal.statement,
      visibility: goal.visibility,
      completion: goal.completion.kind,
      current: current?.id === goal.id,
      achieved: readGoalState(channels, goal.id) === 'achieved',
      proposed: waiting.has(goal.id),
      ...(completedOn === undefined ? {} : { achievedOn: completedOn }),
      next: goal.next,
      thenDefault: goal.thenDefault,
    };
  });
}
