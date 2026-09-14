// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ProgressEvent } from '../state/jobs.js';

/**
 * In-process fan-out for the session stream —
 * [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [20 §8](../../../../docs/design/20-tech-stack.md).
 *
 * Two channels, because that section describes two.
 *
 * **Durable**: the `event` rows, sequenced inside the transaction that writes
 * the draft state they describe. Exactly-once, in order, replayable from a
 * cursor. This class only *delivers* them — the store is what makes them true,
 * and a subscriber that missed some reads them back rather than being resent.
 *
 * **Ephemeral**: token deltas, which [20 §8] names first among the traffic SSE
 * was chosen for and which [P2 §2.10] explicitly declines to make durable. A
 * delta that was missed is not resent and cannot be: the next checkpoint carries
 * the accumulated text and resyncs it.
 *
 * Keyed **by session, not by job**. [09 §3.1] scopes the session stream to *"one
 * session, subscribed while viewing it"* — so a subscriber has to survive one
 * turn ending and the next beginning, and `activeJob` returns null the instant
 * `finished_at` is set.
 */

export interface Listener {
  onEvents(jobId: string, events: readonly ProgressEvent[]): void;
  onDelta(jobId: string, text: string): void;
}

/** What `checkpoint()` needs to reach the bus without importing it. */
export interface EventSink {
  publish(sessionId: string, jobId: string, events: readonly ProgressEvent[]): void;
}

export class TurnStream implements EventSink {
  readonly #listeners = new Map<string, Set<Listener>>();

  /**
   * Accumulated text for an in-flight job — the hole-filler for a late attach.
   *
   * A client attaching between two coalescing checkpoints would otherwise get a
   * draft whose text stops at the last checkpoint and then start receiving
   * deltas that begin *after* it attached: a gap of up to the coalescing window
   * that no offset scheme can close over a one-directional transport. Reading
   * this in the same synchronous tick as the subscription means the deltas that
   * follow append exactly.
   *
   * Process-local, and that is correct rather than a limitation: after a restart
   * it is gone and the checkpointed text is what survives, which is exactly the
   * guarantee [P2 §2.10] makes — *a reattach may observe coalesced text rather
   * than every delta that painted it live*.
   */
  readonly #live = new Map<string, string>();

  /**
   * Called when a listener throws. Set by the app so a broken subscriber is
   * visible rather than swallowed; a test can read it.
   */
  onListenerError: ((error: unknown) => void) | null = null;

  subscribe(sessionId: string, listener: Listener): () => void {
    const set = this.#listeners.get(sessionId) ?? new Set<Listener>();
    set.add(listener);
    this.#listeners.set(sessionId, set);

    let released = false;
    return () => {
      // Idempotent: a stream closes from three directions (the client's socket,
      // an error, the app shutting down) and each of them reasonably unsubscribes.
      if (released) return;
      released = true;
      set.delete(listener);
      if (set.size === 0) this.#listeners.delete(sessionId);
    };
  }

  /**
   * Delivers durable events, and **never lets a subscriber's failure escape**.
   *
   * This is called from inside `checkpoint()`, which is called by the commit
   * protocol *before* the step that marks a job committed. A listener that threw
   * — a socket in a state nobody measured, an unserialisable param, an assertion
   * in a test double — would propagate out of `checkpoint` after its transaction
   * had already committed, leaving the job at `commit_step = 3` with
   * `finished_at` null. The turn would be on disk, the head advanced, and the
   * session refused as busy by every later submission until a restart.
   *
   * So the presentation layer is sealed off from authoritative state. A thrown
   * listener loses its own frame and nothing else.
   */
  publish(sessionId: string, jobId: string, events: readonly ProgressEvent[]): void {
    if (events.length === 0) return;
    if (events.some((event) => event.key === 'turn.finished')) this.#live.delete(jobId);
    this.#each(sessionId, (listener) => {
      listener.onEvents(jobId, events);
    });
  }

  delta(sessionId: string, jobId: string, text: string): void {
    this.#live.set(jobId, (this.#live.get(jobId) ?? '') + text);
    this.#each(sessionId, (listener) => {
      listener.onDelta(jobId, text);
    });
  }

  live(jobId: string): string | null {
    return this.#live.get(jobId) ?? null;
  }

  /** Forgets a job's accumulated text. Called when its stream can no longer grow. */
  forget(jobId: string): void {
    this.#live.delete(jobId);
  }

  subscriberCount(sessionId: string): number {
    return this.#listeners.get(sessionId)?.size ?? 0;
  }

  /**
   * **Iterates a copy, not the live `Set`.**
   *
   * `Set` iteration visits entries added *during* iteration, so a client that
   * attaches from inside another client's delivery callback would receive a
   * frame its own backlog read already contains — a duplicate in a stream whose
   * whole promise is exactly-once. Copying costs one small array per publish and
   * removes the case entirely.
   */
  #each(sessionId: string, deliver: (listener: Listener) => void): void {
    const set = this.#listeners.get(sessionId);
    if (set === undefined) return;
    for (const listener of [...set]) {
      try {
        deliver(listener);
      } catch (error) {
        this.onListenerError?.(error);
      }
    }
  }
}
