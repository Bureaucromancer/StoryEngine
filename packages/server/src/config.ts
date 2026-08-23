// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';
import { createValidator } from '@storyengine/shared';

import { readFileBytes } from './storage/files.js';

/**
 * `config.json` — docs/design/13-internal-contracts.md §4.
 *
 * **The reload tier is declared per key, and that declaration is the source.**
 * [06 D0](../../../docs/design/06-open-questions.md) asks for every key to carry one, and
 * [04 §6.3](../../../docs/design/04-server-multiuser-deployment.md) derives the
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
 * ([04 §4.5](../../../docs/design/04-server-multiuser-deployment.md)) and this type has
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
       * safety ([04 §5.1](../../../docs/design/04-server-multiuser-deployment.md)).
       * Between first boot and first-run setup there is a window in which
       * anyone who can reach the port can claim the admin account; binding
       * loopback closes it, and LAN exposure becomes an explicit act.
       *
       * The container image inverts this, necessarily — `127.0.0.1` inside a
       * container is the container's own loopback and would appear simply
       * broken — and pays for it with the port mapping being the user's
       * deliberate act.
       */
      host: Type.String({ default: '127.0.0.1' }),
      port: Type.Integer({ minimum: 1, maximum: 65_535, default: 8080 }),
      trustProxy: Type.Boolean({ default: false }),
    }),
    auth: Type.Object({
      /**
       * **The one password rule that survives, and it is the operator's rather
       * than the build's** — [04 §4.1](../../../docs/design/04-server-multiuser-deployment.md).
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
       * this software recognises ([04 §5.1]).
       */
      minPasswordLength: Type.Integer({ minimum: 0, maximum: 128, default: 8 }),
    }),
    log: Type.Object({
      /**
       * `silent` is not an operational setting — it exists because the test
       * suite builds whole apps and a level union with no off switch leaves it
       * nowhere to turn them down ([13 §4](../../../docs/design/13-internal-contracts.md)).
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
       * ([13 §4.1](../../../docs/design/13-internal-contracts.md), [P2 §2.2](../../../docs/design/workplan/04-p2-implementation.md)).
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
       * How often the session stream sends a comment frame — [07 §8].
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
       * say — [13 §1.5].
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
    }),
    trash: Type.Object({
      retentionDays: Type.Integer({ minimum: 0, default: 30 }),
    }),
    history: Type.Object({
      /** Pinned versions are exempt ([02 §11.3](../../../docs/design/02-data-model.md)). */
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
 * contract ([P2 §3](../../../docs/design/workplan/04-p2-implementation.md) made
 * that argument and it is still right). This table says what is true *now*, and
 * the two are allowed to disagree.
 *
 * **This is what stops the settings surface ever showing a control that does
 * nothing.** `unread` keys render in a group that says the value is stored and
 * not yet read, which is the difference between a setting and a placeholder —
 * and [01 §2.2](../../../docs/design/workplan/01-work-plan.md) forbids the
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

  // Snapshots are P6's. Nothing reads this.
  'sessions.snapshotEveryNTurns': 'unread',

  // Read inside the runner's streaming loop, through the config reference
  // `applyLiveConfig` now assigns into rather than replaces.
  'sessions.streamCoalesceMs': 'applied',

  // Fastify fixes `bodyLimit` when the instance is constructed, and there is no
  // upload route for it to bound yet. The tier stays `live` deliberately.
  'limits.maxUploadMb': 'unread',

  // Extensions appear in no phase list. Nothing reads this.
  'limits.extensionStorageQuotaMb': 'unread',

  // Read per call by the budgeter, off the same live reference.
  'limits.contextTokens': 'applied',
  'limits.reservedCompletionTokens': 'applied',

  // The maturation sweep does not read it; trash retention is not implemented.
  'trash.retentionDays': 'unread',

  // Read per write through the shared `LibraryContext`, which the watcher now
  // holds rather than copying a number out of.
  'history.keepPerObject': 'applied',

  // The update check is P11's.
  'updates.checkEnabled': 'unread',
  'updates.channel': 'unread',
} as const satisfies Record<string, LiveApplier>;

export function applierOf(key: string): LiveApplier | null {
  return (LIVE_APPLIERS as Record<string, LiveApplier>)[key] ?? null;
}

export const DEFAULT_CONFIG: Config = {
  dataDir: './data',
  server: { host: '127.0.0.1', port: 8080, trustProxy: false },
  auth: { minPasswordLength: 8 },
  log: { level: 'info', format: 'json' },
  index: { rebuildOnStart: false },
  sessions: { snapshotEveryNTurns: 10, streamKeepaliveMs: 15000, streamCoalesceMs: 250 },
  limits: {
    maxUploadMb: 64,
    extensionStorageQuotaMb: 32,
    contextTokens: 8192,
    reservedCompletionTokens: 1024,
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
 * server refuses is the exact failure [01 §2.3](../../../docs/design/workplan/01-work-plan.md)'s
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
    };

    if (schema.properties) {
      for (const [key, child] of Object.entries(schema.properties)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }

    if (schema.anyOf === undefined) return;
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
 * ([04 §6.3](../../../docs/design/04-server-multiuser-deployment.md)) — it names the
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

export interface ConfigLoadResult {
  config: Config;
  /** Absent is normal — the defaults are a working install. */
  fileFound: boolean;
  /** Keys present in the file that this build does not know. Kept, reported. */
  unknownKeys: string[];
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
 */
export async function loadConfig(path: string): Promise<ConfigLoadResult> {
  const bytes = await readFileBytes(path);
  if (bytes === null) {
    return {
      config: structuredClone(DEFAULT_CONFIG),
      fileFound: false,
      unknownKeys: [],
      document: {},
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (cause) {
    throw new ConfigError(path, [`not valid JSON (${String(cause)})`]);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(path, ['the top level must be an object']);
  }

  const merged = validateConfigDocument(parsed, path);

  return {
    config: merged,
    fileFound: true,
    unknownKeys: configKeys(parsed).filter((key) => tierOf(key) === null),
    document: parsed as Record<string, unknown>,
  };
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

/** Deep merge, defaults underneath. Arrays and scalars from the file win whole. */
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
