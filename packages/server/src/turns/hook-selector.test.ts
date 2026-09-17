// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import type { StepCallRequest, StepCallResult, StepHost, StepInput } from '@storyengine/sdk';
import type { HookPacing, HookSelection, PlotHook } from '@storyengine/shared';

import { installBuiltIns } from '../mode-loader.js';
import { channelKey } from '../sessions/channels.js';
import { SE_HOOK, SE_HOOK_PACING } from '../sessions/hooks.js';
import type { PooledHook, Turn } from '../sessions/types.js';
import { randomOver } from '../rng/random.js';
import { Rng } from '../rng/rng.js';
import { hookSelector, lastFiredAt, type HookSelectorReport } from './hook-selector.js';

/**
 * [06 §6.1]'s **stage two** — the judgement pass, built at [P7.5].
 *
 * *"One cheap call over the survivors: is now a good moment, and which of these
 * fits what just happened? Weighted, and permitted to answer 'none'."*
 *
 * **What most of these assert is the record**, because that is what the feature
 * is for as much as the firing is: *"nothing about a held hook may be
 * invisible"*, and *held by pacing* and *judged: none* being different answers
 * is [P7 §1.5]'s whole reason for adding a turn field.
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

function pooled(...hooks: PlotHook[]): PooledHook[] {
  return hooks.map((one) => ({ hook: one, source: { kind: 'treatment' as const, id: 't1' } }));
}

function turn(over: Partial<Turn> = {}): Turn {
  return {
    id: 't',
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-09-13T00:00:00.000Z',
    status: 'complete',
    tape: [],
    effects: [],
    ...over,
  };
}

/** A turn whose one effect records a firing, which is what `lastFiredAt` reads. */
function fired(hookId: string, state: 'fired' | 'provisional' = 'fired', applied = true): Turn {
  return turn({
    effects: [
      {
        id: 'e1',
        turnId: 't',
        channelId: SE_HOOK,
        scopeKey: hookId,
        op: { type: 'set', path: '/' },
        before: null,
        after: state,
        proposedBy: { kind: 'step', stepId: 'se.hooks.select' },
        applied,
        rejectedReason: applied ? null : 'engine-computed',
        supersedes: null,
        channelVersion: 1,
        scope: 'session',
      },
    ],
  });
}

/**
 * A host whose `call` answers with whatever the test says, and a real tape
 * underneath.
 *
 * *The `Rng` is the production one rather than a stub*, because the entrance
 * draw is [25 C13]'s first caller and a stubbed `weightedPick` would prove
 * nothing about the property that made it the right method.
 */
function host(answer: Partial<StepCallResult> = {}): StepHost & { asked: StepCallRequest[] } {
  const asked: StepCallRequest[] = [];
  return {
    asked,
    call: (request) => {
      asked.push(request);
      return Promise.resolve({ callId: 'c1', text: '', usage: null, ...answer });
    },
    random: randomOver(new Rng()),
    signal: new AbortController().signal,
  };
}

function input(over: Partial<StepInput> = {}): StepInput {
  return {
    turnId: 't-new',
    sessionId: 's',
    parentTurnId: null,
    channels: {},
    history: [],
    ...over,
  };
}

/** Runs the selector and hands back what it reported plus what it proposed. */
async function select(options: {
  pool: PooledHook[];
  channels?: Record<string, { value: unknown }>;
  history?: Turn[];
  known?: string[];
  answer?: Partial<StepCallResult>;
  pacing?: HookPacing;
  pacingProse?: string | null;
}) {
  // A holder rather than a bare `let`, for the reason the runner's `inFlight` is
  // one: it is assigned from inside a closure the type checker cannot follow,
  // and a bare binding stays narrowed to its initialiser.
  const held: { report: HookSelectorReport | null } = { report: null };
  const { definition, run } = hookSelector({
    pool: options.pool,
    filter: {
      known: new Set(options.known ?? []),
      activeBooks: new Set(),
      persona: null,
    },
    pacing: options.pacing ?? 'aggressive',
    pacingProse: options.pacingProse ?? null,
    report: (given) => {
      held.report = given;
    },
  });
  const capabilities = host(options.answer);
  const result = await run(
    input({
      ...(options.channels === undefined
        ? {}
        : { channels: options.channels as StepInput['channels'] }),
      ...(options.history === undefined ? {} : { history: options.history }),
    }),
    capabilities,
  );
  const { report } = held;
  if (report === null) throw new Error('the selector reported nothing');
  return { definition, result, host: capabilities, report };
}

