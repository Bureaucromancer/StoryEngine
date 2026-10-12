// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type Lorebook,
  type LoreEntry,
  newActor,
  newLorebook,
  newLoreEntry,
  newPreset,
  newSetup,
  newTreatment,
  newWorld,
  type PlotHook,
  type Setup,
  type TurnPreview,
  type World,
} from '@storyengine/shared';

import { registerMode } from '../mode-registry.js';
import { SETUP_MODE, SETUP_MODE_ID } from '../test-mode.js';
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

/**
 * ***A World with one Setup starts through it*** — **the owner's answer of
 * 2026-10-12**: *"Use the World's Setup when it holds exactly one."*
 *
 * [04 §9](../../../../docs/design/04-schemas.md) and
 * [03 §7.2](../../../../docs/design/03-data-model.md) say a World holding a
 * Setup is started *through* it — "that is the whole mechanism" — and
 * [P16.2] built the World start from its books and treatment and never read a
 * Setup member, which the P16 final audit recorded as open. These pin the
 * answer at the route: with no `setup` sent, a World's sole Setup is the
 * Setup **exactly as if the caller had named it**, the layering under it
 * unchanged — and every case the answer leaves alone (two Setups, a Setup
 * named outright, `null`, a lore list or treatment sent, a Setup gone) as the
 * route decides it.
 */
