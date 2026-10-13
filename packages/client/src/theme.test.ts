// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { page, story } from './ui/classes.js';

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

/**
 * The stylesheet with every comment blanked out, character for character, so
 * an offset into it is an offset into the file.
 *
 * ***Every lookup below reads this rather than the file*** (2026-10-13,
 * P12A.0). They used to find a block by the first occurrence of its opening,
 * and the first `@theme` in `index.css` is in its header comment — *"Plain
 * `@theme`, never `@theme inline`"* — so the light palette was read from
 * whatever followed that comment's next `{`. It was the right block only
 * because no brace happened to sit between the two, and the next header
 * sentence to quote one would have read the wrong block without failing. A
 * declaration quoted in a comment was read as a token for the same reason.
 */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

/**
 * Where the one block that `opening` opens starts — and a loud failure, not a
 * wrong block, when the stylesheet has none of them or more than one.
 */
function only(opening: string): number {
  const at = CODE.indexOf(opening);
  if (at === -1 || CODE.includes(opening, at + 1)) {
    throw new Error(`index.css should open exactly one ${opening.trim()} block`);
  }
  return at;
}

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
  const open = CODE.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < CODE.length; i += 1) {
    if (CODE[i] === '{') depth += 1;
    if (CODE[i] === '}') {
      depth -= 1;
      if (depth === 0) return CODE.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced braces in index.css');
}

const THEME = '@theme {';
const DARK_BY_ATTRIBUTE = ":root[data-theme='dark'] {";
const DARK_BY_PREFERENCE = '@media (prefers-color-scheme: dark) {';
const LESS_MOTION = '@media (prefers-reduced-motion: reduce) {';

const light = tokensIn(blockAt(only(THEME)));
const darkByAttribute = tokensIn(blockAt(only(DARK_BY_ATTRIBUTE)));
const darkByPreference = tokensIn(blockAt(only(DARK_BY_PREFERENCE)));

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
    // Every declaration, not only the colours (2026-10-13, P12A.0). The blocks
    // hold nothing else, and the test below keeps it so — but a step that
    // crept into one copy would be this file's defect wearing another prefix.
    expect(Object.fromEntries(darkByPreference)).toEqual(Object.fromEntries(darkByAttribute));
  });

  it('declares a colour-scheme for each theme', () => {
    // Without it the browser renders the caret, scrollbars and native select
    // popups for the wrong theme — form chrome CSS does not reach, and the
    // reason an input can look right and still be unusable.
    expect(CODE).toMatch(/:root\s*\{[^}]*color-scheme:\s*light/);
    expect(darkByAttribute.size + darkByPreference.size).toBeGreaterThan(0);
    expect(blockAt(only(DARK_BY_ATTRIBUTE))).toMatch(/color-scheme:\s*dark/);
    expect(blockAt(only(DARK_BY_PREFERENCE))).toMatch(/color-scheme:\s*dark/);
  });
});

/**
 * ***The steps that are not colours*** (2026-10-13) — [P12A.0].
 *
 * The colour rules above were the whole of this file because colour was the
 * whole of what `index.css` could say. It names elevation and motion now, and
 * radii that differ, and each of them has a way to be wrong that no colour
 * had: Tailwind writes a shadow's geometry into the utility, so a dark copy of
 * one reaches nothing; it reads durations from a namespace nobody would guess,
 * so a token in the obvious one compiles to no class at all; and a motion
 * token the reduced-motion block does not zero is a motion for someone who
 * asked for none. None of those shows on the machine of whoever wrote it.
 */
