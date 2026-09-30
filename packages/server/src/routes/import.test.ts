// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import {
  makeTestServer,
  ownObjects,
  setUpAdmin,
  tempRoot,
  type TestServer,
} from '../test-server.js';
import { read } from '../library.js';
import { makeZip } from '../storage/test-zip.js';
import {
  aventurasCharacter,
  aventurasLorebook,
  aventurasScenario,
} from '../import/fixtures/test-aventuras.js';
import { sillyTavernFixture } from '../import/fixtures/test-sillytavern.js';

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
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
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

    expect((await ownObjects(server, 'lorebooks')).objects).toHaveLength(1);
  });

  it('carries the scenario off a card into a treatment, as a sweep does', async () => {
    // `convertOne` calls `flushTreatments`, so the second object a card produces
    // is not silently lost — the reason one candidate returns a list.
    await uploadBytes('Vera.png', card());

    expect((await ownObjects(server, 'treatments')).objects).toHaveLength(1);
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

    expect((await ownObjects(server, 'actors')).objects).toHaveLength(0);
  });

  it('does not double the library when the same card is uploaded twice', async () => {
    // Re-import identity comes free with the shared engine and did not exist on
    // this route at all before: a second upload simply made a second actor.
    await uploadBytes('Vera.png', card());
    await uploadBytes('Vera.png', card());

    expect((await ownObjects(server, 'actors')).objects).toHaveLength(1);
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
 * [10 §4.2.2]).
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
    const root = await tempRoot('se-sweep-');
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
    // [21 §4.1.1]: a review somebody pastes into an issue must not be a
    // description of their filesystem. The root lives on the job record; the
    // rows do not repeat it.
    await grantFileAccess();
    const root = await tempRoot('se-sweep-');
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

describe('asking what a folder is, without importing from it', () => {
  /**
   * A fixture root **inside a container this test made**, never directly in the
   * machine's temp directory.
   *
   * The route opens the parent of whatever root it is given, so a fixture at
   * `mkdtemp(tmpdir())` hands the real temp directory to the ascending rules. On
   * a machine whose temp directory happened to hold a `manifest.json` beside a
   * `tables/`, or `settings.json` beside `characters/` and `worlds/`, the
   * suggestion assertions below would fail for reasons having nothing to do with
   * this code. One extra level makes the parent something the test controls.
   */
  async function inSandbox(build: (root: string) => Promise<void>): Promise<string> {
    // F26: this root is posted to `/api/import/inspect` and the suggestion
    // that comes back is an absolute path the server resolved, so the two
    // have to agree about how the temp directory is spelled.
    const container = await tempRoot('se-inspect-');
    const root = join(container, 'fixture');
    await mkdir(root, { recursive: true });
    await build(root);
    return root;
  }

  /** An install root: the library is one level down, where nobody pointed. */
  function installRoot(): Promise<string> {
    return inSandbox(async (root) => {
      const user = join(root, 'data', 'default-user');
      await mkdir(join(user, 'characters'), { recursive: true });
      await mkdir(join(user, 'worlds'), { recursive: true });
      await writeFile(join(user, 'settings.json'), '{}');
      await writeFile(join(root, 'server.js'), '// x');
    });
  }

  /** A folder that is already a SillyTavern library. */
  function library(): Promise<string> {
    return inSandbox(async (root) => {
      await mkdir(join(root, 'characters'), { recursive: true });
      await mkdir(join(root, 'worlds'), { recursive: true });
      await writeFile(join(root, 'settings.json'), '{}');
    });
  }

  it('is behind the same permission as the sweep', async () => {
    // The default is `none`, and the admin created at setup has it. A cheaper
    // gate here than on the route that actually reads would be a way to ask
    // questions about the filesystem that the reader refuses to answer.
    const response = await server.request({
      method: 'POST',
      url: '/api/import/inspect',
      payload: { root: '/somewhere/SillyTavern' },
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('no-file-access');
  });

  it('refuses a folder inside our own data directory', async () => {
    await grantFileAccess();
    const response = await server.request({
      method: 'POST',
      url: '/api/import/inspect',
      payload: { root: server.dataDir },
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('inside-data-root');
  });

  it('names the library one level down when somebody points at the install root', async () => {
    await grantFileAccess();
    const root = await installRoot();

    try {
      const response = await server.request({
        method: 'POST',
        url: '/api/import/inspect',
        payload: { root },
      });

      expect(response.status).toBe(200);
      expect(response.body.verdict).toBe('loose-files');
      expect(response.body.suggestions).toHaveLength(1);
      const [suggestion] = response.body.suggestions as {
        situation: string;
        suggest: string;
        root: string;
        note: { key: string; params: Record<string, string> };
      }[];
      expect(suggestion?.situation).toBe('sillytavern-install-root');
      expect(suggestion?.suggest).toBe('data/default-user');
      expect(suggestion?.note.params).toEqual({ path: 'data/default-user' });
      // The absolute form is the string a retry carries, and it has to be a real
      // path rather than the relative one echoed back.
      expect(suggestion?.root).toBe(join(root, 'data', 'default-user'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('has nothing to suggest about a folder that is already a library', async () => {
    await grantFileAccess();
    const root = await library();

    try {
      const response = await server.request({
        method: 'POST',
        url: '/api/import/inspect',
        payload: { root },
      });

      expect(response.status).toBe(200);
      expect(response.body.verdict).toBe('sillytavern');
      expect(response.body.suggestions).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('imports nothing — the library is untouched by a look', async () => {
    // The whole point of a separate route: somebody checking a path before they
    // commit to it must not thereby commit to it.
    //
    // **The fixture has to contain something importable**, or this passes
    // whatever the route does. An earlier version used a bare install root whose
    // library held only an empty `settings.json`, so `actors` was empty because
    // there was never an actor — the assertion held for the wrong reason. The
    // preset below converts on the sweep path, which is what makes the empty
    // library afterwards mean something.
    await grantFileAccess();
    const root = await inSandbox(async (at) => {
      await mkdir(join(at, 'OpenAI Settings'), { recursive: true });
      await mkdir(join(at, 'characters'), { recursive: true });
      await mkdir(join(at, 'worlds'), { recursive: true });
      await writeFile(join(at, 'settings.json'), '{}');
      await writeFile(join(at, 'OpenAI Settings', 'Harbour.json'), JSON.stringify(PRESET));
    });

    try {
      const looked = await server.request({
        method: 'POST',
        url: '/api/import/inspect',
        payload: { root },
      });
      expect(looked.status).toBe(200);

      expect((await ownObjects(server, 'presets')).objects).toEqual([]);

      // And the same folder, swept, does produce it — so the emptiness above is
      // the look declining to write rather than the fixture having nothing.
      const swept = await server.request({
        method: 'POST',
        url: '/api/import/sweep',
        payload: { root },
      });
      expect(swept.status).toBe(200);
      const after = await server.request({ method: 'GET', url: '/api/library/presets' });
      expect(after.body.objects.map((row: { name: string }) => row.name)).toContain('Harbour');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('tells a disappointing sweep what it should have been pointed at', async () => {
    // The sweep succeeds here — a loose root converts whatever self-identifies —
    // so nothing about the report says the wrong folder was named. That is the
    // indistinguishability the advice exists to remove, which is why it rides on
    // a 200 rather than on a refusal.
    await grantFileAccess();
    const root = await installRoot();

    try {
      const response = await server.request({
        method: 'POST',
        url: '/api/import/sweep',
        payload: { root },
      });

      expect(response.status).toBe(200);
      expect(response.body.report.source).toBe('loose-files');
      expect(
        (response.body.suggestions as { situation: string }[]).map((s) => s.situation),
      ).toEqual(['sillytavern-install-root']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('says nothing extra about a sweep that found the right folder', async () => {
    await grantFileAccess();
    const root = await library();

    try {
      const response = await server.request({
        method: 'POST',
        url: '/api/import/sweep',
        payload: { root },
      });

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/** Grants the admin `read`, which [10 §4.2.2] says is enough for a sweep. */
async function grantFileAccess(): Promise<void> {
  const response = await server.request({
    method: 'PATCH',
    url: '/api/admin/accounts/ned',
    payload: { capabilities: { fileAccess: 'read' } },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

/** Many files plus the manifest, as the browser sends them. */
function folderBody(
  manifest: string[],
  carried: Record<string, string>,
  fields: Record<string, string> = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----storyengineFolderBoundary';
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        [`--${boundary}`, `Content-Disposition: form-data; name="${name}"`, '', value, ''].join(
          '\r\n',
        ),
        'utf8',
      ),
    );
  }
  for (const [path, contents] of Object.entries(carried)) {
    chunks.push(
      Buffer.from(
        [
          `--${boundary}`,
          // The relative path travels as the FIELD name: a multipart filename
          // cannot carry a directory and survive sanitising.
          `Content-Disposition: form-data; name="${path}"; filename="${path.split('/').pop() ?? path}"`,
          'Content-Type: application/octet-stream',
          '',
          contents,
          '',
        ].join('\r\n'),
        'utf8',
      ),
    );
  }
  chunks.push(
    Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="manifest"',
        '',
        JSON.stringify(manifest),
        `--${boundary}--`,
        '',
      ].join('\r\n'),
      'utf8',
    ),
  );

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/**
 * The browser directory upload — P4's first-to-cut clause, reversed ([P4 §7.13]).
 *
 * Two routes because it is two questions. *What is this folder, and what of it
 * do you need* is answerable from names alone, and answering it first is what
 * keeps a thirty-directory tree from being uploaded to discover that most of it
 * is chats.
 */
describe('uploading a folder from the browser', () => {
  const ST_MANIFEST = [
    { path: 'settings.json', bytes: 2 },
    { path: 'characters/Vera.png', bytes: 12 },
    { path: 'worlds/Rain City.json', bytes: 2 },
    { path: 'chats/Vera/2026.jsonl', bytes: 900 },
    { path: 'backups/settings_2026.json', bytes: 400 },
  ];

  it('classifies the folder and asks for only what it will read', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory/plan',
      payload: { entries: ST_MANIFEST },
    });

    expect(response.status).toBe(200);
    expect(response.body.verdict).toBe('sillytavern');
    expect(response.body.wanted).toEqual([
      'settings.json',
      'characters/Vera.png',
      'worlds/Rain City.json',
    ]);
    expect(response.body.declared).toEqual(['chats/Vera/2026.jsonl', 'backups/settings_2026.json']);
  });

  it('needs no file permission, unlike the server-path sweep', async () => {
    // The admin created at setup has `fileAccess: none`, and this answers
    // anyway. The sweep reads the host's disk through the server's own user;
    // this reads nothing — the browser already opened the folder as the person,
    // and what arrives is a list they chose to send.
    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory/plan',
      payload: { entries: ST_MANIFEST },
    });

    expect(response.status).toBe(200);
  });

  it('gives the same wrong-folder advice before a byte is uploaded', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory/plan',
      payload: {
        entries: [
          { path: 'server.js', bytes: 10 },
          { path: 'data/default-user/settings.json', bytes: 2 },
          { path: 'data/default-user/characters/Vera.png', bytes: 12 },
          { path: 'data/default-user/worlds/Rain City.json', bytes: 2 },
        ],
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.verdict).toBe('loose-files');
    expect(
      (response.body.suggestions as { situation: string; root: string | null }[]).map(
        (s) => s.situation,
      ),
    ).toEqual(['sillytavern-install-root']);
    // No absolute path, because a browser upload has nowhere to point.
    expect(response.body.suggestions[0].root).toBeNull();
  });

  it('imports the folder, and accounts for what it was not sent', async () => {
    const { payload, headers } = folderBody(
      ST_MANIFEST.map((entry) => entry.path),
      {
        'settings.json': '{}',
        'worlds/Rain City.json': JSON.stringify({
          entries: { 0: { uid: 0, key: ['rain'], content: 'It rains.', comment: 'Rain' } },
        }),
      },
    );

    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory',
      payload,
      headers,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.report.source).toBe('sillytavern');

    const listed = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect(listed.body.objects.map((row: { name: string }) => row.name)).toContain('Rain City');

    // **The whole folder is accounted for, not the part that travelled.** The
    // chats and backups were named and never sent; they still appear, which is
    // what keeps *nothing is silently dropped* true across a transport that
    // deliberately does not carry everything.
    const sources = (response.body.report.items as { source: string }[]).map((i) => i.source);
    expect(sources).toContain('chats/Vera/2026.jsonl');
    expect(sources).toContain('backups/settings_2026.json');
  });

  it('refuses a folder with no manifest rather than importing a fragment', async () => {
    const { payload, headers } = folderBody([], { 'settings.json': '{}' });
    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory',
      payload,
      headers,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('no-manifest');
  });

  it('keeps a crafted path inside the folder', async () => {
    // Nothing here touches a disk — these become keys in a Map — but a path that
    // climbed would make the review describe a folder nobody picked.
    const { payload, headers } = folderBody(['../../etc/passwd', 'settings.json'], {
      '../../etc/passwd': 'root:x:0:0',
    });

    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory',
      payload,
      headers,
    });

    expect(response.status).toBe(200);
    const sources = (response.body.report.items as { source: string }[]).map((i) => i.source);
    for (const source of sources) {
      expect(source, `${source} climbs out of the folder`).not.toContain('..');
    }
    expect(sources).toContain('etc/passwd');
  });
});

/**
 * ***Chats, through each door*** —
 * [P14.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * One file, and a folder picked in a browser. The folder half is the opt-in:
 * the plan says what chats would add before a byte moves, and the upload
 * carries them only when the person said so — and says, row by row, which it
 * was.
 */
describe('a chat, through the doors', () => {
  const CHAT = 'chats/Vera Solano/2026-01-01.jsonl';
  const text = (path: string): string => {
    const value = sillyTavernFixture()[path];
    return typeof value === 'string' ? value : new TextDecoder().decode(value);
  };

  it('uploaded on its own, becomes a session and answers with its id', async () => {
    const response = await upload('Vera - 2026-01-01.jsonl', text(CHAT));

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.item.disposition).toBe('converted');
    const opened = await server.request({
      method: 'GET',
      url: `/api/sessions/${String(response.body.item.objectId)}`,
    });
    expect(opened.status).toBe(200);
  });

  it('uploaded twice, is already here the second time', async () => {
    await upload('Vera - 2026-01-01.jsonl', text(CHAT));
    const again = await upload('Vera - 2026-01-01.jsonl', text(CHAT));

    expect(again.status).toBe(200);
    expect(again.body.item.disposition).toBe('unchanged');
    expect(again.body.item.notes.map((note: { key: string }) => note.key)).toEqual([
      'import.chat.alreadyHere',
    ]);
  });

  /** Two more lines, as SillyTavern appends them: the chat has grown. */
  const grown = (path: string): string =>
    text(path) +
    [
      {
        name: 'The Inspector',
        is_user: true,
        is_system: false,
        send_date: '2026-01-01T10:02:00.000Z',
        mes: 'Then sign for this.',
        extra: {},
      },
      {
        name: 'Vera Solano',
        is_user: false,
        is_system: false,
        send_date: '2026-01-01T10:02:30.000Z',
        mes: 'Not today.',
        gen_started: '2026-01-01T10:02:26.000Z',
        extra: {},
      },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join('');

  it('uploaded again after it grew, extends the session it made — [P14.10a]', async () => {
    const first = await upload('Vera - 2026-01-01.jsonl', text(CHAT));
    const sessionId = String(first.body.item.objectId);

    // *Update from source* on a session from one file: nothing on the server
    // to re-read, so the menu offers the file picker.
    const update = await server.request({
      method: 'POST',
      url: `/api/import/sessions/${sessionId}/update`,
    });
    expect(update.status).toBe(409);
    expect(update.body.error).toBe('no-recorded-source');

    const again = await upload('Vera - 2026-01-01.jsonl', grown(CHAT));
    expect(again.body.item.disposition).toBe('converted');
    expect(again.body.item.objectId).toBe(sessionId);
    expect(again.body.item.notes[0]).toEqual({
      key: 'import.chat.extended',
      params: { name: 'Vera - 2026-01-01', count: 1 },
      level: 'info',
    });
  });

  it('updated from source, re-sweeps the folder it came from — [P14.10a]', async () => {
    await grantFileAccess();
    const root = await tempRoot('se-sync-');
    const writeTree = async (tree: Record<string, string | Uint8Array>): Promise<void> => {
      for (const [path, body] of Object.entries(tree)) {
        await mkdir(join(root, path, '..'), { recursive: true });
        await writeFile(join(root, path), body);
      }
    };
    try {
      await writeTree(sillyTavernFixture());
      const swept = await server.request({
        method: 'POST',
        url: '/api/import/sweep',
        payload: { root },
      });
      const made = (swept.body.report.items as { source: string; objectId?: string }[]).find(
        (item) => item.source === CHAT,
      );
      const sessionId = String(made?.objectId);

      await writeFile(join(root, CHAT), grown(CHAT));
      const update = await server.request({
        method: 'POST',
        url: `/api/import/sessions/${sessionId}/update`,
      });

      expect(update.status, JSON.stringify(update.body)).toBe(200);
      expect(update.body.item.source).toBe(CHAT);
      expect(update.body.item.disposition).toBe('converted');
      expect(update.body.item.objectId).toBe(sessionId);
      expect(update.body.item.notes[0].key).toBe('import.chat.extended');
      // The path is the server's to know, and is not sent back.
      expect(JSON.stringify(update.body)).not.toContain(root);

      const unchanged = await server.request({
        method: 'POST',
        url: `/api/import/sessions/${sessionId}/update`,
      });
      expect(unchanged.body.item.disposition).toBe('unchanged');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to update a session that was not made from a chat', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Made here' },
    });
    const sessionId = String(created.body.session?.id ?? created.body.id);

    const update = await server.request({
      method: 'POST',
      url: `/api/import/sessions/${sessionId}/update`,
    });
    expect(update.status).toBe(422);
    expect(update.body.error).toBe('no-source');
    const missing = await server.request({
      method: 'POST',
      url: '/api/import/sessions/nobody/update',
    });
    expect(missing.status).toBe(404);
  });

  /** The fixture tree as a browser manifest, sized by its real bytes. */
  function manifest(): { path: string; bytes: number }[] {
    return Object.entries(sillyTavernFixture()).map(([path, body]) => ({
      path,
      bytes: typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength,
    }));
  }

  it('in a folder, is planned out until chosen, and says what choosing it costs', async () => {
    const entries = manifest();
    const first = await server.request({
      method: 'POST',
      url: '/api/import/directory/plan',
      payload: { entries },
    });

    expect(first.status).toBe(200);
    expect(first.body.wanted).not.toContain(CHAT);
    const bytes = entries.find((entry) => entry.path === CHAT)?.bytes;
    expect(first.body.chats).toEqual({ count: 1, bytes, fit: { count: 1, bytes } });

    const chosen = await server.request({
      method: 'POST',
      url: '/api/import/directory/plan',
      payload: { entries, chats: true },
    });
    expect(chosen.body.wanted).toContain(CHAT);
  });

  it('in a folder whose person chose chats, becomes a session beside the cards', async () => {
    const tree = sillyTavernFixture();
    // Text only: the cards' pixels are not what this is about, and the chat
    // resolves Vera by name when her card is not among what was carried.
    const carried = {
      'settings.json': text('settings.json'),
      'worlds/Rain City.json': text('worlds/Rain City.json'),
      [CHAT]: text(CHAT),
    };
    const { payload, headers } = folderBody(Object.keys(tree), carried, { chats: 'include' });

    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory',
      payload,
      headers,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const chat = (response.body.report.items as { source: string; disposition: string }[]).find(
      (item) => item.source === CHAT,
    );
    expect(chat?.disposition).toBe('converted');
  });

  it('in a folder whose person left chats out, is skipped rather than unreadable', async () => {
    const tree = sillyTavernFixture();
    const { payload, headers } = folderBody(
      Object.keys(tree),
      { 'settings.json': text('settings.json') },
      { chats: 'skip' },
    );

    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory',
      payload,
      headers,
    });

    expect(response.status).toBe(200);
    const chat = (
      response.body.report.items as {
        source: string;
        disposition: string;
        notes: { key: string }[];
      }[]
    ).find((item) => item.source === CHAT);
    expect(chat?.disposition).toBe('skipped');
    expect(chat?.notes.map((note) => note.key)).toEqual(['import.chat.notChosen']);
  });

  /** A report's row for one path, with its notes. */
  function rowOf(body: { report: { items: unknown[] } }, source: string) {
    return (
      body.report.items as {
        source: string;
        disposition: string;
        notes: { key: string; params: Record<string, unknown> }[];
      }[]
    ).find((item) => item.source === source);
  }

  it('in a folder whose person chose chats, says a chat the limit left out was over it', async () => {
    // Chosen, and not carried: the plan spent the limit on the library first
    // and this did not fit. That is what the row says — not "could not be
    // read", which is what a named file with no bytes otherwise reads as.
    const { payload, headers } = folderBody(
      Object.keys(sillyTavernFixture()),
      { 'settings.json': text('settings.json') },
      { chats: 'include' },
    );

    const response = await server.request({
      method: 'POST',
      url: '/api/import/directory',
      payload,
      headers,
    });

    expect(response.status).toBe(200);
    const chat = rowOf(response.body, CHAT);
    expect(chat?.disposition).toBe('skipped');
    expect(chat?.notes.map((note) => note.key)).toEqual(['import.chat.overLimit']);
    expect(chat?.notes[0]?.params['limit']).toBe(server.services.config.limits.maxUploadMb);
  });

  it('in a loose folder, is held back and asked about, as a tree’s chats are', async () => {
    const LOOSE = 'exports/Vera - 2026-01-01.jsonl';
    const card = JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Vera Solano' } });
    const entries = [
      { path: 'Vera.json', bytes: Buffer.byteLength(card) },
      { path: LOOSE, bytes: Buffer.byteLength(text(CHAT)) },
    ];

    const plan = await server.request({
      method: 'POST',
      url: '/api/import/directory/plan',
      payload: { entries },
    });
    expect(plan.body.verdict).toBe('loose-files');
    expect(plan.body.wanted).toEqual(['Vera.json']);
    expect(plan.body.chats.count).toBe(1);

    const send = async (chats: 'skip' | 'include', carried: Record<string, string>) => {
      const body = folderBody(
        entries.map((entry) => entry.path),
        carried,
        { chats },
      );
      return server.request({ method: 'POST', url: '/api/import/directory', ...body });
    };

    const declined = await send('skip', { 'Vera.json': card });
    expect(rowOf(declined.body, LOOSE)?.disposition).toBe('skipped');
    expect(rowOf(declined.body, LOOSE)?.notes.map((note) => note.key)).toEqual([
      'import.chat.notChosen',
    ]);

    const taken = await send('include', { 'Vera.json': card, [LOOSE]: text(CHAT) });
    expect(rowOf(taken.body, LOOSE)?.disposition).toBe('converted');
  });

  it('through Play’s door, is a chat or nothing is written', async () => {
    // A card that happens to be named `.jsonl`. The library's own door would
    // import it as an actor; Play's asks for a chat, and a card is not one.
    const boundary = '----storyengineTestBoundary';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="kind"',
      '',
      'chat',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="card.jsonl"',
      'Content-Type: application/octet-stream',
      '',
      JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Vera Solano' } }),
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await server.request({
      method: 'POST',
      url: '/api/import/file',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });

    expect(response.status).toBe(200);
    expect(response.body.item.disposition).toBe('unrecognised');
    expect(response.body.item.notes.map((note: { key: string }) => note.key)).toEqual([
      'import.file.unrecognised',
    ]);
    const listed = await server.request({ method: 'GET', url: '/api/library/actors' });
    expect(listed.body.objects.map((row: { name: string }) => row.name)).not.toContain(
      'Vera Solano',
    );
  });
});

describe('the size of a folder upload', () => {
  /** As above, but built for bulk rather than for shape. */
  function bulkBody(files: Record<string, string>): {
    payload: Buffer;
    headers: Record<string, string>;
  } {
    const boundary = '----storyengineBulkBoundary';
    const chunks: Buffer[] = [];
    for (const [path, contents] of Object.entries(files)) {
      chunks.push(
        Buffer.from(
          [
            `--${boundary}`,
            `Content-Disposition: form-data; name="${path}"; filename="${path}"`,
            'Content-Type: application/octet-stream',
            '',
            contents,
            '',
          ].join('\r\n'),
          'utf8',
        ),
      );
    }
    chunks.push(
      Buffer.from(
        [
          `--${boundary}`,
          'Content-Disposition: form-data; name="manifest"',
          '',
          JSON.stringify(Object.keys(files)),
          `--${boundary}--`,
          '',
        ].join('\r\n'),
        'utf8',
      ),
    );
    return {
      payload: Buffer.concat(chunks),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  it('applies the limit to the whole folder, not to each file in it', async () => {
    /**
     * **The two halves of this transport disagreed, and the plan step is the one
     * that was right.** `planUpload` spends `maxUploadMb` as a *total* across
     * every file it asks for — `wantedBytes + entry.bytes > budgetBytes`
     * accumulates — while the upload route passed the same number to busboy as
     * `fileSize`, which is per part. So a folder of a thousand files each just
     * under the limit was a thousand times the limit, buffered into one object
     * in memory, from any signed-in account: this route is deliberately not
     * behind `fileAccess`, because the browser has already opened the folder.
     *
     * A limit that a well-behaved client respects and the server does not
     * enforce is not a limit.
     */
    const response = await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: { limits: { maxUploadMb: 1 } } },
    });
    expect([200, 204]).toContain(response.status);

    // Eight files of 200 KB: none of them near a megabyte, 1.6 MB together.
    const chunk = 'x'.repeat(200 * 1024);
    const files: Record<string, string> = {};
    for (let n = 0; n < 8; n++) files[`characters/card-${String(n)}.json`] = chunk;
    const { payload, headers } = bulkBody(files);

    const uploaded = await server.request({
      method: 'POST',
      url: '/api/import/directory',
      payload,
      headers,
    });

    expect(uploaded.status).toBe(413);
    expect(uploaded.body.error).toBe('too-large');
  });
});

describe('looking at a file before importing it', () => {
  async function look(filename: string, contents: string) {
    const { payload, headers } = multipart(filename, contents);
    return server.request({ method: 'POST', url: '/api/import/file/preview', payload, headers });
  }

  async function libraryPresets() {
    // The account's own — [P7B.0]'s system packs are in this route's merge and
    // are never what an import wrote.
    return (await ownObjects(server, 'presets')).objects;
  }

  it('answers 200 with what the import would produce, and writes nothing', async () => {
    const response = await look('Harbour.json', JSON.stringify(PRESET));

    expect(response.status).toBe(200);
    expect(response.body.preview.object.kind).toBe('preset');
    expect(response.body.preview.object.name).toBe('Harbour');
    expect(await libraryPresets()).toHaveLength(0);
  });

  it('is the same file the commit then takes', async () => {
    // The two halves of the flow, in order, through the real routes. The preview
    // holds nothing, so the commit is a second upload of the same bytes — and
    // what lands has to be what the preview said it would be.
    const looked = await look('Harbour.json', JSON.stringify(PRESET));
    const { payload, headers } = multipart('Harbour.json', JSON.stringify(PRESET));
    const committed = await server.request({
      method: 'POST',
      url: '/api/import/file',
      payload,
      headers,
    });

    expect(committed.status).toBe(201);
    expect(committed.body.item.disposition).toBe(looked.body.preview.disposition);
    expect(await libraryPresets()).toHaveLength(1);
  });

  it('never carries a credential, whatever the file had in it', async () => {
    const response = await look('Harbour.json', JSON.stringify(PRESET));

    // Over the whole serialised body: the claim is that no route carries the
    // value, which is what stops a look-before-you-commit becoming a way to read
    // somebody else's proxy password out of a preset they shared.
    expect(JSON.stringify(response.body)).not.toContain('this must never reach disk');
  });

  it('names an instruct template rather than shrugging at it', async () => {
    const response = await look(
      'ChatML.json',
      JSON.stringify({
        input_sequence: '<|im_start|>user\n',
        output_sequence: '<|im_start|>assistant\n',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body.preview.disposition).toBe('by-position');
    expect(response.body.preview.object).toBeNull();
    expect(response.body.preview.notes[0].key).toBe('import.template.instruct');
  });

  it('says a zip is a folder in a file, and still writes nothing', async () => {
    // A root in a file. Previewing one means a dry-run sweep, which sweeps do
    // not get — so the answer is honest about that rather than absent.
    const { payload, headers } = binaryMultipart(
      'cards.zip',
      makeZip([{ name: 'Vera.json', body: JSON.stringify({ name: 'Vera', first_mes: 'Hi.' }) }]),
    );
    const response = await server.request({
      method: 'POST',
      url: '/api/import/file/preview',
      payload,
      headers,
    });

    expect(response.status).toBe(200);
    expect(response.body.preview.object).toEqual({ kind: 'sweep' });
    expect(response.body.preview.notes[0].key).toBe('import.file.importsAsFolder');
    expect(await libraryPresets()).toHaveLength(0);
  });

  it('needs the CSRF header too — a look a cross-site form can take is worth refusing', async () => {
    const { payload, headers } = multipart('Harbour.json', JSON.stringify(PRESET));

    const response = await server.request({
      method: 'POST',
      url: '/api/import/file/preview',
      payload,
      headers,
      skipCsrf: true,
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('csrf');
  });

  it('refuses a request that is not multipart', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/import/file/preview',
      payload: PRESET,
    });

    expect(response.status).toBe(415);
    expect(response.body.error).toBe('not-multipart');
  });

  it('reads the upload limit per request, on this door as well as the other', async () => {
    // The shared `readOnePart` means one behaviour; this is what proves both
    // doors reach it rather than one having grown its own copy.
    await server.request({
      method: 'PUT',
      url: '/api/admin/config',
      payload: { config: { limits: { maxUploadMb: 1 } } },
    });

    const big = JSON.stringify({ ...PRESET, padding: 'x'.repeat(2 * 1024 * 1024) });
    const response = await look('Harbour.json', big);

    expect(response.status).toBe(413);
    expect(response.body.error).toBe('too-large');
  });
});

describe('what a re-upload of a changed file does', () => {
  /**
   * **`onConflict` was plumbed everywhere except the door people use.** The
   * sweep and the folder upload have taken it since P4.4; the single-file route
   * ignored it, so re-uploading a changed preset silently replaced with no way
   * to say otherwise. Survivable while the answer arrived after the write, and
   * not once the preview asks first — a screen offering *replace or keep both*
   * has to be able to send it.
   *
   * The field goes **before** the file part, which is busboy's *fields before
   * files* convention: `request.file()` stops at the first file, so anything
   * after it is never parsed. That is a real constraint on a client and it is
   * asserted here rather than left to be discovered.
   */
  function withPolicy(filename: string, contents: string, policy?: string) {
    const boundary = '----storyengineTestBoundary';
    const parts: string[] = [];
    if (policy !== undefined) {
      parts.push(`--${boundary}`, 'Content-Disposition: form-data; name="onConflict"', '', policy);
    }
    parts.push(
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: application/json',
      '',
      contents,
      `--${boundary}--`,
      '',
    );

    return {
      payload: parts.join('\r\n'),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  async function send(contents: string, policy?: string) {
    const { payload, headers } = withPolicy('Harbour.json', contents, policy);
    return server.request({ method: 'POST', url: '/api/import/file', payload, headers });
  }

  async function presetCount(): Promise<number> {
    // The account's own — see `libraryPresets` above.
    return (await ownObjects(server, 'presets')).objects.length;
  }

  const CHANGED = JSON.stringify({ ...PRESET, temperature: 0.4 });

  it('replaces by default, as it always has', async () => {
    await send(JSON.stringify(PRESET));
    const again = await send(CHANGED);

    expect(again.body.item.disposition).toBe('converted');
    expect(await presetCount()).toBe(1);
  });

  it('keeps both when asked, and the field is read at all', async () => {
    await send(JSON.stringify(PRESET));
    const again = await send(CHANGED, 'keep-both');

    // The assertion that proves the field arrived: without it this is 1.
    expect(await presetCount()).toBe(2);
    expect(again.body.item.notes.map((n: { key: string }) => n.key)).toContain(
      'import.object.keptBoth',
    );
  });

  it('writes nothing when asked to skip, and says the file differs', async () => {
    await send(JSON.stringify(PRESET));
    const again = await send(CHANGED, 'skip');

    expect(await presetCount()).toBe(1);
    expect(again.body.item.notes.map((n: { key: string }) => n.key)).toContain(
      'import.object.differsAndKept',
    );
  });

  it('treats a policy it does not know as absent rather than refusing the upload', async () => {
    // A JSON body is validated whole and can say *this field is wrong*. A
    // multipart field arrives after the file is buffered, so refusing here
    // throws away an upload that was otherwise fine over a spelling.
    const response = await send(JSON.stringify(PRESET), 'replace-all-of-them');

    expect(response.status).toBe(201);
  });

  it('is unchanged, not replaced, when the same bytes arrive twice', async () => {
    await send(JSON.stringify(PRESET));
    const again = await send(JSON.stringify(PRESET));

    expect(again.status).toBe(200);
    expect(again.body.item.disposition).toBe('unchanged');
  });
});

describe('uploading one Aventuras scenario', () => {
  /**
   * **The conflated object, and the one upload this route asks a question
   * about** ([P4 §1.5], [04 §6]).
   *
   * `destination` follows `onConflict`'s constraint exactly — fields before the
   * file, because `request.file()` stops at the first file part — and that is
   * asserted here rather than left to be discovered, for the reason the section
   * above gives: it is a real constraint on every client.
   */
  function withDestination(contents: string, destination?: string) {
    const boundary = '----storyengineTestBoundary';
    const parts: string[] = [];
    if (destination !== undefined) {
      parts.push(
        `--${boundary}`,
        'Content-Disposition: form-data; name="destination"',
        '',
        destination,
      );
    }
    parts.push(
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="Ash Harbour.json"',
      'Content-Type: application/json',
      '',
      contents,
      `--${boundary}--`,
      '',
    );
    return {
      payload: parts.join('\r\n'),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  async function send(url: string, destination?: string) {
    const { payload, headers } = withDestination(
      JSON.stringify(aventurasScenario(), null, 2),
      destination,
    );
    return server.request({ method: 'POST', url, payload, headers });
  }

  it('becomes a treatment and its cast by default', async () => {
    const response = await send('/api/import/file');
    expect(response.status).toBe(201);
    expect(response.body.item.disposition).toBe('converted');

    const treatments = await ownObjects(server, 'treatments');
    const actors = await ownObjects(server, 'actors');
    expect(treatments.objects).toHaveLength(1);
    // The npcs land beside it and the cast points at them — which only works
    // because the actors are stored first, so `identify` has settled their ids.
    expect(actors.objects).toHaveLength(2);
    expect(response.body.item.alsoProduced).toHaveLength(2);
  });

  it('becomes a lorebook when the field says so, and the field is read at all', async () => {
    const response = await send('/api/import/file', 'lorebook');
    expect(response.status).toBe(201);

    // The assertion that proves the field arrived: without it this is a
    // treatment and two actors.
    expect((await ownObjects(server, 'lorebooks')).objects).toHaveLength(1);
    expect((await ownObjects(server, 'treatments')).objects).toHaveLength(0);
    expect((await ownObjects(server, 'actors')).objects).toHaveLength(0);
  });

  it('previews the choice, and re-previewing under the other one changes it', async () => {
    const first = await send('/api/import/file/preview');
    expect(first.status).toBe(200);
    expect(first.body.preview.object).toMatchObject({
      kind: 'scenario',
      name: 'Ash Harbour',
      destination: 'treatment',
      cast: ['Ines Vaur', 'The Dockmaster'],
      openings: 2,
    });
    // What it *could* be, so the client can offer the switch without knowing
    // which formats have a choice.
    expect(first.body.preview.object.alternatives).toEqual(['treatment', 'lorebook']);

    const second = await send('/api/import/file/preview', 'lorebook');
    expect(second.body.preview.object).toMatchObject({ kind: 'scenario', openings: 0 });

    // A preview writes nothing, whichever reading it was asked for.
    expect((await ownObjects(server, 'treatments')).objects).toHaveLength(0);
    expect((await ownObjects(server, 'lorebooks')).objects).toHaveLength(0);
  });

  it('treats a destination it does not know as absent', async () => {
    // The file has already been buffered by the time this field is read, so
    // throwing away a good upload over a spelling is the worse answer.
    const response = await send('/api/import/file', 'nonsense');
    expect(response.status).toBe(201);
    expect((await ownObjects(server, 'treatments')).objects).toHaveLength(1);
  });

  /**
   * ***Two npcs of one name are two actors*** —
   * [P13 §0.5](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * Each npc's re-import identity was the scenario file plus its name, so the
   * second of two named alike `identify`d as the first, replaced it, and the
   * cast named one actor twice — one imported character gone, and nothing in
   * the review said so.
   */
  it('keeps two npcs who share a name as two actors, and re-imports them unchanged', async () => {
    const npc = (description: string): Record<string, unknown> => ({
      name: 'Ines Vaur',
      role: 'harbourmaster',
      description,
      relationship: '',
      traits: [],
    });
    const scenario = {
      ...aventurasScenario(),
      npcs: [npc('The elder, who keeps the ledgers.'), npc('Her niece, who does not.')],
    };
    const upload = (): ReturnType<typeof withDestination> =>
      withDestination(JSON.stringify(scenario, null, 2));

    const first = await server.request({ method: 'POST', url: '/api/import/file', ...upload() });
    expect(first.status).toBe(201);
    expect(first.body.item.notes.map((note: { key: string }) => note.key)).toContain(
      'import.aventuras.repeatedNpcNames',
    );

    const actors = await ownObjects(server, 'actors');
    expect(actors.objects).toHaveLength(2);
    const [treatment] = (await ownObjects(server, 'treatments')).objects;
    const cast = (
      read(server.services.library, 'ned', treatment!.id).body as {
        cast: { ref: { id: string } }[];
      }
    ).cast.map((member) => member.ref.id);
    expect(new Set(cast).size).toBe(2);

    const again = await server.request({ method: 'POST', url: '/api/import/file', ...upload() });
    expect(again.body.item.disposition).toBe('unchanged');
    expect((await ownObjects(server, 'actors')).objects).toHaveLength(2);
  });

  it('takes an Aventuras character and its native lorebook too', async () => {
    const character = multipart('Ines Vaur.json', JSON.stringify(aventurasCharacter(), null, 2));
    const asCharacter = await server.request({
      method: 'POST',
      url: '/api/import/file',
      payload: character.payload,
      headers: character.headers,
    });
    expect(asCharacter.body.item.disposition).toBe('converted');

    // The bare `Entry[]` array — the export path [P4 §1.5] counted as covered by
    // the SillyTavern one, and which this route could not even parse before.
    const book = multipart('Harbour lore.json', JSON.stringify(aventurasLorebook(), null, 2));
    const asLorebook = await server.request({
      method: 'POST',
      url: '/api/import/file',
      payload: book.payload,
      headers: book.headers,
    });
    expect(asLorebook.body.item.disposition).toBe('converted');

    expect((await ownObjects(server, 'actors')).objects).toHaveLength(1);
    expect((await ownObjects(server, 'lorebooks')).objects).toHaveLength(1);
  });
});
