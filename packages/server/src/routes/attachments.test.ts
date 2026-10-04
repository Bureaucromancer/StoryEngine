// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AssembledBlock, AssembledPreview, Turn, TurnAttachment } from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { UNSENT_GRACE_MS } from '../sessions/attachments.js';
import { readTurns } from '../sessions/store.js';
import { listEntryNames, touchFile, writeFileBytes } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { eventually, makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Pictures on a player's move, and the one property they must not break*** —
 * [26 E15](../../../../docs/design/26-open-questions.md), R1.
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
 * The route's `ATTACHMENT_CAP_BYTES`, **restated rather than imported**: it is
 * a module constant and not an export, and a ceiling a test read out of the
 * code under test would agree with whatever number the code said.
 */
const CAP_BYTES = 8 * 1024 * 1024;

/** A second picture: other bytes, so another address. */
const OTHER_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);

/**
 * The content address of these bytes, **worked out here** rather than asked of
 * the store — the backup test's whole question is whether the store believed a
 * name, and asking it for the answer would be asking the suspect.
 */
function addressOf(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** The cookie and CSRF header `request` adds, for the uploads that go through `inject` directly. */
function credentials(on: TestServer): Record<string, string> {
  return {
    cookie: [...on.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    'x-csrf-token': on.cookies.get('se_csrf') ?? '',
  };
}

/**
 * An upload to any session on any install, with the answer's body — `attach`
 * for a test that reads a refusal, or that puts a picture somewhere other than
 * the session `beforeEach` made.
 */
async function uploadTo(
  session: string,
  bytes: Buffer,
  on: TestServer = server,
): Promise<{ status: number; body: any }> {
  const form = upload(bytes);
  const sent = await on.app.inject({
    method: 'POST',
    url: `/api/sessions/${session}/attachments`,
    payload: form.payload,
    headers: { ...form.headers, ...credentials(on) },
  });
  return { status: sent.statusCode, body: sent.json() };
}

/** What the bytes route answers for a digest, as a status. */
async function served(
  digest: string,
  session: string = sessionId,
  on: TestServer = server,
): Promise<number> {
  const read = await on.request({
    method: 'GET',
    url: `/api/sessions/${session}/attachments/${digest}`,
  });
  return read.status;
}

/** A session's picture store on disk — ned's, which is whose every install here is. */
function attachmentsFolder(session: string = sessionId, on: TestServer = server): string {
  return join(new Layout(on.dataDir).sessionRoot('ned', session), 'attachments');
}

/**
 * Makes a stored PNG read as last wanted more than a day ago — past the
 * sweep's grace, by the store's own constant, so the sweep that rides on the
 * next upload weighs it. *A day passes in a line*: the file's time is the only
 * clock the sweep reads, so nothing here depends on how long the suite takes.
 */
async function age(digest: string): Promise<void> {
  const path = join(attachmentsFolder(), `${digest.slice('sha256:'.length)}.png`);
  const then = new Date(Date.now() - UNSENT_GRACE_MS - 60_000);
  expect(await touchFile(path, then), `no picture at ${path} to age`).toBe(true);
}

async function aSession(name: string, extra: object = {}): Promise<string> {
  const created = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: { name, ...extra },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.session.id as string;
}

/** Signs in as a second, ordinary account — `backups.test.ts`'s helper. */
async function asUser(handle = 'mara'): Promise<void> {
  await server.services.accounts.create({
    handle,
    password: 'another long password',
    role: 'user',
  });
  await server.request({ method: 'POST', url: '/api/auth/logout' });
  await server.request({
    method: 'POST',
    url: '/api/auth/login',
    payload: { handle, password: 'another long password' },
  });
}

/** The preview's answer, which every test here expects to have been assembled. */
async function previewOf(input: object, session: string = sessionId): Promise<AssembledPreview> {
  const answered = await server.request({
    method: 'POST',
    url: `/api/sessions/${session}/preview`,
    payload: { input },
  });
  expect(answered.status, JSON.stringify(answered.body)).toBe(200);
  const preview = answered.body.preview as { state: string };
  if (preview.state !== 'assembled') {
    throw new Error(`the preview was not assembled: ${JSON.stringify(preview)}`);
  }
  return preview as AssembledPreview;
}

function picturesOf(blocks: readonly AssembledBlock[]): AssembledBlock[] {
  return blocks.filter((block) => block.image !== undefined);
}

/**
 * Why each picture went as words, by attachment id — every distinct reason
 * across every call that carried it, and `sent` where none was given. One map
 * rather than a block apiece, so a mode that asks two calls about the same move
 * cannot make an assertion pass on the first and never look at the second.
 */
function withheldById(blocks: readonly AssembledBlock[]): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const block of blocks) {
    if (block.image === undefined) continue;
    const reasons = (found[block.image.attachmentId] ??= []);
    const reason = block.image.withheld ?? 'sent';
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return found;
}

/** Everything the last call of a turn said, as one string. */
function wordsSent(turn: Turn): string {
  return (turn.request?.calls.at(-1)?.messages ?? []).map((one) => one.content).join('\n');
}

describe('putting a picture in a session', () => {
  /**
   * ***An upload moves no head*** (2026-09-30). The route went through the
   * session reconcile, which appends a divergence turn when the file was edited
   * by hand — so attaching a picture could move the head under the composer it
   * was being attached in, and the move that followed was refused as out of
   * date. It reads the session as the preview does now.
   */
  it('reconciles nothing, so attaching cannot move the head', async () => {
    const file = join(new Layout(server.dataDir).sessionRoot('ned', sessionId), 'session.json');
    const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    stored['channels'] = { 'se.clock': { version: 1, value: { day: 9, hour: 9, minute: 9 } } };
    await writeFile(file, JSON.stringify(stored, null, 2));
    const before = (await readTurns(server.services.sessions, 'ned', sessionId)).size;

    expect((await attach()).status).toBe(201);

    expect((await readTurns(server.services.sessions, 'ned', sessionId)).size).toBe(before);
  });

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

/**
 * ***The sweep that rides on an upload, and the re-upload it used to eat*** —
 * [26 E15]'s *pictures nothing names and nobody has touched for a day go*, and
 * `storeAttachment`'s 2026-09-27 correction.
 *
 * The sweep is right to exist: a composer that attached a picture and was
 * abandoned would otherwise leave it for good. What it must never do is take a
 * picture somebody still wants, and *still wants* has two witnesses — a turn
 * that names it, and a person who uploaded it again today.
 */
describe('the sweep, and a picture uploaded twice', () => {
  /**
   * ***The control the regression below stands on.*** Aging a file by hand has
   * to be something the sweep sees, or the regression passes because no sweep
   * ever weighed the picture at all. So: an aged picture no turn names is gone
   * after the next upload of *another* picture, and that one stays.
   *
   * Fails if the sweep stops riding on the upload, or stops reading the file's
   * time — and with it, the test after next would stop proving anything.
   */
  it('sweeps a picture nobody named for a day, on the next upload', async () => {
    const { digest } = await attach();
    await age(digest);

    const other = await attach(OTHER_PNG);

    expect(other.status).toBe(201);
    expect(await served(digest)).toBe(404);
    expect(await served(other.digest)).toBe(200);
  });

  /**
   * ***A picture a turn names is never swept, however old*** — age is the
   * sweep's first question and never its only one. A turn's record keeps the
   * digest and not the bytes, so a sweep on age alone would leave the record
   * pointing at nothing, and every redo of that move would send words where it
   * had sent pixels.
   *
   * Fails if the sweep deletes on age without asking `digestsOf` what the
   * session's turns name, or asks about the wrong session's turns.
   */
  it('keeps a day-old picture a turn names', async () => {
    const { digest } = await attach();
    await takeATurn({ text: 'Look.', attachments: [{ digest, caption: 'a lantern' }] });
    await age(digest);

    expect((await attach(OTHER_PNG)).status).toBe(201);

    expect(await served(digest)).toBe(200);
  });

  /**
   * ***The regression.*** A picture uploaded, left for a day, and uploaded
   * again — a composer reopened the next morning. Content addressing meant the
   * second upload found its file already there and wrote nothing, so the file
   * still read as a day old, and the sweep in the *same request* removed it as
   * a picture nothing named. The upload answered `201` with a digest, and the
   * move that named that digest was refused `422 unknown-attachment`: a person
   * told their picture was stored, and then told it had never been uploaded.
   *
   * Fails if `storeAttachment` goes back to leaving a picture that is already
   * there untouched — `touchFile` replaced by an existence check — and it fails
   * at `takeATurn`'s `202`, which is where the person met it.
   */
  it('renews a day-old picture uploaded again, so the move naming it goes', async () => {
    const { digest } = await attach();
    await age(digest);

    expect(await attach()).toEqual({ status: 201, digest });
    const turn = await takeATurn({ text: 'Look again.', attachments: [{ digest }] });

    expect(turn.status).toBe('complete');
    expect(fake.requests.at(-1)?.images).toEqual([digest]);
  });
});

/**
 * ***A picture is the session's it was uploaded to, and nobody else's*** —
 * `sessions/<id>/attachments/`, where the path is the owner
 * ([09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md)).
 *
 * Content addressing is what makes this worth pinning: the same bytes have the
 * same name everywhere, and a digest is a hash anyone holding the picture — or
 * reading a shared export, which carries digests and not bytes — can write
 * down. So the address can never be what grants a picture; the session in the
 * path has to be.
 */
describe('a picture belongs to its session', () => {
  /**
   * The same account, a second session: a digest uploaded to the first is not
   * a picture the second has, either to put on a move or to fetch.
   *
   * Fails if the store were keyed by account (or install) rather than by
   * session — which content addressing makes tempting, since it would dedupe a
   * picture shown in two stories — or if either route looked a digest up
   * anywhere but under the session in its path.
   */
  it('is not a picture another session of the same account has', async () => {
    const { digest } = await attach();
    const elsewhere = await aSession('The lighthouse');

    const named = await server.request({
      method: 'POST',
      url: `/api/sessions/${elsewhere}/turns`,
      payload: {
        idempotencyKey: 'k-elsewhere',
        headTurnId: null,
        input: { text: 'Look.', attachments: [{ digest }] },
      },
    });

    expect(named.status).toBe(422);
    expect(named.body).toMatchObject({ error: 'unknown-attachment', digest });
    expect(await served(digest, elsewhere)).toBe(404);
  });

  /**
   * A second account, who knows the digest: naming it on a move in her own
   * session is refused, fetching it under her session finds nothing, and
   * fetching it under *his* session's address is a session she does not have.
   *
   * Fails if the attachment store resolved against anything but the signed-in
   * account's own folder — a handle taken from the path, or the install-wide
   * data root — and fails loudest on the last line, which is the one that
   * would hand her his picture.
   */
  it('is not a picture another account has, nor one she can fetch', async () => {
    const { digest } = await attach();
    const his = sessionId;
    await asUser('mara');
    const hers = await aSession('Her own harbour');

    const named = await server.request({
      method: 'POST',
      url: `/api/sessions/${hers}/turns`,
      payload: {
        idempotencyKey: 'k-hers',
        headTurnId: null,
        input: { text: 'Look.', attachments: [{ digest }] },
      },
    });

    expect(named.status).toBe(422);
    expect(named.body).toMatchObject({ error: 'unknown-attachment', digest });
    expect(await served(digest, hers)).toBe(404);
    expect(await served(digest, his)).toBe(404);
  });
});

/**
 * ***What the upload door refuses before anything is written*** — the size
 * ceiling, and a session that is no longer there to hold the picture.
 */
describe('what an upload refuses', () => {
  /**
   * ***Eight megabytes is the picture's ceiling, and it is the route's own***
   * — below `limits.maxUploadMb`, whose default is 64, so the upload door lets
   * this body through and the route is the one that refuses it. The message
   * says which: the upload limit's 413 names *the upload limit*, this one names
   * the picture. And a byte under is accepted, so the ceiling is exactly where
   * the route says.
   *
   * *A PNG by its signature*, so the refusal cannot be the sniffer's 415 in
   * disguise.
   *
   * Fails if the check goes (the 8 MB + 1 picture is stored, `201`), moves
   * after the store (a `413` with the file already on disk), or tightens to
   * `>=` (the picture at exactly the ceiling is refused).
   */
  it('refuses a picture over 8 MB, and takes one at exactly 8 MB', async () => {
    const signature = PNG.subarray(0, 8);
    const over = Buffer.concat([signature, Buffer.alloc(CAP_BYTES + 1 - signature.length)]);

    const refused = await uploadTo(sessionId, over);

    expect(refused.status).toBe(413);
    expect(refused.body.error).toBe('too-large');
    expect(refused.body.message).toContain('8 MB');
    expect(refused.body.message).not.toContain('upload limit');
    expect(await listEntryNames(attachmentsFolder())).toEqual([]);

    const at = Buffer.concat([signature, Buffer.alloc(CAP_BYTES - signature.length)]);
    const taken = await uploadTo(sessionId, at);
    expect(taken.status).toBe(201);
    expect(taken.body.attachment.bytes).toBe(CAP_BYTES);
  });

  /**
   * A session deleted, then a picture sent to it: refused as a session that is
   * not here, and **no folder made for it** under the live sessions directory
   * — where a `sessions/<id>/attachments/` holding one picture would sit beside
   * the trashed session, a folder nothing lists, sweeps or removes.
   *
   * Fails if the route stored before asking whether the session exists — both
   * the `mine` check at the door and the check under the lock would have to go,
   * which is what the next test is for.
   */
  it('refuses a picture for a deleted session, and makes no folder for it', async () => {
    const deleted = await server.request({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    expect(deleted.status).toBe(204);

    const sent = await uploadTo(sessionId, PNG);

    expect(sent.status).toBe(404);
    expect(sent.body.error).toBe('not-found');
    expect(await listEntryNames(new Layout(server.dataDir).sessionsRoot('ned'))).not.toContain(
      sessionId,
    );
  });

  /**
   * ***Deleted while the picture was on its way*** — the case the check under
   * the session lock exists for. The body is read after the door's `mine` and
   * outside the lock, so a slow transfer holds nothing; the session can go in
   * that gap, and the store must then find it gone rather than recreate it.
   *
   * *Ordered by a signal, not a sleep*: the body is a stream whose first read
   * is the handler asking for the bytes — which it does only after `mine` has
   * let it through — and nothing is pushed until the session has been deleted.
   * If the route answered without reading, that answer is reported rather
   * than waited on.
   *
   * Fails if the store stops checking `session.json` under the lock: the door
   * saw a session, nothing after it looked again, and the picture lands in a
   * new `sessions/<id>/` beside the one in the trash.
   */
  it('refuses a picture whose session was deleted while it was on its way', async () => {
    let asked = (): void => undefined;
    const reading = new Promise<void>((resolve) => {
      asked = resolve;
    });
    const body = new Readable({
      read() {
        asked();
      },
    });
    const form = upload(PNG);
    const answer = server.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/attachments`,
      headers: { ...form.headers, ...credentials(server) },
      payload: body,
    });

    await Promise.race([
      reading,
      answer.then((early) => {
        throw new Error(`answered before reading the picture: ${String(early.statusCode)}`);
      }),
    ]);
    const deleted = await server.request({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    expect(deleted.status).toBe(204);
    body.push(form.payload);
    body.push(null);
    const answered = await answer;

    expect(answered.statusCode).toBe(404);
    expect(answered.json<{ error: string }>().error).toBe('not-found');
    expect(await listEntryNames(new Layout(server.dataDir).sessionsRoot('ned'))).not.toContain(
      sessionId,
    );
  });
});

/**
 * ***A move's shape is closed*** — `SubmitBody.input` since 2026-09-27, and
 * `PreviewBody.input`, which was already. An open one gave a newer client
 * naming a field this server did not know a `202` and silently dropped the
 * field — a picture sent to an older server would have vanished from its turn
 * with nothing said. A `400` naming the field is the refusal a person can act
 * on.
 */
describe('a move’s closed shape', () => {
  /**
   * Fails if `SubmitBody.input` is opened again (`additionalProperties`
   * dropped or set true): the unknown field is then accepted and lost, and the
   * submission answers `202`.
   */
  it('refuses a submission whose move has a field it does not know', async () => {
    const submitted = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: { idempotencyKey: 'k-raw', headTurnId: null, input: { text: 'x', raw: 'x' } },
    });

    expect(submitted.status).toBe(400);
    expect(submitted.body.error).toBe('invalid');
    expect(submitted.body.issues).toContainEqual(expect.objectContaining({ path: '/input/raw' }));
  });

  /**
   * The preview is *field for field the half of `SubmitBody` that describes
   * what would be sent*, so it refuses what the submission refuses — a preview
   * that took a field the turn then refused would show a prompt nobody can
   * send.
   *
   * Fails if `PreviewBody.input` is opened: the preview answers `200`.
   */
  it('refuses a preview whose move has a field it does not know', async () => {
    const previewed = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/preview`,
      payload: { input: { text: 'x', raw: 'x' } },
    });

    expect(previewed.status).toBe(400);
    expect(previewed.body.error).toBe('invalid');
    expect(previewed.body.issues).toContainEqual(expect.objectContaining({ path: '/input/raw' }));
  });
});

/**
 * ***A redo's pictures, named by the turn that has them*** —
 * `input.attachmentsOf`, and `attachmentsAgain` behind it. The record is copied
 * as it stands: every id, kind and caption, and pictures with no digest at
 * all. Until 2026-09-27 a redo's client rebuilt the list from digest and
 * caption, which is lossless for every record this build writes and lossy for
 * every other — and the others are exactly what an import brings.
 */
describe('a redo’s pictures, named by the turn that has them', () => {
  /**
   * A session exported with one picture on its first move, the move's record
   * rewritten to `pictures`, and imported on a second install — which is how a
   * record this build would never write arrives: from an export made by a
   * newer build, or by an importer that had no bytes.
   */
  async function importedWith(
    pictures: (digest: string) => TurnAttachment[],
  ): Promise<{ there: TestServer; copy: string; shown: Turn; digest: string }> {
    const { digest } = await attach();
    const shown = await takeATurn({
      text: 'Look.',
      attachments: [{ digest, caption: 'a lantern' }],
    });
    const exported = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/export`,
    });
    const record = (exported.body.turns as Turn[]).find((turn) => turn.id === shown.id);
    if (record?.input === undefined) throw new Error('the export does not carry the move');
    record.input.attachments = pictures(digest);

    const there = await anInstall();
    others.push(there);
    const landed = await there.request({
      method: 'POST',
      url: '/api/sessions/import',
      payload: exported.body,
    });
    expect(landed.status, JSON.stringify(landed.body)).toBe(201);
    return { there, copy: landed.body.sessionId as string, shown, digest };
  }

  /**
   * ***Three pictures a composer could never have sent, copied as they are.***
   * A kind this build does not know, a picture with no digest, and one whose
   * digest names bytes that did not travel. The redone move records the list
   * exactly as the turn it names did; no pixels go; and each picture's block
   * says why, by the send rule's precedence — the kind first, then the bytes.
   * These are the redone move's own pictures, so they are *current*: the window
   * is not the reason for any of them, and the model sees, so it is not either.
   *
   * Fails if a redo rebuilds its pictures from digests again: the digest-less
   * picture is dropped with its caption, the hologram becomes an `image`, and
   * the ids move — each a different line below. And if the kind check went from
   * `withheldBecause`, the hologram would read `missing-bytes`, which is true
   * and is not the reason.
   */
  it('copies the record’s pictures as they stand, and sends none it cannot', async () => {
    const { there, copy, shown } = await importedWith((digest) => [
      { id: '0', kind: 'hologram', caption: 'from later' },
      { id: '1', kind: 'image', caption: 'no bytes' },
      { id: '2', kind: 'image', digest, mime: 'image/png', caption: 'a lantern' },
    ]);
    const recorded = await there.request({
      method: 'GET',
      url: `/api/sessions/${copy}/turns/${shown.id}`,
    });
    const record = recorded.body.turn as Turn;
    expect(record.input?.attachments?.map((one) => [one.id, one.kind])).toEqual([
      ['0', 'hologram'],
      ['1', 'image'],
      ['2', 'image'],
    ]);

    const again = await redo(there, copy, shown);

    expect(again.input?.attachments).toEqual(record.input?.attachments);
    expect(fake.requests.at(-1)?.modelId).toBe('fake-vision');
    expect(fake.requests.at(-1)?.images).toEqual([]);
    expect(withheldById(pictureBlocks(again))).toEqual({
      '0': ['unknown-kind'],
      '1': ['missing-bytes'],
      '2': ['missing-bytes'],
    });
    // And each went as its words, so the model is told all three were there.
    const sent = wordsSent(again);
    for (const caption of ['from later', 'no bytes', 'a lantern']) {
      expect(sent).toContain(`[Picture — not shown: ${caption}]`);
    }
  });

  /**
   * ***A kind this build does not know never goes as pixels — even when its
   * bytes are here.*** The sharper half of the case above, and the one
   * `attachmentsAgain`'s correction names: a newer build's kind, rebuilt as an
   * `image`, whose bytes happened to be in the store would have been sent to
   * the model as a picture it was never described as. Here the bytes arrive
   * after the record did — as a backup restored beside an import would bring
   * them — so the only thing holding them back is the kind.
   *
   * Fails if the redo re-mints the kind as `image`, or if `withheldBecause`
   * stops refusing kinds it does not know: either way the model is sent the
   * pixels, and `images` holds the digest.
   */
  it('never sends a kind it does not know as pixels, even with its bytes here', async () => {
    const { there, copy, shown, digest } = await importedWith((held) => [
      { id: '0', kind: 'hologram', digest: held, mime: 'image/png', caption: 'from later' },
    ]);
    expect((await uploadTo(copy, PNG, there)).status).toBe(201);
    expect(await served(digest, copy, there)).toBe(200);

    const again = await redo(there, copy, shown);

    expect(again.input?.attachments?.[0]).toMatchObject({ id: '0', kind: 'hologram', digest });
    expect(fake.requests.at(-1)?.modelId).toBe('fake-vision');
    expect(fake.requests.at(-1)?.images).toEqual([]);
    expect(withheldById(pictureBlocks(again))).toEqual({ '0': ['unknown-kind'] });
  });

  /**
   * ***Its own pictures or another turn's, not both*** — two answers to *which
   * pictures does this move carry*, and a server that picked one would lose the
   * other without saying so.
   *
   * Fails if the both-check goes: `attachmentsOf` wins, the pictures just
   * uploaded are dropped, and the move answers `202`.
   */
  it('refuses a move that names its own pictures and another turn’s', async () => {
    const { digest } = await attach();
    const shown = await takeATurn({ text: 'Look.', attachments: [{ digest }] });

    const both = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/turns`,
      payload: {
        idempotencyKey: 'k-both',
        headTurnId: null,
        parentTurnId: shown.parentTurnId,
        input: { text: 'Look.', attachments: [{ digest }], attachmentsOf: shown.id },
      },
    });

    expect(both.status).toBe(400);
    expect(both.body.error).toBe('invalid');
  });

  /**
   * ***A turn in another session is not one to take pictures from***, even
   * the same account's. The turn id is looked up *in this session*, so a move
   * cannot carry another story's pictures — or their captions, which are the
   * player's words about something they showed somewhere else.
   *
   * Fails if the lookup finds a turn by id across the account: the move is
   * accepted, and its record names a picture this session never had.
   */
  it('refuses to take pictures from a turn in another session', async () => {
    const { digest } = await attach();
    const shown = await takeATurn({
      text: 'Look.',
      attachments: [{ digest, caption: 'a lantern' }],
    });
    const elsewhere = await aSession('The lighthouse');

    const taken = await server.request({
      method: 'POST',
      url: `/api/sessions/${elsewhere}/turns`,
      payload: {
        idempotencyKey: 'k-taken',
        headTurnId: null,
        input: { text: 'Look.', attachmentsOf: shown.id },
      },
    });

    expect(taken.status).toBe(404);
    expect(taken.body.error).toBe('no-such-turn');
  });
});

