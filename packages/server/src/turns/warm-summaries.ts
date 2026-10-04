// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Accounts } from '../auth/accounts.js';
import type { Config } from '../config.js';
import type { ProviderFactory } from '../providers/factory.js';
import type { Logger } from '../state/commit.js';
import { readSession, type SessionContext } from '../sessions/store.js';
import { ensureChain, listSummaries, type Summariser } from '../sessions/summaries.js';
import { planChain } from '../sessions/summary-chain.js';
import type { SummaryWarm } from '../stream/bus.js';
import { fromModelCall, recordUsage } from '../usage/log.js';
import { CallFailed, Cancelled, performCall } from './calls.js';
import { gatherAssemblyInputs, roleLayersOf } from './gather.js';
import { transcriptOf } from './steps.js';
import {
  keptSummary,
  SUMMARISE_STEP,
  summarisablePath,
  summaryCandidates,
  summaryPlanFor,
} from './summarise.js';

/**
 * ***The summary chain, derived before anybody asks for it*** —
 * [P14.11](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [19 §7.5](../../../../docs/design/19-session-import.md)'s cliff.
 *
 * `ensureChain` is lazy and sequential by design — link *n* is
 * `f(link(n-1), units)`, and nothing is derived until a turn asks — which is
 * exactly right for a session grown one turn at a time, where each turn pays
 * for the one link it re-keyed. An import is the one way a session arrives
 * with its whole past at once: 2,000 turns at `span: 20` is ~99 summariser
 * calls, one after another, **inside the first turn played after import**,
 * with the person watching a turn that does not start. §7.5 offered two
 * answers — *"a post-import job warms the chain or the first turn says why it
 * is slow"* — and this is the first.
 *
 * ***The same chain the turn would ask for, and nothing else is worth
 * deriving.*** A link is content-addressed, so a warm helps only if every key
 * it writes is one the turn will read. So it asks the turn's own questions in
 * the turn's own words: `gatherAssemblyInputs` at the head (the parent a turn
 * submitted now would name), `summaryPlanFor` for *is there a chain and whose*
 * — slot, depth past the window, and the summariser's role resolved through
 * the session's `roles`, `stepRoles` and the account's bindings, whose
 * **resolved** binding is in every key ([P8 §1.9]) — `transcriptOf` and
 * `summarisablePath` for the path, and `summaryCandidates` and `keptSummary`
 * for the call and what is kept of it. *A session whose mode positions no
 * summary slot, or whose summariser will not resolve, warms nothing*: the
 * plan is null, and no event says a warm that never began has ended.
 *
 * ***Safe to race a turn because of the key; cheap to race one because of
 * `ensureChain`.*** A link's key is `H(summariser, previous link's key, unit
 * keys)` — never text — so whichever derivation of a link lands, the next
 * link's key is the same, and the chain the turn built and the chain the warm
 * built are one chain. What that alone does not bound is the bill: two lazy
 * walks of one chain run in lockstep, each finding the next link missing, so
 * a turn sent mid-warm would pay for every remaining link twice. So
 * `ensureChain` keeps the derivations in flight by link, and a walk that
 * reaches one another walk is deriving waits for it instead of calling: **a
 * race costs no duplicate call, and no key moves.** Whichever walk is ahead
 * derives; the other reads. `warm-summaries.test.ts` races them. The turn is
 * not otherwise made to wait for the warm, nor the warm to stop for the turn:
 * the turn waits only on a link it would have had to derive itself, and a
 * waiter whose link's derivation fails or is cancelled derives it on its own,
 * so a warm stopped by a delete does not fail the turn that joined it.
 *
 * ***Bounded, cancellable, and forgotten by a restart.***
 *
 * - **One warm per session.** A second import of the same session while its
 *   warm runs — a sync on a sweep — marks it to go round once more when it
 *   finishes, since the head may have moved and the chain with it; it does not
 *   start a second derivation of the same links.
 * - **A global cap** ({@link WARM_CONCURRENCY}), because a sweep can import a
 *   whole folder of long chats at once and a warm per chat in parallel would be
 *   a burst of calls at the person's endpoint that no turn asked for. The rest
 *   queue, first in first out.
 * - **Cancelled on delete**, through `SessionContext.deleting`, which
 *   `deleteSession` awaits before the folder moves; and on shutdown, by
 *   {@link SummaryWarmer.stop}, before the stores close.
 * - **Nothing is persisted about a warm.** A restart drops the queue and every
 *   warm in it, and that loses nothing: the links already written are on disk
 *   under their keys, and the next turn derives what is missing, which is the
 *   lazy path this only ever got ahead of.
 *
 * ***What it costs is recorded like any call outside a turn*** — one
 * `usage.jsonl` line per link, purpose `summarise` ([10 §11.4]'s obligation):
 * a warm is a model call nobody pressed a button for, which is the strongest
 * case there is for its bill being written down.
 */

