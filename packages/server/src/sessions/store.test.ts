// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { listDirectoryNames } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { listSegments, readAllTurns, walkPath } from './segments.js';
import {
  appendTurnToSession,
  createSession,
  deleteSession,
  listSessionFiles,
  listSessions,
  readSession,
  readTurns,
  replayChannels,
  setArchived,
  type SessionContext,
} from './store.js';
import type { ChannelEffect, Turn } from './types.js';

/**
 * Session and turn storage — [02 §5.5], [02 §8.1].
 *
 * The two claims worth testing hardest are the ones that only bite later:
 * **file order is creation order and reading order is a tree walk**, which is
 * what keeps branching out of the write path; and **the head snapshot is
 * derived**, which is what stops it becoming a mutable state blob that
 * switching branches has to rewrite.
 */

let dataDir: string;
let index: OpenedIndex;
let context: SessionContext;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-sessions-'));
  index = await openIndex({ path: ':memory:' });
  context = {
    layout: new Layout(dataDir),
    index: index.db,
    limits: { maxTurns: 3, maxBytes: 1_000_000 },
  };
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

const CLOCK = 'se.clock';

function clockEffect(turnId: string, before: unknown, after: unknown): ChannelEffect {
  return {
    id: uuidv7(),
    turnId,
    channelId: CLOCK,
    scopeKey: null,
    op: { type: 'set', path: '/' },
    before,
    after,
    proposedBy: { kind: 'engine' },
    applied: true,
    rejectedReason: null,
    supersedes: null,
    channelVersion: 1,
    scope: 'session',
  };
}

function turnAfter(sessionId: string, parentTurnId: string | null, hour: number): Turn {
  const id = uuidv7();
  return {
    id,
    sessionId,
    parentTurnId,
    createdAt: new Date(Date.UTC(2026, 7, 16, hour)).toISOString(),
    status: 'complete',
    effects: [clockEffect(id, { hour: hour - 1 }, { hour })],
    tape: [],
  };
}

/** A session with `count` turns in a line, returned newest last. */
async function aSessionOf(count: number): Promise<{ sessionId: string; turns: Turn[] }> {
  const session = await createSession(context, 'ned', 'Rain City');
  const turns: Turn[] = [];
  let parent: string | null = null;

  for (let hour = 1; hour <= count; hour += 1) {
    const turn = turnAfter(session.id, parent, hour);
    await appendTurnToSession(context, 'ned', session.id, turn);
    turns.push(turn);
    parent = turn.id;
  }

  return { sessionId: session.id, turns };
}

