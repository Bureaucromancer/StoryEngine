// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONFIG_ENVIRONMENT,
  CONFIG_TIERS,
  ConfigError,
  ConfigSchema,
  DEFAULT_CONFIG,
  LIVE_APPLIERS,
  TIMER_MAX_MS,
  applierOf,
  configBounds,
  configChoices,
  configKeys,
  environmentDocument,
  loadConfig,
  pendingRestart,
  tierOf,
  validateConfigDocument,
} from './config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'se-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * The parsed file, kept beside the merged view — [P2A §2.5].
 *
 * The settings form has to write back a document that preserves keys this build
 * does not know: a newer build's key, or a typo somebody wants to keep seeing
 * rather than have silently eaten. Those exist only in what was parsed.
 *
 * `config` cannot stand in for it. That is the merged view, so every unset key
 * is present there carrying a default — a writer round-tripping through it would
 * pin the whole default set into a file the operator had deliberately left
 * sparse, and the next build's changed default would never reach them.
 */
describe('the raw document', () => {
  it('is what the file said, not what the defaults filled in', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ server: { port: 9999 }, mystery: { key: 1 } }));

    const loaded = await loadConfig(path);

    // Exactly the file's own keys — the assertion that separates the parsed
    // document from the merged one, which would carry every default here.
    expect(configKeys(loaded.document).sort()).toEqual(['mystery.key', 'server.port']);
    // And the merged view is still the merged view, so nothing else moved.
    expect(loaded.config.server.host).toBe(DEFAULT_CONFIG.server.host);
    expect(loaded.config.server.port).toBe(9999);
  });

  it('is empty when there is no file, which is the same shape as an empty one', async () => {
    const loaded = await loadConfig(join(dir, 'absent.json'));
    expect(loaded.document).toEqual({});
    expect(loaded.fileFound).toBe(false);
  });
});

