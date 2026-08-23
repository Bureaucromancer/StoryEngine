// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openTurnStream, type StreamHandlers } from './stream.js';

/**
 * The connector — the half of the transport that decides **whether to try
 * again**.
 *
 * That decision is the entire reason this is a `fetch` loop rather than
 * `EventSource` ([07 §11]): `EventSource` retries everything forever, including
 * a 404, and it cannot send `?after=`. So the claims worth testing are the two
 * it exists to make — that a refusal stops, and that a drop resumes *from the
 * cursor* rather than from the beginning.
 *
 * Written after a 404 on a stale session id produced four requests and a
 * permanent *Reconnecting…* in the browser. `onFatal` was called and the retry
 * ran anyway, because the fatal arm returned without setting `closed`. A test
 * that only asserted `onFatal` fired would have passed on that code, so every
 * test here asserts what happened *next*.
 */

function handlersSpy(): StreamHandlers & { frames: unknown[] } {
  const frames: unknown[] = [];
  return {
    frames,
    onFrame: (frame) => frames.push(frame),
    onReconnecting: vi.fn(),
    onFatal: vi.fn(),
  };
}

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

describe('a refusal', () => {
  it.each([
    [401, 'unauthenticated'],
    [403, 'not-found'],
    [404, 'not-found'],
  ])('stops on %i rather than retrying', async (status, expected) => {
    const handlers = handlersSpy();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status }));

    openTurnStream('s1', handlers, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(handlers.onFatal).toHaveBeenCalledWith(expected);
    // The point of the test: one request, not one every three seconds.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(handlers.onReconnecting).not.toHaveBeenCalled();
  });

  /**
   * 403 reports `not-found` because the routes answer 404 for another account's
   * session — path-is-owner, so *exists but not yours* is not a distinction the
   * client is told. The mapping is asserted so a later route that starts
   * answering 403 does not quietly leak that distinction into the UI.
   */
  it('never shows a class the server did not choose', async () => {
    const handlers = handlersSpy();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

    openTurnStream('s1', handlers, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(0);

    expect(handlers.onFatal).toHaveBeenCalledWith('not-found');
  });
});

describe('a drop', () => {
  it('retries, and asks to resume from the last id it saw', async () => {
    const handlers = handlersSpy();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(bodyOf(['id: job-1.4\nevent: progress\ndata: {"seq":4}\n\n']))
      .mockResolvedValue(new Response(new ReadableStream(), { status: 200 }));

    openTurnStream('s1', handlers, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(5000);

    expect(handlers.onReconnecting).toHaveBeenCalled();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/sessions/s1/stream');
    // Without the cursor the reconnect replays the turn from its first event,
    // which is the duplicate the reducer's guard would then have to absorb.
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('/api/sessions/s1/stream?after=job-1.4');
  });

  /**
   * An `overflow` frame carries the resume point for a client the server gave up
   * on. It is the one case where the cursor comes from a frame's *body* rather
   * than its `id:`, because the events between were never delivered — so
   * resuming from the last `id:` would ask for them all again.
   */
  it('resumes from an overflow cursor rather than the last id', async () => {
    const handlers = handlersSpy();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        bodyOf([
          'id: job-1.4\nevent: progress\ndata: {"seq":4}\n\n',
          'event: overflow\ndata: {"cursor":"job-1.90"}\n\n',
        ]),
      )
      .mockResolvedValue(new Response(new ReadableStream(), { status: 200 }));

    openTurnStream('s1', handlers, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchImpl.mock.calls[1]?.[0]).toBe('/api/sessions/s1/stream?after=job-1.90');
  });

  it('retries a transport failure the same way', async () => {
    const handlers = handlersSpy();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('failed to fetch'))
      .mockResolvedValue(new Response(new ReadableStream(), { status: 200 }));

    openTurnStream('s1', handlers, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('a server-sent error frame', () => {
  it('is delivered and then stops the loop', async () => {
    const handlers = handlersSpy();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(bodyOf(['event: error\ndata: {"error":"budget"}\n\n']));

    openTurnStream('s1', handlers, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(handlers.onFatal).toHaveBeenCalledWith('budget');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to a class rather than passing along a shape it cannot read', async () => {
    const handlers = handlersSpy();
    const fetchImpl = vi.fn().mockResolvedValue(bodyOf(['event: error\ndata: null\n\n']));

    openTurnStream('s1', handlers, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(0);

    expect(handlers.onFatal).toHaveBeenCalledWith('internal');
  });
});

describe('close', () => {
  it('cancels a retry that was already scheduled', async () => {
    const handlers = handlersSpy();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));

    const handle = openTurnStream('s1', handlers, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(100);
    handle.close();
    await vi.advanceTimersByTimeAsync(20_000);

    // The one attempt that was already in flight, and nothing after it: a
    // component that unmounts must not leave a timer reconnecting forever.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
