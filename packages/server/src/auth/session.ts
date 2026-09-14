// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHmac, timingSafeEqual } from 'node:crypto';

import { writeAtomic } from '../storage/atomic.js';
import { ensureDirectory, readFileBytes } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';
import { generateSecret, secretsMatch } from './secrets.js';

/**
 * Sessions — [20 §9](../../../../docs/design/20-tech-stack.md).
 *
 * **Signed, stateless cookies.** No session table, and that is a decision rather
 * than a shortcut: [22 §5.1](../../../../docs/design/22-internal-contracts.md) points out
 * that an earlier draft put session records in the index, which is defined as
 * deletable without consequence — and logging every user out *is* a consequence.
 * A signed cookie removes the table rather than relocating it.
 *
 * **What that costs, stated plainly.** Logout clears the cookie on the client;
 * a cookie already copied elsewhere stays valid until it expires. Under
 * [09 §4.1](../../../../docs/design/09-server-multiuser-deployment.md)'s threat model —
 * access separation among people who already trust each other — that is an
 * acceptable trade, and the honest upgrade when it stops being one is a
 * revocation denylist in the operational store, which is small and additive.
 * It is not a session table by another name.
 */

const COOKIE_NAME = 'se_session';
const CSRF_COOKIE_NAME = 'se_csrf';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Fourteen days. Long enough that a household tablet is not a login prompt
 * every morning; short enough that a stale cookie is not indefinite, which
 * matters more given there is no revocation.
 */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  handle: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/**
 * The signing key.
 *
 * **Not in `config.json`** — 13 §4 says config has nowhere to put a
 * credential, and this is one. **Not in the index** — the index is deletable
 * without consequence and losing this logs everyone out. So it lives beside the
 * operational store ([22 §5.1](../../../../docs/design/22-internal-contracts.md)), which is
 * exactly the category of thing whose loss would surprise a user.
 *
 * Generated on first use. Deleting it is survivable and its consequence is
 * honest: everyone is logged out, nothing else.
 */
export async function loadOrCreateSessionKey(layout: Layout): Promise<string> {
  const path = layout.sessionKeyFile;
  const existing = await readFileBytes(path);
  if (existing !== null) {
    const text = new TextDecoder().decode(existing).trim();
    if (text.length > 0) return text;
  }

  const secret = generateSecret();
  await ensureDirectory(layout.stateRoot);
  await writeAtomic(path, `${secret}\n`);
  return secret;
}

function sign(value: string, key: string): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

export function issueSession(payload: SessionPayload, key: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, key)}`;
}

/**
 * Verifies a cookie and returns its payload, or null.
 *
 * Every failure is null: a bad signature, a mangled body, an expired session.
 * The caller's response to all three is identical — treat the request as
 * anonymous — and distinguishing them would only create a way to probe.
 */
export function readSession(cookie: string | undefined, key: string): SessionPayload | null {
  if (!cookie) return null;

  const separator = cookie.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);

  const expected = Buffer.from(sign(body, key));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) return null;
  const { handle, expiresAt } = payload as Partial<SessionPayload>;
  if (typeof handle !== 'string' || typeof expiresAt !== 'number') return null;
  if (expiresAt <= Date.now()) return null;

  return { handle, expiresAt };
}

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

/**
 * Cookie flags, and why each one.
 *
 * `httpOnly` so a script cannot read the session. `sameSite: 'lax'` so a
 * cross-site form post does not carry it, which is most of CSRF handled before
 * the token below is consulted. `secure` only when actually on HTTPS: there is
 * **no HTTPS by default** on a LAN ([09 §5.1]), and a `secure` cookie over
 * plain HTTP is simply never sent — the login would appear to succeed and
 * nothing would be logged in.
 */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** The CSRF cookie is deliberately readable by script — the client echoes it back. */
export function csrfCookieOptions(secure: boolean): Omit<CookieOptions, 'httpOnly'> & {
  httpOnly: false;
} {
  return {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export const SESSION_COOKIE = COOKIE_NAME;
export const CSRF_COOKIE = CSRF_COOKIE_NAME;
export const CSRF_HEADER_NAME = CSRF_HEADER;

export { generateSecret as generateCsrfToken };

/**
 * Double-submit CSRF check.
 *
 * A random token in a script-readable cookie, echoed in a header the client
 * sets explicitly. A cross-site request can be made to *carry* the cookie but
 * cannot read it to set the header, so the two cannot be made to match.
 *
 * Hand-rolled rather than a plugin because it is fifteen lines and the
 * alternative is a dependency whose configuration surface is larger than the
 * mechanism. [09 §4.1](../../../../docs/design/09-server-multiuser-deployment.md) lists CSRF
 * among the things whose absence is *embarrassing rather than defensible*, which
 * is the bar being cleared here — not a general-purpose framework.
 */
export function csrfValid(cookieToken: string | undefined, headerToken: unknown): boolean {
  if (typeof cookieToken !== 'string' || cookieToken.length === 0) return false;
  if (typeof headerToken !== 'string' || headerToken.length === 0) return false;
  return secretsMatch(cookieToken, headerToken);
}

/** Methods that change something, and therefore need the CSRF token. */
export function isStateChanging(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}
