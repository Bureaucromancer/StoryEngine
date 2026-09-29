// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { renderTemplate } from '../assembly/template.js';
import { convertMacros, KNOWN_MACROS, MACRO_NOTE_LIMIT, macroNoteBudget } from './macros.js';

/**
 * **The closed mapping table [04 §8.4.2] promised and did not contain.**
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
    // [04 §8.4.2]'s rule, and it looks like a bug until the reason is said: a
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

/**
 * ***A template made to be slow is converted in time*** (2026-09-27).
 *
 * The pattern was quadratic: `{{a::` and a quarter of a megabyte of spaces
 * took 26 seconds of synchronous work on the thread every account shares, and
 * a file at the upload limit would have taken weeks. Two seconds is a bound
 * three orders of magnitude above what the pattern now takes, so a slow
 * machine is not what makes this fail.
 */
describe('a template somebody made to be slow', () => {
  const QUARTER_MEGABYTE = 256 * 1024;

  for (const [label, crafted] of [
    ['an argument that never closes', `{{a::${' '.repeat(QUARTER_MEGABYTE)}`],
    ['one opening after another', '{{a::'.repeat(QUARTER_MEGABYTE / 5)],
  ] as const) {
    it(`converts a quarter of a megabyte of ${label} inside two seconds`, () => {
      const started = performance.now();
      const { template } = convertMacros(crafted);
      expect(performance.now() - started).toBeLessThan(2000);
      // Nothing in it is a macro, so nothing changes.
      expect(template).toBe(crafted);
    });
  }

  it('takes a refused macro whole when its argument holds a macro', () => {
    // Ordinary SillyTavern text. The obvious linear pattern stopped at the
    // inner `{{`, never saw `random`, and left `{{random::` for the model.
    const { template, seen } = convertMacros(
      'She {{random::{{char}} smiles::{{user}} frowns}} and waits.',
    );

    expect(template).toBe('She  and waits.');
    expect(seen.get('random')?.kind).toBe('refused');
  });
});

describe('a name every object has', () => {
  it('is not a macro the table knows', () => {
    // A plain index into the table found `Object` for `constructor` and
    // `Object.prototype` for `__proto__`, and the text became `undefined`.
    const { template, seen } = convertMacros('{{constructor}} and {{__proto__}}');

    expect(template).toBe('{{constructor}} and {{__proto__}}');
    expect(seen.get('constructor')).toEqual({ kind: 'unknown' });
    expect(seen.get('__proto__')).toEqual({ kind: 'unknown' });
  });
});

describe('the macros a review names', () => {
  it('are bounded by the budget the conversion is given, and the rest counted', () => {
    const budget = macroNoteBudget();
    const many = Array.from({ length: 10_000 }, (_, at) => `{{made_up_${String(at)}}}`).join(' ');

    const { template, seen } = convertMacros(many, budget);

    expect(seen.size).toBe(MACRO_NOTE_LIMIT);
    expect(budget).toEqual({ left: 0, unlisted: 10_000 - MACRO_NOTE_LIMIT });
    // Converted exactly as before: only the telling stops.
    expect(template).toBe(many);
  });

  it('never spends the budget on a macro that maps', () => {
    const budget = macroNoteBudget();
    convertMacros('{{char}} {{user}} {{bot}}', budget);

    expect(budget).toEqual({ left: MACRO_NOTE_LIMIT, unlisted: 0 });
  });
});

/**
 * ***Read the way SillyTavern binds them*** (2026-09-27) — two corrections the
 * table owed its source.
 */
describe('what SillyTavern means by a name', () => {
  it('takes {{persona}} for the persona’s description, which a slot supplies', () => {
    // SillyTavern binds it to the description; the table put the name there.
    const { template, seen } = convertMacros('Who you are: {{persona}}');

    expect(template).toBe('Who you are: ');
    expect(seen.get('persona')).toEqual({ kind: 'refused', because: 'body-comes-from-a-slot' });
  });

  it('reads the legacy angle forms when a SillyTavern converter asks', () => {
    const { template, seen } = convertMacros('<BOT> greets <user> for <GROUP>.', undefined, {
      angles: true,
    });

    // `<GROUP>` maps since [P13.3]; the two-name context renders it empty, as
    // a name the caller did not pass renders.
    expect(renderTemplate(template, CONTEXT)).toEqual({
      ok: true,
      text: 'Vera Solano greets The Inspector for .',
    });
    expect(seen.get('group')).toEqual({ kind: 'mapped', liquid: '{{ group }}' });
  });

  it('maps the three group names onto the namespace P13.2 gave them', () => {
    // [P13.3]: `{{group}}` was refused, `{{charIfNotGroup}}` approximated as
    // the character alone, and `{{notChar}}` left as braces. Rendered against
    // a group's names, each says what it said in SillyTavern.
    const { template, seen } = convertMacros(
      'Write as {{char}} in a chat with {{charIfNotGroup}}; not for {{notChar}}. Cast: {{group}}.',
    );
    const group = {
      char: 'Vera Solano',
      user: 'The Inspector',
      group: 'Vera Solano, Lund',
      charIfNotGroup: 'Vera Solano, Lund',
      notChar: 'The Inspector, Lund',
    };

    expect(renderTemplate(template, group)).toEqual({
      ok: true,
      text: 'Write as Vera Solano in a chat with Vera Solano, Lund; not for The Inspector, Lund. Cast: Vera Solano, Lund.',
    });
    for (const macro of ['group', 'charifnotgroup', 'notchar']) {
      expect(seen.get(macro)?.kind, macro).toBe('mapped');
    }
  });

  it('leaves angle brackets alone for everyone else, where they may be markup', () => {
    expect(convertMacros('<char>Vera</char>').template).toBe('<char>Vera</char>');
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