describe('the steps that are not colours', () => {
  const declared = (prefix: string): string[] =>
    [...light.keys()].filter((name) => name.startsWith(prefix));

  it('declares each step once in @theme', () => {
    // The maps above keep the last of two declarations and say nothing, so a
    // step pasted twice with two values is read as whichever came second.
    const names = [...blockAt(only(THEME)).matchAll(/(--[a-z0-9-]+)\s*:/g)].map(
      (match) => match[1],
    );
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  it('states a step that is not a colour in @theme alone', () => {
    // The dark theme redefines colours and nothing else, and nothing else in
    // the file redefines a step — but for the reduced-motion block, whose
    // whole job is to zero the motion ones, and which the last test here
    // holds to exactly that.
    const elsewhere = CODE.replace(blockAt(only(THEME)), '').replace(
      blockAt(only(LESS_MOTION)),
      '',
    );
    const steps = [...light.keys()].filter((name) => !name.startsWith('--color-'));
    expect(steps.filter((name) => new RegExp(`${name}\\s*:`).test(elsewhere))).toEqual([]);
    expect(
      [...darkByAttribute.keys(), ...darkByPreference.keys()].filter(
        (name) => !name.startsWith('--color-'),
      ),
    ).toEqual([]);
  });

  it('gives a control, a panel and a picture three different radii', () => {
    // They were one radius under two names, which is the state this guards
    // against drifting back to: a token that equals its neighbour is a name
    // with nothing behind it.
    const radii = ['--radius-control', '--radius-panel', '--radius-media'].map((name) =>
      light.get(name),
    );
    expect(radii.every((value) => value !== undefined)).toBe(true);
    expect(new Set(radii).size).toBe(3);
  });

  it('colours every shadow through the one token a theme can reach', () => {
    // A literal colour in a shadow step is a shadow the dark theme cannot
    // touch, because the geometry — colour included — is written into the
    // utility rather than read from this variable.
    const shadows = declared('--shadow-');
    expect(shadows.length).toBeGreaterThanOrEqual(2);
    for (const name of shadows) {
      const layers = (light.get(name) ?? '').split(',');
      for (const layer of layers) {
        expect(layer, `${name} has a layer with no shadow colour`).toMatch(
          /var\(--color-shadow\)\s*$/,
        );
        expect(
          layer.replace('var(--color-shadow)', ''),
          `${name} has a colour of its own`,
        ).not.toMatch(/#|rgb|hsl|lab|lch|color|var\(/);
      }
    }
  });

  it('names motion in the namespaces Tailwind reads', () => {
    // `duration-*` resolves `--transition-duration-*` and `delay-*`
    // `--transition-delay-*`; a token spelled in the obvious namespace
    // compiles to nothing, and the class that names it to no class.
    expect(declared('--duration-')).toEqual([]);
    expect(declared('--delay-')).toEqual([]);
    expect(declared('--easing-')).toEqual([]);
    expect(declared('--transition-duration-').length).toBeGreaterThan(0);
    expect(declared('--ease-').length).toBeGreaterThan(0);
  });

  it('stills every motion for someone who has asked for less of it', () => {
    // Exactly the motion tokens @theme declares, so a new one without its
    // line here fails rather than ships — and Tailwind's default duration,
    // which a bare `transition-*` spends and `reveal` is. A duration or a
    // delay goes to zero; an animation goes to `none`, because an infinite
    // one runs for ever at any duration.
    const block = blockAt(only(LESS_MOTION));
    expect(block).toMatch(/^\s*:root\s*\{/);
    const expected = Object.fromEntries([
      ...declared('--transition-duration-').map((name) => [name, '0s']),
      ...declared('--transition-delay-').map((name) => [name, '0s']),
      ...declared('--animate-').map((name) => [name, 'none']),
      ['--default-transition-duration', '0s'],
    ]);
    expect(Object.fromEntries(tokensIn(block))).toEqual(expected);
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
  const print = blockAt(only('@media print {'));

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

/**
 * Source with its comments gone — block comments and whole-line `//` ones —
 * so a class named in a sentence about classes is not read as one spent.
 *
 * *Hoisted, with `literals` below, out of the radius scan* (2026-10-13,
 * [P12A.1]), because the story recipe's scan reads string literals the same
 * way and a second lexer would be a second answer to one question.
 */
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

/**
 * Every string literal's text. A template literal's `${…}` holes are read
 * as code, so the `'a'` inside one is a literal of its own and the
 * template's text is what is left around it — which is how `${reveal} flex`
 * is read as ` flex`. A quoted string stops at a line's end, so the
 * apostrophe in a line of JSX prose cannot swallow the file after it.
 */
function literals(source: string): string[] {
  const found: string[] = [];
  let at = 0;
  const code = (inHole: boolean): void => {
    let depth = 0;
    while (at < source.length) {
      const char = source[at];
      if (char === "'" || char === '"') {
        quoted(char);
        continue;
      }
      if (char === '`') {
        template();
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') {
        if (inHole && depth === 0) {
          at += 1;
          return;
        }
        depth -= 1;
      }
      at += 1;
    }
  };
  const quoted = (quote: string): void => {
    let text = '';
    at += 1;
    while (at < source.length && source[at] !== quote && source[at] !== '\n') {
      if (source[at] === '\\') at += 1;
      text += source[at] ?? '';
      at += 1;
    }
    at += 1;
    found.push(text);
  };
  const template = (): void => {
    let text = '';
    at += 1;
    while (at < source.length && source[at] !== '`') {
      if (source[at] === '$' && source[at + 1] === '{') {
        at += 2;
        text += ' ';
        code(true);
        continue;
      }
      if (source[at] === '\\') at += 1;
      text += source[at] ?? '';
      at += 1;
    }
    at += 1;
    found.push(text);
  };
  code(false);
  return found;
}

/**
 * The utility a class names, without its variants, its `!` or its sign.
 *
 * *Hoisted out of the radius scan* (2026-10-13, [P12A.1], after review),
 * because the story recipe's scan reads a class the same way: a step or a
 * face written under a breakpoint, a state or a `!` is still that step or
 * that face, and a scan that matched the bare name alone let one through.
 */
function utilityOf(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i += 1) {
    const char = token[i];
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    else if (char === ':' && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!|!$/g, '').replace(/^-/, '');
}

/**
 * ***Radius, elevation and motion are spent by name*** (2026-10-13) — [P12A.0].
 *
 * The palette rule's other half. ESLint refuses a palette scale because a
 * colour that is not a token stays light when the app goes dark; a radius,
 * a shadow or a motion that is not a token fails the same way one step
 * removed. **Tailwind's medium radius**, written raw twenty-one times, was
 * the shape of a control and of a panel at once — right only while the two
 * were one value, and matching neither the moment they differ. **Its large
 * shadow** carries Tailwind's own colour, which no theme reaches. And **a
 * duration written as a number** is written into the utility as that number,
 * so the reduced-motion block in `index.css` cannot zero it: a motion for
 * someone who asked for none.
 *
 * *The class names are spelled out nowhere in this comment, on purpose*:
 * Tailwind reads candidates out of every source file in the client, this one
 * and its comments included, and a comment naming a class keeps that utility
 * in the built stylesheet after the last element using it has gone.
 *
 * So a radius class names a radius token, or is a circle — `rounded-full` is
 * a shape, not a size — or `none`; a shadow class names an elevation, or
 * `none`; and **motion is written only in `ui/classes.ts`**, as a recipe,
 * where each `duration-*`, `ease-*`, `delay-*` and `animate-*` must name a
 * token `@theme` declares. `transition-*` names which properties move, not
 * how, and spends the default duration the reduced-motion block zeroes, so a
 * recipe may say it — and only a recipe, so that each motion is one decision
 * with one name, as [10 §1.3] asks.
 *
 * A source scan rather than an ESLint rule because this is where the
 * stylesheet's own rules are already read, and the allowed names come from
 * the stylesheet: a token added to `@theme` is spendable the moment it exists.
 * **It reads string literals only** — quoted strings whole, and a template
 * literal's text between its holes — after comments are stripped, because
 * half a dozen comments in the client say *transition*. The bare words `rounded`,
 * `shadow` and `transition` are classes only beside other classes, so they
 * count only in a literal that reads as a class list: no capital letter, and
 * a token with a hyphen or a variant's colon in it.
 */
describe('radius, elevation and motion are spent by name', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url));
  const RECIPES = join('ui', 'classes.ts');

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      return [path];
    });
  }

  /** What `--<namespace>-<name>` tokens in @theme let a class say. */
  const names = (namespace: string): Set<string> =>
    new Set(
      [...light.keys()]
        .filter((name) => name.startsWith(`--${namespace}-`))
        .map((name) => name.slice(namespace.length + 3)),
    );
  const RADII = new Set([...names('radius'), 'full', 'none']);
  const SHADOWS = new Set([...names('shadow'), 'none']);
  const MOTION: Record<string, Set<string>> = {
    duration: names('transition-duration'),
    delay: names('transition-delay'),
    ease: names('ease'),
    animate: names('animate'),
  };

  /** Why a class may not be written where it is, or `null` when it may. */
  function refusal(utility: string, inRecipes: boolean): string | null {
    const radius = /^rounded(?:-(?:s|e|t|r|b|l|ss|se|es|ee|tl|tr|br|bl|x|y))?(?:-(.+))?$/.exec(
      utility,
    );
    if (radius !== null) {
      return RADII.has(radius[1] ?? '') ? null : 'a radius by size, not by what it rounds';
    }
    const shadow = /^(inset-|drop-|text-)?shadow(?:-(.+))?$/.exec(utility);
    if (shadow !== null) {
      return shadow[1] === undefined && SHADOWS.has(shadow[2] ?? '')
        ? null
        : 'a shadow that is not an elevation';
    }
    const motion = /^(?:transition(?:-.+)?|(duration|delay|ease|animate)-(.+))$/.exec(utility);
    if (motion !== null) {
      if (!inRecipes) return 'motion outside the recipes in ui/classes.ts';
      const [, kind, name] = motion;
      if (kind === undefined || name === undefined) return null;
      return MOTION[kind]?.has(name) === true ? null : 'a motion that names no token';
    }
    return null;
  }

  /** A literal that reads as a class list rather than as a sentence. */
  const classList = (text: string): boolean =>
    !/[A-Z]/.test(text) && text.split(/\s+/).some((token) => /^[!-]?[a-z[@][^\s]*[-:]/.test(token));

  const scanned = sources(ROOT).flatMap((path) => {
    const inRecipes = path.endsWith(RECIPES);
    return literals(strip(readFileSync(path, 'utf8'))).flatMap((text) => {
      const listed = classList(text);
      return text
        .split(/\s+/)
        .filter((token) => token !== '')
        .map((token) => ({ path: path.slice(ROOT.length), token, utility: utilityOf(token) }))
        .filter(({ utility }) => listed || utility.includes('-'))
        .map((found) => ({ ...found, why: refusal(found.utility, inRecipes) }));
    });
  });

  it('reads the class lists it is meant to', () => {
    // Calibrated, so a reader that stopped finding strings cannot pass: the
    // client spends `rounded-control` some seventy times, its three overlays
    // spend `shadow-overlay`, its eight pictures and the two stand-ins that
    // take a picture's slot `rounded-media`, and `reveal` is the one
    // `transition-*`. `field-sizing-content` is written only after
    // a `${control}` hole, in the composer and the chat's edit box, so it is
    // the proof that a template literal's text is read at all.
    const count = (utility: string): number =>
      scanned.filter((found) => found.utility === utility).length;
    expect(count('rounded-control')).toBeGreaterThanOrEqual(50);
    expect(count('shadow-overlay')).toBeGreaterThanOrEqual(3);
    expect(count('rounded-media')).toBeGreaterThanOrEqual(10);
    expect(count('transition-opacity')).toBeGreaterThanOrEqual(1);
    expect(count('field-sizing-content')).toBeGreaterThanOrEqual(2);
  });

  it('refuses a radius, a shadow or a motion that is not spent by name', () => {
    const offenders = scanned
      .filter((found) => found.why !== null)
      .map(({ path, token, why }) => `${path}: ${token} — ${why ?? ''}`);
    expect(offenders).toEqual([]);
  });
});

/**
 * ***The appearance layer, spelled once — checked, because it has grown back
 * twice already.***
 *
 * [polish §6] landed `ui/` to end *"338 `className` lines across 20 files, 174
 * distinct class strings"* and *"three incompatible spellings of the primary
 * button"*. By this pass `control` had four spellings again, three of them
 * missing the `disabled:` variants — so a disabled field looked exactly like a
 * live one, which is the *precise* symptom that work removed — and `Note` and
 * `Fine` had been re-typed at more than fifty call sites.
 *
 * None of that is a thing review catches. Every copy is correct on the day it
 * is written; the cost arrives later, when the original changes and the copies
 * do not. So the rule is mechanical, and it is deliberately narrow: it forbids
 * *re-typing these particular strings*, not writing class lists.
 */
describe('the appearance layer is spelled once', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url));

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      return [path];
    });
  }

  function offenders(pattern: RegExp, allowed: string): string[] {
    return sources(ROOT)
      .filter((path) => !path.endsWith(allowed))
      .filter((path) => pattern.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(ROOT.length));
  }

  it('states the text control in one place', () => {
    // The tell is the opening of the recipe. Three copies had dropped the
    // `disabled:` half off the end, so matching the whole string would have
    // found none of them.
    expect(
      offenders(
        /w-full rounded-control border border-line-strong bg-surface/,
        join('ui', 'classes.ts'),
      ),
    ).toEqual([]);
  });

  it('states the supporting-prose steps in one place', () => {
    // `Note` and `Fine` render `<p>`; a `<span>` or a `<dt>` wanting the same
    // shade is a different element and is left alone, which is why this is
    // anchored on the tag rather than on the class list.
    expect(
      offenders(/<p className="text-sm text-ink-(?:subtle|faint)">/, join('ui', 'Text.tsx')),
    ).toEqual([]);
    expect(offenders(/<p className="text-xs text-ink-faint">/, join('ui', 'Text.tsx'))).toEqual([]);
  });

  it('gives every button variant a disabled state, and none of them an opacity', () => {
    // `classes.ts` refuses `disabled:opacity-*` by name: *"it dims text and
    // border together and can push either below the contrast floor, which is
    // how a fix for this becomes the previous bug."* `danger` was doing it.
    const button = readFileSync(join(ROOT, 'ui/Button.tsx'), 'utf8');
    const variants = button.slice(button.indexOf('const VARIANT'), button.indexOf('const SIZE'));
    expect(variants).not.toMatch(/disabled:opacity-/);
    for (const name of ['primary', 'secondary', 'danger', 'dangerOutline', 'quiet']) {
      const line = new RegExp(`${name}:[^,]*disabled:`, 's');
      expect(variants, `${name} has no disabled state`).toMatch(line);
    }
  });

  it('draws focus on a button the way it draws focus on a field', () => {
    // Anchored on the declaration rather than the file: the first version of
    // this matched the docstring above `BASE`, which explains the ring at
    // length — so it passed green against a button that had lost it. A test
    // that reads a comment is a test of the comment.
    expect(readFileSync(join(ROOT, 'ui/Button.tsx'), 'utf8')).toMatch(
      /const BASE =\s*'[^']*focus-visible:outline-focus/,
    );
    expect(readFileSync(join(ROOT, 'ui/classes.ts'), 'utf8')).toMatch(
      /base: 'rounded-control[^']*focus-visible:outline-focus/,
    );
  });
});