/**
 * How many sessions warm at once, install-wide.
 *
 * *Two rather than one*, so a long import does not hold every other import's
 * warm behind it for minutes; *not more*, because each warm is a sequential
 * string of calls to what is, for most installs, one local model server that
 * the person's own turns are also waiting on. Not a config key: nobody has yet
 * measured a reason to turn it, and a key is a five-place edit to add and a
 * promise to keep.
 */
export const WARM_CONCURRENCY = 2;

export interface SummaryWarmContext {
  sessions: SessionContext;
  accounts: Accounts;
  providers: ProviderFactory;
  /** Read per warm, for the runner's reason: several keys it reaches are `live`. */
  config: Config;
  /** Where progress goes — `TurnStream.summaries` in the app. */
  report: (warm: SummaryWarm) => void;
  /** Test seam; the app takes {@link WARM_CONCURRENCY}. */
  concurrency?: number;
}

/**
 * *Read through a function*, because each is changed by another path while an
 * `await` is pending — `cancel` aborts, `request` sets `again` — and a check
 * written inline is narrowed by the compiler to what the line above it made
 * true, which is exactly the assumption an abort exists to break.
 */
function stopped(signal: AbortSignal): boolean {
  return signal.aborted;
}

function goesAgain(entry: Entry): boolean {
  return entry.again && !stopped(entry.controller.signal);
}

interface Entry {
  handle: string;
  sessionId: string;
  controller: AbortController;
  /** Asked for again while running: go round once more at the end. */
  again: boolean;
  /** Set once it leaves the queue; what cancel and stop wait on. */
  done: Promise<void> | null;
}

export class SummaryWarmer {
  readonly #context: SummaryWarmContext;
  readonly #entries = new Map<string, Entry>();
  readonly #queue: Entry[] = [];
  #running = 0;
  #stopped = false;
  #log: Logger | null = null;

  constructor(context: SummaryWarmContext) {
    this.#context = context;
  }

  setLogger(log: Logger): void {
    this.#log = log;
  }

  /**
   * Warm this session's chain, soon. Never throws and never waits: it is
   * called from an import's success path, and the import's answer is not the
   * warm's business.
   */
  request(handle: string, sessionId: string): void {
    if (this.#stopped) return;
    const held = this.#entries.get(sessionId);
    if (held !== undefined) {
      // Queued: it has not read the head yet, so it will read this one.
      // Running: it may have read the head before this import moved it.
      if (held.done !== null) held.again = true;
      return;
    }
    const entry: Entry = {
      handle,
      sessionId,
      controller: new AbortController(),
      again: false,
      done: null,
    };
    this.#entries.set(sessionId, entry);
    this.#queue.push(entry);
    this.#pump();
  }

  /**
   * Stops this session's warm and waits for it to have stopped — the
   * `deleting` hook. A queued warm is dropped without a word, since nothing
   * was said about it starting either.
   */
  async cancel(sessionId: string): Promise<void> {
    const entry = this.#entries.get(sessionId);
    if (entry === undefined) return;
    entry.again = false;
    entry.controller.abort();
    if (entry.done === null) {
      this.#queue.splice(this.#queue.indexOf(entry), 1);
      this.#entries.delete(sessionId);
      return;
    }
    await entry.done;
  }

  /** Every warm stopped and waited for, and no more accepted — shutdown. */
  async stop(): Promise<void> {
    this.#stopped = true;
    const all = [...this.#entries.values()];
    await Promise.all(all.map((entry) => this.cancel(entry.sessionId)));
  }

  /** Resolves once nothing is queued or running — for tests waiting for quiet. */
  async idle(): Promise<void> {
    for (;;) {
      const pending = [...this.#entries.values()].map((entry) => entry.done);
      if (pending.length === 0) return;
      await Promise.all(pending.map((done) => done ?? Promise.resolve()));
      // A queued warm has no `done` yet; give the pump a turn to start it.
      await new Promise((tick) => setImmediate(tick));
    }
  }

  /** Whether this session has a warm queued or running. */
  warming(sessionId: string): boolean {
    return this.#entries.has(sessionId);
  }

  #pump(): void {
    const cap = this.#context.concurrency ?? WARM_CONCURRENCY;
    while (this.#running < cap && this.#queue.length > 0) {
      const entry = this.#queue.shift();
      if (entry === undefined) return;
      this.#running += 1;
      entry.done = this.#drive(entry).finally(() => {
        this.#running -= 1;
        this.#entries.delete(entry.sessionId);
        this.#pump();
      });
    }
  }

