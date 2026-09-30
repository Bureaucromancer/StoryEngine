// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newTreatment, type ImportItemReport, type Turn } from '@storyengine/shared';

import { CHAT_IMPORT_MODE_ID } from '../mode-registry.js';
import { exportSession } from '../sessions/export.js';
import { listSessions } from '../sessions/store.js';
import type { SessionFile } from '../sessions/types.js';
import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { sillyTavernFixture } from './fixtures/test-sillytavern.js';
import { MemoryFileSource } from './memory-source.js';
import { readUpload } from './upload.js';
import { convertOne, sweep, type SweepRequest } from './sweep.js';

/**
 * ***A SillyTavern tree, swept, comes out with its chats as sessions*** —
 * [P14.8](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * The stage's claim is an ordering and a meeting: the session pass runs after
 * the library loop, so a chat resolves against the cards written beside it
 * moments earlier, through the import stamps those writes left. **Both halves
 * are asserted through what a person would find**: the session's cast holds
 * the Vera the sweep made, and the player's lines carry the persona the sweep
 * made — ids read from the same report, not assumed.
 *
 * The rest is the review's vocabulary for everything that is not a new
 * session, each of which is a row with a reason: already here, not chosen, not
 * taken by this kind of import, a group's own file, a file that will not read.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

const CHAT = 'chats/Vera Solano/2026-01-01.jsonl';

async function run(
  tree: Record<string, Uint8Array | string>,
  more: Partial<SweepRequest> = {},
): Promise<ImportItemReport[]> {
  const outcome = await sweep({
    library: server.services.library,
    sessions: server.services.sessions,
    handle: 'ned',
    files: new MemoryFileSource(tree),
    ...more,
  });
  if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
  return outcome.report.items;
}

function row(items: readonly ImportItemReport[], source: string): ImportItemReport {
  const found = items.find((item) => item.source === source);
  if (found === undefined) throw new Error(`no row for ${source}`);
  return found;
}

/**
 * A session as its export has it. The export types `session` as a record, since
 * it is a document another install reads; this reads back what this one wrote.
 */
async function exported(id: string | undefined): Promise<{ session: SessionFile; turns: Turn[] }> {
  const document = await exportSession(
    { sessions: server.services.sessions, build: null },
    'ned',
    id ?? '',
  );
  if (document === null) throw new Error(`no session ${String(id)}`);
  return { session: document.session as unknown as SessionFile, turns: document.turns };
}

