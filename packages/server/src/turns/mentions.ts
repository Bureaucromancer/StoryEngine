// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { literalSpans, type Span, type TextSpan } from '@storyengine/shared';

/**
 * Who the turn's text was about — [06 §8.2](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [03 §8](../../../../docs/design/03-data-model.md),
 * [10 §13.1](../../../../docs/design/10-ui-surfaces.md), built at
 * [P7.7](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***An overlay, never a rewrite.*** 06 §8.2 is explicit — *"spans on the turn
 * record, never a rewrite of the message text"* — so the prose a model wrote is
 * what it wrote, and what the engine understood about it sits beside it.
 *
 * **The same scanner the retriever uses**, which is §P7.7's own requirement:
 * *"sharing P5's keyword scanner so highlighting and inclusion reasons cannot
 * disagree about who **the fixer** is."* `literalSpans` is that scanner and both
 * passes call it.
 *
 * ***What is shared is the rule, not the scan***, and the distinction is worth
 * stating because the obvious reading is wrong: the retriever matches over a
 * **window** of messages it assembled and sliced by `scanDepth`, so its offsets
 * address that haystack and could not address this turn's text. Two passes over
 * two texts, one implementation of what counts as a match — which is all
 * *cannot disagree* ever needed, and is why [P7.7] widened `KeyHit` for
 * [P5.8]'s keyword tester rather than for this.
 *
 * **Two methods at 1.0 and the third deliberately absent.** [10 §13.1] names
 * `explicit`, `matched` and `proposed`; §P7.7 ships the first two and says why —
 * *"`proposed` may follow, but the span overlay and the never-auto-create rule
 * land now"*. A `proposed` span asserts somebody the session does not have, and
 * **auto-materialising on first mention is precisely the failure the feature
 * exists to make visible**.
 */

/** An actor as the scan sees them: an id, and every surface form that names them. */
export interface Mentionable {
  actorId: string;
  name: string;
  /**
   * `name` first, then `aliases` — [04 §5] calls the alias list *"also the
   * default keyword set for lore matching"*, which is the same set a mention
   * scan wants and the reason this needs no second vocabulary.
   */
  terms: readonly string[];
}

/**
 * Every span in one text that names somebody the session has.
 *
 * **`matched`, because a scanner found it** — [10 §13.1] renders the methods
 * differently on purpose: *"a tentative match that looks certain is worse than
 * no highlighting."* Nothing here is tentative; a literal alias either occurs or
 * does not, which is also why `confidence` is null rather than 1.
 *
 * ***Whole words, always, and the rule is stated rather than configurable.***
 * An actor is not a `LoreEntry` and carries none of its three matching flags, so
 * this cannot inherit them — and the honest default is the one
 * `packages/shared/src/mentions.ts` already argues for at length: *"the rule is
 * whole-word matching and nothing else"*, so a short alias produces a long list
 * and that is the file being what it is rather than this module hiding it.
 *
 * *Case-insensitive*, which differs from that module and is right here: an
 * actor's alias is a **name**, and a narrator writing it at the start of a
 * sentence has not named somebody else.
 *
 * **Longest first, and overlaps dropped.** *Vera Kohl* and *Vera* both hit the
 * same words; two spans there would be two highlights over one name, and the
 * longer is the more specific claim about who was meant.
 */
export function mentionSpans(
  text: string,
  field: TextSpan['field'],
  cast: readonly Mentionable[],
): TextSpan[] {
  const found: { span: Span; actorId: string; name: string }[] = [];

  for (const person of cast) {
    // Longest first *within* a person too, so *Vera Kohl* wins over *Vera* for
    // the same actor before the overlap filter ever sees them.
    const terms = [...new Set(person.terms)]
      .filter((term) => term.trim() !== '')
      .sort((left, right) => right.length - left.length);

    for (const term of terms) {
      for (const span of literalSpans(text, term, { wholeWords: true, caseSensitive: false })) {
        found.push({ span, actorId: person.actorId, name: person.name });
      }
    }
  }

  found.sort(
    (left, right) =>
      left.span.start - right.span.start ||
      right.span.end - right.span.start - (left.span.end - left.span.start),
  );

  const kept: TextSpan[] = [];
  let reached = -1;
  for (const hit of found) {
    // Dropped rather than merged: `mergeSpans` joins geometry, and two names
    // welded into one span would point at one actor over both — which is a
    // claim about the text that nothing made.
    if (hit.span.start < reached) continue;
    reached = hit.span.end;
    kept.push({
      field,
      start: hit.span.start,
      end: hit.span.end,
      target: { kind: 'actor', ref: { id: hit.actorId, name: hit.name } },
      method: 'matched',
      confidence: null,
    });
  }
  return kept;
}

/**
 * Whether a span names this actor — the predicate [P7.5]'s provisional firing
 * waits on.
 *
 * [06 §6.1]: an introduction hook is *"recorded provisionally fired and becomes
 * fired only when the extract stage confirms the subject present on that turn;
 * unconfirmed, it returns to the pool with the attempt on the record."* This is
 * the confirmation, and it is a **read of the overlay** rather than a second
 * scan — so the panel's highlight and the hook's confirmation are the same
 * finding by construction.
 */
export function namedIn(spans: readonly TextSpan[], actorId: string): boolean {
  /**
   * **No `kind === 'actor'` guard, and its absence is a note rather than an
   * oversight.** `SpanTarget` has one arm at 1.0, so the check is always true
   * and the lint rule says so — but the tag exists for the arms [13 §13] adds
   * at 2.0, and when the second one lands `ref` stops existing on the union and
   * **the compiler puts the guard back**. Writing it early to satisfy a reader
   * would mean disabling a rule that is correct today.
   */
  return spans.some((span) => span.target.ref.id === actorId);
}
