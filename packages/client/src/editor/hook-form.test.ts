// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newLorebook, newSetup, newTreatment, type PlotHook } from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import {
  hooksOf,
  moveHook,
  newHook,
  patchHook,
  removeHook,
  withHooks,
  withOptionalHooks,
  type Draft,
} from './hook-form.js';

/**
 * The hook editor's edits, where they are pure — which is all of the part that
 * can eat somebody's work.
 *
 * **Three claims, each with a case below that goes red on its own mutation:**
 * an edit to one hook leaves every other hook *byte*-identical and leaves the
 * carrier's own fields alone; a field this build has never heard of survives an
 * edit to the hook carrying it ([04 §2](../../../../docs/design/04-schemas.md));
 * and the absence rule holds in both directions — a `Lorebook` whose `hooks` is
 * optional does not acquire an empty list from being looked at, while a
 * `Treatment` whose `hooks` is required does not lose one.
 *
 * The first claim is asserted **on the carrier** rather than on the list,
 * because the list is the easy half: the failure worth catching is an editor
 * that rebuilds the treatment around its hooks and drops a field it does not
 * render, and a test that only ever looked at `hooks` could not see it.
 */

function hook(title: string, over: Partial<PlotHook> = {}): PlotHook {
  return { ...newHook(title), ...over };
}

/** A treatment carrying these hooks — `hooks` is required on this kind. */
function treatment(hooks: PlotHook[]): Draft {
  return { ...(newTreatment('Rain City') as unknown as Draft), hooks };
}

/** One hook of a carrier, as JSON, for byte comparisons. */
function bytes(carrier: Draft, id: string): string {
  return JSON.stringify(hooksOf(carrier).find((each) => each.id === id));
}

describe('editing one hook', () => {
  it('leaves every other hook byte-identical', () => {
    const hooks = [hook('The marriage'), hook('The war'), hook('The letter')];
    const before = treatment(hooks);
    const untouched = hooksOf(before).map((each) => JSON.stringify(each));

    const after = withHooks(
      before,
      patchHook(hooksOf(before), hooks[1]!.id, { premise: 'A declaration over an island.' }),
    );
    const now = hooksOf(after).map((each) => JSON.stringify(each));

    expect(now[0]).toBe(untouched[0]);
    expect(now[2]).toBe(untouched[2]);
    expect(now[1]).not.toBe(untouched[1]);
  });

  /**
   * The rest of *that* hook, and the rest of the carrier. A patch that spreads
   * over the hook keeps both; a form that rebuilt either from the fields it
   * renders would pass the case above and fail this one.
   */
  it('leaves the rest of that hook, and the carrier, alone', () => {
    const one = hook('The marriage', { weight: 3, blockedBy: ['x'], once: false });
    const before = treatment([one]);

    const after = withHooks(before, patchHook(hooksOf(before), one.id, { title: 'The wedding' }));

    expect(hooksOf(after)[0]).toEqual({ ...one, title: 'The wedding' });
    expect(after['name']).toBe(before['name']);
    expect(after['openings']).toBe(before['openings']);
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });

  /**
   * [04 §2]'s promise, per object. A hook rebuilt from the fields this build
   * knows would strip whatever a newer one wrote into it — which is exactly
   * what a projected form type would have done, and the reason the draft is the
   * carrier itself.
   */
  it('carries through a field this build has never heard of', () => {
    const odd = {
      ...hook('The war'),
      requires: [{ channel: 'se.weather' }],
    } as unknown as PlotHook;
    const before = treatment([odd]);

    const after = withHooks(before, patchHook(hooksOf(before), odd.id, { weight: 2 }));

    expect(hooksOf(after)[0]).toMatchObject({
      weight: 2,
      requires: [{ channel: 'se.weather' }],
    });
  });

  /**
   * **Ids are meant to be unique and are not guaranteed to be.** The pool
   * copies hooks from four sources keeping their ids ([03 §4.1]), so two
   * carriers can hold the same one and a paste between them collides. Patching
   * the first degrades to *one of the two is uneditable*, which is visible;
   * patching both would edit two hooks from one form and save both.
   */
  it('patches the first of two hooks sharing an id, never both', () => {
    const twin = hook('The marriage');
    const hooks = [twin, { ...hook('The war'), id: twin.id }];

    const after = patchHook(hooks, twin.id, { premise: 'They announce it.' });

    expect(after[0]?.premise).toBe('They announce it.');
    expect(after[1]?.premise).toBe('');
  });

  it('changes nothing at all for an id the list does not hold', () => {
    const hooks = [hook('The marriage')];
    expect(JSON.stringify(patchHook(hooks, 'nobody', { weight: 9 }))).toBe(JSON.stringify(hooks));
  });
});

