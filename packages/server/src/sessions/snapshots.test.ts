// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { listEntryNames } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { walkPath } from './segments.js';
import { listSnapshots, readSnapshot, snapshotsRoot, writeSnapshot } from './snapshots.js';
import {
  appendTurnOnly,
  appendTurnToSession,
  createSession,
  readTurns,
  reconstructAlong,
  replayChannels,
  type SessionContext,
} from './store.js';
import type { ChannelEffect, Turn } from './types.js';

/**
 * The snapshot cache — [09 §4](../../../../docs/design/09-branching.md), [P6.0d].
 *
 * **Every test here is about a cache being invisible.** The only thing a
 * snapshot may change is how long a reconstruction takes, so the assertions
 * come in pairs: the cache does what it says (a file appears, the next read
 * starts from it), and the answer is the same as the fold it replaced —
 * including when the files are corrupt, foreign, or gone.
 *
 * The equality-at-every-index half lives in `reconstruct-property.test.ts`,
 * over a fixture whose effects are lore rather than a clock. This file is the
 * mechanism: where snapshots land, what a bad one does, and what the interval
 * is read from.
 */

const ACCOUNT = 'ned';
const CLOCK = 'se.clock';

let dataDir: string;
let index: OpenedIndex;
let context: SessionContext;
let every: number;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-snapshots-'));
  index = await openIndex({ path: ':memory:' });
  every = 3;
  context = {
    layout: new Layout(dataDir),
    index: index.db,
    // Read per call, which is what makes `sessions.snapshotEveryNTurns` live —
    // reassigning `every` below stands for a settings save.
    snapshotEvery: () => every,
  };
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

function clockEffect(turnId: string, hour: number): ChannelEffect {
  return {
    id: uuidv7(),
    turnId,
    channelId: CLOCK,
    scopeKey: null,
    op: { type: 'set', path: '/' },
    before: { hour: hour - 1 },
    after: { hour },
    proposedBy: { kind: 'engine' },
    applied: true,
    rejectedReason: null,
    supersedes: null,
    channelVersion: 1,
    scope: 'session',
  };
}

/**
 * A line of `count` turns, written with `appendTurnOnly`.
 *
 * The head is left where it was on purpose: this file is about the read path,
 * and `advanceHead` would fold each turn as it landed, which is the one thing
 * that would make a slow reconstruction unnecessary and the test vacuous.
 */
async function aLineOf(count: number): Promise<{ sessionId: string; turns: Turn[] }> {
  const session = await createSession(context, ACCOUNT, 'Rain City');
  const turns: Turn[] = [];
  let parent: string | null = null;

  for (let hour = 1; hour <= count; hour += 1) {
    const id = uuidv7();
    const turn: Turn = {
      id,
      sessionId: session.id,
      parentTurnId: parent,
      createdAt: new Date(Date.UTC(2026, 8, 2, 8, hour)).toISOString(),
      status: 'complete',
      effects: [clockEffect(id, hour)],
      tape: [],
    };
    await appendTurnOnly(context, ACCOUNT, session.id, turn);
    turns.push(turn);
    parent = id;
  }

  return { sessionId: session.id, turns };
}

async function pathTo(sessionId: string, turnId: string): Promise<Turn[]> {
  return walkPath(await readTurns(context, ACCOUNT, sessionId), turnId);
}

