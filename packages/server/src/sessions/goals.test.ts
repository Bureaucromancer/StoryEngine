// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import type { Goal } from '@storyengine/shared';

import { installBuiltIns } from '../mode-loader.js';
import { acceptEffect } from '../turns/effects.js';
import { channelDefinition, channelKey } from './channels.js';
import {
  achievedOn,
  goalRows,
  pendingAchievement,
  readConcluded,
  readCurrentGoal,
  readGoalState,
  SE_CONCLUDED,
  SE_GOAL,
  SE_GOAL_CURRENT,
} from './goals.js';
import type { Turn } from './types.js';

/**
 * Goals — [06 §7.3.3], [06 §7.3.4], [04 §7.1], built at [P7.6].
 *
 * ***The chain, not a field — and it was already the chain in schema.*** What
 * this stage adds is all runtime: a cursor, achieved state that branches, the
 * link to the completing turn, and *concluded* as a state rather than a
 * deletion.
 */

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g-ledger',
    statement: 'Get the ledger out of the Foundry.',
    detail: null,
    visibility: 'player',
    completion: { kind: 'narrative' },
    thenDefault: 'advance',
    next: null,
    ...over,
  };
}

function turn(over: Partial<Turn> = {}): Turn {
  return {
    id: 't',
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-09-13T00:00:00.000Z',
    status: 'complete',
    tape: [],
    effects: [],
    ...over,
  };
}

/**
 * A turn on which the judge proposed a completion and [26 C12]'s gate refused
 * it — the shape `pendingAchievement` reads.
 */
function proposing(id: string, goalId: string): Turn {
  return turn({
    id,
    effects: [
      {
        id: `e-${id}`,
        turnId: id,
        channelId: SE_GOAL,
        scopeKey: goalId,
        op: { type: 'set', path: '/' },
        before: null,
        // `after` is the value the model *wanted*, which is the [P7.2]
        // correction the panel depends on — a refusal that stamped `before`
        // back would record that something was refused and not what.
        after: 'achieved',
        proposedBy: { kind: 'model', callId: 'c1' },
        applied: false,
        rejectedReason: 'needs-confirmation',
        supersedes: null,
        channelVersion: 1,
        scope: 'session',
      },
    ],
  });
}

/** A turn whose one effect completes a goal, which is what `achievedOn` reads. */
function completing(id: string, goalId: string, after: unknown = 'achieved'): Turn {
  return turn({
    id,
    effects: [
      {
        id: `e-${id}`,
        turnId: id,
        channelId: SE_GOAL,
        scopeKey: goalId,
        op: { type: 'set', path: '/' },
        before: null,
        after,
        proposedBy: { kind: 'model', callId: 'c1' },
        applied: true,
        rejectedReason: null,
        supersedes: null,
        channelVersion: 1,
        scope: 'session',
      },
    ],
  });
}

beforeEach(async () => {
  await installBuiltIns();
});

describe('which goal play is on', () => {
  /**
   * ***Absent and null are different answers***, which is the one subtlety in
   * this module. [04 §7.1] orders the chain and says `goals[0]` is where play
   * begins, so a session that has never written the cursor is on its **first**
   * goal; a session that wrote `null` answered *continue open* at a completion
   * and is deliberately on none. `init` carries one value and cannot say both.
   */
  it('is the first goal for a session that has never moved the cursor', () => {
    const chain = [goal({ id: 'g-one' }), goal({ id: 'g-two' })];

    expect(readCurrentGoal({}, chain)?.id).toBe('g-one');
  });

  it('is nothing at all once a completion answered continue-open', () => {
    const chain = [goal({ id: 'g-one' })];

    expect(readCurrentGoal({ [SE_GOAL_CURRENT]: { value: null } }, chain)).toBeNull();
  });

  it('follows the cursor when Advance moved it', () => {
    const chain = [goal({ id: 'g-one' }), goal({ id: 'g-two' })];

    expect(readCurrentGoal({ [SE_GOAL_CURRENT]: { value: 'g-two' } }, chain)?.id).toBe('g-two');
  });

  /**
   * A cursor naming a goal the chain no longer has is a hand-edited file or a
   * Setup edited under a running session. *In the pool* has no equivalent here,
   * so the honest answer is **no current goal** — which is a state the panel can
   * show and the prompt can omit, rather than a throw.
   */
  it('reads a cursor pointing at nothing as no goal', () => {
    expect(readCurrentGoal({ [SE_GOAL_CURRENT]: { value: 'g-gone' } }, [goal()])).toBeNull();
  });

  it('is nothing for a session whose Setup carried no goals', () => {
    // [04 §7.1]: empty is *"the deliberate opt-out rather than the default"*.
    expect(readCurrentGoal({}, [])).toBeNull();
  });
});

