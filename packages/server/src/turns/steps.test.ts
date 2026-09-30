// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { channelKey, SE_LORE_TIMING, SE_CLOCK } from '../sessions/channels.js';
import type { StepDefinition, StepInput, StepResult } from '@storyengine/sdk';
import type { Turn } from '@storyengine/shared';

import { callPurposeFor, evaluateCondition, filterReads, transcriptOf } from './steps.js';

/**
 * When a step runs, and what it is handed — [06 §6], [22 §3.1].
 *
 * These exist because an audit measured all three `StepCondition` arms as
 * mutation-insensitive: the runner is the only evaluator, it passes empty sets
 * for `stages` and `armed`, and nothing anywhere produces either — so two arms
 * could never be satisfied and the third's off-by-one could be changed with the
 * whole suite green. A condition vocabulary nothing can exercise is a
 * vocabulary nobody can trust when P2.6's modes start using it.
 *
 * Driven directly, with a hand-built context, which is what restores that
 * sensitivity today without inventing a producer the design has not specified.
 */

const step = (over: Partial<StepDefinition> = {}): StepDefinition => ({
  id: 'se.test',
  stage: 'generate',
  reads: [],
  writes: [],
  callKind: 'narrate',
  when: { when: 'cadence', everyNTurns: 1 },
  failure: 'abort',
  role: null,
  ...over,
});

const at = (turnsOnPath: number, over: { stages?: string[]; armed?: string[] } = {}) => ({
  turnsOnPath,
  stages: new Set(over.stages ?? []),
  armed: new Set(over.armed ?? []),
});

describe('cadence', () => {
  it('runs every turn at one', () => {
    const every = { when: 'cadence', everyNTurns: 1 } as const;
    for (const turns of [0, 1, 2, 7]) {
      expect(evaluateCondition(every, at(turns)).ok, `at ${String(turns)}`).toBe(true);
    }
  });

  it('counts the turn about to happen, not the ones behind it', () => {
    // The off-by-one that an all-green suite could not see. With three turns on
    // the path, the turn being composed is the fourth — so a cadence of two is
    // due, and a cadence of three is not.
    const everyTwo = { when: 'cadence', everyNTurns: 2 } as const;

    expect(evaluateCondition(everyTwo, at(0)).ok).toBe(false); // the 1st turn
    expect(evaluateCondition(everyTwo, at(1)).ok).toBe(true); // the 2nd
    expect(evaluateCondition(everyTwo, at(2)).ok).toBe(false); // the 3rd
    expect(evaluateCondition(everyTwo, at(3)).ok).toBe(true); // the 4th
  });

  it('reports why it skipped, because silence is the worst answer', () => {
    const decision = evaluateCondition({ when: 'cadence', everyNTurns: 3 }, at(0));
    expect(decision).toEqual({ ok: false, reason: 'cadence' });
  });
});

describe('the two arms nothing produces yet', () => {
  it('runs a stage-flagged step when the stage is raised', () => {
    // **Unsatisfiable through the runner today**, which passes an empty set —
    // so without this the arm is dead code that looks live. P2.6's modes are
    // the first thing that could raise one, and this is what will tell them the
    // arm works when they do.
    const flagged = { when: 'stage', flag: 'scene.opening' } as const;

    expect(evaluateCondition(flagged, at(0, { stages: ['scene.opening'] })).ok).toBe(true);
    expect(evaluateCondition(flagged, at(0))).toEqual({ ok: false, reason: 'stage' });
  });

  it('runs an armed step only when the user armed it', () => {
    const armed = { when: 'armed', flag: 'reroll-lore' } as const;

    expect(evaluateCondition(armed, at(0, { armed: ['reroll-lore'] })).ok).toBe(true);
    expect(evaluateCondition(armed, at(0))).toEqual({ ok: false, reason: 'not-armed' });
  });

  it('does not confuse a stage flag with an armed one', () => {
    // Same shape, different set. Reading the wrong one is a one-word mistake
    // that no end-to-end test could distinguish while both sets are empty.
    const stage = { when: 'stage', flag: 'shared-name' } as const;
    const armed = { when: 'armed', flag: 'shared-name' } as const;

    expect(evaluateCondition(stage, at(0, { armed: ['shared-name'] })).ok).toBe(false);
    expect(evaluateCondition(armed, at(0, { stages: ['shared-name'] })).ok).toBe(false);
  });
});

