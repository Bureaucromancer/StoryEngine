// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

import type { Rendition, RenditionError } from '@storyengine/shared';

import { sessionFilePath, withSessionLock } from '../sessions/store.js';
import { ensureDirectory, fileExists, writeFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { PathEscapeError, resolveWithin } from '../storage/paths.js';
import type { Connection } from '../providers/connections.js';
import type { ProviderFactory } from '../providers/factory.js';
import { ProviderError } from '../providers/types.js';
import { readRendition, sessionAssetsRoot, writeRendition } from './store.js';
import {
  enqueueRendition,
  reconcileRenditionJobs,
  setRenditionJobStatus,
  type RenditionJob,
} from './jobs.js';
import { recreateRendition } from './manual.js';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Where the pixels come from — [06 §10.2](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P9.2].
 *
 * ***The turn is already committed by the time anything here runs***, which is
 * the whole of §10.2: *"the turn completes on text. Renditions are dispatched as
 * their own jobs and arrive later over the event stream."* Not an optimisation —
 * *"an image is seconds and a video can be minutes, and a story that stalls on
 * either is unusable"* — so the shape has to make stalling impossible rather
 * than merely unlikely. {@link dispatchRenditions} is an insert, a record
 * written and a detached promise per picture, and nothing in a turn's lifetime
 * awaits the last of those.
 *
 * **The falsifying mutation is making the image call inside the step.** Every
 * assertion about pixels still passes and the turn blocks, which is why
 * `p9-gate.test.ts` asserts on *the turn committing while the rendition is
 * pending* rather than on a picture arriving.
 */

/** What the worker needs to do its job, held by `AppServices`. */
export interface RenditionWorkerContext {
  db: DatabaseSync;
  layout: Layout;
  providers: ProviderFactory;
  /** The connection the `image` role resolves to, for this account. */
  connectionFor: (account: string) => Promise<Connection | null>;
  /** Told when a rendition's state changed, so the stream can say so. */
  changed?: (sessionId: string, rendition: Rendition) => void;
  /**
   * Told when a rendition **stopped being pending**, so a person can be told —
   * [09 §3.5]'s `artifact.ready`, [P10.1].
   *
   * ***Beside `changed` rather than derived from it, because the two answer
   * different questions and one of them needs an account.*** `changed` says
   * *this session's watchers should repaint*, and a session stream is scoped to
   * a session, so it needs no handle. This says *somebody should be told*, and
   * [09 §3.1] puts that decision on the server against a **person** — which is
   * the account on the job and is not recoverable from a session id here.
   *
   * ***And it fires on a failure as well as on a success***, which is why it is
   * called `settled` while the class it feeds is called `artifact.ready`.
   * [09 §3.5] chose that name over `rendition-ready` *"precisely so its second
   * instance would not require renaming it"*, and a picture that failed is the
   * same subject in a different state: the outcome rides in the params, and
   * [P10 §1.4]'s *decide the failure case before writing the table* is that
   * decision made here rather than by a fifth class.
   *
   * *Nothing calls this for a backdrop that was reused* — [P9 §1.7]'s money
   * row dispatches no job, so nothing settles, and there is no news.
   */
  settled?: (account: string, sessionId: string, rendition: Rendition) => void;
  /**
   * Points the backdrop channel at a rendition that just became ready — [P9.3].
   *
   * ***A callback rather than a direct call***, because the write needs a
   * `SessionContext` and this module has a `Layout`: the two are different
   * halves of the session store, and a worker that held both would be a worker
   * that could append turns. What it can do is say *this one is ready*, and the
   * engine decides that means the backdrop moved.
   */
  select?: (account: string, sessionId: string, renditionId: string) => Promise<void>;
  /** Injected so a test can make a seed predictable. */
  seed?: () => number;
  /**
   * ***Where a picture still being made is kept, so shutdown can wait for it.***
   *
   * [P9.2] made the dispatch detached on purpose — *"the thing not being waited
   * for is the thing [06 §10.2] says must never be waited for"* — and
   * [runner.ts]'s own note explains why the runner must not own the worker: *"a
   * runner whose shutdown had to drain pictures"* is the coupling that phase
   * existed to avoid. **Both are still right.** What neither of them says is
   * where the waiting happens *instead*, and the answer was nowhere: a job
   * fired after the last turn committed carried on writing assets and calling
   * `setRenditionJobStatus` into a `DatabaseSync` that `disposeServices` had
   * already closed.
   *
   * `disposeServices` argues against exactly this, one line above where the hole
   * was — *"a detached turn touching a closed `DatabaseSync` is the failure that
   * surfaces on Windows as `EBUSY` on a file the caller never named"* — and the
   * argument transfers verbatim to a detached **rendition**, which touches the
   * same handle. Found from the other end (2026-09-17): a full-suite run went
   * red with `ENOTEMPTY` removing a session directory, because a test's `rm`
   * raced an asset write that nothing had waited for.
   *
   * **A set on the context rather than a worker object**, so the seam P9.2 drew
   * stays where it is: the runner still knows nothing, and what shutdown gets is
   * a thing to await rather than a component to own.
   *
   * *Optional, so every test double stays a double* — absent means nothing is
   * tracked and the dispatch behaves exactly as it did.
   */
  inFlight?: Set<Promise<void>>;
  /**
   * ***Aborted when shutdown stops waiting***, and every picture's call to the
   * endpoint carries its signal.
   *
   * `renderImage` used to be called with no signal at all, though the adapter
   * already accepted one, and `drainRenditions` waited without a bound. So a
   * picture against an endpoint that had stopped answering held shutdown open
   * for as long as the socket lived: a restart or a restore waited on it, and
   * a `docker stop` waited for Docker's `SIGKILL`. What `drainRenditions` now
   * does with the signal is in that function's note.
   *
   * *Optional, for `inFlight`'s reason.*
   */
  shutdown?: AbortController;
}

/**
 * How long shutdown lets a picture still being made land on its own.
 *
 * ***Five seconds, so a plain `docker stop` can still end cleanly.*** Docker's
 * default grace is ten seconds in all, and closing the app and draining the
 * turns come first. Pictures are paid for, so some wait is worth it, but not a
 * wait that makes the supervisor `SIGKILL` the process: a picture cut off
 * here is recorded as interrupted, with its retry button, which is what a
 * restart owes it anyway ([06 §10.2]: *"a failed rendition is a placeholder,
 * never a failed turn"*). The shipped wrappers allow thirty seconds in all.
 */
export const RENDITION_DRAIN_MS = 5_000;

/**
 * How long a picture that shutdown cut off gets to record that it was.
 *
 * The abort makes the endpoint call reject at once, and the worker's own catch
 * writes the record. This bound is for an adapter that ignores the signal:
 * shutdown stops waiting for it, and the next boot's `recoverRenditions` marks
 * whatever it left `pending`.
 */
export const RENDITION_ABORT_SETTLE_MS = 2_000;

/** How `drainRenditions` is bounded — the constants above, unless a test says otherwise. */
export interface RenditionDrainOptions {
  graceMs?: number;
  settleMs?: number;
}

/**
 * What a turn's renditions cost.
 *
 * ***`ChainResult.derived`'s instrument, on a second subject*** — [P9 §0.3]'s
 * item 3. `ensureChain` reports how many links it had to derive so that *a warm
 * chain derives zero* is a **number** rather than a claim, and the same move is
 * what gate rows 10 and 12 need: *no job was dispatched* and *no job was
 * observed* are different assertions, and only one of them survives a harness
 * that stopped watching.
 */
export interface DispatchResult {
  /**
   * Jobs enqueued. **A place already rendered dispatches zero**, and so does a
   * record whose job was already live — that one was dispatched by somebody
   * else, and counting it here would count one picture twice.
   */
  dispatched: number;
  /** Backdrops resolved to a sibling already paid for — [P9 §1.7]'s money row. */
  reused: number;
}

/**
 * Claims, records and starts every rendition a turn or a person asked for, and
 * returns once they have started, without waiting for any picture.
 *
 * **Called after `finaliseTurn`, never before**, so that a client which sees
 * `turn.finished` and re-reads the session finds the turn there *and* finds the
 * rendition pending beside it. Enqueuing first would let a fast provider land an
 * asset on a turn the store has not appended.
 *
 * ***The job row first, then the record, then the run*** (2026-09-27). The
 * runner and the Illustrate route used to write the `pending` record and then
 * call this to claim its job, so a process that died between the two left a
 * record no job named. Recovery reads job rows, so it never found one: a
 * placeholder that said *Making a picture of this…* for good, with no button.
 * P9 recorded the window and left it, because closing it was a choice of
 * order. Claimed first, every record on disk has a job row behind it. A restart
 * that cuts a picture off finds it and marks it `interrupted` with its retry,
 * and a job whose record never landed has nothing to strand, so recovery
 * abandons it. The retry route already worked in this order.
 *
 * ***And an open page is told the picture is coming*** (2026-09-27). The stream
 * carried a `rendition` frame when a picture landed or failed and none while it
 * was pending, so the placeholder [25 E3] decided on appeared only if the page
 * happened to refetch. A turn's prose landed, nothing said a picture was on
 * its way, and thirty seconds later one arrived. The frame goes out after the
 * record is written and before the job starts, so it cannot arrive after the
 * frame that says the picture landed.
 *
 * *A record that cannot be written costs that one picture*, and nothing is
 * started for it.
 */
export async function dispatchRenditions(
  context: RenditionWorkerContext,
  account: string,
  sessionId: string,
  records: readonly Rendition[],
  turnId: string,
): Promise<DispatchResult> {
  const claimed: { record: Rendition; job: RenditionJob }[] = [];
  for (const record of records) {
    if (record.state !== 'pending') continue;
    const { job, created } = enqueueRendition(context.db, {
      sessionId,
      account,
      renditionId: record.id,
      turnId,
      purpose: record.purpose,
    });
    /**
     * ***Only a job this call made is run.*** A live job handed back belongs to
     * whoever enqueued it, and is already running in this process — boot
     * abandons every live job before the listener accepts anything, so there is
     * no other way for one to exist. Until 2026-09-26 this ran whatever came
     * back, which made the constraint stop a second **row** and not a second
     * **run**: a double dispatch was two image calls on one job.
     */
    if (!created) continue;
    claimed.push({ record, job });
  }

  let dispatched = 0;
  for (const { record, job } of claimed) {
    try {
      await writeRendition(context.layout, account, sessionId, record);
    } catch {
      /**
       * ***The disk is asked what happened***, because a write can land and
       * still throw: the atomic writer stats the file after its rename. A
       * record that is there is dispatched like any other, since giving its
       * claim up would leave exactly the `pending` record with no live job
       * this order exists to prevent. One that is not there gives its claim
       * up, so a later retry is not answered *already in hand*.
       */
      const landed = await readRendition(context.layout, account, sessionId, record.id).catch(
        () => null,
      );
      if (landed === null) {
        setRenditionJobStatus(context.db, job.id, 'abandoned', 'retryable');
        continue;
      }
    }
    context.changed?.(sessionId, record);
    dispatched += 1;
    launch(context, job);
  }
  return { dispatched, reused: 0 };
}

/**
 * Starts one job's picture, detached and tracked.
 *
 * **Detached, and the promise is deliberately not returned.** `TurnRunner` makes
 * the same choice for the same reason — *"fire-and-forget by design: the HTTP
 * response is a job id, and the stream is how a client watches"* — and here it is
 * load-bearing rather than convenient, because the thing not being waited for is
 * the thing §10.2 says must never be waited for.
 *
 * ***Detached is not untracked***, which is the distinction that was missing
 * until 2026-09-17. Nobody waits for this to answer a request; `inFlight` is what
 * lets **shutdown** wait for it, and the two are different waits. See that field
 * for what the absence cost.
 *
 * *One function for both starters*, the turn's dispatch and the retry, so the
 * tracking cannot be present on one path and forgotten on the other — which is
 * exactly how it was missing the first time.
 */
function launch(context: RenditionWorkerContext, job: RenditionJob): void {
  const work = runRendition(context, job).catch(() => undefined);
  const live = context.inFlight;
  if (live === undefined) {
    void work;
    return;
  }
  // Removed by the same promise that added it, so the set holds only what is
  // genuinely still running — a set that only grew would make `drain` a wait on
  // every picture the process ever made.
  const tracked = work.finally(() => {
    live.delete(tracked);
  });
  live.add(tracked);
}

/**
 * **Try again** — the retry button [06 §10.2] promises, and the re-creation
 * [25 E3] describes.
 *
 * ***The job is claimed before the record is touched***, and the order is the
 * whole of this function. The record is written by `writeAtomic`, which awaits
 * a `stat` after its rename, and the worker marks its job finished only after
 * that write returns — so there is a real window in which the file already says
 * `failed` and the job that wrote it is still live. A retry that rewrote the
 * record to `pending` first and then found that live job would have nothing to
 * run and nobody left to finish it: a `pending` record with no job behind it,
 * which renders with no button and which boot recovery, reading job rows, would
 * never find.
 *
 * Claimed first, the same request is harmless. **A live job answers**, the
 * record is returned as it stands, and nothing is written — the try in flight
 * finishes the record itself. *Nothing live*, and this call owns the next try:
 * the record goes back to `pending` and the job starts. A crash between the two
 * leaves the record `failed` with its button, and a crash after them is a live
 * job with a `pending` record, which {@link recoverRenditions} marks.
 *
 * *The recipe is replayed, never re-asked*: {@link recreateRendition} is gate
 * step 15's structural half, and this adds only the order it is called in.
 */
export async function retryRendition(
  context: RenditionWorkerContext,
  account: string,
  sessionId: string,
  held: Rendition,
): Promise<Rendition> {
  const { job, created } = enqueueRendition(context.db, {
    sessionId,
    account,
    renditionId: held.id,
    turnId: held.turnId,
    purpose: held.purpose,
  });
  if (!created) {
    return (await readRendition(context.layout, account, sessionId, held.id)) ?? held;
  }

  const again = await recreateRendition(context.layout, account, sessionId, held).catch(
    (error: unknown) => {
      // The record could not be written, so it still says what it said, and
      // its button still works. The claim must not outlive the attempt: a live
      // job nobody runs would answer every later retry with *already in hand*.
      setRenditionJobStatus(context.db, job.id, 'abandoned', 'retryable');
      throw error;
    },
  );
  /**
   * ***Said to an open page, as a dispatch says it*** (2026-09-28), and before
   * the job starts, so `pending` reaches the page ahead of whatever the try
   * ends as. Without it the page held the `failed` frame it had been sent, and
   * the stream's record outranks a refetch there, so *That did not come out*
   * and its Try again stayed on screen through the whole retry.
   */
  context.changed?.(sessionId, again);
  launch(context, job);
  return again;
}

/**
 * What a restart owes the pictures the last process was making — [P9.2].
 *
 * ***Two halves, and until 2026-09-26 only the first existed.***
 * {@link reconcileRenditionJobs} abandons every job still live, which is
 * `state/commit.ts`'s rule: *"recovery resumes finalisation, never generation"*,
 * and a provider call that died with the process cannot be picked up. That
 * settles the **store**. It did not settle the **record**, which is what a
 * person is looking at — and a record left `pending` renders *"Making a picture
 * of this…"* **with no retry button**, so every picture a restart interrupted
 * became a placeholder nobody could press. Three comments said boot marked them
 * `interrupted`; the client has had a sentence for that class since P9.4; and
 * nothing wrote it.
 *
 * **So each interrupted job's record is marked the way {@link fail} marks one**:
 * `failed`, a class in `error`, `asset: null`, the recipe untouched — [06 §10.2]'s
 * *placeholder with a retry button*, which is what makes abandoning generation
 * acceptable here when it would not be for a turn. And the person is told, the
 * way `fail` tells them: a failure they did not watch happen is the one
 * `artifact.ready` is most for.
 *
 * *Only a record still `pending` is touched.* One that already says `ready` or
 * `failed` was written by the worker before it died between that write and the
 * job's status — the record is right, and rewriting it would lose a picture.
 *
 * ***One bad record costs one picture, never the boot.*** Each is tried on its
 * own and a failure is passed over, which is `store.ts`'s *every read failure
 * is a miss* applied to the one caller that runs before anybody can see an
 * error.
 */
export async function recoverRenditions(
  context: RenditionWorkerContext,
): Promise<{ interrupted: number; marked: number }> {
  const { interrupted } = reconcileRenditionJobs(context.db);
  let marked = 0;
  for (const job of interrupted) {
    try {
      const record = await readRendition(
        context.layout,
        job.account,
        job.sessionId,
        job.renditionId,
      );
      if (record?.state !== 'pending') continue;
      const failed: Rendition = { ...record, state: 'failed', asset: null, error: 'interrupted' };
      await writeRendition(context.layout, job.account, job.sessionId, failed);
      marked += 1;
      context.changed?.(job.sessionId, failed);
      context.settled?.(job.account, job.sessionId, failed);
    } catch {
      // Passed over, per the note above. The job is abandoned either way; a
      // record that could not be read or written stays as it was — one picture
      // this cannot mend, rather than a server that will not start. The log line
      // shows it as `marked` falling short of `interrupted`.
    }
  }
  return { interrupted: interrupted.length, marked };
}

/**
 * Waits for every picture still being made — the other half of `inFlight` —
 * and then stops waiting.
 *
 * ***A loop rather than one `Promise.all`***, because a rendition can outlive
 * the snapshot taken when the wait began: `select` writes a channel, and a
 * channel write is a session write, which is the sort of thing that can dispatch
 * again. Waiting on a list captured once would return with work still running,
 * which is the bug this function exists to prevent wearing a fix.
 *
 * ***Bounded twice*** (2026-09-27). It used to wait with no bound for pictures
 * whose endpoint calls had no signal, so one stalled image endpoint held every
 * shutdown open until the supervisor killed it. Now:
 *
 * 1. **The grace.** Pictures get `graceMs` to land on their own.
 * 2. **The cut.** Whatever is left has its call aborted through `shutdown`, and
 *    the worker records each one as `failed` / `interrupted`, recipe intact,
 *    the same record `recoverRenditions` writes for a picture a crash
 *    interrupted.
 * 3. **The settle.** Those records get `settleMs` to be written. After that
 *    this returns whatever is still running, because the stores are about to
 *    close and a process that cannot exit is worse than a job the next boot
 *    reconciles.
 *
 * **It never rejects.** Each entry is already `.catch`ed at dispatch, and a
 * shutdown that threw because a picture failed would turn [06 §10.2]'s *"a
 * failed rendition is a placeholder, never a failed turn"* into *a failed
 * process* at the one moment nobody is watching.
 */
export async function drainRenditions(
  context: RenditionWorkerContext,
  options: RenditionDrainOptions = {},
): Promise<void> {
  const live = context.inFlight;
  if (live === undefined) return;
  if (await quietWithin(live, options.graceMs ?? RENDITION_DRAIN_MS)) return;
  context.shutdown?.abort();
  await quietWithin(live, options.settleMs ?? RENDITION_ABORT_SETTLE_MS);
}

/** True once `live` is empty, false if `ms` ran out first. */
async function quietWithin(live: Set<Promise<void>>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (live.size > 0) {
    const left = deadline - Date.now();
    if (left <= 0) return false;
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, left);
      // Never the reason a process stays alive: this is shutdown.
      timer.unref();
    });
    await Promise.race([Promise.all([...live]), expired]);
    clearTimeout(timer);
  }
  return true;
}

