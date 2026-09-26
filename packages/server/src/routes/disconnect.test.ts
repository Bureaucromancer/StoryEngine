// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { newActor } from '@storyengine/shared';

import { FakeProvider, type FakeProviderOptions } from '../providers/fake.js';
import {
  type GenerationRequest,
  type GenerationResult,
  ProviderError,
} from '../providers/types.js';
import { readRenditions } from '../renditions/store.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { disconnectSignal } from './disconnect.js';

/**
 * ***A client that leaves cancels the model call it started*** — the two
 * routes that dispatch one from inside a request, and the helper both now use.
 *
 * **Over a real socket, which is the exception to `test-server.ts`'s *nothing
 * binds a port*, and it cannot be avoided.** The defect this file pins down
 * exists only on a socket: `inject`'s request ignores a destroy once its body
 * has been read, and its response is never closed early, so under `inject` the
 * listener the illustrate route used and the one it uses now behave
 * identically and the suite could not tell them apart. Loopback on port 0,
 * the arrangement `main.test.ts`'s `freePort` already uses, one listener per
 * test, closed by `dispose`.
 */

let server: TestServer | null = null;
let bare: FastifyInstance | null = null;
let logLines: string[] = [];

afterEach(async () => {
  await server?.dispose();
  server = null;
  await bare?.close();
  bare = null;
  logLines = [];
});

/**
 * Resolves after `ms`, rejects the moment `signal` aborts — the shape of a
 * provider call that is taking its time. The rejection is the one
 * `FakeProvider`'s own stall throws, so `performCall` sees what it would see
 * from an adapter.
 */
function held(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((settle, fail) => {
    const timer = setTimeout(settle, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        fail(new ProviderError('transient', 'The request was aborted.'));
      },
      { once: true },
    );
  });
}

/**
 * The fake, plus the signal of every call it was handed.
 *
 * *A subclass rather than a field on `FakeProvider`*, because golden files
 * snapshot `requests` and a signal has no business in one. `holds` picks the
 * calls that stall until aborted; everything else answers at once, so a turn
 * taken to set up a test is not held by the call the test is about.
 */
class Watched extends FakeProvider {
  readonly signals: AbortSignal[] = [];
  readonly #holds: (request: GenerationRequest) => boolean;

  constructor(options: FakeProviderOptions & { holds: (request: GenerationRequest) => boolean }) {
    super(options);
    this.#holds = options.holds;
  }

  override async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (request.signal !== undefined && this.#holds(request)) {
      this.signals.push(request.signal);
      await held(request.signal, 10_000);
    }
    return await super.generate(request);
  }
}

interface OnTheWire {
  /** What a tab closing looks like, on a socket rather than through `inject`. */
  leave: () => void;
  /** Status and body, or `null` for a request that was left before it answered. */
  answered: Promise<{ status: number; body: string } | null>;
}

/**
 * One POST over loopback, on its own connection (`agent: false`), so that a
 * connection kept alive by the default agent cannot outlive the test and hold
 * `close` open.
 */
function send(
  port: number,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {},
): OnTheWire {
  let leave = (): void => undefined;
  const answered = new Promise<{ status: number; body: string } | null>((settle) => {
    const outgoing = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path,
        agent: false,
        headers: { 'content-type': 'application/json', ...headers },
      },
      (incoming) => {
        let body = '';
        incoming.setEncoding('utf8');
        incoming.on('data', (chunk: string) => {
          body += chunk;
        });
        incoming.on('end', () => {
          settle({ status: incoming.statusCode ?? 0, body });
        });
      },
    );
    outgoing.on('error', () => {
      settle(null);
    });
    outgoing.end(JSON.stringify(payload));
    leave = () => {
      outgoing.destroy();
      settle(null);
    };
  });
  return {
    leave: () => {
      leave();
    },
    answered,
  };
}

async function listen(app: FastifyInstance): Promise<number> {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  return (app.server.address() as AddressInfo).port;
}

/** The cookie and CSRF headers `server.request` would have sent. */
function asTheBrowser(on: TestServer): Record<string, string> {
  const headers: Record<string, string> = {
    cookie: [...on.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
  };
  const csrf = on.cookies.get('se_csrf');
  if (csrf !== undefined) headers['x-csrf-token'] = csrf;
  return headers;
}

/**
 * Error-level lines, which is where a cancellation that escaped the route would
 * land: `setErrorHandler` logs anything unhandled as *Unhandled error*.
 */
function errorLines(): Record<string, unknown>[] {
  return logLines
    .join('')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => typeof line['level'] === 'number' && line['level'] >= 50);
}