/**
 * ***The absence rule, both ways*** — the one place the three carriers differ.
 *
 * `Lorebook.hooks` is optional and `Treatment.hooks` and `Setup.hooks` are
 * required, so *absent* and *empty* are a real distinction on one of the three
 * and a validity question on the other two. A rule that deleted the key
 * whenever the list emptied would write a Treatment that no longer validates;
 * a rule that always wrote it would reclassify a lorebook that was only ever
 * looked at, which [03 §4.1] is explicit about keeping secondary.
 */
describe('the absence rule', () => {
  it('gives a lorebook a hooks key when it gains its first hook', () => {
    const book = newLorebook('Harbour lore') as unknown as Draft;
    expect(Object.hasOwn(book, 'hooks')).toBe(false);

    const after = withHooks(book, [hook('The war')]);

    expect(Object.hasOwn(after, 'hooks')).toBe(true);
    expect(hooksOf(after)).toHaveLength(1);
  });

  it('leaves a lorebook that never had one without it, by identity', () => {
    const book = newLorebook('Harbour lore') as unknown as Draft;

    const after = withHooks(book, []);

    expect(Object.hasOwn(after, 'hooks')).toBe(false);
    // By identity, so an editor's change test stays false and a mount that
    // touched nothing does not light up Save.
    expect(after).toBe(book);
  });

  it('keeps a treatment and a setup carrying an empty list rather than losing the field', () => {
    for (const carrier of [
      newTreatment('Rain City') as unknown as Draft,
      newSetup('A night at the docks') as unknown as Draft,
    ]) {
      const one = hook('The war');
      const after = withHooks(withHooks(carrier, [one]), removeHook([one], one.id));

      expect(Object.hasOwn(after, 'hooks')).toBe(true);
      expect(hooksOf(after)).toEqual([]);
    }
  });

  it('reads a carrier with no hooks as none rather than throwing', () => {
    expect(hooksOf(newLorebook('Harbour lore') as unknown as Draft)).toEqual([]);
  });

  /**
   * ***The optional-carrier half, which is the rule the two carriers do not
   * share.*** `withHooks` above keeps an emptied list because deleting it
   * generically would strip a **required** property off a Treatment; a lorebook
   * has the opposite need, because 03 §4.1 makes hooks-on-lorebooks deliberately
   * secondary and a book carrying `"hooks": []` is a book quietly reclassified
   * by a surface that rendered it.
   */
  it('takes the key back off a lorebook whose last hook is removed', () => {
    const book = newLorebook('Harbour lore') as unknown as Draft;
    const one = hook('The war');

    const carried = withOptionalHooks(book, [one]);
    expect(Object.hasOwn(carried, 'hooks')).toBe(true);

    const emptied = withOptionalHooks(carried, removeHook([one], one.id));
    expect(Object.hasOwn(emptied, 'hooks')).toBe(false);
    // And byte-identical to the book that never had one, which is the claim
    // *absent is not an emptied list* is worth anything for.
    expect(JSON.stringify(emptied)).toBe(JSON.stringify(book));
  });

  it('returns a lorebook that never had one by identity', () => {
    const book = newLorebook('Harbour lore') as unknown as Draft;
    expect(withOptionalHooks(book, [])).toBe(book);
  });

  /**
   * A book that arrived carrying an explicit `"hooks": []` and is emptied
   * *through this control* loses the key: both spellings mean *no hooks*, and
   * only one of them is what this editor writes.
   */
  it('drops an explicit empty list a hand edit left behind', () => {
    const book = { ...(newLorebook('Harbour lore') as unknown as Draft), hooks: [] };

    expect(Object.hasOwn(withOptionalHooks(book, []), 'hooks')).toBe(false);
  });
});

/**
 * ***Clearing an optional field, which is the edit a spread cannot express.***
 *
 * `newHook` above leaves `blockedBy`, `notBefore` and `introduces` **absent**,
 * and states why: *a hook that has never been given an eligibility filter says
 * nothing about one*. The controls that set them have to be able to get back
 * there — type a turn floor, think better of it, and the hook has to end up
 * byte-identical to one that never had a gate, because what it ends up as is
 * what goes into the portable file and every diff of it.
 */
