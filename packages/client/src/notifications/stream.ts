// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { openSseStream, type StreamHandle } from '../sse/connect.js';
import type { NotificationList, NotificationView } from './types.js';

/**
 * The notification stream — [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md)'s
 * second channel, [P10.2].
 *
 * ***Twenty lines, because the transport moved to
 * [`sse/connect.ts`](../sse/connect.js) when this file arrived.*** What is its
 * own is that there is **no cursor**: a notification is a record rather than a
 * sequenced event, so a reconnect does not replay — it re-reads. The server
 * sends the whole list as its first frame and this hands it to `onSnapshot`,
 * which is what makes a drop lossless without anything resembling a backlog.
 *
 * *The same bargain [P9.2] took for the rendition frame*, one layer out:
 * exactness comes from the snapshot rather than from a sequence, and the price
 * is that nothing here may emit an `id:`.
 */

export interface NotificationStreamHandlers {
  /** The whole list, on attach and on every reattach. Replaces, never merges. */
  onSnapshot: (list: NotificationList) => void;
  /** One notification, live. Applied by upsert — it may be a fold of an existing row. */
  onNotification: (notification: NotificationView) => void;
  onReconnecting: () => void;
  onFatal: (error: string) => void;
}

export function openNotificationStream(
  handlers: NotificationStreamHandlers,
  options: { fetchImpl?: typeof fetch } = {},
): StreamHandle {
  return openSseStream({
    url: () => '/api/me/notifications/stream',
    handlers: {
      onFrame: (frame) => {
        if (frame.event === 'snapshot') {
          const list = frame.data as NotificationList | null;
          // A null body is valid JSON and would otherwise blank the list; the
          // same defensiveness `field()` exists for one module over.
          if (list !== null && Array.isArray(list.notifications)) handlers.onSnapshot(list);
          return;
        }
        if (frame.event === 'notification') {
          const one = frame.data as NotificationView | null;
          if (one !== null && typeof one.id === 'string') handlers.onNotification(one);
        }
      },
      onReconnecting: handlers.onReconnecting,
      onFatal: handlers.onFatal,
    },
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
}

/**
 * A list with one notification applied — **upsert by id, newest first**.
 *
 * ***A fold arrives as the same row again with a higher `folded`***, which is
 * the whole reason this is an upsert rather than an unshift: the server does not
 * send *"and four more"*, it sends the row it just changed. Prepending would
 * show one notification five times and make the unread count disagree with what
 * is on screen.
 *
 * `unread` is recomputed from the rows rather than incremented, so a fold into
 * an already-unread row does not add to it — which is the count that matches
 * what the server would answer.
 */
export function applyNotification(list: NotificationList, one: NotificationView): NotificationList {
  const without = list.notifications.filter((held) => held.id !== one.id);
  const notifications = [one, ...without].sort((a, b) => b.createdAt - a.createdAt);
  return { notifications, unread: notifications.filter((held) => held.readAt === null).length };
}
