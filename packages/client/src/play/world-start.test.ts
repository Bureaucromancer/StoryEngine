// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { LibraryObject } from '../api.js';
import {
  booksScopedTo,
  chooseWorld,
  chooseWorldSetup,
  NOTHING_PREFILLED,
  ownWorlds,
  soleSetup,
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

function offer(
  books: string[],
  treatments: string[] = [],
  setups: string[] = [],
  heldSetups: string[] = setups,
): WorldOffer {
  return {
    id: 'w',
    name: 'w',
    books: books.map((id) => ({ id, name: id })),
    scoped: [],
    treatments: treatments.map((id) => ({ id, name: id })),
    setups: setups.map((id) => ({ id, name: id })),
    heldSetups,
  };
}

const setupMember = (id: string, name = id) => ({ schema: 'storyengine.setup/1', id, name });

/** A Setup on the library's shelf. */
function shelfSetup(id: string, name = id): LibraryObject {
  return row(id, undefined, { schema: 'storyengine.setup/1', name, object: {} });
}

/** A lorebook row on the library's shelf, with whatever scope the test gives it. */
function shelfBook(
  id: string,
  name: string,
  scope: unknown,
  over: Partial<LibraryObject> = {},
): LibraryObject {
  return row(id, undefined, {
    schema: 'storyengine.lorebook/1',
    name,
    object: { scope },
    ...over,
  });
}

const forWorld = (...worldIds: unknown[]) => ({ kind: 'world', worldIds });

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

/**
 * ***The books that say they are for a World*** — `LoreScope`'s `world` arm,
 * [P16.2], [15 §5.3], [26 B16]. The server copies them after the World's own
 * members, by name, each once (`library/worlds.ts`, `worldContribution`); the
 * form has to tick the same list, or *what the person sees is what starts*
 * stops being true the first time an author scopes a book.
 */
describe('what a World offers, from the books whose scope names it', () => {
  it('puts them after its members, by name, each once — as the server copies them', () => {
    const world = row('w', [book('m2', 'Members first'), book('both', 'Also a member')]);
    const read = worldOffer(world, [
      shelfBook('z', 'Zephyr notes', forWorld('w')),
      shelfBook('both', 'Also a member', forWorld('w')),
      shelfBook('a', 'Archive', forWorld('other', 'w')),
      shelfBook('elsewhere', 'Another world’s', forWorld('other')),
      shelfBook('plain', 'Not scoped', { kind: 'linked', actorIds: [] }),
    ]);
    expect(read.books.map((one) => one.id)).toEqual(['m2', 'both', 'a', 'z']);
    // Only the two that are there because of their scope — the member that
    // also names the World is the World's, and stays where the World put it.
    expect(read.scoped).toEqual(['a', 'z']);
  });

  /**
   * The server's own filter, row for row: a shadowed copy is not the book its
   * id reaches, a system book is readable and so counts, and an arm read
   * defensively — `worldIdsOf` — names nothing when its list is not one.
   */
  it('reads the arm the way the server does, and nothing else as it', () => {
    const scoped = booksScopedTo('w', [
      shelfBook('shipped', 'Shipped', forWorld('w'), { source: 'system' }),
      shelfBook('loser', 'Loser', forWorld('w'), { shadowed: true }),
      shelfBook('garbled', 'Garbled', { kind: 'world', worldIds: 'w' }),
      shelfBook('newer', 'Newer', { kind: 'campaign', worldIds: ['w'] }),
      shelfBook('global', 'Global', { kind: 'global' }),
      row('w', [], { schema: 'storyengine.actor/1', object: { scope: forWorld('w') } }),
    ]);
    expect(scoped.map((one) => one.id)).toEqual(['shipped']);
    expect(booksScopedTo('w', undefined)).toEqual([]);
  });

  it('is its members alone before the shelf has been read', () => {
    const read = worldOffer(row('w', [book('m1')]));
    expect(read.books).toEqual([{ id: 'm1', name: 'm1' }]);
    expect(read.scoped).toEqual([]);
  });

  it('offers each of your own Worlds with the books scoped to it', () => {
    const offered = worldsToOffer(
      [row('w1', []), row('w2', [book('m')])],
      [shelfBook('s1', 'For one', forWorld('w1')), shelfBook('s2', 'For two', forWorld('w2'))],
    );
    expect(offered.map((one) => one.books.map((each) => each.id))).toEqual([['s1'], ['m', 's2']]);
    expect(ownWorlds([row('mine', []), row('shipped', [], { source: 'system' })])).toHaveLength(1);
  });

  /**
   * ***Taken back with the members*** — the property that makes the select
   * safe to try holds for a scoped book too, because `chooseWorld` never needs
   * to know which statement put a book in the offer.
   */
  it('ticks them after the members and takes them back when the World changes', () => {
    const lorebooks = [
      shelfBook('s1', 'Scoped to Rain City', forWorld('rain')),
      shelfBook('s2', 'Scoped to the Coast', forWorld('coast')),
    ];
    const rain = worldOffer(row('rain', [book('m1')]), lorebooks);
    const coast = worldOffer(row('coast', []), lorebooks);

    const inRain = chooseWorld({ lore: ['mine'], treatment: '' }, NOTHING_PREFILLED, rain);
    expect(inRain.lore).toEqual(['mine', 'm1', 's1']);
    expect(inRain.prefilled.lore).toEqual(['m1', 's1']);

    const onTheCoast = chooseWorld(inRain, inRain.prefilled, coast);
    expect(onTheCoast.lore).toEqual(['mine', 's2']);

    expect(chooseWorld(onTheCoast, onTheCoast.prefilled, undefined).lore).toEqual(['mine']);
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

/**
 * ***A World's Setup, as the form chooses it*** — **the owner's answer of
 * 2026-10-12**: *"Use the World's Setup when it holds exactly one."* The server
 * starts `{ world }` through the World's sole Setup member; the form chooses
 * the same Setup in its select, so that what starts is what the person saw —
 * and, like the treatment, only into an empty select, taken back with the
 * World, and never in place of a Setup the person chose.
 */
describe('what a World offers as its Setup', () => {
  it('reads its Setups in its order, each once, and which of them the library holds', () => {
    const read = worldOffer(
      row('w', [
        setupMember('s2', 'Second'),
        book('b1'),
        setupMember('s1'),
        setupMember('s2', 'Second'),
        setupMember('gone', 'Gone'),
      ]),
      [],
      [shelfSetup('s1'), shelfSetup('s2'), shelfSetup('elsewhere')],
    );
    expect(read.setups).toEqual([
      { id: 's2', name: 'Second' },
      { id: 's1', name: 's1' },
      { id: 'gone', name: 'Gone' },
    ]);
    expect(read.heldSetups).toEqual(['s2', 's1']);
    // Before the Setups shelf has been read, nothing can be started from.
    expect(worldOffer(row('w', [setupMember('s1')])).heldSetups).toEqual([]);
  });

  it('offers each of your Worlds with the Setups the shelf holds', () => {
    const offered = worldsToOffer(
      [row('w1', [setupMember('s1')]), row('w2', [setupMember('s2')])],
      [],
      [shelfSetup('s1')],
    );
    expect(offered.map((one) => one.heldSetups)).toEqual([['s1'], []]);
  });

  /**
   * ***Exactly one, and one the library holds*** — the server's count, which
   * is of members: two Setups of which one is gone choose neither, so the one
   * left is not promoted to *the only one*.
   */
  it('chooses a Setup by itself only when it holds exactly one, and the library holds it', () => {
    expect(soleSetup(offer([], [], ['s1']))).toBe('s1');
    expect(soleSetup(offer([], [], ['s1', 's2']))).toBeNull();
    expect(soleSetup(offer([], [], ['gone'], []))).toBeNull();
    expect(soleSetup(offer([], [], ['s1', 'gone'], ['s1']))).toBeNull();
    expect(soleSetup(offer([]))).toBeNull();
    expect(soleSetup(undefined)).toBeNull();
  });
});

describe('choosing a World, for the Setup select', () => {
  it('chooses its only Setup when none is chosen, and remembers that it did', () => {
    expect(chooseWorldSetup('', null, offer([], [], ['s1']))).toEqual({
      setup: 's1',
      prefilled: 's1',
    });
  });

  /** A person's own Setup outranks a World's, as a picked treatment does. */
  it('never replaces a Setup the person chose', () => {
    expect(chooseWorldSetup('theirs', null, offer([], [], ['s1']))).toEqual({
      setup: 'theirs',
      prefilled: null,
    });
  });

  it('chooses none of several, and none that is gone', () => {
    expect(chooseWorldSetup('', null, offer([], [], ['s1', 's2']))).toEqual({
      setup: '',
      prefilled: null,
    });
    expect(chooseWorldSetup('', null, offer([], [], ['gone'], []))).toEqual({
      setup: '',
      prefilled: null,
    });
  });

  /** ***No world returns the select to where it was***, and another World chooses its own. */
  it('takes back the Setup it chose when the World changes', () => {
    const chosen = chooseWorldSetup('', null, offer([], [], ['s1']));
    expect(chooseWorldSetup(chosen.setup, chosen.prefilled, undefined)).toEqual({
      setup: '',
      prefilled: null,
    });
    expect(chooseWorldSetup(chosen.setup, chosen.prefilled, offer([], [], ['s2']))).toEqual({
      setup: 's2',
      prefilled: 's2',
    });
    expect(chooseWorldSetup(chosen.setup, chosen.prefilled, offer([], [], ['a', 'b']))).toEqual({
      setup: '',
      prefilled: null,
    });
  });

  /** A Setup the person picked after the World chose one is theirs from then on. */
  it('keeps a Setup the person picked after the World chose', () => {
    const chosen = chooseWorldSetup('', null, offer([], [], ['s1']));
    expect(chooseWorldSetup('theirs', chosen.prefilled, undefined)).toEqual({
      setup: 'theirs',
      prefilled: null,
    });
    expect(chooseWorldSetup('theirs', chosen.prefilled, offer([], [], ['s2']))).toEqual({
      setup: 'theirs',
      prefilled: null,
    });
  });
});
