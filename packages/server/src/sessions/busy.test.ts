// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RENDITION_SCHEMA, uuidv7, type Rendition } from '@storyengine/shared';

import { openIndex, type OpenedIndex } from '../index-db/open.js';
import {
  DeferredBackdrops,
  offerBackdrop,
  selectBackdrop,
  showHeldBackdrop,
} from '../renditions/backdrop.js';
import { writeRendition } from '../renditions/store.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { writeFileBytes } from '../storage/files.js';
import { Layout } from '../storage/layout.js';
import { listTrash, restoreFromTrash } from '../storage/trash.js';
import {
  appendTurnLocked,
  appendTurnToSession,
  createSession,
  deleteSession,
  moveHead,
  readSession,
  readTurns,
  reconcileHandEdits,
  sessionFilePath,
  undoTurn,
  withSessionLock,
  writeChannel,
  type SessionContext,
} from './store.js';
import type { Turn } from './types.js';

/**
 * ***A session with a turn in flight takes no other turn*** (2026-09-27).
 *
 * A turn's job is reserved against the head as it was, and its commit sets the
 * head to the new turn whatever happened meanwhile. So anything else that moved
 * the head while it ran — a dial, *Remember this*, a backdrop arriving, a hand
 * edit reconciled — became a sibling of that turn, on a line nobody would see
 * again. Head moves and undo refused at the route, outside the lock; the rest
 * did not ask. Now every one of them asks under the session's lock, where the
 * answer holds, and a backdrop that lands in the middle of a turn waits for it.
 */

let dataDir: string;
let index: OpenedIndex;
let context: SessionContext;
let busyNow: boolean;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-busy-'));
  index = await openIndex({ path: ':memory:' });
  busyNow = false;
  context = { layout: new Layout(dataDir), index: index.db, busy: () => busyNow };
});

afterEach(async () => {
  index.close();
  await rm(dataDir, { recursive: true, force: true });
});

function turnAfter(sessionId: string, parentTurnId: string | null, over: Partial<Turn> = {}): Turn {
  return {
    id: uuidv7(),
    sessionId,
    parentTurnId,
    createdAt: new Date().toISOString(),
    status: 'complete',
    input: { actorId: null, kind: 'say', text: 'And then?', raw: '' },
    output: { text: 'The rain did not stop.' },
    effects: [],
    tape: [],
    ...over,
  };
}

async function aSessionOfTwo(): Promise<{ sessionId: string; turns: Turn[] }> {
  const session = await createSession(context, 'ned', 'Rain City');
  const first = turnAfter(session.id, null);
  await appendTurnToSession(context, 'ned', session.id, first);
  const second = turnAfter(session.id, first.id);
  await appendTurnToSession(context, 'ned', session.id, second);
  return { sessionId: session.id, turns: [first, second] };
}

describe('while a turn is in flight', () => {
  it('refuses every write that would move the head, and writes nothing', async () => {
    const { sessionId, turns } = await aSessionOfTwo();
    busyNow = true;

    expect(await writeChannel(context, 'ned', sessionId, 'se.illustrate', 'off')).toEqual({
      kind: 'busy',
    });
    expect(await moveHead(context, 'ned', sessionId, turns[0]!.id)).toEqual({ kind: 'busy' });
    expect(await undoTurn(context, 'ned', sessionId, turns[1]!.id)).toEqual({ kind: 'busy' });
    expect(await selectBackdrop(context, 'ned', sessionId, 'r-1', { kind: 'engine' })).toEqual({
      kind: 'busy',
    });
    expect(await deleteSession(context, 'ned', sessionId)).toEqual({ kind: 'busy' });

    expect((await readTurns(context, 'ned', sessionId)).size).toBe(2);
    expect((await readSession(context, 'ned', sessionId))?.headTurnId).toBe(turns[1]!.id);

    // …and once it has landed, the same write goes through.
    busyNow = false;
    const written = await writeChannel(context, 'ned', sessionId, 'se.illustrate', 'off');
    expect(written.kind).toBe('written');
  });

  it('leaves a hand edit for the next read to reconcile', async () => {
    const { sessionId } = await aSessionOfTwo();
    const session = await readSession(context, 'ned', sessionId);
    await writeJsonAtomic(sessionFilePath(context.layout, 'ned', sessionId), {
      ...session,
      channels: { 'se.illustrate': { value: 'off', version: 1 } },
    });

    busyNow = true;
    expect(await reconcileHandEdits(context, 'ned', sessionId)).toEqual([]);
    expect((await readTurns(context, 'ned', sessionId)).size).toBe(2);

    busyNow = false;
    expect((await reconcileHandEdits(context, 'ned', sessionId)).length).toBeGreaterThan(0);
  });
});

/**
 * ***The head is read under the lock***, which is the half that holds with no
 * turn in flight at all. `selectBackdrop` read the head and built its turn
 * outside the lock, then appended under it: a turn landing in between left the
 * selection parented on the head as it had been, a sibling of that turn.
 */
