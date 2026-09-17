// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { activeLocale, applyCatalogue, labels } from './catalogue.js';
import { MACHINE_FRENCH } from './fr-x-machine.js';
import { TRANSLATIONS } from './locales.js';

/**
 * ***The one build-time check the sweep leaves behind*** —
 * [19 §12](../../../../docs/design/19-tech-stack.md),
 * [P11 §1.3](../../../../docs/design/workplan/28-p11-implementation.md),
 * [P11.8](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The stage's proof obligation, in its own words: ***"`note-labels.test.ts`'s
 * shape, generalised to the catalogue — the class set and the word set agree,
 * for every map, as one build-time check rather than thirty-one hand-written
 * ones. That is also the answer to how anybody knows the sweep is finished: it
 * is finished when a map outside the catalogue fails the build, not when
 * somebody has been through the list."***
 *
 * So the load-bearing test here is the **first** one, and it is a scan rather
 * than an assertion about anything that exists: a label map written next week in
 * a file nobody thought about turns this red. Everything else in the file is
 * about what the catalogue then does with the maps it has.
 *
 * ---
 *
 * ***What counts as a label map, stated precisely, because the check is only as
 * honest as its rule.*** A top-level `const` in `packages/client/src` whose
 * value is an object literal with two or more entries, **every one of which is a
 * plain string literal**. That rule is mechanical and it is deliberately blind
 * to intent: `STATE_TONES` maps a class to a `BadgeTone` and `TONE` maps one to
 * Tailwind classes, and neither is a sentence — so both appear in `EXEMPT`
 * below, with the reason written down, rather than being excluded by a cleverer
 * rule that would also let a real label map through.
 *
 * *Two entries, not one*, because a one-entry object is usually an options bag
 * rather than a table, and the rule has to be cheap enough that nobody wants to
 * argue with it.
 *
 * ***What the rule deliberately does not reach, said here rather than
 * discovered later.*** Three things:
 *
 * 1. **Prose written inline in JSX** — a heading, a hint, a button's word. That
 *    is the whole interface, it was never in a table, and reaching it needs the
 *    `<Trans>`-shaped machinery [19 §12.3] buys with `i18next` — which
 *    `catalogue.ts` defers, with its reasons.
 * 2. **`[value, label]` option lists** fed to `SelectField`. They are a
 *    control's own options rather than a class-to-word table, and several of
 *    them (`LOCALES`, the connection kinds) are deliberately English.
 * 3. **A table read at module scope into another `const`**, which would freeze
 *    English before any catalogue loaded. Nothing does that today; it is the
 *    one way to use `labels()` wrongly and quietly, and it is written here
 *    because a reader of this file is the person most likely to be about to.
 *
 * *That boundary is [P11 §1.3]'s own*: the sweep it describes is **moving label
 * maps into a catalogue**, because the discipline that made it cheap — the
 * server emits `{ key, params }` and the client holds the words — is a
 * discipline about *classes*. Chrome text never had that shape and does not
 * acquire it here.
 */

const SRC = join(import.meta.dirname, '..');

/**
 * Maps that are not sentences, with the reason each one is not.
 *
 * ***Keyed by file and name, and checked for staleness below***, which is the
 * part that keeps an exemption list from becoming the place the rule goes to
 * die: an entry naming a `const` that no longer exists fails the suite, so the
 * list can only shrink by accident and grows only on purpose.
 */