describe('reconstruction leaves a cache behind', () => {
  it('writes one every N turns of the suffix it replayed', async () => {
    const { sessionId, turns } = await aLineOf(7);

    expect(await listSnapshots(context.layout, ACCOUNT, sessionId)).toEqual(new Set());

    const at = await reconstructAlong(
      context,
      ACCOUNT,
      sessionId,
      await pathTo(sessionId, turns[6]!.id),
    );

    // Every third turn of the seven replayed: the third and the sixth. Not the
    // seventh — the rule bounds what the *next* reconstruction has to replay,
    // and the tip is one turn from the sixth.
    expect(await listSnapshots(context.layout, ACCOUNT, sessionId)).toEqual(
      new Set([turns[2]!.id, turns[5]!.id]),
    );
    expect(at[CLOCK]?.value).toEqual({ hour: 7 });
  });

  it('starts the next reconstruction from the deepest one it can use', async () => {
    const { sessionId, turns } = await aLineOf(7);
    const path = await pathTo(sessionId, turns[6]!.id);
    await reconstructAlong(context, ACCOUNT, sessionId, path);

    /**
     * *Where did you start* asked without a counter that exists for the test's
     * benefit: put a key in the deepest snapshot that no turn after it writes,
     * and see whether it is carried forward.
     *
     * **The clock cannot answer this**, which is the trap this phase has now
     * walked into three times: every turn sets it to a whole value, so the tip
     * reads the same number whether the fold started at the snapshot, at the
     * one before it, or at zero. A marker no effect touches is the only thing
     * that distinguishes them — the same reason a wrong parent map is invisible
     * to a clock-only fixture ([P6.0b]).
     */
    const marker = 'se.came-from-the-snapshot';
    await writeSnapshot(context.layout, ACCOUNT, sessionId, turns[5]!.id, {
      ...replayChannels(path.slice(0, 6)),
      [marker]: { version: 1, value: 'yes' },
    });

    const warm = await reconstructAlong(context, ACCOUNT, sessionId, path);
    expect(warm[marker]?.value).toBe('yes');
    // And the rest of the answer is unchanged, so the start point is the only
    // thing the marker proved.
    expect(warm[CLOCK]?.value).toEqual({ hour: 7 });

    // With the cache gone, the same call folds from zero and the marker is not
    // there to be carried — which is what makes the assertion above mean
    // something rather than describe a value the fold would produce anyway.
    await rm(snapshotsRoot(context.layout, ACCOUNT, sessionId), { recursive: true, force: true });
    const cold = await reconstructAlong(context, ACCOUNT, sessionId, path);
    expect(cold[marker]).toBeUndefined();
    expect(cold[CLOCK]?.value).toEqual({ hour: 7 });
  });
  it('is the same answer as the fold, with the cache warm and with it deleted', async () => {
    // Gate step 6 at store level: *delete every snapshot and everything still
    // works, slower*. The property test says the same thing at every index of a
    // forked session; this is the one-line version beside the mechanism.
    const { sessionId, turns } = await aLineOf(7);
    const path = await pathTo(sessionId, turns[6]!.id);
    const truth = replayChannels(path);

    expect(await reconstructAlong(context, ACCOUNT, sessionId, path)).toEqual(truth);
    expect(await reconstructAlong(context, ACCOUNT, sessionId, path)).toEqual(truth);

    await rm(snapshotsRoot(context.layout, ACCOUNT, sessionId), { recursive: true, force: true });

    expect(await reconstructAlong(context, ACCOUNT, sessionId, path)).toEqual(truth);
  });

  it('reads the interval per reconstruction, not once', async () => {
    // The store half of gate step 9. `snapshotEvery` is a closure precisely so
    // that a settings save changes the cadence of the *next* reconstruction;
    // the falsifying mutation is reading the number into a constant.
    const { sessionId, turns } = await aLineOf(6);
    const path = await pathTo(sessionId, turns[5]!.id);

    every = 2;
    await reconstructAlong(context, ACCOUNT, sessionId, path);
    expect(await listSnapshots(context.layout, ACCOUNT, sessionId)).toEqual(
      new Set([turns[1]!.id, turns[3]!.id, turns[5]!.id]),
    );

    await rm(snapshotsRoot(context.layout, ACCOUNT, sessionId), { recursive: true, force: true });

    every = 5;
    await reconstructAlong(context, ACCOUNT, sessionId, path);
    expect(await listSnapshots(context.layout, ACCOUNT, sessionId)).toEqual(
      new Set([turns[4]!.id]),
    );
  });
});

describe('a snapshot that cannot be trusted is a miss', () => {
  it('folds from zero when the file is not JSON', async () => {
    const { sessionId, turns } = await aLineOf(4);
    const path = await pathTo(sessionId, turns[3]!.id);
    await reconstructAlong(context, ACCOUNT, sessionId, path);

    const held = [...(await listSnapshots(context.layout, ACCOUNT, sessionId))];
    expect(held).toHaveLength(1);
    await writeFile(
      join(snapshotsRoot(context.layout, ACCOUNT, sessionId), `${held[0]!}.json`),
      'not json at all',
    );

    // The falsifying mutation is letting the parse throw: a derived file going
    // bad would take the session's whole read path with it.
    expect(await reconstructAlong(context, ACCOUNT, sessionId, path)).toEqual(replayChannels(path));
  });

  it('refuses one whose turn id is not the one in its name', async () => {
    const { sessionId, turns } = await aLineOf(4);
    const path = await pathTo(sessionId, turns[3]!.id);

    // A copied file — the shape a person makes by duplicating a snapshot, and
    // the one that would otherwise hand one node's state to another. The marker
    // is what would show if it were believed: nothing else in this session
    // writes that key.
    const marker = 'se.came-from-the-copy';
    await writeSnapshot(context.layout, ACCOUNT, sessionId, turns[0]!.id, {
      [marker]: { version: 1, value: 'yes' },
    });
    const root = snapshotsRoot(context.layout, ACCOUNT, sessionId);
    const copied = await readFile(join(root, `${turns[0]!.id}.json`), 'utf8');
    await rm(join(root, `${turns[0]!.id}.json`));
    await writeFile(join(root, `${turns[2]!.id}.json`), copied);

    expect(await readSnapshot(context.layout, ACCOUNT, sessionId, turns[2]!.id)).toBeNull();

    // Refused rather than believed, so the fold runs from zero and the marker
    // never appears. The falsifying mutation is dropping the id check, which
    // makes a duplicated file silently authoritative for another node.
    const at = await reconstructAlong(context, ACCOUNT, sessionId, path);
    expect(at[marker]).toBeUndefined();
    expect(at).toEqual(replayChannels(path));
  });
});