it('parents an engine write on the head as it is when the write lands', async () => {
  const { sessionId, turns } = await aSessionOfTwo();
  const landing = turnAfter(sessionId, turns[1]!.id);

  let selecting: Promise<unknown> = Promise.resolve();
  await withSessionLock(sessionId, async () => {
    selecting = selectBackdrop(context, 'ned', sessionId, 'r-1', { kind: 'engine' });
    // Long enough for a read taken outside the lock to have happened.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await appendTurnLocked(context, 'ned', sessionId, landing);
  });
  await selecting;

  const head = (await readSession(context, 'ned', sessionId))?.headTurnId ?? '';
  const selection = (await readTurns(context, 'ned', sessionId)).get(head);
  expect(selection?.parentTurnId).toBe(landing.id);
});

/**
 * ***A backdrop that lands during a turn is shown after it, unless the turn
 * asked for its own.*** Dropping it would lose a picture somebody paid for;
 * selecting it then would put it on a line the commit abandons; and showing it
 * over a turn that went somewhere new would show the old place.
 */
describe('a backdrop that lands during a turn', () => {
  async function turnLands(sessionId: string, parent: string, over: Partial<Turn> = {}) {
    const turn = turnAfter(sessionId, parent, over);
    await appendTurnToSession(context, 'ned', sessionId, turn);
    return turn;
  }

  function backdropOf(turn: Turn | undefined): unknown {
    return turn?.effects[0]?.after;
  }

  it('waits for the turn, and is shown on top of it', async () => {
    const { sessionId, turns } = await aSessionOfTwo();
    const held = new DeferredBackdrops();

    busyNow = true;
    await offerBackdrop(context, held, 'ned', sessionId, 'r-arrived');
    expect((await readTurns(context, 'ned', sessionId)).size).toBe(2);

    busyNow = false;
    const committed = await turnLands(sessionId, turns[1]!.id);
    await showHeldBackdrop(context, held, sessionId, committed);

    const session = await readSession(context, 'ned', sessionId);
    const shown = (await readTurns(context, 'ned', sessionId)).get(session?.headTurnId ?? '');
    expect(shown?.parentTurnId).toBe(committed.id);
    expect(backdropOf(shown)).toEqual({ from: 'rendition', renditionId: 'r-arrived' });
    expect(held.take(sessionId)).toBeUndefined();
  });

  it('gives way to a backdrop the turn asked for, or reused', async () => {
    const { sessionId, turns } = await aSessionOfTwo();
    const held = new DeferredBackdrops();

    busyNow = true;
    await offerBackdrop(context, held, 'ned', sessionId, 'r-old-place');
    busyNow = false;
    const moved = await turnLands(sessionId, turns[1]!.id, {
      renditions: { requested: ['r-new-place'] },
    });
    await writeRendition(context.layout, 'ned', sessionId, aBackground('r-new-place', moved));
    await showHeldBackdrop(context, held, sessionId, moved);
    expect((await readSession(context, 'ned', sessionId))?.headTurnId).toBe(moved.id);

    busyNow = true;
    await offerBackdrop(context, held, 'ned', sessionId, 'r-old-place');
    busyNow = false;
    const returned = await turnLands(sessionId, moved.id, {
      renditions: { requested: [], reused: { renditionId: 'r-earlier', digest: 'd-1' } },
    });
    await showHeldBackdrop(context, held, sessionId, returned);
    expect((await readSession(context, 'ned', sessionId))?.headTurnId).toBe(returned.id);
  });
});

/**
 * ***A session restores past what a late writer left in its place***
 * (2026-09-27). A live session always has its `session.json`, so a folder at
 * the address without one is what was written after the session left: a turn
 * or a picture with no session around it. It refused the restore for good. It
 * now goes to the trash as an entry of its own.
 */
it('restores a session over a folder a late writer left in its place', async () => {
  const { sessionId } = await aSessionOfTwo();
  expect(await deleteSession(context, 'ned', sessionId)).toEqual({ kind: 'deleted' });
  const stray = join(context.layout.sessionRoot('ned', sessionId), 'assets', 'late.png');
  await writeFileBytes(stray, Uint8Array.from([1, 2, 3]));

  const [entry] = (await listTrash(context.layout, 'ned', 30)).filter(
    (one) => one.kind === 'sessions',
  );
  const restored = await restoreFromTrash(context.layout, 'ned', entry?.id ?? '');

  expect(restored.ok).toBe(true);
  expect((await readSession(context, 'ned', sessionId))?.id).toBe(sessionId);
  const after = (await listTrash(context.layout, 'ned', 30)).filter(
    (one) => one.kind === 'sessions',
  );
  expect(after.map((one) => one.name)).toEqual([sessionId]);
});

function aBackground(id: string, turn: Turn): Rendition {
  return {
    schema: RENDITION_SCHEMA,
    id,
    sessionId: turn.sessionId,
    turnId: turn.id,
    createdAt: '2026-09-27T12:00:00.000Z',
    kind: 'image',
    purpose: 'background',
    scope: null,
    state: 'pending',
    prompt: {
      fragments: [{ id: 'place', text: 'a harbour', rank: 100, required: true }],
      separator: ', ',
      budget: { maxChars: null, usefulChars: null },
      text: 'a harbour',
      kept: ['place'],
      dropped: [],
      overCap: false,
    },
    asset: null,
    provenance: { at: null, binding: null, answeredAs: null, seed: null, workflow: {} },
    error: null,
    digest: 'd-2',
    ordering: 0,
  };
}
