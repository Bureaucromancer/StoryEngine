// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, isLoopbackHost } from '../config.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, type TestServer } from '../test-server.js';

/**
 * The first-run setup token, and the cookie hardening that travels with it —
 * F10, [04 §5.1](../../../../docs/design/04-server-multiuser-deployment.md),
 * [P6A §1.4](../../../../docs/design/workplan/23-p6a-alpha-1.md),
 * [P10 §1.1](../../../../docs/design/workplan/21-p10-implementation.md).
 *
 * **The claim is the check, not the print.** P1 printed a freshly generated
 * token on every non-loopback boot and stored it nowhere, so nothing verified
 * it — and an operator who reads *setup token* in a console reasonably concludes
 * something is enforcing it. So the assertions that matter are that a wrong
 * token is refused and a right one is accepted, in that order; a test that only
 * checked the happy path would pass against exactly the thing P2.0 deleted.
 *
 * **The bind decides, and no test here opens a socket.** `server.host` is a
 * config value, so an exposed install is one line of config rather than a port —
 * which is why the whole existing suite, every test of it driving `inject`,
 * is untouched by a feature gated on being exposed.
 *
 * **Both halves or neither** ([04 §5.1]): the cookie tests at the foot are not
 * a separate subject. They rest on the same premise — the loopback default —
 * and shipping one without the other leaves the survivor resting on something
 * that no longer holds, which is worse than shipping neither because it looks
 * decided.
 */

const PASSWORD = 'correct horse battery';

let dataDir: string;
let server: TestServer;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-token-'));
});

afterEach(async () => {
  await server.dispose().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
});

/** A server bound where the caller says, on a data directory that survives it. */
async function boundTo(host: string, over: Record<string, unknown> = {}): Promise<TestServer> {
  server = await makeTestServer({
    dataDir,
    config: { server: { ...DEFAULT_CONFIG.server, host, ...over } },
  });
  return server;
}

/** The token this install wrote, read off disk the way an operator reads the log. */
async function tokenOnDisk(): Promise<string> {
  const bytes = await readFile(new Layout(dataDir).setupTokenFile, 'utf8');
  return bytes.trim();
}

async function setup(app: TestServer, body: Record<string, unknown>) {
  return await app.request({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { handle: 'ned', password: PASSWORD, ...body },
  });
}

describe('bound beyond loopback with no admin', () => {
  it('mints a token, stores it, and says one is needed', async () => {
    const app = await boundTo('0.0.0.0');

    const state = await app.request({ method: 'GET', url: '/api/auth/state' });

    expect(state.body).toHaveProperty('setupRequired', true);
    // Advertised, because a client cannot tell an exposed server from a
    // loopback one — it may be reaching either through a proxy.
    expect(state.body).toHaveProperty('setupTokenRequired', true);
    // And stored, which is the entire difference from what P1 did: a restart
    // must not invalidate a token somebody has copied out of a container log.
    expect((await tokenOnDisk()).length).toBeGreaterThan(20);
  });

  it('refuses setup with no token', async () => {
    const app = await boundTo('0.0.0.0');

    const refused = await setup(app, {});

    expect(refused.status).toBe(403);
    expect(refused.body).toHaveProperty('error', 'invalid-setup-token');
    // Refused means refused: no account exists afterwards, which is the claim
    // an assertion on the status code alone would not make.
    const state = await app.request({ method: 'GET', url: '/api/auth/state' });
    expect(state.body).toHaveProperty('setupRequired', true);
  });

  it('refuses setup with the wrong token, the same way', async () => {
    const app = await boundTo('0.0.0.0');

    const refused = await setup(app, { setupToken: 'not-the-token' });

    // One answer for absent and for wrong, like a bad handle and a bad password
    // at login: the caller cannot tell which, which costs nothing.
    expect(refused.status).toBe(403);
    expect(refused.body).toHaveProperty('error', 'invalid-setup-token');
  });

  it('accepts setup with the token from its own console', async () => {
    const app = await boundTo('0.0.0.0');

    const created = await setup(app, { setupToken: await tokenOnDisk() });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.account).toHaveProperty('handle', 'ned');
  });

  it('stops asking once there is an admin', async () => {
    const app = await boundTo('0.0.0.0');
    await setup(app, { setupToken: await tokenOnDisk() });

    const state = await app.request({ method: 'GET', url: '/api/auth/state' });

    // The token guards one thing and it has happened. Leaving the field on
    // screen forever would be a control that does nothing.
    expect(state.body).toHaveProperty('setupRequired', false);
    expect(state.body).toHaveProperty('setupTokenRequired', false);
  });

  /**
   * **A restart does not invalidate it**, which is the reason the token is
   * stored rather than generated per boot. The window in which it is used is
   * exactly the window in which a container might restart — somebody is reading
   * its log — and P1's per-boot token could not have survived that even if
   * anything had checked it.
   */
  it('keeps the same token across a restart', async () => {
    const first = await boundTo('0.0.0.0');
    const before = await tokenOnDisk();
    await first.dispose();

    const second = await boundTo('0.0.0.0');
    expect(await tokenOnDisk()).toBe(before);

    const created = await setup(second, { setupToken: before });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  });
});

