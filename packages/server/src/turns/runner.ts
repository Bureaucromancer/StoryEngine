// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { AdvisoryLeakError, estimateTokens } from '../assembly/assemble.js';
import type { AssembledBlock, BudgetVerdict, Candidate } from '../assembly/types.js';
import type { Config } from '../config.js';
import { readBindings } from '../providers/bindings.js';
import { resolveConnections } from '../providers/connections.js';
import type { ProviderFactory } from '../providers/factory.js';
import { Rng } from '../rng/rng.js';
import { advance, MINUTES_PER_TURN, readClock, SE_CLOCK } from '../sessions/channels.js';
import { walkPath } from '../sessions/segments.js';
import { applyEffects, readSession, readTurns, replayChannels } from '../sessions/store.js';
import type {
  ChannelEffect,
  ChannelState,
  ModelCall,
  StepFailureReason,
  StepOutcome,
  Turn,
  TurnCost,
} from '../sessions/types.js';
import { finaliseTurn, type CommitContext, type Logger } from '../state/commit.js';
import {
  callFinished,
  callStarted,
  callStreaming,
  effectApplied,
  stepFailed,
  stepFinished,
  stepSkipped,
  stepStarted,
  turnStarted,
  type EventDraft,
} from '../state/events.js';
import { checkpoint, type Job, setJobStatus } from '../state/jobs.js';
import type { TurnStream } from '../stream/bus.js';
import { CallFailed, Cancelled, performCall, RoleUnresolved } from './calls.js';
import { acceptEffect } from './effects.js';
import { collectCandidates, DEFAULT_PLAN } from './narrate.js';
import { evaluateCondition, filterReads, type TurnPlan } from './steps.js';

/**
 * The step loop — [P2 §2.5], [P2 §2.10], [03 §6].
 *
 * A reserved job becomes a committed turn. Between those two points the runner
 * holds a draft `Turn` in memory, checkpoints it as it becomes durable enough to
 * show, and finally hands it to the commit protocol.
 *
 * **It holds the session lock for none of that.** `submitTurn` takes and
 * releases its own; `finaliseTurn` takes and releases its own. Everything
 * between — the filesystem reads, the provider call, every checkpoint — runs
 * unlocked, because `withSessionLock` is not reentrant and a nested acquisition
 * would wait on a tail that only settles when the outer task returns. That is a
 * permanent hang with no timeout and no error, which is the worst failure this
 * file could have.
 */

export interface TurnPayload {
  input?: { actorId: string | null; kind: string; text: string; raw: string };
  /** The guidance box. Its own field, never concatenated into the action ([03 §5.1]). */
  guidance?: string;
}

export interface RunnerOptions {
  commit: CommitContext;
  bus: TurnStream;
  providers: ProviderFactory;
  config: Config;
  log?: Logger;
  /** P2.6's modes supply their own. */
  plan?: TurnPlan;
}

interface Live {
  controller: AbortController;
  promise: Promise<void>;
}

export class TurnRunner {
  readonly #options: RunnerOptions;
  readonly #live = new Map<string, Live>();

  constructor(options: RunnerOptions) {
    this.#options = options;
  }

  /**
   * Starts a turn. Fire-and-forget by design — the HTTP response is a job id,
   * and the stream is how a client watches.
   *
   * The returned promise **never rejects**: every failure becomes a terminal
   * draft and a finalisation, so the only thing `lastResort` can catch is the
   * store itself being gone.
   */
  start(job: Job, payload: TurnPayload): void {
    if (this.#live.has(job.id)) return;

    const controller = new AbortController();
    const promise = this.#run(job, payload, controller.signal)
      .catch((error: unknown) => {
        this.#options.log?.error(
          { event: 'job.lost', jobId: job.id, err: error },
          'A turn ended without finalising',
        );
      })
      .finally(() => {
        this.#live.delete(job.id);
      });

    this.#live.set(job.id, { controller, promise });
  }