describe('a step is handed only what it declared', () => {
  const everything = {
    turnId: 't',
    sessionId: 's',
    parentTurnId: null,
    channels: { [SE_CLOCK]: { version: 1, value: { day: 1, hour: 8, minute: 0 } } },
    history: [],
    output: { text: 'the answer so far' },
  };

  it('withholds history from a step that did not ask for it', () => {
    // [22 §3.1]'s payload filter, which is also what makes the boundary
    // narrow enough to cross a worker hop later.
    expect(filterReads(step(), everything).history).toBeUndefined();
    expect(filterReads(step({ reads: ['history'] }), everything).history).toEqual([]);
  });

  it('withholds a channel it did not name', () => {
    expect(filterReads(step(), everything).channels).toEqual({});
    expect(filterReads(step({ reads: [SE_CLOCK] }), everything).channels).toHaveProperty(SE_CLOCK);
  });

  /**
   * **A declared read takes the channel's scoped values too**, which is P5.5's
   * widening seen from the step side. A step asking for `se.lore.timing` wants
   * every entry's timing — and for an entry-scoped channel there is no value
   * under the bare id at all, so a lookup by exact key hands the step an empty
   * map and it behaves as though nothing had ever fired.
   */
  it('hands over every scoped value of a channel it did name', () => {
    const scoped = {
      ...everything,
      channels: {
        ...everything.channels,
        [channelKey(SE_LORE_TIMING, 'entry-a')]: { version: 1, value: { sticky: 2 } },
        [channelKey(SE_LORE_TIMING, 'entry-b')]: { version: 1, value: { sticky: 5 } },
      },
    };

    const read = filterReads(step({ reads: [SE_LORE_TIMING] }), scoped).channels;

    expect(Object.keys(read).toSorted()).toEqual([
      channelKey(SE_LORE_TIMING, 'entry-a'),
      channelKey(SE_LORE_TIMING, 'entry-b'),
    ]);
    // And not the clock, which it did not ask for.
    expect(read).not.toHaveProperty(SE_CLOCK);
  });

  /**
   * ***A step that declared `transcript` is handed no blocks*** — [P8 §1.5],
   * [P8.1], and the clause that compounds.
   *
   * [08 §6](../../../../docs/design/08-cross-session-memory.md) asks that memory
   * never be extracted from hidden content and that the refusal happen **at the
   * source**, *"rather than filtering them later"*, because by then *"the
   * extraction has already written the sentence down."* Against `history` that
   * was not expressible: the payload is whole `Turn`s and a `Turn` carries
   * `request.calls[].blocks[].text`, so a hook's premise, an unfired entrance's
   * finished prose and a hidden channel's rendered value all arrive verbatim
   * inside the record a step declared `history` to get.
   *
   * **The fixture's turn carries a premise in exactly that position**, so this
   * fails the moment `transcript` becomes a slice rather than a projection. The
   * first arm is the refusal; the second is its control — a projection that
   * carried nothing would pass the first for the wrong reason.
   */
  it('hands a transcript what was said, and nothing the prompt contained', () => {
    const withPremise: Turn = {
      ...historyTurn(),
      request: {
        calls: [
          {
            id: 'c0',
            stepId: 'se.narrate',
            role: 'prose',
            purpose: 'prose',
            resolved: { connectionId: 'c', modelId: 'm' },
            blocks: [
              {
                id: 'se.hook.premise',
                source: { kind: 'step', stepId: 'se.hooks' },
                reason: 'the hook',
                role: 'system',
                text: 'The ferryman is her brother, which she does not know.',
                tokens: 12,
                included: true,
              },
            ],
            messages: [],
            params: {},
            usage: null,
            cost: null,
            wallMs: 12,
            finishReason: null,
            outcome: 'ok',
            error: null,
            retries: 0,
          },
        ],
      },
    };
    const path = { ...everything, history: [withPremise] };

    const narrow = filterReads(step({ reads: ['transcript'] }), path);
    expect(narrow.history).toBeUndefined();
    expect(JSON.stringify(narrow)).not.toContain('her brother');

    // The control: it does carry the story, or the arm above is satisfied by a
    // filter that hands over nothing at all.
    expect(narrow.transcript).toEqual([
      {
        turnId: 't0',
        input: { actorId: null, kind: 'do', text: 'She waited.' },
        output: { text: 'The rain kept on.' },
      },
    ]);
    // And `raw` goes with the record: a step entitled to the resolved text has
    // no claim on the text before mention resolution.
    expect(JSON.stringify(narrow.transcript)).not.toContain('raw');

    // A step that asked for neither gets neither; one that asked for `history`
    // still gets the whole record, which is what the extractor must not declare.
    expect(filterReads(step(), path).transcript).toBeUndefined();
    expect(JSON.stringify(filterReads(step({ reads: ['history'] }), path))).toContain(
      'her brother',
    );
  });

  it('never hands over guidance, whatever a step declares', () => {
    // The omission is the design: `reads` cannot name guidance, so a step that
    // could receive it would have to be handed it as an ungated extra — and a
    // step holding the text could re-emit it as an ordinary candidate, which
    // `assemble` would admit ([06 §5.2]).
    const input = filterReads(step({ reads: ['history', 'guidance', SE_CLOCK] }), everything);
    expect(input).not.toHaveProperty('guidance');
    expect(JSON.stringify(input)).not.toContain('guidance');
  });
});

