// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { Layout } from '../storage/layout.js';
import { advance, clockEffect, readClock, SE_CLOCK } from './channels.js';
import { walkPath } from './segments.js';
import {
  appendTurnToSession,
  applyEffects,
  createSession,
  readSession,
  readTurns,
  reconcileHandEdits,
  replayChannels,
  type SessionContext,
} from './store.js';
import type { SessionFile, Turn } from './types.js';

/**
 * `se.clock` and the hand-edit rule — [P2 §2.7], [02 §8.1].
 *
 * The claim under test is the one that makes the head snapshot safe to keep in
 * a file people can open: **a hand edit is an intent, not corruption.** Get it
 * wrong in one direction and the edit silently vanishes on the next turn; wrong
 * in the other and the snapshot becomes authoritative, which is the branching
 * failure [09 §5.1] rules out arriving by a different door.
 */

let dataDir: string;
let index: OpenedIndex;
let context: SessionContext;
let session: SessionFile;

const ACCOUNT = 'ned';

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-channels-'));
  index = await openIndex({ path: ':memory:' });
  context = { layout: new Layout(dataDir), index: index.db };
  session = await createSession(context, ACCOUNT, 'Rain City');
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

function sessionFile(): string {
  return join(context.layout.sessionRoot(ACCOUNT, session.id), 'session.json');
}

async function onDisk(): Promise<SessionFile> {
  const found = await readSession(context, ACCOUNT, session.id);
  if (found === null) throw new Error('the session went missing');
  return found;
}

/** One ordinary turn, with the clock effect the engine computes for it. */
async function turn(parentTurnId: string | null): Promise<Turn> {
  const current = await onDisk();
  const id = uuidv7();
  const record: Turn = {
    id,
    sessionId: session.id,
    parentTurnId,
    createdAt: new Date(Date.UTC(2026, 7, 16, 12)).toISOString(),
    status: 'complete',
    effects: [clockEffect(id, current.channels)],
    tape: [],
  };
  await appendTurnToSession(context, ACCOUNT, session.id, record);
  return record;
}

describe('the clock', () => {
  it('carries minutes into hours and days', () => {
    expect(advance({ day: 1, hour: 8, minute: 0 }, 5)).toEqual({ day: 1, hour: 8, minute: 5 });
    expect(advance({ day: 1, hour: 23, minute: 58 }, 5)).toEqual({ day: 2, hour: 0, minute: 3 });
    expect(advance({ day: 1, hour: 0, minute: 0 }, 24 * 60 * 3)).toEqual({
      day: 4,
      hour: 0,
      minute: 0,
    });
  });

  it('advances every turn, engine-attributed', async () => {
    await turn(null);
    const second = await turn((await onDisk()).headTurnId);

    expect(readClock((await onDisk()).channels)).toEqual({ day: 1, hour: 8, minute: 10 });
    expect(second.effects[0]?.proposedBy).toEqual({ kind: 'engine' });
    // Stored rather than derived, which is what makes undoing the tip an apply
    // rather than a replay of 0..N−1 ([13 §1.2]).
    expect(second.effects[0]?.before).toEqual({ day: 1, hour: 8, minute: 5 });
  });

  it('starts from the same place whether replayed or read', async () => {
    await turn(null);
    await turn((await onDisk()).headTurnId);

    const file = await onDisk();
    const turns = await readTurns(context, ACCOUNT, session.id);
    // The head snapshot is derived, and this is the thing it is derived from.
    expect(replayChannels(walkPath(turns, file.headTurnId))).toEqual(file.channels);
  });
});

