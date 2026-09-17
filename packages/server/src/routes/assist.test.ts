// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
 * The third is [21 §1.4]: an unbound role comes back as a **class**, never a
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

  /** A class, for the client to word — [21 §1.4], [P11.6]. */
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
