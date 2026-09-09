// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { Layout } from '../storage/layout.js';
import { walkPath } from './segments.js';
import {
  appendTurnToSession,
  createSession,
  moveHead,
  readSession,
  readTurns,
  replayChannels,
  undoTurn,
  type SessionContext,
} from './store.js';
import type { ChannelEffect, SessionFile, Turn } from './types.js';

/**
 * Undo, and state that differs per line — [§1.4], [21 §1.2.1], [P6 §3] steps 4,
 * 5 and 10, [P6.3].
 *
 * **The refusal is the feature.** `before` is an inverse only while nothing has
 * touched the same key since; applying it otherwise destroys the later change
 * and produces a state no turn ever wrote — plausibly, which is what makes it
 * worth a check rather than a warning. What the refusal offers is the thing
 * this phase spent four stages making cheap: branch from before it.
 */

const ACCOUNT = 'ned';
const CLOCK = 'se.clock';

let dataDir: string;
let index: OpenedIndex;
let context: SessionContext;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-undo-'));
  index = await openIndex({ path: ':memory:' });
  context = { layout: new Layout(dataDir), index: index.db };
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

/** One effect, spelled out — these fixtures care about `before` and `after`. */
function effect(
  turnId: string,
  channelId: string,
  scopeKey: string | null,
  before: unknown,
  after: unknown,
  over: Partial<ChannelEffect> = {},
): ChannelEffect {
  return {
    id: uuidv7(),
    turnId,
    channelId,
    scopeKey,
    op: { type: 'set', path: '/' },
    before,
    after,
    proposedBy: { kind: 'engine' },
    applied: true,
    rejectedReason: null,
    supersedes: null,
    channelVersion: 1,
    scope: 'session',
    ...over,
  };
}

async function append(
  sessionId: string,
  parentTurnId: string | null,
  make: (turnId: string) => ChannelEffect[],
): Promise<string> {
  const id = uuidv7();
  await appendTurnToSession(context, ACCOUNT, sessionId, {
    id,
    sessionId,
    parentTurnId,
    createdAt: new Date(Date.UTC(2026, 8, 2, 9, 0, 0)).toISOString(),
    status: 'complete',
    effects: make(id),
    tape: [],
  });
  return id;
}

async function onDisk(sessionId: string): Promise<SessionFile> {
  const found = await readSession(context, ACCOUNT, sessionId);
  if (found === null) throw new Error('the session went missing');
  return found;
}

async function pathOf(sessionId: string): Promise<Turn[]> {
  const session = await onDisk(sessionId);
  return walkPath(await readTurns(context, ACCOUNT, sessionId), session.headTurnId);
}

