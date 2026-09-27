// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { type AppServices, buildApp, buildServices, disposeServices } from './app.js';
import type { BuildInfo } from './build-info.js';
import { type Config, DEFAULT_CONFIG, loadConfig } from './config.js';
import type { WatchEvent } from './index-db/watcher.js';
import type { ProviderFactory } from './providers/factory.js';
import { MACHINE, type StartableSeams } from './startable.js';
import { Layout } from './storage/layout.js';

/**
 * An app on a real temporary data directory, driven through `inject`.
 *
 * `fastify.inject` rather than a listening socket: the routing, hooks, cookies
 * and serialisation are all exercised, and nothing binds a port — which matters
 * because the suite runs several of these at once and because binding is the one
 * thing a test should not be doing on somebody's machine.
 *
 * The filesystem underneath is real. [testing §8](../../../docs/design/workplan/03-testing.md) is
 * blunt: *do not mock the filesystem* — the storage layer is the thing under
 * test.
 */

/**
 * A temporary directory whose path is the one the filesystem actually uses.
 *
 * **This is F26, at its source rather than at one of its symptoms.** `mkdtemp`
 * returns `tmpdir()` with a suffix, and `tmpdir()` is whatever `TMP` says. On
 * the GitHub Windows runner `TMP` holds the **8.3 alias** —
 * `C:\Users\RUNNER~1\AppData\Local\Temp` — while every path the server
 * resolves comes back long, as `C:\Users\runneradmin\...`. A test that
 * compares one against the other passes on a developer machine and fails on the
 * runner, which is the shape of bug that is only ever seen in CI.
 *
 * `TestServer.dataDir` already answers this for a server built here. **Use this
 * for any other directory a test hands to the server or compares a
 * server-derived path against** — a fixture root posted to `/api/import`, a
 * `--data` flag, an `SE_DATA_DIR`. A directory a test only reads and writes
 * itself does not need it, because both sides are then the same string.
 */
export async function tempRoot(prefix: string): Promise<string> {
  return await realpath(await mkdtemp(join(tmpdir(), prefix)));
}

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
  /** Pretend to be a released build, for the data-directory stamp ([P6A §1.7]). */
  build?: BuildInfo | null;
  /** Substitute the provider factory — how `FakeProvider` becomes the E2E backend. */
  providers?: ProviderFactory;
  /** Capture the log, so a test can assert on what a turn actually narrated about itself. */
  logStream?: NodeJS.WritableStream;
  /** Substitute the outbound fetch — the model-fetch action ([P2B §2.6]). */
  fetch?: typeof globalThis.fetch;
  /** The environment layer a boot would have put under the file (`SE_*`). */
  environment?: Record<string, unknown>;
  /**
   * The machine a settings write is checked against (`startable.ts`).
   *
   * **The trial listen is a no-op unless a test supplies one**, because a real
   * one binds a real port: suites that move `server.port` to 9999 would take it
   * for a moment on the machine running them, and two such files at once would
   * refuse each other. The address checks stay real; they bind nothing.
   */
  startable?: Partial<StartableSeams>;
}

/**
 * The config file, or null if there is not a readable one.
 *
 * Its own function so the `catch` has somewhere to return from: several tests
 * write deliberate nonsense to `config.json` and want a server anyway, and a
 * `let` reassigned in a catch reads as though the initial value mattered.
 */
async function readConfigFile(
  path: string,
): Promise<{ config: Config; document: Record<string, unknown> } | null> {
  try {
    const result = await loadConfig(path);
    return { config: result.config, document: result.document };
  } catch {
    return null;
  }
}

