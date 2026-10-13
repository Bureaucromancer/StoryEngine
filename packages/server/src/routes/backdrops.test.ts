// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type EmbeddedMedia,
  newActor,
  newLorebook,
  newLoreEntry,
  newSetup,
  newTreatment,
  newWorld,
  RENDITION_SCHEMA,
  type Rendition,
} from '@storyengine/shared';

import { sessionAssetsRoot, writeRendition } from '../renditions/store.js';
import { ensureDirectory, writeFileBytes } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, tempRoot, type TestServer } from '../test-server.js';

/**
 * ***Choose a backdrop… — the list*** — [10 §2.3](../../../../docs/design/10-ui-surfaces.md),
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.2, under
 * its §0.4: *choose from what the session already uses*.
 *
 * **The claim is a boundary, so the fixture is built on both sides of it.**
 * Every kind of thing a session uses carries a picture — its treatment, a book
 * the treatment links and a book the session names, a lorebook entry, its
 * setup, a World it is in, its persona, its roster and an actor the channels
 * walked in — and beside each one is the same kind of thing the session does
 * not use, carrying a picture too. A route that listed the library, or one
 * kind too many, offers one of those; a route that followed one reference too
 * few drops a row the first list names.
 *
 * *And each row's URL is the stage's*: the last test writes a row's selection
 * the way the client does and reads the stage back, because a dialog that drew
 * a thumbnail from one address and a stage that drew the pick from another
 * would show a picture it cannot stage.
 */

let dataDir: string;
let server: TestServer;
let layout: Layout;

beforeEach(async () => {
  dataDir = await tempRoot('se-backdrops-');
  server = await makeTestServer({ dataDir });
  await setUpAdmin(server, 'ned');
  layout = new Layout(dataDir);
});

afterEach(async () => {
  await server.dispose();
  await rm(dataDir, { recursive: true, force: true });
});

/** A media row. The bytes are never read here: the list names, the media route serves. */
function picture(id: string, role: EmbeddedMedia['role'], label?: string): EmbeddedMedia {
  return {
    id,
    role,
    mime: 'image/png',
    digest: `sha256:${id}`,
    bytes: 7,
    ref: `assets/${id}.png`,
    tags: [],
    ...(label === undefined ? {} : { label }),
  };
}

