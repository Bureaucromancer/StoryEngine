// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  AssembledBlock,
  BudgetLimit,
  BudgetVerdict,
  CallPurpose,
  Candidate,
} from './types.js';

/**
 * Budget and admission — steps 2 and 3 of
 * [06 §5](../../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * **One arbiter, one policy, applied to everything** — including the blocks we
 * are confident matter. The output is a verdict per block: included, or dropped
 * with the rule that dropped it. A budgeter with exceptions is a budgeter whose
 * answer to *"why was this dropped"* is sometimes "it wasn't, something else
 * was" — which is the question the workbench exists to answer.
 */

/**
 * A cheap, honest token estimate.
 *
 * **Deliberately not a tokenizer.** Bundled tokenizers are discarded
 * ([triage §6.2](../../../../docs/design/workplan/02-triage.md)) and the
 * provider reports the real number afterwards
 * ([21 §1.4](../../../../docs/design/21-internal-contracts.md)) — so this is an
 * estimate used to *decide*, with the measured figure landing on the record and
 * the budgeter's margin covering the gap. Four characters per token is the
 * usual rule of thumb for English prose and is wrong in both directions for
 * other scripts, which is one reason the margin is not optional.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BudgetPolicy {
  /** The window, and the honest account of where it came from. */
  limit: BudgetLimit;
  /** Held back for the completion. */
  reserved: number;
}

/** The priority a candidate that did not declare one is treated as having. */
const DEFAULT_PRIORITY = 50;

export interface AssembleOptions {
  candidates: readonly Candidate[];
  policy: BudgetPolicy;
  /** What the call this context is for produces. Defaults to prose. */
  purpose?: CallPurpose;
  /**
   * Blocks a producer refused **before** they reached here — [P5.6], [03 §3.2].
   *
   * **The two-tier budget arriving at the one arbiter.** [P5 §1.3] asks for
   * per-book `tokenBudget` and `entryLimit` verdicts to feed this one *so that
   * every skip lands in the `BudgetVerdict` with the rule that made it*, and
   * that is only true if the inner tier's refusals appear here. They cannot be
   * candidates — a candidate is something that might still be sent, and these
   * are already decided — so they arrive as decisions rather than as blocks.
   *
   * They cost nothing: `spent` counts what is in the prompt, and these are not.
   * What they buy is a person being able to read one list and find out that
   * four lore entries matched and their book had no room, which is a different
   * sentence from *the turn was too long* and has a different repair.
   */
  refused?: readonly RefusedBlock[];
}

/** A block a producer decided against, with the rule that decided. */
export interface RefusedBlock {
  blockId: string;
  tokens: number;
  /** In the language the workbench shows, exactly like `droppedBy`. */
  rule: string;
}

export interface Assembly {
  blocks: AssembledBlock[];
  verdict: BudgetVerdict;
}

/**
 * Collects, annotates, and budgets — leaving render to
 * [`render`](./render.ts).
 *
 * The order below is the *given* order: the preset positioned these, including
 * anything it placed inside the history run, and the assembler does not
 * reorder. What it decides is what survives.
 */
