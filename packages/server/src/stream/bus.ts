// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Rendition } from '@storyengine/shared';

import type { ProgressEvent } from '../state/jobs.js';

/**
 * In-process fan-out for the session stream —
 * [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [19 §8](../../../../docs/design/19-tech-stack.md).
 *
 * Two channels, because that section describes two.
 *
 * **Durable**: the `event` rows, sequenced inside the transaction that writes
 * the draft state they describe. Exactly-once, in order, replayable from a
 * cursor. This class only *delivers* them — the store is what makes them true,
 * and a subscriber that missed some reads them back rather than being resent.
 *
 * **Ephemeral**: token deltas, which [19 §8] names first among the traffic SSE
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
  /**
   * `message` is the turn's message a speaking call's text belongs to —
   * [P13.2]; see {@link TurnStream.delta}. Absent for everything else.
   */
  onDelta(jobId: string, text: string, message?: number): void;
  /**
   * A rendition's state changed — [06 §10.2], [P9.2].
   *
   * ***Not a `ProgressEvent`, and the store is what forces that.*** The `event`
   * table foreign-keys to `job(id)`, so a rendition job — which is a row in a
   * different table, by [P9 §0.1]'s finding 9 — has no id that table would
   * accept. And even attached to the *turn's* job it would not reattach
   * correctly: `resolveJobs` walks jobs from the cursor's anchor forward, so an
   * illustration of a turn forty back would emit on a job the walk never reaches.
   *
   * **So this is an ephemeral frame, and exactness comes from the snapshot
   * instead.** A progress event is sequenced inside the transaction that writes
   * the draft it describes, which is what makes *snapshot plus cursor* exact. A
   * rendition has no draft and no sequence — it has an **id and a state** — so a
   * client that applies these by upsert converges on the same map whatever order
   * they arrive in and however many it missed. `Snapshot.renditions` is what
   * makes a late attach whole, which is why there is no second cursor.
   */
  onRendition(rendition: Rendition): void;
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

  /**
   * Tells a session's watchers that a picture arrived, failed, or changed.
   *
   * Nothing is accumulated the way `#live` accumulates text: a rendition's whole
   * state is the record, so a listener that missed three of these and then reads
   * the fourth is in the same place as one that saw all four.
   */
  rendition(sessionId: string, rendition: Rendition): void {
    this.#each(sessionId, (listener) => {
      listener.onRendition(rendition);
    });
  }

  /**
   * One piece of streamed text.
   *
   * ***`message` since [P13.2]***: the index into the turn's `output.messages`
   * that a speaking call is filling, so a surface that paints a round as
   * separate messages knows which one a piece belongs to. **Absent on text that
   * belongs only to the turn's joined text** — a narrator's reply, which is not
   * a message of its own until it lands, and the blank line the runner sends
   * between two speakers so that a reader appending every piece to one string
   * (this class's `#live`, and every client written before P13.2) builds the
   * same `output.text` the turn will commit. A per-message reader skips those;
   * a joined-text reader needs no change at all.
   */
  delta(sessionId: string, jobId: string, text: string, message?: number): void {
    this.#live.set(jobId, (this.#live.get(jobId) ?? '') + text);
    this.#each(sessionId, (listener) => {
      listener.onDelta(jobId, text, message);
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