export async function makeTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const borrowed = options.dataDir !== undefined;
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'se-app-')));

  /**
   * **The config file is read, the way `main.ts` reads it.**
   *
   * Without this a server on a borrowed `dataDir` was not a restart: it began
   * from the defaults and never saw what the previous one wrote, so a test
   * asserting *this file is one the process can start on* asserted nothing —
   * and did, until [P2A §3](../../../docs/design/workplan/09-p2a-configuration-surface.md)
   * stage P2A.5 needed exactly that claim.
   *
   * An unreadable file is left to the caller's overrides rather than thrown,
   * because several tests write deliberate nonsense there and want a server
   * anyway.
   */
  const layout = new Layout(dataDir);
  const loaded = await readConfigFile(layout.configFile);

  const services = await buildServices({
    config: {
      ...(loaded?.config ?? DEFAULT_CONFIG),
      // `silent`, because several of these run at once and a suite that prints
      // a request log per assertion buries its own failures. This is the
      // level's reason for existing ([21 §4]).
      ...{ log: { ...DEFAULT_CONFIG.log, level: 'silent' as const } },
      ...options.config,
      dataDir,
    },
    configPath: layout.configFile,
    configDocument: loaded?.document ?? {},
    environment: options.environment ?? {},
    startable: { ...MACHINE, trialListen: () => Promise.resolve(), ...options.startable },
    watch: options.watch ?? false,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.providers === undefined ? {} : { providers: options.providers }),
    /**
     * **Defaulted to *no identity*, not to whatever is on disk** — [P6A §1.5].
     *
     * A developer who has run `pnpm build:identify` has an identity file in
     * their working copy, and without this line the suite would behave one way
     * on their machine and another in CI — stamping every temporary data
     * directory in one and not the other. The tests that care pass one
     * explicitly.
     */
    build: options.build ?? null,
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
    /**
     * **The layout's root, not the string `mkdtemp` returned** — F26. `Layout`
     * resolves its root to the path the filesystem actually uses, so on a
     * machine whose temp directory is an 8.3 alias or a link the two differ.
     * A test comparing a server-derived absolute path against this one would
     * fail on the runner and pass here, which is the shape of bug that reaches
     * CI and nowhere else.
     */
    dataDir: layout.dataRoot,
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

/**
 * Every route under a prefix, from Fastify's own routing tree.
 *
 * **Enumerated, never listed.** A hand-maintained array of admin routes is wrong
 * the first time somebody adds one in a hurry, and it is wrong silently — which
 * is the whole claim [P2A §2.4](../../../docs/design/workplan/09-p2a-configuration-surface.md)
 * makes about the guard being a property of the prefix.
 *
 * Shared rather than copied, because `printRoutes` emits a **tree** whose
 * children carry only the segment they add:
 *
 * ```
 * ├── /api/admin/connections (GET, HEAD, POST)
 * │   └── /:id (PUT, DELETE)
 * │       └── /bindings (GET, HEAD)
 * ```
 *
 * A regex per line finds three routes and misses two, which is what the first
 * version of this did — reporting that everything was guarded while never
 * testing `DELETE /connections/:id`. Depth comes from the indent, four columns a
 * level, and the full path is the stack above it. A second copy of that parser
 * is a second chance to get the tree wrong, which is why
 * [P2B §6.1](../../../docs/design/workplan/10-p2b-provider-configuration.md) asked for this to
 * move here before the opacity test needed it too.
 *
 * `HEAD` is dropped: Fastify generates one per `GET` and `inject` has nothing
 * extra to say about it.
 */
export function routesUnder(app: FastifyInstance, prefix: string): RouteEntry[] {
  const stack: string[] = [];
  const found: RouteEntry[] = [];

  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^([\s│]*)(?:├──|└──)\s(\S+)\s+\(([^)]+)\)\s*$/.exec(line);
    if (!match) continue;
    const [, indent = '', segment = '', methods = ''] = match;

    const depth = Math.floor(indent.length / 4);
    stack.length = depth;
    stack.push(segment);

    const url = stack.join('');
    if (!url.startsWith(prefix)) continue;
    for (const method of methods.split(',')) {
      const trimmed = method.trim();
      if (trimmed !== 'HEAD') found.push({ method: trimmed as RouteEntry['method'], url });
    }
  }
  return found;
}

export interface RouteEntry {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
}

/** One row of a library listing, as far as anything here needs to know. */
export interface ListedObject {
  id: string;
  source?: string;
  [key: string]: unknown;
}

/**
 * The objects an account **owns**, with the system's filtered out — [P7B.0].
 *
 * ***Why this exists, and it is worth reading once rather than discovering
 * twenty-three times.*** `GET /api/library` and `GET /api/library/:kind` return
 * the user's scope merged with the system's, and that is the design
 * ([10 §5](../../../docs/design/10-ui-surfaces.md): *"The user's library and the
 * system library render as one list, with a source badge and a filter, not as
 * two panels"*). Until P7B.0 the system scope was **empty on every install**, so
 * a test that meant *did the user gain an object* could count the whole list and
 * be right by accident.
 *
 * P7B.0 puts each loaded mode's prompt pack there, and the accident ended: a
 * fresh account now lists two presets it did not create. Every assertion that
 * broke was measuring the user's library as *everything*, and every one of them
 * still means what it meant — so what changed is the measurement and not the
 * claim, and this is the measurement written once.
 *
 * **Filtered here rather than by asking the route for a filter**, because the
 * route's merge is the thing under test in more than one of those files: a
 * helper that quietly asked the server a narrower question would take the merge
 * out of the very assertions that are supposed to cross it.
 */
