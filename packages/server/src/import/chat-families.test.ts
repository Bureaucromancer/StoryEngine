// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ImportItemReport, Turn } from '@storyengine/shared';

import { SE_PRESENCE } from '../sessions/cast.js';
import { channelKey } from '../sessions/channels.js';
import { exportSession } from '../sessions/export.js';
import { listSessions, reconcileHandEdits, replayChannels } from '../sessions/store.js';
import type { SessionFile } from '../sessions/types.js';
import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../test-server.js';
import type { CastMember } from '../turns/cast.js';
import { selectSpeakers } from '../turns/speakers.js';
import { sillyTavernFixture } from './fixtures/test-sillytavern.js';
import { MemoryFileSource } from './memory-source.js';
import { sweep } from './sweep.js';

/**
 * ***SillyTavern families and groups, swept*** —
 * [P14.9](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * The stage's *Ends at*, as a person would find it: a character folder holding
 * a chat, a branch, a branch of the branch and a checkpoint is **one** session
 * whose shared prefix exists once, with four refs, opening on the root chat's
 * head; a three-member group comes in with each round's messages attributed,
 * the group's strategy and self-responses on the session, its muted member
 * muted at the head, and its roster in the group's order.
 *
 * *Fixtures built here rather than in `test-sillytavern.ts`*: that tree is the
 * corpus every importer test shares, and a family of five near-identical chat
 * files beside it would make it the fixture nobody can read.
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
    chat_metadata: { integrity: 'aaaaaaaa-0000-4000-8000-000000000001', ...metadata },
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

/** A single chat's own character, which writes no avatar: the folder says who. */
function vera(minute: number, mes: string, generated = true): Line {
  return {
    name: 'Vera Solano',
    is_user: false,
    is_system: false,
    send_date: at(minute),
    mes,
    ...(generated ? { gen_started: at(minute) } : {}),
    extra: {},
  };
}

/** A group member's line, which names its card, and its batch when generated. */
function member(card: string, name: string, minute: number, mes: string, batch?: number): Line {
  return {
    name,
    is_user: false,
    is_system: false,
    send_date: at(minute),
    mes,
    original_avatar: card,
    ...(batch === undefined ? {} : { gen_started: at(minute) }),
    extra: batch === undefined ? {} : { gen_id: batch },
  };
}

