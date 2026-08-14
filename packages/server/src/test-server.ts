// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { type AppServices, buildApp, buildServices } from './app.js';
import { DEFAULT_CONFIG } from './config.js';

/**
 * An app on a real temporary data directory, driven through `inject`.
 *
 * `fastify.inject` rather than a listening socket: the routing, hooks, cookies
 * and serialisation are all exercised, and nothing binds a port — which matters
 * because the suite runs several of these at once and because binding is the one
 * thing a test should not be doing on somebody's machine.
 *
 * The filesystem underneath is real. [16 §8](docs/design/16-testing.md) is
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
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
    /** Omit the CSRF header, to prove the check is real. */
    skipCsrf?: boolean;
  }) => Promise<{ status: number; body: any; headers: Record<string, unknown> }>;
  dispose: () => Promise<void>;
}

export async function makeTestServer(): Promise<TestServer> {
  const dataDir = await mkdtemp(join(tmpdir(), 'se-app-'));
  const services = await buildServices({
    config: { ...DEFAULT_CONFIG, dataDir },
    // The watcher has its own suite; leaving it off here keeps these tests
    // deterministic rather than subject to filesystem event timing.
    watch: false,
  });
  const app = await buildApp(services);
  await app.ready();

  const cookies = new Map<string, string>();

  async function request(options: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
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

  return {
    app,
    services,
    dataDir,
    cookies,
    request,
    dispose: async () => {
      await app.close();
      await services.watcher?.stop();
      services.index.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
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
