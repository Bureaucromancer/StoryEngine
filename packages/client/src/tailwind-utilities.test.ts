// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * **Every class this client names is a class Tailwind actually emitted.**
 *
 * The bug this exists for is invisible to everything else in the gate.
 * Tailwind generates a rule only for a name it recognises and generates
 * *nothing* for one it does not — so a plausible invention like
 * `inset-block-0` is not a lint error, not a type error and not a test
 * failure. It is an element that silently lost a property, found by somebody
 * looking at the page some time later.
 *
 * It was not hypothetical: the workbench's resize handle carried
 * `absolute -start-1 inset-block-0 w-2` for three phases. With no block inset an
 * absolutely-positioned element is zero pixels tall, so the drag affordance was
 * not merely mis-pinned — it was not there at all, and only the keyboard half of
 * that control worked. The correct spelling is `inset-y-0`, which compiles to
 * the same logical `inset-block: 0` the invented name was reaching for.
 *
 * **This reads the built stylesheet**, which is why CI builds before it tests
 * (`.github/workflows/ci.yml`) and why an unbuilt checkout gets a sentence
 * rather than a mysterious pass — the same arrangement, and the same reasoning,
 * as the fixture tree's boundary test.
 *
 * **What it cannot catch**, said plainly so nobody trusts it further than it
 * goes: a string is only read as a class list when something else in it is a
 * real utility, or when it is the whole of a literal `className="…"`. A recipe
 * assembled at runtime out of one broken token, with no working token beside it
 * to calibrate against, would still slip through.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = HERE;
const CSS_DIR = join(HERE, '..', 'dist', 'assets');

/** Source files, minus the tests — a test's own strings are not a stylesheet. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Comments hold prose, and prose in a JSDoc reads enough like a class list. */
function stripComments(text: string): string {
  return text
    .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), ' ')
    .replace(new RegExp('^[ \\t]*//.*$', 'gm'), ' ');
}

/**
 * What Tailwind writes into a selector for a class of this name.
 *
 * `replace` rather than spreading the string, which the lint rules forbid and
 * are right to: a spread cuts a surrogate pair in half. The pattern is
 * everything CSS would need escaped, which for a utility name means the dots of
 * `ms-0.5`, the colons of a variant, and the brackets of an arbitrary value.
 */
function escapeClass(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\u0080-\uffff-]/g, (ch) => `\\${ch}`);
}

/**
 * Utility-shaped: lower case, no spaces, and carrying a dash or a variant
 * colon. Deliberately loose — a token that is not a class simply will not be in
 * the stylesheet either, and the calibration below is what keeps that from
 * mattering.
 */
function classShaped(token: string): boolean {
  if (!/^-?[a-z][a-z0-9]*(?:[-:.[\]()%]|[a-z0-9])*$/.test(token)) return false;
  if (!token.includes('-') && !token.includes(':')) return false;
  return !/\.(js|ts|tsx|md|json|css)$/.test(token);
}

const NO_BUILD =
  'No built stylesheet under packages/client/dist/assets. Run `pnpm build` first — this test compares the class names the source mentions against the ones Tailwind emitted, and without a build there is nothing to compare against, so an unrecognised utility would pass silently. CI builds before it tests for exactly this reason.';

function loadCss(): string {
  let names: string[];
  try {
    names = readdirSync(CSS_DIR).filter((name) => name.endsWith('.css'));
  } catch {
    names = [];
  }
  // One string literal, not four joined: the assembly rule bans a sentence built
  // by concatenation, and it does not make an exception for one a developer
  // reads.
  if (names.length === 0) throw new Error(NO_BUILD);
  return names.map((name) => readFileSync(join(CSS_DIR, name), 'utf8')).join('\n');
}

describe('every utility the client names', () => {
  const css = loadCss();

  /** Whether a rule for this class was generated, variants and all. */
  function emitted(token: string): boolean {
    const needle = `.${escapeClass(token)}`;
    let at = css.indexOf(needle);
    while (at !== -1) {
      // The selector ends here only if the next character cannot continue a
      // class name — `{`, a pseudo-class, a combinator, a comma.
      const next = css[at + needle.length] ?? '';
      if (!/[a-zA-Z0-9_\\-]/.test(next)) return true;
      at = css.indexOf(needle, at + 1);
    }
    return false;
  }

  it('was emitted by the build', () => {
    const suspects: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = stripComments(readFileSync(file, 'utf8'));

      /**
       * Two passes. A literal `className="…"` is a class list by construction,
       * whatever is in it; any other string is one only when something in it is
       * a real utility, which is what keeps prose and attribute names out.
       */
      const lists: string[] = [];
      for (const match of source.matchAll(/className="([^"\n]*)"/g)) {
        lists.push(match[1] ?? '');
      }
      const declared = new Set(lists);
      for (const match of source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
        const text = match[1] ?? match[2] ?? '';
        if (declared.has(text)) continue;
        const shaped = text.split(/\s+/).filter(classShaped);
        if (shaped.length > 0 && shaped.some((token) => emitted(token))) lists.push(text);
      }

      for (const list of lists) {
        for (const token of list.split(/\s+/).filter(classShaped)) {
          if (emitted(token)) continue;
          const where = file.slice(file.indexOf('packages')).replace(/\\/g, '/');
          suspects.push(`${token} — ${where}`);
        }
      }
    }

    expect(suspects, 'class names with no rule in the built stylesheet').toEqual([]);
  });
});
