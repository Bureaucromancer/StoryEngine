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
