// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import { Accounts, type PublicAccount } from './auth/accounts.js';
import {
  CSRF_COOKIE,
  CSRF_HEADER_NAME,
  csrfValid,
  isStateChanging,
  loadOrCreateSessionKey,
  readSession,
  SESSION_COOKIE,
} from './auth/session.js';
import { type Config, pendingRestart } from './config.js';
import { openIndex, type OpenedIndex } from './index-db/open.js';
import { rebuild } from './index-db/rebuild.js';
import { LibraryWatcher } from './index-db/watcher.js';
import type { LibraryContext } from './library.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerLibraryRoutes } from './routes/library.js';
import { Layout } from './storage/layout.js';

/**
 * The HTTP app — Fastify, per [07 §3](../../../docs/design/07-tech-stack.md).
 *
 * The deciding argument there was that this design already needs runtime JSON
 * Schema in four places, so route validation becomes a *fifth* use of the same
 * mechanism rather than a parallel one. That is why the routes validate against
 * the very schemas the storage layer uses — one schema technology, five jobs.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated account, or null. Never read from a route parameter. */
    account: PublicAccount | null;
  }
}

export interface AppServices {
  config: Config;
  layout: Layout;
  index: OpenedIndex;
  accounts: Accounts;
  watcher: LibraryWatcher | null;
  sessionKey: string;
  library: LibraryContext;
}

export interface BuildAppOptions {
  config: Config;
  /** Skip the filesystem watcher. Tests that do not exercise foreign writes want this. */
  watch?: boolean;
}

export async function buildServices(options: BuildAppOptions): Promise<AppServices> {
  const layout = new Layout(options.config.dataDir);
  const index = await openIndex({ path: layout.indexFile });
  const library: LibraryContext = {
    db: index.db,
    layout,
    keepHistoryPerObject: options.config.history.keepPerObject,
  };

  // A fresh or version-bumped index is empty and says so, which is what makes
  // deleting `index.sqlite` a non-event rather than a silently empty library
  // ([13 §5](../../../docs/design/13-internal-contracts.md)).
  if (index.migration.rebuildRequired || options.config.index.rebuildOnStart) {
    await rebuild(index.db, layout);
  }

  const watcher =
    options.watch === false
      ? null
      : new LibraryWatcher({
          db: index.db,
          layout,
          keepHistoryPerObject: options.config.history.keepPerObject,
        });
  await watcher?.start();

  return {
    config: options.config,
    layout,
    index,
    accounts: new Accounts(layout),
    watcher,
    sessionKey: await loadOrCreateSessionKey(layout),
    library,
  };
}

