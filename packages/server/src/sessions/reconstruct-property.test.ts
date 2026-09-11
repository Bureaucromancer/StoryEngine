// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newLorebook, newLoreEntry, uuidv7, type LoreEntry } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { installBuiltIns } from '../mode-loader.js';
import { TEST_PRESET } from '../test-mode.js';
import { retrieve, type Retrieved } from '../retrieval/retrieve.js';
import {
  advanceTiming,
  NO_TIMING,
  timingOf,
  timingVerdict,
  type EntryTiming,
} from '../retrieval/timing.js';
import { Rng } from '../rng/rng.js';
import { seededSource } from '../rng/source.js';
import { Layout } from '../storage/layout.js';
import { acceptEffect } from '../turns/effects.js';
import type { LoreSource } from '../turns/lore.js';
import {
  advance,
  channelKey,
  MINUTES_PER_TURN,
  readClock,
  SE_CLOCK,
  SE_LORE_TIMING,
} from './channels.js';
import { listSegments, walkPath } from './segments.js';
import { listSnapshots, snapshotsRoot } from './snapshots.js';
import {
  appendTurnToSession,
  applyEffects,
  createSession,
  readSession,
  readTurns,
  reconstructAlong,
  replayChannels,
  sessionRoot,
  type SessionContext,
} from './store.js';
import type { ChannelEffect, ChannelState, SessionFile, Turn } from './types.js';

/**
 * Reconstruction at every node — [P6 §2] P6.0a, and [P5 §3] step 14 discharged.
 *
 * The property this phase is built on: **state at a node is
 * `replayChannels(walkPath(turns, node))`, and nothing else is authoritative.**
 * Every earlier test of that pair folds a clock-only path, so a fault in how a
 * scoped effect replays, or in how a branch keeps its counters to itself,
 * would have been green all the way to the first person who pressed a branch
 * button. This file generalises the fold from the head to every index, over a
 * session that forks, with the effect log P5 actually writes.
 *
 * **The `se.lore.timing` effects are genuine, not hand-built.** Each turn runs
 * the real retriever and commits its proposals through `acceptEffect` exactly
 * as the runner does (`turns/runner.ts`), then the clock the same way. That is
 * deliberate rather than convenient: the clause this file exists to protect —
 * `same()`'s `fired` comparison in `retrieval/retrieve.ts` — decides whether an
 * effect is *written at all*, and a fixture that wrote its own effects could not
 * go red when that clause is deleted. Before this file, deleting it left the
 * whole suite green and made an `ephemeral` entry fire forever.
 *
 * **Two oracles, because one would be vacuous.** The forward map — the channel
 * state the writer held after each turn — proves the disk round-trip and the
 * walk; but it is computed with the same `applyEffects` the replay uses, so a
 * keying fault would change both sides equally. The literal table beside it is
 * the independent half: three integers per entry per node, derived by hand from
 * `timingVerdict` and `advanceTiming`, that pass through no production code at
 * all. `walkPath` and `replayChannels` themselves are the shipped pair on
 * purpose — a test that reimplemented either would be comparing two of its own
 * beliefs while the real ones drifted (`routes/p2-gate-storage.test.ts` says
 * the same about step 16).
 *
 * **The head snapshot, which this file could not assert when it was written.**
 * At P6.0a `advanceHead` folded a new turn's effects onto whatever the head's
 * map was rather than onto the parent's, so appending a sibling left the file
 * describing a state no path had — and asserting that either way would have
 * pinned the defect or failed until it was fixed. **[P6.0b] fixed it**, and the
 * last test now says so on the richest fork in the suite: the snapshot is the
 * replay at the head it names. `snapshotIsAt` is why that is worth one line
 * here as well as at store level — two readers take the file's map for the
 * head and replay for every other node, and this fixture is the only one whose
 * effects are lore rather than a clock.
 */

const ACCOUNT = 'ned';

