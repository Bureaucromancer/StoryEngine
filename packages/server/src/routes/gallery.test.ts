// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTestServer, routesUnder, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * The sign-in gallery — [12](../../../../docs/design/12-account-gallery.md), [P10.4].
 *
 * ***[12 §8] names three tests and this file is them***, plus the ones that fell
 * out of building it. They are named there rather than derived here for the
 * reason that section exists: *"recording the owner here rather than leaving the
 * feature described and unowned is the lesson [work plan §2.3] exists to
 * teach."*
 *
 * 1. **The projection picks, and picking is the test.** A field added to
 *    `Account` does not appear in a `GalleryEntry` until a line picks it.
 * 2. **A hidden account still signs in by handle.** §2's lockout invariant as an
 *    integration test rather than a sentence.
 * 3. **In form mode, the unauthenticated surface is unchanged.** The
 *    route-enumeration pattern the admin-guard tests already use, extended.
 *
 * **The falsifying mutation for the third is making the gate a UI concern** —
 * rendering the form and leaving the routes answering. Every assertion about the
 * gallery still passes, and a default install quietly starts publishing who has
 * an account on it.
 */

const PASSWORD = 'correct horse battery';

let server: TestServer;

async function boot(loginScreen: 'form' | 'gallery'): Promise<void> {
  server = await makeTestServer({
    config: { auth: { minPasswordLength: 8, loginScreen } },
  });
  await setUpAdmin(server, 'ned', PASSWORD);
}

afterEach(async () => {
  await server.dispose();
});

/** A tiny but real PNG — the sniffer reads magic numbers, not a filename. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
);

function upload(
  bytes: Buffer,
  filename = 'face.png',
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----se-avatar';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, bytes, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('in gallery mode', () => {
  beforeEach(async () => {
    await boot('gallery');
  });

  /**
   * ***[12 §8]'s first test.*** `toPublic` is already built by picking and is
   * *still too wide for this socket*: it carries `role`, `enabled`,
   * `capabilities`, `locale` and `createdAt`, none of which belongs in front of
   * an unauthenticated caller.
   */
  it('publishes exactly three fields and no more', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const listed = await server.request({ method: 'GET', url: '/api/auth/gallery' });

    expect(listed.status).toBe(200);
    expect(listed.body.accounts).toHaveLength(1);
    // The keys themselves, so a field added to `Account` and picked up by a
    // spread fails here rather than reaching an anonymous caller.
    expect(Object.keys(listed.body.accounts[0] as object).sort()).toEqual([
      'avatar',
      'displayName',
      'handle',
    ]);
    expect(JSON.stringify(listed.body)).not.toContain('admin');
    expect(JSON.stringify(listed.body)).not.toContain('capabilities');
  });

  it('is reachable with no session at all', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const listed = await server.request({ method: 'GET', url: '/api/auth/gallery' });
    expect(listed.status).toBe(200);
  });

  it('leaves out a disabled account and a hidden one', async () => {
    await server.services.accounts.create({ handle: 'mara', password: PASSWORD, role: 'user' });
    await server.services.accounts.create({ handle: 'ada', password: PASSWORD, role: 'user' });
    await server.services.accounts.update('mara', { enabled: false });
    await server.services.accounts.update('ada', { hiddenFromGallery: true });

    const listed = await server.request({ method: 'GET', url: '/api/auth/gallery' });
    expect((listed.body.accounts as { handle: string }[]).map((one) => one.handle)).toEqual([
      'ned',
    ]);
  });

  /**
   * ***[12 §8]'s second test, and [12 §2]'s lockout invariant.*** Hiding a face
   * is presentation; it grants nothing and withholds nothing, and an account
   * that could not sign in after opting out would have been given a foot-gun
   * rather than a preference.
   */
  it('lets a hidden account sign in by handle exactly as before', async () => {
    await server.services.accounts.create({ handle: 'ada', password: PASSWORD, role: 'user' });
    await server.services.accounts.update('ada', { hiddenFromGallery: true });
    await server.request({ method: 'POST', url: '/api/auth/logout' });

    const signedIn = await server.request({
      method: 'POST',
      url: '/api/auth/login',
      payload: { handle: 'ada', password: PASSWORD },
    });

    expect(signedIn.status).toBe(200);
    expect(signedIn.body.account.handle).toBe('ada');
  });

  /**
   * **`false` removes the field rather than storing it**, which keeps [12 §4]'s
   * polarity true on disk: only objectors carry it, so `accounts.json` stays a
   * document where a field's presence marks a choice somebody made.
   */
  it('stores an objection and forgets a retraction', async () => {
    await server.request({
      method: 'PATCH',
      url: '/api/me',
      payload: { hiddenFromGallery: true },
    });
    expect((await server.request({ method: 'GET', url: '/api/me' })).body.account).toMatchObject({
      hiddenFromGallery: true,
    });

    await server.request({
      method: 'PATCH',
      url: '/api/me',
      payload: { hiddenFromGallery: false },
    });
    const back = await server.request({ method: 'GET', url: '/api/me' });
    expect('hiddenFromGallery' in (back.body.account as object)).toBe(false);
    expect(
      (await server.request({ method: 'GET', url: '/api/auth/gallery' })).body.accounts,
    ).toHaveLength(1);
  });
});