/**
 * ***Two faces, and the story's travels with its step*** (2026-10-01) — [10 §1.2].
 *
 * §1.2 says what separates the quiet surfaces from the tooling ones: **type**,
 * **measure** and **chrome**. *Type* was a size and a leading, which at body
 * size reads as the same page set a little looser. It is a face now as well —
 * `--font-story`, a book serif, against `--font-ui` — and the risk that brings
 * is the one this file keeps finding: a paragraph that takes the story's step
 * and not its face, which looks like a typo in the theme rather than a choice.
 * So the pairing is checked rather than remembered, in every class string in
 * the client, and so is the promise that neither face is a download.
 *
 * *(2026-10-13, [P12A.1]: the pairing is a recipe now, `story` in
 * `ui/classes.ts`, and it carries the measure with the step and the face —
 * the next describe says why the three are one string. So the check that
 * every class string paired the two became a check that no class string but
 * the recipe spells any of the three.)*
 */
describe('the two faces', () => {
  const theme = blockAt(only(THEME));

  /** The families in a stack, unquoted, in order. */
  function families(token: string): string[] {
    const value = tokensIn(theme).get(token) ?? '';
    return value.split(',').map((family) => family.trim().replace(/^['"]|['"]$/g, ''));
  }

  it('names both as system stacks, each with its generic family to fall back on', () => {
    // A machine with none of the named faces still gets a sans interface and a
    // serif story, rather than the browser's default for both.
    expect(families('--font-ui')).toContain('sans-serif');
    expect(families('--font-story')).toContain('serif');
    // No webfont: a downloaded face is a request on every cold load and a flash
    // of the fallback while it arrives, for a server meant to need nothing
    // from outside the house.
    expect(CODE).not.toMatch(/@font-face/);
  });

  it('sets the interface in the interface face', () => {
    expect(blockAt(only('\nbody {'))).toMatch(/font-family:\s*var\(--font-ui\)/);
  });

  it('never sets the story step without the story face', () => {
    // It read every class string in the client for the pair until P12A.1.
    // The step and the face are one recipe now, so this holds the recipe to
    // both, and the next describe holds every other string to neither.
    const tokens = story.split(/\s+/);
    expect(tokens).toContain('text-story');
    expect(tokens).toContain('font-story');
  });
});

/**
 * ***The story's measure, in characters of its own face*** (2026-10-13) —
 * [P12A.1], under P12A §0.4's decision.
 *
 * The measure was the reading column's width, which made it 45em of prose
 * whatever the face: ninety to a hundred and ten characters a line in a book
 * serif, by the first test's measurement, against the seventy or so
 * typographers cite, and nothing in the corpus said which it should be. It is
 * `--container-story` now, about seventy characters of the story face held in
 * `ch`, and the trap that comes with `ch` is the reason most of this describe
 * exists: a `ch` is the zero of **the element it is resolved on**. Spent on the
 * column, which is set in the interface face, it would count zeros of the sans
 * and some other number of the serif's letters. So the measure is spent only by
 * the recipe that also sets the face, and the recipe is the only place any of
 * the three is spelled.
 * *(And the number is not seventy, because the zero is not the average
 * letter — the first test below says by how much. 2026-10-13, after review.)*
 *
 * What none of this can see is a line on a screen. jsdom lays nothing out,
 * so how many characters a real line holds in Charter, Sitka or Noto Serif
 * is a person's look, and P12A §3.1 files a second platform's rendering as a
 * standing row. These hold the numbers the stylesheet states and where they
 * are spent, which is what drifts without anybody seeing it.
 */
describe("the story's measure", () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url));
  const RECIPES = join('ui', 'classes.ts');

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      return [path];
    });
  }

  /** The step, the face and the measure, any of them, as the utility a class names. */
  const STORY = new Set(['text-story', 'font-story', 'max-w-story']);

  /**
   * Whether a string spells one of them, under any variant, `!` or `/`
   * modifier — read token by token through `utilityOf`, as the radius scan
   * reads a class, because a step or a face written under a breakpoint is
   * still that step or that face at that breakpoint, without the measure
   * (2026-10-13, after review: a whitespace-bounded match of the bare name
   * let every prefixed spelling through).
   */
  const spellsStory = (text: string): boolean =>
    text
      .split(/\s+/)
      .some((token) => token !== '' && STORY.has(utilityOf(token).split('/')[0] ?? ''));

  it('holds the measure in characters, about seventy of them', () => {
    // In `ch` and nothing else: a measure in `rem` or `em` is a width, and
    // a width is what the column already was.
    //
    // **And the band is in zeros, not in characters.** A `ch` is the advance
    // of the zero, and in the stack's serifs the zero is about 1.26 times the
    // average advance of running prose, spaces and punctuation included —
    // Bitstream Charter's zero is 556 thousandths of an em against about
    // 434, Liberation Serif's 500 against about 397, DejaVu Serif's 636
    // against about 507 (2026-10-13, after P12A.1's review, which found the
    // step first written as seventy `ch` and setting nearly ninety a line).
    // So the sixty to eighty characters typographers cite is about 48–64ch,
    // and the band is tightened round the 55 that is seventy: fifty to
    // sixty. Outside it the number has stopped being the decision P12A §0.4
    // recorded, and wants a new one rather than a wider band.
    const measure = /^(\d+(?:\.\d+)?)ch$/.exec(light.get('--container-story') ?? '');
    expect(measure, '--container-story is not a number of ch').not.toBeNull();
    const zeros = Number(measure?.[1]);
    expect(zeros).toBeGreaterThanOrEqual(50);
    expect(zeros).toBeLessThanOrEqual(60);
  });

  it('spends it on the prose, through the recipe that sets the face', () => {
    // The class names the step Tailwind reads from `--container-*`, so the
    // recipe's `max-w-story` is this token and no other, and it sits in one
    // string with `font-story` so that every element measured is an element
    // set in the face its `ch` counts.
    expect(story.split(/\s+/).sort()).toEqual(['font-story', 'max-w-story', 'text-story']);
    // And the column is not the measure: it is the reading column still,
    // for the composer and the panels, and a story measure on it would
    // count characters of the interface face.
    expect(page.reading.split(/\s+/)).toContain('max-w-reading');
    expect(spellsStory(page.reading)).toBe(false);
  });

  it('is spelled nowhere but the recipe, so no paragraph takes one half of it', () => {
    // Every string literal in the client, template text included, through
    // the lexer the radius scan uses — so `${story} text-ink` is read as
    // ` text-ink` and a pair re-typed beside a hole is still found — and
    // each class in it by the utility it names, so a breakpoint, a state,
    // `!` or a line-height modifier does not hide one.
    // Calibrated by the recipe itself: a reader that went blind would not
    // find it, and the count would be nought rather than one.
    const recipe = `${RECIPES}: ${story}`;
    const spelled = sources(ROOT).flatMap((path) =>
      literals(strip(readFileSync(path, 'utf8')))
        .filter(spellsStory)
        .map((text) => `${path.slice(ROOT.length)}: ${text.trim()}`),
    );
    expect(spelled.filter((found) => found !== recipe)).toEqual([]);
    expect(spelled.filter((found) => found === recipe)).toHaveLength(1);
  });

  it('is spent wherever the story is set', () => {
    // The other half of the calibration: fourteen paragraphs of story — the
    // reading view's article, five of the transcript's prose, the player's
    // line, three of the turn being written, two of a chat's, home's
    // changelog and Compare's output — each spend the recipe through a
    // template's hole. Fewer means a surface lost its story type without
    // the scan above having anything to refuse.
    const spent = sources(ROOT)
      .filter((path) => !path.endsWith(RECIPES))
      .flatMap((path) => [...strip(readFileSync(path, 'utf8')).matchAll(/\$\{story\}/g)]);
    expect(spent.length).toBeGreaterThanOrEqual(14);
  });
});
