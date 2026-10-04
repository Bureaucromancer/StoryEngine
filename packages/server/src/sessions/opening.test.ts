// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeAll, describe, expect, it } from 'vitest';

import {
  newActor,
  newSetup,
  redoable,
  type Actor,
  type Opening,
  type PlotHook,
  type Setup,
} from '@storyengine/shared';

import { installBuiltIns } from '../mode-loader.js';
import { readParty, SE_PARTY } from './cast.js';
import { readHookState, SE_HOOK } from './hooks.js';
import {
  carriesOpening,
  chooseOpening,
  firstTurns,
  openingChoiceRefusal,
  type FirstTurnsRequest,
} from './opening.js';
import { applyEffects } from './store.js';
import type { PooledHook, Turn } from './types.js';

/**
 * ***What a session starts on*** — [03 §6](../../../../docs/design/03-data-model.md),
 * [P15.3](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md), and
 * since the merge (2026-10-03) the one account of turn 1 that holds it and
 * [P14.4](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * greetings together.
 *
 * Pure, so everything the route relies on is asserted over values here and the
 * route's own tests only have to show the turns arrive. **Every effect is read
 * back through the reader the rest of the engine uses** — `readParty`,
 * `readHookState` over `applyEffects` — because an effect that was recorded
 * and applied but keyed so that no reader found it would pass a test that
 * looked at the effect list, and seed nothing.
 */

beforeAll(async () => {
  // `acceptEffect` reads the channel declarations; an unregistered channel is a
  // recorded refusal, which would make every assertion below about a refusal.
  await installBuiltIns();
});

const opening = (id: string, text: string): Opening => ({ id, label: id, text });

function setupWith(over: Partial<Setup> = {}): Setup {
  const made = newSetup('The Fixer’s Debt');
  return {
    ...made,
    openings: {
      written: [opening('o-docks', 'Rain on the docks.'), opening('o-office', 'The office.')],
      seeds: [],
      primaryWrittenId: 'o-office',
      primarySeedId: null,
    },
    ...over,
  };
}

/** A Setup that holds no written opening at all. */
const unopened = (over: Partial<Setup> = {}): Setup =>
  setupWith({
    openings: { written: [], seeds: [], primaryWrittenId: null, primarySeedId: null },
    ...over,
  });

function hook(id: string): PlotHook {
  return {
    id,
    title: id,
    premise: `the premise of ${id}`,
    magnitude: 'local',
    involves: [],
    weight: 1,
    delivery: 'guidance',
    once: true,
  };
}

const pool = (...ids: string[]): PooledHook[] =>
  ids.map((id) => ({ hook: hook(id), source: { kind: 'treatment', id: 'treat-1' } }));

/** A cast member with written greetings, the first the primary. */
function member(id: string, name: string, ...greetings: string[]): Actor {
  const made = newActor(name);
  const written = greetings.map((text, at) => opening(`${id}-g${String(at)}`, text));
  return {
    ...made,
    id,
    openings: { ...made.openings, written, primaryWrittenId: written[0]?.id ?? null },
  };
}

/** Vera seated by the Setup, and the hook it says had fired — the seeding under test. */
const SEEDING: Partial<Setup> = {
  cast: {
    personaOptions: [],
    partyDefault: [{ id: 'vera', name: 'Vera' }],
    narrator: null,
  },
  spentHooks: ['hook-ledger'],
};

/**
 * `firstTurns` for a Setup and a cast — the opening chosen as the route
 * chooses it (`chooseOpening`, the primary when nobody said) unless `opening`
 * names one, `null` being start cold.
 */
function start(
  setup: Setup | null,
  over: {
    opening?: Opening | null;
    greetings?: FirstTurnsRequest['greetings'];
    createdAt?: string;
  } = {},
): { turns: Turn[]; head: string } | null {
  const chosen = setup === null ? null : chooseOpening(setup.openings, undefined);
  return firstTurns({
    sessionId: 's1',
    setup:
      setup === null
        ? null
        : {
            setup,
            opening:
              over.opening !== undefined ? over.opening : chosen === 'unknown' ? null : chosen,
            pool: pool('hook-ledger', 'hook-fresh'),
            personaId: null,
          },
    greetings: over.greetings ?? null,
    ...(over.createdAt === undefined ? {} : { createdAt: over.createdAt }),
  });
}

