// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { get as httpGet, request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { closeApp } from './app.js';
import { makeTestServer, setUpAdmin, type TestServer } from './test-server.js';

/**
 * ***Closing a server somebody is looking at*** — [09 §6.4]'s restart, a
 * restore, and every `SIGTERM`, which all end in `app.close()`.
 *
 * **Over a real socket, because the defect only exists on one.** `inject()`
 * never listens, so `server.close()` has no connection to wait for, and the
 * old comment's measurement ("`app.close()` resolves in zero milliseconds with
 * a hijacked stream open") was true there and nowhere else. On a listener,
 * Fastify's `onClose` runs only *after* `server.close()` has waited for every
 * open response, and the stream closer lived in `onClose`: it waited on
 * itself. One signed-in tab was enough to hang *Restart now* for good.
 * `disconnect.test.ts` is the other file that has to bind a port, for the same
 * kind of reason.
 */

let server: TestServer | null = null;
let bare: FastifyInstance | null = null;
let release: (() => void) | null = null;

afterEach(async () => {
  release?.();
  release = null;
  await server?.dispose();
  server = null;
  await bare?.close();
  bare = null;
});

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as AddressInfo).port;
}

/**
 * Resolves `'closed'` when the promise does, or `'hung'` after `ms`: a hang
 * is the failure, so it has to be something an assertion can read rather than
 * a test that never returns.
 */
async function within(promise: Promise<unknown>, ms: number): Promise<'closed' | 'hung'> {
  let timer: NodeJS.Timeout | undefined;
  const hung = new Promise<'hung'>((resolve) => {
    timer = setTimeout(() => {
      resolve('hung');
    }, ms);
  });
  try {
    return await Promise.race([promise.then(() => 'closed' as const), hung]);
  } finally {
    clearTimeout(timer);
  }
}

describe('closing a listening server', () => {
  /**
   * Catches: moving the stream closer back to `onClose`. The close then waits
   * on a response that only the close would have ended, and this reads
   * `'hung'`.
   */
  it('ends an open event stream first, so the close does not wait on it', async () => {
    server = await makeTestServer();
    await setUpAdmin(server);
    const port = await listen(server.app);
    const cookie = [...server.cookies].map(([name, value]) => `${name}=${value}`).join('; ');

    // One tab's notification stream, on its own connection.
    const opened = new Promise<IncomingMessage>((resolve, reject) => {
      const outgoing = httpGet(
        {
          host: '127.0.0.1',
          port,
          path: '/api/me/notifications/stream',
          agent: false,
          headers: { cookie },
        },
        resolve,
      );
      outgoing.on('error', reject);
    });
    const stream = await opened;
    expect(stream.statusCode).toBe(200);
    const ended = new Promise<void>((resolve) => {
      stream.on('close', resolve);
      stream.resume();
    });

    expect(await within(server.app.close(), 3_000)).toBe('closed');
    // And the tab was told, rather than left holding a socket that went quiet:
    // the stream ended, which is what makes `EventSource` reconnect.
    expect(await within(ended, 1_000)).toBe('closed');
  });

  /**
   * ***The backstop, for everything that is not a stream.*** An assist or a
   * preview can wait on a model for as long as `limits.providerTimeoutMs`
   * allows, and a restart it held open is a server that stays down. So
   * `closeApp` ends whatever is still open once its bound runs out.
   *
   * Catches: calling `app.close()` without the backstop, which waits on the
   * held request and reads `'hung'`.
   */
  it('ends a request that is still running once the backstop runs out', async () => {
    bare = Fastify({ logger: false });
    bare.get('/hold', async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: true };
    });
    const port = await listen(bare);

    const answered = new Promise<'answered' | 'cut off'>((resolve) => {
      const outgoing = httpRequest(
        { host: '127.0.0.1', port, path: '/hold', agent: false },
        (incoming) => {
          incoming.resume();
          incoming.on('end', () => {
            resolve('answered');
          });
        },
      );
      outgoing.on('error', () => {
        resolve('cut off');
      });
      outgoing.end();
    });
    // The handler is running, so the request is what the close would wait on.
    while (release === null) await new Promise((tick) => setImmediate(tick));

    expect(await within(closeApp(bare, 100), 3_000)).toBe('closed');
    expect(await answered).toBe('cut off');
  });
});
