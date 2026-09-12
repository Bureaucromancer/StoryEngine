// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { PlotHook } from '@storyengine/shared';

import { SE_PARTY, SE_PRESENCE, SE_STATUS } from './cast.js';
import { channelKey } from './channels.js';
import {
  filterHooks,
  readHookState,
  SE_HOOK,
  type FilterContext,
  type HookRefusal,
} from './hooks.js';
import type { PooledHook, Turn } from './types.js';

/**
 * [06 §6.1]'s **stage one** — mechanical eligibility, no model call, built at
 * [P7.5].
 *
 * *"Cheap filter before expensive judgement is the pattern; inverting it is both
 * costlier and worse, because a model asked to consider ineligible hooks will
 * argue for them."* And the filter is what stops the failure [03 §4.1] names as
 * the severe one: a hook firing about someone who died four sessions ago
 * *"destroys confidence in the mechanism in one message"*.
 *
 * **Every case here is a distinct refusal class**, which is the test for whether
 * an arm earns its place: [06 §6.1] wants an author to see *which are blocked
 * and by what*, and two classes that lead to the same remedy would be one class.
 */

function hook(over: Partial<PlotHook> = {}): PlotHook {
  return {
    id: 'hook-war',
    title: 'War',
    premise: 'The Flower Kingdom will declare war.',
    magnitude: 'sweeping',
    involves: [],
    weight: 1,
    delivery: 'guidance',
    once: true,
    ...over,
  };
}

function pooled(one: PlotHook, source: PooledHook['source'] = { kind: 'treatment', id: 't1' }) {
  return [{ hook: one, source }];
}

/** A turn whose only effect introduces somebody, which is what `introducedOn` reads. */
function metThem(...actorIds: string[]): Turn {
  return {
    id: 't',
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-09-12T00:00:00.000Z',
    status: 'complete',
    tape: [],
    effects: actorIds.map((scopeKey, index) => ({
      id: `e${String(index)}`,
      turnId: 't',
      channelId: SE_PRESENCE,
      scopeKey,
      op: { type: 'set' as const, path: '/' },
      before: null,
      after: true,
      proposedBy: { kind: 'model' as const, callId: 'c1' },
      applied: true,
      rejectedReason: null,
      supersedes: null,
      channelVersion: 1,
      scope: 'session' as const,
    })),
  };
}

function context(over: Partial<FilterContext> = {}): FilterContext {
  return {
    channels: {},
    path: [],
    activeBooks: new Set(),
    known: new Set(),
    persona: null,
    ...over,
  };
}

/**
 * The one refusal, or `null`. Every case here is about a single hook.
 *
 * *Throws rather than coalescing an empty result*, because `null` is the
 * **eligible** answer: a helper that folded a missing verdict into it would
 * report a pool the filter never saw as a hook that passed.
 */
function refusalOf(pool: PooledHook[], ctx: FilterContext): HookRefusal | null {
  const verdict = filterHooks(pool, ctx)[0];
  if (verdict === undefined) throw new Error('the filter returned no verdict');
  return verdict.refusal;
}

describe('what the pool has already done', () => {
  it('is in the pool when nothing has been said about it', () => {
    expect(readHookState({}, 'hook-war')).toBeNull();
    expect(refusalOf(pooled(hook()), context())).toBeNull();
  });

  it('is out once it has fired', () => {
    const channels = { [channelKey(SE_HOOK, 'hook-war')]: { value: 'fired' } };

    expect(refusalOf(pooled(hook()), context({ channels }))).toBe('fired');
  });

  /**
   * **`provisional` is [06 §6.1]'s honest reading of the slot an introduction
   * fires through.** Guidance is advisory and the narrator may decline it; for an
   * introduction a decline is *"a silent permanent loss — marked fired, character
   * never arrived, and once-only"*. So it is out of the pool while it waits, and
   * comes back if the extract stage does not confirm.
   */
  it('is out while a provisional firing waits to be confirmed', () => {
    const channels = { [channelKey(SE_HOOK, 'hook-war')]: { value: 'provisional' } };

    expect(refusalOf(pooled(hook()), context({ channels }))).toBe('pending');
  });

  it('reads a state this build does not know as no state at all', () => {
    // The channel's schema refuses one on the way in; a hand-edited file is the
    // path that gets past it, and *in the pool* is the answer that keeps a
    // session playable.
    const channels = { [channelKey(SE_HOOK, 'hook-war')]: { value: 'committed' } };

    expect(readHookState(channels, 'hook-war')).toBeNull();
  });
});

