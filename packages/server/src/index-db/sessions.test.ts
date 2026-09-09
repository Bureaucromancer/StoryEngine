// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import {
  appendTurnToSession,
  createSession,
  deleteSession,
  setArchived,
  setName,
  type SessionContext,
} from '../sessions/store.js';
import type { Turn } from '../sessions/types.js';
import { Layout } from '../storage/layout.js';
import { openIndex, type OpenedIndex } from './open.js';
import { rebuild } from './rebuild.js';
import { listSessionRows, searchTurns, sessionSnapshot, turnText } from './sessions.js';

/**
 * Sessions and turns in the index — [07 §7.1], F10.
 *
 * Two properties matter here and they pull in different directions. The index
 * must be **maintained on write**, because a lazily built search index is empty
 * exactly when somebody first searches; and it must be **derived**, because
 * deleting `index.sqlite` has to stay a non-event. The way both stay true is the
 * same rebuild-equals-incremental assertion the library is held to, extended to
 * cover the new rows.
 */

let dataDir: string;
let index: OpenedIndex;
let context: SessionContext;

const ACCOUNT = 'ned';

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-sessidx-'));
  index = await openIndex({ path: ':memory:' });
  context = {
    layout: new Layout(dataDir),
    index: index.db,
    limits: { maxTurns: 2, maxBytes: 1e6 },
  };
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * A turn with something typed and something said back.
 *
 * The input is deliberately the same bland line every time: it keeps the
 * distinguishing words in the *output*, so a search test that expects one hit is
 * measuring the search rather than a fixture that repeated its own keyword.
 */
function spokenTurn(sessionId: string, parentTurnId: string | null, said: string): Turn {
  const id = uuidv7();
  return {
    id,
    sessionId,
    parentTurnId,
    createdAt: new Date(Date.UTC(2026, 7, 16, 12)).toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'say', text: 'And then?', raw: '' },
    output: { text: said },
    effects: [],
    tape: [],
  };
}

async function aSessionWith(name: string, lines: string[]): Promise<string> {
  const session = await createSession(context, ACCOUNT, name);
  let parent: string | null = null;
  for (const line of lines) {
    const turn = spokenTurn(session.id, parent, line);
    await appendTurnToSession(context, ACCOUNT, session.id, turn);
    parent = turn.id;
  }
  return session.id;
}

describe('a session is indexed as it is written', () => {
  it('records the session and every turn, with its location', async () => {
    const sessionId = await aSessionWith('Rain City', ['The rain had not stopped in nine days.']);

    expect(listSessionRows(index.db, [`user:${ACCOUNT}`])).toMatchObject([
      { sessionId, name: 'Rain City', archived: false },
    ]);

    // The location is the point of the turn row: reading the last N turns of a
    // long session becomes a query rather than a walk through every segment.
    const rows = index.db.prepare('select segment, offset from turn').all();
    expect(rows).toEqual([{ segment: '000001', offset: 0 }]);
  });

  it('follows a turn across a segment roll', async () => {
    const sessionId = await aSessionWith('Rain City', ['one', 'two', 'three']);

    const rows = index.db
      .prepare('select segment, offset from turn where session_id = ? order by segment, offset')
      .all(sessionId);
    expect(rows).toEqual([
      { segment: '000001', offset: 0 },
      { segment: '000001', offset: 1 },
      { segment: '000002', offset: 0 },
    ]);
  });

  it('indexes what was said and typed, and not the machinery around it', () => {
    // A search that matched assembled blocks or the system prompt would return
    // every turn in the session the moment a lorebook entry used the word.
    const turn = spokenTurn('s', null, 'The cathedral was three streets east.');
    expect(turnText(turn)).toBe('And then?\nThe cathedral was three streets east.');
  });

  it('indexes nothing for a turn that has no text', () => {
    // A hand-edit turn ([02 §8.1]) has neither input nor output, and an empty
    // FTS row would match a bare-prefix query and offer the reader nothing.
    const turn: Turn = { ...spokenTurn('s', null, '') };
    delete turn.input;
    delete turn.output;
    expect(turnText(turn)).toBe('');
  });
});

