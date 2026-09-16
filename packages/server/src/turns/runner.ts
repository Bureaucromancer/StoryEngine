// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { AdvisoryLeakError, estimateTokens } from '../assembly/assemble.js';
import type { Candidate } from '../assembly/types.js';
import type { Config } from '../config.js';
import type { Accounts } from '../auth/accounts.js';
import type { ProviderFactory } from '../providers/factory.js';
import { randomOver } from '../rng/random.js';
import { Rng, type Tape } from '../rng/rng.js';
import {
  advance,
  MINUTES_PER_TURN,
  readClock,
  renderedChannels,
  SE_CLOCK,
} from '../sessions/channels.js';
import { applyEffects } from '../sessions/store.js';
import type {
  ChannelEffect,
  ChannelState,
  ModelCall,
  PooledHook,
  StepFailureReason,
  StepOutcome,
  Turn,
  TurnCost,
} from '../sessions/types.js';
import type { CastMember } from './cast.js';
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
import { CallFailed, Cancelled, performCall, resolveStepRole, RoleUnresolved } from './calls.js';
import { acceptEffect } from './effects.js';
import { gatherAssemblyInputs } from './gather.js';
import { extractMentions, type ExtractReport } from './extract.js';
import { goalJudge, GOAL_JUDGE_STEP, type GoalJudgeReport } from './goal-judge.js';
import { readSuggesting, suggest, type SuggestReport } from './suggest.js';
import {
  readBackdropOn,
  readIllustration,
  render,
  RENDER_STEP,
  type RenderReport,
} from './render.js';
import { capabilitiesFor } from '../providers/capabilities.js';
import { RENDITION_SCHEMA, type Rendition } from '@storyengine/shared';
import { renditionIdFor, writeRendition } from '../renditions/store.js';
import { summarise, SUMMARISE_PROMPT, SUMMARISE_STEP, type SummariseReport } from './summarise.js';
import { DEFAULT_SUMMARY_POLICY, summariserKey } from '../sessions/summary-chain.js';
import type { Mentionable } from './mentions.js';
import { hookSelector, type HookSelectorReport } from './hook-selector.js';
import { readHookState, readPacing, SE_HOOK } from '../sessions/hooks.js';
import { SE_GOAL } from '../sessions/goals.js';
import { retrieve } from '../retrieval/retrieve.js';
import type { EffectProposal } from './effects.js';
import { collectCandidates } from '../assembly/collect.js';
import { planFor, setupPlanFor } from '../mode-registry.js';
import { evaluateCondition, filterReads, type CastEntry, type TurnPlan } from './steps.js';
import { lastProse, selectSpeakers, selectsSpeakers } from './speakers.js';

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
  /**
   * This is the session's **setup** turn — [06 §7.3], [P7.4].
   *
   * The mode's declared parts run instead of its steps. In memory rather than on
   * the job, like `replay` and `attempt` beside it: the route knows because it
   * is the route that just created the session, and a flag on the reservation
   * would be a persisted field whose only reader is the next few milliseconds.
   *
   * *What that costs is stated rather than hidden: a job recovered after the
   * process died between reservation and run loses this, and would run the
   * ordinary plan. It is the same exposure `replay` already has, and the
   * recovery path's answer to a turn it cannot reconstruct is the one place to
   * fix it for all three.*
   */
  setup?: boolean;
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
  /**
   * Queues a turn's pictures, after it has committed — [P9.2].
   *
   * ***A callback rather than a worker held here***, and the seam is the point:
   * the runner's job ends when the turn is on disk, and everything after that is
   * [06 §10.2]'s *"dispatched as their own jobs"*. A runner that owned the
   * worker would be a runner whose shutdown had to drain pictures, which is
   * exactly the coupling this phase exists to avoid.
   *
   * **Optional, so every existing test double stays a double.** Absent means the
   * step never asked for anything — which is every turn of every session before
   * this phase, and every test that is not about pictures.
   */
  dispatch?: (
    account: string,
    sessionId: string,
    records: readonly Rendition[],
    turnId: string,
  ) => void;
  /**
   * The `image` binding to stamp on a record before its job runs.
   *
   * On the record **before** the call because the reuse digest already keys on
   * it ([P9 §0.3]'s item 2): a record that learned its model from the answer
   * would be one whose key could not be checked until after the money was spent.
   */
  imageBinding?: (account: string) => { connectionId: string; modelId: string } | null;
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
     * What the plot-hook selector decided, and the words a firing sends —
     * [06 §6.1], [P7.5].
     *
     * **A cell the runner owns, filled by a callback, because neither value can
     * travel through `StepResult`.** The record line is a turn field and
     * widening the step contract with one would let any mode write it; the
     * guidance text is the thing a step may specifically not hand back
     * ([06 §5.2]), and it has to reach `collectCandidates` so the fired hook
     * lands in the slot the preset positioned rather than after everything else
     * ([25 C13(c)]). *The callback is engine code handed to engine code — the
     * selector is the one step `planFor` does not build.*
     */
    const hooks: { report: HookSelectorReport | null } = { report: null };
    /**
     * What the goal judge answered — [06 §7.3.3], [P7.6]. A cell for the same
     * reason the selector's is one: `se.goal` is `model-proposed` and what the
     * *session* does about an achievement is the engine's to decide, so the step
     * reports and the runner writes.
     */
    const goals: { report: GoalJudgeReport | null } = { report: null };
    /**
     * What the extract pass understood about the turn's text — [06 §8.2],
     * [P7.7]. The overlay lands on the turn record and the introduction verdict
     * decides a hook's fate, so like the two cells above it this is the engine's
     * to read rather than the step's to write.
     */
    const extracted: { report: ExtractReport | null } = { report: null };
    /**
     * What the suggestion step offered — [R11], [P7.9]. Same cell shape as the
     * three above.
     *
     * ***Declared here rather than beside the step that fills it***, which is
     * why all four are together: `write()` closes over every one of them to
     * build the checkpoint draft, and it runs before the plan is assembled. A
     * declaration further down is a **temporal dead zone** the compiler is happy
     * with and the first turn is not — `Cannot access 'suggested' before
     * initialization`, thrown out of the checkpoint, caught as *unstartable*,
     * and recorded as a failed turn with no request on it. Found at [P7.9] by
     * 141 route tests going red at once, and cheap to reintroduce, which is what
     * this paragraph is for.
     */
    const suggested: { report: SuggestReport | null } = { report: null };
    /**
     * The story above the window — [P8.1]. Up here with the other four for the
     * reason the paragraph above gives: `write()` closes over it, and a
     * declaration further down is a temporal dead zone the compiler is happy
     * with and the first turn is not.
     *
     * *Nothing of this lands on the turn record directly*, unlike the four
     * above: a summary reaches the record as **blocks on a call**, through the
     * collector, which is what makes the block table able to say which links
     * covered which turns without a fifth field on `Turn`.
     */
    const summaries: { report: SummariseReport | null } = { report: null };
    /**
     * What the rendition step asked for — [06 §10], [P9.1]. The sixth cell, and
     * **up here with the other five for the reason the paragraph above gives**:
     * `write()` closes over it to build the checkpoint draft and runs before the
     * plan is assembled, so a declaration further down is a temporal dead zone
     * the compiler is happy with and the first turn is not.
     *
     * *What lands on the record is a report and never the records.* A rendition
     * is dispatched after the turn commits and then moves `pending → ready`,
     * which an append-only line cannot express — so `Turn.renditions` keeps what
     * this turn **asked for** and `sessions/<id>/renditions/` keeps the rest.
     */
    const renditions: { report: RenderReport | null } = { report: null };
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
      /**
       * **Absent rather than empty when the pass did not run** — [03 §8]'s
       * distinction, and the one [10 §13.1]'s overlay acts on: *empty* claims a
       * pass ran and found nobody, which is a different fact from *nobody
       * looked*.
       */
      if (extracted.report !== null && extracted.report.spans.length > 0) {
        draft.spans = extracted.report.spans;
      }
      // Absent means the selector did not run, which is every session with no
      // hook pool — never *it ran and had nothing to say*, which is what the
      // `nothing-eligible` verdict is for.
      if (hooks.report !== null) draft.hooks = hooks.report.selection;
      /**
       * **Absent rather than empty when nothing ran** — the distinction `spans`
       * draws two lines up and for the same reason: *empty* claims the step ran
       * and the model offered nothing, which is a different fact from *the
       * session has suggestions turned off*. [R11] wants the unselected kept,
       * and keeping an empty list is not keeping anything.
       */
      if (suggested.report !== null && suggested.report.actions.length > 0) {
        draft.suggestions = [...suggested.report.actions];
      }
      /**
       * **What the turn asked for, and never the renditions themselves** —
       * [06 §10], [P9.1].
       *
       * *The ids are allocated here rather than by the step*, which is the one
       * place this differs from the four cells above: a rendition is a **file**
       * with a name, and the name has to exist before the record is written and
       * before the job that fills it is enqueued. A step that minted them would
       * be a step deciding what a path is called.
       *
       * **Absent rather than empty when the step did not run** — every session
       * with nothing switched on, and every turn before this phase. It never
       * means *it ran and asked for nothing*, which is what `held` says, and
       * which is the distinction every optional field on this record draws.
       */
      if (renditions.report !== null) {
        const report = renditions.report;
        draft.renditions = {
          requested: report.requests.map((_, at) => renditionIdFor(draft.id, at)),
          ...(report.reused === undefined ? {} : { reused: report.reused }),
          ...(report.held === undefined ? {} : { held: report.held }),
        };
      }
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
     * **Who talks this turn** — [06 §7.2]'s participant policy, [P7.3].
     *
     * **Once per turn and before the loop**, for two reasons that pull the same
     * way. A selection is a fact about the turn rather than about a step, so two
     * steps must not be able to disagree about who is speaking; and `pooled`
     * draws, so computing it per step would put a different number of draws on
     * the tape depending on how many steps the plan happened to run — which is
     * a replay that diverges for a reason nobody could see.
     *
     * *The site is the selector's own, so a `pooled` mode's draw sits beside the
     * retriever's and the dice on one tape, under a name a person reading a
     * replay can recognise.*
     */
    const spoken = lastProse(history);
    /**
     * The wizard's answers, narrowed once — [P7.4]. `mode.config` is `unknown`
     * because [06 §1] keeps it opaque to the host, and a hand-edited session can
     * hold anything there; a step is handed a record or nothing.
     */
    const declared: unknown = inputs.session?.mode?.config;
    const answers =
      typeof declared === 'object' && declared !== null && !Array.isArray(declared)
        ? (declared as Record<string, unknown>)
        : undefined;
    const speakers = selectsSpeakers(mode.definition.participants)
      ? selectSpeakers({
          policy: mode.definition.participants,
          actors: cast.actors,
          persona: cast.persona?.actor.id ?? null,
          channels: running,
          depth: history.length,
          draw: rng.at('se.participants', 'speaker'),
          ...(payload.input === undefined
            ? {}
            : { input: { actorId: payload.input.actorId, text: payload.input.text } }),
          ...(spoken === undefined ? {} : { lastProse: spoken }),
        })
      : undefined;

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
    /**
     * **The setup turn runs the mode's parts instead of its steps** — [06 §7.3],
     * [P7.4].
     *
     * A session whose mode declares generated parts makes them on its first
     * turn, which is what lets [06 §7.3]'s *"separate validated generations,
     * each individually retryable, applied as they succeed"* be the step loop
     * rather than a second pipeline beside it: every clause of that sentence is
     * already a property of this loop.
     *
     * *`this.#options.plan` still wins, because a test that supplied a plan
     * asked for that plan.*
     */
    const declaredPlan =
      this.#options.plan ?? (payload.setup === true ? setupPlanFor(mode) : planFor(mode));

    /**
     * **The plot-hook selector, prepended** — [06 §6.1], [P7.5].
     *
     * *The one step `planFor` cannot build*, because it reads the session's hook
     * pool and a pool is assembled from a treatment, its lorebooks and the
     * session's own hooks ([03 §4.1]) — none of which is a mode. The same
     * argument that registers `se.hook` and `se.hook.pacing` in `mode-loader`
     * rather than in Scene's declaration, one level up.
     *
     * **First, and that is what buys the guidance slot.** Step candidates are
     * appended after the preset's, so a fired hook returned as a candidate would
     * arrive at the end of the prompt instead of where the author positioned
     * guidance — [25 C13(c)], and §1.5 raised it as the thing that had no
     * answer. Running before every other step means the words are in hand by the
     * time any of them assembles, and `collectCandidates` fills the slot
     * properly.
     *
     * **An empty pool means no selector at all**, which is also why this applies
     * to a supplied plan and does not contradict *a test that supplied a plan
     * asked for that plan*: the selector is in no mode's plan either way, and a
     * test that wants one seeds the session's hooks. *And never on a setup turn
     * — [06 §7.3]'s parts run before the session has a first turn, and a pool
     * judged against no history would fire its opening beat into a prompt that
     * has not happened yet.*
     */
    /**
     * **The goal judge, appended** — [06 §7.3.3], [P7.6], and the second
     * engine-owned step. `post`, so it runs after the prose exists: the selector
     * asks about the turn that is about to happen and this asks about the one
     * that just did.
     *
     * **Only for a `narrative` goal.** [04 §7.1]'s other arm is `manual` — *the
     * player says when* — and a call that judged a manual goal would be the
     * engine asking a question the author reserved for a person. *And never on a
     * concluded session*: [06 §7.3.4] keeps an ended story readable and
     * branchable, not running.
     */
    const judging =
      payload.setup !== true &&
      !inputs.goals.concluded &&
      inputs.goals.current !== null &&
      inputs.goals.current.completion.kind === 'narrative';

    const selects = payload.setup !== true && inputs.hooks.pool.length > 0;
    const plan: TurnPlan = selects
      ? {
          steps: [
            hookSelector({
              pool: inputs.hooks.pool,
              filter: {
                known: inputs.hooks.known,
                activeBooks: new Set(inputs.lore.books.map((book) => book.id)),
                persona: cast.persona?.actor.id ?? null,
              },
              pacing: readPacing(running, {
                ...(isRecord(inputs.session?.setup) ? { setup: inputs.session.setup } : {}),
                ...(isRecord(inputs.lore.treatment?.treatment)
                  ? { treatment: inputs.lore.treatment.treatment }
                  : {}),
              }),
              report: (report) => {
                hooks.report = report;
              },
            }),
            ...declaredPlan.steps,
          ],
        }
      : declaredPlan;

    /**
     * ***The summariser, prepended*** — [07 §5.1], [P8.1], and the fifth
     * engine-owned step. `pre`, because what it produces goes into **this**
     * turn's prompt: the selector is `pre` for the identical reason, and a chain
     * built by a `post` step would be permanently one link behind the story.
     *
     * **Three gates, and each of them saves a model call rather than tidying
     * up.**
     *
     * *No summary slot in the pack, no step.* A session whose preset positions
     * nothing would otherwise pay a `fast`-role call per turn to fill a cache
     * nothing reads. This is the same judgement `suggesting` makes one block
     * down — **keep the step out of the plan rather than idling it** — and for
     * the same reason: a step outcome that means *this feature exists* rather
     * than anything about the turn is noise on every turn of every session.
     *
     * *Nothing above the window, no step.* `planChain` would return an empty
     * plan and `ensureChain` would derive nothing, so the call is saved by
     * arithmetic rather than by policy — but the step row would still appear.
     *
     * *An unresolvable role, no step.* The summariser's **resolved** binding is
     * in every key ([P8 §1.9]), so a chain cannot be keyed before the role
     * resolves. `resolveStepRole` is the same layering `planCall` applies, which
     * is why it was extracted rather than restated: a second answer to *which
     * model is this* would let a session derive its chain under one model and
     * read it under another.
     */
    const wantsSummary =
      payload.setup !== true &&
      preset.blocks.some(
        (block) => block.enabled && block.kind === 'slot' && block.source.of === 'summary',
      ) &&
      history.length > mode.definition.assembly.historyWindow;

    const summariserRole = wantsSummary
      ? resolveStepRole(
          {
            bindings,
            defaults,
            usable,
            ...(inputs.session?.roles === undefined ? {} : { sessionRoles: inputs.session.roles }),
            ...(inputs.session?.stepRoles === undefined
              ? {}
              : { stepRoles: inputs.session.stepRoles }),
            cast,
          },
          SUMMARISE_STEP,
          SUMMARISE_STEP.role ?? 'prose',
          undefined,
        )
      : null;

    const withSummary: TurnPlan =
      summariserRole?.ok === true
        ? {
            steps: [
              summarise({
                layout: commit.sessions.layout,
                handle: job.account,
                sessionId: job.sessionId,
                policy: {
                  ...DEFAULT_SUMMARY_POLICY,
                  window: mode.definition.assembly.historyWindow,
                },
                key: summariserKey(
                  { connectionId: summariserRole.connection.id, modelId: summariserRole.modelId },
                  SUMMARISE_PROMPT,
                  preset.params,
                ),
                report: (report) => {
                  summaries.report = report;
                },
              }),
              ...plan.steps,
            ],
          }
        : plan;

    /**
     * **The mention pass, after the prose and before the judge** — [06 §8.2],
     * [P7.7], and the third engine-owned step.
     *
     * *Every turn with somebody to find*, which is the cast plus any subject an
     * introduction hook is trying to bring in — [06 §6.1] is explicit that a
     * firing *"contributes the subject's card for that turn and adds their
     * aliases to the shared keyword scan"*, and a subject who is not in the cast
     * is exactly the one the scan must not miss on the one turn it matters.
     */
    const pendingHooks = provisionalHooks(inputs.hooks.pool, running);
    /**
     * *Whether there is anybody findable at all*, which is what decides whether
     * the step joins the plan — as against **who**, which is settled inside it
     * because the selector has not run yet.
     */
    const findable =
      cast.persona !== null ||
      cast.actors.length > 0 ||
      inputs.hooks.pool.some((entry) => entry.hook.introduces !== undefined);

    const withExtract: TurnPlan =
      payload.setup !== true && findable
        ? {
            steps: [
              ...withSummary.steps,
              extractMentions({
                subjects: () => {
                  const introducing = pendingIntroduction(hooks, inputs.hooks.pool);
                  return {
                    cast: castTerms(
                      cast,
                      introducing,
                      pendingHooks,
                      inputs.hooks.pool,
                      inputs.hooks.terms,
                    ),
                    introducing,
                    pending: pendingHooks,
                  };
                },
                report: (report) => {
                  extracted.report = report;
                },
              }),
            ],
          }
        : withSummary;

    const withJudge: TurnPlan =
      judging && inputs.goals.current !== null
        ? {
            steps: [
              ...withExtract.steps,
              goalJudge({
                goal: inputs.goals.current,
                report: (report) => {
                  goals.report = report;
                },
              }),
            ],
          }
        : withExtract;

    /**
     * ***What the player could do next*** — [06 §7.3]'s *suggested actions*,
     * [R11], [P7.9]. See `turns/suggest.ts` for why they land on the turn.
     *
     * **Appended after the judge**, which is the ordering the two steps want
     * rather than an accident: a turn that just completed a goal is a turn whose
     * suggestions should be read against a story that has ended or moved on, and
     * a `post` stage runs its steps in declaration order.
     *
     * ***The toggle keeps the step out of the plan rather than idling it***, and
     * the first draft had it the other way — the step always present, returning
     * early when the session had suggestions off, the way [P7.5]'s pacing gate
     * sits inside the selector. That is right for pacing and wrong here, for a
     * reason the two do not share: **a held selector is a thing that happened**
     * and its skip is the record a player reads to understand a quiet session,
     * where a suggestion step nobody asked for has nothing to report. Leaving it
     * in would put an `ok` row contributing nothing on every turn of every
     * session in the build, which is a step outcome that means *this feature
     * exists* rather than anything about the turn.
     *
     * *The step still holds its own gate*, because `enabled` is read here and a
     * plan assembled elsewhere could disagree with it — the belt the selector
     * wears for the same reason.
     */
    const suggesting = payload.setup !== true && readSuggesting(running);
    const withSuggest: TurnPlan = suggesting
      ? {
          steps: [
            ...withJudge.steps,
            suggest({
              enabled: true,
              report: (report) => {
                suggested.report = report;
              },
            }),
          ],
        }
      : withJudge;

    /**
     * ***The rendition step, appended last*** — [06 §10.3], [P9.1], and the
     * sixth engine-owned one.
     *
     * **Last among the `post` steps, and the ordering is the one the steps
     * want.** A `post` stage runs in declaration order, and this reads the
     * turn's finished prose and the state the turn has already moved — so
     * anything that could still change either belongs in front of it. The judge
     * can conclude a goal and the mention pass can move a hook; a picture of a
     * turn should be a picture of the turn as it ended.
     *
     * ***Three gates, and each of them keeps a step out of the plan rather than
     * idling it*** — `wantsSummary`'s arrangement, and the paragraph above the
     * suggester says why: *"a step outcome that means this feature exists rather
     * than anything about the turn"* is noise on every turn of every session.
     *
     * *Nothing wanted, no step.* A session with illustration off and no backdrop
     * has nothing for this to decide.
     *
     * *No `image` binding, no step.* [19 §5.1] leaves `image` **unset** on every
     * install until a matching connection exists, *"because there is no sensible
     * text-model fallback for it"* — so without this gate every turn of every
     * session in the build would log a failed step to discover what the binding
     * already says. It is [P2B]'s dangling posture applied to a step: visible,
     * named, and never a turn that fails obscurely. **And it is what buys the
     * honest `fast` role**, which is the first non-`prose` role any step in this
     * build has asked for ([25 C15] is why the other three settled).
     *
     * *A setup turn, no step.* There is no prose to be a picture of.
     */
    const wantsIllustration = payload.setup !== true && readIllustration(running) === 'each-turn';
    const wantsBackdrop = payload.setup !== true && readBackdropOn(running);
    const renderRoles =
      wantsIllustration || wantsBackdrop
        ? {
            image: resolveStepRole(
              {
                bindings,
                defaults,
                usable,
                ...(inputs.session?.roles === undefined
                  ? {}
                  : { sessionRoles: inputs.session.roles }),
                ...(inputs.session?.stepRoles === undefined
                  ? {}
                  : { stepRoles: inputs.session.stepRoles }),
                cast,
              },
              RENDER_STEP,
              'image',
              undefined,
            ),
            /**
             * *Resolved even when only a backdrop is wanted*, because the step
             * is one step: the background branch makes no `fast` call, and a
             * gate that let it into the plan without a resolvable `fast` role
             * would fail the moment somebody turned illustration on mid-session.
             */
            moment: resolveStepRole(
              {
                bindings,
                defaults,
                usable,
                ...(inputs.session?.roles === undefined
                  ? {}
                  : { sessionRoles: inputs.session.roles }),
                ...(inputs.session?.stepRoles === undefined
                  ? {}
                  : { stepRoles: inputs.session.stepRoles }),
                cast,
              },
              RENDER_STEP,
              RENDER_STEP.role ?? 'fast',
              undefined,
            ),
          }
        : null;

    const withRender: TurnPlan =
      renderRoles?.image.ok === true && renderRoles.moment.ok
        ? {
            steps: [
              ...withSuggest.steps,
              render({
                illustration: wantsIllustration ? 'each-turn' : 'off',
                backdrop: wantsBackdrop,
                image: {
                  binding: {
                    connectionId: renderRoles.image.connection.id,
                    modelId: renderRoles.image.modelId,
                  },
                  capabilities: capabilitiesFor(
                    renderRoles.image.connection.provider,
                    renderRoles.image.connection.capabilities ?? {},
                  ),
                },
                tone: toneOf(inputs.lore.treatment?.treatment),
                channels: renderedChannels(running),
                /**
                 * **Empty at 1.0, and a field rather than a later migration.**
                 * What an endpoint wants beyond a prompt is per-connection
                 * production configuration, and [P2B] keeps that on the
                 * connection rather than in a session. The seed is deliberately
                 * absent: it is the worker's, because it is the one value that
                 * must not be part of *what picture is this*.
                 */
                workflow: {},
                /**
                 * *A thunk, which is `ExtractContext.subjects`' shape and its
                 * reason*: the digest is not known until the fragments are
                 * assembled, which happens inside the step. **Always null until
                 * [P9.3]**, so this build dispatches every backdrop — the lookup
                 * arrives with the store that can answer it, and wiring a reuse
                 * check to a function that cannot look anything up would be a
                 * counter that reads zero for the wrong reason.
                 */
                reusable: () => null,
                report: (report) => {
                  renditions.report = report;
                },
              }),
            ],
          }
        : withSuggest;

    for (const { definition, run } of withRender.steps) {
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
            ...(speakers === undefined ? {} : { speakers }),
            // `mode.config` is where the wizard's answers live ([P7.4]) — a
            // step reads them as `setup`, which is the mode's word for its own
            // declaration, and the record's word is `config`.
            ...(answers === undefined ? {} : { setup: answers }),
            /**
             * Who is in the scene and what pictures travel with them — [P7.12].
             * `filterReads` drops it for a step that did not declare `cast`, so
             * this is the whole cast and the filter is where it narrows.
             */
            cast: castEntries(cast),
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
               *
               * ***Not at all when the step brought its own candidates***, which
               * is [P7.5] and is a correctness fix rather than a saving.
               * `performCall` already knows what this case means — it zeroes
               * `notFilled` and `refused` because *"a step supplied its own
               * candidates: the preset was not consulted, so it honestly has
               * nothing to say"* — but the retriever ran anyway, so a scan whose
               * blocks were then discarded still **moved every matched entry's
               * cooldown**. That is a lorebook entry recorded as having fired on
               * a turn where its text reached no prompt, which is exactly the
               * claim [P5.6]'s counters exist to make truthfully.
               *
               * *Nothing hit it before the plot-hook selector, which is the
               * first step in the build to pass `candidates` — and it passes
               * them for the reason [06 §6.1] gives: the judgement call is meant
               * to be **cheap**, and the accumulated prompt is the whole scene.*
               */
              const brought = request.candidates !== undefined;
              const lore = brought
                ? null
                : retrieve({
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
              if (lore !== null) loreEffects.push(...lore.effects);

              const fromPreset = brought
                ? { candidates: [], notFilled: [] }
                : collectCandidates({
                    preset,
                    callKind: definition.callKind,
                    // What the player did, for a preset's per-kind block —
                    // [13 §8.3], [P7.9]. Absent on a call with no submission
                    // behind it, which is what keeps a `say` block off a judge.
                    ...(payload.input === undefined ? {} : { inputKind: payload.input.kind }),
                    history: windowed,
                    persona: cast.persona,
                    actors: cast.actors,
                    channels: running,
                    lore: lore?.blocks ?? [],
                    carriers: { treatment: inputs.lore.treatment, books: inputs.lore.books },
                    ...(payload.input === undefined ? {} : { input: payload.input }),
                    ...(payload.guidance === undefined ? {} : { guidance: payload.guidance }),
                    // [06 §5.1]'s second producer, filled by the selector that ran
                    // before this loop reached any step that assembles.
                    ...(hooks.report?.guidance === undefined
                      ? {}
                      : { hookGuidance: hooks.report.guidance }),
                    // The story above the window — [07 §5.1], [P8.1]. Filled by
                    // the summariser, which is `pre` for the selector's reason
                    // and has therefore run before this loop reached anything
                    // that assembles. **Absent is not empty**: a session with no
                    // summary slot builds no chain, and `emptyReason` draws the
                    // line between *waiting on the engine* and *not yet long
                    // enough to have one*.
                    ...(summaries.report === null ? {} : { summary: summaries.report.links }),
                    // [06 §7.3.3]'s *always injected*, resolved by the gather so
                    // a preview and a turn cannot disagree about which goal.
                    ...(inputs.goals.current === null
                      ? {}
                      : {
                          goal: {
                            id: inputs.goals.current.id,
                            statement: inputs.goals.current.statement,
                          },
                        }),
                    // [06 §7.3.1]'s two dials, resolved by the gather for the
                    // reason the goal is: the authored rung runs through
                    // `mode.config` and the level is looked up in the pack, and
                    // neither is in the collector's hand.
                    dials: inputs.dials,
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
                  ...(lore === null ? {} : { refused: lore.refused }),
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
     * **A fired hook and a lapsed commitment, after the loop and not as a
     * step** — [06 §6.1], [P7.5], and the same rule the clock states below.
     *
     * `se.hook` is `engine-computed` because *a firing is the selector's
     * decision and a model proposing one would be a hook firing itself*; the
     * refusal covers a `step` proposal too, so the selector reports the firing
     * and the engine computes it. **Measured rather than reasoned to**: the step
     * proposed it first and `acceptEffect` recorded `applied: false`,
     * `rejectedReason: 'engine-computed'` — the policy working on the first
     * thing that tried it.
     *
     * *Before the clock, because it is the story's and the clock is
     * bookkeeping* — the same ordering the retriever's counters get for the
     * mirror-image reason.
     */
    if (!aborted && hooks.report !== null) {
      /**
       * **The lapses first, because one of them may be the hook that fired.**
       * A commitment that ran out of patience goes back in the pool, and the
       * selector re-filtered against that; applying the firing first and then
       * deleting the key would clear the state it had just written. Ordering
       * them is cheaper than special-casing the overlap.
       *
       * ***A set to null rather than a delete, and on this channel those are
       * the same claim.*** `store.ts`'s `inverseOf` draws the distinction
       * sharply — a key present holding null can mean *something happened and
       * the record of it is broken* — but that argument is about a timing
       * counter whose init is an object. `se.hook` declares
       * `init: { kind: 'literal', value: null }`, so **null is what *in the pool*
       * resolves to** and a reader cannot tell the two apart even in principle.
       *
       * *And `acceptEffect` admits only a whole-value set*, deliberately: every
       * partial op is a reducer the P6 gate would have to be re-proved against,
       * and [P7 §0.2] item 6 records the decision to add an arm only when a
       * channel can say why its value cannot be scoped instead. This one cannot
       * say that, because it does not need to.
       */
      for (const hookId of hooks.report.lapses ?? []) {
        const effect = acceptEffect(
          job.turnId,
          {
            channelId: SE_HOOK,
            scopeKey: hookId,
            op: { type: 'set', path: '/' },
            after: null,
            proposedBy: { kind: 'engine' },
          },
          running,
        );
        effects.push(effect);
        running = applyEffects(running, [effect]);
      }

      if (hooks.report.fired !== undefined) {
        const { hookId, state } = hooks.report.fired;
        /**
         * ***The extract pass decides what a provisional firing becomes*** —
         * [06 §6.1], [P7.7], and this closes [P7.5]'s fourth property row.
         *
         * *"Recorded provisionally fired, and becomes fired only when the
         * extract stage confirms the subject present on that turn;
         * unconfirmed, it returns to the pool with the attempt on the
         * record."* So: confirmed writes `fired`; **unconfirmed writes
         * nothing**, which is what *returns to the pool* is — and the attempt
         * is on the record either way, in the turn's own `hooks` line saying it
         * fired and naming the hook.
         *
         * **`provisional` is what a turn that could not answer leaves behind**,
         * which is the one path that still writes it: the extract step is
         * `failure: 'warn'`, so a pass that threw leaves the firing unresolved
         * rather than silently confirmed — the under-firing direction — and the
         * next turn's pass resolves it through `ExtractReport.resolved`.
         */
        const verdict = state === 'provisional' ? (extracted.report?.introduced ?? null) : null;
        const after =
          state !== 'provisional'
            ? state
            : verdict === null
              ? 'provisional'
              : verdict.confirmed
                ? 'fired'
                : null;

        if (after !== null) {
          const effect = acceptEffect(
            job.turnId,
            {
              channelId: SE_HOOK,
              scopeKey: hookId,
              op: { type: 'set', path: '/' },
              after,
              proposedBy: { kind: 'engine' },
            },
            running,
          );
          effects.push(effect);
          running = applyEffects(running, [effect]);
        }
      }

      /**
       * Provisional firings from earlier turns, resolved — the recovery path.
       * Confirmed if the subject turned up now; otherwise back in the pool,
       * because a hook the filter refuses as `pending` forever is worse than
       * one that lost its moment.
       */
      for (const one of extracted.report?.resolved ?? []) {
        const effect = acceptEffect(
          job.turnId,
          {
            channelId: SE_HOOK,
            scopeKey: one.hookId,
            op: { type: 'set', path: '/' },
            after: one.confirmed ? 'fired' : null,
            proposedBy: { kind: 'engine' },
          },
          running,
        );
        effects.push(effect);
        running = applyEffects(running, [effect]);
      }
    }

    /**
     * **A goal met, after the loop** — [06 §7.3.3], [P7.6], [25 C12].
     *
     * ***Attributed to the **model**, which is the one thing that makes
     * `model-proposed` mean anything here.*** The policy exists because
     * [06 §7.3.3] says *"the narrator's judgement is the only signal
     * available"* — so the record has to say a model judged this, with the call
     * it judged it in. A step attribution would have been true of the plumbing
     * and false about the decision. (`se.goal` is not the *first*
     * `model-proposed` channel — three cast channels have carried the policy
     * since [P3.0] — it is the first one a model's judgement is written to.)
     *
     * ***And it is expected to be refused.*** `se.goal` declares
     * `confirm: ['achieved']`, so this proposal normally lands
     * `applied: false, rejectedReason: 'needs-confirmation'`: recorded on the
     * turn, changing nothing, surfaced by the goal panel for a person to rule
     * on. `applyEffects` skips an unapplied effect, so the line below is a
     * deliberate no-op on the ordinary path and is kept because the path where
     * it is not — a mode that redeclares the channel without `confirm` — must
     * not silently leave `running` stale for the clock write underneath it.
     *
     * *The fallback is `step` rather than `engine`, and that is the gate rather
     * than tidiness.* `confirm` is checked for `model` and `step` only, so an
     * `engine` stamp here would have been a **bypass**: a judged completion
     * applying itself unasked on the one path where `calls` came back empty.
     * `step` is also the truer claim — with no call to point at, what is known
     * is that the judge step reported it.
     *
     * *Written by the runner rather than proposed by the step* for the reason
     * the firing is: what an achievement **means** for the session — which
     * offers to raise, whether anything moves — is the engine's, and
     * [06 §7.3.4] is explicit that none of it happens without asking.
     */
    if (!aborted && goals.report?.met === true) {
      const judged = calls.at(-1);
      const effect = acceptEffect(
        job.turnId,
        {
          channelId: SE_GOAL,
          scopeKey: goals.report.goalId,
          op: { type: 'set', path: '/' },
          after: 'achieved',
          proposedBy:
            judged === undefined
              ? { kind: 'step', stepId: GOAL_JUDGE_STEP.id }
              : { kind: 'model', callId: judged.id },
        },
        running,
      );
      effects.push(effect);
      running = applyEffects(running, [effect]);
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

    /**
     * ***Renditions, after the commit and awaited no further than the insert***
     * — [06 §10.2], [P9.2].
     *
     * **After `finaliseTurn`, never before**, so that a client which receives
     * `turn.finished` and immediately re-reads the session finds the turn there
     * ([09 §3.3]) *and* finds the rendition pending beside it. Enqueuing first
     * would let a fast provider land an asset on a turn the store has not
     * appended.
     *
     * *Records first, then jobs.* The record is what a placeholder renders from
     * and what the retry re-runs, so a job whose record did not land would be a
     * spinner with nothing behind it. Written here rather than by the worker for
     * the same reason: the recipe is known now and the worker may not start for
     * seconds.
     *
     * **Nothing below this line can fail the turn**, which is the whole of
     * §10.2 and the reason it is after the append rather than inside it.
     */
    if (renditions.report !== null && this.#options.dispatch !== undefined) {
      await this.#recordRenditions(job, draft, renditions.report);
    }
  }

  /**
   * Writes a turn's rendition records and queues their jobs.
   *
   * Every failure here is swallowed: a full disk or a store that would not write
   * costs a picture, and [06 §10.2] is explicit that it must never cost the turn
   * the picture was of.
   */
  async #recordRenditions(job: Job, draft: Turn, report: RenderReport): Promise<void> {
    const dispatch = this.#options.dispatch;
    if (dispatch === undefined) return;

    try {
      const records: Rendition[] = [];
      for (const [at, request] of report.requests.entries()) {
        const record: Rendition = {
          schema: RENDITION_SCHEMA,
          id: renditionIdFor(draft.id, at),
          sessionId: job.sessionId,
          turnId: draft.id,
          createdAt: new Date().toISOString(),
          kind: request.kind,
          purpose: request.purpose,
          scope: request.scope,
          state: 'pending',
          prompt: request.prompt,
          asset: null,
          provenance: {
            at: null,
            // **The binding is on the record before the call**, because the
            // digest already keys on it: a record that learned its model from
            // the answer would be a record whose reuse key could not be checked
            // until after the money was spent.
            binding: this.#options.imageBinding?.(job.account) ?? null,
            answeredAs: null,
            // Drawn by the step on the turn and recorded on its tape ([19 §14]),
            // so a `pending` record already states the seed its picture will be
            // made with — which is what lets re-creation be a replay.
            seed: request.seed,
            workflow: request.workflow,
          },
          error: null,
          digest: request.digest,
          ordering: request.ordering,
        };
        records.push(record);
        await writeRendition(
          this.#options.commit.sessions.layout,
          job.account,
          job.sessionId,
          record,
        );
      }
      dispatch(job.account, job.sessionId, records, draft.id);
    } catch {
      // Swallowed on purpose — see above.
    }
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

/**
 * A plain object, for the two authored values the pacing dial layers over.
 *
 * Both reach here as `unknown`: a Setup is stored on the session record and a
 * treatment comes back from a resolver that never throws, so a hand-edited file
 * puts a string or a number in either. `readPacing` validates the level itself;
 * this is only what makes the property access legal.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The introduction this turn fired, if it fired one — [06 §6.1], [P7.7].
 *
 * Read off the selector's report rather than off channel state, because the
 * firing has not been applied yet: the runner writes it after the loop, and the
 * extract step runs inside it.
 */
function pendingIntroduction(
  hooks: { report: HookSelectorReport | null },
  pool: readonly PooledHook[],
): { hookId: string; actorId: string } | null {
  const fired = hooks.report?.fired;
  if (fired?.state !== 'provisional') return null;
  const subject = pool.find((entry) => entry.hook.id === fired.hookId)?.hook.introduces?.actor.id;
  return subject === undefined ? null : { hookId: fired.hookId, actorId: subject };
}

/**
 * Provisional firings already on the record — the recovery path [P7.7]'s
 * `ExtractReport.resolved` exists for.
 *
 * A firing is confirmed on its own turn; one whose turn could not answer would
 * otherwise sit `pending` forever, because the filter refuses it and nothing
 * else looks at it again.
 */
function provisionalHooks(
  pool: readonly PooledHook[],
  channels: Readonly<Record<string, ChannelState>>,
): { hookId: string; actorId: string }[] {
  const out: { hookId: string; actorId: string }[] = [];
  for (const entry of pool) {
    if (readHookState(channels, entry.hook.id) !== 'provisional') continue;
    const subject = entry.hook.introduces?.actor.id;
    if (subject !== undefined) out.push({ hookId: entry.hook.id, actorId: subject });
  }
  return out;
}

/**
 * Everybody the scan should look for, and the surface forms that name them.
 *
 * ***The cast, plus the subject of any introduction in flight*** — [06 §6.1]:
 * a firing *"contributes the subject's card for that turn and adds their aliases
 * to the shared keyword scan… the scan is the third consumer of the one pass,
 * which is the argument for having built it as a pass rather than a lorebook
 * feature."* A subject who is not in the cast is precisely the one the scan must
 * not miss **on the one turn it matters**.
 *
 * *The subject's own card is not loaded here*: `resolveCast` unions the roster
 * with whoever the channels name, so an actor who has arrived is already in
 * `cast`. What this adds is the name the hook itself carries, which is enough to
 * find them in the prose and is all the confirmation needs.
 */
function castTerms(
  cast: { persona: CastMember | null; actors: CastMember[] },
  introducing: { hookId: string; actorId: string } | null,
  pending: readonly { hookId: string; actorId: string }[],
  pool: readonly PooledHook[],
  terms: ReadonlyMap<string, string[]>,
): Mentionable[] {
  const out = new Map<string, Mentionable>();
  for (const member of [...(cast.persona === null ? [] : [cast.persona]), ...cast.actors]) {
    out.set(member.actor.id, {
      actorId: member.actor.id,
      name: member.actor.name,
      terms: [member.actor.name, ...member.actor.aliases],
    });
  }

  for (const entry of pool) {
    const subject = entry.hook.introduces?.actor;
    if (subject === undefined) continue;
    // Only the ones in flight: a pool of thirty introductions would otherwise
    // put thirty names into every turn's scan for arrivals that are not
    // happening, which is a highlight claiming somebody is here who is not.
    const inFlight =
      introducing?.actorId === subject.id || readHookState({}, entry.hook.id) === 'provisional';
    if (!inFlight || out.has(subject.id)) continue;
    /**
     * ***The card's aliases, not just the `Ref`'s name*** — [06 §6.1] requires
     * exactly this, and the reason is the failure without it: a hook naming
     * *Vera Kohl* over prose that says *Vera came in* finds nothing, and a
     * provisional firing the narrator honoured is recorded as declined.
     *
     * *Measured rather than reasoned to.* The `Ref` carries a name and nothing
     * else, and the gather already reads the card to answer whether the subject
     * resolves — so the aliases were one field away on a read that was already
     * happening.
     */
    out.set(subject.id, {
      actorId: subject.id,
      name: subject.name,
      terms: terms.get(subject.id) ?? [subject.name],
    });
  }
  return [...out.values()];
}

/**
 * The treatment's tone as one line of an image prompt — [06 §10.3]'s fourth
 * fragment, [P9.1].
 *
 * ***Style, and not the whole of `TreatmentTone`.*** That object carries
 * `genres`, `moods`, `pov`, `tense`, `contentRating` and `styleNotes`, and only
 * the first two and the last describe how a picture should look: point of view
 * and tense are facts about **prose**, and handing *"second person, past tense"*
 * to an image model is the category error §10.3 opens by describing one size
 * larger.
 *
 * *`contentRating` is deliberately not read either.* [04 §6.2] makes it
 * advisory — *"nothing in the engine gates on it… because enforcement here would
 * be a promise that cannot be kept"* — and a rating spliced into an image prompt
 * would be exactly that promise, made to a model that cannot keep it.
 *
 * Returns null rather than an empty string when there is nothing to say, so the
 * fragment is **absent** rather than blank: a blank fragment would occupy a rank
 * and contribute a separator.
 */
function toneOf(treatment: unknown): string | null {
  if (!isRecord(treatment)) return null;
  const tone = treatment['tone'];
  if (!isRecord(tone)) return null;

  // Read through `unknown` rather than through a declared shape, which is
  // `readSummary`'s rule and `originOf`'s: a treatment reaches here out of a
  // library file, and a `Treatment` annotation would make the checks below look
  // redundant to the compiler while doing the only work that matters.
  const words = [...listOfStrings(tone['genres']), ...listOfStrings(tone['moods'])];
  if (typeof tone['styleNotes'] === 'string') words.push(tone['styleNotes']);

  const kept = words.map((word) => word.trim()).filter((word) => word !== '');
  return kept.length === 0 ? null : kept.join(', ');
}

/** The strings in an unknown array, and nothing else in it. */
function listOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
}

/**
 * The cast as a step sees it — [P7.12], and the manifest rather than the bytes.
 *
 * *Deliberately not the `Actor`.* A card is prose, sections, provenance and
 * forty fields; a step that wanted a name would be handed all of it, and the
 * payload filter would stop meaning anything. What crosses is what a step can
 * act on: who somebody is, and what pictures travel with them.
 *
 * **The persona is in it.** [P3.0]'s rule — *the persona is an actor too* — and
 * a mode staging a scene has no reason to leave the player's own character out
 * of it.
 */
function castEntries(cast: {
  persona: CastMember | null;
  actors: readonly CastMember[];
}): CastEntry[] {
  const everyone = cast.persona === null ? cast.actors : [cast.persona, ...cast.actors];
  return everyone.map((member) => ({
    actorId: member.actor.id,
    name: member.actor.name,
    kind: 'actors',
    media: member.actor.media.map((one) => ({
      id: one.id,
      role: one.role,
      ...(one.label === undefined ? {} : { label: one.label }),
    })),
    /**
     * **Structured appearance, and absent when the card has none** — [P9.1].
     *
     * `null` on the card and absent here are the same fact stated in the two
     * vocabularies this boundary joins: a portable schema says *the field exists
     * and holds nothing*, and a step payload says *you were not handed one*. The
     * conditional spread is what keeps them from becoming three states.
     */
    ...(member.actor.profile.visual === null ? {} : { visual: member.actor.profile.visual }),
  }));
}