describe('the purpose a call is given', () => {
  it('is prose only for a step that writes nothing and speaks', () => {
    expect(callPurposeFor(step({ contributes: 'messages' }))).toBe('prose');
    expect(callPurposeFor(step({ contributes: 'messages', writes: [SE_CLOCK] }))).toBe('effects');
    expect(callPurposeFor(step({ contributes: 'effects' }))).toBe('effects');
    expect(callPurposeFor(step({ contributes: 'blocks' }))).toBe('effects');
    // Fails closed: a step declaring nothing gets the restrictive purpose.
    expect(callPurposeFor(step())).toBe('effects');
  });
});

describe('the step boundary is serialisable, which is what P7 moves', () => {
  /**
   * **Every member of the type, listed by the type** — [P7 §1.3], whose second
   * correction is what these two objects answer.
   *
   * A `Record<keyof Required<T>, true>` literal must name every key of `T`:
   * omitting one is a compile error and inventing one is a compile error. So
   * these are not key lists somebody maintains — they are the type, in a form a
   * runtime assertion can compare against, and **adding a member to `StepInput`
   * or `StepResult` stops this file compiling until somebody decides whether it
   * crosses a worker hop**.
   *
   * That is the property [P7 §1.3](../../../../docs/design/workplan/23-p7-implementation.md)
   * leans on and did not have. It recorded the gap precisely: the `StepInput`
   * case cloned a fixture with `history: []` and no `output`, so neither arm was
   * exercised, and the `StepResult` case pinned a hand-written literal with no
   * annotation, *"so a non-clonable member added to `StepResult` tomorrow leaves
   * the test green"*. A day-one item ([01 §2]) held by a test that cannot notice
   * the thing changing is held by nothing.
   */
  const EVERY_INPUT_MEMBER: Record<keyof Required<StepInput>, true> = {
    turnId: true,
    sessionId: true,
    parentTurnId: true,
    input: true,
    speakers: true,
    voice: true,
    dispatch: true,
    setup: true,
    cast: true,
    channels: true,
    history: true,
    transcript: true,
    output: true,
    // A boolean flag, which clones trivially — [P13.5a]'s on-demand run.
    onDemand: true,
  };

  const EVERY_RESULT_MEMBER: Record<keyof Required<StepResult>, true> = {
    candidates: true,
    effects: true,
    message: true,
    messages: true,
    // An editor's answer — plain data, readonly arrays of strings and records ([P13.5c]).
    revisions: true,
  };

  it('round-trips a StepInput through structuredClone with nothing lost', () => {
    // [01 §2] makes the step contract async and serialisable a **day-one** item,
    // precisely so the worker split at P7 is a move rather than a rewrite. The
    // claim was in a docstring and asserted nowhere.
    //
    // **Every optional arm populated, and `history` carrying a real turn.** An
    // empty array clones trivially and proves nothing about the thing actually
    // in the payload — a `Turn` is the deepest object that crosses this seam,
    // with an effect's `unknown` values and a tape inside it, and `unknown` is
    // where a non-clonable value would hide.
    const input = filterReads(
      step({ reads: ['history', 'transcript', 'output', 'cast', SE_CLOCK] }),
      {
        turnId: 't',
        sessionId: 's',
        parentTurnId: null,
        input: { actorId: null, kind: 'do', text: 'She waited.', raw: 'She waited.' },
        // A readonly array, which is where a frozen input would cross badly — and
        // the shape a mode with a widened `select` hands every step ([P7.3]).
        speakers: ['actor-vera'],
        // How the session speaks — two strings, handed to every step ([P13.2]).
        voice: 'embodied',
        dispatch: 'per-actor',
        // A frozen record, which is what a session's stored answers are by the
        // time they reach a step — and the shape a structured clone has to survive.
        setup: Object.freeze({ premise: 'A city that does not sleep.', dice: true }),
        // Readonly twice over — the array and each entry's `media` — which is the
        // shape the runner builds and the one a frozen payload crosses badly in
        // ([P7.12]).
        cast: [
          {
            actorId: 'actor-vera',
            name: 'Vera',
            kind: 'actors',
            media: [{ id: 'm-1', role: 'expression', label: 'neutral' }],
          },
        ],
        channels: { [SE_CLOCK]: { version: 1, value: { day: 1, hour: 8, minute: 0 } } },
        history: [historyTurn()],
        // With its messages, as a revising step reads it ([P13.5c]).
        output: {
          text: 'The rain did not let up.',
          messages: [{ speaker: null, text: 'The rain did not let up.' }],
        },
        onDemand: true,
      },
    );

    // The seam's width, from the type rather than from a hand-kept list.
    expect(Object.keys(input).sort()).toEqual(Object.keys(EVERY_INPUT_MEMBER).sort());
    expect(structuredClone(input)).toEqual(input);
  });

  it('round-trips a StepResult too', () => {
    const result: Required<StepResult> = {
      candidates: [
        {
          id: 'se.x',
          source: { kind: 'step', stepId: 'se.x' },
          reason: 'because',
          role: 'system',
          text: 'hello',
          priority: 50,
        },
      ],
      effects: [
        {
          channelId: SE_CLOCK,
          op: { type: 'set', path: '/' },
          after: { day: 1, hour: 9, minute: 0 },
          proposedBy: { kind: 'step', stepId: 'se.x' },
        },
      ],
      message: { text: 'the answer', reasoning: 'she had been waiting a while' },
      /**
       * *Beside `message` only because `Required` puts every member here* — the
       * runner refuses a result carrying both ([P13.0]). What this literal
       * proves is that the shape crosses the hop, and a speaker is a `Ref`, an
       * object inside an object inside an array, which is the depth a clone
       * has to get right.
       */
      messages: [
        { speaker: null, text: 'Rain.', original: 'Narrator: Rain.' },
        { speaker: { id: 'actor-vera', name: 'Vera' }, text: '"Late."', carried: true },
      ],
      revisions: [
        {
          index: 0,
          text: 'Rain, still.',
          changes: ['Removed a banned word.'],
          notices: [{ issue: 'The lamp was out.', quote: 'lit lamp', fix: 'dark lamp' }],
        },
      ],
    };

    // `Required<StepResult>` rather than a bare literal: the annotation is what
    // makes a wrong shape a compile error, and `Required` is what makes a
    // *missing* member one. The `as const` casts the old literal needed were an
    // artefact of having no annotation at all.
    expect(Object.keys(result).sort()).toEqual(Object.keys(EVERY_RESULT_MEMBER).sort());
    expect(structuredClone(result)).toEqual(result);
  });

  /**
   * **The debt this block used to record is paid, and what it said was wrong
   * twice** — [P7.0].
   *
   * It read *"`StepHost.rng` is a live class instance… `call` and `signal` cross
   * fine; `rng` does not"*, and asserted that by comparing `Object.keys` on a
   * hand-built literal whose `rng` was `{}`. It never cloned anything. Checked
   * rather than assumed, **none of the three crosses**: a function throws
   * `DataCloneError`, and an `AbortSignal` does something worse than throw — it
   * clones to a detached `{}` whose `aborted` is `undefined`, so a step would
   * hold a signal that never fires.
   *
   * That is not a defect, because **the host is proxied and never cloned**. It
   * is `StepInput` and `StepResult` that cross, which is what the two tests
   * above pin. What singled `rng` out was never clonability: it was that `call`
   * and `signal` have bridges invisible to their callers — `call` already
   * returns a `Promise`, a signal bridges as an abort message — while an `Rng`
   * would have turned eight synchronous methods async at every call site that
   * had already been written against them. Converting it before anything drew
   * is what this phase did instead.
   */
  it('hands a step three capabilities, and none of them is data', () => {
    const host = {
      call: () => Promise.resolve(),
      random: { at: () => ({}) },
      signal: new AbortController().signal,
    };
    // A canary on the *width* of the seam: every member added here is another
    // thing a worker has to bridge, and the narrowness is the contract.
    expect(Object.keys(host).sort()).toEqual(['call', 'random', 'signal']);

    expect(() => structuredClone(host.call)).toThrow(/DataCloneError|could not be cloned/);
    // The quiet one, which is why it is asserted rather than described.
    expect((structuredClone(host.signal) as { aborted?: boolean }).aborted).toBeUndefined();
  });
});

