// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { estimateTokens } from '../assembly/assemble.js';
import type { Activation } from './activate.js';

/**
 * The **per-book** budget — [02 §3.2]'s inner tier, and its trim order.
 *
 * [P5 §1.3] is explicit that the two tiers are not one thing: per-book
 * `tokenBudget` and `entryLimit` are decided here, and the chat-wide cut stays
 * the budgeter's, *so every skip lands in the `BudgetVerdict` with the rule
 * that made it*. An entry can be blocked by either, and a person looking at a
 * prompt that is missing something needs to know which — *your book is full* and
 * *this turn is full* have different repairs, and one of them is not the
 * author's fault.
 *
 * ## The trim order is a specification, not a preference
 *
 * [02 §3.2] writes it out, and it is taken whole:
 *
 * > constants first, then entries matching the latest message, then normal
 * > injection order — and the scan continues past a skipped entry, so a small
 * > entry can still fit after a large one was dropped.
 *
 * Each clause earns its place:
 *
 * - **Constants first** because a constant is the author saying *this is always
 *   true of my world*. An entry that fires unconditionally being crowded out by
 *   one that matched a passing word is the budget inverting the author's own
 *   statement of what matters.
 * - **Latest-message matches next** because recency is the cheapest available
 *   proxy for relevance, and because an entry the player just named and did not
 *   get is the single most noticeable failure this system can have.
 * - **Injection order last**, which is the author's own `order` field — the tie
 *   is broken by the person who wrote the book rather than by the engine.
 * - **The scan continues past a skip**, which is the clause people get wrong.
 *   A first-fit that stopped at the first entry too large to fit would make one
 *   long entry silently delete every shorter entry behind it, and the symptom —
 *   *most of my lorebook stopped working* — points nowhere near the cause.
 *
 * ## Ties, and why they are broken twice
 *
 * The sort is total. Two entries at the same rank and the same `order` are
 * separated by their id, which is arbitrary and stable — the property that
 * matters, because an unstable tie-break means a prompt that changes between
 * two runs over identical inputs and a diff nobody can explain.
 */

/** Which of the book's two limits refused an entry. */
export type ShelfRule = 'token-budget' | 'entry-limit';

export interface Shelved {
  activation: Activation;
  tokens: number;
  /** Absent when it fits. */
  refusedBy?: ShelfRule;
}

export interface ShelfResult {
  /** Everything that fits, in the order it was considered. */
  kept: Shelved[];
  /** Everything the book's own limits refused, with which one did it. */
  refused: Shelved[];
  /**
   * Per book: what it spent, what it was allowed, and how many entries it kept.
   *
   * Reported even for a book that refused nothing, because *this book used 90
   * of its 2048 tokens* is the answer to **why is my budget not the problem**,
   * and a report that only appears when something went wrong cannot give it.
   */
  books: {
    bookId: string;
    tokenBudget: number;
    tokensSpent: number;
    entryLimit: number;
    entriesKept: number;
  }[];
}

/**
 * The rank an entry is trimmed at. Lower survives longer.
 *
 * Exported because [P5.8]'s tester has to *show* this — "your entry is third in
 * line" is the explanation, and a rank computed privately here and re-derived
 * there is two rules that will disagree.
 */
export function trimRank(activation: Activation, latestMessage: string): 0 | 1 | 2 {
  if (activation.entry.constant) return 0;
  return matchedTheLatestMessage(activation, latestMessage) ? 1 : 2;
}

/**
 * **Whether the key that fired it appears in the latest message specifically.**
 *
 * Re-checked against that one message rather than trusting the scan, because
 * the scan searched a `scanDepth` of them and cannot say *which*. Restricting
 * the question here keeps the rule this function's own: an entry promoted for
 * recency has to have actually matched something recent.
 *
 * A `sticky` or `recursive` activation has no key hit at all, and so is never
 * promoted — correctly. Stickiness is *already in the prompt and staying*, and
 * a recursive hit matched another entry's text rather than the player's words.
 */
function matchedTheLatestMessage(activation: Activation, latestMessage: string): boolean {
  const hit = activation.hit;
  if (hit?.source !== 'message') return false;
  return latestMessage.toLowerCase().includes(hit.key.toLowerCase());
}

export interface ShelfInput {
  activated: readonly Activation[];
  /**
   * The most recent message, for the second rank. Empty is legitimate — the
   * first turn of a session, or a call with no player input — and simply means
   * nothing earns the promotion.
   */
  latestMessage: string;
}

export function shelve(input: ShelfInput): ShelfResult {
  const kept: Shelved[] = [];
  const refused: Shelved[] = [];
  const spent = new Map<string, { tokens: number; entries: number }>();

  for (const activation of inTrimOrder(input.activated, input.latestMessage)) {
    const book = activation.book;
    const tokens = estimateTokens(activation.entry.content);
    const used = spent.get(activation.bookId) ?? { tokens: 0, entries: 0 };

    /**
     * **`entryLimit` is asked first**, and the order is observable: an entry
     * that is over both limits has to be reported against one of them, and the
     * count is the limit an author can act on without a token estimate in
     * front of them. *Your book allows 100 entries and 130 fired* is a
     * sentence somebody can check.
     */
    if (used.entries >= book.entryLimit) {
      refused.push({ activation, tokens, refusedBy: 'entry-limit' });
      continue;
    }
    if (used.tokens + tokens > book.tokenBudget) {
      /**
       * Refused, and **the loop goes on** — [02 §3.2]'s *the scan continues
       * past a skipped entry*. Nothing is marked as full, because a later,
       * smaller entry may still fit in what this one could not use.
       */
      refused.push({ activation, tokens, refusedBy: 'token-budget' });
      continue;
    }

    spent.set(activation.bookId, { tokens: used.tokens + tokens, entries: used.entries + 1 });
    kept.push({ activation, tokens });
  }

  const seen = new Map<string, Activation>();
  for (const activation of input.activated) {
    if (!seen.has(activation.bookId)) seen.set(activation.bookId, activation);
  }

  return {
    kept,
    refused,
    books: [...seen].map(([bookId, activation]) => ({
      bookId,
      tokenBudget: activation.book.tokenBudget,
      tokensSpent: spent.get(bookId)?.tokens ?? 0,
      entryLimit: activation.book.entryLimit,
      entriesKept: spent.get(bookId)?.entries ?? 0,
    })),
  };
}

/**
 * The order the budget walks — the documented one, made explicit rather than
 * left implied by a comparator buried in a loop.
 *
 * Exported for the same reason {@link trimRank} is: this list *is* the answer
 * to "what falls out next", which [02 §8]'s `nextToDrop` promises is answerable
 * before it happens.
 */
export function inTrimOrder(activated: readonly Activation[], latestMessage: string): Activation[] {
  return [...activated].sort((left, right) => {
    const rank = trimRank(left, latestMessage) - trimRank(right, latestMessage);
    if (rank !== 0) return rank;
    if (left.entry.order !== right.entry.order) return left.entry.order - right.entry.order;
    return left.entry.id < right.entry.id ? -1 : left.entry.id > right.entry.id ? 1 : 0;
  });
}
