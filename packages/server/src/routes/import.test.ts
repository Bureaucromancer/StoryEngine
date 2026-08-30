// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The first upload route this server has had ([P4 §1.3]).
 *
 * Three things are being tested and only one of them is the conversion: that the
 * limit is read **per request** rather than frozen at construction — which is
 * what earns `limits.maxUploadMb` its `applied` row after three phases as the
 * standing example of a key nobody read — that the ordinary mutation rules apply
 * to an upload like anything else, and that a file this build cannot convert
 * *yet* is reported as such rather than refused as broken.
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

  it('reports a file it cannot convert yet as recorded, not as an error', async () => {
    // A PNG card lands here today and converts at P4.2. Answering 4xx would tell
    // somebody their file is wrong when the truth is that this build is not
    // finished.
    const response = await upload('Vera.png', 'not json, a picture');

    expect(response.status).toBe(200);
    expect(response.body.item.disposition).toBe('recorded');
    expect(response.body.notes[0].key).toBe('import.file.notYetConvertible');
  });

  it('reports JSON that is no preset at all as unrecognised', async () => {
    const response = await upload('something.json', JSON.stringify({ unrelated: true }));

    expect(response.body.item.disposition).toBe('unrecognised');
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