async function created(kind: string, payload: { id: string }): Promise<void> {
  const response = await server.request({ method: 'POST', url: `/api/library/${kind}`, payload });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function put(sessionId: string, key: string, value: unknown) {
  const response = await server.request({
    method: 'PUT',
    url: `/api/sessions/${sessionId}/channels/${encodeURIComponent(key)}`,
    payload: { value },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as { effect: { applied: boolean } };
}

async function candidates(sessionId: string) {
  const response = await server.request({
    method: 'GET',
    url: `/api/sessions/${sessionId}/backdrops`,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (
    response.body as {
      candidates: {
        selection: Record<string, string>;
        url: string;
        source: { kind: string; id: string; name: string } | null;
        label: string | null;
        current: boolean;
      }[];
    }
  ).candidates;
}

/** A background or an illustration on disk, with or without its pixels. */
async function rendition(
  sessionId: string,
  id: string,
  over: Partial<Rendition> & { pixels?: boolean } = {},
): Promise<void> {
  const { pixels = true, ...rest } = over;
  await writeRendition(layout, 'ned', sessionId, {
    schema: RENDITION_SCHEMA,
    id,
    sessionId,
    turnId: 't-1',
    createdAt: '2026-10-13T10:00:00.000Z',
    kind: 'image',
    purpose: 'background',
    scope: null,
    state: 'ready',
    prompt: {
      fragments: [{ id: 'place', text: 'a harbour', rank: 100, required: true }],
      separator: ', ',
      budget: { maxChars: null, usefulChars: null },
      text: 'a harbour',
      kept: ['place'],
      dropped: [],
      overCap: false,
    },
    asset: { path: `${id}.png`, mime: 'image/png', bytes: 7, digest: `sha256:${id}` },
    provenance: {
      at: '2026-10-13T10:00:02.000Z',
      binding: null,
      answeredAs: null,
      seed: null,
      workflow: {},
    },
    error: null,
    digest: `d-${id}`,
    ordering: 0,
    ...rest,
  });
  if (!pixels) return;
  const root = sessionAssetsRoot(layout, 'ned', sessionId);
  await ensureDirectory(root);
  await writeFileBytes(join(root, `${id}.png`), new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
}

/**
 * The story and its neighbours. Each object the session uses holds a picture
 * that must be offered and, where its kind has one, a picture whose role must
 * not be; each neighbour holds a background, which would be offered if the
 * route reached it at all.
 */
async function aStoryAndItsNeighbours() {
  const linked = {
    ...newLorebook('The Coast'),
    entries: [
      { ...newLoreEntry('The harbour'), media: [picture('m-harbour', 'reference')] },
      { ...newLoreEntry('The lighthouse'), media: [picture('m-light', 'map', 'The light, drawn')] },
    ],
  };
  const named = { ...newLorebook('Saltmarsh'), media: [picture('m-marsh', 'gallery')] };
  const treatment = {
    ...newTreatment('Low Tide'),
    lore: [{ ref: { id: linked.id, name: linked.name }, required: false }],
    media: [picture('m-tide', 'gallery', 'Low water'), picture('m-tide-face', 'expression')],
  };
  const setup = { ...newSetup('The Fixer’s Debt'), media: [picture('m-setup', 'background')] };
  const persona = {
    ...newActor('Mara'),
    media: [
      picture('m-mara-ref', 'reference', 'Mara’s cottage'),
      picture('m-mara-face', 'expression', 'smiling'),
      picture('m-mara-source', 'portrait-source'),
    ],
  };
  const vera = {
    ...newActor('Vera'),
    media: [picture('m-vera-gallery', 'gallery'), picture('m-vera-bg', 'background', 'Vera’s')],
  };
  const stranger = { ...newActor('A stranger'), media: [picture('m-stranger', 'reference')] };
  const world = { ...newWorld('Rain City'), media: [picture('m-world', 'gallery', 'The skyline')] };

  // The neighbours: one of each kind, each with a picture, none used.
  const neighbours = {
    treatment: { ...newTreatment('High Tide'), media: [picture('n-tide', 'background')] },
    book: { ...newLorebook('Inland'), media: [picture('n-book', 'background')] },
    setup: { ...newSetup('Another debt'), media: [picture('n-setup', 'background')] },
    actor: { ...newActor('Nobody here'), media: [picture('n-actor', 'background')] },
    world: { ...newWorld('Dry County'), media: [picture('n-world', 'background')] },
  };

  await created('lorebooks', linked);
  await created('lorebooks', named);
  await created('treatments', treatment);
  await created('setups', setup);
  await created('actors', persona);
  await created('actors', vera);
  await created('actors', stranger);
  await created('worlds', world);
  await created('treatments', neighbours.treatment);
  await created('lorebooks', neighbours.book);
  await created('setups', neighbours.setup);
  await created('actors', neighbours.actor);
  await created('worlds', neighbours.world);

  const started = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: {
      name: 'Night one',
      setup: setup.id,
      treatment: treatment.id,
      lore: [named.id],
      cast: { persona: persona.id, actors: [vera.id] },
    },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const sessionId = (started.body as { session: { id: string } }).session.id;

  // In the World by membership, and the stranger in the story by presence
  // alone — the two references a session holds that are not fields it names.
  const joined = await server.request({
    method: 'POST',
    url: `/api/library/worlds/${world.id}/members`,
    payload: { members: [{ schema: 'storyengine.session/1', id: sessionId, name: 'Night one' }] },
  });
  expect(joined.status, JSON.stringify(joined.body)).toBe(200);
  await put(sessionId, `se.presence#${stranger.id}`, true);

  return { sessionId, linked, named, treatment, setup, persona, vera, stranger, world };
}

describe('the pictures a session could stage', () => {
  it('offers a picture from each thing the session uses, and nothing from what it does not', async () => {
    const story = await aStoryAndItsNeighbours();
    const { sessionId } = story;

    // What this session made: two backgrounds with pixels, and three that
    // must not be offered — one whose file is gone, one that failed, and an
    // illustration, which is a moment rather than a place.
    await rendition(sessionId, 't-1.0', { createdAt: '2026-10-13T09:00:00.000Z' });
    await rendition(sessionId, 't-1.1', { createdAt: '2026-10-13T11:00:00.000Z' });
    await rendition(sessionId, 't-1.2', { pixels: false });
    await rendition(sessionId, 't-1.3', { state: 'failed', asset: null, pixels: false });
    await rendition(sessionId, 't-1.4', { purpose: 'illustration' });

    const rows = await candidates(sessionId);
    const summary = rows.map((row) => [
      row.source === null ? 'this session' : `${row.source.kind}: ${row.source.name}`,
      row.selection['from'] === 'rendition'
        ? row.selection['renditionId']
        : row.selection['mediaId'],
      row.label,
    ]);

    // In the order a person looks for one, and each object once.
    expect(summary).toEqual([
      ['this session', 't-1.1', null],
      ['this session', 't-1.0', null],
      ['treatments: Low Tide', 'm-tide', 'Low water'],
      ['setups: The Fixer’s Debt', 'm-setup', null],
      ['worlds: Rain City', 'm-world', 'The skyline'],
      ['lorebooks: The Coast', 'm-harbour', 'The harbour'],
      ['lorebooks: The Coast', 'm-light', 'The light, drawn'],
      ['lorebooks: Saltmarsh', 'm-marsh', null],
      ['actors: Mara', 'm-mara-ref', 'Mara’s cottage'],
      ['actors: Vera', 'm-vera-bg', 'Vera’s'],
      ['actors: A stranger', 'm-stranger', null],
    ]);

    // The selection is the channel's shape, whole — the client sends it back
    // unread, so it has to be writable as it stands.
    expect(rows[2]?.selection).toEqual({
      from: 'authored',
      kind: 'treatments',
      objectId: story.treatment.id,
      mediaId: 'm-tide',
    });
    expect(rows[0]?.selection).toEqual({ from: 'rendition', renditionId: 't-1.1' });
    expect(rows[0]?.url).toBe(`/api/sessions/${sessionId}/renditions/t-1.1/asset`);
    expect(rows[2]?.url).toBe(`/api/library/treatments/${story.treatment.id}/media/m-tide`);
    // Nothing is showing, so nothing is marked as showing.
    expect(rows.filter((row) => row.current)).toEqual([]);
  });

  it('marks the one the stage is showing', async () => {
    const { sessionId, world } = await aStoryAndItsNeighbours();
    await rendition(sessionId, 't-1.0');
    const chosen = { from: 'authored', kind: 'worlds', objectId: world.id, mediaId: 'm-world' };
    expect((await put(sessionId, 'se.backdrop', chosen)).effect.applied).toBe(true);

    const marked = (await candidates(sessionId)).filter((row) => row.current);
    expect(marked.map((row) => row.selection)).toEqual([chosen]);
  });

  /**
   * ***The thumbnail's address is the stage's.*** Written the way the dialog
   * writes it — staging off, then the selection, both a person's channel
   * writes — and read back off the session, the stage draws exactly the URL
   * the row was drawn from.
   */
  it('is staged from the address it was offered under', async () => {
    const { sessionId } = await aStoryAndItsNeighbours();
    await rendition(sessionId, 't-1.0');
    const rows = await candidates(sessionId);

    for (const row of [rows[0], rows[5]]) {
      if (row === undefined) throw new Error('fixture lost a row');
      expect((await put(sessionId, 'se.backdrop.on', false)).effect.applied).toBe(true);
      expect((await put(sessionId, 'se.backdrop', row.selection)).effect.applied).toBe(true);
      const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
      const stage = (
        read.body as { surfaces: { region: string; image?: { url: string } }[] }
      ).surfaces.filter((one) => one.region === 'stage');
      expect(stage.map((one) => one.image?.url)).toEqual([row.url]);
    }
  });

  it('answers not-found for a session whose mode stages no backdrop', async () => {
    const sessionId = await aFreeformSession();

    const response = await server.request({
      method: 'GET',
      url: `/api/sessions/${sessionId}/backdrops`,
    });
    expect(response.status).toBe(404);
    expect((response.body as { error: string }).error).toBe('no-such-channel');
  });
});

/**
 * ***Where the choice is offered*** — `renditions.backdrop` on the session
 * read, which the page draws *Set the scene* and *Choose a backdrop…* under.
 * It was present only once *Stage a backdrop* had been written on the path,
 * because a session's channel map starts empty; it is present now for every
 * session whose mode declares the switch, from the first moment, and still
 * absent for one that does not.
 */
describe('the backdrop’s controls on the session read', () => {
  async function backdropOf(sessionId: string): Promise<unknown> {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}` });
    expect(read.status).toBe(200);
    return (read.body as { renditions: Record<string, unknown> }).renditions['backdrop'];
  }

  it('are there in a Scene session before anybody has touched the switch', async () => {
    const started = await server.request({
      method: 'POST',
      url: '/api/sessions',
      payload: { name: 'Night one' },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const sessionId = (started.body as { session: { id: string } }).session.id;

    expect(await backdropOf(sessionId)).toBe(false);
    await put(sessionId, 'se.backdrop.on', true);
    expect(await backdropOf(sessionId)).toBe(true);
  });

  it('are not there for a mode with no backdrop', async () => {
    expect(await backdropOf(await aFreeformSession())).toBeUndefined();
  });
});

async function aFreeformSession(): Promise<string> {
  const started = await server.request({
    method: 'POST',
    url: '/api/sessions',
    payload: {
      name: 'Free',
      mode: 'storyengine.freeform',
      modeConfig: { premise: 'Rain.', difficulty: 'even', directedness: 'following' },
    },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  return (started.body as { session: { id: string } }).session.id;
}