describe('the tier table is the source', () => {
  it('gives every key a tier', () => {
    // [25 D0](../../../docs/design/25-open-questions.md) requires every key to be
    // annotated. Adding a key without deciding how it applies should be a test
    // failure rather than a silent `undefined` that reads as "live".
    const missing = configKeys().filter((key) => tierOf(key) === null);
    expect(missing).toEqual([]);
  });

  it('has no tier for a key that does not exist', () => {
    // The other direction: a stale entry left behind after a key was removed.
    const stale = Object.keys(CONFIG_TIERS).filter((key) => !configKeys().includes(key));
    expect(stale).toEqual([]);
  });

  it('declares every key in the commented example', async () => {
    // [work plan §2.3](../../../docs/design/workplan/01-work-plan.md): configuration
    // ships with its surface, and `config.example.json` is the surface every
    // operator meets first — its own header calls the settings UI "the primary
    // path", which makes this file the other one. Four keys had already drifted
    // out of it before anybody looked, which is the argument for a test rather
    // than a habit.
    //
    // Named as out of scope at [P2 §3](../../../docs/design/workplan/08-p2-implementation.md)
    // because it cited no finding; it enters at
    // [P2A §3](../../../docs/design/workplan/09-p2a-configuration-surface.md).
    const example = await readFile(
      fileURLToPath(new URL('../../../config.example.json', import.meta.url)),
      'utf8',
    );
    // JSON has no comments, which is the one real cost of JSON everywhere
    // ([03 §5.4]) and the reason this file is not loadable as it stands. Strip
    // whole-line comments only: no value in it contains `//`, and a parser that
    // tried to be cleverer would be a second config reader.
    const stripped = example
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');

    const parsed: unknown = JSON.parse(stripped);
    expect(configKeys(parsed).sort()).toEqual(configKeys().sort());
  });

  /**
   * **Every default is written twice, and nothing checked they agreed.**
   *
   * `ConfigSchema` annotates each leaf with a `default` and `DEFAULT_CONFIG` is
   * a hand-written literal of the same values. Only the literal is ever read —
   * `configKeys` walks it, `mergeDefaults` fills from it, every process boots on
   * it — so a schema annotation that drifted would be wrong in the one place a
   * reader goes to *find out* what a key defaults to, and would stay wrong
   * indefinitely because nothing runs it.
   *
   * Found at [P6A.1] by a mutation that changed the schema's `server.clientRoot`
   * default and made no test fail. It is the fourth table in this file's family
   * — tiers, appliers, the example file — and it was the one nobody had noticed
   * was a table.
   */
  it('declares the same default in the schema as DEFAULT_CONFIG holds', () => {
    const declared: Record<string, unknown> = {};
    const walk = (node: unknown, prefix: string): void => {
      if (typeof node !== 'object' || node === null) return;
      const schema = node as { default?: unknown; properties?: Record<string, unknown> };
      if (schema.properties) {
        for (const [key, child] of Object.entries(schema.properties)) {
          walk(child, prefix ? `${prefix}.${key}` : key);
        }
        return;
      }
      declared[prefix] = schema.default;
    };
    walk(ConfigSchema, '');

    const held: Record<string, unknown> = {};
    for (const key of configKeys()) {
      held[key] = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], DEFAULT_CONFIG);
    }

    // Both directions at once: a key in one and not the other fails on the
    // shape, and a value that moved fails on the value.
    expect(declared).toEqual(held);
  });

  /**
   * The appliers table covers exactly the `live` keys — [P2A §2.5].
   *
   * Both directions, for the same reason the tier table gets both: a `live` key
   * with no entry is a key nobody decided about, and an entry for a key that is
   * no longer `live` is a row that outlived its question. The second is the one
   * a re-tier produces, and a re-tier is exactly when somebody is not thinking
   * about this file.
   */
  it('says of every live key whether anything reads it', () => {
    const live = configKeys().filter((key) => tierOf(key) === 'live');
    expect(live.filter((key) => applierOf(key) === null)).toEqual([]);
  });

  it('claims no key that is not live', () => {
    const stale = Object.keys(LIVE_APPLIERS).filter((key) => tierOf(key) !== 'live');
    expect(stale).toEqual([]);
  });

  /**
   * **And at least one key is honestly declared unread**, which is the assertion
   * that keeps the table from being decorative.
   *
   * A table whose every row said `applied` would pass both checks above while
   * telling the settings surface there is nothing to warn about — and the
   * surface exists partly to warn. ~~`limits.maxUploadMb` is the standing
   * example ([P2A §2.5]): tiered `live` because the key names uploads, read
   * once at construction because there is no upload route yet.~~
   *
   * **The standing example moved at P4.1**, because the old one stopped being
   * one: the upload route arrived and `limits.maxUploadMb` is now read per
   * request. ~~`trash.retentionDays` takes its place — tiered `live` because a
   * retention window is a thing an operator changes and expects to matter,
   * unread because nothing prunes on it yet.~~ That the exemplar had to move is
   * the table working: a key stops being an example of dishonesty by becoming
   * honest.
   *
   * ***And it moved again at [P11.7]***, which built the retention sweep — so
   * `limits.extensionStorageQuotaMb` takes the seat, tiered `live` because a
   * quota is a thing an operator changes and expects to matter, unread because
   * nothing installs an extension yet ([24 §3.2](../../../docs/design/24-roadmap.md)).
   *
   * **Twice now, and the pattern is the finding rather than either move.** The
   * exemplar of *stored and not read* keeps becoming read, which means this
   * check has never once failed by a key going the other way — nothing has ever
   * quietly stopped being consumed. *What it is actually holding is that the
   * table stays capable of saying `unread` at all*: a row of nothing but
   * `applied` would pass the two checks above while telling the settings
   * surface there is nothing to warn about, and the surface exists partly to
   * warn.
   */
  it('admits that some live keys are stored and not read', () => {
    expect(applierOf('limits.extensionStorageQuotaMb')).toBe('unread');
    expect(applierOf('log.level')).toBe('applied');
  });

  /**
   * And the flip itself, pinned from this side too.
   *
   * [P4 §1.3] calls this a *deliberate two-file edit rather than a drive-by*:
   * the coverage test above requires the entry to exist, and this one required
   * it to say `unread`, so making the route real meant changing both on
   * purpose. Asserting the new value keeps the pair symmetrical — the next
   * person to make a `live` key honest has to come here as well.
   */
  it('reads the upload limit per request, since P4.1', () => {
    expect(applierOf('limits.maxUploadMb')).toBe('applied');
  });

  /**
   * **The tier table in [21 §4] names exactly the keys the schema has, with the
   * same tiers.**
   *
   * That document calls the annotation *the source, not documentation of it* —
   * and until P2A the document's own copy of it was four keys behind, which is
   * the ordinary fate of a table nothing checks. `config.example.json` has had a
   * drift test since P2A.0 for the same reason; this is the other shipped
   * description of the same keys.
   *
   * Read as text and parsed loosely on purpose: the assertion is about the
   * *content* of the table, and a stricter markdown parser here would be a
   * second thing to keep working.
   */
  it('matches the tier table in the internal contracts', async () => {
    const doc = await readFile(
      fileURLToPath(new URL('../../../docs/design/21-internal-contracts.md', import.meta.url)),
      'utf8',
    );

    const documented = new Map<string, string>();
    for (const line of doc.split('\n')) {
      // `| \`dataDir\` | \`restart\` | … |` — a key and a tier, both in backticks.
      const row = /^\|\s*`([a-z][\w.]*)`\s*\|\s*`(live|reconnect|restart)`\s*\|/i.exec(line);
      if (row) documented.set(row[1] ?? '', row[2] ?? '');
    }

    // The table exists and was found, so a regex that stopped matching fails
    // here rather than silently reporting agreement about nothing.
    expect(documented.size).toBeGreaterThan(10);

    expect([...documented.keys()].sort()).toEqual(configKeys().sort());
    for (const [key, tier] of documented) {
      expect(tierOf(key), key).toBe(tier);
    }
  });

  /**
   * ***A row that calls an applied key unread is a row nobody corrected***
   * (2026-09-27). `limits.maxUploadMb` read *there is no upload route yet … so
   * it is `unread` today* for seven phases after the upload route shipped and
   * the applier said `applied`. Struck-through text is the record of what was
   * believed, and is left out.
   */
  it('has no row in the table calling an applied key unread', async () => {
    const doc = await readFile(
      fileURLToPath(new URL('../../../docs/design/21-internal-contracts.md', import.meta.url)),
      'utf8',
    );

    const stale: string[] = [];
    for (const line of doc.split('\n')) {
      const row = /^\|\s*`([a-z][\w.]*)`\s*\|\s*`live`\s*\|/i.exec(line);
      if (!row) continue;
      const key = row[1] ?? '';
      const standing = line.replace(/~~[^~]*~~/g, '');
      if (applierOf(key) === 'applied' && standing.includes('`unread`')) stale.push(key);
    }

    expect(stale).toEqual([]);
  });

  /**
   * ***Every millisecond key stops where a timer can hold it*** (2026-09-27).
   * Node does not refuse a longer delay: it warns and uses one millisecond, so
   * the schema is the only place a value meant as *effectively never* can be
   * stopped from meaning *constantly*.
   */
  it('bounds every millisecond key at the longest delay a timer holds', () => {
    const bounds = configBounds();
    const timed = configKeys().filter((key) => key.endsWith('Ms'));

    expect(timed.length).toBeGreaterThanOrEqual(3);
    for (const key of timed) expect(bounds[key]?.maximum, key).toBe(TIMER_MAX_MS);
    expect(() =>
      validateConfigDocument({ limits: { providerTimeoutMs: TIMER_MAX_MS + 1 } }),
    ).toThrow(/providerTimeoutMs/);
  });

  it('keeps the bind address on restart', () => {
    expect(tierOf('server.host')).toBe('restart');
    expect(tierOf('log.level')).toBe('live');
  });
});

