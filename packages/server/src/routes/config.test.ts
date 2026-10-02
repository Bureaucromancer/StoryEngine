// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile, writeFile } from 'node:fs/promises';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../config.js';
import {
  makeTestServer,
  setUpAdmin,
  type TestServer,
  type TestServerOptions,
} from '../test-server.js';

/**
 * The install's settings — [10 §15.3](../../../../docs/design/10-ui-surfaces.md),
 * [P2A §3](../../../../docs/design/workplan/09-p2a-configuration-surface.md) stage P2A.5.
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
    // would falsify [21 §4]'s claim that the annotation *is* the source —
    // sending it means a key a newer build adds renders with the right badge
    // without a client release.
    expect(response.body.tiers['server.port']).toBe('restart');
    expect(response.body.tiers['log.level']).toBe('live');
  });

  /**
   * **And whether each live key is actually read**, which is what stops the form
   * ever showing a control that does nothing — the placeholder [work plan §2.2]
   * forbids.
   */
  it('says which live keys are stored and not yet read', async () => {
    const response = await server.request({ method: 'GET', url: '/api/admin/config' });

    expect(response.body.appliers['log.level']).toBe('applied');
    // The exemplar moved at P4.1: `limits.maxUploadMb` became `applied` when
    // the upload route arrived and started reading it per request, so the
    // still-honest example is a key nothing reads yet.
    // And moved again at [P11.7], which built the retention sweep —
    // `limits.extensionStorageQuotaMb` is the still-honest example now. *Twice,
    // and always in the same direction*: the exemplar keeps becoming read,
    // which means this check has never failed by a key quietly stopping.
    expect(response.body.appliers['limits.extensionStorageQuotaMb']).toBe('unread');
    expect(response.body.appliers['limits.maxUploadMb']).toBe('applied');
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

  /**
   * **`dataDir` cannot be written through this route** — F33.
   *
   * It decides where `config.json` itself lives, so a save that moved it would
   * be a one-click way to appear to lose everything: the next start reads a
   * different directory and finds an empty install. [P2A §2.6] argued the field
   * into a read-only note in the form for exactly that reason, **and then
   * enforced it in the browser only.**
   *
   * The trap is not somebody editing it. An *unedited* Save does it: the form
   * sends back the config it was given, that config carries the running
   * `dataDir` — which `--data` may have set to an absolute machine-specific
   * path — and the file gains it. Nobody has to touch the field.
   */
  it('does not write the data root, even when the body carries one', async () => {
    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('dataDir', '/somewhere/else') },
    });

    expect(response.status).toBe(200);
    // Not in the file — which is the whole point, because the file is what the
    // next start reads.
    expect(await onDisk()).not.toHaveProperty('dataDir');
    // And the running server did not move.
    expect(server.services.config.dataDir).not.toBe('/somewhere/else');
  });

  /**
   * The half that a naive fix breaks, and the reason this needs two tests.
   *
   * Dropping the key on the way in is not enough: the loader fills the default
   * for a key the file does not name, and `--data` sets a value no file ever
   * carried. So a save would have relocated a container's data root to `./data`
   * on the next restart — the same disaster arriving by the other door.
   */
  it('keeps the data root this process is actually using', async () => {
    const before = server.services.config.dataDir;

    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });

    expect(server.services.config.dataDir).toBe(before);
    // Nothing pending: the value did not change, so there is nothing to restart
    // for. A regression here reads as "the server wants a restart after every
    // save", which is how this was caught.
    const view = await server.request({ method: 'GET', url: '/api/admin/config' });
    expect(view.body.pendingRestart).toEqual([]);
  });

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
   * **What makes `auth.minPasswordLength`'s `applied` a fact rather than a
   * claim**, in both directions and with no restart between them.
   *
   * The rule it governs used to be a `minLength` literal in four TypeBox
   * schemas, which Ajv compiles once when the route is registered. Anyone who
   * put it back there would leave every other test green and only this one red.
   */
  it('changes what a password route accepts on the very next request', async () => {
    const raise = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('auth.minPasswordLength', 24) },
    });
    expect(raise.status).toBe(200);
    expect(raise.body.pendingRestart).toEqual([]);

    const refused = await server.request({
      method: 'POST',
      url: '/api/me/password',
      payload: { currentPassword: 'correct horse battery', newPassword: 'a dozen char' },
    });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('24');

    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('auth.minPasswordLength', 8) },
    });

    const accepted = await server.request({
      method: 'POST',
      url: '/api/me/password',
      payload: { currentPassword: 'correct horse battery', newPassword: 'a dozen char' },
    });
    expect(accepted.status).toBe(204);
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
 * structural claim [21 §4](../../../../docs/design/21-internal-contracts.md)
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
   * `apiKey` is the shape that matters: [21 §4] argues config has nowhere to
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
 * left to be rediscovered: [09 §6.2]'s hot-reload claim is about *content*,
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
      // [09 §6.4]: the notice ships, the button does not. A banner that invites
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