let dataDir: string;
let index: OpenedIndex;
let context: SessionContext;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-reconstruct-'));
  // Channels are registered rather than frozen into the engine since [P7.0], so
  // a test that needs one asks for the built-ins the way `buildServices` does.
  await installBuiltIns();

  index = await openIndex({ path: ':memory:' });
  context = {
    layout: new Layout(dataDir),
    index: index.db,
    // Three turns per segment, so the seven-turn fixture below spans three
    // files and the fork parent is not in the same segment as the sibling line.
    // A reader that lost a later segment would find no head at all; one that
    // lost an earlier one would replay a path that starts in the middle and
    // is simply shorter, which is the quiet kind of wrong.
    limits: { maxTurns: 3, maxBytes: 1_000_000 },
    // Two rather than the shipped ten, so a fixture four turns deep exercises
    // the snapshot cache at all — see the cache test at the end of this file.
    snapshotEvery: () => 2,
  };
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * Three entries, one per counter, with ids fixed by name so that a failure reads
 * `se.lore.timing#sticky` rather than a uuid — the same choice
 * `retrieval/gate-correspondence.test.ts` makes with its `f1`..`f4` folders.
 * `ephemeral` carries **neither** `sticky` nor `cooldown`: when it fires,
 * `fired` is the only integer that moves, so it is the one entry whose effect
 * depends on the `fired` clause alone. Its limit is two rather than one so the
 * log also holds a write in which `fired` goes from one to two — a clause that
 * only told zero from non-zero would keep the first firing and lose the second,
 * and an entry with a limit of one could never show the difference.
 */
const STICKY: LoreEntry = {
  ...newLoreEntry('The lighthouse'),
  id: 'sticky',
  keys: ['lighthouse'],
  content: 'A light that should not be lit.',
  sticky: 2,
};
const COOLDOWN: LoreEntry = {
  ...newLoreEntry('The ferryman'),
  id: 'cooldown',
  keys: ['ferryman'],
  content: 'He takes coin, not names.',
  cooldown: 2,
};
const EPHEMERAL: LoreEntry = {
  ...newLoreEntry('The omen'),
  id: 'ephemeral',
  keys: ['omen'],
  content: 'Seen twice, and never again.',
  ephemeral: 2,
};
const ENTRIES = [STICKY, COOLDOWN, EPHEMERAL] as const;

/**
 * `scanDepth: 1` so that a turn's matches are decided by its own input and
 * nothing before it — the retriever scans the pending input first, so depth one
 * is exactly that message. The table below is then derivable by reading each
 * turn's text, which is the point of a table. (The table would survive any
 * depth up to six; at seven, `t4` would see `t1`'s lighthouse again.)
 */
const BOOK: LoreSource = {
  book: { ...newLorebook('Rain City'), scanDepth: 1, entries: [...ENTRIES] },
  id: 'book-1',
  contentHash: 'sha256:0',
  required: false,
  by: 'session',
};

function keyOf(entry: LoreEntry): string {
  return channelKey(SE_LORE_TIMING, entry.id);
}

/** One turn as the writer saw it: what it was handed, and what it left behind. */
interface Played {
  turn: Turn;
  /** The channel map after this turn, computed forward the way the runner does. */
  state: Record<string, ChannelState>;
  /** Root-first and excluding this turn — the history the retriever was handed. */
  history: Turn[];
  retrieved: Retrieved;
}

/**
 * Runs one turn the way `turns/runner.ts` does, minus the model: the retriever
 * proposes, `acceptEffect` decides and stamps `before` from the running map,
 * `applyEffects` chains, and the clock goes last through the same gate. The
 * parent's `state` is the starting map — never the session file's, which is
 * what makes this a forward computation rather than a read-back.
 */
