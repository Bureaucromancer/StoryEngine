// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***The client's source read as string literals, for the scans that hold its
 * class lists*** (2026-10-14,
 * [P12A](../../../docs/design/workplan/35-p12a-the-look.md)'s final audit).
 *
 * Two test files read the client's own source for the classes it spends, and
 * until this audit they read it two ways. `theme.test.ts`'s scans — radius,
 * elevation and motion, the story recipe, the strip's ink, the layers, the
 * phone rules — used the lexer below, which reads a template literal's text
 * between its holes. `tailwind-utilities.test.ts` used two regular
 * expressions, one for `className="…"` and one for a quoted string, and read
 * no template at all. That was a gap from the first, and
 * [P12A.1](../../../docs/design/workplan/35-p12a-the-look.md#p12a1--the-story-face-and-the-two-surfaces-that-wear-it)
 * widened it to the story's own paragraphs: turning fourteen of them from
 * `className="… text-story …"` into `` className={`${story} …`} `` took the
 * classes left beside the hole out of the one test that asks whether Tailwind
 * emitted them, so a misspelt `whitespace-pre-wrap` on the transcript's prose
 * would have passed it, and the paragraph would have stopped wrapping.
 * `theme.test.ts` had already said why one lexer: *a second lexer would be a
 * second answer to one question*. So the lexer moved here, and both read it.
 *
 * **A test helper, not a test**: the `test-` prefix is what keeps it out of
 * the client's build project and in `tsconfig.spec.json`'s, and gives it the
 * test files' lint rules, as `test-dom-setup.ts` beside it has. Nothing the
 * client ships imports it.
 */

/** One string literal's text, and whether it was written as a `className`. */
export interface Literal {
  /** The literal's text; a template's holes are each a single space. */
  readonly text: string;
  /**
   * Whether the literal is the whole value of a `className` — the opening
   * quote or backtick directly after `className=` or `className={`. Such a
   * literal is a class list by construction, whatever is in it, which is
   * the one thing a scan can know about a literal without guessing from its
   * words; every other literal is a class list only by what it holds.
   */
  readonly className: boolean;
}

/**
 * Source with its comments gone — block comments and whole-line `//` ones —
 * so a class named in a sentence about classes is not read as one spent.
 *
 * *Hoisted, with `literals` below, out of the radius scan* (2026-10-13,
 * [P12A.1]), because the story recipe's scan reads string literals the same
 * way and a second lexer would be a second answer to one question.
 * *(2026-10-14, the final audit: and out of `theme.test.ts` into this file,
 * because `tailwind-utilities.test.ts` was that second answer —
 * `stripComments` there was this same expression, and its regular
 * expressions were a second lexer that read no template.)*
 */
export const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

/** What comes before a literal written as an element's class list. */
const CLASS_NAME = 'className=';

/**
 * Every string literal's text. A template literal's `${…}` holes are read
 * as code, so the `'a'` inside one is a literal of its own and the
 * template's text is what is left around it — which is how `${reveal} flex`
 * is read as ` flex`. A quoted string stops at a line's end, so the
 * apostrophe in a line of JSX prose cannot swallow the file after it.
 *
 * *(2026-10-14, the final audit: each literal says too whether it was
 * written as a `className`, read off the characters before its opening
 * quote — `className=` for an attribute's string, `className={` for an
 * expression's. A template in an expression is how [P12A.1] spends the story
 * recipe, and its text is then a list by construction even when it holds a
 * single class, which no test of its words could tell from a sentence.)*
 *
 * **What it is not is a parser.** A backtick in a regular expression, or an
 * odd number of them in a comment after code on a line, would open a template
 * that reads on to the next backtick, and a quote in a regular expression
 * reads to the line's end. When this moved, no literal it read in the client
 * ran past six lines, which is how a template opened by mistake shows; the
 * calibrations in both tests are what would notice one going quiet.
 */
export function literals(source: string): Literal[] {
  const found: Literal[] = [];
  let at = 0;
  /** Whether the quote or backtick at `at` opens a `className`'s value. */
  const isClassName = (): boolean =>
    source.slice(at - CLASS_NAME.length, at) === CLASS_NAME ||
    source.slice(at - CLASS_NAME.length - 1, at) === `${CLASS_NAME}{`;
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
    const className = isClassName();
    let text = '';
    at += 1;
    while (at < source.length && source[at] !== quote && source[at] !== '\n') {
      if (source[at] === '\\') at += 1;
      text += source[at] ?? '';
      at += 1;
    }
    at += 1;
    found.push({ text, className });
  };
  const template = (): void => {
    const className = isClassName();
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
    found.push({ text, className });
  };
  code(false);
  return found;
}
