// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile, writeFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../config.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The install's settings — [05 §15.3](../../../../docs/design/05-ui-surfaces.md),
 * [P2A §3](../../../../docs/design/workplan/13-p2a-configuration-surface.md) stage P2A.5.
 *
 * The stage's ending is four clauses: *the whole `Config` shape is writable, an
 * unknown key from a newer build survives the round trip, a key the caller
 * invents does not reach disk, and every admin sees the same pending list.*
 *
 * The asymmetry in the middle two is the interesting part and it is deliberate:
 * unknown keys **in the body** are dropped, unknown keys **in the file** are
 * preserved. A newer build's key may legitimately be on disk; no client may
 * invent one.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

/** The config file this server would write to — the same path the route uses. */
function configPath(): string {
  return server.services.configPath;
}

async function onDisk(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown>;
}

/** The running config, with one leaf changed — the shape the form submits. */
function withChange(path: string, value: unknown): Record<string, unknown> {
  const config = structuredClone(server.services.config) as Record<string, unknown>;
  const parts = path.split('.');
  const last = parts.pop()!;
  let node = config;
  for (const part of parts) node = node[part] as Record<string, unknown>;
  node[last] = value;
  return config;
}

describe('GET /api/admin/config', () => {
  it('carries the tier table as data, so the client does not keep a copy', async () => {
    const response = await server.request({ method: 'GET', url: '/api/admin/config' });

    expect(response.status).toBe(200);
    // The client may not import from the server package, and a duplicated table
    // would falsify [13 §4]'s claim that the annotation *is* the source —
    // sending it means a key a newer build adds renders with the right badge
    // without a client release.
    expect(response.body.tiers['server.port']).toBe('restart');
    expect(response.body.tiers['log.level']).toBe('live');
  });

  /**
   * **And whether each live key is actually read**, which is what stops the form
   * ever showing a control that does nothing — the placeholder [01 §2.2]
   * forbids.
   */
  it('says which live keys are stored and not yet read', async () => {
    const response = await server.request({ method: 'GET', url: '/api/admin/config' });

    expect(response.body.appliers['log.level']).toBe('applied');
    expect(response.body.appliers['limits.maxUploadMb']).toBe('unread');
  });

  it('names the file it would write to', async () => {
    const response = await server.request({ method: 'GET', url: '/api/admin/config' });

    // The form renders `dataDir` read-only pointing at this, because a field
    // that moves the data directory and then writes to the old one is a
    // one-click way to appear to lose everything.
    expect(response.body.path).toBe(configPath());
  });
});

describe('PUT /api/admin/config', () => {
  /**
   * Gate step 12: change `log.level` in the form → the next log line is at the
   * new level, with no restart and no banner.
   */
  it('applies a live key immediately, with nothing pending', async () => {
    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });

    expect(response.status).toBe(200);
    expect(response.body.pendingRestart).toEqual([]);
    // Read off the running record rather than the response, because the claim
    // is that the *server* changed rather than that the handler echoed.
    expect(server.services.config.log.level).toBe('debug');
    expect((await onDisk())['log']).toMatchObject({ level: 'debug' });
  });

  /**
   * Gate step 13, the first half: a restart-tier change names itself and does
   * **not** take effect.
   */
  it('names a restart-tier change instead of pretending it took', async () => {
    const bound = server.services.config.server.port;

    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('server.port', 9999) },
    });

    expect(response.body.pendingRestart).toEqual(['server.port']);
    // The record moves — that is what makes the *next* start use it — while the
    // listener does not, which is exactly what the notice is for.
    expect(server.services.config.server.port).toBe(9999);
    expect(server.services.bootConfig.server.port).toBe(bound);
  });

  /**
   * Gate step 13, the second half: change it back and the banner clears.
   *
   * This is what makes the notice self-healing, and it only works because it is
   * derived from the boot config rather than accumulated — a stored pending set
   * would still be claiming `server.port` here.
   */
  it('clears the notice when the value goes back to what this process bound', async () => {
    const bound = server.services.config.server.port;
    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('server.port', 9999) },
    });

    const back = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('server.port', bound) },
    });

    expect(back.body.pendingRestart).toEqual([]);
  });

  it('writes a file the process can actually start on', async () => {
    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('history.keepPerObject', 5) },
    });

    // The strongest available statement of "valid": start a second server on
    // the same data directory and watch it read the file.
    const restarted = await makeTestServer({ dataDir: server.dataDir });
    try {
      expect(restarted.services.config.history.keepPerObject).toBe(5);

      /**
       * **And the module-level defaults are untouched**, which is not a
       * paragraph about hygiene — it is the bug this test found.
       *
       * `mergeDefaults` copies one level per recursion, so a key the file does
       * not mention comes back as the *same nested object* `DEFAULT_CONFIG`
       * holds. Once [P2A §2.5] made `applyLiveConfig` assign in place, one save
       * rewrote the defaults for the life of the process — and this test passed
       * *because of it*, reading 5 from a mutated default rather than from the
       * file it claimed to be about.
       */
      expect(DEFAULT_CONFIG.history.keepPerObject).toBe(50);
    } finally {
      await restarted.dispose();
    }
  });

  it('refuses a value the schema will not have, without touching the file', async () => {
    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });
    const before = await onDisk();

    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('server.port', 'not a port') },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid');
    // Validated *before* the write, so a refused save cannot leave a file the
    // server would refuse to start on — the one outcome a settings form must
    // never produce.
    expect(await onDisk()).toEqual(before);
  });
});