function capture(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      logLines.push(chunk.toString());
      done();
    },
  });
}

/**
 * Past every microtask the abort set off. The route's catch, or the error
 * handler if the catch were missing, runs in the promise chain behind the
 * provider's rejection, and all of it has settled before the next turn of the
 * event loop.
 */
function settled(): Promise<void> {
  return new Promise((done) => {
    setImmediate(done);
  });
}

describe('disconnectSignal, on a bare server', () => {
  /**
   * The route shape both callers have: the signal is taken **after** an
   * `await`, which is what defeated `request.raw.on('close')`. `gate` lets a test
   * leave before the signal exists; `replies` lets it see the server notice.
   */
  let gate: Promise<void>;
  let open: () => void;
  const seen: AbortSignal[] = [];
  const replies: FastifyReply[] = [];

  async function standUp(holdMs: number): Promise<number> {
    seen.length = 0;
    replies.length = 0;
    gate = new Promise((resolve) => {
      open = resolve;
    });
    bare = Fastify({ logger: false });
    bare.post('/work', async (_request, reply) => {
      replies.push(reply);
      await gate;
      const signal = disconnectSignal(reply);
      seen.push(signal);
      await held(signal, holdMs);
      return { ok: true };
    });
    return await listen(bare);
  }

  /**
   * ***The negative is the half that matters.*** Every response closes when it
   * is done, and a signal that read that as the client leaving would cancel
   * work that finished. `request.raw` listened to synchronously at handler
   * entry does exactly that on a POST: it closes as soon as its body is read.
   */
  it('stays quiet for a client that waits for its answer', async () => {
    const port = await standUp(50);
    open();

    const answer = await send(port, '/work', {}).answered;
    await settled();

    expect(answer?.status).toBe(200);
    expect(seen[0]?.aborted).toBe(false);
  });

  it('aborts when the client leaves mid-work', async () => {
    const port = await standUp(10_000);
    open();
    const call = send(port, '/work', {});
    await eventually(() => Promise.resolve(seen.length === 1), { timeoutMs: 3_000 });

    call.leave();

    await eventually(() => Promise.resolve(seen[0]?.aborted === true), { timeoutMs: 3_000 });
  });

  /**
   * ***A client that left during an earlier `await`***, before this was
   * called. Its `close` has already been emitted, and a listener attached now
   * would wait forever. This is the case the `destroyed` check is for.
   */
  it('is already aborted when the client left before it was asked', async () => {
    const port = await standUp(10_000);
    const call = send(port, '/work', {});
    await eventually(() => Promise.resolve(replies.length === 1), { timeoutMs: 3_000 });

    call.leave();
    await eventually(() => Promise.resolve(replies[0]?.raw.destroyed === true), {
      timeoutMs: 3_000,
    });
    open();

    await eventually(() => Promise.resolve(seen.length === 1), { timeoutMs: 3_000 });
    expect(seen[0]?.aborted).toBe(true);
  });
});

const CHAT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a21';
const IMAGE = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a22';

async function standUpServer(provider: Watched): Promise<TestServer> {
  const made = await makeTestServer({
    providers: () => provider,
    logStream: capture(),
    config: { log: { level: 'info', format: 'json' } },
  });
  server = made;
  await setUpAdmin(made, 'ned');
  return made;
}