/**
 * A turn rich enough for the clone to be about something.
 *
 * `effects[].before` / `.after` and a `Draw`'s `value` are all `unknown` on the
 * record types, which is exactly where a value that cannot cross would hide —
 * so they hold structures rather than scalars, and the tape is non-empty.
 */
function historyTurn(): Turn {
  return {
    id: 't0',
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-09-11T00:00:00.000Z',
    status: 'complete',
    input: { actorId: null, kind: 'do', text: 'She waited.', raw: 'She waited.' },
    output: { text: 'The rain kept on.' },
    effects: [
      {
        id: 'e0',
        turnId: 't0',
        channelId: SE_CLOCK,
        scopeKey: null,
        op: { type: 'set', path: '/' },
        before: { day: 1, hour: 8, minute: 0 },
        after: { day: 1, hour: 8, minute: 5 },
        proposedBy: { kind: 'engine' },
        applied: true,
        rejectedReason: null,
        supersedes: null,
        channelVersion: 1,
        scope: 'session',
      },
    ],
    tape: [
      {
        key: 'se.test:pick#0',
        site: 'se.test',
        purpose: 'pick',
        index: 0,
        kind: 'int',
        detail: '0..5',
        value: 3,
        replayed: false,
      },
    ],
  };
}

/**
 * ***The transcript is the story's turns*** (2026-09-27). A channel write, an
 * undo or a backdrop choice is on the path with nothing said in it, and it took
 * a place in the summary chain's stretches beside the window, which counts the
 * same list (`gather.ts`).
 */
describe('the transcript a step reads', () => {
  function turnOf(id: string, over: Partial<Turn> = {}): Turn {
    return {
      id,
      sessionId: 's',
      parentTurnId: null,
      createdAt: '2026-09-27T00:00:00.000Z',
      status: 'complete',
      effects: [],
      tape: [],
      ...over,
    };
  }

  it('holds the turns of the story and not what the path holds between them', () => {
    const path = [
      turnOf('said', { input: { actorId: null, kind: 'do', text: 'Go.', raw: 'Go.' } }),
      turnOf('an edit'),
      turnOf('told', { output: { text: 'Rain.' } }),
      turnOf('set up', { steps: [] }),
    ];

    expect(transcriptOf(path).map((turn) => turn.turnId)).toEqual(['said', 'told', 'set up']);
  });
});