function playTurn(sessionId: string, parent: Played | null, text: string, at: number): Played {
  const history = parent === null ? [] : [...parent.history, parent.turn];
  let running: Record<string, ChannelState> = parent?.state ?? {};
  const id = uuidv7();

  const retrieved = retrieve({
    lore: { treatment: null, books: [BOOK], missing: [] },
    preset: TEST_PRESET,
    history,
    input: { text },
    channels: running,
    persona: null,
    actors: [],
    callKind: 'prose',
    rng: new Rng({ source: seededSource(0x9e3779b9) }),
  });

  const effects: ChannelEffect[] = [];
  for (const proposal of retrieved.effects) {
    const effect = acceptEffect(id, proposal, running);
    effects.push(effect);
    running = applyEffects(running, [effect]);
  }
  const clock = acceptEffect(
    id,
    {
      channelId: SE_CLOCK,
      op: { type: 'set', path: '/' },
      after: advance(readClock(running), MINUTES_PER_TURN),
      proposedBy: { kind: 'engine' },
    },
    running,
  );
  effects.push(clock);
  running = applyEffects(running, [clock]);

  const turn: Turn = {
    id,
    sessionId,
    parentTurnId: parent?.turn.id ?? null,
    createdAt: new Date(Date.UTC(2026, 8, 2, 8, at)).toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'do', text, raw: text },
    output: { text: 'Nothing happens.' },
    effects,
    tape: [],
  };
  return { turn, state: running, history, retrieved };
}

type NodeName = 't1' | 't2' | 't3' | 't4' | 's2' | 's3' | 's4';

/**
 * The fixture, in append order:
 *
 *     t1 "The lighthouse." ─ t2 "The ferryman." ─ t3 "An omen." ─ t4 "Nothing much."
 *      └─ s2 "An omen." ─ s3 "The ferryman, and an omen." ─ s4 "An omen."
 *
 * The main line fires all three entries in turn and then does nothing, so every
 * counter is observed mid-count and then carried through a turn that wrote
 * nothing. The sibling line forks from `t1` — before the ferryman and the omen
 * were ever mentioned on the main line — and fires them in its own order, so
 * each line's counters are its own. It mentions the omen three times: the
 * second is the firing only `fired` records, and the third is the one an
 * `ephemeral: 2` entry must refuse.
 */
const SCRIPT: readonly { name: NodeName; parent: NodeName | null; text: string }[] = [
  { name: 't1', parent: null, text: 'The lighthouse.' },
  { name: 't2', parent: 't1', text: 'The ferryman.' },
  { name: 't3', parent: 't2', text: 'An omen.' },
  { name: 't4', parent: 't3', text: 'Nothing much.' },
  { name: 's2', parent: 't1', text: 'An omen.' },
  { name: 's3', parent: 's2', text: 'The ferryman, and an omen.' },
  { name: 's4', parent: 's3', text: 'An omen.' },
];

/**
 * What each node's state must be, derived by hand from `timingVerdict` and
 * `advanceTiming` in `retrieval/timing.ts` and from nothing in this file. A
 * firing sets `sticky` and `cooldown` from the entry and bumps `fired`; a sticky
 * window counts down first; a cooldown counts down on turns the entry took no
 * part in; a spent entry changes nothing; `null` means the key is absent because
 * the entry never fired on that path. The clock starts at 08:00 and moves five
 * minutes a turn.
 */
