// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import {
  joinMessageTexts,
  PRESET_SCHEMA,
  type Candidate,
  type EffectProposal,
  type OutputMessage,
  type StepDefinition,
  type StepHost,
  type StepImplementation,
  type StepInput,
  type StepResult,
  type SurfaceContribution,
  type WidgetSpec,
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

  /**
   * ***The prohibition [10 §8] names, as an assertion rather than a
   * docstring*** — [P7.11].
   *
   * *"What must **not** happen is the vocabulary quietly acquiring an
   * `html: string` field. That is the escape hatch arriving without any of the
   * safety, and it is how this decision would be undone by accident rather than
   * on purpose."*
   *
   * **A test is what makes *by accident* impossible.** Every widget arm is a
   * label plus something the server already rendered; the day one of them takes
   * markup is the day an extension can break the app's rendering, and the day
   * the frontend framework stops being a reversible decision ([19 §6]). Written
   * over a value rather than over the type because a type cannot be asserted at
   * run time — what this catches is a field arriving on a declaration, which is
   * where it would arrive.
   */
  it('has no way for a mode to ship markup, now or later', () => {
    const arms: WidgetSpec[] = [
      { kind: 'text', label: 'Time' },
      { kind: 'image', label: 'Behind you' },
      { kind: 'toggle', label: 'Show the scene' },
    ];

    for (const widget of arms) {
      const keys = Object.keys(widget);
      expect(keys, widget.kind).toEqual(expect.arrayContaining(['kind', 'label']));
      // Not `html`, and not anything that would smuggle one in.
      for (const banned of ['html', 'dangerouslySetInnerHTML', 'component', 'render', 'script']) {
        expect(keys, `${widget.kind} carries ${banned}`).not.toContain(banned);
      }
    }
  });

  /**
   * *A contribution shows state and never invents it*, which is what keeps this
   * declarative all the way down: no text field, no template, no payload of the
   * mode's own — a channel id and a widget, and everything that already governs
   * a channel governs the surface for free.
   */
  it('lets a mode place a widget and say nothing else about it', () => {
    const contribution: SurfaceContribution = {
      region: 'stage',
      channelId: 'se.backdrop',
      widget: { kind: 'image', label: 'Behind you' },
    };

    expect(Object.keys(contribution).sort()).toEqual(['channelId', 'region', 'widget']);
    expect(structuredClone(contribution)).toEqual(contribution);
  });

  /**
   * ***A step that voices several speakers, from this package alone*** —
   * [P13.0](../../../docs/design/workplan/30-p13-scene-and-session-import.md).
   *
   * `OutputMessage` is a record type and lives in `shared`, so what this
   * asserts is that the re-export carries it: a mode author writing a group
   * round names the type and the derivation through one import, and the result
   * still clones, because it crosses the same hop the rest of `StepResult` does.
   */
  it('returns several attributed messages, and the text they derive to', () => {
    const messages: OutputMessage[] = [
      { speaker: null, text: 'Rain on the tin roof.' },
      { speaker: { id: 'actor-marlow', name: 'Marlow' }, text: '"You came."' },
    ];
    const result: StepResult = { messages };

    expect(structuredClone(result)).toEqual(result);
    expect(joinMessageTexts(messages)).toBe('Rain on the tin roof.\n\n"You came."');
  });

  /**
   * ***A round, fanned out from this package alone*** — [P13.2]. The session's
   * voice and dispatch arrive on the input, a speaking call names its member,
   * and the result carries back who spoke and, when cleanup changed the reply,
   * what the model said — everything a step needs to write the turn's
   * `messages` without declaring `cast` to learn a name.
   */
  it('speaks for each selected member in turn, from the input and the results alone', async () => {
    const asked: (string | undefined)[] = [];
    const host: StepHost = {
      call: (request) => {
        asked.push(request.speaker);
        const name = request.speaker === 'actor-vera' ? 'Vera' : 'Lund';
        return Promise.resolve({
          callId: `call-${String(asked.length)}`,
          text: `"${name} speaks."`,
          usage: null,
          ...(request.speaker === undefined ? {} : { speaker: { id: request.speaker, name } }),
          ...(name === 'Vera' ? { original: `Vera: "${name} speaks."` } : {}),
        });
      },
      random: {
        at: () => {
          throw new Error('a round draws nothing; its order is the selection');
        },
      },
      signal: new AbortController().signal,
    };
    const round: StepImplementation = async (input, stepHost) => {
      if (input.voice !== 'embodied' || input.dispatch !== 'per-actor') return {};
      const messages: OutputMessage[] = [];
      for (const speaker of input.speakers ?? []) {
        const result = await stepHost.call({ stream: true, speaker });
        if (result.speaker === undefined) continue;
        messages.push({
          speaker: result.speaker,
          text: result.text,
          ...(result.original === undefined ? {} : { original: result.original }),
        });
      }
      return { messages };
    };
    const input: StepInput = {
      turnId: 't',
      sessionId: 's',
      parentTurnId: null,
      speakers: ['actor-vera', 'actor-lund'],
      voice: 'embodied',
      dispatch: 'per-actor',
      channels: {},
    };

    const result = await round(input, host);

    expect(asked).toEqual(['actor-vera', 'actor-lund']);
    expect(result.messages).toEqual([
      {
        speaker: { id: 'actor-vera', name: 'Vera' },
        text: '"Vera speaks."',
        original: 'Vera: "Vera speaks."',
      },
      { speaker: { id: 'actor-lund', name: 'Lund' }, text: '"Lund speaks."' },
    ]);
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
