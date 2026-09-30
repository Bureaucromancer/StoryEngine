// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  uuidv7,
  type AssembledBlock,
  type ImportItemReport,
  type NotFilledSlot,
  type Turn,
  type TurnPreview,
} from '@storyengine/shared';

import { FakeProvider } from '../providers/fake.js';
import { base64TextChunk, makePng, withChunks } from '../storage/card/test-png.js';
import { Layout } from '../storage/layout.js';
import { makeTestServer, setUpAdmin, type SseFrame, type TestServer } from '../test-server.js';
import { marinaraFixture } from './fixtures/test-marinara.js';
import { sillyTavernFixture } from './fixtures/test-sillytavern.js';
import { MemoryFileSource } from './memory-source.js';
import { sweep } from './sweep.js';

/**
 * ***The fixture pair, for chats*** —
 * [P14.12](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * `fixture-pair.test.ts` exists because a card importer and a preset importer
 * convert opposite ends of one format and can each be right while disagreeing,
 * and the failure is *silence*: a slot that resolves empty forever. Part B adds
 * a third converter with the same hazard and more ends to miss. A chat importer
 * writes speakers, a persona, settings and hidden flags; the card importer
 * writes the actor the speakers resolve to and the prompt sections the Scene
 * pack places; the collector reads all of it. Every one of those is tested
 * alone (`chat-families.test.ts`, `marinara/chat-sessions.test.ts`,
 * `routes/preview.test.ts`), and none of them would notice a speaker resolving
 * to a card whose prompts the pack never reaches, or a history that loses its
 * names because the importer wrote a setting the collector reads differently.
 *
 * So one test per source does what a person does: **sweep a tree holding the
 * cards and the chats together**, open each session that came out (a
 * single-character family with a branch, and a group), preview a turn on it
 * **under the session's own settings** — Scene's embodied voice and per-actor
 * dispatch, the policy and names setting the importer wrote — and play one.
 * What is asserted is what the gate has always asserted, `notFilled` with no
 * `empty-source` for a slot the pair should feed and no `unknown-slot` at all,
 * plus the three things only a chat has: the history names its speakers as
 * `namesInHistory` says, the speaker's card leads the call, and a played turn
 * commits messages attributed to members of the cast.
 *
 * *The cards are the fixtures' own, given prompts.* The shared trees' cards
 * carry no `system_prompt`, `post_history_instructions` or depth prompt —
 * they were written at P4, before [P14.3] gave those fields a destination —
 * so a pair test over them could not tell *the sections are unreachable* from
 * *there was nothing to place*. They are overridden here rather than in the
 * shared trees, whose cards other tests count and compare.
 *
 * *Played on the stub provider*: the gate is about conversion, not prose, and
 * the double's request log is what shows the played turn made one call per
 * speaker.
 */

let server: TestServer;
let provider: FakeProvider;

const CONNECTION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a12';
/** The budget `gestures.test.ts` and `force-talk.test.ts` use for a whole turn. */
const TURN_FINISHES_MS = 8_000;

beforeEach(async () => {
  provider = new FakeProvider({ script: [{ text: 'The tide is late.' }] });
  server = await makeTestServer({
    providers: () => provider,
    config: {
      sessions: { snapshotEveryNTurns: 10, streamKeepaliveMs: 15000, streamCoalesceMs: 0 },
    },
  });
  await setUpAdmin(server, 'ned');

  // A bound model, without which a preview is `unmeasurable` and a turn has
  // nothing to call — the stub, through a connection file as a person's is.
  const root = new Layout(server.dataDir).userConnectionsRoot('ned');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'fake.json'),
    JSON.stringify({
      id: CONNECTION_ID,
      label: 'The double',
      provider: 'openai-compatible',
      models: ['fake-hi'],
    }),
  );
  await writeFile(
    join(server.dataDir, 'users', 'ned', 'bindings.json'),
    JSON.stringify({ prose: { connectionId: CONNECTION_ID, modelId: 'fake-hi' } }),
  );
});

