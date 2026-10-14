// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as recipes from './ui/classes.js';
import { page, reveal, sheet, story, strip as stripItem } from './ui/classes.js';
import { PHONE } from './ui/phone.js';

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
    // which a bare `transition-*` spends and `reveal` is *(was, until P12A.6
    // named its duration; the line stays as the floor under a recipe that
    // forgets — `the motions` below refuses one that does)*. A duration or a
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
 * A literal that reads as a class list rather than as a sentence.
 *
 * *Hoisted out of the radius scan* (2026-10-13, [P12A.8]), because the phone
 * rules' scan asks the same question of a bare word: *invisible* is a class
 * in a class list and an adjective in a sentence, and a labels table has
 * sentences.
 */
const classList = (text: string): boolean =>
  !/[A-Z]/.test(text) && text.split(/\s+/).some((token) => /^[!-]?[a-z[@][^\s]*[-:]/.test(token));

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
    // `transition-*` *(2026-10-13, P12A.6: one of six motion recipes now,
    // three of them `transition-opacity` — `the motions` below holds them)*.
    // `field-sizing-content` is written only after
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
 * ***The motions: each a recipe, each spent by name, and each still for
 * someone who has asked for less*** (2026-10-13) — [P12A.6].
 *
 * The stage asked for *"the same test `theme.test.ts` already applies to
 * `reveal`"*, and the phase's audit found that test reads `(hover: none)` and
 * not reduced motion — so these are new, and they sit beside the scan above
 * because they extend it. The scan holds that motion is written only in
 * `ui/classes.ts` and that a duration, an easing or an animation names a
 * token; these hold what that left open:
 *
 * - **Each motion is a named recipe** — the five [10 §1.3] and the stage name,
 *   and `reveal`, which was the client's one motion before them — and each one
 *   moves, so a recipe emptied of its motion fails rather than shipping a
 *   still thing under a motion's name.
 * - **Nothing transitions on Tailwind's default.** A recipe that names what
 *   moves names a duration token and an easing token as well, because the
 *   default is a length nobody chose — `reveal` rode it until this stage — and
 *   the reduced-motion block reaches it only through a line that is a floor,
 *   not a design.
 * - **Motion is written in a motion recipe and nowhere else in the file**,
 *   which is the scan's rule carried down from files to names: a `transition`
 *   added to a link's recipe would pass the scan, since it is in the right
 *   file, and would be a sixth motion nobody named.
 * - **The one motion that loops is stilled, not slowed.** A transition's
 *   reduced-motion arm is its duration going to zero, which the P12A.0 test
 *   above already holds for every duration; a loop's is its animation token
 *   going to `none`, and this checks that the streaming state spends one that
 *   does — and that it is the loop, so the arm is the one that matters.
 */
describe('the motions', () => {
  /** What each recipe is, by the name it is exported under. */
  const MOTIONS: Record<string, string> = {
    arrival: 'a turn arriving',
    busy: 'the streaming state',
    enter: 'a panel or sheet entering',
    crossfade: 'the backdrop changing',
    press: 'a press acknowledged',
    reveal: 'a row of controls coming up under the pointer',
  };

  /** Every class string an export of `ui/classes.ts` holds. */
  const stringsOf = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : typeof value === 'object' && value !== null
        ? Object.values(value).flatMap(stringsOf)
        : [];
  const utilities = (text: string): string[] =>
    text
      .split(/\s+/)
      .filter((token) => token !== '')
      .map(utilityOf);
  const moves = (utility: string): boolean =>
    /^(?:transition(?:-.+)?|(?:duration|delay|ease|animate)-.+)$/.test(utility);
  const tokens = (namespace: string): Set<string> =>
    new Set(
      [...light.keys()]
        .filter((name) => name.startsWith(`--${namespace}-`))
        .map((name) => name.slice(namespace.length + 3)),
    );

  it('names each motion as a recipe beside reveal, and each one moves', () => {
    for (const [name, what] of Object.entries(MOTIONS)) {
      const held = stringsOf((recipes as Record<string, unknown>)[name]);
      expect(held.length, `${name} — ${what} — is not a recipe in ui/classes.ts`).toBeGreaterThan(
        0,
      );
      expect(
        held.flatMap(utilities).some(moves),
        `${name} — ${what} — names nothing that moves`,
      ).toBe(true);
    }
  });

  it('names a duration and an easing wherever it transitions, so nothing rides the default', () => {
    const durations = tokens('transition-duration');
    const easings = tokens('ease');
    for (const name of Object.keys(MOTIONS)) {
      for (const text of stringsOf((recipes as Record<string, unknown>)[name])) {
        const used = utilities(text);
        if (!used.some((utility) => /^transition(?:-.+)?$/.test(utility))) continue;
        expect(
          used.filter((utility) => durations.has(utility.replace(/^duration-/, ''))),
          `${name} transitions without naming a duration token: ${text}`,
        ).toHaveLength(1);
        expect(
          used.filter((utility) => easings.has(utility.replace(/^ease-/, ''))),
          `${name} transitions without naming an easing token: ${text}`,
        ).toHaveLength(1);
      }
    }
  });

  it('writes motion in a motion recipe and nowhere else in the file', () => {
    const offenders = Object.entries(recipes)
      .filter(([name]) => !(name in MOTIONS))
      .flatMap(([name, value]) =>
        stringsOf(value).flatMap((text) =>
          text
            .split(/\s+/)
            .filter((token) => moves(utilityOf(token)) || token.startsWith('starting:'))
            .map((token) => `${name}: ${token}`),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it('stills the streaming state rather than slowing it', () => {
    const animations = utilities(recipes.busy).filter((utility) => utility.startsWith('animate-'));
    expect(animations).toHaveLength(1);
    const token = `--${animations[0] ?? ''}`;
    // The loop is what makes `none` the arm that matters: a transition that
    // ran once would be stilled by its duration already.
    expect(light.get(token), `${token} is not a token @theme declares`).toMatch(/\binfinite\b/);
    expect(tokensIn(blockAt(only(LESS_MOTION))).get(token)).toBe('none');
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

/**
 * ***The HUD strip is set in no ink fainter than the veil was worked out for***
 * (2026-10-14, [P12A](../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.4, after review).
 *
 * The strip is the part of Play's column that stays over a backdrop once
 * P12A.5 has moved the configuration panels out, and the veil's opacity was
 * worked out for `ink-subtle`: `ink-faint` over it is about 3 to 1 in the
 * light theme, and 4.35 to 1 on the `surface-muted` ground an item takes while
 * it is hovered or open. contrast.test.ts measures the pairs, and says why
 * `ink-faint` is on neither ground; what it cannot see is which ink the strip
 * spends. The review found the label and *not set* in `ink-faint` — once in
 * the recipe and once at the call site — so this reads both: the recipe's
 * strings, and the class lists of the two files that draw the strip and its
 * entries. A mode's panel text, in `ModeRegion`, is not the strip's and is not
 * read.
 */
describe('the HUD strip', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url));
  const FAINT = 'text-ink-faint';

  it('spends no ink fainter than ink-subtle, in its recipe or where it is drawn', () => {
    for (const [name, classes] of Object.entries(stripItem)) {
      expect(classes.split(/\s+/).map(utilityOf), `strip.${name}`).not.toContain(FAINT);
    }
    for (const file of [join('play', 'HudStrip.tsx'), join('play', 'HudEntry.tsx')]) {
      const spent = literals(strip(readFileSync(join(ROOT, file), 'utf8')))
        .flatMap((text) => text.split(/\s+/))
        .map(utilityOf);
      // Calibrated: a reader gone blind would find nothing, and pass. Both
      // files lay out their line, so each spends `flex` somewhere.
      expect(spent, file).toContain('flex');
      expect(spent, file).not.toContain(FAINT);
    }
  });
});

/**
 * ***The phone rules*** (2026-10-13) — [P12A.8], and
 * [10 §1.3](../../../docs/design/10-ui-surfaces.md)'s two sentences: *sheets
 * rather than shrunken panels*, and *no essential action that exists only on
 * hover*. Both were written, and neither was enforced; the second had been
 * met by hand, once, in the recipe above, and broken by a `title` in a dozen
 * places nobody counted as hover.
 *
 * **What a scan can hold, and what it says it cannot.**
 *
 * - ***A reveal on hover is a recipe's.*** A class that shows something —
 *   its opacity, its visibility, its display, whether it takes a press — under
 *   a hover variant (`hover`, a group's or a peer's hover, an arbitrary
 *   variant that names one), and a hidden state at rest that only a reveal
 *   needs, are refused anywhere but `ui/classes.ts`, where `reveal` holds its
 *   arms for every group by name and is held below to its touch arm and its
 *   keyboard arm. *It cannot see* a reveal by size, clip, colour or transform,
 *   a class assembled at run time, an inline `style`, a rule in `index.css`,
 *   or a script that shows a thing on a pointer's arrival — `TokenField`'s one
 *   pointer handler moves a highlight and reveals nothing, which was read.
 * - ***A control's explanation is not its title alone.*** A `title` on an
 *   interactive element — a native control or link, a summary, a label,
 *   `Button` and `Link`, or anything given a click handler, an `href`, a tab
 *   stop or an interactive role — is refused unless the element carries
 *   `aria-describedby`, or shows its own name as text: it has children, and
 *   no `aria-label` or `aria-labelledby` standing in for them. An element
 *   named by an attribute is one whose content is not its name — a glyph, a
 *   bar, a colour — and its title is then the only words a sighted reader is
 *   given, which a phone never shows. *It cannot see* what a child expression
 *   renders (a glyph in an expression with no `aria-label` passes as text), a
 *   title passed through a spread or by a component this scan does not know
 *   to forward one, an element made interactive by a script, or whether the
 *   text it calls visible is hidden at a phone's width. *(2026-10-14, after
 *   review: nor whether an `aria-describedby` is there at all — one given
 *   only on some condition, as `InputKind` describes the chosen kind alone
 *   with `selected && … ? hintId : undefined`, is counted as present on every
 *   element that writes it; nor a tag written hard against a word of text,
 *   `Press<button`, which it takes for a type's arguments. A tag after a
 *   word and a space, or on the line after a sentence, it reads.)* ***And it
 *   does not judge a title on what cannot be pressed*** — a badge, a span, a
 *   list item: no phone and no keyboard ever reaches one, so whether it was
 *   essential is a judgement per site, and P12A §2's record makes each.
 *   `DECORATION` is the list of controls whose title was judged a
 *   decoration a phone can lose, each with its reason, and a reason for a
 *   control that has gone fails as stale.
 *
 * Calibrated, both: a reader that stopped finding hover arms or titled
 * controls would pass, so each counts what it must find.
 */
describe('the phone rules', () => {
  const ROOT = fileURLToPath(new URL('.', import.meta.url));
  const RECIPES = join('ui', 'classes.ts');

  function sources(dir: string, pattern: RegExp): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path, pattern);
      if (!pattern.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
      return [path];
    });
  }

  /** The variants a class is written under — `utilityOf`'s other half. */
  function variantsOf(token: string): string[] {
    const found: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < token.length; i += 1) {
      const char = token[i];
      if (char === '[' || char === '(') depth += 1;
      else if (char === ']' || char === ')') depth -= 1;
      else if (char === ':' && depth === 0) {
        found.push(token.slice(start, i));
        start = i + 1;
      }
    }
    return found;
  }

  /**
   * A variant that holds only while something is hovered — `hover` itself,
   * or `hover` as the last link of a compound (`group-hover/turn`,
   * `peer-hover`, `in-hover`, `has-hover`, `group-has-hover`,
   * `in-group-hover`), or an arbitrary selector or query that names one
   * wherever its brackets sit (`[&:hover]`, `group-[:hover]/turn`,
   * `peer-[:hover]`, `has-[:hover]`, `[@media(hover:hover)]`). A device
   * that cannot hover, `[@media(hover:none)]`, is not one: it is the touch
   * arm `reveal` brings the row back under.
   *
   * *(2026-10-14, P12A.8, after review: it named four compounds whole and
   * read an arbitrary variant only when the variant began with its bracket,
   * so a `hidden` row given `flex` under `group-[:hover]/turn` passed with no
   * failure at all — a group's hover reveal, which P12A §0.4 has this test
   * refuse, by the `hidden` or `sr-only` toggle the older `opacity-0` scan
   * above was never able to see. None was written.)*
   */
  const onHover = (variant: string): boolean =>
    /(?:^|-)hover(?:\/.+)?$/.test(variant) ||
    (variant.includes('[') && /:hover\b|\bhover:hover\b/.test(variant));
  /** A utility that decides whether a thing is seen, or takes a press, at all. */
  const SEEN =
    /^(?:opacity-.+|visible|invisible|collapse|hidden|block|inline|inline-block|inline-flex|inline-grid|flex|grid|contents|flow-root|table|sr-only|not-sr-only|pointer-events-.+)$/;
  /** A hidden state at rest, which nothing but a reveal needs. */
  const UNSEEN = new Set(['invisible', 'opacity-0']);

  /** Why a class is a reveal that belongs in a recipe, or `null`. */
  function hoverRefusal(token: string, listed: boolean): string | null {
    const variants = variantsOf(token);
    const utility = utilityOf(token);
    if (variants.some(onHover) && SEEN.test(utility)) return 'shown on hover';
    if ((listed || variants.length > 0) && UNSEEN.has(utility)) return 'hidden until revealed';
    return null;
  }

  function hoverRefusals(path: string): { path: string; token: string; why: string }[] {
    return literals(strip(readFileSync(path, 'utf8'))).flatMap((text) => {
      const listed = classList(text);
      return text
        .split(/\s+/)
        .filter((token) => token !== '')
        .flatMap((token) => {
          const why = hoverRefusal(token, listed);
          return why === null ? [] : [{ path: path.slice(ROOT.length), token, why }];
        });
    });
  }

  const scripts = sources(ROOT, /\.tsx?$/);

  it('reveals nothing on hover but through a recipe', () => {
    const offenders = scripts
      .filter((path) => !path.endsWith(RECIPES))
      .flatMap(hoverRefusals)
      .map(({ path, token, why }) => `${path}: ${token} — ${why}, outside ui/classes.ts`);
    expect(offenders).toEqual([]);
  });

  it('reads the hover arms it is meant to', () => {
    // The client is full of hover arms that show nothing — a ground, an
    // ink, an underline — so a reader that found none has gone blind.
    const hovered = scripts.flatMap((path) =>
      literals(strip(readFileSync(path, 'utf8')))
        .flatMap((text) => text.split(/\s+/))
        .filter((token) => variantsOf(token).some(onHover)),
    );
    expect(hovered.length).toBeGreaterThanOrEqual(30);
    // And it would refuse the recipe's own arms, were they written anywhere
    // else: each group's two hover arms and its hidden state, three groups.
    const inRecipes = hoverRefusals(join(ROOT, RECIPES)).map(({ token }) => token);
    for (const group of Object.keys(reveal)) {
      expect(inRecipes).toEqual(
        expect.arrayContaining([
          `group-hover/${group}:opacity-100`,
          `group-hover/${group}:pointer-events-auto`,
        ]),
      );
    }
    expect(inRecipes.filter((token) => token === 'opacity-0').length).toBeGreaterThanOrEqual(3);
  });

  /**
   * Every hover arm in the client today is `hover:` or `group-hover/…:`, and
   * the arms the count above finds were the same under the detector this one
   * replaced, so the count cannot tell a detector that reads the rarer shapes
   * from one that does not (2026-10-14, P12A.8, after review). These are
   * written for it: a reveal by display, `sr-only` or opacity under each
   * shape of variant that names a hover, and the touch arm `reveal` itself
   * spends, which names a hover only to say there is none — read as one, a
   * call site that showed a thing to a finger would be refused as hiding it
   * from one.
   */
  it('reads a hover however its variant is compounded', () => {
    // Each class is written as its variant and its utility apart and joined
    // here, because the build reads this file for class names too: whole,
    // each would be emitted into the stylesheet the client ships. For the
    // same reason the utility that undoes `sr-only`, which nothing in the
    // client spends, is spelt in halves.
    const shown: [variant: string, utility: string][] = [
      ['group-[:hover]/turn', 'flex'],
      ['peer-[:hover]', ['not', 'sr-only'].join('-')],
      ['has-[:hover]', 'block'],
      ['group-has-hover', 'flex'],
      ['in-group-hover', 'opacity-100'],
    ];
    for (const [variant, utility] of shown) {
      const token = `${variant}:${utility}`;
      expect(hoverRefusal(token, false), token).toBe('shown on hover');
    }
    const touch = ['[@media(hover:none)]', 'opacity-100'].join(':');
    expect(hoverRefusal(touch, false)).not.toBe('shown on hover');
  });

  /**
   * `reveal` is one recipe per group because a group's name is part of the
   * class. What makes it *one* recipe is held here: the strings differ in the
   * name and nothing else, and each shows the row the same three ways — the
   * group hovered, the keyboard inside it, a device that cannot hover — and
   * lets it take a press under exactly those, and not at rest.
   */
  it('brings the row back the same three ways in every group, and lets it take a press only then', () => {
    const groups = Object.entries(reveal);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    const shapes = groups.map(([group, text]) =>
      text.split(/\s+/).map((token) => token.replace(`/${group}:`, '/*:')),
    );
    for (const shape of shapes) expect(shape).toEqual(shapes[0]);

    for (const [group, text] of groups) {
      const tokens = text.split(/\s+/);
      const at = (utility: string): string[] =>
        tokens
          .filter((token) => utilityOf(token) === utility && variantsOf(token).length > 0)
          .map((token) => variantsOf(token).join(':'));
      const ways = ['[@media(hover:none)]', `group-focus-within/${group}`, `group-hover/${group}`];
      expect(at('opacity-100').sort(), `${group}: what shows the row`).toEqual([...ways].sort());
      expect(at('pointer-events-auto').sort(), `${group}: what lets it be pressed`).toEqual(
        [...ways].sort(),
      );
      const rest = tokens.filter((token) => variantsOf(token).length === 0).map(utilityOf);
      expect(rest, `${group} at rest`).toEqual(
        expect.arrayContaining(['opacity-0', 'pointer-events-none']),
      );
    }
  });

  it('makes a panel a sheet on a phone, and nowhere else', () => {
    const tokens = sheet.split(/\s+/);
    // Every class is the phone's: on a desk the panel is where it was opened.
    expect(tokens.filter((token) => variantsOf(token).join(':') !== 'max-sm')).toEqual([]);
    // Along the bottom edge, the screen's width, and scrolling in itself.
    expect(tokens.map(utilityOf)).toEqual(
      expect.arrayContaining(['fixed', 'inset-x-0', 'bottom-0', 'top-auto', 'overflow-y-auto']),
    );
    expect(tokens.map(utilityOf).some((utility) => utility.startsWith('max-h-'))).toBe(true);
  });

  it('asks the stylesheet’s question when a press asks whether this is a phone', () => {
    const require = createRequire(import.meta.url);
    const tailwind = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8');
    const breakpoint = /--breakpoint-sm:\s*([^;]+);/.exec(tailwind)?.[1]?.trim();
    expect(breakpoint).toBeDefined();
    // `max-sm:` compiles to *not all and (width >= sm)*; this is that query in
    // the older spelling every browser parses, and the client may not move
    // the breakpoint out from under it.
    expect(PHONE).toBe(`not all and (min-width: ${breakpoint ?? ''})`);
    expect(CODE).not.toMatch(/--breakpoint-sm\s*:/);
  });

  // ——— A control's title ———

  interface Tag {
    name: string;
    attrs: Map<string, string>;
    selfClosing: boolean;
    /** What follows the tag, so its first child can be seen. */
    after: string;
  }

  /** From an opening `{`, the index after its partner — strings and templates skipped. */
  function balanced(source: string, open: number): number | null {
    let depth = 0;
    let at = open;
    while (at < source.length) {
      const char = source[at];
      if (char === '"' || char === "'") {
        at += 1;
        while (at < source.length && source[at] !== char && source[at] !== '\n') {
          if (source[at] === '\\') at += 1;
          at += 1;
        }
      } else if (char === '`') {
        at += 1;
        while (at < source.length && source[at] !== '`') {
          if (source[at] === '\\') at += 1;
          else if (source[at] === '$' && source[at + 1] === '{') {
            const close = balanced(source, at + 1);
            if (close === null) return null;
            at = close;
            continue;
          }
          at += 1;
        }
      } else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return at + 1;
      }
      at += 1;
    }
    return null;
  }

  /** The attributes of the JSX tag whose name ends at `start`, or `null` if it is not one. */
  function readTag(source: string, start: number): Omit<Tag, 'name'> | null {
    const attrs = new Map<string, string>();
    let at = start;
    const space = (): void => {
      while (at < source.length && /\s/.test(source[at] ?? '')) at += 1;
    };
    while (at < source.length) {
      space();
      if (source[at] === '>') return { attrs, selfClosing: false, after: source.slice(at + 1) };
      if (source.startsWith('/>', at)) return { attrs, selfClosing: true, after: '' };
      if (source[at] === '{') {
        const close = balanced(source, at);
        if (close === null) return null;
        at = close;
        continue;
      }
      const name = /^[A-Za-z_][\w:.-]*/.exec(source.slice(at, at + 64))?.[0];
      if (name === undefined) return null;
      at += name.length;
      space();
      if (source[at] !== '=') {
        attrs.set(name, '');
        continue;
      }
      at += 1;
      space();
      const quote = source[at];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, at + 1);
        if (close === -1) return null;
        attrs.set(name, source.slice(at + 1, close));
        at = close + 1;
      } else if (quote === '{') {
        const close = balanced(source, at);
        if (close === null) return null;
        attrs.set(name, source.slice(at + 1, close - 1).trim());
        at = close;
      } else return null;
    }
    return null;
  }

  /** Every JSX opening tag in a source, read past its comments. */
  function tagsOf(text: string): Tag[] {
    const source = strip(text);
    return [...source.matchAll(/<([A-Za-z][\w.]*)/g)].flatMap((match) => {
      // A type's arguments or a comparison, not a tag: `useState<`, `a<b`,
      // `)<` — each touches its `<`. Prettier writes a comparison with a
      // space on both sides, where no name follows the `<` at all, so a word
      // with whitespace before the `<` is JSX text — `Press <button`, or a
      // sentence and then a control on the next line, as Prettier writes
      // one — and its tag is read. `return <div` is the same case, which is
      // why `return` needs no guard of its own any more.
      // *(2026-10-14, P12A.8, after review: the whitespace was allowed, with
      // `return` excepted by name, so every tag after a word of text was
      // skipped as a type's arguments, and a control explained by its title
      // alone could stand after a sentence unread. None did.)*
      if (/[\w$)\]]/.test(source[match.index - 1] ?? '')) return [];
      const tag = readTag(source, match.index + match[0].length);
      return tag === null ? [] : [{ name: match[1] ?? '', ...tag }];
    });
  }

  const INTERACTIVE = new Set([
    'a',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    'label',
    'Button',
    'Link',
  ]);
  const ROLES =
    /^(?:button|link|checkbox|radio|switch|tab|menuitem|menuitemcheckbox|menuitemradio|option|slider|spinbutton|combobox|textbox)$/;
  const interactive = (tag: Tag): boolean =>
    INTERACTIVE.has(tag.name) ||
    tag.attrs.has('onClick') ||
    tag.attrs.has('href') ||
    tag.attrs.has('tabIndex') ||
    ROLES.test(tag.attrs.get('role') ?? '');

  /** Why a titled control is explained by its title alone, or `null`. */
  function titleOnly(tag: Tag): string | null {
    if (!tag.attrs.has('title') || !interactive(tag)) return null;
    if (tag.attrs.has('aria-describedby')) return null;
    if (tag.selfClosing || /^\s*<\//.test(tag.after)) return 'it has no text of its own';
    if (tag.attrs.has('aria-label') || tag.attrs.has('aria-labelledby')) {
      return 'it is named by an attribute, so its title is the only words a sighted reader gets';
    }
    return null;
  }

  /**
   * ***Controls whose title was judged a decoration a phone can lose*** —
   * keyed by file, tag and the title's own expression, each with the reason
   * it was judged so (P12A.8). A new one is a decision, made here in words.
   */
  const DECORATION: Record<string, string> = {
    'tags/TagManagerDialog.tsx:button:props.label':
      'A colour swatch. The colour is what is chosen, and the button shows it; its name is a second channel for a reader who cannot tell two colours apart — a screen reader has it from the name, a pointer from the title, and a phone, for now, from neither, which P12A §2 records as the limit.',
    'play/ContextMeter.tsx:button:text':
      'The context meter. Its figure is drawn beside its bar, its press opens the turn record the sentence describes, and its title repeats the name a screen reader is given.',
  };

  const titled = sources(ROOT, /\.tsx$/).flatMap((path) =>
    tagsOf(readFileSync(path, 'utf8'))
      .filter((tag) => tag.attrs.has('title') && interactive(tag))
      .map((tag) => ({
        tag,
        key: `${path.slice(ROOT.length)}:${tag.name}:${tag.attrs.get('title') ?? ''}`,
      })),
  );

  it('leaves no control explained by its title alone', () => {
    const offenders = titled
      .filter(({ key }) => DECORATION[key] === undefined)
      .flatMap(({ tag, key }) => {
        const why = titleOnly(tag);
        return why === null ? [] : [`${key} — ${why}`];
      });
    expect(offenders).toEqual([]);
  });

  it('reads the controls it is meant to', () => {
    // The header's two panel buttons, the selector bar's toggle, the turn
    // kinds, a swatch, the meter and the handle's field are titled controls
    // today; a reader that found fewer has stopped reading tags.
    expect(titled.length).toBeGreaterThanOrEqual(7);
    // And it reads what decides the rule, not only the title: the handle's
    // field is described by its sentence, and a swatch is named by a label.
    const at = (key: string): Tag | undefined => titled.find((one) => one.key === key)?.tag;
    expect(
      at(
        'auth/forms.tsx:input:Lowercase letters, digits and hyphens, starting with a letter or a digit and not ending in a hyphen.',
      )?.attrs.has('aria-describedby'),
    ).toBe(true);
    const swatch = at('tags/TagManagerDialog.tsx:button:props.label');
    expect(swatch?.attrs.has('aria-label')).toBe(true);
    expect(swatch === undefined ? null : titleOnly(swatch)).not.toBeNull();
    // And the reader's edges, on a source written for them: a tag straight
    // after `return` is a tag, a type's arguments and a comparison are not,
    // an arrow inside an attribute does not end the tag, nor a brace inside a
    // string inside one, and each of the rule's answers comes back. A tag
    // after a word of text is a tag too, on the word's line or the next
    // (2026-10-14, P12A.8, after review): the last two lines are each a
    // control explained by its title alone, standing after a sentence.
    const read = tagsOf(
      [
        'const x = useState<string>(a<b);',
        'return <button title="Close" aria-label="Close the panel" onClick={() => a > b}>X</button>;',
        '<a href="/x" title="Where it goes">Somewhere</a>',
        '<input title="A rule" />',
        '<span title="Only a span">Off</span>',
        '<Button title="Says }" onClick={() => say("}")} aria-describedby="why">Go</Button>',
        '<p>Press <button title="x" aria-label="y">K</button></p>',
        '<p>\n  A sentence that ends in a word\n  <Link title="x" aria-label="y" href="/">→</Link>\n</p>',
      ].join('\n'),
    );
    expect(read.map((tag) => tag.name)).toEqual([
      'button',
      'a',
      'input',
      'span',
      'Button',
      'p',
      'button',
      'p',
      'Link',
    ]);
    expect(read.map(titleOnly)).toEqual([
      expect.stringMatching(/named by an attribute/),
      null,
      expect.stringMatching(/no text of its own/),
      null,
      null,
      null,
      expect.stringMatching(/named by an attribute/),
      null,
      expect.stringMatching(/named by an attribute/),
    ]);
  });

  it('keeps no reason for a control that has gone, or that no longer needs one', () => {
    const live = new Map(titled.map(({ tag, key }) => [key, tag]));
    const stale = Object.keys(DECORATION).filter((key) => {
      const tag = live.get(key);
      return tag === undefined || titleOnly(tag) === null;
    });
    expect(stale).toEqual([]);
  });
});
