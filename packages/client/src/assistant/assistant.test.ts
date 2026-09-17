// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { TurnRecord } from '../api.js';
import { contextFor, sameContext } from './context.js';
import { latestProposal, valueAt, withValueAt } from './Proposal.js';
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
    expect(contextFor('/sessions/s-1')).toMatchObject({ kind: 'session', id: 's-1' });
    expect(contextFor('/sessions/s-1/read')).toMatchObject({ kind: 'session', id: 's-1' });
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

  it('ignores a proposal that changes nothing, or names nothing', () => {
    expect(latestProposal([turn([effect({ kind: 'actors', id: 'a', changes: {} })])])).toBeNull();
    expect(
      latestProposal([turn([effect({ kind: 'wombats', id: 'a', changes: { n: 'x' } })])]),
    ).toBeNull();
    expect(latestProposal([turn([effect(null)])])).toBeNull();
  });
});

describe('the diff’s two halves', () => {
  const actor = { name: 'Vera', profile: { traits: ['quiet'], sections: { a: { body: 'x' } } } };

  it('reads a dotted path, and says nothing for one that is not there', () => {
    expect(valueAt(actor, 'name')).toBe('Vera');
    expect(valueAt(actor, 'profile.sections.a.body')).toBe('x');
    expect(valueAt(actor, 'profile.nowhere')).toBe('');
  });

  it('writes a dotted path without touching the rest', () => {
    const next = withValueAt(actor, 'profile.sections.a.body', 'y');
    expect(valueAt(next, 'profile.sections.a.body')).toBe('y');
    expect(valueAt(next, 'name')).toBe('Vera');
    // The original is untouched: the editor's own rule, and the reason this is
    // a clone rather than a mutation.
    expect(valueAt(actor, 'profile.sections.a.body')).toBe('x');
  });

  /**
   * ***A path the object does not have is not created.*** Inventing structure
   * because a model named it would let a suggestion add fields nobody reviewed,
   * which is the *silent write* [06 §7.4] refuses arriving through the one door
   * that stayed open.
   */
  it('creates nothing for a path into nowhere', () => {
    const next = withValueAt(actor, 'profile.invented.deeply.body', 'y');
    expect(valueAt(next, 'profile.invented.deeply.body')).toBe('');
    expect(next).toEqual(actor);
  });
});