describe('bound to loopback, which is every development install', () => {
  it('mints nothing and asks for nothing', async () => {
    const app = await boundTo('127.0.0.1');

    const state = await app.request({ method: 'GET', url: '/api/auth/state' });
    expect(state.body).toHaveProperty('setupTokenRequired', false);

    // Setup works with no token at all, which is what keeps every other test in
    // this suite — and every development install — exactly as it was.
    const created = await setup(app, {});
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await expect(tokenOnDisk()).rejects.toThrow();
  });
});

/**
 * The predicate both halves turn on, in one place — [04 §5.1].
 *
 * Two spellings of *is this exposed* would be a security bug rather than an
 * inconsistency, and the two the codebase had were `main.ts`'s
 * `host === '127.0.0.1' || host === 'localhost'` and nothing else. The cases
 * below are the ones that spelling got wrong.
 */
describe('what counts as loopback', () => {
  it('knows the whole of 127/8, and both spellings of ::1', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    // A second loopback address is still loopback; the old spelling said no,
    // which would have demanded a token from an install nobody can reach.
    expect(isLoopbackHost('127.0.0.2')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
  });

  it('knows the wildcard is not loopback, which is the case that matters', () => {
    // The direction that costs something: answering *loopback* for a wildcard
    // bind would leave an exposed install with no token at all.
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('::')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
    // Not a prefix match: this is a public address that starts with the digits.
    expect(isLoopbackHost('127.example.com')).toBe(false);
  });
});

/**
 * The twin deferral — cookie `secure`, deferred at [P2 §2.11] on the same
 * premise as the token and expiring at the same instant ([04 §5.1]).
 *
 * **Not derived from the bind, deliberately.** [04 §5.1] blesses plain HTTP on a
 * trusted LAN and refuses to ship self-signed certificates; a `Secure` cookie is
 * not sent back over HTTP, so a rule that turned it on for every non-loopback
 * bind would lock out the LAN install the design endorses — silently, because
 * the browser declines without telling anyone. So it is config, and it is the
 * operator saying TLS is in front.
 */
describe('cookie hardening', () => {
  async function cookiesFrom(over: Record<string, unknown>): Promise<string[]> {
    const app = await boundTo('127.0.0.1', over);
    const created = await setup(app, {});
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.headers['set-cookie'] as string[];
  }

  it('leaves the cookies as they were by default', async () => {
    const cookies = await cookiesFrom({});

    expect(cookies.length).toBeGreaterThan(1);
    expect(cookies.every((cookie) => !cookie.includes('Secure'))).toBe(true);
  });

  it('marks both cookies Secure when the operator says TLS is in front', async () => {
    const cookies = await cookiesFrom({ cookieSecure: true });

    // Both, not one: the CSRF cookie is script-readable and the session cookie
    // is not, and a half-hardened pair is the configuration nobody chose.
    expect(cookies.length).toBeGreaterThan(1);
    expect(cookies.every((cookie) => cookie.includes('Secure'))).toBe(true);
  });
});
