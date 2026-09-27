// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RENDITION_SCHEMA, type Rendition, type RenditionAsset } from '@storyengine/shared';

import { digestOf } from '../library/assets.js';
import { sessionAssetsRoot, writeRendition } from '../renditions/store.js';
import { fileExists, writeFileBytes } from '../storage/files.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The backup surface, through HTTP —
 * [P12.3](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***`archive.test.ts` proves what an archive carries; this proves the door.***
 * The property that matters here is that **there is no way to name somebody
 * else's**: the owner comes from the session cookie and never from a parameter,
 * which is [09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md)'s
 * *the path is the owner* arriving at the API.
 *
 * **Two accounts throughout**, because a per-user claim asserted with one
 * account is a claim about nothing — an implementation that ignored the account
 * entirely would pass every single-account test written against it.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

/** Signs in as a second, ordinary account — `notifications.test.ts`'s helper. */
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

async function take(url = '/api/me/backups', contents = 'full'): Promise<string> {
  const response = await server.request({ method: 'POST', url, payload: { contents } });
  expect(response.status).toBe(201);
  return (response.body as { backup: { id: string } }).backup.id;
}

describe('taking one', () => {
  it('is offered to every account, gated by no capability', async () => {
    await asUser();
    const response = await server.request({
      method: 'POST',
      url: '/api/me/backups',
      payload: { contents: 'full' },
    });

    expect(response.status).toBe(201);
    const { backup } = response.body as { backup: Record<string, unknown> };
    expect(backup['scope']).toBe('account');
    expect(backup['handle']).toBe('mara');
    expect(backup['contents']).toBe('full');
    expect(backup['bytes']).toBeGreaterThan(0);
  });

  /**
   * **No default for `contents`**, because the two produce genuinely different
   * files and the difference is a person's to make rather than this file's.
   */
  it('refuses a body that does not say which kind of archive it wants', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/me/backups',
      payload: {},
    });
    expect(response.status).toBe(400);

    const unknown = await server.request({
      method: 'POST',
      url: '/api/me/backups',
      payload: { contents: 'everything' },
    });
    expect(unknown.status).toBe(400);
  });

  it('needs somebody signed in', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const response = await server.request({
      method: 'POST',
      url: '/api/me/backups',
      payload: { contents: 'full' },
    });
    expect(response.status).toBe(401);
  });
});

describe('the listing', () => {
  it('is one account’s own, and says what they weigh together', async () => {
    await take();
    await take('/api/me/backups', 'redacted');

    const mine = await server.request({ method: 'GET', url: '/api/me/backups' });
    const body = mine.body as { backups: { id: string }[]; totalBytes: number };
    expect(body.backups).toHaveLength(2);
    expect(body.totalBytes).toBeGreaterThan(0);

    await asUser();
    const theirs = await server.request({ method: 'GET', url: '/api/me/backups' });
    expect((theirs.body as { backups: unknown[] }).backups).toEqual([]);
  });
});

describe('downloading one', () => {
  it('sends the archive as a file, with its length', async () => {
    const id = await take();
    const response = await server.request({ method: 'GET', url: `/api/me/backups/${id}/download` });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/gzip');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="account-ned-/);
    // **The length the listing reported**, which is the cheapest proof that a
    // file rather than a description of one came back — and that the stream
    // carried all of it rather than being cut off by the response ending.
    const listed = await server.request({ method: 'GET', url: '/api/me/backups' });
    const row = (listed.body as { backups: { id: string; bytes: number }[] }).backups[0];
    expect(Number(response.headers['content-length'])).toBe(row?.bytes);
  });

  /**
   * ***404 rather than 403 for somebody else's archive***, which is the
   * library's posture: whether an id exists elsewhere is worth hiding.
   */
  it('cannot be pointed at another account’s archive', async () => {
    const theirs = await take();
    await asUser();

    const response = await server.request({
      method: 'GET',
      url: `/api/me/backups/${theirs}/download`,
    });
    expect(response.status).toBe(404);
  });
});

describe('deleting one', () => {
  it('removes it, and says so the second time', async () => {
    const id = await take();

    expect((await server.request({ method: 'DELETE', url: `/api/me/backups/${id}` })).status).toBe(
      204,
    );
    expect((await server.request({ method: 'DELETE', url: `/api/me/backups/${id}` })).status).toBe(
      404,
    );
    const after = await server.request({ method: 'GET', url: '/api/me/backups' });
    expect((after.body as { backups: unknown[] }).backups).toEqual([]);
  });

  it('cannot be pointed at another account’s archive', async () => {
    const theirs = await take();
    await asUser();

    expect(
      (await server.request({ method: 'DELETE', url: `/api/me/backups/${theirs}` })).status,
    ).toBe(404);
  });
});

