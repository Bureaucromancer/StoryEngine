// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { remedyFor, uuidv7, type ErrorClass, type FailureRemedy } from '@storyengine/shared';

import type { Accounts } from '../auth/accounts.js';
import type { Config } from '../config.js';
import { planFor } from '../mode-registry.js';
import type { ProviderFactory } from '../providers/factory.js';
import { randomOver } from '../rng/random.js';
import { Rng } from '../rng/rng.js';
import { castIsPresentFor, chatSettingsOf } from '../sessions/chat-settings.js';
import { storyTurns } from '../sessions/depth.js';
import {
  appendEngineTurnLocked,
  applyEffects,
  readSession,
  withSessionLock,
  type SessionContext,
} from '../sessions/store.js';
import type { ChannelEffect, ModelCall, SessionFile, Turn } from '../sessions/types.js';
import { fromModelCall, recordUsage } from '../usage/log.js';
import { CallFailed, Cancelled, performCall, RoleUnresolved, WindowTooSmall } from './calls.js';
import { acceptEffect } from './effects.js';
import { collectFor, gatherAssemblyInputs, roleLayersOf } from './gather.js';
import { castEntries, costOf } from './runner.js';
import { filterReads, type EffectProposal, type TurnStep } from './steps.js';

/**
 * ***A step a person runs between turns*** —
 * [P14 §1.9.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * *Update trackers*, built at [P14.5a].
 *
 * §1.9.2 says what it is in one sentence: *"It writes an **engine turn**
 * carrying the step's call and its effects, exactly as a person's channel edit
 * already writes one (`store.ts:1207`), so an on-demand update is
 * branch-correct and undoable for free."* So this is `writeChannel`'s shape
 * with a model call in front of it:
 *
 * - **A child of the head**, complete, no tape, **no `steps`** — which is what
 *   keeps it off `isStoryTurn`: it is not something that happened in the story,
 *   so it moves no cadence and shows as no transcript row. Its `request` holds
 *   the call and its `cost` what the call cost, as any turn's do, so the
 *   workbench can show why the inventory changed.
 * - **Branch-correct**, because the effects are on a turn on the head's line:
 *   navigate to a sibling and it is not there.
 * - **Undoable**, because `undoTurn` inverts any turn's applied effects.
 *
 * ***Generic, and the step decides whether it can mean anything alone.*** The
 * engine names no mode's step: a mode declares {@link StepDefinition.onDemand}
 * and the route takes the id. Only a `post` step that does not write the
 * turn's messages qualifies — a narrator run with no turn to write into would
 * be prose that lands nowhere — and anything else is `no-step`, the same
 * answer an id the mode does not declare gets.
 *
 * ***The lock and the busy state, and why the call is outside the lock.*** A
 * model call can take a minute; `submitTurn` waits on the session lock, so
 * holding it across the call would freeze the composer behind the trackers.
 * Instead: *busy* is refused up front (a turn in flight is going to move the
 * head), the call runs against the head as it was, and the append takes the
 * lock and **refuses if the head moved meanwhile** — `moved`, which is
 * `submitTurn`'s `stale` seen from this side. Effects computed against one
 * head and written under another would be a tracker update for a story that
 * had already gone on without it.
 */

export interface OnDemandContext {
  sessions: SessionContext;
  accounts: Accounts;
  providers: ProviderFactory;
  config: Config;
  /** Read at failure time, for the remedy's words — as impersonation reads it. */
  online?: () => boolean | null;
}

export interface OnDemandRequest {
  account: string;
  sessionId: string;
  stepId: string;
  signal: AbortSignal;
}

export type OnDemandOutcome =
  | { kind: 'written'; session: SessionFile; turn: Turn }
  /** The step ran and had nothing to change — no call, or a call that moved nothing. */
  | { kind: 'nothing'; callId: string | null }
  | { kind: 'no-session' }
  /** The session's mode declares no such on-demand step. */
  | { kind: 'no-step' }
  | { kind: 'busy' }
  /** The head moved while the step ran; nothing was written. */
  | { kind: 'moved' }
  | { kind: 'role-unbound' | 'role-dangling' | 'window-too-small' }
  | {
      kind: 'provider-failed';
      class: ErrorClass;
      remedy: FailureRemedy;
      callId: string;
      detail?: string;
    }
  /** The step itself threw — its answer could not be applied. */
  | { kind: 'step-failed'; message: string }
  | { kind: 'cancelled' };

