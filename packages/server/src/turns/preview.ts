// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  NO_LORE_REPORT,
  type TurnAttachment,
  type TurnPreview,
  type UnmeasurableReason,
} from '@storyengine/shared';

import type { Accounts } from '../auth/accounts.js';
import type { Config } from '../config.js';
import type { Mode } from '@storyengine/sdk';
import type { ProviderFactory } from '../providers/factory.js';
import { digestsOf, presentAttachments } from '../sessions/attachments.js';
import { storyDepth, storyTurns } from '../sessions/depth.js';
import { readHeldChain } from '../sessions/summaries.js';
import type { SessionContext } from '../sessions/store.js';
import { evaluateCondition, type StepDefinition } from './steps.js';
import { Rng } from '../rng/rng.js';
import { retrieve } from '../retrieval/retrieve.js';
import { loreReport } from '../retrieval/blocks.js';
import { planCall, RoleUnresolved, WindowTooSmall } from './calls.js';
import { collectFor, gatherAssemblyInputs, roleLayersOf } from './gather.js';
import { chatSettingsOf } from '../sessions/chat-settings.js';
import { talkativenessMap, turnSelection } from './speakers.js';
import { summaryPlanFor } from './summarise.js';

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
  input?: { text: string; kind?: string; attachments?: TurnAttachment[] };
  guidance?: string;
}

/**
 * The step a preview is about: the first that asks the prose role ***and
 * writes the turn's messages***, else the first that asks the prose role.
 *
 * One function so P7's per-step surfaces have a single place to change, and so
 * the answer's `stepId` and the call it previewed cannot come apart.
 *
 * *Corrected 2026-09-29, at [P13.5b]*: `role` is which model a step binds,
 * not what it writes, and every Scene step asks `prose` for [25 C15]'s reason.
 * While the narrator was Scene's first step the two readings agreed; the
 * secret plot's `pre` pass, declared ahead of it, is a `prose`-role call that
 * writes an effect, and the preview measured that instead of the prompt a
 * person is about to send. The fallback keeps a mode whose prose step
 * contributes nothing declared previewing what it did.
 */