describe('a fork gets a snapshot the moment it becomes one', () => {
  it('writes at the parent when a second child lands', async () => {
    // [09 §4]'s cheap win: a node with several children is one whose state will
    // be materialised once per sibling explored. The falsifying mutation is
    // dropping the sibling count, which makes every branch append pay the whole
    // walk again.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const first = uuidv7();
    await appendTurnToSession(context, ACCOUNT, session.id, {
      id: first,
      sessionId: session.id,
      parentTurnId: null,
      createdAt: new Date(Date.UTC(2026, 8, 2, 8, 1)).toISOString(),
      status: 'complete',
      effects: [clockEffect(first, 1)],
      tape: [],
    });

    const second = uuidv7();
    await appendTurnToSession(context, ACCOUNT, session.id, {
      id: second,
      sessionId: session.id,
      parentTurnId: first,
      createdAt: new Date(Date.UTC(2026, 8, 2, 8, 2)).toISOString(),
      status: 'complete',
      effects: [clockEffect(second, 2)],
      tape: [],
    });

    // A line of two, and nothing has forked: the head path writes no snapshot.
    expect(await listSnapshots(context.layout, ACCOUNT, session.id)).toEqual(new Set());

    const sibling = uuidv7();
    await appendTurnToSession(context, ACCOUNT, session.id, {
      id: sibling,
      sessionId: session.id,
      parentTurnId: first,
      createdAt: new Date(Date.UTC(2026, 8, 2, 8, 3)).toISOString(),
      status: 'complete',
      effects: [clockEffect(sibling, 50)],
      tape: [],
    });

    expect(await listSnapshots(context.layout, ACCOUNT, session.id)).toEqual(new Set([first]));
    expect(await readSnapshot(context.layout, ACCOUNT, session.id, first)).toEqual({
      [CLOCK]: { version: 1, value: { hour: 1 } },
    });
  });

  it('writes nothing for the first child of a node', async () => {
    const { sessionId, turns } = await aLineOf(2);
    expect(turns).toHaveLength(2);
    expect(await listEntryNames(snapshotsRoot(context.layout, ACCOUNT, sessionId))).toEqual([]);
  });
});

describe('a long line, which is what the cache is for', () => {
  /**
   * [P6 §3] step 14's cost bound, asserted as a **bound on work** rather than
   * as a wall-clock number: reconstruct at depth two hundred against an effect
   * log the size P5 made ordinary, and the second reconstruction replays
   * nothing, because the deepest snapshot is the node itself.
   *
   * Wall-clock is left to the gate walk on purpose. *A time a person would
   * accept* is a judgement about a machine, and a CI assertion about it is a
   * flake waiting for a busy runner — whereas *the fold ran over N turns rather
   * than two hundred* is the property the cache actually promises, and it fails
   * loudly when the cache stops working.
   */
  it('replays nothing the second time, at depth two hundred', async () => {
    const depth = 200;
    const entries = 25;
    const session = await createSession(context, ACCOUNT, 'Rain City');
    let parent: string | null = null;
    let last = '';

    for (let at = 1; at <= depth; at += 1) {
      const id = uuidv7();
      // One clock effect and twenty-five entry-scoped timing effects, which is
      // what a turn against a real book writes — `retrieve` filters to entries
      // whose counters moved, and this is that filter's output rather than a
      // whole library.
      const effects: ChannelEffect[] = [clockEffect(id, at)];
      for (let entry = 0; entry < entries; entry += 1) {
        effects.push({
          ...clockEffect(id, at),
          channelId: 'se.lore.timing',
          scopeKey: `entry-${String(entry)}`,
          before: null,
          after: { sticky: 0, cooldown: at % 4, fired: at },
        });
      }
      await appendTurnOnly(context, ACCOUNT, session.id, {
        id,
        sessionId: session.id,
        parentTurnId: parent,
        createdAt: new Date(Date.UTC(2026, 8, 2, 8, 0, at)).toISOString(),
        status: 'complete',
        effects,
        tape: [],
      });
      parent = id;
      last = id;
    }

    every = 10;
    const path = await pathTo(session.id, last);
    expect(path).toHaveLength(depth);

    const cold = await reconstructAlong(context, ACCOUNT, session.id, path);
    expect(cold).toEqual(replayChannels(path));

    // Twenty snapshots, and the deepest is the tip — so the next reconstruction
    // starts where it wants to end.
    const held = await listSnapshots(context.layout, ACCOUNT, session.id);
    expect(held.size).toBe(depth / every);
    expect(held.has(last)).toBe(true);

    // Proved rather than assumed: a marker in the tip's snapshot that no effect
    // writes comes back only if the fold started there and replayed nothing.
    const marker = 'se.replayed-nothing';
    await writeSnapshot(context.layout, ACCOUNT, session.id, last, {
      ...cold,
      [marker]: { version: 1, value: 'yes' },
    });

    const warm = await reconstructAlong(context, ACCOUNT, session.id, path);
    expect(warm[marker]?.value).toBe('yes');
    expect(warm[CLOCK]?.value).toEqual({ hour: depth });
    expect(warm['se.lore.timing#entry-24']?.value).toEqual({
      sticky: 0,
      cooldown: depth % 4,
      fired: depth,
    });
  }, 30_000);
});