describe('sweeping a tree of cards and chats', () => {
  it('makes a session whose cast is the swept card and whose player is the swept persona', async () => {
    const items = await run(sillyTavernFixture());

    const chat = row(items, CHAT);
    expect(chat.disposition).toBe('converted');
    expect(chat.notes.map((note) => note.key)).toContain('import.chat.imported');

    const vera = row(items, 'characters/Vera Solano.png').objectId;
    const inspector = row(items, 'User Avatars/inspector.png').objectId;
    const book = row(items, 'worlds/Rain City.json').objectId;
    expect(vera).toBeDefined();
    expect(inspector).toBeDefined();

    const { session, turns } = await exported(chat.objectId);
    expect(session.mode?.id).toBe(CHAT_IMPORT_MODE_ID);
    expect(session.cast?.actors).toEqual([vera]);
    expect(session.cast?.persona).toBe(inspector);
    expect(session.lore).toEqual([book]);

    // Every line the player wrote is theirs, as the persona the sweep made.
    const inputs = turns.flatMap((turn) => (turn.input == null ? [] : [turn.input]));
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((input) => input.actorId === inspector)).toBe(true);

    // The greeting and its alternate are two opening turns, the reply and its
    // other swipe two more ([P14 §2.3]); Vera speaks every reply, by id.
    expect(turns).toHaveLength(4);
    const speakers = turns.flatMap((turn) => turn.output?.messages ?? []);
    expect(speakers.length).toBeGreaterThan(0);
    expect(speakers.every((message) => message.speaker?.id === vera)).toBe(true);
  });

  /**
   * ***The card's scenario reaches the session*** — [P14.5c], the gap
   * [P14.12] found: the sweep made a treatment from Vera's `scenario` and the
   * chat's session linked none, so `se.treatment` was empty on every imported
   * chat while SillyTavern sends the scenario every turn. The treatment is
   * found by its provenance — the `scenario:` stamp the sweep gives it — and
   * the cast it names.
   */
  it('links the treatment the sweep made from the card’s scenario', async () => {
    const items = await run(sillyTavernFixture());
    const made = items.filter((item) =>
      item.notes.some((note) => note.key === 'import.card.treatmentCreated'),
    );
    expect(made).toHaveLength(1);

    const { session } = await exported(row(items, CHAT).objectId);
    expect(session.treatment).toBe(made[0]?.objectId);
    expect(row(items, CHAT).notes.map((note) => note.key)).not.toContain(
      'import.chat.scenarioAmbiguous',
    );
  });

  it('links the newer treatment when the card’s scenario was edited, and calls nothing ambiguous', async () => {
    const { [CHAT]: chat, ...cards } = sillyTavernFixture();
    const first = await run(cards);
    const old = first.find((item) =>
      item.notes.some((note) => note.key === 'import.card.treatmentCreated'),
    );
    // Vera's card again, its scenario rewritten: a second treatment names her,
    // and the first still does.
    const edited = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Vera Solano',
        description: 'A dock inspector who notices what the manifests leave out.',
        scenario: 'The rain has stopped at last, and the inspections are caught up.',
        first_mes: 'You again. Third time this week.',
      },
    };
    const second = await run({
      'characters/Vera Solano.png': withChunks(makePng(), [base64TextChunk('chara', edited)]),
    });
    const newer = second.find((item) =>
      item.notes.some((note) => note.key === 'import.card.treatmentCreated'),
    );
    expect(newer?.objectId).toBeDefined();
    expect(newer?.objectId).not.toBe(old?.objectId);

    const items = await run({ [CHAT]: chat ?? '' });
    const { session } = await exported(row(items, CHAT).objectId);
    expect(session.treatment).toBe(newer?.objectId);
    expect(row(items, CHAT).notes.map((note) => note.key)).not.toContain(
      'import.chat.scenarioAmbiguous',
    );
  });

  it('links no treatment a person wrote, even one naming the chat’s character', async () => {
    const { [CHAT]: chat, ...cards } = sillyTavernFixture();
    const first = await run(cards);
    const vera = row(first, 'characters/Vera Solano.png').objectId ?? '';
    // Vera's scenario treatment, gone; one written by hand naming her, in its place.
    const scenario = first.find((item) =>
      item.notes.some((note) => note.key === 'import.card.treatmentCreated'),
    );
    const url = `/api/library/treatments/${scenario?.objectId ?? ''}`;
    const held = await server.request({ method: 'GET', url });
    const removed = await server.request({
      method: 'DELETE',
      url,
      headers: { 'if-match': held.body.contentHash as string },
    });
    expect(removed.status, JSON.stringify(removed.body)).toBeLessThan(300);
    const handWritten = newTreatment('Harbour, by hand');
    handWritten.cast = [{ ref: { id: vera, name: 'Vera' }, billing: 'npc', note: '' }];
    const created = await server.request({
      method: 'POST',
      url: '/api/library/treatments',
      payload: handWritten,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const items = await run({ [CHAT]: chat ?? '' });
    const { session } = await exported(row(items, CHAT).objectId);
    expect(session.treatment).toBeUndefined();
  });

  it('resolves against a card walked after the chat, because the pass waits for the library', async () => {
    // The chat first in the walk, its card last: an importer that resolved as
    // it walked would find nobody.
    const { [CHAT]: chat, ...rest } = sillyTavernFixture();
    const items = await run({ [CHAT]: chat ?? '', ...rest });

    const { session } = await exported(row(items, CHAT).objectId);
    expect(session.cast?.actors).toEqual([row(items, 'characters/Vera Solano.png').objectId]);
  });

  it('refuses the same chat as already here on a second sweep, and writes no second session', async () => {
    const tree = sillyTavernFixture();
    await run(tree);
    const second = await run(tree);

    const chat = row(second, CHAT);
    expect(chat.disposition).toBe('unchanged');
    expect(chat.notes.map((note) => note.key)).toEqual(['import.chat.alreadyHere']);
    expect(await listSessions(server.services.sessions, 'ned')).toHaveLength(1);
  });

  it('extends the session a grown chat was imported into, and makes no second one', async () => {
    // [P14 §2.7], [P14.10a]: a chat that grew *extends* the session it came
    // from. Until P14.10a this row was `recorded` and the new turns were left
    // out; now they are appended to the same session, which the row names.
    const tree = sillyTavernFixture();
    const first = await run(tree);
    const more = [
      {
        name: 'The Inspector',
        is_user: true,
        is_system: false,
        send_date: '2026-01-01T10:02:00.000Z',
        mes: 'Then sign for this.',
        extra: {},
        force_avatar: '/thumbnail?type=persona&file=inspector.png',
      },
      {
        name: 'Vera Solano',
        is_user: false,
        is_system: false,
        send_date: '2026-01-01T10:02:30.000Z',
        mes: 'Not today.',
        gen_started: '2026-01-01T10:02:26.000Z',
        gen_finished: '2026-01-01T10:02:30.000Z',
        extra: {},
      },
    ];
    const grown = `${String(tree[CHAT])}${more.map((line) => JSON.stringify(line)).join('\n')}\n`;

    const second = await run({ ...tree, [CHAT]: grown });

    const chat = row(second, CHAT);
    expect(chat.disposition).toBe('converted');
    expect(chat.objectId).toBe(row(first, CHAT).objectId);
    // One round — the player's line and its reply — is one turn ([P14 §2.2]).
    expect(chat.notes[0]).toEqual({
      key: 'import.chat.extended',
      params: { name: '2026-01-01', count: 1 },
      level: 'info',
    });
    expect(await listSessions(server.services.sessions, 'ned')).toHaveLength(1);
    const { session, turns } = await exported(row(first, CHAT).objectId);
    expect(turns).toHaveLength(5);
    // Nobody played on here, so the session follows the source to its end.
    expect(turns.find((turn) => turn.id === session.headTurnId)?.output?.text).toBe('Not today.');
  });

  it('survives a chat that will not read, and says which', async () => {
    const items = await run({
      ...sillyTavernFixture(),
      'chats/Maris Okonkwo/broken.jsonl': 'this was never a chat',
    });

    const broken = row(items, 'chats/Maris Okonkwo/broken.jsonl');
    expect(broken.disposition).toBe('unrecognised');
    expect(broken.notes[0]?.key).toBe('import.file.refused');
    expect(row(items, CHAT).disposition).toBe('converted');
  });

  it('records a group’s own file whose chats did not come with it', async () => {
    // Read since P14.9, and with nothing to apply its roster to: said so,
    // rather than called converted into nothing.
    const items = await run({
      ...sillyTavernFixture(),
      'groups/1700000000000.json': JSON.stringify({ id: '1700000000000', members: [] }),
    });

    const group = row(items, 'groups/1700000000000.json');
    expect(group.disposition).toBe('recorded');
    expect(group.notes.map((note) => note.key)).toEqual(['import.chat.groupNoChats']);
  });
});

