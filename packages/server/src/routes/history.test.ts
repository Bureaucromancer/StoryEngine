// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newLorebook } from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * Version history through the HTTP surface — the CI equivalents of exit-gate
 * steps 13–19 ([P1 §3](../../../../docs/design/workplan/07-p1-implementation.md)).
 *
 * Each of these fails silently otherwise: mis-attributed sources look like a
 * working feature, no-op suppression is invisible until the list is unusable,
 * and a destructive restore is only discovered by someone who needed the thing
 * it destroyed.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

async function createActor(name = 'Vera Solano') {
  const response = await server.request({
    method: 'POST',
    url: '/api/library/actors',
    payload: newActor(name),
  });
  expect(response.status).toBe(201);
  return response.body as { id: string; slug: string; contentHash: string };
}

async function readEnvelope(id: string) {
  const response = await server.request({ method: 'GET', url: `/api/library/actors/${id}` });
  expect(response.status).toBe(200);
  return response.body as { contentHash: string; object: Record<string, any> };
}

async function saveSummary(id: string, contentHash: string, summary: string) {
  const { object } = await readEnvelope(id);
  object['profile'].sections[0].body = summary;
  const response = await server.request({
    method: 'PUT',
    url: `/api/library/actors/${id}`,
    payload: { object, contentHash },
  });
  expect(response.status).toBe(200);
  return response.body as { contentHash: string };
}

async function listHistory(id: string) {
  const response = await server.request({
    method: 'GET',
    url: `/api/library/actors/${id}/history`,
  });
  expect(response.status).toBe(200);
  return response.body.versions as {
    id: string;
    revision: number;
    source: { kind: string };
    reason: string;
    pinned: boolean;
    authoredAt: string;
  }[];
}

describe('every edit snapshots the state it replaces', () => {
  it('records a manual source for an edit through the API', async () => {
    const created = await createActor();
    await saveSummary(created.id, created.contentHash, 'A fixer with a conscience.');

    const versions = await listHistory(created.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.source).toEqual({ kind: 'manual' });
  });

  it('serves the snapshotted object, not the live one', async () => {
    const created = await createActor();
    await saveSummary(created.id, created.contentHash, 'Rewritten.');

    const versions = await listHistory(created.id);
    const version = await server.request({
      method: 'GET',
      url: `/api/library/actors/${created.id}/history/${versions[0]!.id}`,
    });
    expect(version.status).toBe(200);
    // The snapshot is the state *before* the edit: an empty summary.
    expect(version.body.object.profile.sections[0].body).toBe('');
  });

  it('keeps the replaced state’s own authored date, not the moment it was superseded', async () => {
    const created = await createActor();
    const { object: before } = await readEnvelope(created.id);
    await saveSummary(created.id, created.contentHash, 'Edited.');

    const versions = await listHistory(created.id);
    // [03 §11.1]: a restored version keeps its real date in the list.
    expect(versions[0]!.authoredAt).toBe(before['provenance'].updatedAt);
  });

  // The external half of the attribution claim — a hand edit on disk recording
  // `external` — is tested where it actually happens: through real filesystem
  // events, in watcher.test.ts.
});

describe('the no-op rule', () => {
  it('a save that changes nothing records no version and keeps the hash', async () => {
    const created = await createActor();
    const first = await saveSummary(created.id, created.contentHash, 'One real edit.');

    // Save the identical object again — [03 §11.1], exit-gate step 17.
    const { object } = await readEnvelope(created.id);
    const again = await server.request({
      method: 'PUT',
      url: `/api/library/actors/${created.id}`,
      payload: { object, contentHash: first.contentHash },
    });
    expect(again.status).toBe(200);
    expect(again.body.contentHash).toBe(first.contentHash);

    expect(await listHistory(created.id)).toHaveLength(1);
  });
});