const EXEMPT: Record<string, string> = {
  'library/fields.ts:EDITOR_ROUTES': 'Router paths. A translated URL is a 404.',
  'library/fields.ts:NEW_ROUTES': 'Router paths, as above.',
  'notifications/labels.ts:VARIANT_BY':
    'Class to *param name* — it says which field decides a variant, and the field names are wire keys.',
  'tags/TagFilterBar.tsx:NEXT': 'A state machine: each value is the next state, not a word.',
  'tags/TagManagerDialog.tsx:FOLDER_NEXT': 'A state machine, as above.',
  'tags/TagManagerDialog.tsx:FOLDER_GLYPH':
    'Three typographic marks. A glyph is not language, and translating one would be translating a dash.',
  'ui/Alert.tsx:TONE': 'Tailwind classes.',
  'ui/Alert.tsx:NOTE_TONE': 'Tailwind classes.',
  'ui/Badge.tsx:TONE': 'Tailwind classes.',
  'ui/Button.tsx:VARIANT': 'Tailwind classes.',
  'ui/Button.tsx:SIZE': 'Tailwind classes.',
  'ui/Dialog.tsx:SIZE': 'Tailwind classes.',
  'ui/Panel.tsx:VARIANT': 'Tailwind classes.',
  'ui/classes.ts:link': 'Tailwind classes — the file is nothing else.',
  'ui/classes.ts:navLink': 'Tailwind classes.',
  'ui/classes.ts:table': 'Tailwind classes.',
  'ui/classes.ts:page': 'Tailwind classes.',
  'workbench/turn/labels.ts:OUTCOME_TONES': 'A call outcome to a `BadgeTone`, which is a colour.',
  'workbench/address.ts:SAMPLE_OWNERS':
    'A block source to the library kind that owns it — the kinds are route segments and index keys.',
  'workbench/live/LiveSubject.tsx:STATE_TONES': 'A step state to a `BadgeTone`, which is a colour.',
  'workbench/turn/StepList.tsx:STATE_TONES': 'A step state to a `BadgeTone`, as above.',
};

/**
 * Replaces every comment with spaces, leaving strings alone.
 *
 * *Written as a scanner rather than as two regular expressions*, and the reason
 * is one that has bitten this repository before: `'https://…'` inside a string
 * is not a line comment, and a regular expression that cannot tell the
 * difference silently truncates whatever follows it — which in a checker means
 * a table that stops being visible rather than a checker that fails.
 */
function withoutComments(source: string): string {
  let out = '';
  let at = 0;
  while (at < source.length) {
    const two = source.slice(at, at + 2);
    if (two === '//') {
      while (at < source.length && source.charAt(at) !== '\n') {
        at += 1;
      }
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', at + 2);
      const stop = end === -1 ? source.length : end + 2;
      // Newlines survive so that reported line numbers stay true.
      out += source.slice(at, stop).replace(/[^\n]/g, ' ');
      at = stop;
      continue;
    }
    const char = source.charAt(at);
    if (char === "'" || char === '"' || char === '`') {
      const start = at;
      at += 1;
      while (at < source.length) {
        const here = source.charAt(at);
        if (here === '\\') at += 2;
        else if (here === char) {
          at += 1;
          break;
        } else at += 1;
      }
      out += source.slice(start, at);
      continue;
    }
    out += char;
    at += 1;
  }
  return out;
}

/** Where the `{` opened at `from` closes, string- and depth-aware. */
function closingBrace(source: string, from: number): number {
  let depth = 0;
  let at = from;
  while (at < source.length) {
    const char = source.charAt(at);
    if (char === "'" || char === '"' || char === '`') {
      at += 1;
      while (at < source.length) {
        const here = source.charAt(at);
        if (here === '\\') at += 2;
        else if (here === char) {
          at += 1;
          break;
        } else at += 1;
      }
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
    at += 1;
  }
  return -1;
}

interface Entry {
  key: string;
  value: string;
}

/** The top-level `key: value` pairs of an object literal's body. */
function entriesOf(body: string): Entry[] | null {
  const found: Entry[] = [];
  let at = 0;
  while (at < body.length) {
    while (at < body.length && /[\s,]/.test(body.charAt(at))) at += 1;
    if (at >= body.length) break;

    const rest = body.slice(at);
    const key = /^(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))\s*:/.exec(rest);
    // A computed key, a spread, or a method: not a class-to-word table, and a
    // checker that guessed at one would be guessing about the thing it exists
    // to be sure of.
    if (key === null) return null;
    at += key[0].length;

    const start = at;
    let depth = 0;
    while (at < body.length) {
      const char = body.charAt(at);
      if (char === "'" || char === '"' || char === '`') {
        at += 1;
        while (at < body.length) {
          const here = body.charAt(at);
          if (here === '\\') at += 2;
          else if (here === char) {
            at += 1;
            break;
          } else at += 1;
        }
        continue;
      }
      if ('{(['.includes(char)) depth += 1;
      else if ('})]'.includes(char)) depth -= 1;
      else if (char === ',' && depth === 0) break;
      at += 1;
    }
    found.push({ key: key[1] ?? key[2] ?? key[3] ?? '', value: body.slice(start, at).trim() });
  }
  return found;
}

