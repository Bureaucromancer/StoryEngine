// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { setupFromForm, type SessionForm } from './setup-from-form.js';

/**
 * **A Setup built from the form that already collects one** — [04 §7], [P7.4].
 *
 * The property worth holding is a **round trip**: what this writes,
 * `POST /api/sessions` reads back out of a Setup, so a person who saves a
 * configuration and starts from it gets the configuration back. Both halves are
 * tested against it — `routes/sessions.test.ts` asserts the reading side, and
 * every field here has its counterpart there. A field this wrote that creation
 * did not read would be a promise the library keeps and the game does not.
 */

const NAMES = {
  'treat-1': 'Rain City, noir',
  'preset-1': 'Rain noir',
  'actor-vera': 'Vera Kohl',
  'book-1': 'Rain City',
};

function form(over: Partial<SessionForm> = {}): SessionForm {
  return {
    name: 'The Fixer’s Debt',
    mode: 'storyengine.scene',
    modeConfig: {},
    treatment: '',
    preset: '',
    persona: '',
    lore: [],
    names: NAMES,
    ...over,
  };
}

describe('a Setup made from the session form', () => {
  it('is a well-formed library object with the name it was given', () => {
    const setup = setupFromForm(form());

    expect(setup.schema).toBe('storyengine.setup/1');
    expect(setup.name).toBe('The Fixer’s Debt');
    expect(setup.id.length).toBeGreaterThan(0);
  });

  it('names the mode and keeps its wizard’s answers', () => {
    const setup = setupFromForm(form({ modeConfig: { premise: 'Rain.', dice: true } }));

    expect(setup.mode).toEqual({
      id: 'storyengine.scene',
      config: { premise: 'Rain.', dice: true },
    });
  });

  /**
   * `null`, not `{}` — the same distinction the session file draws at
   * `mode.config`, so a Setup for a mode with no wizard does not claim one
   * answered nothing.
   */
  it('leaves the config null when no wizard collected anything', () => {
    expect(setupFromForm(form()).mode.config).toBeNull();
  });

  /**
   * **Both halves of a `Ref`.** [04 §3] resolves one by id *and* by name, so a
   * Setup that stored bare ids would travel to another install and resolve to
   * nothing.
   */
  it('stores a reference by id and by name', () => {
    const setup = setupFromForm(form({ treatment: 'treat-1', preset: 'preset-1' }));

    expect(setup.treatment).toEqual({ id: 'treat-1', name: 'Rain City, noir' });
    expect(setup.preset).toEqual({ id: 'preset-1', name: 'Rain noir' });
  });

  it('falls back to the id when the name is not to hand', () => {
    // A shelf that has not loaded is a worse Setup, not a broken one.
    const setup = setupFromForm(form({ treatment: 'treat-9', names: {} }));

    expect(setup.treatment).toEqual({ id: 'treat-9', name: 'treat-9' });
  });

  it('writes null for what was not chosen, which is *start bare*', () => {
    const setup = setupFromForm(form());

    expect(setup.treatment).toBeNull();
    expect(setup.preset).toBeNull();
    expect(setup.cast.personaOptions).toEqual([]);
    expect(setup.lore).toEqual([]);
  });

  /**
   * **The persona as an *option***, which is the shape's own word: a Setup
   * offers personas and a session has one, and `POST /api/sessions` takes the
   * first. One in and one out is the round trip.
   */
  it('offers the chosen persona', () => {
    const setup = setupFromForm(form({ persona: 'actor-vera' }));

    expect(setup.cast.personaOptions).toEqual([{ id: 'actor-vera', name: 'Vera Kohl' }]);
  });

  it('links the chosen lorebooks, none of them required', () => {
    const setup = setupFromForm(form({ lore: ['book-1'] }));

    // `required: false` because the form has no control for the distinction and
    // inventing one would be a claim the person did not make.
    expect(setup.lore).toEqual([{ ref: { id: 'book-1', name: 'Rain City' }, required: false }]);
  });

  /**
   * *Named rather than dropped.* `partyDefault` is empty because the party is
   * `se.party` since [P7.3] and seeding it means writing effects ~~— which the
   * session-creation path does not do either, so this is one honest gap rather
   * than two halves that disagree~~.
   *
   * *Corrected 2026-10-03, at the P15 merge*, and the test renamed from *as
   * the creation path does*: since P15.3 the creation path reads a party —
   * seats it and makes each member a companion — so this is not a gap both
   * halves share. The form writes none because what it picks is a cast, not a
   * party; [P7.4]'s symmetry paragraph records the asymmetry that leaves.
   * Mutation: write the persona into `partyDefault` and this fails.
   */
  it('writes no party, because what the form picks is a cast', () => {
    expect(setupFromForm(form({ persona: 'actor-vera' })).cast.partyDefault).toEqual([]);
  });

  it('trims the name, so a setup cannot be saved under whitespace', () => {
    expect(setupFromForm(form({ name: '  Rain  ' })).name).toBe('Rain');
  });
});
