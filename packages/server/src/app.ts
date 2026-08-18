// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import cookie from '@fastify/cookie';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

import { createValidator } from '@storyengine/shared';

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
import { startMaturation, type Maturation } from './index-db/maturation.js';
import { rebuild } from './index-db/rebuild.js';
import { LibraryWatcher } from './index-db/watcher.js';
import type { LibraryContext } from './library.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { listSessions, type SessionContext } from './sessions/store.js';
import { createProviderFactory, type ProviderFactory } from './providers/factory.js';
import { assertModesRunnable } from './modes/registry.js';
import {
  reconcile,
  reconcileSession,
  type CommitContext,
  type Reconciliation,
} from './state/commit.js';
import type { JobContext } from './state/jobs.js';
import { TurnStream } from './stream/bus.js';
import { TurnRunner } from './turns/runner.js';
import { openState, type OpenedState } from './state/open.js';
import { listDirectoryNames } from './storage/files.js';
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
  /**
   * The running config. **Assigned into, never replaced** — see
   * {@link applyLiveConfig}. Everything holding this reference sees a live key
   * change without being told.
   */
  config: Config;
  /**
   * The config as it was when this process started. A clone, never reassigned.
   *
   * The restart notice is `pendingRestart(bootConfig, config)`, computed per
   * request and stored nowhere — which is what makes it self-healing: change a
   * value, change it back, and the notice clears, because it is derived rather
   * than accumulated. A stored pending-set would be a second source of truth
   * for a derived value, and would drift the first time a save was undone.
   */
  bootConfig: Config;
  layout: Layout;
  index: OpenedIndex;
  /**
   * The operational store — jobs, reservations, drafts, events ([13 §5.1]).
   *
   * Beside the index and emphatically not part of it: deleting `index.sqlite`
   * is a non-event, and deleting this one loses an uncommitted turn.
   */
  state: OpenedState;
  /** Where sessions live. One context, so the write lock is genuinely shared. */
  sessions: SessionContext;
  /** The operational store's context — jobs, drafts, events. */
  jobs: JobContext;
  /** In-process fan-out for the session stream. */
  bus: TurnStream;
  /** Drives a reserved job to a committed turn. */
  runner: TurnRunner;
  /** The commit protocol's context — shared with the runner, so one logger reaches both. */
  commit: CommitContext;
  providers: ProviderFactory;
  /**
   * Every open stream's closer.
   *
   * `app.close()` resolves in zero milliseconds with a hijacked response open,
   * so an `onClose` hook has to end them — otherwise a surviving keepalive
   * interval is a hung process rather than a failed test.
   */
  streams: Set<() => void>;
  /**
   * What startup reconciliation did, for the log line and for a test to read.
   *
   * Assigned by `buildApp` rather than `buildServices`, because recovery has to
   * be able to *narrate itself*: the recovering process is where the interesting
   * half of a killed turn's lifecycle happens, and `buildServices` runs before
   * any logger exists. Reconciling there wrote nothing, so a log filtered by a
   * killed turn's job id held only the dying process's lines — which satisfies a
   * much weaker claim than the one this stage makes.
   */
  reconciliation: Reconciliation;
  accounts: Accounts;
  watcher: LibraryWatcher | null;
  /**
   * The tombstone sweep (F9). Runs whether or not the watcher does — it used to
   * run only from the watcher, so `watch: false` meant tombstones accumulated
   * forever.
   */
  maturation: Maturation;
  sessionKey: string;
  library: LibraryContext;
}

export interface BuildAppOptions {
  config: Config;
  /** Skip the filesystem watcher. Tests that do not exercise foreign writes want this. */
  watch?: boolean;
  /**
   * Where a connection becomes a provider.
   *
   * The one seam an end-to-end turn test needs, and it belongs here rather than
   * as a mutable field: the runner captures the factory when it is built, so a
   * test that reassigned `services.providers` afterwards would swap something
   * nothing reads and then assert against the real adapter without noticing.
   */
  providers?: ProviderFactory;
}

