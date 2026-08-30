// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONFIG_TIERS,
  ConfigError,
  ConfigSchema,
  DEFAULT_CONFIG,
  LIVE_APPLIERS,
  applierOf,
  configChoices,
  configKeys,
  loadConfig,
  pendingRestart,
  tierOf,
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
    // [06 D0](../../../docs/design/06-open-questions.md) requires every key to be
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
    // [01 §2.3](../../../docs/design/workplan/01-work-plan.md): configuration
    // ships with its surface, and `config.example.json` is the surface every
    // operator meets first — its own header calls the settings UI "the primary
    // path", which makes this file the other one. Four keys had already drifted
    // out of it before anybody looked, which is the argument for a test rather
    // than a habit.
    //
    // Named as out of scope at [P2 §3](../../../docs/design/workplan/04-p2-implementation.md)
    // because it cited no finding; it enters at
    // [P2A §3](../../../docs/design/workplan/13-p2a-configuration-surface.md).
    const example = await readFile(
      fileURLToPath(new URL('../../../config.example.json', import.meta.url)),
      'utf8',
    );
    // JSON has no comments, which is the one real cost of JSON everywhere
    // ([02 §5.4]) and the reason this file is not loadable as it stands. Strip
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
   * request. `trash.retentionDays` takes its place — tiered `live` because a
   * retention window is a thing an operator changes and expects to matter,
   * unread because nothing prunes on it yet. That the exemplar had to move is
   * the table working: a key stops being an example of dishonesty by becoming
   * honest.
   */
  it('admits that some live keys are stored and not read', () => {
    expect(applierOf('trash.retentionDays')).toBe('unread');
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
   * **The tier table in [13 §4] names exactly the keys the schema has, with the
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
      fileURLToPath(new URL('../../../docs/design/13-internal-contracts.md', import.meta.url)),
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

  it('keeps the bind address on restart', () => {
    expect(tierOf('server.host')).toBe('restart');
    expect(tierOf('log.level')).toBe('live');
  });
});

describe('the restart-required notice is derived', () => {
  it('names the specific keys that changed', () => {
    // [04 §6.3](../../../docs/design/04-server-multiuser-deployment.md): the banner lists
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
    // ([04 §5.1](../../../docs/design/04-server-multiuser-deployment.md)): between first
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
    // ([00 §3.2](../../../docs/design/00-stance.md), [13 §4]): connections live in
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
    const knownSafe = [
      'server.trustProxy',
      'server.host',
      'auth.minPasswordLength',
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
 * **A control cannot offer a value the schema refuses** — [01 §2.3].
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

interface SchemaNode {
  properties: Record<string, { properties: Record<string, { anyOf?: { const: string }[] }> }>;
}
