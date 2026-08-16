// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONFIG_TIERS,
  ConfigError,
  configKeys,
  DEFAULT_CONFIG,
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

  it('refuses a file that is not JSON, and says so', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, '{ not json');

    await expect(loadConfig(path)).rejects.toThrow(/not valid JSON/);
  });
});

describe('config has nowhere to put a credential', () => {
  it('declares no key that looks like one', () => {
    // The same structural enforcement the portable schemas get
    // ([00 §3.2](../../../docs/design/00-stance.md), [18 §4]): connections live in
    // `connections/`, and a check can be forgotten where a missing field
    // cannot.
    const denied = /key|secret|password|token|credential|proxy|auth|url|endpoint|host/i;

    // `server.trustProxy` is a boolean — "is something in front of me?" — and
    // `server.host` is a bind address, not a destination. Listed rather than
    // pattern-matched away, so that a *new* key with a credential-shaped name
    // still fails this and has to be argued for here.
    const knownSafe = ['server.trustProxy', 'server.host'];

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
