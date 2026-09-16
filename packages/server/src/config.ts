// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';
import { createValidator } from '@storyengine/shared';

import { readFileBytes } from './storage/files.js';

/**
 * `config.json` — docs/design/21-internal-contracts.md §4.
 *
 * **The reload tier is declared per key, and that declaration is the source.**
 * [25 D0](../../../docs/design/25-open-questions.md) asks for every key to carry one, and
 * [09 §6.3](../../../docs/design/09-server-multiuser-deployment.md) derives the
 * restart-required banner from it rather than from a parallel list. The reason
 * is stated plainly there and worth repeating: *a hand-maintained list of
 * settings that need a restart is wrong within two releases*, and wrong in the
 * direction where a user changes something, sees nothing happen, and concludes
 * the software is broken.
 *
 * So {@link CONFIG_TIERS} is not documentation of the table in 13 §4 — it is
 * the table, and {@link pendingRestart} is the only thing that decides whether a
 * change needs one.
 *
 * **No credentials here.** Connections live in `connections/`
 * ([09 §4.5](../../../docs/design/09-server-multiuser-deployment.md)) and this type has
 * nowhere to put a key — the same structural enforcement the portable schemas
 * get ([00 §3.2](../../../docs/design/00-stance.md)), and for the same reason: a check
 * can be forgotten, a missing field cannot.
 */

/**
 * `live` — re-read on change, effective immediately.
 * `reconnect` — effective for new sessions, or after clients reconnect.
 * `restart` — anything establishing a listener or a file handle.
 */
export type ReloadTier = 'live' | 'reconnect' | 'restart';