function jsonl(lines: readonly Line[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// A family: a chat, a branch, a branch of the branch, a checkpoint
// ---------------------------------------------------------------------------

const FOLDER = 'chats/Vera Solano';
const ROOT = `${FOLDER}/Vera - 2026-02-01.jsonl`;
const BRANCH = `${FOLDER}/Vera - 2026-02-01 - Branch #1.jsonl`;
const DEEPER = `${FOLDER}/Vera - 2026-02-01 - Branch #1 - Branch #1.jsonl`;
const CHECKPOINT = `${FOLDER}/Vera - 2026-02-01 - Checkpoint #1.jsonl`;

const PREFIX: Line[] = [
  vera(0, 'You again.', false),
  player(1, 'Manifests?'),
  vera(2, 'Define unusual.'),
];
const ROOT_TAIL: Line[] = [player(3, 'Crates from the north.'), vera(4, 'Sealed, all of them.')];

function family(): Record<string, string> {
  return {
    [ROOT]: jsonl([header(), ...PREFIX, ...ROOT_TAIL]),
    // Branched at the reply to the first question, then played differently.
    [BRANCH]: jsonl([
      header({ main_chat: 'Vera - 2026-02-01' }),
      ...PREFIX,
      player(5, 'Anything with a false bottom?'),
      vera(6, 'Two.'),
    ]),
    // Branched from the branch, at its last line, and played on.
    [DEEPER]: jsonl([
      header({ main_chat: 'Vera - 2026-02-01 - Branch #1' }),
      ...PREFIX,
      player(5, 'Anything with a false bottom?'),
      vera(6, 'Two.'),
      player(7, 'Open them.'),
      vera(8, 'Not without a warrant.'),
    ]),
    // A checkpoint of the whole root, played on past it.
    [CHECKPOINT]: jsonl([
      header({ main_chat: 'Vera - 2026-02-01' }),
      ...PREFIX,
      ...ROOT_TAIL,
      player(9, 'Who sealed them?'),
      vera(10, 'The harbourmaster.'),
    ]),
  };
}

// ---------------------------------------------------------------------------
// A group of three
// ---------------------------------------------------------------------------

const LUND = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: { name: 'Lund Harrow', description: 'The harbourmaster.', first_mes: 'Papers.' },
};

const GROUP_ID = '1700000000000';
const GROUP_FILE = `groups/${GROUP_ID}.json`;
const GROUP_CHAT = `group chats/${GROUP_ID}.jsonl`;

function group(): Record<string, Uint8Array | string> {
  return {
    'characters/Lund Harrow.png': withChunks(makePng(), [base64TextChunk('chara', LUND)]),
    [GROUP_FILE]: JSON.stringify({
      id: GROUP_ID,
      name: 'Night Crossing',
      // The group's order, which is not the order anybody first spoke in.
      members: ['Maris Okonkwo.png', 'Vera Solano.png', 'Lund Harrow.png'],
      disabled_members: ['Lund Harrow.png'],
      allow_self_responses: true,
      activation_strategy: 1,
      generation_mode: 1,
      chats: [GROUP_ID],
      chat_id: GROUP_ID,
    }),
    [GROUP_CHAT]: jsonl([
      header(),
      member('Vera Solano.png', 'Vera Solano', 0, 'You again.'),
      member('Maris Okonkwo.png', 'Maris Okonkwo', 0, 'Pay at the rail.'),
      player(1, 'Two tickets.'),
      member('Vera Solano.png', 'Vera Solano', 2, 'Who is the second for?', 111),
      member('Maris Okonkwo.png', 'Maris Okonkwo', 3, 'Cash only.', 111),
      player(4, 'A friend.'),
      member('Maris Okonkwo.png', 'Maris Okonkwo', 5, 'Friends pay double.', 222),
    ]),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function run(
  tree: Record<string, Uint8Array | string>,
  notCarried?: ReadonlySet<string>,
): Promise<ImportItemReport[]> {
  const outcome = await sweep({
    library: server.services.library,
    sessions: server.services.sessions,
    handle: 'ned',
    files: new MemoryFileSource(tree),
    ...(notCarried === undefined ? {} : { notCarried, uploadLimitMb: 1 }),
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

/** The path from a root to `id`, root first. */
function pathTo(turns: readonly Turn[], id: string | null): Turn[] {
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const path: Turn[] = [];
  for (let turn = byId.get(id ?? ''); turn !== undefined;) {
    path.unshift(turn);
    turn = turn.parentTurnId === null ? undefined : byId.get(turn.parentTurnId);
  }
  return path;
}

const textOf = (turn: Turn | undefined): string =>
  (turn?.output?.messages ?? []).map((message) => message.text).join(' | ');

// ---------------------------------------------------------------------------

describe('a character’s chats, as one family', () => {
  it('is one session with four refs, the prefix once, opening on the root’s head', async () => {
    const items = await run({ ...sillyTavernFixture(), ...family() });

    const root = row(items, ROOT);
    expect(root.disposition).toBe('converted');
    for (const path of [BRANCH, DEEPER, CHECKPOINT]) {
      const branch = row(items, path);
      expect(branch.disposition).toBe('converted');
      expect(branch.objectId).toBe(root.objectId);
      expect(branch.notes.map((note) => note.key)).toEqual(['import.chat.inFamily']);
    }
    // The fixture's own chat is another family, and another session.
    expect(await listSessions(server.services.sessions, 'ned')).toHaveLength(2);

    const { session, turns } = await exported(root.objectId);
    expect(session.name).toBe('Vera - 2026-02-01');

    // Greeting, first round, then four divergent rounds: the root's second,
    // the branch's second, the deeper branch's third, the checkpoint's third.
    expect(turns).toHaveLength(6);
    expect(turns.filter((turn) => turn.parentTurnId === null)).toHaveLength(1);
    expect(turns.filter((turn) => turn.input?.text === 'Manifests?')).toHaveLength(1);

    // Root first, then by creation: the copies all begin at the same moment,
    // so the shallower first — a branch after the branch it was made from.
    expect((session.branchRefs ?? []).map((ref) => ref.name)).toEqual([
      'Vera - 2026-02-01',
      'Vera - 2026-02-01 - Branch #1',
      'Vera - 2026-02-01 - Checkpoint #1',
      'Vera - 2026-02-01 - Branch #1 - Branch #1',
    ]);
    const heads = (session.branchRefs ?? []).map((ref) =>
      textOf(pathTo(turns, ref.headTurnId).at(-1)),
    );
    expect(heads).toEqual([
      'Sealed, all of them.',
      'Two.',
      'The harbourmaster.',
      'Not without a warrant.',
    ]);
    // The deeper branch passes through its parent branch's fork, and the
    // checkpoint through the root's own second round.
    expect(pathTo(turns, session.branchRefs?.[3]?.headTurnId ?? null).map(textOf)).toEqual([
      'You again.',
      'Define unusual.',
      'Two.',
      'Not without a warrant.',
    ]);
    expect(pathTo(turns, session.branchRefs?.[2]?.headTurnId ?? null).map(textOf)).toContain(
      'Sealed, all of them.',
    );

    expect(session.headTurnId).toBe(session.branchRefs?.[0]?.headTurnId);
  });

  it('is unchanged when imported again', async () => {
    const tree = { ...sillyTavernFixture(), ...family() };
    await run(tree);
    const second = await run(tree);

    for (const path of [ROOT, BRANCH, DEEPER, CHECKPOINT]) {
      expect(row(second, path).disposition).toBe('unchanged');
    }
    expect(await listSessions(server.services.sessions, 'ned')).toHaveLength(2);
  });

  it('has the same ids whatever order the source listed the chats in', async () => {
    const forwards = family();
    const first = await run({ ...sillyTavernFixture(), ...forwards });
    const before = await exported(row(first, ROOT).objectId);

    // Another install-state, the same account, the listing reversed.
    await server.dispose();
    server = await makeTestServer();
    await setUpAdmin(server);
    const reversed = Object.fromEntries(Object.entries(forwards).reverse());
    const second = await run({ ...sillyTavernFixture(), ...reversed });
    const after = await exported(row(second, ROOT).objectId);

    expect(after.turns.map((turn) => turn.id)).toEqual(before.turns.map((turn) => turn.id));
    expect(after.session.branchRefs).toEqual(before.session.branchRefs);
  });

  it('makes a branch whose parent is missing a session of its own, with a note', async () => {
    const orphan = `${FOLDER}/Orphan.jsonl`;
    const items = await run({
      ...sillyTavernFixture(),
      [orphan]: jsonl([header({ main_chat: 'Deleted long ago' }), ...PREFIX]),
    });

    const answer = row(items, orphan);
    expect(answer.disposition).toBe('converted');
    expect(answer.notes).toContainEqual({
      key: 'import.chat.parentMissing',
      params: { chat: 'Orphan', parent: `${FOLDER}/Deleted long ago.jsonl` },
      level: 'warn',
    });
    expect(await listSessions(server.services.sessions, 'ned')).toHaveLength(2);
  });

  it('breaks a cycle, deterministically, with a note', async () => {
    const a = `${FOLDER}/a.jsonl`;
    const b = `${FOLDER}/b.jsonl`;
    const items = await run({
      ...sillyTavernFixture(),
      [b]: jsonl([header({ main_chat: 'a' }), ...PREFIX, player(5, 'b'), vera(6, 'bee')]),
      [a]: jsonl([header({ main_chat: 'b' }), ...PREFIX, player(3, 'a'), vera(4, 'ay')]),
    });

    // Both chats begin at the same time — copies do — so the path decides.
    const root = row(items, a);
    expect(root.notes).toContainEqual({
      key: 'import.chat.familyCycle',
      params: { chat: 'a', parent: 'b' },
      level: 'warn',
    });
    expect(row(items, b).objectId).toBe(root.objectId);
    const { session } = await exported(root.objectId);
    expect((session.branchRefs ?? []).map((ref) => ref.name)).toEqual(['a', 'b']);
  });

  it('holds a branch back while its parent is in the source and not carried', async () => {
    const { [ROOT]: root = '', [BRANCH]: branch = '' } = family();
    const tree = { ...sillyTavernFixture(), [ROOT]: root, [BRANCH]: branch };
    const partial = await run(tree, new Set([ROOT]));

    expect(row(partial, ROOT).disposition).toBe('skipped');
    const held = row(partial, BRANCH);
    expect(held.disposition).toBe('skipped');
    expect(held.objectId).toBeUndefined();
    expect(held.notes).toEqual([
      { key: 'import.chat.parentNotHere', params: { parent: 'Vera - 2026-02-01' }, level: 'warn' },
    ]);

    // The whole folder later is the one family, with the ids a first import
    // of the whole folder would have given — not a second copy of the branch.
    const whole = await run(tree);
    expect(row(whole, ROOT).disposition).toBe('converted');
    expect(row(whole, BRANCH).objectId).toBe(row(whole, ROOT).objectId);
    const later = await exported(row(whole, ROOT).objectId);

    await server.dispose();
    server = await makeTestServer();
    await setUpAdmin(server);
    const direct = await exported(row(await run(tree), ROOT).objectId);
    expect(later.turns.map((turn) => turn.id)).toEqual(direct.turns.map((turn) => turn.id));
  });
});

describe('a group of three', () => {
  it('attributes each round, takes the group’s settings, and mutes the muted member', async () => {
    const items = await run({ ...sillyTavernFixture(), ...group() });

    const chat = row(items, GROUP_CHAT);
    expect(chat.disposition).toBe('converted');
    expect(chat.notes).toContainEqual({
      key: 'import.chat.groupGenerationMode',
      params: { group: 'Night Crossing', mode: 'append' },
      level: 'info',
    });
    const file = row(items, GROUP_FILE);
    expect(file.disposition).toBe('converted');
    expect(file.objectId).toBe(chat.objectId);
    expect(file.notes.map((note) => note.key)).toEqual(['import.chat.groupRead']);

    const vera = row(items, 'characters/Vera Solano.png').objectId ?? '';
    const maris = row(items, 'characters/Maris Okonkwo.png').objectId ?? '';
    const lund = row(items, 'characters/Lund Harrow.png').objectId ?? '';
    expect([vera, maris, lund].every((id) => id !== '')).toBe(true);

    const { session, turns } = await exported(chat.objectId);
    expect(session.name).toBe('Night Crossing');
    // The roster in the group's order — Lund included, who never spoke.
    expect(session.cast?.actors).toEqual([maris, vera, lund]);
    expect(session.speakers).toMatchObject({ policy: 'list', allowSelfResponses: true });

    // Greetings, the first round (both replies, one batch), the second round.
    const path = pathTo(turns, session.headTurnId);
    expect(path.map((turn) => (turn.output?.messages ?? []).map((m) => m.speaker?.id))).toEqual([
      [vera, maris],
      [vera, maris],
      [maris],
    ]);

    /**
     * ***Muted, at the head, and as the log says.*** The opening carries the
     * source's mute as an applied engine effect; the head cache agrees with
     * a replay of the log, so opening the session reconciles nothing — which
     * an empty cache would have turned into a user-attributed *unmute*.
     */
    const opening = path[0];
    expect(opening?.effects).toEqual([
      expect.objectContaining({
        channelId: SE_PRESENCE,
        scopeKey: lund,
        after: false,
        applied: true,
        proposedBy: { kind: 'engine' },
      }),
    ]);
    const key = channelKey(SE_PRESENCE, lund);
    expect(session.channels[key]?.value).toBe(false);
    expect(replayChannels(path)).toEqual(session.channels);
    expect(await reconcileHandEdits(server.services.sessions, 'ned', chat.objectId ?? '')).toEqual(
      [],
    );

    // And the policy, reading presence as a group chat reads it, passes him by.
    const cast = [maris, vera, lund].map((id) => ({ actor: { id } }) as unknown as CastMember);
    const selection = selectSpeakers({
      policy: 'list',
      castIsPresent: true,
      allowSelfResponses: true,
      actors: cast,
      persona: session.cast?.persona ?? null,
      channels: session.channels,
      hasInput: true,
      activation: 'Lund, are you there?',
      lastSpeaker: null,
      spokenSinceInput: [],
      talkativeness: {},
      draw: () => {
        throw new Error('list draws nothing');
      },
    });
    expect(selection.speakers).toEqual([maris, vera]);
  });

  it('still imports a group chat whose group file is missing, its roster from its lines', async () => {
    const { [GROUP_FILE]: dropped, ...rest } = group();
    void dropped;
    const items = await run({ ...sillyTavernFixture(), ...rest });

    const chat = row(items, GROUP_CHAT);
    expect(chat.disposition).toBe('converted');
    expect(chat.notes).toContainEqual({
      key: 'import.chat.groupMissing',
      params: { chat: GROUP_ID },
      level: 'info',
    });
    const { session, turns } = await exported(chat.objectId);
    expect(session.cast?.actors).toEqual([
      row(items, 'characters/Vera Solano.png').objectId,
      row(items, 'characters/Maris Okonkwo.png').objectId,
    ]);
    expect(turns.flatMap((turn) => turn.effects)).toEqual([]);
    expect(session.channels).toEqual({});
  });
});

describe('a group’s scenarios', () => {
  it('links none when two members bring different scenarios, and says so', async () => {
    const maris = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Maris Okonkwo',
        description: 'Runs the night ferry.',
        scenario: 'The last ferry leaves at midnight and someone is not on the manifest.',
        first_mes: 'Pay at the rail.',
      },
    };
    const items = await run({
      ...sillyTavernFixture(),
      ...group(),
      'characters/Maris Okonkwo.png': withChunks(makePng(), [base64TextChunk('chara', maris)]),
    });
    const made = items.filter((item) =>
      item.notes.some((note) => note.key === 'import.card.treatmentCreated'),
    );
    expect(made).toHaveLength(2);

    const chat = row(items, GROUP_CHAT);
    expect(chat.notes.map((note) => note.key)).toContain('import.chat.scenarioAmbiguous');
    const { session } = await exported(chat.objectId);
    expect(session.treatment).toBeUndefined();
  });
});

describe('a group, again and in older shapes', () => {
  it('says it was compared with the sessions already here, and not that it made them', async () => {
    const tree = { ...sillyTavernFixture(), ...group() };
    await run(tree);
    const second = await run(tree);

    const file = row(second, GROUP_FILE);
    expect(file.disposition).toBe('unchanged');
    expect(file.notes).toEqual([
      {
        key: 'import.chat.groupSynced',
        params: { group: 'Night Crossing', sessions: 1 },
        level: 'info',
      },
    ]);
  });

  it('reads a group file from before chat_id: its one chat, and members by name', async () => {
    const items = await run({
      ...sillyTavernFixture(),
      'groups/old.json': JSON.stringify({
        id: 'old',
        name: 'Old Crew',
        members: ['Maris Okonkwo', 'Vera Solano', 'Nobody Here'],
      }),
      'group chats/old.jsonl': jsonl([
        header(),
        member('Vera Solano.png', 'Vera Solano', 0, 'You again.'),
        player(1, 'Two tickets.'),
        member('Maris Okonkwo.png', 'Maris Okonkwo', 2, 'Cash only.', 111),
      ]),
    });

    const chat = row(items, 'group chats/old.jsonl');
    expect(chat.disposition).toBe('converted');
    expect(chat.notes.map((note) => note.key)).not.toContain('import.chat.groupMissing');
    expect(chat.notes).toContainEqual({
      key: 'import.chat.speakerUnresolved',
      params: { name: 'Nobody Here' },
      level: 'warn',
    });
    expect(row(items, 'groups/old.json').disposition).toBe('converted');

    const { session } = await exported(chat.objectId);
    expect(session.name).toBe('Old Crew');
    // By name, in the group's order — Maris first, though Vera spoke first.
    expect(session.cast?.actors).toEqual([
      row(items, 'characters/Maris Okonkwo.png').objectId,
      row(items, 'characters/Vera Solano.png').objectId,
    ]);
  });

  it('finds a headerless group branch’s parent in the group file that kept it', async () => {
    const lines = [
      member('Vera Solano.png', 'Vera Solano', 0, 'You again.'),
      player(1, 'Two tickets.'),
      member('Maris Okonkwo.png', 'Maris Okonkwo', 2, 'Cash only.', 111),
    ];
    const items = await run({
      ...sillyTavernFixture(),
      'groups/g.json': JSON.stringify({
        id: 'g',
        name: 'Crossing',
        members: ['Maris Okonkwo.png', 'Vera Solano.png'],
        chats: ['A', 'B'],
        chat_id: 'A',
        chat_metadata: {},
        past_metadata: { B: { main_chat: 'A' } },
      }),
      'group chats/A.jsonl': jsonl(lines),
      'group chats/B.jsonl': jsonl([...lines, player(3, 'A friend.')]),
    });

    const root = row(items, 'group chats/A.jsonl');
    expect(root.disposition).toBe('converted');
    expect(row(items, 'group chats/B.jsonl').objectId).toBe(root.objectId);
    expect(row(items, 'groups/g.json').notes).toEqual([
      expect.objectContaining({
        key: 'import.chat.groupRead',
        params: expect.objectContaining({ sessions: 1 }),
      }),
    ]);
    expect(root.notes.map((note) => note.key)).toContain('import.chat.groupLegacyMetadata');
    const { session } = await exported(root.objectId);
    expect(session.branchRefs).toHaveLength(2);
  });

  it('says a muted member two actors are named is ambiguous, not missing', async () => {
    const twin = (description: string): Uint8Array =>
      withChunks(makePng(), [
        base64TextChunk('chara', { ...LUND, data: { ...LUND.data, description } }),
      ]);
    const items = await run({
      ...sillyTavernFixture(),
      'characters/Lund Harrow.png': twin('The harbourmaster.'),
      'characters/Lund Harrow (2).png': twin('His brother.'),
      'groups/old.json': JSON.stringify({
        id: 'old',
        name: 'Old Crew',
        members: ['Vera Solano', 'Lund Harrow'],
        disabled_members: ['Lund Harrow'],
      }),
      'group chats/old.jsonl': jsonl([
        header(),
        member('Vera Solano.png', 'Vera Solano', 0, 'You again.'),
      ]),
    });

    const keys = row(items, 'group chats/old.jsonl').notes.map((note) => note.key);
    expect(keys).toContain('import.chat.nameAmbiguous');
    expect(keys).not.toContain('import.chat.mutedUnresolved');
  });
});