describe('in form mode — the default', () => {
  beforeEach(async () => {
    await boot('form');
  });

  /**
   * ***[12 §8]'s third test***, and the claim [12 §1.1]'s default exists to make
   * true: *"a default install's unauthenticated surface is byte-for-byte what it
   * is today."*
   */
  it('answers 404 on the whole gallery family', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });

    for (const url of ['/api/auth/gallery', '/api/auth/gallery/ned/avatar']) {
      const response = await server.request({ method: 'GET', url });
      expect(response.status, url).toBe(404);
    }
  });

  /**
   * **The family is enumerated from Fastify rather than listed here**, which is
   * `route-callers.test.ts`'s own argument: a fourth member added in a hurry is
   * covered by existing rather than by somebody remembering to add a line.
   */
  it('has no unauthenticated route outside the family and the two it always had', () => {
    const unauthenticated = routesUnder(server.app, '/api/auth').map(
      (route) => `${route.method} ${route.url}`,
    );

    // The floor, so a scan that stopped matching cannot pass vacuously.
    expect(unauthenticated.length).toBeGreaterThanOrEqual(5);
    const family = unauthenticated.filter((one) => one.includes('/api/auth/gallery'));
    expect(family).toHaveLength(2);
  });

  it('says which door it is showing, without a session', async () => {
    await server.request({ method: 'POST', url: '/api/auth/logout' });
    const state = await server.request({ method: 'GET', url: '/api/auth/state' });

    // [12 §1.2]: one required field, and the pre-auth client is the only reader.
    expect(state.body.loginScreen).toBe('form');
  });
});

describe('the face', () => {
  beforeEach(async () => {
    await boot('gallery');
  });

  it('round-trips, and the listing carries its token', async () => {
    const sent = await server.request({ method: 'POST', url: '/api/me/avatar', ...upload(PNG) });
    expect(sent.status).toBe(200);
    expect(sent.body.avatar).toMatch(/^sha256:/);

    const listed = await server.request({ method: 'GET', url: '/api/auth/gallery' });
    expect((listed.body.accounts as { avatar: string }[])[0]?.avatar).toBe(sent.body.avatar);

    const served = await server.request({ method: 'GET', url: '/api/auth/gallery/ned/avatar' });
    expect(served.status).toBe(200);
    // The sniffed type, not the one the request claimed — it sent
    // `application/octet-stream`.
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['etag']).toBe(sent.body.avatar);
  });

  /**
   * ***Sniff the bytes, never trust the extension*** — [10 §4.4]. A route that
   * believed a filename would store an HTML document as `avatar.png` and serve
   * it back with a content type somebody else chose.
   */
  it('refuses something that is not an image, however it is named', async () => {
    const refused = await server.request({
      method: 'POST',
      url: '/api/me/avatar',
      ...upload(Buffer.from('<!doctype html><script>alert(1)</script>'), 'face.png'),
    });

    expect(refused.status).toBe(415);
    expect(refused.body.error).toBe('not-an-image');
  });

  it('is 304 for a client that already has it', async () => {
    const sent = await server.request({ method: 'POST', url: '/api/me/avatar', ...upload(PNG) });

    const again = await server.request({
      method: 'GET',
      url: '/api/auth/gallery/ned/avatar',
      headers: { 'if-none-match': sent.body.avatar as string },
    });
    expect(again.status).toBe(304);
  });

  /**
   * ***The clause that makes `hiddenFromGallery` mean something.*** Without it
   * the flag would hide a tile and still serve the portrait to anybody who
   * guessed the handle — the flag doing nothing for the only reason somebody
   * sets it.
   */
  it('is not served for an account that opted out', async () => {
    await server.request({ method: 'POST', url: '/api/me/avatar', ...upload(PNG) });
    await server.request({
      method: 'PATCH',
      url: '/api/me',
      payload: { hiddenFromGallery: true },
    });

    const refused = await server.request({ method: 'GET', url: '/api/auth/gallery/ned/avatar' });
    expect(refused.status).toBe(404);
  });

  it('can be removed, which goes back to the drawn tile', async () => {
    await server.request({ method: 'POST', url: '/api/me/avatar', ...upload(PNG) });
    expect((await server.request({ method: 'DELETE', url: '/api/me/avatar' })).status).toBe(204);

    const listed = await server.request({ method: 'GET', url: '/api/auth/gallery' });
    expect((listed.body.accounts as { avatar: string | null }[])[0]?.avatar).toBeNull();
  });
});