export const ConfigSchema = Type.Object(
  {
    dataDir: Type.String({ default: './data' }),
    server: Type.Object({
      /**
       * **Loopback on first boot**, and the one default that decides first-run
       * safety ([09 §5.1](../../../docs/design/09-server-multiuser-deployment.md)).
       * Between first boot and first-run setup there is a window in which
       * anyone who can reach the port can claim the admin account; binding
       * loopback closes it, and LAN exposure becomes an explicit act.
       *
       * **`SE_HOST` is how that is changed without a config file**, and it is
       * the same variable everywhere ({@link CONFIG_ENVIRONMENT}). A container
       * must invert this default — `127.0.0.1` inside a container is the
       * container's own loopback and would appear simply broken — and it does
       * so by setting a variable anybody can read and override, rather than by
       * being a build that decided differently. It pays for the inversion with
       * the port mapping being the user's deliberate act.
       *
       * That sentence was here before any of it was true: the server read no
       * environment variable that could have done it, and this comment, the one
       * in `config.example.json` and a third in `main.ts` all described a
       * container that could not have worked ([P6A §0.2]).
       */
      host: Type.String({ default: '127.0.0.1' }),
      port: Type.Integer({ minimum: 1, maximum: 65_535, default: 8080 }),
      trustProxy: Type.Boolean({ default: false }),
      /**
       * `Secure` on the session and CSRF cookies — [P6A §1.4], F10.
       *
       * **Off by default, and not derived from the bind.** The obvious rule —
       * *secure whenever the bind is not loopback* — is wrong here, and wrong
       * in the direction that locks people out: [09 §5.1] blesses plain HTTP on
       * a trusted LAN and refuses to ship self-signed certificates that train
       * people to click through warnings. A `Secure` cookie is simply not sent
       * back over HTTP, so deriving this would make a LAN install unable to
       * sign in, with no error anywhere — the browser declines silently.
       *
       * So it is the operator's statement that TLS is in front, which is the
       * same thing `trustProxy` beside it is. Both were deferred at
       * [P2 §2.11] on the loopback default, and both expire with the image.
       */
      cookieSecure: Type.Boolean({ default: false }),
      /**
       * The built client, served from this process — [P6A §1.3].
       *
       * **Unset means serve nothing, and that is the default on purpose.**
       * Development is two processes — Vite on its own port, proxying `/api`
       * back here — and it has to stay that way, so a packaged build is the
       * only configuration in which this is set. A default pointing at
       * `packages/client/dist` would make the two arrangements differ by
       * whether somebody had run a build, which is the least legible way for
       * them to differ.
       *
       * A directory holding `index.html` and the assets it names. Resolved
       * against the working directory when relative.
       */
      clientRoot: Type.String({ default: '' }),
    }),
    auth: Type.Object({
      /**
       * **The one password rule that survives, and it is the operator's rather
       * than the build's** — [09 §4.1](../../../docs/design/09-server-multiuser-deployment.md).
       *
       * That section skips rate limiting, lockout, complexity policy, email
       * verification and 2FA, on a threat model of *access separation among
       * people who already trust each other*. A length floor is the whole of
       * what is left — and hardcoding it made this install's policy a property
       * of this build: a household on a machine only they can reach could not
       * choose to have no rule at all, and one reaching the port down a tunnel
       * could not ask for more.
       *
       * **`0` is a setting, not a disabled one.** It means the empty string is
       * a password: it hashes, stores and authenticates like any other, and the
       * box stays on every form. `128` is the ceiling because the bodies
       * carrying a password cap at 512 characters, and a *minimum* anywhere
       * near that is a lockout waiting to happen rather than a policy.
       *
       * **It applies where a password is set, never where one is checked.**
       * Login does not measure what it was handed — it cannot, without refusing
       * a password that is genuinely correct and turning the login route into a
       * way to read this install's rule from outside. Raising this leaves every
       * existing account working, with no forced-change flow and no per-account
       * record to carry one. And `--reset-password` honours no minimum at all,
       * including this one: console access is already the highest authority
       * this software recognises ([09 §5.1]).
       */
      minPasswordLength: Type.Integer({ minimum: 0, maximum: 128, default: 8 }),
    }),
    log: Type.Object({
      /**
       * `silent` is not an operational setting — it exists because the test
       * suite builds whole apps and a level union with no off switch leaves it
       * nowhere to turn them down ([21 §4](../../../docs/design/21-internal-contracts.md)).
       */
      level: Type.Union(
        [
          Type.Literal('silent'),
          Type.Literal('error'),
          Type.Literal('warn'),
          Type.Literal('info'),
          Type.Literal('debug'),
        ],
        { default: 'info' },
      ),
      /**
       * One value, deliberately. `pretty` was documented as the default and
       * implemented nowhere; honouring it means a second dependency and a
       * transport for an ergonomic gain in development only, and a terminal
       * that wants it pretty can pipe it
       * ([21 §4.1](../../../docs/design/21-internal-contracts.md), [P2 §2.2](../../../docs/design/workplan/08-p2-implementation.md)).
       * The key stays a union so that adding a format later is not a type
       * change at every call site.
       */
      format: Type.Union([Type.Literal('json')], { default: 'json' }),
    }),
    index: Type.Object({
      /** The rebuild-from-disk startup option ([work plan P1](../../../docs/design/workplan/01-work-plan.md)). */
      rebuildOnStart: Type.Boolean({ default: false }),
    }),
    sessions: Type.Object({
      snapshotEveryNTurns: Type.Integer({ minimum: 1, default: 10 }),
      /**
       * How often the session stream sends a comment frame — [19 §8].
       *
       * `reconnect` rather than `live`: a keepalive is a property of a
       * *connection*, and an open stream keeps the interval it opened with. It
       * is the first real consumer of that tier, which F8 found declared and
       * unused.
       */
      streamKeepaliveMs: Type.Integer({ minimum: 1000, default: 15000 }),
      /**
       * How long streamed deltas accumulate before a durable checkpoint — [P2 §2.10].
       *
       * The operational store runs `synchronous = full`, so a transaction per
       * token would be an fsync storm; the snapshot already carries the
       * accumulated text, so coalescing loses a client nothing it cannot
       * recover. `0` in a test forces one checkpoint per chunk and makes event
       * ordering deterministic.
       */
      streamCoalesceMs: Type.Integer({ minimum: 0, default: 250 }),
    }),
    limits: Type.Object({
      maxUploadMb: Type.Integer({ minimum: 1, default: 64 }),
      extensionStorageQuotaMb: Type.Integer({ minimum: 1, default: 32 }),
      /**
       * The context window a turn may assemble into, when the endpoint does not
       * say — [21 §1.5].
       *
       * No `KNOWN_PROVIDERS` entry sets `maxContextTokens`, because
       * `capabilities.ts` refuses to invent a number it cannot verify. Without
       * this, every turn would be unbudgetable. A per-connection override wins,
       * and reads as `provider` rather than `user` — it is a statement about
       * that endpoint.
       */
      contextTokens: Type.Integer({ minimum: 256, default: 8192 }),
      /** Held back for the answer when a call does not say how long it may be. */
      reservedCompletionTokens: Type.Integer({ minimum: 0, default: 1024 }),
      /**
       * How long one call may make **no progress** before the turn abandons it
       * — [P2C §1.3].
       *
       * Nothing bounded a provider call: only the person's Stop button, which
       * requires somebody to be watching. A stalled endpoint was an unending
       * turn whose only exit was restarting the server, and restarting destroys
       * the state that produced the finding.
       *
       * **No progress, rather than total duration**, because a multi-minute
       * first token is ordinary on a local runtime and a wall-clock ceiling
       * would kill healthy long generations. A streamed chunk resets it. A
       * non-streaming call has no progress to show, so for that call this is
       * the whole of it — which is the honest reading of *nothing has happened
       * for five minutes*.
       *
       * `0` disables it, for an endpoint whose operator knows it is slower than
       * any number here would be. That is a real case and refusing it would
       * only move the workaround somewhere less visible.
       */
      providerTimeoutMs: Type.Integer({ minimum: 0, default: 300_000 }),
    }),
    trash: Type.Object({
      retentionDays: Type.Integer({ minimum: 0, default: 30 }),
    }),
    history: Type.Object({
      /** Pinned versions are exempt ([03 §11.3](../../../docs/design/03-data-model.md)). */
      keepPerObject: Type.Integer({ minimum: 0, default: 50 }),
    }),
    updates: Type.Object({
      checkEnabled: Type.Boolean({ default: true }),
      channel: Type.Union(
        [Type.Literal('latest'), Type.Literal('testing'), Type.Literal('nightly')],
        { default: 'latest' },
      ),
    }),
    dev: Type.Object({
      enabled: Type.Boolean({ default: false }),
    }),
  },
  { title: 'Config', $id: 'https://storyengine.dev/schemas/config.json' },
);