/** Just the record line, which is what most of this file is about. */
async function line(options: Parameters<typeof select>[0]): Promise<HookSelection> {
  return (await select(options)).report.selection;
}

beforeEach(async () => {
  await installBuiltIns();
});

describe('the gate decides whether anything is asked', () => {
  /**
   * **No call at all when the gate holds**, which is the point of putting the
   * dial inside the step: *"that costs nothing, because stage 1 is deliberately
   * model-free"*. A selector that asked and then discarded the answer would make
   * `sparse` the most expensive setting.
   */
  it('asks nobody when there is nothing eligible', async () => {
    const channels = { [channelKey(SE_HOOK, 'hook-war')]: { value: 'fired' } };
    const run = await select({ pool: pooled(hook()), channels });

    expect(run.host.asked).toHaveLength(0);
    expect(run.report.selection.verdict).toBe('nothing-eligible');
    expect(run.report.fired).toBeUndefined();
    expect(run.report.guidance).toBeUndefined();
  });

  it('reports the dial it was read at, not the dial today', async () => {
    // Recorded on the turn because the value branches: a reader asking a hundred
    // turns on why this one was quiet would otherwise get today's answer for a
    // decision taken under a different one.
    expect((await line({ pool: pooled(hook()) })).pacing).toBe('aggressive');
  });

  /**
   * *"Nothing about a held hook may be invisible."* Every hook comes back with
   * its class, refused or not — the standard the assembler already meets when it
   * records why a slot was not filled.
   */
  it('accounts for every hook in the pool, fired or waiting', async () => {
    const channels = { [channelKey(SE_HOOK, 'hook-peace')]: { value: 'fired' } };
    const selection = await line({
      pool: pooled(hook({ id: 'hook-peace' }), hook({ id: 'hook-war' })),
      channels,
    });

    expect(selection.considered).toEqual([
      { hookId: 'hook-peace', refusal: 'fired' },
      { hookId: 'hook-war', refusal: null },
    ]);
  });
});

