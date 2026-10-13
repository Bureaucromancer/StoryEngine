// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  outputFromMessages,
  RENDITION_SCHEMA,
  SESSION_EXPORT_SCHEMA,
  uuidv7,
  type OutputMessage,
  type Rendition,
  type Turn,
} from '@storyengine/shared';

import { openIndex } from '../index-db/open.js';
import { readRenditions, renditionIdFor, writeRendition } from '../renditions/store.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { Layout } from '../storage/layout.js';
import { exportSession } from './export.js';
import { appendTurnOnly, createSession, sessionFilePath, type SessionContext } from './store.js';
import type { SessionFile } from './types.js';

/**
 * ***The round trip, and the three things a serialiser written against our own
 * records would silently get wrong*** —
 * [19 §3](../../../../docs/design/19-session-import.md),
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
   * ***A turn that never ran a model*** — [19 §3]'s first consequence.
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
   * ***A foreign identifier this build has never heard of*** — [19 §3]'s second
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
   * ***What [P14.0] added travels, because nothing had to be told about it*** —
   * [P14 §1.1](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * [P14 §1.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   *
   * The export spreads the document and writes each turn as it is on disk, and
   * this is the test that the spread is doing that job for the fields P14 grew:
   * attributed messages on a turn — a narrator one keeping its `original`, a
   * carried one — and every chat setting on the session. The falsifying mutation is a serialiser that
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
      { speaker: null, text: 'Rain on the tin roof.', original: 'Narrator: Rain on the tin roof.' },
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

/** A connection id nothing else in a session could spell by accident. */
const CONNECTION = 'connection-on-neds-install';

/** A ready picture of a turn, bound as `binding` says — the record the illustrate step leaves. */
function picture(
  sessionId: string,
  turnId: string,
  ordinal: number,
  binding: Rendition['provenance']['binding'],
): Rendition {
  const id = renditionIdFor(turnId, ordinal);
  return {
    schema: RENDITION_SCHEMA,
    id,
    sessionId,
    turnId,
    createdAt: '2026-10-13T09:00:00.000Z',
    kind: 'image',
    purpose: 'illustration',
    scope: null,
    state: 'ready',
    prompt: {
      fragments: [{ id: 'moment', text: 'a lantern', rank: 100, required: true }],
      separator: ', ',
      budget: { maxChars: null, usefulChars: null },
      text: 'a lantern',
      kept: ['moment'],
      dropped: [],
      overCap: false,
    },
    asset: { path: `${id}.png`, mime: 'image/png', bytes: 11, digest: 'sha256:aa' },
    provenance: {
      at: '2026-10-13T09:00:02.000Z',
      binding,
      answeredAs: null,
      seed: 7,
      seedSent: false,
      workflow: {},
    },
    error: null,
    digest: `d-${id}`,
    ordering: 0,
  };
}

/**
 * ***A picture's record leaves with the model it was asked of and without the
 * connection's id*** — the owner's decision of 2026-10-13, and the writer is
 * where it is kept (`travellingRendition`), so the route, the World file, the
 * review's measure and the ledger's digest all carry the same thing.
 *
 * Three halves, each its own way to get it wrong: the key **absent** rather
 * than `undefined` or `''` (`toHaveProperty` fails on a key set to
 * `undefined`, and `toEqual` alone would not); a `null` binding left `null`,
 * which is *not recorded* and is not the same as a binding that travelled; and
 * **the record on this install untouched** — the sender's picture keeps its
 * id, read back through the store as everything here reads it. The strip put
 * in the store's reader instead of the export passes the first two halves and
 * fails this one, and so would a migration that rewrote the files.
 */
describe('a picture, exported', () => {
  it('keeps the model and drops the connection id, leaves a null binding null, and leaves the record on disk as it was', async () => {
    const session = await createSession(sessions, 'ned', { name: 'Rain City' });
    const said = uuidv7();
    await appendTurnOnly(sessions, 'ned', session.id, turn({ id: said, parentTurnId: null }));
    const bound = picture(session.id, said, 0, { connectionId: CONNECTION, modelId: 'sdxl' });
    const unbound = picture(session.id, said, 1, null);
    await writeRendition(sessions.layout, 'ned', session.id, bound);
    await writeRendition(sessions.layout, 'ned', session.id, unbound);

    const exported = await exportSession({ sessions, build: null }, 'ned', session.id);

    const [first, second] = exported?.renditions ?? [];
    expect(first?.id).toBe(bound.id);
    expect(first?.provenance.binding).toEqual({ modelId: 'sdxl' });
    expect(first?.provenance.binding).not.toHaveProperty('connectionId');
    expect(JSON.stringify(exported)).not.toContain(CONNECTION);
    // Everything else about the record travels as it is, the digest included.
    const { provenance: sentProvenance, ...sentRest } = first!;
    const { provenance: heldProvenance, ...heldRest } = bound;
    expect(sentRest).toEqual(heldRest);
    expect({ ...sentProvenance, binding: null }).toEqual({ ...heldProvenance, binding: null });

    expect(second?.id).toBe(unbound.id);
    expect(second?.provenance).toHaveProperty('binding', null);

    const onDisk = await readRenditions(sessions.layout, 'ned', session.id);
    expect(onDisk.get(bound.id)?.provenance.binding).toEqual({
      connectionId: CONNECTION,
      modelId: 'sdxl',
    });
  });
});