export async function buildServices(options: BuildAppOptions): Promise<AppServices> {
  /**
   * Before anything opens a file: a mode declaring a step it cannot run is a
   * turn that quietly narrates nothing, and `assertModesRunnable` said it ran
   * "at module load" while nothing invoked it.
   */
  assertModesRunnable();

  const layout = new Layout(options.config.dataDir);
  const index = await openIndex({ path: layout.indexFile });

  /**
   * **Everything after the first handle opens runs under a guard.**
   *
   * `openState` already closes its own handle on a failed open, for a reason
   * its comment states: on Windows a leaked SQLite handle keeps `-wal` and
   * `-shm` locked, so the *next* thing to touch that directory fails with
   * `EBUSY` and the real error is two layers from where it was caused. The same
   * argument applies to everything between the two opens and the return — a
   * rebuild that throws, a watcher that cannot start, a reconcile that rejects —
   * and none of it was guarded, so one failed build buried its own cause.
   */
  try {
    return await assembleServices(options, layout, index);
  } catch (error) {
    index.close();
    throw error;
  }
}

async function assembleServices(
  options: BuildAppOptions,
  layout: Layout,
  index: OpenedIndex,
): Promise<AppServices> {
  const state = await openState({ path: layout.stateFile });
  try {
    return await assembleWithState(options, layout, index, state);
  } catch (error) {
    state.close();
    throw error;
  }
}

async function assembleWithState(
  options: BuildAppOptions,
  layout: Layout,
  index: OpenedIndex,
  state: OpenedState,
): Promise<AppServices> {
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

  // **The same object, not the same number.** The watcher used to copy
  // `keepPerObject` out of the config at construction, so the two write paths
  // into one object's history could disagree the moment the value changed —
  // and `history.keepPerObject` is tiered `live`. Handing it the context the
  // routes already share makes both paths read the same cell.
  const watcher = options.watch === false ? null : new LibraryWatcher(library);
  await watcher?.start();
  const maturation = startMaturation(index.db, layout);

  const sessions: SessionContext = { layout, index: index.db };
  const bus = new TurnStream();
  const jobs: JobContext = { db: state.db, sessions, events: bus };
  const commit: CommitContext = { ...jobs };
  const providers = options.providers ?? createProviderFactory();
  const runner = new TurnRunner({ commit, bus, providers, config: options.config });

  return {
    config: options.config,
    // Cloned rather than aliased: `config` is mutated in place from here on, so
    // sharing one object would make the baseline follow the thing it is the
    // baseline for, and the notice would always be empty.
    bootConfig: structuredClone(options.config),
    layout,
    index,
    state,
    sessions,
    jobs,
    bus,
    runner,
    commit,
    providers,
    streams: new Set<() => void>(),
    // Filled in by `buildApp`, which is the first point a logger exists.
    reconciliation: { finalised: [], abandoned: [], failed: [] },
    accounts: new Accounts(layout),
    watcher,
    maturation,
    sessionKey: await loadOrCreateSessionKey(layout),
    library,
  };
}

/**
 * Releases everything `buildServices` acquired, in the order that works.
 *
 * **The order is not stylistic, and it bites hardest on Windows.** The watcher
 * holds handles on the library tree, and both databases hold their own file plus
 * a `-wal` and a `-shm`; a test that removes its temporary directory before
 * those are closed fails with `EBUSY` on a file it never named. Close the app
 * first so no request is mid-flight, then the watcher, then the stores.
 *
 * One function rather than the same four lines in `main`, the test harness and
 * every suite that builds services directly — that duplication had already
 * silently dropped the maturation timer and the operational store from two of
 * the three, and each omission surfaced as a locked file rather than as a leak.
 */
export async function disposeServices(services: AppServices): Promise<void> {
  // **Runs first, and waits.** A detached turn touching a closed
  // `DatabaseSync` is the failure that surfaces on Windows as `EBUSY` on a
  // file the caller never named, two layers from where it was caused.
  await services.runner.drain();
  for (const close of services.streams) close();
  services.streams.clear();
  services.maturation.stop();
  await services.watcher?.stop();
  services.index.close();
  services.state.close();
}

export interface BuildOptions {
  /** Where log lines go. A test reads them back; production uses stdout. */
  logStream?: NodeJS.WritableStream;
}

