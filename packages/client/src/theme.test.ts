// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The palette, checked as a thing with rules rather than read as decoration.
 *
 * `index.css` is the only file in the client allowed to name a Tailwind colour
 * scale — everything else spends semantic tokens, and ESLint makes that a build
 * error. What ESLint cannot check is the stylesheet itself, because it is CSS.
 * These are the claims that would otherwise be nobody's job.
 *
 * The one that earns its keep is the last: the dark theme is written twice, once
 * for the media query and once for the attribute, because CSS cannot hand one
 * declaration block to two selectors across a media boundary. A token updated in
 * one copy and not the other is a single wrong colour on whichever surfaces use
 * it, for whichever half of users chose their theme the other way — the kind of
 * defect that is found by a person rather than by anything else here.
 */

const CSS = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');
const SHELL = readFileSync(fileURLToPath(new URL('./Shell.tsx', import.meta.url)), 'utf8');

/** The declarations inside one brace-balanced block, as name → value. */
function tokensIn(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1]!, match[2]!.trim());
  }
  return found;
}

/** From `start` to the brace that closes the block it opens. */
function blockAt(start: number): string {
  const open = CSS.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced braces in index.css');
}

const light = tokensIn(blockAt(CSS.indexOf('@theme')));
const darkByAttribute = tokensIn(blockAt(CSS.indexOf(":root[data-theme='dark']")));
const darkByPreference = tokensIn(blockAt(CSS.indexOf('@media (prefers-color-scheme: dark)')));

const colours = (tokens: Map<string, string>) =>
  new Map([...tokens].filter(([name]) => name.startsWith('--color-')));

describe('the theme', () => {
  it('states the light palette by aliasing Tailwind rather than by re-typing it', () => {
    // This is what made the migration on to these tokens provably non-visual: a
    // rename cannot change a colour if the token *is* the old colour. A literal
    // here gives that up quietly, so it is refused rather than reviewed.
    const literals = [...colours(light)].filter(
      ([, value]) => !value.startsWith('var(--color-') && !value.startsWith('color-mix('),
    );
    expect(literals).toEqual([]);
  });

  it('gives every light colour a dark counterpart', () => {
    // A token defined in one theme and not the other keeps its light value on a
    // dark page, which is the exact shape of the defect this palette replaced.
    const unpaired = [...colours(light).keys()].filter((name) => !darkByAttribute.has(name));
    expect(unpaired).toEqual([]);
  });

  it('keeps the two copies of the dark theme identical', () => {
    expect(Object.fromEntries(colours(darkByPreference))).toEqual(
      Object.fromEntries(colours(darkByAttribute)),
    );
  });

  it('declares a colour-scheme for each theme', () => {
    // Without it the browser renders the caret, scrollbars and native select
    // popups for the wrong theme — form chrome CSS does not reach, and the
    // reason an input can look right and still be unusable.
    expect(CSS).toMatch(/:root\s*\{[^}]*color-scheme:\s*light/);
    expect(darkByAttribute.size + darkByPreference.size).toBeGreaterThan(0);
    expect(blockAt(CSS.indexOf(":root[data-theme='dark']"))).toMatch(/color-scheme:\s*dark/);
    expect(blockAt(CSS.indexOf('@media (prefers-color-scheme: dark)'))).toMatch(
      /color-scheme:\s*dark/,
    );
  });
});

/**
 * ***That the story prints at all*** — [10 §12.2], [P11.1], and manual row R2.
 *
 * §12.2 makes the browser's own print-to-PDF the **entire** PDF story, which is
 * the reason this project ships no PDF renderer. That makes the print
 * stylesheet a feature rather than a courtesy, and it was broken from the day
 * the shell became height-managed: `<main>` is the scroll container rather than
 * the document ([P3.−1]), and a box with a definite block-size and
 * `overflow: auto` prints as its first page and nothing after it. A forty-turn
 * story printed as whatever happened to be on screen.
 *
 * **Nothing caught it because nobody had printed.** Row R2 — *"then print it
 * through the browser and look at the PDF"* — has sat with an empty result cell
 * since P11.1. This is that row's cheap half: jsdom computes no layout, so the
 * clipping itself still needs a person, but *the release being present at all*
 * is mechanical and is what would go missing again.
 *
 * It spans two files on purpose, and the assertions follow the same split:
 * `main`'s printed geometry belongs beside its printed width in the stylesheet,
 * and the two ancestors are known only to the shell, which releases them at the
 * call site as position always is here.
 */
describe('printing', () => {
  const print = blockAt(CSS.indexOf('@media print'));

  it('releases the scrollport, so more than the first page is printed', () => {
    const main = print.slice(print.indexOf('main'));
    expect(main).toMatch(/overflow:\s*visible/);
    expect(main).toMatch(/block-size:\s*auto/);
  });

  it('releases the height-managed column the scrollport sits in', () => {
    // Without these the stylesheet above frees `main` inside a parent that is
    // still exactly one viewport tall, which prints the same single page by a
    // different route — so the two halves are asserted together or neither is
    // worth asserting.
    expect(SHELL).toMatch(/h-dvh[^"]*print:h-auto/);
    expect(SHELL).toMatch(/overflow-y-auto[^"]*print:overflow-visible/);
  });

  it('leaves the docks and the banners off the page', () => {
    // By landmark, like every other entry in this list, so a restyle cannot
    // quietly put the workbench back on the printed story.
    expect(print).toMatch(/(^|,)\s*aside\s*(,|\{)/m);
    expect(SHELL).toMatch(/bg-warn-surface[^"]*print:hidden/);
  });
});

/**
 * ***A control nobody can reveal is a control that is not there*** — [10 §1].
 *
 * Tailwind compiles `hover:` to `@media (hover: hover)`. A row held at
 * `opacity-0` until `group-hover` fires is therefore **permanently invisible**
 * on a device with no pointer, while staying in the tab order and swallowing
 * taps. Two rows in this client were written that way, and between them they
 * are every per-turn gesture on the play surface — Redo, Reroll, Continue from
 * here, Illustrate, Remember this, Undo — and the lorebook's entry reordering.
 *
 * `ui/classes.ts` owns the recipe now, with the `(hover: none)` arm in it. This
 * is the rule that keeps the *next* one from being written without it: the
 * mistake is invisible on every machine a developer owns, so it cannot be left
 * to review. A file that genuinely wants a fade of its own may have it — by
 * adding a second named recipe here, which is a decision rather than a default.
 */
describe('controls that hide until you look at them', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url));

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      return [path];
    });
  }

  it('reaches a device that cannot hover', () => {
    const recipe = readFileSync(join(ROOT, 'ui/classes.ts'), 'utf8');
    expect(recipe).toMatch(/export const reveal\b/);
    expect(recipe).toMatch(/\[@media\(hover:none\)\]:opacity-100/);
  });

  it('is spelled in one place, so the media query cannot be left out of the next one', () => {
    const offenders = sources(ROOT)
      .filter((path) => !path.endsWith(join('ui', 'classes.ts')))
      .filter((path) => /(?:^|\s|`)opacity-0(?:\s|`|")/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(ROOT.length));
    expect(offenders).toEqual([]);
  });
});
