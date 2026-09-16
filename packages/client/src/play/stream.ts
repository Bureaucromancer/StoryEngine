// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { field, openSseStream, type StreamHandle, type StreamHandlers } from '../sse/connect.js';

/**
 * The session stream — [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [19 §11](../../../../docs/design/19-tech-stack.md).
 *
 * ***What is left here after [P10.2] is the cursor, which is the only thing
 * about this stream that is its own.*** The transport — a `fetch` loop rather
 * than `EventSource`, a refusal that stops, a drop that retries — moved to
 * [`sse/connect.ts`](../sse/connect.js) when a second stream arrived, and that
 * file carries the argument. This one says how a session stream is addressed and
 * what a frame does to the address of the next attempt.
 *
 * **Exactly-once is the cursor's**, which is why it is remembered here rather
 * than in the reducer: a reconnect must ask for everything *after* what it
 * actually received, and an `overflow` frame names where the server gave up.
 */

export type { StreamHandle, StreamHandlers };

export function openTurnStream(
  sessionId: string,
  handlers: StreamHandlers,
  options: { after?: string | null; fetchImpl?: typeof fetch } = {},
): StreamHandle {
  let cursor = options.after ?? null;

  return openSseStream({
    url: () => {
      const base = `/api/sessions/${sessionId}/stream`;
      return cursor === null ? base : `${base}?after=${encodeURIComponent(cursor)}`;
    },
    handlers,
    onCursor: (frame) => {
      if (frame.id !== undefined) cursor = frame.id;
      if (frame.event === 'overflow') {
        const named = field(frame.data, 'cursor');
        if (typeof named === 'string' && named.length > 0) cursor = named;
      }
    },
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
}