describe('the restart-required notice is derived', () => {
  it('names the specific keys that changed', () => {
    // [09 §6.3](../../../docs/design/09-server-multiuser-deployment.md): the banner lists
    // *what* is pending, because "restart required" alone invites people to
    // restart and hope.
    const next = {
      ...DEFAULT_CONFIG,
      server: { ...DEFAULT_CONFIG.server, host: '0.0.0.0' },
      log: { ...DEFAULT_CONFIG.log, level: 'debug' as const },
    };

    expect(pendingRestart(DEFAULT_CONFIG, next)).toEqual(['server.host']);
  });

  it('says nothing when only live keys moved', () => {
    const next = { ...DEFAULT_CONFIG, trash: { retentionDays: 7 } };
    expect(pendingRestart(DEFAULT_CONFIG, next)).toEqual([]);
  });

  it('says nothing when nothing moved', () => {
    expect(pendingRestart(DEFAULT_CONFIG, structuredClone(DEFAULT_CONFIG))).toEqual([]);
  });
});

describe('loading', () => {
  it('treats a missing file as the defaults', async () => {
    // "Download and run" has to be true rather than aspirational: the defaults
    // are a complete working install.
    const result = await loadConfig(join(dir, 'nothing.json'));
    expect(result.fileFound).toBe(false);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  it('binds loopback by default', async () => {
    // The one default that decides first-run safety
    // ([09 §5.1](../../../docs/design/09-server-multiuser-deployment.md)): between first
    // boot and first-run setup, anyone who can reach the port can claim the
    // admin account.
    const { config } = await loadConfig(join(dir, 'nothing.json'));
    expect(config.server.host).toBe('127.0.0.1');
  });

  it('fills absent keys from the defaults', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ server: { port: 9999 } }));

    const { config } = await loadConfig(path);
    expect(config.server.port).toBe(9999);
    expect(config.server.host).toBe('127.0.0.1');
    expect(config.log.level).toBe('info');
  });

  it('keeps and reports a key it does not know', async () => {
    // Not rejected. A key from a newer build, or a typo, should produce a line
    // someone can read rather than a refusal to start.
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ inventedLater: true, server: { port: 9000 } }));

    const result = await loadConfig(path);
    expect(result.unknownKeys).toEqual(['inventedLater']);
    expect(result.config.server.port).toBe(9000);
  });

  it('refuses a value of the wrong type', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ server: { port: 'eight thousand' } }));

    await expect(loadConfig(path)).rejects.toThrow(ConfigError);
  });

  it('refuses a port outside the legal range', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ server: { port: 70_000 } }));

    await expect(loadConfig(path)).rejects.toThrow(ConfigError);
  });

  it('accepts a password minimum of zero, which is a setting and not an absence', async () => {
    // The one value worth naming: `0` means the empty string is a password, so
    // a reader who assumes a falsy value means "unset" is reading it wrong.
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ auth: { minPasswordLength: 0 } }));

    const result = await loadConfig(path);

    expect(result.config.auth.minPasswordLength).toBe(0);
  });

  it('refuses a password minimum past the ceiling', async () => {
    // 128, because the bodies carrying a password cap at 512 and a minimum
    // anywhere near that is a lockout rather than a policy.
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ auth: { minPasswordLength: 129 } }));

    await expect(loadConfig(path)).rejects.toThrow(ConfigError);
  });

  it('refuses a negative password minimum', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ auth: { minPasswordLength: -1 } }));

    await expect(loadConfig(path)).rejects.toThrow(ConfigError);
  });

  it('refuses a file that is not JSON, and says so', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, '{ not json');

    await expect(loadConfig(path)).rejects.toThrow(/not valid JSON/);
  });
});

