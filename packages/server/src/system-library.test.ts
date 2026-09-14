// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { PRESET_SCHEMA, slugify } from '@storyengine/shared';

import { registeredModes } from './mode-registry.js';
import { SYSTEM_OWNER } from './storage/layout.js';
import { materialiseModePresets } from './system-library.js';
import { makeTestServer, setUpAdmin, type TestServer } from './test-server.js';

/**
 * **The system library has contents** — [P7B.0].
 *
 * Six phases of `system/library/` being described as *"shipped, read-only,
 * loaded for everyone"* with nothing in it, which meant the merge, the badge,
 * the read-only refusals and *Copy to my library* were all built against a
 * scope that had never once held an object. These tests are the first thing in
 * the repository that puts one there.
 *
 * **The assertion that matters most is the second one**, and it is the one that
 * would be easy to leave out: *a restart writes nothing*. Every other property
 * here fails loudly. That one fails silently, as a history version per restart
 * on an object nobody edited, and it is only true because `system-library.ts`
 * shares `encodeObject` with the request path rather than spelling the JSON a
 * second time.
 */

let servers: TestServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.dispose()));
  servers = [];
});

async function start(dataDir?: string): Promise<TestServer> {
  const server = await makeTestServer(dataDir === undefined ? {} : { dataDir });
  servers.push(server);
  return server;
}

describe('the built-in packs reach the system library', () => {
  it('writes one per registered mode, at the mode-derived slug', async () => {
    const server = await start();
    const { layout } = server.services;

    // Against the registry rather than a hard-coded pair, because the claim is
    // *every loaded mode* — a third mode arriving must not need this edited,
    // which is the same reason `system-library.ts` iterates rather than lists.
    const modes = registeredModes();
    expect(modes.length).toBeGreaterThan(0);

    for (const mode of modes) {
      // `slugify`, not a regex spelled here: a second spelling of the rule is
      // a test that keeps passing after the rule changes under it.
      const path = layout.objectFile(SYSTEM_OWNER, PRESET_SCHEMA, slugify(mode.definition.id));
      const stored: unknown = JSON.parse(await readFile(path, 'utf8'));

      expect(stored).toMatchObject({
        schema: PRESET_SCHEMA,
        // The declared id, unchanged. A pack whose id moved between builds
        // would orphan every session that named it.
        id: mode.definition.assembly.defaultPreset.id,
      });
    }
  });

  it('writes nothing on a restart that changes nothing', async () => {
    const first = await start();
    const { dataDir } = first;
    await first.dispose();
    servers = servers.filter((server) => server !== first);

    const second = await start(dataDir);

    // Boot already ran the materialiser once on this directory. Running it
    // again is the restart, and every pack should come back untouched.
    const again = await materialiseModePresets(second.services.index.db, second.services.layout);

    expect(again.length).toBeGreaterThan(0);
    expect(again.map((one) => one.written)).toEqual(again.map(() => false));

    await rm(dataDir, { recursive: true, force: true });
  });

  it('overwrites a hand edit, because that is what shipped means', async () => {
    const first = await start();
    const { dataDir, services } = first;
    const firstMode = registeredModes()[0];
    expect(firstMode).toBeDefined();
    const path = services.layout.objectFile(
      SYSTEM_OWNER,
      PRESET_SCHEMA,
      slugify(String(firstMode?.definition.id)),
    );

    const original = await readFile(path, 'utf8');
    const edited: Record<string, unknown> = JSON.parse(original) as Record<string, unknown>;
    edited['name'] = 'Hand edited';
    await writeFile(path, `${JSON.stringify(edited, null, 2)}\n`);

    await first.dispose();
    servers = servers.filter((server) => server !== first);

    const second = await start(dataDir);
    expect(await readFile(path, 'utf8')).toBe(original);

    // And once boot has put it back, a further pass writes nothing — the same
    // predicate as the test above, here proving the overwrite was a comparison
    // reaching a different answer rather than an unconditional rewrite.
    const again = await materialiseModePresets(second.services.index.db, second.services.layout);
    expect(again.map((one) => one.written)).toEqual(again.map(() => false));

    await rm(dataDir, { recursive: true, force: true });
  });
});

describe('a materialised pack behaves like every other system object', () => {
  it('lists for an ordinary account, marked as the system’s', async () => {
    const server = await start();
    await setUpAdmin(server);

    const listed = await server.request({ method: 'GET', url: '/api/library/presets' });
    expect(listed.status).toBe(200);

    const fromSystem = (listed.body.objects as { source?: string; id: string }[]).filter(
      (row) => row.source === 'system',
    );
    expect(fromSystem.length).toBe(registeredModes().length);
  });

  it('refuses edit and delete through the routes that already refuse them', async () => {
    const server = await start();
    await setUpAdmin(server);

    const listed = await server.request({ method: 'GET', url: '/api/library/presets' });
    const one = (listed.body.objects as { source?: string; id: string }[]).find(
      (row) => row.source === 'system',
    );
    expect(one).toBeDefined();

    const written = await server.request({
      method: 'PUT',
      url: `/api/library/presets/${String(one?.id)}`,
      payload: { ...(one as object), name: 'Mine now' },
    });
    expect(written.status).toBeGreaterThanOrEqual(400);

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/presets/${String(one?.id)}`,
    });
    expect(removed.status).toBeGreaterThanOrEqual(400);
  });
});
