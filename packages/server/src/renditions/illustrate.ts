// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Rendition, RenditionPurpose } from '@storyengine/shared';

import type { Accounts } from '../auth/accounts.js';
import type { Config } from '../config.js';
import { capabilitiesFor } from '../providers/capabilities.js';
import type { ProviderFactory } from '../providers/factory.js';
import { renderedChannels } from '../sessions/channels.js';
import type { SessionContext } from '../sessions/store.js';
import { performCall, resolveStepRole, RoleUnresolved } from '../turns/calls.js';
import { gatherAssemblyInputs } from '../turns/gather.js';
import { momentCall, readMoment, RENDER_STEP } from '../turns/render.js';
import { castEntries } from '../turns/runner.js';
import { fromModelCall, recordUsage } from '../usage/log.js';
import { toneOf } from './assemble.js';
import { requestRendition } from './manual.js';

/**
 * **Illustrate** and **Set the scene**, pressed by hand —
 * [06 §10.6](../../../../docs/design/06-modes-and-turn-pipeline.md), [P9.4].
 *
 * ***"The same step invoked by hand"*** is §10.6's phrase and this module is
 * what makes it literally true rather than nearly true. What is shared with the
 * step is everything that decides the picture: `momentCall` builds the request,
 * `fragmentsFor` ranks, `assemblePrompt` caps, `recipeDigest` keys. What differs
 * is only where the state came from and who dispatched the call — which is the
 * same division `previewAssembly` draws, one seam further along.
 *
 * ***It is `turns/preview.ts`'s posture, and that file is the precedent for
 * every structural claim here.*** A preview is a route-driven read that
 * assembles through `gatherAssemblyInputs` and stops at `planCall`; this is a
 * route-driven act that assembles through the same gather and goes one step
 * past, to `performCall`. Neither mints a job, neither writes a turn, and
 * neither can disagree with the runner about what was in play, because all
 * three read one gather.
 *
 * ---
 *
 * ***§1.3's `[OPEN]`, decided: recorded state.*** [06 §10.6]'s standing
 * question is *"whether an on-demand rendition of an **old** turn assembles from
 * that turn's recorded state or from the present"*, and the gather answers it in
 * one argument: `parentTurnId: turnId` reconstructs the channels **at** that
 * node, which is what `snapshotIsAt` and `reconstructAlong` were built for at
 * [P6.0b]. Three things decide it, and `manual.ts` carries the full argument;
 * the short form is that a **backdrop's** whole subject is where you were
 * standing, both purposes read the same field, and *"whatever is decided, it is
 * decided once"*.
 *
 * ***The one honest cost, stated rather than hidden.*** The moment call this
 * makes is not on any turn's tape, because there is no turn: the record it
 * belongs to is the **rendition**, which keeps the resolved binding, the seed
 * and the fragments as sent. So the provenance survives in full and what is
 * absent is the *token accounting* — a hand-pressed illustration spends a `fast`
 * call that no turn's figures include. Making it a turn would put the call on a
 * tape and put a node with no prose in somebody's transcript, which is a worse
 * trade for a story than a missing line in a cost total. *Since 2026-09-27 the
 * line is not missing, only elsewhere*: the call's figures go to the account's
 * usage log (`usage/log.ts`), which is [10 §11.4]'s home for every call that
 * makes no turn.
 *
 * ***Aggregate spend tracking is where this is properly answered, and it is
 * post-1.0*** — [24 §3], which [10 §3] states and `CostSummary`'s docstring
 * repeats: *"per-turn only; aggregate tracking is post-1.0 by design."* §10.6
 * already says [06 §10] has no budget of its own, so there is nothing in this
 * phase for the figure to be missing **from**; what a later aggregate has to
 * know is that a rendition's text call exists outside the turn totals, which is
 * why it is written here rather than left to be rediscovered.
 */

export interface IllustrateContext {
  sessions: SessionContext;
  accounts: Accounts;
  providers: ProviderFactory;
  config: Config;
}

export interface IllustrateRequest {
  handle: string;
  sessionId: string;
  /** The node the picture is of. Its recorded state, not the head's. */
  turnId: string;
  purpose: RenditionPurpose;
  /** Cancels the moment call. A route's own, so a disconnect stops the spend. */
  signal: AbortSignal;
}

/**
 * Why nothing was made, when nothing was.
 *
 * ***The same vocabulary the step reports***, deliberately: `no-binding` and
 * `no-moment` mean here exactly what they mean on `RenderReport.held`, so a
 * client rendering a reason does not need two tables. `no-turn` is this path's
 * own, because a route can be asked about a turn that does not exist and a step
 * cannot.
 */
export type IllustrateRefusal = 'no-binding' | 'no-moment' | 'no-turn';

