// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readFile, rm } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7, type ImportItemReport, type Turn } from '@storyengine/shared';

import { SE_PRESENCE } from '../sessions/cast.js';
import { channelKey } from '../sessions/channels.js';
import { exportSession } from '../sessions/export.js';
import { importSession } from '../sessions/import.js';
import {
  appendTurnToSession,
  deleteSession,
  listSessions,
  readSession,
  reconcileHandEdits,
  reindexSession,
  replayChannels,
  sessionFilePath,
  sessionRoot,
  setCast,
} from '../sessions/store.js';
import type { SessionFile } from '../sessions/types.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import { sillyTavernFixture } from './fixtures/test-sillytavern.js';
import { MemoryFileSource } from './memory-source.js';
import { sweep } from './sweep.js';

/**
 * ***Sync: a re-import extends the session it came from*** —
 * [P13.10a](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * [P13 §2.7](../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
 *
 * The stage's *Ends at*, first and as a person would find it: a chat imported,
 * then grown in SillyTavern by three messages, an edit and a new branch, and
 * swept again — the session gains exactly those turns, one of them a sibling
 * and one of them on a new ref, and a session played on here in between keeps
 * its head. Then each of §2.7's rules on its own: hidden flags three ways,
 * mutes as effects the head cache agrees with, an unchanged chat left
 * byte-for-byte alone, a round that grew in place (§2.7's open case, decided
 * here), and a session imported before this stage found by its turns.
 */

let server: TestServer;

beforeEach(async () => {
  server = await makeTestServer();
  await setUpAdmin(server);
});

afterEach(async () => {
  await server.dispose();
});

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

const at = (minute: number): string => new Date(Date.UTC(2026, 1, 1, 10, minute)).toISOString();

type Line = Record<string, unknown>;

function header(metadata: Record<string, unknown> = {}): Line {
  return {
    user_name: 'unused',
    character_name: 'unused',
    chat_metadata: { integrity: 'aaaaaaaa-0000-4000-8000-000000000002', ...metadata },
  };
}

function player(minute: number, mes: string): Line {
  return {
    name: 'The Inspector',
    is_user: true,
    is_system: false,
    send_date: at(minute),
    mes,
    extra: {},
    force_avatar: '/thumbnail?type=persona&file=inspector.png',
  };
}

function vera(minute: number, mes: string, options: { hidden?: boolean } = {}): Line {
  return {
    name: 'Vera Solano',
    is_user: false,
    is_system: options.hidden === true,
    send_date: at(minute),
    mes,
    gen_started: at(minute),
    extra: {},
  };
}

function member(
  card: string,
  name: string,
  minute: number,
  mes: string,
  batch: number,
  more: Line = {},
): Line {
  return {
    ...more,
    name,
    is_user: false,
    is_system: false,
    send_date: at(minute),
    mes,
    original_avatar: card,
    gen_started: at(minute),
    extra: { gen_id: batch },
  };
}