/** A value that is one plain string literal — no interpolation, no expression. */
function isPlainString(value: string): boolean {
  if (value.startsWith('`')) return value.endsWith('`') && !value.includes('${');
  if (!value.startsWith("'") && !value.startsWith('"')) return false;
  const quote = value.charAt(0);
  // A concatenation or a `??` would leave something after the closing quote,
  // and prettier's own wrapping means the literal may span lines.
  let at = 1;
  while (at < value.length) {
    const here = value.charAt(at);
    if (here === '\\') at += 2;
    else if (here === quote) return at === value.length - 1;
    else at += 1;
  }
  return false;
}

interface Table {
  file: string;
  name: string;
  namespace: string | null;
  keys: string[];
}

function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * Every string-valued table in the client, and the namespace it declares if it
 * has one.
 *
 * *A directory walk rather than `git ls-files`*, unlike `route-callers.test.ts`
 * — and the difference is what each is protecting against. That one asks
 * *which routes does the repository contain*, where an untracked scratch file
 * is noise. This one asks *has anything escaped the catalogue*, where a file
 * somebody forgot to add is exactly the thing worth catching.
 */
const TABLES: Table[] = [];
for (const file of sourceFiles(SRC)) {
  const source = withoutComments(readFileSync(file, 'utf8'));
  const declaration =
    /^(?:export )?const ([A-Za-z_$][\w$]*)((?:[^=;])*?)=\s*(labels\(\s*'([^']+)'\s*,\s*)?\{/gm;
  let found: RegExpExecArray | null;
  while ((found = declaration.exec(source)) !== null) {
    const open = source.indexOf('{', declaration.lastIndex - 1);
    const close = closingBrace(source, open);
    if (close === -1) continue;
    const entries = entriesOf(source.slice(open + 1, close));
    if (entries === null || entries.length < 2) continue;
    if (!entries.every((entry) => isPlainString(entry.value))) continue;
    TABLES.push({
      file: relative(SRC, file).split(sep).join('/'),
      name: found[1] ?? '',
      namespace: found[4] ?? null,
      keys: entries.map((entry) => entry.key),
    });
  }
}

describe('the sweep is finished, and stays finished', () => {
  /**
   * ***The check the stage is actually for.***
   *
   * A label map written tomorrow, in a file that does not exist today, fails
   * here — which is the difference between a sweep that was done once and a
   * sweep that holds. The fix is one of two lines: wrap it in `labels()`, or
   * add it to `EXEMPT` with a sentence saying why it is not language.
   */
  it('has every string-valued table in the catalogue or in the exemption list', () => {
    const escaped = TABLES.filter(
      (table) => table.namespace === null && EXEMPT[`${table.file}:${table.name}`] === undefined,
    ).map((table) => `${table.file}:${table.name}`);
    expect(escaped).toEqual([]);
  });

  /** An exemption for a table that is gone is a sentence nobody will re-read. */
  it('has no exemption for a table that no longer exists', () => {
    const present = new Set(TABLES.map((table) => `${table.file}:${table.name}`));
    expect(Object.keys(EXEMPT).filter((one) => !present.has(one))).toEqual([]);
  });

  /** The instrument must be able to see something, or it is asserting nothing. */
  it('found the tables at all', () => {
    expect(TABLES.filter((table) => table.namespace !== null).length).toBeGreaterThan(30);
  });

  /**
   * ***One namespace, one source of English.***
   *
   * Two declarations of one namespace mean one translator entry and two English
   * sources, so an English copy-edit in one file leaves the other quietly
   * disagreeing with the catalogue — and disagreeing **only in English**,
   * because the translation follows the namespace. This is what
   * `library/gate-labels.ts` exists to satisfy: the sweep found that table
   * written out twice, and hoisting it was cheaper than explaining the
   * exception.
   */
  it('declares each namespace exactly once', () => {
    const seen = new Map<string, string[]>();
    for (const table of TABLES) {
      if (table.namespace === null) continue;
      seen.set(table.namespace, [...(seen.get(table.namespace) ?? []), table.file]);
    }
    expect([...seen].filter(([, files]) => files.length > 1)).toEqual([]);
  });
});

