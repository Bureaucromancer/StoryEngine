// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { type AppServices, buildApp, buildServices, disposeServices } from './app.js';
import { type Config, DEFAULT_CONFIG } from './config.js';
import type { ProviderFactory } from './providers/factory.js';

/**
 * An app on a real temporary data directory, driven through `inject`.
 *
 * `fastify.inject` rather than a listening socket: the routing, hooks, cookies
 * and serialisation are all exercised, and nothing binds a port — which matters
 * because the suite runs several of these at once and because binding is the one
 * thing a test should not be doing on somebody's machine.
 *
 * The filesystem underneath is real. [testing §8](../../../docs/design/workplan/10-testing.md) is
 * blunt: *do not mock the filesystem* — the storage layer is the thing under
 * test.
 */

export interface TestServer {
  app: FastifyInstance;
  services: AppServices;
  dataDir: string;
  /** Cookies the client is holding, in the form a `cookie` header wants. */
  cookies: Map<string, string>;
  request: (options: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
    /** Omit the CSRF header, to prove the check is real. */
    skipCsrf?: boolean;
  }) => Promise<{ status: number; body: any; headers: Record<string, unknown> }>;
  /**
   * Opens an SSE stream — a **sibling** of `request`, not a flag on it.
   *
   * Plain `inject` never resolves for a response that does not end, and under
   * `payloadAsStream` the response has no `body` and `json()` throws — which
   * is exactly what `request` depends on. One helper that does the other thing
   * is clearer than one that does both badly.
   */
  stream: (options: { url: string; headers?: Record<string, string> }) => Promise<StreamHandle>;
  dispose: () => Promise<void>;
}

export interface SseFrame {
  event: string;
  id?: string;
  data: unknown;
}

export interface StreamHandle {
  status: number;
  headers: Record<string, unknown>;
  /** Every frame parsed so far. */
  frames: () => SseFrame[];
  /**
   * Waits for a frame, and **is the only synchronisation primitive** — there
   * are no sleeps in the stream tests. On timeout it reports what it did see, so
   * a failure reads as *"waited for turn.finished, got [turn.started]"* rather
   * than as an unexplained hang.
   */
  until: (predicate: (frame: SseFrame) => boolean, ms?: number) => Promise<SseFrame>;
  /** What a tab closing looks like. */
  abort: () => Promise<void>;
}

/**
 * Everything a test can vary about the server it is given.
 *
 * One options object rather than four patches. Five separate P2.0 items each
 * need this helper to take a different thing — the watcher on, an existing data
 * directory to restart against, a clock, a level, a config override — and
 * discovering that one at a time turns the file every route suite imports into
 * a pile of special cases. Every field is optional and the defaults are the
 * behaviour this helper had before it took options at all.
 */
export interface TestServerOptions {
  /**
   * Reuse a directory instead of making one — which is how a test restarts a
   * server against the data it already wrote (exit-gate step 11). A reused
   * directory is not removed on dispose; whoever made it owns it.
   */
  dataDir?: string;
  /**
   * Run the filesystem watcher. Off by default: the watcher has its own suite,
   * and route tests that do not need foreign writes should not be subject to
   * filesystem event timing.
   */
  watch?: boolean;
  /** Anything else about the config — a level to hear, a retention to test. */
  config?: Partial<Config>;
  /** Substitute the provider factory — how `FakeProvider` becomes the E2E backend. */
  providers?: ProviderFactory;
  /** Capture the log, so a test can assert on what a turn actually narrated about itself. */
  logStream?: NodeJS.WritableStream;
}

