// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyNotification, openNotificationStream } from './stream.js';
import type { NotificationList, NotificationView } from './types.js';

/**
 * The notification stream — [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [P10.2].
 *
 * ***The transport is `sse/connect.ts`'s and is tested by
 * `play/stream.test.ts`***, which drives the same connector through
 * `openTurnStream` — refusals stop, drops retry. What is this stream's own is
 * the pair of frames and the **upsert**, and the upsert is where the interesting
 * failure lives.
 *
 * **The falsifying mutation is making the upsert a prepend.** Every assertion
 * about a notification arriving still passes; what goes red is a fold, which
 * appears as the same row five times with an unread count that disagrees with
 * what is on screen. That is [09 §3.4]'s *one notification, not five* failing in
 * the one place a person would see it.
 */

function one(over: Partial<NotificationView> = {}): NotificationView {
  return {
    id: 'n-1',
    class: 'turn.complete',
    actionable: false,
    params: { sessionName: 'The harbour' },
    sessionId: 's-1',
    turnId: 't-1',
    folded: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    readAt: null,
    ...over,
  };
}

const EMPTY: NotificationList = { notifications: [], unread: 0 };

describe('applying one notification', () => {
  it('adds a new one, newest first', () => {
    const after = applyNotification(
      { notifications: [one({ id: 'old', createdAt: 500 })], unread: 1 },
      one({ id: 'new', createdAt: 900 }),
    );

    expect(after.notifications.map((held) => held.id)).toEqual(['new', 'old']);
    expect(after.unread).toBe(2);
  });

  /**
   * ***A fold arrives as the same row again with a higher `folded`***, because
   * the server does not send *"and four more"* — it sends the row it changed.
   */
  it('replaces the row it is a fold of rather than adding one', () => {
    let list = applyNotification(EMPTY, one({ folded: 1 }));
    list = applyNotification(list, one({ folded: 2, updatedAt: 2_000 }));
    list = applyNotification(list, one({ folded: 3, updatedAt: 3_000 }));

    expect(list.notifications).toHaveLength(1);
    expect(list.notifications[0]?.folded).toBe(3);
    // One unread, not three. A prepend would say three here, which is the
    // badge disagreeing with the list it sits above.
    expect(list.unread).toBe(1);
  });

  it('recomputes the unread count rather than incrementing it', () => {
    const list = applyNotification(
      { notifications: [one({ id: 'read', readAt: 5_000 })], unread: 0 },
      one({ id: 'fresh' }),
    );

    expect(list.unread).toBe(1);
  });
});

/** A response whose body streams the given chunks and then ends. */
function bodyOf(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the frames this stream carries', () => {
  it('hands the snapshot over whole, and each notification after it', async () => {
    const snapshots: NotificationList[] = [];
    const live: NotificationView[] = [];
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        bodyOf([
          'retry: 3000\n\n',
          `event: snapshot\ndata: ${JSON.stringify({ notifications: [one()], unread: 1 })}\n\n`,
          `event: notification\ndata: ${JSON.stringify(one({ id: 'n-2' }))}\n\n`,
        ]),
      ),
    ) as unknown as typeof fetch;

    const handle = openNotificationStream(
      {
        onSnapshot: (list) => snapshots.push(list),
        onNotification: (held) => live.push(held),
        onReconnecting: vi.fn(),
        onFatal: vi.fn(),
      },
      { fetchImpl },
    );

    await vi.advanceTimersByTimeAsync(0);
    handle.close();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.unread).toBe(1);
    expect(live.map((held) => held.id)).toEqual(['n-2']);
  });

  /**
   * *No `?after=`, ever.* There is no cursor on this stream: a reconnect
   * re-reads rather than replaying, which is what the snapshot frame is for.
   * A query string appearing here would mean somebody had given it one.
   */
  it('asks for the same address every time', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(bodyOf(['retry: 3000\n\n']));
    }) as unknown as typeof fetch;

    const handle = openNotificationStream(
      {
        onSnapshot: vi.fn(),
        onNotification: vi.fn(),
        onReconnecting: vi.fn(),
        onFatal: vi.fn(),
      },
      { fetchImpl },
    );

    await vi.advanceTimersByTimeAsync(0);
    // The body ended cleanly, so the connector schedules a retry.
    await vi.advanceTimersByTimeAsync(3000);
    handle.close();

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(calls)).toEqual(new Set(['/api/me/notifications/stream']));
  });

  it('ignores a frame whose body is not what it claims', async () => {
    const onSnapshot = vi.fn();
    const onNotification = vi.fn();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        bodyOf(['event: snapshot\ndata: null\n\n', 'event: notification\ndata: {"nope":1}\n\n']),
      ),
    ) as unknown as typeof fetch;

    const handle = openNotificationStream(
      { onSnapshot, onNotification, onReconnecting: vi.fn(), onFatal: vi.fn() },
      { fetchImpl },
    );

    await vi.advanceTimersByTimeAsync(0);
    handle.close();

    // `null` is valid JSON and a body with no `id` is a body from a build that
    // does not exist yet. Blanking the list over either would be worse than
    // showing a stale one.
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onNotification).not.toHaveBeenCalled();
  });
});
