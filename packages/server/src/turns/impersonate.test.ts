// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { impersonationInstruction } from './impersonate.js';

/**
 * ***The card is the subject, not the audience*** —
 * [06 §3.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.4](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §3.1's *proof obligation* in the phase plan is a claim about the **assembled
 * prompt** rather than about a component: *"the persona's card is present as the
 * thing being written **as**, and the turn is an ordinary one on the record."*
 * The first half is this block, and it is the half a behavioural test could not
 * see — a call that lost this instruction would still return prose, and the
 * prose would be the narrator's.
 *
 * *The route half is `sessions.test.ts`'s*, where a real session, a real cast
 * and the `not-a-player` refusal live.
 */

describe('the instruction that flips the call', () => {
  it('asks for that character’s own next message, by name', () => {
    const block = impersonationInstruction('Vera');
    expect(block.text).toContain('Vera');
    expect(block.text.toLowerCase()).toContain('in their own voice');
  });

  /**
   * ***Required, so the budget cannot drop it.*** A call that lost this block
   * would silently become an ordinary narration and hand somebody the
   * narrator's prose as their own words — the one failure this feature must not
   * have, and the kind a token ceiling produces quietly on a long session.
   */
  it('is required, because losing it would produce the narrator’s prose as yours', () => {
    expect(impersonationInstruction('Vera').required).toBe(true);
  });

  /**
   * The workbench's words rather than a debug string. `schemaInstruction` sets
   * the precedent and states the reason: what a reader needs is **why** a
   * sentence they did not write is in their prompt.
   */
  it('explains itself to whoever reads the block table', () => {
    const block = impersonationInstruction('Vera');
    expect(block.reason).toContain('Vera');
    expect(block.reason).not.toBe('impersonate');
  });

  /**
   * ***One message, and nothing else.*** The failure a bare *write as Vera*
   * produces is a model that writes Vera's line and then narrates the reply,
   * which hands the player a paragraph containing somebody else's turn.
   */
  it('forbids narrating anybody else', () => {
    const text = impersonationInstruction('Vera').text.toLowerCase();
    expect(text).toContain('one message only');
    expect(text).toContain('do not resolve what happens next');
  });
});