/**
 * One picture, start to finish.
 *
 * ***Never throws to its caller.*** Every failure path ends with a record whose
 * `state` is `failed`, whose `error` is a **class**, and whose recipe is
 * untouched — which is [06 §10.2]'s *"a failed rendition is a placeholder with a
 * retry button, never a failed turn"* expressed as the only exit this function
 * has.
 */
export async function runRendition(
  context: RenditionWorkerContext,
  job: RenditionJob,
): Promise<void> {
  const record = await readRendition(context.layout, job.account, job.sessionId, job.renditionId);
  if (record === null) {
    // The record is gone — a session deleted underneath us, or a hand edit. The
    // job has nothing to fill, and saying so is better than retrying forever.
    setRenditionJobStatus(context.db, job.id, 'abandoned', 'terminal');
    return;
  }

  setRenditionJobStatus(context.db, job.id, 'running');

  try {
    const connection = await context.connectionFor(job.account);
    if (connection === null) {
      await fail(context, job, record, 'no-binding');
      return;
    }

    const provider = context.providers(connection);
    if (provider.renderImage === undefined || !provider.capabilities.rendersImages) {
      /**
       * **The capability is checked, not assumed** — the rule `stream` states
       * one field up: *"the caller checks; a provider that cannot stream does
       * not pretend to by yielding once."* A connection whose `rendersImages` is
       * false is one somebody bound `image` to by mistake, and this is where
       * they find out in a form with a sentence attached.
       */
      await fail(context, job, record, 'no-binding');
      return;
    }

    /**
     * ***The seed comes off the record, and the step drew it on the turn***
     * ([19 §14], [P9.1]).
     *
     * So this function makes no random draw at all — which is what lets a
     * re-creation be a **replay**: the same record, the same seed, the same
     * prompt, and therefore the same picture from an endpoint that honours one.
     * A worker that drew its own would make *"the recipe is preserved"* mean
     * *approximately re-creatable*, which [06 §10.7] says is a different promise.
     *
     * `0` for a record written without one, which is only a hand-edited file:
     * an endpoint that ignores the seed produces a different picture and the
     * record still says what was asked for, which is the honest failure.
     */
    const seed = context.seed?.() ?? record.provenance.seed ?? 0;

    const result = await provider.renderImage({
      modelId: record.provenance.binding?.modelId ?? connection.models[0] ?? '',
      prompt: record.prompt.text,
      seed,
      workflow: filterScalars(record.provenance.workflow),
      // Shutdown's, so a stalled endpoint cannot hold the process open.
      ...(context.shutdown === undefined ? {} : { signal: context.shutdown.signal }),
    });

    const path = assetPathFor(context.layout, job.account, job.sessionId, record.id, result.mime);
    if (path === null) {
      await fail(context, job, record, 'terminal');
      return;
    }

    const ready: Rendition = {
      ...record,
      state: 'ready',
      asset: {
        path: fileNameFor(record.id, result.mime),
        mime: result.mime,
        bytes: result.bytes.byteLength,
        digest: `sha256:${createHash('sha256').update(result.bytes).digest('hex')}`,
      },
      provenance: {
        ...record.provenance,
        at: new Date().toISOString(),
        // Echoed from the result rather than from the request, so the record
        // says what ran rather than what was asked for.
        seed: result.seed,
        answeredAs: result.modelId === record.provenance.binding?.modelId ? null : result.modelId,
      },
      error: null,
    };
    const landed = await intoSession(context, job, async () => {
      await ensureDirectory(sessionAssetsRoot(context.layout, job.account, job.sessionId));
      await writeFileBytes(path, result.bytes);
      await writeRendition(context.layout, job.account, job.sessionId, ready);
    });
    if (!landed) {
      setRenditionJobStatus(context.db, job.id, 'abandoned', 'terminal');
      return;
    }
    setRenditionJobStatus(context.db, job.id, 'done');

    /**
     * ***A backdrop that arrived is a backdrop that is showing*** — [06 §10.1a],
     * [P9.3].
     *
     * The artefact is on disk; the **selection** is channel state, and nothing
     * would be showing until something wrote the pointer. Only for a background:
     * an illustration belongs to one turn and is shown because that turn is on
     * screen, which needs no pointer at all.
     *
     * *After the record is written*, so a channel that names a rendition always
     * names one that exists — the same ordering `appendTurnToSession` takes for
     * the turn and its head: **the durable thing first, then the derived one**.
     */
    if (ready.purpose === 'background') {
      await context.select?.(job.account, job.sessionId, ready.id);
    }
    context.changed?.(job.sessionId, ready);
    context.settled?.(job.account, job.sessionId, ready);
  } catch (error) {
    /**
     * ***Cut off by shutdown is `interrupted`, whatever the adapter threw.***
     * The abort reaches the adapter as a cancellation, which it reports as
     * `transient` or not at all, and neither is what happened: the picture was
     * fine and the process was leaving. `interrupted` is the class
     * `recoverRenditions` gives a picture a crash cut off, and the client
     * already has its sentence and its retry button.
     */
    const interrupted = context.shutdown?.signal.aborted === true;
    await fail(context, job, record, interrupted ? 'interrupted' : classOf(error));
  }
}