/** Who said what on a turn, as a reader of the transcript sees it. */
function said(turn: Turn | undefined): string[] {
  const messages = turn?.output?.messages;
  if (messages !== undefined) {
    return messages.map((message) => `${message.speaker?.name ?? '-'}: ${message.text}`);
  }
  return turn?.output === undefined ? [] : [turn.output.text];
}

/** The channels at a node, folded along its path from the root. */
function channelsAt(turns: readonly Turn[], id: string): ReturnType<typeof applyEffects> {
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const path: Turn[] = [];
  for (let at = byId.get(id); at !== undefined;) {
    path.unshift(at);
    at = at.parentTurnId === null ? undefined : byId.get(at.parentTurnId);
  }
  return path.reduce<ReturnType<typeof applyEffects>>(
    (channels, turn) => applyEffects(channels, turn.effects),
    {},
  );
}

describe('which opening a creation asked for', () => {
  const { openings } = setupWith();

  it('takes the primary when nobody chose, and the one named when somebody did', () => {
    expect(chooseOpening(openings, undefined)).toMatchObject({ id: 'o-office' });
    expect(chooseOpening(openings, 'o-docks')).toMatchObject({ id: 'o-docks' });
  });

  it('starts cold when asked to, even with openings to offer', () => {
    // 03 §6's third choice, and a choice rather than an absence.
    expect(chooseOpening(openings, null)).toBeNull();
  });

  it('refuses a named opening that is not there rather than substituting the primary', () => {
    expect(chooseOpening(openings, 'o-nowhere')).toBe('unknown');
  });

  it('falls back to the first written one when the primary pointer is stale', () => {
    expect(chooseOpening({ ...openings, primaryWrittenId: 'o-deleted' }, undefined)).toMatchObject({
      id: 'o-docks',
    });
    expect(chooseOpening({ ...openings, written: [] }, undefined)).toBeNull();
    expect(chooseOpening(undefined, undefined)).toBeNull();
  });

  /**
   * ***An opening with no words is not an opening*** — one reading for both
   * halves since the merge (2026-10-03): P14.4 always skipped a blank
   * greeting, and a Setup's editor can leave a blank opening behind, which
   * would otherwise be a blank first turn that silences the cast's greetings.
   * Mutation: drop `writtenOf`'s filter and the Setup's three fail.
   */
  it('takes an opening with no words for none, on a Setup as on a card', () => {
    const blank = { ...openings, written: [opening('o-blank', '  '), ...openings.written] };
    expect(chooseOpening({ ...blank, primaryWrittenId: 'o-blank' }, undefined)).toMatchObject({
      id: 'o-docks',
    });
    expect(chooseOpening(blank, 'o-blank')).toBe('unknown');
    const onlyBlank = { ...openings, written: [opening('o-b', '')], primaryWrittenId: 'o-b' };
    expect(carriesOpening(setupWith({ openings: onlyBlank }))).toBe(false);
    expect(
      openingChoiceRefusal([member('vera', 'Vera', '', 'Hello.')], { vera: 'vera-g0' }),
    ).toEqual({ kind: 'no-such-opening', actorId: 'vera', openingId: 'vera-g0' });
  });

  it('says whether a Setup carries an opening, whatever was chosen from it', () => {
    expect(carriesOpening(setupWith())).toBe(true);
    expect(carriesOpening(unopened())).toBe(false);
    expect(carriesOpening(undefined)).toBe(false);
  });
});