export function assemble(options: AssembleOptions): Assembly {
  const purpose = options.purpose ?? 'prose';
  const admissible = admit(options.candidates, purpose);

  const annotated = admissible.map((candidate) => ({
    candidate,
    tokens: estimateTokens(candidate.text),
  }));

  const available = options.policy.limit.tokens - options.policy.reserved;

  // Dropped in priority order, lowest first, later-listed first within a
  // priority — the same order of sacrifice the prompt caps use, for the same
  // reason: a person reading the two should not have to learn two rules.
  const sacrificial = annotated
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.candidate.required !== true)
    .sort(
      (a, b) =>
        (a.candidate.priority ?? DEFAULT_PRIORITY) - (b.candidate.priority ?? DEFAULT_PRIORITY) ||
        b.index - a.index,
    );

  const dropped = new Map<string, string>();
  let spent = annotated.reduce((sum, entry) => sum + entry.tokens, 0);

  for (const entry of sacrificial) {
    if (spent <= available) break;
    dropped.set(
      entry.candidate.id,
      `over budget — priority ${String(entry.candidate.priority ?? DEFAULT_PRIORITY)}`,
    );
    spent -= entry.tokens;
  }

  const blocks: AssembledBlock[] = annotated.map(({ candidate, tokens }) => {
    const droppedBy = dropped.get(candidate.id);
    return {
      id: candidate.id,
      source: candidate.source,
      reason: candidate.reason,
      role: candidate.role,
      text: candidate.text,
      tokens,
      included: droppedBy === undefined,
      ...(droppedBy === undefined ? {} : { droppedBy }),
      // The flag survives onto the record — [P3.0]. Dropping it here is what
      // reduced [testing §1]'s invariant to a source-kind proxy.
      ...(candidate.advisory === true ? { advisory: true as const } : {}),
    };
  });

  const verdict: BudgetVerdict = {
    limit: options.policy.limit,
    reserved: options.policy.reserved,
    spent,
    // Every block, in the order considered — a verdict listing only drops
    // cannot answer what falls out next.
    //
    // The producers' own refusals come first, because they were decided first:
    // an entry its book had no room for never reached the chat-wide cut, and
    // listing it after the blocks that did would put the two tiers in the wrong
    // order in the one place somebody reads to reconstruct what happened.
    decisions: [
      ...(options.refused ?? []).map((one) => ({
        blockId: one.blockId,
        tokens: one.tokens,
        included: false,
        rule: one.rule,
      })),
      ...blocks.map((block) => ({
        blockId: block.id,
        tokens: block.tokens,
        included: block.included,
        rule: block.droppedBy ?? ruleFor(block, annotated),
      })),
    ],
    nextToDrop: nextToDrop(sacrificial, dropped),
  };

  return { blocks, verdict };
}

function ruleFor(block: AssembledBlock, annotated: readonly { candidate: Candidate }[]): string {
  const candidate = annotated.find((entry) => entry.candidate.id === block.id)?.candidate;
  if (candidate?.required === true) return 'required';
  return `included — priority ${String(candidate?.priority ?? DEFAULT_PRIORITY)}`;
}

/**
 * What would go next, at current pressure.
 *
 * The UI promises this is answerable *before* it happens, which means computing
 * it rather than inferring it from a drop that has not occurred: the next
 * survivor in sacrifice order.
 */
function nextToDrop(
  sacrificial: readonly { candidate: Candidate }[],
  dropped: ReadonlyMap<string, string>,
): string[] {
  const survivor = sacrificial.find((entry) => !dropped.has(entry.candidate.id));
  return survivor === undefined ? [] : [survivor.candidate.id];
}

export class AdvisoryLeakError extends Error {
  constructor(blockId: string, purpose: CallPurpose) {
    super(
      `Advisory block ${JSON.stringify(blockId)} cannot enter a ${purpose} call. ` +
        'Guidance influences prose and must never reach a systematic outcome ' +
        '(docs/design/06-modes-and-turn-pipeline.md §5.2).',
    );
    this.name = 'AdvisoryLeakError';
  }
}

/**
 * Refuses advisory content to a call that decides something.
 *
 * **Structural, not conventional.** A step declares what it produces, so this
 * is checkable rather than remembered — and it throws rather than filtering,
 * because a context that silently lost its guidance and one that never had it
 * are indistinguishable afterwards, and only one of them is a bug in the
 * caller.
 */
function admit(candidates: readonly Candidate[], purpose: CallPurpose): readonly Candidate[] {
  if (purpose === 'prose') return candidates;

  for (const candidate of candidates) {
    if (candidate.advisory === true) {
      throw new AdvisoryLeakError(candidate.id, purpose);
    }
  }
  return candidates;
}
