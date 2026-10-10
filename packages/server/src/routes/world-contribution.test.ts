// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type Lorebook,
  type LoreEntry,
  newLorebook,
  newLoreEntry,
  newTreatment,
  newWorld,
  type TurnPreview,
  type World,
} from '@storyengine/shared';

import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';

/**
 * ***Contribution copies, and P5.7 stays reversed*** —
 * [P16 §1.3](../../../../docs/design/workplan/35-p16-world.md), [P16.2].
 *
 * **What went wrong at [P5.7]** is the thing this file exists to keep from
 * coming back from the other direction: a book's own `scope` was briefly allowed
 * to admit it to a session, and since `global` was the factory default and what
 * the SillyTavern importer wrote, a person's whole library appeared in every
 * prompt. A World contributes **once, at creation, by copying** — its books into
 * `session.lore`, its one treatment as the session's — and never as a query that
 * re-decides each turn.
 *
 * **The stage ends on the check §1.3 names**, and the last case here is it: after
 * starting a session in a World, `session.lore` names the books — as data, on
 * disk, editable — and nothing reaches the prompt that is not selected there. *If
 * a book reaches the prompt without appearing in that list, this stage rebuilt
 * P5.7*, and the library in this file holds a `global` book outside the World
 * precisely so that it would.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server, 'ned');
});

afterEach(async () => {
  await server.dispose();
});

async function created(kind: string, payload: unknown): Promise<void> {
  const response = await server.request({ method: 'POST', url: `/api/library/${kind}`, payload });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

function bookOf(name: string, entry: Partial<LoreEntry>, edits: Partial<Lorebook> = {}): Lorebook {
  return { ...newLorebook(name), entries: [{ ...newLoreEntry(name), ...entry }], ...edits };
}

function worldOf(name: string, members: { schema: string; id: string; name: string }[]): World {
  return { ...newWorld(name), contents: members };
}

async function start(payload: Record<string, unknown>) {
  const response = await server.request({ method: 'POST', url: '/api/sessions', payload });
  return response;
}

async function onDisk(sessionId: string): Promise<{ lore?: string[]; treatment?: string }> {
  return JSON.parse(
    await readFile(
      join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json'),
      'utf8',
    ),
  ) as { lore?: string[]; treatment?: string };
}

describe('starting a session in a World', () => {
  it('copies the World’s books into the session’s lore list, in the order the World holds them', async () => {
    const docks = bookOf('The Docks', { keys: ['ferry'] });
    const council = bookOf('The Council', { keys: ['council'] });
    await created('lorebooks', docks);
    await created('lorebooks', council);
    const world = worldOf('Rain City', [
      { schema: council.schema, id: council.id, name: council.name },
      { schema: docks.schema, id: docks.id, name: docks.name },
    ]);
    await created('worlds', world);

    const response = await start({ name: 'A night out', world: world.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const session = response.body.session as { id: string };
    expect((await onDisk(session.id)).lore).toEqual([council.id, docks.id]);
  });

  it('chooses the World’s treatment when it holds exactly one, and none when it holds several', async () => {
    const noir = newTreatment('Rain City, noir');
    const farce = newTreatment('Rain City, farce');
    await created('treatments', noir);
    await created('treatments', farce);

    const one = worldOf('One', [{ schema: noir.schema, id: noir.id, name: noir.name }]);
    await created('worlds', one);
    const first = await start({ world: one.id });
    expect(first.status).toBe(201);
    expect((await onDisk(first.body.session.id as string)).treatment).toBe(noir.id);

    // Two treatments is a choice the form offers; the server picking the first
    // would be choosing a story on somebody's behalf.
    const two = worldOf('Two', [
      { schema: noir.schema, id: noir.id, name: noir.name },
      { schema: farce.schema, id: farce.id, name: farce.name },
    ]);
    await created('worlds', two);
    const second = await start({ world: two.id });
    expect(second.status).toBe(201);
    expect((await onDisk(second.body.session.id as string)).treatment).toBeUndefined();
  });

  /**
   * ***Prefill, never binding*** ([00 §3.1]). What the caller sends is the last
   * word, as it is over a Setup's defaults: a form that offered the World's
   * books and had one unticked sends the rest, and the server re-adding the
   * unticked one would be the World binding the session after all.
   */
  it('lets what the caller sends override what the World would contribute', async () => {
    const docks = bookOf('The Docks', { keys: ['ferry'] });
    const council = bookOf('The Council', { keys: ['council'] });
    const noir = newTreatment('Rain City, noir');
    const farce = newTreatment('Rain City, farce');
    await created('lorebooks', docks);
    await created('lorebooks', council);
    await created('treatments', noir);
    await created('treatments', farce);
    const world = worldOf('Rain City', [
      { schema: docks.schema, id: docks.id, name: docks.name },
      { schema: council.schema, id: council.id, name: council.name },
      { schema: noir.schema, id: noir.id, name: noir.name },
    ]);
    await created('worlds', world);

    const response = await start({
      world: world.id,
      lore: [docks.id],
      treatment: farce.id,
    });
    expect(response.status).toBe(201);
    const stored = await onDisk(response.body.session.id as string);
    expect(stored.lore).toEqual([docks.id]);
    expect(stored.treatment).toBe(farce.id);
  });

  it('adds the session to the World it was started in', async () => {
    const world = worldOf('Rain City', []);
    await created('worlds', world);

    const response = await start({ name: 'A night out', world: world.id });
    expect(response.status).toBe(201);
    const session = response.body.session as { id: string };

    const read = await server.request({ method: 'GET', url: `/api/library/worlds/${world.id}` });
    expect(read.body.object.contents).toEqual([
      { schema: 'storyengine.session/1', id: session.id, name: 'A night out' },
    ]);
  });

  it('refuses a World that is not there, rather than starting something else', async () => {
    const response = await start({ world: '0199c000-0000-7000-8000-0000000000ff' });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe('unknown-world');
    const listed = await server.request({ method: 'GET', url: '/api/sessions' });
    expect(listed.body.sessions).toEqual([]);
  });

  /**
   * ***§1.3's check, and the stage ends on it.*** A `global` book sits in the
   * library outside the World, keyed on a word the input says. It is not in
   * `session.lore`, so it is not in play — whatever its own scope claims.
   */
  it('puts in play only the books session.lore names, and no global book outside the World', async () => {
    const docks = bookOf('The Docks', { keys: ['ferry'], content: 'The ferry runs at dawn.' });
    const everywhere = bookOf(
      'Everywhere',
      { keys: ['council'], content: 'The council meets at dusk.' },
      { scope: { kind: 'global' } },
    );
    await created('lorebooks', docks);
    await created('lorebooks', everywhere);
    const world = worldOf('Rain City', [{ schema: docks.schema, id: docks.id, name: docks.name }]);
    await created('worlds', world);

    const response = await start({ world: world.id });
    expect(response.status).toBe(201);
    const sessionId = response.body.session.id as string;
    expect((await onDisk(sessionId)).lore).toEqual([docks.id]);

    const previewed = await server.request({
      method: 'POST',
      url: `/api/sessions/${sessionId}/preview`,
      payload: { input: { text: 'The council took the ferry.' } },
    });
    expect(previewed.status).toBe(200);
    const preview = previewed.body.preview as TurnPreview;
    expect(preview.lore.books.map((book) => book.bookId)).toEqual([docks.id]);
    if (preview.state !== 'unmeasurable') {
      const lore = preview.blocks.filter((one) => one.source.kind === 'lore');
      expect(lore.map((one) => one.text)).toEqual(['The ferry runs at dawn.']);
    }
  });

  /**
   * ***None, said out loud.*** Absent takes the World's only treatment; `null`
   * is a person choosing no treatment beside a World that holds one, which the
   * form has to be able to send.
   */
  it('starts with no treatment when the caller sends null, whatever the World holds', async () => {
    const noir = newTreatment('Rain City, noir');
    await created('treatments', noir);
    const world = worldOf('One', [{ schema: noir.schema, id: noir.id, name: noir.name }]);
    await created('worlds', world);

    const response = await start({ world: world.id, treatment: null });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await onDisk(response.body.session.id as string)).treatment).toBeUndefined();
  });

  /** A World is filled from a whole library, so its books can be many. */
  it('takes an explicit list of a large World’s books', async () => {
    const world = worldOf('Big', []);
    await created('worlds', world);
    const lore = Array.from(
      { length: 200 },
      (_, at) => `0199c000-0000-7000-8000-${String(at).padStart(12, '0')}`,
    );

    const response = await start({ world: world.id, lore });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await onDisk(response.body.session.id as string)).lore).toHaveLength(200);
  });

  /**
   * ***A book that says it is for this World*** — `LoreScope`'s `world` arm,
   * the author's statement where membership is the curator's ([15 §5.3]). Read
   * once, here, by copying: it joins the World's own books in `session.lore`,
   * and a book scoped to another World does not.
   */
  it('copies a book whose scope names the World after the World’s own, and no other', async () => {
    const member = bookOf('The Docks', { keys: ['ferry'] });
    await created('lorebooks', member);
    const world = worldOf('Rain City', [
      { schema: member.schema, id: member.id, name: member.name },
    ]);
    await created('worlds', world);
    const forIt = bookOf(
      'Harbour gossip',
      { keys: ['gossip'] },
      { scope: { kind: 'world', worldIds: [world.id] } },
    );
    const forAnother = bookOf(
      'Far coast',
      { keys: ['coast'] },
      { scope: { kind: 'world', worldIds: ['0199c000-0000-7000-8000-0000000000ee'] } },
    );
    await created('lorebooks', forIt);
    await created('lorebooks', forAnother);

    const response = await start({ world: world.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await onDisk(response.body.session.id as string)).lore).toEqual([member.id, forIt.id]);

    // Not a query each turn: a session started with no World never sees it.
    const plain = await start({});
    expect((await onDisk(plain.body.session.id as string)).lore).toBeUndefined();
  });

  /**
   * ***A scope this build has never heard of*** — [26 B16]'s answer, *open the
   * unions*. A book a newer build scoped some new way is kept, byte for byte,
   * and admits itself to nothing.
   */
  it('keeps a book whose scope is of a kind it does not know, and admits it to nothing', async () => {
    const strange = bookOf(
      'From a newer build',
      { keys: ['ferry'] },
      { scope: { kind: 'campaign', campaignIds: ['c-1'] } as unknown as Lorebook['scope'] },
    );
    await created('lorebooks', strange);
    const read = await server.request({
      method: 'GET',
      url: `/api/library/lorebooks/${strange.id}`,
    });
    expect(read.status).toBe(200);
    expect(read.body.object.scope).toEqual({ kind: 'campaign', campaignIds: ['c-1'] });

    const world = worldOf('Rain City', []);
    await created('worlds', world);
    const response = await start({ world: world.id });
    expect((await onDisk(response.body.session.id as string)).lore).toEqual([]);
  });
});
