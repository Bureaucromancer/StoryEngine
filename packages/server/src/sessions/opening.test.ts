// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeAll, describe, expect, it } from 'vitest';

import { newSetup, type Opening, type PlotHook, type Setup } from '@storyengine/shared';

import { installBuiltIns } from '../mode-loader.js';
import { readParty, SE_PARTY } from './cast.js';
import { readHookState, SE_HOOK } from './hooks.js';
import { chooseOpening, openingTurn } from './opening.js';
import { applyEffects } from './store.js';
import type { PooledHook } from './types.js';

/**
 * ***The opening turn*** — [03 §6](../../../../docs/design/03-data-model.md),
 * [P13.3](../../../../docs/design/workplan/30-p13-implementation.md).
 *
 * Pure, so everything the route relies on is asserted over values here and the
 * route's own tests only have to show the turn arrives. **Every effect is read
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
});

describe('the opening turn', () => {
  it('is the opening, written by the engine, as the root of the story', () => {
    const setup = setupWith();
    const turn = openingTurn({
      sessionId: 's1',
      setup,
      opening: setup.openings.written[0] ?? null,
      pool: [],
      persona: null,
      createdAt: '2026-09-26T00:00:00.000Z',
    });

    expect(turn).toMatchObject({
      sessionId: 's1',
      parentTurnId: null,
      status: 'complete',
      output: { text: 'Rain on the docks.' },
      opening: { id: 'o-docks' },
      effects: [],
      tape: [],
    });
    // Nobody said anything, so there is nothing to redo — the play surface
    // reads this absence as it does a divergence turn's.
    expect(turn?.input).toBeUndefined();
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

    const turn = openingTurn({
      sessionId: 's1',
      setup,
      opening: null,
      pool: pool('hook-ledger', 'hook-fresh'),
      persona: 'marlow',
    });
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
    const turn = openingTurn({
      sessionId: 's1',
      setup: setupWith({ spentHooks: ['hook-ledger'] }),
      opening: null,
      pool: pool('hook-ledger'),
      persona: null,
    });

    expect(turn?.output).toBeUndefined();
    expect(turn?.opening).toBeUndefined();
    expect(turn?.effects).toHaveLength(1);
  });

  it('writes no turn at all when there is nothing to write', () => {
    // [P7.4]'s rule: a blank first entry is a cost nobody asked for.
    expect(
      openingTurn({
        sessionId: 's1',
        setup: setupWith({ spentHooks: ['hook-not-in-pool'] }),
        opening: null,
        pool: [],
        persona: null,
      }),
    ).toBeNull();
  });
});
