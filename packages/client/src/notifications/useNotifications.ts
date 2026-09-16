// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api.js';
import { showBrowserNotification } from './browser.js';
import { playChime } from './chime.js';
import { summary } from './labels.js';
import { applyNotification, openNotificationStream } from './stream.js';
import type { NotificationList, NotificationView } from './types.js';

/**
 * The delivery channels, wired — [09 §3.6](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P10.2].
 *
 * ***One hook for all four in-app surfaces***, and that is the design rather
 * than convenience. §3.6's channel 1 is *"sound, toast, unread badge, document
 * title"* — **four things that must agree**, because they are four renderings of
 * one fact. Split across four components they would each hold their own copy of
 * *what has arrived*, and the way that fails is a badge showing two while the
 * title shows three.
 *
 * ***The query cache is the state, and the stream writes into it.*** That is
 * `usePatchPrefs`' shape one shelf along: one place holds the truth, every
 * surface reads it, and nothing has a second copy to fall out of step. The list
 * route seeds it on mount and the stream's snapshot replaces it on every
 * reattach — so a drop costs a repaint and never a missed notification.
 */

export const NOTIFICATIONS_KEY = ['notifications'] as const;

const EMPTY: NotificationList = { notifications: [], unread: 0 };

export function useNotificationList(enabled: boolean): UseQueryResult<NotificationList> {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => api.readNotifications(),
    enabled,
    /**
     * **No polling interval**, unlike `useNotices`. The stream is the live
     * channel and a poll beside it would be a second clock: two sources
     * disagreeing about the count for up to thirty seconds, which is precisely
     * the state a badge must never be in. A reattach re-reads, which is the
     * recovery this needs.
     */
  });
}

export interface NotificationsState {
  list: NotificationList;
  /** The stream's health, for the one line a surface shows about it. */
  connected: boolean;
  /** What a toast should show right now, or null. */
  toast: NotificationView | null;
  dismissToast: () => void;
  markRead: (ids?: string[]) => void;
}

/**
 * Subscribes, delivers, and hands back what the surfaces render.
 *
 * ***Mounted once, in the shell.*** A second mount would open a second stream
 * and play the chime twice, which is the failure mode of every *"just use the
 * hook where you need it"* design and is why this returns state rather than
 * being called by each consumer.
 */
export function useNotifications(enabled: boolean): NotificationsState {
  const client = useQueryClient();
  const query = useNotificationList(enabled);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<NotificationView | null>(null);

  /**
   * ***What has already been announced, so a reconnect is silent.***
   *
   * The snapshot on reattach carries every unread notification, including the
   * ones this tab already chimed for. Without this, a flaky LAN would turn one
   * finished turn into a sound every three seconds — and the person would
   * reasonably conclude notifications are broken rather than that the network
   * is. Ids rather than a timestamp, because a **fold** re-sends a row whose
   * `createdAt` has not moved.
   *
   * *A ref rather than state*: announcing must not re-render, and the value has
   * to be readable from inside the stream callback without re-subscribing.
   */
  const announced = useRef<Set<string>>(new Set());
  /**
   * How many folds of each row have been announced.
   *
   * **A fold is news the second time**: *your picture is ready* and then *three
   * pictures are ready* are different facts about the same row, and [09 §3.4]'s
   * whole point is that the second one is worth saying once rather than three
   * times. So the id alone would silence a fold, and a bare re-announce would
   * chime for every arrival the fold exists to collapse.
   */
  const foldedAt = useRef<Map<string, number>>(new Map());

  const deliver = useCallback((one: NotificationView) => {
    if (one.readAt !== null) return;
    const seen = foldedAt.current.get(one.id);
    if (seen !== undefined && seen >= one.folded) return;
    announced.current.add(one.id);
    foldedAt.current.set(one.id, one.folded);

    playChime();
    setToast(one);
    const said = summary(one);
    showBrowserNotification({ title: said.title, body: said.body, tag: one.id });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handle = openNotificationStream({
      onSnapshot: (list) => {
        setConnected(true);
        client.setQueryData<NotificationList>(NOTIFICATIONS_KEY, list);
        /**
         * **The snapshot is recorded as announced without announcing it.** What
         * is on it is what was true before this tab attached — a reload, a
         * reconnect, or a notification raised while this browser was closed —
         * and none of that is news happening *now*. The badge shows it, which
         * is the durable channel doing its job.
         */
        for (const one of list.notifications) {
          announced.current.add(one.id);
          foldedAt.current.set(one.id, one.folded);
        }
      },
      onNotification: (one) => {
        client.setQueryData<NotificationList>(NOTIFICATIONS_KEY, (held) =>
          applyNotification(held ?? EMPTY, one),
        );
        deliver(one);
      },
      onReconnecting: () => {
        setConnected(false);
      },
      onFatal: () => {
        setConnected(false);
      },
    });

    return () => {
      handle.close();
    };
  }, [client, deliver, enabled]);

  const markRead = useCallback(
    (ids: string[] = []) => {
      /**
       * **Optimistic, for `usePatchPrefs`' reason**: a badge that waits for a
       * round trip before clearing is a badge that feels broken on a LAN. The
       * answer carries the real count and replaces this.
       */
      client.setQueryData<NotificationList>(NOTIFICATIONS_KEY, (held) => {
        const list = held ?? EMPTY;
        const at = Date.now();
        const notifications = list.notifications.map((one) =>
          (ids.length === 0 || ids.includes(one.id)) && one.readAt === null
            ? { ...one, readAt: at }
            : one,
        );
        return { notifications, unread: notifications.filter((o) => o.readAt === null).length };
      });
      setToast((held) =>
        held !== null && (ids.length === 0 || ids.includes(held.id)) ? null : held,
      );

      void api
        .markNotificationsRead(ids)
        .then(() => client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }))
        .catch(() => client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }));
    },
    [client],
  );

  const list = query.data ?? EMPTY;
  useUnreadInTitle(list.unread);

  return {
    list,
    connected,
    toast,
    dismissToast: useCallback(() => {
      setToast(null);
    }, []),
    markRead,
  };
}

/**
 * The fourth in-app channel: the document title — [09 §3.6].
 *
 * ***The one channel that works when the tab is not on screen and the install is
 * plain HTTP***, which makes it the quiet workhorse of §3.6's table rather than
 * an afterthought: the tab strip is where somebody looks when they come back to
 * a browser they left. So it is a prefix on whatever title the page had, not a
 * replacement — losing *which page this is* to gain a count would be a bad
 * trade.
 *
 * **The base title is captured once**, not re-read: reading it on every change
 * would capture a title this hook had already prefixed, and the count would
 * accumulate — `(2) (1) StoryEngine`.
 */
function useUnreadInTitle(unread: number): void {
  const base = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    base.current ??= document.title;
    const original = base.current;
    document.title = unread > 0 ? `(${String(unread)}) ${original}` : original;

    return () => {
      document.title = original;
    };
  }, [unread]);
}