/**
 * A failed picture, recorded the only way this subsystem records one.
 *
 * `asset: null`, `prompt` and `provenance` untouched, and a **class** in
 * `error`. The recipe surviving a failure is what makes the retry button mean
 * *run this again* rather than *guess again*.
 */
async function fail(
  context: RenditionWorkerContext,
  job: RenditionJob,
  record: Rendition,
  reason: RenditionError,
): Promise<void> {
  const failed: Rendition = { ...record, state: 'failed', asset: null, error: reason };
  let landed = true;
  try {
    landed = await intoSession(context, job, () =>
      writeRendition(context.layout, job.account, job.sessionId, failed),
    );
  } catch {
    // A write that cannot land leaves the record as it was on disk — `pending`,
    // for a job that got this far. Losing the *job's* status too would lose the
    // only remaining trace, so the status update below runs regardless. (It is
    // not left for boot to find: this marks the job finished, and
    // `recoverRenditions` reads live jobs only.)
  }
  if (!landed) {
    setRenditionJobStatus(context.db, job.id, 'abandoned', 'terminal');
    return;
  }
  setRenditionJobStatus(context.db, job.id, 'done', reason);
  context.changed?.(job.sessionId, failed);
  context.settled?.(job.account, job.sessionId, failed);
}

/**
 * ***Writes into a session only while it is there*** (2026-09-27), under its
 * lock.
 *
 * A picture can take minutes, and the session it belongs to can be deleted in
 * the meantime. Every write here makes its parent directories, so the late
 * picture used to put `sessions/<id>/` back beside the trashed one, and the
 * trash's restore then found the place taken. Under the lock a delete happens
 * wholly before this (the session is gone, nothing is written, and the job is
 * abandoned) or wholly after it (the picture goes to the trash with the rest).
 */
