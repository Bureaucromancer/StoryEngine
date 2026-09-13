// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import type { HookRefusal, PlotHook } from '@storyengine/shared';

import { installBuiltIns } from '../mode-loader.js';
import { SE_PARTY, SE_PRESENCE, SE_STATUS } from './cast.js';
import { channelDefinition, channelKey, registerChannel } from './channels.js';
import {
  filterHooks,
  gate,
  readHookState,
  readPacing,
  SE_HOOK,
  SE_HOOK_PACING,
  type FilterContext,
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
    //
    // **This said `'committed'` until [P7.5] stage four**, when the state
    // arrived and the test went red — which is the same shape as `effects.ts`'s
    // unknown-channel fixture having to stop being `se.party` the moment that
    // channel was declared. A fixture that names a value the build is *about* to
    // have is a test with an expiry date on it; this one now names a value
    // nothing will ever declare.
    const channels = { [channelKey(SE_HOOK, 'hook-war')]: { value: 'smouldering' } };

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

/**
 * **Commit** — [06 §6.1]'s play affordance, [P7.5] stage four.
 *
 * *"I want this to happen — not necessarily on this turn"* is the sentence the
 * whole feature is for, and until this arrived the only way to act on it was to
 * add a hook and hope. What the filter owes it is one of §6.1's three rules:
 * **skipping the filter must say what it skipped**, because *"the failure this
 * section names twice is a hook firing about someone dead four sessions ago, and
 * a control that permits it silently reintroduces that failure by hand."*
 */
describe('a committed hook', () => {
  function committed(id = 'hook-war') {
    return { [channelKey(SE_HOOK, id)]: { value: 'committed' } };
  }

  it('is eligible even when the filter would have refused it', () => {
    const blocked = hook({ notBefore: { turn: 40 } });

    expect(refusalOf(pooled(blocked), context())).toBe('too-early');
    expect(refusalOf(pooled(blocked), context({ channels: committed() }))).toBeNull();
  });

  /**
   * The first rule, and the whole of Commit's honesty: the clause a person
   * overrode travels beside the hook, so *the confirmation names the clause that
   * failed and proceeds* has something to name.
   */
  it('says what the commitment carried it past', () => {
    const dead = hook({ involves: [{ id: 'actor-vera', name: 'Vera' }] });
    const verdict = filterHooks(pooled(dead), context({ channels: committed() }))[0];

    expect(verdict?.refusal).toBeNull();
    expect(verdict?.committed).toEqual({ overrode: 'cast-gone' });
  });

  it('says so too when there was nothing to carry it past', () => {
    // `null` rather than the field being absent: *committed and eligible anyway*
    // is a different claim from *not committed*, and a panel offering a
    // confirmation needs to tell them apart.
    const verdict = filterHooks(pooled(hook()), context({ channels: committed() }))[0];

    expect(verdict?.committed).toEqual({ overrode: null });
  });

  /**
   * **The one clause a commitment does not override**, and it is the one that
   * would make the record lie: a hook already `fired` has no `committed` value
   * to read, because the two are the same channel and the states are exclusive.
   * Committing a fired hook is therefore *un-firing* it, which is a person's
   * decision and reads exactly as one.
   */
  it('replaces the firing it is written over, rather than stacking on it', () => {
    const channels = { [channelKey(SE_HOOK, 'hook-war')]: { value: 'committed' } };

    expect(readHookState(channels, 'hook-war')).toBe('committed');
    expect(refusalOf(pooled(hook()), context({ channels }))).toBeNull();
  });
});

/**
 * [04 §6.1b]'s ordering, and the reason it is a reader rather than an `init`.
 *
 * *"A Treatment proposes, a Setup overrides, and the running session owns it."*
 * Three rungs is one more than `InitPolicy` can express — `init` is a single
 * value and this is an ordering over two — so the arm names the field and
 * {@link readPacing} finds it, with `initialValue` underneath for the session
 * that authored nothing.
 */
describe('the pacing dial', () => {
  beforeEach(async () => {
    // The fourth rung reads the declaration back, the way `clockStart` does, so
    // these need the channel registered rather than a literal to compare with.
    await installBuiltIns();
  });

  it('is declared as the one thing a model may not turn', () => {
    const declared = channelDefinition(SE_HOOK_PACING);

    // `user-only` is the whole point: a model proposing a pacing change is a
    // model turning its own volume up. `budget: null` is the second half — [06
    // §6.1] says the dial *"never enters a prompt"*, and a channel with no
    // budget line has nothing to enter one with.
    expect(declared?.update).toBe('user-only');
    expect(declared?.budget).toBeNull();
    expect(declared?.scope).toBe('session');
  });

  it('reads normal for a session that authored nothing', () => {
    expect(readPacing({})).toBe('normal');
  });

  /**
   * **Through the declaration rather than beside it.** Substituting the
   * channel's `init` moves the answer, which is what proves `?? 'normal'` is not
   * written twice — the same substitution `clockStart`'s test makes, restored in
   * a `finally` for the same reason: the registry is a module global.
   */
  it('takes its unauthored answer from whoever declared the channel', () => {
    const original = channelDefinition(SE_HOOK_PACING);
    if (original === null) throw new Error('the pacing channel is not registered');

    try {
      registerChannel({
        ...original,
        init: { kind: 'authored', field: 'hookPacing', fallback: 'sparse' },
      });
      expect(readPacing({})).toBe('sparse');
    } finally {
      registerChannel(original);
    }

    expect(readPacing({})).toBe('normal');
  });

  it('lets a treatment propose one', () => {
    expect(readPacing({}, { treatment: { hookPacing: 'sparse' } })).toBe('sparse');
  });

  it('lets the setup over it win', () => {
    expect(
      readPacing({}, { setup: { hookPacing: 'aggressive' }, treatment: { hookPacing: 'sparse' } }),
    ).toBe('aggressive');
  });

  /**
   * The rung that matters in play: turning the dial writes an effect, and from
   * that turn on the session's own answer outranks everything it was created
   * with. *Which is also what makes it branch* — rewind past the change and the
   * authored value is what the reader sees again, for free.
   */
  it('lets the running session own it outright', () => {
    const channels = { [SE_HOOK_PACING]: { value: 'manual-only' } };

    expect(
      readPacing(channels, {
        setup: { hookPacing: 'aggressive' },
        treatment: { hookPacing: 'sparse' },
      }),
    ).toBe('manual-only');
  });

  /**
   * *A level this build does not know reads as unset rather than as itself*, at
   * every rung — and the rungs are not equally protected. The channel's schema
   * refuses an unknown value on the way in, so only a hand-edited file gets one
   * there; a Treatment and a Setup are **portable** and [04 §2]'s additive door
   * is exactly how a `/1` acquires a level a later build understands. Falling
   * through to the next rung is the reading that keeps such a file playable.
   */
  it('falls through a level it does not know, at every rung', () => {
    expect(readPacing({ [SE_HOOK_PACING]: { value: 'glacial' } })).toBe('normal');
    expect(
      readPacing(
        { [SE_HOOK_PACING]: { value: 'glacial' } },
        { treatment: { hookPacing: 'sparse' } },
      ),
    ).toBe('sparse');
    expect(readPacing({}, { setup: { hookPacing: 7 }, treatment: { hookPacing: 'sparse' } })).toBe(
      'sparse',
    );
  });
});

/**
 * [06 §6.1]'s gate — *"the selector step runs every turn and the dial is a gate
 * inside it, before the judgement call"*.
 *
 * Not a `StepCondition`, and the section says why: a committed hook needs the
 * selector consulted every turn and a `sparse` dial needs it consulted rarely,
 * and one step cannot declare both — nor can a condition see channel state at
 * all. The four verdicts are what [P7 §1.5] means by *held by pacing* and
 * *judged: none* being **different answers**.
 */
describe('the pacing gate', () => {
  it('judges on the cadence and holds between', () => {
    expect(gate({ pacing: 'normal', depth: 3, firedAt: null, eligible: 2 })).toBe('judged');
    expect(gate({ pacing: 'normal', depth: 4, firedAt: null, eligible: 2 })).toBe('held');
    expect(gate({ pacing: 'normal', depth: 5, firedAt: null, eligible: 2 })).toBe('held');
    expect(gate({ pacing: 'normal', depth: 6, firedAt: null, eligible: 2 })).toBe('judged');
  });

  it('considers every turn at the top of the dial and rarely at the bottom', () => {
    for (const depth of [1, 2, 3, 4]) {
      expect(gate({ pacing: 'aggressive', depth, firedAt: null, eligible: 1 })).toBe('judged');
    }
    expect(gate({ pacing: 'sparse', depth: 3, firedAt: null, eligible: 1 })).toBe('held');
    expect(gate({ pacing: 'sparse', depth: 6, firedAt: null, eligible: 1 })).toBe('judged');
  });

  /**
   * **A cooldown longer than the cadence is the point of having both**: a dial
   * that considers rarely and, having fired, waits longer still. `normal`
   * considers every third turn and waits ten after a firing, so the two turns
   * this checks are both on the cadence and both refused.
   */
  it('cools after a firing for longer than the cadence', () => {
    expect(gate({ pacing: 'normal', depth: 12, firedAt: 9, eligible: 2 })).toBe('cooling');
    expect(gate({ pacing: 'normal', depth: 18, firedAt: 9, eligible: 2 })).toBe('cooling');
    expect(gate({ pacing: 'normal', depth: 21, firedAt: 9, eligible: 2 })).toBe('judged');
  });

  /**
   * **Counted on the path, like every other cadence here.** `firedAt` is where
   * on the path the firing sits rather than how long ago it was, so a rewind
   * past it restores the selector's freedom instead of leaving a cooldown that
   * outlived the turn which started it — the property [06 §6.1] states for
   * Commit's patience and which every count in this file shares.
   */
  it('restores the selector when the firing is rewound off the path', () => {
    expect(gate({ pacing: 'normal', depth: 12, firedAt: 9, eligible: 2 })).toBe('cooling');
    // The same node, reached down a branch where the firing never happened.
    expect(gate({ pacing: 'normal', depth: 12, firedAt: null, eligible: 2 })).toBe('judged');
  });

  /**
   * *"Nothing eligible"* is reported **before** the dial, because it is the more
   * specific answer and the one an author acts on: *held* invites somebody to
   * turn the dial up, and turning it up changes nothing when the pool is empty.
   */
  it('says nothing was eligible before it says anything about pacing', () => {
    expect(gate({ pacing: 'sparse', depth: 4, firedAt: 2, eligible: 0 })).toBe('nothing-eligible');
    expect(gate({ pacing: 'manual-only', depth: 4, firedAt: null, eligible: 0 })).toBe(
      'nothing-eligible',
    );
  });

  /**
   * **A commitment opens the gate every turn until it lands** — [06 §6.1], and
   * *"that is what makes **immediately** an honest word under `sparse`"*. Exempt
   * from cooldown and from cadence both, and `manual-only` is no exception: a
   * dial that could veto a person's own decision is not the dial that section
   * describes.
   */
  it('opens the gate for a commitment, at every setting and through a cooldown', () => {
    for (const pacing of ['sparse', 'normal', 'aggressive', 'manual-only'] as const) {
      expect(gate({ pacing, depth: 5, firedAt: 4, eligible: 1, committed: true })).toBe('judged');
    }
    // And the same node without the commitment is refused, which is what makes
    // the assertions above about the commitment rather than about the numbers.
    expect(gate({ pacing: 'normal', depth: 5, firedAt: 4, eligible: 1 })).toBe('cooling');
  });

  /**
   * *But not over an empty pool*, and it has to be that way round: a committed
   * hook is by construction an eligible one, so a commitment with nothing
   * eligible means the commitment is not in this pool at all.
   */
  it('still reports nothing eligible ahead of a commitment', () => {
    expect(
      gate({ pacing: 'aggressive', depth: 3, firedAt: null, eligible: 0, committed: true }),
    ).toBe('nothing-eligible');
  });

  /**
   * **`manual-only` is a coherent state rather than a dead step.** [06 §6.1]:
   * the filter still runs and still reports, and only the judgement is off — so
   * an author with thirty hooks can still see which are eligible, and this
   * answers `held` rather than `nothing-eligible` when they are.
   */
  it('never judges on manual-only, and still says why', () => {
    for (const depth of [1, 2, 3, 6, 12, 60]) {
      expect(gate({ pacing: 'manual-only', depth, firedAt: null, eligible: 3 })).toBe('held');
    }
  });
});
