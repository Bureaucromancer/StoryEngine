// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  AccountError,
  isListedInGallery,
  toGalleryEntry,
  type GalleryEntry,
  type PublicAccount,
} from '../auth/accounts.js';
import { avatarToken, readAvatar } from '../auth/avatars.js';
import { refuseShortPassword } from '../auth/password-policy.js';
import { secretsMatch } from '../auth/secrets.js';
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

/** The handle in a URL is user input, so it is bounded like every other id. */
const HandleParams = Type.Object({ handle: Type.String({ minLength: 1, maxLength: 63 }) });

/**
 * Login, logout, and first-run setup.
 *
 * **Auth ships whole rather than stubbed** ([P1 §1.3](../../../../docs/design/workplan/07-p1-implementation.md)),
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
  /**
   * The console token, when this install is exposed and unclaimed — F10.
   *
   * Optional in the schema and required in the handler, which is the same
   * division `password` makes one line down and for a related reason: whether
   * it is needed is a property of *this process's bind*, and a schema Ajv
   * compiles once cannot ask. A required field here would refuse every loopback
   * setup, which is every development install.
   */
  setupToken: Type.Optional(Type.String({ maxLength: 512 })),
  // The minimum is `auth.minPasswordLength`, checked in the handler — a `live`
  // key cannot live in a schema Ajv compiles once. See `refuseShortPassword`.
  password: Type.String({ maxLength: 512 }),
  displayName: Type.Optional(Type.String({ maxLength: 200 })),
});

