// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { SE_CLOCK } from '../sessions/channels.js';
import type { StepDefinition } from './steps.js';
import { callPurposeFor, evaluateCondition, filterReads } from './steps.js';

/**
 * When a step runs, and what it is handed — [03 §6], [12 §3.1].
 *
 * These exist because an audit measured all three `StepCondition` arms as
 * mutation-insensitive: the runner is the only evaluator, it passes empty sets
 * for `stages` and `armed`, and nothing anywhere produces either — so two arms
 * could never be satisfied and the third's off-by-one could be changed with the
 * whole suite green. A condition vocabulary nothing can exercise is a
 * vocabulary nobody can trust when P2.6's modes start using it.
 *
 * Driven directly, with a hand-built context, which is what restores that
 * sensitivity today without inventing a producer the design has not specified.
 */

const step = (over: Partial<StepDefinition> = {}): StepDefinition => ({
  id: 'se.test',
  stage: 'generate',
  reads: [],
  writes: [],
  callKind: 'narrate',
  when: { when: 'cadence', everyNTurns: 1 },
  failure: 'abort',
  role: null,
  ...over,
});

const at = (turnsOnPath: number, over: { stages?: string[]; armed?: string[] } = {}) => ({
  turnsOnPath,
  stages: new Set(over.stages ?? []),
  armed: new Set(over.armed ?? []),
});

describe('cadence', () => {
  it('runs every turn at one', () => {
    const every = { when: 'cadence', everyNTurns: 1 } as const;
    for (const turns of [0, 1, 2, 7]) {
      expect(evaluateCondition(every, at(turns)).ok, `at ${String(turns)}`).toBe(true);
    }
  });

  it('counts the turn about to happen, not the ones behind it', () => {
    // The off-by-one that an all-green suite could not see. With three turns on
    // the path, the turn being composed is the fourth — so a cadence of two is
    // due, and a cadence of three is not.
    const everyTwo = { when: 'cadence', everyNTurns: 2 } as const;

    expect(evaluateCondition(everyTwo, at(0)).ok).toBe(false); // the 1st turn
    expect(evaluateCondition(everyTwo, at(1)).ok).toBe(true); // the 2nd
    expect(evaluateCondition(everyTwo, at(2)).ok).toBe(false); // the 3rd
    expect(evaluateCondition(everyTwo, at(3)).ok).toBe(true); // the 4th
  });

  it('reports why it skipped, because silence is the worst answer', () => {
    const decision = evaluateCondition({ when: 'cadence', everyNTurns: 3 }, at(0));
    expect(decision).toEqual({ ok: false, reason: 'cadence' });
  });
});

describe('the two arms nothing produces yet', () => {
  it('runs a stage-flagged step when the stage is raised', () => {
    // **Unsatisfiable through the runner today**, which passes an empty set —
    // so without this the arm is dead code that looks live. P2.6's modes are
    // the first thing that could raise one, and this is what will tell them the
    // arm works when they do.
    const flagged = { when: 'stage', flag: 'scene.opening' } as const;

    expect(evaluateCondition(flagged, at(0, { stages: ['scene.opening'] })).ok).toBe(true);
    expect(evaluateCondition(flagged, at(0))).toEqual({ ok: false, reason: 'stage' });
  });

  it('runs an armed step only when the user armed it', () => {
    const armed = { when: 'armed', flag: 'reroll-lore' } as const;

    expect(evaluateCondition(armed, at(0, { armed: ['reroll-lore'] })).ok).toBe(true);
    expect(evaluateCondition(armed, at(0))).toEqual({ ok: false, reason: 'not-armed' });
  });

  it('does not confuse a stage flag with an armed one', () => {
    // Same shape, different set. Reading the wrong one is a one-word mistake
    // that no end-to-end test could distinguish while both sets are empty.
    const stage = { when: 'stage', flag: 'shared-name' } as const;
    const armed = { when: 'armed', flag: 'shared-name' } as const;

    expect(evaluateCondition(stage, at(0, { armed: ['shared-name'] })).ok).toBe(false);
    expect(evaluateCondition(armed, at(0, { stages: ['shared-name'] })).ok).toBe(false);
  });
});

describe('a step is handed only what it declared', () => {
  const everything = {
    turnId: 't',
    sessionId: 's',
    parentTurnId: null,
    channels: { [SE_CLOCK]: { version: 1, value: { day: 1, hour: 8, minute: 0 } } },
    history: [],
    output: { text: 'the answer so far' },
  };

  it('withholds history from a step that did not ask for it', () => {
    // [12 §3.1]'s payload filter, which is also what makes the boundary
    // narrow enough to cross a worker hop later.
    expect(filterReads(step(), everything).history).toBeUndefined();
    expect(filterReads(step({ reads: ['history'] }), everything).history).toEqual([]);
  });

  it('withholds a channel it did not name', () => {
    expect(filterReads(step(), everything).channels).toEqual({});
    expect(filterReads(step({ reads: [SE_CLOCK] }), everything).channels).toHaveProperty(SE_CLOCK);
  });

  it('never hands over guidance, whatever a step declares', () => {
    // The omission is the design: `reads` cannot name guidance, so a step that
    // could receive it would have to be handed it as an ungated extra — and a
    // step holding the text could re-emit it as an ordinary candidate, which
    // `assemble` would admit ([03 §5.2]).
    const input = filterReads(step({ reads: ['history', 'guidance', SE_CLOCK] }), everything);
    expect(input).not.toHaveProperty('guidance');
    expect(JSON.stringify(input)).not.toContain('guidance');
  });
});

describe('the purpose a call is given', () => {
  it('is prose only for a step that writes nothing and speaks', () => {
    expect(callPurposeFor(step({ contributes: 'messages' }))).toBe('prose');
    expect(callPurposeFor(step({ contributes: 'messages', writes: [SE_CLOCK] }))).toBe('effects');
    expect(callPurposeFor(step({ contributes: 'effects' }))).toBe('effects');
    expect(callPurposeFor(step({ contributes: 'blocks' }))).toBe('effects');
    // Fails closed: a step declaring nothing gets the restrictive purpose.
    expect(callPurposeFor(step())).toBe('effects');
  });
});
