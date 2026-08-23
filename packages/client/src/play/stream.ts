// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { SseParser, type SseFrame } from './sse.js';

/**
 * The connector — `fetch` plus a `ReadableStream`, deliberately not `EventSource`.
 *
 * **`EventSource` cannot see an HTTP status.** A 401 after a session expires and
 * a 404 for a session that is not yours both arrive as a bare `onerror`, and the
 * browser then retries every three seconds forever behind a UI that cannot say
 * why. Reading `response.status` is the whole difference: a fatal stops, and
 * only a transport failure reconnects — which is what
 * [07 §11](../../../../docs/design/07-tech-stack.md)'s *quiet reconnecting state that resumes
 * rather than erroring out* actually asks for.
 *
 * Nothing about the route changes for this: `fetch` sends cookies same-origin
 * and sets no header, which is what the stream route's standing "nothing may add
 * a header requirement here" depends on.
 */

export interface StreamHandlers {
  onFrame: (frame: SseFrame) => void;
  /** A transport hiccup. The UI says *reconnecting*; the cursor makes it lossless. */
  onReconnecting: () => void;
  /** A class the client cannot recover from. Never retried. */
  onFatal: (error: string) => void;
}

export interface StreamHandle {
  close: () => void;
}

/** How long before a dropped connection is retried. The server suggests 3s. */
const RETRY_MS = 3000;

export function openTurnStream(
  sessionId: string,
  handlers: StreamHandlers,
  options: { after?: string | null; fetchImpl?: typeof fetch } = {},
): StreamHandle {
  const controller = new AbortController();
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  let closed = false;
  let cursor = options.after ?? null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const url = (): string => {
    const base = `/api/sessions/${sessionId}/stream`;
    return cursor === null ? base : `${base}?after=${encodeURIComponent(cursor)}`;
  };

  async function connect(): Promise<void> {
    const response = await doFetch(url(), {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });

    /**
     * **The reason this is not `EventSource`.** These are answers, not
     * failures — retrying them would loop forever against a server that is
     * telling us plainly to stop.
     */
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      // `closed` before `return`, or the resolution path below reads a clean
      // finish and schedules a retry — which is how a 404 became four 404s and
      // a *Reconnecting…* that would never resolve. Caught by opening the page
      // on a session id that does not exist, which is also the first thing a
      // stale bookmark does.
      closed = true;
      handlers.onFatal(response.status === 401 ? 'unauthenticated' : 'not-found');
      return;
    }
    if (!response.ok || response.body === null) {
      throw new Error(`stream failed with status ${String(response.status)}`);
    }

    const parser = new SseParser();
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      for (const frame of parser.push(value)) {
        // Remembered here rather than in the reducer, because it is what the
        // *next connection* must ask for — a concern of the transport.
        if (frame.id !== undefined) cursor = frame.id;
        if (frame.event === 'overflow') {
          const named = field(frame.data, 'cursor');
          if (typeof named === 'string' && named.length > 0) cursor = named;
        }
        handlers.onFrame(frame);

        /**
         * **A server-sent `error` frame is fatal and never retried.**
         *
         * It arrives *after* a 200 head — the route has already hijacked the
         * socket by the time anything can go wrong — so the status cannot carry
         * it. Without this arm the one server-initiated fatal reproduces exactly
         * the infinite-retry failure `EventSource` was rejected for.
         */
        if (frame.event === 'error') {
          const named = field(frame.data, 'error');
          handlers.onFatal(typeof named === 'string' ? named : 'internal');
          closed = true;
          controller.abort();
          return;
        }
      }
    }
  }

  function run(): void {
    connect()
      .then(() => {
        // A clean end of body with no fatal: the server closed, or an overflow
        // ended it. Both are resumable from the cursor.
        if (!closed) schedule();
      })
      .catch((error: unknown) => {
        if (closed || controller.signal.aborted) return;
        void error;
        schedule();
      });
  }

  function schedule(): void {
    if (closed) return;
    handlers.onReconnecting();
    retry = setTimeout(run, RETRY_MS);
  }

  run();

  return {
    close: () => {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      controller.abort();
    },
  };
}

/**
 * One field out of a frame's untyped body.
 *
 * A cast would satisfy the compiler and check nothing — the body arrives as
 * whatever the server sent, and `null` is a valid JSON document.
 */
function field(data: unknown, name: string): unknown {
  return typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)[name]
    : undefined;
}
