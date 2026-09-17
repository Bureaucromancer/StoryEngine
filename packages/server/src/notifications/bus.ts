// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Notification } from '../state/notifications.js';
import type { Presence } from './router.js';

/**
 * Who is here, what they are looking at, and how a notification reaches them —
 * [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P10 §1.3](../../../../docs/design/workplan/27-p10-implementation.md), [P10.1].
 *
 * ***One object for presence and delivery, because they are the same
 * registry read two ways.*** A person is *connected* when they hold a
 * notification stream, and that stream is also where a notification is
 * delivered; a person is *viewing* a session when they hold that session's
 * stream. Splitting the two would mean two structures that have to agree about
 * who is online, and the way that fails is quiet.
 *
 * **Keyed by account, which is the difference from
 * [`TurnStream`](../stream/bus.ts).** That one is keyed by session and its
 * listeners are anonymous — deliberately, because [09 §4.3] withholds sharing
 * at 1.0, so anyone reading a session stream is its owner and the stream does
 * not need to know who. A notification has the opposite requirement: it is
 * addressed to a **person**, has to find them in a session they do not have
 * open, and `system.notice` has no session at all.
 *
 * ***Process-local, and that is the whole of what an ephemeral channel
 * promises.*** After a restart nobody is connected and nothing is viewing,
 * which is true rather than lossy: the notifications themselves are rows in
 * `notification`, so what a reconnecting client reads back is the durable list
 * and an unread count. This class only decides *who to tell now*.
 */

export type NotificationListener = (notification: Notification) => void;

export class NotificationBus implements Presence {
  readonly #listeners = new Map<string, Set<NotificationListener>>();

  /**
   * Which sessions each account has open, **counted rather than flagged**.
   *
   * Two tabs on one session are two attachments and one of them closing must
   * not make the other stop counting as viewing. A `Set<string>` would make
   * the second `detach` wrong, and the symptom — notifications about a session
   * that is on screen — is the exact failure [P10 §1.3]'s rule exists to
   * prevent, arriving only when somebody had two tabs open.
   */
  readonly #viewing = new Map<string, Map<string, number>>();

  /** Called when a listener throws — set by the app, read by a test. */
  onListenerError: ((error: unknown) => void) | null = null;

  /**
   * Attaches a person's notification stream. The returned function detaches it.
   *
   * *Idempotent on release*, for the reason `TurnStream.subscribe` gives: a
   * stream closes from three directions and each of them reasonably detaches.
   */
  subscribe(account: string, listener: NotificationListener): () => void {
    const set = this.#listeners.get(account) ?? new Set<NotificationListener>();
    set.add(listener);
    this.#listeners.set(account, set);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      set.delete(listener);
      if (set.size === 0) this.#listeners.delete(account);
    };
  }

  /**
   * Records that this person has this session on screen. The returned function
   * says they no longer do.
   *
   * **Called by the session stream route rather than by the session store**,
   * because what it records is *a socket is open on this session*, and only the
   * route knows that. A store-level hook would record *somebody read this
   * session*, which is a different fact and is true of a background poll.
   */
  viewing(account: string, sessionId: string): () => void {
    const held = this.#viewing.get(account) ?? new Map<string, number>();
    held.set(sessionId, (held.get(sessionId) ?? 0) + 1);
    this.#viewing.set(account, held);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = held.get(sessionId);
      if (count === undefined) return;
      if (count <= 1) held.delete(sessionId);
      else held.set(sessionId, count - 1);
      if (held.size === 0) this.#viewing.delete(account);
    };
  }

  isConnected(account: string): boolean {
    return (this.#listeners.get(account)?.size ?? 0) > 0;
  }

  isViewing(account: string, sessionId: string): boolean {
    return (this.#viewing.get(account)?.get(sessionId) ?? 0) > 0;
  }

  /**
   * Hands a notification to whatever streams this person has open.
   *
   * **A listener's failure never escapes**, which is `TurnStream.#each`'s rule
   * and matters more here than there: this is called from
   * {@link import('./router.js').route}, which is called from a producer, and
   * one of those producers is the commit path. A thrown listener propagating
   * out of a notification would be a picture or a turn failing because somebody
   * else's socket was in a state nobody measured.
   *
   * Nobody connected is not an error and not a drop: the row is already in the
   * store, and the badge is what they come back to.
   */
  deliver(account: string, notification: Notification): void {
    const set = this.#listeners.get(account);
    if (set === undefined) return;
    // A copy, for the reason `TurnStream` iterates one: `Set` iteration visits
    // entries added during iteration, so a client that attached from inside
    // another's callback would receive a frame its own backlog already holds.
    for (const listener of [...set]) {
      try {
        listener(notification);
      } catch (error) {
        this.onListenerError?.(error);
      }
    }
  }

  subscriberCount(account: string): number {
    return this.#listeners.get(account)?.size ?? 0;
  }
}