export async function ownObjects(
  server: TestServer,
  kind?: string,
): Promise<{ status: number; objects: ListedObject[] }> {
  const listed = await server.request({
    method: 'GET',
    url: kind === undefined ? '/api/library' : `/api/library/${kind}`,
  });
  const rows = (listed.body as { objects?: ListedObject[] }).objects ?? [];
  return { status: listed.status, objects: rows.filter((row) => row.source !== 'system') };
}

/**
 * Waits for the watcher to finish handling a foreign write to `path` — [P7.0].
 *
 * **Subscribe first, then write.** The subscription has to exist before the
 * write that triggers it, which is the whole shape of the helper: it returns a
 * promise that is already listening, so the caller writes and then awaits. Do
 * it the other way round and the event can land in the gap, which is the race
 * this exists to remove rather than one it introduces.
 *
 * **Why a signal and not a poll.** The watcher emits after the handler is done
 * — after the ingest and after any history snapshot — so a resolved promise
 * here means the consequences are readable, with no second wait and no guess
 * about how long one should be. A poll can only ask *has it happened yet* and,
 * when it runs out, cannot distinguish a watcher that was slow from a watcher
 * that never delivered: both arrive as the same timeout. This distinguishes
 * them, because it never reports success it did not see.
 *
 * The timeout is a **diagnostic**, not the mechanism: if it fires, the message
 * names the path and every event the watcher did emit, which is what turns
 * "condition never held" into something a reader can act on.
 */
export function watchedIndex(
  server: TestServer,
  path: string,
  timeoutMs = 8000,
): Promise<WatchEvent> {
  const watcher = server.services.watcher;
  if (!watcher) {
    throw new Error('watchedIndex needs a server built with { watch: true }.');
  }

  const seen: WatchEvent[] = [];
  return new Promise<WatchEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(
        new Error(
          `The watcher never indexed ${path} within ${String(timeoutMs)}ms. ` +
            `It emitted: ${seen.length === 0 ? '(nothing)' : seen.map(describe).join(', ')}`,
        ),
      );
    }, timeoutMs);

    const stop = watcher.observe((event) => {
      seen.push(event);
      // A path this helper was not asked about is still worth keeping: a
      // `suppressed` for the very file we are waiting on is the interesting
      // failure, and it only reads as interesting beside the others.
      if (event.type !== 'indexed' || event.path !== path) return;
      clearTimeout(timer);
      stop();
      resolve(event);
    });
  });
}

function describe(event: WatchEvent): string {
  return `${event.type} ${event.path}`;
}

/**
 * Polls a condition that has no signal behind it — and says what it saw.
 *
 * **Use {@link watchedIndex} instead wherever the thing being waited for is a
 * watcher event.** This is for the cases with genuinely no in-process signal:
 * a turn that ends when the commit protocol says so, observed from outside
 * through the route a client would call.
 *
 * **`describe` is the reason this exists rather than four copies of it.** The
 * helper it replaces lived in four files, was identical in three, and failed
 * with `condition never held before the timeout` — a message that names neither
 * the condition nor what was true instead, in files that include two phase exit
 * gates. A poll that cannot say what it saw turns every timing failure into the
 * same shrug, which is how a flake in a gate test stays unexplained.
 */
export async function eventually(
  check: () => Promise<boolean>,
  options: { timeoutMs?: number; pollMs?: number; describe?: () => Promise<string> } = {},
): Promise<void> {
  const { timeoutMs = 8000, pollMs = 50, describe } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((tick) => setTimeout(tick, pollMs));
  }
  if (await check()) return;

  const seen = describe
    ? await describe().catch((error: unknown) => `could not be described: ${String(error)}`)
    : null;
  throw new Error(
    `The condition never held within ${String(timeoutMs)}ms` +
      (seen === null ? '.' : `. What was true instead: ${seen}`),
  );
}

/**
 * Waits until everything a turn set off has finished — the turn's own body,
 * and the pictures it dispatched.
 *
 * ***The head moving is not the end of a turn.*** The commit moves the head at
 * its third step, and the runner then records the turn's renditions,
 * dispatches them, and tells the person — in that order, deliberately: *"the
 * person is told, last of all"* ([09 §3.5], in `runner.ts`). A test that
 * returned when the head moved and then asserted on a notification, or on the
 * image provider's call log, was racing that tail. On the Windows runner,
 * where every atomic write is slower, it lost: `producers.test.ts` found no
 * completion notification, and the P9 selection gate counted one picture
 * where two had been paid for.
 *
 * **And a negative assertion needs it more than a positive one.** *No picture
 * was requested* checked the moment the head moved cannot fail, because the
 * request it is watching for comes later — which is what made three of P9's
 * gate rows pass whatever the code did.
 */
export async function settled(server: TestServer): Promise<void> {
  await server.services.runner.settle();
  await server.services.drainRenditions();
}
