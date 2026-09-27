// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AssembledBlock, Turn } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Pictures on a player's move, and the one property they must not break*** —
 * [25 E15](../../../../docs/design/25-open-questions.md), R1.
 *
 * The property: **using a picture once never confines a session to models that
 * see.** Whether the pixels go is decided per call, from the model that call
 * resolved to, and every picture always has words to go instead — so the
 * falsifying test is the one that shows a picture to a model that sees, rebinds
 * the narrator to one that does not, and carries on. If anything had recorded
 * the session as multimodal, the second turn is where it would show.
 *
 * One connection serves a model that sees and one that does not, which is the
 * case the per-model `imageModels` exists for: Ollama and OpenRouter both work
 * this way, and a connection-wide flag would send pixels to the second model
 * the moment the narrator was rebound to it.
 */

const CONNECTION = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a77';
/** A PNG by its signature, which is all the store checks — it never decodes. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7]);

let server: TestServer;
let fake: FakeProvider;
let sessionId: string;
let head: string | null;
let counter: number;
/** Every other install a test made, so each is disposed with it. */
const others: TestServer[] = [];

/** An install with an admin, the double connection, and the narrator on the model that sees. */
async function anInstall(): Promise<TestServer> {
  const made = await makeTestServer({ providers: () => fake });
  await setUpAdmin(made, 'ned');
  const root = new Layout(made.dataDir).userConnectionsRoot('ned');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'double.json'),
    JSON.stringify({
      id: CONNECTION,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-vision', 'fake-text'],
      imageModels: ['fake-vision'],
    }),
  );
  await narrateWith('fake-vision', made);
  return made;
}

beforeEach(async () => {
  fake = new FakeProvider({ script: [{ text: 'The harbour, yes.' }] });
  server = await anInstall();

  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name: 'The harbour' },
  });
  sessionId = created.body.session.id as string;
  head = null;
  counter = 0;
});

afterEach(async () => {
  await server.dispose();
  for (const other of others.splice(0)) await other.dispose();
});

async function narrateWith(modelId: string, on: TestServer = server): Promise<void> {
  await writeFile(
    join(on.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION, modelId } }),
  );
}