describe('the judgement pass', () => {
  it('fires the hook the model named, and sends its words to the slot', async () => {
    const run = await select({
      pool: pooled(hook()),
      answer: { object: { hookId: 'hook-war' } },
    });

    expect(run.report.selection).toMatchObject({ verdict: 'fired', hookId: 'hook-war' });
    expect(run.report.guidance).toContain('The Flower Kingdom will declare war.');
    /**
     * **Reported, not proposed** — `se.hook` is `engine-computed`, which refuses
     * a `step` proposal for the reason it is declared that way: *a firing is the
     * selector's decision and a model proposing one would be a hook firing
     * itself*. The runner applies it, the way it applies the clock. Measured:
     * the step proposed it first and `acceptEffect` recorded the refusal.
     */
    expect(run.report.fired).toEqual({ hookId: 'hook-war', state: 'fired' });
    expect(run.result.effects ?? []).toHaveLength(0);
  });

  /**
   * **Permitted to answer none, and that has to be distinguishable from held.**
   * [06 §6.1] says so in as many words, and [10 §10.1]'s reason is the one that
   * bites: *"a record that merges them makes a correctly-quiet session
   * indistinguishable from a broken one"*.
   */
  it('records a judged none as its own answer', async () => {
    const run = await select({ pool: pooled(hook()), answer: { object: { hookId: null } } });

    expect(run.host.asked).toHaveLength(1);
    expect(run.report.selection.verdict).toBe('judged-none');
    expect(run.report.fired).toBeUndefined();
  });

  /**
   * *"A model asked to consider ineligible hooks will argue for them"* — and
   * this is the same refusal one step later. The schema's `enum` closes the
   * answer for an endpoint that honours it; [P7.4] measured that `jsonSchema()`
   * does not validate, so the reader checks membership too.
   */
  it('refuses a hook the filter never offered', async () => {
    const channels = { [channelKey(SE_HOOK, 'hook-peace')]: { value: 'fired' } };
    const run = await select({
      pool: pooled(hook({ id: 'hook-peace' }), hook({ id: 'hook-war' })),
      channels,
      answer: { object: { hookId: 'hook-peace' } },
    });

    expect(run.report.selection.verdict).toBe('judged-none');
    expect(run.report.fired).toBeUndefined();
  });

  /**
   * The degraded path is the **ordinary** one for a self-hosted install
   * ([P7.4]): `openai-compatible` declares `supportsStructuredOutput: false` by
   * default, so the answer arrives as text the endpoint was asked to shape.
   */
  it('reads the answer out of text when no object came back', async () => {
    const run = await select({
      pool: pooled(hook()),
      answer: { text: '{"hookId":"hook-war","why":"the border just closed"}' },
    });

    expect(run.report.selection).toMatchObject({ verdict: 'fired', hookId: 'hook-war' });
  });

  it('treats prose it cannot read as none, which is the safe direction', async () => {
    // Bias toward under-firing, exactly as §6.1 chose for goal completion and
    // §8.1 for death. A model that answered in sentences has not chosen a hook.
    const run = await select({
      pool: pooled(hook()),
      answer: { text: 'I think the war one would be good here!' },
    });

    expect(run.report.selection.verdict).toBe('judged-none');
  });

  it('asks over the premises and nothing else', async () => {
    const run = await select({
      pool: pooled(hook()),
      history: [turn({ output: { text: 'The gate closed behind them.' } })],
      answer: { object: { hookId: null } },
    });

    // Its own candidates rather than the turn's: `StepCallRequest.candidates`
    // omitted means everything accumulated so far, and the accumulated prompt is
    // the whole scene. *Cheap* is the word §6.1 uses.
    const asked = run.host.asked[0];
    expect(asked?.candidates?.map((candidate) => candidate.text).join('\n')).toContain(
      'The Flower Kingdom will declare war.',
    );
    expect(asked?.candidates?.map((candidate) => candidate.text).join('\n')).toContain(
      'The gate closed behind them.',
    );
    expect(asked?.schema).toMatchObject({
      properties: { hookId: { enum: ['hook-war', null] } },
    });
  });
});

describe('an introduction', () => {
  const arrival = hook({
    id: 'hook-vera',
    premise: '',
    introduces: {
      actor: { id: 'actor-vera', name: 'Vera' },
      entrances: [{ id: 'e-rain', label: 'In the rain', text: 'She is soaked to the skin.' }],
      primaryEntranceId: null,
    },
  });

  /**
   * **Provisional, and that is an honest reading of the slot rather than a
   * special case** ([06 §6.1]). Guidance is advisory and the narrator may
   * decline it; for an event hook a decline is a miss, and for an introduction
   * it is *"a silent permanent loss — marked fired, character never arrived, and
   * once-only"*.
   */
  it('is recorded provisionally, never as fired', async () => {
    const run = await select({
      pool: pooled(arrival),
      known: ['actor-vera'],
      answer: { object: { hookId: 'hook-vera' } },
    });

    expect(run.report.fired).toEqual({ hookId: 'hook-vera', state: 'provisional' });
    expect(run.report.selection.verdict).toBe('fired');
  });

  /**
   * *Entrances are shown by label, never by text* ([08 §6], [10 §10.1]) — an
   * unfired entrance is hidden content. So the judgement call reads the labels,
   * and only the hook that actually fires sends the text anywhere.
   */
  it('offers the selector labels and the narrator the text', async () => {
    const run = await select({
      pool: pooled(arrival),
      known: ['actor-vera'],
      answer: { object: { hookId: 'hook-vera' } },
    });

    const asked = run.host.asked[0]?.candidates?.map((c) => c.text).join('\n') ?? '';
    expect(asked).toContain('In the rain');
    expect(asked).not.toContain('She is soaked to the skin.');
    expect(run.report.guidance).toContain('She is soaked to the skin.');
  });
});

