// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7 } from '@storyengine/shared';

import { Accounts } from '../auth/accounts.js';
import { openIndex, type OpenedIndex } from '../index-db/open.js';
import { SCENE_ID } from '../modes/scene/mode.js';
import { appendTurnToSession, createSession, type SessionContext } from '../sessions/store.js';
import type { ChannelEffect, Turn } from '../sessions/types.js';
import { Layout } from '../storage/layout.js';
import { gatherAssemblyInputs } from './gather.js';
import { create, type LibraryContext } from '../library.js';
import { newActor, newLorebook } from '@storyengine/shared';

/**
 * The gather a turn and a preview share — [P3.4].
 *
 * These are characterization tests: the code they cover moved out of the
 * runner unchanged, and the whole existing suite already proves a turn still
 * runs. What was never pinned anywhere is the pair of values whose slips fail
 * **silently** rather than throwing — the window, which quietly grows every
 * prompt, and the channel replay, which quietly empties every channel block.
 * Both were safe while the code had exactly one caller. They stop being safe
 * the moment there are two.
 */

let dataDir: string;
let index: OpenedIndex;
let sessions: SessionContext;
let accounts: Accounts;

const ACCOUNT = 'ned';
const CLOCK = 'se.clock';

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'se-gather-'));
  index = await openIndex({ path: ':memory:' });
  sessions = {
    layout: new Layout(dataDir),
    index: index.db,
    limits: { maxTurns: 1000, maxBytes: 10_000_000 },
  };
  accounts = new Accounts(new Layout(dataDir));
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

/** A session of `count` turns in a line, each moving the clock on by an hour. */
async function aSessionOf(count: number): Promise<{ sessionId: string; head: string }> {
  const session = await createSession(sessions, ACCOUNT, 'Rain City');
  let parent: string | null = null;

  for (let hour = 1; hour <= count; hour += 1) {
    const id = uuidv7();
    const turn: Turn = {
      id,
      sessionId: session.id,
      parentTurnId: parent,
      createdAt: new Date(Date.UTC(2026, 7, 16, hour)).toISOString(),
      status: 'complete',
      effects: [clockEffect(id, hour)],
      tape: [],
    };
    await appendTurnToSession(sessions, ACCOUNT, session.id, turn);
    parent = id;
  }

  if (parent === null) throw new Error('a session of no turns has no head');
  return { sessionId: session.id, head: parent };
}

describe('the history the collector is given', () => {
  it('is the mode’s window, not the whole path', async () => {
    // Scene's `historyWindow` is 20; twenty-five turns is comfortably past it.
    const { sessionId, head } = await aSessionOf(25);

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: head },
    );

    // Both are on the result and both are `Turn[]`, so nothing but a test can
    // tell them apart — which is exactly why handing the collector the wrong
    // one would grow every prompt until the budgeter started dropping, and
    // never throw. The falsifying mutation is `windowed: history`.
    expect(inputs.history).toHaveLength(25);
    expect(inputs.windowed).toHaveLength(20);
    // The window is the *newest* twenty, not the oldest.
    expect(inputs.windowed.at(-1)?.id).toBe(head);
    expect(inputs.windowed[0]?.id).toBe(inputs.history[5]?.id);
  });
});

describe('the channels the collector is given', () => {
  it('replays them from the effect log when the session file cannot be read', async () => {
    const { sessionId, head } = await aSessionOf(3);

    // The ternary's live branch, and the reason it exists: the effect log is
    // the source of truth and the head snapshot is *derived* ([02 §5.5]), so
    // a session whose file is unreadable still assembles against the right
    // clock rather than against nothing. The falsifying mutation is dropping
    // `replayChannels` and trusting the file unconditionally, which turns an
    // unreadable file into a session with no channel state at all.
    const file = join(sessions.layout.sessionRoot(ACCOUNT, sessionId), 'session.json');
    await writeFile(file, 'not json at all');

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: head },
    );

    expect(inputs.session).toBeNull();
    expect(inputs.channels[CLOCK]?.value).toEqual({ hour: 3 });
  });

  it('takes the file’s channels when it has them', async () => {
    const { sessionId, head } = await aSessionOf(3);

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: head },
    );

    expect(inputs.session).not.toBeNull();
    expect(inputs.channels[CLOCK]?.value).toEqual({ hour: 3 });
  });
});

describe('what the gather resolves without a job', () => {
  it('answers with the default mode and its preset, and needs no turn id', async () => {
    const { sessionId, head } = await aSessionOf(1);

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: head },
    );

    // The property the preview rests on: everything above is keyed by
    // (account, sessionId, parentTurnId) alone.
    expect(inputs.mode.definition.id).toBe(SCENE_ID);
    expect(inputs.declaredMode).toBe(SCENE_ID);
    expect(inputs.preset.blocks.length).toBeGreaterThan(0);
    expect(inputs.cast.actors).toEqual([]);
  });

  it('resolves an account that does not exist to no capabilities, not to the defaults', async () => {
    const { sessionId, head } = await aSessionOf(1);

    // [04 §4.5]: a deleted account's queued turn must not run with more
    // authority than a live one whose capability was revoked. Reaching the
    // personal-connection branch needs a connection on disk; what is asserted
    // here is that the read completes and offers none.
    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: head },
    );

    expect(inputs.usable).toEqual([]);
  });
});

/**
 * The cast reaching the lore resolver — [P5.7].
 *
 * `scope: linked` means *this book belongs wherever these actors are*, and
 * whether an actor is there is a fact only the gather knows. It resolves the
 * cast two lines above the lore, and nothing but this test says the two are
 * connected: a resolver called without the cast would compile, admit every
 * global book exactly as before, and silently never admit a linked one.
 */
describe('what the gather tells the lore resolver about the cast', () => {
  async function withCast(cast: { persona: string | null; actors: string[] }): Promise<string> {
    const created = await createSession(sessions, ACCOUNT, { name: 'Scoped', cast });
    return created.id;
  }

  function libraryOf(): LibraryContext {
    return { db: sessions.index, layout: sessions.layout, keepHistoryPerObject: 0 };
  }

  async function linkedTo(actorIds: string[]): Promise<void> {
    const made = { ...newLorebook('Theirs'), scope: { kind: 'linked' as const, actorIds } };
    await create(libraryOf(), ACCOUNT, made);
  }

  it('admits a book linked to an actor in the cast', async () => {
    const vera = newActor('Vera');
    await create(libraryOf(), ACCOUNT, vera);
    await linkedTo([vera.id]);
    const sessionId = await withCast({ persona: null, actors: [vera.id] });

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: null },
    );

    expect(inputs.lore.books.map((one) => one.by)).toEqual(['linked']);
  });

  /**
   * A persona *is* an actor ([02 §2.2]), and a book scoped to the player's own
   * character is the first thing anybody would scope one to. Left out of the
   * list, that book would never appear and the reason would be invisible.
   */
  it('counts the persona as part of the cast', async () => {
    const inspector = newActor('The Inspector');
    await create(libraryOf(), ACCOUNT, inspector);
    await linkedTo([inspector.id]);
    const sessionId = await withCast({ persona: inspector.id, actors: [] });

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: null },
    );

    expect(inputs.lore.books.map((one) => one.by)).toEqual(['linked']);
  });

  it('leaves out a book linked to an actor who is not in the scene', async () => {
    const vera = newActor('Vera');
    await create(libraryOf(), ACCOUNT, vera);
    await linkedTo([vera.id]);
    const sessionId = await withCast({ persona: null, actors: [] });

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: null },
    );

    expect(inputs.lore.books).toEqual([]);
  });
});
