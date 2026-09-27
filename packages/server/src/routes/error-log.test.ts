// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { FakeProvider } from '../providers/fake.js';
import {
  ProviderError,
  type GenerationRequest,
  type GenerationResult,
} from '../providers/types.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***An unhandled error is logged as what diagnoses it, and nothing else it
 * carries*** (2026-09-27) — `unhandledShape` in `app.ts`.
 *
 * `setErrorHandler` logged `err: error`, and the serialiser copies every
 * enumerable property. A `CallFailed` carries the call it failed on, whose
 * blocks are the whole rendered prompt. Illustrate still lets one through, so a
 * refused moment call wrote the turn's own prose into the log as an
 * *Unhandled error*. [21 §4.1] keeps portable object bodies out of the log, and
 * this is the one door every route that does not answer a failure falls
 * through.
 */

const CHAT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a33';
const IMAGE = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a34';
const PROSE = 'The lantern burned low on the wet quay, and nobody came for it.';

/** Answers every call but the moment call, which it refuses as an endpoint would. */
class RefusesTheMoment extends FakeProvider {
  override async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (JSON.stringify(request.messages).includes('choosing one image')) {
      throw new ProviderError('terminal', 'The endpoint refused the request.');
    }
    return await super.generate(request);
  }
}

let server: TestServer;
let lines: string[];

beforeEach(async () => {
  lines = [];
  server = await makeTestServer({
    providers: () =>
      new RefusesTheMoment({
        script: [{ text: PROSE }],
        capabilities: { rendersImages: true, supportsStructuredOutput: true },
      }),
    logStream: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    }),
    config: { log: { level: 'info', format: 'json' } },
  });
  await setUpAdmin(server, 'ned');

  const connections = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(connections, { recursive: true });
  await writeFile(
    join(connections, 'chat.json'),
    JSON.stringify({
      id: CHAT,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
      capabilities: { maxContextTokens: 32_000 },
    }),
  );
  await writeFile(
    join(connections, 'image.json'),
    JSON.stringify({
      id: IMAGE,
      label: 'The picture double',
      provider: 'openai-compatible',
      models: ['fake-image'],
      capabilities: { rendersImages: true },
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({
      prose: { connectionId: CHAT, modelId: 'fake-hi' },
      fast: { connectionId: CHAT, modelId: 'fake-hi' },
      image: { connectionId: IMAGE, modelId: 'fake-image' },
    }),
  );
});

afterEach(async () => {
  await server.dispose();
});

it('logs the kind and the sentence of an unhandled failure, and none of the story', async () => {
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'The harbour' },
  });
  const sessionId = created.body.session.id as string;
  await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: 'k-0', headTurnId: null, input: { text: 'Look around.' } },
  });
  const committed = async (): Promise<string | null> => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    return read.body.activeJob === null ? (read.body.session.headTurnId as string | null) : null;
  };
  await eventually(async () => (await committed()) !== null);
  const turnId = await committed();

  const illustrated = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns/${turnId ?? ''}/illustrate`,
    payload: { purpose: 'illustration' },
  });
  expect(illustrated.status).toBe(500);

  const failed = lines
    .join('')
    .split('\n')
    .filter((line) => line.includes('"event":"request.failed"'));
  expect(failed).toHaveLength(1);
  expect(JSON.parse(failed[0] ?? '{}')).toMatchObject({ type: 'CallFailed' });
  // The moment call's prompt is the turn's prose, so a serialised call on
  // this line would have carried it.
  expect(failed[0]).not.toContain('The lantern burned low');
});
