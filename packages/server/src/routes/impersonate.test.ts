// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newLorebook, newLoreEntry } from '@storyengine/shared';

import { DEFAULT_CONFIG } from '../config.js';
import { FakeProvider } from '../providers/fake.js';
import { readAllTurns } from '../sessions/segments.js';
import { Layout } from '../storage/layout.js';
import {
  makeTestServer,
  setUpAdmin,
  type TestServer,
  type TestServerOptions,
} from '../test-server.js';

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

async function bindProse(models: string[] = ['fake-hi']): Promise<void> {
  const root = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models,
      capabilities: { maxContextTokens: 32_000 },
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );
}

/**
 * A server with an admin and Vera in the library. Every test gets one from
 * `beforeEach`; the timeout tests below throw that one away and stand up their
 * own, because what they are about is the config and the endpoint's pace, and
 * both are fixed when the server is made.
 */
async function standUp(options: TestServerOptions): Promise<void> {
  server = await makeTestServer(options);
  await setUpAdmin(server, 'ned');
  const actor = newActor('Vera');
  await server.request({ method: 'POST', url: '/api/library/actors', payload: actor });
  vera = actor.id;
}

beforeEach(async () => {
  await standUp({
    providers: () =>
      new FakeProvider({
        script: [
          { text: 'I would not go in there.', usage: { promptTokens: 21, completionTokens: 8 } },
        ],
      }),
  });
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
   * *A window with no room beside the reply is refused before anything is
   * sent* (2026-09-27), and the answer names the setting.
   */
  it('refuses a draft whose window has no room beside the reply', async () => {
    // The double's own window, since the factory here answers with it: Scene
    // keeps 800 for the reply and spends three quarters of 1000.
    await server.dispose();
    const cramped = new FakeProvider({
      capabilities: { maxContextTokens: 1000 },
      script: [{ text: 'I would not go in there.' }],
    });
    await standUp({ providers: () => cramped });
    await bindProse();
    const sessionId = await aSession(vera);

    const drafted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/impersonate`,
      payload: {},
    });

    expect(drafted.status).toBe(422);
    expect(drafted.body.error).toBe('window-too-small');
    expect(cramped.requests).toHaveLength(0);
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

/**
 * ***`limits.providerTimeoutMs` is `performCall`'s, and this route has no copy
 * of it*** — [22 §4](../../../../docs/design/22-internal-contracts.md),
 * [P2C §1.3](../../../../docs/design/workplan/12-p2c-first-real-run.md).
 *
 * §4's row is two sentences this route used to break: the key bounds **silence
 * rather than duration**, and **`0` disables it**. `withIdleTimeout` in
 * `turns/calls.ts` keeps both, and a draft goes through it like every other
 * call. The route also used to wrap the request in
 * `AbortSignal.timeout(providerTimeoutMs)`, which was a wall-clock ceiling on
 * top of the idle one and, at zero, a signal that aborts on the next tick, so
 * every draft failed for exactly the operators who had switched the bound off
 * because their endpoint is slow.
 *
 * So there are two claims, one for each way to get this wrong again: zero
 * really means no bound, and removing the route's copy did not remove the
 * bound.
 */
describe('the provider timeout, as a draft sees it', () => {
  /**
   * ***The falsifying mutation is putting `AbortSignal.timeout(...)` back on
   * the route.*** At zero that signal has already fired by the time
   * `performCall` first checks it, and the draft comes back as a 500 rather
   * than words. The stall is there so the endpoint is a slow one rather than
   * an instant one, which is the case the setting exists for.
   */
  it('drafts when the timeout is switched off', async () => {
    await server.dispose();
    await standUp({
      config: { limits: { ...DEFAULT_CONFIG.limits, providerTimeoutMs: 0 } },
      providers: () =>
        new FakeProvider({ script: [{ text: 'I would not go in there.', stallMs: 20 }] }),
    });
    await bindProse();
    const sessionId = await aSession(vera);

    const drafted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/impersonate`,
      payload: {},
    });

    expect(drafted.status).toBe(200);
    expect(drafted.body.text).toBe('I would not go in there.');
  });

  /**
   * **A stalled endpoint still ends the draft**, now that only the idle timer
   * bounds it. The stall is far longer than the suite's per-test timeout, so a
   * draft with no bound at all fails by timing out rather than by passing.
   *
   * ~~*The status pins that the bound exists, not what the answer should
   * say.*~~ *Answered 2026-09-27*: a draft's provider failure has a class and a
   * remedy now, so the stall says so rather than reaching `setErrorHandler`.
   */
  it('still gives up on an endpoint that says nothing', async () => {
    await server.dispose();
    await standUp({
      config: { limits: { ...DEFAULT_CONFIG.limits, providerTimeoutMs: 60 } },
      providers: () => new FakeProvider({ script: [{ stallMs: 60_000 }] }),
    });
    await bindProse();
    const sessionId = await aSession(vera);

    const drafted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/impersonate`,
      payload: {},
    });

    expect(drafted.status).toBe(502);
    expect(drafted.body).toMatchObject({
      error: 'provider-failed',
      class: 'terminal',
      remedy: 'endpoint-stalled',
    });
  });
});

/**
 * ***A provider failure is an answer, not an accident*** (2026-09-27).
 *
 * It was rethrown, so a wrong key, a model server that was down or a 429
 * reached the unhandled-error path. The person got a bare 500 with no class and
 * no remedy, and the log got the error object, whose `call` is the whole
 * rendered story prompt.
 */
describe('a draft the endpoint refuses', () => {
  let lines: string[];

  beforeEach(async () => {
    await server.dispose();
    lines = [];
    await standUp({
      config: { log: { level: 'info', format: 'json' } },
      logStream: new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString());
          done();
        },
      }),
      providers: () =>
        new FakeProvider({
          script: [
            {
              error: {
                class: 'terminal',
                message: 'The endpoint refused the request.',
                detail: 'Incorrect API key provided',
              },
            },
          ],
        }),
    });
  });

  it('says which class it was and what to do, and keeps the prompt out of the log', async () => {
    await bindProse();
    const sessionId = await aSession(vera);

    const drafted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/impersonate`,
      payload: {},
    });

    expect(drafted.status).toBe(502);
    expect(drafted.body).toMatchObject({
      error: 'provider-failed',
      class: 'terminal',
      remedy: 'endpoint-refused',
    });

    const logged = lines.join('');
    // The one line an operator needs, with the endpoint's own words on it…
    expect(logged).toContain('"event":"impersonate.failed"');
    expect(logged).toContain('Incorrect API key provided');
    // …and none of the story. The impersonation instruction is in every
    // draft's prompt, so it is what a serialised call would have carried.
    expect(logged).not.toContain('next message, as Vera');
  });
});