describe('what the slot is told to do with the words', () => {
  /**
   * *"`delivery: 'seed'` is the same block with an instruction to expand rather
   * than weave"* — which is why neither needs a mechanism of its own.
   */
  it('weaves guidance and expands a seed', async () => {
    const weave = await select({
      pool: pooled(hook({ delivery: 'guidance' })),
      answer: { object: { hookId: 'hook-war' } },
    });
    const expand = await select({
      pool: pooled(hook({ delivery: 'seed' })),
      answer: { object: { hookId: 'hook-war' } },
    });

    expect(weave.report.guidance).toMatch(/^Weave/);
    expect(expand.report.guidance).toMatch(/^Expand/);
  });
});

describe('the cooldown is counted on the path', () => {
  it('finds the most recent firing, and counts a provisional as one', () => {
    expect(lastFiredAt([])).toBeNull();
    expect(lastFiredAt([turn(), turn()])).toBeNull();
    expect(lastFiredAt([turn(), fired('hook-war'), turn()])).toBe(1);
    expect(lastFiredAt([fired('hook-war'), turn(), fired('hook-peace')])).toBe(2);
    // An attempt the narrator was asked to make. Starting the next cooldown from
    // the attempt rather than from its confirmation is what stops a declined
    // introduction being retried on the very next turn.
    expect(lastFiredAt([turn(), fired('hook-vera', 'provisional')])).toBe(1);
  });

  /**
   * **A refused effect is not a firing**, which matters because [21 §1.2] keeps
   * refusals in the record: a proposal the engine said no to would otherwise
   * start a cooldown for a hook that never fired.
   */
  it('ignores an effect the engine refused', () => {
    expect(lastFiredAt([fired('hook-war', 'fired', false)])).toBeNull();
  });
});

describe('the step it declares itself as', () => {
  it('reads the dial and every hook, and writes only the hook state', async () => {
    const { definition } = await select({ pool: pooled(hook()) });

    expect(definition.reads).toContain(SE_HOOK_PACING);
    expect(definition.reads).toContain(SE_HOOK);
    expect(definition.writes).toEqual([SE_HOOK]);
    // Guidance is the one thing a step may not hand back ([06 §5.2]), so there
    // is nothing here for it to contribute — the runner fills the slot.
    expect(definition.contributes).toBeUndefined();
  });

  it('warns rather than aborting, because a broken pool is not a lost turn', async () => {
    const { definition } = await select({ pool: pooled(hook()) });

    expect(definition.failure).toBe('warn');
    /**
     * **`prose`, and asking for `fast` was measured wrong** — `resolveRole` has
     * no cross-role fallback and nothing in this build binds any role but
     * `prose`, so a `fast` selector failed on every turn of every session with a
     * pool. The cheapness [06 §6.1] asks for is a property of the call, which
     * stage one delivers; an install that wants a smaller model says so through
     * `stepRoles`.
     */
    expect(definition.role).toBe('prose');
  });
});

/**
 * **Commit** — [06 §6.1]'s play affordance, [P7.5] stage four.
 *
 * *"Committing a hook marks it must-fire immediately: it skips eligibility, it
 * is exempt from cooldown and cadence, and it opens the pacing gate every turn
 * until it lands."* **What it does not do is choose the moment** — stage two
 * still runs, *"with the question changed from whether to where, and that is the
 * difference between committing a hook and forcing one."*
 */
