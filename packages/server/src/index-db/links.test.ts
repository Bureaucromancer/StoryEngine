// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  LOREBOOK_SCHEMA,
  PACKAGE_SCHEMA,
  PRESET_SCHEMA,
  SETUP_SCHEMA,
  TREATMENT_SCHEMA,
} from '@storyengine/shared';

import { referencesIn } from './links.js';

/**
 * ***What counts as a reference*** —
 * [03 §10.1](../../../../docs/design/03-data-model.md),
 * [10 §5.2](../../../../docs/design/10-ui-surfaces.md),
 * [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The stage's proof obligation is *"an object referenced by a session, a
 * treatment and a package reports **three**"* — a claim [03 §10.1] makes and
 * one a panel showing *Used by* would otherwise assert only by looking right.
 * The counting is `usedBy`'s and the deciding is here, which is where a wrong
 * answer would come from: **a reference is a link somebody authored, not a
 * mention.**
 */

describe('what an object points at', () => {
  it('reads a setup’s treatment, preset, cast and lore', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      treatment: { id: 'treatment-1', name: 'Rain' },
      preset: { id: 'preset-1', name: 'Default' },
      cast: {
        personaOptions: [{ id: 'actor-you', name: 'You' }],
        partyDefault: [{ id: 'actor-vera' }],
        narrator: null,
      },
      lore: [{ ref: { id: 'book-1', name: 'Harbour' }, required: true }],
    });
    expect(new Set(found)).toEqual(
      new Set(['treatment-1', 'preset-1', 'actor-you', 'actor-vera', 'book-1']),
    );
  });

  /**
   * ***Both shapes, because the corpus has both.*** `Setup.treatment` is a
   * `Ref` and a session's `cast.actors` is an array of bare ids; a reader that
   * took only one would silently count half the references, which is worse than
   * counting none because the number still looks like an answer.
   */
  it('reads a bare id as readily as a Ref', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      cast: { personaOptions: ['actor-you'], partyDefault: ['actor-vera'], narrator: null },
    });
    expect(new Set(found)).toEqual(new Set(['actor-you', 'actor-vera']));
  });

  it('reads a treatment’s lore and cast', () => {
    const found = referencesIn(TREATMENT_SCHEMA, {
      id: 'treatment-1',
      lore: [{ ref: { id: 'book-1' } }],
      cast: [{ ref: { id: 'actor-vera' } }],
    });
    expect(new Set(found)).toEqual(new Set(['book-1', 'actor-vera']));
  });

  it('reads a package’s contents', () => {
    const found = referencesIn(PACKAGE_SCHEMA, {
      id: 'package-1',
      contents: [{ id: 'actor-vera' }, { id: 'book-1' }],
    });
    expect(new Set(found)).toEqual(new Set(['actor-vera', 'book-1']));
  });

  /**
   * ***A lorebook's entries are inside it, not pointed at by it.*** This is the
   * kind where a generic walk over every `{ id, name }`-shaped value looks most
   * principled and is most wrong: it would produce a table where a book
   * references its own three hundred entries, and *Used by* would answer with
   * the book's own contents.
   *
   * **Kept as the other half of the hook exception below**, and the pair is the
   * point: a lorebook now contributes edges, and this says the reason it does
   * is not *lorebooks contribute edges now*. Entries and folders are still its
   * own contents and still name nothing.
   */
  it('finds nothing in a lorebook, because its entries are its own', () => {
    expect(
      referencesIn(LOREBOOK_SCHEMA, {
        id: 'book-1',
        entries: [{ id: 'entry-1', name: 'The keeper' }],
        folders: [{ id: 'folder-1', name: 'The docks' }],
      }),
    ).toEqual([]);
  });

  it('reports each target once, however many fields name it', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      cast: {
        personaOptions: [{ id: 'actor-vera' }],
        partyDefault: [{ id: 'actor-vera' }],
        narrator: null,
      },
    });
    expect(found).toEqual(['actor-vera']);
  });

  it('answers empty for a kind that points at nothing and for a malformed one', () => {
    expect(referencesIn(SETUP_SCHEMA, null)).toEqual([]);
    expect(referencesIn(SETUP_SCHEMA, { id: 'setup-1', lore: 'not an array' })).toEqual([]);
  });
});

/**
 * ***An actor named only by a hook*** —
 * [04 §6.1a](../../../../docs/design/04-schemas.md),
 * [03 §4.1](../../../../docs/design/03-data-model.md),
 * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **The edge that was missing, and the reason it could go missing.** Hooks have
 * been on three carriers since [P7 §1.5] and authorable on none of them, so an actor
 * that only a hook named could not exist to be miscounted. It reads as *used by
 * nothing* — which is the one direction [03 §10.1]'s count must not lie in,
 * because the count is shown at the moment somebody is deciding whether to
 * delete. These tests are written against the shape a real hook has rather than
 * a two-field stub, because the failure being fixed was a reader that never
 * looked, and a stub proves a reader that never looked wrong just as well as it
 * proves one that looks in the wrong place right.
 */
