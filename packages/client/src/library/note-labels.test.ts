// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MACRO_REASONS, sentence } from './note-labels.js';

/**
 * Every note class the server emits has a sentence here
 * ([P4 §1.4](../../../../docs/design/workplan/16-p4-implementation.md),
 * [§7.1](../../../../docs/design/workplan/16-p4-implementation.md)).
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
const SERVER = join(HERE, '..', '..', '..', 'server', 'src');
const SERVER_IMPORT = join(SERVER, 'import');
/**
 * **The writers emit notes too, and they emit them for the same reason.**
 *
 * An export is a conversion run backwards, so every one of them loses something
 * — a treatment's cast narrowed to a card's one character, a lorebook's folder
 * gates flattened — and the surface offering the download is the only place
 * anybody is told. Those notes are `{ key, params }` like every other, and they
 * would drift the same way, so they are checked by the same three tests rather
 * than by a fourth that would have to be remembered.
 */
const SERVER_EXPORT = join(SERVER, 'export');

/** Both halves of the vocabulary — a note is `import.…` or `export.…`. */
const EMITTED = /'((?:import|export)\.[a-zA-Z0-9.]+)'/g;
const LABELLED = /'((?:import|export)\.[a-zA-Z0-9.]+)':/g;

/** Every file the two directions are written in, plus the routes' own notes. */
function allSources(): string[] {
  return [
    ...sourceFiles(SERVER_IMPORT),
    ...sourceFiles(SERVER_EXPORT),
    // The routes emit a few of their own — transport failures a converter never
    // sees, like a file that is not JSON at all.
    join(SERVER, 'routes', 'import.ts'),
    /**
     * ***And the backup import's*** —
     * [P12.9](../../../../docs/design/workplan/29-p12-implementation.md).
     *
     * Its orchestration sits beside the archive writer rather than under
     * `import/`, because what it does **above** the sweep is copy files and
     * merge documents rather than convert anything — and the route emits the
     * configuration group's notes, for the same reason `routes/import.ts` is
     * already here. Both had to be added by hand, which is the cost of this
     * list being a list; the check failing loudly when they were not is what
     * makes that cost payable.
     */
    join(SERVER, 'backup', 'import.ts'),
    join(SERVER, 'routes', 'backups.ts'),
    /**
     * ***And the snapshot's*** —
     * [P13.1](../../../../docs/design/workplan/30-p13-aventuras-import.md).
     * `import.aventuras.walCopied` is decided in `storage/`, because only the
     * code that made the copy knows it replayed a log; the Aventuras reader
     * passes the note on as it arrived.
     */
    join(SERVER, 'storage', 'sqlite-snapshot.ts'),
  ];
}
/**
 * The catalogue, which moved out of `ImportPanel.tsx` at [P5.0] when the book
 * page became its second renderer. This constant is the coupling that move has
 * to keep honest: the grep below is a fact about a path, so a table that moves
 * again without repointing it would report every key as missing — loudly, which
 * is the good failure — while the orphan check below would quietly pass over an
 * empty file.
 */
const LABELS = join(HERE, 'note-labels.ts');

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
    for (const file of allSources()) {
      for (const key of keysIn(readFileSync(file, 'utf8'), EMITTED)) emitted.add(key);
    }

    const labelled = keysIn(readFileSync(LABELS, 'utf8'), LABELLED);

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
    const panel = readFileSync(LABELS, 'utf8');
    const sources = allSources().map((file) => readFileSync(file, 'utf8'));

    const wrong: string[] = [];
    // Both quote styles: prettier reaches for double quotes as soon as a
    // sentence contains an apostrophe, so a single-quote-only pattern would
    // quietly stop checking exactly the labels most likely to read well.
    for (const match of panel.matchAll(
      /'((?:import|export)\.[a-zA-Z0-9.]+)':\s*\n?\s*(['"])(.*?)\2,/g,
    )) {
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
    for (const file of allSources()) {
      for (const key of keysIn(readFileSync(file, 'utf8'), EMITTED)) emitted.add(key);
    }

    const labelled = keysIn(readFileSync(LABELS, 'utf8'), LABELLED);
    const orphaned = [...labelled].filter((key) => !emitted.has(key)).sort();
    expect(orphaned, 'these labels name a note no converter emits any more').toEqual([]);
  });
});

/**
 * ***Every kind of root a folder can be named as has a sentence*** —
 * [P13.0](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * The same drift as the notes, one table over. `ImportPanel`'s verdict labels
 * fall back to the raw kind, so a CHARX folder was announced as `charx` and an
 * unpacked backup as `storyengine-backup` — both kinds the server's probe table
 * learned after the labels were written, and nothing noticed, because the
 * fallback is exactly what a version skew should do.
 *
 * *One direction only.* The other would fail on two Marinara labels whose kinds
 * the server declares and no route sends; whether they go is a question about
 * the server's union, and not this test's to answer.
 */
describe('the import panel’s verdicts', () => {
  const DETECT = join(SERVER_IMPORT, 'detect.ts');
  const PANEL = join(HERE, 'ImportPanel.tsx');

  it('has a sentence for every kind the probe table can classify', () => {
    const probed = [...readFileSync(DETECT, 'utf8').matchAll(/\{ kind: '([a-z-]+)', requires:/g)]
      .map((match) => match[1]!)
      // The walker's plain mode — what every folder is that no probe matched.
      .concat('loose-files');
    expect(
      probed.length,
      'the probe pattern matched nothing, so it checked nothing',
    ).toBeGreaterThan(3);

    const panel = readFileSync(PANEL, 'utf8');
    const start = panel.indexOf("labels('import.verdict', {");
    const table = panel.slice(start, panel.indexOf('});', start));
    const labelled = new Set([...table.matchAll(/^\s*'?([a-z-]+)'?:/gm)].map((match) => match[1]!));

    const missing = probed.filter((kind) => !labelled.has(kind)).sort();
    expect(missing, 'these kinds are announced to a person as their raw name').toEqual([]);
  });
});

/**
 * ***A macro taken out is said to be taken out, and why, in words***
 * (2026-09-27). The sentence said *left as written* of the one kind of macro
 * that never is, and printed the converter's code as the reason.
 */
describe('a refused macro, in words', () => {
  it('says it was taken out, never that it was left, and gives a reason', () => {
    const said = sentence({
      key: 'import.macro.refused',
      params: { macro: 'date', block: 'Main', because: 'time-is-not-reproducible' },
    });

    expect(said).toContain('taken out');
    expect(said).not.toContain('left as written');
    expect(said).not.toContain('time-is-not-reproducible');
  });

  it('has words for every reason the converter can give', () => {
    const source = readFileSync(join(SERVER_IMPORT, 'macros.ts'), 'utf8');
    const reasons = new Set(
      [...source.matchAll(/because: '([a-z-]+)'/g)].map((match) => match[1] ?? ''),
    );

    expect(reasons.size).toBeGreaterThanOrEqual(4);
    expect([...reasons].filter((reason) => MACRO_REASONS[reason] === undefined)).toEqual([]);
  });
});