/**
 * **Unknown keys in the file are preserved; unknown keys in the body are
 * dropped** — [P2A §2.5], gate step 14.
 *
 * The asymmetry is the correct one and both halves matter. A newer build's key
 * may legitimately be on disk, and eating it would make a downgrade
 * destructive. No client may invent one, and accepting one would falsify the
 * structural claim [13 §4](../../../../docs/design/13-internal-contracts.md)
 * makes about config having nowhere to put a credential.
 */
describe('what survives a round trip', () => {
  it('keeps a key on disk that this build has never heard of', async () => {
    await writeFile(
      configPath(),
      JSON.stringify({ log: { level: 'info' }, futureFeature: { enabled: true } }),
    );
    // A second server, so the process has actually *read* the file it is about
    // to write back — which is the situation an upgrade produces.
    const upgraded = await makeTestServer({ dataDir: server.dataDir });
    try {
      await upgraded.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'ned', password: 'correct horse battery' },
      });
      const response = await upgraded.request({
        method: 'PUT',
        url: '/api/admin/config',
        payload: { config: { ...upgraded.services.config, log: { level: 'debug' } } },
      });
      expect(response.status).toBe(200);

      const after = JSON.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown>;
      expect(after['futureFeature']).toEqual({ enabled: true });
      expect(after['log']).toMatchObject({ level: 'debug' });
    } finally {
      await upgraded.dispose();
    }
  });

  /**
   * **And a key the caller invents never reaches disk** — not because it was
   * rejected, but because the pick never looked at it.
   *
   * `apiKey` is the shape that matters: [13 §4] argues config has nowhere to
   * put a credential, and an unknown-key-preserving write over an open schema
   * would have made that false the moment somebody sent one.
   */
  it('drops a key the caller invented, credential-shaped or not', async () => {
    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: {
        config: {
          ...server.services.config,
          apiKey: 'sk-must-never-land',
          nonsense: { deeply: 'nested' },
        },
      },
    });

    expect(response.status).toBe(200);
    const after = await onDisk();
    expect(after['apiKey']).toBeUndefined();
    expect(after['nonsense']).toBeUndefined();
    expect(JSON.stringify(after)).not.toContain('sk-must-never-land');
  });
});

/**
 * **The stale check is what makes the form safe against a text editor** without
 * a watcher — [P2A §2.5], gate step 15.
 *
 * No config watcher lands this phase, and the reason is recorded rather than
 * left to be rediscovered: [04 §6.2]'s hot-reload claim is about *content*,
 * config is explicitly not content, and a check on write gives the settings form
 * everything a watcher would without introducing a second writer to the
 * in-memory record on the day the first one ships.
 */
