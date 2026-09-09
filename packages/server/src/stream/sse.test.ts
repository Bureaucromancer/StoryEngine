// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';

import type { ProgressEvent } from '../state/jobs.js';
import { SseWriter } from './sse.js';

/**
 * The writer's backpressure policy — [19 §8], and exit gate 14.
 *
 * The interesting behaviour is entirely in what happens when a client stops
 * reading: which frames may be dropped, which may not, and — the one that
 * matters most — **which cursor the client is told to come back with**. A
 * cursor that names a frame the client never received turns a bounded loss into
 * a silent one.
 */

/**
 * A response that accepts a bounded amount and then refuses, like a full socket.
 *
 * `drain()` both raises the cap and fires the event, because that is what a
 * socket draining *is*. A fake that fired the event while still refusing would
 * let one queued frame out per call and stall — which is correct behaviour
 * against a lying socket, and would have made the test below assert the fake.
 */
function fullAfter(bytes: number): {
  response: ServerResponse;
  written: string[];
  drain: () => void;
} {
  const written: string[] = [];
  let limit = bytes;
  let accepted = 0;
  const handlers = new Map<string, (() => void)[]>();

  const response = {
    writeHead: () => undefined,
    end: () => undefined,
    on(event: string, handler: () => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return this;
    },
    write(text: string): boolean {
      written.push(text);
      accepted += text.length;
      return accepted < limit;
    },
  } as unknown as ServerResponse;

  return {
    response,
    written,
    drain: () => {
      limit = Number.POSITIVE_INFINITY;
      for (const handler of handlers.get('drain') ?? []) handler();
    },
  };
}

function progress(seq: number): { kind: 'progress'; jobId: string; event: ProgressEvent } {
  return {
    kind: 'progress',
    jobId: 'job-1',
    event: { seq, key: 'call.streaming', params: {}, at: 0 },
  };
}

describe('a client that stops reading', () => {
  it('is told to resume from the last frame it was actually sent', () => {
    // The bug this test exists for: the cursor was read from the newest
    // *queued* frame — one the client had not received — so a reconnect
    // resumed past everything still in the queue. `attachToSession` replays
    // strictly after the cursor, so those events were skipped in silence, in a
    // stream whose whole promise is exactly-once.
    const { response, written } = fullAfter(200);
    const writer = new SseWriter(response, { keepaliveMs: 60_000, onClose: () => undefined });

    for (let seq = 1; seq <= 400; seq += 1) writer.send(progress(seq));

    const overflow = written.find((frame) => frame.startsWith('event: overflow'));
    expect(overflow, 'the stream should have ended rather than queued forever').toBeTruthy();

    const cursor = (JSON.parse(overflow?.split('data: ')[1] ?? '{}') as { cursor: string }).cursor;
    const delivered = written
      .filter((frame) => frame.startsWith('id: '))
      .map((frame) => frame.slice(4, frame.indexOf('\n')));

    // The cursor must name something the client was actually handed.
    expect(delivered).toContain(cursor);
    // …and specifically the last such thing, or the client re-reads what it has.
    expect(cursor).toBe(delivered.at(-1));
  });

  it('drops a delta but never a sequenced frame', () => {
    // Full from the first byte, so everything after it is queued or dropped —
    // a delta is only droppable while the socket is refusing.
    const { response, written, drain } = fullAfter(1);
    const writer = new SseWriter(response, { keepaliveMs: 60_000, onClose: () => undefined });

    writer.send(progress(1));
    writer.send({ kind: 'delta', jobId: 'job-1', text: 'a wasted word' });
    writer.send(progress(2));
    drain();

    const body = written.join('');
    // The delta is ephemeral — the next checkpoint's text resyncs it.
    expect(body).not.toContain('a wasted word');
    // The sequenced ones are the exactly-once promise and are queued, not lost.
    expect(body).toContain('job-1.1');
    expect(body).toContain('job-1.2');
  });
});