describe('rebuild-from-disk equals the incremental index, for sessions too', () => {
  /**
   * **The test a missing `indexSession` fails.**
   *
   * A rename writes the file and denormalises the name into the `session` row.
   * Drop the reindex from `setName` and the file is right, `listSessionFiles`
   * is right, and only the index disagrees — so this is asserted through two
   * doors that both read the index and neither reads the file: the list rows,
   * and a turn search, whose `sessionName` is a live join onto the same row.
   *
   * A search that kept labelling hits with a session's old name is the kind of
   * wrongness nobody reports, because nobody searches for the thing they just
   * renamed.
   */
  it('relabels a renamed session, in the rows and in search', async () => {
    const sessionId = await aSessionWith('Rain City', ['The cathedral was three streets east.']);

    await setName(context, ACCOUNT, sessionId, 'Rain City, after the fire');

    expect(listSessionRows(index.db, [`user:${ACCOUNT}`]).map((row) => row.name)).toEqual([
      'Rain City, after the fire',
    ]);
    expect(searchTurns(index.db, [`user:${ACCOUNT}`], 'cathedral')[0]).toMatchObject({
      sessionName: 'Rain City, after the fire',
    });
  });

  it('agrees after writes, an archive, a rename and a delete', async () => {
    // The same assertion the library is held to, and it is what keeps the
    // session rows honest about being derived ([13 §5]).
    await aSessionWith('Rain City', ['The rain had not stopped in nine days.', 'Nor had she.']);
    const archived = await aSessionWith('Old Game', ['Once.']);
    const doomed = await aSessionWith('A Mistake', ['Never mind.']);
    const renamed = await aSessionWith('Working Title', ['Something.']);

    await setArchived(context, ACCOUNT, archived, true);
    await setName(context, ACCOUNT, renamed, 'Rain City, after the fire');
    await deleteSession(context, ACCOUNT, doomed);

    const incremental = sessionSnapshot(index.db);
    await rebuild(index.db, context.layout);

    expect(sessionSnapshot(index.db)).toEqual(incremental);
    // Three sessions and four turns — the deleted one is absent from both.
    expect(incremental.filter((line) => line.startsWith('session'))).toHaveLength(3);
    expect(incremental.filter((line) => line.startsWith('turn'))).toHaveLength(4);
  });

  it('forgets a session whose folder is gone', async () => {
    // The session half of what `rebuild`'s deletes are for. The equality test
    // above cannot show it: rebuilding over a *consistent* index upserts every
    // row onto itself, so removing `delete from session` left it green. The
    // deletes only matter when the index holds something disk does not justify.
    const kept = await aSessionWith('Rain City', ['one']);
    const gone = await aSessionWith('Deleted Outside The App', ['two']);

    await rm(join(dataDir, 'users', ACCOUNT, 'sessions', gone), { recursive: true });
    await rebuild(index.db, context.layout);

    const rows = listSessionRows(index.db, [`user:${ACCOUNT}`]);
    expect(rows.map((row) => row.sessionId)).toEqual([kept]);
    // …and its turns went with it. Asserted on the rows as well as on search,
    // because the two are deleted by separate statements and a search that
    // joins them would come up empty if either had gone.
    const turns = index.db
      .prepare('select count(*) c from turn where session_id = ?')
      .get(gone) as { c: number };
    expect(turns.c).toBe(0);
    expect(searchTurns(index.db, [`user:${ACCOUNT}`], 'two')).toEqual([]);
  });

  it('counts what it found', async () => {
    await aSessionWith('Rain City', ['one', 'two']);

    const result = await rebuild(index.db, context.layout);
    expect(result).toMatchObject({ sessions: 1, turns: 2 });
  });
});

describe('search over turn text', () => {
  it('finds a turn by something said in it, and names the session', async () => {
    const sessionId = await aSessionWith('Rain City', [
      'The cathedral was three streets east.',
      'She went north instead.',
    ]);

    const hits = searchTurns(index.db, [`user:${ACCOUNT}`], 'cathedral');

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sessionId, sessionName: 'Rain City', segment: '000001' });
  });

  it('never reaches another account', async () => {
    // The owner comes from the session row, which is the only thing that knows
    // an owner — the join *is* the containment rule ([04 §4.3]).
    await aSessionWith('Rain City', ['The cathedral was three streets east.']);

    expect(searchTurns(index.db, ['user:sister'], 'cathedral')).toEqual([]);
  });

  it('still finds an archived session', async () => {
    // Archived is out of the way, not gone ([02 §10.3]) — a search that skipped
    // it would make archiving a quiet way of losing things.
    const sessionId = await aSessionWith('Old Game', ['The cathedral burned that winter.']);
    await setArchived(context, ACCOUNT, sessionId, true);

    expect(searchTurns(index.db, [`user:${ACCOUNT}`], 'cathedral')).toHaveLength(1);
    // …and is still hidden from the list, which is the distinction.
    expect(listSessionRows(index.db, [`user:${ACCOUNT}`])).toEqual([]);
  });

  it('finds nothing in a deleted session', async () => {
    const sessionId = await aSessionWith('A Mistake', ['The cathedral, again.']);
    await deleteSession(context, ACCOUNT, sessionId);

    expect(searchTurns(index.db, [`user:${ACCOUNT}`], 'cathedral')).toEqual([]);
  });
});
