// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { join, resolve } from 'node:path';

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

import { createValidator } from '@storyengine/shared';

import { Accounts, type PublicAccount } from './auth/accounts.js';
import { PrefsStore } from './auth/prefs.js';
import { TagStore } from './tags/store.js';
import { loadOrCreateSetupToken } from './auth/setup-token.js';
import {
  CSRF_COOKIE,
  CSRF_HEADER_NAME,
  csrfValid,
  isStateChanging,
  loadOrCreateSessionKey,
  readSession,
  SESSION_COOKIE,
} from './auth/session.js';
import { readBuildInfo, type BuildInfo } from './build-info.js';
import { type Config, isLoopbackHost, pendingRestart } from './config.js';
import { openIndex, type OpenedIndex } from './index-db/open.js';
import { startMaturation, type Maturation } from './index-db/maturation.js';
import { rebuild } from './index-db/rebuild.js';
import { materialiseModePresets } from './system-library.js';
import { LibraryWatcher } from './index-db/watcher.js';
import type { LibraryContext } from './library.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerImportRoutes } from './routes/import.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerMeRoutes } from './routes/me.js';
import { registerModeRoutes } from './routes/modes.js';
import { registerTagRoutes } from './routes/tags.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { listSessions, type SessionContext } from './sessions/store.js';
import { createCaptureRecorder, type CaptureRecorder } from './providers/capture.js';
import { createProviderFactory, type ProviderFactory } from './providers/factory.js';
import { capabilitiesFor } from './providers/capabilities.js';
import { resolveConnections } from './providers/connections.js';
import { dispatchRenditions, type RenditionWorkerContext } from './renditions/worker.js';
import { reconcileRenditionJobs } from './renditions/jobs.js';
import { installBuiltIns } from './mode-loader.js';
import { assertModesRunnable } from './mode-registry.js';
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
import { listDirectoryNames, readFileBytes } from './storage/files.js';
import { stampDataDirectory } from './storage/stamp.js';
import { createCaptureStore } from './storage/captures.js';
import { Layout } from './storage/layout.js';

/**
 * The HTTP app — Fastify, per [19 §3](../../../docs/design/19-tech-stack.md).
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
   * The operational store — jobs, reservations, drafts, events ([21 §5.1]).
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
  /** The cassette recorder, present only when `--capture` asked for one. */
  capture?: CaptureRecorder;
  /**
   * The tombstone sweep (F9). Runs whether or not the watcher does — it used to
   * run only from the watcher, so `watch: false` meant tombstones accumulated
   * forever.
   */
  maturation: Maturation;
  sessionKey: string;
  /**
   * The first-run setup token, or null when nothing needs one — F10,
   * [09 §5.1](../../../docs/design/09-server-multiuser-deployment.md),
   * [P6A §1.4](../../../docs/design/workplan/19-p6a-alpha-1.md).
   *
   * **Null carries the decision**, which is why it is a nullable value rather
   * than a token plus a boolean somewhere else: a token exists exactly when this
   * process booted bound beyond loopback with no admin account, and the two
   * places that read it — the check on setup and the advertisement on
   * `auth/state` — ask the same question by asking whether it is here.
   */
  setupToken: string | null;
  /**
   * What build this is, or null for one nobody identified — [P6A §1.5].
   *
   * Null is every development run, and it is a state rather than a missing
   * value: it is what the `notices` route reports, and it is what makes the
   * data-directory stamp neither write nor refuse.
   */
  build: BuildInfo | null;
  /**
   * Where `config.json` actually is.
   *
   * **Not derivable from the layout.** `main.ts` resolves it from `--config`,
   * or from `--data`, or from the default before any config has been read —
   * the bootstrap has to, because the data directory can only come from the
   * config and the config path is derived from the data directory. So a settings
   * route writing to `layout.configFile` would write the wrong file for anyone
   * who passed `--config`, silently, and their edits would vanish on restart.
   */
  /**
   * How the server reaches an outside URL — the model-fetch action ([P2B §2.6]).
   *
   * A seam rather than a bare `fetch` call, for the reason every other seam in
   * this file exists: a test asserting *what happens when an endpoint does not
   * implement /models* must not be a test that makes a network request. It is
   * also the one place the server talks to a host somebody typed in, which is
   * worth being able to point at.
   */
  fetch: typeof globalThis.fetch;
  configPath: string;
  /**
   * `config.json` as this process last saw it — read at boot, replaced on every
   * successful settings write.
   *
   * **This, and not `config`, is what the stale check compares against.** The
   * running config is not the file: `--data` overrides `dataDir` after the load
   * and never touches the document, and an install with no config file at all
   * runs entirely on defaults. Comparing the merged view would therefore report
   * a hand edit on every container start, which is the one deployment the docs
   * recommend.
   *
   * What the form needs to know is narrower and answerable: *has the file
   * changed since we read it?*
   */
  configDocument: Record<string, unknown>;
  library: LibraryContext;
  /**
   * Client preferences, per user ([25 B13]).
   *
   * A service rather than a free function because it owns a write queue: a
   * patch is read-modify-write across an `await`, and two of those racing lose
   * one silently.
   */
  prefs: PrefsStore;
  /**
   * The tag registry — [05 §4](../../../docs/design/05-tagging.md).
   *
   * Beside `prefs` and for the same structural reason: it owns a write queue,
   * because every change to it is a read-modify-write across an `await`. It is
   * a *separate* store rather than a key in that one because it has a schema
   * and validates, which is exactly what [25 B13] decided the preferences bag
   * would not do.
   */
  tags: TagStore;
}