/**
 * ***An id from a client never becomes a path component.***
 *
 * Two checks stand between these and the filesystem and the test exercises the
 * first: the schema refuses anything that is not a uuidv7, so a traversal never
 * reaches a handler. The second — `findBackup` resolving against the listing
 * rather than building a path — is `archive.test.ts`'s, and either alone is the
 * one that gets edited away in a hurry.
 */
describe('an id that is not one', () => {
  for (const attempt of [
    '../../accounts.json',
    '..%2F..%2Faccounts.json',
    'install-full-2026-09-22-x',
    '00000000-0000-1000-8000-000000000000',
  ]) {
    it(`is refused before it is a path: ${attempt}`, async () => {
      const download = await server.request({
        method: 'GET',
        url: `/api/me/backups/${encodeURIComponent(attempt)}/download`,
      });
      expect(download.status).toBeGreaterThanOrEqual(400);
      expect(download.status).toBeLessThan(500);

      const remove = await server.request({
        method: 'DELETE',
        url: `/api/me/backups/${encodeURIComponent(attempt)}`,
      });
      expect(remove.status).toBeGreaterThanOrEqual(400);
      expect(remove.status).toBeLessThan(500);
    });
  }
});

describe('the install’s own', () => {
  it('is the whole data directory, and an admin’s', async () => {
    const id = await take('/api/admin/backups');

    const listing = await server.request({ method: 'GET', url: '/api/admin/backups' });
    const body = listing.body as { backups: { id: string; scope: string; handle: null }[] };
    expect(body.backups.map((row) => row.id)).toEqual([id]);
    expect(body.backups[0]?.scope).toBe('install');
    expect(body.backups[0]?.handle).toBeNull();
  });

  /**
   * The guard is `adminOnly` on the prefix, which `admin.test.ts` sweeps for
   * every route under it. This asserts the consequence rather than the
   * mechanism, because the consequence is what a person meets.
   */
  it('is not an ordinary account’s', async () => {
    await asUser();

    expect((await server.request({ method: 'GET', url: '/api/admin/backups' })).status).toBe(403);
    expect(
      (
        await server.request({
          method: 'POST',
          url: '/api/admin/backups',
          payload: { contents: 'full' },
        })
      ).status,
    ).toBe(403);
  });

  /** An account archive and an install archive do not share a directory. */
  it('does not appear in anybody’s own listing', async () => {
    await take('/api/admin/backups');

    const mine = await server.request({ method: 'GET', url: '/api/me/backups' });
    expect((mine.body as { backups: unknown[] }).backups).toEqual([]);
  });
});

/**
 * ***The one thing a capability gates here.***
 *
 * `scheduledBackups` governs the **server** writing archives on a timer nobody
 * is watching, which is the one way a misconfigured setting fills a data
 * directory — and a full disk stops the server writing turns, so the cost lands
 * on everybody. Taking one by hand is never gated, and the pair of tests below
 * is what keeps those two facts from drifting into each other.
 */