/** The on-demand step a mode declares under this id, or null. */
export function onDemandStep(steps: readonly TurnStep[], stepId: string): TurnStep | null {
  const found = steps.find((one) => one.definition.id === stepId);
  if (found === undefined) return null;
  const { definition } = found;
  return definition.onDemand !== undefined &&
    definition.stage === 'post' &&
    definition.contributes !== 'messages'
    ? found
    : null;
}

export async function runOnDemand(
  context: OnDemandContext,
  request: OnDemandRequest,
): Promise<OnDemandOutcome> {
  const { account, sessionId } = request;
  // Refused before anything is read or spent: the running turn is going to
  // move the head, and anything this computed would be for the old one.
  if (context.sessions.busy?.(sessionId) === true) return { kind: 'busy' };
  const session = await readSession(context.sessions, account, sessionId);
  if (session === null) return { kind: 'no-session' };
  const head = session.headTurnId ?? null;

  const inputs = await gatherAssemblyInputs(
    { sessions: context.sessions, accounts: context.accounts },
    { account, sessionId, parentTurnId: head },
  );
  const step = onDemandStep(planFor(inputs.mode).steps, request.stepId);
  if (step === null) return { kind: 'no-step' };
  const { definition, run } = step;

  /**
   * ***What the step sees is what it saw when the last story turn committed***
   * — that turn's move and reply as `input` and `output`, and the path before
   * it as `history` — with the channels at the head, because a person's edits
   * since then are the state this update starts from.
   */
  const story = storyTurns(inputs.history);
  const last = story.at(-1);
  const before = last === undefined ? [] : inputs.history.slice(0, inputs.history.indexOf(last));
  const chat = chatSettingsOf(inputs.session, inputs.mode.definition);
  const turnId = uuidv7();
  const calls: ModelCall[] = [];
  const rng = new Rng();

  let proposals: EffectProposal[];
  try {
    const result = await run(
      filterReads(definition, {
        turnId,
        sessionId,
        parentTurnId: head,
        ...(last?.input === undefined
          ? {}
          : {
              input: {
                actorId: last.input.actorId,
                kind: last.input.kind,
                text: last.input.text,
                raw: last.input.raw,
                ...(last.input.attachments === undefined
                  ? {}
                  : { attachments: last.input.attachments }),
              },
            }),
        voice: chat.voice,
        dispatch: chat.dispatch,
        cast: castEntries(inputs.cast, {
          channels: inputs.channels,
          castIsPresent: castIsPresentFor(chat, inputs.mode.definition),
        }),
        channels: inputs.channels,
        history: before,
        ...(last?.output === undefined ? {} : { output: { text: last.output.text } }),
        onDemand: true,
      }),
      {
        random: randomOver(rng),
        signal: request.signal,
        call: async (asked) => {
          /**
           * *The step's own candidates, or the pack's* — the runner's rule,
           * minus the retriever: a lorebook entry's cooldown is story state a
           * turn moves, and this is not a turn. A step that brings its own
           * prompt (the trackers do) is not handed the scene's at all.
           */
          const collected =
            asked.candidates === undefined
              ? collectFor(inputs, { callKind: definition.callKind })
              : { candidates: [], notFilled: [] };
          const outcome = await performCall(
            {
              definition,
              ...roleLayersOf(inputs),
              dispatch: chat.dispatch,
              providers: context.providers,
              config: context.config,
              preset: { params: inputs.preset.params, budget: inputs.preset.budget },
              signal: request.signal,
              notFilled: collected.notFilled,
              // Nothing is checkpointed: there is no job to attach a draft to,
              // and a call that never returns writes no turn.
              onCallAssembled: () => undefined,
              onProgress: () => undefined,
            },
            asked,
            [...collected.candidates, ...(asked.candidates ?? [])],
          );
          calls.push(outcome.call);
          return {
            callId: outcome.call.id,
            text: outcome.text,
            ...(outcome.object === undefined ? {} : { object: outcome.object }),
            usage: outcome.usage,
            outcome: outcome.call.outcome,
          };
        },
      },
    );
    /**
     * ***Effects and nothing else*** — the declaration said so, and a step
     * that returned text or candidates here would be asking for a turn this is
     * not. Refused as the runner refuses `message` beside `messages`: a
     * programmer error, named, rather than half an answer applied.
     */
    if (
      result.message !== undefined ||
      result.messages !== undefined ||
      (result.candidates ?? []).length > 0
    ) {
      return {
        kind: 'step-failed',
        message: `Step ${definition.id} returned more than effects, which an on-demand run cannot use.`,
      };
    }
    proposals = result.effects ?? [];
  } catch (error) {
    return await failed(context, request, error, calls);
  }

  const callId = calls.at(-1)?.id ?? null;
  if (proposals.length === 0) {
    await spent(context, request, calls);
    return { kind: 'nothing', callId };
  }

  // A cell rather than a `let`: the builder runs inside the lock's closure,
  // and a flag it sets is a fact the compiler cannot follow out of it.
  const seen = { moved: false };
  const outcome = await withSessionLock(sessionId, () =>
    appendEngineTurnLocked(context.sessions, account, sessionId, (current, running) => {
      if ((current.headTurnId ?? null) !== head) {
        seen.moved = true;
        return null;
      }
      // Chained over the running state, as the runner applies a step's
      // effects: a second proposal on one key carries the first's `after`.
      let state = running;
      const effects: ChannelEffect[] = [];
      for (const proposal of proposals) {
        const effect = acceptEffect(turnId, proposal, state);
        effects.push(effect);
        state = applyEffects(state, [effect]);
      }
      return {
        id: turnId,
        sessionId,
        parentTurnId: head,
        createdAt: new Date().toISOString(),
        status: 'complete',
        effects,
        tape: [],
        request: { calls },
        cost: costOf(calls),
      };
    }),
  );

  if (outcome.kind === 'written')
    return { kind: 'written', session: outcome.session, turn: outcome.turn };
  // Nothing was written, so the call's spend has no turn to live on.
  await spent(context, request, calls);
  if (seen.moved) return { kind: 'moved' };
  return outcome.kind === 'busy' ? { kind: 'busy' } : { kind: 'no-session' };
}