async function intoSession(
  context: RenditionWorkerContext,
  job: RenditionJob,
  write: () => Promise<void>,
): Promise<boolean> {
  return withSessionLock(job.sessionId, async () => {
    if (!(await fileExists(sessionFilePath(context.layout, job.account, job.sessionId)))) {
      return false;
    }
    await write();
    return true;
  });
}

/**
 * A provider failure as a class — [21 §1.4]'s rule.
 *
 * The provider's own sentence goes to the log; what reaches a surface is
 * something a client can render in the reader's language, which the server does
 * not know.
 */
function classOf(error: unknown): RenditionError {
  /**
   * ***A pass-through, and that is the finding rather than a shortcut.***
   * `ErrorClass` is already `transient | retryable | terminal`, and
   * {@link RenditionError} adds exactly two arms that a provider cannot produce:
   * `no-binding` (nothing can serve the `image` role) and `interrupted` (the
   * process died holding the socket). So there is no mapping to get wrong — the
   * two vocabularies were designed against the same three-way question, one at
   * [P2] and one here, and a translation table between them would be a place for
   * them to drift.
   */
  if (error instanceof ProviderError) return error.class;
  // Anything that is not a `ProviderError` came from this process rather than
  // from an endpoint — a write that failed, a path that would not resolve — and
  // `retryable` is the honest answer to *try it again and see*.
  return 'retryable';
}

