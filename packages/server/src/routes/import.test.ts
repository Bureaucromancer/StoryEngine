// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The first upload route this server has had ([P4 §1.3]).
 *
 * Three things are being tested and only one of them is the conversion: that the
 * limit is read **per request** rather than frozen at construction — which is
 * what earns `limits.maxUploadMb` its `applied` row after three phases as the
 * standing example of a key nobody read — that the ordinary mutation rules apply
 * to an upload like anything else, and that a file this build cannot convert
 * ~~*yet* is reported as such rather than refused as broken~~ **is reported as
 * unrecognised, and that the files it can convert all do**.
 *
 * *Amended at the P4 completeness audit ([P4 §7.1]).* The third clause used to
 * read the other way, and a test asserted it: a card PNG came back `recorded`
 * with a note saying the build was unfinished. That was true at P4.1 and false
 * from P4.2, when the sweep learned cards — and nothing taught this route, so
 * the one file everybody uploads first was the one file it could not take. The
 * cases below are the shapes a person actually arrives with.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

const PRESET = {
  prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'You are {{char}}.' }],
  prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }],
  temperature: 0.9,
  proxy_password: 'this must never reach disk',
};

/** A multipart body, hand-built: one file part, which is all this route takes. */
function multipart(
  filename: string,
  contents: string,
): { payload: string; headers: Record<string, string> } {
  const boundary = '----storyengineTestBoundary';
  const payload = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: application/json',
    '',
    contents,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/**
 * The same body with bytes in it, which a card needs.
 *
 * A separate function rather than a widened `multipart`, because the difference
 * is not the signature: a text part can be joined with `\r\n` and a binary one
 * cannot survive being decoded and re-encoded on the way through. Assembling it
 * as buffers is the point of it.
 */
function binaryMultipart(
  filename: string,
  bytes: Uint8Array,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----storyengineTestBoundary';
  const head = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: application/octet-stream',
      '',
      '',
    ].join('\r\n'),
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    payload: Buffer.concat([head, Buffer.from(bytes), tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function upload(filename: string, contents: string) {
  const { payload, headers } = multipart(filename, contents);
  return server.request({ method: 'POST', url: '/api/import/file', payload, headers });
}

describe('uploading one preset', () => {
  it('converts it, stores it, and names it from the filename', async () => {
    const response = await upload('Harbour.json', JSON.stringify(PRESET));

    expect(response.status).toBe(201);
    expect(response.body.item.disposition).toBe('converted');
    expect(response.body.item.source).toBe('Harbour.json');

    const listed = await server.request({ method: 'GET', url: '/api/library/presets' });
    expect(listed.body.objects.map((row: { name: string }) => row.name)).toContain('Harbour');
  });

  it('drops the credential on the way in, and says it did', async () => {
    // The stance's own showcase, through the route rather than the converter:
    // what reaches disk is what matters, and this is the path a file takes.
    const response = await upload('Harbour.json', JSON.stringify(PRESET));
    const id = response.body.item.objectId as string;

    const stored = await server.request({ method: 'GET', url: `/api/library/presets/${id}` });
    expect(JSON.stringify(stored.body)).not.toContain('this must never reach disk');
    expect(response.body.notes.map((n: { key: string }) => n.key)).toContain(
      'import.preset.credentialsRemoved',
    );
  });

  it('reports a file that is neither card nor JSON as unrecognised', async () => {
    // ~~A PNG card lands here today and converts at P4.2.~~ This now says what it
    // means: bytes nothing recognised. The old note claimed the build was
    // unfinished, which outlived being true by three stages.
    const response = await upload('Vera.png', 'not json, a picture');

    expect(response.status).toBe(200);
    expect(response.body.item.disposition).toBe('unrecognised');
    expect(response.body.notes[0].key).toBe('import.file.unrecognised');
  });

  it('reports JSON that is no preset at all as unrecognised', async () => {
    const response = await upload('something.json', JSON.stringify({ unrelated: true }));

    expect(response.body.item.disposition).toBe('unrecognised');
  });
});

/**
 * The audit's finding 7.1, as the files a person actually uploads.
 *
 * Each of these converted in a folder sweep and failed here, on the same build,
 * through the same library — which is the whole shape of the defect and the
 * reason the fix was to delete this route's converter rather than extend it.
 */
describe('uploading the things people actually upload', () => {
  const VERA = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Vera Solano',
      description: 'A harbourmaster who has read every manifest twice.',
      first_mes: 'You are late.',
      scenario: 'The harbour office, an hour before the tide.',
    },
  };

  const card = (): Uint8Array => withChunks(makePng(), [base64TextChunk('chara', VERA)]);

  const uploadBytes = async (filename: string, bytes: Uint8Array) => {
    const { payload, headers } = binaryMultipart(filename, bytes);
    return server.request({ method: 'POST', url: '/api/import/file', payload, headers });
  };

  it('converts a character card that arrived as a picture', async () => {
    const response = await uploadBytes('Vera.png', card());

    expect(response.status).toBe(201);
    expect(response.body.item.disposition).toBe('converted');

    const listed = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(listed.body.objects.map((row: { name: string }) => row.name)).toContain('Vera Solano');
  });

  it('converts a character card that arrived as JSON', async () => {
    const response = await upload('Vera.json', JSON.stringify(VERA));

    expect(response.status).toBe(201);
    expect(response.body.item.disposition).toBe('converted');

    const listed = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(listed.body.objects.map((row: { name: string }) => row.name)).toContain('Vera Solano');
  });

  it('converts a lorebook, which used to be told it was unidentifiable', async () => {
    // The sharper half of 7.1. A card at least got an honest *not yet*; a
    // lorebook got `unrecognised`, which is a confident wrong answer.
    const book = {
      name: 'Harbour lore',
      entries: {
        '0': { uid: 0, key: ['tide'], content: 'The tide runs out at dusk.', order: 100 },
      },
    };

    const response = await upload('Harbour lore.json', JSON.stringify(book));

    expect(response.status).toBe(201);
    expect(response.body.item.disposition).toBe('converted');

    const listed = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect(listed.body.objects).toHaveLength(1);
  });

  it('carries the scenario off a card into a treatment, as a sweep does', async () => {
    // `convertOne` calls `flushTreatments`, so the second object a card produces
    // is not silently lost — the reason one candidate returns a list.
    await uploadBytes('Vera.png', card());

    const listed = await server.request({ method: 'GET', url: '/api/library/treatments' });
    expect(listed.body.objects).toHaveLength(1);
  });

  it('still refuses a picture with no character in it, and says which', async () => {
    const response = await uploadBytes('holiday.png', makePng());

    expect(response.body.item.disposition).toBe('unrecognised');
    expect(response.body.notes[0].key).toBe('import.file.pictureWithoutACard');
  });

  it('answers with the uploaded file, never with a treatment it synthesised', async () => {
    /**
     * Found by an adversarial review of this fix, and the trigger is narrower
     * than the review stated — which is why it is written out here rather than
     * asserted from the description.
     *
     * The route used to answer with `reports.find(converted)`. On a plain
     * re-import that is harmless: the card *and* its treatment both read
     * `unchanged`, `find` matches neither, and the fallback returns the card's
     * row anyway. The bug needs the card to be unchanged while the treatment is
     * new — so: import, delete the treatment, import again. Then `find` skips
     * the card's `unchanged` row, lands on the treatment's `converted` one, and
     * the response `source` is `Scenario: …` — a file the person never sent.
     *
     * Answering with `reports[0]` is right in all three cases, because
     * `convertOne` puts the uploaded file's own row first by construction.
     */
    await uploadBytes('Vera.png', card());
    const treatments = await server.request({ method: 'GET', url: '/api/library/treatments' });
    const id = (treatments.body.objects as { id: string }[])[0]?.id;
    expect(id).toBeDefined();

    // Deletion is hash-guarded, and a DELETE without `if-match` answers 428
    // rather than failing loudly in a test — which is how the first version of
    // this test passed while deleting nothing at all.
    const stored = await server.request({ method: 'GET', url: `/api/library/treatments/${id!}` });
    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/treatments/${id!}`,
      headers: { 'if-match': (stored.body as { contentHash: string }).contentHash },
    });
    expect(removed.status).toBe(204);

    const again = await uploadBytes('Vera.png', card());

    expect(again.body.item.source).toBe('Vera.png');
    expect(again.body.item.disposition).toBe('unchanged');
  });

  it('does not mistake an ordinary config file for a character', async () => {
    // Also from the review: `name` plus `description` is the shape of half the
    // JSON on a disk. A package.json must not become an actor.
    const response = await upload(
      'package.json',
      JSON.stringify({
        name: 'storyengine',
        description: 'Self-hosted LLM storytelling server.',
        version: '0.1.0',
      }),
    );

    expect(response.body.item.disposition).toBe('unrecognised');

    const listed = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(listed.body.objects).toHaveLength(0);
  });

  it('does not double the library when the same card is uploaded twice', async () => {
    // Re-import identity comes free with the shared engine and did not exist on
    // this route at all before: a second upload simply made a second actor.
    await uploadBytes('Vera.png', card());
    await uploadBytes('Vera.png', card());

    const listed = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(listed.body.objects).toHaveLength(1);
  });
});

describe('the rules that apply to any mutation apply here', () => {
  it('needs a session', async () => {
    const anonymous = await makeTestServer();
    await setUpAdmin(anonymous);
    anonymous.cookies.clear();
    const { payload, headers } = multipart('Harbour.json', JSON.stringify(PRESET));

    const response = await anonymous.request({
      method: 'POST',
      url: '/api/import/file',
      payload,
      headers,
    });

    expect(response.status).toBe(401);
    await anonymous.dispose();
  });

  it('needs the CSRF header, which an upload form is exactly where one forgets', async () => {
    const { payload, headers } = multipart('Harbour.json', JSON.stringify(PRESET));

    const response = await server.request({
      method: 'POST',
      url: '/api/import/file',
      payload,
      headers,
      skipCsrf: true,
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('csrf');
  });

  it('refuses a request that is not multipart at all', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/import/file',
      payload: PRESET,
    });

    expect(response.status).toBe(415);
  });
});

describe('the upload limit is read per request', () => {
  it('refuses a file over the configured size, naming the number', async () => {
    // The claim that flips `limits.maxUploadMb` from `unread` to `applied`. The
    // message carries the limit because *too large* without a number is
    // something a person cannot act on.
    const put = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: { limits: { maxUploadMb: 1 } } },
    });
    expect([200, 204]).toContain(put.status);

    const big = JSON.stringify({ ...PRESET, padding: 'x'.repeat(2 * 1024 * 1024) });
    const response = await upload('Harbour.json', big);

    expect(response.status).toBe(413);
    expect(response.body.error).toBe('too-large');
  });

  it('takes the same file when the limit is raised, without a restart', async () => {
    // The whole meaning of the `live` tier, and the difference between `applied`
    // and `unread`: the number a person sets applies to the next upload rather
    // than to the next start.
    const big = JSON.stringify({ ...PRESET, padding: 'x'.repeat(2 * 1024 * 1024) });

    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: { limits: { maxUploadMb: 1 } } },
    });
    expect((await upload('Harbour.json', big)).status).toBe(413);

    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: { limits: { maxUploadMb: 8 } } },
    });
    expect((await upload('Harbour.json', big)).status).toBe(201);
  });
});

/**
 * The server-path sweep, and the permission it turns on ([P4 §1.3],
 * [05 §4.2.2]).
 *
 * `fileAccess` spent three phases as a capability that gated nothing. This is
 * where it gets teeth — and the tests below are mostly about the teeth rather
 * than about the sweep, because a widened permission with an unenforced
 * carve-out is worse than no permission at all.
 */
describe('pointing the server at a directory', () => {
  it('refuses an account with no file access', async () => {
    // Default is `none`, and the admin created at setup has it.
    const response = await server.request({
      method: 'POST',
      url: '/api/import/sweep',
      payload: { root: '/somewhere/SillyTavern/data' },
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('no-file-access');
  });

  it('refuses a folder inside our own data directory, even with the grant', async () => {
    // **The carve-out**, through the route. Without it, `fileAccess: read`
    // becomes a way to reach another account's library.
    await grantFileAccess();

    const response = await server.request({
      method: 'POST',
      url: '/api/import/sweep',
      payload: { root: server.dataDir },
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('inside-data-root');
  });

  it('refuses a relative path rather than resolving it against the cwd', async () => {
    await grantFileAccess();

    const response = await server.request({
      method: 'POST',
      url: '/api/import/sweep',
      payload: { root: 'data' },
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('not-absolute');
  });

  it('sweeps a real directory and answers with the report', async () => {
    await grantFileAccess();
    const root = await mkdtemp(join(tmpdir(), 'se-sweep-'));
    await mkdir(join(root, 'OpenAI Settings'), { recursive: true });
    await mkdir(join(root, 'characters'), { recursive: true });
    await mkdir(join(root, 'worlds'), { recursive: true });
    await writeFile(join(root, 'settings.json'), '{}');
    await writeFile(join(root, 'OpenAI Settings', 'Harbour.json'), JSON.stringify(PRESET));

    try {
      const response = await server.request({
        method: 'POST',
        url: '/api/import/sweep',
        payload: { root },
      });

      expect(response.status).toBe(200);
      expect(response.body.report.source).toBe('sillytavern');
      expect(response.body.report.counts.converted).toBeGreaterThan(0);

      const listed = await server.request({ method: 'GET', url: '/api/library/presets' });
      expect(listed.body.objects.map((row: { name: string }) => row.name)).toContain('Harbour');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('names source files relative to the root, never absolutely', async () => {
    // [13 §4.1.1]: a review somebody pastes into an issue must not be a
    // description of their filesystem. The root lives on the job record; the
    // rows do not repeat it.
    await grantFileAccess();
    const root = await mkdtemp(join(tmpdir(), 'se-sweep-'));
    await mkdir(join(root, 'OpenAI Settings'), { recursive: true });
    await mkdir(join(root, 'characters'), { recursive: true });
    await mkdir(join(root, 'worlds'), { recursive: true });
    await writeFile(join(root, 'settings.json'), '{}');
    await writeFile(join(root, 'OpenAI Settings', 'Harbour.json'), JSON.stringify(PRESET));

    try {
      const response = await server.request({
        method: 'POST',
        url: '/api/import/sweep',
        payload: { root },
      });

      const sources = (response.body.report.items as { source: string }[]).map((i) => i.source);
      expect(sources).toContain('OpenAI Settings/Harbour.json');
      for (const source of sources) {
        expect(source, `${source} leaks the root`).not.toContain(root);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/** Grants the admin `read`, which [05 §4.2.2] says is enough for a sweep. */
async function grantFileAccess(): Promise<void> {
  const response = await server.request({
    method: 'PATCH',
    url: '/api/admin/accounts/ned',
    payload: { capabilities: { fileAccess: 'read' } },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}