describe('unsetting a field', () => {
  it('removes the key rather than writing undefined into it', () => {
    const one = hook('The war', { notBefore: { turn: 4 }, blockedBy: ['other'] });

    const [after] = patchHook([one], one.id, { notBefore: undefined, blockedBy: undefined });

    expect(Object.hasOwn(after!, 'notBefore')).toBe(false);
    expect(Object.hasOwn(after!, 'blockedBy')).toBe(false);
  });

  it('leaves the hook byte-identical to one that never carried the field', () => {
    const plain = hook('The war');
    const gated = { ...plain, notBefore: { turn: 4 } };

    const [after] = patchHook([gated], plain.id, { notBefore: undefined });

    expect(JSON.stringify(after)).toBe(JSON.stringify(plain));
  });

  it('leaves a key the hook never had absent rather than adding it', () => {
    const plain = hook('The war');

    const [after] = patchHook([plain], plain.id, { introduces: undefined });

    expect(JSON.stringify(after)).toBe(JSON.stringify(plain));
  });

  it('still sets a key given a value, in the same patch', () => {
    const one = hook('The war', { notBefore: { turn: 4 } });

    const [after] = patchHook([one], one.id, { notBefore: undefined, premise: 'Soon.' });

    expect(after).toMatchObject({ premise: 'Soon.' });
    expect(Object.hasOwn(after!, 'notBefore')).toBe(false);
  });
});

/**
 * The defaults a hook typed by hand takes — the same five the session panel
 * fills in behind its two fields ([P7.5]), because a hook written while playing
 * and a hook written in the editor must not be different objects for a reason
 * nobody can see.
 */
describe('a new hook', () => {
  it('mints an id and takes the defaults the panel already uses', () => {
    const made = newHook('The marriage');

    expect(made.id).not.toBe('');
    expect(made).toMatchObject({
      title: 'The marriage',
      premise: '',
      magnitude: 'local',
      involves: [],
      weight: 1,
      delivery: 'guidance',
      once: true,
    });
  });

  /** The optional three are absent, not empty — [04 §2]'s additive shape. */
  it('leaves the eligibility filters and the introduction unset', () => {
    const made = newHook('The marriage');

    expect(Object.hasOwn(made, 'blockedBy')).toBe(false);
    expect(Object.hasOwn(made, 'notBefore')).toBe(false);
    expect(Object.hasOwn(made, 'introduces')).toBe(false);
  });

  /**
   * Two hooks made in the same millisecond are still two hooks. The id is what
   * `blockedBy` and `notBefore.afterHook` address, and [15 §5.1] makes it the
   * thing that has to survive every later copy.
   */
  it('mints a different id every time', () => {
    expect(newHook('a').id).not.toBe(newHook('a').id);
  });
});

describe('removing and reordering', () => {
  it('removes the one named and leaves the others byte-identical', () => {
    const keep = hook('The marriage');
    const drop = hook('The war');
    const before = treatment([keep, drop]);

    const after = withHooks(before, removeHook(hooksOf(before), drop.id));

    expect(hooksOf(after).map((each) => each.title)).toEqual(['The marriage']);
    expect(bytes(after, keep.id)).toBe(bytes(before, keep.id));
  });

  it('moves a hook to the position asked for', () => {
    const hooks = [hook('one'), hook('two'), hook('three')];

    expect(moveHook(hooks, hooks[2]!.id, 0).map((each) => each.title)).toEqual([
      'three',
      'one',
      'two',
    ]);
    expect(moveHook(hooks, hooks[0]!.id, 1).map((each) => each.title)).toEqual([
      'two',
      'one',
      'three',
    ]);
  });

  /**
   * A target past either end is clamped, so *down* on the last hook is a no-op
   * rather than a throw — and a no-op comes back by identity, so nothing
   * downstream reads a move that did not happen as a change.
   */
  it('clamps past the ends and returns the list unchanged for a no-op', () => {
    const hooks = [hook('one'), hook('two')];

    expect(moveHook(hooks, hooks[1]!.id, 9)).toBe(hooks);
    expect(moveHook(hooks, hooks[0]!.id, -3)).toBe(hooks);
    expect(moveHook(hooks, 'nobody', 0)).toBe(hooks);
  });

  it('leaves the moved hook byte-identical to what it was', () => {
    const hooks = [hook('one'), hook('two', { weight: 4 })];
    const moved = moveHook(hooks, hooks[1]!.id, 0);

    expect(JSON.stringify(moved[0])).toBe(JSON.stringify(hooks[1]));
  });
});