describe('starting in a World through its only Setup', () => {
  const hook = (id: string): PlotHook => ({
    id,
    title: id,
    premise: `the premise of ${id}`,
    magnitude: 'local',
    involves: [],
    weight: 1,
    delivery: 'guidance',
    once: true,
  });

  const goal = (id: string) => ({
    id,
    statement: `Do ${id}`,
    detail: null,
    visibility: 'player' as const,
    completion: { kind: 'narrative' as const },
    thenDefault: 'advance' as const,
    next: null,
  });

  const OPENINGS = {
    written: [
      { id: 'o-docks', label: 'The docks', text: 'Rain on the docks.' },
      { id: 'o-office', label: 'The office', text: 'The office, after hours.' },
    ],
    seeds: [],
    primaryWrittenId: 'o-office',
    primarySeedId: null,
  };

  const envelope = (object: { schema: string; id: string; name: string }) => ({
    schema: object.schema,
    id: object.id,
    name: object.name,
  });

  async function aSetup(name: string, over: Partial<Setup> = {}): Promise<Setup> {
    const made = { ...newSetup(name), ...over } as Setup;
    await created('setups', made);
    return made;
  }

  async function sessionFile(sessionId: string): Promise<any> {
    return JSON.parse(
      await readFile(
        join(server.dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json'),
        'utf8',
      ),
    );
  }

  async function turnsOf(sessionId: string): Promise<{ output: { text: string } }[]> {
    const read = await server.request({ method: 'GET', url: `/api/sessions/${sessionId}/turns` });
    return read.body.turns as { output: { text: string } }[];
  }

  /**
   * ***The World page's straight-in start*** — *Start a session in this world*
   * sends `{ world }` and nothing else (`StartInWorld`), and the server
   * supplies the Setup. Everything the Setup carries lands, as it would for a
   * Setup named outright; its treatment wins over the World's, and the
   * World's books follow the Setup's.
   */
  it('starts {world} alone through the World’s one Setup — everything the Setup carries lands', async () => {
    registerMode(SETUP_MODE);
    const vera = newActor('Vera');
    const marlow = newActor('Marlow');
    await created('actors', vera);
    await created('actors', marlow);
    const pack = newPreset('Rain noir');
    await created('presets', pack);
    const setupBook = bookOf('The Ledger', { keys: ['ledger'] });
    const worldBook = bookOf('The Docks', { keys: ['ferry'] });
    await created('lorebooks', setupBook);
    await created('lorebooks', worldBook);
    const setupTreatment = newTreatment('Rain City, noir');
    const worldTreatment = newTreatment('Rain City, farce');
    await created('treatments', setupTreatment);
    await created('treatments', worldTreatment);
    const setup = await aSetup('The Fixer’s Debt', {
      mode: { id: SETUP_MODE_ID, config: { premise: 'Rain.', difficulty: 'harsh' } },
      treatment: { id: setupTreatment.id, name: setupTreatment.name },
      preset: { id: pack.id, name: pack.name },
      cast: {
        personaOptions: [{ id: vera.id, name: 'Vera' }],
        partyDefault: [{ id: marlow.id, name: 'Marlow' }],
        narrator: null,
      },
      lore: [{ ref: { id: setupBook.id, name: setupBook.name }, required: false }],
      openings: OPENINGS,
      hooks: [hook('hook-debt')],
      goals: [goal('g-ledger')],
    });
    const world = worldOf('Rain City', [
      envelope(worldBook),
      envelope(setup),
      envelope(worldTreatment),
    ]);
    await created('worlds', world);

    const response = await start({ world: world.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const session = response.body.session;
    const stored = await sessionFile(session.id as string);

    // Recorded as a Setup named outright is: the copy on disk, the reply's
    // `{ id, name }`, and the Setup's name for a session given none.
    expect(stored.setup).toMatchObject({ id: setup.id, schema: 'storyengine.setup/1' });
    expect(session.setup).toEqual({ id: setup.id, name: 'The Fixer’s Debt' });
    expect(session.name).toBe('The Fixer’s Debt');
    // Its mode, and its answers held to the mode's declaration.
    expect(session.mode).toEqual({
      id: SETUP_MODE_ID,
      config: { premise: 'Rain.', difficulty: 'harsh' },
    });
    // Its preset, copied.
    expect(session.preset.id).toBe(pack.id);
    // Its persona and its party.
    expect(stored.cast).toEqual({ persona: vera.id, actors: [marlow.id] });
    // Its hooks, attributed to it, and its goals.
    expect(stored.hooks).toEqual([
      {
        hook: expect.objectContaining({ id: 'hook-debt' }),
        source: { kind: 'setup', id: setup.id },
      },
    ]);
    expect((stored.goals as { id: string }[]).map((one) => one.id)).toEqual(['g-ledger']);
    // Its primary opening, as the first turn.
    const turns = await turnsOf(session.id as string);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.output.text).toBe('The office, after hours.');
    // The layering under it: the Setup's treatment, not the World's; the
    // World's books after the Setup's.
    expect(stored.treatment).toBe(setupTreatment.id);
    expect(stored.lore).toEqual([setupBook.id, worldBook.id]);

    // And the session joined the World, as every World start does.
    const read = await server.request({ method: 'GET', url: `/api/library/worlds/${world.id}` });
    expect((read.body.object.contents as { id: string }[]).map((one) => one.id)).toContain(
      session.id,
    );
  });

  it('uses the World’s treatment under its Setup only when the Setup names none', async () => {
    const worldTreatment = newTreatment('Rain City, farce');
    await created('treatments', worldTreatment);
    const setup = await aSetup('No treatment of its own');
    const world = worldOf('Rain City', [envelope(setup), envelope(worldTreatment)]);
    await created('worlds', world);

    const response = await start({ world: world.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const stored = await sessionFile(response.body.session.id as string);
    expect(stored.setup.id).toBe(setup.id);
    expect(stored.treatment).toBe(worldTreatment.id);
  });

  /** The treatment's rule: the first of several would be the server choosing a game. */
  it('starts through neither of two Setups', async () => {
    const book = bookOf('The Docks', { keys: ['ferry'] });
    await created('lorebooks', book);
    const one = await aSetup('One way in', { openings: OPENINGS });
    const two = await aSetup('Another way in');
    const world = worldOf('Rain City', [envelope(book), envelope(one), envelope(two)]);
    await created('worlds', world);

    const response = await start({ world: world.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const stored = await sessionFile(response.body.session.id as string);
    expect(stored.setup).toBeUndefined();
    expect(stored.lore).toEqual([book.id]);
    expect(await turnsOf(response.body.session.id as string)).toEqual([]);
  });

  /** A Setup named outright is the caller's; the World adds under it as it always did. */
  it('lets a Setup the caller names win over the World’s own', async () => {
    const worldBook = bookOf('The Docks', { keys: ['ferry'] });
    await created('lorebooks', worldBook);
    const worldTreatment = newTreatment('Rain City, farce');
    await created('treatments', worldTreatment);
    const theWorlds = await aSetup('The World’s', { openings: OPENINGS });
    const theirs = await aSetup('Their own');
    const world = worldOf('Rain City', [
      envelope(worldBook),
      envelope(theWorlds),
      envelope(worldTreatment),
    ]);
    await created('worlds', world);

    const response = await start({ world: world.id, setup: theirs.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const stored = await sessionFile(response.body.session.id as string);
    expect(stored.setup.id).toBe(theirs.id);
    expect(stored.name).toBe('Their own');
    // Not the World's Setup's opening: theirs carries none.
    expect(await turnsOf(response.body.session.id as string)).toEqual([]);
    expect(stored.lore).toEqual([worldBook.id]);
    expect(stored.treatment).toBe(worldTreatment.id);
  });

  /**
   * ***Prefill, never binding***, one rung down ([00 §3.1]): the caller's `lore`
   * and `treatment` override the World's Setup's as they override a named
   * one's — `null` included — while the Setup is still what the session starts
   * through.
   */
  it('lets the caller’s lore and treatment override the World’s Setup', async () => {
    const setupBook = bookOf('The Ledger', { keys: ['ledger'] });
    const worldBook = bookOf('The Docks', { keys: ['ferry'] });
    const own = bookOf('My notes', { keys: ['notes'] });
    await created('lorebooks', setupBook);
    await created('lorebooks', worldBook);
    await created('lorebooks', own);
    const setupTreatment = newTreatment('Rain City, noir');
    const other = newTreatment('Somewhere else');
    await created('treatments', setupTreatment);
    await created('treatments', other);
    const setup = await aSetup('The Fixer’s Debt', {
      treatment: { id: setupTreatment.id, name: setupTreatment.name },
      lore: [{ ref: { id: setupBook.id, name: setupBook.name }, required: false }],
    });
    const world = worldOf('Rain City', [envelope(worldBook), envelope(setup)]);
    await created('worlds', world);

    const chosen = await start({ world: world.id, lore: [own.id], treatment: other.id });
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(201);
    const stored = await sessionFile(chosen.body.session.id as string);
    expect(stored.setup.id).toBe(setup.id);
    expect(stored.lore).toEqual([own.id]);
    expect(stored.treatment).toBe(other.id);

    const none = await start({ world: world.id, lore: [], treatment: null });
    expect(none.status, JSON.stringify(none.body)).toBe(201);
    const bare = await sessionFile(none.body.session.id as string);
    expect(bare.setup.id).toBe(setup.id);
    expect(bare.lore).toEqual([]);
    expect(bare.treatment).toBeUndefined();
  });

  /**
   * ***`setup: null` is "none", said out loud*** — `treatment: null`'s reason:
   * the session form's *None* beside a World with one Setup has to be sendable,
   * or the World would choose for a person who chose otherwise.
   */
  it('starts without the World’s Setup when the caller sends null', async () => {
    const book = bookOf('The Docks', { keys: ['ferry'] });
    await created('lorebooks', book);
    const setup = await aSetup('The Fixer’s Debt', { openings: OPENINGS });
    const world = worldOf('Rain City', [envelope(book), envelope(setup)]);
    await created('worlds', world);

    const response = await start({ world: world.id, setup: null });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const stored = await sessionFile(response.body.session.id as string);
    expect(stored.setup).toBeUndefined();
    expect(stored.lore).toEqual([book.id]);
    expect(await turnsOf(response.body.session.id as string)).toEqual([]);

    // And beside no World it asks for nothing, as absent does.
    const plain = await start({ setup: null });
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
  });

  /**
   * ***An opening sent with a World alone*** is its Setup's — a written one by
   * id, *start cold* as `null` — and refused as it always was when the World
   * supplies no Setup to take it from, or the Setup does not hold it.
   */
  it('takes an opening sent with a World alone from the World’s Setup', async () => {
    const setup = await aSetup('The Fixer’s Debt', { openings: OPENINGS });
    const world = worldOf('Rain City', [envelope(setup)]);
    await created('worlds', world);

    const docks = await start({ world: world.id, opening: 'o-docks' });
    expect(docks.status, JSON.stringify(docks.body)).toBe(201);
    expect((await turnsOf(docks.body.session.id as string))[0]?.output.text).toBe(
      'Rain on the docks.',
    );

    const cold = await start({ world: world.id, opening: null });
    expect(cold.status).toBe(201);
    expect(await turnsOf(cold.body.session.id as string)).toEqual([]);

    const missing = await start({ world: world.id, opening: 'o-nowhere' });
    expect(missing.status).toBe(422);
    expect(missing.body.error).toBe('unknown-setup-opening');

    const bare = worldOf('No setup', []);
    await created('worlds', bare);
    const before = await server.request({ method: 'GET', url: '/api/sessions' });
    const orphan = await start({ world: bare.id, opening: 'o-docks' });
    expect(orphan.status).toBe(422);
    expect(orphan.body.error).toBe('unknown-setup-opening');
    // Refused before anything was made.
    const after = await server.request({ method: 'GET', url: '/api/sessions' });
    expect(after.body.sessions).toHaveLength((before.body.sessions as unknown[]).length);
  });

  /**
   * ***A sole Setup that no longer resolves*** — decided with the owner's
   * answer, the treatment's rule mirrored (`worldContribution` says why): still
   * the World's only Setup, so nothing else is promoted in its place, and
   * started **without** rather than refused, since a session holds a copy of
   * its Setup and there is nothing to copy. The World's books and treatment
   * still land, and the session still joins it.
   */
  it('starts without a sole Setup the library no longer holds, and refuses nothing', async () => {
    const book = bookOf('The Docks', { keys: ['ferry'] });
    await created('lorebooks', book);
    const treatment = newTreatment('Rain City, noir');
    await created('treatments', treatment);
    const gone = {
      schema: 'storyengine.setup/1',
      id: '0199c000-0000-7000-8000-0000000000aa',
      name: 'Gone',
    };
    const world = worldOf('Rain City', [envelope(book), gone, envelope(treatment)]);
    await created('worlds', world);

    const response = await start({ world: world.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const sessionId = response.body.session.id as string;
    const stored = await sessionFile(sessionId);
    expect(stored.setup).toBeUndefined();
    expect(stored.lore).toEqual([book.id]);
    expect(stored.treatment).toBe(treatment.id);
    const read = await server.request({ method: 'GET', url: `/api/library/worlds/${world.id}` });
    // The dangling member is still the World's, where its page marks it Missing.
    expect((read.body.object.contents as { id: string }[]).map((one) => one.id)).toEqual([
      book.id,
      gone.id,
      treatment.id,
      sessionId,
    ]);

    // An opening sent beside it has no Setup to come from, as for a World with none.
    const opening = await start({ world: world.id, opening: 'o-docks' });
    expect(opening.status).toBe(422);
    expect(opening.body.error).toBe('unknown-setup-opening');
  });

  /** Counted as members, as treatments are: one gone of two does not make the other *the only one*. */
  it('does not promote the other of two Setups when one is gone', async () => {
    const present = await aSetup('Still here', { openings: OPENINGS });
    const gone = {
      schema: 'storyengine.setup/1',
      id: '0199c000-0000-7000-8000-0000000000ab',
      name: 'Gone',
    };
    const world = worldOf('Rain City', [gone, envelope(present)]);
    await created('worlds', world);

    const response = await start({ world: world.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await sessionFile(response.body.session.id as string)).setup).toBeUndefined();
  });

  /**
   * ***Each member once***: a hand-edited World naming its one Setup — or its
   * one treatment — twice still holds one, as the session form reads it.
   */
  it('reads a member named twice as one', async () => {
    const setup = await aSetup('The Fixer’s Debt');
    const treatment = newTreatment('Rain City, noir');
    await created('treatments', treatment);
    const world = worldOf('Rain City', [
      envelope(setup),
      envelope(setup),
      envelope(treatment),
      envelope(treatment),
    ]);
    await created('worlds', world);

    const response = await start({ world: world.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const stored = await sessionFile(response.body.session.id as string);
    expect(stored.setup.id).toBe(setup.id);
    expect(stored.treatment).toBe(treatment.id);
  });

  /**
   * ***Held to what a named Setup is held to*** — every refusal the route makes
   * of a Setup, with its code: a mode this build does not have, and answers the
   * mode would not accept. *As if the caller had named it* cuts both ways.
   */
  it('refuses the World’s Setup for what it would refuse a named one', async () => {
    registerMode(SETUP_MODE);
    const unknownMode = await aSetup('From a newer build', {
      mode: { id: 'storyengine.not-installed', config: null },
    });
    const strange = worldOf('Strange', [envelope(unknownMode)]);
    await created('worlds', strange);
    const refused = await start({ world: strange.id });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe('unknown-mode');

    const misfit = await aSetup('Impossible', {
      mode: { id: SETUP_MODE_ID, config: { premise: 'Rain.', difficulty: 'impossible' } },
    });
    const hard = worldOf('Hard', [envelope(misfit)]);
    await created('worlds', hard);
    const invalid = await start({ world: hard.id });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error).toBe('setup-invalid');
  });
});
