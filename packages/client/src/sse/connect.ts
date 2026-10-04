// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { SseParser, type SseFrame } from './parser.js';

/**
 * The connector — `fetch` plus a `ReadableStream`, deliberately not `EventSource`.
 *
 * **`EventSource` cannot see an HTTP status.** A 401 after a session expires and
 * a 404 for a session that is not yours both arrive as a bare `onerror`, and the
 * browser then retries every three seconds forever behind a UI that cannot say
 * why. Reading `response.status` is the whole difference: a fatal stops, and
 * only a transport failure reconnects — which is what
 * [20 §11](../../../../docs/design/20-tech-stack.md)'s *quiet reconnecting state
 * that resumes rather than erroring out* actually asks for.
 *
 * Nothing about a route changes for this: `fetch` sends cookies same-origin and
 * sets no header, which is what both stream routes' standing *"nothing may add a
 * header requirement here"* depends on.
 *
 * ---
 *
 * ***Generic since [P10.2], and the generalisation is a move rather than a
 * rewrite.*** This was `play/stream.ts`, written when the session stream was the
 * only one. [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md)
 * describes two, and the second — the per-account notification stream — has the
 * same transport problem and a different address. What varies between them is
 * **the URL and whether a frame moves a cursor**, which is why those are the two
 * callbacks; everything else here is the retry policy, and two copies of a retry
 * policy is how two streams end up disagreeing about what a 403 means.
 *
 * *`play/stream.test.ts` is unchanged and is the proof*: it drives
 * `openTurnStream`, which is now a twenty-line caller of this, so its assertions
 * about refusals, retries and cursors are assertions about this file.
 */

export interface StreamHandlers {
  onFrame: (frame: SseFrame) => void;
  /** A transport hiccup. The UI says *reconnecting*; a cursor makes it lossless. */
  onReconnecting: () => void;
  /** A class the client cannot recover from. Never retried. */
  onFatal: (error: string) => void;
}

export interface StreamHandle {
  close: () => void;
}

export interface SseStreamOptions {
  /**
   * The address to (re)connect to, asked **per attempt** rather than once.
   *
   * A function because a reconnect is not the same request as the first one:
   * the session stream appends the cursor it has reached, so a URL captured at
   * open would replay from the beginning on every drop.
   */
  url: () => string;
  handlers: StreamHandlers;
  /**
   * Called for every frame, before the handler, so the caller can advance
   * whatever it reconnects with. Optional — a stream with no cursor has nothing
   * to remember, which is the notification stream's case exactly.
   */
  onCursor?: (frame: SseFrame) => void;
  fetchImpl?: typeof fetch;
}

/** How long before a dropped connection is retried. The server suggests 3s. */
const RETRY_MS = 3000;

export function openSseStream(options: SseStreamOptions): StreamHandle {
  const controller = new AbortController();
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const { handlers } = options;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  async function connect(): Promise<void> {
    const response = await doFetch(options.url(), {
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
        // Before the handler, because it is what the *next connection* must ask
        // for — a concern of the transport rather than of whoever is reading.
        options.onCursor?.(frame);
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
        // ended it. Both are resumable.
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
export function field(data: unknown, name: string): unknown {
  return typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)[name]
    : undefined;
}
