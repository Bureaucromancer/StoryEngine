// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { DatabaseSync } from 'node:sqlite';

import type { FailureRemedy } from '@storyengine/shared';

import {
  notify,
  type Notification,
  type NotificationClass,
  type NotificationDraft,
} from '../state/notifications.js';

/**
 * Who gets told, and through what — [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P10 §1.3](../../../../docs/design/workplan/27-p10-implementation.md), [P10.1].
 *
 * ***The routing is server-side and that is the part that must not be got
 * wrong.*** [09 §3.1] is unambiguous: *"if the client decides what to notify
 * about, notifications only work while a client is connected"* — which fails the
 * case that motivated the feature. The server knows who should be told and
 * through which channel; the client renders the in-app part.
 *
 * **So every producer hands this module a fact and never a decision.** A turn
 * finished, a picture landed, a restart is pending. Whether that reaches anybody,
 * and how loudly, is decided here against the session's owner and the reader's
 * presence — never against who happens to have a socket open, which is the
 * client deciding with extra steps.
 */

/**
 * Whether the person is here, and whether they are looking at this.
 *
 * ***Written as a presence input with one implementation, which is
 * [P10 §1.3](../../../../docs/design/workplan/27-p10-implementation.md)'s
 * instruction and not a guess at the future.*** The routing signal the design
 * names — per-user presence, Active/Idle/DND/Invisible — *"arrives with
 * Messages, which is now unscheduled"*. So 1.0 routes on what it has: connection
 * state, and whether the connected client is viewing the session in question.
 *
 * **Shaped so real presence substitutes rather than rewrites.** A
 * `connected: boolean` parameter threaded through the call sites would be a
 * connection check wearing presence's name, and replacing it later would mean
 * touching every producer. An interface with one implementation costs one file
 * and is replaced by writing a second — which is the difference
 * [work plan §0.3](../../../../docs/design/workplan/01-work-plan.md) records the
 * cost of a seam with no date for.
 */
export interface Presence {
  /** Has this person got a live client anywhere? */
  isConnected(account: string): boolean;
  /** Is a live client of theirs looking at this session right now? */
  isViewing(account: string, sessionId: string): boolean;
}

/**
 * What a producer reports. **A fact, never a decision.**
 *
 * The `account` is the session's **owner**, resolved by the caller from the
 * record rather than from the request — which is [09 §4.3]'s per-user scoping at
 * the only point where it can be got right. A producer running on a job has an
 * account on the job; a producer running at boot has none and says so by using
 * the admin arm.
 */
export type Occurrence =
  | {
      kind: 'turn.complete';
      account: string;
      sessionId: string;
      turnId: string;
      sessionName: string;
    }
  | {
      kind: 'turn.failed';
      account: string;
      sessionId: string;
      turnId: string;
      sessionName: string;
      /** A class, never a provider's words ([22 §1.4]). */
      error: string;
      /**
       * ***What a person could do about it*** — [P11.6].
       *
       * The class answers *how did the engine treat this*, which is what a bug
       * report wants; this answers *what do I do now*, which is what the person
       * reading the toast wants. **They were one field doing both jobs**, and
       * the body rendered `{error}` — so a turn that could not reach the
       * internet said *transient* to somebody whose wifi was off.
       *
       * Absent when the turn failed before any step did, because there is
       * nothing to have a remedy for.
       */
      remedy?: FailureRemedy;
    }
  | {
      kind: 'artifact.ready';
      account: string;
      sessionId: string;
      turnId: string;
      /** `illustration` or `background`, so delivery policy can tell them apart. */
      purpose: string;
      /** Whether the picture arrived or failed — see {@link route}. */
      outcome: 'ready' | 'failed';
    }
  | {
      kind: 'system.notice';
      account: string;
      /** A class the client renders, never a sentence: `restart-required`, and so on. */
      notice: string;
      actionable: boolean;
      /**
       * What the sentence needs beyond the notice itself.
       *
       * ***The one arm that carries free params, because it is the one arm
       * whose subject is open.*** The other three name a turn or a picture and
       * the composer knows what those are; `system.notice` is a family, and
       * [09 §6.3] wants a restart notice to say **which keys** rather than to
       * *"invite people to restart and hope"*. `notice` is merged in below and
       * always wins, so a producer cannot overwrite the thing being notified
       * about with a param of the same name.
       */
      params?: Readonly<Record<string, string | number | boolean>>;
    };

export interface RouterContext {
  db: DatabaseSync;
  presence: Presence;
  /** Delivery. Called only for what is actually being told to somebody. */
  deliver: (account: string, notification: Notification) => void;
}

