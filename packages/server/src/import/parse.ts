// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * What every import parser returns, and the table of malformed inputs every one
 * of them is tested against
 * ([P4 §1.2](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **A status, never a throw.** The rule comes from
 * [manual gate §4.2](../../../../docs/design/workplan/11-p2-manual-gate.md) and it is not
 * a style preference: a sweep reads thousands of files it did not write, and a
 * parser that throws on the seventh one takes the other six thousand with it.
 * One poisoned file never aborts a sweep, and one poisoned *row* never aborts a
 * table — which is only true if refusing is an ordinary return value.
 */

/** Why a parser would not take something. Coarse on purpose: the review says which file, not which byte. */
export type ParseRefusal =
  /** Not JSON at all, or bytes that are not text. */
  | 'unreadable'
  /** Readable, but not the shape this parser is for — a string where an object was due. */
  | 'wrong-shape'
  /** The right shape with a required field missing or of the wrong type. */
  | 'missing-field';

export type ParseOutcome<T> =
  { ok: true; value: T } | { ok: false; refusal: ParseRefusal; field?: string };

export function parsed<T>(value: T): ParseOutcome<T> {
  return { ok: true, value };
}

export function refused<T>(refusal: ParseRefusal, field?: string): ParseOutcome<T> {
  return field === undefined ? { ok: false, refusal } : { ok: false, refusal, field };
}

/**
 * ***A table's own entry, or nothing*** (2026-09-27).
 *
 * The converters look foreign strings up in tables of their own — a macro's
 * name, a marker's type, a lorebook's logic, a file's table name — and a plain
 * index walks the prototype: `constructor` finds `Object`, and `__proto__` finds
 * `Object.prototype`. So a SillyTavern prompt identified as `constructor` became
 * a slot whose source was a function, failed validation, and lost the whole
 * preset with nothing in the review saying why. `sillytavern/reader.ts` fixed
 * its one instance; this is the rule for all of them.
 */
export function ownEntry<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * The malformed inputs every parser is driven through.
 *
 * **The interesting members are the last ones.** `null` and a bare string are
 * the cases anybody writes a guard for. An object of the right shape *missing
 * one required field* is the one that parses-but-is-wrong — it survives a
 * `typeof x === 'object'` check and produces an object with `undefined` where a
 * name should be, which then reaches the library as a nameless actor rather than
 * as a refusal. That is the class this table exists for, and it is why the valid
 * example is a parameter: the table is generated from what the parser actually
 * wants rather than from what a test author remembered.
 */
export function malformedInputs(
  valid: Record<string, unknown>,
  required: readonly string[],
): { label: string; input: unknown }[] {
  return [
    { label: 'null', input: null },
    { label: 'undefined', input: undefined },
    { label: 'a string', input: 'not an object' },
    { label: 'a number', input: 7 },
    { label: 'an array', input: [valid] },
    { label: 'an empty object', input: {} },
    ...required.map((field) => ({
      label: `an object missing ${field}`,
      input: withoutField(valid, field),
    })),
    ...required.map((field) => ({
      label: `an object whose ${field} is null`,
      input: { ...valid, [field]: null },
    })),
  ];
}

function withoutField(object: Record<string, unknown>, field: string): Record<string, unknown> {
  // Rebuilt rather than copied-and-deleted: a dynamic `delete` is a lint error
  // here, and filtering says the same thing without asking whether the key was
  // an own property.
  return Object.fromEntries(Object.entries(object).filter(([key]) => key !== field));
}