/** `<id>.<ext>`, so serving the bytes needs the record and no directory scan. */
function fileNameFor(renditionId: string, mime: string): string {
  return `${renditionId}.${extensionFor(mime)}`;
}

function extensionFor(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  // PNG is what every OpenAI-compatible image endpoint answers with by default,
  // and an unknown type getting one is better than a file with no extension.
  return 'png';
}

/**
 * The absolute path for a rendition's bytes, or null when the id cannot name
 * one.
 *
 * Guarded for `pathFor`'s reason one module over, and harder: a rendition id
 * reaches this function from a record that a person may have edited, and
 * `resolveWithin` throwing here would take the worker down rather than the
 * picture.
 */
function assetPathFor(
  layout: Layout,
  handle: string,
  sessionId: string,
  renditionId: string,
  mime: string,
): string | null {
  try {
    return resolveWithin(
      sessionAssetsRoot(layout, handle, sessionId),
      fileNameFor(renditionId, mime),
    );
  } catch (error) {
    if (error instanceof PathEscapeError) return null;
    throw error;
  }
}

/** The stored workflow, narrowed back to what a request may carry. */
function filterScalars(
  workflow: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean>> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(workflow)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Where a rendition's bytes are, for the route that serves them.
 *
 * ***Within the session's `assets/`, checked*** (2026-09-27). This joined the
 * record's `path` on, and a record is a file: a hand edit can say
 * `../../../connections/x.json`, and the route would have served it, since
 * `assertReal` asks only whether the path stays inside the data directory.
 * The session importer checks the records it writes; this is the door that
 * does not depend on it.
 */
export function assetPath(
  layout: Layout,
  handle: string,
  sessionId: string,
  rendition: Rendition,
): string | null {
  if (rendition.asset === null) return null;
  try {
    return resolveWithin(sessionAssetsRoot(layout, handle, sessionId), rendition.asset.path);
  } catch {
    return null;
  }
}