export async function buildApp(
  services: AppServices,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  // One instance for the whole app: Ajv caches by `$id`, and compiling the same
  // schema through two instances is how a second, differently-configured
  // validator sneaks in.
  const validator = createValidator();

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
    logger: {
      level: services.config.log.level,
      ...(options.logStream === undefined ? {} : { stream: options.logStream }),
    },
    trustProxy: services.config.server.trustProxy,
    bodyLimit: services.config.limits.maxUploadMb * 1024 * 1024,
  });

  /**
   * **The routes validate with the storage layer's Ajv, not Fastify's** (F2).
   *
   * Fastify's default compiler sets `useDefaults` and `coerceTypes`, and Ajv
   * applies both **in place**. The body it rewrites is the object that gets
   * written to disk, so the defaults are not a convenience — they manufacture
   * validity: a `POST` omitting `provenance.source` was accepted, and the
   * handler received an authorship claim nobody made. `assertValidObject`
   * cannot catch it either, because it validates the same mutated reference.
   *
   * `createValidator()` is Ajv with those off, and with `date-time` registered
   * as an actual check rather than an ignored unknown format — the one place in
   * the repo that gets that right ([10 §3](../../../docs/design/10-schemas.md)),
   * now shared instead of imitated.
   */
  app.setValidatorCompiler(({ schema }) => validator.compile(schema as object));

  /**
   * Two failures the framework would otherwise answer in its own words.
   *
   * **A schema rejection keeps the documented shape.** Fastify's default is
   * `{statusCode, code: "FST_ERR_VALIDATION", error, message}`, and
   * [the API doc](../../../docs/api.md)'s error table says a bad body is
   * `400 invalid` with a `message` — the shape every hand-written 400 in the
   * routes already uses. Adding schemas (F2) without this would have made the
   * published contract false for exactly the requests the schemas newly reject.
   *
   * **And anything unhandled says nothing.** The default handler sends the
   * error's message, which is how F22 leaked absolute filesystem paths to a
   * client. The message goes to the log, where it is useful and where the
   * `err` binding carries the stack; the caller gets a status.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      const issues = error.validation.map((issue) => ({
        path: issue.instancePath === '' ? '/' : issue.instancePath,
        message: issue.message ?? 'is invalid',
      }));
      return reply.code(400).send({ error: 'invalid', message: error.message, issues });
    }

    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      return reply.code(status).send({ error: 'internal', message: 'The request failed.' });
    }
    return reply.code(status).send({ error: 'invalid', message: error.message });
  });

  // A hijacked stream survives `app.close()` — measured at zero milliseconds
  // with one open — so the app has to end them itself.
  app.addHook('onClose', (_instance, done) => {
    for (const close of services.streams) close();
    services.streams.clear();
    done();
  });

  /**
   * Everything that outlives a request logs through the app's logger.
   *
   * Bound here rather than at construction because `buildServices` runs first —
   * and gate 19's claim, that a killed turn's lifecycle is reconstructable from
   * the log by job id alone, needs the *recovering* process's lines too, not
   * only the dying one's.
   */
  services.runner.setLogger(app.log);
  services.commit.log = app.log;
  services.bus.onListenerError = (error: unknown) => {
    app.log.error({ err: error, event: 'stream.listener-failed' }, 'A stream listener threw');
  };

  /**
   * **Every job still active at startup was interrupted**, because nothing else
   * can leave one active across a restart ([P2 §2.10]). Reconciliation resumes
   * their *finalisation* — never their generation — so a turn that died
   * mid-stream lands as a failed record somebody can re-run, and a session is
   * never left blocked by a job that will never finish.
   *
   * Here rather than in `buildServices`: it must run before the listener accepts
   * anything (a submission against a session whose previous job is still marked
   * active would be refused as busy, which would be true and wrong), and it must
   * run *after* the logger exists, or the recovering half of a killed turn's
   * lifecycle is written nowhere.
   */
  services.reconciliation = await reconcile(services.commit);

  /**
   * And the turns that have no job to resume from — [P2 §2.10]'s
   * deleted-`state.sqlite` case.
   *
   * `reconcile` walks *jobs*; if the operational store is gone there are
   * none, and a turn already appended to a segment would sit there with the
   * head never advancing over it. That is the case §2.10 says must be
   * "reconciled into the session rather than duplicated or discarded" — and
   * until this call existed, `reconcileSession` was exported, tested, and
   * reached by nothing.
   */
  for (const handle of await listAccountHandles(services)) {
    for (const sessionId of await listSessions(services.sessions, handle)) {
      const advanced = await reconcileSession(services.sessions, handle, sessionId);
      if (advanced > 0) {
        app.log.info(
          { event: 'session.reconciled', sessionId, advanced },
          'Linked turns the head had not caught up to',
        );
      }
    }
  }

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
      registerSearchRoutes(api, services);
      registerSessionRoutes(api, services);
      done();
    },
    { prefix: '/api' },
  );

  return app;
}