describe('a translation agrees with the English it translates', () => {
  const english = new Map(
    TABLES.filter((table) => table.namespace !== null).map((table) => [
      table.namespace ?? '',
      new Set(table.keys),
    ]),
  );

  /**
   * ***`note-labels.test.ts`'s orphan check, generalised.***
   *
   * That file fails the build when the client holds a sentence for a class
   * nothing emits. This is the same claim one level up: a translated key whose
   * English is gone is a string a translator spent time on that nobody will
   * ever see — and, worse, it is *invisible*, because the fallback means the
   * interface looks right either way. §12.1 makes a **missing** key fine
   * forever; an **extra** one is always a mistake.
   */
  it('translates no key and no namespace that English does not have', () => {
    const orphans: string[] = [];
    for (const [namespace, words] of Object.entries(MACHINE_FRENCH)) {
      const known = english.get(namespace);
      if (known === undefined) {
        orphans.push(namespace);
        continue;
      }
      for (const key of Object.keys(words)) {
        if (!known.has(key)) orphans.push(`${namespace}.${key}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  /**
   * *Deliberately partial, and asserted so.* A test French that crept up to
   * complete would stop exercising the fallback, which is the only thing it is
   * really for — so incompleteness is a property of this file rather than a
   * state it happens to be in.
   */
  it('is partial, which is the steady state the fallback exists for', () => {
    expect(Object.keys(MACHINE_FRENCH).length).toBeLessThan(english.size);
    const kinds = MACHINE_FRENCH['play.input-kind'] ?? {};
    expect(kinds['say.label']).toBeDefined();
    expect(kinds['say.hint']).toBeUndefined();
  });

  /** Every offered language has a catalogue behind it, and it loads. */
  it('offers only languages that load', async () => {
    for (const translation of TRANSLATIONS) {
      const loaded = await translation.load();
      expect(Object.keys(loaded).length).toBeGreaterThan(0);
    }
  });
});

describe('a label read through the catalogue', () => {
  const WORDS = labels('test.namespace', { here: 'Here', gone: 'Gone' });

  it('is English when no locale is active', () => {
    applyCatalogue('en', {});
    expect(WORDS.here).toBe('Here');
    expect(activeLocale()).toBe('en');
  });

  /**
   * ***Per key, silently.*** §12.1's sharpest instruction and the one a naive
   * implementation gets backwards: a namespace that is 50% translated renders
   * half in each language, with no placeholder, no `[MISSING]` and nothing on
   * the console. A test that only checked the translated key would pass against
   * an implementation that fell back **per namespace**, which is the bug.
   */
  it('falls back to English one key at a time', () => {
    applyCatalogue('fr-x-machine', { 'test.namespace': { here: 'Ici' } });
    expect(WORDS.here).toBe('Ici');
    expect(WORDS.gone).toBe('Gone');
    applyCatalogue('en', {});
  });

  /**
   * ***Asking whether a table knows a class must not depend on the locale.***
   * `note-labels.test.ts` asks exactly that — *does the client hold a sentence
   * for this class* — and a translation that happened to omit a key must not
   * make the class look unknown. The `has` trap is what makes it true; this is
   * what would notice if somebody removed it.
   */
  it('knows the same classes in every language', () => {
    applyCatalogue('fr-x-machine', { 'test.namespace': { here: 'Ici' } });
    expect('gone' in WORDS).toBe(true);
    expect(Object.keys(WORDS).sort()).toEqual(['gone', 'here']);
    applyCatalogue('en', {});
  });

  /** A catalogue for a namespace nobody declared changes nothing. */
  it('ignores a catalogue it has no table for', () => {
    applyCatalogue('fr-x-machine', { 'not.a.namespace': { here: 'Nulle part' } });
    expect(WORDS.here).toBe('Here');
    applyCatalogue('en', {});
  });
});