describe('a hand edit lands as a user-attributed effect', () => {
  /** Opens `session.json` in a text editor, so to speak, and changes the clock. */
  async function editTheClockOnDisk(value: unknown): Promise<void> {
    const file = JSON.parse(await readFile(sessionFile(), 'utf8')) as SessionFile;
    file.channels[SE_CLOCK] = { version: 1, value };
    await writeFile(sessionFile(), JSON.stringify(file, null, 2));
  }

  it('appends a turn carrying the edit, attributed to the user', async () => {
    await turn(null);
    const headBefore = (await onDisk()).headTurnId;

    // "It should be evening by now."
    await editTheClockOnDisk({ day: 1, hour: 19, minute: 30 });

    const effects = await reconcileHandEdits(context, ACCOUNT, session.id);

    expect(effects).toHaveLength(1);
    expect(effects[0]?.channelId).toBe(SE_CLOCK);
    expect(effects[0]?.proposedBy).toEqual({ kind: 'user' });
    // `before` is what the log said was true, which is what makes the effect
    // reversible into a state the log agrees with.
    expect(effects[0]?.before).toEqual({ day: 1, hour: 8, minute: 5 });
    expect(effects[0]?.after).toEqual({ day: 1, hour: 19, minute: 30 });

    // A turn of its own, because a segment is append-only and the head turn's
    // line cannot be rewritten to carry somebody's edit.
    const file = await onDisk();
    expect(file.headTurnId).not.toBe(headBefore);
    const turns = await readTurns(context, ACCOUNT, session.id);
    expect(turns.get(file.headTurnId ?? '')?.parentTurnId).toBe(headBefore);
  });

  it('makes the edit survive the next replay, which is the whole point', async () => {
    await turn(null);
    await editTheClockOnDisk({ day: 1, hour: 19, minute: 30 });
    await reconcileHandEdits(context, ACCOUNT, session.id);

    // Delete the snapshot's authority entirely and rebuild from the log: the
    // edit is still there, because it is *in* the log now.
    const file = await onDisk();
    const turns = await readTurns(context, ACCOUNT, session.id);
    expect(readClock(replayChannels(walkPath(turns, file.headTurnId)))).toEqual({
      day: 1,
      hour: 19,
      minute: 30,
    });
  });

  it('keeps advancing from the edited value, not the one it replaced', async () => {
    await turn(null);
    await editTheClockOnDisk({ day: 1, hour: 19, minute: 30 });
    await reconcileHandEdits(context, ACCOUNT, session.id);

    await turn((await onDisk()).headTurnId);

    expect(readClock((await onDisk()).channels)).toEqual({ day: 1, hour: 19, minute: 35 });
  });

  it('is reversible like any other effect', async () => {
    await turn(null);
    await editTheClockOnDisk({ day: 1, hour: 19, minute: 30 });
    const [effect] = await reconcileHandEdits(context, ACCOUNT, session.id);
    if (!effect) throw new Error('expected an effect');

    // Undoing the tip is applying `before` — no replay from zero.
    const undone = applyEffects((await onDisk()).channels, [
      { ...effect, op: { type: 'set', path: '/' }, before: effect.after, after: effect.before },
    ]);
    expect(readClock(undone)).toEqual({ day: 1, hour: 8, minute: 5 });
  });

  it('does nothing when the file and the log agree', async () => {
    await turn(null);
    const before = await onDisk();

    expect(await reconcileHandEdits(context, ACCOUNT, session.id)).toEqual([]);

    // Not even a touch: an ordinary load must not append a turn.
    expect(await onDisk()).toEqual(before);
  });

  it('records a channel deleted from the file as a delete', async () => {
    // The one divergence a re-derive-and-overwrite would read as "nothing
    // changed", and it is as much an intent as an edit.
    await turn(null);
    const file = JSON.parse(await readFile(sessionFile(), 'utf8')) as SessionFile;
    // Rebuilt without the key rather than deleted from — the same shape
    // `applyEffects` uses, and for the same reason the rule bans the other one.
    const { [SE_CLOCK]: removed, ...rest } = file.channels;
    void removed;
    await writeFile(sessionFile(), JSON.stringify({ ...file, channels: rest }, null, 2));

    const [effect] = await reconcileHandEdits(context, ACCOUNT, session.id);

    expect(effect?.op).toEqual({ type: 'delete', path: '/' });
    expect(effect?.proposedBy).toEqual({ kind: 'user' });
    expect((await onDisk()).channels[SE_CLOCK]).toBeUndefined();
  });

  it('heals a divergence nobody intended, visibly', async () => {
    // If the snapshot drifted because of a bug rather than a person, the same
    // mechanism turns it into an effect somebody can inspect — instead of
    // letting it persist silently, which is the failure mode that costs a
    // week to diagnose.
    await turn(null);
    await editTheClockOnDisk({ day: 400, hour: 3, minute: 0 });

    const effects = await reconcileHandEdits(context, ACCOUNT, session.id);

    expect(effects).toHaveLength(1);
    const turns = await readTurns(context, ACCOUNT, session.id);
    const head = turns.get((await onDisk()).headTurnId ?? '');
    // Visible in the turn record, which is where the workbench will show it.
    expect(head?.effects[0]?.after).toEqual({ day: 400, hour: 3, minute: 0 });
  });
});
