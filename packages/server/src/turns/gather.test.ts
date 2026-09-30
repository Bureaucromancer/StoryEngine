// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidv7, type Preset } from '@storyengine/shared';

import { Accounts } from '../auth/accounts.js';
import { openIndex, type OpenedIndex } from '../index-db/open.js';

import {
  appendTurnToSession,
  createSession,
  readSession,
  writeChannel,
  type SessionContext,
} from '../sessions/store.js';
import type { ChannelEffect, SessionFile, Turn } from '../sessions/types.js';
import { Layout } from '../storage/layout.js';
import { installBuiltIns } from '../mode-loader.js';
import { DEFAULT_MODE_ID, defaultMode } from '../mode-registry.js';
import { collectFor, gatherAssemblyInputs } from './gather.js';
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
  await installBuiltIns();

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
      // A turn of the story: the window counts those (`sessions/depth.ts`).
      output: { text: `Hour ${String(hour)} passed in the rain.` },
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

  /**
   * ***Twenty turns of the story, however many edits sit among them***
   * (2026-09-27). The window was the path's last twenty, and a channel write
   * or a backdrop choice is on the path with nothing said in it: each one
   * pushed a turn somebody read out of the prompt.
   */
  it('holds the last turns of the story, not the last turns of the path', async () => {
    const { sessionId } = await aSessionOf(25);
    for (let edit = 0; edit < 5; edit += 1) {
      await writeChannel(sessions, ACCOUNT, sessionId, 'se.hook.pacing', 'sparse');
    }
    const head = (await readSession(sessions, ACCOUNT, sessionId))?.headTurnId ?? null;

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId, parentTurnId: head },
    );

    expect(inputs.history).toHaveLength(30);
    expect(inputs.windowed).toHaveLength(20);
    expect(inputs.windowed.every((turn) => turn.output !== undefined)).toBe(true);
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
    // **The default mode, named through the registry rather than imported**
    // — [P7.0]. What this asserts is that a session naming nothing resolves to
    // the build's default, which is a fact about the registry; reaching for the
    // mode's own constant asserted the same thing and coupled an engine test to
    // a package the engine may not import.
    expect(inputs.mode.definition.id).toBe(DEFAULT_MODE_ID);
    expect(inputs.declaredMode).toBe(DEFAULT_MODE_ID);
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
 * ***The collector is told the mode the turn plays*** (2026-09-30), so a
 * channel slot, the state block and a tracker standing a slot aside see only
 * that mode's channels (`channelInPlay`) — the rule the HUD and the channel
 * write kept, where the collector walked every mode's declarations.
 */
describe('the mode the collector is told', () => {
  it('is the one the session plays, so another mode’s tracker says nothing', async () => {
    const state = defaultMode().definition.assembly.defaultPreset.blocks.find(
      (block) => block.id === 'se.state',
    );
    if (state === undefined) throw new Error('the default pack has a state slot');
    const world = {
      'se.track.world.on': { version: 1, value: true },
      'se.track.world': {
        version: 1,
        value: {
          date: '',
          time: 'dusk',
          location: 'the docks',
          weather: '',
          temperature: '',
          fields: [],
          recent: [],
        },
      },
    };
    const said = async (modeId: string): Promise<string | undefined> => {
      const created = await createSession(sessions, ACCOUNT, {
        name: modeId,
        mode: { id: modeId, config: null },
      });
      const inputs = await gatherAssemblyInputs(
        { sessions, accounts },
        { account: ACCOUNT, sessionId: created.id, parentTurnId: null },
      );
      const collected = collectFor(
        { ...inputs, preset: { ...inputs.preset, blocks: [{ ...state, enabled: true }] } },
        { callKind: 'narrate', voice: 'narrator', channels: world, lore: [] },
      );
      return collected.candidates.find((candidate) => candidate.id === 'se.state')?.text;
    };

    expect(await said(DEFAULT_MODE_ID)).toContain('the docks');
    expect(await said('storyengine.freeform')).toBeUndefined();
  });
});

/**
 * ***A session copied before a block shipped is assembled with it***
 * (2026-09-27) — `presetOf`, through the gather every turn and every preview
 * calls. The file on disk is exactly what a session begun on the first alpha
 * holds: Scene's pack without the summary slot and without pacing levels. Read
 * as the file said, its story above the window never reached a prompt and its
 * hooks came with no pacing prose.
 */
