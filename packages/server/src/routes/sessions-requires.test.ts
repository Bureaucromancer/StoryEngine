// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newSetup, newWorld, type Setup, uuidv7, type World } from '@storyengine/shared';

import { DEFAULT_MODE_ID, modeById } from '../mode-registry.js';
import { appendTurnToSession } from '../sessions/store.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Starting what this install cannot fully play*** — 2026-10-13, the owner's
 * answer to *"Build the promise, or narrow the notes"*: build it.
 * [04 §9](../../../../docs/design/04-schemas.md) and
 * [03 §7.2](../../../../docs/design/03-data-model.md) promise *"this wants
 * Campaign ≥ 2 and an image connection; you have neither"* rather than a broken
 * session later, and **a degraded-start option rather than a hard block where
 * possible**.
 *
 * So `POST /api/sessions` checks what the World it starts in asks for — its
 * authored `requires` — and whether the Setup it starts through names a mode
 * this install has. Anything unmet is `422 unmet-requirements`, with the list;
 * the same request with `degraded: true` starts, each requirement degraded,
 * and the session keeps what it started without. A `mode` the caller names
 * outright is not imported content, and stays `unknown-mode`.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

const MISSING = 'storyengine.not-installed';

async function created(kind: string, payload: unknown): Promise<void> {
  const response = await server.request({ method: 'POST', url: `/api/library/${kind}`, payload });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function start(payload: Record<string, unknown>) {
  return server.request({ method: 'POST', url: '/api/sessions', payload });
}

async function sessionFile(sessionId: string): Promise<any> {
  return JSON.parse(
    await readFile(
      join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json'),
      'utf8',
    ),
  );
}

async function sessionCount(): Promise<number> {
  const listed = await server.request({ method: 'GET', url: '/api/sessions' });
  return (listed.body.sessions as unknown[]).length;
}

/** A Setup for a mode this install does not have, answering that mode's wizard. */
async function setupElsewhere(): Promise<Setup> {
  const setup: Setup = {
    ...newSetup('From a newer build'),
    mode: { id: MISSING, config: { premise: 'Rain over the harbour.' } },
  };
  await created('setups', setup);
  return setup;
}

/** A World holding these members, asking for this, as an author wrote it by hand. */
async function worldAsking(
  requires: Partial<World['requires']>,
  members: { schema: string; id: string; name: string }[] = [],
): Promise<World> {
  const world: World = {
    ...newWorld('Rain City'),
    contents: members,
    requires: { modes: [], extensions: [], capabilities: [], ...requires },
  };
  await created('worlds', world);
  return world;
}

/** `prose` bound for everybody, on a connection the install holds. */
async function bindProse(): Promise<void> {
  const layout = new Layout(server.dataDir);
  await mkdir(layout.systemConnectionsRoot, { recursive: true });
  const id = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a13';
  await writeFile(
    join(layout.systemConnectionsRoot, 'house.json'),
    JSON.stringify({
      id,
      label: 'The house model',
      provider: 'openai-compatible',
      models: ['house-hi'],
      capabilities: { maxContextTokens: 32_000 },
    }),
  );
  await writeFile(
    layout.systemBindingsFile,
    JSON.stringify({ prose: { connectionId: id, modelId: 'house-hi' } }),
  );
}

const envelope = (object: { schema: string; id: string; name: string }) => ({
  schema: object.schema,
  id: object.id,
  name: object.name,
});

describe('a start that wants what this install lacks', () => {
  /**
   * ***Refused with the list, and nothing made*** — the World's only Setup
   * names a mode that is not installed. The refusal names it, with no version
   * (a Setup names its mode by id alone) and `installed: null`, before any
   * session exists.
   */
  it('refuses a World whose Setup names a missing mode, with the list, making nothing', async () => {
    const setup = await setupElsewhere();
    const world = await worldAsking({}, [envelope(setup)]);

    const refused = await start({ world: world.id });

    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('unmet-requirements');
    expect(refused.body.unmet).toEqual([
      { kind: 'mode', id: MISSING, installed: null, substituted: true },
    ]);
    expect(await sessionCount()).toBe(0);
  });

  /**
   * ***Start anyway*** — the same request with `degraded: true`. The session
   * plays the default mode, the Setup's answers to the missing mode's wizard
   * dropped (Scene's takes exactly `{}`), and records what it started
   * without; its copy of the Setup still says which mode the Setup wanted,
   * and `GET /sessions/:id` presents the record as it is.
   */
  it('starts anyway in the default mode, the answers dropped, and records what it lacked', async () => {
    const setup = await setupElsewhere();
    const world = await worldAsking({}, [envelope(setup)]);

    const response = await start({ world: world.id, degraded: true });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const id = response.body.session.id as string;
    const stored = await sessionFile(id);
    expect(stored.mode).toEqual({ id: DEFAULT_MODE_ID, config: null });
    expect(stored.setup.mode.id).toBe(MISSING);
    expect(stored.startedWithout).toEqual({
      at: expect.any(String),
      unmet: [{ kind: 'mode', id: MISSING, installed: null, substituted: true }],
    });
    const read = await server.request({ method: 'GET', url: `/api/sessions/${id}` });
    expect(read.body.session.startedWithout).toEqual(stored.startedWithout);
  });

  /**
   * ***Only the mode the session would play is `substituted`*** — that one
   * starts as another mode, which the dialog says; a missing mode the World
   * merely also asks for is listed without the mark. When the World names the
   * Setup's own mode at a version, the one item keeps the version and the mark.
   */
  it('marks the Setup’s missing mode substituted, and no other', async () => {
    const setup = await setupElsewhere();
    const world = await worldAsking(
      {
        modes: [
          { id: 'storyengine.campaign', minVersion: '2.0.0' },
          { id: MISSING, minVersion: '1.2.0' },
        ],
      },
      [envelope(setup)],
    );

    const refused = await start({ world: world.id });

    expect(refused.status).toBe(422);
    expect(refused.body.unmet).toEqual([
      { kind: 'mode', id: MISSING, minVersion: '1.2.0', installed: null, substituted: true },
      { kind: 'mode', id: 'storyengine.campaign', minVersion: '2.0.0', installed: null },
    ]);
  });

  /** The Setup page's door: a Setup named outright is held to the same, and started the same. */
  it('holds a Setup named outright to the same, and starts it anyway the same', async () => {
    const setup = await setupElsewhere();

    const refused = await start({ setup: setup.id });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('unmet-requirements');

    const anyway = await start({ setup: setup.id, degraded: true });
    expect(anyway.status, JSON.stringify(anyway.body)).toBe(201);
    expect((await sessionFile(anyway.body.session.id as string)).mode.id).toBe(DEFAULT_MODE_ID);
  });

  /**
   * ***A capability is a model role*** (the lead's decision, 04 §9). `prose`,
   * bound for everybody, is met and not listed; `image`, bound for nobody, is
   * listed as one that can be checked; `audio`, no role at all, is listed as
   * one that cannot.
   */
  it('lists a role that does not resolve, and a capability no role names', async () => {
    await bindProse();
    const world = await worldAsking({ capabilities: ['prose', 'image', 'audio'] });

    const refused = await start({ world: world.id });

    expect(refused.status).toBe(422);
    expect(refused.body.unmet).toEqual([
      { kind: 'capability', id: 'image', checkable: true },
      { kind: 'capability', id: 'audio', checkable: false },
    ]);
    const anyway = await start({ world: world.id, degraded: true });
    expect(anyway.status).toBe(201);
    expect((await sessionFile(anyway.body.session.id as string)).startedWithout.unmet).toEqual(
      refused.body.unmet,
    );
  });

  /**
   * ***An older mode, and an extension*** — a World whose author wrote that it
   * wants the default mode at a version past this install's, and an extension.
   * The version is checked because an author wrote one; the extension is unmet
   * by construction, since this build loads none. Started anyway, the session
   * plays the installed version.
   */
  it('lists a mode older than its author asked for, and every extension', async () => {
    const installed = modeById(DEFAULT_MODE_ID)?.definition.version ?? null;
    const world = await worldAsking({
      modes: [{ id: DEFAULT_MODE_ID, minVersion: '999.0.0' }],
      extensions: [{ id: 'dice', minVersion: '0.1.0' }],
    });

    const refused = await start({ world: world.id });

    expect(refused.status).toBe(422);
    expect(refused.body.unmet).toEqual([
      { kind: 'mode', id: DEFAULT_MODE_ID, minVersion: '999.0.0', installed },
      { kind: 'extension', id: 'dice', minVersion: '0.1.0' },
    ]);
    const anyway = await start({ world: world.id, degraded: true });
    expect(anyway.status).toBe(201);
    expect((await sessionFile(anyway.body.session.id as string)).mode.id).toBe(DEFAULT_MODE_ID);
  });

  /**
   * ***The caller's own `mode` is not imported content*** — naming a mode this
   * install does not have is still `unknown-mode`, and `degraded` does not
   * start it in another: that would be giving somebody a mode they did not
   * ask for, which is what the refusal exists to prevent.
   */
  it('still refuses a mode the caller names outright, degraded or not', async () => {
    const refused = await start({ mode: MISSING });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('unknown-mode');

    const anyway = await start({ mode: MISSING, degraded: true });
    expect(anyway.status).toBe(422);
    expect(anyway.body.error).toBe('unknown-mode');
    expect(await sessionCount()).toBe(0);
  });

  /**
   * ***Nothing unmet starts exactly as before*** — no record, with or without
   * the flag: `startedWithout` says what a session lacked, and a session that
   * lacked nothing has nothing to say.
   */
  it('starts a World asking for nothing it lacks as before, with no record', async () => {
    const world = await worldAsking({ modes: [{ id: DEFAULT_MODE_ID, minVersion: '0.0.1' }] });

    const plain = await start({ world: world.id });
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    expect(await sessionFile(plain.body.session.id as string)).not.toHaveProperty('startedWithout');

    const flagged = await start({ world: world.id, degraded: true });
    expect(flagged.status).toBe(201);
    expect(await sessionFile(flagged.body.session.id as string)).not.toHaveProperty(
      'startedWithout',
    );
  });

  /**
   * ***The record travels*** — a session export carries the document whole,
   * and the import spreads it, so a session sent to somebody else still says
   * what it started without.
   */
  it('keeps what it started without through an export and back', async () => {
    const setup = await setupElsewhere();
    const started = await start({ setup: setup.id, degraded: true });
    const id = started.body.session.id as string;
    const before = (await sessionFile(id)).startedWithout;
    // The import takes a session with a story in it, so one turn is played.
    await appendTurnToSession(server.services.sessions, 'ned', id, {
      id: uuidv7(),
      sessionId: id,
      parentTurnId: null,
      createdAt: new Date().toISOString(),
      status: 'complete',
      input: { actorId: null, kind: 'say', text: 'And then?', raw: '' },
      output: { text: 'The rain kept on.' },
      effects: [],
      tape: [],
    } as never);

    const exported = await server.request({ method: 'GET', url: `/api/sessions/${id}/export` });
    expect(exported.status).toBe(200);
    // Another install, as a session sent to somebody else arrives.
    const there = await makeTestServer();
    try {
      await setUpAdmin(there, 'ned');
      const landed = await there.request({
        method: 'POST',
        url: '/api/sessions/import',
        payload: exported.body,
      });
      expect(landed.status, JSON.stringify(landed.body)).toBe(201);
      const read = await there.request({
        method: 'GET',
        url: `/api/sessions/${landed.body.sessionId as string}`,
      });
      expect(read.body.session.startedWithout).toEqual(before);
    } finally {
      await there.dispose();
    }
  });
});