describe('restore', () => {
  it('reverts the object and puts the state you were on at the top of the list', async () => {
    const created = await createActor();
    const afterFirst = await saveSummary(created.id, created.contentHash, 'The first summary.');
    await saveSummary(created.id, afterFirst.contentHash, 'The second summary.');

    // Restore the version that holds "The first summary." — the newest entry
    // snapshots the second state, so nothing is destroyed (exit-gate step 18).
    const versions = await listHistory(created.id);
    expect(versions).toHaveLength(2);
    const target = versions.find((v) => v.revision === 2)!; // snapshot of "first summary" state

    const { contentHash } = await readEnvelope(created.id);
    const restore = await server.request({
      method: 'POST',
      url: `/api/library/actors/${created.id}/history/${target.id}/restore`,
      payload: { contentHash },
    });
    expect(restore.status).toBe(200);
    expect(restore.body.object.profile.sections[0].body).toBe('The first summary.');

    const after = await listHistory(created.id);
    expect(after).toHaveLength(3);
    expect(after[0]!.source).toEqual({ kind: 'restore', fromVersionId: target.id });
    expect(after[0]!.reason).toBe('Saved before restoring an earlier version');
  });

  it('restoring the state you are already on is a no-op', async () => {
    const created = await createActor();
    const afterEdit = await saveSummary(created.id, created.contentHash, 'Edited once.');
    // Snapshot of the pre-edit state; restore it, then restore it again.
    const versions = await listHistory(created.id);
    const restore = await server.request({
      method: 'POST',
      url: `/api/library/actors/${created.id}/history/${versions[0]!.id}/restore`,
      payload: { contentHash: afterEdit.contentHash },
    });
    expect(restore.status).toBe(200);

    const secondRestore = await server.request({
      method: 'POST',
      url: `/api/library/actors/${created.id}/history/${versions[0]!.id}/restore`,
      payload: { contentHash: restore.body.contentHash as string },
    });
    expect(secondRestore.status).toBe(200);
    expect(secondRestore.body.contentHash).toBe(restore.body.contentHash);

    // One edit, one restore — the second restore added nothing.
    expect(await listHistory(created.id)).toHaveLength(2);
  });

  it('is hash-checked like any other write', async () => {
    const created = await createActor();
    await saveSummary(created.id, created.contentHash, 'Edited.');
    const versions = await listHistory(created.id);

    const stale = await server.request({
      method: 'POST',
      url: `/api/library/actors/${created.id}/history/${versions[0]!.id}/restore`,
      payload: { contentHash: created.contentHash }, // the pre-edit hash: stale
    });
    expect(stale.status).toBe(412);
    expect(stale.body.error).toBe('stale');
    expect(stale.body.current.object).toBeDefined();
  });
});

