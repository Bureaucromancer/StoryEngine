// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { LibraryObject, SessionSummary } from '../api.js';
import type { Draft } from './book-form.js';
import {
  addMember,
  candidateMatches,
  candidatesFor,
  contentsShape,
  type Member,
  mergedMembers,
  removeMemberAt,
  resolveMember,
  SESSION_MEMBER_SCHEMA,
  sessionMember,
} from './members-form.js';

/**
 * ***A World's members as data*** — [P16.1](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §3.1](../../../../docs/design/15-world.md).
 *
 * **The merge is the claim that most needs a test**, because its failure is
 * silent and lands on the one write that is not an editor's: *Add to a world*
 * from a session's page posts an envelope while the World's editor may be open,
 * which is exactly what makes that editor's Save come back 412 — and a merge
 * that took one side's whole list would drop the add inside the dialog whose
 * offer is *reapply my edits*. The rest are the rules the field leans on:
 * what resolves, what is offered, and what the guard refuses before the field
 * can throw.
 */

const BOOK: Member = { schema: 'storyengine.lorebook/1', id: 'book-rain', name: 'Rain City' };
const ACTOR: Member = { schema: 'storyengine.actor/1', id: 'actor-vera', name: 'Vera Kohl' };
const TREATMENT: Member = { schema: 'storyengine.treatment/1', id: 'treat-wet', name: 'Wet' };
const SESSION: Member = { schema: SESSION_MEMBER_SCHEMA, id: 's-1', name: 'The docks' };

function world(contents: Member[]): Draft {
  return { name: 'The harbour set', contents };
}

function ids(members: Member[]): string[] {
  return members.map((member) => member.id);
}

describe('the 412 merge, member by member', () => {
  const PRISTINE = world([BOOK, ACTOR]);

  /** The case the merge exists for: a session added from its page while this editor was open. */
  it('keeps an add on each side — theirs in place, mine after', () => {
    const merged = mergedMembers(
      PRISTINE,
      world([BOOK, ACTOR, TREATMENT]),
      world([BOOK, ACTOR, SESSION]),
    );

    expect(ids(merged)).toEqual(['book-rain', 'actor-vera', 's-1', 'treat-wet']);
  });

  it('keeps a removal I made, even though they still have it', () => {
    const merged = mergedMembers(PRISTINE, world([BOOK]), world([BOOK, ACTOR, SESSION]));

    expect(ids(merged)).toEqual(['book-rain', 's-1']);
  });

  it('keeps a removal they made, when my copy is the one I opened', () => {
    const merged = mergedMembers(PRISTINE, world([BOOK, ACTOR, TREATMENT]), world([BOOK]));

    expect(ids(merged)).toEqual(['book-rain', 'treat-wet']);
  });

  /**
   * ***Unless I re-added it*** — which the walk can see only when my envelope
   * differs from the one I opened: a re-add after the object was renamed
   * writes the new name. The identical re-add is my net change being nothing,
   * and `mergedMembers`' docstring says so.
   */
  it('keeps a member they removed that I re-added under its current name', () => {
    const renamed = { ...ACTOR, name: 'Vera Kohl, retired' };
    const merged = mergedMembers(PRISTINE, world([BOOK, renamed]), world([BOOK]));

    expect(merged).toEqual([BOOK, renamed]);
  });

  /** Mutation guard: a merge that ignored `pristine` would resurrect every removal of theirs. */
  it('does not resurrect a removal of theirs that I never touched', () => {
    const merged = mergedMembers(PRISTINE, world([BOOK, ACTOR]), world([ACTOR]));

    expect(ids(merged)).toEqual(['actor-vera']);
  });

  it('adds nothing twice when both sides added the same member', () => {
    const merged = mergedMembers(
      PRISTINE,
      world([BOOK, ACTOR, SESSION]),
      world([BOOK, ACTOR, SESSION]),
    );

    expect(ids(merged)).toEqual(['book-rain', 'actor-vera', 's-1']);
  });
});

describe('editing the list', () => {
  it('appends a new member and leaves a held one where it is', () => {
    expect(ids(addMember([BOOK], ACTOR))).toEqual(['book-rain', 'actor-vera']);
    expect(ids(addMember([BOOK, ACTOR], { ...BOOK, name: 'Renamed' }))).toEqual([
      'book-rain',
      'actor-vera',
    ]);
  });

  /** By position: a hand edit can name one id twice, and a click removes the row it was on. */
  it('removes the row that was pressed and not its twin', () => {
    const twin = { ...BOOK, name: 'Rain City (again)' };
    expect(removeMemberAt([BOOK, ACTOR, twin], 2)).toEqual([BOOK, ACTOR]);
  });

  it('names a session by its stored name, and not by the placeholder for none', () => {
    expect(sessionMember('s-1', 'The docks')).toEqual({
      schema: 'storyengine.session/1',
      id: 's-1',
      name: 'The docks',
    });
    expect(sessionMember('s-2', '  ')).toEqual({ schema: 'storyengine.session/1', id: 's-2' });
  });
});

