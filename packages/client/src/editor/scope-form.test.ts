// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  actorIdsOf,
  pickableIds,
  scopeChoiceOf,
  scopeChoicesFor,
  scopeFor,
  withScopeIds,
} from './scope-form.js';

/**
 * ***What the scope control writes, and what it refuses to rewrite*** —
 * [P16.2](../../../../docs/design/workplan/35-p16-world.md),
 * [15 §5.3](../../../../docs/design/15-world.md),
 * [26 B16](../../../../docs/design/26-open-questions.md).
 *
 * The page's tests click the select and read the saved file; these state the
 * rules as data, because the failures worth a build are quiet ones — a scope
 * from a newer build replaced by a default, a list of ids that no longer
 * resolve thinned out, typed text stored as an id.
 */

describe('which option a scope reads as', () => {
  it('reads each arm, and tells characters from nobody inside `linked`', () => {
    expect(scopeChoiceOf({ kind: 'linked', actorIds: [] })).toBe('nobody');
    expect(scopeChoiceOf({ kind: 'linked', actorIds: ['a1'] })).toBe('actors');
    expect(scopeChoiceOf({ kind: 'world', worldIds: [] })).toBe('worlds');
    expect(scopeChoiceOf({ kind: 'world', worldIds: ['w1'] })).toBe('worlds');
    expect(scopeChoiceOf({ kind: 'global' })).toBe('global');
    expect(scopeChoiceOf({ kind: 'campaign', campaignIds: ['c'] })).toBe('unknown');
  });

  /**
   * A scope nothing can read reads as what it does — *not tied to anything* —
   * and is not offered as something to keep, which would be offering to keep a
   * broken value.
   */
  it('reads a scope with no readable kind, or no readable list, as tied to nothing', () => {
    expect(scopeChoiceOf(undefined)).toBe('nobody');
    expect(scopeChoiceOf('global')).toBe('nobody');
    expect(scopeChoiceOf({ kind: 7 })).toBe('nobody');
    expect(scopeChoiceOf({ kind: 'linked', actorIds: 'a1' })).toBe('nobody');
    expect(actorIdsOf({ kind: 'linked', actorIds: ['a1', 2, null] })).toEqual(['a1']);
  });
});

describe('what a choice writes', () => {
  it('writes each arm, empty, when the saved book said something else', () => {
    const saved = { kind: 'linked', actorIds: [] };
    expect(scopeFor('nobody', saved)).toEqual({ kind: 'linked', actorIds: [] });
    expect(scopeFor('actors', saved)).toEqual({ kind: 'linked', actorIds: [] });
    expect(scopeFor('worlds', saved)).toEqual({ kind: 'world', worldIds: [] });
    expect(scopeFor('global', saved)).toEqual({ kind: 'global' });
  });

  /**
   * ***Switching away and back is not a loss.*** The file's own value comes
   * back — its list, and anything a newer build put beside it ([04 §2]).
   */
  it('puts back what the saved book said when that is the choice made', () => {
    const characters = { kind: 'linked', actorIds: ['a1', 'gone'] };
    expect(scopeFor('actors', characters)).toEqual(characters);
    const worlds = { kind: 'world', worldIds: ['w1'], since: 'a newer build' };
    expect(scopeFor('worlds', worlds)).toEqual(worlds);
    expect(scopeFor('worlds', worlds)).not.toBe(worlds);
  });

  /**
   * ***[26 B16]: open the unions.*** A scope of a kind this build does not
   * know is kept byte for byte — choosing its option puts the original back —
   * and an older book's `global` likewise, whatever it carries.
   */
  it('keeps an unknown kind, and an older book’s global, exactly as they were', () => {
    const newer = { kind: 'campaign', campaignIds: ['c-1'], note: { deep: true } };
    expect(scopeFor('unknown', newer)).toEqual(newer);
    const older = { kind: 'global', from: 'an importer' };
    expect(scopeFor('global', older)).toEqual(older);
  });

  /** *Not tied to anything* is how an unreadable scope gets repaired, so it never restores one. */
  it('writes the factory default for nobody, whatever the saved book said', () => {
    expect(scopeFor('nobody', undefined)).toEqual({ kind: 'linked', actorIds: [] });
    expect(scopeFor('nobody', { kind: 'linked' })).toEqual({ kind: 'linked', actorIds: [] });
  });

  it('replaces the list inside the arm, keeping what else the arm carries', () => {
    expect(withScopeIds({ kind: 'world', worldIds: ['w1'], since: 'x' }, 'worlds', ['w2'])).toEqual(
      { kind: 'world', worldIds: ['w2'], since: 'x' },
    );
    // From another arm, the list's own arm — nothing of the old one carried over.
    expect(withScopeIds({ kind: 'linked', actorIds: ['a1'] }, 'worlds', ['w1'])).toEqual({
      kind: 'world',
      worldIds: ['w1'],
    });
    expect(withScopeIds({ kind: 'global' }, 'actors', ['a1'])).toEqual({
      kind: 'linked',
      actorIds: ['a1'],
    });
  });
});

describe('which ids a pick may write', () => {
  /**
   * The combobox's box can be typed into; what was typed is a search, never an
   * id. **A held id is never refused**, resolvable or not — dropping it would be
   * the silent repair [15 §3.1]'s *dangles visibly* rules out.
   */
  it('takes an offered id or a held one, and never typed text', () => {
    const offered = new Set(['w1', 'w2']);
    expect(pickableIds(['gone', 'w1'], ['gone'], offered)).toEqual(['gone', 'w1']);
    expect(pickableIds(['gone', 'Rain City'], ['gone'], offered)).toEqual(['gone']);
    expect(pickableIds(['w1', 'w1'], [], offered)).toEqual(['w1']);
  });
});

describe('which options the select offers', () => {
  it('offers the three to pick among, and global or unknown only while the book says one', () => {
    const nobody = { kind: 'linked', actorIds: [] };
    expect(scopeChoicesFor(nobody, nobody)).toEqual(['nobody', 'actors', 'worlds']);
    expect(scopeChoicesFor({ kind: 'global' }, nobody)).toEqual([
      'nobody',
      'actors',
      'worlds',
      'global',
    ]);
    // The draft switched away from a newer kind: still offered, so it can be put back.
    expect(scopeChoicesFor({ kind: 'campaign' }, nobody)).toEqual([
      'nobody',
      'actors',
      'worlds',
      'unknown',
    ]);
  });
});