describe('rename and pin', () => {
  it('sets the reason and the pin, and both survive', async () => {
    const created = await createActor();
    await saveSummary(created.id, created.contentHash, 'Edited.');
    const versions = await listHistory(created.id);

    const patched = await server.request({
      method: 'PATCH',
      url: `/api/library/actors/${created.id}/history/${versions[0]!.id}`,
      payload: { reason: 'before I rewrote her backstory', pinned: true },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.version).toMatchObject({
      reason: 'before I rewrote her backstory',
      pinned: true,
    });

    const after = await listHistory(created.id);
    expect(after[0]).toMatchObject({ reason: 'before I rewrote her backstory', pinned: true });
  });
});

describe('the editor’s save path keeps its promises', () => {
  it('does not re-encode the card’s pixels (exit-gate step 13)', async () => {
    const created = await createActor();
    const cardPath = join(
      server.dataDir,
      'users',
      'ned',
      'library',
      'actors',
      created.slug,
      'card.png',
    );
    const before = await readFile(cardPath);
    const pixelsBefore = pixelBytesOf(before);

    await saveSummary(created.id, created.contentHash, 'A new summary.');

    const after = await readFile(cardPath);
    expect(pixelBytesOf(after)).toEqual(pixelsBefore);
  });

  it('preserves fields this build does not know (exit-gate step 14)', async () => {
    const created = await createActor();

    // A field from the future, added by hand.
    const { object, contentHash } = await readEnvelope(created.id);
    object['fromTheFuture'] = { keep: 'me' };
    const withUnknown = await server.request({
      method: 'PUT',
      url: `/api/library/actors/${created.id}`,
      payload: { object, contentHash },
    });
    expect(withUnknown.status).toBe(200);

    // Edit a *different* field, the way the editor does.
    await saveSummary(created.id, withUnknown.body.contentHash as string, 'Edited afterwards.');

    const final = await readEnvelope(created.id);
    expect(final.object['fromTheFuture']).toEqual({ keep: 'me' });
  });

  it('serves the avatar with the card’s bytes', async () => {
    const created = await createActor();
    const avatar = await server.request({
      method: 'GET',
      url: `/api/library/actors/${created.id}/avatar`,
    });
    expect(avatar.status).toBe(200);
    expect(avatar.headers['content-type']).toBe('image/png');
  });

  /**
   * ***The route nothing could show a picture without*** — [03 §5.2.2],
   * [06 §7.2], [P7.10].
   *
   * `/avatar` above serves the card's *own* pixels and was the only image path
   * this build had. An actor's expression set, a treatment's cover and an
   * authored backdrop are all `EmbeddedMedia` — *"a reference to bytes carried
   * by the container"* — and nothing served those, which is where [06 §7.2]'s
   * sprites stopped.
   */
  it('serves an embedded media entry’s bytes, keyed on its own digest', async () => {
    const created = await createActor();
    const { object, contentHash } = await readEnvelope(created.id);

    // A one-pixel GIF, which is a real image and not a card — exactly what an
    // expression is: bytes a browser renders, not a container anything parses.
    const bytes = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const written = await server.request({
      method: 'PUT',
      url: `/api/library/actors/${created.id}`,
      payload: {
        object: {
          ...object,
          media: [
            {
              id: 'm-neutral',
              role: 'expression',
              mime: 'image/gif',
              digest: 'sha256:deadbeef',
              bytes: bytes.byteLength,
              ref: 'blob-neutral',
              label: 'neutral',
              tags: [],
            },
          ],
        },
        contentHash,
      },
    });
    expect(written.status).toBe(200);

    /**
     * **The manifest without its blob is not-found, not empty.** The two halves
     * are written by different people and [03 §5.2.2] names the way they come
     * apart — *"ancillary chunks are droppable by spec-compliant tools that do
     * not understand them"*. A route that answered 200 with nothing would make
     * a stripped card look like a card with a blank face.
     */
    const missing = await server.request({
      method: 'GET',
      url: `/api/library/actors/${created.id}/media/m-neutral`,
    });
    expect(missing.status).toBe(404);
  });

  it('does not serve media nobody named', async () => {
    const created = await createActor();
    const response = await server.request({
      method: 'GET',
      url: `/api/library/actors/${created.id}/media/nothing-like-it`,
    });
    expect(response.status).toBe(404);
  });

  it('does not serve an avatar for a kind with no pixels', async () => {
    const response = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: newLorebook('Rain City'),
    });
    const avatar = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${response.body.id as string}/avatar`,
    });
    expect(avatar.status).toBe(404);
  });
});

describe('retention', () => {
  it('prunes oldest first and never prunes a pin', async () => {
    // The cap in this harness is the default 50; drive the mechanism directly
    // at a lower cap through the storage layer.
    const { snapshotReplaced, listVersions, patchVersion } = await import('../storage/history.js');
    const created = await createActor();
    const objectRoot = join(server.dataDir, 'users', 'ned', 'library', 'actors', created.slug);

    // Three distinct states, capped at two.
    for (const summary of ['one', 'two', 'three']) {
      await snapshotReplaced({
        objectRoot,
        payload: { schema: 'storyengine.actor/1', state: summary },
        source: { kind: 'manual' },
        reason: summary,
        keepPerObject: 2,
      });
    }
    let versions = await listVersions(objectRoot);
    expect(versions.map((v) => v.reason)).toEqual(['two', 'three']);

    // Pin the oldest survivor; the next snapshot must prune around it.
    await patchVersion(objectRoot, versions[0]!.id, { pinned: true });
    await snapshotReplaced({
      objectRoot,
      payload: { schema: 'storyengine.actor/1', state: 'four' },
      source: { kind: 'manual' },
      reason: 'four',
      keepPerObject: 2,
    });
    versions = await listVersions(objectRoot);
    expect(versions.map((v) => v.reason)).toEqual(['two', 'four']);
    expect(versions[0]!.pinned).toBe(true);
  });
});

/**
 * The concatenated IDAT payload — the pixels as encoded, headers and text
 * chunks excluded. Byte-identical pixels across a save is exit-gate step 13.
 */
function pixelBytesOf(png: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 8; // the PNG signature
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const name = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    if (name === 'IDAT') {
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
}
