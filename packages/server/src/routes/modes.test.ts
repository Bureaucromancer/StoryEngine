// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupAnswerSchema } from '@storyengine/sdk';

import { registerMode } from '../mode-registry.js';
import { DEFAULT_MODE_ID } from '../mode-registry.js';
import { SETUP_MODE, SETUP_MODE_ID } from '../test-mode.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * What this install can play, and what a mode asks for —
 * [10 §8](../../../../docs/design/10-ui-surfaces.md),
 * [P7.4](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **The route's absence was wider than the wizard.** `registeredModes()` had no
 * production reader at all, so nothing could tell a browser which modes exist —
 * and the stage's exit line, *a wizard for a mode the engine has no knowledge
 * of, rendered from its declaration alone*, is unreachable without a route that
 * carries the declaration.
 *
 * **So the sharp tests here are about a mode nothing in `packages/server`
 * names.** `SETUP_MODE` is registered by this file and by nothing else; if its
 * declaration reaches a client intact, then so does one an extension shipped.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
  /**
   * Process-wide and not cleared, which is safe rather than sloppy: nothing else
   * names this id, and `makeTestServer` installs the built-ins per test. A
   * fixture that needed *removing* would be a reason to give the registry a
   * reset; this one does not.
   */
  registerMode(SETUP_MODE);
});

afterEach(async () => {
  await server.dispose();
});

describe('GET /api/modes', () => {
  it('lists what this install can play', async () => {
    const response = await server.request({ method: 'GET', url: '/api/modes' });

    const ids = (response.body.modes as { id: string }[]).map((mode) => mode.id);
    expect(ids).toContain(DEFAULT_MODE_ID);
    expect(ids).toContain(SETUP_MODE_ID);
  });

  /**
   * **The omissions are the design**, so they are asserted rather than described.
   * A session *copies* its preset at creation, so sending a thirteen-block
   * prompt pack would be shipping a copy of something the client cannot change;
   * `steps` and `channels` are what the engine runs and registers.
   */
  it('sends what a client acts on and not what the engine runs', async () => {
    const response = await server.request({ method: 'GET', url: '/api/modes' });
    const mode = (response.body.modes as Record<string, unknown>[]).find(
      (one) => one['id'] === DEFAULT_MODE_ID,
    );

    expect(Object.keys(mode ?? {}).sort()).toEqual([
      'dispatch',
      'displayName',
      'id',
      'inputs',
      'participants',
      'presetIds',
      'setup',
      'surfaces',
      'voice',
    ]);
    // By name too, because a `Pick` that grew a field would pass the list above
    // if somebody updated it without thinking about why.
    expect(JSON.stringify(response.body)).not.toContain('defaultPreset');
    expect(JSON.stringify(response.body)).not.toContain('historyWindow');
  });

  /**
   * **The client cannot know which mode a bare `POST /api/sessions` plays**, and
   * a form that guessed — the first in the list, say — would render one mode's
   * wizard and create a session on another the moment registration order stopped
   * matching. Registration order is `installBuiltIns`' business, not a contract.
   */
  it('says which mode a session gets when none is named', async () => {
    const response = await server.request({ method: 'GET', url: '/api/modes' });

    expect(response.body.defaultModeId).toBe(DEFAULT_MODE_ID);
    // And it is one of the modes listed, so a client can resolve it to a
    // declaration rather than to nothing.
    expect((response.body.modes as { id: string }[]).map((one) => one.id)).toContain(
      response.body.defaultModeId as string,
    );
  });

  it('needs an account, like everything else after the first run', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });

    expect((await server.request({ method: 'GET', url: '/api/modes' })).status).toBe(401);
  });
});

describe('GET /api/modes/:modeId', () => {
  it('carries a declaration the engine knows nothing about, intact', async () => {
    const response = await server.request({ method: 'GET', url: `/api/modes/${SETUP_MODE_ID}` });

    expect(response.body.mode.setup).toEqual(SETUP_MODE.definition.setup);
  });

  it('says a mode with no wizard has none, rather than saying nothing', async () => {
    const response = await server.request({ method: 'GET', url: `/api/modes/${DEFAULT_MODE_ID}` });

    // `{ kind: 'none' }` is an answer: [06 §2]'s no-wizard mode, declared.
    expect(response.body.mode.setup).toEqual({ kind: 'none' });
  });

  /**
   * The runner falls back to the default for a session already *playing* an
   * unknown mode, because that is somebody's story and it should still open.
   * Asking about a mode by name is a different question, and answering with a
   * different mode's declaration would render a wizard for a mode the person is
   * not choosing.
   */
  it('refuses a mode it does not have rather than substituting one', async () => {
    const response = await server.request({ method: 'GET', url: '/api/modes/nobody.invented' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('unknown-mode');
  });
});

describe('the schema a wizard validates against', () => {
  /**
   * **Derived, so a client checking a form and the server checking a request are
   * checking the same thing.** A schema written out beside the fields would be
   * the second description `library/fields.ts` spends its header refusing.
   */
  it('is derived from the declaration the route sent', async () => {
    const response = await server.request({ method: 'GET', url: `/api/modes/${SETUP_MODE_ID}` });

    expect(setupAnswerSchema(response.body.mode.setup)).toEqual({
      type: 'object',
      properties: {
        premise: { type: 'string' },
        difficulty: { type: 'string', enum: ['gentle', 'even', 'harsh'] },
        dice: { type: 'boolean' },
      },
      required: ['premise', 'difficulty'],
      additionalProperties: false,
    });
  });

  it('lets a mode with no wizard accept exactly nothing', () => {
    expect(setupAnswerSchema({ kind: 'none' })).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });
});
