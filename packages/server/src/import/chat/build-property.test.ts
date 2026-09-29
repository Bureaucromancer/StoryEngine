// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isUuidv7, uuidv7Timestamp, type Turn } from '@storyengine/shared';

import { importSession } from '../../sessions/import.js';
import { walkPath } from '../../sessions/segments.js';
import { readSession, readTurns } from '../../sessions/store.js';
import type { SessionFile } from '../../sessions/types.js';
import { makeTestServer, setUpAdmin, type TestServer } from '../../test-server.js';
import { buildSession } from './build.js';
import { roundsOf } from './rounds.js';
import type {
  BuildContext,
  ChatBuild,
  ChatFamily,
  ChatMessage,
  ChatResolution,
  ChatSourceChat,
  ChatSwipe,
  ForeignRef,
} from './types.js';

/**
 * ***The tree builder's proof obligation*** —
 * [P13.6](../../../../../docs/design/workplan/30-p13-scene-and-session-import.md):
 * *"a set of property tests over generated families, because hand-written
 * fixtures are linear."*
 *
 * **Linear is the precise complaint.** A fixture somebody writes is a chat, and
 * perhaps one branch of it, and the builder's hard cases are what a family does
 * that nobody writes down: a branch of a branch kept to zero rounds, a group
 * round whose force-talk falls exactly at the fork, a swipe copied into three
 * chats, send times that run backwards across a fork. So the families here are
 * generated — a root chat and up to three branches, each a prefix of an earlier
 * chat (the root or another branch) plus rounds of its own, which is what
 * SillyTavern's `createBranch` and Marinara's branch copy both write
 * ([P13 §0.1]) — and the claims are asserted over all of them:
 *
 * - (a) **shared prefixes collapse**: two chats sharing *k* rounds share
 *   exactly *k* nodes, and fork after them;
 * - (b) **parents precede children in id order**, which is what makes
 *   `importSession`'s append-in-file-order safe;
 * - (c) **the same input gives byte-identical output**;
 * - (d) **two accounts produce disjoint ids** ([P13 §2.4]'s *already-here*);
 * - (e) **the head's path is the root chat**, one turn per round;
 * - (f) **a built document loads through the real `importSession`**, and the
 *   loaded session's head walks back to a root;
 * - (g) **which swipe is showing moves no id**: a chat's last message switched
 *   to another of its swipes, as SillyTavern switches it, gives the same turns
 *   — the one thing [P13 §2.7]'s sync has to survive most often, since it is
 *   what a person does between two imports.
 *
 * ***The generator keeps round boundaries knowable***, because (e) is only a
 * claim if the round count comes from somewhere other than the code under
 * test. A reply after a reply folds into its round unless a SillyTavern batch
 * says otherwise (`rounds.ts`), so an output-only round is generated only where
 * a boundary exists to put one: first in a chat, or — in a batched family —
 * after a round that had a batched reply. Everywhere else the round opens with
 * a player's line. The test also checks `roundsOf` finds the same count, so a
 * generator that drifted from the builder's rule would fail loudly rather than
 * test something else.
 */

const CONTEXT: BuildContext = {
  account: 'ned',
  now: '2026-09-29T12:00:00.000Z',
  modeId: 'storyengine.scene',
};
const NOBODY: ChatResolution = { speakers: new Map(), persona: null, lore: [] };

const SPEAKERS: readonly ForeignRef[] = [
  { key: 'Vera.png', name: 'Vera' },
  { key: 'Oskar.png', name: 'Oskar' },
  { key: 'Mira.png', name: 'Mira' },
];

/**
 * *A small vocabulary on purpose*: identical content at different places in a
 * tree is exactly what a content-keyed trie has to keep apart, and a large
 * alphabet would almost never generate it.
 */
const WORDS = ['yes', 'no', 'the rain', 'a door opens', 'Vera laughs', ''];

