// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

import type { Rendition, RenditionError } from '@storyengine/shared';

import { ensureDirectory, writeFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { PathEscapeError, resolveWithin } from '../storage/paths.js';
import type { Connection } from '../providers/connections.js';
import type { ProviderFactory } from '../providers/factory.js';
import { ProviderError } from '../providers/types.js';
import { readRendition, sessionAssetsRoot, writeRendition } from './store.js';
import { enqueueRendition, setRenditionJobStatus, type RenditionJob } from './jobs.js';
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
 * than merely unlikely. {@link dispatchRenditions} is one synchronous insert and
 * a detached promise, and nothing in a turn's lifetime awaits the second.
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
  /** Jobs enqueued. **A place already rendered dispatches zero.** */
  dispatched: number;
  /** Backdrops resolved to a sibling already paid for — [P9 §1.7]'s money row. */
  reused: number;
}

/**
 * Queues every rendition a turn asked for, and returns without waiting.
 *
 * **Called after `finaliseTurn`, never before**, so that a client which sees
 * `turn.finished` and re-reads the session finds the turn there *and* finds the
 * rendition pending beside it. Enqueuing first would let a fast provider land an
 * asset on a turn the store has not appended.
 */
export function dispatchRenditions(
  context: RenditionWorkerContext,
  account: string,
  sessionId: string,
  records: readonly Rendition[],
  turnId: string,
): DispatchResult {
  let dispatched = 0;
  for (const record of records) {
    if (record.state !== 'pending') continue;
    const job = enqueueRendition(context.db, {
      sessionId,
      account,
      renditionId: record.id,
      turnId,
      purpose: record.purpose,
    });
    dispatched += 1;
    /**
     * **Detached, and the promise is deliberately not returned.** `TurnRunner`
     * makes the same choice for the same reason — *"fire-and-forget by design:
     * the HTTP response is a job id, and the stream is how a client watches"* —
     * and here it is load-bearing rather than convenient, because the thing not
     * being waited for is the thing §10.2 says must never be waited for.
     *
     * ***Detached is not untracked***, which is the distinction that was missing
     * until 2026-09-17. Nobody waits for this to answer a request; `inFlight`
     * is what lets **shutdown** wait for it, and the two are different waits.
     * See that field for what the absence cost.
     */
    const work = runRendition(context, job).catch(() => undefined);
    const live = context.inFlight;
    if (live === undefined) {
      void work;
    } else {
      // Removed by the same promise that added it, so the set holds only what is
      // genuinely still running — a set that only grew would make `drain` a wait
      // on every picture the process ever made.
      const tracked = work.finally(() => {
        live.delete(tracked);
      });
      live.add(tracked);
    }
  }
  return { dispatched, reused: 0 };
}

/**
 * Waits for every picture still being made — the other half of `inFlight`.
 *
 * ***A loop rather than one `Promise.all`***, because a rendition can outlive
 * the snapshot taken when the wait began: `select` writes a channel, and a
 * channel write is a session write, which is the sort of thing that can dispatch
 * again. Waiting on a list captured once would return with work still running,
 * which is the bug this function exists to prevent wearing a fix.
 *
 * **It never rejects.** Each entry is already `.catch`ed at dispatch, and a
 * shutdown that threw because a picture failed would turn [06 §10.2]'s *"a
 * failed rendition is a placeholder, never a failed turn"* into *a failed
 * process* at the one moment nobody is watching.
 */
export async function drainRenditions(context: RenditionWorkerContext): Promise<void> {
  const live = context.inFlight;
  if (live === undefined) return;
  while (live.size > 0) {
    await Promise.all([...live]);
  }
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
    });

    const path = assetPathFor(context.layout, job.account, job.sessionId, record.id, result.mime);
    if (path === null) {
      await fail(context, job, record, 'terminal');
      return;
    }
    await ensureDirectory(sessionAssetsRoot(context.layout, job.account, job.sessionId));
    await writeFileBytes(path, result.bytes);

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
    await writeRendition(context.layout, job.account, job.sessionId, ready);
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
    await fail(context, job, record, classOf(error));
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
  try {
    await writeRendition(context.layout, job.account, job.sessionId, failed);
  } catch {
    // A write that cannot land leaves the record pending on disk, which the next
    // boot reconciles to `interrupted`. Losing the *job's* status too would lose
    // the only remaining trace, so the status update below runs regardless.
  }
  setRenditionJobStatus(context.db, job.id, 'done', reason);
  context.changed?.(job.sessionId, failed);
  context.settled?.(job.account, job.sessionId, failed);
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
 * ***Contained in `assets/`, not merely in the data root.*** `asset.path` is a
 * field in a file, and since 2026-09-27 a file can arrive by import; the route's
 * `assertReal` only proves a path is somewhere under the data root, which would
 * let a record naming `../../../accounts.json` be served as a picture. So the
 * lexical guard is the session's own asset directory, and a path that climbs out
 * of it is no path at all.
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