  /**
   * Stops a turn. It **finalises as a failed turn**, never as an abandoned job.
   *
   * An abandoned job writes no turn at all, so a stop after real prose had
   * arrived would make it silently never have happened — and gate 10 wants the
   * partial record with its blocks.
   */
  cancel(jobId: string): boolean {
    const live = this.#live.get(jobId);
    if (!live) return false;
    live.controller.abort();
    return true;
  }

  /** Whether a job is running in this process. */
  isLive(jobId: string): boolean {
    return this.#live.has(jobId);
  }

  /**
   * Waits for every in-flight turn to finish **without stopping any of them**.
   *
   * Separate from `drain` because *wait* and *stop and wait* are different
   * things, and conflating them is a trap: a caller that just wanted to know
   * when the work was done would silently cancel it instead.
   */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.#live.values()].map((live) => live.promise));
  }

  /**
   * Stops everything and waits for it, which shutdown must do **before** the
   * stores close.
   *
   * A detached run touching a closed `DatabaseSync` is the failure that surfaces
   * on Windows as `EBUSY` on a file the test never named, two layers from where
   * it was caused.
   */
  async drain(): Promise<void> {
    for (const live of this.#live.values()) live.controller.abort();
    await this.settle();
  }

  /**
   * Drops every run **without finalising** — a faithful in-process model of the
   * process being killed.
   *
   * `drain()` is what shutdown wants; this is what a crash *is*. A test that
   * disposed without draining would not get either: the detached run would carry
   * on writing into a store the next server is already reconciling, and which
   * turn landed would be a timing question rather than an assertion.
   */
  halt(): void {
    for (const live of this.#live.values()) live.controller.abort();
    this.#live.clear();
  }

  async #run(job: Job, payload: TurnPayload, signal: AbortSignal): Promise<void> {
    const { commit, bus, config } = this.#options;
    const log = this.#options.log?.child({
      jobId: job.id,
      sessionId: job.sessionId,
      account: job.account,
      turnId: job.turnId,
      parentTurnId: job.parentTurnId,
    });

    const draft = initialDraft(job, payload);
    const rng = new Rng();
    const steps: StepOutcome[] = [];
    const calls: ModelCall[] = [];
    const effects: ChannelEffect[] = [];
    let blocks: AssembledBlock[] = [];
    let verdict: BudgetVerdict | null = null;

    const write = (events: EventDraft[] = []): void => {
      draft.steps = steps;
      draft.effects = effects;
      draft.request = { blocks, budget: verdict, calls };
      draft.tape = rng.tape;
      checkpoint(commit, job.id, {
        turn: draft,
        events: events.map((event) => ({
          key: event.key,
          ...(event.params ? { params: event.params } : {}),
        })),
      });
    };

    setJobStatus(commit, job.id, 'running');
    log?.info({ event: 'job.running' }, 'Turn started');
    write([turnStarted(job.turnId)]);

    // Unlocked, and every read happens before any step runs.
    const session = await readSession(commit.sessions, job.account, job.sessionId);
    const turnsById = await readTurns(commit.sessions, job.account, job.sessionId);
    const history = walkPath(turnsById, job.parentTurnId);
    let running: Record<string, ChannelState> = session
      ? session.channels
      : replayChannels(history);

    const { usable } = await resolveConnections(commit.sessions.layout, job.account, {
      privateConnections: true,
    });
    const bindings = await readBindings(commit.sessions.layout, job.account);

    const candidates: Candidate[] = collectCandidates({
      history,
      ...(payload.input === undefined ? {} : { input: payload.input }),
      ...(payload.guidance === undefined ? {} : { guidance: payload.guidance }),
    });

    let aborted = false;
    const plan = this.#options.plan ?? DEFAULT_PLAN;

    for (const { definition, run } of plan.steps) {
      const decision = evaluateCondition(definition.when, {
        turnsOnPath: history.length,
        stages: new Set<string>(),
        armed: new Set<string>(),
      });
      if (!decision.ok) {
        steps.push({
          stepId: definition.id,
          stage: definition.stage,
          state: 'skipped',
          skipReason: decision.reason,
          contributed: { blocks: 0, effects: 0 },
          wallMs: 0,
        });
        log?.info(
          { event: 'step.skipped', stepId: definition.id, reason: decision.reason },
          'Step skipped',
        );
        write([stepSkipped(definition.id, decision.reason)]);
        continue;
      }

      const startedAt = Date.now();
      log?.info(
        { event: 'step.started', stepId: definition.id, stage: definition.stage },
        'Step started',
      );
      write([stepStarted(definition.id, definition.stage)]);

      let contributedBlocks = 0;
      let contributedEffects = 0;

      try {
        let sinceCheckpoint = Date.now();
        let streamedText = '';

        const result = await run(
          filterReads(definition, {
            turnId: job.turnId,
            sessionId: job.sessionId,
            parentTurnId: job.parentTurnId,
            ...(payload.input === undefined ? {} : { input: payload.input }),
            channels: running,
            history,
            ...(draft.output === undefined ? {} : { output: { text: draft.output.text } }),
          }),
          {
            rng,
            signal,
            call: async (request) => {
              const outcome = await performCall(
                {
                  definition,
                  bindings,
                  usable,
                  providers: this.#options.providers,
                  config,
                  signal,
                  onAssembled: (assembled, budget) => {
                    blocks = assembled;
                    verdict = budget;
                    contributedBlocks = assembled.filter((block) => block.included).length;
                  },
                  onProgress: (event) => {
                    if (event.kind === 'started') {
                      log?.info(
                        { event: 'call.started', stepId: definition.id, model: event.model },
                        'Call started',
                      );
                      write([callStarted(definition.id, definition.role ?? 'prose', event.model)]);
                      return;
                    }

                    // **Ephemeral first, durable on a window.** Every delta
                    // reaches a watching client immediately; a checkpoint per
                    // token would be an fsync storm under `synchronous = full`,
                    // and the snapshot already carries the accumulated text.
                    streamedText += event.text;
                    bus.delta(job.sessionId, job.id, event.text);
                    if (Date.now() - sinceCheckpoint >= config.sessions.streamCoalesceMs) {
                      sinceCheckpoint = Date.now();
                      draft.output = { text: streamedText };
                      write([callStreaming(definition.id, estimateTokens(streamedText))]);
                    }
                  },
                },
                request,
                candidates,
              );

              calls.push(outcome.call);
              log?.info(
                {
                  event: 'call.finished',
                  stepId: definition.id,
                  promptTokens: outcome.usage?.promptTokens ?? null,
                  completionTokens: outcome.usage?.completionTokens ?? null,
                },
                'Call finished',
              );
              write([callFinished(definition.id, outcome.usage, outcome.call.wallMs)]);

              return {
                callId: outcome.call.id,
                text: outcome.text,
                ...(outcome.object === undefined ? {} : { object: outcome.object }),
                usage: outcome.usage,
              };
            },
          },
        );

        for (const candidate of result.candidates ?? []) candidates.push(candidate);
        const written: EventDraft[] = [];
        for (const proposal of result.effects ?? []) {
          const effect = acceptEffect(job.turnId, proposal, running);
          effects.push(effect);
          running = applyEffects(running, [effect]);
          contributedEffects += 1;
          written.push(effectApplied(effect.channelId, effect.applied));
        }
        if (result.message) draft.output = result.message;

        steps.push({
          stepId: definition.id,
          stage: definition.stage,
          state: 'ok',
          contributed: { blocks: contributedBlocks, effects: contributedEffects },
          wallMs: Date.now() - startedAt,
        });
        log?.info({ event: 'step.finished', stepId: definition.id }, 'Step finished');
        write([
          stepFinished(
            definition.id,
            { blocks: contributedBlocks, effects: contributedEffects },
            Date.now() - startedAt,
          ),
          ...written,
        ]);
      } catch (error) {
        const reason = classifyStep(error);

        // A mid-stream failure has already handed the user words. The runner's
        // buffer is the only survivor — neither adapter attaches its
        // accumulation to the error — and gate 10 wants those words recorded.
        if (error instanceof CallFailed) {
          calls.push(error.call);
          if (error.partialText.length > 0) draft.output = { text: error.partialText };
        }

        steps.push({
          stepId: definition.id,
          stage: definition.stage,
          state: 'failed',
          failure: definition.failure,
          error: { reason, message: messageOf(error) },
          contributed: { blocks: contributedBlocks, effects: contributedEffects },
          wallMs: Date.now() - startedAt,
        });

        log?.error(
          { event: 'step.failed', stepId: definition.id, reason, err: error },
          'Step failed',
        );

        // `ignore` says the author already decided this is unremarkable, so no
        // live alarm — but it is still on the record, because silence about a
        // step that ran is the failure [04 §3.3] calls out for `skipped`.
        if (definition.failure !== 'ignore') write([stepFailed(definition.id, reason, false)]);
        else write();

        // Cancellation overrides the declared mode: a user's stop is not a warn.
        if (definition.failure === 'abort' || reason === 'cancelled') {
          aborted = true;
          break;
        }
      }
    }

    /**
     * The clock, after the loop and **not as a step**.
     *
     * A `failure: 'warn'` clock step would leave a turn with no time advance and
     * route an engine computation through the step path, where it would be
     * proposed rather than computed. It goes through the same registry gate
     * every step effect does — engine-proposed, so admitted; the identical
     * proposal from a model is refused.
     */
    if (!aborted) {
      const effect = acceptEffect(
        job.turnId,
        {
          channelId: SE_CLOCK,
          op: { type: 'set', path: '/' },
          after: advance(readClock(running), MINUTES_PER_TURN),
          proposedBy: { kind: 'engine' },
        },
        running,
      );
      effects.push(effect);
    }

    draft.status = aborted ? 'failed' : 'complete';
    draft.cost = costOf(calls);
    write();

    // The lock is taken here and nowhere before it.
    await finaliseTurn(commit, job.id, draft);
  }
}

