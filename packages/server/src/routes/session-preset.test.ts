// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newPreset } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***A session's pack can be changed after creation*** — [P7B.2], and the route
 * [P6B §4](../../../../docs/design/workplan/20-p6b-playable.md) declined to add.
 *
 * It declined because adding one *"is a question about what a session's preset
 * is"*, and [P7B §1.1] is that question answered: **a switch is a new copy, and
 * the turns already taken keep theirs.** The record holds the blocks each turn
 * was assembled from, so nothing rewrites history — which is what makes
 * [10 §3]'s *the same turn before and after a preset change* mean anything.
 *
 * Until this, `PATCH /api/sessions/:id` accepted `name` and `archived` and
 * nothing touched `preset` or `params`. The manual walk sheet's C3 still says
 * *"hand-edit `preset.params.maxTokens` in the session's own `session.json`"*.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

async function newSession(): Promise<string> {
  const made = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'The Ashfall Road' },
  });
  expect(made.status).toBe(201);
  return made.body.session.id as string;
}

async function readPreset(sessionId: string): Promise<Record<string, unknown>> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  return read.body.session.preset as Record<string, unknown>;
}

describe('switching the pack a session is assembled from', () => {
  it('clones a library preset rather than linking to it', async () => {
    const sessionId = await newSession();

    const made = await server.request({
      method: 'POST',
      url: '/api/library/presets',
      payload: { ...newPreset('Harbour'), blurb: 'Mine' },
    });
    expect(made.status).toBe(201);

    const switched = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: { presetId: made.body.id },
    });
    expect(switched.status).toBe(200);
    expect((await readPreset(sessionId))['blurb']).toBe('Mine');

    // **Copied, never linked** ([03 §8]): editing the library's copy must not
    // reach a game in progress. The assertion is a second write to the library
    // object and a re-read of the session.
    const edited = await server.request({
      method: 'PUT',
      url: `/api/library/presets/${String(made.body.id)}`,
      payload: {
        object: { ...newPreset('Harbour'), id: made.body.id, blurb: 'Changed underneath' },
        contentHash: made.body.contentHash,
      },
    });
    expect(edited.status).toBe(200);
    expect((await readPreset(sessionId))['blurb']).toBe('Mine');
  });

  it('takes the pack itself, which is how the panel edits one in place', async () => {
    const sessionId = await newSession();
    const before = await readPreset(sessionId);

    const written = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: { preset: { ...before, blurb: 'Edited in the panel' } },
    });
    expect(written.status).toBe(200);
    expect((await readPreset(sessionId))['blurb']).toBe('Edited in the panel');
  });

  it("goes back to the mode's own on `default`", async () => {
    const sessionId = await newSession();
    const shipped = await readPreset(sessionId);

    await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: { preset: { ...shipped, blurb: 'Wandered off' } },
    });

    const back = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: { presetId: 'default' },
    });
    expect(back.status).toBe(200);
    expect(await readPreset(sessionId)).toEqual(shipped);
  });

  it('refuses both halves and neither, because the route cannot guess', async () => {
    const sessionId = await newSession();

    const both = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: { presetId: 'default', preset: { name: 'x' } },
    });
    expect(both.status).toBe(422);

    const neither = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: {},
    });
    expect(neither.status).toBe(422);
  });

  it('is not-found for an id in somebody else’s library, never forbidden', async () => {
    const sessionId = await newSession();

    const unknown = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: { presetId: '01a008de-7e08-70d0-899c-f6869d6b9aeb' },
    });
    // 422 with `unknown-preset`, the same answer session creation gives — a
    // route that said *forbidden* would confirm the id exists somewhere, which
    // is the one fact the separation exists to keep ([09 §4.3]).
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toBe('unknown-preset');
  });
});