/**
 * ***A call that wrote no turn still cost something*** — [10 §11.4], through
 * the usage log impersonation writes to. On success the turn's own `request`
 * and `cost` carry it, and a second line here would count it twice.
 */
async function spent(
  context: OnDemandContext,
  request: OnDemandRequest,
  calls: readonly ModelCall[],
): Promise<void> {
  for (const call of calls) {
    await recordUsage(
      context.sessions.layout,
      request.account,
      fromModelCall(call, request.stepId, { sessionId: request.sessionId }),
    );
  }
}

/** What a failure inside the step came to — impersonation's mapping, for its reasons. */
async function failed(
  context: OnDemandContext,
  request: OnDemandRequest,
  error: unknown,
  calls: ModelCall[],
): Promise<OnDemandOutcome> {
  if (error instanceof CallFailed) calls.push(error.call);
  if (error instanceof Cancelled && error.call !== undefined) calls.push(error.call);
  await spent(context, request, calls);

  if (error instanceof RoleUnresolved) {
    return { kind: error.reason === 'unbound' ? 'role-unbound' : 'role-dangling' };
  }
  if (error instanceof WindowTooSmall) return { kind: 'window-too-small' };
  if (error instanceof CallFailed) {
    return {
      kind: 'provider-failed',
      class: error.class,
      remedy: remedyFor({
        reason: error.class,
        endpoint: error.endpoint,
        stalled: error.stalled,
        online: context.online?.() ?? null,
      }),
      callId: error.call.id,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    };
  }
  if (error instanceof Cancelled) return { kind: 'cancelled' };
  return { kind: 'step-failed', message: error instanceof Error ? error.message : String(error) };
}
