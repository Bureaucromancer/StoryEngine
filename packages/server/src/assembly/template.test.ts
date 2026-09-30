// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { renderTemplate } from './template.js';

/**
 * **The renderer's whole job, and the fence around it** ([P4 §1.6]).
 *
 * A block's template is Liquid over a closed namespace of names. What these
 * assert is mostly what it may *not* do, because the risk in adding a template
 * language to an assembler is not that it fails to interpolate — it is that it
 * quietly becomes a second assembler.
 */

const CONTEXT = {
  char: 'Vera Solano',
  user: 'The Inspector',
  group: 'Vera Solano, Lund',
  charIfNotGroup: 'Vera Solano, Lund',
  notChar: 'The Inspector, Lund',
};

describe('rendering a block template', () => {
  it('interpolates the participants by name', () => {
    expect(renderTemplate('You are {{ char }}, talking to {{ user }}.', CONTEXT)).toEqual({
      ok: true,
      text: 'You are Vera Solano, talking to The Inspector.',
    });
  });

  it('runs conditionals, which is what charIfNotGroup converts into', () => {
    // [04 §8.4.2] names this specifically: those macros become Liquid
    // conditionals rather than being dropped.
    const template = '{% if char == "Vera Solano" %}She knows the docks.{% endif %}';

    expect(renderTemplate(template, CONTEXT)).toEqual({ ok: true, text: 'She knows the docks.' });
  });

  it('leaves prose with no interpolation exactly alone', () => {
    // The overwhelmingly common case — most authored prose is prose — and it
    // must not round-trip through an engine that could normalise whitespace.
    const prose = 'Write what happens next.\n\n  Keep the rain in frame.\t';

    expect(renderTemplate(prose, CONTEXT)).toEqual({ ok: true, text: prose });
  });

  it('renders an unknown variable as nothing, leaving the rest of the prose intact', () => {
    // Strict mode would blank a block that was otherwise fine over one unknown
    // name. The flag belongs in the review, at conversion time, when the
    // macro's name is still known.
    expect(renderTemplate('Before {{ nothing }} after.', CONTEXT)).toEqual({
      ok: true,
      text: 'Before  after.',
    });
  });

  it('hands back the source when a template will not compile, rather than throwing', () => {
    // A preset is somebody else's authored file. One bad block must not take
    // the turn down with it, and literal braces in the prompt are the visible
    // failure [04 §8.4.2] prefers to a mangled one that looks fine.
    const broken = 'Before {% if %} after';
    const result = renderTemplate(broken, CONTEXT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.source).toBe(broken);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('cannot see anything but the namespace, however it is asked', () => {
    // The fence, tested from the outside: a template that could reach a
    // section body, the environment, or the object graph would be a second
    // assembler reached sideways.
    for (const probe of [
      '{{ process }}',
      '{{ process.env.PATH }}',
      '{{ constructor }}',
      '{{ char.constructor }}',
      '{{ __proto__ }}',
      '{{ globalThis }}',
    ]) {
      const result = renderTemplate(`[${probe}]`, CONTEXT);

      expect(result.ok, `${probe} threw`).toBe(true);
      if (!result.ok) continue;
      expect(result.text, `${probe} resolved to something`).toBe('[]');
    }
  });

  it('does not let one template leak into the next', () => {
    // Liquid has assignment, and a block-scoped renderer that shared state
    // between blocks would be rendering *across* blocks by another route.
    renderTemplate('{% assign char = "somebody else" %}', CONTEXT);

    expect(renderTemplate('{{ char }}', CONTEXT)).toEqual({ ok: true, text: 'Vera Solano' });
  });

  it('renders the same input the same way twice, which the record depends on', () => {
    const template = 'You are {{ char }}.';

    expect(renderTemplate(template, CONTEXT)).toEqual(renderTemplate(template, CONTEXT));
  });
});

/**
 * ***A template cannot take the server with it*** (2026-09-27).
 *
 * liquidjs defaults its limits to infinity, and a preset is somebody else's
 * file: `{% for i in (1..1000000000) %}` in one text block built a
 * billion-element array on the event loop, and V8 aborted the process for
 * every account. What the budget refuses has to be shown with something the
 * engine without one would finish quickly, or the test measures the time
 * limit instead: a string that doubles itself twenty-one times is two million
 * characters, built in milliseconds, and well past the budget.
 */
describe('a template past its limits', () => {
  it('is refused rather than run when it would build too much', () => {
    const doubling =
      '{% assign s = "x" %}{% for i in (1..21) %}{% assign s = s | append: s %}{% endfor %}{{ s | size }}';
    expect(renderTemplate(doubling, CONTEXT).ok).toBe(false);
  });

  it('cannot read a file from the working directory', () => {
    // It resolved `include` against the process's own directory, which holds
    // this repository's `package.json` when the suite runs.
    const result = renderTemplate('{% include "package.json" %}', CONTEXT);
    expect(result.ok).toBe(false);
  });
});