/**
 * The draft as it stands before anything has run.
 *
 * **`status: 'failed'` from the first write, and that is the recovery contract
 * rather than pessimism.** `reconcile` finalises whatever the last checkpoint
 * left, verbatim, and the draft is defined as *the turn as it would be written
 * if it ended now*. A draft written optimistically as `complete` mid-generation
 * would be appended to somebody's story as a completed turn that never finished.
 */
function initialDraft(job: Job, payload: TurnPayload): Turn {
  return {
    id: job.turnId,
    sessionId: job.sessionId,
    parentTurnId: job.parentTurnId,
    createdAt: new Date().toISOString(),
    status: 'failed',
    ...(payload.input === undefined ? {} : { input: payload.input }),
    effects: [],
    tape: [],
    steps: [],
    request: { blocks: [], budget: null, calls: [] },
  };
}

function costOf(calls: readonly ModelCall[]): TurnCost {
  const reported = calls.filter((call) => call.usage !== null);
  return {
    promptTokens: reported.reduce((sum, call) => sum + (call.usage?.promptTokens ?? 0), 0),
    completionTokens: reported.reduce((sum, call) => sum + (call.usage?.completionTokens ?? 0), 0),
    wallMs: calls.reduce((sum, call) => sum + call.wallMs, 0),
    model: calls.at(-1)?.resolved.modelId ?? '',
  };
}

function classifyStep(error: unknown): StepFailureReason {
  if (error instanceof Cancelled) return 'cancelled';
  if (error instanceof AdvisoryLeakError) return 'advisory-leak';
  if (error instanceof RoleUnresolved) return error.reason;
  if (error instanceof CallFailed) return error.class;
  return 'internal';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