/**
 * Decides whether an occurrence becomes a notification, and records it if so.
 *
 * ***The one routing rule 1.0 has, and it is a rule about attention rather than
 * about connection.*** **If you are looking at the session, you are not told
 * about it.** You can see the turn finish; a toast saying so is the app telling
 * you what is on your screen. Everything else — a different session, a different
 * tab, no client at all — is a notification, because the alternative is the
 * completion-sound case [09 §3.6] names failing exactly when it is wanted.
 *
 * *Not connected is deliberately **not** a reason to skip.* The notification is
 * durable and the badge is what they come back to; dropping it because nobody
 * had a socket open is the client deciding, one layer down.
 *
 * ***`artifact.ready` carries its outcome rather than splitting into two
 * classes.*** [09 §3.5] chose the name over `rendition-ready` *"precisely so its
 * second instance would not require renaming it"*, and the same instinct applies
 * here: a picture that failed is the same subject in a different state, and
 * `outcome` in the params is what lets a client say so. **A failed one is
 * actionable and a ready one is not** — which is why the store's class table
 * marks `artifact.ready` as `varies` and this module answers, and why
 * {@link route} exists rather than every producer calling `notify` directly.
 */
export function route(context: RouterContext, occurrence: Occurrence): Notification | null {
  const draft = draftFor(occurrence);
  if (draft === null) return null;

  if (
    'sessionId' in occurrence &&
    context.presence.isViewing(occurrence.account, occurrence.sessionId)
  ) {
    return null;
  }

  const recorded = notify(context.db, draft);
  context.deliver(occurrence.account, recorded);
  return recorded;
}

/**
 * The occurrence as a draft — the class, the params and the dedupe key.
 *
 * ***The dedupe keys are the interesting half and each one encodes a
 * judgement*** about what counts as the same news ([09 §3.4]):
 *
 * - **A turn completing keys on the session.** Two turns finishing in one
 *   session inside the window is *your story moved on*, once.
 * - **A turn failing keys on the session too, but separately** — a failure and a
 *   completion are not the same news even about the same session, and a failure
 *   is actionable where a completion is not.
 * - **A picture keys on the turn.** Three renditions of one turn settling
 *   together is one notification, which is [09 §3.4]'s example in this build's
 *   own terms. *Keying on the session would fold two deliberate **Illustrate**
 *   presses on different turns into one*, which is losing news rather than
 *   coalescing noise.
 * - **A system notice keys on the notice.** *Restart required* twice is once
 *   until somebody restarts.
 */
function draftFor(occurrence: Occurrence): NotificationDraft | null {
  switch (occurrence.kind) {
    case 'turn.complete':
      return {
        account: occurrence.account,
        class: 'turn.complete',
        params: { sessionName: occurrence.sessionName },
        sessionId: occurrence.sessionId,
        turnId: occurrence.turnId,
        dedupeKey: `turn.complete:${occurrence.sessionId}`,
      };

    case 'turn.failed':
      return {
        account: occurrence.account,
        class: 'turn.failed',
        params: {
          sessionName: occurrence.sessionName,
          error: occurrence.error,
          ...(occurrence.remedy === undefined ? {} : { remedy: occurrence.remedy }),
        },
        sessionId: occurrence.sessionId,
        turnId: occurrence.turnId,
        dedupeKey: `turn.failed:${occurrence.sessionId}`,
      };

    case 'artifact.ready':
      return {
        account: occurrence.account,
        class: 'artifact.ready',
        // **A failed picture needs acting on and a ready one does not**, which
        // is why this is answered here: the outcome is known at this line and
        // nowhere earlier. A fifth class would have been the alternative, and
        // [09 §3.5] named `artifact.ready` the way it did to avoid exactly that.
        actionable: occurrence.outcome === 'failed',
        params: { purpose: occurrence.purpose, outcome: occurrence.outcome },
        sessionId: occurrence.sessionId,
        turnId: occurrence.turnId,
        dedupeKey: `artifact:${occurrence.turnId}`,
      };

    case 'system.notice':
      return {
        account: occurrence.account,
        class: 'system.notice',
        actionable: occurrence.actionable,
        params: { ...occurrence.params, notice: occurrence.notice },
        dedupeKey: `notice:${occurrence.notice}`,
      };
  }
}

/**
 * ***Where the one implementation lives, and why it is not here.***
 *
 * [`NotificationBus`](./bus.ts) implements this, because presence and delivery
 * turn out to be one registry read two ways: a person is *connected* when they
 * hold a notification stream, and that stream is where a notification is
 * delivered. Two structures would have to agree about who is online, and the
 * way that disagreement fails is quiet.
 *
 * ***An earlier draft of this file put presence over `TurnStream`'s subscriber
 * map and it could not have worked*** — corrected 2026-09-16, before it was
 * committed. That map is `sessionId -> Set<Listener>` and **a listener carries
 * no account**, deliberately: [09 §4.3] withholds sharing at 1.0, so anyone who
 * can read a session stream is its owner and the session bus has never needed
 * to know who. The registry that answers *whose* is therefore a new one, and it
 * is the notification bus's.
 *
 * **When [25 §3.4]'s real presence lands, something else implements this
 * interface and no producer changes**, which is the whole reason it is an
 * interface over one class rather than a `connected: boolean` threaded through
 * every call site.
 */

/** Nobody is anywhere — the default before anything has attached, and for tests. */
export const NOBODY_PRESENT: Presence = {
  isConnected: () => false,
  isViewing: () => false,
};

export type { NotificationClass };