export type Config = Static<typeof ConfigSchema>;

/**
 * Whether a bind address reaches only this machine — [09 §5.1], [P6A §1.4].
 *
 * **One definition, because two would be a security bug rather than an
 * inconsistency.** Everything that turns on *is this install exposed* reads
 * this: whether a setup token is required, and what the startup line says. A
 * second spelling that forgot `127.0.0.2` or `::1` would answer *exposed* for
 * an install that is not, or — the direction that matters — *safe* for one that
 * is.
 *
 * `0.0.0.0` and `::` are deliberately not loopback. They are the wildcard, which
 * is what a container binds and precisely the case the token exists for.
 */
export function isLoopbackHost(host: string): boolean {
  // A bracketed IPv6 literal is what a URL carries; `server.host` may hold
  // either spelling, and the answer must not depend on which.
  const bare = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (bare === 'localhost' || bare === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

/**
 * The tier table from 13 §4, by dotted path.
 *
 * Exhaustive by construction: {@link configKeys} walks the defaults and
 * `config.test.ts` fails if a key has no tier, so adding a config key without
 * deciding how it applies is a test failure rather than a silent `undefined`
 * that reads as "live". (The check is a test rather than a function — this
 * docstring named `assertTiersComplete` for a while and no such thing existed.)
 */
export const CONFIG_TIERS = {
  dataDir: 'restart',
  'server.host': 'restart',
  'server.port': 'restart',
  'server.trustProxy': 'restart',
  'server.cookieSecure': 'restart',
  'server.clientRoot': 'restart',
  'auth.minPasswordLength': 'live',
  'log.level': 'live',
  'log.format': 'restart',
  'index.rebuildOnStart': 'restart',
  'sessions.snapshotEveryNTurns': 'live',
  'sessions.streamKeepaliveMs': 'reconnect',
  'sessions.streamCoalesceMs': 'live',
  'limits.maxUploadMb': 'live',
  'limits.extensionStorageQuotaMb': 'live',
  'limits.contextTokens': 'live',
  'limits.reservedCompletionTokens': 'live',
  'limits.providerTimeoutMs': 'live',
  'trash.retentionDays': 'live',
  'history.keepPerObject': 'live',
  'updates.checkEnabled': 'live',
  'updates.channel': 'live',
  'dev.enabled': 'restart',
} as const satisfies Record<string, ReloadTier>;

/** Whether a `live` key is actually read by a running server, or only stored. */
export type LiveApplier = 'applied' | 'unread';

/**
 * What each `live` key's implementation actually does — the honest half of the
 * tier table.
 *
 * A tier says what a key is *for*: `limits.maxUploadMb` names uploads and will
 * apply live when there is an upload route, so re-tiering it to `restart` to
 * match today's construction-time read would lock the shortcut into the
 * contract ([P2 §3](../../../docs/design/workplan/08-p2-implementation.md) made
 * that argument and it is still right). This table says what is true *now*, and
 * the two are allowed to disagree.
 *
 * **This is what stops the settings surface ever showing a control that does
 * nothing.** `unread` keys render in a group that says the value is stored and
 * not yet read, which is the difference between a setting and a placeholder —
 * and [work plan §2.2](../../../docs/design/workplan/01-work-plan.md) forbids the
 * second. The alternative was remembering, per key, forever.
 *
 * **The rule when a tier and an implementation disagree:** this table records
 * the disagreement; the tier moves only when the *intent* changes.
 *
 * Keyed by the same dotted paths as {@link CONFIG_TIERS} and covering exactly
 * the `live` ones — `config.test.ts` fails on a `live` key with no entry and on
 * an entry for a key that is not `live`, so a new key cannot be added without
 * deciding, and a re-tier cannot leave a stale row behind.
 */
export const LIVE_APPLIERS = {
  // Read per request by the four routes that set a password, off the same live
  // reference `applyLiveConfig` assigns into rather than replaces. Nothing
  // caches it and nothing may: this number used to be a `minLength` literal in
  // those four TypeBox schemas, which Ajv compiles once when the route is
  // registered — precisely the shape that would make this row say `applied` and
  // be a lie.
  'auth.minPasswordLength': 'applied',

  // Assigned onto the root logger, which every child pino derived from it
  // inherits. The one key that was live before this table existed.
  'log.level': 'applied',

  /**
   * **Flipped at P6.0d, when the snapshot cache arrived.**
   *
   * It read `unread` from P2A until then, with the honest reason that snapshots
   * were P6's and nothing read the number. Now `reconstructAlong`
   * (`sessions/store.ts`) reads it **per reconstruction**, through a closure the
   * session context holds rather than a number read at construction — which is
   * the shape that would have made this row say `applied` and be a lie, and is
   * exactly what `routes/live-config.test.ts` exists to catch. Saving a new
   * value changes the *cadence* of the next reconstruction rather than
   * anything on the next restart.
   *
   * Nothing about correctness depends on it: snapshots are derived and
   * disposable ([07 §4]), so the value chooses how often the cache is written
   * and never what a reconstruction answers.
   */
  'sessions.snapshotEveryNTurns': 'applied',

  // Read inside the runner's streaming loop, through the config reference
  // `applyLiveConfig` now assigns into rather than replaces.
  'sessions.streamCoalesceMs': 'applied',

  /**
   * **Flipped at P4.1, when the upload route arrived** ([P4 §1.3]).
   *
   * It read `unread` from P2A until then, with the honest reason that Fastify
   * fixes `bodyLimit` at construction and there was no upload route for it to
   * bound. Now there is, and the enforcement is a **per-request check off the
   * live config reference** rather than the constructor bound — so changing the
   * value in Settings applies to the next upload rather than to the next
   * restart, which is what `live` promised all along.
   *
   * The constructor `bodyLimit` stays as the outer bound. Two tiers is not
   * redundancy: the outer one refuses a body before it is read, the inner one
   * is the honest number a person set.
   */
  'limits.maxUploadMb': 'applied',

  // Extensions appear in no phase list. Nothing reads this.
  'limits.extensionStorageQuotaMb': 'unread',

  // Read per call by the budgeter, off the same live reference.
  'limits.contextTokens': 'applied',
  'limits.reservedCompletionTokens': 'applied',

  // Read per attempt inside `performCall`, off the same live reference — so a
  // turn already in flight when the number changes is bounded by the new one at
  // its next call rather than at the next restart.
  'limits.providerTimeoutMs': 'applied',

  // The maturation sweep does not read it; trash retention is not implemented.
  'trash.retentionDays': 'unread',

  // Read per write through the shared `LibraryContext`, which the watcher now
  // holds rather than copying a number out of.
  'history.keepPerObject': 'applied',

  /**
   * ~~The update check is P11's.~~ ***Built at [P10.3]***, which is
   * [P10 §1.7](../../../docs/design/workplan/27-p10-implementation.md)'s lean
   * taken — *"move the check"* rather than ship a surface reading a source that
   * is always unknown.
   *
   * ***These two rows are why that section exists***: the settings for the check
   * shipped ahead of the check, which is not *shipping dark* as a decision but
   * **shipping dark by default**. They were `unread` for four phases and this
   * table is what made that visible rather than remembered.
   *
   * *Both are genuinely live*: `checkEnabled` is read at the top of every check,
   * so turning it off stops the next one without a restart, and `channel` is
   * read when the feed is filtered — a change applies to the next daily run.
   */
  'updates.checkEnabled': 'applied',
  'updates.channel': 'applied',
} as const satisfies Record<string, LiveApplier>;

export function applierOf(key: string): LiveApplier | null {
  return (LIVE_APPLIERS as Record<string, LiveApplier>)[key] ?? null;
}

export const DEFAULT_CONFIG: Config = {
  dataDir: './data',
  server: { host: '127.0.0.1', port: 8080, trustProxy: false, cookieSecure: false, clientRoot: '' },
  auth: { minPasswordLength: 8 },
  log: { level: 'info', format: 'json' },
  index: { rebuildOnStart: false },
  sessions: { snapshotEveryNTurns: 10, streamKeepaliveMs: 15000, streamCoalesceMs: 250 },
  limits: {
    maxUploadMb: 64,
    extensionStorageQuotaMb: 32,
    contextTokens: 8192,
    reservedCompletionTokens: 1024,
    providerTimeoutMs: 300_000,
  },
  trash: { retentionDays: 30 },
  history: { keepPerObject: 50 },
  updates: { checkEnabled: true, channel: 'latest' },
  dev: { enabled: false },
};

/** What a numeric key will accept, keyed by dotted path. */
export interface ConfigBound {
  minimum?: number;
  maximum?: number;
}

/**
 * The numeric bounds already declared in {@link ConfigSchema}, read back out.
 *
 * **Derived rather than hand-listed, and travelling as data**, which is the
 * pattern {@link CONFIG_TIERS} set: the settings form needs to know that
 * `auth.minPasswordLength` stops at 128 so a browser can refuse 999 before the
 * server has to, and the one thing that must not happen is a second copy of
 * these numbers in the client — wrong the first time somebody widens a range.
 *
 * Only leaves that declare a bound appear. A key with neither is absent rather
 * than present-and-empty, so a caller can spread the result unconditionally.
 */
export function configBounds(): Record<string, ConfigBound> {
  const bounds: Record<string, ConfigBound> = {};

  const walk = (node: unknown, prefix: string): void => {
    if (typeof node !== 'object' || node === null) return;
    const schema = node as { type?: string; properties?: Record<string, unknown> } & ConfigBound;

    if (schema.properties) {
      for (const [key, child] of Object.entries(schema.properties)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }

    if (schema.minimum === undefined && schema.maximum === undefined) return;
    bounds[prefix] = {
      ...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
      ...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
    };
  };

  walk(ConfigSchema, '');
  return bounds;
}

/**
 * The permitted values of every closed-union key, by dotted path.
 *
 * The sibling of {@link configBounds}, and it exists for the same reason and a
 * sharper instance of it. The install form had a hand-written list of log levels
 * carrying `trace`, which the schema's union does not contain: picking it
 * answered `400` and the form said nothing. A control offering a value the
 * server refuses is the exact failure [work plan §2.3](../../../docs/design/workplan/01-work-plan.md)'s
 * *configuration ships with its surface* is about — the surface existed, and it
 * had drifted from the thing it configures.
 *
 * So the list travels as data. There is now no second copy to drift, and adding
 * a level is a change to the union alone.
 *
 * TypeBox renders `Type.Union([Type.Literal(…)])` as `anyOf` of `const`, which
 * is what this reads. A union of anything other than string literals is skipped
 * rather than half-understood — **and nothing in the schema exercises that
 * branch today**, which is said here rather than asserted in a test, because a
 * test over a case that cannot occur is one that passes for no reason. The
 * branch earns its place the first time a config key is a union of numbers.
 */
export function configChoices(): Record<string, string[]> {
  const choices: Record<string, string[]> = {};

  const walk = (node: unknown, prefix: string): void => {
    if (typeof node !== 'object' || node === null) return;
    const schema = node as {
      properties?: Record<string, unknown>;
      anyOf?: { const?: unknown }[];
      const?: unknown;
    };

    if (schema.properties) {
      for (const [key, child] of Object.entries(schema.properties)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }

    /**
     * **A one-member union is a bare `const`, not an `anyOf`.** TypeBox
     * collapses it, so `log.format` — the only such key — rendered as a
     * free-text box over a value the server refuses, which is the same defect
     * this function was written to close, one row below the control it fixed.
     */
    if (schema.anyOf === undefined) {
      if (typeof schema.const === 'string') choices[prefix] = [schema.const];
      return;
    }
    const values = schema.anyOf.map((member) => member.const);
    if (values.some((value) => typeof value !== 'string')) return;
    choices[prefix] = values as string[];
  };

  walk(ConfigSchema, '');
  return choices;
}

/** Every dotted leaf path in a config object. */
export function configKeys(value: unknown = DEFAULT_CONFIG, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    configKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

export function tierOf(key: string): ReloadTier | null {
  return (CONFIG_TIERS as Record<string, ReloadTier>)[key] ?? null;
}

/**
 * Every key that changed between two configs and needs a restart to apply.
 *
 * This *is* the restart-required notice
 * ([09 §6.3](../../../docs/design/09-server-multiuser-deployment.md)) — it names the
 * specific pending changes rather than saying "restart required", because the
 * bare notice invites people to restart and hope.
 */
export function pendingRestart(current: Config, next: Config): string[] {
  return configKeys().filter(
    (key) => tierOf(key) === 'restart' && !Object.is(valueAt(current, key), valueAt(next, key)),
  );
}

function valueAt(config: Config, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      config,
    );
}

/**
 * The bootstrap keys an environment variable may set, by variable name —
 * [P6A §1.2](../../../docs/design/workplan/19-p6a-alpha-1.md),
 * [P10 §1.2](../../../docs/design/workplan/27-p10-implementation.md).
 *
 * **This table exists because of a rule about artifacts, not because
 * environment variables are convenient.** [P10 §1.2] forbids the container
 * image shipping a different baked default for the bind address: *"a hidden
 * difference between artifacts is a support burden shaped like a security
 * feature."* What it requires instead is one documented variable, so a
 * bare-metal operator can opt into the container's behaviour and a container
 * operator can tighten it back. Before this there was no environment layer at
 * all — the server read exactly one variable in the whole codebase and it was
 * dev-only — so the rule's cheap-sounding wording cost the layer rather than a
 * lookup.
 *
 * **Three keys, and they are the bootstrap ones.** `server.host` is the one the
 * rule is about; `port` and `dataDir` are here so that a container's whole
 * bootstrap is one mechanism rather than a flag, a variable and a file. Nothing
 * else belongs: a key that can wait for the config file has a settings page to
 * be changed on, and every variable added here is a value that cannot be
 * changed without a restart of the thing that read it.
 */
export const CONFIG_ENVIRONMENT = {
  SE_DATA_DIR: 'dataDir',
  SE_HOST: 'server.host',
  SE_PORT: 'server.port',
  /**
   * **Added at [P6A.4], which is where the gap showed.** [P6A §1.2] listed the
   * bootstrap keys before [§1.3] invented this one, and an image has nowhere
   * else to put it: the config file lives inside the data directory, which is
   * an empty volume on first run, so a container that could not name the client
   * root through the environment would serve a 404 until somebody wrote a file
   * into the volume it was trying to avoid needing.
   */
  SE_CLIENT_ROOT: 'server.clientRoot',
} as const satisfies Record<string, string>;

/** The variable that sets a key, for an error message that names what was typed. */
const VARIABLE_OF: Record<string, string> = Object.fromEntries(
  Object.entries(CONFIG_ENVIRONMENT).map(([variable, key]) => [key, variable]),
);

/**
 * The declared `type` of every leaf in {@link ConfigSchema}, by dotted path.
 *
 * Private, where {@link configBounds} and {@link configChoices} are exported,
 * because only the layer below needs it: an environment variable arrives as a
 * string and `server.port` is an integer, so something has to know which keys
 * are numbers. Derived rather than declared beside the table above for the
 * reason those two are — a second copy of a fact the schema already holds is
 * wrong the first time somebody changes the schema.
 */
function configTypes(): Record<string, string> {
  const types: Record<string, string> = {};

  const walk = (node: unknown, prefix: string): void => {
    if (typeof node !== 'object' || node === null) return;
    const schema = node as { type?: string; properties?: Record<string, unknown> };

    if (schema.properties) {
      for (const [key, child] of Object.entries(schema.properties)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    if (schema.type !== undefined) types[prefix] = schema.type;
  };

  walk(ConfigSchema, '');
  return types;
}

/**
 * The config document {@link CONFIG_ENVIRONMENT}'s variables describe.
 *
 * **A document rather than a `Config`**, which is the whole reason the layering
 * works: what the environment says is a sparse overlay that the file is merged
 * on top of, exactly as the file is a sparse overlay on the defaults. Returning
 * a filled-in config here would make every unset key an assertion, and the file
 * would have nothing left to win.
 *
 * **An empty value is an unset variable.** `docker compose`'s
 * `environment: [SE_HOST]` forwards the host's variable, and forwards an empty
 * string when the host does not have it — so treating `SE_HOST=` as a value
 * would turn *the operator did nothing* into a startup error, at the one moment
 * they are least equipped to read it.
 *
 * **A bad value is refused, and the message names the variable.** Validation
 * goes through {@link validateConfigDocument}, so there is still one answer to
 * *would this start?* — but its issues speak in JSON pointers, and an operator
 * who set `SE_PORT` and reads `/server/port must be <= 65535` goes looking in a
 * file they never edited. The pointers are translated back to the names that
 * were typed.
 */
export function environmentDocument(
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const types = configTypes();
  const document: Record<string, unknown> = {};

  for (const [variable, key] of Object.entries(CONFIG_ENVIRONMENT)) {
    const raw = env[variable];
    if (raw === undefined || raw === '') continue;

    /**
     * Converted only when it is unambiguously a whole number, so `SE_PORT=x`
     * stays a string and the schema refuses it with *must be integer*. The
     * alternative — `Number()`, which accepts `' 8080 '` and answers `NaN` for
     * the rest — would need a second error path to say what `NaN` meant.
     */
    const value = types[key] === 'integer' && /^-?\d+$/.test(raw) ? Number.parseInt(raw, 10) : raw;

    let node = document;
    const parts = key.split('.');
    const leaf = parts.pop() ?? key;
    for (const part of parts) {
      node[part] ??= {};
      node = node[part] as Record<string, unknown>;
    }
    node[leaf] = value;
  }

  try {
    validateConfigDocument(document, 'the environment');
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new ConfigError('the environment', error.issues.map(nameTheVariable));
  }

  return document;
}

/** `/server/port must be <= 65535` → `SE_PORT must be <= 65535`. */
function nameTheVariable(issue: string): string {
  const [pointer, ...rest] = issue.split(' ');
  const variable = VARIABLE_OF[(pointer ?? '').replace(/^\//, '').replaceAll('/', '.')];
  return variable === undefined ? issue : [variable, ...rest].join(' ');
}

export interface ConfigLoadResult {
  config: Config;
  /** Absent is normal — the defaults are a working install. */
  fileFound: boolean;
  /** Keys present in the file that this build does not know. Kept, reported. */
  unknownKeys: string[];
  /**
   * Which mapped variables were set, by the name that was typed rather than by
   * the key it sets — the operator is debugging what they exported.
   *
   * `shadowed` is the case worth a line of log: the variable is set, the file
   * sets the same key, and the file wins. Silence there is how somebody spends
   * an afternoon on a bind address that is doing exactly what it was told.
   */
  environment: { applied: string[]; shadowed: string[] };
  /**
   * The file exactly as it parsed, before the defaults were merged under it.
   *
   * `config` cannot stand in for this: it is the *merged* view, so every
   * unset key is present there carrying a default, and a writer that round
   * tripped through it would silently pin every default into the file. What
   * the settings form needs to preserve is the unknown keys — a newer build's,
   * or a typo somebody wants to keep seeing — and those exist only here.
   *
   * Empty when there is no file, which is the same shape as an empty one.
   *
   * **And it is the file's, not the resolved document's** — the environment is
   * deliberately absent from it. The settings write round-trips through this
   * value, so an environment value that reached it would be written into the
   * file on the next save: the variable would stop being an override and become
   * a setting, silently, in a file the operator did not put it in.
   */
  document: Record<string, unknown>;
}

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(path: string, issues: string[]) {
    super(`${path} is not valid:\n  ${issues.join('\n  ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Reads `config.json`, filling anything absent from the defaults.
 *
 * **A missing file is not an error.** The defaults are a complete, working
 * install — loopback, port 8080, a `./data` directory — which is what makes
 * "download and run" true rather than aspirational.
 *
 * Unknown keys are **kept and reported**, not rejected. Config is not a portable
 * schema, but the same reasoning applies for the same reason: a key added by a
 * newer build, or a typo, should produce a line someone can read rather than a
 * refusal to start.
 *
 * **Three layers, and the file is above the environment** — [P6A §1.2]. The
 * order is defaults, then `environment`, then the file, and the reason the file
 * outranks a variable is that the file is what the settings page writes: an
 * operator who changed a value in the UI, restarted, and found a variable had
 * outranked it would be right to call that a bug. `--data` still wins over all
 * three, in the caller.
 *
 * **`environment` is passed rather than read**, and defaults to none. A
 * function that reached for `process.env` itself would make every test that
 * loads a config depend on the machine it runs on, and would fail *open* — the
 * ambient environment leaking in — where an argument fails closed.
 */
export async function loadConfig(
  path: string,
  environment: Record<string, unknown> = {},
): Promise<ConfigLoadResult> {
  const bytes = await readFileBytes(path);

  /**
   * **No file is an empty document, not an early return.** It used to return
   * the defaults whole, which was the same answer by a shorter route — until
   * the environment layer arrived, at which point *no file* stopped meaning
   * *the defaults* and the shortcut would have skipped the only case the layer
   * exists for: a container with an empty volume, which is precisely where
   * there is no file.
   */
  let parsed: unknown = {};
  if (bytes !== null) {
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (cause) {
      throw new ConfigError(path, [`not valid JSON (${String(cause)})`]);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ConfigError(path, ['the top level must be an object']);
    }
  }

  // `mergeDefaults` reads its first argument as the layer underneath, which is
  // exactly the environment's position here — the name says `defaults` because
  // that was the only thing ever underneath a file until now.
  const merged = validateConfigDocument(mergeDefaults(environment, parsed), path);

  const fromFile = new Set(configKeys(parsed));
  const setByEnvironment = configKeys(environment);

  return {
    config: merged,
    fileFound: bytes !== null,
    unknownKeys: configKeys(parsed).filter((key) => tierOf(key) === null),
    document: parsed as Record<string, unknown>,
    environment: {
      applied: setByEnvironment.filter((key) => !fromFile.has(key)).map(variableFor),
      shadowed: setByEnvironment.filter((key) => fromFile.has(key)).map(variableFor),
    },
  };
}

/** The variable name for a key, falling back to the key for anything unmapped. */
function variableFor(key: string): string {
  return VARIABLE_OF[key] ?? key;
}

/**
 * Fills a document from the defaults and validates the result.
 *
 * Extracted from {@link loadConfig} so the **settings write** can check a
 * candidate document with the same code the process boots on. A second
 * validator would be a second answer to "would this file start?", and the one
 * outcome a settings form must never produce is a file the server refuses to
 * read.
 *
 * `path` is only used to name the file in the error, and defaults to a phrase
 * for the case where there is no file yet — a document being proposed.
 */
export function validateConfigDocument(document: unknown, path = 'the config'): Config {
  /**
   * **Cloned, because `mergeDefaults` shares what the override does not
   * mention.**
   *
   * It copies one level per recursion, so a key absent from the file comes back
   * as the *same nested object* `DEFAULT_CONFIG` holds — and since [P2A §2.5]
   * made `applyLiveConfig` assign in place, one settings save then rewrote the
   * module-level defaults for the life of the process. It was invisible in the
   * ordinary case and made a test pass for entirely the wrong reason, which is
   * how aliasing bugs usually announce themselves.
   */
  const merged = mergeDefaults(structuredClone(DEFAULT_CONFIG), document);

  const validate = createValidator().compile(ConfigSchema);
  if (!validate(merged)) {
    throw new ConfigError(
      path,
      (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`),
    );
  }
  return merged;
}

/**
 * Deep merge, the first argument underneath. Arrays and scalars from the second
 * win whole.
 *
 * Named for its first use — the defaults under a file — and now the join for
 * both layerings: the defaults under the environment under the file. What it
 * means is *underneath*, not *default*.
 */
function mergeDefaults(defaults: unknown, override: unknown): unknown {
  if (
    typeof defaults !== 'object' ||
    defaults === null ||
    Array.isArray(defaults) ||
    typeof override !== 'object' ||
    override === null ||
    Array.isArray(override)
  ) {
    return override === undefined ? defaults : override;
  }

  const result: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    result[key] = key in result ? mergeDefaults(result[key], value) : value;
  }
  return result;
}
