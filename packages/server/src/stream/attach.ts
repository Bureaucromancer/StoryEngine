// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Rendition } from '@storyengine/shared';

import type { Turn } from '../sessions/types.js';
import {
  activeJob,
  type Job,
  latestJob,
  type ProgressEvent,
  readDraft,
  readEvents,
  readJob,
  sessionJobsFrom,
} from '../state/jobs.js';
import type { JobContext } from '../state/jobs.js';
import type { SummaryWarm, TurnStream } from './bus.js';

/**
 * Snapshot plus cursor, with no gap between them —
 * [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P2 §2.10](../../../../docs/design/workplan/08-p2-implementation.md).
 *
 * A client that drops mid-turn and reattaches needs *the turn's state now* plus
 * everything since, not a replay from the beginning. Getting that right is
 * entirely about ordering, and the ordering is the whole content of this file.
 */

/** `<jobId>.<seq>` — on the wire as the SSE `id:`, as `?after=`, as `Last-Event-ID`. */
export interface Cursor {
  jobId: string;
  seq: number;
}

export function formatCursor(cursor: Cursor): string {
  return `${cursor.jobId}.${String(cursor.seq)}`;
}

/**
 * Parses a cursor, treating anything unusable as **absent rather than invalid**.
 *
 * A browser resends `Last-Event-ID` automatically and a client cannot inspect
 * what it is sending. A malformed one that answered 400 would brick a reconnect
 * for as long as the browser kept resending it — so the stream opens from the
 * current job instead, which is the state a fresh client would have got anyway.
 */
export function parseCursor(raw: string | undefined): Cursor | null {
  if (raw === undefined) return null;
  const at = raw.lastIndexOf('.');
  if (at <= 0) return null;

  const jobId = raw.slice(0, at);
  const seq = Number.parseInt(raw.slice(at + 1), 10);
  return Number.isInteger(seq) && seq >= 0 ? { jobId, seq } : null;
}

export interface Snapshot {
  sessionId: string;
  job: { id: string; status: Job['status']; turnId: string; commitStep: number } | null;
  turn: Turn | null;
  /** The accumulated text, including deltas the last checkpoint has not caught. */
  text: string | null;
  cursor: string | null;
}

export type StreamFrame =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'progress'; jobId: string; event: ProgressEvent }
  /**
   * `message` — the turn's message a speaking call's text belongs to, [P13.2].
   * Absent on a narrator's text and on the separator between two messages; see
   * `TurnStream.delta`.
   */
  | { kind: 'delta'; jobId: string; text: string; message?: number }
  /**
   * A picture arrived, failed, or changed — [P9.2].
   *
   * ***Deliberately not in the snapshot, and the synchronous rule above is
   * why.*** A rendition record is a file, and reading one is an `await` — which
   * this function structurally cannot contain, because the absence of an await
   * between subscribe and snapshot is the whole argument that a reattach has no
   * hole.
   *
   * **So the current set is delivered as frames instead, right after attaching,
   * and that is exact rather than approximate.** A rendition frame carries the
   * whole record and a client applies it by **upsert**, so order does not matter
   * and duplicates are no-ops: anything that changed while the set was being
   * read arrives a second time as a live frame and lands on the same value.
   * That is the property `progress` cannot have — an event is a delta against a
   * draft — and it is why this kind needs neither a sequence nor a cursor.
   */
  | { kind: 'rendition'; rendition: Rendition }
  /**
   * The summary chain's warm moved — [P13.11]. Whole state, applied by
   * replacement, so it needs no cursor either; see `SummaryWarm`.
   */
  | { kind: 'summaries'; warm: SummaryWarm };

export interface Attachment {
  snapshot: Snapshot;
  /** Stops delivery. Idempotent. */
  detach: () => void;
}

/**
 * Subscribes and snapshots, in that order, **without an `await` between them**.
 *
 * ```
 *   subscribe  →  read jobs  →  read backlog  →  read draft  →  flush buffer
 *   ^^^^^^^^^     ────────── no await anywhere in here ──────────
 * ```
 *
 * **Why that closes the race, and why it needs no lock.** `node:sqlite` is
 * synchronous and `inTransaction` structurally forbids an `await` in its body —
 * the signature enforces it — so `checkpoint()`'s write-and-publish pair is one
 * indivisible block on a single thread. A checkpoint therefore cannot interleave
 * between the subscribe and the reads: every event is either already in the
 * backlog this function read, or still in the buffer it is about to flush. The
 * sequence filter removes the only overlap.
 *
 * Snapshot-then-subscribe would leave a hole; subscribe-then-snapshot without
 * the filter would duplicate. Doing both under a lock would work and would make
 * a reader able to block a writer, which is the thing WAL mode was chosen to
 * avoid.
 *
 * **This function must not become `async`.** There is a test that fails the
 * moment it does, because the argument above is not visible in the code — it is
 * visible in the *absence* of something.
 */
