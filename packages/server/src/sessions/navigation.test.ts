// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { Layout } from '../storage/layout.js';
import {
  appendTurnToSession,
  createBranchRef,
  createSession,
  deleteBranchRef,
  moveHead,
  readSession,
  readTurns,
  renameBranchRef,
  resumeFrom,
  type SessionContext,
} from './store.js';
import type { ChannelEffect, SessionFile } from './types.js';

/**
 * Navigation — [09 §3](../../../../docs/design/09-branching.md), [P6.1].
 *
 * **Moving the head is the first gesture that is not a turn**, and the two
 * claims under it are the ones the tree model rests on: the state at the new
 * head is *reconstructed there* rather than carried from wherever the head
 * happened to be, and nothing else moves. A `BranchRef` is a name; deleting one
 * deletes a name.
 *
 * The fixture writes a key on one line that the other never writes, because a
 * clock cannot tell these apart — every turn sets it to a whole value, so a
 * head that folded the wrong map still reads the right number. That is the
 * same trap [P6.0b] and [P6.0d] each hit once.
 */

const ACCOUNT = 'ned';
const CLOCK = 'se.clock';
const STRANDED = 'se.lore.timing#ferryman';

let dataDir: string;
let index: OpenedIndex;
let context: SessionContext;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-navigation-'));
  index = await openIndex({ path: ':memory:' });
  context = { layout: new Layout(dataDir), index: index.db };
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

/** A turn, optionally carrying the key only one line writes. */
async function append(
  sessionId: string,
  parentTurnId: string | null,
  hour: number,
  stranded = false,
): Promise<string> {
  const id = uuidv7();
  const effects = [clockEffect(id, hour)];
  if (stranded) {
    effects.push({
      ...clockEffect(id, hour),
      channelId: 'se.lore.timing',
      scopeKey: 'ferryman',
      before: null,
      after: { sticky: 0, cooldown: 2, fired: 1 },
    });
  }
  await appendTurnToSession(context, ACCOUNT, sessionId, {
    id,
    sessionId,
    parentTurnId,
    createdAt: new Date(Date.UTC(2026, 8, 2, 8, hour)).toISOString(),
    status: 'complete',
    effects,
    tape: [],
  });
  return id;
}

async function onDisk(sessionId: string): Promise<SessionFile> {
  const found = await readSession(context, ACCOUNT, sessionId);
  if (found === null) throw new Error('the session went missing');
  return found;
}

/**
 * A fork: a main line whose second turn writes the stranded key, and a sibling
 * of the first turn that never does. The head ends on the sibling.
 */
async function aFork(): Promise<{ sessionId: string; t1: string; t2: string; s2: string }> {
  const session = await createSession(context, ACCOUNT, 'Rain City');
  const t1 = await append(session.id, null, 1);
  const t2 = await append(session.id, t1, 2, true);
  const s2 = await append(session.id, t1, 50);
  return { sessionId: session.id, t1, t2, s2 };
}