/**
 * **`log.level` through the route, not through `applyLiveConfig` directly.**
 *
 * `logging.test.ts` already proves the function assigns the level and that a
 * child logger inherits it. What it cannot see is *which instance the route
 * hands it*: `registerConfigRoutes` is called with the encapsulated `/api/admin`
 * plugin, so `applyLiveConfig(app, …)` reaches whatever `app.log` is inside a
 * plugin rather than necessarily the root.
 *
 * Asserted as an emitted line rather than as `services.config.log.level`,
 * because the record moving is exactly the thing that stays true when the
 * logger does not — which is the shape [P2A §3] predicted for this stage:
 * *assigning to the child half-works silently and is the likeliest bug in the
 * phase.*
 */
describe('log.level, applied by a save', () => {
  it('changes what the root logger emits, not just what the record says', async () => {
    const lines: string[] = [];
    const capture = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });

    const loud = await makeTestServer({
      dataDir: server.dataDir,
      config: { log: { level: 'info', format: 'json' } },
      logStream: capture,
    });
    try {
      await loud.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'ned', password: 'correct horse battery' },
      });

      loud.app.log.debug({ event: 'before' }, 'quiet');

      const saved = await loud.request({
        method: 'PUT',
        url: '/api/admin/config',
        payload: {
          config: { ...loud.services.config, log: { level: 'debug', format: 'json' } },
        },
      });
      expect(saved.status).toBe(200);

      loud.app.log.debug({ event: 'after' }, 'audible');

      const emitted = lines.join('');
      expect(emitted).not.toContain('"event":"before"');
      expect(emitted).toContain('"event":"after"');
    } finally {
      await loud.dispose();
    }
  });
});

/**
 * **Both ways out of a 412, and neither by accident** — gate step 15.
 *
 * The refusal is only half the mechanism. Until this was walked as a checklist,
 * the other half did not exist: the 412 returned without refreshing what the
 * process had read, and that field moves only at boot and after a successful
 * write — so **one hand edit wedged the form until the process restarted**,
 * including against a save carrying precisely what was on disk.
 *
 * A stage of mutation-proven tests missed it because the test named *allows a
 * second save, having seen its own first one* exercises a save after a
 * **successful** save. Nothing exercised a save after a refusal.
 */
describe('recovering from a hand edit', () => {
  async function refusedSave() {
    await writeFile(configPath(), JSON.stringify({ history: { keepPerObject: 7 } }));
    const refused = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });
    expect(refused.status).toBe(412);
    return refused;
  }

  it('takes the save once the form has loaded what is on disk', async () => {
    const refused = await refusedSave();
    const body = refused.body as { current: Record<string, unknown>; contentHash: string };

    const recovered = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: body.current, contentHash: body.contentHash },
    });

    expect(recovered.status).toBe(200);
    expect((await onDisk())['history']).toMatchObject({ keepPerObject: 7 });
  });

  it('takes the save when the admin chooses to overwrite with theirs', async () => {
    const refused = await refusedSave();
    const body = refused.body as { contentHash: string };

    // The same acknowledgement, different values beside it — which is the whole
    // difference between the two offers, and why neither can happen by
    // accident.
    const overwritten = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug'), contentHash: body.contentHash },
    });

    expect(overwritten.status).toBe(200);
    expect((await onDisk())['log']).toMatchObject({ level: 'debug' });
  });

  it('refuses a plain re-save, so neither recovery happens by accident', async () => {
    await refusedSave();

    // No acknowledgement: the admin has not said which they want, and pressing
    // Save again must not silently pick one.
    const again = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug') },
    });

    expect(again.status).toBe(412);
    expect((await onDisk())['history']).toMatchObject({ keepPerObject: 7 });
  });

  it('refuses an acknowledgement of something that is not what is on disk', async () => {
    const refused = await refusedSave();
    const body = refused.body as { contentHash: string };
    // The file moves again between the refusal and the retry.
    await writeFile(configPath(), JSON.stringify({ history: { keepPerObject: 9 } }));

    const stale = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'debug'), contentHash: body.contentHash },
    });

    // An acknowledgement is of a specific document, not a bypass.
    expect(stale.status).toBe(412);
  });

  /**
   * **The read hands out the same acknowledgement**, so a form that loaded
   * *after* somebody edited the file can save without first being refused.
   *
   * The scenario is what makes this assertion mean anything: the hand edit
   * happens first, so the document comparison would refuse — and the only thing
   * that lets the save through is the hash this read returned. Asserting it on
   * a clean install would pass with no hash at all, because there is nothing to
   * be stale against. That is how the first version of this test survived
   * deleting the field.
   */
  it('hands out an acknowledgement a later save can present', async () => {
    await writeFile(configPath(), JSON.stringify({ history: { keepPerObject: 7 } }));

    const read = await server.request({ method: 'GET', url: '/api/admin/config' });
    expect(typeof read.body.contentHash).toBe('string');

    const saved = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: withChange('log.level', 'warn'), contentHash: read.body.contentHash },
    });

    expect(saved.status).toBe(200);
  });
});

