// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { createValidator } from '@storyengine/sdk';
import type {
  StepCastMember,
  StepCallRequest,
  StepCallResult,
  StepHost,
  StepInput,
} from '@storyengine/sdk';

import { SCENE_ID } from './mode.js';
import {
  PLOT_CADENCE,
  PLOT_CHANNELS,
  PLOT_ON,
  PLOT_STEP,
  PLOT_SURFACES,
  REVEAL,
  SECRET_PLOT,
  plot,
} from './plot.js';
import { SCENE_PRESET } from './preset.js';

/**
 * ***The secret plot, held to [P14 §1.9.3]*** — [P14.5b].
 *
 * The step's claims, each with the mutation that falsifies it: **off costs
 * nothing**; **no arc is due at once**, and so is a completed one; **otherwise
 * the cadence decides**, in story turns, default four; **a pass that completes
 * the arc is followed by a second**, and both revisions are written; **a lost
 * follow-up keeps the completion**; **an unchanged arc proposes nothing**. The
 * engine half — the slot, the reveal, the director reading it — is the
 * server's (`routes/director.test.ts`).
 */

const VERA: StepCastMember = { actorId: 'a-vera', name: 'Vera', kind: 'actors', media: [] };
const NED: StepCastMember = {
  actorId: 'a-ned',
  name: 'Ned',
  kind: 'actors',
  media: [],
  persona: true,
};

const ARC = {
  description: 'The harbourmaster is smuggling for the Guild, and Vera knows it.',
  protagonistArc: 'Ned learns whom to trust.',
  completed: false,
};

/** A host that answers each call with the next object, and can fail one. */
function host(
  answers: readonly (object | Error)[],
  stopped = false,
): StepHost & { asked: StepCallRequest[] } {
  const asked: StepCallRequest[] = [];
  // The one thing the pass asks of the signal is whether a Stop landed.
  const signal = { aborted: stopped };
  const call = (request: StepCallRequest): Promise<StepCallResult> => {
    const answer = answers[asked.length];
    asked.push(request);
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({
      callId: `c-plot-${String(asked.length)}`,
      text: JSON.stringify(answer),
      usage: null,
      ...(answer === undefined ? {} : { object: answer }),
    });
  };
  return { asked, call, signal } as unknown as StepHost & { asked: StepCallRequest[] };
}

type Channels = StepInput['channels'];

function state(value: unknown): Channels[string] {
  return { value } as Channels[string];
}

function input(channels: Channels, storyTurns = 0): StepInput {
  return {
    turnId: 't-new',
    sessionId: 's',
    parentTurnId: null,
    channels,
    cast: [NED, VERA],
    input: { actorId: null, kind: 'do', text: 'I ask about the ledger.', raw: '' },
    transcript: Array.from({ length: storyTurns }, (_, at) => ({
      turnId: `t-${String(at)}`,
      output: { text: `Turn ${String(at)}.` },
    })),
  };
}

const ON = { [PLOT_ON.id]: state(true) };

describe('what is declared', () => {
  it('is a hidden session channel with a reveal, owned by Scene, off and empty', () => {
    expect(SECRET_PLOT).toMatchObject({
      id: 'se.plot.secret',
      owner: SCENE_ID,
      scope: 'session',
      visibility: 'hidden',
      update: 'model-proposed',
      enabledBy: PLOT_ON.id,
      reveal: REVEAL.id,
      init: { kind: 'literal', value: null },
    });
    // The switch and the reveal are a person's, and both start off.
    for (const toggle of [PLOT_ON, REVEAL]) {
      expect(toggle.update).toBe('user-only');
      expect(toggle.init).toEqual({ kind: 'literal', value: false });
    }
    // Revealing a plot nobody keeps is a control with nothing behind it.
    expect(REVEAL.enabledBy).toBe(PLOT_ON.id);
    expect(PLOT_CADENCE.init).toEqual({ kind: 'literal', value: { everyNTurns: 4 } });
  });

  it('holds every init and an arc to its own schema, characterArc optional', () => {
    const validator = createValidator();
    for (const channel of PLOT_CHANNELS) {
      if (channel.init.kind !== 'literal') throw new Error(channel.id);
      expect(validator.validate(channel.schema, channel.init.value), channel.id).toBe(true);
    }
    expect(validator.validate(SECRET_PLOT.schema, ARC)).toBe(true);
    expect(validator.validate(SECRET_PLOT.schema, { ...ARC, characterArc: 'Vera' })).toBe(true);
    expect(validator.validate(SECRET_PLOT.schema, { description: 'x' })).toBe(false);
  });

  it('is a pre step writing the plot alone, warned on failure', () => {
    expect(PLOT_STEP).toMatchObject({
      id: 'se.scene.plot',
      stage: 'pre',
      writes: [SECRET_PLOT.id],
      contributes: 'effects',
      failure: 'warn',
    });
  });

  it('reaches the narrator through a channel slot among the system blocks, and no other call', () => {
    const slot = SCENE_PRESET.blocks.find((block) => block.id === 'se.plot.secret');
    expect(slot).toMatchObject({
      kind: 'slot',
      role: 'system',
      placement: { at: 'sequence' },
      appliesTo: ['narrate'],
      omitWhenEmpty: true,
      source: { of: 'channel', channelId: SECRET_PLOT.id },
    });
    // Before the history — with the system blocks, not in the chat.
    const at = (id: string): number => SCENE_PRESET.blocks.findIndex((block) => block.id === id);
    expect(at('se.plot.secret')).toBeLessThan(at('se.history'));
  });

  it('puts the switch under Agents and the reveal and the card in the panel', () => {
    expect(
      PLOT_SURFACES.map((one) => [one.region, one.group, one.channelId, one.widget.kind]),
    ).toEqual([
      ['settings', 'Agents', PLOT_ON.id, 'toggle'],
      ['settings', 'Agents', PLOT_CADENCE.id, 'record'],
      ['panel', 'Director', REVEAL.id, 'toggle'],
      ['panel', 'Director', SECRET_PLOT.id, 'record'],
    ]);
  });

  it('ships the push texts the director falls back on', () => {
    expect(SCENE_PRESET.pushDirections?.natural.length).toBeGreaterThan(0);
    expect(SCENE_PRESET.pushDirections?.random.length).toBeGreaterThan(0);
  });
});