describe('config has nowhere to put a credential', () => {
  it('declares no key that looks like one', () => {
    // The same structural enforcement the portable schemas get
    // ([00 §3.2](../../../docs/design/00-stance.md), [21 §4]): connections live in
    // `connections/`, and a check can be forgotten where a missing field
    // cannot.
    const denied = /key|secret|password|token|credential|proxy|auth|url|endpoint|host/i;

    // `server.trustProxy` is a boolean — "is something in front of me?" — and
    // `server.host` is a bind address, not a destination. Listed rather than
    // pattern-matched away, so that a *new* key with a credential-shaped name
    // still fails this and has to be argued for here.
    //
    // The two `…Tokens` keys are counts of tokens in the *language-model* sense
    // — a context window and a completion reserve, both integers with minimums.
    // The word collides with the credential sense and the denylist is right to
    // stop on it; this is the argument it asks for.
    // `auth.minPasswordLength` trips the list twice, on `auth` and on
    // `password`, and both hits are the list doing its job: a section called
    // `auth` is exactly where somebody would later reach to put a signing key.
    // What is there is a *policy number* — how short a password this install
    // accepts when one is set. It is the length of a secret, not a secret, and
    // it is deliberately published to unauthenticated callers on
    // `GET /api/auth/state` so the first-run form can state the rule before
    // anybody types. A value handed to anyone who can reach the port is not a
    // credential; that is the argument this list asks for.
    //
    // `auth.loginScreen` trips it on `auth` alone and the argument is the same
    // shape, one notch weaker, which is why it is written out rather than
    // waved through: it is a two-value union naming **which arrival screen an
    // install shows** ([12 §1.1]), it is published on the same unauthenticated
    // `GET /api/auth/state` for the same reason — a pre-auth client cannot
    // choose a screen it has not been told about — and a value that is one of
    // exactly `form` and `gallery` has nowhere for a secret to hide.
    const knownSafe = [
      'server.trustProxy',
      'server.host',
      'auth.minPasswordLength',
      'auth.loginScreen',
      'limits.contextTokens',
      'limits.reservedCompletionTokens',
    ];

    const suspicious = configKeys().filter((key) => denied.test(key) && !knownSafe.includes(key));
    expect(suspicious).toEqual([]);
  });

  it('would catch a credential-shaped key if one were added', () => {
    // Guards the guard: the allowlist above must not have quietly become the
    // whole rule.
    const denied = /key|secret|password|token|credential|proxy|auth|url|endpoint|host/i;
    const knownSafe = ['server.trustProxy', 'server.host'];
    const hypothetical = ['server.host', 'providers.apiKey', 'log.level'];

    expect(hypothetical.filter((key) => denied.test(key) && !knownSafe.includes(key))).toEqual([
      'providers.apiKey',
    ]);
  });
});