interface Expected {
  S: EntryTiming | null;
  C: EntryTiming | null;
  E: EntryTiming | null;
  minute: number;
}
const EXPECTED: Record<NodeName, Expected> = {
  t1: { S: { sticky: 2, cooldown: 0, fired: 1 }, C: null, E: null, minute: 5 },
  t2: {
    S: { sticky: 1, cooldown: 0, fired: 1 },
    C: { sticky: 0, cooldown: 2, fired: 1 },
    E: null,
    minute: 10,
  },
  t3: {
    S: { sticky: 0, cooldown: 0, fired: 1 },
    C: { sticky: 0, cooldown: 1, fired: 1 },
    E: { sticky: 0, cooldown: 0, fired: 1 },
    minute: 15,
  },
  // Nothing was said. S and E are carried from t3 untouched; C counts down.
  t4: {
    S: { sticky: 0, cooldown: 0, fired: 1 },
    C: { sticky: 0, cooldown: 0, fired: 1 },
    E: { sticky: 0, cooldown: 0, fired: 1 },
    minute: 20,
  },
  s2: {
    S: { sticky: 1, cooldown: 0, fired: 1 },
    C: null,
    E: { sticky: 0, cooldown: 0, fired: 1 },
    minute: 10,
  },
  // The ferryman fires fresh on this line — t2's counter belongs to the other
  // one — and the omen fires for the second time, moving `fired` alone.
  s3: {
    S: { sticky: 0, cooldown: 0, fired: 1 },
    C: { sticky: 0, cooldown: 2, fired: 1 },
    E: { sticky: 0, cooldown: 0, fired: 2 },
    minute: 15,
  },
  // The omen is spent, so E is carried; C counts down; S is idle.
  s4: {
    S: { sticky: 0, cooldown: 0, fired: 1 },
    C: { sticky: 0, cooldown: 1, fired: 1 },
    E: { sticky: 0, cooldown: 0, fired: 2 },
    minute: 20,
  },
};

/**
 * Which effects each turn writes, by scope key, with `null` for the clock. An
 * entry whose counters did not move writes nothing — `retrieve` filters those
 * out, and that filter is what keeps a four-hundred-entry book from writing
 * four hundred no-ops a turn. The lore order is production's (the retriever
 * walks the scan's timing record, which is filled in book order); the clock's
 * place at the end is `playTurn`'s own, mirrored from the runner.
 */
const WRITES: Record<NodeName, readonly (string | null)[]> = {
  t1: ['sticky', null],
  t2: ['sticky', 'cooldown', null],
  t3: ['sticky', 'cooldown', 'ephemeral', null],
  t4: ['cooldown', null],
  s2: ['sticky', 'ephemeral', null],
  s3: ['sticky', 'cooldown', 'ephemeral', null],
  s4: ['cooldown', null],
};

const NODE_NAMES: readonly NodeName[] = ['t1', 't2', 't3', 't4', 's2', 's3', 's4'];

async function onDisk(sessionId: string): Promise<SessionFile> {
  const found = await readSession(context, ACCOUNT, sessionId);
  if (found === null) throw new Error('the session went missing');
  return found;
}

interface Fixture {
  sessionId: string;
  nodes: ReadonlyMap<NodeName, Played>;
  /** The session file as it stood after `t4`, before any sibling existed. */
  headBeforeFork: SessionFile;
  /** And as it stood the moment the first sibling landed, which is where a
   * wrong parent map shows before later writes cover it over. */
  fileAfterFork: SessionFile;
  turns: Map<string, Turn>;
}

async function buildOnDisk(): Promise<Fixture> {
  const session = await createSession(context, ACCOUNT, { name: 'Rain City', lore: ['book-1'] });
  const nodes = new Map<NodeName, Played>();
  let headBeforeFork: SessionFile | null = null;
  let fileAfterFork: SessionFile | null = null;

  for (const [at, step] of SCRIPT.entries()) {
    if (step.name === 's2') headBeforeFork = await onDisk(session.id);
    const parent = step.parent === null ? null : nodes.get(step.parent);
    if (parent === undefined) throw new Error(`${step.name} names a parent that was not played`);
    const played = playTurn(session.id, parent, step.text, at);
    await appendTurnToSession(context, ACCOUNT, session.id, played.turn);
    nodes.set(step.name, played);
    if (step.name === 's2') fileAfterFork = await onDisk(session.id);
  }
  if (headBeforeFork === null || fileAfterFork === null) {
    throw new Error('the fork never happened');
  }

  return {
    sessionId: session.id,
    nodes,
    headBeforeFork,
    fileAfterFork,
    turns: await readTurns(context, ACCOUNT, session.id),
  };
}

