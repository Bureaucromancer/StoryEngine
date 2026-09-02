// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newLoreEntry } from '@storyengine/shared';

import { formatCount } from '../format.js';
import type { FieldGroup, FieldRow } from './fields.js';

/**
 * **What in this entry is not at its default** — the one computation the
 * closed-section invariant needs
 * ([05 §11.2d](../../../../docs/design/05-ui-surfaces.md)):
 *
 * > A closed section must name what is inside it that is not at its default.
 * > *Matching (3 set)*. *Timing (sticky 4)*.
 *
 * That invariant is what makes progressive disclosure compatible with
 * [05 §2.1](../../../../docs/design/05-ui-surfaces.md)'s refusal of hidden
 * fields, and [P5.1](../../../../docs/design/workplan/07-p5-implementation.md)
 * calls it *the part not to cut*. A collapse that conceals a non-default value
 * **is** a hidden field; a collapse that advertises one is a summary.
 *
 * **The default is the factory, and there is no second list of defaults.**
 * `newLoreEntry` is documented as *"a lore entry with the doc's stated defaults
 * ([10 §5])"* and it is already what creating an entry calls — so the entry this
 * editor makes and the entry this module measures against are the same object,
 * and they cannot drift into disagreeing about what *default* means. A
 * hand-written table here would be the second description that
 * [fields.ts](./fields.ts) exists to prevent, one layer along. A field added to
 * the schema therefore arrives with a default already, because adding it to the
 * factory is what makes a `LoreEntry` valid at all.
 */

/** One field whose value is not the one a fresh entry carries. */
export interface OffDefault {
  key: string;
  label: string;
  value: unknown;
}

/**
 * A fresh entry, made once.
 *
 * Lazily rather than at module scope, and memoised rather than per call:
 * `newLoreEntry` mints a uuid, so calling it per field would be thirty
 * identifiers for a comparison that never looks at `id`. The name is empty
 * because it is not compared either — `name` is un-bannered, so it belongs to
 * the head group, which [05 §11.2d] leaves always open and which therefore
 * never carries a summary.
 */
let fresh: Record<string, unknown> | undefined;
function defaults(): Record<string, unknown> {
  fresh ??= newLoreEntry('') as unknown as Record<string, unknown>;
  return fresh;
}

/**
 * Whether two field values are the same fact.
 *
 * `JSON.stringify` rather than a deep compare written here, and the two things
 * that usually make that a mistake are both absent. **Key order** cannot
 * differ, because every object-valued field on a `LoreEntry` defaults to `null`
 * or `{}` — an entry carrying an object where the default is `null` differs
 * whatever its key order, and `metadata` with keys in it differs from `{}` for
 * the same reason. And **`undefined` survives the round trip as itself**, so an
 * absent optional (`stateSchema`, `extensionActivations`) compares equal to an
 * absent one and unequal to a present one, which is what the schema means by
 * optional.
 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The rows among these whose value differs from a fresh entry's, in the
 * schema's own order.
 *
 * Takes rows rather than a group so the caller decides what is in scope: `id`
 * and `name` differ from a fresh entry's by construction, and it is the head
 * group's exemption from ever being collapsed — not a rule here — that keeps
 * them out of every summary.
 */
export function offDefaults(rows: readonly FieldRow[], entry: unknown): OffDefault[] {
  if (typeof entry !== 'object' || entry === null) return [];
  const held = entry as Record<string, unknown>;
  const base = defaults();

  return rows
    .filter((row) => !same(held[row.key], base[row.key]))
    .map((row) => ({ key: row.key, label: row.label, value: held[row.key] }));
}

/**
 * Longer than this and one field has made the summary longer than the heading
 * it annotates, which is where a summary stops being one. Only `group`,
 * `outletName` and `tag` are free strings inside a group at all, and all three
 * are short by nature; the cap is for the hand-edited file, which this
 * repository assumes rather than hopes against.
 */
const MAX_VALUE_CHARS = 24;

/**
 * One off-default field, as the words that name it.
 *
 * The label is lowercased at its first letter only, which reverses exactly what
 * [fields.ts](./fields.ts)'s `labelFor` did to the property name — so the word
 * stays the schema's, mid-sentence, with no second table of them.
 *
 * **The value is appended as a value, never as a plural.** *keys 3* rather than
 * *3 keys*, which reads as the same field-and-value pair every other token here
 * is and, not incidentally, has no singular to get wrong: a rule that produced
 * *1 keys* would be one that has to grow a plural table, and a plural table is
 * the thing [01 §2](../../../../docs/design/workplan/01-work-plan.md)'s i18n
 * discipline is about. A boolean names itself when it is on and takes *off*
 * when it is not, because a field is listed here only *because* it is not at
 * its default — so *use regex* already says the whole thing, and *match whole
 * words* alone would not.
 */
function token(row: OffDefault): string {
  const named = row.label.charAt(0).toLowerCase() + row.label.slice(1);
  const value = row.value;

  if (typeof value === 'boolean') return value ? named : `${named} off`;
  if (typeof value === 'number' && Number.isFinite(value)) return `${named} ${formatCount(value)}`;
  if (typeof value === 'string' && value !== '')
    return value.length > MAX_VALUE_CHARS ? `${named} set` : `${named} ${value}`;
  if (Array.isArray(value))
    return value.length === 0 ? `${named} none` : `${named} ${formatCount(value.length)}`;
  if (value === null || value === undefined) return `${named} not set`;
  return `${named} set`;
}

/**
 * A closed group's heading with everything inside it that is not at its
 * default — the whole phrase, in one place.
 *
 * **One string rather than a title and an annotation rendered beside each
 * other**, which is what the assembly rule asks for in its own words (*keep
 * helpers like `revisionLabel(n)` for the whole phrase rather than half of it*)
 * and what its JSX arm would report if the two were put next to each other in
 * an element.
 *
 * **Every off-default field is named, and that is a departure from the
 * illustration in [05 §11.2d] rather than from its rule.** The rule says *name
 * what is inside it that is not at its default*, and the section's own gloss
 * puts the standard at the value: *a collapse that conceals a non-default value
 * is a hidden field*. The illustration *Matching (3 set)* is a count, and a
 * count conceals every one of the three — an entry running `useRegex` under a
 * heading that says only *3 set* has exactly the surprising behaviour §11.2d
 * exists to make discoverable, and [05 §2.1] forbids a *lossy summary* by name.
 * So *Timing (sticky 4)* is reproduced exactly and *Matching (3 set)* comes out
 * as the fields it stood for.
 *
 * **A group with nothing set says so** rather than showing a bare title, on the
 * same argument [polish §1] settled one level down for empty fields: silence
 * cannot be told apart from *this surface does not annotate*, and the whole
 * purpose of the line is to answer *is it safe to leave this closed*.
 */
export function groupSummary(group: FieldGroup, entry: unknown): string {
  const title = group.title;
  if (title === null) return '';

  const off = offDefaults(group.fields, entry);
  if (off.length === 0) return `${title} (all at default)`;
  return `${title} (${off.map(token).join(', ')})`;
}