describe('a hand edit while the form is open', () => {
  it('refuses the save and hands back what is on disk', async () => {
    await writeFile(configPath(), JSON.stringify({ history: { keepPerObject: 7 } }));

    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });

    expect(response.status).toBe(412);
    expect(response.body.error).toBe('stale');
    // Carrying the current document, so the client can offer *load what is on
    // disk* or *overwrite with mine* rather than only being told no.
    expect(response.body.current.history.keepPerObject).toBe(7);
    expect(response.body.currentDocument).toEqual({ history: { keepPerObject: 7 } });
  });

  it('leaves the hand edit exactly where it was', async () => {
    const edited = JSON.stringify({ history: { keepPerObject: 7 } });
    await writeFile(configPath(), edited);

    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });

    expect(await readFile(configPath(), 'utf8')).toBe(edited);
  });

  it('does not cry wolf over a reordered file', async () => {
    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });
    const written = await onDisk();

    // The same document with its keys in a different order, which JSON says is
    // the same document. A stale check firing here would be one an admin
    // learned to click through.
    await writeFile(
      configPath(),
      JSON.stringify(Object.fromEntries(Object.entries(written).reverse())),
    );

    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'warn') },
    });

    expect(response.status).toBe(200);
  });

  /**
   * **A broken file does not block a write that fixes it.**
   *
   * Refusing here would trap the admin inside the problem they are trying to
   * leave — with the settings form as the one tool that could repair it and the
   * one tool that will not.
   */
  it('lets a save through when the file on disk will not parse', async () => {
    await writeFile(configPath(), '{ not json at all');

    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });

    expect(response.status).toBe(200);
    expect((await onDisk())['log']).toMatchObject({ level: 'debug' });
  });

  it('allows a second save, having seen its own first one', async () => {
    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });

    // Without the document being updated on write, this compares against what
    // was read at boot and refuses its own predecessor's work.
    const second = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'warn') },
    });

    expect(second.status).toBe(200);
  });
});

describe('GET /api/admin/notices', () => {
  it('is the same list every admin sees, and says the server will not restart itself', async () => {
    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('server.port', 9999) },
    });

    await server.services.accounts.create({
      handle: 'mara',
      password: 'another long password',
      role: 'admin',
    });

    // A second browser and a second admin, so "every admin sees the same list"
    // is asserted rather than assumed — it is one process and one answer, not a
    // per-session note. (This second server reads the config file, so its own
    // boot config already has 9999; what it reports is *this* process's
    // pending list, which is the point of the route being on the server.)
    const theirs = await makeTestServer({ dataDir: server.dataDir });
    try {
      await theirs.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'mara', password: 'another long password' },
      });
      const response = await theirs.request({ method: 'GET', url: '/api/admin/notices' });

      expect(response.status).toBe(200);
      // [04 §6.4]: the notice ships, the button does not. A banner that invites
      // "so how do I restart it?" is a worse answer than one that says.
      expect(response.body.canRestart).toBe(false);
    } finally {
      await theirs.dispose();
    }

    // And on this process — the one actually bound to the old port — the change
    // is outstanding and named.
    const mine = await server.request({ method: 'GET', url: '/api/admin/notices' });
    expect(mine.body.pendingRestart).toEqual(['server.port']);
  });

  it('is empty on a server nothing has changed', async () => {
    const response = await server.request({ method: 'GET', url: '/api/admin/notices' });

    expect(response.body.pendingRestart).toEqual([]);
  });
});

/**
 * **A save must not rewrite the module-level defaults** — the bug this stage
 * found, and the one shape of it that is actually reachable.
 *
 * `mergeDefaults` copies one level per recursion, so a section the config file
 * does not mention comes back as the *same nested object* `DEFAULT_CONFIG`
 * holds. Once [P2A §2.5] made `applyLiveConfig` assign in place, one settings
 * save then rewrote the defaults for the life of the process.
 *
 * Reaching it needs a file that **omits** the section being changed, which is
 * the ordinary case: `config.example.json` is commented rather than complete,
 * and most installs set two or three keys. A server with no file at all cannot
 * reproduce it — `loadConfig` clones the defaults wholesale there — and that is
 * exactly why the first version of this test passed against the broken code.
 */
describe('the module defaults', () => {
  it('survive a save that touches a section the file never mentioned', async () => {
    // A sparse file, the way an operator writes one.
    await writeFile(configPath(), JSON.stringify({ log: { level: 'silent' } }));
    const sparse = await makeTestServer({ dataDir: server.dataDir });
    try {
      await sparse.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'ned', password: 'correct horse battery' },
      });

      const response = await sparse.request({
        method: 'PUT',
        url: '/api/admin/config',
        payload: {
          config: {
            ...sparse.services.config,
            history: { keepPerObject: 3 },
          },
        },
      });
      expect(response.status).toBe(200);
      expect(sparse.services.config.history.keepPerObject).toBe(3);

      // The whole claim: the process's idea of "the default" is unchanged.
      //
      // Two clones stand behind this — the loader's and `buildServices`' — and
      // either alone is enough, so reverting one at a time leaves this green.
      // That is deliberate rather than an oversight, and it is recorded here so
      // the next person to find one "unnecessary" reads why it is not.
      expect(DEFAULT_CONFIG.history.keepPerObject).toBe(50);
    } finally {
      await sparse.dispose();
    }
  });
});