describe('what has happened to a goal', () => {
  it('is nothing until something says otherwise', () => {
    expect(readGoalState({}, 'g-ledger')).toBeNull();
  });

  it('is achieved once the judge or a person says so', () => {
    const channels = { [channelKey(SE_GOAL, 'g-ledger')]: { value: 'achieved' } };

    expect(readGoalState(channels, 'g-ledger')).toBe('achieved');
  });

  it('reads a state this build does not know as nothing at all', () => {
    const channels = { [channelKey(SE_GOAL, 'g-ledger')]: { value: 'nearly' } };

    expect(readGoalState(channels, 'g-ledger')).toBeNull();
  });

  /**
   * [06 §7.3.4]'s *"completed goals are retained with the turn that completed
   * them"* — **derived rather than stored**, because the answer has to change
   * under a rewind and a stored turn id would point at a node this branch does
   * not contain.
   */
  it('names the turn it was completed on', () => {
    const path = [turn({ id: 't1' }), completing('t2', 'g-ledger'), turn({ id: 't3' })];

    expect(achievedOn(path).get('g-ledger')).toBe('t2');
    // And a branch where it never happened has nothing to name.
    expect(achievedOn([turn({ id: 't1' })]).get('g-ledger')).toBeUndefined();
  });

  it('forgets the turn when a later effect takes the achievement back', () => {
    const path = [completing('t1', 'g-ledger'), completing('t2', 'g-ledger', null)];

    expect(achievedOn(path).get('g-ledger')).toBeUndefined();
  });
});

describe('whether the story is over', () => {
  /**
   * [06 §7.3.4]: *"Concluded is a state, not a deletion: the session stays
   * readable and branchable, because 'what if I had done it differently' is a
   * reasonable thing to want at exactly that moment."* A channel is what makes
   * both true for free.
   */
  it('starts false and reads true once End was chosen', () => {
    expect(readConcluded({})).toBe(false);
    expect(readConcluded({ [SE_CONCLUDED]: { value: true } })).toBe(true);
  });
});

describe('the channels this declares', () => {
  it('keeps the narrator away from the cursor and away from the ending', () => {
    // Moving the cursor is *Advance* and ending is *End* — both a person's, and
    // [06 §7.3.4] is emphatic that the offer is asked rather than applied. A
    // narrator that could write either would be a story choosing its own next
    // objective, or its own last turn.
    expect(channelDefinition(SE_GOAL_CURRENT)?.update).toBe('engine-computed');
    expect(channelDefinition(SE_CONCLUDED)?.update).toBe('engine-computed');
  });

  /**
   * ***The first channel a model's own judgement is written to*** — [06 §7.3.3]
   * settles the policy: *"the narrator's judgement is the only signal
   * available"* in Freeform, where there is nothing to compute from. Campaign's
   * `engine-computed` declaration is [work plan §5]'s and not here.
   *
   * *Not the first `model-proposed` channel*, which is what this said until
   * 2026-09-13 and is false: `se.presence`, `se.status` and `se.party` carry
   * the policy and have since [P3.0]. They are declared open to a model and
   * nothing in the build had ever written one that way — the assertion below is
   * about the declaration, and {@link goalJudge}'s own test is what covers the
   * `proposedBy` stamp that makes the distinction real.
   */
  it('lets the narrator propose that a goal is met, which nothing else does', () => {
    expect(channelDefinition(SE_GOAL)?.update).toBe('model-proposed');
    expect(channelDefinition(SE_GOAL)?.scope).toBe('goal');
  });

  it('keeps all three out of the strip above the story', () => {
    // `visibility` is about the HUD. A goal's surface is its own panel with the
    // three offers on it, and a line saying `g-ledger` over the transcript would
    // be an id where a sentence belongs.
    for (const id of [SE_GOAL, SE_GOAL_CURRENT, SE_CONCLUDED]) {
      expect(channelDefinition(id)?.visibility, id).toBe('hidden');
    }
  });
});

describe('what the panel is shown', () => {
  it('marks exactly one row current, and says what each is for', () => {
    const chain = [goal({ id: 'g-one' }), goal({ id: 'g-two', thenDefault: 'end' })];
    const rows = goalRows(chain, {}, []);

    expect(rows.map((row) => [row.goalId, row.current])).toEqual([
      ['g-one', true],
      ['g-two', false],
    ]);
    expect(rows[1]?.thenDefault).toBe('end');
  });

  it('carries the achievement and the turn that earned it', () => {
    const channels = { [channelKey(SE_GOAL, 'g-ledger')]: { value: 'achieved' } };
    const rows = goalRows([goal()], channels, [completing('t2', 'g-ledger')]);

    expect(rows[0]).toMatchObject({ achieved: true, achievedOn: 't2' });
  });

  /**
   * ***The `detail` does not travel.*** [04 §7.1] reserves it for steps —
   * *"not injected by default, so a long one costs nothing per turn"* — and a
   * panel row is the same trade: the sentence a person is playing toward is the
   * `statement`.
   */
  it('sends the statement and never the author’s fuller version', () => {
    const rows = goalRows(
      [goal({ detail: 'Three pages, in the east vault, by Thursday.' })],
      {},
      [],
    );

    expect(rows[0]?.statement).toBe('Get the ledger out of the Foundry.');
    expect(JSON.stringify(rows)).not.toContain('east vault');
  });

  /**
   * *A hidden goal is still a row.* [04 §7.1]'s `visibility` is the GM's arc —
   * about what the **player** is told — and the panel is where that distinction
   * is rendered, so the field travels and the panel decides.
   */
  it('sends a hidden goal’s visibility rather than dropping the row', () => {
    const rows = goalRows([goal({ visibility: 'hidden' })], {}, []);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.visibility).toBe('hidden');
  });
});