describe('the lorebook that carried it', () => {
  /**
   * [03 §4.1]: a hook carried by a lorebook *"is only eligible while that
   * lorebook is active in the session. That is a sensible default and a
   * mechanical justification for the association, rather than 'it seemed
   * handy'."*
   */
  it('is out when its book is no longer in play', () => {
    const pool = pooled(hook(), { kind: 'lore', id: 'b1' });

    expect(refusalOf(pool, context())).toBe('book-inactive');
    expect(refusalOf(pool, context({ activeBooks: new Set(['b1']) }))).toBeNull();
  });

  it('does not apply to a hook the treatment carried', () => {
    // A treatment's hooks were copied at creation and the treatment is not a
    // thing that can be switched off mid-session.
    expect(refusalOf(pooled(hook()), context())).toBeNull();
  });
});

describe('blockedBy and notBefore', () => {
  it('is out when a hook that makes it nonsensical has fired', () => {
    const channels = { [channelKey(SE_HOOK, 'hook-peace')]: { value: 'fired' } };
    const pool = [
      { hook: hook({ id: 'hook-peace' }), source: { kind: 'treatment' as const, id: 't1' } },
      {
        hook: hook({ id: 'hook-war', blockedBy: ['hook-peace'] }),
        source: { kind: 'treatment' as const, id: 't1' },
      },
    ];

    expect(filterHooks(pool, context({ channels })).map((one) => one.refusal)).toEqual([
      'fired',
      'blocked',
    ]);
  });

  it('is not blocked by a hook that has not fired', () => {
    const pool = pooled(hook({ blockedBy: ['hook-peace'] }));

    expect(refusalOf(pool, context())).toBeNull();
  });

  it('waits for a turn number, counted on the path', () => {
    const pool = pooled(hook({ notBefore: { turn: 3 } }));

    expect(refusalOf(pool, context({ path: [metThem(), metThem()] }))).toBe('too-early');
    expect(refusalOf(pool, context({ path: [metThem(), metThem(), metThem()] }))).toBeNull();
  });

  it('waits for another hook to have fired', () => {
    const pool = pooled(hook({ notBefore: { afterHook: 'hook-peace' } }));
    const fired = [
      { hook: hook({ id: 'hook-peace' }), source: { kind: 'treatment' as const, id: 't1' } },
      ...pool,
    ];

    expect(refusalOf(pool, context())).toBe('too-early');
    expect(
      filterHooks(
        fired,
        context({ channels: { [channelKey(SE_HOOK, 'hook-peace')]: { value: 'fired' } } }),
      )[1]?.refusal,
    ).toBeNull();
  });
});

describe('involves', () => {
  const met = { path: [metThem('actor-vera')], known: new Set(['actor-vera']) };

  it('needs everyone it names to resolve, be met, and be alive', () => {
    const pool = pooled(hook({ involves: [{ id: 'actor-vera', name: 'Vera' }] }));

    expect(refusalOf(pool, context(met))).toBeNull();
  });

  it('is out when somebody it names does not resolve', () => {
    const pool = pooled(hook({ involves: [{ id: 'actor-vera', name: 'Vera' }] }));

    expect(refusalOf(pool, context({ path: [metThem('actor-vera')] }))).toBe('cast-gone');
  });

  it('is out when somebody it names has never been met', () => {
    const pool = pooled(hook({ involves: [{ id: 'actor-vera', name: 'Vera' }] }));

    expect(refusalOf(pool, context({ known: new Set(['actor-vera']) }))).toBe('cast-gone');
  });

  /**
   * **The severe failure**, and the one [03 §4.1] says destroys confidence in
   * one message: a hook firing about someone who died four sessions ago.
   */
  it('is out when somebody it names has been written out of the story', () => {
    const pool = pooled(hook({ involves: [{ id: 'actor-vera', name: 'Vera' }] }));
    const dead = { [channelKey(SE_STATUS, 'actor-vera')]: { value: 'dead' } };

    expect(refusalOf(pool, context({ ...met, channels: dead }))).toBe('cast-gone');
  });
});