describe('the guard the field is behind', () => {
  it('passes a list of envelopes, and an empty one', () => {
    expect(contentsShape([BOOK, { schema: 'x', id: 'y' }])).toBeNull();
    expect(contentsShape([])).toBeNull();
  });

  it('refuses what the field would throw on', () => {
    expect(contentsShape('none')).toBe('its "contents" is not a list');
    expect(contentsShape([null])).toBe('a member is not an object');
    expect(contentsShape([{ schema: 'x', id: 7 }])).toBe('a member has no "id" string');
    expect(contentsShape([{ id: 'y' }])).toBe('a member has no "schema" string');
  });
});

function object(
  id: string,
  name: string,
  schema: string,
  over: Partial<LibraryObject> = {},
): LibraryObject {
  return {
    id,
    name,
    schema,
    slug: id,
    source: 'user',
    contentHash: 'sha256:x',
    shadowed: false,
    object: {},
    ...over,
  };
}

function session(id: string, name: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    name,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    headTurnId: null,
    ...over,
  };
}

describe('what a member resolves to', () => {
  const LIBRARY = [object('book-rain', 'Rain City, revised', 'storyengine.lorebook/1')];
  const SESSIONS = [session('s-1', 'The docks at night')];

  it('takes the current name of what it names, which is what a reference is for', () => {
    expect(resolveMember(BOOK, LIBRARY, SESSIONS)).toEqual({
      state: 'found',
      name: 'Rain City, revised',
    });
    expect(resolveMember(SESSION, LIBRARY, SESSIONS)).toEqual({
      state: 'found',
      name: 'The docks at night',
    });
  });

  it('is missing when the list has answered and does not hold it', () => {
    expect(resolveMember(ACTOR, LIBRARY, SESSIONS)).toEqual({ state: 'missing' });
    expect(resolveMember({ ...SESSION, id: 's-gone' }, LIBRARY, SESSIONS)).toEqual({
      state: 'missing',
    });
  });

  /** A slow request is not a deletion, and a badge saying so would be the surface guessing. */
  it('is unchecked, not missing, while its list has not answered', () => {
    expect(resolveMember(ACTOR, undefined, SESSIONS)).toEqual({ state: 'unchecked' });
    expect(resolveMember(SESSION, LIBRARY, undefined)).toEqual({ state: 'unchecked' });
  });

  it('says a kind it does not know is unknown rather than missing', () => {
    expect(
      resolveMember({ schema: 'storyengine.campaign/1', id: 'c-1' }, LIBRARY, SESSIONS),
    ).toEqual({ state: 'unknown-kind' });
  });

  it('reads the winner of a duplicated id', () => {
    const library = [
      object('book-rain', 'The loser', 'storyengine.lorebook/1', { shadowed: true }),
      object('book-rain', 'The winner', 'storyengine.lorebook/1'),
    ];
    expect(resolveMember(BOOK, library, [])).toEqual({ state: 'found', name: 'The winner' });
  });
});

describe('what the picker offers', () => {
  const LIBRARY = [
    object('book-rain', 'Rain City', 'storyengine.lorebook/1'),
    object('actor-vera', 'Vera Kohl', 'storyengine.actor/1'),
    object('preset-sys', 'Shipped preset', 'storyengine.preset/1', { source: 'system' }),
    object('world-other', 'Another world', 'storyengine.world/1'),
  ];
  const SESSIONS = [session('s-1', 'The docks'), session('s-2', '', { archivedAt: '2026-10-02' })];

  /**
   * Yours, every kind but a World, and your sessions — [15 §3.1]'s *not
   * another World* and P16.1's *the objects you own*.
   */
  it('offers your objects of every kind but worlds, and your sessions after them', () => {
    const offered = candidatesFor(LIBRARY, SESSIONS);

    // Sessions by the label a row shows: *The docks* before *Untitled
    // session*, not the unnamed one first under an empty string.
    expect(offered.map((one) => [one.kind, one.member.id])).toEqual([
      ['actors', 'actor-vera'],
      ['lorebooks', 'book-rain'],
      ['session', 's-1'],
      ['session', 's-2'],
    ]);
    expect(offered.find((one) => one.member.id === 's-2')?.archived).toBe(true);
    expect(offered.find((one) => one.member.id === 's-1')?.member).toEqual({
      schema: SESSION_MEMBER_SCHEMA,
      id: 's-1',
      name: 'The docks',
    });
  });

  it('offers one row per id, the winner', () => {
    const offered = candidatesFor(
      [
        object('book-rain', 'The loser', 'storyengine.lorebook/1', { shadowed: true }),
        object('book-rain', 'The winner', 'storyengine.lorebook/1'),
      ],
      [],
    );
    expect(offered.map((one) => one.name)).toEqual(['The winner']);
  });

  it('narrows by kind and by a piece of the name, case-insensitively', () => {
    const offered = candidatesFor(LIBRARY, SESSIONS);

    expect(
      offered.filter((one) => candidateMatches(one, '', 'rain')).map((one) => one.name),
    ).toEqual(['Rain City']);
    expect(offered.filter((one) => candidateMatches(one, 'session', '')).length).toBe(2);
    expect(offered.filter((one) => candidateMatches(one, 'actors', 'rain')).length).toBe(0);
  });

  /** The row says *Untitled session*, so typing that has to find it. */
  it('finds an unnamed session by the words its row shows', () => {
    const offered = candidatesFor(LIBRARY, SESSIONS);

    expect(
      offered.filter((one) => candidateMatches(one, '', 'untitled')).map((one) => one.member.id),
    ).toEqual(['s-2']);
  });
});
