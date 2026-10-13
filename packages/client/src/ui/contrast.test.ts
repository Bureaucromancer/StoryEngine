// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { TAG_SWATCH_STYLES } from './tag-colors.js';

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
 * What a colour token resolves to: the ramp step it names, and how much of it
 * is there. Every token but a few is a plain alias, `alpha` 1; the overlay,
 * the shadow and the veil are a step thinned toward transparent.
 */
interface Colour {
  step: string;
  alpha: number;
}

/**
 * Our tokens, per theme, read out of `index.css`.
 *
 * The three blocks are the three states [10 §1.2] commits to: bare `:root` is
 * light, the `prefers-color-scheme` block is the system default, and the
 * `[data-theme='dark']` block is an explicit choice. The last two must agree,
 * and a token defined in only one of them is the exact shape of the bug this
 * file exists for — so they are read separately and compared.
 *
 * ***Two spellings are read, not one*** (2026-10-13, P12A.0). It read only
 * `var(--color-<step>)`, which made a `color-mix()` token invisible rather than
 * a failure — the overlay was never so much as read, and the backdrop's veil,
 * whose whole purpose is a contrast floor, could not have been measured. It reads
 * `color-mix(in oklab, var(--color-<step>) N%, transparent)` as well now, which
 * is a step at an opacity: mixing with `transparent` in a premultiplied space
 * keeps the colour and scales its alpha. **And `reads every colour` below
 * fails on any third spelling**, so the next token this cannot read is a
 * failure here rather than a colour nobody measures. Comments are blanked
 * before either is read, so a declaration quoted in prose is not a token.
 */