interface ReplyShape {
  narrator: boolean;
  speaker: number;
  text: string;
  alternatives: string[] | null;
  active: number;
  hidden: boolean;
  at: number | null;
}

interface RoundShape {
  input: string | null;
  inputHidden: boolean;
  inputAt: number | null;
  replies: ReplyShape[];
}

const time = fc.option(fc.integer({ min: 0, max: 20_000 }), { nil: null });
const words = fc.constantFrom(...WORDS);

const replyShape: fc.Arbitrary<ReplyShape> = fc.record({
  narrator: fc.nat({ max: 3 }).map((roll) => roll === 0),
  speaker: fc.nat({ max: SPEAKERS.length - 1 }),
  text: words,
  alternatives: fc.option(fc.array(words, { minLength: 1, maxLength: 3 }), { nil: null }),
  active: fc.nat({ max: 3 }),
  hidden: fc.boolean(),
  at: time,
});

const roundShape: fc.Arbitrary<RoundShape> = fc.record({
  input: fc.option(words, { nil: null }),
  inputHidden: fc.boolean(),
  inputAt: time,
  replies: fc.array(replyShape, { maxLength: 3 }),
});

type Unplaced = Omit<ChatMessage, 'foreignId'>;

interface Laid {
  /** Each round's lines, so a branch can copy a prefix of rounds. */
  rounds: Unplaced[][];
}

/**
 * Round shapes as a chat's lines, with every boundary where the shape says.
 *
 * `start` is the index of the first of these rounds in its chat, and
 * `afterBatch` whether the round before it had a batched reply — together, all
 * `rounds.ts` needs to split an output-only round off. `diverge` forces the
 * first round's player line, for (a)'s *"and fork after them"*.
 */
function lay(
  shapes: readonly RoundShape[],
  style: { batched: boolean; tag: string; start: number; afterBatch: boolean; diverge?: string },
): Laid {
  const rounds: Unplaced[][] = [];
  let afterBatch = style.afterBatch;

  shapes.forEach((shape, offset) => {
    const index = style.start + offset;
    const replies = [...shape.replies];
    let input = offset === 0 && style.diverge !== undefined ? style.diverge : shape.input;

    const outputOnlyFits = index === 0 || (style.batched && afterBatch);
    if (input === null && (!outputOnlyFits || replies.length === 0)) input = 'and?';
    const first = replies[0];
    if (input === null && index > 0 && first?.narrator === true) {
      replies[0] = { ...first, narrator: false };
    }

    const batch = style.batched ? `${style.tag}${String(index)}` : undefined;
    const lines: Unplaced[] = [];
    if (input !== null) {
      lines.push({
        role: 'user',
        text: input,
        at: shape.inputAt,
        ...(shape.inputHidden ? { hidden: true } : {}),
      });
    }
    for (const reply of replies) {
      const hidden = reply.hidden ? { hidden: true } : {};
      if (reply.narrator) {
        lines.push({ role: 'narrator', text: reply.text, at: reply.at, ...hidden });
        continue;
      }
      let swipes = {};
      if (reply.alternatives !== null) {
        // The parser's promise (§0.3): the active swipe already holds `text`.
        const active = reply.active % (reply.alternatives.length + 1);
        const alternatives: ChatSwipe[] = reply.alternatives.map((text) => ({ text, at: null }));
        alternatives.splice(active, 0, { text: reply.text, at: reply.at });
        swipes = { swipes: alternatives, activeSwipe: active };
      }
      lines.push({
        role: 'character',
        speaker: SPEAKERS[reply.speaker] ?? SPEAKERS[0]!,
        text: reply.text,
        at: reply.at,
        ...(batch === undefined ? {} : { batch }),
        ...hidden,
        ...swipes,
      });
    }
    afterBatch = style.batched && replies.some((reply) => !reply.narrator);
    rounds.push(lines);
  });
  return { rounds };
}

