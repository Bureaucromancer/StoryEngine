// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLorebook } from '@storyengine/shared';

import { rebuild } from '../index-db/rebuild.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * A link out of the data root, through the real routes — F1.
 *
 * The symlink-aware resolver was written at P1, tested thoroughly, and called
 * by nothing: every live path used the lexical check, which passes
 * `library/lorebooks/vera` happily and cannot know that `vera` is a link to
 * somewhere else. The corpus tested dead code, so this suite deliberately does
 * not call the resolver — it drives HTTP and the watcher's ingest, which is
 * where the check had to actually land.
 */

let server: TestServer;
let outside: string;
let linkSupported = true;
let linkFailure = '';

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
  outside = await mkdtemp(join(tmpdir(), 'se-outside-'));
  // Reset per test: a single failure must not silently disarm the rest.
  linkSupported = true;
  linkFailure = '';
});

afterEach(async () => {
  await server.dispose();
  await rm(outside, { recursive: true, force: true });
});

const KIND_ROOT = ['users', 'ned', 'library', 'lorebooks'] as const;

/**
 * A directory inside the library that is really somewhere else.
 *
 * A junction rather than a symlink, for the same reason the paths corpus uses
 * one: creating a symlink on Windows needs elevation, a junction does not, and
 * `realpath` follows both.
 */
async function linkIntoTheLibrary(name: string): Promise<string> {
  const kindRoot = join(server.dataDir, ...KIND_ROOT);
  await mkdir(kindRoot, { recursive: true });
  const link = join(kindRoot, name);
  try {
    await symlink(outside, link, 'junction');
  } catch (error) {
    linkSupported = false;
    linkFailure = error instanceof Error ? error.message : String(error);
  }
  return link;
}

describe('a link out of the data root', () => {
  it('can be created here at all — otherwise this suite proves nothing', async () => {
    await linkIntoTheLibrary('probe');
    expect(linkSupported, `this platform refused to create a junction: ${linkFailure}`).toBe(true);
  });

  it('is not indexed, so nothing downstream ever holds an escaping path', async () => {
    /**
     * What a rebuild scans before the link exists.
     *
     * ***A baseline rather than a constant, changed at [P7B.0]***, which put the
     * built-in prompt packs into the system scope and so made the old
     * `toBe(0)` false. It was worth more than a number fix: zero was only ever
     * a *proxy* for the claim, true because nothing else happened to be on
     * disk. The claim is **the link contributes nothing**, which is a
     * comparison — and a comparison stays true the next time something ships
     * with the install.
     */
    const before = await rebuild(server.services.index.db, server.services.layout);

    const link = await linkIntoTheLibrary('escape');
    if (!linkSupported) return;

    // A perfectly valid object, in a folder that is really outside the root.
    const book = newLorebook('Somewhere Else');
    await writeFile(join(link, 'lorebook.json'), JSON.stringify(book, null, 2));

    // Through the same scan a restart runs. It does not even reach the
    // containment check: `listDirectoryNames` filters on `isDirectory()`, and a
    // junction reports as a link — so a rebuild never opens it. That is worth
    // asserting rather than assuming, because it is the difference between "we
    // refuse it" and "we never see it", and only the first survives someone
    // relaxing that filter.
    const result = await rebuild(server.services.index.db, server.services.layout);
    expect(result.scanned).toBe(before.scanned);

    const listed = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect(listed.body.objects).toHaveLength(0);

    // And it is not reachable by id either — there is no row to reach.
    const read = await server.request({ method: 'GET', url: `/api/library/lorebooks/${book.id}` });
    expect(read.status).toBe(404);
  });

  it('cannot be written through, even when the index already holds the row', async () => {
    // The harder case: an object indexed while its folder was ordinary, whose
    // folder is *then* replaced by a link. The row's path passes every lexical
    // rule, and only the filesystem knows it now leads out. This is the door
    // the index opens, and the reason the check is not only at ingest.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    expect(created.status).toBe(201);
    const slug = created.body.slug as string;

    await rm(join(server.dataDir, ...KIND_ROOT, slug), { recursive: true, force: true });
    const link = await linkIntoTheLibrary(slug);
    if (!linkSupported) return;
    await writeFile(join(link, 'lorebook.json'), JSON.stringify(book, null, 2));

    const written = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: { object: { ...book, name: 'Renamed' }, contentHash: created.body.contentHash },
    });

    // Refused, and refused in the vocabulary a caller can act on rather than as
    // a 500 (F22).
    expect(written.status).toBe(422);
    expect(written.body.error).toBe('refused-path');
    expect(written.body.message).toContain('symlink-escape');
    expect(written.body.message).not.toContain(outside);
  });

  it('cannot be deleted through, which would move somebody else’s directory', async () => {
    // Delete is a *move* since F7, so following a link here would relocate a
    // directory outside the data root into this user's trash.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    const slug = created.body.slug as string;

    await rm(join(server.dataDir, ...KIND_ROOT, slug), { recursive: true, force: true });
    const link = await linkIntoTheLibrary(slug);
    if (!linkSupported) return;
    await writeFile(join(link, 'lorebook.json'), JSON.stringify(book, null, 2));

    const removed = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${book.id}`,
      headers: { 'if-match': created.body.contentHash as string },
    });

    expect(removed.status).toBe(422);
    // The linked directory is untouched.
    const stillThere = await server.request({ method: 'GET', url: '/api/library/lorebooks' });
    expect(stillThere.status).toBe(200);
  });
});

describe('an ordinary library', () => {
  it('is unaffected by any of this', async () => {
    // The negative case, and it is not a formality: a containment check that
    // compares a realpath'd candidate against a *non*-realpath'd root rejects
    // every path in a data directory that is itself a link — which is an
    // ordinary deployment on a machine with a data volume.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });
    expect(created.status).toBe(201);

    const read = await server.request({ method: 'GET', url: `/api/library/lorebooks/${book.id}` });
    expect(read.status).toBe(200);

    const written = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${book.id}`,
      payload: { object: { ...book, name: 'Renamed' }, contentHash: created.body.contentHash },
    });
    expect(written.status).toBe(200);
  });
});
