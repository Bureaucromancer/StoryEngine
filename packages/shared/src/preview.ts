// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { AssembledBlock, BudgetVerdict, CallPurpose, NotFilledSlot } from './turn.js';

/**
 * What a turn *would* assemble to, if it were taken now — [P3.4], [P3 §1.6].
 *
 * **Not a record, and never written to disk.** That is why it lives here
 * rather than in `turn.ts`: putting it beside the record would invite somebody
 * to store one, and the whole argument of §1.6 is that the preview holds no
 * state — no job, no draft, no record, no head. It is a question the client
 * asks and an answer it renders, and both ends of that need the same three
 * shapes the record already defines.
 *
 * The client cannot compute this. [P3 §5] draws the line: *no assembly logic
 * in the client* now also means **the panel never recomputes what a dry run
 * would produce — it asks the server**, and the estimator that decides is a
 * server function over blocks the client never sees whole.
 */

/**
 * Why a preview has no numbers.
 *
 * A class rather than a sentence, so the surface phrases it and the server's
 * own English stays server-side — the same rule `NotFilledReason` follows.
 * These are answers, not errors: *nothing is bound to the prose role* is a
 * true reply to *how full is the context*, which is why the route serves them
 * with a 200.
 */
export type UnmeasurableReason = 'role-unbound' | 'role-dangling' | 'no-prose-step';

/**
 * What the retriever did, and — mostly — what it declined to do.
 *
 * **This is the whole substance of [P5.8]'s keyword tester**, which [05 §3]
 * describes as *paste sample text, see which entries would fire*, generalised
 * to the whole assembly. The tester needs no endpoint of its own: sample text
 * *is* an input, so it previews with it, and what it renders is this.
 *
 * **The refused half is the half that matters.** An entry that fired is
 * already legible — it is a block in the block table with a reason beside it.
 * Nothing anywhere could say why an entry did *not*, and *my lorebook never
 * fires* is, per PLAYABLE, the complaint this stage exists to end. Sixteen
 * reasons reach here because each is a different piece of advice.
 *
 * Carried on **both** preview arms, for `notFilled`'s reason: the scan runs
 * before a model is resolved, so an install with nothing bound still has a
 * complete answer to *why is my world not appearing* — and an unconfigured
 * install is exactly where somebody is asking it.
 */
export interface LoreReport {
  /** Books in play, and which selection put each one there. */
  books: LoreBookRow[];
  /**
   * Every entry that did not fire, with the rule that stopped it.
   *
   * Not truncated here. A surface may cap what it *shows*, but a report that
   * arrived pre-trimmed could not offer *and 40 more* honestly, and the count
   * is often the useful part on its own.
   */
  skipped: LoreSkipRow[];
  /** Patterns that could not be run — [P5.4]'s timeout and its refusals. */
  refused: { entryId: string; entryName: string; key: string; reason: string }[];
  /**
   * Sources entries asked to scan that nothing supplied.
   *
   * An entry looking somewhere that does not exist never fires and looks
   * exactly like an entry whose keys are wrong, which is the case this list
   * exists to separate.
   */
  unknownSources: string[];
}

export interface LoreBookRow {
  bookId: string;
  bookName: string;
  /**
   * Why this book is being scanned. **Selection is the only route** — this
   * session named it, or the treatment this session names links it. A book
   * nobody selected is not in the prompt, whatever its own fields say.
   */
  by: 'treatment' | 'session';
  /** What its own two limits allowed and what they spent — [02 §3.2]. */
  tokenBudget: number;
  tokensSpent: number;
  entryLimit: number;
  entriesKept: number;
}

export interface LoreSkipRow {
  bookId: string;
  entryId: string;
  entryName: string;
  /**
   * The `SkipReason` as a class, phrased by the surface.
   *
   * A string rather than a union in this file, and deliberately open: the
   * server's list will grow — `semantic` and channel predicates are both
   * scheduled — and a client pinned to today's sixteen would have to be
   * redeployed in step with the server to keep rendering a report. It falls
   * back to showing the class itself, which is ugly and true.
   */
  reason: string;
  /** Named when `reason` is the folder gate — [P5.7]. The outermost shut one. */
  folder?: { id: string; name: string };
}

interface PreviewCommon {
  /** The turn this was assembled against — what a submission would name as its parent. */
  headTurnId: string | null;
  /**
   * Whether an action or guidance was supplied.
   *
   * The panel chooses on this: a preview of *something being composed* is what
   * it shows in place of the head turn, and a preview of an empty composer is
   * the honest at-rest reading that must not displace the record.
   */
  pendingInput: boolean;
  /**
   * What the preset's collection left unfilled — carried on **both** arms.
   *
   * *Why is there no lore in this prompt* is answerable without a model
   * ([P3.0] §7.5), and an install with nothing bound is exactly where somebody
   * is most likely to be asking.
   */
  notFilled: NotFilledSlot[];
  /** What the retriever found and refused — [P5.8]. See {@link LoreReport}. */
  lore: LoreReport;
}

export interface AssembledPreview extends PreviewCommon {
  state: 'assembled';
  /** Which step was previewed — the prose call, and it says so rather than being assumed. */
  stepId: string;
  callKind: string;
  purpose: CallPurpose;
  /** The model that *would* be asked. Nothing has answered. */
  resolved: { connectionId: string; modelId: string };
  blocks: AssembledBlock[];
  budget: BudgetVerdict;
}

export interface UnmeasurablePreview extends PreviewCommon {
  state: 'unmeasurable';
  reason: UnmeasurableReason;
}

export type TurnPreview = AssembledPreview | UnmeasurablePreview;

/**
 * A report from a scan that never ran.
 *
 * The one place this is honest is `no-prose-step`: with no call to assemble
 * there is no `callKind`, and `generationTriggerFilter` reads one — so a scan
 * would have to invent the very fact it filters on. Everywhere else an empty
 * report means *the scan ran and there was nothing to say*, and the two are
 * indistinguishable in this shape by design: `books: []` already separates
 * them, because a scan that ran with books lists them even when they
 * contributed nothing.
 */
export const NO_LORE_REPORT: LoreReport = {
  books: [],
  skipped: [],
  refused: [],
  unknownSources: [],
};