export function attachToSession(
  context: JobContext & { bus: TurnStream },
  sessionId: string,
  account: string,
  after: Cursor | null,
  deliver: (frame: StreamFrame) => void,
): Attachment {
  const buffered: StreamFrame[] = [];
  let live = false;

  const detach = context.bus.subscribe(sessionId, {
    onEvents: (jobId, events) => {
      for (const event of events) {
        const frame: StreamFrame = { kind: 'progress', jobId, event };
        if (live) deliver(frame);
        else buffered.push(frame);
      }
    },
    onDelta: (jobId, text, message) => {
      const frame: StreamFrame = {
        kind: 'delta',
        jobId,
        text,
        ...(message === undefined ? {} : { message }),
      };
      if (live) deliver(frame);
      else buffered.push(frame);
    },
    onRendition: (rendition) => {
      const frame: StreamFrame = { kind: 'rendition', rendition };
      if (live) deliver(frame);
      else buffered.push(frame);
    },
    onSummaries: (warm) => {
      const frame: StreamFrame = { kind: 'summaries', warm };
      if (live) deliver(frame);
      else buffered.push(frame);
    },
  });

  const jobs = resolveJobs(context, sessionId, account, after);
  const backlog: { jobId: string; event: ProgressEvent }[] = [];
  for (const [index, job] of jobs.entries()) {
    // Only the cursor's own job resumes from the cursor. Every job after it is
    // new to this client and is replayed whole.
    const from = index === 0 && after?.jobId === job.id ? after.seq : 0;
    for (const event of readEvents(context, job.id, from)) {
      backlog.push({ jobId: job.id, event });
    }
  }

  const current = jobs.at(-1) ?? null;
  const draft = current ? readDraft(context, current.id) : null;
  // The live cell first: a client attaching between two coalescing checkpoints
  // would otherwise see text that stops at the last checkpoint and then deltas
  // that begin after it attached.
  const text = current ? (context.bus.live(current.id) ?? draft?.output?.text ?? null) : null;

  const highest = new Map<string, number>();
  for (const { jobId, event } of backlog) {
    highest.set(jobId, Math.max(highest.get(jobId) ?? 0, event.seq));
  }

  const snapshot: Snapshot = {
    sessionId,
    job: current
      ? {
          id: current.id,
          status: current.status,
          turnId: current.turnId,
          commitStep: current.commitStep,
        }
      : null,
    turn: draft,
    text,
    cursor:
      current && highest.has(current.id)
        ? formatCursor({ jobId: current.id, seq: highest.get(current.id) ?? 0 })
        : null,
  };

  deliver({ kind: 'snapshot', snapshot });
  for (const { jobId, event } of backlog) deliver({ kind: 'progress', jobId, event });

  // Anything that arrived while the reads were happening, minus what those
  // reads already saw.
  for (const frame of buffered) {
    if (frame.kind === 'progress' && frame.event.seq <= (highest.get(frame.jobId) ?? 0)) continue;
    deliver(frame);
  }
  live = true;

  return { snapshot, detach };
}

/**
 * Which jobs this attachment covers.
 *
 * A cursor names where the client left off; without one, whatever is happening
 * now, or the last thing that did. ~~Between turns everything resolves empty and
 * the stream opens with a null job and waits — the ordinary state of a session
 * somebody is reading.~~ *Corrected 2026-09-27:* between turns this resolves to
 * the session's **latest** job, finished, and the snapshot carries its draft and
 * the backlog its events; only a session that has never had a turn opens with a
 * null job. The operational store's prune (`state/prune.ts`) keeps each
 * session's latest job for exactly that reason, while the session is there.
 *
 * **The cursor's job is ownership-checked**, because `readJob` applies no owner
 * filter and a job id in a URL is user input. A cursor naming another session's
 * or another account's job is treated as absent, never as permission to replay
 * somebody else's turn.
 */
function resolveJobs(
  context: JobContext,
  sessionId: string,
  account: string,
  after: Cursor | null,
): Job[] {
  if (after !== null) {
    const anchor = readJob(context.db, after.jobId);
    if (anchor?.sessionId === sessionId && anchor.account === account) {
      return sessionJobsFrom(context.db, sessionId, anchor.createdAt);
    }
  }

  const current = activeJob(context.db, sessionId) ?? latestJob(context.db, sessionId);
  return current === null ? [] : [current];
}
