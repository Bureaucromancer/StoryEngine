// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every note class the server emits has a sentence here
 * ([P4 §1.4](../../../../docs/design/workplan/06-p4-implementation.md),
 * [§7.1](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **Written because the map had drifted by twenty-four keys and nothing said
 * so.** The review's whole design is that the server emits `{ key, params }` and
 * never prose, and the client turns classes into words — which is right, and
 * which has exactly one failure mode: a converter learns a note and the label
 * map does not. The fallback in `sentence()` renders the raw key, deliberately,
 * so that a newer server's class appears as itself rather than as a blank. That
 * is the correct behaviour for a version skew and a silent defect for a build
 * shipped against itself, and the two are indistinguishable at runtime.
 *
 * So it is checked at build time instead. `import.card.bookExtracted` — the note
 * that fires on every card carrying a lorebook, which is most of them — had been
 * rendering as a dotted machine string in the most common import there is.
 *
 * **A grep over source rather than a shared constant**, and that is a real
 * trade. A constant in `@storyengine/shared` would be checked by the compiler,
 * which is stronger; it would also mean every converter importing a registry to
 * add a note, and the notes would stop being a thing you write next to the line
 * that noticed something. This keeps the writing cheap and moves the cost to a
 * test that fails loudly, which suits a vocabulary that should keep growing.
 */

const HERE = import.meta.dirname;
const SERVER_IMPORT = join(HERE, '..', '..', '..', 'server', 'src', 'import');
const PANEL = join(HERE, 'ImportPanel.tsx');

/** Every `.ts` under the server's import module, tests excluded. */
function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    // Fixtures and tests both name keys they expect to see, which would make
    // this assert against itself.
    if (entry.name.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

function keysIn(text: string, pattern: RegExp): Set<string> {
  // The group is not optional in either pattern — both have exactly one — so the
  // assertion is a fact about the regex rather than a hope about the input.
  return new Set([...text.matchAll(pattern)].map((match) => match[1]!));
}

describe('the review vocabulary', () => {
  it('has a sentence for every class the converters emit', () => {
    const emitted = new Set<string>();
    for (const file of sourceFiles(SERVER_IMPORT)) {
      for (const key of keysIn(readFileSync(file, 'utf8'), /'(import\.[a-zA-Z0-9.]+)'/g)) {
        emitted.add(key);
      }
    }
    // The routes emit a few of their own — transport failures a converter never
    // sees, like a file that is not JSON at all.
    const routes = readFileSync(
      join(HERE, '..', '..', '..', 'server', 'src', 'routes', 'import.ts'),
      'utf8',
    );
    for (const key of keysIn(routes, /'(import\.[a-zA-Z0-9.]+)'/g)) emitted.add(key);

    const labelled = keysIn(readFileSync(PANEL, 'utf8'), /'(import\.[a-zA-Z0-9.]+)':/g);

    expect(emitted.size).toBeGreaterThan(30);
    const missing = [...emitted].filter((key) => !labelled.has(key)).sort();
    expect(missing, 'these notes would render to a person as a raw dotted key').toEqual([]);
  });

  it('interpolates only parameters the server actually sends', () => {
    /**
     * **The half a key-only check misses**, and the one that bit during the fix
     * itself: a label whose `{placeholder}` names nothing renders the braces
     * literally, so the sentence arrives with `{filename}` in the middle of it.
     *
     * `import.file.refused` had two emitters — the sweep sending `file`, the
     * upload route sending `filename` — for the same class. One label cannot
     * satisfy both, so the mismatch was a defect in the *server's* vocabulary
     * rather than in the words, and it was fixed by making `file` the one
     * spelling. This is what keeps it that way.
     *
     * Deliberately a text search near the emission site rather than anything
     * cleverer: the params are built inline at dozens of call sites and only a
     * type would do better, which is the trade the file header already argues.
     */
    const panel = readFileSync(PANEL, 'utf8');
    const sources = [
      ...sourceFiles(SERVER_IMPORT),
      join(HERE, '..', '..', '..', 'server', 'src', 'routes', 'import.ts'),
    ].map((file) => readFileSync(file, 'utf8'));

    const wrong: string[] = [];
    // Both quote styles: prettier reaches for double quotes as soon as a
    // sentence contains an apostrophe, so a single-quote-only pattern would
    // quietly stop checking exactly the labels most likely to read well.
    for (const match of panel.matchAll(/'(import\.[a-zA-Z0-9.]+)':\s*\n?\s*(['"])(.*?)\2,/g)) {
      const key = match[1]!;
      // Group 2 is the quote character the pattern back-references; 3 is the text.
      const placeholders = [...match[3]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
      for (const name of placeholders) {
        /**
         * Shorthand (`{ file }`) and explicit (`{ file: path }`) both count, so
         * this looks for the two ways a **key** can be written — and not for a
         * bare word, which is the version of this check that was written first
         * and silently passed. `upload.ts` emits `params: { file: filename }`,
         * where `filename` is the local variable; a bare-word search found it
         * and concluded that `{filename}` was a parameter. It is not, and the
         * mutation that should have failed did not.
         */
        const looksSent = new RegExp(`(\\b${name}\\s*:)|([{,]\\s*${name}\\s*[,}])`);
        const sent = sources.some((source) => {
          let at = source.indexOf(`'${key}'`);
          while (at >= 0) {
            const near = source.slice(at + key.length, at + 300);
            if (looksSent.test(near)) return true;
            at = source.indexOf(`'${key}'`, at + 1);
          }
          return false;
        });
        if (!sent) wrong.push(`${key} interpolates {${name}}, which no emitter sends`);
      }
    }

    expect(wrong, 'these sentences would render a literal {placeholder}').toEqual([]);
  });

  it('has no sentence for a class nothing emits', () => {
    // The other direction, and the cheaper bug: a label kept after its note was
    // renamed is dead weight that reads as coverage.
    const emitted = new Set<string>();
    for (const file of [
      ...sourceFiles(SERVER_IMPORT),
      join(HERE, '..', '..', '..', 'server', 'src', 'routes', 'import.ts'),
    ]) {
      for (const key of keysIn(readFileSync(file, 'utf8'), /'(import\.[a-zA-Z0-9.]+)'/g)) {
        emitted.add(key);
      }
    }

    const labelled = keysIn(readFileSync(PANEL, 'utf8'), /'(import\.[a-zA-Z0-9.]+)':/g);
    const orphaned = [...labelled].filter((key) => !emitted.has(key)).sort();
    expect(orphaned, 'these labels name a note no converter emits any more').toEqual([]);
  });
});