  async #drive(entry: Entry): Promise<void> {
    do {
      entry.again = false;
      try {
        await this.#warm(entry);
      } catch (error) {
        // A warm that could not even plan — a session file gone bad, an index
        // closed under it — is a turn that will derive its own chain later.
        this.#log?.warn(
          {
            event: 'summaries.warm-failed',
            sessionId: entry.sessionId,
            reason: error instanceof Error ? error.name : 'unknown',
          },
          'The summary chain could not be warmed',
        );
      }
    } while (goesAgain(entry));
  }

  async #warm(entry: Entry): Promise<void> {
    const { sessions, accounts, providers, config, report } = this.#context;
    const { handle, sessionId, controller } = entry;
    const signal = controller.signal;

    const session = await readSession(sessions, handle, sessionId);
    if (session === null || signal.aborted) return;

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: handle, sessionId, parentTurnId: session.headTurnId },
    );
    const plan = summaryPlanFor(inputs);
    if (plan === null) return;

    const path = summarisablePath(transcriptOf(inputs.history));
    /**
     * ***Rooted as the turn is*** (2026-10-03, at the [P15] merge). A session
     * started from a Setup with a story so far keys its first link off that
     * root, so a warm that planned without it counted every link missing,
     * derived a chain no turn reads, and left the turn to derive its own.
     * `plan.root` is the turn's root by construction — the runner passes the
     * same field of the same plan.
     */
    const planned = planChain(path, plan.key, plan.policy, plan.root?.key ?? null);
    const held = await listSummaries(sessions.layout, handle, sessionId);
    const missing = planned.filter((link) => !held.has(link.key)).length;
    // Warm already: nothing to derive, and so nothing to say.
    if (missing === 0 || stopped(signal)) return;

    const progress = { sessionId, links: planned.length, missing, derived: 0 };
    report({ ...progress, state: 'warming' });

    const summariser: Summariser = {
      key: plan.key,
      signal,
      run: async ({ previous, units }) => {
        let outcome;
        try {
          outcome = await performCall(
            {
              definition: SUMMARISE_STEP,
              ...roleLayersOf(inputs),
              providers,
              config,
              preset: { params: inputs.preset.params, budget: inputs.preset.budget },
              signal,
              // The step brings its own candidates: the preset was not asked,
              // so it has nothing to say about what the preset left unfilled.
              notFilled: [],
              onCallAssembled: () => {
                /* No draft: what this call produces is a file under its key. */
              },
              onProgress: () => {
                /* No stream: nobody is watching a turn that does not exist. */
              },
            },
            { candidates: summaryCandidates(previous, units) },
            [],
          );
        } catch (error) {
          // A call that got as far as the provider was paid for, even if
          // nothing it said is kept.
          if ((error instanceof CallFailed || error instanceof Cancelled) && error.call) {
            await recordUsage(
              sessions.layout,
              handle,
              fromModelCall(error.call, 'summarise', { sessionId }),
            );
          }
          throw error;
        }
        await recordUsage(
          sessions.layout,
          handle,
          fromModelCall(outcome.call, 'summarise', { sessionId }),
        );
        /**
         * ***Not written once the session is going.*** The abort reaches the
         * provider through `signal`, but a reply that landed a moment before
         * it would otherwise be written by `ensureChain` into a folder
         * `deleteSession` is about to move — so a late answer is thrown here,
         * and `ensureChain` stops at it and writes nothing.
         */
        if (signal.aborted) throw new Cancelled();
        const text = keptSummary({ text: outcome.text, outcome: outcome.call.outcome });
        progress.derived += 1;
        // The count of links whose text is in hand; the write follows it at once.
        if (progress.derived < missing) report({ ...progress, state: 'warming' });
        return text;
      },
    };

    const chain = await ensureChain(
      sessions.layout,
      handle,
      sessionId,
      path,
      summariser,
      plan.policy,
      plan.root,
    );

    if (chain.failure === undefined) {
      report({ ...progress, derived: chain.derived, state: 'warmed' });
      return;
    }
    const cancelled = stopped(signal) || chain.failure instanceof Cancelled;
    report({ ...progress, derived: chain.derived, state: cancelled ? 'cancelled' : 'failed' });
    if (!cancelled) {
      this.#log?.warn(
        {
          event: 'summaries.warm-stopped',
          sessionId,
          derived: chain.derived,
          missing,
          reason: chain.failure instanceof Error ? chain.failure.message : 'unknown',
        },
        'A summary link could not be derived; the next turn will ask for it again',
      );
    }
  }
}