/**
 * **The reversal, written out rather than described as one** — [04 §6.1a]:
 *
 * > Eligible when the subject **resolves**, is **not yet introduced**, carries no
 * > terminal status, is **not the persona**, and is **not already in the party**.
 *
 * Describing it as *the inverse of `involves`* gets it wrong, which is why that
 * section spells it: a subject who is dead is no more introducible than an
 * `involves` member who is.
 */
describe('an introduction hook', () => {
  function introducing(): PooledHook[] {
    return pooled(
      hook({
        introduces: {
          actor: { id: 'actor-vera', name: 'Vera' },
          entrances: [],
          primaryEntranceId: null,
        },
      }),
    );
  }

  it('is eligible while its subject has not been met', () => {
    expect(refusalOf(introducing(), context({ known: new Set(['actor-vera']) }))).toBeNull();
  });

  it('is spent once its subject has been met', () => {
    const ctx = context({ known: new Set(['actor-vera']), path: [metThem('actor-vera')] });

    expect(refusalOf(introducing(), ctx)).toBe('subject-met');
  });

  /**
   * **The one arm that is an authoring error rather than a state.** [04 §6.1a]:
   * a dangling `involves` entry retires a hook quietly, which is mercy for a
   * cast that is gone — but a dangling subject *"can never succeed at all"*, so
   * it is ineligible **with a visible reason** and the author is told.
   */
  it('reports a subject that does not resolve as broken, not retired', () => {
    expect(refusalOf(introducing(), context())).toBe('subject-gone');
  });

  it('will not introduce somebody the story has already written out', () => {
    const ctx = context({
      known: new Set(['actor-vera']),
      channels: { [channelKey(SE_STATUS, 'actor-vera')]: { value: 'dead' } },
    });

    // *"Exempting the subject from the whole check would fire 'Vera walks into
    // the bar' for a Vera the session recorded dead four sessions ago."*
    expect(refusalOf(introducing(), ctx)).toBe('subject-unavailable');
  });

  it('will not introduce the player to themselves', () => {
    const ctx = context({ known: new Set(['actor-vera']), persona: 'actor-vera' });

    expect(refusalOf(introducing(), ctx)).toBe('subject-unavailable');
  });

  /**
   * *Not hypothetical*, which 04 §6.1a says in as many words: a Setup's
   * `cast.partyDefault` can name the same actor a lorebook-borne hook wants to
   * introduce.
   */
  it('will not introduce somebody already travelling with you', () => {
    const ctx = context({
      known: new Set(['actor-vera']),
      channels: { [channelKey(SE_PARTY, 'actor-vera')]: { value: 'companion' } },
    });

    expect(refusalOf(introducing(), ctx)).toBe('subject-unavailable');
  });

  it('still keeps the clauses it does not reverse', () => {
    // `involves` stays available for the other characters an entrance depends
    // on — *only if her brother is still alive* — and is checked as usual.
    const pool = pooled(
      hook({
        involves: [{ id: 'actor-lund', name: 'Lund' }],
        introduces: {
          actor: { id: 'actor-vera', name: 'Vera' },
          entrances: [],
          primaryEntranceId: null,
        },
      }),
    );

    expect(refusalOf(pool, context({ known: new Set(['actor-vera', 'actor-lund']) }))).toBe(
      'cast-gone',
    );
  });
});

describe('what comes back', () => {
  /**
   * *"Nothing about a held hook may be invisible."* The judgement pass takes the
   * eligible ones; the panel takes all of them, because an author with thirty
   * hooks cannot test them by playing to turn 200.
   */
  it('returns every hook, refused or not', () => {
    const channels = { [channelKey(SE_HOOK, 'hook-peace')]: { value: 'fired' } };
    const pool = [
      { hook: hook({ id: 'hook-peace' }), source: { kind: 'treatment' as const, id: 't1' } },
      { hook: hook({ id: 'hook-war' }), source: { kind: 'treatment' as const, id: 't1' } },
    ];

    expect(filterHooks(pool, context({ channels }))).toEqual([
      { hook: expect.objectContaining({ id: 'hook-peace' }), refusal: 'fired' },
      { hook: expect.objectContaining({ id: 'hook-war' }), refusal: null },
    ]);
  });
});
