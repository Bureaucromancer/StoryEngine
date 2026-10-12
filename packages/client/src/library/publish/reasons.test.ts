// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ClosureRule } from '@storyengine/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { REASON_LABELS, reasonFor } from './reasons.js';

/**
 * ***Every rule the walker can follow has a sentence*** —
 * [P16.3g](../../../../../docs/design/workplan/34-p16-world.md), and the
 * promise `shared/src/publish.ts` makes for its `ClosureRule` union: *"a rule
 * added here with no sentence there is a compile error rather than a dotted
 * string on screen."*
 *
 * **Twice, because each half can be skipped without the other noticing.** The
 * type is the compile error — `REASON_LABELS` is declared
 * `Record<ClosureRule, string>`, and this file asserts that declaration with
 * `expectTypeOf`, which the spec typecheck reads. The run is the same claim
 * against the union **as written in `shared`**, read from its source, so a
 * build that ran the tests and not the typecheck still fails on a rule with
 * no words — and so does a `REASON_LABELS` widened to `Record<string, …>` by
 * somebody silencing the compiler.
 */

const PUBLISH = join(import.meta.dirname, '..', '..', '..', '..', 'shared', 'src', 'publish.ts');

/**
 * The union's members, read from the source between `export type ClosureRule =`
 * and the member that ends it — `'…';`, since the comments inside the union
 * hold semicolons of their own.
 */
function rulesInShared(): string[] {
  const source = readFileSync(PUBLISH, 'utf8');
  const start = source.indexOf('export type ClosureRule =');
  const last = /'[a-zA-Z.]+';/g;
  last.lastIndex = start;
  const end = (last.exec(source)?.index ?? start) + 1;
  // Comments inside the union carry quoted words of their own; only a member
  // starts a line with `|`.
  return [...source.slice(start, end + 40).matchAll(/^\s*\|\s*'([a-zA-Z.]+)'/gm)].map(
    (match) => match[1] ?? '',
  );
}

describe('a sentence for every rule', () => {
  it('is required by the type', () => {
    expectTypeOf(REASON_LABELS).toEqualTypeOf<Readonly<Record<ClosureRule, string>>>();
  });

  it('is there for every member of the union as shared writes it, and for nothing else', () => {
    const rules = rulesInShared();
    // The table's thirteen rows and a query, read per field: twenty-five rules.
    expect(rules.length, 'the union was not found in shared/src/publish.ts').toBeGreaterThan(20);
    const labelled = Object.keys(REASON_LABELS).sort();
    expect(labelled).toEqual([...rules].sort());
    for (const rule of rules) {
      const sentence = (REASON_LABELS as Readonly<Record<string, string>>)[rule] ?? '';
      expect(sentence.trim(), rule).not.toBe('');
      expect(sentence, rule).not.toContain(rule);
    }
  });

  it('names what names it, for every rule that is an edge from a node', () => {
    const fromTheStart = new Set(['selected', 'world.member', 'world.scopedBook']);
    for (const rule of rulesInShared()) {
      const said = reasonFor({ rule: rule as ClosureRule }, 'Rain');
      if (fromTheStart.has(rule)) expect(said, rule).not.toContain('{from}');
      else expect(said, rule).toContain('“Rain”');
    }
  });
});

/**
 * ***`session.cast.arrived`, worded as the walker computes it*** — [P16.3b]'s
 * correction of row 13, and the arm's own docstring: the rule is *in play
 * through channel state and not in the configured cast*, which is also true of
 * somebody taken off the roster or a former persona. A sentence promising an
 * arrival would be false of them.
 */
describe('the played cast’s other half', () => {
  it('says in play, not in the configured cast, and promises no arrival', () => {
    const said = reasonFor({ rule: 'session.cast.arrived' }, 'Night one');
    expect(said).toContain('In play in the session “Night one”');
    expect(said).toContain('not in its configured cast');
    expect(said.toLowerCase()).not.toMatch(/arriv|walked in/);
  });

  it('reads apart from the configured cast', () => {
    expect(reasonFor({ rule: 'session.cast.actors' }, 'Night one')).not.toBe(
      reasonFor({ rule: 'session.cast.arrived' }, 'Night one'),
    );
  });
});
