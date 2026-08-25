// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { AdvisoryLeakError, estimateTokens } from '../assembly/assemble.js';
import type { AssembledBlock, BudgetVerdict, Candidate } from '../assembly/types.js';
import type { Config } from '../config.js';
import { readBindings, readSystemBindings } from '../providers/bindings.js';
import type { Accounts } from '../auth/accounts.js';
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
import { collectCandidates } from '../assembly/collect.js';
import { DEFAULT_MODE_ID, modeById, planFor } from '../modes/registry.js';
import { resolveCast } from './cast.js';
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
  /**
   * The account store, for the `privateConnections` capability ([P2A §2.1]).
   *
   * **The same instance the routes hold**, though not because a second one
   * would be stale — `Accounts` re-stats on every read, so it would not. It is
   * so that the capability check does not *depend* on filesystem timestamp
   * granularity to stay fresh. `app.ts` carries the argument.
   */
  accounts: Accounts;
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
   * Hands the runner the app's logger.
   *
   * Set rather than injected because `buildServices` runs before `buildApp`,
   * and the logger is Fastify's ([13 §4.1] — one mechanism, one format). The
   * alternative was building the runner lazily on first use, which would make
   * "is there a runner?" a question with a timing-dependent answer.
   */
  setLogger(log: Logger): void {
    this.#options.log = log;
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

  /**
   * Runs a turn, and **finalises whatever happens**.
   *
   * The wrapper is the invariant rather than a nicety. Everything between
   * `setJobStatus('running')` and the step loop — reading the session,
   * resolving the mode, resolving the cast, building the plan — used to sit
   * outside every `try`. A throw there left the job `running` with
   * `finished_at` null, and because `job_one_active_per_session` is partial
   * on that column, **every later submission to that session was refused as
   * busy until the process restarted** — presenting to a caller as a
   * well-behaved 409 rather than as the bug it was.
   *
   * A hand-edited `session.json` reaches that region, and hand-editing is a
   * supported way to get data into this system. So the guarantee is stated
   * here once, in a place no future addition to `#body` can fall outside of:
   * a turn that cannot even be set up still commits, as a failed turn that
   * says why.
   */
  async #run(job: Job, payload: TurnPayload, signal: AbortSignal): Promise<void> {
    try {
      await this.#body(job, payload, signal);
    } catch (error) {
      this.#options.log?.error(
        { event: 'job.unstartable', jobId: job.id, err: error },
        'A turn failed before it could run',
      );
      await this.#finaliseUnstartable(job, payload, error);
    }
  }

  /**
   * Commits the least dishonest record a turn that never ran can leave.
   *
   * A turn, not an abandonment: the job reserved a turn id and the session
   * is waiting on it, and `abandoned` writes nothing at all — so the session
   * would look as though the submission had never happened.
   */
  async #finaliseUnstartable(job: Job, payload: TurnPayload, error: unknown): Promise<void> {
    const draft: Turn = {
      ...initialDraft(job, payload),
      steps: [
        {
          stepId: 'se.setup',
          stage: 'pre',
          state: 'failed',
          failure: 'abort',
          error: { reason: 'internal', message: messageOf(error) },
          contributed: { blocks: 0, effects: 0 },
          wallMs: 0,
        },
      ],
    };

    try {
      checkpoint(this.#options.commit, job.id, { turn: draft });
      await finaliseTurn(this.#options.commit, job.id, draft);
    } catch (fatal) {
      // The store itself is gone — the kill case. Startup reconciliation is
      // what picks this up; there is nothing left to write it with.
      this.#options.log?.error(
        { event: 'job.lost', jobId: job.id, err: fatal },
        'Could not finalise an unstartable turn',
      );
    }
  }

  async #body(job: Job, payload: TurnPayload, signal: AbortSignal): Promise<void> {
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

    /**
     * **The capability, not a literal** — [P2A §2.1], [04 §4.5].
     *
     * This passed `{ privateConnections: true }` from P2.5 until now, which
     * defeated the one check [04 §4.5] calls load-bearing. It calls it that
     * precisely because the alternative — hiding personal connections in the
     * UI — is a trivial bypass for anyone with `fileAccess: "write"`, and a
     * turn is where a connection is actually *used*.
     *
     * An account that has vanished between reservation and run resolves to no
     * capabilities rather than to the defaults. Defaulting would mean a deleted
     * account's queued turn ran with more authority than a live one whose
     * capability had been revoked, which is the wrong way round.
     */
    const account = await this.#options.accounts.find(job.account);
    const capabilities = account?.capabilities ?? { privateConnections: false };
    const { usable, disabled } = await resolveConnections(
      commit.sessions.layout,
      job.account,
      capabilities,
    );

    /**
     * **Revoking disables; it never deletes** ([04 §4.5]).
     *
     * The files are still on disk and `resolveConnections` has always returned
     * this list — nothing populated it in production, because the literal above
     * meant the branch that fills it could not be reached. Logged as a count
     * rather than as names: [04 §4.5] keeps a connection opaque, and the fact
     * an operator needs when somebody reports "my model stopped working" is
     * that connections were ignored and how many.
     */
    if (disabled.length > 0) {
      log?.info(
        { event: 'connections.disabled', ignored: disabled.length },
        'Personal connections ignored: the account may not use its own',
      );
    }
    // Two layers ([P2B §2.1]): the account's own, and the install defaults it
    // falls back to per role. Read together because a turn resolves every role
    // against both, and a second read per role would be the same two files.
    const bindings = await readBindings(commit.sessions.layout, job.account);
    const defaults = await readSystemBindings(commit.sessions.layout);

    /**
     * **What the session is playing decides what runs**, and an unknown mode
     * resolves to the default rather than refusing.
     *
     * [00 §3.3]: a session whose mode came from a newer build, or from an
     * extension that is not installed, is still somebody's story and should
     * still open. The substitution is logged so that it is not silent.
     */
    const declared = session?.mode?.id ?? DEFAULT_MODE_ID;
    const mode = modeById(declared) ?? modeById(DEFAULT_MODE_ID);
    if (mode === null) throw new Error('No default mode is registered.');
    if (declared !== mode.definition.id) {
      log?.warn(
        { event: 'mode.substituted', declared, using: mode.definition.id },
        'Unknown mode; playing the default',
      );
    }

    const preset = session?.preset ?? mode.definition.assembly.defaultPreset;
    const cast = resolveCast(
      { db: commit.sessions.index, layout: commit.sessions.layout, keepHistoryPerObject: 0 },
      job.account,
      session?.cast,
    );
    const windowed = history.slice(-mode.definition.assembly.historyWindow);

    /**
     * Candidates the *steps* contributed, kept outside the loop.
     *
     * The preset's own are re-collected per call, because a block's
     * `appliesTo` filters on the call kind and two steps may want different
     * ones. What a step contributed has to survive into the next step's call —
     * that is what `contributes: 'blocks'` means — so it accumulates here
     * rather than in the per-call array.
     */
    const contributed: Candidate[] = [];

    let aborted = false;
    const plan = this.#options.plan ?? planFor(mode);

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
              const fromPreset = collectCandidates({
                preset,
                callKind: definition.callKind,
                history: windowed,
                persona: cast.persona,
                actors: cast.actors,
                channels: running,
                ...(payload.input === undefined ? {} : { input: payload.input }),
                ...(payload.guidance === undefined ? {} : { guidance: payload.guidance }),
              });

              const outcome = await performCall(
                {
                  definition,
                  bindings,
                  defaults,
                  usable,
                  providers: this.#options.providers,
                  config,
                  preset: { params: preset.params, budget: preset.budget },
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
                [...fromPreset, ...contributed],
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

        for (const candidate of result.candidates ?? []) contributed.push(candidate);
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

/**
 * The turn's totals — {@link TurnCost} carries the argument for the nulls.
 *
 * A turn with no calls at all is the case that made this visible: a cancelled
 * turn recorded `{promptTokens: 0, completionTokens: 0, model: ''}`, which reads
 * as *counted, and it was nothing* rather than *nobody counted*.
 */
function costOf(calls: readonly ModelCall[]): TurnCost {
  const counted = calls.length > 0 && calls.every((call) => call.usage !== null);

  return {
    promptTokens: counted
      ? calls.reduce((sum, call) => sum + (call.usage?.promptTokens ?? 0), 0)
      : null,
    completionTokens: counted
      ? calls.reduce((sum, call) => sum + (call.usage?.completionTokens ?? 0), 0)
      : null,
    wallMs: calls.reduce((sum, call) => sum + call.wallMs, 0),
    model: calls.at(-1)?.resolved.modelId ?? null,
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