/**
 * ***The preview's pictures*** — [P3.4]'s *what would be sent*, for a move with
 * pictures on it. The preview reads the draft's pictures as a submission reads
 * them and resolves the model the turn will, so *this picture will be seen* is
 * the turn's answer rather than a guess about it.
 */
describe('the preview’s pictures', () => {
  /**
   * The narrator sees, the bytes are here, the picture is the move's own: the
   * preview says it will go as pixels.
   *
   * Fails if the preview stops asking which of the draft's pictures are
   * present (`picturesPresent` absent reads as *none*, and the block says
   * `missing-bytes`), or stops putting the draft's pictures in at all.
   */
  it('says a picture will be seen by a narrator that sees', async () => {
    const { digest } = await attach();

    const preview = await previewOf({ text: 'Look.', attachments: [{ digest }] });

    expect(preview.resolved.modelId).toBe('fake-vision');
    expect(picturesOf(preview.blocks).map((block) => block.image)).toEqual([
      { attachmentId: '0', digest, mime: 'image/png', sent: true },
    ]);
  });

  /**
   * The account's narrator rebound to a model that does not see: the same
   * draft now previews as words, and says why.
   *
   * Fails if the preview's send rule were decided anywhere but from the model
   * the call resolved to — a session flag, a connection-wide one — which is the
   * lock-in the whole feature is built against.
   */
  it('says a picture will go as words once the narrator cannot see', async () => {
    const { digest } = await attach();
    await narrateWith('fake-text');

    const preview = await previewOf({ text: 'Look.', attachments: [{ digest }] });

    expect(preview.resolved.modelId).toBe('fake-text');
    expect(picturesOf(preview.blocks).map((block) => block.image)).toEqual([
      { attachmentId: '0', digest, mime: 'image/png', sent: false, withheld: 'model-text-only' },
    ]);
  });

  /**
   * ***The session's own narrator, not the account's.*** The account's binding
   * sees; the session points prose at a model that does not; the preview must
   * answer for the model the turn will actually ask. Until `roleLayersOf`
   * (2026-09-27) the preview never passed the session's overrides, and it would
   * have promised pixels here that the turn would never send.
   *
   * Fails if the preview resolves the role without the session's layers: it
   * reads `fake-vision` and `sent: true`, as it does before the override.
   */
  it('answers for the session’s own narrator, not the account’s', async () => {
    const { digest } = await attach();
    const input = { text: 'Look.', attachments: [{ digest }] };
    expect(picturesOf((await previewOf(input)).blocks)[0]?.image?.sent).toBe(true);

    const pointed = await server.request({
      method: 'PUT',
      url: `/api/sessions/${sessionId}/roles`,
      payload: { roles: { prose: { connectionId: CONNECTION, modelId: 'fake-text' } } },
    });
    expect(pointed.status, JSON.stringify(pointed.body)).toBe(200);

    const preview = await previewOf(input);

    expect(preview.resolved.modelId).toBe('fake-text');
    expect(picturesOf(preview.blocks)[0]?.image).toMatchObject({
      sent: false,
      withheld: 'model-text-only',
    });
  });

  /**
   * ***A picture the store does not hold is left out, in place.*** A preview
   * fires on every pause in typing, so a picture swept a moment ago must not
   * turn the meter into an error — nor hide the pictures that are fine behind
   * it. *In place* is the half that is easy to lose: the picture that remains
   * keeps the id it will have when the move is sent, so the preview labels it
   * as the turn will.
   *
   * Fails if the preview refuses (`422`, as a submission does), drops every
   * picture because one was unknown, or renumbers what is left — `'0'` here
   * where the turn would record `'1'`.
   */
  it('leaves out a picture it does not hold, and keeps the rest with their ids', async () => {
    const { digest } = await attach();

    const preview = await previewOf({
      text: 'Look.',
      attachments: [
        { digest: `sha256:${'b'.repeat(64)}`, caption: 'swept a moment ago' },
        { digest, caption: 'a lantern' },
      ],
    });

    const pictures = picturesOf(preview.blocks);
    expect(pictures.map((block) => block.image?.attachmentId)).toEqual(['1']);
    expect(pictures[0]?.source).toEqual({ kind: 'input', part: 'attachment', attachmentId: '1' });
    expect(pictures[0]?.image).toMatchObject({ digest, sent: true });
  });

  /**
   * ***A move with no kind previews as the `do` a submission would make it***
   * — `DEFAULT_INPUT_KIND`, shared so the two cannot drift. Freeform's input
   * slots are all per-kind (`appliesTo: ['do']` and its siblings), so a preview
   * with no kind at all matched none of them and showed a prompt with neither
   * the draft's words nor its pictures — while the turn defaulted to `do` and
   * sent both. Scene's one input slot applies to every kind, which is why this
   * needs a Freeform session: the default mode could not show the difference.
   *
   * Fails if the preview passes no input kind when the draft names none: the
   * words block and the picture block are both absent.
   */
  it('previews a move with no kind as the do a submission would make it', async () => {
    const freeform = await aSession('Rain', {
      mode: 'storyengine.freeform',
      modeConfig: { premise: 'Rain.', difficulty: 'even', directedness: 'following' },
    });
    const { status, body } = await uploadTo(freeform, PNG);
    expect(status).toBe(201);
    const digest = body.attachment.digest as string;

    const preview = await previewOf({ text: 'Knock.', attachments: [{ digest }] }, freeform);

    const words = preview.blocks.filter(
      (block) => block.source.kind === 'input' && block.image === undefined,
    );
    expect(words.map((block) => block.id)).toEqual(['se.input.do']);
    expect(words[0]?.text).toContain('Knock.');
    expect(picturesOf(preview.blocks).map((block) => block.image?.attachmentId)).toEqual(['0']);
  });
});

