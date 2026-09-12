// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { AdvisoryLeakError, estimateTokens } from '../assembly/assemble.js';
import type { Candidate } from '../assembly/types.js';
import type { Config } from '../config.js';
import type { Accounts } from '../auth/accounts.js';
import type { ProviderFactory } from '../providers/factory.js';
import { randomOver } from '../rng/random.js';
import { Rng, type Tape } from '../rng/rng.js';
import { advance, MINUTES_PER_TURN, readClock, SE_CLOCK } from '../sessions/channels.js';
import { applyEffects } from '../sessions/store.js';
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
import { gatherAssemblyInputs } from './gather.js';
import { retrieve } from '../retrieval/retrieve.js';
import type { EffectProposal } from './effects.js';
import { collectCandidates } from '../assembly/collect.js';
import { planFor } from '../mode-registry.js';
import { evaluateCondition, filterReads, type TurnPlan } from './steps.js';

/**
 * The step loop — [P2 §2.5], [P2 §2.10], [06 §6].
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
  /** The guidance box. Its own field, never concatenated into the action ([06 §5.1]). */
  guidance?: string;
  /**
   * The attempt a guided redo is redoing — its words, to show — [06 §5.1],
   * [07 §7]. The other half of a redo: `replay` below says *whose draws*, this
   * says *whose words*, and the two are independent on the wire because a
   * guided reroll wants the second without the first.
   *
   * Read from the server's own record by the route, for the reason the tape
   * is. It reaches the prompt only as a candidate the runner collects, marked
   * advisory — never through `StepInput`, which withholds it as it withholds
   * guidance, and never onto the draft turn, which is what keeps a discarded
   * reply out of the history every later turn assembles from.
   */
  attempt?: { turnId: string; text: string };
  /**
   * A previous turn's draws, to replay — **rewrite**, [19 §14.5], [P6.2].
   *
   * Present means *same mechanical outcome, different prose*: the roll that
   * decided a lore entry's appearance is taken off the tape rather than made
   * again. Absent means *reroll*, which is also what an ordinary first run is —
   * and rewrite is the default of the two gestures precisely because the other
   * way round makes swiping past a failed check save-scumming by accident.
   *
   * **The tape comes from the server's own record**, never from the wire: the
   * route reads it from the turn a submission names, so a client cannot post
   * the draws it would like to have had.
   */
  replay?: Tape;
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
   * and the logger is Fastify's ([21 §4.1] — one mechanism, one format). The
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

    /**
     * **Bound once, where the job comes into existence** —
     * [21 §4.1](../../../../docs/design/21-internal-contracts.md) says that in as many words,
     * and says why: it is what makes *filter by job id* a complete lifecycle
     * rather than a sample of one.
     *
     * It used to be built inside `#body`, which is most of the lifecycle and
     * not all of it — so the three lines that fire when a turn never gets that
     * far, or dies after it, carried `jobId` alone. A tester reports the id they
     * can see, which is the session's, and those were the lines that could not
     * be found by it.
     */
    const log = this.#logFor(job);

    const controller = new AbortController();
    const promise = this.#run(job, payload, controller.signal, log)
      .catch((error: unknown) => {
        log?.error(
          { event: 'job.lost', ...failureShape(error) },
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
  async #run(
    job: Job,
    payload: TurnPayload,
    signal: AbortSignal,
    log: Logger | undefined,
  ): Promise<void> {
    try {
      await this.#body(job, payload, signal, log);
    } catch (error) {
      log?.error(
        { event: 'job.unstartable', ...failureShape(error) },
        'A turn failed before it could run',
      );
      await this.#finaliseUnstartable(job, payload, error, log);
    }
  }

  /** The bindings every line from this job inherits. */
  #logFor(job: Job): Logger | undefined {
    return this.#options.log?.child({
      jobId: job.id,
      sessionId: job.sessionId,
      account: job.account,
      turnId: job.turnId,
      parentTurnId: job.parentTurnId,
    });
  }

  /**
   * Commits the least dishonest record a turn that never ran can leave.
   *
   * A turn, not an abandonment: the job reserved a turn id and the session
   * is waiting on it, and `abandoned` writes nothing at all — so the session
   * would look as though the submission had never happened.
   */
  async #finaliseUnstartable(
    job: Job,
    payload: TurnPayload,
    error: unknown,
    log: Logger | undefined,
  ): Promise<void> {
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
      log?.error(
        { event: 'job.lost', ...failureShape(fatal) },
        'Could not finalise an unstartable turn',
      );
    }
  }

  async #body(
    job: Job,
    payload: TurnPayload,
    signal: AbortSignal,
    log: Logger | undefined,
  ): Promise<void> {
    const { commit, bus, config } = this.#options;

    const draft = initialDraft(job, payload);
    /**
     * **The replay path** — [P6.2], and the line [P6 §2] names.
     *
     * This was a bare `new Rng()` from P2 until now: the tape was recorded from
     * the first turn *though nothing rerolled until P6*, which is the deferral
     * [P2 §2.13] wrote down. A supplied tape makes this turn a rewrite of the
     * one it came from; the draws that still apply come off it, the ones that
     * do not are drawn fresh, and every draw says which it was.
     */
    const rng = payload.replay === undefined ? new Rng() : new Rng({ replay: payload.replay });
    const steps: StepOutcome[] = [];
    const calls: ModelCall[] = [];
    const effects: ChannelEffect[] = [];
    /**
     * The in-flight call, while there is one — [P3.0]. `onCallAssembled`
     * pushes a provisional `ModelCall` into `calls` the moment assembly and
     * rendering are done, stamped for the only case in which it survives to
     * disk: the process dying mid-call. Every live exit from `performCall`
     * replaces it by id, so `reconcile` — which finalises the last checkpoint
     * verbatim — is the sole reader that ever sees the stamp. Blocks moving
     * onto the call is what makes this necessary: without it, a power cut
     * would erase the very block table the recovery gate pins.
     */
    // A holder rather than a bare `let`, for the same reason `performCall`'s
    // `partial` is one: it is assigned from inside closures the type checker
    // cannot follow, and a bare binding stays narrowed to its initialiser.
    const inFlight: { pending: { call: ModelCall; startedAt: number } | null } = { pending: null };

    /** The finalised record replaces the provisional it shares an id with. */
    const finalise = (call: ModelCall): void => {
      const at = calls.findIndex((existing) => existing.id === call.id);
      if (at === -1) calls.push(call);
      else calls[at] = call;
      inFlight.pending = null;
    };

    const write = (events: EventDraft[] = []): void => {
      // A checkpoint mid-call keeps the provisional's elapsed time honest —
      // the recovered record then says how long the call had been running at
      // the last durable moment, not zero.
      if (inFlight.pending !== null) {
        inFlight.pending.call.wallMs = Date.now() - inFlight.pending.startedAt;
      }
      draft.steps = steps;
      draft.effects = effects;
      // Only once something was assembled — [P3.0], and the record's own
      // docstring: *absent* means this never happened, and an empty `request`
      // on a turn that failed before assembly is a record claiming a prompt
      // was built. `divergenceTurn` had this right from the start.
      if (calls.length > 0) draft.request = { calls };
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

    /**
     * Unlocked, and every read happens before any step runs — now through the
     * gather a preview shares ([P3.4]), so the two cannot drift on the values
     * that fail silently. **It stays inside this `try`**: a throw in here — a
     * hand-edited `accounts.json` reaches one — must commit a failed turn
     * rather than leave the job running with `finishedAt` null, which wedges
     * the session's one-active-job index until the process restarts. That is
     * what `runner.test.ts`'s *cannot even be set up* case exists to catch.
     */
    const inputs = await gatherAssemblyInputs(
      { sessions: commit.sessions, accounts: this.#options.accounts },
      { account: job.account, sessionId: job.sessionId, parentTurnId: job.parentTurnId },
    );
    const { history, windowed, usable, bindings, defaults, mode, preset, cast } = inputs;
    let running: Record<string, ChannelState> = inputs.channels;

    /**
     * **Revoking disables; it never deletes** ([09 §4.5]).
     *
     * The files are still on disk and `resolveConnections` has always returned
     * this list — nothing populated it in production, because a literal in the
     * gather's capability line meant the branch that fills it could not be
     * reached. Logged as a count rather than as names: [09 §4.5] keeps a
     * connection opaque, and the fact an operator needs when somebody reports
     * "my model stopped working" is that connections were ignored and how many.
     *
     * The logging is here rather than in the gather because a preview runs
     * every time somebody pauses typing, and these lines are what an operator
     * searches for — they belong to the turn, not to the read.
     */
    if (inputs.disabled.length > 0) {
      log?.info(
        { event: 'connections.disabled', ignored: inputs.disabled.length },
        'Personal connections ignored: the account may not use its own',
      );
    }

    if (inputs.declaredMode !== mode.definition.id) {
      log?.warn(
        { event: 'mode.substituted', declared: inputs.declaredMode, using: mode.definition.id },
        'Unknown mode; playing the default',
      );
    }

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
      // The retriever's timing proposals, gathered across every call this step
      // makes and committed with the step's own — see below.
      const loreEffects: EffectProposal[] = [];

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
            // The host's `random`, not the turn's `Rng` — the same tape and the
            // same keys, behind the async seam a mode package can be given.
            random: randomOver(rng),
            signal,
            call: async (request) => {
              /**
               * The retriever, once per call — [P5.6].
               *
               * **Per call rather than per turn**, because `callKind` is one of
               * its inputs: `generationTriggerFilter` lets an entry say *only
               * during a summary*, and a scan hoisted out of this closure could
               * not honour it. It reads `running`, so a call later in the turn
               * sees the counters the earlier calls moved.
               *
               * The effects it proposes are collected into `loreEffects` and
               * committed with the step's own, because only a step may propose
               * one and this is inside a step's `call`.
               */
              const lore = retrieve({
                lore: inputs.lore,
                preset,
                history,
                channels: running,
                persona: cast.persona,
                actors: cast.actors,
                callKind: definition.callKind,
                rng,
                ...(payload.input === undefined ? {} : { input: payload.input }),
              });
              loreEffects.push(...lore.effects);

              const fromPreset = collectCandidates({
                preset,
                callKind: definition.callKind,
                history: windowed,
                persona: cast.persona,
                actors: cast.actors,
                channels: running,
                lore: lore.blocks,
                carriers: { treatment: inputs.lore.treatment, books: inputs.lore.books },
                ...(payload.input === undefined ? {} : { input: payload.input }),
                ...(payload.guidance === undefined ? {} : { guidance: payload.guidance }),
                ...(payload.attempt === undefined ? {} : { attempt: payload.attempt }),
              });

              const outcome = await performCall(
                {
                  definition,
                  bindings,
                  defaults,
                  usable,
                  /**
                   * **[19 §5.1]'s third and fourth layers, passed at last** —
                   * [P7 §1.9], [P7.3]. `resolveRole` has implemented both since
                   * P2B and nothing outside a test had ever handed them over, so
                   * the documented layering described a function rather than
                   * what runs. This is the line that makes the two the same.
                   */
                  ...(inputs.session?.roles === undefined
                    ? {}
                    : { sessionRoles: inputs.session.roles }),
                  ...(inputs.session?.stepRoles === undefined
                    ? {}
                    : { stepRoles: inputs.session.stepRoles }),
                  // So a call naming an actor can be resolved with that actor's
                  // hint — [19 §5.1]'s last layer, [P7 §1.9]. The cards, not the
                  // hints: a step passes an id and cannot pass a preference its
                  // actor does not hold.
                  cast,
                  providers: this.#options.providers,
                  config,
                  preset: { params: preset.params, budget: preset.budget },
                  signal,
                  notFilled: fromPreset.notFilled,
                  refused: lore.refused,
                  onCallAssembled: (provisional) => {
                    contributedBlocks = provisional.blocks.filter((block) => block.included).length;
                    const call: ModelCall = {
                      id: provisional.id,
                      stepId: provisional.stepId,
                      role: provisional.role,
                      purpose: provisional.purpose,
                      resolved: provisional.resolved,
                      blocks: provisional.blocks,
                      budget: provisional.budget,
                      notFilled: provisional.notFilled,
                      messages: provisional.messages,
                      params: provisional.params,
                      usage: null,
                      cost: null,
                      wallMs: 0,
                      finishReason: null,
                      /**
                       * The stamp for a process death, and nothing else ever
                       * commits it — every live exit replaces this record by
                       * id. Not `cancelled`: nobody pressed Stop, and blaming
                       * the person is the mislabel the timeout work refused.
                       * Not a new un-sent outcome either — the call *was*
                       * sent, or was about to be; §1.6 reserves un-sent for
                       * the dry run. `terminal` is honest: the right recovery
                       * is a new turn, never a retry of this one.
                       */
                      outcome: 'error',
                      error: {
                        class: 'terminal',
                        message: 'The server stopped before this call returned.',
                      },
                      retries: 0,
                    };
                    calls.push(call);
                    inFlight.pending = { call, startedAt: provisional.startedAt };
                    // Durable before dispatch — the whole point.
                    write();
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
                [...fromPreset.candidates, ...contributed],
              );

              finalise(outcome.call);
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
        /**
         * **The retriever's counter updates ride out with the step's own** —
         * [P5.6], and ahead of them.
         *
         * Ahead because the step's effects are the story's and these are the
         * bookkeeping the story ran on: an entry that fired has already been
         * read by everything downstream by the time the step proposes anything,
         * so its cooldown starting is the earlier fact. Through the same
         * `acceptEffect` path as everything else, because a channel written by
         * a second route is a channel whose inverse nobody computed — and the
         * inverse is what [07 §4] replays.
         */
        for (const proposal of [...loreEffects, ...(result.effects ?? [])]) {
          const effect = acceptEffect(job.turnId, proposal, running);
          effects.push(effect);
          running = applyEffects(running, [effect]);
          contributedEffects += 1;
          written.push(effectApplied(effect.channelId, effect.applied, effect.rejectedReason));
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
          finalise(error.call);
          if (error.partialText.length > 0) draft.output = { text: error.partialText };
        }
        // And a Stop that landed mid-call is the same shape from the record's
        // side — finding 2 in [16]: the interrupted call is named, the words
        // already streamed survive. Optional, because a cancel between
        // attempts genuinely carries no call.
        if (error instanceof Cancelled && error.call !== undefined) {
          finalise(error.call);
          if (error.partialText !== undefined && error.partialText.length > 0) {
            draft.output = { text: error.partialText };
          }
        }
        /**
         * A Stop with no call attached, while a provisional is checkpointed —
         * the between-attempts window, or the beat between assembly and the
         * first dispatch. Finding 2's *"a Stop between attempts stays bare"*
         * stays true of the exception; the record extension is [P3.0]'s,
         * because with blocks on the call, dropping the provisional here
         * would erase assembly the record had already durably kept — a
         * regression against what the turn-level table used to survive. The
         * restamp says what happened: cancelled, nothing failed, real
         * elapsed time, nothing answered.
         */
        if (error instanceof Cancelled && error.call === undefined && inFlight.pending !== null) {
          inFlight.pending.call.outcome = 'cancelled';
          inFlight.pending.call.error = null;
          inFlight.pending.call.wallMs = Date.now() - inFlight.pending.startedAt;
          inFlight.pending = null;
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

        /**
         * **A shape, not the error object** — F32, and it closes three §1.3
         * items at one call site.
         *
         * `err: error` serialises the error's own enumerable properties, and a
         * `CallFailed` carries `partialText` and `call` — so a failed step wrote
         * **the whole rendered prompt and the model's partial narration** into
         * the log. [21 §4.1] says portable object bodies never appear there —
         * *a log is not a backup and user prose is not diagnostic* — and it also
         * says a value a later reader filters on is a field rather than a phrase.
         * A blob of prose is neither.
         *
         * The level is by reason rather than fixed. A user pressing Stop is not
         * an error and `error` is *"what the server could not do"*; a step whose
         * author declared `ignore` said in advance that this is unremarkable.
         * Stop is the most-pressed button in a session against real latency, so
         * logging it at `error` was most of what a phase's log would contain.
         *
         * `detail` is the provider's own words, which is the third item: it is
         * populated now and this is the line that was throwing it away.
         */
        const level = levelFor(reason, definition.failure);
        log?.[level](
          {
            event: 'step.failed',
            stepId: definition.id,
            reason,
            message: messageOf(error),
            ...(error instanceof CallFailed
              ? {
                  class: error.class,
                  callId: error.call.id,
                  // The endpoint's own words. Absent rather than empty when
                  // there are none, so a reader can tell silence from a blank.
                  ...(error.detail === undefined ? {} : { detail: error.detail }),
                }
              : {}),
          },
          'Step failed',
        );

        // `ignore` says the author already decided this is unremarkable, so no
        // live alarm — but it is still on the record, because silence about a
        // step that ran is the failure [09 §3.3] calls out for `skipped`.
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
        supersededProposal(effects, SE_CLOCK),
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
    // No `request`: nothing has been assembled, and the field's absence is the
    // claim ([03 §8] — *absent* and *empty* are different claims, and the
    // workbench renders the difference).
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

/**
 * The most recent same-turn refusal this engine write replaces — [P3.0], and
 * [10 §3]'s third effect outcome. A model that decided it was suddenly
 * midnight was refused with its reason; the engine's own advance landing
 * afterwards is the *override*, and the link is what lets the panel say so
 * rather than inferring it from adjacency. Null when nothing on the channel
 * was refused this turn, which is the ordinary case and is data.
 */
function supersededProposal(effects: readonly ChannelEffect[], channelId: string): string | null {
  for (let at = effects.length - 1; at >= 0; at -= 1) {
    const effect = effects[at];
    if (effect?.channelId === channelId && !effect.applied) {
      return effect.id;
    }
  }
  return null;
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

/**
 * What a step failure is worth saying out loud at.
 *
 * [21 §4.1]'s boundary: `error` is what the server could not do, `warn` is what
 * it refused. A cancellation is neither — it is the system doing exactly what
 * was asked — and a step whose author declared `ignore` has said in advance that
 * a failure here is unremarkable.
 */
function levelFor(
  reason: StepFailureReason,
  failure: 'abort' | 'warn' | 'ignore' | undefined,
): 'info' | 'warn' | 'error' {
  if (reason === 'cancelled') return 'info';
  return failure === 'abort' ? 'error' : 'warn';
}

/**
 * An unexpected failure, as fields rather than as an error object.
 *
 * `err: error` serialises an error's own enumerable properties, and the same
 * `CallFailed` that carries `partialText` and `call` can reach these paths — so
 * the rule the step-failure line already follows applies here too:
 * [21 §4.1] says portable object bodies never appear in a log.
 *
 * The stack stays, because these are the *internal* failures — a store that is
 * gone, a setup that threw — where it is the diagnostic rather than noise.
 */
function failureShape(error: unknown): Record<string, unknown> {
  return {
    message: messageOf(error),
    ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
  };
}
