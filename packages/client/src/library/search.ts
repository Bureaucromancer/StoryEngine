// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { LoreEntry } from '@storyengine/shared';

/**
 * Within-book search, which [05 §5.3](../../../../docs/design/05-ui-surfaces.md)
 * calls "the strongest fact in this section": the detail route already holds
 * the whole object, so filtering and highlighting across `name`, `keys`,
 * `secondaryKeys`, `description` and `content` is local, immediate, and needs
 * nothing from the server. Half of *searchable in its own right* was paid for
 * at P1 and never spent.
 *
 * **Substring, case-insensitively, and no regular expression anywhere.** Not a
 * simplification — a pattern compiled from something a person is still typing
 * is the same hazard [§1.10](../../../../docs/design/workplan/07-p5-implementation.md)
 * puts a hard timeout in front of at P5.4, and reaching for one here would put
 * it in a keystroke handler where there is nothing to time out. `indexOf` over
 * a lowercased copy is what the feature actually needs.
 *
 * **Which fields, exactly, is §5.3's list and not a judgement.** `content` is in
 * it, so a search finds prose as well as index terms; `keys` and
 * `secondaryKeys` are in it, so the thing an author typed to make an entry fire
 * is also the thing they can find it by.
 */

/** The fields §5.3 names, in the order it names them. */
function haystacks(entry: LoreEntry): string[] {
  return [entry.name, ...entry.keys, ...entry.secondaryKeys, entry.description, entry.content];
}

export function matches(haystack: string, query: string): boolean {
  if (query === '') return true;
  return haystack.toLowerCase().includes(query.toLowerCase());
}

/** Whether this entry answers the query at all. An empty query matches all. */
export function entryMatches(entry: LoreEntry, query: string): boolean {
  if (query === '') return true;
  return haystacks(entry).some((field) => matches(field, query));
}

/** One stretch of text, and whether it is part of what the reader searched for. */
export interface Run {
  text: string;
  hit: boolean;
}

/**
 * The text cut into runs, so a match can be marked without the caller doing
 * string surgery in JSX.
 *
 * Returns a single un-hit run for an empty query or a text with no match, which
 * is what lets a caller render through this unconditionally rather than
 * branching on whether a search is running.
 */
export function highlight(text: string, query: string): Run[] {
  if (query === '' || text === '') return [{ text, hit: false }];

  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const runs: Run[] = [];
  let cursor = 0;

  for (;;) {
    const at = hay.indexOf(needle, cursor);
    if (at === -1) break;
    if (at > cursor) runs.push({ text: text.slice(cursor, at), hit: false });
    runs.push({ text: text.slice(at, at + needle.length), hit: true });
    cursor = at + needle.length;
  }

  if (runs.length === 0) return [{ text, hit: false }];
  if (cursor < text.length) runs.push({ text: text.slice(cursor), hit: false });
  return runs;
}

/**
 * The same cut, driven by spans somebody else computed — [P5.8].
 *
 * `highlight` above finds its own occurrences of one query string. This takes
 * positions worked out by the **real matcher's** rules, which vary per entry
 * (whole-word, case) and cannot be re-derived from a single needle. Sharing the
 * `Run` shape is what lets one component render both.
 */
export function runsFor(text: string, spans: readonly { start: number; end: number }[]): Run[] {
  if (spans.length === 0) return [{ text, hit: false }];

  const runs: Run[] = [];
  let cursor = 0;
  for (const span of spans) {
    // Defensive against a span outside the text: the caller computes these from
    // the same string, but a run with a negative length would render as an
    // empty mark and be invisible rather than wrong-looking.
    if (span.start < cursor || span.end > text.length) continue;
    if (span.start > cursor) runs.push({ text: text.slice(cursor, span.start), hit: false });
    runs.push({ text: text.slice(span.start, span.end), hit: true });
    cursor = span.end;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), hit: false });
  return runs;
}