/**
 * ***A backup's pictures are addressed by their bytes, not by their names*** —
 * the backup importer stores each file through the attachment store rather
 * than copying it by name. An archive is a file somebody can open and edit,
 * and the live store serves a picture by the name its file has; so an archive
 * that carried a file under a name it did not earn would, copied as named, put
 * that file behind a digest a turn might name.
 */
describe('a backup’s pictures, addressed by their bytes', () => {
  /**
   * Takes a full backup, deletes the session and empties the trash — an import
   * leaves a session already here alone, so this is the case that proves the
   * bytes came out of the archive — imports it, and returns the session it
   * brought back.
   */
  async function throughABackup(): Promise<string> {
    const taken = await server.request({
      method: 'POST',
      url: '/api/me/backups',
      payload: { contents: 'full' },
    });
    expect(taken.status).toBe(201);
    const id = (taken.body as { backup: { id: string } }).backup.id;

    const deleted = await server.request({ method: 'DELETE', url: `/api/sessions/${sessionId}` });
    expect(deleted.status).toBe(204);
    await rm(join(new Layout(server.dataDir).trashRoot('ned'), 'sessions'), {
      recursive: true,
      force: true,
    });

    const imported = await server.request({
      method: 'POST',
      url: '/api/me/backups/import',
      payload: { id },
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    const [back] = (listed.body.sessions as { id: string }[]).map((one) => one.id);
    if (back === undefined) throw new Error('the backup brought no session back');
    return back;
  }

  /**
   * Two files put in a session's store by hand before the backup: text bytes
   * under a PNG's name, and a real PNG under a hex name that is not its digest.
   * *Here, before the backup, both are served by their names* — the live store
   * reads a file by what it is called — which is exactly why the import cannot
   * take a name as evidence.
   *
   * After the round trip, the text is nowhere (it is not a picture, so the
   * store refuses it), and the PNG is served under its true digest and not
   * under the name it arrived with.
   *
   * Fails if the importer goes back to copying `attachments/` by name: both
   * fake names would then be served again, and the true digest would find
   * nothing.
   */
  it('stores what a backup brings under the digest its bytes have', async () => {
    await takeATurn({ text: 'We walk on.' });
    const notAPicture = 'd'.repeat(64);
    const misnamed = 'c'.repeat(64);
    const truly = addressOf(OTHER_PNG);
    await writeFileBytes(
      join(attachmentsFolder(), `${notAPicture}.png`),
      Buffer.from('<html>not a picture</html>'),
    );
    await writeFileBytes(join(attachmentsFolder(), `${misnamed}.png`), OTHER_PNG);
    expect(await served(`sha256:${notAPicture}`)).toBe(200);
    expect(await served(`sha256:${misnamed}`)).toBe(200);
    expect(await served(truly)).toBe(404);

    const back = await throughABackup();

    expect(await served(`sha256:${notAPicture}`, back)).toBe(404);
    expect(await served(`sha256:${misnamed}`, back)).toBe(404);
    expect(await served(truly, back)).toBe(200);
  });
});