export interface BuildAppOptions {
  config: Config;
  /** Where `config.json` was read from. `main.ts` knows; nothing else can. */
  configPath?: string;
  /** Substitute the outbound fetch — how the model-fetch action is tested. */
  fetch?: typeof globalThis.fetch;
  /** The file's contents as this process read them. See {@link AppServices.configDocument}. */
  configDocument?: Record<string, unknown>;
  /** Skip the filesystem watcher. Tests that do not exercise foreign writes want this. */
  watch?: boolean;
  /**
   * Say what build this is, instead of reading the identity file — [P6A §1.5].
   *
   * A seam of the same kind as `providers` and `fetch` above, and it exists for
   * a reason the others do not have: the identity is a property of *the
   * artifact*, so no test can arrange one without writing into the package it is
   * testing. Without this the data-directory stamp's wiring — refusing before
   * anything opens — would be provable only by running a built server, and a
   * guard that runs one line too late is exactly the sort of thing that then
   * regresses in silence.
   */
  build?: BuildInfo | null;
  /**
   * Where a connection becomes a provider.
   *
   * The one seam an end-to-end turn test needs, and it belongs here rather than
   * as a mutable field: the runner captures the factory when it is built, so a
   * test that reassigned `services.providers` afterwards would swap something
   * nothing reads and then assert against the real adapter without noticing.
   */
  providers?: ProviderFactory;
  /**
   * Record every provider exchange as a cassette into this directory —
   * [P2C §2.2]. CLI-threaded (`--capture`), deliberately not a config key: a
   * dev-only recording toggle in every operator's settings form is noise, and
   * the phase's standing line — P2C adds exactly one key — stays true.
   */
  captureDir?: string;
}