describe('a session on disk', () => {
  it('is a folder with a session.json and a turns directory', async () => {
    const { sessionId } = await aSessionOf(1);

    const file = join(dataDir, 'users', 'ned', 'sessions', sessionId, 'session.json');
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { schema: string };
    expect(parsed.schema).toBe('storyengine.session/1');

    const segments = await listSegments(
      join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    expect(segments).toEqual(['000001']);
  });

  it('rolls to a new segment rather than growing one file', async () => {
    // Not one file per turn — thousands of small files for a long campaign —
    // and not one growing document rewritten on every turn.
    const { sessionId } = await aSessionOf(7);

    const segments = await listSegments(
      join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns'),
    );
    expect(segments).toEqual(['000001', '000002', '000003']);
  });

  it('never rewrites a segment once it has rolled', async () => {
    // Immutability is what makes segments rsync-friendly and what bounds the
    // loss from a corrupted one.
    const { sessionId } = await aSessionOf(3);
    const first = join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns', '000001.jsonl');
    const before = await readFile(first, 'utf8');

    await aSessionOf(0);
    const { turns } = await aSessionOf(0);
    expect(turns).toEqual([]);

    // Four more turns into the same session: the first segment is untouched.
    let parent = (await readSession(context, 'ned', sessionId))?.headTurnId ?? null;
    for (let hour = 4; hour <= 7; hour += 1) {
      const turn = turnAfter(sessionId, parent, hour);
      await appendTurnToSession(context, 'ned', sessionId, turn);
      parent = turn.id;
    }

    expect(await readFile(first, 'utf8')).toBe(before);
  });
});

describe('reading is a tree walk', () => {
  it('follows parentTurnId rather than file order', async () => {
    const { sessionId, turns } = await aSessionOf(4);
    const byId = await readTurns(context, 'ned', sessionId);

    const path = walkPath(byId, turns.at(-1)?.id ?? null);

    expect(path.map((turn) => turn.id)).toEqual(turns.map((turn) => turn.id));
  });

  it('reads a branch without the write path knowing there was one', async () => {
    // Branching costs nothing on write: a branch is more appends, in creation
    // order, into the same segments. This is the property that makes it so.
    const { sessionId, turns } = await aSessionOf(3);
    const forkParent = turns[0]!;

    const sibling = turnAfter(sessionId, forkParent.id, 99);
    await appendTurnToSession(context, 'ned', sessionId, sibling);

    const byId = await readTurns(context, 'ned', sessionId);

    // The original path is unchanged...
    expect(walkPath(byId, turns.at(-1)!.id).map((turn) => turn.id)).toEqual(
      turns.map((turn) => turn.id),
    );
    // ...and the branch is two turns long, sharing only the fork point.
    expect(walkPath(byId, sibling.id).map((turn) => turn.id)).toEqual([forkParent.id, sibling.id]);
  });

  it('skips a tombstoned turn rather than rewriting the segment', async () => {
    // Nothing removes turns at 1.0. The format tolerates it now because
    // retrofitting deletion into a pure-append format is a migration.
    const { sessionId, turns } = await aSessionOf(2);
    const file = join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns', '000001.jsonl');

    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    const removed = { ...(JSON.parse(lines[0]!) as Turn), removed: true };
    await writeFile(file, `${JSON.stringify(removed)}\n${lines[1]!}\n`);

    const byId = await readTurns(context, 'ned', sessionId);
    expect(byId.has(turns[0]!.id)).toBe(false);
    expect(byId.has(turns[1]!.id)).toBe(true);
  });

  it('survives a half-written line at the tail', async () => {
    // The one file a crash can leave torn. One bad line must not make the turns
    // before it unreadable — that is the bounded loss the append-only format
    // trades for.
    const { sessionId, turns } = await aSessionOf(2);
    const file = join(dataDir, 'users', 'ned', 'sessions', sessionId, 'turns', '000001.jsonl');
    await writeFile(file, `${await readFile(file, 'utf8')}{"id":"half-writ`);

    const byId = await readTurns(context, 'ned', sessionId);
    expect([...byId.keys()].sort()).toEqual(turns.map((turn) => turn.id).sort());
  });
});

describe('the head snapshot', () => {
  it('advances with the turn', async () => {
    const { sessionId, turns } = await aSessionOf(3);
    const session = await readSession(context, 'ned', sessionId);

    expect(session?.headTurnId).toBe(turns.at(-1)?.id);
    expect(session?.channels[CLOCK]?.value).toEqual({ hour: 3 });
  });

  it('is derived — deleting it costs a recomputation and nothing else', async () => {
    // The claim [02 §8.1] makes, tested rather than asserted: state exists at a
    // *node*, and `session.json`'s map can only ever mean state at the head.
    const { sessionId, turns } = await aSessionOf(3);

    const byId = await readTurns(context, 'ned', sessionId);
    const replayed = replayChannels(walkPath(byId, turns.at(-1)!.id));

    const session = await readSession(context, 'ned', sessionId);
    expect(replayed).toEqual(session?.channels);
  });

  it('differs between branches, which is why it cannot be session state', async () => {
    const { sessionId, turns } = await aSessionOf(2);
    const sibling = turnAfter(sessionId, turns[0]!.id, 50);
    await appendTurnToSession(context, 'ned', sessionId, sibling);

    const byId = await readTurns(context, 'ned', sessionId);
    const onOriginal = replayChannels(walkPath(byId, turns.at(-1)!.id));
    const onBranch = replayChannels(walkPath(byId, sibling.id));

    expect(onOriginal[CLOCK]?.value).toEqual({ hour: 2 });
    expect(onBranch[CLOCK]?.value).toEqual({ hour: 50 });
  });

  it('ignores a rejected effect, because the record keeps what was refused', async () => {
    // "The model tried to give itself 40 gold" is part of the turn record and
    // must not be part of the state.
    const { sessionId, turns } = await aSessionOf(1);
    const refused: Turn = {
      ...turnAfter(sessionId, turns[0]!.id, 2),
      effects: [
        {
          ...clockEffect('t', { hour: 1 }, { hour: 999 }),
          applied: false,
          rejectedReason: 'The engine computes the clock.',
        },
      ],
    };
    await appendTurnToSession(context, 'ned', sessionId, refused);

    const session = await readSession(context, 'ned', sessionId);
    expect(session?.channels[CLOCK]?.value).toEqual({ hour: 1 });
  });

  it('records an escaped effect without replaying it', async () => {
    // A library write or a generated asset is not something a branch can
    // un-write. P2 writes only `session`; this proves the field is honoured
    // before anything depends on it at P6.
    const { sessionId, turns } = await aSessionOf(1);
    const escaped: Turn = {
      ...turnAfter(sessionId, turns[0]!.id, 2),
      effects: [{ ...clockEffect('t', { hour: 1 }, { hour: 500 }), scope: 'escaped' }],
    };
    await appendTurnToSession(context, 'ned', sessionId, escaped);

    const byId = await readTurns(context, 'ned', sessionId);
    const replayed = replayChannels(walkPath(byId, escaped.id));

    expect(replayed[CLOCK]?.value).toEqual({ hour: 1 });
    // Still on the record, though.
    expect(byId.get(escaped.id)?.effects[0]?.scope).toBe('escaped');
  });
});

describe('deleting a session is a move, and archiving is neither', () => {
  it('moves the folder to the trash rather than erasing it', async () => {
    // F7's lesson applied rather than re-learned. The finding was a hard delete
    // that took an object's *history* with it — and a session's turns are its
    // history, so an erasure here would be the same bug in the kind that has
    // more to lose. [02 §10.3] settles it: a session is a folder too.
    const { sessionId, turns } = await aSessionOf(2);

    expect(await deleteSession(context, 'ned', sessionId)).toBe(true);

    expect(await readSession(context, 'ned', sessionId)).toBeNull();
    expect(await listSessions(context, 'ned')).toEqual([]);

    // Still there, turns and all, which is what makes a restore a move back.
    const trashed = await listDirectoryNames(join(dataDir, 'users', 'ned', 'trash', 'sessions'));
    expect(trashed).toHaveLength(1);
    const recovered = await readAllTurns(
      join(dataDir, 'users', 'ned', 'trash', 'sessions', trashed[0]!, 'turns'),
    );
    expect(recovered.map(({ turn }) => turn.id)).toEqual(turns.map((turn) => turn.id));
  });

  it('does not collide when a session id is deleted, recreated and deleted', async () => {
    const { sessionId } = await aSessionOf(1);
    await deleteSession(context, 'ned', sessionId);
    await aSessionOf(1);
    const { sessionId: second } = await aSessionOf(1);
    await deleteSession(context, 'ned', second);

    expect(
      await listDirectoryNames(join(dataDir, 'users', 'ned', 'trash', 'sessions')),
    ).toHaveLength(2);
  });

  it('reports a session that was not there rather than throwing', async () => {
    expect(await deleteSession(context, 'ned', uuidv7())).toBe(false);
  });

  it('hides an archived session from the default list, intact', async () => {
    // Most sessions people stop playing are not sessions they want gone — they
    // are sessions they want out of the way ([02 §10.3]).
    const { sessionId, turns } = await aSessionOf(2);
    await createSession(context, 'ned', 'Still Playing');

    const archived = await setArchived(context, 'ned', sessionId, true);
    expect(archived?.archivedAt).toBeTruthy();

    expect((await listSessionFiles(context, 'ned')).map((each) => each.name)).toEqual([
      'Still Playing',
    ]);
    expect(await listSessionFiles(context, 'ned', { includeArchived: true })).toHaveLength(2);

    // Fully intact: nothing moved, nothing swept, the head still points where
    // it did.
    expect(archived?.headTurnId).toBe(turns.at(-1)?.id);
    expect(await readTurns(context, 'ned', sessionId)).toHaveLength(2);
  });

  it('unarchives by removing the field, not by writing a false', async () => {
    const { sessionId } = await aSessionOf(1);
    await setArchived(context, 'ned', sessionId, true);

    const restored = await setArchived(context, 'ned', sessionId, false);

    expect(restored && 'archivedAt' in restored).toBe(false);
    expect(await listSessionFiles(context, 'ned')).toHaveLength(1);
  });
});
