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
import { installBuiltIns } from '../modes/built-ins.js';
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
  // Registration is a call rather than an import since [P7.0], and this test
  // reaches the pipeline without going through `buildServices` — so it asks for
  // the built-ins the same way the composition root does. A test that needs a
  // mode now says so, which is the visibility the split was for.
  installBuiltIns();

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
async function aSessionOf(
  count: number,
): Promise<{ sessionId: string; head: string; ids: string[] }> {
  const ids: string[] = [];
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
    ids.push(id);
    parent = id;
  }

  if (parent === null) throw new Error('a session of no turns has no head');
  return { sessionId: session.id, head: parent, ids };
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
    // the source of truth and the head snapshot is *derived* ([03 §5.5]), so
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

  it('replays them at the node asked for, rather than reading the head’s', async () => {
    // [P6.0b]: the file's map is state at `headTurnId` and at no other node, so
    // preferring it whenever the file was readable assembled this history
    // against another node's state. Assembling at the first of three turns is
    // the cheapest demonstration — one hour in, not three — and it is the same
    // fault a branch gesture meets, since an ancestor is no more the head than
    // a sibling is.
    const { sessionId, ids } = await aSessionOf(3);

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: ids[0] ?? null },
    );

    expect(inputs.session).not.toBeNull();
    expect(inputs.channels[CLOCK]?.value).toEqual({ hour: 1 });
  });

  it('gives an abandoned line its own state while the head is on a sibling', async () => {
    // The case the phase is for, driven at the level the runner drives it: the
    // head is on one branch and the assembly is asked for the other. The clock
    // alone would not show a wrong map — a whole-value set lands on the same
    // number whichever map it folds onto — so the abandoned line writes a
    // second key that the sibling's path never wrote, which is what P5's lore
    // timing looks like on the wire.
    const { sessionId, ids } = await aSessionOf(1);
    const fork = ids[0] ?? null;

    const abandonedId = uuidv7();
    await appendTurnToSession(sessions, ACCOUNT, sessionId, {
      id: abandonedId,
      sessionId,
      parentTurnId: fork,
      createdAt: new Date(Date.UTC(2026, 7, 16, 2)).toISOString(),
      status: 'complete',
      effects: [
        clockEffect(abandonedId, 2),
        {
          ...clockEffect(abandonedId, 2),
          channelId: 'se.lore.timing',
          scopeKey: 'ferryman',
          before: null,
          after: { sticky: 0, cooldown: 2, fired: 1 },
        },
      ],
      tape: [],
    });

    const siblingId = uuidv7();
    await appendTurnToSession(sessions, ACCOUNT, sessionId, {
      id: siblingId,
      sessionId,
      parentTurnId: fork,
      createdAt: new Date(Date.UTC(2026, 7, 16, 3)).toISOString(),
      status: 'complete',
      effects: [clockEffect(siblingId, 50)],
      tape: [],
    });

    // The head is the sibling; the assembly is asked for the other line's tip.
    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: abandonedId },
    );

    expect(inputs.session?.headTurnId).toBe(siblingId);
    expect(inputs.channels[CLOCK]?.value).toEqual({ hour: 2 });
    expect(inputs.channels['se.lore.timing#ferryman']?.value).toEqual({
      sticky: 0,
      cooldown: 2,
      fired: 1,
    });
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

    // [09 §4.5]: a deleted account's queued turn must not run with more
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
 * **No lorebook is active that has not been selected for the session.**
 *
 * ~~The cast reaching the lore resolver, for `scope: linked`.~~ [P5.7] admitted
 * books by their own scope and this is the reversal, asserted where it is
 * observable end to end: the gather is what a turn actually calls, so a
 * regression that let the library back in would show here first.
 *
 * `global` is the case that matters, because it is what every book is by
 * default — the factory sets it and the SillyTavern importer falls back to it.
 * A book nobody selected is not in the prompt.
 */
describe('what a session gets without asking for it', () => {
  function libraryOf(): LibraryContext {
    return { db: sessions.index, layout: sessions.layout, keepHistoryPerObject: 0 };
  }

  it('reads no lorebook at all for a session that links none', async () => {
    await create(libraryOf(), ACCOUNT, newLorebook('Everywhere'));
    await create(libraryOf(), ACCOUNT, {
      ...newLorebook('Vera\u2019s'),
      scope: { kind: 'linked' as const, actorIds: ['vera'] },
    });
    const created = await createSession(sessions, ACCOUNT, { name: 'Bare' });

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId: created.id, parentTurnId: null },
    );

    expect(inputs.lore.books).toEqual([]);
  });

  /**
   * And a cast changes nothing about it, which is the specific reversal: an
   * actor being in the scene used to pull that actor's books in.
   */
  it('reads no lorebook for a session whose cast matches one', async () => {
    const vera = newActor('Vera');
    await create(libraryOf(), ACCOUNT, vera);
    await create(libraryOf(), ACCOUNT, {
      ...newLorebook('Hers'),
      scope: { kind: 'linked' as const, actorIds: [vera.id] },
    });
    const created = await createSession(sessions, ACCOUNT, {
      name: 'With Vera',
      cast: { persona: null, actors: [vera.id] },
    });

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId: created.id, parentTurnId: null },
    );

    expect(inputs.lore.books).toEqual([]);
  });

  it('reads the one the session did select, and only that one', async () => {
    const chosen = newLorebook('Chosen');
    await create(libraryOf(), ACCOUNT, chosen);
    await create(libraryOf(), ACCOUNT, newLorebook('Not chosen'));
    const created = await createSession(sessions, ACCOUNT, {
      name: 'Selected',
      lore: [chosen.id],
    });

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId: created.id, parentTurnId: null },
    );

    expect(inputs.lore.books.map((one) => one.book.name)).toEqual(['Chosen']);
    expect(inputs.lore.books[0]?.by).toBe('session');
  });
});