afterEach(async () => {
  await server.dispose();
});

// ---------------------------------------------------------------------------
// The cards' prompts
// ---------------------------------------------------------------------------

/**
 * The three prompt fields [P14.3] routes into sections, each saying `{{char}}`
 * as a card does — so the assertion also sees the card's own name written in.
 */
function cardPrompts(name: string): Record<string, unknown> {
  return {
    system_prompt: `You are {{char}}. Keep it short. (${name})`,
    post_history_instructions: `Stay as {{char}}. (${name})`,
  };
}

function depthPrompt(name: string): Record<string, unknown> {
  return {
    depth_prompt: { prompt: `{{char}} has not slept. (${name})`, depth: 2, role: 'system' },
  };
}

// ---------------------------------------------------------------------------
// Shared reading
// ---------------------------------------------------------------------------

type Tree = Record<string, Uint8Array | string>;

async function swept(tree: Tree): Promise<ImportItemReport[]> {
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

function idOf(items: readonly ImportItemReport[], source: string): string {
  const id = row(items, source).objectId;
  if (id === undefined) throw new Error(`${source} made nothing`);
  return id;
}

interface OpenedSession {
  id: string;
  headTurnId: string | null;
  voice?: string;
  dispatch?: string;
  speakers?: { policy?: string; namesInHistory?: string };
  cast?: { persona: string | null; actors: string[] };
  branchRefs?: { name: string; headTurnId: string | null }[];
}

/** Opens a session as Play does: through the route, which reconciles and reads. */
async function opened(id: string): Promise<OpenedSession> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${id}` });
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  return read.body.session as OpenedSession;
}

async function turnsOf(id: string): Promise<Map<string, Turn>> {
  const read = await server.request({ method: 'GET', url: `/api/sessions/${id}/turns` });
  expect(read.status).toBe(200);
  return new Map((read.body.turns as Turn[]).map((turn) => [turn.id, turn]));
}

async function preview(id: string, text?: string): Promise<TurnPreview> {
  const answered = await server.request({
    method: 'POST',
    url: `/api/sessions/${id}/preview`,
    payload: text === undefined ? {} : { input: { text } },
  });
  expect(answered.status, JSON.stringify(answered.body)).toBe(200);
  return answered.body.preview as TurnPreview;
}

const finished = (frame: SseFrame): boolean =>
  frame.event === 'progress' && (frame.data as { key: string }).key === 'turn.finished';

/** Plays one turn against the session's head and waits for it to land. */
async function play(id: string, body: Record<string, unknown>): Promise<Turn> {
  const session = await opened(id);
  const submitted = await server.request({
    method: 'POST',
    url: `/api/sessions/${id}/turns`,
    payload: { idempotencyKey: uuidv7(), headTurnId: session.headTurnId, ...body },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(202);
  const stream = await server.stream({ url: submitted.body.stream as string });
  await stream.until(finished, TURN_FINISHES_MS);
  await stream.abort();
  const read = await server.request({
    method: 'GET',
    url: `/api/sessions/${id}/turns/${submitted.body.turnId as string}`,
  });
  expect(read.status).toBe(200);
  return read.body.turn as Turn;
}

/**
 * The block ids a preview carries, with the actor suffix the collector adds
 * to an actor block (`se.card.system.<actorId>`) kept, so a test can say whose.
 */
const idsOf = (blocks: readonly AssembledBlock[]): string[] => blocks.map((block) => block.id);

/** The actor whose card block comes first — whose card *leads* the call. */
function leadingCard(blocks: readonly AssembledBlock[]): string | undefined {
  const first = blocks.find((block) => block.source.kind === 'actor');
  return first?.source.kind === 'actor' ? first.source.actorId : undefined;
}

/**
 * **The slots a chat and its cards should feed**, by block id, which is
 * `NotFilledSlot.blockId` — the unsuffixed pack id.
 *
 * Narrower than `fixture-pair.test.ts`'s *every `actor` row*, and on purpose:
 * that test reads an imported preset, which places the fields its cards have;
 * the Scene pack places every field an actor *could* have — appearance, voice,
 * background — and a card with none of them is honestly empty there, not a
 * conversion that missed. What a V2 card and a chat do carry is named here:
 * the persona the chat was locked to, the description and personality, the
 * three [P14.3] prompt sections, the history the chat became, and the input.
 *
 * ~~***Not `se.treatment`, and that is a gap rather than a reading.*** The
 * sweep turns a card's `scenario` into a treatment, and the chat door links
 * none to the session it builds, so the slot is empty on every imported chat
 * while SillyTavern sends the scenario every turn. Nothing in the plan says
 * which is right; the P14.12 as-built note records it, and naming it here would
 * make this gate red over a decision nobody has taken.~~ ***`se.treatment`
 * since [P14.5c]***, which took the decision: the session pass links the
 * treatment the sweep made from the cast's card scenario, as SillyTavern sends
 * it, so the slot is fed and this gate says so.
 */
const FED = [
  'se.persona',
  'se.treatment',
  'se.actor.summary',
  'se.actor.traits',
  'se.card.system',
  'se.card.depth',
  'se.card.post-history',
  'se.history',
  'se.input',
];

/**
 * The gate's assertion, and the three things only a chat has. `speaker` is
 * the member whose call this is; `others` the rest of the present cast.
 */
function assertThePairMeets(
  answer: TurnPreview,
  turns: ReadonlyMap<string, Turn>,
  expected: {
    persona: string;
    speaker: string;
    speakerName: string;
    others: readonly string[];
    named: boolean;
    fed?: readonly string[];
  },
): void {
  if (answer.state !== 'assembled') throw new Error(`not assembled: ${JSON.stringify(answer)}`);
  const { blocks } = answer;
  const ids = idsOf(blocks);
  const notFilled: NotFilledSlot[] = answer.notFilled;

  // **The gate.** A slot the pair should have fed and did not is an
  // `empty-source` row — the silence this project exists to catch.
  const fed = expected.fed ?? FED;
  const starved = notFilled.filter(
    (slot) => slot.reason === 'empty-source' && fed.includes(slot.blockId),
  );
  expect(starved, `slots the pair should have fed: ${JSON.stringify(starved)}`).toEqual([]);
  expect(notFilled.filter((slot) => slot.reason === 'unknown-slot')).toEqual([]);

  // **The embodied call, as the speaker.** Scene's instruction for the voice
  // the session holds, naming the member whose call it is.
  expect(ids).toContain('se.instruction.embodied');
  expect(ids).not.toContain('se.instruction');
  expect(blocks.find((block) => block.id === 'se.instruction.embodied')?.text).toContain(
    `Write ${expected.speakerName}'s next reply`,
  );

  // **The persona the chat was locked to** fills its slot.
  const persona = blocks.find((block) => block.id === 'se.persona');
  expect(persona?.source).toMatchObject({ kind: 'persona', actorId: expected.persona });

  // **The speaker's card leads**, every other present member's follows.
  expect(leadingCard(blocks)).toBe(expected.speaker);
  const summary = (actor: string): number => ids.indexOf(`se.actor.summary.${actor}`);
  expect(summary(expected.speaker)).toBeGreaterThan(-1);
  for (const other of expected.others) {
    expect(summary(other), `${other}'s card`).toBeGreaterThan(summary(expected.speaker));
  }

  // **The card's prompt sections fill — the speaker's, and only theirs**:
  // `voiced` scopes them to the speaker under per-actor ([P14.3]). Written in
  // the card's own name, and post-history last of all.
  const system = blocks.find((block) => block.id === `se.card.system.${expected.speaker}`);
  expect(system?.text).toBe(
    `You are ${expected.speakerName}. Keep it short. (${expected.speakerName})`,
  );
  expect(ids.indexOf(`se.card.system.${expected.speaker}`)).toBeGreaterThan(
    ids.indexOf('se.instruction.embodied'),
  );
  expect(ids).toContain(`se.card.depth.${expected.speaker}`);
  expect(blocks.at(-1)).toMatchObject({
    id: `se.card.post-history.${expected.speaker}`,
    text: `Stay as ${expected.speakerName}. (${expected.speakerName})`,
  });
  for (const other of expected.others) {
    expect(ids.filter((id) => id.startsWith('se.card.') && id.endsWith(other))).toEqual([]);
  }

  // **The history carries the speakers' names as `namesInHistory` says.**
  // Every attributed line of history is read back against the turn it came
  // from, so a name on the wrong line fails as surely as a missing one.
  const lines = blocks.filter(
    (block) => block.source.kind === 'history' && block.source.part === 'output',
  );
  expect(lines.length, 'the chat reached the prompt').toBeGreaterThan(0);
  for (const line of lines) {
    if (line.source.kind !== 'history') continue;
    const message = turns.get(line.source.turnId)?.output?.messages?.[line.source.message ?? 0];
    expect(message, `a history line from ${line.source.turnId}`).toBeDefined();
    if (message === undefined) continue;
    const said =
      expected.named && message.speaker !== null
        ? `${message.speaker.name}: ${message.text}`
        : message.text;
    expect(line.text).toBe(said);
  }
}