describe('the schedule', () => {
  it('is off for an account that has never set one', async () => {
    const response = await server.request({ method: 'GET', url: '/api/me/backups/settings' });

    expect(response.status).toBe(200);
    expect((response.body as { settings: unknown }).settings).toEqual({
      frequency: 'off',
      onStart: false,
      contents: 'full',
    });
  });

  it('is refused to an account an admin has not enabled it for', async () => {
    await asUser();

    const response = await server.request({
      method: 'PUT',
      url: '/api/me/backups/settings',
      payload: { frequency: 'daily', onStart: true, contents: 'full' },
    });

    expect(response.status).toBe(403);
    expect((response.body as { error: string }).error).toBe('no-scheduled-backups');
  });

  it('is written once an admin grants the capability, and read back', async () => {
    await asUser();
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ned', password: 'correct horse battery' },
    });
    await server.request({
      method: 'PATCH',
      url: '/api/admin/accounts/mara',
      payload: { capabilities: { scheduledBackups: true } },
    });

    await server.request({ method: 'POST', url: '/api/auth/logout' });
    await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'mara', password: 'another long password' },
    });

    const written = await server.request({
      method: 'PUT',
      url: '/api/me/backups/settings',
      payload: { frequency: 'weekly', onStart: true, contents: 'redacted' },
    });
    expect(written.status).toBe(200);

    const read = await server.request({ method: 'GET', url: '/api/me/backups/settings' });
    expect((read.body as { settings: unknown }).settings).toEqual({
      frequency: 'weekly',
      onStart: true,
      contents: 'redacted',
    });
  });

  /**
   * **A whole document, every field required.** A patch would let a client that
   * knew about two fields leave the third at whatever it was, and the failure
   * there is a schedule somebody believes they turned off.
   */
  it('refuses a partial schedule, and an unknown key', async () => {
    const partial = await server.request({
      method: 'PUT',
      url: '/api/me/backups/settings',
      payload: { frequency: 'daily' },
    });
    expect(partial.status).toBe(400);

    const extra = await server.request({
      method: 'PUT',
      url: '/api/me/backups/settings',
      payload: { frequency: 'daily', onStart: false, contents: 'full', keepLast: 5 },
    });
    expect(extra.status).toBe(400);
  });

  /** Granting the capability does not, by itself, turn a schedule on. */
  it('stays off until somebody sets one', async () => {
    await server.request({
      method: 'PATCH',
      url: '/api/admin/accounts/ned',
      payload: { capabilities: { scheduledBackups: true } },
    });

    const response = await server.request({ method: 'GET', url: '/api/me/backups/settings' });
    expect((response.body as { settings: { frequency: string } }).settings.frequency).toBe('off');
  });
});

/**
 * ***Import is not restore, and the routes keep them apart*** —
 * [P12.9](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * `reader.test.ts` proves what an import *does* to a library. This proves the
 * door: who may ask, for whose subtree, and what the optional groups do when
 * nobody ticks them.
 */
/**
 * The manifest route —
 * [P12.10](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***It is the look that stands in for a preview***, so what matters is that it
 * answers the two questions the import controls turn on — *whose work is in
 * there* and *does it carry credentials* — and that it is owned exactly as
 * every other route here is.
 */
