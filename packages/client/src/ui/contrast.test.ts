// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **Every ink token is legible on every surface it is used on, in both themes.**
 *
 * The play surface once put `text-slate-900` on a `bg-neutral-900` input —
 * 1.01 to 1, a box that did nothing visible when typed into — and the token
 * layer exists so that cannot recur. But a token layer moves the failure rather
 * than removing it: the second theme arrived with `--color-ink-faint` set to the
 * *same* value in light and dark, which is 4.76 to 1 on white and **3.74 to 1**
 * on the dark surface. Every placeholder in the app, below the floor, in the
 * theme built to fix contrast.
 *
 * Nothing caught it because contrast had only ever been checked by hand, once,
 * by somebody who had just changed it.
 *
 * **Values come from Tailwind's own `theme.css` rather than being retyped**, so
 * this cannot pass against a palette that has moved underneath it. What is
 * asserted is *our* choice of which ramp step each token points at.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** WCAG AA for body text. Large text may go to 3, and none of these are large. */
const FLOOR = 4.5;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function oklchToRgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const bb = c * Math.sin(h);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = l - 0.0894841775 * a - 1.291485548 * bb;

  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;

  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];

  const encode = (v: number): number => {
    const clamped = Math.min(1, Math.max(0, v));
    return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  };

  return { r: encode(lin[0] ?? 0), g: encode(lin[1] ?? 0), b: encode(lin[2] ?? 0) };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** Tailwind's ramp, read from the package so it cannot drift from the real one. */
function palette(): Map<string, Rgb> {
  const source = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8');
  const found = new Map<string, Rgb>();
  const pattern = /--color-([a-z]+-\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g;
  for (const match of source.matchAll(pattern)) {
    const [, name, l, c, h] = match;
    if (name === undefined) continue;
    found.set(name, oklchToRgb(Number(l) / 100, Number(c), Number(h)));
  }
  found.set('white', { r: 1, g: 1, b: 1 });
  found.set('black', { r: 0, g: 0, b: 0 });
  return found;
}

/**
 * Our tokens, per theme, read out of `index.css`.
 *
 * The three blocks are the three states [05 §1.2] commits to: bare `:root` is
 * light, the `prefers-color-scheme` block is the system default, and the
 * `[data-theme='dark']` block is an explicit choice. The last two must agree,
 * and a token defined in only one of them is the exact shape of the bug this
 * file exists for — so they are read separately and compared.
 */
function tokensByTheme(): { light: Map<string, string>; dark: Map<string, string>[] } {
  const css = readFileSync(join(HERE, '..', 'index.css'), 'utf8');
  const light = new Map<string, string>();
  const dark: Map<string, string>[] = [];

  const assignments = (block: string, into: Map<string, string>): void => {
    for (const match of block.matchAll(
      /--color-([a-z-]+):\s*var\(--color-([a-z]+-\d+|white|black)\)/g,
    )) {
      const [, token, value] = match;
      if (token !== undefined && value !== undefined) into.set(token, value);
    }
  };

  // Everything outside a dark block is the light definition.
  const darkBlocks = [
    ...css.matchAll(/(?:prefers-color-scheme: dark|\[data-theme='dark'\])[^{]*\{/g),
  ];
  let lightSource = css;
  for (const opener of darkBlocks) {
    const start = opener.index + opener[0].length;
    let depth = 1;
    let at = start;
    while (at < css.length && depth > 0) {
      if (css[at] === '{') depth += 1;
      if (css[at] === '}') depth -= 1;
      at += 1;
    }
    const body = css.slice(start, at - 1);
    const block = new Map<string, string>();
    assignments(body, block);
    dark.push(block);
    lightSource = lightSource.replace(body, '');
  }
  assignments(lightSource, light);

  return { light, dark };
}

/** Text token → the surfaces it is actually painted on, from the components. */
const PAIRS: [ink: string, on: string[]][] = [
  ['ink', ['surface', 'canvas', 'surface-muted']],
  ['ink-muted', ['surface', 'canvas', 'surface-muted']],
  ['ink-subtle', ['surface', 'canvas']],
  ['ink-faint', ['surface', 'canvas']],
  // A search hit has to be readable, and it is the one pair where the ink and
  // the surface arrived together rather than one landing on the other.
  ['highlight-ink', ['highlight-surface']],
];

describe('the palette is legible', () => {
  const ramp = palette();
  const { light, dark } = tokensByTheme();

  function resolve(theme: Map<string, string>, token: string): Rgb {
    const step = theme.get(token);
    expect(step, `${token} is not defined in this theme`).toBeDefined();
    const colour = ramp.get(step ?? '');
    expect(colour, `${step ?? '?'} is not a Tailwind colour`).toBeDefined();
    return colour ?? { r: 0, g: 0, b: 0 };
  }

  it('clears 4.5 to 1 in the light theme', () => {
    for (const [ink, surfaces] of PAIRS) {
      for (const surface of surfaces) {
        const measured = ratio(resolve(light, ink), resolve(light, surface));
        expect(measured, `${ink} on ${surface} (light)`).toBeGreaterThanOrEqual(FLOOR);
      }
    }
  });

  it('clears 4.5 to 1 in the dark theme', () => {
    for (const block of dark) {
      for (const [ink, surfaces] of PAIRS) {
        for (const surface of surfaces) {
          const measured = ratio(resolve(block, ink), resolve(block, surface));
          expect(measured, `${ink} on ${surface} (dark)`).toBeGreaterThanOrEqual(FLOOR);
        }
      }
    }
  });

  /**
   * The two dark blocks are one theme written twice — `prefers-color-scheme` for
   * the system default and `[data-theme]` for an explicit choice — and a token
   * that differs between them is a theme that changes when somebody opens the
   * settings page without touching anything.
   */
  it('says the same thing in both dark blocks', () => {
    const [first, second] = dark;
    expect(dark).toHaveLength(2);
    expect(Object.fromEntries(first ?? [])).toEqual(Object.fromEntries(second ?? []));
  });
});
