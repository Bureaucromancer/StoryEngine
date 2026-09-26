// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { newActor, validate, type Goal, type PlotHook } from '@storyengine/shared';

import { SE_PARTY } from './cast.js';
import { channelKey } from './channels.js';
import { SE_CONCLUDED, SE_GOAL, SE_GOAL_CURRENT } from './goals.js';
import { SE_HOOK, SE_HOOK_PACING } from './hooks.js';
import {
  buildSetup,
  carryAt,
  previewOf,
  type CarryChoices,
  type CarrySource,
} from './setup-from-turn.js';
import type { PooledHook } from './types.js';

/**
 * ***The carry*** — [04 §7.2](../../../../docs/design/04-schemas.md),
 * [P13.5](../../../../docs/design/workplan/30-p13-implementation.md).
 *
 * Over values, because every rule here is a statement about a channel map and a
 * pool. **The property at the bottom is the one the phase exists to keep**: no
 * serialised preview, for any pool and any goal chain, carries a premise, an
 * entrance's words or a hidden goal's statement.
 */

const ALL: CarryChoices = { party: true, goals: true, hooks: true };

function member(id: string, name: string) {
  return { actor: { ...newActor(name), id }, contentHash: `hash-${id}` };
}

function hook(id: string, over: Partial<PlotHook> = {}): PlotHook {
  return {
    id,
    title: `title of ${id}`,
    premise: `SECRET premise of ${id}`,
    magnitude: 'local',
    involves: [],
    weight: 1,
    delivery: 'guidance',
    once: true,
    ...over,
  };
}

function goal(id: string, over: Partial<Goal> = {}): Goal {
  return {
    id,
    statement: `statement of ${id}`,
    detail: null,
    visibility: 'player',
    completion: { kind: 'narrative' },
    thenDefault: 'advance',
    next: null,
    ...over,
  };
}

const value = (v: unknown) => ({ value: v });

function source(over: Partial<CarrySource> = {}): CarrySource {
  return {
    session: {
      mode: { id: 'storyengine.freeform', config: { difficulty: 'even' } },
      treatment: 'treat-1',
      lore: ['book-1', 'book-gone'],
      cast: { persona: 'marlow', actors: ['vera'] },
    },
    channels: {},
    pool: [],
    goals: [],
    lore: {
      treatment: {
        id: 'treat-1',
        contentHash: 'h',
        treatment: { name: 'Rain City, noir' } as never,
      },
      books: [{ id: 'book-1', contentHash: 'h', book: { name: 'Rain City' } as never } as never],
    },
    cast: { persona: member('marlow', 'Marlow'), actors: [member('vera', 'Vera')] },
    defaultPresetId: 'pack-default',
    ...over,
  };
}