describe('the pack a session is assembled from', () => {
  function sceneWithout(blockIds: string[]): Preset {
    const pack = structuredClone(defaultMode().definition.assembly.defaultPreset);
    pack.blocks = pack.blocks.filter((block) => !blockIds.includes(block.id));
    delete pack.pacingLevels;
    return pack;
  }

  it('gains what the mode shipped after the session copied its pack', async () => {
    const session = await createSession(sessions, ACCOUNT, {
      name: 'Begun on alpha.1',
      preset: sceneWithout(['se.summary']),
    });

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId: session.id, parentTurnId: null },
    );

    const shipped = defaultMode().definition.assembly.defaultPreset;
    expect(inputs.preset.blocks.map((block) => block.id)).toEqual(
      shipped.blocks.map((block) => block.id),
    );
    expect(inputs.preset.pacingLevels).toEqual(shipped.pacingLevels);
    // Read, never written: the file keeps what it was until somebody edits it.
    const stored = await readSession(sessions, ACCOUNT, session.id);
    expect(stored?.preset?.blocks.map((block) => block.id)).not.toContain('se.summary');
  });

  it('reads a library preset exactly as the session copied it', async () => {
    const library = { ...sceneWithout(['se.summary']), id: uuidv7(), name: 'Harbour' };
    const session = await createSession(sessions, ACCOUNT, {
      name: 'On a library pack',
      preset: library,
    });

    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId: session.id, parentTurnId: null },
    );

    expect(inputs.preset).toEqual(library);
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

/**
 * ***A narrated session keeps the presence reading it was played with***
 * (2026-09-29, the [P14.3] review). Scene declares `castIsPresent` since
 * P14.3, and read through the mode alone that re-read every narrated
 * session's presence: a member the story had walked out (`false`, the
 * channel's *not in this room*) lost their card from the narrator's one
 * merged call. Tied to the session's voice, a `legacy` session and one P14.0
 * made narrated keep the prompt they had.
 */
describe('a muted-looking member in a narrated session', () => {
  function libraryOf(): LibraryContext {
    return { db: sessions.index, layout: sessions.layout, keepHistoryPerObject: 0 };
  }

  async function assembled(
    fields: Partial<Pick<SessionFile, 'voice' | 'dispatch' | 'speakers'>>,
  ): Promise<{ ids: string[]; veraId: string }> {
    const plain = newActor('Vera');
    const vera = {
      ...plain,
      profile: {
        ...plain.profile,
        sections: plain.profile.sections.map((section) =>
          section.id === 'se.summary' ? { ...section, body: 'Vera keeps the ferry.' } : section,
        ),
      },
    };
    await create(libraryOf(), ACCOUNT, vera);
    const created = await createSession(sessions, ACCOUNT, {
      name: 'Walked out',
      cast: { persona: null, actors: [vera.id] },
    });
    const inputs = await gatherAssemblyInputs(
      { sessions, accounts },
      { account: ACCOUNT, sessionId: created.id, parentTurnId: null },
    );
    if (inputs.session === null) throw new Error('the session reads');
    // The file as the era wrote it: none of the three for `legacy`.
    const bare: SessionFile = { ...inputs.session };
    delete bare.voice;
    delete bare.dispatch;
    delete bare.speakers;
    const collected = collectFor(
      { ...inputs, session: { ...bare, ...fields } },
      {
        callKind: 'narrate',
        voice: fields.voice ?? 'narrator',
        channels: { ...inputs.channels, [`se.presence#${vera.id}`]: { version: 1, value: false } },
        lore: [],
      },
    );
    return { ids: collected.candidates.map((one) => one.id), veraId: vera.id };
  }

  it('keeps their card in a legacy session’s narrator call', async () => {
    const { ids, veraId } = await assembled({});

    expect(ids).toContain(`se.actor.summary.${veraId}`);
  });

  it('keeps it in a session P14.0 created narrated', async () => {
    const { ids, veraId } = await assembled({ voice: 'narrator', dispatch: 'merged' });

    expect(ids).toContain(`se.actor.summary.${veraId}`);
  });

  it('drops it from a room that reads her as muted, which an embodied one does', async () => {
    const { ids, veraId } = await assembled({ voice: 'embodied', dispatch: 'per-actor' });

    expect(ids).not.toContain(`se.actor.summary.${veraId}`);
  });
});