describe('a commitment', () => {
  const COMMITTED = { [channelKey(SE_HOOK, 'hook-war')]: { value: 'committed' } };

  /** A turn whose one effect is the commitment, which is what starts its clock. */
  function commit(hookId = 'hook-war'): Turn {
    return turn({
      effects: [
        {
          id: 'e1',
          turnId: 't',
          channelId: SE_HOOK,
          scopeKey: hookId,
          op: { type: 'set', path: '/' },
          before: null,
          after: 'committed',
          proposedBy: { kind: 'user' },
          applied: true,
          rejectedReason: null,
          supersedes: null,
          channelVersion: 1,
          scope: 'session',
        },
      ],
    });
  }

  it('is judged even at a setting that would otherwise hold', async () => {
    const run = await select({
      pool: pooled(hook()),
      channels: COMMITTED,
      history: [commit()],
      pacing: 'manual-only',
      answer: { object: { hookId: 'hook-war' } },
    });

    expect(run.report.selection).toMatchObject({ verdict: 'fired', pacing: 'manual-only' });
  });

  /**
   * *The question changes, and the record shows it.* A person has already decided
   * **whether**; the call is only being asked **where**, so the prompt drops
   * *prefer null* — which is the line that would otherwise make a committed hook
   * wait out its patience against a selector told to be reluctant.
   */
  it('asks where rather than whether', async () => {
    const plain = await select({ pool: pooled(hook()), answer: { object: { hookId: null } } });
    const run = await select({
      pool: pooled(hook()),
      channels: COMMITTED,
      history: [commit()],
      answer: { object: { hookId: null } },
    });

    const asked = (host: typeof run.host) =>
      host.asked[0]?.candidates?.map((candidate) => candidate.text).join('\n') ?? '';
    expect(asked(plain.host)).toContain('Prefer null');
    expect(asked(run.host)).not.toContain('Prefer null');
    expect(asked(run.host)).toContain('not choosing whether');
  });

  /**
   * **It still may answer no**, which is what separates Commit from force-fire.
   * The commitment persists — nothing is written, nothing lapses — and the
   * selector is asked again next turn.
   */
  it('waits when the call says not yet, and stays committed', async () => {
    const run = await select({
      pool: pooled(hook()),
      channels: COMMITTED,
      history: [commit()],
      answer: { object: { hookId: null } },
    });

    expect(run.report.selection.verdict).toBe('judged-none');
    expect(run.report.fired).toBeUndefined();
    expect(run.report.lapses).toBeUndefined();
  });

  it('narrows the question to the committed hooks', async () => {
    const run = await select({
      pool: pooled(hook({ id: 'hook-war' }), hook({ id: 'hook-peace' })),
      channels: COMMITTED,
      history: [commit()],
      answer: { object: { hookId: null } },
    });

    const asked = run.host.asked[0];
    // Both are eligible; only the committed one is offered, because *whether*
    // has been answered and only *where* is left.
    expect(asked?.schema).toMatchObject({ properties: { hookId: { enum: ['hook-war', null] } } });
  });

  it('carries the clause it overrode into the turn record', async () => {
    const run = await select({
      pool: pooled(hook({ notBefore: { turn: 40 } })),
      channels: COMMITTED,
      history: [commit()],
      answer: { object: { hookId: 'hook-war' } },
    });

    expect(run.report.selection.considered).toEqual([
      { hookId: 'hook-war', refusal: null, committed: { overrode: 'too-early' } },
    ]);
  });
});

/**
 * **Patience is bounded, and the deadline is a lapse rather than a firing** —
 * [06 §6.1]. *"One that fires anyway at the deadline delivers the twist at the
 * exact moment the selector has already rejected three times — the worst
 * available moment."* So it returns to the pool and **says so**, because a
 * silent lapse is worse than either outcome.
 */