/**
 * **A control cannot offer a value the schema refuses** — [work plan §2.3].
 *
 * The install form carried a hand-written list of log levels including `trace`,
 * which the union does not contain: picking it answered `400` and the form said
 * nothing. The list now travels as data, and this is the assertion that it is
 * the *same* list rather than a second copy that happens to agree today.
 */
describe('the closed unions travel with the config', () => {
  it('names every permitted value, and only those', () => {
    const choices = configChoices();

    // Read off the schema rather than retyped, so this test cannot become the
    // second copy it exists to prevent.
    const union = (ConfigSchema as unknown as SchemaNode).properties['log']?.properties['level']
      ?.anyOf;
    expect(choices['log.level']).toEqual(union?.map((member) => member.const));
    expect(choices['log.level']).not.toContain('trace');
  });

  it('reads a one-value union, which is a bare const', () => {
    // `log.format` is the only key like this, and TypeBox collapses a
    // single-member union to `const` — so it rendered as a free-text box over a
    // value the server refuses, one row below the control this function was
    // written to fix.
    expect(configChoices()['log.format']).toEqual(['json']);
  });

  it('finds a union nobody thought to look for', () => {
    // `updates.channel` was rendering as a free-text box over a three-value
    // union. One walk of the schema is what makes the surface complete rather
    // than complete for the keys somebody remembered.
    expect(configChoices()['updates.channel']).toEqual(['latest', 'testing', 'nightly']);
  });

  it('says nothing about keys that are not a closed choice', () => {
    const choices = configChoices();

    expect(choices['server.host']).toBeUndefined();
    expect(choices['limits.contextTokens']).toBeUndefined();
    // A boolean renders as `type: 'boolean'` rather than as `anyOf`, so it is
    // skipped by the shape of the walk rather than by a decision. The checkbox
    // already renders it either way.
    expect(choices['server.trustProxy']).toBeUndefined();
    // **Not asserted here: the non-string guard.** No key in the current schema
    // is a union of anything but string literals, so nothing exercises it and a
    // test claiming otherwise would be one of the vacuous ones this suite keeps
    // finding. It is named in `configChoices` as deliberately unexercised.
  });
});

