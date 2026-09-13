// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { LoreEntry } from './schema/lorebook.js';

/**
 * The part of key matching that is pure string work — [P5.8].
 *
 * **It moved here so that two surfaces cannot answer differently**, which is
 * the same move [P5.7] made with `entryGate` and for the same reason: the
 * retriever decides whether a key hits, and the book page's inline highlighting
 * claims to show *what the scanner sees*. Two implementations of one rule
 * disagree eventually, and this one has three flags to disagree about.
 *
 * ## What deliberately did not move
 *
 * **The regex arm.** [P5.4] runs patterns inside `node:vm` under a 50ms
 * timeout, because an imported book can carry a catastrophic pattern and
 * running one unbounded is a denial of service on your own server. A browser
 * has no equivalent: `new RegExp(…).test(…)` on the main thread cannot be
 * interrupted, so the same pattern would hang the tab instead. The client
 * therefore does not evaluate `useRegex` keys at all and says so, which is a
 * principled refusal rather than a missing feature — the surface that cannot
 * bound a computation should not start one.
 *
 * **`mentions.ts` keeps its own rule**, and that is not an oversight either.
 * [10 §5.3] argues it into one stated rule — whole-word matching, no
 * per-entry flags — because a *list* that approximated thirty rule sets would
 * be pretending to be the matcher, and because it is [11 §6]'s falsification
 * instrument, where changing the rule changes what the measurement means. The
 * list and the highlight can therefore disagree, and the disagreement is
 * informative: the list says a name appears, the highlight says whether the
 * scanner would catch it.
 */

/** Characters that count as being inside a word, for whole-word matching. */
const WORD = /[\p{L}\p{N}_]/u;

/**
 * ***Where something is in a text, and nothing about what*** — named at
 * [P7.7](../../../docs/design/workplan/23-p7-implementation.md), where three
 * functions in this file had been returning it anonymously since P5.8.
 *
 * **[P7 §1.7] is the reason it gets a name rather than a rename.** That section
 * prices the span obligation precisely: *"the obligation is free if the shared
 * scanner's return type is widened in the same change and expensive if the
 * tagged type is bolted on beside an untagged one that three functions already
 * produce."* This is the widening — the geometry, alone, so `TextSpan` in
 * `turn.ts` is *this plus what it points at* rather than a second shape that
 * happens to have the same two numbers.
 *
 * **Half-open, like every offset pair in this file**: `start` is the first
 * character and `end` the one after the last, so `end - start` is the length and
 * `text.slice(start, end)` is the match.
 */
export interface Span {
  start: number;
  end: number;
}

export function isWordCharacter(character: string): boolean {
  return character !== '' && WORD.test(character);
}

/**
 * Every position a literal term occupies in a haystack, optionally at word
 * boundaries.
 *
 * **Written out rather than built as a `\b`-anchored pattern**, for two
 * reasons. `\b` in JavaScript is ASCII-only unless the pattern is Unicode, so a
 * key in any other script would stop matching at a boundary it should have; and
 * a term has to be escaped before it can go in a pattern at all, which is one
 * more place to get user text wrong in a module whose whole subject is not
 * doing that.
 *
 * The boundary test is that the characters immediately outside the match are
 * not word characters — so `docks` does not match inside `dockside`, and a term
 * that itself begins with punctuation still behaves.
 *
 * **Overlaps are not returned.** The search resumes past each hit, so `aa` in
 * `aaa` is one span rather than two. A highlight of two overlapping spans is
 * one highlight on screen, and a caller counting hits wants occurrences rather
 * than offsets.
 */
export function literalSpans(
  haystack: string,
  term: string,
  options: { wholeWords: boolean; caseSensitive: boolean },
): Span[] {
  if (term === '' || haystack === '') return [];

  /**
   * Folded copies, and the **offsets are still the original's**, which is the
   * property the caller needs: it slices the text it was given, not a
   * lower-cased shadow of it. Safe because `toLowerCase` is length-preserving
   * for every case pair this can meet in practice; the alternative — folding
   * per candidate position — would be right in the pathological cases and far
   * slower in all the others.
   */
  const hay = options.caseSensitive ? haystack : haystack.toLowerCase();
  const needle = options.caseSensitive ? term : term.toLowerCase();

  const spans: Span[] = [];
  let at = hay.indexOf(needle);
  while (at !== -1) {
    const before = at === 0 ? '' : hay.charAt(at - 1);
    const after = hay.charAt(at + needle.length);
    const bounded = !isWordCharacter(before) && !isWordCharacter(after);
    if (!options.wholeWords || bounded) {
      spans.push({ start: at, end: at + needle.length });
      at = hay.indexOf(needle, at + needle.length);
    } else {
      at = hay.indexOf(needle, at + 1);
    }
  }
  return spans;
}

/** Whether a literal term appears at all — the boolean the retriever asks for. */
export function containsTerm(haystack: string, term: string, wholeWords: boolean): boolean {
  return literalSpans(haystack, term, { wholeWords, caseSensitive: true }).length > 0;
}

/**
 * Every span in a text that this entry's own **literal** keys would hit.
 *
 * `useRegex` entries return nothing, which the caller is expected to report
 * rather than hide — see this module's header for why a browser must not run
 * one. Both key lists are read: a secondary key is still a thing the scanner
 * looks for, and a highlight that showed only the primaries would be a partial
 * answer wearing a complete one's clothes.
 */
export function entrySpans(entry: LoreEntry, text: string): Span[] {
  if (entry.useRegex) return [];

  return [...entry.keys, ...entry.secondaryKeys].flatMap((key) =>
    literalSpans(text, key, {
      wholeWords: entry.matchWholeWords,
      caseSensitive: entry.caseSensitive,
    }),
  );
}

/**
 * Overlapping spans merged into the runs a surface can render.
 *
 * Two keys hitting the same words — `harbour` and `the harbour` — are one
 * highlight, and nested `<mark>` elements would render as a darker patch that
 * looks like a third kind of match.
 */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((left, right) => left.start - right.start);
  const merged: Span[] = [];

  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}
