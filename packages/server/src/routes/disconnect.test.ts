// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { abortOnDisconnect } from './disconnect.js';

/**
 * ***A signal that notices a person leaving, and nothing else*** —
 * `disconnect.ts`, found at
 * [P13](../../../../docs/design/workplan/30-p13-implementation.md) §0.5.
 *
 * **Over a listening socket, on purpose.** The fault this repairs lived in the
 * difference between a real connection and `inject`, which has none — so a
 * test through `inject` would pass against the broken version and the repair
 * alike. A bare Fastify app on `127.0.0.1:0` is the smallest thing that has the
 * behaviour, and it is what `main.test.ts` and `renditions/shutdown.test.ts`
 * already bind.
 *
 * *The first arm is a test of Node rather than of this code*, and it is here
 * deliberately: it pins the premise, so the next person to read `disconnect.ts`
 * and think *surely the request's `close` is simpler* finds out in the suite
 * rather than in somebody's bill.
 */

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

const pause = (ms: number) => new Promise((settle) => setTimeout(settle, ms));

/** A POST with a body to a route on a fresh, listening app. */
async function serve(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
): Promise<(signal?: AbortSignal) => Promise<string>> {
  app = Fastify();
  app.post('/x', handler);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return (signal) =>
    fetch(`http://127.0.0.1:${String(port)}/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'illustration' }),
      ...(signal === undefined ? {} : { signal }),
    }).then(
      (response) => response.text(),
      () => 'left',
    );
}

describe('noticing that the person who asked has gone', () => {
  it('cannot use the request’s close: it has fired before the handler is done, client or no client', async () => {
    let closedWhileHandling = false;
    const post = await serve(async (request) => {
      request.raw.on('close', () => {
        closedWhileHandling = true;
      });
      await pause(200);
      return { closedWhileHandling };
    });

    // The client is waiting for its answer, and the request has "closed" anyway.
    expect(JSON.parse(await post())).toEqual({ closedWhileHandling: true });
  });

  it('stays quiet for a client that waits for its answer', async () => {
    const post = await serve(async (_request, reply) => {
      const signal = abortOnDisconnect(reply);
      await pause(200);
      return { aborted: signal.aborted };
    });

    expect(JSON.parse(await post())).toEqual({ aborted: false });
  });

  it('aborts for a client that leaves before the answer', async () => {
    let seen: boolean | null = null;
    const post = await serve(async (_request, reply) => {
      const signal = abortOnDisconnect(reply);
      await pause(400);
      seen = signal.aborted;
      return { aborted: signal.aborted };
    });

    const leaving = new AbortController();
    setTimeout(() => {
      leaving.abort();
    }, 100);
    expect(await post(leaving.signal)).toBe('left');

    await pause(500);
    expect(seen).toBe(true);
  });

  /**
   * ***Attached late, and still in time*** — the property the route's old
   * listener did not have. Illustrate put its listener on after two awaited
   * reads; the request's `close` had already gone by, so a person who left was
   * never noticed. The response's `close` has not happened yet at that point,
   * whenever the point is.
   */
  it('notices a client that leaves even when it is attached after awaited work', async () => {
    let seen: boolean | null = null;
    const post = await serve(async (_request, reply) => {
      await readFile(fileURLToPath(import.meta.url));
      await readFile(fileURLToPath(import.meta.url));
      const signal = abortOnDisconnect(reply);
      await pause(400);
      seen = signal.aborted;
      return { aborted: signal.aborted };
    });

    const leaving = new AbortController();
    setTimeout(() => {
      leaving.abort();
    }, 100);
    expect(await post(leaving.signal)).toBe('left');

    await pause(500);
    expect(seen).toBe(true);
  });
});