function upload(bytes: Buffer): { headers: Record<string, string>; payload: Buffer } {
  const boundary = '----se';
  const open = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([Buffer.from(open), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
  };
}

async function attach(bytes: Buffer = PNG): Promise<{ status: number; digest: string }> {
  const sent = await server.app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/attachments`,
    ...upload(bytes),
    headers: {
      ...upload(bytes).headers,
      cookie: [...server.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      'x-csrf-token': server.cookies.get('se_csrf') ?? '',
    },
  });
  const body = sent.json<{ attachment?: { digest: string } }>();
  return { status: sent.statusCode, digest: body.attachment?.digest ?? '' };
}

async function takeATurn(input: object): Promise<Turn> {
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${sessionId}/turns`,
    payload: { idempotencyKey: `k-${String(counter++)}`, headTurnId: head, input },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
  const before = head;
  await eventually(async () => {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    const now = (read.body as { session: { headTurnId: string | null } }).session.headTurnId;
    return now !== null && now !== before;
  });
  const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
  head = (read.body as { session: { headTurnId: string } }).session.headTurnId;
  const turn = await server.request({
    method: 'GET',
    url: `/api/sessions/${sessionId}/turns/${head}`,
  });
  return turn.body.turn as Turn;
}

function pictureBlocks(turn: Turn): AssembledBlock[] {
  return (turn.request?.calls ?? []).flatMap((call) =>
    (call.blocks ?? []).filter((block) => block.image !== undefined),
  );
}

describe('putting a picture in a session', () => {
  it('stores a picture by its content, and serves it back', async () => {
    const { status, digest } = await attach();
    expect(status).toBe(201);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const served = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/attachments/${digest}`,
    });
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['etag']).toBe(digest);
  });

  it('refuses what is not a picture, by its bytes rather than its name', async () => {
    const { status } = await attach(Buffer.from('<html>not a picture</html>'));
    expect(status).toBe(415);
  });

  it('refuses a move that names a picture this session never had', async () => {
    const submitted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'k-unknown',
        headTurnId: null,
        input: { text: 'Look.', attachments: [{ digest: `sha256:${'b'.repeat(64)}` }] },
      },
    });
    expect(submitted.status).toBe(422);
    expect(submitted.body.error).toBe('unknown-attachment');
  });
});

describe('a picture on a move', () => {
  it('goes as pixels to a model that sees, and the record says so', async () => {
    const { digest } = await attach();
    const turn = await takeATurn({
      text: 'Look at this.',
      attachments: [{ digest, caption: 'the harbour at dusk' }],
    });

    // The record holds what the store read, never what a client claimed.
    expect(turn.input?.attachments).toEqual([
      {
        id: '0',
        kind: 'image',
        digest,
        mime: 'image/png',
        bytes: PNG.byteLength,
        caption: 'the harbour at dusk',
      },
    ]);
    expect(fake.requests.at(-1)?.images).toEqual([digest]);
    const [block] = pictureBlocks(turn);
    expect(block?.image).toMatchObject({ sent: true, digest });
    expect(block?.text).toContain('[Picture: the harbour at dusk]');

    const message = turn.request?.calls.at(-1)?.messages.find((one) => one.parts !== undefined);
    expect(message?.parts?.map((part) => part.kind)).toContain('image');
  });

  it('goes as its words to a model that does not, and says why', async () => {
    await narrateWith('fake-text');
    const { digest } = await attach();
    const turn = await takeATurn({
      text: 'Look at this.',
      attachments: [{ digest, caption: 'the harbour at dusk' }],
    });

    expect(fake.requests.at(-1)?.images).toEqual([]);
    const [block] = pictureBlocks(turn);
    expect(block?.image).toMatchObject({ sent: false, withheld: 'model-text-only' });
    const sent = (turn.request?.calls.at(-1)?.messages ?? []).map((one) => one.content).join('\n');
    expect(sent).toContain('[Picture — not shown: the harbour at dusk]');
    for (const message of turn.request?.calls.at(-1)?.messages ?? []) {
      expect(message.parts).toBeUndefined();
    }
  });

  /**
   * ***The lock-in test.*** A picture shown to a model that sees, then the
   * narrator rebound to one that does not, on the same connection. The second
   * turn must simply work: the earlier picture reaches it as its words, and no
   * pixels go anywhere they would be refused.
   */
  it('lets the story carry on with a text-only model after a picture', async () => {
    const { digest } = await attach();
    await takeATurn({ text: 'Look at this.', attachments: [{ digest, caption: 'a lantern' }] });
    expect(fake.requests.at(-1)?.images).toEqual([digest]);

    await narrateWith('fake-text');
    const next = await takeATurn({ text: 'We walk on.' });

    expect(next.status).toBe('complete');
    expect(fake.requests.at(-1)?.modelId).toBe('fake-text');
    expect(fake.requests.at(-1)?.images).toEqual([]);
    const [earlier] = pictureBlocks(next);
    expect(earlier?.image).toMatchObject({ sent: false });
    const sent = (next.request?.calls.at(-1)?.messages ?? []).map((one) => one.content).join('\n');
    expect(sent).toContain('[Picture — not shown: a lantern]');
  });

  /**
   * ***A picture from an earlier turn is words even to a model that sees*** —
   * R1's window is the move being made. Resending every picture in the history
   * on every turn is a cost nobody chose.
   */
  it('sends only the move’s own pictures as pixels, even to a model that sees', async () => {
    const { digest } = await attach();
    await takeATurn({ text: 'Look.', attachments: [{ digest }] });
    const next = await takeATurn({ text: 'And now?' });

    expect(fake.requests.at(-1)?.images).toEqual([]);
    expect(pictureBlocks(next)[0]?.image).toMatchObject({
      sent: false,
      withheld: 'outside-window',
    });
  });

  /**
   * ***A move that is only a picture is still a move.*** An empty half of
   * history used to be dropped, and a picture with no words would have been
   * dropped with it — lost from every prompt after the one it was sent in.
   */
  it('keeps a move that is only a picture in the history that follows', async () => {
    const { digest } = await attach();
    const shown = await takeATurn({ text: '', attachments: [{ digest }] });
    expect(shown.status).toBe('complete');

    const next = await takeATurn({ text: 'What do you make of it?' });
    const sent = (next.request?.calls.at(-1)?.messages ?? []).map((one) => one.content).join('\n');
    expect(sent).toContain('[Picture — not shown, and not described]');
  });
});

/**
 * ***An imported session's pictures*** — the two ways a session arrives, and
 * the one property both keep: **a session that had pictures continues without
 * them wherever they did not travel.**
 */
describe('pictures that travel', () => {
  /**
   * Redoes a session's first turn with its picture, as the client does — the
   * turn named as the one whose pictures the move carries — and returns the
   * sibling once it is complete.
   */
  async function redo(on: TestServer, session: string, shown: Turn): Promise<Turn> {
    const redone = await on.request({
      method: 'POST',
      url: `/api/sessions/${session}/turns`,
      payload: {
        idempotencyKey: 'k-redo',
        headTurnId: null,
        parentTurnId: shown.parentTurnId,
        input: { text: 'Look.', attachmentsOf: shown.id },
      },
    });
    expect(redone.status, JSON.stringify(redone.body)).toBe(202);
    const sibling = async (): Promise<Turn | undefined> => {
      const read = await on.request({ method: 'GET', url: `/api/sessions/${session}/turns` });
      return (read.body.turns as Turn[]).find(
        (turn) => turn.id !== shown.id && turn.status === 'complete',
      );
    };
    await eventually(async () => (await sibling()) !== undefined);
    const again = await sibling();
    if (again === undefined) throw new Error('the redo never completed');
    return again;
  }

  /**
   * ***A backup brings the bytes, because it holds the session directory
   * whole***, and the session it brings back sends them again.
   *
   * *Gone first*: an import leaves a session already here alone, so what a
   * backup brings back is a session deleted and emptied out of the trash —
   * which is what a backup is for, and the case that proves the bytes came out
   * of the archive rather than being found where they were.
   */
  it('comes back from a backup with its bytes, and a redo still sends them', async () => {
    const { digest } = await attach();
    const shown = await takeATurn({
      text: 'Look.',
      attachments: [{ digest, caption: 'a lantern' }],
    });

    const taken = await server.request({
      method: 'POST',
      url: '/api/me/backups',
      payload: { contents: 'full' },
    });
    const id = (taken.body as { backup: { id: string } }).backup.id;

    const deleted = await server.request({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    expect(deleted.status).toBeLessThan(300);
    await rm(join(new Layout(server.dataDir).trashRoot('ned'), 'sessions'), {
      recursive: true,
      force: true,
    });

    const imported = await server.request({
      method: 'POST',
      url: '/api/me/backups/import',
      payload: { id },
    });
    expect(imported.status).toBe(200);
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    const [back] = (listed.body.sessions as { id: string }[]).map((one) => one.id);
    if (back === undefined) throw new Error('the backup brought no session back');

    const served = await server.request({
      method: 'GET',
      url: `/api/sessions/${back}/attachments/${digest}`,
    });
    expect(served.status).toBe(200);

    await redo(server, back, shown);
    expect(fake.requests.at(-1)?.images).toEqual([digest]);
  });

  /**
   * ***From an export, the record arrives and the bytes do not*** — *the records,
   * not the pixels*. The turn still names its picture, a redo of it is still
   * accepted rather than refused as a picture this session never had, and the
   * redo sends the picture's words: the session continues as one that had a
   * picture, not as one that cannot go on.
   *
   * *On a second install*, which is where an export goes: the one that made it
   * refuses a session whose turns it already holds.
   */
  it('continues from an export without the bytes, as words', async () => {
    const { digest } = await attach();
    const shown = await takeATurn({
      text: 'Look.',
      attachments: [{ digest, caption: 'a lantern' }],
    });

    const exported = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });
    const there = await anInstall();
    others.push(there);
    const landed = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: exported.body,
    });
    expect(landed.status).toBe(201);
    const copy = landed.body.sessionId as string;

    const missing = await there.request({
      method: 'GET',
      url: `/api/sessions/${copy}/attachments/${digest}`,
    });
    expect(missing.status).toBe(404);

    // The model sees pictures; the bytes are what is missing, and the words go.
    const again = await redo(there, copy, shown);
    expect(fake.requests.at(-1)?.modelId).toBe('fake-vision');
    expect(fake.requests.at(-1)?.images).toEqual([]);
    // Pinned on the record too: without the bytes check this would read *sent*.
    expect(pictureBlocks(again)[0]?.image).toMatchObject({
      sent: false,
      withheld: 'missing-bytes',
    });
    // The picture as the record had it, copied rather than rebuilt.
    expect(again.input?.attachments).toEqual(shown.input?.attachments);
  });
});
