// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../config.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The client, served by the server — [P6A.1],
 * [P6A §1.3](../../../../docs/design/workplan/19-p6a-alpha-1.md).
 *
 * **The claim is one process on one port serving both halves**, which is what
 * turns an image from an API and a 404 into something a person can open. Three
 * things have to be true together and each is a separate way to get it wrong:
 * the assets are served, a client-side route falls back to the app shell, and
 * **`/api` never does** — an address under the prefix that matches no route has
 * to answer JSON, because [docs/api.md](../../../../docs/api.md) is a contract
 * with clients that parse it and HTML arriving there is a worse failure than the
 * 404 it already argues for.
 *
 * The fourth is absence: with the key unset nothing is served at all, because
 * development is two processes with Vite proxying `/api` and must stay that way.
 *
 * A fixture directory rather than a real `vite build`: what is under test is the
 * routing, and a suite that depended on the client having been built would fail
 * for a reason that has nothing to do with the server.
 */

const SHELL = '<!doctype html><title>StoryEngine</title><div id="root"></div>';
const SCRIPT = 'export const built = true;\n';

let dataDir: string;
let clientRoot: string;
let server: TestServer;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-client-'));
  clientRoot = join(dataDir, 'client');
  await mkdir(join(clientRoot, 'assets'), { recursive: true });
  await writeFile(join(clientRoot, 'index.html'), SHELL);
  await writeFile(join(clientRoot, 'assets', 'index-abc123.js'), SCRIPT);
});

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/** A server with the client wired up, unless a root is given as empty. */
async function serving(root: string = clientRoot): Promise<TestServer> {
  server = await makeTestServer({
    config: { server: { ...DEFAULT_CONFIG.server, clientRoot: root } },
  });
  return server;
}

describe('with a client root configured', () => {
  it('serves the shell at the root address', async () => {
    const app = await serving();

    const response = await app.request({ method: 'GET', url: '/' });

    expect(response.status).toBe(200);
    expect(String(response.headers['content-type'])).toContain('text/html');
  });

  it('serves an asset by its own path', async () => {
    const app = await serving();

    const response = await app.request({ method: 'GET', url: '/assets/index-abc123.js' });

    expect(response.status).toBe(200);
    // The bytes, not a shell wearing the address — a fallback that answered
    // every path with `index.html` would pass a status-only assertion here and
    // hand the browser HTML to execute as a module.
    expect(response.body).toBe(SCRIPT);
  });

  it('answers a client-side route with the shell', async () => {
    const app = await serving();

    // The address a bookmark holds. No route on the server matches it, and the
    // router in the browser is what resolves it once the shell has loaded.
    const response = await app.request({ method: 'GET', url: '/library/actors/01a0/edit' });

    expect(response.status).toBe(200);
    expect(response.body).toBe(SHELL);
  });

  /**
   * **The trap [P6A §0.3] names, and the reason `isApi` was already there.**
   *
   * The falsifying mutation is dropping the `isApi` branch from the not-found
   * handler: every assertion above stays green, and every client in the world
   * starts receiving a 200 of HTML where it asked for JSON.
   *
   * An admin first, because the setup gate answers `503 setup-required` for
   * every API address before one exists — which is the right answer and not the
   * one under test here.
   */
  it('answers an unrouted API address with JSON, never the shell', async () => {
    const app = await serving();
    await setUpAdmin(app, 'ned', 'correct horse battery');

    const response = await app.request({ method: 'GET', url: '/api/nonsense' });

    expect(response.status).toBe(404);
    expect(String(response.headers['content-type'])).toContain('application/json');
    expect(response.body).toEqual({ error: 'not-found', message: 'No such route.' });
  });

  /**
   * **The shell loads before there is an account**, which is how setup is
   * reached at all. The setup gate refuses every API address until an admin
   * exists ([09 §5.1]), and it is guarded on `isApi` — so the UI that has to
   * ask for the admin is outside it. That guard predates this stage; what is
   * new is that there is now something on the other side of it to serve.
   */
  it('serves the shell before setup, which is how setup is reached', async () => {
    const app = await serving();

    const shell = await app.request({ method: 'GET', url: '/' });
    expect(shell.status).toBe(200);

    // And the two addresses a client needs before it has an account still work.
    const state = await app.request({ method: 'GET', url: '/api/auth/state' });
    expect(state.body).toHaveProperty('setupRequired', true);
  });

  /**
   * **The `isApi` branch in the fallback is necessary and not sufficient**, and
   * this is the test that says so. A fallback only sees requests that matched
   * no route — and a file at `<clientRoot>/api/nonsense` *is* a route once the
   * static plugin is looking at that directory. Measured before the guard
   * existed: this request answered `200` with the file's bytes.
   *
   * Not a hypothesis about the client this project ships, whose build is
   * `index.html` and `assets/`. `clientRoot` is a path an operator sets, and
   * what it happens to contain must not decide what `/api` means.
   */
  it('does not let the client root shadow the API namespace', async () => {
    await mkdir(join(clientRoot, 'api'), { recursive: true });
    await writeFile(join(clientRoot, 'api', 'nonsense'), 'SHADOW');

    const app = await serving();
    await setUpAdmin(app, 'ned', 'correct horse battery');

    const response = await app.request({ method: 'GET', url: '/api/nonsense' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'not-found', message: 'No such route.' });
  });

  /**
   * **Measured rather than assumed**, and the measurement changed the code:
   * `@fastify/static` with a root that is not there does **not** throw. It
   * finds nothing, serves nothing, and the server comes up answering the API
   * and showing a blank page — so the check in `buildApp` is what turns that
   * into a refusal somebody can read.
   *
   * `index.html` rather than the directory, because a directory that exists and
   * holds no build is the same failure with a better disguise.
   */
  it('refuses to start on a client root with no build in it', async () => {
    await expect(serving(join(dataDir, 'not-built'))).rejects.toThrow(/index\.html/);

    // An empty directory is refused too, which the directory-exists check that
    // suggests itself first would have let through.
    const empty = join(dataDir, 'empty');
    await mkdir(empty, { recursive: true });
    await expect(serving(empty)).rejects.toThrow(/index\.html/);

    // Neither call assigned `server`, and `afterEach` disposes whatever it
    // holds — which is the previous test's, already disposed.
    server = { dispose: () => Promise.resolve() } as unknown as TestServer;
  });
});

/**
 * **The default, not an override**, which is the difference between testing the
 * decision and testing an argument. `makeTestServer` with no `config` at all
 * takes `DEFAULT_CONFIG`, so what these two assert is that *unset means serve
 * nothing* — the falsifying mutation being a default that points at a build
 * directory, which would make development differ by whether somebody had run
 * `pnpm build` and would quietly end the two-process arrangement [P6A §1.3]
 * insists on.
 */
describe('with no client root, which is development', () => {
  it('serves nothing at all', async () => {
    server = await makeTestServer();

    const response = await server.request({ method: 'GET', url: '/' });

    expect(response.status).toBe(404);
    // And in the shape the API uses, so the two arrangements answer alike.
    expect(response.body).toEqual({ error: 'not-found', message: 'No such route.' });
  });

  it('still answers the API', async () => {
    server = await makeTestServer();

    // The half that must keep working while Vite serves the other one.
    const response = await server.request({ method: 'GET', url: '/api/auth/state' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('setupRequired');
  });
});