function jsonl(lines: readonly Line[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

const FOLDER = 'chats/Vera Solano';
const ROOT = `${FOLDER}/Vera - 2026-02-01.jsonl`;
const BRANCH = `${FOLDER}/Vera - 2026-02-01 - Branch #1.jsonl`;

const GREETING = vera(0, 'You again.');
const ASKED = [player(1, 'Manifests?'), vera(2, 'Define unusual.')];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function run(tree: Record<string, Uint8Array | string>): Promise<ImportItemReport[]> {
  const outcome = await sweep({
    library: server.services.library,
    sessions: server.services.sessions,
    handle: 'ned',
    files: new MemoryFileSource(tree),
  });
  if (!outcome.ok) throw new Error(`refused: ${outcome.refusal}`);
  return outcome.report.items;
}

function row(items: readonly ImportItemReport[], source: string): ImportItemReport {
  const found = items.find((item) => item.source === source);
  if (found === undefined) throw new Error(`no row for ${source}`);
  return found;
}

async function exported(id: string | undefined): Promise<{ session: SessionFile; turns: Turn[] }> {
  const document = await exportSession(
    { sessions: server.services.sessions, build: null },
    'ned',
    id ?? '',
  );
  if (document === null) throw new Error(`no session ${String(id)}`);
  return { session: document.session as unknown as SessionFile, turns: document.turns };
}

function pathTo(turns: readonly Turn[], id: string | null): Turn[] {
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const path: Turn[] = [];
  for (let turn = byId.get(id ?? ''); turn !== undefined;) {
    path.unshift(turn);
    turn = turn.parentTurnId === null ? undefined : byId.get(turn.parentTurnId);
  }
  return path;
}

const said = (turn: Turn | undefined): string =>
  (turn?.output?.messages ?? []).map((message) => message.text).join(' | ');

const keys = (item: ImportItemReport): string[] => item.notes.map((note) => note.key);

function note(item: ImportItemReport, key: string): ImportItemReport['notes'][number] | undefined {
  return item.notes.find((one) => one.key === key);
}

/** A turn played here, on the head, as the runner would write one: no `foreign`. */
async function playOn(sessionId: string, parent: string | null): Promise<Turn> {
  const turn: Turn = {
    id: uuidv7(),
    sessionId,
    parentTurnId: parent,
    createdAt: new Date().toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'do', text: 'I read the manifest aloud.', raw: '' },
    output: { text: 'She listens.' },
    effects: [],
    tape: [],
  };
  await appendTurnToSession(server.services.sessions, 'ned', sessionId, turn);
  return turn;
}

// ---------------------------------------------------------------------------
// The Ends at
// ---------------------------------------------------------------------------

/** The chat as first imported: a greeting and two rounds. */
function before(): Record<string, string> {
  return {
    [ROOT]: jsonl([header(), GREETING, ...ASKED, player(3, 'Crates.'), vera(4, 'Sealed.')]),
  };
}

/**
 * The chat afterwards, in SillyTavern: the last reply **edited**, then **three
 * messages** after it, and a **new branch** from the first question on.
 */
function after(): Record<string, string> {
  return {
    [ROOT]: jsonl([
      header(),
      GREETING,
      ...ASKED,
      player(3, 'Crates.'),
      vera(4, 'Sealed, every one.'),
      player(5, 'Who sealed them?'),
      vera(6, 'The harbourmaster.'),
      player(7, 'Fetch him.'),
    ]),
    [BRANCH]: jsonl([
      header({ main_chat: 'Vera - 2026-02-01' }),
      GREETING,
      ...ASKED,
      player(8, 'Anything else?'),
      vera(9, 'No.'),
    ]),
  };
}

describe('a chat grown in its source, imported again', () => {
  it('gains exactly the new turns, one new sibling and one new ref, and follows the source', async () => {
    const first = await run({ ...sillyTavernFixture(), ...before() });
    const sessionId = row(first, ROOT).objectId;
    const was = await exported(sessionId);
    expect(was.turns).toHaveLength(3);

    const second = await run({ ...sillyTavernFixture(), ...after() });

    const root = row(second, ROOT);
    expect(root.disposition).toBe('converted');
    expect(root.objectId).toBe(sessionId);
    // The edited round, the two rounds after it, and the branch's round.
    expect(note(root, 'import.chat.extended')?.params).toEqual({
      name: 'Vera - 2026-02-01',
      count: 4,
    });
    expect(note(root, 'import.chat.syncBranches')?.params).toEqual({ count: 1 });
    // The round as it was before the edit is still here, and said to be.
    expect(note(root, 'import.chat.notInSource')?.params).toEqual({ count: 1 });
    expect(keys(root)).not.toContain('import.chat.syncPlayedOn');
    expect(row(second, BRANCH).objectId).toBe(sessionId);
    expect(await listSessions(server.services.sessions, 'ned')).toHaveLength(2);

    const { session, turns } = await exported(sessionId);
    const added = turns.filter((turn) => !was.turns.some((old) => old.id === turn.id));
    expect(added.map(said).sort()).toEqual(
      ['Sealed, every one.', 'The harbourmaster.', '', 'No.'].sort(),
    );
    // Nothing that was here changed, byte for byte.
    for (const old of was.turns) {
      expect(turns.find((turn) => turn.id === old.id)).toEqual(old);
    }

    // One new sibling: the edit, beside the round it edited.
    const [greeting, asked, sealed] = pathTo(was.turns, was.session.headTurnId);
    const edited = added.find((turn) => said(turn) === 'Sealed, every one.');
    expect(edited?.parentTurnId).toBe(asked?.id);
    expect(turns.filter((turn) => turn.parentTurnId === asked?.id)).toHaveLength(3);
    expect(sealed).toBeDefined();
    expect(greeting).toBeDefined();

    // One new ref, and the root chat's ref moved to where the chat now ends.
    const refs = session.branchRefs ?? [];
    expect(refs).toHaveLength(2);
    expect(refs[0]?.id).toBe(was.session.branchRefs?.[0]?.id);
    expect(refs[0]?.headTurnId).toBe(session.headTurnId);
    expect(said(turns.find((turn) => turn.id === refs[1]?.headTurnId))).toBe('No.');

    // Nobody played on here, so the head followed the source.
    const head = turns.find((turn) => turn.id === session.headTurnId);
    expect(head?.input?.text).toBe('Fetch him.');
    expect(session.lastSelectedChild?.[asked?.id ?? '']).toBe(edited?.id);
    expect(await reconcileHandEdits(server.services.sessions, 'ned', sessionId ?? '')).toEqual([]);
  });

  it('keeps the head, and the path to it, of a session played on here', async () => {
    const first = await run({ ...sillyTavernFixture(), ...before() });
    const sessionId = row(first, ROOT).objectId ?? '';
    const was = await exported(sessionId);
    const played = await playOn(sessionId, was.session.headTurnId);

    const second = await run({ ...sillyTavernFixture(), ...after() });

    const root = row(second, ROOT);
    expect(note(root, 'import.chat.extended')?.params).toMatchObject({ count: 4 });
    expect(note(root, 'import.chat.syncPlayedOn')?.params).toEqual({ chat: 'Vera - 2026-02-01' });

    const { session, turns } = await exported(sessionId);
    expect(session.headTurnId).toBe(played.id);
    // The turn played here was never compared with anything, and is still here.
    expect(turns.find((turn) => turn.id === played.id)).toBeDefined();
    // *Forward* from the fork the edit made still leads to where the person is.
    const [, asked, sealed] = pathTo(was.turns, was.session.headTurnId);
    expect(session.lastSelectedChild?.[asked?.id ?? '']).toBe(sealed?.id);
    // The source's chat moved its ref, so the new messages are one click away.
    const rootRef = session.branchRefs?.[0];
    expect(turns.find((turn) => turn.id === rootRef?.headTurnId)?.input?.text).toBe('Fetch him.');
  });

  it('writes nothing for a chat unchanged since, and says unchanged', async () => {
    const tree = { ...sillyTavernFixture(), ...before() };
    const first = await run(tree);
    const sessionId = row(first, ROOT).objectId ?? '';
    const file = sessionFilePath(server.services.sessions.layout, 'ned', sessionId);
    const bytes = await readFile(file, 'utf8');

    const second = await run(tree);

    const root = row(second, ROOT);
    expect(root.disposition).toBe('unchanged');
    expect(root.objectId).toBe(sessionId);
    expect(keys(root)).toEqual(['import.chat.alreadyHere']);
    expect(await readFile(file, 'utf8')).toBe(bytes);
  });

  it('does not put back a member removed from the cast here', async () => {
    const tree = { ...sillyTavernFixture(), ...before() };
    const first = await run(tree);
    const sessionId = row(first, ROOT).objectId ?? '';
    const context = server.services.sessions;
    const here = await readSession(context, 'ned', sessionId);
    expect(here?.cast?.actors).toHaveLength(1);
    await setCast(context, 'ned', sessionId, { persona: here?.cast?.persona ?? null, actors: [] });

    const second = await run(tree);
    const root = row(second, ROOT);
    expect(root.disposition).toBe('unchanged');
    expect(keys(root)).not.toContain('import.chat.syncCast');
    expect((await readSession(context, 'ned', sessionId))?.cast?.actors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A session restored from its own export, then synced
// ---------------------------------------------------------------------------

describe('a session restored from an export of an imported chat', () => {
  it('is synced without moving the person or undoing a hide made before the export', async () => {
    const first = await run({ ...sillyTavernFixture(), ...before() });
    const sessionId = row(first, ROOT).objectId ?? '';
    const was = await exported(sessionId);
    const played = await playOn(sessionId, was.session.headTurnId);
    const [greeting] = pathTo(was.turns, was.session.headTurnId);
    const context = server.services.sessions;
    const here = await readSession(context, 'ned', sessionId);
    await writeJsonAtomic(sessionFilePath(context.layout, 'ned', sessionId), {
      ...here,
      hidden: { ...(here?.hidden ?? {}), [greeting?.id ?? '']: true },
    });

    // Exported, deleted, and loaded back through the export door, as a backup
    // restored to the same account would be.
    const document = await exportSession({ sessions: context, build: null }, 'ned', sessionId);
    expect((await deleteSession(context, 'ned', sessionId)).kind).toBe('deleted');
    const restored = await importSession({ sessions: context }, 'ned', document);
    if (!restored.ok) throw new Error(`refused: ${restored.reason}`);

    const second = await run({ ...sillyTavernFixture(), ...after() });

    const root = row(second, ROOT);
    expect(root.objectId).toBe(restored.sessionId);
    expect(note(root, 'import.chat.extended')?.params).toMatchObject({ count: 4 });
    expect(note(root, 'import.chat.syncPlayedOn')).toBeDefined();
    const { session } = await exported(restored.sessionId);
    expect(session.headTurnId).toBe(played.id);
    expect(session.hidden?.[greeting?.id ?? '']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2.7's open case, decided: a round that grew is a sibling, and the head moves
// ---------------------------------------------------------------------------

describe('a round that grew in its source', () => {
  it('is the round as it now stands, beside the round as it was, and the head moves onto it', async () => {
    const trailing = { [ROOT]: jsonl([header(), GREETING, ...ASKED, player(3, 'Crates?')]) };
    const answered = {
      [ROOT]: jsonl([header(), GREETING, ...ASKED, player(3, 'Crates?'), vera(4, 'Sealed.')]),
    };
    const first = await run({ ...sillyTavernFixture(), ...trailing });
    const sessionId = row(first, ROOT).objectId;
    const was = await exported(sessionId);

    const second = await run({ ...sillyTavernFixture(), ...answered });

    const root = row(second, ROOT);
    expect(note(root, 'import.chat.extended')?.params).toMatchObject({ count: 1 });
    expect(note(root, 'import.chat.roundGrew')?.params).toEqual({ count: 1 });
    // The grown round is named for what it is, and not also called deleted.
    expect(keys(root)).not.toContain('import.chat.notInSource');

    const { session, turns } = await exported(sessionId);
    const asked = turns.find((turn) => turn.id === was.session.headTurnId);
    const grown = turns.find((turn) => turn.id === session.headTurnId);
    expect(grown?.parentTurnId).toBe(asked?.parentTurnId);
    expect(grown?.input?.text).toBe('Crates?');
    expect(said(grown)).toBe('Sealed.');
    expect(asked).toBeDefined();

    // And the same again says unchanged, without calling the old round deleted.
    const third = await run({ ...sillyTavernFixture(), ...answered });
    expect(row(third, ROOT).disposition).toBe('unchanged');
    expect(keys(row(third, ROOT))).toEqual(['import.chat.alreadyHere']);
  });
});

// ---------------------------------------------------------------------------
// Hidden flags, three ways
// ---------------------------------------------------------------------------

describe('hidden flags', () => {
  it('takes an unhide from the source and keeps a hide made here', async () => {
    const hidden = {
      [ROOT]: jsonl([
        header(),
        GREETING,
        player(1, 'Manifests?'),
        vera(2, 'Define unusual.', { hidden: true }),
        player(3, 'Crates.'),
        vera(4, 'Sealed.'),
      ]),
    };
    const shown = {
      [ROOT]: jsonl([
        header(),
        GREETING,
        player(1, 'Manifests?'),
        vera(2, 'Define unusual.'),
        player(3, 'Crates.'),
        vera(4, 'Sealed.'),
      ]),
    };
    const first = await run({ ...sillyTavernFixture(), ...hidden });
    const sessionId = row(first, ROOT).objectId ?? '';
    const was = await exported(sessionId);
    const [greeting, asked] = pathTo(was.turns, was.session.headTurnId);
    expect(was.session.hidden?.[asked?.id ?? '']).toEqual([0]);

    // A hide made here, on a turn the source shows, as the hide gesture writes it.
    const context = server.services.sessions;
    const here = await readSession(context, 'ned', sessionId);
    await writeJsonAtomic(sessionFilePath(context.layout, 'ned', sessionId), {
      ...here,
      hidden: { ...(here?.hidden ?? {}), [greeting?.id ?? '']: true },
    });

    const second = await run({ ...sillyTavernFixture(), ...shown });

    const root = row(second, ROOT);
    expect(root.disposition).toBe('converted');
    expect(note(root, 'import.chat.extended')?.params).toMatchObject({ count: 0 });
    expect(note(root, 'import.chat.syncHidden')?.params).toEqual({ count: 1 });
    const { session } = await exported(sessionId);
    expect(session.hidden).toEqual({ [greeting?.id ?? '']: true });
  });
});

// ---------------------------------------------------------------------------
// Mutes, as effects the head cache agrees with
// ---------------------------------------------------------------------------

const LUND = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: { name: 'Lund Harrow', description: 'The harbourmaster.', first_mes: 'Papers.' },
};
const GROUP_ID = '1700000000000';
const GROUP_FILE = `groups/${GROUP_ID}.json`;
const GROUP_CHAT = `group chats/${GROUP_ID}.jsonl`;

function group(muted: string[], more: Line[] = []): Record<string, Uint8Array | string> {
  return {
    'characters/Lund Harrow.png': withChunks(makePng(), [base64TextChunk('chara', LUND)]),
    [GROUP_FILE]: JSON.stringify({
      id: GROUP_ID,
      name: 'Night Crossing',
      members: ['Maris Okonkwo.png', 'Vera Solano.png', 'Lund Harrow.png'],
      disabled_members: muted,
      activation_strategy: 1,
      chats: [GROUP_ID],
      chat_id: GROUP_ID,
    }),
    [GROUP_CHAT]: jsonl([
      header(),
      player(1, 'Two tickets.'),
      member('Vera Solano.png', 'Vera Solano', 2, 'Who is the second for?', 111),
      member('Maris Okonkwo.png', 'Maris Okonkwo', 3, 'Cash only.', 111),
      ...more,
    ]),
  };
}

describe('a group’s mutes', () => {
  it('come across onto the new turns, and the head cache agrees with the replay', async () => {
    const first = await run({ ...sillyTavernFixture(), ...group(['Lund Harrow.png']) });
    const sessionId = row(first, GROUP_CHAT).objectId ?? '';
    const lund = row(first, 'characters/Lund Harrow.png').objectId ?? '';
    const maris = row(first, 'characters/Maris Okonkwo.png').objectId ?? '';

    const second = await run({
      ...sillyTavernFixture(),
      ...group(
        ['Maris Okonkwo.png'],
        [
          player(4, 'A friend.'),
          member('Vera Solano.png', 'Vera Solano', 5, 'Friends pay double.', 222),
        ],
      ),
    });

    const chat = row(second, GROUP_CHAT);
    expect(chat.objectId).toBe(sessionId);
    expect(note(chat, 'import.chat.syncMutes')?.params).toEqual({ count: 2 });
    expect(keys(row(second, GROUP_FILE))).toEqual(['import.chat.groupSynced']);

    const { session, turns } = await exported(sessionId);
    const path = pathTo(turns, session.headTurnId);
    expect(session.channels[channelKey(SE_PRESENCE, maris)]?.value).toBe(false);
    expect(session.channels[channelKey(SE_PRESENCE, lund)]?.value).toBe(true);
    expect(session.channels).toEqual(replayChannels(path));
    expect(await reconcileHandEdits(server.services.sessions, 'ned', sessionId)).toEqual([]);
  });

  it('wait, and say so, when nothing new came to carry them', async () => {
    const first = await run({ ...sillyTavernFixture(), ...group(['Lund Harrow.png']) });
    const sessionId = row(first, GROUP_CHAT).objectId ?? '';

    const second = await run({ ...sillyTavernFixture(), ...group([]) });

    const chat = row(second, GROUP_CHAT);
    expect(note(chat, 'import.chat.mutesWaiting')).toEqual({
      key: 'import.chat.mutesWaiting',
      params: { count: 1 },
      level: 'warn',
    });
    // And the next sync that brings a message carries it.
    const third = await run({
      ...sillyTavernFixture(),
      ...group([], [player(4, 'A friend.')]),
    });
    expect(note(row(third, GROUP_CHAT), 'import.chat.syncMutes')?.params).toEqual({ count: 1 });
    const { session } = await exported(sessionId);
    const lund = row(first, 'characters/Lund Harrow.png').objectId ?? '';
    expect(session.channels[channelKey(SE_PRESENCE, lund)]?.value).toBe(true);
  });

  it('reach a branch that grows at a later sync than the one that first carried them', async () => {
    const BRANCH_ID = '1700000000001';
    const branchChat = `group chats/${BRANCH_ID}.jsonl`;
    const opening = [
      player(1, 'Two tickets.'),
      member('Vera Solano.png', 'Vera Solano', 2, 'Who is the second for?', 111),
    ];
    const family = (
      muted: string[],
      main: Line[],
      branch: Line[],
    ): Record<string, Uint8Array | string> => ({
      'characters/Lund Harrow.png': withChunks(makePng(), [base64TextChunk('chara', LUND)]),
      [GROUP_FILE]: JSON.stringify({
        id: GROUP_ID,
        name: 'Night Crossing',
        members: ['Maris Okonkwo.png', 'Vera Solano.png', 'Lund Harrow.png'],
        disabled_members: muted,
        activation_strategy: 1,
        chats: [GROUP_ID, BRANCH_ID],
        chat_id: GROUP_ID,
      }),
      [GROUP_CHAT]: jsonl([header(), ...opening, ...main]),
      [branchChat]: jsonl([header({ main_chat: GROUP_ID }), ...opening, ...branch]),
    });
    const mainLine = [player(3, 'A friend.')];
    const branchLine = [player(10, 'Nobody.')];

    const first = await run({
      ...sillyTavernFixture(),
      ...family(['Lund Harrow.png'], mainLine, branchLine),
    });
    const sessionId = row(first, GROUP_CHAT).objectId ?? '';
    expect(row(first, branchChat).objectId).toBe(sessionId);
    const lund = row(first, 'characters/Lund Harrow.png').objectId ?? '';

    // Lund unmuted in the group; only the main chat grows.
    await run({
      ...sillyTavernFixture(),
      ...family([], [...mainLine, player(4, 'Fine.')], branchLine),
    });
    // Then only the branch grows.
    await run({
      ...sillyTavernFixture(),
      ...family([], [...mainLine, player(4, 'Fine.')], [...branchLine, player(11, 'Further.')]),
    });

    const { turns } = await exported(sessionId);
    const tail = turns.find((turn) => turn.input?.text === 'Further.');
    expect(tail).toBeDefined();
    const channels = replayChannels(pathTo(turns, tail?.id ?? null));
    expect(channels[channelKey(SE_PRESENCE, lund)]?.value).toBe(true);
  });

  it('wait for the source’s own path when only a swipe carried them', async () => {
    const opened = [
      player(4, 'A friend.'),
      member('Vera Solano.png', 'Vera Solano', 5, 'Friends pay double.', 222),
    ];
    const swiped = [
      player(4, 'A friend.'),
      member('Vera Solano.png', 'Vera Solano', 5, 'Friends pay double.', 222, {
        swipes: ['Friends pay double.', 'Friends pay triple.'],
        swipe_id: 0,
      }),
    ];
    const first = await run({ ...sillyTavernFixture(), ...group(['Lund Harrow.png'], opened) });
    const sessionId = row(first, GROUP_CHAT).objectId ?? '';
    const lund = row(first, 'characters/Lund Harrow.png').objectId ?? '';

    // The mute lifted, and the only new content a swipe off the source's path.
    const second = await run({ ...sillyTavernFixture(), ...group([], swiped) });
    const chat = row(second, GROUP_CHAT);
    expect(note(chat, 'import.chat.extended')?.params).toMatchObject({ count: 1 });
    expect(note(chat, 'import.chat.mutesWaiting')?.params).toEqual({ count: 1 });

    // A main-line message later carries it to where the source is.
    const third = await run({
      ...sillyTavernFixture(),
      ...group([], [...swiped, player(6, 'Fine.')]),
    });
    const later = row(third, GROUP_CHAT);
    expect(keys(later)).not.toContain('import.chat.mutesWaiting');
    // The swipe came at the last sync, and is not counted again.
    expect(keys(later)).not.toContain('import.chat.swipes');
    const { session, turns } = await exported(sessionId);
    expect(pathTo(turns, session.headTurnId).at(-1)?.input?.text).toBe('Fine.');
    expect(session.channels[channelKey(SE_PRESENCE, lund)]?.value).toBe(true);
    expect(session.channels).toEqual(replayChannels(pathTo(turns, session.headTurnId)));
    expect(await reconcileHandEdits(server.services.sessions, 'ned', sessionId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A session imported before this stage
// ---------------------------------------------------------------------------

describe('a session imported before sync existed', () => {
  it('is found by its turns, extended, and stamped with its source', async () => {
    const first = await run({ ...sillyTavernFixture(), ...before() });
    const sessionId = row(first, ROOT).objectId ?? '';

    // What P13.8 to P13.10 wrote: no source on the session, no sync record.
    const context = server.services.sessions;
    const here = await readSession(context, 'ned', sessionId);
    await writeJsonAtomic(sessionFilePath(context.layout, 'ned', sessionId), {
      ...here,
      origin: { ...here?.origin, originalFilename: null },
    });
    await rm(`${sessionRoot(context.layout, 'ned', sessionId)}/import-sync.json`);
    await reindexSession(context, 'ned', sessionId);

    const second = await run({ ...sillyTavernFixture(), ...after() });

    const root = row(second, ROOT);
    expect(root.objectId).toBe(sessionId);
    expect(note(root, 'import.chat.extended')?.params).toMatchObject({ count: 4 });
    const { session } = await exported(sessionId);
    expect(session.origin?.originalFilename).toBe(ROOT);
    // Untouched, read off its root ref, so it followed the source.
    expect(pathTo((await exported(sessionId)).turns, session.headTurnId).at(-1)?.input?.text).toBe(
      'Fetch him.',
    );
  });
});