/**
 * The environment layer — [P6A.0], [P6A §1.2], [21 §4],
 * [P10 §1.2](../../../docs/design/workplan/27-p10-implementation.md).
 *
 * **The claim the phase turns on is the first test**: a server that takes its
 * bind address from a variable with no config file anywhere. Until this stage
 * the server read exactly one environment variable in the whole codebase and it
 * was dev-only, so a container started against an empty volume fell back to
 * `127.0.0.1` — the container's own loopback — and was unreachable however its
 * port was mapped, while three comments in the repository said otherwise.
 *
 * The rest is precedence and refusal, which is where a layer like this actually
 * goes wrong: silently outranking a file somebody edited, silently eating a
 * value it could not parse, or silently applying a variable the operator never
 * set because a container runtime forwarded an empty one.
 *
 * `environmentDocument` then `loadConfig` is exactly the composition `main.ts`
 * performs, rather than a shortcut for the test: the validation that names the
 * variable lives in the first, and the layering in the second.
 */
describe('the environment layer', () => {
  it('binds where a variable says, with no config file at all', async () => {
    const loaded = await loadConfig(
      join(dir, 'nothing.json'),
      environmentDocument({ SE_HOST: '0.0.0.0' }),
    );

    expect(loaded.fileFound).toBe(false);
    expect(loaded.config.server.host).toBe('0.0.0.0');
    expect(loaded.environment.applied).toEqual(['SE_HOST']);
    // Everything it did not speak for is still the default, which is what makes
    // this a layer rather than a replacement.
    expect(loaded.config.server.port).toBe(DEFAULT_CONFIG.server.port);
  });

  it('loses to the file, and says which variables it lost', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ server: { host: '10.0.0.5' } }));

    const loaded = await loadConfig(
      path,
      environmentDocument({ SE_HOST: '0.0.0.0', SE_PORT: '9001' }),
    );

    // [P6A §1.2]: the file is what the settings page writes, so a value set
    // there outranks a variable — and the operator is told, because a variable
    // that is set and not applied is otherwise invisible.
    expect(loaded.config.server.host).toBe('10.0.0.5');
    expect(loaded.environment.shadowed).toEqual(['SE_HOST']);
    // The other one still applied. Shadowing is per key, not per document.
    expect(loaded.config.server.port).toBe(9001);
    expect(loaded.environment.applied).toEqual(['SE_PORT']);
  });

  it('reads a number as a number', () => {
    // The schema's `port` is an integer and a variable is always a string, so
    // the layer has to convert or every port would be refused. The type comes
    // from the schema rather than from a second list beside the table.
    expect(environmentDocument({ SE_PORT: '9001' })).toEqual({ server: { port: 9001 } });
  });

  it('refuses a value it cannot read, and names the variable that was typed', () => {
    // The message is the point. `validateConfigDocument` speaks in JSON
    // pointers, and `/server/port` sends an operator to a file they never
    // edited — this is a fault in their shell.
    expect(() => environmentDocument({ SE_PORT: 'banana' })).toThrow(ConfigError);
    expect(() => environmentDocument({ SE_PORT: 'banana' })).toThrow(/SE_PORT/);
    expect(() => environmentDocument({ SE_PORT: 'banana' })).not.toThrow(/server\/port/);
  });

  it('refuses a number the schema will not accept', () => {
    // Bounds are the schema's, not the layer's — there is one answer to
    // *would this start?* and it is the same one a config file gets.
    expect(() => environmentDocument({ SE_PORT: '99999' })).toThrow(/SE_PORT/);
  });

  it('treats an empty value as an unset variable', () => {
    // `docker compose`'s `environment: [SE_HOST]` forwards the host's variable,
    // and forwards an empty string when the host has not got one. Refusing that
    // would turn *the operator did nothing* into a failure to start.
    expect(environmentDocument({ SE_HOST: '', SE_PORT: '' })).toEqual({});
  });

  it('ignores a variable it does not map', () => {
    expect(environmentDocument({ SE_NONSENSE: 'x', PATH: '/usr/bin' })).toEqual({});
  });

  it('moves the data directory, which is where the config file is looked for', async () => {
    const loaded = await loadConfig(
      join(dir, 'nothing.json'),
      environmentDocument({ SE_DATA_DIR: '/srv/storyengine' }),
    );
    expect(loaded.config.dataDir).toBe('/srv/storyengine');
  });

  /**
   * **The ambient environment does not leak in.** `loadConfig` takes the
   * document rather than reading `process.env`, so a test that loads a config
   * does not depend on the machine it runs on — and the default is *no
   * environment*, which fails closed. The falsifying mutation is the obvious
   * convenience: defaulting the parameter to `environmentDocument(process.env)`.
   */
  it('reads nothing from the process unless it is handed it', async () => {
    vi.stubEnv('SE_HOST', '0.0.0.0');
    try {
      const loaded = await loadConfig(join(dir, 'nothing.json'));
      expect(loaded.config.server.host).toBe(DEFAULT_CONFIG.server.host);
      expect(loaded.environment.applied).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('maps only keys the schema has', () => {
    // The same mechanical check the tier table gets: a variable naming a key
    // that does not exist would be silently inert, and inert is the one thing
    // a bind-address override must never be.
    const keys = new Set(configKeys());
    expect(Object.values(CONFIG_ENVIRONMENT).filter((key) => !keys.has(key))).toEqual([]);
  });

  /**
   * **The variables are documented, which is the requirement rather than a
   * courtesy.** [P10 §1.2] asks for *one documented environment variable*
   * precisely so the container is not a build that behaves differently — an
   * undocumented variable would satisfy the code and fail the rule.
   *
   * Parsed out of the shipped document the same way the tier table is, for the
   * same reason: a table nothing checks is four keys behind within two phases.
   */
  it('matches the variable table in the internal contracts', async () => {
    const doc = await readFile(
      fileURLToPath(new URL('../../../docs/design/21-internal-contracts.md', import.meta.url)),
      'utf8',
    );

    const documented = new Map<string, string>();
    for (const line of doc.split('\n')) {
      const row = /^\|\s*`(SE_[A-Z_]+)`\s*\|\s*`([a-z][\w.]*)`\s*\|/.exec(line);
      if (row) documented.set(row[1] ?? '', row[2] ?? '');
    }

    // The table was found, so a regex that stopped matching fails here rather
    // than reporting agreement about nothing.
    expect(documented.size).toBeGreaterThan(0);
    expect(Object.fromEntries(documented)).toEqual(CONFIG_ENVIRONMENT);
  });
});

interface SchemaNode {
  properties: Record<string, { properties: Record<string, { anyOf?: { const: string }[] }> }>;
}