function chatOf(
  id: string,
  rounds: readonly Unplaced[][],
  more: Partial<ChatSourceChat> = {},
): ChatSourceChat {
  return {
    id,
    name: id,
    createdAt: null,
    messages: rounds
      .flat()
      .map((line, index) => ({ ...line, foreignId: `${id}#${String(index)}` })),
    ...more,
  };
}

function endsOnBatch(rounds: readonly Unplaced[][], batched: boolean): boolean {
  return batched && (rounds.at(-1) ?? []).some((line) => line.role === 'character');
}

interface FamilyShape {
  batched: boolean;
  root: RoundShape[];
  createdAt: number | null;
  branches: { from: number; keep: number; own: RoundShape[] }[];
}

const familyShape: fc.Arbitrary<FamilyShape> = fc.record({
  batched: fc.boolean(),
  root: fc.array(roundShape, { minLength: 1, maxLength: 6 }),
  createdAt: time,
  branches: fc.array(
    fc.record({
      from: fc.nat(),
      keep: fc.nat(),
      own: fc.array(roundShape, { maxLength: 3 }),
    }),
    { maxLength: 3 },
  ),
});

/**
 * A generated family: the root, then each branch copying a prefix of an earlier
 * chat — which may itself be a branch — and adding rounds of its own.
 */
function familyOf(
  shape: FamilyShape,
  key = 'chats/Gen/root.jsonl',
): {
  family: ChatFamily;
  rootRounds: number;
} {
  const chats: { id: string; rounds: Unplaced[][] }[] = [];
  const root = lay(shape.root, { batched: shape.batched, tag: 'r', start: 0, afterBatch: false });
  chats.push({ id: 'chats/Gen/root.jsonl', rounds: root.rounds });

  const built: ChatSourceChat[] = [
    chatOf('chats/Gen/root.jsonl', root.rounds, { createdAt: shape.createdAt }),
  ];
  shape.branches.forEach((branch, n) => {
    const parent = chats[branch.from % chats.length]!;
    const keep = branch.keep % (parent.rounds.length + 1);
    const kept = parent.rounds.slice(0, keep);
    const own = lay(branch.own, {
      batched: shape.batched,
      tag: `b${String(n)}-`,
      start: keep,
      afterBatch: endsOnBatch(kept, shape.batched),
    });
    const id = `chats/Gen/branch-${String(n)}.jsonl`;
    const rounds = [...kept, ...own.rounds];
    chats.push({ id, rounds });
    built.push(chatOf(id, rounds, { parentId: parent.id }));
  });

  return {
    family: { source: 'sillytavern', key, name: 'Generated', chats: built },
    rootRounds: root.rounds.length,
  };
}

function sessionOf(built: ChatBuild): SessionFile {
  return built.document.session as unknown as SessionFile;
}

function turnsOf(built: ChatBuild): Map<string, Turn> {
  return new Map(built.document.turns.map((turn) => [turn.id, turn]));
}

// ---------------------------------------------------------------------------