/**
 * ***What a draft is assembled from, and who is asked*** (2026-09-27).
 *
 * The draft was collected as the prose step's own call, `narrate`, so the
 * narrator instruction that forbids writing the player's words was in every
 * draft's prompt and a pack's own impersonation block, which SillyTavern's
 * converter scopes to `impersonate`, was in none. And it resolved its model
 * without the session's overrides, so a session pointed at its own endpoint
 * drafted on the account default's, with its key.
 */
describe('what a draft is assembled from', () => {
  let fake: FakeProvider;

  beforeEach(async () => {
    await server.dispose();
    fake = new FakeProvider({ script: [{ text: 'I would not go in there.' }] });
    await standUp({ providers: () => fake });
  });

  function asked(): string {
    return (fake.requests[0]?.messages ?? []).map((message) => message.content).join('\n');
  }

  async function draft(sessionId: string): Promise<void> {
    const drafted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/impersonate`,
      payload: {},
    });
    expect(drafted.status).toBe(200);
  }

  it('is collected as an impersonation, without the narrator’s brief', async () => {
    await bindProse();
    const sessionId = await aSession(vera);

    await draft(sessionId);

    expect(asked()).toContain('next message, as Vera');
    expect(asked()).not.toContain('You are the narrator of a scene');
  });

  it('carries the block a pack wrote for impersonation', async () => {
    await bindProse();
    const sessionId = await aSession(vera);
    const current = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const preset = current.body.session.preset as { blocks: unknown[] };
    const put = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: {
        preset: {
          ...preset,
          blocks: [
            ...preset.blocks,
            {
              id: 'st.impersonation_prompt',
              label: 'impersonation',
              role: 'system',
              enabled: true,
              placement: { at: 'sequence' },
              priority: 85,
              appliesTo: ['impersonate'],
              advisory: false,
              omitWhenEmpty: true,
              kind: 'text',
              template: 'Keep the draft to a single breath.',
            },
          ],
        },
      },
    });
    expect(put.status).toBe(200);

    await draft(sessionId);

    expect(asked()).toContain('Keep the draft to a single breath.');
  });

  /**
   * *A session keeps the pack it was created with*, so one made before the
   * narrator instruction was scoped still sends it to a draft. The
   * impersonation instruction answers it in so many words.
   */
  it('tells an older pack’s narrator brief that it does not apply', async () => {
    await bindProse();
    const sessionId = await aSession(vera);
    const current = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const preset = current.body.session.preset as { blocks: { id: string }[] };
    const wide = preset.blocks.map((block) =>
      block.id === 'se.instruction' ? { ...block, appliesTo: [] } : block,
    );
    const put = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/preset`,
      payload: { preset: { ...preset, blocks: wide } },
    });
    expect(put.status).toBe(200);

    await draft(sessionId);

    expect(asked()).toContain('You are the narrator of a scene');
    expect(asked()).toContain('is the narrator’s, and does not apply to this message');
  });

  /**
   * The retriever is asked under the same kind, so an entry an author limited
   * to one kind of call is read the way they limited it.
   */
  it('asks the lore as an impersonation', async () => {
    await bindProse();
    const book = newLorebook('Rain City');
    book.entries = [
      {
        ...newLoreEntry('For drafts'),
        constant: true,
        content: 'Vera never raises her voice.',
        generationTriggerFilter: { mode: 'include', values: ['impersonate'] },
      },
      {
        ...newLoreEntry('For narration'),
        constant: true,
        content: 'The rain has not stopped in a week.',
        generationTriggerFilter: { mode: 'include', values: ['narrate'] },
      },
    ];
    await server.request({ method: 'POST', url: '/api/library/lorebooks', payload: book });
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain City', cast: { persona: vera, actors: [vera] }, lore: [book.id] },
    });
    expect(created.status).toBe(201);

    await draft(created.body.session.id as string);

    expect(asked()).toContain('Vera never raises her voice.');
    expect(asked()).not.toContain('The rain has not stopped in a week.');
  });

  it('is drafted on the model the session chose', async () => {
    await bindProse(['fake-hi', 'fake-lo']);
    const sessionId = await aSession(vera);
    const roles = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/roles`,
      payload: { roles: { prose: { connectionId: CONNECTION_ID, modelId: 'fake-lo' } } },
    });
    expect(roles.status).toBe(200);

    await draft(sessionId);

    expect(fake.requests[0]?.modelId).toBe('fake-lo');
  });
});