/**
 * ***What a save writes, and whether the next start could use it***
 * (2026-09-27).
 *
 * Three faults in one write. The form sends the whole running config back and
 * every key was written, so one unedited Save copied the environment's
 * `SE_HOST`, `SE_PORT` and `SE_CLIENT_ROOT` into the file, where they outrank
 * the environment for good. The config the write said would run had no
 * environment under it, so on a container it was not the config a restart
 * ran. And the only question asked of it was the schema's, which passes an
 * address this machine lacks, a port something else holds, a client root with
 * no build and `Secure` cookies over plain HTTP — each a start that failed or
 * could not be reached, with no settings page left to undo it from.
 */
describe('what a save writes, and whether the next start could use it', () => {
  /** A server as a container boots one: `SE_HOST` and `SE_PORT` set. */
  async function containerServer(
    startable: TestServerOptions['startable'] = {},
  ): Promise<TestServer> {
    const environment = { server: { host: '0.0.0.0', port: 8123 } };
    const container = await makeTestServer({
      environment,
      config: { server: { ...DEFAULT_CONFIG.server, ...environment.server } },
      startable,
    });
    // Bound beyond loopback, so setup wants the console's token, as it should.
    const setUp = await container.request({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {
        handle: 'ned',
        password: 'correct horse battery',
        setupToken: container.services.setupToken ?? '',
      },
    });
    expect(setUp.status).toBe(201);
    return container;
  }

  async function save(
    target: TestServer,
    change: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: any }> {
    const config = structuredClone(target.services.config) as Record<string, unknown>;
    for (const [path, value] of Object.entries(change)) {
      const parts = path.split('.');
      const last = parts.pop()!;
      let node = config;
      for (const part of parts) node = node[part] as Record<string, unknown>;
      node[last] = value;
    }
    return target.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config },
      headers,
    });
  }

  async function fileOf(target: TestServer): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(target.services.configPath, 'utf8')) as Record<
      string,
      unknown
    >;
  }

  it('writes what was changed, not what the environment or the defaults already say', async () => {
    const container = await containerServer();
    try {
      const saved = await save(container, { 'log.level': 'debug' });

      expect(saved.status).toBe(200);
      expect(await fileOf(container)).toEqual({ log: { level: 'debug' } });
      // Resolved with the environment under the file, as a restart will be, so
      // nothing reads as waiting for one.
      expect(saved.body.pendingRestart).toEqual([]);
    } finally {
      await container.dispose();
    }
  });

  it('hands a refused save the config that file would start on, environment included', async () => {
    const container = await containerServer();
    try {
      // A hand edit the form has not seen: the stale check refuses the save.
      await writeFile(container.services.configPath, JSON.stringify({ log: { level: 'warn' } }));

      const refused = await save(container, { 'log.level': 'debug' });

      expect(refused.status).toBe(412);
      // What a start on that file would bind: `SE_HOST` under it, not the default.
      expect(refused.body.current.server).toMatchObject({ host: '0.0.0.0', port: 8123 });
    } finally {
      await container.dispose();
    }
  });

  it('still writes a value somebody changed where the environment set one', async () => {
    const container = await containerServer();
    try {
      const saved = await save(container, { 'server.port': 9123 });

      expect(saved.status).toBe(200);
      // The section only: a test server runs `log.level: silent`, which no
      // file or variable says, so it is a value this save differs on.
      expect((await fileOf(container))['server']).toEqual({ port: 9123 });
      expect(saved.body.pendingRestart).toEqual(['server.port']);
    } finally {
      await container.dispose();
    }
  });

  it('writes a value put back to its default when the file had set it', async () => {
    // The file's word is written whatever it equals, so *overwrite with mine*
    // overwrites — here, setting a level back to the default takes.
    await writeFile(configPath(), JSON.stringify({ log: { level: 'debug' } }));
    const restarted = await makeTestServer({ dataDir: server.dataDir });
    try {
      // The directory already has its admin, from the server this borrowed it from.
      await restarted.request({
        method: 'POST',
        url: '/api/auth/login',
        payload: { handle: 'ned', password: 'correct horse battery' },
      });
      const saved = await save(restarted, { 'log.level': 'info' });

      expect(saved.status).toBe(200);
      expect(restarted.services.config.log.level).toBe('info');
      expect(await fileOf(restarted)).toEqual({ log: { level: 'info' } });
    } finally {
      await restarted.dispose();
    }
  });

  it('refuses a client root with no build in it, and writes nothing', async () => {
    const before = await readFile(configPath(), 'utf8').catch(() => null);

    const refused = await save(server, { 'server.clientRoot': '/no/build/was/ever/here' });

    expect(refused.status).toBe(400);
    expect(refused.body.issues.join(' ')).toMatch(/\/server\/clientRoot has no index\.html/);
    expect(await readFile(configPath(), 'utf8').catch(() => null)).toBe(before);
  });

  it('refuses an address this machine does not have, and takes the wildcard and loopback', async () => {
    const refused = await save(server, { 'server.host': '203.0.113.7' });
    expect(refused.status).toBe(400);
    expect(refused.body.issues.join(' ')).toMatch(
      /\/server\/host 203\.0\.113\.7 is not an address/,
    );

    expect((await save(server, { 'server.host': '0.0.0.0' })).status).toBe(200);
    expect((await save(server, { 'server.host': '::1' })).status).toBe(200);
  });

  it('asks a name what it resolves to here', async () => {
    const lost = await containerServer({
      resolveHost: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
    });
    try {
      const refused = await save(lost, { 'server.host': 'storyengine.local' });
      expect(refused.status).toBe(400);
      expect(refused.body.issues.join(' ')).toMatch(/does not resolve/);
    } finally {
      await lost.dispose();
    }

    const found = await containerServer({ resolveHost: () => Promise.resolve('127.0.0.1') });
    try {
      expect((await save(found, { 'server.host': 'storyengine.local' })).status).toBe(200);
    } finally {
      await found.dispose();
    }
  });

  it('refuses a port the next start could not listen on', async () => {
    const held = await containerServer({
      trialListen: () =>
        Promise.reject(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })),
    });
    try {
      const refused = await save(held, { 'server.port': 9124 });

      expect(refused.status).toBe(400);
      expect(refused.body.issues.join(' ')).toMatch(/\/server\/port 9124 .*EADDRINUSE/);
      expect(held.services.config.server.port).toBe(8123);
    } finally {
      await held.dispose();
    }
  });

  it('does not try the port it already holds when only the address changes', async () => {
    // The port this process listens on would refuse its own trial.
    let tried = 0;
    const counting = await containerServer({
      trialListen: () => {
        tried += 1;
        return Promise.resolve();
      },
    });
    try {
      expect((await save(counting, { 'server.host': '127.0.0.1' })).status).toBe(200);
      expect(tried).toBe(0);
    } finally {
      await counting.dispose();
    }
  });

  it('refuses Secure cookies asked for over plain HTTP', async () => {
    const refused = await save(server, { 'server.cookieSecure': true });

    expect(refused.status).toBe(400);
    expect(refused.body.issues.join(' ')).toMatch(/\/server\/cookieSecure/);
    // A proxy's word counts only where the next start will trust it.
    const unproxied = await save(
      server,
      { 'server.cookieSecure': true },
      { 'x-forwarded-proto': 'https' },
    );
    expect(unproxied.status).toBe(400);
  });

  it('takes Secure cookies with trustProxy in the same save, behind an HTTPS proxy', async () => {
    const saved = await save(
      server,
      { 'server.cookieSecure': true, 'server.trustProxy': true },
      { 'x-forwarded-proto': 'https' },
    );

    expect(saved.status).toBe(200);
  });
});