describe('the head can be moved to any node', () => {
  it('re-derives the state there rather than carrying the state it had', async () => {
    // Proof obligation (i), and the first consumer of [P6.0b]: `advanceHead`
    // folds a turn's effects onto its parent's map, which is meaningless for a
    // head that did not arrive by a turn being taken. The falsifying mutation
    // is keeping the session's channels and writing only `headTurnId`.
    const { sessionId, t2, s2 } = await aFork();
    expect((await onDisk(sessionId)).headTurnId).toBe(s2);

    const toMain = await moveHead(context, ACCOUNT, sessionId, t2);
    expect(toMain.kind).toBe('moved');
    const onMain = await onDisk(sessionId);
    expect(onMain.headTurnId).toBe(t2);
    expect(onMain.channels[CLOCK]?.value).toEqual({ hour: 2 });
    expect(onMain.channels[STRANDED]?.value).toEqual({ sticky: 0, cooldown: 2, fired: 1 });

    // Back to the line that never wrote it. The clock alone would pass either
    // way; the absent key is the assertion.
    await moveHead(context, ACCOUNT, sessionId, s2);
    const onBranch = await onDisk(sessionId);
    expect(onBranch.headTurnId).toBe(s2);
    expect(onBranch.channels[CLOCK]?.value).toEqual({ hour: 50 });
    expect(onBranch.channels[STRANDED]).toBeUndefined();
  });

  it('moves no turn data', async () => {
    const { sessionId, t2 } = await aFork();
    const before = await readTurns(context, ACCOUNT, sessionId);

    await moveHead(context, ACCOUNT, sessionId, t2);

    const after = await readTurns(context, ACCOUNT, sessionId);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [id, turn] of before) expect(after.get(id)).toEqual(turn);
  });

  it('refuses a node that is not a turn of this session', async () => {
    const { sessionId } = await aFork();
    expect((await moveHead(context, ACCOUNT, sessionId, uuidv7())).kind).toBe('no-turn');

    // A real turn, in somebody else's session: the read is scoped, so this is
    // the ownership boundary rather than a lookup miss.
    const other = await createSession(context, ACCOUNT, 'Another city');
    const theirs = await append(other.id, null, 1);
    expect((await moveHead(context, ACCOUNT, sessionId, theirs)).kind).toBe('no-turn');
    expect((await moveHead(context, ACCOUNT, uuidv7(), theirs)).kind).toBe('no-session');
  });
});

describe('back and forward resumes rather than guesses', () => {
  it('remembers the whole path it moved to, not just the tip', async () => {
    // Proof obligation (v). Recording only the new head's parent would answer
    // *forward* once and guess after that, which is the falsifying mutation.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const t1 = await append(session.id, null, 1);
    const t2 = await append(session.id, t1, 2);
    const t3 = await append(session.id, t2, 3);
    const s2 = await append(session.id, t1, 50);

    await moveHead(context, ACCOUNT, session.id, t3);
    expect((await onDisk(session.id)).lastSelectedChild).toEqual({ [t1]: t2, [t2]: t3 });

    // Walk back to the fork. The memory of what was below it survives, which
    // is the whole point — the map is only written for the path moved *to*.
    await moveHead(context, ACCOUNT, session.id, t1);
    const back = await onDisk(session.id);
    expect(back.headTurnId).toBe(t1);
    expect(back.lastSelectedChild?.[t1]).toBe(t2);

    // Forward again lands where it was, two levels down.
    const forward = await moveHead(context, ACCOUNT, session.id, t1, { resume: true });
    expect(forward.kind === 'moved' && forward.session.headTurnId).toBe(t3);

    // And after visiting the sibling, forward from the fork follows the new
    // choice rather than the old one.
    await moveHead(context, ACCOUNT, session.id, s2);
    await moveHead(context, ACCOUNT, session.id, t1);
    const again = await moveHead(context, ACCOUNT, session.id, t1, { resume: true });
    expect(again.kind === 'moved' && again.session.headTurnId).toBe(s2);
  });

  it('follows the only child, which is not a guess', async () => {
    // A session that has never branched has an empty map, and forward still
    // works: there is nothing to choose between.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const t1 = await append(session.id, null, 1);
    const t2 = await append(session.id, t1, 2);
    const t3 = await append(session.id, t2, 3);

    const turns = await readTurns(context, ACCOUNT, session.id);
    const file = await onDisk(session.id);
    expect(file.lastSelectedChild).toBeUndefined();
    expect(resumeFrom(file, turns, t1)).toBe(t3);
    expect(t2).not.toBe(t3);
  });

  it('stops at a fork nobody has been through', async () => {
    // `reconcileSession`'s rule, reused: a node with two children and no memory
    // is a place where guessing would silently pick somebody's story for them.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const t1 = await append(session.id, null, 1);
    await append(session.id, t1, 2);
    await append(session.id, t1, 50);

    const turns = await readTurns(context, ACCOUNT, session.id);
    // The file's own map names the sibling, because appending it moved the
    // head — so the fork is asked cold, as a client that never navigated.
    const cold: SessionFile = { ...(await onDisk(session.id)), lastSelectedChild: {} };
    expect(resumeFrom(cold, turns, t1)).toBe(t1);
  });

  it('ignores a remembered child that no longer resolves', async () => {
    // The map is in a file people may edit. A name that is not a child of the
    // node — or not a turn at all — is a stale note rather than an error.
    const session = await createSession(context, ACCOUNT, 'Rain City');
    const t1 = await append(session.id, null, 1);
    const t2 = await append(session.id, t1, 2);
    await append(session.id, t1, 50);

    const turns = await readTurns(context, ACCOUNT, session.id);
    const invented: SessionFile = {
      ...(await onDisk(session.id)),
      lastSelectedChild: { [t1]: uuidv7() },
    };
    expect(resumeFrom(invented, turns, t1)).toBe(t1);

    const honest: SessionFile = { ...invented, lastSelectedChild: { [t1]: t2 } };
    expect(resumeFrom(honest, turns, t1)).toBe(t2);
  });
});

