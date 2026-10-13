// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { TurnRecord } from '../api.js';
import { contextFor, sameContext } from './context.js';
import { heldText, latestProposal, withValueAt } from './Proposal.js';
import { assistantSessionIn, ASSISTANT_MODE_ID } from './session.js';

/**
 * ***The assistant's pure halves*** —
 * [06 §7.4](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §7](../../../../docs/design/10-ui-surfaces.md),
 * [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The panel itself is `PlayPage` with a header, and the play surface has its own
 * tests. What is genuinely this stage's — and genuinely able to be wrong — is
 * the three small readers: **what the assistant can see**, **which session it
 * is**, and **what a proposal turns into**.
 */

describe('what the assistant can see', () => {
  it('is the object a library address names', () => {
    expect(contextFor('/library/actors/actor-1')).toMatchObject({
      kind: 'actors',
      id: 'actor-1',
    });
    expect(contextFor('/library/lorebooks/book-9/edit')).toMatchObject({
      kind: 'lorebooks',
      id: 'book-9',
    });
  });

  it('is the session a play or reading address names', () => {
    expect(contextFor('/play/s-1')).toMatchObject({ kind: 'session', id: 's-1' });
    expect(contextFor('/read/s-1')).toMatchObject({ kind: 'session', id: 's-1' });
  });

  /**
   * ***Null rather than a vague one.*** A person in their settings is not
   * looking at an object, and *"they are in their settings"* with nothing
   * attached is a sentence that costs tokens on every turn to tell the model
   * something it cannot use.
   */
  it('is nothing where there is nothing to disclose', () => {
    expect(contextFor('/settings')).toBeNull();
    expect(contextFor('/')).toBeNull();
    expect(contextFor('/library')).toBeNull();
  });

  /**
   * *The comparison is what stops a write per navigation.* A channel write is
   * an effect carried by a turn, so re-disclosing the same object each time
   * somebody moved between its tabs would put a line in the record every time.
   */
  it('knows when it has not changed', () => {
    const seen = contextFor('/library/actors/actor-1');
    expect(sameContext(seen, contextFor('/library/actors/actor-1/edit'))).toBe(true);
    expect(sameContext(seen, contextFor('/library/actors/actor-2'))).toBe(false);
    expect(sameContext(null, null)).toBe(true);
    expect(sameContext(seen, null)).toBe(false);
  });
});

describe('which session is the assistant’s', () => {
  const session = (over: Record<string, unknown>) =>
    ({
      id: 's',
      name: 'x',
      createdAt: '',
      updatedAt: '',
      headTurnId: null,
      ...over,
    }) as Parameters<typeof assistantSessionIn>[0][number];

  /**
   * ***The mode, never the name.*** A session's name is the person's to change,
   * so matching on *Assistant* would make renaming it produce a second one on
   * the next summon.
   */
  it('is the one in the assistant mode', () => {
    const found = assistantSessionIn([
      session({ id: 'story', name: 'Assistant', mode: { id: 'storyengine.scene' } }),
      session({ id: 'right', name: 'Notes to self', mode: { id: ASSISTANT_MODE_ID } }),
    ]);
    expect(found?.id).toBe('right');
  });

  /** An archived one is a conversation somebody finished — *New conversation*. */
  it('is not an archived one', () => {
    const found = assistantSessionIn([
      session({ id: 'old', mode: { id: ASSISTANT_MODE_ID }, archivedAt: 'yesterday' }),
    ]);
    expect(found).toBeNull();
  });
});