describe('what crosses from the turn', () => {
  it('names the configuration by id and by name, and dangles visibly', () => {
    const carry = carryAt(source());

    expect(carry.mode).toEqual({ id: 'storyengine.freeform', config: { difficulty: 'even' } });
    expect(carry.treatment).toEqual({ id: 'treat-1', name: 'Rain City, noir' });
    expect(carry.persona).toEqual({ id: 'marlow', name: 'Marlow' });
    // A book the session links and the library cannot read keeps its id as its
    // name — [04 §3] resolves by both, and a dropped link would be silent.
    expect(carry.lore).toEqual([
      { ref: { id: 'book-1', name: 'Rain City' }, required: false },
      { ref: { id: 'book-gone', name: 'book-gone' }, required: false },
    ]);
  });

  it('calls the mode’s own pack the mode’s own, and names any other', () => {
    const own = carryAt(
      source({
        session: { ...source().session, preset: { id: 'pack-default', name: 'Freeform' } as never },
      }),
    );
    expect(own.preset).toBeNull();

    const pinned = carryAt(
      source({
        session: { ...source().session, preset: { id: 'pack-noir', name: 'Noir house' } as never },
      }),
    );
    expect(pinned.preset).toEqual({ id: 'pack-noir', name: 'Noir house' });
  });

  it('reads the party off the channel, never the persona and never a seat alone', () => {
    const carry = carryAt(
      source({
        channels: {
          [channelKey(SE_PARTY, 'vera')]: value('companion'),
          [channelKey(SE_PARTY, 'marlow')]: value('player'),
          // Left the party: written back to `null`, which is absent.
          [channelKey(SE_PARTY, 'lark')]: value(null),
          // A member who is not seated in the cast still is one.
          [channelKey(SE_PARTY, 'hollis')]: value('auto'),
        },
      }),
    );

    expect(carry.party).toEqual([
      { id: 'vera', name: 'Vera' },
      { id: 'hollis', name: 'hollis' },
    ]);
  });

  it('begins on the goal the story is on, and drops what was achieved', () => {
    const chain = [goal('g1', { next: 'g2' }), goal('g2', { next: 'g3' }), goal('g3')];
    const carry = carryAt(
      source({
        goals: chain,
        channels: {
          [channelKey(SE_GOAL, 'g1')]: value('achieved'),
          [SE_GOAL_CURRENT]: value('g2'),
        },
      }),
    );

    expect(carry.goalsCarried).toBe('carried');
    expect(carry.goals.map((one) => [one.id, one.next])).toEqual([
      ['g2', 'g3'],
      ['g3', null],
    ]);
  });

  it('carries no goal from a story that was ended or left open, and says which', () => {
    const chain = [goal('g1'), goal('g2')];
    expect(
      carryAt(source({ goals: chain, channels: { [SE_CONCLUDED]: value(true) } })),
    ).toMatchObject({ goals: [], goalsCarried: 'concluded' });
    expect(
      carryAt(source({ goals: chain, channels: { [SE_GOAL_CURRENT]: value(null) } })),
    ).toMatchObject({ goals: [], goalsCarried: 'open' });
    expect(carryAt(source())).toMatchObject({ goals: [], goalsCarried: 'none' });
  });

  it('clears a next pointer into a goal it dropped, so the chain does not break', () => {
    const carry = carryAt(
      source({
        goals: [goal('g1', { next: 'g0' }), goal('g0')],
        channels: {
          [channelKey(SE_GOAL, 'g0')]: value('achieved'),
          [SE_GOAL_CURRENT]: value('g1'),
        },
      }),
    );
    expect(carry.goals.map((one) => [one.id, one.next])).toEqual([['g1', null]]);
  });

  it('carries the hooks only it can carry, and spends every fired one', () => {
    const pool: PooledHook[] = [
      { hook: hook('t-fired'), source: { kind: 'treatment', id: 'treat-1' } },
      { hook: hook('t-fresh'), source: { kind: 'treatment', id: 'treat-1' } },
      { hook: hook('s-fresh'), source: { kind: 'setup', id: 'setup-1' } },
      { hook: hook('s-fired'), source: { kind: 'setup', id: 'setup-1' } },
      { hook: hook('own-fresh'), source: { kind: 'session' } },
      { hook: hook('own-provisional'), source: { kind: 'session' } },
      { hook: hook('l-fired'), source: { kind: 'lore', id: 'book-1' } },
    ];
    const carry = carryAt(
      source({
        pool,
        channels: {
          [channelKey(SE_HOOK, 't-fired')]: value('fired'),
          [channelKey(SE_HOOK, 's-fired')]: value('fired'),
          [channelKey(SE_HOOK, 'l-fired')]: value('fired'),
          [channelKey(SE_HOOK, 'own-provisional')]: value('provisional'),
        },
      }),
    );

    // The treatment's and the book's come back on their own, so only the
    // Setup's and the session's are copied — with their ids.
    expect(carry.hooks.map((one) => one.id)).toEqual(['s-fresh', 'own-fresh', 'own-provisional']);
    expect(carry.spentHooks).toEqual(['t-fired', 's-fired', 'l-fired']);
  });

  it('carries pacing only when somebody set it', () => {
    expect(carryAt(source()).hookPacing).toBeUndefined();
    expect(carryAt(source({ channels: { [SE_HOOK_PACING]: value('sparse') } })).hookPacing).toBe(
      'sparse',
    );
    expect(
      carryAt(
        source({ session: { ...source().session, setup: { hookPacing: 'aggressive' } as never } }),
      ).hookPacing,
    ).toBe('aggressive');
    // A value this build does not know is unset, not itself.
    expect(
      carryAt(source({ channels: { [SE_HOOK_PACING]: value('frantic') } })).hookPacing,
    ).toBeUndefined();
  });
});