describe('a commitment that runs out of patience', () => {
  const COMMITTED = { [channelKey(SE_HOOK, 'hook-war')]: { value: 'committed' } };

  function commitAt(depth: number, length: number): Turn[] {
    return Array.from({ length }, (_unused, at) =>
      at === depth
        ? turn({
            effects: [
              {
                id: 'e1',
                turnId: 't',
                channelId: SE_HOOK,
                scopeKey: 'hook-war',
                op: { type: 'set', path: '/' },
                before: null,
                after: 'committed',
                proposedBy: { kind: 'user' },
                applied: true,
                rejectedReason: null,
                supersedes: null,
                channelVersion: 1,
                scope: 'session',
              },
            ],
          })
        : turn(),
    );
  }

  it('holds for three turns and lapses on the fourth', async () => {
    // Committed at 0, judged on the turns after it: two spent, then three.
    const waiting = await select({
      pool: pooled(hook()),
      channels: COMMITTED,
      history: commitAt(0, 3),
      answer: { object: { hookId: null } },
    });
    expect(waiting.report.lapses).toBeUndefined();
    expect(waiting.report.selection.lapsed).toBeUndefined();

    const spent = await select({
      pool: pooled(hook()),
      channels: COMMITTED,
      history: commitAt(0, 4),
      answer: { object: { hookId: null } },
    });
    expect(spent.report.lapses).toEqual(['hook-war']);
    expect(spent.report.selection.lapsed).toEqual(['hook-war']);
  });

  /**
   * ***Counted on the path, which is the clause that decides the
   * implementation.*** *"Commit at ten, fire at twelve, rewind to eleven, and the
   * commitment correctly survives with one turn already spent."* The same node
   * reached down a shorter path has spent less of its patience — which only
   * holds because the count is derived rather than stored.
   */
  it('spends less patience on a path where fewer turns happened', async () => {
    const long = await select({
      pool: pooled(hook()),
      channels: COMMITTED,
      history: commitAt(0, 4),
      answer: { object: { hookId: null } },
    });
    const short = await select({
      pool: pooled(hook()),
      channels: COMMITTED,
      history: commitAt(0, 2),
      answer: { object: { hookId: null } },
    });

    expect(long.report.lapses).toEqual(['hook-war']);
    expect(short.report.lapses).toBeUndefined();
  });

  /**
   * **A commitment made on another branch has not started its clock**, which is
   * the reading a rewind forces: the channel value reconstructs at this node, so
   * the hook *is* committed here, and expiring it because the effect that made it
   * is not on this path would lapse a commitment the rewind had just restored.
   */
  it('does not lapse a commitment whose effect is not on this path', async () => {
    const run = await select({
      pool: pooled(hook()),
      channels: COMMITTED,
      history: [turn(), turn(), turn(), turn(), turn()],
      answer: { object: { hookId: null } },
    });

    expect(run.report.lapses).toBeUndefined();
  });

  /**
   * **Back in the pool, and the filter gets its say again on the very turn it
   * lapses.** The commitment was suppressing a refusal; once it is gone the
   * record should show what the filter actually thinks, not a stale `null`.
   */
  it('hands the hook back to the filter as it goes', async () => {
    const run = await select({
      pool: pooled(hook({ notBefore: { turn: 40 } })),
      channels: COMMITTED,
      history: commitAt(0, 4),
    });

    expect(run.report.selection.lapsed).toEqual(['hook-war']);
    expect(run.report.selection.considered).toEqual([{ hookId: 'hook-war', refusal: 'too-early' }]);
    // Nothing was eligible once it went back, so nobody was asked.
    expect(run.report.selection.verdict).toBe('nothing-eligible');
    expect(run.host.asked).toHaveLength(0);
  });
});

/**
 * **Force-fire** — [06 §6.1]'s other hand control, [P7.5].
 *
 * *"It stays what it sounds like: the hook is delivered on the next turn with no
 * judgement call at all."* Where Commit opens the gate and still asks **where**,
 * this answers **now** — which is the whole of the difference between them, and
 * the reason [10 §10.1] keeps them in different surfaces.
 */
