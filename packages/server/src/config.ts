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
    }),
    limits: Type.Object({
      maxUploadMb: Type.Integer({ minimum: 1, default: 64 }),
      extensionStorageQuotaMb: Type.Integer({ minimum: 1, default: 32 }),
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
 * {@link assertTiersComplete} fails if a key has no tier, so adding a config key
 * without deciding how it applies is a test failure rather than a silent
 * `undefined` that reads as "live".
 */
export const CONFIG_TIERS = {
  dataDir: 'restart',
  'server.host': 'restart',
  'server.port': 'restart',
  'server.trustProxy': 'restart',
  'log.level': 'live',
  'log.format': 'restart',
  'index.rebuildOnStart': 'restart',
  'sessions.snapshotEveryNTurns': 'live',
  'limits.maxUploadMb': 'live',
  'limits.extensionStorageQuotaMb': 'live',
  'trash.retentionDays': 'live',
  'history.keepPerObject': 'live',
  'updates.checkEnabled': 'live',
  'updates.channel': 'live',
  'dev.enabled': 'restart',
} as const satisfies Record<string, ReloadTier>;

export const DEFAULT_CONFIG: Config = {
  dataDir: './data',
  server: { host: '127.0.0.1', port: 8080, trustProxy: false },
  log: { level: 'info', format: 'json' },
  index: { rebuildOnStart: false },
  sessions: { snapshotEveryNTurns: 10 },
  limits: { maxUploadMb: 64, extensionStorageQuotaMb: 32 },
  trash: { retentionDays: 30 },
  history: { keepPerObject: 50 },
  updates: { checkEnabled: true, channel: 'latest' },
  dev: { enabled: false },
};

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
    return { config: structuredClone(DEFAULT_CONFIG), fileFound: false, unknownKeys: [] };
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

  const merged = mergeDefaults(DEFAULT_CONFIG, parsed);

  const ajv = createValidator();
  const validate = ajv.compile(ConfigSchema);
  if (!validate(merged)) {
    throw new ConfigError(
      path,
      (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`),
    );
  }

  return {
    config: merged,
    fileFound: true,
    unknownKeys: configKeys(parsed).filter((key) => tierOf(key) === null),
  };
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
