// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { HookRefusal } from '../api.js';
import { hookState, hookWords } from './hookWords.js';

/**
 * A class to a sentence — [06 §6.1], [10 §10.1], [P7.5].
 *
 * **The claim under test is that each arm earns its place**, which is the test
 * [06 §6.1] sets for the vocabulary itself: *"each arm is a different remedy"*.
 * Two classes that produced the same sentence would be one class with a spare
 * name, and the place that shows is here.
 */

const EVERY: HookRefusal[] = [
  'fired',
  'pending',
  'book-inactive',
  'blocked',
  'too-early',
  'cast-gone',
  'subject-gone',
  'subject-met',
  'subject-unavailable',
  'malformed',
];

describe('saying why a hook is held back', () => {
  it('gives every class its own sentence', () => {
    const said = EVERY.map((refusal) => hookWords(refusal));

    expect(new Set(said).size).toBe(EVERY.length);
    // And none of them is the fallback, which is what would happen to an arm
    // added to the wire vocabulary and not to this one.
    expect(said).not.toContain(hookWords('a class from a newer server'));
  });

  /**
   * **The arms that are authoring errors rather than states** — [04 §6.1a]
   * makes a dangling `introduces.actor` *"a broken hook, not a retired one…
   * ineligible with a visible reason, and the author is told"*, and since
   * 2026-09-27 a hook the schema refuses is the second. So their sentences say
   * *broken*, where every other one says some form of *waiting*: the remedy is
   * to fix the hook, not to play on.
   */
  it('says broken for the two that are authoring errors, and only those', () => {
    const broken: HookRefusal[] = ['subject-gone', 'malformed'];
    for (const refusal of broken) expect(hookWords(refusal), refusal).toMatch(/^Broken/);
    for (const refusal of EVERY.filter((one) => !broken.includes(one))) {
      expect(hookWords(refusal), refusal).not.toMatch(/^Broken/);
    }
  });

  it('answers a class it does not know rather than throwing', () => {
    // A client one deploy behind a server is the ordinary shape of this, and
    // *the engine is holding it back and this build cannot say why* is still
    // information — where an empty row would read as *eligible*.
    expect(hookWords('moon-phase')).toContain('does not recognise');
  });
});

describe('what a row is badged', () => {
  it('marks only the three states that have a story attached', () => {
    expect(hookState({ state: 'fired' })).toBe('Fired');
    expect(hookState({ state: 'provisional' })).toBe('Firing');
    expect(hookState({ state: 'committed' })).toBe('Committed');
    // The pool is mostly hooks that have not fired, and a badge on every row is
    // a badge that says nothing.
    expect(hookState({ state: null })).toBeNull();
  });
});
