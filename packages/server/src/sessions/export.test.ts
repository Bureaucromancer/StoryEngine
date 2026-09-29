// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  outputFromMessages,
  SESSION_EXPORT_SCHEMA,
  uuidv7,
  type OutputMessage,
  type Turn,
} from '@storyengine/shared';

import { openIndex } from '../index-db/open.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { Layout } from '../storage/layout.js';
import { exportSession } from './export.js';
import { appendTurnOnly, createSession, sessionFilePath, type SessionContext } from './store.js';
import type { SessionFile } from './types.js';

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

/** A turn, with only what the caller says. Everything else stays absent. */
function turn(over: Partial<Turn> & { id: string; parentTurnId: string | null }): Turn {
  return {
    sessionId: 'unset',
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
    await appendTurnOnly(sessions, 'ned', session.id, turn({ id: root, parentTurnId: null }));

    // Two children of one parent: the head's line, and the one that was left.
    const taken = uuidv7();
    const left = uuidv7();
    await appendTurnOnly(sessions, 'ned', session.id, turn({ id: taken, parentTurnId: root }));
    await appendTurnOnly(sessions, 'ned', session.id, turn({ id: left, parentTurnId: root }));

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
      turn({ id: bare, parentTurnId: null, effects: [], tape: [] }),
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
        turn({ id: uuidv7(), parentTurnId: parent }),
      );
    }

    const one = await exportSession({ sessions, build: null }, 'ned', session.id);
    const two = await exportSession({ sessions, build: null }, 'ned', session.id);

    expect(one?.turns.map((turn) => turn.id)).toEqual(two?.turns.map((turn) => turn.id));
  });

  /**
   * ***What [P13.0] added travels, because nothing had to be told about it*** —
   * [P13 §1.1](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
   * [P13 §1.2](../../../../docs/design/workplan/30-p13-scene-and-session-import.md).
   *
   * The export spreads the document and writes each turn as it is on disk, and
   * this is the test that the spread is doing that job for the fields P13 grew:
   * attributed messages on a turn — a narrator one, a carried one — and every
   * chat setting on the session. The falsifying mutation is a serialiser that
   * restates the shape, which would drop whichever of these it was written
   * before.
   */
  it('carries a turn’s attributed messages and the session’s chat settings', async () => {
    const made = await createSession(sessions, 'ned', {
      name: 'Rain City',
      voice: 'embodied',
      dispatch: 'per-actor',
      speakers: {
        policy: 'list',
        allowSelfResponses: true,
        namesInHistory: 'always',
        maxPerRound: 3,
      },
    });
    const said = uuidv7();
    const messages: OutputMessage[] = [
      { speaker: null, text: 'Rain on the tin roof.' },
      { speaker: { id: 'actor-marlow', name: 'Marlow' }, text: '"You came."', carried: true },
      { speaker: { id: 'actor-elena', name: 'Elena' }, text: '"I said I would."' },
    ];
    await appendTurnOnly(
      sessions,
      'ned',
      made.id,
      turn({ id: said, parentTurnId: null, output: outputFromMessages(messages) }),
    );
    const settings = {
      note: { text: 'Keep it tense.', depth: 4, every: 2 },
      hidden: { [said]: [1] },
      prompts: { instruction: false as const, cards: { 'actor-elena': ['depth' as const] } },
    };
    const file: SessionFile = { ...made, ...settings };
    await writeJsonAtomic(sessionFilePath(sessions.layout, 'ned', made.id), file);

    const exported = await exportSession({ sessions, build: null }, 'ned', made.id);

    expect(exported?.turns[0]?.output).toEqual({
      text: 'Rain on the tin roof.\n\n"You came."\n\n"I said I would."',
      messages,
    });
    expect(exported?.session).toMatchObject({
      voice: 'embodied',
      dispatch: 'per-actor',
      speakers: made.speakers,
      ...settings,
    });
  });
});