describe('a forced hook', () => {
  const FORCED = { [channelKey(SE_HOOK, 'hook-war')]: { value: 'forced' } };

  it('fires without asking anybody', async () => {
    const run = await select({
      pool: pooled(hook()),
      channels: FORCED,
      // At the setting that refuses everything, and straight after a firing:
      // neither the dial nor the cooldown is consulted at all.
      pacing: 'manual-only',
      history: [fired('hook-peace')],
    });

    expect(run.host.asked).toHaveLength(0);
    expect(run.report.selection).toMatchObject({ verdict: 'fired', hookId: 'hook-war' });
    expect(run.report.fired).toEqual({ hookId: 'hook-war', state: 'fired' });
    expect(run.report.guidance).toContain('The Flower Kingdom will declare war.');
  });

  /**
   * **The record says nobody was asked**, which is what makes a forced firing
   * readable as one: a `fired` verdict carrying `forced` on the hook it names is
   * a different fact from the same verdict without it.
   */
  it('says so on the record, and says what it skipped', async () => {
    const run = await select({
      pool: pooled(hook({ notBefore: { turn: 40 } })),
      channels: FORCED,
    });

    expect(run.report.selection.considered).toEqual([
      { hookId: 'hook-war', refusal: null, forced: { overrode: 'too-early' } },
    ]);
  });

  /**
   * *An introduction forced is still provisional.* Guidance stays advisory at
   * every setting — [06 §6.1] is explicit that none of this makes the narrator
   * comply — so the decline that costs an introduction *"a silent permanent
   * loss"* is just as possible here, and the same under-firing bias applies.
   */
  it('is still only provisional when it introduces somebody', async () => {
    const arrival = hook({
      premise: '',
      introduces: {
        actor: { id: 'actor-vera', name: 'Vera' },
        entrances: [{ id: 'e-rain', label: 'In the rain', text: 'She is soaked to the skin.' }],
        primaryEntranceId: null,
      },
    });
    const run = await select({ pool: pooled(arrival), channels: FORCED, known: ['actor-vera'] });

    expect(run.report.fired).toEqual({ hookId: 'hook-war', state: 'provisional' });
    expect(run.report.guidance).toContain('She is soaked to the skin.');
  });

  /**
   * **A force outranks a commitment**, and it has to: the two are exclusive on
   * one channel, so a hook cannot be both — but a *different* hook being
   * committed must not delay the one somebody forced, which is the case this
   * pins.
   */
  it('goes ahead of a commitment on another hook', async () => {
    const channels = {
      ...FORCED,
      [channelKey(SE_HOOK, 'hook-peace')]: { value: 'committed' },
    };
    const run = await select({
      pool: pooled(hook({ id: 'hook-war' }), hook({ id: 'hook-peace' })),
      channels,
    });

    expect(run.host.asked).toHaveLength(0);
    expect(run.report.selection.hookId).toBe('hook-war');
  });
});

/**
 * ***Gate step 4's record half, as the one assertion it asks for*** —
 * [06 §6.1], [10 §10.1], [P7 §3] row 4, written at [P7.9].
 *
 * §3.1: *"drive the selector into pacing-held, nothing-eligible, judged-none and
 * fired, assert **four distinguishable lines**."* Every one of those is
 * already asserted somewhere in this build — and **in three different files**,
 * one verdict at a time, which is not the same claim. *Distinguishable* is a
 * statement about the set, and a set is what nothing was checking: four tests
 * that each assert one arm all pass on an implementation that answers `fired`
 * for everything except the case each of them happens to drive.
 *
 * *`cooling` is the fifth and had never reached a record at all* — it existed
 * only as an arithmetic answer from `gate()`. [06 §6.1] separates it from `held`
 * deliberately, because *waiting* is the remedy rather than the dial, and a
 * verdict with no path to a turn cannot say that to anybody.
 */
describe('the five answers are five answers', () => {
  const WAR = 'hook-war';

  /** A turn that fired the hook `n` turns ago, which is what a cooldown counts. */
  function after(n: number): Turn[] {
    const turns: Turn[] = [];
    for (let index = 0; index < n; index += 1) {
      turns.push({
        id: `t${String(index)}`,
        sessionId: 's',
        parentTurnId: index === 0 ? null : `t${String(index - 1)}`,
        createdAt: '2026-09-13T00:00:00.000Z',
        status: 'complete',
        tape: [],
        effects:
          index === 0
            ? [
                {
                  id: 'e0',
                  turnId: 't0',
                  channelId: SE_HOOK,
                  scopeKey: WAR,
                  op: { type: 'set', path: '/' },
                  before: null,
                  after: 'fired',
                  proposedBy: { kind: 'engine' },
                  applied: true,
                  rejectedReason: null,
                  supersedes: null,
                  channelVersion: 1,
                  scope: 'session',
                },
              ]
            : [],
      });
    }
    return turns;
  }

  it('answers each of the five for the situation that is its own', async () => {
    const held = await line({ pool: pooled(hook()), pacing: 'manual-only' });

    const spent = await line({
      pool: pooled(hook()),
      channels: { [channelKey(SE_HOOK, WAR)]: { value: 'fired' } },
    });

    /**
     * *A second hook, so the pool is not empty while the first one cools.*
     * Without it the gate answers `nothing-eligible` — which is true and is a
     * different question, and is exactly the confusion [06 §6.1] separates the
     * two verdicts to prevent.
     */
    const cooling = await line({
      pool: pooled(hook(), hook({ id: 'hook-peace' })),
      channels: { [channelKey(SE_HOOK, WAR)]: { value: 'fired' } },
      history: after(2),
      pacing: 'sparse',
    });

    const none = await line({ pool: pooled(hook()), answer: { object: { hookId: null } } });
    const fired = await line({ pool: pooled(hook()), answer: { object: { hookId: WAR } } });

    const verdicts = [held.verdict, spent.verdict, cooling.verdict, none.verdict, fired.verdict];

    expect(verdicts).toEqual(['held', 'nothing-eligible', 'cooling', 'judged-none', 'fired']);
    // **The claim the row is actually making**: five situations, five answers,
    // no two the same. A merged pair is what makes a correctly-quiet session
    // indistinguishable from a broken one.
    expect(new Set(verdicts).size).toBe(5);
  });
});