export async function illustrateTurn(
  context: IllustrateContext,
  request: IllustrateRequest,
): Promise<{ rendition: Rendition } | { held: IllustrateRefusal }> {
  /**
   * **The gather, at the node rather than at the head.** `parentTurnId` means
   * *the state after this turn* — `walkPath` ends the path at it and
   * `reconstructAlong` folds the whole path — which is the recorded state §1.3
   * decides for.
   */
  const inputs = await gatherAssemblyInputs(
    { sessions: context.sessions, accounts: context.accounts },
    { account: request.handle, sessionId: request.sessionId, parentTurnId: request.turnId },
  );

  const turn = inputs.turnsById.get(request.turnId);
  if (turn === undefined) return { held: 'no-turn' };

  /**
   * ***The full five-layer resolution, which the worker's `connectionFor`
   * deliberately is not.*** That one answers *can this account make a picture at
   * all*, because a job carries an account and no session; this has the session
   * in hand, so it resolves the way the turn does — the account's bindings, the
   * install defaults, the session's overrides and the step's. [P9.2]'s comment
   * on `connectionFor` names this stage as the one that replaces it, and for the
   * hand-pressed path it does.
   */
  const roles = {
    bindings: inputs.bindings,
    defaults: inputs.defaults,
    usable: inputs.usable,
    ...(inputs.session?.roles === undefined ? {} : { sessionRoles: inputs.session.roles }),
    ...(inputs.session?.stepRoles === undefined ? {} : { stepRoles: inputs.session.stepRoles }),
    cast: inputs.cast,
  };
  const image = resolveStepRole(roles, RENDER_STEP, 'image', undefined);
  if (!image.ok) return { held: 'no-binding' };

  const capabilities = capabilitiesFor(
    image.connection.provider,
    image.connection.capabilities ?? {},
  );

  /**
   * ***The backdrop branch makes no call at all***, which is §10.3's own
   * sentence and the reason **Set the scene** is free: *"a backdrop is a place
   * and a place has no moment."* So the refusal above is the only thing that can
   * stop it, and the assembly below is handed an empty moment and an empty cast.
   */
  let moment = '';
  let anchor: string | undefined;
  if (request.purpose === 'illustration') {
    const prose = turn.output?.text ?? '';
    if (prose.trim() === '') return { held: 'no-moment' };

    const answer = await askForMoment(
      context,
      inputs,
      roles,
      prose,
      capabilities,
      request.signal,
      request,
    );
    if (answer === null) return { held: 'no-binding' };
    if (answer.subject === '') return { held: 'no-moment' };
    moment = answer.subject;
    if (answer.anchor !== null) anchor = answer.anchor;
  }

  const rendition = await requestRendition({
    layout: context.sessions.layout,
    handle: request.handle,
    sessionId: request.sessionId,
    turnId: request.turnId,
    purpose: request.purpose,
    moment,
    cast: castEntries(inputs.cast),
    channels: renderedChannels(inputs.channels),
    tone: toneOf(inputs.lore.treatment?.treatment),
    image: {
      binding: { connectionId: image.connection.id, modelId: image.modelId },
      capabilities,
    },
    /** Empty for the reason the step's is: what an endpoint wants beyond a
     *  prompt is per-connection production configuration ([P2B]). */
    workflow: {},
    seed: seedFor(),
    ...(anchor === undefined ? {} : { anchor }),
  });

  return { rendition };
}

/**
 * The moment call, dispatched from a route.
 *
 * ***`performCall` and not a second client***, which is what keeps retries, the
 * idle timeout, the structured-output coercion and the provider error classes
 * identical to the turn's. The three callbacks it requires are the runner's
 * checkpointing hooks and there is nothing here to checkpoint — no job, no
 * event stream, no draft — so they are no-ops, which is the honest answer rather
 * than a gap: what this call produces is recorded on the rendition.
 *
 * Returns `null` when the `fast` role will not resolve, which is the one failure
 * that is an **answer** rather than an error — the same distinction
 * `previewAssembly` draws around `RoleUnresolved`.
 */
async function askForMoment(
  context: IllustrateContext,
  inputs: Awaited<ReturnType<typeof gatherAssemblyInputs>>,
  roles: Parameters<typeof resolveStepRole>[0],
  prose: string,
  capabilities: ReturnType<typeof capabilitiesFor>,
  signal: AbortSignal,
  /** Whose usage log the call's figures go to, and which session it was for. */
  owner: { handle: string; sessionId: string },
): Promise<{ subject: string; anchor: string | null } | null> {
  try {
    const outcome = await performCall(
      {
        definition: RENDER_STEP,
        ...roles,
        providers: context.providers,
        config: context.config,
        preset: { params: inputs.preset.params, budget: inputs.preset.budget },
        signal,
        /**
         * **Empty, and `performCall` agrees.** A step that brings its own
         * candidates was not assembled from the preset, so it *"honestly has
         * nothing to say"* about what the preset left unfilled — the same
         * zeroing the runner relies on for every judge call.
         */
        notFilled: [],
        onCallAssembled: () => {
          /* No draft to checkpoint: the record this call feeds is the rendition. */
        },
        onProgress: () => {
          /* No event stream: nobody is watching a turn that does not exist. */
        },
      },
      momentCall(prose, capabilities),
      [],
    );
    await recordUsage(
      context.sessions.layout,
      owner.handle,
      fromModelCall(outcome.call, 'illustrate', { sessionId: owner.sessionId }),
    );
    return readMoment(outcome.object);
  } catch (error) {
    if (error instanceof RoleUnresolved) return null;
    throw error;
  }
}

/**
 * The sampling seed for a hand-pressed picture.
 *
 * ***Drawn from the clock rather than from the RNG service, and the exemption is
 * narrow enough to state.*** [19 §14] puts every draw on the turn tape because a
 * draw that affects outcome has to replay; this one affects an outcome that is
 * **not** replayed from a tape at all — it is written onto the rendition's own
 * `provenance.seed` before the job runs, which is what makes *re-creating* an
 * evicted picture a replay of this exact number. There is no turn here to record
 * it on and no reconstruction that would consult one.
 *
 * *The lint rule bans `Math.random` and `node:crypto` outside `rng/`, and this
 * uses neither.* A clock-derived seed is a poor generator and a perfectly good
 * nonce: what it has to be is different from the last one, so that pressing
 * **Illustrate** twice on the same turn gives two pictures rather than the same
 * one twice — which is [06 §10.7]'s *additive* meaning something.
 */
function seedFor(): number {
  return Date.now() % 2_147_483_647;
}
