// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { isStoryTurn, storyDepth } from './depth.js';
import type { Turn } from './types.js';

/**
 * ***What counts as a turn of the story*** (2026-09-27).
 *
 * Every turn-count gate — `notBefore.turn`, the hook dial's cadence, cooldown
 * and patience, a step's `everyNTurns`, ~~the speaker rotation,~~ lore `delay`
 * — reads this one answer, so each of its three clauses is pinned on its own:
 * the tests in the gates' files would all still pass on a predicate that
 * dropped the one clause none of their fixtures happens to lean on.
 *
 * *Corrected 2026-09-29, at [P13.1]*: `list` no longer rotates, and no speaker
 * arm reads the path's depth. The smart order's roster does read
 * `isStoryTurn`, to tell the model how many rounds ago each member last spoke
 * (`turns/smart-speakers.ts`), but that is a line in a prompt rather than a
 * gate, so it is not pinned here.
 */

function bare(over: Partial<Turn> = {}): Turn {
  return {
    id: 't',
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-09-27T00:00:00.000Z',
    status: 'complete',
    tape: [],
    effects: [],
    ...over,
  };
}

describe('a turn of the story', () => {
  it('is one a person took, by what they wrote', () => {
    expect(
      isStoryTurn(bare({ input: { actorId: null, kind: 'do', text: 'Go.', raw: 'Go.' } })),
    ).toBe(true);
  });

  it('is one the narrator took, by what it wrote — a continue has no input', () => {
    expect(isStoryTurn(bare({ output: { text: 'Rain.' } }))).toBe(true);
  });

  /**
   * *A setup turn has only its steps*: the wizard's job ran, and nothing was
   * typed or narrated. It is the story's first turn all the same, and a job
   * that failed before it wrote anything is still a turn somebody took.
   */
  it('is one a job ran, by the steps it recorded, even with nothing written', () => {
    expect(isStoryTurn(bare({ steps: [] }))).toBe(true);
  });

  it('is not a channel write, an undo, a divergence or a backdrop choice', () => {
    // Each of those is `engineTurn`'s shape or the undo's or the divergence's:
    // effects, an empty tape, and nothing else.
    expect(isStoryTurn(bare())).toBe(false);
  });
});

describe('how far into the story a path is', () => {
  it('counts the story turns and nothing between them', () => {
    const path = [
      bare({ steps: [] }),
      bare(),
      bare({ output: { text: 'Rain.' } }),
      bare(),
      bare(),
      bare({ input: { actorId: null, kind: 'do', text: 'Go.', raw: 'Go.' } }),
    ];

    expect(storyDepth(path)).toBe(3);
    expect(storyDepth([])).toBe(0);
    expect(storyDepth([bare(), bare()])).toBe(0);
  });
});
