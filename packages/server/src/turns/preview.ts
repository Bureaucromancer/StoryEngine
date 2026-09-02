// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { NO_LORE_REPORT, type TurnPreview, type UnmeasurableReason } from '@storyengine/shared';

import { collectCandidates } from '../assembly/collect.js';
import type { Accounts } from '../auth/accounts.js';
import type { Config } from '../config.js';
import type { Mode } from '../modes/types.js';
import type { ProviderFactory } from '../providers/factory.js';
import type { SessionContext } from '../sessions/store.js';
import type { StepDefinition } from './steps.js';
import { Rng } from '../rng/rng.js';
import { retrieve } from '../retrieval/retrieve.js';
import { loreReport } from '../retrieval/blocks.js';
import { planCall, RoleUnresolved } from './calls.js';
import { gatherAssemblyInputs } from './gather.js';

/**
 * The stateless assemble — [P3.4], the affordance [P3 §1.6] created this stage
 * for.
 *
 * **No job, no draft, no record, no head is moved.** Everything it reads is
 * keyed by `(account, sessionId, headTurnId)` through the same gather a real
 * turn uses, and it stops at the same seam `performCall` stops at before
 * minting an id: candidates in, blocks and a verdict out. That shape is not
 * incidental — §1.6 calls it the constraint that makes P5's keyword tester a
 * text box over machinery that already exists rather than a second pipeline.
 *
 * **It assembles against the session's current head**, which is why no
 * `headTurnId` travels in: a preview is a read, a stale one corrects itself on
 * the next keystroke, and refusing would blank the meter for the one moment
 * the person is most likely to be looking at it. The head it *did* use is
 * echoed back.
 *
 * **The prose call, and it says which.** [03 §5.2] admits guidance only to a
 * call whose purpose is prose, so the prose call is the only one the guidance
 * box can change — which is what makes previewing on a guidance edit
 * coherent. A mode with several calls has several verdicts and one meter; the
 * meter's question is whether the *story* context fits, and the answer names
 * the step it came from rather than leaving the reader to assume.
 *
 * Refused by name: evaluating the step's `when` condition. It would be more
 * honest for a cadence-gated step — *this turn will not narrate* — but Scene's
 * cadence is every turn, so it would be a fifth state no shipped mode can
 * reach. It arrives with the first mode that can exercise it.
 */

export interface PreviewContext {
  sessions: SessionContext;
  accounts: Accounts;
  providers: ProviderFactory;
  config: Config;
}

export interface PreviewRequest {
  account: string;
  sessionId: string;
  /**
   * The head to assemble against — what a submission now would name as its
   * parent. Supplied by the caller because the route has already read the
   * session to answer *is this yours*, and reading it twice to learn the same
   * fact is a second file read per keystroke.
   */
  parentTurnId: string | null;
  input?: { text: string };
  guidance?: string;
}

/**
 * The step a preview is about: the first that asks the prose role.
 *
 * One function so P7's per-step surfaces have a single place to change, and so
 * the answer's `stepId` and the call it previewed cannot come apart.
 */
export function previewStepFor(mode: Mode): StepDefinition | null {
  return mode.definition.steps.find((step) => step.role === 'prose') ?? null;
}

export async function previewAssembly(
  context: PreviewContext,
  request: PreviewRequest,
): Promise<TurnPreview> {
  const inputs = await gatherAssemblyInputs(
    { sessions: context.sessions, accounts: context.accounts },
    {
      account: request.account,
      sessionId: request.sessionId,
      parentTurnId: request.parentTurnId,
    },
  );

  const headTurnId = request.parentTurnId;
  const pendingInput =
    (request.input !== undefined && request.input.text.trim() !== '') ||
    (request.guidance !== undefined && request.guidance.trim() !== '');

  const step = previewStepFor(inputs.mode);
  if (step === null) {
    return {
      state: 'unmeasurable',
      headTurnId,
      pendingInput,
      reason: 'no-prose-step',
      notFilled: [],
      // No call kind means no scan: `generationTriggerFilter` reads one, so a
      // scan here would have to invent the fact it filters on.
      lore: NO_LORE_REPORT,
    };
  }

  /**
   * The retriever runs for a preview too, and **its effects are discarded** —
   * [P5.6].
   *
   * That is the whole reason `retrieve` returns proposals rather than writing
   * them: the preview needs the same blocks the turn will send, and must not
   * move a single cooldown to get them. A preview that advanced timing would
   * change the turn it was previewing, and it fires every time somebody pauses
   * typing.
   *
   * The RNG is a fresh one for the same reason, and its tape is thrown away
   * with it. A preview showing a 50% entry that the turn then rolls differently
   * is honest — the number says so — and the alternative, reserving the turn's
   * draws from a preview, would let a person reroll by retyping.
   */
  const lore = retrieve({
    lore: inputs.lore,
    preset: inputs.preset,
    history: inputs.history,
    channels: inputs.channels,
    persona: inputs.cast.persona,
    actors: inputs.cast.actors,
    callKind: step.callKind,
    rng: new Rng(),
    ...(request.input === undefined ? {} : { input: request.input }),
  });

  const report = loreReport({
    books: inputs.lore.books,
    scan: lore.scan,
    shelf: lore.shelf,
    unplaced: lore.unplaced,
  });

  const collected = collectCandidates({
    preset: inputs.preset,
    callKind: step.callKind,
    history: inputs.windowed,
    persona: inputs.cast.persona,
    actors: inputs.cast.actors,
    channels: inputs.channels,
    lore: lore.blocks,
    // The books and the treatment, for the samples slot 2014 [P5.9]. Separate from
    // `lore` above because a sample rides with its carrier rather than with an
    // activation: a book's prose is offered because the book is in play.
    carriers: { treatment: inputs.lore.treatment, books: inputs.lore.books },
    ...(request.input === undefined ? {} : { input: request.input }),
    ...(request.guidance === undefined ? {} : { guidance: request.guidance }),
  });

  try {
    const { call } = planCall(
      {
        definition: step,
        bindings: inputs.bindings,
        defaults: inputs.defaults,
        usable: inputs.usable,
        providers: context.providers,
        config: context.config,
        preset: { params: inputs.preset.params, budget: inputs.preset.budget },
        notFilled: collected.notFilled,
        refused: lore.refused,
      },
      {},
      collected.candidates,
    );

    return {
      state: 'assembled',
      headTurnId,
      pendingInput,
      stepId: call.stepId,
      callKind: step.callKind,
      purpose: call.purpose,
      resolved: call.resolved,
      blocks: call.blocks,
      budget: call.budget,
      notFilled: call.notFilled,
      lore: report,
    };
  } catch (error) {
    // **The one caught throw, and it is an answer rather than a failure.**
    // With no model resolved there is no context window, so there is no
    // denominator — which is a true reply to *how full is the context*, not a
    // refused request. `AdvisoryLeakError` is deliberately *not* caught: it is
    // [03 §5.2]'s structural refusal, and a preview that swallowed it would be
    // the one surface able to route around the guarantee.
    if (error instanceof RoleUnresolved) {
      const reason: UnmeasurableReason =
        error.reason === 'unbound' ? 'role-unbound' : 'role-dangling';
      return {
        state: 'unmeasurable',
        headTurnId,
        pendingInput,
        reason,
        notFilled: collected.notFilled,
        // The scan ran before the role was resolved, so its answer survives the
        // failure that made the numbers unmeasurable — which is the state an
        // unconfigured install is in while somebody asks why nothing fires.
        lore: report,
      };
    }
    throw error;
  }
}
