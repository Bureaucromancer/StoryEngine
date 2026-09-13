// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { NO_LORE_REPORT, type TurnPreview, type UnmeasurableReason } from '@storyengine/shared';

import { collectCandidates } from '../assembly/collect.js';
import type { Accounts } from '../auth/accounts.js';
import type { Config } from '../config.js';
import type { Mode } from '@storyengine/sdk';
import type { ProviderFactory } from '../providers/factory.js';
import type { SessionContext } from '../sessions/store.js';
import { evaluateCondition, type StepDefinition } from './steps.js';
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
 * **The prose call, and it says which.** [06 §5.2] admits guidance only to a
 * call whose purpose is prose, so the prose call is the only one the guidance
 * box can change — which is what makes previewing on a guidance edit
 * coherent. A mode with several calls has several verdicts and one meter; the
 * meter's question is whether the *story* context fits, and the answer names
 * the step it came from rather than leaving the reader to assume.
 *
 * ~~Refused by name: evaluating the step's `when` condition. It would be more
 * honest for a cadence-gated step — *this turn will not narrate* — but Scene's
 * cadence is every turn, so it would be a fifth state no shipped mode can
 * reach. It arrives with the first mode that can exercise it.~~
 *
 * ***It arrived, at [P7.9], and the condition is evaluated below.*** The
 * refusal was right for as long as it stood — a state nothing can produce is a
 * state nothing can test, and a client rendering a sentence for an unreachable
 * case is worse than no sentence. What changed is that a prose step can now be
 * gated to run less often than every turn, and the meter's honest answer on the
 * turns in between is **nothing is being assembled**, not a context fill for a
 * call that will not happen.
 *
 * *Evaluated with the same function the runner uses*, over the same path count,
 * because a preview that disagreed with the turn about whether it is going to
 * narrate would be worse than the silence it replaced.
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
  /**
   * `kind` since [P7.9] and optional: the box sends what the selector is on, so
   * a preview of a `say` turn shows the block a `say` turn would send
   * ([13 §8.3]). A caller that omits it previews the mode's kindless default,
   * which is what every caller did before the selector existed.
   */
  input?: { text: string; kind?: string };
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
   * ***The fifth state*** — [P7.9], [P7 §0.1a] item 20. See the module
   * docstring for why this could not exist until a mode could reach it.
   *
   * **The same evaluator the runner uses, over the same count**, so the two
   * cannot disagree about whether this turn narrates. `stages` and `armed` are
   * empty here on purpose and the effect is stated rather than hidden: a preview
   * has no step loop, so no stage flag has been raised and nothing has been
   * armed for a turn that has not been submitted — which makes a `stage` or
   * `armed` gated prose step read as *not this turn* until it is one. That is
   * the truthful answer to *what would happen if I sent this now*.
   *
   * *No scan, for `no-prose-step`'s reason inverted:* there is a call kind, but
   * there is no call, and a scan would advance nothing while reporting what a
   * turn that is not happening would have activated.
   */
  const gate = evaluateCondition(step.when, {
    turnsOnPath: inputs.history.length,
    stages: new Set<string>(),
    armed: new Set<string>(),
  });
  if (!gate.ok) {
    return {
      state: 'unmeasurable',
      headTurnId,
      pendingInput,
      reason: 'not-this-turn',
      notFilled: [],
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
   *
   * **Examined again at [P6.2] and left bare**, since that stage gave the
   * runner a replay path and [P6 §2] asks for the second construction site in
   * the same pass. It stays: a preview commits nothing, so it has nothing to
   * reproduce. The one case where a tape would belong here is a preview *of a
   * rewrite* — showing the outcome the rewrite will actually get rather than a
   * fresh roll of it — and nothing offers one, because the gestures submit
   * rather than preview. A guided redo's previous attempt ([06 §5.1]) is
   * absent here for the same reason: it belongs to a redo, and a redo is
   * submitted, not previewed.
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
    // [13 §8.3]'s per-kind block, so a preview of a `say` turn shows the block a
    // `say` turn sends.
    ...(request.input?.kind === undefined ? {} : { inputKind: request.input.kind }),
    history: inputs.windowed,
    persona: inputs.cast.persona,
    actors: inputs.cast.actors,
    channels: inputs.channels,
    lore: lore.blocks,
    // The books and the treatment, for the samples slot — [P5.9]. Separate from
    // `lore` above because a sample rides with its carrier rather than with an
    // activation: a book's prose is offered because the book is in play.
    carriers: { treatment: inputs.lore.treatment, books: inputs.lore.books },
    /**
     * ***The goal and the dials, which this call was missing*** — [06 §7.3.3],
     * [06 §7.3.1], found and fixed at [P7.8].
     *
     * **A preview that omits a block the turn will send is a preview that
     * lies**, and the goal is the sharpest case in the build because 7.3.3 calls
     * it *"always injected"*: every session with a cursor would have previewed a
     * prompt one block shorter than the one it sends, with the budget arithmetic
     * under it correspondingly wrong. It shipped that way at [P7.6] — the arm
     * was added to the collector and wired into the runner, and this second
     * caller was not — and the dials would have shipped the same way for the
     * same reason one stage later, which is why both are here in one line.
     *
     * *The gather resolves both*, so there is nothing to duplicate: the two
     * callers hand over the same values or the preview is not a preview.
     */
    ...(inputs.goals.current === null
      ? {}
      : { goal: { id: inputs.goals.current.id, statement: inputs.goals.current.statement } }),
    dials: inputs.dials,
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
    // [06 §5.2]'s structural refusal, and a preview that swallowed it would be
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