describe('reading what is in one', () => {
  /**
   * One file under `users/ned/`, because both claims below are read off the
   * member names — a fresh account has written nothing, so an archive of it is
   * a manifest and no members, which is correct and proves neither claim.
   */
  async function writeATag(): Promise<void> {
    await server.services.tags.write('ned', [
      {
        id: 't1',
        name: 'a tag',
        swatch: null,
        sortOrder: 0,
        folder: 'general',
        hidden: false,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  it('answers with the archive’s own account of itself', async () => {
    await writeATag();
    const id = await take();

    const response = await server.request({ method: 'GET', url: `/api/me/backups/${id}/manifest` });

    expect(response.status).toBe(200);
    const { manifest } = response.body as { manifest: Record<string, unknown> };
    expect(manifest['scope']).toBe('account');
    expect(manifest['contents']).toBe('full');
    // The handles are what the admin's control offers, so an empty list here
    // would be a picker with nothing in it rather than a visible failure.
    expect(manifest['handles']).toEqual(['ned']);
    expect(manifest['files']).toBeGreaterThan(0);
    expect(manifest['unpackedBytes']).toBeGreaterThan(0);
  });

  it('cannot be pointed at another account’s archive', async () => {
    const mine = await take();
    await asUser();

    const response = await server.request({
      method: 'GET',
      url: `/api/me/backups/${mine}/manifest`,
    });

    // 404 rather than 403, per the download's argument: whether an id exists
    // elsewhere is worth hiding.
    expect(response.status).toBe(404);
  });

  it('is the install’s for an admin, and names every account in it', async () => {
    // A file under `users/ned/`, because the handle list is read off the member
    // names — an account with nothing written is an account with no subtree.
    await writeATag();

    const id = await take('/api/admin/backups');
    const response = await server.request({
      method: 'GET',
      url: `/api/admin/backups/${id}/manifest`,
    });

    expect(response.status).toBe(200);
    const { manifest } = response.body as { manifest: { scope: string; handles: string[] } };
    expect(manifest.scope).toBe('install');
    expect(manifest.handles).toContain('ned');
  });
});

describe('importing one', () => {
  it('reports what it did, and what it declined to do', async () => {
    const id = await take();

    const response = await server.request({
      method: 'POST',
      url: '/api/me/backups/import',
      payload: { id },
    });

    expect(response.status).toBe(200);
    const body = response.body as {
      report: { jobId: string; source: string };
      notes: { key: string }[];
    };
    expect(body.report.source).toBe('storyengine-backup');
    // **The ledger, not a toast.** A backup import is addressable afterwards
    // exactly as every other import is.
    expect(body.report.jobId).toMatch(/^[0-9a-f]{8}-/);

    /**
     * ***Each optional group reports whether it was taken or not.*** *My keys
     * did not come across* is a question with an answer, and silence would make
     * it a bug report.
     */
    const keys = body.notes.map((note) => note.key);
    expect(keys).toContain('import.backup.connectionsNotTaken');
    expect(keys).toContain('import.backup.prefsNotTaken');
  });

  it('will not be pointed at somebody else’s part of an archive', async () => {
    const id = await take();

    const response = await server.request({
      method: 'POST',
      url: '/api/me/backups/import',
      payload: { id, handle: 'mara' },
    });

    expect(response.status).toBe(403);
    expect((response.body as { error: string }).error).toBe('forbidden');
  });

  it('is a 404 for an archive this account does not have', async () => {
    const theirs = await take();
    await asUser();

    const response = await server.request({
      method: 'POST',
      url: '/api/me/backups/import',
      payload: { id: theirs },
    });
    expect(response.status).toBe(404);
  });

  /**
   * ***No all-of-them arm, and the refusal says why it is not an oversight.***
   * A handle in the archive with no account here would have to be created to
   * receive a library, and an account created from an archive has no password.
   */
  it('makes an admin say which account, and refuses one this install does not have', async () => {
    const id = await take('/api/admin/backups');

    const unsaid = await server.request({
      method: 'POST',
      url: '/api/admin/backups/import',
      payload: { id },
    });
    expect(unsaid.status).toBe(400);

    const stranger = await server.request({
      method: 'POST',
      url: '/api/admin/backups/import',
      payload: { id, handle: 'nobody' },
    });
    expect(stranger.status).toBe(404);
    expect((stranger.body as { error: string }).error).toBe('no-such-account');
  });

  /** Settings are an install-scope decision, so the account half refuses it. */
  it('refuses a configuration import on an account archive', async () => {
    const id = await take();

    const response = await server.request({
      method: 'POST',
      url: '/api/me/backups/import',
      payload: { id, options: { config: true } },
    });

    expect(response.status).toBe(403);
    expect((response.body as { error: string }).error).toBe('not-install-scope');
  });

  it('brings settings across for an admin, and refuses the two that are paths', async () => {
    /**
     * ***The archive has to hold something of theirs, and a config to bring.***
     * An account with nothing in it appears in no `users/<h>/…` member, so the
     * manifest does not list it and the reader refuses — which is the right
     * answer to *import ned's part* when the archive holds none, and is why
     * this fixture creates one.
     */
    const { newLorebook } = await import('@storyengine/shared');
    const { create } = await import('../library.js');
    await create(server.services.library, 'ned', newLorebook('Rain City'));

    const { writeJsonAtomic } = await import('../storage/atomic.js');
    await writeJsonAtomic(server.services.configPath, {
      trash: { retentionDays: 11 },
      dataDir: '/somewhere/else/entirely',
    });

    const id = await take('/api/admin/backups');

    const response = await server.request({
      method: 'POST',
      url: '/api/admin/backups/import',
      payload: { id, handle: 'ned', options: { config: true } },
    });

    expect(response.status).toBe(200);
    const keys = (response.body as { notes: { key: string }[] }).notes.map((note) => note.key);
    expect(keys).toContain('import.backup.configTaken');
    expect(server.services.config.trash.retentionDays).toBe(11);
    /**
     * ***And the running data root is untouched***, which is the disaster the
     * drop list exists to prevent: the archive's `config.json` names a
     * directory on the machine it came from, and taking it would point this
     * server at one that may not exist or may be somebody else's.
     */
    expect(server.services.config.dataDir).not.toBe('/somewhere/else/entirely');
  });
});

/**
 * Restoring the install —
 * [P12.11](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***`restore.test.ts` proves the preconditions; this proves that none of them
 * is reached before the two the route owns.*** Supervision is checked here and
 * again in `beginRestart`, and the first check is the one that matters: a
 * marker written into a process that will never come back is a restore that
 * fires whenever somebody next starts the server by hand, possibly months
 * later, possibly not knowing it was pending.
 */
describe('restoring the install', () => {
  /** The marker the next boot would act on. Absent is the interesting answer. */
  async function pending(): Promise<boolean> {
    return fileExists(server.services.layout.restorePendingFile);
  }

  it('refuses where nothing would start the server again, and writes no marker', async () => {
    const id = await take('/api/admin/backups');

    const response = await server.request({
      method: 'POST',
      url: '/api/admin/restore',
      payload: { id },
    });

    expect(response.status).toBe(409);
    expect((response.body as { error: string }).error).toBe('unsupervised');
    // The message has to carry the way out, because the surface this refusal
    // reaches is the only one that person has.
    expect((response.body as { message: string }).message).toContain('pnpm backup restore');
    expect(await pending()).toBe(false);
  });

  it('is not an ordinary account’s', async () => {
    const id = await take('/api/admin/backups');
    await asUser();

    const response = await server.request({
      method: 'POST',
      url: '/api/admin/restore',
      payload: { id },
    });

    expect(response.status).toBe(403);
    expect(await pending()).toBe(false);
  });

  it('refuses an account archive by id, without reading it as an install', async () => {
    server.services.supervision = { supervised: true, how: 'declared' };
    const mine = await take();

    const response = await server.request({
      method: 'POST',
      url: '/api/admin/restore',
      payload: { id: mine },
    });

    /**
     * ***404 rather than `wrong-scope`, and that is the right answer.*** An
     * account archive lives in that account's own directory, so the install's
     * listing does not hold it — and `findBackup` resolves an id against a
     * listing rather than building a path from it, which is what makes the two
     * scopes genuinely separate rather than separated by a check.
     */
    expect(response.status).toBe(404);
    expect(await pending()).toBe(false);
  });

  it('accepts, writes the marker, and drains', async () => {
    server.services.supervision = { supervised: true, how: 'declared' };
    const exit = vi.fn();
    server.services.exit = exit;
    const id = await take('/api/admin/backups');

    const response = await server.request({
      method: 'POST',
      url: '/api/admin/restore',
      payload: { id },
    });

    // 202: accepted rather than done. The swap happens on the next boot, in a
    // process this one is about to end.
    expect(response.status).toBe(202);
    const { plan } = response.body as { plan: { archive: string; attempts: number } };
    expect(plan.attempts).toBe(0);
    expect(plan.archive).toMatch(/^backups\//);
    expect(await pending()).toBe(true);
  });

  it('can be called off, which is the one door out of a refused one', async () => {
    server.services.supervision = { supervised: true, how: 'declared' };
    server.services.exit = vi.fn();
    const id = await take('/api/admin/backups');
    await server.request({ method: 'POST', url: '/api/admin/restore', payload: { id } });
    expect(await pending()).toBe(true);

    const response = await server.request({ method: 'DELETE', url: '/api/admin/restore' });

    expect(response.status).toBe(204);
    expect(await pending()).toBe(false);

    /**
     * ***204 whether or not there was one***, because *there is no pending
     * restore* is what the caller wanted either way — and because the state
     * this clears is one a boot may have written, so a client cannot know
     * whether it is there without asking.
     */
    const again = await server.request({ method: 'DELETE', url: '/api/admin/restore' });
    expect(again.status).toBe(204);
  });

  it('takes the marker back when the drain will not start', async () => {
    server.services.supervision = { supervised: true, how: 'declared' };
    // No `exit` seam — a harness, or a build that embeds the app.
    const id = await take('/api/admin/backups');

    const response = await server.request({
      method: 'POST',
      url: '/api/admin/restore',
      payload: { id },
    });

    expect(response.status).toBe(409);
    expect((response.body as { error: string }).error).toBe('unavailable');
    /**
     * ***The only place a marker is ever deleted.*** The process is staying up,
     * so one left behind would fire on the next ordinary restart instead — a
     * restore nobody asked for, at a moment nobody chose.
     */
    expect(await pending()).toBe(false);
  });
});

/**
 * ***The pixels in an archive come back with it*** — the half of a merge-import
 * that, until 2026-09-27, rebuilt a session's records from the archive and left
 * its `assets/` where they lay.
 *
 * A backup is not an export: an export carries *"the records, not the
 * pixels"*, while an archive holds the session directory whole. So a picture
 * whose bytes are in the file and match the record's digest arrives as a
 * picture, and anything that fails a check arrives as its recipe — the
 * placeholder this build already renders for a picture that can be made again.
 */
describe('importing a session’s pictures from a backup', () => {
  const PIXELS = new TextEncoder().encode('not really a png');

  function aRendition(sessionId: string, turnId: string, asset: RenditionAsset): Rendition {
    return {
      schema: RENDITION_SCHEMA,
      id: `${turnId}.0`,
      sessionId,
      turnId,
      createdAt: '2026-09-27T10:00:00.000Z',
      kind: 'image',
      purpose: 'illustration',
      scope: null,
      state: 'ready',
      prompt: {
        fragments: [{ id: 'moment', text: 'a lantern', rank: 100, required: true }],
        separator: ', ',
        budget: { maxChars: null, usefulChars: null },
        text: 'a lantern',
        kept: ['moment'],
        dropped: [],
        overCap: false,
      },
      asset,
      provenance: {
        at: '2026-09-27T10:00:02.000Z',
        binding: { connectionId: 'c-1', modelId: 'sdxl' },
        answeredAs: null,
        seed: 7,
        workflow: { steps: 20 },
      },
      error: null,
      digest: 'd-1',
      ordering: 0,
    };
  }

  it('brings back the bytes a record describes, and nothing it does not', async () => {
    const created = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Rain City' },
    });
    const original = created.body.session.id as string;
    for (const value of ['each-turn', 'off', 'each-turn', 'off']) {
      await server.request({
        method: 'PUT',
        url: `/api/sessions/${original}/channels/se.illustrate`,
        payload: { value },
      });
    }
    const listed = await server.request({ method: 'GET', url: `/api/sessions/${original}/turns` });
    const [good, tampered, climbing, disguised] = (listed.body.turns as { id: string }[]).map(
      (turn) => turn.id,
    ) as [string, string, string, string];

    const layout = server.services.sessions.layout;
    const assets = sessionAssetsRoot(layout, 'ned', original);
    const honest = (turnId: string): RenditionAsset => ({
      path: `${turnId}.0.png`,
      mime: 'image/png',
      bytes: PIXELS.byteLength,
      digest: digestOf(PIXELS),
    });
    // The picture as the worker leaves it.
    await writeRendition(layout, 'ned', original, aRendition(original, good, honest(good)));
    await writeFileBytes(join(assets, `${good}.0.png`), PIXELS);
    // Bytes that are not the ones the record describes.
    await writeRendition(layout, 'ned', original, aRendition(original, tampered, honest(tampered)));
    await writeFileBytes(join(assets, `${tampered}.0.png`), new TextEncoder().encode('other'));
    // A path that would reach out of the session's `assets/`.
    await writeRendition(
      layout,
      'ned',
      original,
      aRendition(original, climbing, { ...honest(climbing), path: '../session.json' }),
    );
    // Real bytes under a type the asset route would serve as a page.
    await writeRendition(
      layout,
      'ned',
      original,
      aRendition(original, disguised, { ...honest(disguised), mime: 'text/html' }),
    );
    await writeFileBytes(join(assets, `${disguised}.0.png`), PIXELS);

    /**
     * ***The route that serves pixels is contained in `assets/`, not merely in
     * the data root.*** Before `assetPath` resolved within the session's asset
     * directory, this record would have been answered with the session's own
     * `session.json`, labelled a PNG.
     */
    const escaped = await server.request({
      method: 'GET',
      url: `/api/sessions/${original}/renditions/${encodeURIComponent(`${climbing}.0`)}/asset`,
    });
    expect(escaped.status).toBe(404);

    const id = await take();
    const imported = await server.request({
      method: 'POST',
      url: '/api/me/backups/import',
      payload: { id },
    });
    expect(imported.status).toBe(200);

    const sessions = (await server.request({ method: 'GET', url: '/api/sessions' })).body
      .sessions as { id: string }[];
    const copy = sessions.map((one) => one.id).find((one) => one !== original);
    expect(copy).toBeDefined();

    const read = await server.request({
      method: 'GET',
      url: `/api/sessions/${copy ?? ''}/renditions`,
    });
    const byTurn = new Map(
      (read.body.renditions as Rendition[]).map((one) => [one.turnId, one] as const),
    );
    expect(byTurn.size).toBe(4);
    expect(byTurn.get(good)?.asset?.digest).toBe(digestOf(PIXELS));
    expect(byTurn.get(tampered)?.asset).toBeNull();
    expect(byTurn.get(climbing)?.asset).toBeNull();
    expect(byTurn.get(disguised)?.asset).toBeNull();

    // Served from the copy's own `assets/`, as the bytes the record describes.
    const served = await server.request({
      method: 'GET',
      url: `/api/sessions/${copy ?? ''}/renditions/${encodeURIComponent(`${good}.0`)}/asset`,
    });
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['etag']).toBe(digestOf(PIXELS));
    expect(
      await fileExists(join(sessionAssetsRoot(layout, 'ned', copy ?? ''), `${good}.0.png`)),
    ).toBe(true);
  });
});