export async function buildServices(options: BuildAppOptions): Promise<AppServices> {
  /**
   * Before anything opens a file: a mode declaring a step it cannot run is a
   * turn that quietly narrates nothing, and `assertModesRunnable` said it ran
   * "at module load" while nothing invoked it.
   *
   * **Two calls since [P7.0], and the order is the point.** Registration is a
   * call rather than an import, so the proof has something to be about only
   * after it — and `assertModesRunnable` now refuses a build that registered
   * nothing, which is the failure the split makes possible and therefore the
   * one it has to catch.
   *
   * *Awaited, because the first call resolves mode packages by specifier.* The
   * `await` is load-bearing in the way an easy one is not: dropped, the proof
   * below runs against an empty registry and every start-up fails with "No
   * modes are registered", which is at least the right kind of noisy.
   */
  await installBuiltIns();
  assertModesRunnable();

  const layout = new Layout(options.config.dataDir);

  /**
   * **Before the index opens, which is the first thing that writes** — [P6A §1.7].
   *
   * The refusal has to happen before this process has touched anything, or it
   * is not a refusal: `openIndex` creates and migrates, and a guard that ran
   * afterwards would be reporting a directory it had already changed.
   */
  const build = options.build === undefined ? await readBuildInfo() : options.build;
  await stampDataDirectory(layout, build);

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
    return await assembleServices(options, layout, index, build);
  } catch (error) {
    index.close();
    throw error;
  }
}

