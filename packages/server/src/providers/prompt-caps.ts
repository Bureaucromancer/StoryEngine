// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ProviderCapabilities } from './types.js';

/**
 * Capping a generated prompt — [19 §5.3](../../../../docs/design/19-tech-stack.md).
 *
 * **The failure this prevents is not an error, it is silence.** Hand an
 * endpoint more than it accepts and the common behaviour is that the request
 * succeeds, the tail is discarded, and the user gets a degraded image with
 * nothing to indicate why.
 *
 * Two numbers, not one, because they are different questions: a request-size
 * limit is *hard*, and CLIP's 77-token window is *useful* — many
 * implementations chunk past it and attention simply degrades. Conflating them
 * either wastes headroom or silently produces bad output.
 *
 * Three properties this file exists to give the rest of the engine:
 *
 * - **The cap is an input to generation, not a guillotine at send.** A step
 *   that writes an image prompt should be told its budget so it writes within
 *   it, which produces a good short prompt rather than a truncated long one.
 *   {@link budgetFor} is that half, and it is the one that matters.
 * - **Assembly is from ranked parts.** Over budget drops the lowest-ranked
 *   fragment whole, rather than cutting a sentence in half.
 * - **Never silently.** {@link CappedPrompt} says what was dropped and why, so
 *   the turn record can show it exactly as it shows a dropped context block —
 *   and library-time generation, which has no turn record, records it as field
 *   provenance instead.
 */

/**
 * One part of a composed prompt — subject, style, quality tags, a character
 * reference, a negative.
 *
 * `rank` is the order things are given up in: **lower goes first**. Equal ranks
 * drop in reverse order of appearance, so an author listing two style notes
 * loses the second before the first.
 */
export interface PromptFragment {
  id: string;
  text: string;
  rank: number;
  /**
   * A fragment the prompt is pointless without — the subject of an image.
   * Required fragments are never dropped; if they alone exceed the hard cap
   * the result says so rather than quietly cutting one.
   */
  required?: boolean;
}

export interface DroppedFragment {
  id: string;
  rank: number;
  reason: 'over-hard-cap' | 'over-useful-cap';
}

export interface CappedPrompt {
  /** The prompt as it will be sent. */
  text: string;
  /** In the order they were kept. */
  kept: string[];
  dropped: DroppedFragment[];
  /**
   * True when the kept text still exceeds the hard cap — which can only happen
   * if the required fragments alone do. The caller decides what to do about it;
   * this module will not cut a required fragment in half to hide the problem.
   */
  overCap: boolean;
  /** What was being aimed at, so a record can show the budget beside the result. */
  budget: PromptBudget;
}

export interface PromptBudget {
  /** What the endpoint accepts. Undefined means undeclared, not unlimited. */
  maxChars: number | undefined;
  /** Where quality degrades. Undefined means undeclared. */
  usefulChars: number | undefined;
}

/**
 * The budget to *tell a step about* before it writes.
 *
 * Deliberately returns both numbers rather than a single "limit": a step
 * writing an image prompt should aim at the useful one and know the hard one
 * exists, and collapsing them here would take that choice away from the only
 * code that knows what it is writing.
 */
export function budgetFor(capabilities: ProviderCapabilities): PromptBudget {
  return {
    maxChars: capabilities.maxPromptChars,
    usefulChars: capabilities.usefulPromptChars,
  };
}

/**
 * Assembles ranked fragments into a prompt that fits.
 *
 * Drops toward the *useful* cap first and only reports those drops as
 * `over-useful-cap`; if the result still exceeds the hard cap, it keeps
 * dropping and says `over-hard-cap`. The distinction is the whole point of
 * having two numbers — a record that showed both as one "too long" would lose
 * the difference between "this was trimmed for quality" and "this would have
 * been rejected".
 */
export function capPrompt(
  fragments: PromptFragment[],
  budget: PromptBudget,
  separator = ', ',
): CappedPrompt {
  const ordered = [...fragments];
  const dropped: DroppedFragment[] = [];

  // Lowest rank first, later-listed first within a rank: the order things are
  // given up in.
  const sacrificial = fragments
    .map((fragment, index) => ({ fragment, index }))
    .filter((entry) => entry.fragment.required !== true)
    .sort((a, b) => a.fragment.rank - b.fragment.rank || b.index - a.index);

  function render(kept: PromptFragment[]): string {
    return kept.map((fragment) => fragment.text).join(separator);
  }

  let kept = ordered;
  let sacrificeIndex = 0;

  function fits(limit: number | undefined): boolean {
    return limit === undefined || render(kept).length <= limit;
  }

  // The useful cap first, then the hard one. Two passes rather than one, so a
  // drop is attributed to the limit that actually caused it.
  for (const [limit, reason] of [
    [budget.usefulChars, 'over-useful-cap'] as const,
    [budget.maxChars, 'over-hard-cap'] as const,
  ]) {
    while (!fits(limit)) {
      const next = sacrificial[sacrificeIndex];
      if (next === undefined) break;
      sacrificeIndex += 1;
      kept = kept.filter((fragment) => fragment !== next.fragment);
      dropped.push({ id: next.fragment.id, rank: next.fragment.rank, reason });
    }
  }

  const text = render(kept);
  return {
    text,
    kept: kept.map((fragment) => fragment.id),
    dropped,
    overCap: budget.maxChars !== undefined && text.length > budget.maxChars,
    budget,
  };
}
