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
  readTurnById,
  readTurns,
  replayChannels,
  setArchived,
  setName,
  type SessionContext,
} from './store.js';
import type { ChannelEffect, Turn } from './types.js';

/**
 * Session and turn storage — [03 §5.5], [03 §8.1].
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

describe('one turn by id', () => {
  /**
   * [P3.0]'s read: the location index finally doing the job its header
   * promised, with the cold read behind it because [21 §5] makes the index
   * derived — deleting it costs a rescan and nothing else, and a route that
   * 404'd on a missing row would make it load-bearing.
   */
  it('serves a turn the head has passed, by id', async () => {
    const { sessionId, turns } = await aSessionOf(3);
    const middle = turns[1];

    const found = await readTurnById(context, 'ned', sessionId, middle?.id ?? '');
    expect(found?.id).toBe(middle?.id);
    expect(found?.createdAt).toBe(middle?.createdAt);
  });

  it('falls back to the cold read when the index has no row', async () => {
    // The falsifying mutation is returning null on an index miss — the
    // derived index becomes load-bearing exactly the way [21 §5] forbids.
    const { sessionId, turns } = await aSessionOf(2);
    index.db.prepare('delete from turn').run();

    const found = await readTurnById(context, 'ned', sessionId, turns[0]?.id ?? '');
    expect(found?.id).toBe(turns[0]?.id);
  });

  it('refuses to read across sessions, even with a real turn id', async () => {
    // The boundary is structural — the location resolves under the
    // *requested* session's directory — but that alone is not enough: both
    // sessions' first turns share `{000001.jsonl, offset 0}`, so an aligned
    // hit parses cleanly and would serve the wrong session's turn under the
    // requested id. The id-match on the line read back is what refuses it,
    // and dropping that guard is the falsifying mutation — this test then
    // hands back the other session's turn. (The mutation is *trusting the
    // located row* — the session short-circuit and the id-match protect this
    // independently, so it takes removing both, which is one decision.)
    const first = await aSessionOf(1);
    const second = await aSessionOf(1);

    const found = await readTurnById(context, 'ned', first.sessionId, second.turns[0]?.id ?? '');
    expect(found).toBeNull();
  });

  it('hides a tombstone on both paths', async () => {
    // `readAllTurns` skips tombstones and `readTurnAt` does not, so without
    // the guard the two paths would disagree about whether a removed turn
    // exists — the falsifying mutation is dropping the `removed` check on the
    // index path.
    const { sessionId, turns } = await aSessionOf(1);
    const ghost: Turn = { ...turnAfter(sessionId, turns[0]?.id ?? null, 2), removed: true };
    await appendTurnToSession(context, 'ned', sessionId, ghost);

    expect(await readTurnById(context, 'ned', sessionId, ghost.id)).toBeNull();
    index.db.prepare('delete from turn').run();
    expect(await readTurnById(context, 'ned', sessionId, ghost.id)).toBeNull();
  });
});

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
    // The claim [03 §8.1] makes, tested rather than asserted: state exists at a
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

  it('is the state at the node appended to, not at the head it displaced', async () => {
    // [P6.0b]. `advanceHead` computed the new map from `session.channels` —
    // whatever the head's map happened to be — which is right for a child of
    // the head and wrong for a sibling: the state written was the *abandoned*
    // line's, plus this turn's effects.
    //
    // **A clock-only fixture cannot see it**, which is why it survived five
    // phases: a whole-value set lands on the same number whichever map it folds
    // onto, so the falsifying mutation passes every other test in this file.
    // What shows it is a key the abandoned line wrote and this branch never
    // did — after P5 that is lore timing, and it reads as an entry sticky on a
    // line that never fired it.
    const { sessionId, turns } = await aSessionOf(1);

    const abandoned = turnAfter(sessionId, turns[0]!.id, 2);
    abandoned.effects.push({
      ...clockEffect(abandoned.id, null, { sticky: 0, cooldown: 2, fired: 1 }),
      channelId: 'se.lore.timing',
      scopeKey: 'ferryman',
    });
    await appendTurnToSession(context, 'ned', sessionId, abandoned);

    const sibling = turnAfter(sessionId, turns[0]!.id, 50);
    const { session } = await appendTurnToSession(context, 'ned', sessionId, sibling);

    // The stranded key, spelled out rather than composed, so this fails on the
    // name a reader of `session.json` would see.
    expect(session.channels['se.lore.timing#ferryman']).toBeUndefined();
    expect(session.channels[CLOCK]?.value).toEqual({ hour: 50 });

    // And the invariant the whole file rests on, now true by construction
    // rather than by nothing having branched yet: the snapshot is the replay at
    // the head. `gatherAssemblyInputs` reads the file for exactly this reason
    // and for no other node.
    const byId = await readTurns(context, 'ned', sessionId);
    expect(session.channels).toEqual(replayChannels(walkPath(byId, sibling.id)));
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
    // more to lose. [03 §10.3] settles it: a session is a folder too.
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
    // are sessions they want out of the way ([03 §10.3]).
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

  /**
   * Renaming — [03 §8].
   *
   * The interesting assertions are the ones about what *did not* move. A
   * session's name is behaviour-inert: nothing resolves a session by it, so a
   * rename that disturbed the head, the channels or the turns would be doing
   * something nobody asked for.
   */
  it('renames a session without disturbing anything else', async () => {
    const { sessionId, turns } = await aSessionOf(2);
    const before = await readSession(context, 'ned', sessionId);

    const renamed = await setName(context, 'ned', sessionId, 'Rain City, after the fire');

    expect(renamed?.name).toBe('Rain City, after the fire');
    expect(renamed?.headTurnId).toBe(turns.at(-1)?.id);
    expect(renamed?.channels).toEqual(before?.channels);
    expect(await readTurns(context, 'ned', sessionId)).toHaveLength(2);

    // Written, not merely returned.
    expect((await readSession(context, 'ned', sessionId))?.name).toBe('Rain City, after the fire');
  });

  it('accepts an empty name, which is where a session may have started', async () => {
    const unnamed = await createSession(context, 'ned', { mode: { id: 'scene', config: null } });
    expect(unnamed.name).toBe('');

    const named = await setName(context, 'ned', unnamed.id, 'Rain City');
    expect(named?.name).toBe('Rain City');

    // And back again. A rule that let you never name a session but never
    // un-name one would be arbitrary in a way somebody would have to discover.
    expect((await setName(context, 'ned', unnamed.id, ''))?.name).toBe('');
  });

  it('reports a session that was not there rather than throwing, when renaming', async () => {
    expect(await setName(context, 'ned', uuidv7(), 'Nowhere')).toBeNull();
  });

  it('unarchives by removing the field, not by writing a false', async () => {
    const { sessionId } = await aSessionOf(1);
    await setArchived(context, 'ned', sessionId, true);

    const restored = await setArchived(context, 'ned', sessionId, false);

    expect(restored && 'archivedAt' in restored).toBe(false);
    expect(await listSessionFiles(context, 'ned')).toHaveLength(1);
  });
});