describe('the actors a hook names', () => {
  /** A hook that names one actor through `involves` and nowhere else. */
  function involvingHook(actorId: string): Record<string, unknown> {
    return {
      id: 'hook-debt',
      title: 'The debt comes due',
      premise: 'Somebody calls it in at the worst moment.',
      magnitude: 'local',
      involves: [{ id: actorId, name: 'Vera' }],
      weight: 1,
      delivery: 'guidance',
      once: true,
    };
  }

  /**
   * A hook that **is** an arrival. Its subject sits in `introduces.actor` and,
   * per [04 §6.1a], deliberately *not* in `involves` — the two fields want
   * opposite answers about the same person, so a reader that only read
   * `involves` would find an introduction hook's subject nowhere at all.
   */
  function introducingHook(actorId: string): Record<string, unknown> {
    return {
      id: 'hook-stranger',
      title: 'The stranger at the door',
      premise: '',
      magnitude: 'personal',
      involves: [],
      weight: 1,
      delivery: 'seed',
      once: true,
      introduces: {
        actor: { id: actorId, name: 'The keeper' },
        entrances: [{ id: 'entrance-1', label: 'Out of the rain', text: 'She knocks twice.' }],
        primaryEntranceId: null,
      },
    };
  }

  it('reads an actor a treatment names only through a hook’s involves', () => {
    const found = referencesIn(TREATMENT_SCHEMA, {
      id: 'treatment-1',
      lore: [],
      cast: [],
      hooks: [involvingHook('actor-vera')],
    });
    expect(found).toEqual(['actor-vera']);
  });

  it('reads the actor a treatment’s hook introduces', () => {
    const found = referencesIn(TREATMENT_SCHEMA, {
      id: 'treatment-1',
      lore: [],
      cast: [],
      hooks: [introducingHook('actor-keeper')],
    });
    expect(found).toEqual(['actor-keeper']);
  });

  it('reads both on a setup, whose hooks are additional to the treatment’s', () => {
    const found = referencesIn(SETUP_SCHEMA, {
      id: 'setup-1',
      cast: { personaOptions: [], partyDefault: [], narrator: null },
      lore: [],
      hooks: [involvingHook('actor-vera'), introducingHook('actor-keeper')],
    });
    expect(new Set(found)).toEqual(new Set(['actor-vera', 'actor-keeper']));
  });

  /**
   * ***The arm that used to answer nothing.*** A lorebook returning `[]`
   * outright was right about its entries and wrong about its hooks, and this is
   * the case that makes the difference visible: the same object carries both,
   * and only the hooks' actors come out. The entry and the folder are contents;
   * the actors are links somebody authored.
   */
  it('reads both on a lorebook, and still not its own entries', () => {
    const found = referencesIn(LOREBOOK_SCHEMA, {
      id: 'book-1',
      entries: [{ id: 'entry-1', name: 'The keeper' }],
      folders: [{ id: 'folder-1', name: 'The docks' }],
      hooks: [involvingHook('actor-vera'), introducingHook('actor-keeper')],
    });
    expect(new Set(found)).toEqual(new Set(['actor-vera', 'actor-keeper']));
  });

  /**
   * **A preset keeps the whole of the old argument**, because it has no `hooks`
   * to make an exception for. It is here so that the exception above is a
   * change to one kind rather than to the rule.
   */
  it('finds nothing in a preset', () => {
    expect(
      referencesIn(PRESET_SCHEMA, {
        id: 'preset-1',
        name: 'Default',
        blocks: [{ id: 'block-1', name: 'System' }],
      }),
    ).toEqual([]);
  });

  /**
   * ***Malformed hooks are a rebuild that finishes, not a rebuild that dies.***
   * This index is fed by files people hand-edit, so the question is never
   * whether a bad hook can arrive but what happens when one does: every other
   * reader here answers *nothing, quietly*, and a throw would take a whole
   * rebuild down over one file somebody mistyped.
   */
  it('survives hooks that are absent, or not hooks at all', () => {
    const bare = { id: 'treatment-1', lore: [], cast: [] };
    expect(referencesIn(TREATMENT_SCHEMA, bare)).toEqual([]);
    expect(referencesIn(TREATMENT_SCHEMA, { ...bare, hooks: 'not an array' })).toEqual([]);
    expect(referencesIn(LOREBOOK_SCHEMA, { id: 'book-1', hooks: null })).toEqual([]);
    expect(
      referencesIn(TREATMENT_SCHEMA, {
        ...bare,
        hooks: [
          null,
          'a hook, allegedly',
          { involves: 'not an array' },
          { involves: [null, 42, {}] },
          { introduces: 'not an object' },
          { introduces: {} },
          { introduces: { actor: null } },
        ],
      }),
    ).toEqual([]);
  });
});
