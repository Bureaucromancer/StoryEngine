// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../config.js';
import { assistField } from '../library/assist.js';
import { FakeProvider } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***The field assist contract's endpoint*** —
 * [10 §11.1](../../../../docs/design/10-ui-surfaces.md),
 * [P11.2](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * **Three claims, and the first is the one §11.1 spends a paragraph on.**
 * *"Context is the part that gets skimped. 'Generate an appearance' must see the
 * actor's name, summary, tags and the treatment it is being authored against.
 * An assist that receives only the field label produces generic slop and trains
 * people not to use it."* So the assertion is on **what reached the provider**,
 * not on what came back: a route that sent the label and the path alone would
 * return perfectly good-looking words and be the failure that sentence
 * describes.
 *
 * The second is that **nothing is written**. §11.1's *"nothing may require a
 * model call to proceed, ever"* has a server-side reading: a route that recorded
 * the generation would have made accepting it the default, because refusing it
 * would then be a second write. The answer goes to a form and the form decides.
 *
 * The third is [22 §1.4]: an unbound role comes back as a **class**, never a
 * sentence, because the client owns the words and [P11.6] already wrote them.
 */

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a11';

let server: TestServer;
let provider: FakeProvider;

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
  provider = new FakeProvider({ script: [{ text: '  A wet quay under sodium light.  ' }] });
  server = await makeTestServer({ providers: () => provider });
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

const BODY = {
  subject: 'actor',
  path: 'profile.appearance',
  label: 'Appearance',
  draft: { name: 'Vera Solano', summary: 'A fixer who works the harbour.', tags: ['noir'] },
};

describe('writing one field', () => {
  it('sends the whole draft, not the label', async () => {
    await bindProse();
    const response = await server.request({
      method: 'POST',
      url: '/api/library/assist',
      payload: BODY,
    });

    expect(response.status).toBe(200);
    expect(response.body.text).toBe('A wet quay under sodium light.');
    expect(response.body.model).toBe('fake-hi');

    const sent =
      provider.requests
        .at(-1)
        ?.messages.map((one) => one.content)
        .join('\n') ?? '';
    // **The three §11.1 names.** A route that sent only the label would pass
    // every other assertion in this file.
    expect(sent).toContain('Vera Solano');
    expect(sent).toContain('A fixer who works the harbour.');
    expect(sent).toContain('noir');
    expect(sent).toContain('Appearance');
  });

  /**
   * ***Refine carries the current value and the steer.*** §11.1: *"'make it
   * darker' is the whole interaction, and without it the only recourse is
   * regenerate-and-hope."* A route that dropped either would turn every refine
   * into a regenerate, which looks identical until somebody notices their
   * instruction never lands.
   */
  it('carries the guidance and the value being rewritten', async () => {
    await bindProse();
    await server.request({
      method: 'POST',
      url: '/api/library/assist',
      payload: { ...BODY, guidance: 'Make it darker.', current: 'A quay at noon.' },
    });

    const sent =
      provider.requests
        .at(-1)
        ?.messages.map((one) => one.content)
        .join('\n') ?? '';
    expect(sent).toContain('Make it darker.');
    expect(sent).toContain('A quay at noon.');
  });

  /**
   * ***The seed is the prompt*** — [10 §11.2] defines it as *"the input the
   * generation ran from"*, and what the map buys is *"honest disclosure — this
   * was model-written, from this prompt, with this model"*. A number there
   * would answer a reproducibility question a text endpoint cannot answer.
   */
  it('hands back what it asked, so the provenance can say so', async () => {
    await bindProse();
    const response = await server.request({
      method: 'POST',
      url: '/api/library/assist',
      payload: BODY,
    });
    expect(response.body.seed as string).toContain('Vera Solano');
  });

  /** A class, for the client to word — [22 §1.4], [P11.6]. */
  it('refuses with a class when nothing is bound', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/library/assist',
      payload: BODY,
    });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe('not-bound');
    expect(JSON.stringify(response.body)).not.toContain('Settings');
  });

  /**
   * ***An endpoint that answers with nothing is not an answer***, and it is a
   * different class from an unbound role: one is a configuration fault with a
   * remedy, the other is an endpoint having a bad day. Reporting them alike
   * would send somebody to Settings to fix a working binding.
   */
  it('tells an empty answer apart from an unbound role', async () => {
    await bindProse();
    provider.setScript([{ text: '   ' }]);
    const response = await server.request({
      method: 'POST',
      url: '/api/library/assist',
      payload: BODY,
    });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe('no-answer');
  });

  /**
   * ***What it spent is recorded, whether or not anyone keeps the answer*** —
   * [10 §11.4]'s *"They cost money, and must be recorded even though nothing
   * displays it at 1.0."* The figures are the provider's, copied; the model is
   * the one that answered.
   */
  it('records what the call spent in the account’s usage log', async () => {
    await bindProse();
    provider.setScript([
      { text: 'A wet quay.', usage: { promptTokens: 12, completionTokens: 34 } },
    ]);
    await server.request({ method: 'POST', url: '/api/library/assist', payload: BODY });

    const lines = (await readFile(join(server.dataDir, 'users', 'ned', 'usage.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      schema: 'storyengine.usage/1',
      purpose: 'assist:profile.appearance',
      role: 'prose',
      resolved: { connectionId: CONNECTION_ID, modelId: 'fake-hi' },
      usage: { promptTokens: 12, completionTokens: 34 },
      cost: null,
      subject: 'actor',
    });
  });

  /**
   * ***A provider that reports nothing is recorded as having reported
   * nothing*** — the capability gate's answer copied, never a zero standing in
   * for an unknown. And an empty answer still cost what it cost.
   */
  it('records a null usage when the provider sends none, even for an empty answer', async () => {
    await bindProse();
    provider.setScript([{ text: '   ', reportsNoUsage: true }]);
    const response = await server.request({
      method: 'POST',
      url: '/api/library/assist',
      payload: BODY,
    });
    expect(response.body.error).toBe('no-answer');

    const text = await readFile(join(server.dataDir, 'users', 'ned', 'usage.jsonl'), 'utf8');
    const [line] = text.split('\n').filter((one) => one !== '');
    expect(JSON.parse(line ?? '{}')).toMatchObject({ usage: null });
  });

  /**
   * ***The role is the account's to choose, until [26 C15] chooses for
   * everyone*** — `providers/task-roles.ts`. [10 §11.4] says assist wants
   * `fast`; asking for it unconditionally would fail every install that never
   * bound it, so the default stays `prose` and the person who has bound a quick
   * model can point assist at it.
   */
  it('asks for the role the account chose for writing help', async () => {
    await bindProse();
    const root = new Layout(server.dataDir).userConnectionsRoot('ned');
    await writeFile(
      join(root, 'fake.json'),
      JSON.stringify({
        id: CONNECTION_ID,
        label: 'The double',
        provider: 'openai-compatible',
        models: ['fake-hi', 'fake-lo'],
        capabilities: { maxContextTokens: 32_000 },
      }),
    );
    await writeFile(
      join(server.dataDir, 'users', 'ned', 'bindings.json'),
      JSON.stringify({
        prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' },
        fast: { connectionId: CONNECTION_ID, modelId: 'fake-lo' },
      }),
    );

    const before = await server.request({ method: 'GET', url: '/api/me/roles' });
    expect(before.body.tasks).toEqual({ assist: 'prose' });

    const chosen = await server.request({
      method: 'PUT',
      url: '/api/me/task-roles',
      payload: { assist: 'fast' },
    });
    expect(chosen.status).toBe(200);
    expect(chosen.body.tasks).toEqual({ assist: 'fast' });

    const response = await server.request({
      method: 'POST',
      url: '/api/library/assist',
      payload: BODY,
    });
    expect(response.status).toBe(200);
    expect(response.body.model).toBe('fake-lo');
    expect(provider.requests.at(-1)?.modelId).toBe('fake-lo');

    const lines = (await readFile(join(server.dataDir, 'users', 'ned', 'usage.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line !== '');
    expect(JSON.parse(lines.at(-1) ?? '{}')).toMatchObject({ role: 'fast' });
  });

  it('refuses a role that is not one assist can use', async () => {
    const refused = await server.request({
      method: 'PUT',
      url: '/api/me/task-roles',
      payload: { assist: 'image' },
    });
    expect(refused.status).toBe(400);
    const roles = await server.request({ method: 'GET', url: '/api/me/roles' });
    expect(roles.body.tasks).toEqual({ assist: 'prose' });
  });

  /**
   * ***Nothing is written.*** The library is untouched by an assist, which is
   * §11.1's *"nothing may require a model call to proceed"* read from the
   * server's side: the answer goes to a form and the form decides.
   */
  it('writes nothing to the library', async () => {
    await bindProse();
    const before = await server.request({ method: 'GET', url: '/api/library' });
    await server.request({ method: 'POST', url: '/api/library/assist', payload: BODY });
    const after = await server.request({ method: 'GET', url: '/api/library' });
    expect(after.body).toEqual(before.body);
  });
});

/**
 * ***A call like every other call*** (2026-09-27).
 *
 * The assist asked the provider directly, so it was the one call in the build
 * with no idle bound, no retry for a busy endpoint and no classification: a
 * wrong key or a model server that was down reached the route as an exception
 * and the person as a bare 500, and a closed editor left the call running. It
 * goes through `performCall` now, and these are the four things that buys.
 */
describe('an assist the endpoint does not answer', () => {
  it('is a class and a remedy when the endpoint refuses', async () => {
    await bindProse();
    provider.setScript([
      {
        error: {
          class: 'terminal',
          message: 'The provider call failed.',
          detail: 'Incorrect API key provided',
        },
      },
    ]);

    const response = await server.request({
      method: 'POST',
      url: '/api/library/assist',
      payload: BODY,
    });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: 'provider-failed',
      class: 'terminal',
      remedy: 'endpoint-refused',
    });
  });

  it('asks a busy endpoint again, as a turn would', async () => {
    await bindProse();
    provider.setScript([
      { error: { class: 'retryable', message: 'Too many requests.' } },
      { text: 'A wet quay, second time asked.' },
    ]);

    const response = await server.request({
      method: 'POST',
      url: '/api/library/assist',
      payload: BODY,
    });

    expect(response.status).toBe(200);
    expect(response.body.text).toBe('A wet quay, second time asked.');
    expect(provider.requests).toHaveLength(2);
  });

  it('gives up on an endpoint that goes quiet, and says it was a stall', async () => {
    await server.dispose();
    provider = new FakeProvider({ script: [{ stallMs: 5_000 }] });
    server = await makeTestServer({
      providers: () => provider,
      config: { limits: { ...DEFAULT_CONFIG.limits, providerTimeoutMs: 60 } },
    });
    await setUpAdmin(server, 'ned');
    await bindProse();

    const response = await server.request({
      method: 'POST',
      url: '/api/library/assist',
      payload: BODY,
    });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ error: 'provider-failed', remedy: 'endpoint-stalled' });
  });

  /**
   * *Ended by the signal it is handed*, which the route takes from the person
   * leaving (`disconnectSignal`). A request that cannot be disconnected
   * through `inject` is asked here with the signal already gone.
   */
  it('asks nothing once the person has gone', async () => {
    await bindProse();

    const result = await assistField(
      {
        layout: server.services.library.layout,
        accounts: server.services.accounts,
        providers: () => provider,
        config: server.services.config,
      },
      { account: 'ned', ...BODY, signal: AbortSignal.abort() },
    );

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(provider.requests).toHaveLength(0);
  });
});