describe('undoing the tip', () => {
  it('applies `before`, as its own turn, attributed to the person', async () => {
    // Gate step 4's first half. The undo is an append rather than an erasure:
    // a segment is never rewritten ([03 §5.5]), so the record says a person
    // undid something instead of quietly lacking it.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const first = await append(session.id, null, (id) => [
      effect(id, CLOCK, null, null, { hour: 1 }),
    ]);
    const second = await append(session.id, first, (id) => [
      effect(id, CLOCK, null, { hour: 1 }, { hour: 2 }),
    ]);

    const outcome = await undoTurn(context, ACCOUNT, session.id, second);
    expect(outcome.kind).toBe('undone');

    const file = await onDisk(session.id);
    expect(file.channels[CLOCK]?.value).toEqual({ hour: 1 });
    // Local: the value came off the effect rather than out of a replay, and
    // the turn that wrote it is still on the record.
    expect((await readTurns(context, ACCOUNT, session.id)).has(second)).toBe(true);

    const tip = (await pathOf(session.id)).at(-1);
    expect(tip?.effects[0]?.proposedBy).toEqual({ kind: 'user' });
    expect(tip?.effects[0]?.before).toEqual({ hour: 2 });
    expect(tip?.effects[0]?.after).toEqual({ hour: 1 });
    // And the snapshot is still the replay, which is the invariant every
    // reader of this file depends on.
    expect(file.channels).toEqual(replayChannels(await pathOf(session.id)));
  });

  it('deletes a key the turn created rather than setting it to null', async () => {
    // `acceptEffect` stamps `before: null` both for a key that held null and
    // for one that did not exist. Setting null back would leave the key present
    // holding null — for a timing counter, the difference between *never fired*
    // and *fired, and the record of it is broken*.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const first = await append(session.id, null, (id) => [
      effect(id, CLOCK, null, null, { hour: 1 }),
    ]);
    const second = await append(session.id, first, (id) => [
      effect(id, 'se.lore.timing', 'ferryman', null, { sticky: 0, cooldown: 2, fired: 1 }),
    ]);

    await undoTurn(context, ACCOUNT, session.id, second);

    const file = await onDisk(session.id);
    expect(file.channels['se.lore.timing#ferryman']).toBeUndefined();
    expect('se.lore.timing#ferryman' in file.channels).toBe(false);
  });

  it('restores the state the turn began from when it wrote a key twice', async () => {
    // `acceptEffect` chains within a turn, so the second effect's `before` is
    // the first one's `after`. The earliest is the only one that names what the
    // turn started from, and using the latest would undo half a turn.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const first = await append(session.id, null, (id) => [
      effect(id, CLOCK, null, null, { hour: 1 }),
    ]);
    const twice = await append(session.id, first, (id) => [
      effect(id, CLOCK, null, { hour: 1 }, { hour: 2 }),
      effect(id, CLOCK, null, { hour: 2 }, { hour: 3 }),
    ]);

    await undoTurn(context, ACCOUNT, session.id, twice);

    expect((await onDisk(session.id)).channels[CLOCK]?.value).toEqual({ hour: 1 });
  });

  it('is itself undoable, because the inverse is an ordinary effect', async () => {
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const first = await append(session.id, null, (id) => [
      effect(id, CLOCK, null, null, { hour: 1 }),
    ]);
    const second = await append(session.id, first, (id) => [
      effect(id, CLOCK, null, { hour: 1 }, { hour: 2 }),
    ]);

    const undone = await undoTurn(context, ACCOUNT, session.id, second);
    if (undone.kind !== 'undone') throw new Error('expected an undo');
    const redone = await undoTurn(context, ACCOUNT, session.id, undone.turn.id);

    expect(redone.kind).toBe('undone');
    expect((await onDisk(session.id)).channels[CLOCK]?.value).toEqual({ hour: 2 });
  });
});

describe('undoing anything deeper', () => {
  it('is refused, and the refusal offers the branch', async () => {
    // Gate step 4's second half, and [21 §1.2.1]'s worked case: HP goes 10 → 8
    // at turn N and 8 → 5 later, so applying N's `before: 10` now destroys the
    // later change and produces a state no turn ever wrote. **The falsifying
    // mutation is applying it anyway**, which leaves a plausible number and
    // surfaces nothing.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const first = await append(session.id, null, (id) => [
      effect(id, 'se.hp', 'vera', { hp: 10 }, { hp: 8 }),
    ]);
    const second = await append(session.id, first, (id) => [
      effect(id, 'se.hp', 'vera', { hp: 8 }, { hp: 5 }),
    ]);

    const refused = await undoTurn(context, ACCOUNT, session.id, first);

    expect(refused.kind).toBe('not-at-tip');
    expect(refused.kind === 'not-at-tip' && refused.keys).toEqual(['se.hp#vera']);
    // Where to go instead: the node before the turn somebody wanted to undo,
    // which is a branch point this phase made a one-request gesture.
    expect(refused.kind === 'not-at-tip' && refused.branchFrom).toBeNull();
    // Nothing was written. The state is what the later turn left.
    expect((await onDisk(session.id)).channels['se.hp#vera']?.value).toEqual({ hp: 5 });
    expect(second).not.toBe(first);
  });

  it('allows a deeper turn whose keys nothing has touched since', async () => {
    // *Tip* is per key, not per turn — [21 §1.2.1]'s rule is that `before` is
    // an inverse while nothing has written the same key, and a later turn on a
    // different channel has not.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const first = await append(session.id, null, (id) => [
      effect(id, 'se.hp', 'vera', { hp: 10 }, { hp: 8 }),
    ]);
    await append(session.id, first, (id) => [effect(id, CLOCK, null, null, { hour: 1 })]);

    const outcome = await undoTurn(context, ACCOUNT, session.id, first);

    expect(outcome.kind).toBe('undone');
    const file = await onDisk(session.id);
    expect(file.channels['se.hp#vera']?.value).toEqual({ hp: 10 });
    // And the untouched channel is untouched.
    expect(file.channels[CLOCK]?.value).toEqual({ hour: 1 });
  });

  it('refuses a turn that is not on the line the head is on', async () => {
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const first = await append(session.id, null, (id) => [
      effect(id, CLOCK, null, null, { hour: 1 }),
    ]);
    const abandoned = await append(session.id, first, (id) => [
      effect(id, CLOCK, null, { hour: 1 }, { hour: 2 }),
    ]);
    await append(session.id, first, (id) => [effect(id, CLOCK, null, { hour: 1 }, { hour: 50 })]);

    // The head is on the sibling now; inverting the other line's turn would
    // write its `before` into a line it was never on.
    expect((await undoTurn(context, ACCOUNT, session.id, abandoned)).kind).toBe('off-path');
    expect((await undoTurn(context, ACCOUNT, session.id, uuidv7())).kind).toBe('no-turn');
  });

  it('never inverts an escaped effect, and says there was nothing to undo', async () => {
    // [07 §7]: a library write or a generated asset left the session, and
    // pretending a branch can un-write it would be worse than saying it cannot.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const escaped = await append(session.id, null, (id) => [
      effect(
        id,
        'se.library.writes',
        null,
        null,
        { wrote: 'an actor card' },
        {
          scope: 'escaped',
        },
      ),
    ]);

    expect((await undoTurn(context, ACCOUNT, session.id, escaped)).kind).toBe('nothing-to-undo');
    // And it is still on the record, which is the honesty half.
    const tip = (await pathOf(session.id)).at(-1);
    expect(tip?.effects[0]?.scope).toBe('escaped');
  });
});

