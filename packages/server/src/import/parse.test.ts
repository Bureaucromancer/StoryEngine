// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { malformedInputs, parsed, refused, type ParseOutcome } from './parse.js';

/**
 * **The harness is tested before it has a customer**, because a harness that
 * cannot fail is worse than none: every parser written against it afterwards
 * would inherit a green light it never earned.
 *
 * So there are two parsers here — one that obeys the contract and one that does
 * not — and the assertions below are the ones each parser's own test file will
 * make. If they do not separate these two, they will not separate anything.
 */

interface Row {
  id: string;
  name: string;
}

const VALID: Record<string, unknown> = { id: 'row-1', name: 'Vera Solano', extra: 1 };
const REQUIRED = ['id', 'name'] as const;

/** What an import parser is supposed to look like. */
function goodParser(input: unknown): ParseOutcome<Row> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return refused('wrong-shape');
  }
  const record = input as Record<string, unknown>;
  for (const field of REQUIRED) {
    if (typeof record[field] !== 'string') return refused('missing-field', field);
  }
  return parsed({ id: record['id'] as string, name: record['name'] as string });
}

/**
 * The failure mode the table exists to catch, and it is not "throws on null".
 * This one guards the obvious cases and then trusts the shape — so an object
 * missing `name` parses into a row whose name is `undefined`, and a nameless
 * actor reaches the library instead of a line in the review.
 */
function parsesButIsWrong(input: unknown): ParseOutcome<Row> {
  if (typeof input !== 'object' || input === null) return refused('wrong-shape');
  return parsed(input as Row);
}

describe('the malformed-input table', () => {
  it('includes the cases nobody writes a guard for', () => {
    const labels = malformedInputs(VALID, REQUIRED).map((entry) => entry.label);

    expect(labels).toContain('an object missing name');
    expect(labels).toContain('an object whose id is null');
    // And the ordinary ones, so the table is a superset rather than a swap.
    expect(labels).toContain('null');
    expect(labels).toContain('an array');
  });

  it('leaves the valid example untouched, so one table can drive many parsers', () => {
    malformedInputs(VALID, REQUIRED);

    expect(VALID).toEqual({ id: 'row-1', name: 'Vera Solano', extra: 1 });
  });
});

describe('a parser that obeys the contract', () => {
  for (const { label, input } of malformedInputs(VALID, REQUIRED)) {
    it(`answers with a status for ${label}`, () => {
      expect(() => goodParser(input)).not.toThrow();
      expect(goodParser(input).ok).toBe(false);
    });
  }

  it('still takes the valid row, and ignores fields it does not know', () => {
    expect(goodParser(VALID)).toEqual({ ok: true, value: { id: 'row-1', name: 'Vera Solano' } });
  });
});

describe('the harness separates a real parser from a plausible one', () => {
  it('catches the parser that guards the shape and trusts the fields', () => {
    const survivors = malformedInputs(VALID, REQUIRED).filter(
      (entry) => parsesButIsWrong(entry.input).ok,
    );

    // Not zero — that is the whole point. These are the inputs it accepted and
    // should not have, and any real parser's table would fail on exactly them.
    expect(survivors.map((entry) => entry.label)).toEqual([
      // `typeof [] === 'object'`, which is the oldest trap in the language and
      // still catches a guard written in a hurry.
      'an array',
      'an empty object',
      'an object missing id',
      'an object missing name',
      'an object whose id is null',
      'an object whose name is null',
    ]);
  });
});