/**
 * ***The dial says something to the model, and not only to the clock*** —
 * [06 §6.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [P11.5](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §6.1's split — *"Level → cadence, cooldown and patience is engine code; the
 * level's prose is the prompt pack's"* — had only one half built for four
 * phases. The dial changed **how often** the question was asked and never
 * **what** was asked, so `sparse` and `aggressive` put the identical prompt to
 * the model and differed in a cadence the model could not see.
 *
 * *The falsifying mutation is the state it was in*: drop the block and every
 * other test in this file still passes, because the selector's answer is a hook
 * id and the prose does not change its shape.
 */
describe('the pacing prose the pack ships', () => {
  const PROSE = 'Beats are rare in this story.';

  function blocks(asked: StepCallRequest[]): string[] {
    return (asked[0]?.candidates ?? []).map((candidate) => candidate.id);
  }

  it('reaches the call when the pack has some', async () => {
    const run = await select({ pool: pooled(hook()), pacingProse: PROSE });
    expect(blocks(run.host.asked)).toContain('se.hooks.select.pacing');
    const carried = (run.host.asked[0]?.candidates ?? []).find(
      (candidate) => candidate.id === 'se.hooks.select.pacing',
    );
    expect(carried?.text).toBe(PROSE);
  });

  /**
   * ***Absent rather than empty***, which is the difference between *the pack
   * has nothing to say here* and *the pack tried and failed*. A reader of the
   * turn record can tell those apart only if one of them is not there.
   */
  it('is not in the call at all when the pack ships none', async () => {
    const run = await select({ pool: pooled(hook()) });
    expect(blocks(run.host.asked)).not.toContain('se.hooks.select.pacing');
    expect(blocks(run.host.asked)).toContain('se.hooks.select.task');
  });

  /**
   * *After the task and before the pool.* The task is what makes the schema
   * answerable; the prose is a disposition to bring to it, and a disposition
   * read after the premises is a disposition read **about** the premises.
   */
  it('sits between the question and the premises', async () => {
    const run = await select({ pool: pooled(hook()), pacingProse: PROSE });
    const order = blocks(run.host.asked);
    expect(order.indexOf('se.hooks.select.pacing')).toBeGreaterThan(
      order.indexOf('se.hooks.select.task'),
    );
    expect(order.indexOf('se.hooks.select.pacing')).toBeLessThan(
      order.indexOf('se.hooks.select.pool'),
    );
  });

  /**
   * **A held turn carries no prose because it carries no call**, which is the
   * property the gate has and this must not cost: *"that costs nothing, because
   * stage 1 is deliberately model-free"*. A pacing block assembled before the
   * gate would make `sparse` the setting that does the most work.
   */
  it('costs nothing on a turn the gate holds', async () => {
    const run = await select({
      pool: pooled(hook()),
      channels: { [channelKey(SE_HOOK_PACING, null)]: { value: 'manual-only' } },
      pacing: 'manual-only',
      pacingProse: PROSE,
    });
    expect(run.report.selection.verdict).toBe('held');
    expect(run.host.asked).toHaveLength(0);
  });
});
