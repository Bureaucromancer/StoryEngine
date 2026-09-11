// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  PRESET_SCHEMA,
  type Candidate,
  type EffectProposal,
  type StepDefinition,
  type StepHost,
  type StepImplementation,
  type StepInput,
  type StepResult,
} from './index.js';

/**
 * The contract, written against as a mode author would —
 * [P7.0](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **This file's imports are the assertion.** Everything below comes from
 * `./index.js` and nothing from `server`, so if a step cannot be declared and
 * implemented from this package alone, this file stops compiling. That is the
 * automatable half of the exit gate's step 10 — the half a person still has to
 * walk is whether the contract *permitted* something worth building, which no
 * test can answer.
 *
 * The first test in `packages/sdk`, which is what `tsconfig.spec.json`'s
 * `files: []` was waiting for: *"so the project is legal before the package has
 * its first test."*
 */
describe('a mode can be written against the SDK alone', () => {
  const NARRATE: StepDefinition = {
    id: 'example.narrate',
    stage: 'generate',
    reads: ['history'],
    writes: [],
    contributes: 'messages',
    callKind: 'narrate',
    when: { when: 'cadence', everyNTurns: 1 },
    failure: 'abort',
    role: 'prose',
  };

  const narrate: StepImplementation = async (_input, host) => {
    const result = await host.call({ stream: true });
    return { message: { text: result.text } };
  };

  it('declares a step without naming an engine type', () => {
    // Nothing here is a smoke test of the values: the point is that the
    // annotations above resolved. What is worth asserting is the one field
    // whose meaning is load-bearing and easy to get wrong — an empty `writes`
    // beside `contributes: 'messages'` is what earns a step the guidance block,
    // and one entry would turn every guided turn into a refusal.
    expect(NARRATE.writes).toHaveLength(0);
    expect(NARRATE.contributes).toBe('messages');
  });

  it('runs a step against a host the package describes', async () => {
    const host: StepHost = {
      call: () => Promise.resolve({ callId: 'c-1', text: 'The rain kept on.', usage: null }),
      random: {
        at: () => {
          throw new Error('this step does not draw');
        },
      },
      signal: new AbortController().signal,
    };

    const input: StepInput = {
      turnId: 't-1',
      sessionId: 's-1',
      parentTurnId: null,
      channels: {},
      history: [],
    };

    await expect(narrate(input, host)).resolves.toEqual({
      message: { text: 'The rain kept on.' },
    });
  });

  it('keeps the payload clonable, which is what crosses a worker hop', () => {
    // [01 §2] makes the step contract async and serialisable a day-one item.
    // The host is proxied and the payload is cloned, so it is these two shapes
    // the property has to hold for — asserted here as well as in the engine,
    // because here is where a published type would acquire a non-clonable
    // member without the engine noticing.
    const input: StepInput = {
      turnId: 't-1',
      sessionId: 's-1',
      parentTurnId: null,
      input: { actorId: null, kind: 'do', text: 'She waited.', raw: 'She waited.' },
      channels: { 'se.clock': { version: 1, value: { day: 1, hour: 8, minute: 0 } } },
      history: [],
    };

    const candidate: Candidate = {
      id: 'example.block',
      source: { kind: 'step', stepId: 'example.narrate' },
      reason: 'because the step said so',
      role: 'system',
      text: 'It is raining.',
    };

    const effect: EffectProposal = {
      channelId: 'example.mood',
      op: { type: 'set', path: '/' },
      after: 'bleak',
      proposedBy: { kind: 'step', stepId: 'example.narrate' },
    };

    const result: StepResult = { candidates: [candidate], effects: [effect] };

    expect(structuredClone(input)).toEqual(input);
    expect(structuredClone(result)).toEqual(result);
  });

  it('hands over the portable schemas too, so a mode needs one import', () => {
    // `shared` is re-exported rather than re-declared: a second declaration
    // would be two vocabularies for one wire format. `/0` rather than `/1` is
    // the preset's own business — it is the one portable kind still declaring
    // itself unstable — and reading it through this package is the assertion.
    expect(PRESET_SCHEMA).toBe('storyengine.preset/0');
  });
});