export async function buildApp(services: AppServices): Promise<FastifyInstance> {
  const app = Fastify({
    /**
     * Fastify's own logger, configured rather than replaced (F8, [P2 §2.2]).
     *
     * pino already travels with Fastify, so taking the option instead of
     * declaring and injecting an instance keeps this stage from silently
     * choosing a logging library that no design section names. JSON is the only
     * format ([13 §4.1]), which is pino's default, so `level` is the whole
     * configuration — and it is also what makes the `live` tier real: pino
     * resolves a child's level through its prototype, so assigning
     * `app.log.level` reaches every logger derived from it.
     */
    logger: { level: services.config.log.level },
    trustProxy: services.config.server.trustProxy,
    bodyLimit: services.config.limits.maxUploadMb * 1024 * 1024,
  });

  await app.register(cookie);

  app.decorateRequest('account', null);

  /**
   * Identity, CSRF, and the first-run gate — in that order, because each
   * depends on the one before.
   */
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = readSession(request.cookies[SESSION_COOKIE], services.sessionKey);
    request.account = session ? await services.accounts.find(session.handle) : null;
    if (request.account && !request.account.enabled) {
      // Disabled between issuing the cookie and using it.
      request.account = null;
    }

    // CSRF before anything else acts on the request. Double-submit: a token in
    // a script-readable cookie, echoed in a header a cross-site caller cannot
    // set ([04 §4.1](../../../docs/design/04-server-multiuser-deployment.md)).
    //
    // **Only when there is a session to protect.** CSRF is an attack on ambient
    // authority — it makes the victim's browser spend credentials it is already
    // holding. Setup and login carry none: an attacker forging either would
    // have to already know the password, at which point they do not need the
    // victim's browser. Requiring a token there would also be a bootstrap
    // paradox, since the token is issued *by* signing in.
    //
    // Login CSRF — forcing someone into an account the attacker controls — is
    // the one real gap this leaves, and `SameSite=Lax` is what covers it: a
    // cross-site POST does not carry cookies at all.
    if (request.account && isStateChanging(request.method) && isApi(request.url)) {
      if (!csrfValid(request.cookies[CSRF_COOKIE], request.headers[CSRF_HEADER_NAME])) {
        await reply.code(403).send({ error: 'csrf', message: 'Missing or invalid CSRF token.' });
        return;
      }
    }

    // **First-run setup gates everything.** Until an admin exists, every route
    // except setup reports that setup is needed
    // ([04 §5.1](../../../docs/design/04-server-multiuser-deployment.md)). Combined with
    // the loopback default this closes the window in which anyone on the
    // network could claim the admin account.
    if (
      isApi(request.url) &&
      !survivesSetupGate(request.url) &&
      (await services.accounts.needsSetup())
    ) {
      await reply
        .code(503)
        .send({ error: 'setup-required', message: 'This install has no accounts yet.' });
      return;
    }
  });

  await app.register(
    (api, _options, done) => {
      registerAuthRoutes(api, services);
      registerLibraryRoutes(api, services);
      done();
    },
    { prefix: '/api' },
  );

  return app;
}

function isApi(url: string): boolean {
  return url.startsWith('/api/');
}

/**
 * The two routes that must work before an install has any accounts.
 *
 * `setup` for obvious reasons, and `state` because it is how a client *learns*
 * that setup is needed — gating the discovery endpoint behind the thing being
 * discovered would leave the UI with a 503 and no way to know what it means.
 */
function survivesSetupGate(url: string): boolean {
  return url.startsWith('/api/auth/setup') || url.startsWith('/api/auth/state');
}

/**
 * Applies a re-read config to a running app, and names what it could not.
 *
 * The `live` tier stops being a data-only annotation here: `log.level` is its
 * first real consumer ([P2 §2.2]), and the return value *is* the
 * restart-required notice ([04 §6.3]) — the specific keys, because a bare
 * "restart required" invites people to restart and hope.
 *
 * Deliberately not a subscription mechanism. One assignment reaches every
 * logger pino derived from this one, and the other `live` keys are read at the
 * point of use rather than cached, so there is nothing to notify. A registry of
 * listeners would be machinery in front of an assignment.
 *
 * The caller decides *when* — this function does not watch anything. What it
 * must never be handed is a config that failed to load: a reload that cannot
 * read a valid file keeps the running one ([13 §4.2]), because a server that
 * reverted to defaults on a typo would unbind itself from its own port.
 */
export function applyLiveConfig(
  app: FastifyInstance,
  services: AppServices,
  next: Config,
): string[] {
  const pending = pendingRestart(services.config, next);

  // Assigned unconditionally rather than only on a difference. Comparing
  // against `services.config` would make this correct only while that record
  // and the running logger agree, and the whole job of this function is to be
  // the thing that keeps them agreeing.
  app.log.level = next.log.level;

  services.config = next;
  return pending;
}

/** Rejects a request with no session. The routes' single authentication point. */
export async function requireAccount(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PublicAccount | null> {
  if (!request.account) {
    await reply.code(401).send({ error: 'unauthenticated', message: 'Sign in first.' });
    return null;
  }
  return request.account;
}