function tokensByTheme(): {
  light: Map<string, Colour>;
  dark: Map<string, Colour>[];
  /** How many colours each block declares, light first, read or not. */
  declared: number[];
} {
  const css = readFileSync(join(HERE, '..', 'index.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    (comment) => comment.replace(/[^\n]/g, ' '),
  );
  const light = new Map<string, Colour>();
  const dark: Map<string, Colour>[] = [];
  const declared: number[] = [];

  const assignments = (block: string, into: Map<string, Colour>): void => {
    for (const match of block.matchAll(
      /--color-([a-z-]+):\s*var\(--color-([a-z]+-\d+|white|black)\)/g,
    )) {
      const [, token, step] = match;
      if (token !== undefined && step !== undefined) into.set(token, { step, alpha: 1 });
    }
    for (const match of block.matchAll(
      /--color-([a-z-]+):\s*color-mix\(in oklab, var\(--color-([a-z]+-\d+|white|black)\) ([\d.]+)%, transparent\)/g,
    )) {
      const [, token, step, percent] = match;
      if (token !== undefined && step !== undefined) {
        into.set(token, { step, alpha: Number(percent) / 100 });
      }
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
    const block = new Map<string, Colour>();
    assignments(body, block);
    declared.push([...body.matchAll(/--color-([a-z-]+)\s*:/g)].length);
    dark.push(block);
    lightSource = lightSource.replace(body, '');
  }
  assignments(lightSource, light);
  declared.unshift([...lightSource.matchAll(/--color-([a-z-]+)\s*:/g)].length);

  return { light, dark, declared };
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
  // Every primary button's label, at rest and under the pointer. Not asserted
  // while the accent was slate-800 — white on near-black could not miss — and
  // the first thing a hue can get wrong (2026-10-01).
  ['on-accent', ['accent', 'accent-hover']],
  /**
   * Every tag swatch, in both themes — [05 §4](../../../../docs/design/05-tagging.md).
   *
   * **Spread from the style record rather than listed**, so a ninth swatch is
   * measured because it exists rather than because somebody remembered to add
   * a row here. That is the whole reason the record carries its tokens: the
   * thing that draws the chip and the thing that measures it read one source.
   *
   * This is also what makes the curated palette worth choosing over a colour
   * picker. A picker cannot be held to a floor; eight pairs can, from the day
   * they land and every time anybody re-tunes them.
   */
  ...Object.values(TAG_SWATCH_STYLES).map((style): [string, string[]] => [
    style.inkToken,
    [style.surfaceToken],
  ]),
];

/**
 * ***What is drawn rather than written*** — WCAG 1.4.11, 3 to 1 against what
 * it sits on (2026-10-01).
 *
 * The keyboard's ring is the one mark that has to be found on every surface
 * there is, and the accent is drawn as a mark as well as a fill: a selected
 * tag's outline, an active toggle's border, the lorebook's drop line. While
 * both were slate they were checked by nobody, and a hue is exactly where a
 * ring stops being visible — indigo-300 on white is 2 to 1.
 */
const GRAPHIC_FLOOR = 3;
const GRAPHICS: [mark: string, on: string[]][] = [
  ['focus', ['surface', 'canvas', 'surface-muted']],
  ['accent', ['surface', 'canvas', 'surface-muted']],
];

/**
 * ***Over a picture*** (2026-10-13) — [P12A.0], for P12A.2's backdrop and
 * [10 §2.3]'s *the prose wins, always*.
 *
 * The veil is the canvas at an opacity, and what shows through it is whatever
 * the picture holds — so these pairs are measured over the worst pixel a
 * picture can put there rather than over a surface. The browser composites in
 * gamma-encoded sRGB, channel by channel, which is what `over` does; the
 * composite's luminance rises with every channel of the pixel underneath, so
 * across every possible picture it runs exactly from the veil over **black**
 * to the veil over **white**. If the ink lies outside that span, the nearer
 * end is the worst case there is, and measuring both ends measures every
 * picture. Those are the two assertions below, and why the first is not
 * decoration: an ink inside the span has some pixel that matches it.
 *
 * `ink-subtle` is here because it is the quietest ink a turn is set in — the
 * player's own line — and it is what the veil's opacity was worked out for.
 * `ink-faint` is not, and cannot be: in light it needs the veil at 99.5%.
 */
const OVER_A_PICTURE: [ink: string, veil: string][] = [
  ['ink', 'veil'],
  ['ink-muted', 'veil'],
  ['ink-subtle', 'veil'],
];
const WORST_PIXELS: [name: string, pixel: Rgb][] = [
  ['black', { r: 0, g: 0, b: 0 }],
  ['white', { r: 1, g: 1, b: 1 }],
];

describe('the palette is legible', () => {
  const ramp = palette();
  const { light, dark, declared } = tokensByTheme();
  const themes = [['light', light], ...dark.map((block) => ['dark', block] as const)] as const;

  function step(theme: Map<string, Colour>, token: string): Rgb {
    const colour = theme.get(token);
    expect(colour, `${token} is not defined in this theme`).toBeDefined();
    const rgb = ramp.get(colour?.step ?? '');
    expect(rgb, `${colour?.step ?? '?'} is not a Tailwind colour`).toBeDefined();
    return rgb ?? { r: 0, g: 0, b: 0 };
  }

  /** An opaque token. A translucent one has no colour until it is over something. */
  function resolve(theme: Map<string, Colour>, token: string): Rgb {
    expect(theme.get(token)?.alpha, `${token} is translucent; measure it over a pixel`).toBe(1);
    return step(theme, token);
  }

  /** A translucent token over one pixel, as the browser composites it. */
  function over(theme: Map<string, Colour>, token: string, pixel: Rgb): Rgb {
    const alpha = theme.get(token)?.alpha ?? 1;
    const top = step(theme, token);
    const mix = (a: number, b: number): number => alpha * a + (1 - alpha) * b;
    return { r: mix(top.r, pixel.r), g: mix(top.g, pixel.g), b: mix(top.b, pixel.b) };
  }

  it('reads every colour the stylesheet declares', () => {
    // A token in a spelling this file cannot read is not measured and is not
    // a failure either — which is how the overlay went unread. So the count
    // of what was read is held to the count of what is there.
    expect([light.size, ...dark.map((block) => block.size)]).toEqual(declared);
  });

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

  it('draws its marks at 3 to 1 against every surface, in both themes', () => {
    for (const [theme, blocks] of [
      ['light', [light]],
      ['dark', dark],
    ] as const) {
      for (const block of blocks) {
        for (const [mark, surfaces] of GRAPHICS) {
          for (const surface of surfaces) {
            const measured = ratio(resolve(block, mark), resolve(block, surface));
            expect(measured, `${mark} on ${surface} (${theme})`).toBeGreaterThanOrEqual(
              GRAPHIC_FLOOR,
            );
          }
        }
      }
    }
  });

  it('keeps the prose above 4.5 to 1 over any picture, in both themes', () => {
    for (const [theme, block] of themes) {
      for (const [ink, veil] of OVER_A_PICTURE) {
        const colour = resolve(block, ink);
        const [darkest, lightest] = WORST_PIXELS.map(([, pixel]) => over(block, veil, pixel));
        const [low, high] = [relativeLuminance(darkest!), relativeLuminance(lightest!)];
        const inside = relativeLuminance(colour) > low && relativeLuminance(colour) < high;
        expect(inside, `${ink} matches some picture under the ${veil} (${theme})`).toBe(false);
        for (const [name, pixel] of WORST_PIXELS) {
          const measured = ratio(colour, over(block, veil, pixel));
          expect(measured, `${ink} on ${veil} over ${name} (${theme})`).toBeGreaterThanOrEqual(
            FLOOR,
          );
        }
      }
    }
  });

  it('thins the canvas rather than some other colour', () => {
    // The column's ground is the canvas whether a picture is behind it or
    // not, so a veil of another step would re-tint the column when a backdrop
    // arrives. It names the step rather than `var(--color-canvas)` because
    // the build's fallback for `color-mix()` resolves a token inside it
    // against the light theme (index.css says how that was found); this is
    // the guarantee the token name would have given.
    for (const [theme, block] of themes) {
      expect(block.get('veil')?.step, `the veil (${theme})`).toBe(block.get('canvas')?.step);
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