describe('the Setup it builds', () => {
  const texts = {
    name: '  The Ledger, Lost  ',
    blurb: 'Pick it up at the docks.',
    storySoFar: '  Marlow lost the ledger.  ',
    opening: { label: '', text: 'Rain on the docks.' },
  };

  it('validates as a Setup, and names where it came from', () => {
    const setup = buildSetup(
      carryAt(
        source({
          channels: {
            [channelKey(SE_PARTY, 'vera')]: value('companion'),
            [channelKey(SE_HOOK, 's-fired')]: value('fired'),
          },
          pool: [{ hook: hook('s-fired'), source: { kind: 'setup', id: 'setup-1' } }],
          goals: [goal('g1')],
        }),
      ),
      ALL,
      texts,
      { companion: { id: 'book-facts', name: 'The Ledger, Lost — established facts' } },
    );

    expect(validate(setup)).toEqual({ valid: true });
    expect(setup.name).toBe('The Ledger, Lost');
    expect(setup.storySoFar).toBe('Marlow lost the ledger.');
    expect(setup.provenance.source).toBe('session');
    expect(setup.cast).toEqual({
      personaOptions: [{ id: 'marlow', name: 'Marlow' }],
      partyDefault: [{ id: 'vera', name: 'Vera' }],
      narrator: null,
    });
    expect(setup.spentHooks).toEqual(['s-fired']);
    expect(setup.goals.map((one) => one.id)).toEqual(['g1']);
    // The one opening, primary, and labelled even when nobody named it.
    expect(setup.openings.written).toHaveLength(1);
    expect(setup.openings.primaryWrittenId).toBe(setup.openings.written[0]?.id);
    expect(setup.openings.written[0]?.label).toBe('Where it left off');
    // The facts book, required: the story was written against it.
    expect(setup.lore.at(-1)).toEqual({
      ref: { id: 'book-facts', name: 'The Ledger, Lost — established facts' },
      required: true,
    });
  });

  it('leaves out what a person switched off', () => {
    const setup = buildSetup(
      carryAt(
        source({
          channels: {
            [channelKey(SE_PARTY, 'vera')]: value('companion'),
            [channelKey(SE_HOOK, 't-fired')]: value('fired'),
          },
          pool: [{ hook: hook('t-fired'), source: { kind: 'treatment', id: 'treat-1' } }],
          goals: [goal('g1')],
        }),
      ),
      { party: false, goals: false, hooks: false },
      { ...texts, storySoFar: '   ' },
    );

    expect(setup.cast.partyDefault).toEqual([]);
    expect(setup.goals).toEqual([]);
    expect(setup.hooks).toEqual([]);
    expect(Object.hasOwn(setup, 'spentHooks')).toBe(false);
    // An empty story so far is a fresh start, not an empty root.
    expect(Object.hasOwn(setup, 'storySoFar')).toBe(false);
  });
});

describe('the preview', () => {
  it('shows a player goal’s statement, and only that a hidden one exists', () => {
    const visible = previewOf(carryAt(source({ goals: [goal('g1')] })));
    expect(visible.goals.current).toEqual({ statement: 'statement of g1' });

    const hidden = previewOf(
      carryAt(source({ goals: [goal('g1', { visibility: 'hidden' }), goal('g2')] })),
    );
    expect(hidden.goals).toEqual({
      carried: 'carried',
      current: { hidden: true },
      count: 2,
      hidden: 1,
    });
  });

  /**
   * ***The property the phase exists to keep.*** Any pool, any states, any goal
   * chain: the preview, serialised as the route will send it, contains no
   * premise, no entrance's words and no hidden goal's statement. The markers are
   * words no name or count in the preview could produce by accident.
   */
  it('never carries hidden content, for any pool and any goal chain', () => {
    const hookState = fc.constantFrom('fired', 'provisional', 'committed', 'forced', null);
    const kind = fc.constantFrom('treatment', 'setup', 'lore', 'session');

    fc.assert(
      fc.property(
        fc.array(fc.tuple(kind, hookState), { maxLength: 8 }),
        fc.array(fc.boolean(), { maxLength: 5 }),
        fc.option(fc.nat({ max: 4 }), { nil: undefined }),
        (hooks, goalsHidden, current) => {
          const pool: PooledHook[] = hooks.map(([from], at) => ({
            hook: hook(`h${String(at)}`, {
              premise: `SECRETPREMISE${String(at)}`,
              entrances: [
                { id: `e${String(at)}`, label: 'x', text: `SECRETENTRANCE${String(at)}` },
              ],
            } as Partial<PlotHook>),
            source: from === 'session' ? { kind: 'session' } : { kind: from, id: 'x' },
          }));
          const channels: Record<string, { value: unknown }> = {};
          hooks.forEach(([, state], at) => {
            if (state !== null) channels[channelKey(SE_HOOK, `h${String(at)}`)] = value(state);
          });
          const goals = goalsHidden.map((hidden, at) =>
            goal(`g${String(at)}`, {
              visibility: hidden ? 'hidden' : 'player',
              statement: hidden ? `SECRETGOAL${String(at)}` : `open goal ${String(at)}`,
              detail: `SECRETDETAIL${String(at)}`,
            }),
          );
          if (current !== undefined && goals[current] !== undefined) {
            channels[SE_GOAL_CURRENT] = value(`g${String(current)}`);
          }

          const wire = JSON.stringify(previewOf(carryAt(source({ pool, channels, goals }))));
          expect(wire).not.toMatch(/SECRET/);
        },
      ),
    );
  });
});
