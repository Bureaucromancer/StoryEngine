// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { LibraryObject } from '../api.js';
import {
  chooseWorld,
  NOTHING_PREFILLED,
  soleTreatment,
  worldOffer,
  worldsToOffer,
  type WorldOffer,
} from './world-start.js';

/**
 * ***What a World fills into the session form, and what it takes back*** —
 * [P16.2](../../../../docs/design/workplan/35-p16-world.md),
 * [P16 §1.3](../../../../docs/design/workplan/35-p16-world.md).
 *
 * The page's tests assert the wire; these assert the rule on its own, because
 * the cases where a form quietly loses a choice — a book ticked before the
 * World came, a treatment picked by hand, a World changed for another — are
 * easier to state as data than to click through.
 */

function row(id: string, contents: unknown, over: Partial<LibraryObject> = {}): LibraryObject {
  return {
    id,
    schema: 'storyengine.world/1',
    name: id,
    slug: id,
    source: 'user',
    contentHash: 'sha256:x',
    shadowed: false,
    object: { contents },
    ...over,
  };
}

const book = (id: string, name = id) => ({ schema: 'storyengine.lorebook/1', id, name });
const treatment = (id: string) => ({ schema: 'storyengine.treatment/1', id, name: id });

function offer(books: string[], treatments: string[] = []): WorldOffer {
  return {
    id: 'w',
    name: 'w',
    books: books.map((id) => ({ id, name: id })),
    treatments: treatments.map((id) => ({ id, name: id })),
  };
}

describe('what a World offers', () => {
  it('reads its books and treatments in its order, as the server does', () => {
    const read = worldOffer(
      row('w', [
        book('b2', 'Second'),
        { schema: 'storyengine.session/1', id: 's1' },
        book('b1'),
        treatment('t1'),
        { schema: 'storyengine.actor/1', id: 'a1' },
      ]),
    );
    expect(read.books).toEqual([
      { id: 'b2', name: 'Second' },
      { id: 'b1', name: 'b1' },
    ]);
    expect(read.treatments).toEqual([{ id: 't1', name: 't1' }]);
  });

  /**
   * The row is whatever was on disk, and this runs on the session list's page,
   * which has no error boundary — so a malformed member is skipped, a nameless
   * one is shown by its id, and one named twice is offered once.
   */
  it('skips what it cannot read, and names each member once', () => {
    const read = worldOffer(
      row('w', [
        null,
        7,
        { schema: 'storyengine.lorebook/1' },
        book('b1'),
        book('b1'),
        book('b2', ''),
      ]),
    );
    expect(read.books).toEqual([
      { id: 'b1', name: 'b1' },
      { id: 'b2', name: 'b2' },
    ]);
    expect(worldOffer(row('w', 'none')).books).toEqual([]);
  });

  it('offers only your own Worlds, and only the copy their id reaches', () => {
    const offered = worldsToOffer([
      row('mine', []),
      row('shipped', [], { source: 'system' }),
      row('loser', [], { shadowed: true }),
      row('preset', [], { schema: 'storyengine.preset/1' }),
    ]);
    expect(offered.map((one) => one.id)).toEqual(['mine']);
    expect(worldsToOffer(undefined)).toEqual([]);
  });

  it('chooses a treatment by itself only when it holds exactly one', () => {
    expect(soleTreatment(offer([], ['t1']))).toBe('t1');
    expect(soleTreatment(offer([], ['t1', 't2']))).toBeNull();
    expect(soleTreatment(offer([]))).toBeNull();
    expect(soleTreatment(undefined)).toBeNull();
  });
});

describe('choosing a World on a form already in progress', () => {
  it('adds its books after what is ticked, and fills an empty treatment with its one', () => {
    const next = chooseWorld(
      { lore: ['mine'], treatment: '' },
      NOTHING_PREFILLED,
      offer(['b1', 'mine', 'b2'], ['t1']),
    );
    expect(next).toEqual({
      lore: ['mine', 'b1', 'b2'],
      treatment: 't1',
      // `mine` was the person's before the World came, so it is not the World's to take back.
      prefilled: { lore: ['b1', 'b2'], treatment: 't1' },
    });
  });

  it('leaves a treatment somebody picked, and picks none of several', () => {
    expect(
      chooseWorld({ lore: [], treatment: 'theirs' }, NOTHING_PREFILLED, offer([], ['t1'])),
    ).toMatchObject({ treatment: 'theirs', prefilled: { treatment: null } });
    expect(
      chooseWorld({ lore: [], treatment: '' }, NOTHING_PREFILLED, offer([], ['t1', 't2'])),
    ).toMatchObject({ treatment: '', prefilled: { treatment: null } });
  });

  /**
   * ***No world returns the form to where it was*** — the property that makes
   * the select safe to try.
   */
  it('takes back exactly what it added when no World is chosen', () => {
    const chosen = chooseWorld(
      { lore: ['mine'], treatment: '' },
      NOTHING_PREFILLED,
      offer(['b1', 'b2'], ['t1']),
    );
    expect(chooseWorld(chosen, chosen.prefilled, undefined)).toEqual({
      lore: ['mine'],
      treatment: '',
      prefilled: NOTHING_PREFILLED,
    });
  });

  it('keeps what the person changed after the World filled it in', () => {
    const chosen = chooseWorld(
      { lore: [], treatment: '' },
      NOTHING_PREFILLED,
      offer(['b1', 'b2'], ['t1']),
    );
    // Unticked b1, ticked one of their own, picked another treatment.
    const edited = { lore: ['b2', 'theirs'], treatment: 't9' };
    expect(chooseWorld(edited, chosen.prefilled, offer(['b3']))).toEqual({
      lore: ['theirs', 'b3'],
      treatment: 't9',
      prefilled: { lore: ['b3'], treatment: null },
    });
  });
});