describe('the Setup’s turn', () => {
  it('is the opening, written by the engine, as the root of the story', () => {
    const setup = setupWith();
    const started = start(setup, {
      opening: setup.openings.written[0] ?? null,
      createdAt: '2026-09-26T00:00:00.000Z',
    });
    const turn = started?.turns[0];

    expect(started?.turns).toHaveLength(1);
    expect(started?.head).toBe(turn?.id);
    expect(turn).toMatchObject({
      sessionId: 's1',
      parentTurnId: null,
      createdAt: '2026-09-26T00:00:00.000Z',
      status: 'complete',
      output: { text: 'Rain on the docks.' },
      effects: [],
      tape: [],
    });
    // Nobody said anything and nothing was called, so there is nothing to
    // redo — the convention that replaced `Turn.opening` (2026-10-03), and no
    // field says so.
    expect(turn?.input).toBeUndefined();
    expect(turn?.request).toBeUndefined();
    expect(turn === undefined || redoable(turn)).toBe(false);
    expect(Object.keys(turn ?? {})).not.toContain('opening');
  });

  it('seats the party and spends the hooks, through the readers the engine uses', () => {
    const setup = setupWith({
      cast: {
        personaOptions: [{ id: 'marlow', name: 'Marlow' }],
        partyDefault: [
          { id: 'marlow', name: 'Marlow' },
          { id: 'vera', name: 'Vera' },
          { id: 'vera', name: 'Vera' },
        ],
        narrator: null,
      },
      spentHooks: ['hook-ledger', 'hook-not-in-pool', 'hook-ledger'],
    });

    const turn = firstTurns({
      sessionId: 's1',
      setup: { setup, opening: null, pool: pool('hook-ledger', 'hook-fresh'), personaId: 'marlow' },
      greetings: null,
    })?.turns[0];
    const channels = applyEffects({}, turn?.effects ?? []);

    expect(readParty(channels, 'vera', 'marlow')).toBe('companion');
    // The persona is in the party by the reader's invariant, not by a write.
    expect(readParty(channels, 'marlow', 'marlow')).toBe('player');
    expect(readHookState(channels, 'hook-ledger')).toBe('fired');
    expect(readHookState(channels, 'hook-fresh')).toBeNull();

    // Once each, by the engine, and every one applied — a refusal here would
    // be a channel policy the opening does not satisfy.
    expect(turn?.effects.map((effect) => [effect.channelId, effect.scopeKey])).toEqual([
      [SE_PARTY, 'vera'],
      [SE_HOOK, 'hook-ledger'],
    ]);
    expect(turn?.effects.every((effect) => effect.applied)).toBe(true);
    expect(turn?.effects.every((effect) => effect.proposedBy.kind === 'engine')).toBe(true);
    expect(turn?.effects.every((effect) => effect.turnId === turn.id)).toBe(true);
  });

  it('writes the seeding without an opening when somebody starts cold, and no output', () => {
    const turn = start(setupWith({ spentHooks: ['hook-ledger'] }), { opening: null })?.turns[0];

    expect(turn?.output).toBeUndefined();
    expect(turn?.effects).toHaveLength(1);
  });

  it('writes no turn at all when there is nothing to write', () => {
    // [P7.4]'s rule: a blank first entry is a cost nobody asked for.
    expect(start(setupWith({ spentHooks: ['hook-not-in-pool'] }), { opening: null })).toBeNull();
    expect(start(null)).toBeNull();
  });
});

/**
 * ***A Setup's opening against a cast's greetings*** — the merge's question,
 * and the module header's rules, each asserted where it decides.
 */
