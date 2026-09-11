// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { castBadge, isTerminalBadge } from './castBadge.js';

/**
 * One badge from two axes — [10 §13.2], [P7.2].
 *
 * **The two combinations the split exists for are the two this has to get
 * right**, and they are the assertions a future simplification would break: a
 * single enum can say neither *dead but present* nor *alive, elsewhere*, so a
 * derivation that collapsed them back would undo the split on the screen while
 * leaving it intact in the data — the worst of both.
 */
describe('castBadge', () => {
  it('says dead but present, which no single enum can', () => {
    expect(castBadge({ presence: true, status: 'dead' })).toBe('Dead, present');
  });

  it('says alive and elsewhere, the ordinary state of most of the cast', () => {
    expect(castBadge({ presence: false, status: 'alive' })).toBe('Elsewhere');
  });

  it('leads with the terminal status, because it is the thing to say first', () => {
    expect(castBadge({ presence: false, status: 'dead' })).toBe('Dead');
    expect(castBadge({ presence: true, status: 'departed' })).toBe('Departed, present');
  });

  it('leads with presence among the living, because `here` beats `alive`', () => {
    // Every row is alive; only some are in the room.
    expect(castBadge({ presence: true, status: 'alive' })).toBe('Here');
  });

  it('falls back to the living reading for a status it does not know', () => {
    // A mode shipping a fourth status should not blank the badge; the engine's
    // terminal list is what makes a status grave, and an unknown one is not on
    // it.
    expect(castBadge({ presence: true, status: 'imprisoned' })).toBe('Here');
    expect(isTerminalBadge('imprisoned')).toBe(false);
  });
});
