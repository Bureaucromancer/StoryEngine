// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { AccountError } from '../auth/accounts.js';
import { refuseShortPassword } from '../auth/password-policy.js';
import {
  CSRF_COOKIE,
  csrfCookieOptions,
  generateCsrfToken,
  issueSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookieOptions,
} from '../auth/session.js';
import type { AppServices } from '../app.js';

/**
 * Login, logout, and first-run setup.
 *
 * **Auth ships whole rather than stubbed** ([P1 §1.3](../../../../docs/design/workplan/03-p1-implementation.md)),
 * and the reason it is affordable is that there is very little of it: doc 04
 * §4.1 already rules out rate limiting, lockout, complexity policy, email
 * verification and 2FA, and §4.2 rules out self-registration and identity
 * providers. What is left is roughly the whole of what will ever ship.
 *
 * What survives of "complexity policy" is a single length floor, and it is the
 * operator's rather than this build's — `auth.minPasswordLength`, checked by
 * `refuseShortPassword` wherever a password is *set*. Login does not check it.
 *
 * The alternative was a stub user context threaded through every route from
 * here to P10 and then torn out — every one of those routes written twice.
 */

const Credentials = Type.Object({
  handle: Type.String({ minLength: 1, maxLength: 63 }),
  // No minimum, and the absence is the rule rather than an oversight. At
  // `auth.minPasswordLength: 0` the empty string is a password, and the console
  // reset honours no minimum on any install — so a schema floor here would
  // refuse a password that is genuinely correct, and refuse it with a 400 that
  // tells the caller how short it was. `maxLength` stays: it bounds the body.
  password: Type.String({ maxLength: 512 }),
});

const SetupRequest = Type.Object({
  handle: Type.String({ minLength: 1, maxLength: 63 }),
  // The minimum is `auth.minPasswordLength`, checked in the handler — a `live`
  // key cannot live in a schema Ajv compiles once. See `refuseShortPassword`.
  password: Type.String({ maxLength: 512 }),
  displayName: Type.Optional(Type.String({ maxLength: 200 })),
});

export function registerAuthRoutes(app: FastifyInstance, services: AppServices): void {
  const secure = false; // No HTTPS by default on a LAN ([04 §5.1]). See sessionCookieOptions.

  /**
   * What the client needs before it can render anything.
   *
   * Reachable without a session on purpose: it is how the client learns whether
   * to show the setup form, the login form, or the library.
   */
  app.get('/auth/state', async (request) => ({
    setupRequired: await services.accounts.needsSetup(),
    account: request.account,
    /**
     * **The password rule, so a form can state it before anybody types.**
     *
     * It has to be here rather than on the admin config route because the
     * setup form needs it *before any account exists*, and that route is behind
     * both `adminOnly` and the first-run gate. Unauthenticated on purpose: this
     * is the length of a secret, not a secret, and the same response already
     * says whether this install is unclaimed, which is the more sensitive fact
     * by some distance.
     */
    minPasswordLength: services.config.auth.minPasswordLength,
  }));

  app.post('/auth/setup', { schema: { body: SetupRequest } }, async (request, reply) => {
    const body = request.body as { handle: string; password: string; displayName?: string };

    // Before `createFirstAdmin`, which is where the schema's `minLength` used
    // to run: a short password is refused whether or not setup has already
    // happened, and that precedence is today's.
    const refusal = refuseShortPassword('password', body.password, services.config);
    if (refusal) return await reply.code(400).send(refusal);

    try {
      const account = await services.accounts.createFirstAdmin({
        handle: body.handle,
        password: body.password,
        // Defaulted from Accept-Language, per [04 §4.2]. The server localises
        // notifications with the app closed, so it has to know
        // ([07 §12.5](../../../../docs/design/07-tech-stack.md)).
        locale: localeFrom(request.headers['accept-language']),
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      });

      signIn(reply, account.handle, services.sessionKey, secure);
      return await reply.code(201).send({ account });
    } catch (error) {
      if (error instanceof AccountError && error.code === 'exists') {
        // Setup already ran. Not "forbidden": the honest answer is that this
        // route no longer applies.
        return await reply.code(409).send({ error: 'already-setup', message: error.message });
      }
      throw error;
    }
  });

  app.post('/auth/login', { schema: { body: Credentials } }, async (request, reply) => {
    const body = request.body as { handle: string; password: string };

    // **No length check here, deliberately** — see `Credentials` above. Login
    // measures nothing; it either matches the stored hash or it does not.
    const account = await services.accounts.authenticate(body.handle, body.password);

    if (!account) {
      // One answer for "no such handle", "wrong password" and "disabled". The
      // caller cannot tell which, which costs nothing and avoids a handle
      // oracle.
      return await reply.code(401).send({ error: 'invalid-credentials' });
    }

    signIn(reply, account.handle, services.sessionKey, secure);
    return await reply.send({ account });
  });

  app.post('/auth/logout', async (_request, reply) => {
    // Clears the cookie. A copy already taken elsewhere stays valid until it
    // expires — the honest cost of stateless sessions, argued in session.ts.
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}

function signIn(reply: FastifyReply, handle: string, key: string, secure: boolean): void {
  const token = issueSession({ handle, expiresAt: Date.now() + SESSION_TTL_MS }, key);
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(secure));
  reply.setCookie(CSRF_COOKIE, generateCsrfToken(), csrfCookieOptions(secure));
}

/**
 * The first language tag in `Accept-Language`, or null.
 *
 * Deliberately crude — a full negotiation would be pretending to a precision
 * the field does not have here. It is a *default* the user can change, and
 * guessing "en-GB" from `en-GB,en;q=0.9` is the whole of the value.
 */
function localeFrom(header: string | undefined): string | null {
  if (!header) return null;
  const first = header.split(',')[0]?.split(';')[0]?.trim();
  return first && first !== '*' ? first : null;
}