/**
 * [26 C12]'s gate — answered *ask* at [P7.6] and enforced by a three-word field
 * rather than a prompt, which is the whole reason the question stopped being
 * worth deferring.
 */
describe('the confirmation before a completion fires', () => {
  it('declares the loaded state a model may not set on its own', async () => {
    await installBuiltIns();
    expect(channelDefinition(SE_GOAL)?.confirm).toEqual(['achieved']);
  });

  /**
   * ***The gate is the asymmetry and nothing else.*** [26 C12]: *"a missed
   * completion is an annoyance the player resolves manually, a false one ends
   * the story on a turn that did not earn it."* So the model's proposal waits
   * and the person's write does not — same channel, same value, opposite
   * answers, which is `refuse()` checking `confirm` for `model` and `step` only.
   */
  it('refuses the narrator and admits the person', async () => {
    await installBuiltIns();

    const proposal = {
      channelId: SE_GOAL,
      scopeKey: 'g-ledger',
      op: { type: 'set', path: '/' },
      after: 'achieved',
    } as const;

    const judged = acceptEffect(
      't1',
      { ...proposal, proposedBy: { kind: 'model', callId: 'c1' } },
      {},
    );
    expect(judged.applied).toBe(false);
    expect(judged.rejectedReason).toBe('needs-confirmation');

    // The manual path [06 §7.3.3] calls always-available, arriving at the same
    // channel by the other door.
    const said = acceptEffect('t1', { ...proposal, proposedBy: { kind: 'user' } }, {});
    expect(said.applied).toBe(true);
  });

  /**
   * *The step arm matters because the runner falls back to it.* With no call to
   * attribute a completion to, the runner stamps `step` rather than `engine` —
   * and if `step` were admitted here that fallback would be a bypass.
   */
  it('refuses a step proposal too, which is what makes the runner’s fallback safe', async () => {
    await installBuiltIns();

    const effect = acceptEffect(
      't1',
      {
        channelId: SE_GOAL,
        scopeKey: 'g-ledger',
        op: { type: 'set', path: '/' },
        after: 'achieved',
        proposedBy: { kind: 'step', stepId: 'se.goals.judge' },
      },
      {},
    );

    expect(effect.rejectedReason).toBe('needs-confirmation');
  });

  it('leaves an unruled proposal outstanding', () => {
    expect([...pendingAchievement([proposing('t1', 'g-ledger')])]).toEqual(['g-ledger']);
  });

  /**
   * **Answered, not acknowledged** — the rule `pendingStatuses` settled at
   * [P7.2]. Both of the panel's buttons write, so both clear it; nothing else
   * does, which is why a proposal a player never looked at is still waiting
   * next session.
   */
  it('clears once a person has ruled, whichever way they ruled', () => {
    const confirmed = [proposing('t1', 'g-ledger'), completing('t2', 'g-ledger')];
    expect(pendingAchievement(confirmed).size).toBe(0);

    // *Not yet* writes the standing null, which is an applied effect and so is
    // equally an answer. A dismissal that wrote nothing would never clear.
    const dismissed = [proposing('t1', 'g-ledger'), completing('t2', 'g-ledger', null)];
    expect(pendingAchievement(dismissed).size).toBe(0);
  });

  /**
   * *A dismissal is not remembered as a dismissal.* The judge may propose again
   * on a later turn and should — the second time it may be right — so the walk
   * carries no memory beyond the last word on each goal.
   */
  it('goes outstanding again when the narrator proposes a second time', () => {
    const path = [
      proposing('t1', 'g-ledger'),
      completing('t2', 'g-ledger', null),
      proposing('t3', 'g-ledger'),
    ];
    expect([...pendingAchievement(path)]).toEqual(['g-ledger']);
  });

  /**
   * The row the panel renders. `proposed` and `achieved` are never both true:
   * confirming *is* an applied effect, so the same walk that sets one clears
   * the other.
   */
  it('reaches the panel as a row, and never alongside achieved', () => {
    const waiting = goalRows([goal()], {}, [proposing('t1', 'g-ledger')]);
    expect(waiting[0]).toMatchObject({ proposed: true, achieved: false });

    const ruled = goalRows([goal()], { [channelKey(SE_GOAL, 'g-ledger')]: { value: 'achieved' } }, [
      proposing('t1', 'g-ledger'),
      completing('t2', 'g-ledger'),
    ]);
    expect(ruled[0]).toMatchObject({ proposed: false, achieved: true });
  });
});
