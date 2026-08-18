// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { SseFrame } from './sse.js';

/**
 * What the play surface knows, and how a frame changes it.
 *
 * **A pure reducer, and that is where the correctness of this feature lives.**
 * Reattach, ordering and the no-duplicate promise are all statements about a
 * sequence of frames — testable exactly, with no DOM, no timers and no server.
 * What is left for the components is rendering, which is the part a component
 * test is actually good at.
 */

export interface PlayState {
  /** The job being watched, or null between turns. */
  jobId: string | null;
  /** What the turn has produced so far. Replaced by a snapshot, appended by a delta. */
  text: string;
  /** Where to resume from. The last durable event this client actually has. */
  cursor: string | null;
  /** The highest sequence seen per job, so a replayed frame is ignored. */
  seen: Readonly<Record<string, number>>;
  status: 'idle' | 'running' | 'finished' | 'reconnecting' | 'failed';
  /** The turn as last checkpointed — what the record affordance shows. */
  turn: unknown;
  /** A failure class, never a message: the server sends classes ([01 §2]). */
  error: string | null;
}

export const INITIAL: PlayState = {
  jobId: null,
  text: '',
  cursor: null,
  seen: {},
  status: 'idle',
  turn: null,
  error: null,
};

export type PlayAction =
  | { kind: 'frame'; frame: SseFrame }
  | { kind: 'status'; status: PlayState['status'] }
  | { kind: 'submitted' };

export function reduce(state: PlayState, action: PlayAction): PlayState {
  if (action.kind === 'status') return { ...state, status: action.status };
  if (action.kind === 'submitted') {
    // A fresh turn clears the previous one's text so the reader does not watch
    // the last answer while waiting for this one.
    return { ...state, text: '', status: 'running', error: null };
  }

  const { frame } = action;
  switch (frame.event) {
    case 'snapshot':
      return applySnapshot(state, frame.data);
    case 'progress':
      return applyProgress(state, frame);
    case 'delta':
      return applyDelta(state, frame.data);
    case 'overflow':
      /**
       * The server gave up on a slow client and said where to resume. Not an
       * error: the cursor makes it lossless, and the connector reconnects from
       * it. Recorded as `reconnecting` so the UI can say something true.
       */
      return { ...state, cursor: cursorOf(frame.data) ?? state.cursor, status: 'reconnecting' };
    case 'error':
      // A class the server chose. Fatal — the connector does not retry it.
      return { ...state, status: 'failed', error: classOf(frame.data) };
    default:
      return state;
  }
}

function applySnapshot(state: PlayState, data: unknown): PlayState {
  if (!isRecord(data)) return state;
  const job = isRecord(data['job']) ? data['job'] : null;
  const jobId = typeof job?.['id'] === 'string' ? job['id'] : null;
  const cursor = typeof data['cursor'] === 'string' ? data['cursor'] : null;

  return {
    ...state,
    jobId,
    // The snapshot's text is authoritative — it includes the deltas the last
    // checkpoint had not caught, which is what closes the reattach hole.
    text: typeof data['text'] === 'string' ? data['text'] : '',
    cursor,
    // Seeding `seen` from the snapshot's cursor is what makes a replayed frame
    // a no-op rather than a duplicate.
    seen:
      cursor === null || jobId === null ? state.seen : { ...state.seen, [jobId]: seqOf(cursor) },
    turn: data['turn'] ?? null,
    status: job === null ? 'idle' : statusOf(job['status']),
    error: null,
  };
}

function applyProgress(state: PlayState, frame: SseFrame): PlayState {
  if (!isRecord(frame.data)) return state;
  const jobId = typeof frame.data['jobId'] === 'string' ? frame.data['jobId'] : null;
  const seq = typeof frame.data['seq'] === 'number' ? frame.data['seq'] : null;
  if (jobId === null || seq === null) return state;

  /**
   * **The duplicate guard.** A reconnect replays from a cursor, and a frame at
   * or below what this client already has is one it already applied. Dropping
   * it here rather than trusting the server is the client's half of
   * exactly-once: the server promises not to skip, and this promises not to
   * double-count.
   */
  if (seq <= (state.seen[jobId] ?? 0)) return state;

  const finished = keyOf(frame.data) === 'turn.finished';
  return {
    ...state,
    jobId,
    seen: { ...state.seen, [jobId]: seq },
    cursor: frame.id ?? state.cursor,
    status: finished ? 'finished' : state.status === 'idle' ? 'running' : state.status,
  };
}

function applyDelta(state: PlayState, data: unknown): PlayState {
  if (!isRecord(data) || typeof data['text'] !== 'string') return state;
  /**
   * Appended, and **deliberately not deduplicated**: a delta carries no id
   * because no store can answer for one ([P2 §2.10] declines to make them
   * durable). What makes that safe is the snapshot — a reattach replaces the
   * text wholesale rather than continuing to append to a stale buffer.
   */
  return { ...state, text: state.text + data['text'], status: 'running' };
}

function statusOf(value: unknown): PlayState['status'] {
  return value === 'committed' || value === 'abandoned' ? 'finished' : 'running';
}

function seqOf(cursor: string): number {
  const seq = Number.parseInt(cursor.slice(cursor.lastIndexOf('.') + 1), 10);
  return Number.isInteger(seq) ? seq : 0;
}

function cursorOf(data: unknown): string | null {
  return isRecord(data) && typeof data['cursor'] === 'string' ? data['cursor'] : null;
}

function classOf(data: unknown): string {
  return isRecord(data) && typeof data['error'] === 'string' ? data['error'] : 'internal';
}

function keyOf(data: Record<string, unknown>): string | null {
  return typeof data['key'] === 'string' ? data['key'] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