describe('a proposal read off the record', () => {
  const turn = (effects: unknown[]) => ({ effects }) as unknown as TurnRecord;
  const effect = (after: unknown, applied = true) => ({
    channelId: 'se.assistant.proposal',
    applied,
    after,
  });

  it('is the newest one on the path', () => {
    const found = latestProposal([
      turn([effect({ kind: 'actors', id: 'a', changes: { name: 'First' } })]),
      turn([effect({ kind: 'actors', id: 'a', changes: { name: 'Second' } })]),
    ]);
    expect(found?.changes['name']).toBe('Second');
  });

  /**
   * ***A refused effect is not an offer.*** `acceptEffect` records a refusal
   * rather than dropping it, so a proposal the channel policy declined is on the
   * turn — and rendering it as something to apply would be the one place this
   * reading could go quietly wrong.
   */
  it('ignores an effect the engine refused', () => {
    expect(
      latestProposal([turn([effect({ kind: 'actors', id: 'a', changes: { n: 'x' } }, false)])]),
    ).toBeNull();
  });

  /**
   * ***A proposal recorded before Package was renamed World*** ([P16.0]): the
   * turn keeps the effect as written, so it names `packages`, and it is offered
   * against the World it is now rather than dropped as a kind nobody knows.
   */
  it('reads a proposal about a Package as one about the World', () => {
    const found = latestProposal([
      turn([effect({ kind: 'packages', id: 'w-1', changes: { name: 'Rain City' } })]),
    ]);
    expect(found).toMatchObject({ kind: 'worlds', id: 'w-1' });
  });

  it('ignores a proposal that changes nothing, or names nothing', () => {
    expect(latestProposal([turn([effect({ kind: 'actors', id: 'a', changes: {} })])])).toBeNull();
    expect(
      latestProposal([turn([effect({ kind: 'wombats', id: 'a', changes: { n: 'x' } })])]),
    ).toBeNull();
    expect(latestProposal([turn([effect(null)])])).toBeNull();
  });

  /**
   * ***A withdrawn offer is the newest word*** (2026-09-30): the step writes
   * `null` when an answer proposes nothing, and the walk stops there rather
   * than reaching back to an offer made questions ago.
   */
  it('is nothing once a later answer withdrew it', () => {
    expect(
      latestProposal([
        turn([effect({ kind: 'actors', id: 'a', changes: { name: 'First' } })]),
        turn([effect(null)]),
      ]),
    ).toBeNull();
  });
});

describe('the diff’s two halves', () => {
  const actor = { name: 'Vera', profile: { traits: ['quiet'], sections: { a: { body: 'x' } } } };

  /**
   * ***Text, or nothing*** (2026-09-30): a path the object does not have, one
   * that holds something other than text, and one through the prototype are
   * all no text — where this answered `''` and JSON, and a missing field
   * rendered as an empty one waiting to be filled.
   */
  it('reads the text at a dotted path, and nothing where there is none', () => {
    expect(heldText(actor, 'name')).toBe('Vera');
    expect(heldText(actor, 'profile.sections.a.body')).toBe('x');
    expect(heldText(actor, 'profile.nowhere')).toBeNull();
    expect(heldText(actor, 'profile.traits')).toBeNull();
    expect(heldText(actor, 'constructor')).toBeNull();
  });

  it('writes a dotted path without touching the rest', () => {
    const next = withValueAt(actor, 'profile.sections.a.body', 'y');
    expect(heldText(next, 'profile.sections.a.body')).toBe('y');
    expect(heldText(next, 'name')).toBe('Vera');
    // The original is untouched: the editor's own rule, and the reason this is
    // a clone rather than a mutation.
    expect(heldText(actor, 'profile.sections.a.body')).toBe('x');
  });

  /**
   * ***Not the last step either*** (2026-09-30). The walk refused a missing
   * intermediate and then set the leaf regardless, so `summary` on an actor —
   * whose summary is a section — was created at the top level, and *Apply*
   * said it had worked.
   */
  it('creates no field the object does not hold, at the top level either', () => {
    expect(withValueAt(actor, 'summary', 'y')).toEqual(actor);
  });

  /**
   * ***A path the object does not have is not created.*** Inventing structure
   * because a model named it would let a suggestion add fields nobody reviewed,
   * which is the *silent write* [06 §7.4] refuses arriving through the one door
   * that stayed open.
   */
  it('creates nothing for a path into nowhere', () => {
    const next = withValueAt(actor, 'profile.invented.deeply.body', 'y');
    expect(heldText(next, 'profile.invented.deeply.body')).toBeNull();
    expect(next).toEqual(actor);
  });
});