/** The played turn's messages as who-said-it, by id and name. */
function attributed(turn: Turn): { id: string | undefined; name: string | undefined }[] {
  return (turn.output?.messages ?? []).map((message) => ({
    id: message.speaker?.id,
    name: message.speaker?.name,
  }));
}

/**
 * ***Whose card led each call the played turn made***, in call order — one
 * call per message under per-actor, each led by the card of the member it
 * speaks for. Read off the turn's own record, so it is the prompt that was
 * sent and not a reconstruction of it. `se.narrate` is Scene's generate step.
 */
function playedAsSpoken(turn: Turn): (string | undefined)[] {
  return (turn.request?.calls ?? [])
    .filter((call) => call.stepId === 'se.narrate')
    .map((call) => leadingCard(call.blocks ?? []));
}

// ---------------------------------------------------------------------------
// SillyTavern
// ---------------------------------------------------------------------------

type Line = Record<string, unknown>;

const jsonl = (lines: readonly Line[]): string =>
  `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;

const at = (minute: number): string => new Date(Date.UTC(2026, 0, 2, 20, minute)).toISOString();

/**
 * A card with the corpus card's words and [P14.3]'s three prompts. Vera's
 * `scenario` is kept, so the sweep makes the treatment it always has — which
 * ~~the session it imports then does not link (the P14.12 as-built note)~~ the
 * session it imports links, since [P14.5c].
 */
function stCard(name: string, description: string, personality: string, scenario = ''): Uint8Array {
  return withChunks(makePng(), [
    base64TextChunk('chara', {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name,
        description,
        personality,
        scenario,
        first_mes: '',
        ...cardPrompts(name),
        extensions: depthPrompt(name),
      },
    }),
  ]);
}

const VERA_ROOT = 'chats/Vera Solano/2026-01-01.jsonl';
const VERA_BRANCH = 'chats/Vera Solano/2026-01-01 - Branch #1.jsonl';
const GROUP_ID = '1767384000000';
const GROUP_FILE = `groups/${GROUP_ID}.json`;
const GROUP_CHAT = `group chats/${GROUP_ID}.jsonl`;

const player = (minute: number, mes: string): Line => ({
  name: 'The Inspector',
  is_user: true,
  is_system: false,
  send_date: at(minute),
  mes,
  extra: {},
  force_avatar: '/thumbnail?type=persona&file=inspector.png',
});

const member = (card: string, name: string, minute: number, mes: string, batch: number): Line => ({
  name,
  is_user: false,
  is_system: false,
  send_date: at(minute),
  mes,
  original_avatar: card,
  gen_started: at(minute),
  extra: { gen_id: batch },
});

/**
 * The shared tree, plus what a person's SillyTavern folder would also hold:
 * **a branch** of the corpus's own chat, made at its last reply and played on,
 * and **a group** of the corpus's two characters with a chat in which both
 * spoke. `natural`, SillyTavern's default strategy, so the mention in a draft
 * decides who replies first and the test can say whose card must lead.
 */
function sillyTavernTree(): Tree {
  const base = sillyTavernFixture();
  const rootText = String(base[VERA_ROOT]).trim();
  return {
    ...base,
    'characters/Vera Solano.png': stCard(
      'Vera Solano',
      'A dock inspector who notices what the manifests leave out.',
      'wry, patient, unbribable',
      'The rain has not stopped in eleven days and the harbour is behind on inspections.',
    ),
    'characters/Maris Okonkwo.png': stCard(
      'Maris Okonkwo',
      'Runs the night ferry and asks no questions worth answering.',
      'Terse. Watches the water.',
    ),
    // The corpus chat, copied whole with a new header — which is what
    // SillyTavern's *branch* writes — then played past its last line.
    [VERA_BRANCH]: jsonl([
      {
        user_name: 'unused',
        character_name: 'unused',
        create_date: '2026-01-02@20h00m00s',
        chat_metadata: {
          integrity: '0f6d3c2e-7a41-4c1b-9e57-2b8a1d4f6c90',
          persona: 'inspector.png',
          world_info: 'Rain City',
          main_chat: '2026-01-01',
        },
      },
      ...rootText
        .split('\n')
        .slice(1)
        .map((line) => JSON.parse(line) as Line),
      player(1, 'Then show me the sealed ones.'),
      {
        name: 'Vera Solano',
        is_user: false,
        is_system: false,
        send_date: at(2),
        mes: 'Bring a warrant.',
        gen_started: at(2),
        extra: {},
      },
    ]),
    [GROUP_FILE]: JSON.stringify({
      id: GROUP_ID,
      name: 'The Night Ferry',
      members: ['Vera Solano.png', 'Maris Okonkwo.png'],
      disabled_members: [],
      allow_self_responses: false,
      activation_strategy: 0,
      generation_mode: 0,
      chats: [GROUP_ID],
      chat_id: GROUP_ID,
    }),
    [GROUP_CHAT]: jsonl([
      {
        user_name: 'unused',
        character_name: 'unused',
        chat_metadata: { integrity: 'bbbbbbbb-0000-4000-8000-000000000002' },
      },
      player(10, 'Two tickets across.'),
      member('Maris Okonkwo.png', 'Maris Okonkwo', 11, 'Pay at the rail.', 501),
      member('Vera Solano.png', 'Vera Solano', 12, 'Not until I see the manifest.', 501),
      player(13, 'Here it is.'),
      member('Vera Solano.png', 'Vera Solano', 14, 'This is last week’s.', 502),
    ]),
  };
}

describe('a SillyTavern folder of cards and chats', () => {
  it('sweeps into sessions whose previews and turns read the cards they resolved to', async () => {
    const items = await swept(sillyTavernTree());
    const vera = idOf(items, 'characters/Vera Solano.png');
    const maris = idOf(items, 'characters/Maris Okonkwo.png');
    const inspector = idOf(items, 'User Avatars/inspector.png');

    // --- The single-character family: the corpus chat and its branch -------
    const single = idOf(items, VERA_ROOT);
    expect(row(items, VERA_BRANCH).objectId).toBe(single);
    const chat = await opened(single);
    expect(chat.branchRefs?.map((ref) => ref.name)).toEqual([
      '2026-01-01',
      '2026-01-01 - Branch #1',
    ]);
    expect(chat.cast).toEqual({ persona: inspector, actors: [vera] });
    expect(chat).toMatchObject({
      voice: 'embodied',
      dispatch: 'per-actor',
      speakers: { policy: 'natural', namesInHistory: 'groups' },
    });

    // One speaker in the window, and `groups` names nobody in a solo chat.
    assertThePairMeets(await preview(single, 'Vera, the docks?'), await turnsOf(single), {
      persona: inspector,
      speaker: vera,
      speakerName: 'Vera Solano',
      others: [],
      named: false,
    });

    const reply = await play(single, { input: { kind: 'do', text: 'Vera, the docks?' } });
    expect(reply.status).toBe('complete');
    expect(attributed(reply)).toEqual([{ id: vera, name: 'Vera Solano' }]);
    expect(playedAsSpoken(reply)).toEqual([vera]);

    // --- The group --------------------------------------------------------
    const group = idOf(items, GROUP_CHAT);
    expect(row(items, GROUP_FILE).objectId).toBe(group);
    const crew = await opened(group);
    expect(crew.cast).toEqual({ persona: inspector, actors: [vera, maris] });
    expect(crew).toMatchObject({
      voice: 'embodied',
      dispatch: 'per-actor',
      speakers: { policy: 'natural', namesInHistory: 'groups' },
    });

    // Two speakers in the window, so `groups` names every attributed line —
    // and the draft names Maris, so hers is the call although Vera is first
    // in the group's order.
    assertThePairMeets(await preview(group, 'Maris, how much?'), await turnsOf(group), {
      persona: inspector,
      speaker: maris,
      speakerName: 'Maris Okonkwo',
      others: [vera],
      named: true,
    });

    const round = await play(group, { input: { kind: 'do', text: 'Maris, how much?' } });
    expect(round.status).toBe('complete');
    const said = attributed(round);
    expect(said[0]).toEqual({ id: maris, name: 'Maris Okonkwo' });
    // `natural` may bring Vera in after her; whoever speaks is a member, by name.
    for (const message of said) {
      expect([
        { id: vera, name: 'Vera Solano' },
        { id: maris, name: 'Maris Okonkwo' },
      ]).toContainEqual(message);
    }
    expect(playedAsSpoken(round)).toEqual(said.map((message) => message.id));
  });
});

// ---------------------------------------------------------------------------
// Marinara
// ---------------------------------------------------------------------------

const CHATS = 'storage/tables/chats.json#';
const CHARACTERS = 'storage/tables/characters.json';

/**
 * The corpus's character rows with [P14.3]'s prompts in each card — the
 * double-encoded `data` column read, extended and written back, as the store
 * keeps it.
 */
function withPrompts(rows: string): string {
  const parsed = JSON.parse(rows) as { id: string; data: string }[];
  return JSON.stringify(
    parsed.map((character) => {
      const card = JSON.parse(character.data) as Record<string, unknown> & { name: string };
      const extensions = (card['extensions'] ?? {}) as Record<string, unknown>;
      return {
        ...character,
        data: JSON.stringify({
          ...card,
          ...cardPrompts(card.name),
          extensions: { ...extensions, ...depthPrompt(card.name) },
        }),
      };
    }),
  );
}

function marinaraTree(): Tree {
  const base = marinaraFixture();
  return {
    ...base,
    [CHARACTERS]: withPrompts(String(base[CHARACTERS])),
    [`${CHARACTERS}.bak`]: withPrompts(String(base[`${CHARACTERS}.bak`])),
  };
}

describe('a Marinara data root of cards and chats', () => {
  it('sweeps into sessions whose previews and turns read the cards they resolved to', async () => {
    const items = await swept(marinaraTree());
    const character = (key: string): string => idOf(items, `${CHARACTERS}#${key}`);
    const [vera, maris, lund] = [
      character('char_vera'),
      character('char_maris'),
      character('char_lund'),
    ];
    const inspector = idOf(items, 'storage/tables/personas.json#persona_inspector');

    // --- The roleplay and its branch ------------------------------------
    const single = idOf(items, `${CHATS}chat_1`);
    expect(row(items, `${CHATS}chat_2`).objectId).toBe(single);
    const chat = await opened(single);
    expect(chat.branchRefs?.map((ref) => ref.name)).toEqual(['Harbour Night', 'False bottoms']);
    expect(chat.cast).toEqual({ persona: inspector, actors: [vera] });
    expect(chat).toMatchObject({
      voice: 'embodied',
      dispatch: 'per-actor',
      speakers: { policy: 'natural', namesInHistory: 'groups' },
    });

    // Vera alone speaks in the window — the head round's narrator line came in
    // hidden, and a narrator's line has no name to give — so `groups` names
    // nobody.
    assertThePairMeets(await preview(single, 'Vera, the docks?'), await turnsOf(single), {
      persona: inspector,
      speaker: vera,
      speakerName: 'Vera Solano',
      others: [],
      named: false,
    });

    const reply = await play(single, { input: { kind: 'do', text: 'Vera, the docks?' } });
    expect(reply.status).toBe('complete');
    expect(attributed(reply)).toEqual([{ id: vera, name: 'Vera Solano' }]);
    expect(playedAsSpoken(reply)).toEqual([vera]);

    // --- The group --------------------------------------------------------
    const group = idOf(items, `${CHATS}chat_group`);
    const crew = await opened(group);
    expect(crew.cast).toEqual({ persona: inspector, actors: [maris, vera, lund] });
    expect(crew).toMatchObject({
      voice: 'embodied',
      dispatch: 'per-actor',
      speakers: { policy: 'manual', namesInHistory: 'groups' },
    });

    /**
     * ***`manual` is the session's own policy, and it is in force.*** Marinara's
     * manual order answers a player's line with nobody — replies are asked
     * for — so a preview of a draft is `not-this-turn`, honestly. The turn a
     * manual group does make is asked for, by force-talk: Maris, then Vera,
     * one call each under per-actor, each attributed.
     */
    const drafted = await preview(group, 'Two tickets, then.');
    expect(drafted).toMatchObject({ state: 'unmeasurable', reason: 'not-this-turn' });

    const round = await play(group, {
      input: { kind: 'do', text: 'Two tickets, then.' },
      speakers: [maris, vera],
    });
    expect(round.status).toBe('complete');
    expect(attributed(round)).toEqual([
      { id: maris, name: 'Maris Okonkwo' },
      { id: vera, name: 'Vera Solano' },
    ]);
    expect(playedAsSpoken(round)).toEqual([maris, vera]);

    /**
     * ***Then the call a manual group makes on its own: *let them talk*.*** No
     * input, so one present member at random — Lund is muted, so Maris or
     * Vera — and the preview is that member's call. Whoever it is, their card
     * leads and the other's follows; Lund's muted card is not on it at all.
     *
     * *Names on now, and not before.* The import's opening round is hidden
     * whole and Maris's reply was hidden by hand in Marinara, so the window
     * held Vera alone and `groups` named nobody; the round just played put
     * Maris in it. *`se.input` is not in `FED` here*, because a turn with no
     * input is exactly what this preview is of.
     */
    const talk = await preview(group);
    if (talk.state !== 'assembled') throw new Error(JSON.stringify(talk));
    const speaker = leadingCard(talk.blocks);
    expect([maris, vera]).toContain(speaker);
    assertThePairMeets(talk, await turnsOf(group), {
      persona: inspector,
      speaker: speaker ?? '',
      speakerName: speaker === maris ? 'Maris Okonkwo' : 'Vera Solano',
      others: [speaker === maris ? vera : maris],
      named: true,
      fed: FED.filter((id) => id !== 'se.input'),
    });
    expect(idsOf(talk.blocks).filter((id) => id.endsWith(lund))).toEqual([]);
  });
});