export async function makeTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const borrowed = options.dataDir !== undefined;
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'se-app-')));
  const services = await buildServices({
    config: {
      ...DEFAULT_CONFIG,
      // `silent`, because several of these run at once and a suite that prints
      // a request log per assertion buries its own failures. This is the
      // level's reason for existing ([13 §4]).
      ...{ log: { ...DEFAULT_CONFIG.log, level: 'silent' as const } },
      ...options.config,
      dataDir,
    },
    watch: options.watch ?? false,
    ...(options.providers === undefined ? {} : { providers: options.providers }),
  });
  const app = await buildApp(
    services,
    options.logStream === undefined ? {} : { logStream: options.logStream },
  );
  await app.ready();

  const cookies = new Map<string, string>();

  async function request(options: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
    skipCsrf?: boolean;
  }): Promise<{ status: number; body: any; headers: Record<string, unknown> }> {
    const headers: Record<string, string> = { ...options.headers };

    if (cookies.size > 0) {
      headers['cookie'] = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    const csrf = cookies.get('se_csrf');
    if (csrf && !options.skipCsrf && !headers['x-csrf-token']) {
      headers['x-csrf-token'] = csrf;
    }

    const response = await app.inject({
      method: options.method,
      url: options.url,
      headers,
      ...(options.payload === undefined ? {} : { payload: options.payload as object }),
    });

    // Track Set-Cookie the way a browser would, so a login in one call is a
    // session in the next.
    for (const raw of response.cookies) {
      if (raw.value === '') cookies.delete(raw.name);
      else cookies.set(raw.name, raw.value);
    }

    let body: unknown = null;
    if (response.body.length > 0) {
      try {
        body = response.json();
      } catch {
        body = response.body;
      }
    }

    return { status: response.statusCode, body, headers: response.headers };
  }

  async function stream(options: {
    url: string;
    headers?: Record<string, string>;
  }): Promise<StreamHandle> {
    const headers: Record<string, string> = { ...options.headers };
    if (cookies.size > 0) {
      headers['cookie'] = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }

    const controller = new AbortController();
    const response = await app.inject({
      method: 'GET',
      url: options.url,
      headers,
      // Resolves inside `writeHead` rather than at the end of the body, which
      // is the only way to see a response that never ends.
      payloadAsStream: true,
      signal: controller.signal,
    });

    const frames: SseFrame[] = [];
    const waiters: {
      predicate: (frame: SseFrame) => boolean;
      resolve: (frame: SseFrame) => void;
    }[] = [];
    let buffer = '';

    const offer = (frame: SseFrame): void => {
      frames.push(frame);
      for (const [index, waiter] of [...waiters.entries()].reverse()) {
        if (waiter.predicate(frame)) {
          waiters.splice(index, 1);
          waiter.resolve(frame);
        }
      }
    };

    if (response.headers['content-type'] === 'text/event-stream') {
      response.stream().on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let at = buffer.indexOf('\n\n');
        while (at !== -1) {
          const raw = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const frame = parseFrame(raw);
          if (frame) offer(frame);
          at = buffer.indexOf('\n\n');
        }
      });
    }

    return {
      status: response.statusCode,
      headers: response.headers,
      frames: () => [...frames],
      until: async (predicate, ms = 2000) => {
        const found = frames.find(predicate);
        if (found) return found;
        return new Promise<SseFrame>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(
              new Error(
                `no frame matched within ${String(ms)}ms. Saw: ${JSON.stringify(
                  frames.map((frame) => frame.event),
                )}`,
              ),
            );
          }, ms);
          waiters.push({
            predicate,
            resolve: (frame) => {
              clearTimeout(timer);
              resolve(frame);
            },
          });
        });
      },
      abort: async () => {
        controller.abort();
        // The handler's `close` fires a tick later, so a caller that asserts on
        // the subscriber count immediately would read it before the detach ran.
        // Measured: not after a microtask, but after `nextTick`.
        await new Promise((tick) => {
          process.nextTick(tick);
        });
      },
    };
  }

  return {
    app,
    services,
    dataDir,
    cookies,
    request,
    stream,
    dispose: async () => {
      await app.close();
      await disposeServices(services);
      if (!borrowed) await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** `event:`, `id:` and `data:` out of one SSE frame. Comments yield nothing. */
function parseFrame(raw: string): SseFrame | null {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event: ')) event = line.slice(7);
    else if (line.startsWith('id: ')) id = line.slice(4);
    else if (line.startsWith('data: ')) data.push(line.slice(6));
  }
  if (data.length === 0 && event === 'message') return null;

  const text = data.join('\n');
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A frame whose data is not JSON is still a frame worth reporting.
  }
  return { event, ...(id === undefined ? {} : { id }), data: parsed };
}

/** Runs first-run setup and leaves the client signed in as that admin. */
export async function setUpAdmin(
  server: TestServer,
  handle = 'ned',
  password = 'correct horse battery',
): Promise<void> {
  const response = await server.request({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { handle, password },
  });
  if (response.status !== 201) {
    throw new Error(`setup failed: ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
}
