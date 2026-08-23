// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
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
