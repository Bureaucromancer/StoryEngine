// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { LOREBOOK_SCHEMA, newLorebook } from '@storyengine/shared';

import { Layout, userOwner } from '../storage/layout.js';
import { makeTestServer, ownObjects, setUpAdmin } from '../test-server.js';

/**
 * ***A start that does not rebuild still looks*** (2026-09-27) —
 * [03 §5.1](../../../../docs/design/03-data-model.md)'s start-up consistency
 * check, through the start a person actually makes: the server stopped, the
 * library edited by hand, the server started again.
 *
 * `index-db/reconcile.test.ts` holds the check itself to a rebuild. This is the
 * half it cannot show: that a start runs it, before anything is served, and
 * says what it found.
 */

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-startup-check-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** The folder a book was written to, found by its id, since the server chose it. */
async function folderOf(id: string): Promise<string> {
  const books = new Layout(dataDir).kindRoot(userOwner('ned'), LOREBOOK_SCHEMA);
  for (const slug of await readdir(books)) {
    const text = await readFile(join(books, slug, 'lorebook.json'), 'utf8');
    if ((JSON.parse(text) as { id: string }).id === id) return join(books, slug);
  }
  throw new Error(`no folder holds ${id}`);
}

it('serves what changed in the library while the server was stopped, and says so', async () => {
  const first = await makeTestServer({ dataDir });
  await setUpAdmin(first);
  const kept = newLorebook('Rain City');
  const gone = newLorebook('Elsewhere');
  for (const book of [kept, gone]) {
    const made = await first.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    expect(made.status).toBe(201);
  }
  await first.dispose();

  // By hand, with nothing running: one book renamed inside its file, and one
  // folder deleted.
  const keptFile = join(await folderOf(kept.id), 'lorebook.json');
  const onDisk = JSON.parse(await readFile(keptFile, 'utf8')) as Record<string, unknown>;
  await writeFile(keptFile, JSON.stringify({ ...onDisk, name: 'Rain City, by hand' }, null, 2));
  await rm(await folderOf(gone.id), { recursive: true });

  const lines: string[] = [];
  const second = await makeTestServer({
    dataDir,
    logStream: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    }),
    config: { log: { level: 'info', format: 'json' } },
  });
  try {
    const login = await second.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ned', password: 'correct horse battery' },
    });
    expect(login.status).toBe(200);

    const names = (await ownObjects(second, 'lorebooks')).objects.map((book) => book['name']);
    expect(names).toEqual(['Rain City, by hand']);

    const reconciled = lines
      .map((line) => JSON.parse(line) as { event?: string })
      .find((record) => record.event === 'index.reconciled');
    expect(reconciled).toMatchObject({ reread: 1, forgotten: 1 });
  } finally {
    await second.dispose();
  }
});
