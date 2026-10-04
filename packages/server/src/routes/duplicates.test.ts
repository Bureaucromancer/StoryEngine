// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newLorebook, uuidv7 } from '@storyengine/shared';

import { rebuild } from '../index-db/rebuild.js';
import { makeTestServer, ownObjects, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * Opening the copy the warning is about — F19.
 *
 * Copying a folder in a file manager is a thing this storage model invites, and
 * it produces two files holding one id. The list already showed both and
 * flagged the loser; what it could not do was open it. `findById` answers with
 * the winner by design, so the shadowed row's link led to the winning object
 * while the page said it was showing the shadowed one — the warning existed and
 * the thing it warned about had no address.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

const KIND_ROOT = ['users', 'ned', 'library', 'lorebooks'] as const;

/**
 * One id in two folders, the way a person makes it: copy the directory.
 *
 * The names are chosen so the winner is decided by the *slug* and not by a
 * prefix relationship — `vera` versus `vera2` is where a binary ordering over a
 * native path flips between platforms (F23), and this test should be about F19
 * rather than about that. F23 is fixed and the prefix case has its own test in
 * `index-db.test.ts`; the choice stays because a fixture that leans on the fix
 * would fail here for a reason that has nothing to do with what it asserts.
 */
async function duplicateOnDisk(): Promise<{ id: string; winner: string; shadowed: string }> {
  const book = newLorebook('Rain City');
  const created = await server.request({
    method: 'POST',
    url: '/api/library/lorebooks',
    payload: book,
  });
  expect(created.status).toBe(201);
  const winner = created.body.slug as string;

  const kindRoot = join(server.dataDir, ...KIND_ROOT);
  const shadowed = 'zz-copy-of-rain-city';
  await cp(join(kindRoot, winner), join(kindRoot, shadowed), { recursive: true });
  await rebuild(server.services.index.db, server.services.layout);

  return { id: book.id, winner, shadowed };
}

describe('a duplicated id', () => {
  it('lists both copies, with the later path flagged', async () => {
    const { id, winner, shadowed } = await duplicateOnDisk();

    // The user's own: a shipped system book is on the same shelf and is not
    // one of the two copies this test made.
    const rows = (await ownObjects(server, 'lorebooks')).objects as unknown as {
      id: string;
      slug: string;
      shadowed: boolean;
    }[];

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.id === id)).toBe(true);
    expect(rows.find((row) => row.slug === winner)?.shadowed).toBe(false);
    expect(rows.find((row) => row.slug === shadowed)?.shadowed).toBe(true);
  });

  it('opens the winner by id, as everything else must continue to', async () => {
    const { id, winner } = await duplicateOnDisk();

    const response = await server.request({ method: 'GET', url: `/api/library/lorebooks/${id}` });

    expect(response.status).toBe(200);
    expect(response.body.slug).toBe(winner);
    expect(response.body.shadowed).toBe(false);
  });

  it('opens the shadowed copy when the address says which one', async () => {
    const { id, shadowed } = await duplicateOnDisk();

    const response = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}?source=user&slug=${shadowed}`,
    });

    expect(response.status).toBe(200);
    expect(response.body.slug).toBe(shadowed);
    // The flag is what the page needs to say "this is the copy that does not
    // load" — and it was an unreachable branch until this route existed.
    expect(response.body.shadowed).toBe(true);
  });

  it('tells the two copies apart by their contents, not just their labels', async () => {
    // The real proof. If the discriminator were ignored, both addresses would
    // answer with identical bytes and every assertion above would still pass.
    const { id, winner, shadowed } = await duplicateOnDisk();

    const kindRoot = join(server.dataDir, ...KIND_ROOT);
    const edited = { ...newLorebook('Hand Edited'), id };
    await writeFile(join(kindRoot, shadowed, 'lorebook.json'), JSON.stringify(edited, null, 2));
    await rebuild(server.services.index.db, server.services.layout);

    const winnerResponse = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}?source=user&slug=${winner}`,
    });
    const shadowedResponse = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}?source=user&slug=${shadowed}`,
    });

    expect(winnerResponse.body.name).toBe('Rain City');
    expect(shadowedResponse.body.name).toBe('Hand Edited');
  });

  it('refuses an address that names nothing, and one that names another kind', async () => {
    const { id, shadowed } = await duplicateOnDisk();

    const noSuchSlug = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}?source=user&slug=no-such-folder`,
    });
    expect(noSuchSlug.status).toBe(404);

    // The kind check applies to the addressed copy too — one funnel, both
    // rules.
    const wrongKind = await server.request({
      method: 'GET',
      url: `/api/library/actors/${id}?source=user&slug=${shadowed}`,
    });
    expect(wrongKind.status).toBe(404);

    // And the system scope is a different address space: nothing of the
    // caller's is reachable through it.
    const wrongScope = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}?source=system&slug=${shadowed}`,
    });
    expect(wrongScope.status).toBe(404);
  });

  /**
   * ***What a copy's page hands over is that copy*** (2026-09-27).
   *
   * The detail page of a shadowed copy is reached through this address and
   * showed the right file, and its Download and Export buttons went to routes
   * that ignored the address — so they served the winner's bytes, named after
   * the copy on screen. Here the two copies differ in what they hold, which is
   * the only way a route ignoring the address can be seen.
   */
  it('downloads and exports the copy the address names, and the winner without one', async () => {
    const { id, shadowed } = await duplicateOnDisk();
    const kindRoot = join(server.dataDir, ...KIND_ROOT);
    const edited = { ...newLorebook('Hand Edited'), id };
    await writeFile(join(kindRoot, shadowed, 'lorebook.json'), JSON.stringify(edited, null, 2));
    await rebuild(server.services.index.db, server.services.layout);
    const at = `?source=user&slug=${shadowed}`;

    const downloaded = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}/download${at}`,
    });
    expect(downloaded.status).toBe(200);
    expect(downloaded.body.name).toBe('Hand Edited');

    const exported = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}/export/aventuras.lorebook${at}`,
    });
    expect(exported.status).toBe(200);
    // An Aventuras lorebook is its entries; the name travels as the file's.
    expect(exported.headers['content-disposition']).toBe('attachment; filename="Hand-Edited.json"');

    // No address is the winner, as it is everywhere else.
    const plain = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}/download`,
    });
    expect(plain.body.name).toBe('Rain City');

    // And an address that names nothing is a 404, not a quiet fall back to the
    // winner: a page that asked for one file must not be handed another.
    const nowhere = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}/export/aventuras.lorebook?source=user&slug=no-such-folder`,
    });
    expect(nowhere.status).toBe(404);
  });

  /**
   * ***And an actor's copy is that copy's card*** (2026-09-28). An actor
   * downloads as its card now, read through `readCardPixels`, which took no
   * address — so the address above had to reach that read too, or a copy's
   * page would hand over the winner's card under the copy's name.
   */
  it("downloads a shadowed actor copy's own card", async () => {
    const actor = newActor('Vera');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/actors',
      payload: actor,
    });
    expect(created.status).toBe(201);
    const winner = created.body.slug as string;
    const actorRoot = join(server.dataDir, 'users', 'ned', 'library', 'actors');
    const shadowed = 'zz-copy-of-vera';
    await cp(join(actorRoot, winner), join(actorRoot, shadowed), { recursive: true });
    await rebuild(server.services.index.db, server.services.layout);

    // The winner moves on, and the copy keeps the card it was copied with.
    const held = await server.request({ method: 'GET', url: `/api/library/actors/${actor.id}` });
    const written = await server.request({
      method: 'PUT',
      url: `/api/library/actors/${actor.id}`,
      payload: {
        object: { ...(held.body.object as Record<string, unknown>), name: 'Vera Solano' },
        contentHash: held.body.contentHash as string,
      },
    });
    expect(written.status).toBe(200);

    const cookie = [...server.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const download = (at: string) =>
      server.app.inject({
        method: 'GET',
        url: `/api/library/actors/${actor.id}/download${at}`,
        headers: { cookie },
      });
    const copy = await download(`?source=user&slug=${shadowed}`);
    const plain = await download('');
    expect(copy.statusCode).toBe(200);
    expect(copy.headers['content-disposition']).toBe('attachment; filename="Vera.png"');
    expect(copy.rawPayload.equals(await readFile(join(actorRoot, shadowed, 'card.png')))).toBe(
      true,
    );
    expect(plain.rawPayload.equals(await readFile(join(actorRoot, winner, 'card.png')))).toBe(true);
    expect(copy.rawPayload.equals(plain.rawPayload)).toBe(false);
  });

  it('does not make the shadowed copy writable', async () => {
    // The line the plan draws: reads may name a copy, writes may not. A write
    // carries no address, so it resolves to the winner and the hash check does
    // the rest — a duplicate stays a warning rather than becoming a fork.
    const { id, winner, shadowed } = await duplicateOnDisk();

    const addressed = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}?source=user&slug=${shadowed}`,
    });
    const written = await server.request({
      method: 'PUT',
      url: `/api/library/lorebooks/${id}?source=user&slug=${shadowed}`,
      payload: {
        object: { ...(addressed.body.object as Record<string, unknown>), name: 'Renamed' },
        contentHash: addressed.body.contentHash as string,
      },
    });
    expect(written.status).toBe(200);

    // It wrote the winner, because that is what an id resolves to. The
    // shadowed file on disk is untouched.
    const winnerNow = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}?source=user&slug=${winner}`,
    });
    expect(winnerNow.body.name).toBe('Renamed');

    const shadowedNow = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}?source=user&slug=${shadowed}`,
    });
    expect(shadowedNow.body.name).toBe('Rain City');
  });

  it('survives a rebuild choosing the same winner', async () => {
    // Gate step 12's second half: the same copy stays shadowed after a rebuild,
    // which is what makes the address stable enough to put in a link.
    const { id, shadowed } = await duplicateOnDisk();

    await rebuild(server.services.index.db, server.services.layout);

    const response = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}?source=user&slug=${shadowed}`,
    });
    expect(response.body.shadowed).toBe(true);
  });
});

/**
 * The index-rows projection — [P3.3], with [P3 §7.4] decided: every row the
 * index holds for the id, best-effort rather than a contract. This file is
 * its natural home because the projection's reason to exist is the question
 * this file is about: which of two copies loads, said by path.
 */
describe('the index-rows projection', () => {
  it('shows every row for the id, the winner named by its portable path', async () => {
    const { id, winner, shadowed } = await duplicateOnDisk();

    const response = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}/rows`,
    });
    expect(response.status).toBe(200);

    const rows = response.body.rows as {
      path: string;
      slug: string;
      shadowed: boolean;
      tombstonedAt: number | null;
    }[];
    expect(rows).toHaveLength(2);
    // Winner first, because the order shown is the order that decides (F23):
    // ascending portable path.
    expect(rows[0]?.slug).toBe(winner);
    expect(rows[0]?.shadowed).toBe(false);
    expect(rows[1]?.slug).toBe(shadowed);
    expect(rows[1]?.shadowed).toBe(true);
    // Portable, never native (F22): forward slashes, root-relative, the exact
    // string a person can follow under their data directory. On Windows the
    // native spelling would carry backslashes, so the equality is the mutation
    // trap for a projection that leaked the stored path.
    expect(rows[0]?.path).toBe(`users/ned/library/lorebooks/${winner}/lorebook.json`);
    expect(rows.every((row) => !row.path.includes('\\'))).toBe(true);
    // The projection restates the row, not the object: no body rides along.
    expect(rows[0]).not.toHaveProperty('body');
  });

  it('keeps a deleted copy visible as tombstoned, for its settling window', async () => {
    const { id, winner, shadowed } = await duplicateOnDisk();

    const current = await server.request({ method: 'GET', url: `/api/library/lorebooks/${id}` });
    const deleted = await server.request({
      method: 'DELETE',
      url: `/api/library/lorebooks/${id}`,
      headers: { 'if-match': current.body.contentHash as string },
    });
    expect(deleted.status).toBe(204);

    const response = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}/rows`,
    });
    const rows = response.body.rows as {
      slug: string;
      shadowed: boolean;
      tombstonedAt: number | null;
    }[];
    expect(rows).toHaveLength(2);

    // The delete resolved to the winner; its row is inside the settling
    // window, stamped rather than gone. The survivor was promoted the moment
    // the winner died — the projection shows the dance mid-step.
    const gone = rows.find((row) => row.slug === winner);
    const survivor = rows.find((row) => row.slug === shadowed);
    expect(typeof gone?.tombstonedAt).toBe('number');
    expect(survivor?.shadowed).toBe(false);
    expect(survivor?.tombstonedAt).toBeNull();
  });

  it('never shows another library’s rows, even for the same id', async () => {
    const { id } = await duplicateOnDisk();

    // A same-id copy planted straight into somebody else's tree — the
    // filesystem is the fixture, and rebuild walks every user directory it
    // finds. `amaya` sorts before `ned`, so a projection that dropped the
    // owner filter would list this row first, as the global winner.
    const foreign = { ...newLorebook('Foreign Copy'), id };
    const foreignDir = join(server.dataDir, 'users', 'amaya', 'library', 'lorebooks', 'foreign');
    await mkdir(foreignDir, { recursive: true });
    await writeFile(join(foreignDir, 'lorebook.json'), JSON.stringify(foreign, null, 2));
    await rebuild(server.services.index.db, server.services.layout);

    const response = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${id}/rows`,
    });
    expect(response.status).toBe(200);

    const rows = response.body.rows as { path: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.path.startsWith('users/ned/'))).toBe(true);
  });

  it('answers not-found across kinds and for unknown ids, like every read', async () => {
    const { id } = await duplicateOnDisk();

    const wrongKind = await server.request({
      method: 'GET',
      url: `/api/library/actors/${id}/rows`,
    });
    expect(wrongKind.status).toBe(404);
    expect(wrongKind.body.error).toBe('not-found');

    const unknown = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${uuidv7()}/rows`,
    });
    expect(unknown.status).toBe(404);
  });
});

describe('an id that is not duplicated', () => {
  it('ignores an address that happens to match it', async () => {
    // The parameter narrows a read; it does not require one. An ordinary
    // object addressed by its own slug is still just that object.
    const book = newLorebook('Rain City');
    const created = await server.request({
      method: 'POST',
      url: '/api/library/lorebooks',
      payload: book,
    });

    const response = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}?source=user&slug=${created.body.slug as string}`,
    });

    expect(response.status).toBe(200);
    expect(response.body.shadowed).toBe(false);
  });

  it('keeps working when a foreign folder is added under a new kind root', async () => {
    // Belt and braces on the scope key: a lorebook written into a directory
    // that did not exist yet is indexed and addressable like any other.
    const kindRoot = join(server.dataDir, ...KIND_ROOT);
    await mkdir(kindRoot, { recursive: true });
    const book = newLorebook('Hand Made');
    await mkdir(join(kindRoot, 'hand-made'), { recursive: true });
    await writeFile(join(kindRoot, 'hand-made', 'lorebook.json'), JSON.stringify(book, null, 2));
    await rebuild(server.services.index.db, server.services.layout);

    const response = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${book.id}?source=user&slug=hand-made`,
    });
    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Hand Made');
  });
});
