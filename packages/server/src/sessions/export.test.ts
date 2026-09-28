// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SESSION_EXPORT_SCHEMA, uuidv7, type Turn } from '@storyengine/shared';

import { openIndex } from '../index-db/open.js';
import { Layout } from '../storage/layout.js';
import { exportSession } from './export.js';
import { appendTurnOnly, createSession, type SessionContext } from './store.js';

/**
 * ***The round trip, and the three things a serialiser written against our own
 * records would silently get wrong*** —
 * [18 §3](../../../../docs/design/18-session-import.md),
 * [P11 §1.8](../../../../docs/design/workplan/28-p11-implementation.md),
 * [P11.10](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * The stage's proof obligation names all three and says which one costs data:
 * *"the first is the one that costs data, and no fixture this build produces
 * would catch it unless the fixture branches — so the fixture branches."*
 *
 * ***That sentence is the reason this file exists rather than an assertion that
 * the JSON parses.*** Every read surface in this build calls `walkPath(head)`,
 * so a serialiser reaching for the obvious function produces an export that is
 * **correct against every linear session and lossy against every real one** —
 * and every fixture in this repository is linear.
 */

let dataDir: string;
let sessions: SessionContext;
let index: Awaited<ReturnType<typeof openIndex>>;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-export-'));
  index = await openIndex({ path: ':memory:' });
  sessions = { layout: new Layout(dataDir), index: index.db };
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * A turn, with only what the caller says. Everything else stays absent — except
 * the session it names, which `appendTurnOnly` checks against the session it is
 * appended to ([P13.0](../../../../docs/design/workplan/30-p13-aventuras-import.md)):
 * a turn naming another session is filed under it by the index.
 */
function turn(
  over: Partial<Turn> & { id: string; parentTurnId: string | null; sessionId: string },
): Turn {
  return {
    createdAt: new Date().toISOString(),
    status: 'complete',
    ...over,
  } as Turn;
}

describe('a session, exported whole', () => {
  /**
   * ***The one that costs data.*** [07 §3] makes swipes and branches one
   * mechanism, so a serialised path drops every swipe — and the loss is
   * invisible against a linear session, which is what every other fixture here
   * is. **So this fixture branches**, and the assertion is a count.
   */
  it('carries every sibling, not the path', async () => {
    const session = await createSession(sessions, 'ned', { name: 'Rain City' });
    const root = uuidv7();
    await appendTurnOnly(
      sessions,
      'ned',
      session.id,
      turn({ sessionId: session.id, id: root, parentTurnId: null }),
    );

    // Two children of one parent: the head's line, and the one that was left.
    const taken = uuidv7();
    const left = uuidv7();
    await appendTurnOnly(
      sessions,
      'ned',
      session.id,
      turn({ sessionId: session.id, id: taken, parentTurnId: root }),
    );
    await appendTurnOnly(
      sessions,
      'ned',
      session.id,
      turn({ sessionId: session.id, id: left, parentTurnId: root }),
    );

    const exported = await exportSession({ sessions, build: null }, 'ned', session.id);

    expect(exported?.schema).toBe(SESSION_EXPORT_SCHEMA);
    expect(exported?.turns).toHaveLength(3);
    // The falsifying mutation is `walkPath(head)`, which answers with two.
    expect(exported?.turns.map((one) => one.id).sort()).toEqual([root, taken, left].sort());
  });

  /**
   * ***A turn that never ran a model*** — [18 §3]'s first consequence.
   * `input`, `output`, `request`, `cost` and `steps` are optional, and a
   * hand-edit divergence turn on disk is exactly that record. **Ours always
   * have them**, which is why a serialiser would tighten this without anybody
   * deciding to.
   */
  it('survives a turn with five of its fields absent', async () => {
    const session = await createSession(sessions, 'ned', { name: 'Rain City' });
    const bare = uuidv7();
    await appendTurnOnly(
      sessions,
      'ned',
      session.id,
      turn({ sessionId: session.id, id: bare, parentTurnId: null, effects: [], tape: [] }),
    );

    const exported = await exportSession({ sessions, build: null }, 'ned', session.id);
    const carried = exported?.turns[0];

    expect(carried?.id).toBe(bare);
    for (const field of ['input', 'output', 'request', 'cost', 'steps'] as const) {
      expect(carried).not.toHaveProperty(field);
    }
  });

  /**
   * ***A foreign identifier this build has never heard of*** — [18 §3]'s second
   * consequence, and the case that makes this a format rather than a dialect. A
   * turn imported from somewhere else carries where it came from, and an export
   * that dropped it would break re-import idempotence for every source that has
   * one.
   */
  it('round-trips a foreign identifier from a source it does not know', async () => {
    const session = await createSession(sessions, 'ned', { name: 'Rain City' });
    const imported = uuidv7();
    await appendTurnOnly(
      sessions,
      'ned',
      session.id,
      turn({
        sessionId: session.id,
        id: imported,
        parentTurnId: null,
        foreign: { source: 'some-app-nobody-here-has-heard-of', id: 'msg-42' },
      }),
    );

    const exported = await exportSession({ sessions, build: null }, 'ned', session.id);

    expect(exported?.turns[0]?.foreign).toEqual({
      source: 'some-app-nobody-here-has-heard-of',
      id: 'msg-42',
    });
  });

  it('answers null for a session that is not there', async () => {
    expect(await exportSession({ sessions, build: null }, 'ned', 'no-such-session')).toBeNull();
  });

  /**
   * Two exports of one unchanged session are the same bytes but for the
   * timestamp, which is what makes a diff of two exports mean something.
   */
  it('orders turns the same way twice', async () => {
    const session = await createSession(sessions, 'ned', { name: 'Rain City' });
    for (const parent of [null, null, null]) {
      await appendTurnOnly(
        sessions,
        'ned',
        session.id,
        turn({ sessionId: session.id, id: uuidv7(), parentTurnId: parent }),
      );
    }

    const one = await exportSession({ sessions, build: null }, 'ned', session.id);
    const two = await exportSession({ sessions, build: null }, 'ned', session.id);

    expect(one?.turns.map((turn) => turn.id)).toEqual(two?.turns.map((turn) => turn.id));
  });
});