describe('state differs per line', () => {
  it('leaves a character dead on one line and alive on the other — gate step 5', async () => {
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const fork = await append(session.id, null, (id) => [
      effect(id, 'se.actor', 'vera', null, { alive: true }),
    ]);
    const killed = await append(session.id, fork, (id) => [
      effect(id, 'se.actor', 'vera', { alive: true }, { alive: false }),
    ]);
    const spared = await append(session.id, fork, (id) => [
      effect(id, CLOCK, null, null, { hour: 1 }),
    ]);

    const turns = await readTurns(context, ACCOUNT, session.id);
    expect(replayChannels(walkPath(turns, killed))['se.actor#vera']?.value).toEqual({
      alive: false,
    });
    expect(replayChannels(walkPath(turns, spared))['se.actor#vera']?.value).toEqual({
      alive: true,
    });

    // And through the head, which is the way a person meets it.
    await moveHead(context, ACCOUNT, session.id, spared);
    expect((await onDisk(session.id)).channels['se.actor#vera']?.value).toEqual({ alive: true });
    await moveHead(context, ACCOUNT, session.id, killed);
    expect((await onDisk(session.id)).channels['se.actor#vera']?.value).toEqual({ alive: false });
  });

  it('keeps sticky, cooldown and ephemeral off a sibling that branched first — gate step 10', async () => {
    // The step, extended past sticky as [P6 §2] asks. All three activate
    // *after* the fork, so a sibling that left before them must have none of
    // them — and `ephemeral` is the one whose absence is least visible, since a
    // spent entry that looks unspent simply fires again.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const fork = await append(session.id, null, (id) => [
      effect(id, CLOCK, null, null, { hour: 1 }),
    ]);
    const activated = await append(session.id, fork, (id) => [
      effect(id, 'se.lore.timing', 'sticky', null, { sticky: 2, cooldown: 0, fired: 1 }),
      effect(id, 'se.lore.timing', 'cooldown', null, { sticky: 0, cooldown: 3, fired: 1 }),
      effect(id, 'se.lore.timing', 'ephemeral', null, { sticky: 0, cooldown: 0, fired: 1 }),
    ]);
    const sibling = await append(session.id, fork, (id) => [
      effect(id, CLOCK, null, { hour: 1 }, { hour: 2 }),
    ]);

    const turns = await readTurns(context, ACCOUNT, session.id);
    const onLine = replayChannels(walkPath(turns, activated));
    const onSibling = replayChannels(walkPath(turns, sibling));

    for (const entry of ['sticky', 'cooldown', 'ephemeral']) {
      expect(onLine[`se.lore.timing#${entry}`]).toBeDefined();
      // Absent, not zeroed: a decoder reads a missing key as zeros, so the
      // assertion has to be about the key rather than about its value.
      expect(onSibling[`se.lore.timing#${entry}`]).toBeUndefined();
    }

    // This holds by construction through [P6.0b] — if it ever fails, the bug is
    // in this phase's reconstruction rather than in P5's key, which is a useful
    // thing to know before debugging.
    await moveHead(context, ACCOUNT, session.id, sibling);
    expect((await onDisk(session.id)).channels['se.lore.timing#ephemeral']).toBeUndefined();
  });
});