export function previewStepFor(mode: Mode): StepDefinition | null {
  return (
    mode.definition.steps.find(
      (step) => step.role === 'prose' && step.contributes === 'messages',
    ) ??
    mode.definition.steps.find((step) => step.role === 'prose') ??
    null
  );
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
    (request.input?.attachments?.length ?? 0) > 0 ||
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
    turnsOnPath: storyDepth(inputs.history),
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
   * ***Whose call this is*** — [P13.3], and the answer to [P13.2]'s *"the
   * preview still assembles one merged call"*.
   *
   * **The first speaker's call, as the turn would make it.** Under an embodied
   * voice the generate step speaks as the selection's first member whatever
   * the dispatch — every call under `per-actor`, the one call under `merged` —
   * so the prompt a person most needs to see before sending is that one:
   * `{{char}}` as them, their card first, their card prompts under `per-actor`.
   * The selection is `turnSelection`'s, the runner's own question, asked with
   * the draft as the input; a narrated session, or a room nobody is cast in,
   * has no selection and is previewed as the narrator's one call, as the turn
   * would be.
   *
   * *What it cannot promise, stated.* The policy's rolls are drawn on a fresh
   * tape (the scan's reason below: a preview reserves nothing), so under
   * `natural` a draft that names nobody shows **one** plausible first speaker,
   * not the one the turn will roll — a draft that names somebody is decided by
   * the mention and matches. `smart` shows its rule-based fallback, because a
   * preview makes no model call. And a round's *later* speakers are not
   * previewed at all: their prompts hold replies nobody has written yet.
   *
   * ***A selection of nobody is nothing assembled***: `manual` after an input,
   * or a room whose every member is muted, makes no call, and the meter says
   * `not-this-turn` rather than measuring a prompt nobody will send.
   */
  const chat = chatSettingsOf(inputs.session, inputs.mode.definition);
  const selection =
    chat.voice === 'embodied'
      ? turnSelection({
          policy: chat.speakers,
          castIsPresent: inputs.mode.definition.participants.castIsPresent === true,
          cast: inputs.cast,
          channels: inputs.channels,
          history: inputs.history,
          hidden: chat.hidden,
          input: request.input,
          forced: undefined,
          talkativeness: talkativenessMap(inputs.cast.actors, inputs.mode.definition.id),
          draw: (() => {
            const tape = new Rng();
            return (purpose: string) => tape.at('se.participants', purpose);
          })(),
        })
      : undefined;
  if (selection?.speakers.length === 0) {
    return {
      state: 'unmeasurable',
      headTurnId,
      pendingInput,
      reason: 'not-this-turn',
      notFilled: [],
      lore: NO_LORE_REPORT,
    };
  }
  const speaker = selection?.speakers[0];

  /**
   * The retriever runs for a preview too, and **moves nothing** — [P5.6].
   *
   * ~~That is the whole reason `retrieve` returns proposals rather than writing
   * them~~ — it returns no proposals at all now (2026-09-27): the runner
   * settles the counters after assembly, over what reached the prompt, and a
   * preview never asks it to. The rule is the same: the preview needs the
   * same blocks the turn will send, and must not move a single cooldown to get
   * them. A preview that advanced timing would change the turn it was
   * previewing, and it fires every time somebody pauses typing.
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

  /**
   * ***`collectFor`, which is the turn's collector input by construction*** —
   * [06 §7.3.3], [06 §7.3.1], and [P7.8]'s lesson made structural
   * (2026-09-27).
   *
   * **A preview that omits a block the turn will send is a preview that
   * lies**, and the goal was the sharpest case in the build because 7.3.3 calls
   * it *"always injected"*: it shipped at [P7.6] wired into the runner and not
   * here, and the dials would have shipped the same way one stage later. P7.8
   * fixed both by adding them to this call by hand, which fixed those two;
   * the gather now fills everything it knows for every caller, so the next
   * producer cannot reach the turn alone. What stays here is what only a
   * preview knows: the draft and the guidance, and [13 §8.3]'s per-kind block
   * so a preview of a `say` turn shows the block a `say` turn sends.
   */
  /**
   * ***The story above the window, as the session holds it*** (2026-09-27).
   * The preview carried no summary at all, so on a long session the meter
   * under-read by the whole chain and the workbench showed a prompt without
   * the block the turn would send. `summaryPlanFor` asks the turn's three
   * questions; what is read is what is on disk and nothing is derived, since a
   * preview makes no model call — so a preview before a link the turn will
   * write reads short by that link, which is the truth about *nothing has
   * been asked yet*.
   */
  const plan = summaryPlanFor(inputs);
  const summary =
    plan === null
      ? undefined
      : await readHeldChain(
          context.sessions.layout,
          request.account,
          request.sessionId,
          storyTurns(inputs.history),
          plan.key,
          plan.policy,
        );

  const collected = collectFor(inputs, {
    callKind: step.callKind,
    ...(request.input?.kind === undefined ? {} : { inputKind: request.input.kind }),
    lore: lore.blocks,
    ...(request.input === undefined ? {} : { input: request.input }),
    ...(request.guidance === undefined ? {} : { guidance: request.guidance }),
    // Nothing held reads as the turn's summariser with nothing yet written:
    // absent, not an empty chain.
    ...(summary === undefined || summary.length === 0 ? {} : { summary }),
    // The first speaker's call, or the narrator's — see `selection` above.
    ...(speaker === undefined ? {} : { speaker }),
    ...(step.contributes === 'messages'
      ? { voice: speaker === undefined ? ('narrator' as const) : ('embodied' as const) }
      : {}),
  });

  /**
   * ***Which of the draft's pictures are here*** — the send rule's *are the
   * bytes present* ([25 E15]), asked before the plan because the plan is
   * synchronous. With `roleLayersOf` resolving the model the turn will, the
   * preview's *this picture will be seen* is the turn's answer rather than a
   * guess.
   */
  const picturesPresent = await presentAttachments(
    context.sessions.layout,
    request.account,
    request.sessionId,
    digestsOf(request.input === undefined ? [] : [{ input: request.input }]),
  );
  try {
    const { call } = planCall(
      {
        definition: step,
        // The session's own overrides among them, which a preview did not pass
        // until `roleLayersOf` (2026-09-27): a session pointed at a bigger model
        // was metered against the account default's window.
        ...roleLayersOf(inputs),
        providers: context.providers,
        config: context.config,
        preset: { params: inputs.preset.params, budget: inputs.preset.budget },
        notFilled: collected.notFilled,
        refused: lore.refused,
        picturesPresent,
        // So the first speaker's model hint applies as the turn's would: under
        // `per-actor` only ([P13.2], `planCall`).
        dispatch: chat.dispatch,
      },
      speaker === undefined ? {} : { speaker },
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
    // A window no larger than the reply reserve is the same kind of answer: the
    // denominator is zero, and the turn would be refused for it (2026-09-27).
    if (error instanceof RoleUnresolved || error instanceof WindowTooSmall) {
      const reason: UnmeasurableReason =
        error instanceof WindowTooSmall
          ? 'window-too-small'
          : error.reason === 'unbound'
            ? 'role-unbound'
            : 'role-dangling';
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