describe('the pass', () => {
  it('costs nothing while switched off', async () => {
    const calls = host([ARC]);
    expect(await plot(input({}), calls)).toEqual({});
    expect(calls.asked).toHaveLength(0);
  });

  it('writes an arc at once when there is none, as a model’s judgement', async () => {
    const calls = host([ARC]);
    const result = await plot(input(ON, 1), calls);
    expect(calls.asked).toHaveLength(1);
    expect(calls.asked[0]?.schema).toBeDefined();
    expect(result.effects).toEqual([
      {
        channelId: SECRET_PLOT.id,
        op: { type: 'set', path: '/' },
        after: ARC,
        proposedBy: { kind: 'model', callId: 'c-plot-1' },
      },
    ]);
  });

  it('revisits a standing arc every fourth story turn, and the cadence is the session’s', async () => {
    const standing = { ...ON, [SECRET_PLOT.id]: state(ARC) };
    // Story turns 1..3 before this one: the fourth is due.
    expect((await plot(input(standing, 2), host([ARC]))).effects).toBeUndefined();
    const due = host([{ ...ARC, description: 'The Guild knows Ned asked.' }]);
    expect((await plot(input(standing, 3), due)).effects).toHaveLength(1);

    const every2 = { ...standing, [PLOT_CADENCE.id]: state({ everyNTurns: 2 }) };
    const often = host([ARC]);
    await plot(input(every2, 1), often);
    expect(often.asked).toHaveLength(1);
  });

  it('proposes nothing when the arc did not change', async () => {
    const standing = { ...ON, [SECRET_PLOT.id]: state(ARC) };
    expect(await plot(input(standing, 3), host([ARC]))).toEqual({});
  });

  it('follows a pass that completes the arc with a second, and writes both', async () => {
    const standing = { ...ON, [SECRET_PLOT.id]: state(ARC) };
    const next = {
      description: 'The Guild wants Ned for itself.',
      protagonistArc: '',
      completed: false,
    };
    const calls = host([{ ...ARC, completed: true }, next]);
    const result = await plot(input(standing, 3), calls);

    expect(calls.asked).toHaveLength(2);
    // The second pass is shown the arc that just resolved.
    expect(JSON.stringify(calls.asked[1]?.candidates)).toContain('\\"completed\\": true');
    expect(result.effects?.map((effect) => effect.after)).toEqual([
      { ...ARC, completed: true },
      next,
    ]);
  });

  it('keeps the completion when the follow-up fails, so the next turn is due', async () => {
    const standing = { ...ON, [SECRET_PLOT.id]: state(ARC) };
    const calls = host([{ ...ARC, completed: true }, new Error('timeout')]);
    const result = await plot(input(standing, 3), calls);
    expect(result.effects?.map((effect) => effect.after)).toEqual([{ ...ARC, completed: true }]);

    // A completed arc is due whatever the cadence says.
    const completed = { ...ON, [SECRET_PLOT.id]: state({ ...ARC, completed: true }) };
    const again = host([ARC]);
    await plot(input(completed, 0), again);
    expect(again.asked).toHaveLength(1);
  });

  it('does not swallow a Stop that lands on the follow-up', async () => {
    const standing = { ...ON, [SECRET_PLOT.id]: state(ARC) };
    const calls = host([{ ...ARC, completed: true }, new Error('cancelled')], true);
    await expect(plot(input(standing, 3), calls)).rejects.toThrow('cancelled');
  });

  it('fails the step on an answer that is not an arc, rather than proposing nothing', async () => {
    await expect(plot(input(ON), host([{ nonsense: true }]))).rejects.toThrow(/arc/u);
  });
});