/**
 * Every account with a directory on disk.
 *
 * Read from the filesystem rather than from `accounts.json`, for the same
 * reason the rebuild scans directories: a directory belonging to a removed
 * account still holds somebody's sessions, and skipping it would leave a turn
 * unlinked forever.
 */
async function listAccountHandles(services: AppServices): Promise<string[]> {
  return listDirectoryNames(services.layout.usersRoot);
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
  /**
   * **Against the boot config, not the running one.**
   *
   * The previous version computed the delta against `services.config` and then
   * replaced it, which made the answer right exactly once: after one save the
   * baseline had already moved, so the second save's notice was measured from
   * somewhere the listener had never been. What is pending is the difference
   * between what this process *started* with and what is on disk now — a
   * property of the process, so it is derived per call and stored nowhere.
   */
  const pending = pendingRestart(services.bootConfig, next);

  // Assigned unconditionally rather than only on a difference. Comparing
  // against `services.config` would make this correct only while that record
  // and the running logger agree, and the whole job of this function is to be
  // the thing that keeps them agreeing.
  //
  // `app.log` is the **root** logger. Fastify gives each encapsulated plugin a
  // child, and pino children resolve their level through the parent unless one
  // was set on them — so assigning here reaches every child, and assigning to a
  // child would work for that child's lines and silently not for the rest.
  app.log.level = next.log.level;

  /**
   * **Assigned into, not replaced.**
   *
   * `services.config = next` was the bug underneath most of this stage: the
   * runner, the budgeter and the library context all hold *this object*, and
   * rebinding the field left every one of them reading a record the server had
   * stopped using. Six keys the tier table calls `live` could not change on a
   * running server for that reason alone.
   *
   * A deep in-place merge instead, so every holder of the reference sees the
   * change without being told. This function's own docstring already claimed
   * values were read at the point of use; this is where that becomes true.
   *
   * Which `live` keys a running server genuinely reads is
   * {@link LIVE_APPLIERS}, and it is a table rather than a comment because the
   * settings surface renders it.
   */
  assignInPlace(services.config, next);

  /**
   * **The fan-out**, for the one `live` key an in-place assign cannot reach.
   *
   * `LibraryContext` carries `keepHistoryPerObject` as its own field rather than
   * a config reference, because it is the shape the library module takes and
   * that module knows nothing about config. So the value is copied there once at
   * assembly, and copying is exactly what makes a `live` tier untrue.
   *
   * One assignment rather than a subscription: there is one consumer, it is
   * reached from here, and the watcher holds this same object, so both write
   * paths into an object's history see it. If a second field ever needs this,
   * the honest move is to make {@link LIVE_APPLIERS} say so — not to grow a
   * listener registry in front of two assignments.
   */
  services.library.keepHistoryPerObject = next.history.keepPerObject;

  return pending;
}

/**
 * Deep-assigns `next` onto `target`, keeping every nested object's identity.
 *
 * Config is a fixed tree of plain objects and scalars — no arrays, no nulls,
 * validated against {@link ConfigSchema} before it ever reaches here — so this
 * does not need to be a general deep merge, and deliberately is not one. A
 * general version would have to take positions on arrays and on deletion that
 * config has no way to express.
 */
function assignInPlace(target: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(next)) {
    const existing = target[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing)
    ) {
      assignInPlace(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
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