function node(fixture: Fixture, name: NodeName): Played {
  const found = fixture.nodes.get(name);
  if (found === undefined) throw new Error(`no node ${name}`);
  return found;
}

function replayedAt(fixture: Fixture, name: NodeName): Record<string, ChannelState> {
  return replayChannels(walkPath(fixture.turns, node(fixture, name).turn.id));
}

describe('reconstruction from zero', () => {
  it('replays the head with the three counters checked — P5 gate step 14', async () => {
    // [P5 §3] step 14 as written: a session through turns with a sticky-or-
    // cooldown entry, `replayChannels(walkPath(turns, head))` against
    // `session.channels`, three counters by name. The head is the file's own
    // pointer, not the fixture's knowledge of it; and it is read before the
    // fork, because before it every append's parent was the previous head and
    // the file's map is the state of exactly one path.
    const fixture = await buildOnDisk();
    const head = fixture.headBeforeFork.headTurnId;
    expect(head).toBe(node(fixture, 't4').turn.id);
    const replayed = replayChannels(walkPath(fixture.turns, head));

    expect(replayed).toEqual(fixture.headBeforeFork.channels);
    expect(replayed[keyOf(STICKY)]?.value).toEqual({ sticky: 0, cooldown: 0, fired: 1 });
    expect(replayed[keyOf(COOLDOWN)]?.value).toEqual({ sticky: 0, cooldown: 0, fired: 1 });
    expect(replayed[keyOf(EPHEMERAL)]?.value).toEqual({ sticky: 0, cooldown: 0, fired: 1 });
  });

  it('agrees with the forward map at every node, across a fork and two segment rolls', async () => {
    const fixture = await buildOnDisk();

    // The seam is engaged: without this pin a raised limit would quietly turn
    // the cross-segment walk into a single-file one and the test would still
    // pass, proving less than it says.
    expect(
      await listSegments(join(sessionRoot(context.layout, ACCOUNT, fixture.sessionId), 'turns')),
    ).toEqual(['000001', '000002', '000003']);

    // The stored form, by name, once: everything below reads through
    // `channelKey`, which is the right thing to do and also symmetric with the
    // writer — a changed separator would move both sides together and no cell
    // would notice. This is the witness that the key on disk is the one
    // [P6 §2] promises.
    expect(keyOf(STICKY)).toBe('se.lore.timing#sticky');

    for (const name of NODE_NAMES) {
      const replayed = replayedAt(fixture, name);
      const expected = EXPECTED[name];

      // The writer's own map, after the disk round-trip and the walk. The
      // falsifying mutations all show first here: a walk that is not
      // root-first as the wrong clock, a fold that does not start empty as a
      // stray key, a copy that starts from nothing as a counter the writer's
      // own map kept and the replay lost.
      expect(replayed, name).toEqual(node(fixture, name).state);

      // The literal table, which shares nothing with the code under test. This
      // is the assertion that reddens when `applyEffects` keys on the channel
      // id alone — the forward map agrees with the replay under that mutation,
      // because both sides make the same mistake — and when `same()` loses a
      // clause, because then a firing or a countdown is never written: the key
      // is absent (`fired`) or stale (`sticky`, `cooldown`). `toEqual` against
      // `undefined` rather than a decoder, so an absent key cannot read as
      // zeros.
      expect(replayed[keyOf(STICKY)]?.value, `${name} sticky`).toEqual(expected.S ?? undefined);
      expect(replayed[keyOf(COOLDOWN)]?.value, `${name} cooldown`).toEqual(expected.C ?? undefined);
      expect(replayed[keyOf(EPHEMERAL)]?.value, `${name} ephemeral`).toEqual(
        expected.E ?? undefined,
      );
      expect(replayed[SE_CLOCK]?.value, `${name} clock`).toEqual({
        day: 1,
        hour: 8,
        minute: expected.minute,
      });
    }
  });

  it("keeps one line's activations off the other", async () => {
    const fixture = await buildOnDisk();

    // Before the fork point neither line had met the ferryman or the omen, so
    // on the sibling line the ferryman's counter is absent until s3 fires it
    // fresh — t2's belongs to the main line. [P6 §3] step 10 is this claim
    // made through a gesture; this is the same claim through the store.
    expect(replayedAt(fixture, 't1')[keyOf(COOLDOWN)]).toBeUndefined();
    expect(replayedAt(fixture, 't1')[keyOf(EPHEMERAL)]).toBeUndefined();
    expect(replayedAt(fixture, 't2')[keyOf(EPHEMERAL)]).toBeUndefined();
    expect(replayedAt(fixture, 's2')[keyOf(COOLDOWN)]).toBeUndefined();

    // The omen was spent on this line by s3, so s4's mention is refused — and
    // refused as `spent`, not as a missed match. This is the behaviour the
    // `fired` clause protects, seen from the retriever rather than the map: a
    // clause that only told zero from non-zero would have dropped s3's write,
    // left `fired` at one, and let s4 fire a third time.
    expect(node(fixture, 's4').retrieved.scan.skipped).toContainEqual(
      expect.objectContaining({
        entry: expect.objectContaining({ id: 'ephemeral' }),
        reason: 'spent',
      }),
    );

    // Each turn wrote exactly the counters that moved. Removing the no-op
    // filter outright is caught above, by the table, as keys that should be
    // absent holding zeros; what only this catches is the narrower fault of
    // rewriting a *present* key with its own value every turn, which replays
    // to the right state and bloats the log the whole way there.
    for (const name of NODE_NAMES) {
      expect(
        node(fixture, name).turn.effects.map((effect) => effect.scopeKey),
        name,
      ).toEqual(WRITES[name]);
    }

    // The store took the sibling appends without complaint — the head gate that
    // refuses a non-head parent lives in `state/jobs.ts`, not here — and the
    // head now points at s4.
    const file = await onDisk(fixture.sessionId);
    expect(file.headTurnId).toBe(node(fixture, 's4').turn.id);

    // And the snapshot is the replay at the head it names — [P6.0b], asserted
    // **at the fork rather than at the tip**, which is the whole subtlety.
    // Before P6.0b `advanceHead` folded each sibling onto the *previous head's*
    // map, so the file that s2 wrote carried t4's cooldown counter on a path
    // that never wrote one. By s4 the sibling line has written that key twice
    // itself and the file agrees with the replay again — so the same assertion
    // one node later passes the bug it was written to catch. This fixture is
    // also the only one whose stranded key is lore rather than a clock, and a
    // whole-value set of the clock lands on the same number whichever map it
    // folds onto.
    expect(fixture.fileAfterFork.headTurnId).toBe(node(fixture, 's2').turn.id);
    expect(fixture.fileAfterFork.channels).toEqual(replayedAt(fixture, 's2'));
  });

  it('answers the same through the snapshot cache, warm and with every one deleted', async () => {
    /**
     * [07 §4](../../../../docs/design/07-branching.md) asks CI for exactly this
     * — *replay-from-zero must equal snapshot-plus-replay at every index* — and
     * [P6 §3] step 6 asks for the other half: delete every snapshot and
     * everything still works, slower. Both are here rather than beside the
     * cache because this is the fixture whose effects are **lore**: a cache
     * that lost a scoped key would pass a clock-only comparison.
     *
     * `snapshotEvery` is two in this file, so a fixture four turns deep
     * exercises the cache at all. Ten — the shipped default — would leave every
     * path here below the interval and the comparison would be between a fold
     * and the same fold.
     */
    const fixture = await buildOnDisk();
    const root = snapshotsRoot(context.layout, ACCOUNT, fixture.sessionId);

    // Building the fixture already branched twice, and a branch append
    // reconstructs at its parent — so the cache is not empty before the first
    // assertion, which is the state a real session is in.
    expect((await listSnapshots(context.layout, ACCOUNT, fixture.sessionId)).size).toBeGreaterThan(
      0,
    );

    async function agreesEverywhere(when: string): Promise<void> {
      for (const name of NODE_NAMES) {
        const path = walkPath(fixture.turns, node(fixture, name).turn.id);
        const cached = await reconstructAlong(context, ACCOUNT, fixture.sessionId, path);
        expect(cached, `${name} ${when}`).toEqual(replayChannels(path));
      }
    }

    await agreesEverywhere('warm');
    await agreesEverywhere('warmer');

    await rm(root, { recursive: true, force: true });
    expect(await listSnapshots(context.layout, ACCOUNT, fixture.sessionId)).toEqual(new Set());

    // Slower, and identical. Then it fills again on its own.
    await agreesEverywhere('cold');
    expect((await listSnapshots(context.layout, ACCOUNT, fixture.sessionId)).size).toBeGreaterThan(
      0,
    );
  });
});

