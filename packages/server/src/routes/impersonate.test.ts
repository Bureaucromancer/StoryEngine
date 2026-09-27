// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { readAllTurns } from '../sessions/segments.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***A draft of your own next message*** —
 * [06 §3.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.4](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **Two claims, and the negative one is the load-bearing half.** §3.1's first
 * detail is that this is *"a draft, not a commitment… anything else takes
 * authorship away rather than assisting it"* — so the assertion that matters is
 * that **nothing happened**: no job reserved, no turn appended, the head where
 * it was. That is cheap to state and easy to lose, exactly as
 * [`preview.test.ts`](./preview.test.ts) says of its own negative, and one
 * convenience later a route that committed a turn would still return the right
 * words.
 *
 * The other claim is the design's own line: **only a member you author.** [06 §8]
 * calls the difference between a companion and a second player *"the 'we are
 * not building a D&D engine' line"*, and a draft affordance that could speak in
 * a companion's voice would cross it without anybody deciding to.
 */

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a05';

let server: TestServer;
let vera: string;

async function bindProse(): Promise<void> {
  const root = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
      capabilities: { maxContextTokens: 32_000 },
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );
}

beforeEach(async () => {
  server = await makeTestServer({
    providers: () =>
      new FakeProvider({
        script: [
          { text: 'I would not go in there.', usage: { promptTokens: 21, completionTokens: 8 } },
        ],
      }),
  });
  await setUpAdmin(server, 'ned');
  const actor = newActor('Vera');
  await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });
  vera = actor.id;
});

afterEach(async () => {
  await server.dispose();
});

async function aSession(persona: string | null): Promise<string> {
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'Rain City', cast: { persona, actors: [vera] } },
  });
  return created.body.session.id as string;
}

describe('drafting your own next message', () => {
  it('returns words and commits absolutely nothing', async () => {
    await bindProse();
    const sessionId = await aSession(vera);

    const before = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const head = before.body.session.headTurnId as string | null;

    const drafted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/impersonate`,
      payload: {},
    });

    expect(drafted.status).toBe(200);
    expect(drafted.body.text).toBe('I would not go in there.');

    /**
     * ***The falsifying mutation is routing this through the runner***, which
     * would return the identical words and quietly take the session's one
     * active-job slot, append a turn and move the head. Every one of those is
     * checked, because each is a different way of taking authorship away.
     */
    const after = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(after.body.activeJob).toBeNull();
    expect(after.body.session.headTurnId).toBe(head);

    const turns = await readAllTurns(
      join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    expect(turns).toHaveLength(0);
  });

  /**
   * ***Committing nothing is not the same as recording nothing*** —
   * [10 §11.4]. The draft writes no turn, so the turn's tape cannot carry what
   * the call spent; the account's usage log does, with the session it was for.
   */
  it('records what the draft cost without writing a turn', async () => {
    await bindProse();
    const sessionId = await aSession(vera);

    await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/impersonate`,
      payload: {},
    });

    const lines = (await readFile(join(server.dataDir, 'users', 'ned', 'usage.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      purpose: 'impersonate',
      role: 'prose',
      resolved: { connectionId: CONNECTION_ID, modelId: 'fake-hi' },
      usage: { promptTokens: 21, completionTokens: 8 },
      sessionId,
    });

    const turns = await readAllTurns(
      join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    expect(turns).toHaveLength(0);
  });

  /**
   * ***The party line, refused at the door.*** A session with no persona has
   * nobody the person authors, so there is no voice to borrow — and answering
   * with the narrator's prose would be the failure §3.1's third detail exists
   * to prevent, arriving by the back route.
   */
  it('refuses when there is nobody you author', async () => {
    await bindProse();
    const sessionId = await aSession(null);

    const drafted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/impersonate`,
      payload: {},
    });

    expect(drafted.status).toBe(409);
    expect(drafted.body.error).toBe('not-a-player');
  });

  it('refuses a cast member the person does not author', async () => {
    await bindProse();
    const sessionId = await aSession(null);

    const drafted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/impersonate`,
      payload: { actorId: vera },
    });

    expect(drafted.status).toBe(409);
    expect(drafted.body.error).toBe('not-a-player');
  });

  /**
   * An unbound install is the state every install is in before somebody
   * configures a model, and the answer names the bindings rather than the
   * feature — [P2B]'s dangling posture.
   */
  it('says which thing is unconfigured when no model is bound', async () => {
    const sessionId = await aSession(vera);

    const drafted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/impersonate`,
      payload: {},
    });

    expect(drafted.status).toBe(422);
    expect(drafted.body.error).toBe('role-unbound');
  });
});