export function registerAuthRoutes(app: FastifyInstance, services: AppServices): void {
  /**
   * `Secure` on both cookies — config since [P6A.2], hardcoded `false` before
   * it (F10, deferred at [P2 §2.11] on the loopback default that the container
   * image removes).
   *
   * **Read once, because the key is `restart` tier**, like `trustProxy` beside
   * it in `Fastify({ … })`. Reading it per request would make a `restart` key
   * behave as a live one, which is the sort of drift the tier annotation exists
   * to prevent.
   *
   * Still `false` by default: [09 §5.1] blesses plain HTTP on a trusted LAN, and
   * a `Secure` cookie is not sent back over HTTP — so a default derived from the
   * bind would lock out the LAN install the design endorses, silently, because
   * the browser declines without telling anyone.
   */
  const secure = services.config.server.cookieSecure;

  /**
   * What the client needs before it can render anything.
   *
   * Reachable without a session on purpose: it is how the client learns whether
   * to show the setup form, the login form, or the library.
   */
  app.get('/auth/state', async (request) => {
    const setupRequired = await services.accounts.needsSetup();
    return {
      setupRequired,
      /**
       * **Whether the console token is needed, so the form can say so** — F10.
       *
       * Advertised rather than guessed. A client cannot tell a loopback server
       * from an exposed one — it may be reaching either through a proxy — so
       * without this the setup form either always shows a token field, which is
       * baffling on a laptop, or never does, which makes an exposed install look
       * broken.
       *
       * It is not a secret and does not narrow anything: this same response
       * already says whether the install is unclaimed, which is the sensitive
       * half, and the token itself is only ever on the server's console.
       */
      setupTokenRequired: setupRequired && services.setupToken !== null,
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
      /**
       * **Which of the two front doors this install shows** — [12 §1.2],
       * [P10.4].
       *
       * This route is *"the one place the pre-auth client learns anything"*,
       * and this is the same kind of fact as `minPasswordLength` above:
       * configuration a screen needs before anybody types, not a secret. The
       * handler's own argument carries it — the same response already says
       * whether this install is unclaimed, *"which is the more sensitive fact by
       * some distance"*. **Which door is open is a smaller fact than whether the
       * house has an owner.**
       *
       * Read off the live config per request, so flipping it takes effect on
       * the next arrival with no restart ([12 §1.1]).
       */
      loginScreen: services.config.auth.loginScreen,
      /**
       * **What build this is, so every page can say so** — the footer on every
       * page and the About block at the top of Settings, since alpha.2.
       *
       * Unauthenticated on purpose, and it narrows nothing: this response
       * already says whether the install is unclaimed, the login page is served
       * to anyone who can reach the port, and a version is a fact about the
       * software rather than about anybody's data — the same audience can read
       * the client bundle. It is also user-facing by design: [09 §7] makes
       * *what am I running* a question the running version answers for
       * everyone who interacts with the server, and this route is that everyone.
       *
       * `null` for a build nobody identified, exactly as on the notices route
       * and for the same reason: a version string that is not a version is what
       * a bug report quotes back.
       */
      build: services.build,
    };
  });

  app.post('/auth/setup', { schema: { body: SetupRequest } }, async (request, reply) => {
    const body = request.body as {
      handle: string;
      password: string;
      displayName?: string;
      setupToken?: string;
    };

    /**
     * **The check P1 never made** — F10, [09 §5.1], [P10 §1.1].
     *
     * Only when this process is exposed *and* still unclaimed: `setupToken` is
     * null on a loopback bind, and `needsSetup` is re-read here rather than
     * trusted from boot so that a claimed install answers `409 already-setup`
     * — the honest reason — instead of a token refusal about a route that no
     * longer applies.
     *
     * Absent and wrong are one answer, like a bad handle and a bad password at
     * login: the caller cannot tell which, and telling them costs something and
     * buys nothing. `secretsMatch` is constant-time and length-safe, so an
     * empty string compares false rather than throwing.
     */
    if (services.setupToken !== null && (await services.accounts.needsSetup())) {
      if (!secretsMatch(body.setupToken ?? '', services.setupToken)) {
        return await reply.code(403).send({
          error: 'invalid-setup-token',
          message: 'This install needs the setup token from the server console.',
        });
      }
    }

    // Before `createFirstAdmin`, which is where the schema's `minLength` used
    // to run: a short password is refused whether or not setup has already
    // happened, and that precedence is today's.
    const refusal = refuseShortPassword('password', body.password, services.config);
    if (refusal) return await reply.code(400).send(refusal);

    try {
      const account = await services.accounts.createFirstAdmin({
        handle: body.handle,
        password: body.password,
        // Defaulted from Accept-Language, per [09 §4.2]. The server localises
        // notifications with the app closed, so it has to know
        // ([20 §12.5](../../../../docs/design/20-tech-stack.md)).
        locale: localeFrom(request.headers['accept-language']),
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      });

      signIn(reply, account, services.sessionKey, secure);
      return await reply.code(201).send({ account });
    } catch (error) {
      if (error instanceof AccountError && error.code === 'exists') {
        // Setup already ran. Not "forbidden": the honest answer is that this
        // route no longer applies.
        return await reply.code(409).send({ error: 'already-setup', message: error.message });
      }
      // ***A handle the rules refuse is the caller's to fix*** (2026-09-27),
      // and the sentence says how. It was a bare 500, *The request failed*,
      // with a stack in the log, for `-ned`, `Sam` or `aux`.
      if (error instanceof AccountError && error.code === 'invalid') {
        return await reply.code(400).send({ error: 'invalid', message: error.message });
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

    signIn(reply, account, services.sessionKey, secure);
    return await reply.send({ account });
  });

  /**
   * ***The gallery, and the whole of its scoping is these four lines*** —
   * [12 §3](../../../../docs/design/12-account-gallery.md),
   * [12 §6](../../../../docs/design/12-account-gallery.md), [P10.4].
   *
   * **It answers only in gallery mode**, which is §3's one-route-family rule
   * made concrete rather than remembered: *"when `loginScreen` is `form`, the
   * family answers 404 — a default install's unauthenticated surface is
   * byte-for-byte what it is today"*, which is the sentence §1.1's default
   * exists to make true. The gate is a helper both routes call, so a third
   * member of the family cannot be added without it.
   *
   * ***And it does not join the setup gate's allowlist.*** Before first run the
   * client renders the setup form before it would ever ask for a gallery, and
   * the pre-setup surface is a claim window ([09 §5.1]) kept deliberately small
   * — two routes. This declines to widen it.
   *
   * **Order is file order**, which is creation order and the convention the
   * storage model already keeps ([03 §5.5]): deterministic, stable under
   * display-name changes, and free of collation. *Alphabetical would have to
   * pick a locale's collation rules for a response addressed to nobody in
   * particular*, which is a decision this feature has no business making.
   */
  app.get('/auth/gallery', async (_request, reply) => {
    if (!galleryOpen(services)) return await reply.code(404).send(NOT_FOUND);

    const held = await services.accounts.list();
    const entries: GalleryEntry[] = [];
    for (const account of held) {
      if (!isListedInGallery(account)) continue;
      entries.push(toGalleryEntry(account, await avatarToken(services.layout, account.handle)));
    }
    return await reply.send({ accounts: entries });
  });

  /**
   * One face, unauthenticated — [12 §5.3].
   *
   * ***Nested under the gallery contract so the scoping is structural rather
   * than remembered***: it answers only in gallery mode, only for accounts the
   * listing would name, and 404 otherwise. **The second clause is the one worth
   * having**: without it, `hiddenFromGallery` would hide a tile and still serve
   * the portrait to anybody who guessed the handle, which is the flag doing
   * nothing for the only reason somebody sets it.
   *
   * **The cache story is the actor avatar's, copied**: `ETag` of the content
   * hash, cache-busted by the token the listing carries. A changed face is a
   * changed URL; an unchanged one is a 304.
   */
  app.get(
    '/auth/gallery/:handle/avatar',
    { schema: { params: HandleParams } },
    async (request, reply) => {
      if (!galleryOpen(services)) return await reply.code(404).send(NOT_FOUND);

      const { handle } = request.params as { handle: string };
      const account = await services.accounts.find(handle);
      if (account === null || !isListedInGallery(account)) {
        return await reply.code(404).send(NOT_FOUND);
      }

      const avatar = await readAvatar(services.layout, handle);
      // Null is the ordinary case rather than an error: [12 §5.4] says every
      // account has a face from the day the feature ships because the client
      // draws one, and an upload is an override.
      if (avatar === null) return await reply.code(404).send(NOT_FOUND);

      if (request.headers['if-none-match'] === avatar.digest) return await reply.code(304).send();

      return await reply
        .header('content-type', avatar.mime)
        .header('etag', avatar.digest)
        // Revalidate rather than cache blindly: the token in the listing is what
        // makes a change visible, and a client that composed the URL without it
        // would otherwise hold a stale face for a year.
        .header('cache-control', 'no-cache')
        .send(Buffer.from(avatar.bytes));
    },
  );

  app.post('/auth/logout', async (_request, reply) => {
    // Clears the cookie. A copy already taken elsewhere stays valid until it
    // expires — the honest cost of stateless sessions, argued in session.ts.
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}

/**
 * Typed over the two fields the cookie carries, so the account's own
 * `createdAt` is what goes in and no caller can hand over a handle alone.
 */
function signIn(
  reply: FastifyReply,
  account: Pick<PublicAccount, 'handle' | 'createdAt'>,
  key: string,
  secure: boolean,
): void {
  const token = issueSession(
    {
      handle: account.handle,
      createdAt: account.createdAt,
      expiresAt: Date.now() + SESSION_TTL_MS,
    },
    key,
  );
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

/**
 * Whether the gallery family answers at all — [12 §3], [12 §6].
 *
 * **One helper rather than the check repeated per route**, which is how one of
 * them ends up without it. Read off the live config, so an admin flipping the
 * key closes the family on the next request rather than at the next restart.
 */
function galleryOpen(services: AppServices): boolean {
  return services.config.auth.loginScreen === 'gallery';
}

/**
 * *The same body for every arm*, deliberately: *not in gallery mode*, *no such
 * account*, *hidden* and *no uploaded face* are four different facts and one
 * answer, because distinguishing them to an unauthenticated caller is how a
 * 404 becomes an oracle for who has an account here.
 */
const NOT_FOUND = { error: 'not-found', message: 'No such thing.' } as const;