async function assembleServices(
  options: BuildAppOptions,
  layout: Layout,
  index: OpenedIndex,
  // Threaded rather than read again here. It is one file and it cannot change
  // under a running process, so a second read would be a second chance to
  // disagree with the stamp that was already written from the first.
  build: BuildInfo | null,
): Promise<AppServices> {
  const state = await openState({ path: layout.stateFile });
  try {
    return await assembleWithState(options, layout, index, state, build);
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
  build: BuildInfo | null,
): Promise<AppServices> {
  const library: LibraryContext = {
    db: index.db,
    layout,
    keepHistoryPerObject: options.config.history.keepPerObject,
  };

  // A fresh or version-bumped index is empty and says so, which is what makes
  // deleting `index.sqlite` a non-event rather than a silently empty library
  // ([21 §5](../../../docs/design/21-internal-contracts.md)).
  if (index.migration.rebuildRequired || options.config.index.rebuildOnStart) {
    await rebuild(index.db, layout);
  }

  /**
   * **The system library gets its contents** — [P7B.0].
   *
   * Each loaded mode's default prompt pack, written into `system/library/` so
   * that it has an address, an index row and a *Copy to my library* action
   * ([system-library.ts](./system-library.ts) carries the argument).
   *
   * ***Between the rebuild and the watcher, and both edges matter.*** A rebuild
   * walks the system root, so writing before one would index the previous
   * start's bytes and leave the fresh ones unseen on exactly the start where
   * the index was thrown away. And the watcher must not be running yet, or its
   * first event is this process's own boot write arriving as an *external*
   * change — which is a history version, attributed to a person, for a file
   * nobody touched.
   *
   * The no-op rule does the rest: an unchanged pack is not rewritten, so the
   * ordinary restart is silent here.
   */
  await materialiseModePresets(index.db, layout);

  // **The same object, not the same number.** The watcher used to copy
  // `keepPerObject` out of the config at construction, so the two write paths
  // into one object's history could disagree the moment the value changed —
  // and `history.keepPerObject` is tiered `live`. Handing it the context the
  // routes already share makes both paths read the same cell.
  const watcher = options.watch === false ? null : new LibraryWatcher(library);
  await watcher?.start();
  const maturation = startMaturation(index.db, layout);

  const config = structuredClone(options.config);

  const sessions: SessionContext = {
    layout,
    index: index.db,
    // The live reference, read per reconstruction rather than captured — see
    // `SessionContext.snapshotEvery` and `LIVE_APPLIERS`. `config` is the
    // server's own clone, which is what `applyLiveConfig` assigns into.
    snapshotEvery: () => config.sessions.snapshotEveryNTurns,
  };
  const bus = new TurnStream();
  const jobs: JobContext = { db: state.db, sessions, events: bus };
  const commit: CommitContext = { ...jobs };
  /**
   * The cassette recorder, when `--capture` asked for one — [P2C §2.2].
   * Built before the factory because the factory is what carries its wrapper
   * to every provider. `options.providers` still wins outright: a test that
   * injected a double gets exactly the double it injected, recorded by
   * nothing.
   */
  const capture =
    options.captureDir === undefined
      ? undefined
      : createCaptureRecorder({ sink: createCaptureStore(options.captureDir) });
  const providers =
    options.providers ??
    createProviderFactory(capture === undefined ? {} : { wrapFetch: capture.wrapFetch });
  /**
   * **One `Accounts`, shared with the routes** — [P2A §2.1](../../../docs/design/workplan/09-p2a-configuration-surface.md).
   *
   * The runner needs it to read the account's `privateConnections` capability.
   *
   * The plan argues this as *two instances would be two caches and a revocation
   * that takes effect eventually*, and that overstates what is true here, which
   * is worth saying rather than repeating: `Accounts` revalidates against the
   * file's `(mtime, size)` on **every** read, so a second instance would notice
   * a revocation on its next turn too. A mutation that constructs one survives
   * the suite, and it should.
   *
   * What sharing actually buys is not depending on that. A permission check
   * whose freshness rests on filesystem timestamp granularity is one same-size
   * write inside one clock tick away from being wrong, and it would be wrong
   * silently and only sometimes. One instance has one answer by construction —
   * and costs one stat per turn instead of two.
   */
  const accounts = new Accounts(layout);

  /**
   * **The server's own copy**, so a settings save cannot reach back into the
   * object the caller built.
   *
   * `applyLiveConfig` assigns into this, and a caller who assembled their
   * config by spreading `DEFAULT_CONFIG` — a shallow spread shares every
   * nested object — would have their defaults rewritten by the first save.
   *
   * **Belt and braces with the loader's own clone**, and the honest version of
   * that is worth writing down: `validateConfigDocument` also clones, so
   * reverting *either* of them alone leaves the defaults intact and a mutation
   * test cannot tell. The loader's is the one production depends on, because
   * `mergeDefaults` shares whatever the file does not mention. This one guards
   * the other direction — a caller assembling a config some way the loader
   * never touched, which `main.ts` does the moment `--data` overrides
   * `dataDir`.
   *
   * **Bound here rather than in the returned literal, because the runner needs
   * the same object and used to get a different one.** It was handed
   * `options.config` while `applyLiveConfig` assigned into the clone below —
   * two objects, one of them updated, and every key the turn path reads holding
   * the other. Four `LIVE_APPLIERS` rows said `applied` about that, which is
   * the exact claim the table exists to keep honest.
   *
   * Every test of a live save passed throughout, because each asserted against
   * `services.config` — the object the route writes and the form reads back.
   * The value really did change. Nothing had asked the component that consumes
   * it, which is why the test that catches this takes a turn.
   *
   * **Declared above the session context rather than here, since P6.0d**, which
   * holds a closure over it for `sessions.snapshotEveryNTurns`. A closure may
   * legally name a `const` declared later, and this one would never have been
   * called before the declaration ran — but *would never* is a property of the
   * lines in between rather than of the code, and the failure it buys is a
   * temporal-dead-zone throw at startup.
   */
  /**
   * ***The rendition worker, beside the turn runner rather than inside it*** —
   * [06 §10.2], [P9.2].
   *
   * A picture is dispatched after a turn has committed and outlives the runner's
   * interest in it, so the seam is a callback the runner calls and nothing it
   * owns. A runner that held this would be a runner whose `drain()` had to wait
   * for pictures — which is the exact coupling §10.2 exists to refuse.
   */
  const renditions: RenditionWorkerContext = {
    db: state.db,
    layout,
    providers,
    /**
     * The connection the `image` role resolves to, for this account.
     *
     * *Resolved per job rather than held*, because a person can rebind the role
     * between a turn committing and its picture being made — and the digest
     * already keys on the binding, so a job that used a stale one would write a
     * record whose reuse key names a model that did not answer.
     */
    connectionFor: async (account: string) => {
      // The account's capabilities, read now rather than held — `gather.ts`'s
      // rule: *"a queued turn must not run with more authority than a live one
      // whose capability had been revoked."* A picture is a queued turn's
      // afterthought and is held to the same line.
      const held = await accounts.find(account);
      const { usable } = await resolveConnections(
        layout,
        account,
        held?.capabilities ?? { privateConnections: false },
      );
      /**
       * **The first usable connection that says it makes pictures.**
       *
       * Not `resolveRole('image')`, and the difference is deliberate at this
       * stage: the full five-layer resolution needs a session's overrides, and a
       * job carries an account rather than a session's role table. What this
       * answers is *can this account make a picture at all*, which is the
       * question the worker's `no-binding` arm asks. **[P9.4] replaces it with
       * the session-aware binding**, where the overrides are in hand.
       */
      return (
        usable.find((one) => capabilitiesFor(one.provider, one.capabilities ?? {}).rendersImages) ??
        null
      );
    },
    changed: (sessionId, rendition) => {
      bus.rendition(sessionId, rendition);
    },
  };

  const runner = new TurnRunner({
    commit,
    bus,
    providers,
    accounts,
    config,
    dispatch: (account, sessionId, records, turnId) => {
      dispatchRenditions(renditions, account, sessionId, records, turnId);
    },
    imageBinding: () => null,
  });

  return {
    config,
    // And the baseline separately, for the same reason in the other direction:
    // sharing one object would make it follow the thing it is the baseline for,
    // and the restart notice would always be empty.
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
    accounts,
    watcher,
    maturation,
    prefs: new PrefsStore(layout),
    tags: new TagStore(layout),
    build,
    sessionKey: await loadOrCreateSessionKey(layout),
    /**
     * **Minted only in the window it is for.** A loopback install never gets
     * one — [09 §5.1]'s claim window is closed by the bind itself — and an
     * install that already has an admin never gets one either, because the
     * thing a token protects has already happened.
     *
     * Read once at boot rather than per request. `server.host` is a `restart`
     * key, so it cannot change under a running process; and an admin appearing
     * mid-life does not need to un-mint anything, because both readers
     * re-check `needsSetup()` themselves.
     */
    setupToken:
      isLoopbackHost(config.server.host) || !(await accounts.needsSetup())
        ? null
        : await loadOrCreateSetupToken(layout),
    // Defaulted rather than required: every test builds services without a real
    // command line, and the layout's answer is right whenever nobody overrode it.
    fetch: options.fetch ?? globalThis.fetch,
    configPath: options.configPath ?? layout.configFile,
    configDocument: options.configDocument ?? {},
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
     * format ([21 §4.1]), which is pino's default, so `level` is the whole
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
   * the repo that gets that right ([04 §3](../../../docs/design/04-schemas.md)),
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
        /**
         * **The rejected key, not just the object it was in.**
         *
         * Ajv reports `additionalProperties` with the *parent's* path and puts
         * the offending name in `params.additionalProperty` — so a body
         * carrying a `role` answered `/ must NOT have additional properties`,
         * which tells a client author to go and read the schema.
         *
         * That matters more since [P2A](../../../docs/design/workplan/09-p2a-configuration-surface.md):
         * closed bodies are how the settings routes refuse a field rather than
         * ignoring it, and *refused* only teaches a client something if the
         * answer says which field.
         */
        path: pathOfIssue(issue),
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
  // The watcher too: a hand-edited file that fails to parse is otherwise
  // recorded in the index and said nowhere (F34).
  services.watcher?.setLogger(app.log);
  services.capture?.setLogger(app.log);
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
   * ***And the pictures that were being made when the process died*** — [P9.2].
   *
   * **Abandoned rather than resumed**, which is `state/commit.ts`'s own rule —
   * *"recovery resumes finalisation, never generation"* — and a provider call
   * that died with the process cannot be picked up mid-flight.
   *
   * *What makes that acceptable here and not there is the placeholder.* An
   * interrupted turn has to become a failed turn because there is nothing else
   * honest to be; an interrupted rendition becomes a record with `asset: null`,
   * its recipe intact, and a retry in front of it — which is [06 §10.2]'s answer
   * to every other way this goes wrong.
   */
  const stranded = reconcileRenditionJobs(services.state.db);
  if (stranded.interrupted.length > 0) {
    app.log.info(
      { event: 'renditions.reconciled', count: stranded.interrupted.length },
      'Marked in-flight renditions as interrupted',
    );
  }

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

  /**
   * Multipart, for the one upload route ([P4 §1.3]).
   *
   * `attachFieldsToBody` is left off: the route reads the file as a stream and
   * decides on its size itself, which is what makes `limits.maxUploadMb` a
   * **per-request** check off the live config rather than a number frozen when
   * this instance was built. The plugin's own limits are passed per call for the
   * same reason.
   */
  await app.register(multipart);

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
    // set ([09 §4.1](../../../docs/design/09-server-multiuser-deployment.md)).
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
    // ([09 §5.1](../../../docs/design/09-server-multiuser-deployment.md)). Combined with
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
      registerMeRoutes(api, services);
      registerModeRoutes(api);
      registerTagRoutes(api, services);
      registerLibraryRoutes(api, services);
      registerImportRoutes(api, services);
      registerSearchRoutes(api, services);
      registerSessionRoutes(api, services);

      /**
       * **The admin half, encapsulated** — [P2A §2.4](../../../docs/design/workplan/09-p2a-configuration-surface.md).
       *
       * A nested `register` rather than a call beside the others, because that
       * is what gives `adminOnly` somewhere to live: a Fastify plugin is an
       * encapsulation boundary, so a hook added inside covers every route
       * registered inside it and nothing outside. The guard is therefore a
       * property of the prefix rather than something each handler remembers.
       *
       * **Registered after the root hook, and that ordering is a security
       * property.** Identity, CSRF and the setup gate all run on the root
       * instance, so they run first — which is why a state-changing admin call
       * with no CSRF token answers `csrf` rather than `forbidden`, and why an
       * admin route is unreachable before setup like every other one.
       * `admin.test.ts` asserts that rather than trusting it.
       */
      void api.register(
        (admin, _adminOptions, adminDone) => {
          registerAdminRoutes(admin, services);
          adminDone();
        },
        { prefix: '/admin' },
      );

      done();
    },
    { prefix: '/api' },
  );

  /**
   * The client, from this process, on this port — [P6A §1.3].
   *
   * **Registered after the API and nothing about the API moved**, which is the
   * whole reason this is a small change: every route in the server lives inside
   * the one encapsulated plugin above at `{ prefix: '/api' }`, so the root
   * namespace was empty and a static handler shadows nothing. The client needed
   * no change either — `vite.config.ts` sets no `base`, so `index.html` names
   * `/assets/…` absolutely, and every call in `api.ts` is already a relative
   * `/api/…`. It was written for one origin from the start; only the server was
   * not.
   *
   * **Unset means serve nothing**, and development stays two processes. The
   * exit gate checks that rather than assuming it ([P6A §3] step 13).
   *
   * **The check before the register is not defensive tidiness.** Measured:
   * `@fastify/static` with a root that is not there does not throw. It finds
   * nothing and serves nothing, so a typo'd `clientRoot` would start a server
   * that answers the API, serves no asset, and hands every page request to the
   * fallback below, which then fails per-request on a file that was never
   * there. That is a packaged build coming up and showing a blank page, which
   * is the class of failure this stage exists to remove.
   *
   * `index.html` rather than the directory, because a directory that exists and
   * holds no build is the same failure wearing a better disguise — an image
   * whose build step silently produced nothing would pass a directory check.
   */
  const clientRoot = services.config.server.clientRoot;
  if (clientRoot !== '') {
    const root = resolve(clientRoot);
    if ((await readFileBytes(join(root, 'index.html'))) === null) {
      throw new Error(`server.clientRoot has no index.html in it: ${root}`);
    }
    await app.register(fastifyStatic, {
      root,
      /**
       * **The `/api` namespace is the router's, never the filesystem's.**
       *
       * [P6A §0.3] names the SPA fallback as the place `isApi` has to be used,
       * and that is necessary and not sufficient: a fallback only sees requests
       * that matched no route, and a file at `<clientRoot>/api/nonsense` *is* a
       * route. Measured before this line existed — `GET /api/nonsense` answered
       * `200` with the file's bytes, past every guard below.
       *
       * Not a hypothetical about the client we ship, whose build is
       * `index.html` and `assets/`: `clientRoot` is a path an operator sets, so
       * what it happens to contain must not be able to decide what `/api`
       * means. One predicate used twice — this refuses, the handler below
       * answers.
       */
      allowedPath: (pathName) => !isApi(pathName),
    });
  }

  /**
   * Everything unrouted, and the one branch that matters.
   *
   * **`/api` is never the app shell.** An address under the prefix that matches
   * no route answers JSON, because [the API doc](../../../docs/api.md) is a
   * contract with clients that parse it — and HTML arriving where JSON is
   * expected is a worse failure than the 404 that passage already argues for:
   * the parse error names a syntax position in a document nobody wrote, and
   * says nothing about the address being wrong.
   *
   * The body is this server's documented error shape rather than Fastify's
   * default `{statusCode, error, message}`. The default was never the contract
   * — it was what the framework happened to send while nothing had set a
   * not-found handler — and a *packaged* build answering differently from a
   * development one would be the worst of the three options.
   *
   * **Anything else is `index.html`**, which is what makes a bookmarked
   * `/library/actors/…/edit` load. The accepted cost is that a request for an
   * asset that is not there also answers the shell: a built client names its
   * assets by content hash, so a miss means the browser is holding a stale
   * `index.html`, and the shell it gets back is the newer one.
   */
  app.setNotFoundHandler((request, reply) => {
    if (clientRoot === '' || isApi(request.url)) {
      return reply.code(404).send({ error: 'not-found', message: 'No such route.' });
    }
    return reply.sendFile('index.html');
  });

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
 * restart-required notice ([09 §6.3]) — the specific keys, because a bare
 * "restart required" invites people to restart and hope.
 *
 * Deliberately not a subscription mechanism. One assignment reaches every
 * logger pino derived from this one, and the other `live` keys are read at the
 * point of use rather than cached, so there is nothing to notify. A registry of
 * listeners would be machinery in front of an assignment.
 *
 * The caller decides *when* — this function does not watch anything. What it
 * must never be handed is a config that failed to load: a reload that cannot
 * read a valid file keeps the running one ([21 §4.2]), because a server that
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
  /**
   * **Which `app` this is does not matter, and that is worth stating** because
   * it does not look that way.
   *
   * P2A.5 registers the settings routes inside the encapsulated `/api/admin`
   * plugin, so the instance reaching this line is a plugin's rather than the
   * root — which reads like the classic half-working bug: set the level on a
   * child, watch that child's lines change and nothing else's.
   *
   * It is not, because **Fastify shares one logger across plugin instances**;
   * `instance.log` is the root logger unless a plugin was registered with its
   * own `logLevel`, and none here is. Per-*request* loggers are children, and
   * pino children resolve their level through the parent unless one was set on
   * them, so this assignment reaches those too.
   *
   * That is a fact about Fastify rather than about this code, so it is pinned by
   * a test that emits a line either side of a save through the route
   * (`routes/config.test.ts`) rather than by this paragraph. Assigning to a
   * child instead fails it.
   */
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

/**
 * Where a validation issue happened, including the key an `additionalProperties`
 * rejection is about.
 *
 * Ajv puts that key in `params` rather than in `instancePath`, because the path
 * describes what was being validated and the extra property is by definition not
 * part of it. Joining them is what turns "this object is wrong" into "this field
 * is wrong".
 */
function pathOfIssue(issue: { instancePath: string; params?: unknown }): string {
  const base = issue.instancePath === '' ? '' : issue.instancePath;
  const params = issue.params;
  const extra =
    typeof params === 'object' && params !== null
      ? (params as Record<string, unknown>)['additionalProperty']
      : undefined;
  if (typeof extra === 'string') return `${base}/${extra}`;
  return base === '' ? '/' : base;
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