describe('the chat tree builder, over generated families', () => {
  it('(a) makes two chats sharing k rounds share exactly k nodes, then fork', () => {
    fc.assert(
      fc.property(
        fc.record({
          batched: fc.boolean(),
          root: fc.array(roundShape, { minLength: 1, maxLength: 6 }),
          keep: fc.nat(),
          own: fc.array(roundShape, { maxLength: 3 }),
        }),
        (shape) => {
          const root = lay(shape.root, {
            batched: shape.batched,
            tag: 'r',
            start: 0,
            afterBatch: false,
          });
          const k = shape.keep % (root.rounds.length + 1);
          const kept = root.rounds.slice(0, k);
          // `!` is in no generated text, so the branch's next round is its own.
          const own = lay(shape.own, {
            batched: shape.batched,
            tag: 'b',
            start: k,
            afterBatch: endsOnBatch(kept, shape.batched),
            diverge: '!diverged',
          });
          const built = buildSession(
            {
              source: 'sillytavern',
              key: 'chats/Gen/root.jsonl',
              name: 'Generated',
              chats: [
                chatOf('root', root.rounds),
                chatOf('branch', [...kept, ...own.rounds], { parentId: 'root' }),
              ],
            },
            NOBODY,
            CONTEXT,
          );

          const refs = new Map((sessionOf(built).branchRefs ?? []).map((ref) => [ref.name, ref]));
          const turns = turnsOf(built);
          const main = walkPath(turns, refs.get('root')?.headTurnId ?? null).map((t) => t.id);
          const other = walkPath(turns, refs.get('branch')?.headTurnId ?? null).map((t) => t.id);
          const shared = main.filter((id) => other.includes(id));

          expect(shared).toHaveLength(k);
          expect(main.slice(0, k)).toEqual(other.slice(0, k));
          expect(other).toHaveLength(k + own.rounds.length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('(b) lists every parent before its children, in id order, as uuidv7s', () => {
    fc.assert(
      fc.property(familyShape, (shape) => {
        const built = buildSession(familyOf(shape).family, NOBODY, CONTEXT);
        const ids = built.document.turns.map((turn) => turn.id);
        const at = new Map(ids.map((id, index) => [id, index]));

        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual([...ids].sort());
        for (const turn of built.document.turns) {
          expect(isUuidv7(turn.id)).toBe(true);
          if (turn.parentTurnId === null) continue;
          expect(at.get(turn.parentTurnId)).toBeLessThan(at.get(turn.id) ?? -1);
          expect(uuidv7Timestamp(turn.parentTurnId)).toBeLessThan(uuidv7Timestamp(turn.id) ?? 0);
        }

        // Everything the session names is a turn the document holds.
        const session = sessionOf(built);
        for (const ref of session.branchRefs ?? []) expect(at.has(ref.headTurnId)).toBe(true);
        for (const [parent, child] of Object.entries(session.lastSelectedChild ?? {})) {
          expect(at.has(parent)).toBe(true);
          expect(built.document.turns[at.get(child) ?? -1]?.parentTurnId).toBe(parent);
        }
        for (const [id, entry] of Object.entries(session.hidden ?? {})) {
          const turn = built.document.turns[at.get(id) ?? -1];
          expect(turn).toBeDefined();
          if (entry === true) continue;
          for (const index of entry) {
            expect(index).toBeLessThan(turn?.output?.messages?.length ?? 0);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('(c) gives byte-identical output for the same family, account and time', () => {
    fc.assert(
      fc.property(familyShape, (shape) => {
        const { family } = familyOf(shape);
        const once = buildSession(family, NOBODY, CONTEXT);
        const twice = buildSession(structuredClone(family), NOBODY, { ...CONTEXT });

        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
      }),
      { numRuns: 200 },
    );
  });

  it('(d) gives two accounts disjoint ids for the same family', () => {
    fc.assert(
      fc.property(familyShape, (shape) => {
        const { family } = familyOf(shape);
        const ned = buildSession(family, NOBODY, CONTEXT);
        const ada = buildSession(family, NOBODY, { ...CONTEXT, account: 'ada' });
        const idsOf = (built: ChatBuild): string[] => [
          ...built.document.turns.map((turn) => turn.id),
          ...(sessionOf(built).branchRefs ?? []).map((ref) => ref.id),
        ];
        const nedIds = new Set(idsOf(ned));

        expect(idsOf(ada).filter((id) => nedIds.has(id))).toEqual([]);
        expect(ada.document.turns).toHaveLength(ned.document.turns.length);
      }),
      { numRuns: 200 },
    );
  });

  it('(e) opens on the root chat, one turn per round', () => {
    fc.assert(
      fc.property(familyShape, (shape) => {
        const { family, rootRounds } = familyOf(shape);
        const built = buildSession(family, NOBODY, CONTEXT);
        const path = walkPath(turnsOf(built), sessionOf(built).headTurnId);

        // The generator's count and the builder's rule agree, or (e) proves nothing.
        expect(roundsOf(family.chats[0]?.messages ?? [])).toHaveLength(rootRounds);
        expect(path).toHaveLength(rootRounds);
        expect(path[0]?.parentTurnId).toBeNull();
        expect(sessionOf(built).headTurnId).toBe(sessionOf(built).branchRefs?.[0]?.headTurnId);
      }),
      { numRuns: 300 },
    );
  });

  it('(g) gives the same turn ids whichever swipe of a chat’s last message is showing', () => {
    fc.assert(
      fc.property(familyShape, fc.nat(), fc.nat(), (shape, pick, to) => {
        const { family } = familyOf(shape);
        const at = pick % family.chats.length;
        const chat = family.chats[at]!;
        const last = chat.messages.at(-1);
        const swipes = last?.swipes ?? [];
        /**
         * *The chat's last message*, because that is the only one SillyTavern
         * lets a person swipe: one further back has a continuation hanging off
         * its active swipe, and switching it would re-hang everything after.
         */
        fc.pre(last?.role === 'character' && swipes.length >= 2);
        const from = last.activeSwipe ?? 0;
        const next = to % swipes.length;
        fc.pre(next !== from);

        /**
         * `syncMesToSwipe` then `syncSwipeToMes`: the line keeps the swipe it
         * leaves as it was shown, and takes the new one's text and time.
         */
        const leaving: ChatSwipe = { text: last.text, at: last.at };
        const arriving = swipes[next]!;
        const switched: ChatMessage = {
          ...last,
          text: arriving.text,
          at: arriving.at,
          swipes: swipes.map((swipe, index) => (index === from ? leaving : swipe)),
          activeSwipe: next,
        };
        const other: ChatFamily = {
          ...family,
          chats: family.chats.map((each, index) =>
            index === at ? { ...each, messages: [...each.messages.slice(0, -1), switched] } : each,
          ),
        };

        const idsOf = (built: ChatBuild): string[] =>
          built.document.turns.map((turn) => turn.id).sort();
        expect(idsOf(buildSession(other, NOBODY, CONTEXT))).toEqual(
          idsOf(buildSession(family, NOBODY, CONTEXT)),
        );
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------

describe('(f) a built document, through the real importSession', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await makeTestServer();
    await setUpAdmin(server, 'ned');
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('loads every turn, and the loaded head walks back to a root', async () => {
    /**
     * *A family key per run*, because the ids are keyed on it and the index
     * refuses a session whose turns are already here — which is the rule doing
     * its job, and not what this property is about.
     */
    let run = 0;
    await fc.assert(
      fc.asyncProperty(familyShape, async (shape) => {
        run += 1;
        const { family, rootRounds } = familyOf(shape, `chats/Gen/run-${String(run)}.jsonl`);
        const built = buildSession(family, NOBODY, CONTEXT);

        const result = await importSession(
          { sessions: server.services.sessions },
          'ned',
          built.document,
        );
        expect(result).toMatchObject({ ok: true, turns: built.document.turns.length });
        if (!result.ok) return;

        const session = await readSession(server.services.sessions, 'ned', result.sessionId);
        const turns = await readTurns(server.services.sessions, 'ned', result.sessionId);
        const path = walkPath(turns, session?.headTurnId ?? null);

        expect(turns.size).toBe(built.document.turns.length);
        expect(path).toHaveLength(rootRounds);
        expect(path[0]?.parentTurnId).toBeNull();
        expect(session?.headTurnId).toBe(sessionOf(built).headTurnId);
        expect(session?.voice).toBe('embodied');
        expect(session?.hidden).toEqual(sessionOf(built).hidden);
        expect(session?.lastSelectedChild).toEqual(sessionOf(built).lastSelectedChild);
      }),
      { numRuns: 12 },
    );
  });
});
