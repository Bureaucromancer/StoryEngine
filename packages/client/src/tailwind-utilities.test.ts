// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { literals, strip } from './test-source-literals.js';

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
 *
 * *(2026-10-14, [P12A](../../../docs/design/workplan/35-p12a-the-look.md)'s
 * final audit: **and it read no template literal at all** until then — two
 * regular expressions, one for `className="…"` and one for a quoted string,
 * where `theme.test.ts`'s scans had a lexer. [P12A.1] turned fourteen of the
 * story's paragraphs from `className="… text-story …"` into
 * `` className={`${story} …`} `` — fifteen with the player's line beside its
 * face, which [P12A.3] wrote as a template from the first — and every class
 * left beside the hole left this test with them: `whitespace-pre-wrap` on the
 * transcript's prose misspelt, or `print:max-w-none` on the reading view's
 * article, would have passed, as would a misspelling in any of the fifty-four
 * other `className` templates this test had never read. It reads every
 * literal through `test-source-literals.ts` now, a template's text between its
 * holes included, and **a template written as a `className` is a list by
 * construction** as the quoted attribute always was, so a hole beside a single
 * misspelt class is caught too. What is left is the sentence above, now about
 * a quoted string or a template's text anywhere but a `className`.)*
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
 *
 * ***And `>`, `,` and `_` inside a name*** (2026-10-13,
 * [P12A](../../../docs/design/workplan/35-p12a-the-look.md) P12A.2, after
 * review). The backdrop's veil is four classes on `<main>` keyed on a child —
 * `has-[>…]` — with a gradient's two arguments and a two-part size in them,
 * and a token holding any of those three was not read as a class at all: a
 * typo in any of the four passed, which a mutation showed before this line
 * changed. A comma or an underscore in prose sits next to a word that is
 * not a utility, so the class-list test below still keeps a sentence out.
 */
function classShaped(token: string): boolean {
  if (!/^-?[a-z][a-z0-9]*(?:[-:.[\]()%>,_]|[a-z0-9])*$/.test(token)) return false;
  if (!token.includes('-') && !token.includes(':')) return false;
  return !/\.(js|ts|tsx|md|json|css)$/.test(token);
}

const NO_BUILD =
  'No built stylesheet under packages/client/dist/assets. Run `pnpm build` first — this test compares the class names the source mentions against the ones Tailwind emitted, and without a build there is nothing to compare against, so an unrecognised utility would pass silently. CI builds before it tests for exactly this reason.';

const STALE_OR_WRONG =
  'Class names with no rule in the built stylesheet. Either the name is not a Tailwind utility — the bug this test exists for, and the element has silently lost that property — or the build is older than the source, which is what happens the first time a legitimate new class is added. Run `pnpm build` and try again before hunting for a typo.';

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

  /**
   * The class lists in a piece of source, its comments already stripped.
   *
   * Two rules, one reading. A literal written as a `className` — the
   * attribute's quoted string, or a template in its braces — is a class list
   * by construction, whatever is in it; any other string is one only when
   * something in it is a real utility, which is what keeps prose and attribute
   * names out.
   *
   * *(2026-10-14, P12A's final audit: these were two passes of two regular
   * expressions, and neither read a template. Every literal comes through the
   * lexer `theme.test.ts` uses now, a template's text between its holes and a
   * quoted string inside a hole each read on its own, and the lexer says which
   * were written as a `className` — so `` `whitespace-pre-wrap ${story} ${…}` ``
   * is a list for the one class it spells beside its holes, which the second
   * rule alone could not tell from a word. [P12A.1] is what moved the story's
   * paragraphs there.)*
   */
  function listsIn(source: string): string[] {
    return literals(source)
      .filter(
        (literal) =>
          literal.className || literal.text.split(/\s+/).filter(classShaped).some(emitted),
      )
      .map((literal) => literal.text);
  }

  /** The class-shaped names in a piece of source that the build has no rule for. */
  function unemitted(source: string): string[] {
    return listsIn(source).flatMap((list) =>
      list
        .split(/\s+/)
        .filter(classShaped)
        .filter((token) => !emitted(token)),
    );
  }

  /**
   * ***Calibrated, so a reader gone blind cannot pass*** (2026-10-14, P12A's
   * final audit). The test below passes by finding nothing wrong, and for
   * every template in the client it found nothing because it read nothing,
   * from the first. So it is asked to find what it is for, in two shapes a
   * class list takes in a template — written as a `className`, with one
   * misspelt class beside its holes and no real one to vouch for it, as
   * the chat's own turn is; and held in a constant, with a real class beside
   * the misspelling — and to read at least a thousand class lists out of the
   * client (1,548 when this was written, most of them quoted attributes), so
   * that a lexer that stopped seeing them fails here as well as in
   * `theme.test.ts`'s calibrations. Mutations: the lexer's `className` flag
   * always false, a template's text read as empty, and the lexer finding
   * nothing — each fails it.
   */
  it('reads the class lists it is meant to', () => {
    expect(
      unemitted(`<p className={\`whitespace-pre-wrp \${story} \${a ? 'x' : 'y'}\`} />`),
    ).toEqual(['whitespace-pre-wrp']);
    expect(unemitted(`const article = \`mt-2 \${story} gap-q3\`;`)).toEqual(['gap-q3']);
    const read = sourceFiles(SRC).flatMap((file) => listsIn(strip(readFileSync(file, 'utf8'))));
    expect(read.length).toBeGreaterThanOrEqual(1000);
  });

  it('was emitted by the build', () => {
    const suspects: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const where = file.slice(file.indexOf('packages')).replace(/\\/g, '/');
      // Comments hold prose, and prose in a JSDoc reads enough like a class
      // list; `strip` takes them out, as it does for `theme.test.ts`.
      for (const token of unemitted(strip(readFileSync(file, 'utf8')))) {
        suspects.push(`${token} — ${where}`);
      }
    }

    /**
     * **Two things make this fail, and the message has to offer both.**
     *
     * Either a name is not a utility — the bug this exists for — or the built
     * stylesheet is older than the source, which is what happens the first time
     * anybody adds a legitimate class and runs the suite without rebuilding.
     * A message that only accused the class would send them looking for a typo
     * that is not there.
     */
    expect(suspects, STALE_OR_WRONG).toEqual([]);
  });
});