async function writeConnections(on: TestServer, withImage: boolean): Promise<void> {
  const connections = new Layout(on.dataDir).userConnectionsRoot('ned');
  await mkdir(connections, { recursive: true });
  await writeFile(
    join(connections, 'chat.json'),
    JSON.stringify({
      id: CHAT,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
      capabilities: { maxContextTokens: 32_000 },
    }),
  );
  if (withImage) {
    await writeFile(
      join(connections, 'image.json'),
      JSON.stringify({
        id: IMAGE,
        label: 'The picture double',
        provider: 'openai-compatible',
        models: ['fake-image'],
        capabilities: { rendersImages: true },
      }),
    );
  }
  await writeFile(
    join(on.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({
      prose: { connectionId: CHAT, modelId: 'fake-hi' },
      fast: { connectionId: CHAT, modelId: 'fake-hi' },
      ...(withImage ? { image: { connectionId: IMAGE, modelId: 'fake-image' } } : {}),
    }),
  );
}

describe('a draft nobody is waiting for', () => {
  async function aDraftingSession(provider: Watched): Promise<{ on: TestServer; path: string }> {
    const on = await standUpServer(provider);
    await writeConnections(on, false);
    const vera = newActor('Vera');
    await on.request({ method: 'POST', url: '/api/library/actors', payload: vera });
    const created = await on.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain City', cast: { persona: vera.id, actors: [vera.id] } },
    });
    return { on, path: `/api/sessions/${created.body.session.id as string}/impersonate` };
  }

  /**
   * The route end to end over a socket, cookie and CSRF included, so that the
   * cancellation below is known to be the client leaving rather than the
   * request never having been accepted.
   */
  it('is drafted for a client that waits', async () => {
    const provider = new Watched({
      script: [{ text: 'I would not go in there.' }],
      holds: () => false,
    });
    const { on, path } = await aDraftingSession(provider);

    const answer = await send(await listen(on.app), path, {}, asTheBrowser(on)).answered;

    expect(answer?.status).toBe(200);
    expect(JSON.parse(answer?.body ?? '{}')).toEqual({ text: 'I would not go in there.' });
  });

  /**
   * ***The falsifying mutation is taking the signal from anywhere but the
   * response*** — `request.raw.on('close')`, `request.signal`, or the signal
   * that never aborts this route had before. Each leaves the call running
   * after the client has gone, and the `eventually` below times out.
   *
   * *No error line* is the other half: the route swallows the cancellation it
   * caused, because an *Unhandled error* for every tab that closed would be a
   * false alarm in exactly the log a person reads when something is wrong.
   */
  it('is cancelled when the client leaves, and says nothing about it', async () => {
    const provider = new Watched({
      script: [{ text: 'I would not go in there.' }],
      holds: () => true,
    });
    const { on, path } = await aDraftingSession(provider);

    const call = send(await listen(on.app), path, {}, asTheBrowser(on));
    await eventually(() => Promise.resolve(provider.signals.length === 1), { timeoutMs: 3_000 });
    call.leave();

    await eventually(() => Promise.resolve(provider.signals[0]?.aborted === true), {
      timeoutMs: 3_000,
    });
    await settled();
    expect(errorLines()).toEqual([]);
  });
});

describe('a picture nobody is waiting for', () => {
  const MOMENT = JSON.stringify({ subject: 'a lantern on a wet quay', anchor: null });

  /**
   * ***No rendition is the assertion that costs something.*** The moment call is
   * the first half of Illustrate, and the pending record is written only after
   * it answers, so a cancelled moment leaves nothing behind: no record, no
   * image job, no picture for a page nobody has open.
   */
  it('stops at the moment call when the client leaves, and records nothing', async () => {
    const provider = new Watched({
      script: [{ text: MOMENT, object: JSON.parse(MOMENT) as unknown }],
      images: [{}],
      capabilities: { rendersImages: true, supportsStructuredOutput: true },
      holds: (request) => JSON.stringify(request.messages).includes('choosing one image'),
    });
    const on = await standUpServer(provider);
    await writeConnections(on, true);

    const created = await on.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'The harbour' },
    });
    const sessionId = created.body.session.id as string;
    const submitted = await on.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k-0', headTurnId: null, input: { text: 'Look around.' } },
    });
    expect(submitted.status).toBe(202);
    const headOf = async (): Promise<string | null> => {
      const read = await on.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      return (read.body as { session: { headTurnId: string | null } }).session.headTurnId;
    };
    await eventually(async () => (await headOf()) !== null);
    const turnId = await headOf();

    const call = send(
      await listen(on.app),
      `/api/sessions/${sessionId}/turns/${turnId ?? ''}/illustrate`,
      { purpose: 'illustration' },
      asTheBrowser(on),
    );
    await eventually(() => Promise.resolve(provider.signals.length === 1), { timeoutMs: 3_000 });
    call.leave();

    await eventually(() => Promise.resolve(provider.signals[0]?.aborted === true), {
      timeoutMs: 3_000,
    });
    await settled();
    expect(errorLines()).toEqual([]);
    const renditions = await readRenditions(on.services.sessions.layout, 'ned', sessionId);
    expect(renditions.size).toBe(0);
  });
});
