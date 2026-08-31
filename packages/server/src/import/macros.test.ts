// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { renderTemplate } from '../assembly/template.js';
import { convertMacros, KNOWN_MACROS } from './macros.js';

/**
 * **The closed mapping table [10 §8.4.2] promised and did not contain.**
 *
 * Three outcomes, and the tests are mostly about keeping them three: mapped,
 * refused-with-a-reason, unrecognised. Collapsing refused into unrecognised
 * would leave literal braces in a prompt; collapsing it into mapped would
 * invent an answer. Both are worse than saying which it was.
 */

const CONTEXT = { char: 'Vera Solano', user: 'The Inspector' };

describe('converting SillyTavern macros', () => {
  it('maps the participants, and the result renders', () => {
    // The pair that matters, end to end: conversion produces Liquid, and the
    // renderer built beside it turns that Liquid into the name. Testing the
    // conversion alone would prove the table and not the promise.
    const { template } = convertMacros('You are {{char}}, talking to {{user}}.');

    expect(renderTemplate(template, CONTEXT)).toEqual({
      ok: true,
      text: 'You are Vera Solano, talking to The Inspector.',
    });
  });

  it('is case-insensitive and tolerates inner spaces, because ST is', () => {
    const { template } = convertMacros('{{Char}} and {{ USER }}');

    expect(renderTemplate(template, CONTEXT)).toEqual({
      ok: true,
      text: 'Vera Solano and The Inspector',
    });
  });

  it('leaves an unrecognised macro exactly as it was', () => {
    // [10 §8.4.2]'s rule, and it looks like a bug until the reason is said: a
    // mangled prompt that looks fine is worse than one that visibly needs a
    // look. The review carries the flag; the file carries the evidence.
    const { template, seen } = convertMacros('Roll for {{fictitious_macro}} now.');

    expect(template).toBe('Roll for {{fictitious_macro}} now.');
    expect(seen.get('fictitious_macro')).toEqual({ kind: 'unknown' });
  });

  it('removes a macro that names a body, and says why', () => {
    // `{{description}}` is what a slot block supplies. Leaving it would put
    // braces in the prompt; mapping it would make the template a second
    // assembler.
    const { template, seen } = convertMacros('Here she is: {{description}}');

    expect(template).toBe('Here she is: ');
    expect(seen.get('description')).toEqual({
      kind: 'refused',
      because: 'body-comes-from-a-slot',
    });
  });

  it('refuses the draws and the clocks for the reasons the engine already has', () => {
    // Not squeamishness: every draw comes from the RNG service and is recorded,
    // or replay and branching break silently — and a prompt that differs
    // between two renders of one turn is one the record cannot reproduce.
    const { seen } = convertMacros('{{roll}} {{random::a::b}} {{time}} {{date}}');

    expect(seen.get('roll')?.kind).toBe('refused');
    expect(seen.get('random')?.kind).toBe('refused');
    expect(seen.get('time')).toEqual({ kind: 'refused', because: 'time-is-not-reproducible' });
    expect(seen.get('date')).toEqual({ kind: 'refused', because: 'time-is-not-reproducible' });
  });

  it('reports each distinct macro once, however many times it appears', () => {
    // The review lists what a preset uses, not how often — a note per
    // occurrence would bury the one that matters under forty of the same.
    const { seen } = convertMacros('{{char}} {{char}} {{char}}');

    expect([...seen.keys()]).toEqual(['char']);
  });

  it('leaves text that merely looks like a macro alone', () => {
    // Braces occur in authored prose, in JSON examples, and in Liquid the
    // author may already have written. A pattern that ate those would corrupt
    // prose to fix prose.
    const original = 'Use {{ }} sparingly, and {%- raw -%} is not a macro.';

    expect(convertMacros(original).template).toBe(original);
  });
});

describe('the table stays closed', () => {
  it('produces no literal braces for anything it claims to know', () => {
    // The property behind gate step 5: **no literal `{{` from the closed
    // table's set reaches a rendered message.** Every known macro either
    // renders to a value or is removed — never left as braces.
    for (const macro of KNOWN_MACROS) {
      const { template } = convertMacros(`before {{${macro}}} after`);
      const rendered = renderTemplate(template, CONTEXT);

      expect(rendered.ok, `${macro} failed to render`).toBe(true);
      if (!rendered.ok) continue;
      expect(rendered.text, `${macro} left braces behind`).not.toContain('{{');
    }
  });

  it('covers the macros the fixture preset and cards actually use', () => {
    // A table that is closed over nothing real is closed over nothing. These
    // are the ones the synthesised corpus contains, so the corpus and the table
    // cannot drift apart silently.
    for (const macro of ['char', 'user']) {
      expect(KNOWN_MACROS, `${macro} is not in the table`).toContain(macro);
    }
  });
});