describe('a branch ref is a name and nothing more', () => {
  it('creates, renames and forgets one without touching a turn', async () => {
    // Proof obligation (iv). [09 §6]: *promoting a swipe writes about fifty
    // bytes and moves no data*, and deleting the name deletes no turns.
    const { sessionId, t2, s2 } = await aFork();
    const before = await readTurns(context, ACCOUNT, sessionId);

    const created = await createBranchRef(context, ACCOUNT, sessionId, 'The ferryman', t2);
    expect(created.kind).toBe('written');
    const refs = created.kind === 'written' ? (created.session.branchRefs ?? []) : [];
    expect(refs).toHaveLength(1);
    expect(refs[0]?.name).toBe('The ferryman');
    expect(refs[0]?.headTurnId).toBe(t2);

    const refId = refs[0]?.id ?? '';
    const renamed = await renameBranchRef(context, ACCOUNT, sessionId, refId, 'The other line');
    expect(renamed.kind === 'written' && renamed.session.branchRefs?.[0]?.name).toBe(
      'The other line',
    );
    // Renaming a name does not move the bookmark.
    expect(renamed.kind === 'written' && renamed.session.branchRefs?.[0]?.headTurnId).toBe(t2);

    const deleted = await deleteBranchRef(context, ACCOUNT, sessionId, refId);
    expect(deleted.kind === 'written' && deleted.session.branchRefs).toEqual([]);

    // Every turn is exactly where it was, through all three gestures — and the
    // node the ref pointed at is still reachable and still has its state.
    const after = await readTurns(context, ACCOUNT, sessionId);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [id, turn] of before) expect(after.get(id)).toEqual(turn);
    expect((await moveHead(context, ACCOUNT, sessionId, t2)).kind).toBe('moved');
    expect((await onDisk(sessionId)).channels[STRANDED]).toBeDefined();
    expect(s2).not.toBe(t2);
  });

  it('refuses a name on a node that is not in this session, and an id that is not a ref', async () => {
    const { sessionId } = await aFork();
    expect((await createBranchRef(context, ACCOUNT, sessionId, 'Nowhere', uuidv7())).kind).toBe(
      'no-turn',
    );
    expect((await renameBranchRef(context, ACCOUNT, sessionId, uuidv7(), 'Nothing')).kind).toBe(
      'no-ref',
    );
    expect((await deleteBranchRef(context, ACCOUNT, sessionId, uuidv7())).kind).toBe('no-ref');
    expect((await onDisk(sessionId)).branchRefs ?? []).toEqual([]);
  });

  it('keeps several names, including two on one node', async () => {
    // Nothing about a ref is exclusive: it is a bookmark, so a node may carry
    // two names and a session may carry names on both lines of a fork.
    const { sessionId, t2, s2 } = await aFork();
    await createBranchRef(context, ACCOUNT, sessionId, 'The ferryman', t2);
    await createBranchRef(context, ACCOUNT, sessionId, 'Where I was', t2);
    const third = await createBranchRef(context, ACCOUNT, sessionId, 'The other way', s2);

    const refs = third.kind === 'written' ? (third.session.branchRefs ?? []) : [];
    expect(refs.map((ref) => ref.name)).toEqual(['The ferryman', 'Where I was', 'The other way']);
    expect(new Set(refs.map((ref) => ref.id)).size).toBe(3);
  });
});
