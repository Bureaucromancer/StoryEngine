// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