describe('a chat that is not made into a session', () => {
  it('is skipped, not unreadable, when the person did not choose chats', async () => {
    const items = await run(sillyTavernFixture(), { chats: false });

    const chat = row(items, CHAT);
    expect(chat.disposition).toBe('skipped');
    expect(chat.notes.map((note) => note.key)).toEqual(['import.chat.notChosen']);
    expect(await listSessions(server.services.sessions, 'ned')).toEqual([]);
  });

  it('is recorded, with a reason, by a sweep asked for library objects only', async () => {
    const outcome = await sweep({
      library: server.services.library,
      handle: 'ned',
      files: new MemoryFileSource(sillyTavernFixture()),
    });
    if (!outcome.ok) throw new Error(outcome.refusal);

    const chat = row(outcome.report.items, CHAT);
    expect(chat.disposition).toBe('recorded');
    expect(chat.notes.map((note) => note.key)).toEqual(['import.chat.notImportedHere']);
  });
});

describe('one chat file on its own', () => {
  it('becomes a session through the one-file engine the upload route uses', async () => {
    await run(sillyTavernFixture(), { chats: false });
    const bytes = new TextEncoder().encode(String(sillyTavernFixture()[CHAT]));

    const read = readUpload('Vera - 2026-01-01.jsonl', bytes);
    if (read.outcome !== 'candidate') throw new Error('not recognised as a chat');
    const [answer] = await convertOne(
      {
        library: server.services.library,
        sessions: server.services.sessions,
        handle: 'ned',
        files: new MemoryFileSource({ 'Vera - 2026-01-01.jsonl': bytes }),
      },
      read.candidate,
    );

    expect(answer?.disposition).toBe('converted');
    // No folder to say whose chat it is, so Vera is found by her name — and
    // the persona by the stamp the sweep left, which the line names exactly.
    const { session } = await exported(answer?.objectId);
    expect(session.name).toBe('Vera - 2026-01-01');
    expect(session.cast?.persona).not.toBeNull();
  });

  it('is a second session when the same chat already came in with its folder', async () => {
    // Pinned because the surfaces say it (`import.chats.copy`, the
    // `sessions.import` hint): a chat's family is keyed by its path, which is
    // `chats/<card>/<file>` in a folder and the bare file name on its own, so
    // the two doors do not recognise each other until [P14 §2.7]'s sync.
    await run(sillyTavernFixture());
    const bytes = new TextEncoder().encode(String(sillyTavernFixture()[CHAT]));

    const read = readUpload('2026-01-01.jsonl', bytes);
    if (read.outcome !== 'candidate') throw new Error('not recognised as a chat');
    const [answer] = await convertOne(
      {
        library: server.services.library,
        sessions: server.services.sessions,
        handle: 'ned',
        files: new MemoryFileSource({ '2026-01-01.jsonl': bytes }),
      },
      read.candidate,
    );

    expect(answer?.disposition).toBe('converted');
    expect(await listSessions(server.services.sessions, 'ned')).toHaveLength(2);
  });
});