describe('one account of turn 1', () => {
  const vera = member('vera', 'Vera', '"You came."', '"Late again."');
  const lund = member('lund', 'Lund', 'Lund nods.');
  const greetings = (...members: Actor[]): FirstTurnsRequest['greetings'] => ({
    members,
    user: 'Ned',
    choices: {},
  });

  /**
   * ***The owner's decision, 2026-10-03 — [26 B18](../../../../docs/design/26-open-questions.md).*** Mutation: make
   * `setupWins` false and the greetings are written beside the opening, two
   * first turns where the rule allows one.
   */
  it('writes only the Setup’s opening when it carries one, never the greetings beside it', () => {
    const started = start(setupWith(SEEDING), { greetings: greetings(vera) });

    expect(started?.turns).toHaveLength(1);
    expect(said(started?.turns[0])).toEqual(['The office.']);
    expect(started?.head).toBe(started?.turns[0]?.id);
    // The seeding rides on the opening itself, as it always did.
    expect(readParty(channelsAt(started?.turns ?? [], started?.head ?? ''), 'vera', null)).toBe(
      'companion',
    );
  });

  /**
   * ***And when it is started cold***: *neither* is a choice, not a gap for a
   * greeting to fill. Mutation: test `from.opening !== null` alone, dropping
   * `carriesOpening`, and a cold start writes the greetings.
   */
  it('writes no greeting when a Setup that carries an opening is started cold', () => {
    const seeded = start(setupWith(SEEDING), { opening: null, greetings: greetings(vera) });
    expect(seeded?.turns).toHaveLength(1);
    expect(said(seeded?.turns[0])).toEqual([]);
    expect(seeded?.turns[0]?.effects).toHaveLength(2);

    expect(start(setupWith(), { opening: null, greetings: greetings(vera) })).toBeNull();
  });

  it('leaves the greetings as P14.4 writes them for a Setup with no opening and nothing seeded', () => {
    const started = start(unopened(), { greetings: greetings(vera) });

    // One character: the primary and its alternate, siblings at the root.
    expect(started?.turns.map(said)).toEqual([['Vera: "You came."'], ['Vera: "Late again."']]);
    expect(started?.turns.every((turn) => turn.parentTurnId === null)).toBe(true);
    expect(started?.head).toBe(started?.turns[0]?.id);
    expect(started?.turns.every((turn) => turn.effects.length === 0)).toBe(true);
  });

  /**
   * ***Rule 3 — recommended answer, owner deferred, 2026-10-03.*** The
   * greetings hang from the seeding turn, so whichever one the head is on,
   * the party is seated and the spent hook spent. Mutation: hang them at the
   * root (`parentTurnId` null) and the head's path loses the seeding — the
   * defect the merge's placeholder had.
   */
  it('hangs the greetings from the seeding turn when a Setup with no opening seeds state', () => {
    const started = start(unopened(SEEDING), {
      greetings: { members: [vera], user: 'Ned', choices: { vera: 'vera-g1' } },
    });
    const [seed, ...rest] = started?.turns ?? [];

    expect(seed?.parentTurnId).toBeNull();
    expect(seed?.output).toBeUndefined();
    expect(seed?.effects.map((effect) => [effect.channelId, effect.scopeKey])).toEqual([
      [SE_PARTY, 'vera'],
      [SE_HOOK, 'hook-ledger'],
    ]);
    expect(rest.map(said)).toEqual([['Vera: "You came."'], ['Vera: "Late again."']]);
    expect(rest.every((turn) => turn.parentTurnId === seed?.id)).toBe(true);
    // A greeting is still words and nothing else.
    expect(rest.every((turn) => turn.effects.length === 0)).toBe(true);

    // The head is on the alternate the form chose, and its path is seated and
    // spent — as is every other alternate's.
    expect(started?.head).toBe(rest[1]?.id);
    for (const greeting of rest) {
      const channels = channelsAt(started?.turns ?? [], greeting.id);
      expect(readParty(channels, 'vera', null)).toBe('companion');
      expect(readHookState(channels, 'hook-ledger')).toBe('fired');
    }
  });

  it('writes a group’s greetings as one turn in cast order, with no Setup at all', () => {
    const started = start(null, { greetings: greetings(lund, member('abel', 'Abel'), vera) });

    expect(started?.turns).toHaveLength(1);
    // Abel has nothing written and says nothing.
    expect(said(started?.turns[0])).toEqual(['Lund: Lund nods.', 'Vera: "You came."']);
    expect(started?.turns[0]?.parentTurnId).toBeNull();
  });
});