describe('over random trees', () => {
  /**
   * Up to ten turns, each choosing any earlier turn as its parent and any subset
   * of the three keys to say. Nothing touches disk: the point is *every index*
   * over shapes nobody drew, and the oracle is the pure timing fold rather than
   * a table — `retrieval/timing.test.ts`'s `play`, generalised to a tree. That
   * oracle shares `timing.ts` with the code under test, so a fault in the
   * counting itself is the table's to catch; what this adds is the walk and
   * the fold over every shape.
   */
  const KEYS = ['lighthouse', 'ferryman', 'omen'] as const;
  const shape = fc.array(fc.record({ parent: fc.nat({ max: 9 }), said: fc.subarray([...KEYS]) }), {
    minLength: 1,
    maxLength: 10,
  });

  it('replays what a forward fold of the timing rules predicts, at every node', () => {
    fc.assert(
      fc.property(shape, (steps) => {
        const played: Played[] = [];
        const turns = new Map<string, Turn>();
        const said = new Map<string, ReadonlySet<string>>();

        for (const [at, step] of steps.entries()) {
          const parent = at === 0 ? null : played[step.parent % at];
          if (parent === undefined) throw new Error('a parent index escaped its range');
          const text =
            step.said.length === 0 ? 'Nothing much.' : `The ${step.said.join(', the ')}.`;
          const next = playTurn('in-memory', parent, text, at);
          played.push(next);
          turns.set(next.turn.id, next.turn);
          said.set(next.turn.id, new Set(step.said));
        }

        for (const current of played) {
          const path = [...current.history, current.turn];
          const replayed = replayChannels(walkPath(turns, current.turn.id));

          expect(replayed).toEqual(current.state);
          expect(replayed[SE_CLOCK]?.value).toEqual({ day: 1, hour: 8, minute: 5 * path.length });

          for (const entry of ENTRIES) {
            // The test's own bookkeeping of what was said, so the oracle never
            // consults the matcher; and the verdict order in `timingVerdict`
            // is what makes `matched` irrelevant inside a window or a cooldown,
            // exactly as it is for the retriever.
            let timing = NO_TIMING;
            for (const [depth, turn] of path.entries()) {
              const matched = said.get(turn.id)?.has(entry.keys[0] ?? '') ?? false;
              const verdict = timingVerdict(entry, timing, { messagesSoFar: depth, matched });
              timing = advanceTiming(entry, timing, verdict);
            }
            // `timingOf` is sound as a reader here and nowhere else in this
            // file: `fired` only ever grows, so the fold predicts zeros exactly
            // when the entry never fired on the path — which is exactly when
            // the key is absent and the decoder's tolerance returns zeros.
            expect(timingOf(replayed[keyOf(entry)]?.value), entry.id).toEqual(timing);
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});
