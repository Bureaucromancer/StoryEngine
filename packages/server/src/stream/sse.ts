// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ServerResponse } from 'node:http';

import { formatCursor, type StreamFrame } from './attach.js';

/**
 * SSE framing — [19 §8](../../../../docs/design/19-tech-stack.md).
 *
 * SSE rather than WebSockets because the traffic is one-directional and because
 * it reconnects by itself: a browser resends `Last-Event-ID` with no code of
 * ours involved, which is what makes the cursor a transport feature rather than
 * an application protocol.
 */

/** Beyond this many queued durable frames, the stream ends rather than growing. */
const MAX_QUEUED = 256;

export interface SseOptions {
  keepaliveMs: number;
  /** Called once when the stream can no longer be written to. */
  onClose: () => void;
}

export class SseWriter {
  readonly #response: ServerResponse;
  readonly #options: SseOptions;
  readonly #queue: string[] = [];
  #keepalive: NodeJS.Timeout | null = null;
  /** The id of the last durable frame the socket actually accepted. */
  #lastWritten: string | null = null;
  #closed = false;
  #draining = false;

  constructor(response: ServerResponse, options: SseOptions) {
    this.#response = response;
    this.#options = options;

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      // `no-transform` matters as much as `no-cache`: a proxy that helpfully
      // compressed this would buffer it, and a buffered event stream is a
      // stream that arrives all at once at the end.
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx buffers proxied responses by default and this is how it is told
      // not to. Cheap, and the alternative is an install that looks broken only
      // behind a reverse proxy.
      'x-accel-buffering': 'no',
    });

    // Told once. A client that loses the connection retries on its own after
    // this long, which is the reconnection [19 §8] chose SSE for.
    this.#write('retry: 3000\n\n', false);

    this.#keepalive = setInterval(() => {
      // A comment frame: no event, no id, nothing for a client to handle. It
      // exists to keep an idle connection from being reaped by something in the
      // middle that cannot tell a quiet stream from a dead one.
      this.#write(': keepalive\n\n', true);
    }, options.keepaliveMs);
    // Never the reason a process stays alive.
    this.#keepalive.unref();

    response.on('drain', () => {
      this.#draining = false;
      this.#flush();
    });
  }

  send(frame: StreamFrame): void {
    if (this.#closed) return;

    switch (frame.kind) {
      case 'snapshot':
        this.#write(`event: snapshot\ndata: ${JSON.stringify(frame.snapshot)}\n\n`, false);
        return;
      case 'progress': {
        const id = formatCursor({ jobId: frame.jobId, seq: frame.event.seq });
        this.#write(
          `id: ${id}\nevent: progress\ndata: ${JSON.stringify({
            jobId: frame.jobId,
            ...frame.event,
          })}\n\n`,
          false,
        );
        return;
      }
      case 'delta':
        /**
         * **Deliberately no `id:` line.**
         *
         * A delta is ephemeral ([P2 §2.10] declines to make it durable), and an
         * `id` is a promise that a client may come back and ask for everything
         * after it. No store can answer that for a delta — so giving one an id
         * would let a browser reconnect with a `Last-Event-ID` naming a cursor
         * that does not exist.
         */
        this.#write(
          `event: delta\ndata: ${JSON.stringify({
            jobId: frame.jobId,
            text: frame.text,
            // A speaking call's message index, [P14.2] — absent, not null, on
            // everything else, so the frame a pre-P14.2 client parses is the
            // frame it always parsed.
            ...(frame.message === undefined ? {} : { message: frame.message }),
          })}\n\n`,
          true,
        );
        return;
      case 'rendition':
        /**
         * **No `id:` line either, and for a different reason than `delta`'s.**
         *
         * A delta has no id because nothing could answer *everything after
         * this*. A rendition frame has none because it does not need one: it
         * carries the **whole record**, so a client applies it by upsert and
         * converges on the same map whatever it missed. Exactness comes from
         * re-reading the set on attach rather than from a backlog, which is what
         * [P9.2] trades for keeping `attachToSession` synchronous.
         *
         * **Durable rather than droppable**, unlike a delta: a dropped delta
         * costs a repaint that the next checkpoint fixes, and a dropped
         * rendition frame is a picture that never appears until the page is
         * reloaded.
         */
        this.#write(`event: rendition\ndata: ${JSON.stringify(frame.rendition)}\n\n`, false);
        return;
      case 'summaries':
        /**
         * ***The summary warm*** — [P14.11]. No `id:` line, for the rendition
         * frame's reason: the frame is the whole state. *A link's progress is
         * droppable and the end is not*: a dropped `warming` frame is a
         * progress bar one link behind until the next, and a dropped ending is
         * a bar that never finishes.
         */
        this.#write(
          `event: summaries\ndata: ${JSON.stringify(frame.warm)}\n\n`,
          frame.warm.state === 'warming',
        );
        return;
    }
  }

  /**
   * One frame of a stream whose frames are not {@link StreamFrame}.
   *
   * ***The typed door stays typed and this is the second one*** — [P10.1].
   * {@link send} is exhaustive over the session stream's union on purpose: a new
   * session frame has to be declared there or it does not compile. The
   * **notification** stream ([09 §3.1]'s other channel) is per *account* rather
   * than per session, carries whole records, and has no cursor — so its frames
   * are not that union and adding them to it would make `attach.ts` declare a
   * frame session attach can never produce.
   *
   * What is shared is everything below the frame: the head, the keepalive, the
   * backpressure queue and the overflow rule. Duplicating those for a second
   * stream is how two streams end up disagreeing about which of them drops.
   *
   * **No `id:` line, for the rendition frame's reason**: a client applies these
   * by upsert and re-reads the list on attach, so exactness comes from the
   * snapshot rather than from a backlog nothing could serve.
   */
  emit(event: string, data: unknown, droppable = false): void {
    if (this.#closed) return;
    this.#write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, droppable);
  }

  /** A class, never a message — the same rule the JSON errors follow. */
  fail(error: string): void {
    this.#write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`, false);
    this.close();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#keepalive) clearInterval(this.#keepalive);
    this.#keepalive = null;
    this.#options.onClose();
    this.#response.end();
  }

  /**
   * Writes, or queues if the socket is full.
   *
   * **Droppable frames are dropped and durable ones are not**, which is the
   * whole backpressure policy. A delta or a keepalive that a slow client missed
   * costs nothing — the next checkpoint carries the accumulated text and resyncs
   * it. A sequenced progress frame cannot be dropped, because the client's
   * exactly-once guarantee is over exactly those.
   *
   * Past the bound the stream **ends with a cursor** rather than growing without
   * limit. Terminating is lossless: the client reconnects with that cursor and
   * reads the rest from the store. An unbounded queue would trade a bounded
   * memory cost for an unbounded one, to protect a client that is not reading.
   */
  #write(text: string, droppable: boolean): void {
    if (this.#closed) return;

    if (this.#draining) {
      if (droppable) return;
      if (this.#queue.length >= MAX_QUEUED) {
        this.#overflow();
        return;
      }
      this.#queue.push(text);
      return;
    }

    this.#emit(text);
  }

  /**
   * Hands one frame to the socket and remembers it if it carried an id.
   *
   * The bookkeeping is the whole point: an overflow has to tell the client where
   * to resume, and the only honest answer is the last thing it was actually
   * sent.
   */
  #emit(text: string): void {
    if (text.startsWith('id: ')) this.#lastWritten = text.slice(4, text.indexOf('\n'));
    // `false` under backpressure, and `false` (not a throw) after an abort.
    if (!this.#response.write(text)) this.#draining = true;
  }

  #flush(): void {
    while (this.#queue.length > 0 && !this.#draining && !this.#closed) {
      const next = this.#queue.shift();
      if (next === undefined) return;
      this.#emit(next);
    }
  }

  /**
   * Ends the stream, naming where to resume.
   *
   * **The cursor is the last frame the client actually received**, not the
   * newest one queued behind it. `attachToSession` replays strictly *after* a
   * cursor, so naming an undelivered frame skips everything still queued — up to
   * the bound, silently, in a stream whose whole promise is exactly-once. That
   * is what this did before, and it turned a bounded, announced loss into an
   * unbounded, invisible one.
   */
  #overflow(): void {
    const cursor = this.#lastWritten ?? '';
    this.#queue.length = 0;
    this.#draining = false;
    this.#response.write(`event: overflow\ndata: ${JSON.stringify({ cursor })}\n\n`);
    this.close();
  }
}
