// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { createValidator } from '@storyengine/sdk';
import type {
  CastEntry,
  StepCallRequest,
  StepCallResult,
  StepHost,
  StepInput,
} from '@storyengine/sdk';

import {
  ECHO,
  ECHO_CADENCE,
  ECHO_CHANNELS,
  ECHO_ON,
  ECHO_STEP,
  ECHO_SURFACES,
  echo,
} from './echo.js';
import { SCENE_ID } from './mode.js';

/**
 * ***The echo chamber, held to [P14 §1.9.5]*** — [P14.5c]: *"a panel fed by a
 * cadence step, since it never touches the story. Off by default."*
 *
 * The claims: **off costs nothing**; **it never reaches a prompt** (no render,
 * no slot); **only present members react**, once each; **the cadence
 * decides**; **a malformed answer fails the step**.
 */

const NED: CastEntry = {
  actorId: 'a-ned',
  name: 'Ned',
  kind: 'actors',
  media: [],
  persona: true,
};
const VERA: CastEntry = { actorId: 'a-vera', name: 'Vera', kind: 'actors', media: [] };
const MARLOW: CastEntry = { actorId: 'a-marlow', name: 'Marlow', kind: 'actors', media: [] };
const MUTED: CastEntry = {
  actorId: 'a-ida',
  name: 'Ida',
  kind: 'actors',
  media: [],
  present: false,
};

function host(answers: readonly object[]): StepHost & { asked: StepCallRequest[] } {
  const asked: StepCallRequest[] = [];
  const call = (request: StepCallRequest): Promise<StepCallResult> => {
    const answer = answers[asked.length];
    asked.push(request);
    return Promise.resolve({
      callId: `c-echo-${String(asked.length)}`,
      text: JSON.stringify(answer),
      usage: null,
      ...(answer === undefined ? {} : { object: answer }),
    });
  };
  return { asked, call, signal: { aborted: false } } as unknown as StepHost & {
    asked: StepCallRequest[];
  };
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
    cast: [NED, VERA, MARLOW, MUTED],
    input: { actorId: null, kind: 'do', text: 'I slam the ledger shut.', raw: '' },
    output: { text: 'The harbourmaster flinched.' },
    transcript: Array.from({ length: storyTurns }, (_, at) => ({
      turnId: `t-${String(at)}`,
      output: { text: `Turn ${String(at)}.` },
    })),
  };
}

const ON = { [ECHO_ON.id]: state(true) };

describe('what is declared', () => {
  it('is off, owned by Scene, and reaches no prompt and no picture', () => {
    const validator = createValidator();
    for (const channel of ECHO_CHANNELS) {
      expect(channel.owner).toBe(SCENE_ID);
      if (channel.init.kind !== 'literal') throw new Error(channel.id);
      expect(validator.validate(channel.schema, channel.init.value), channel.id).toBe(true);
    }
    expect(ECHO_ON.init).toEqual({ kind: 'literal', value: false });
    // No render: the collector cannot place it and the picture digest skips it.
    expect(ECHO.render).toBeUndefined();
    expect(ECHO.state).toBeUndefined();
    expect(ECHO.enabledBy).toBe(ECHO_ON.id);
    expect(ECHO_STEP).toMatchObject({ stage: 'post', writes: [ECHO.id], failure: 'warn' });
    // The switch in settings under Agents; the chorus in the panel.
    expect(ECHO_SURFACES.map((one) => `${one.region}/${one.group ?? ''}`)).toEqual([
      'settings/Agents',
      'settings/Agents',
      'panel/Echo chamber',
    ]);
  });
});

describe('the pass', () => {
  it('costs nothing while it is off', async () => {
    const calls = host([]);
    expect(await echo(input({}), calls)).toEqual({});
    expect(calls.asked).toHaveLength(0);
  });

  it('keeps one reaction per present member, and nobody else’s', async () => {
    const calls = host([
      {
        reactions: [
          { characterName: 'vera', reaction: 'Finally.' },
          { characterName: 'Vera', reaction: 'Twice?' },
          { characterName: 'Ned', reaction: 'The player’s own.' },
          { characterName: 'Ida', reaction: 'Muted, so absent.' },
          { characterName: 'Stranger', reaction: 'Not in the scene.' },
          { characterName: 'Marlow', reaction: 'He will not like that.' },
        ],
      },
    ]);
    const result = await echo(input(ON), calls);
    expect(result.effects).toEqual([
      {
        channelId: ECHO.id,
        op: { type: 'set', path: '/' },
        after: [
          { name: 'Vera', value: 'Finally.' },
          { name: 'Marlow', value: 'He will not like that.' },
        ],
        proposedBy: { kind: 'model', callId: 'c-echo-1' },
      },
    ]);
    expect(calls.asked[0]?.candidates?.[1]?.text).toBe('Who may react: Vera, Marlow');
  });

  it('follows its cadence, in story turns', async () => {
    const every = { ...ON, [ECHO_CADENCE.id]: state({ everyNTurns: 3 }) };
    const calls = host([{ reactions: [] }]);
    expect(await echo(input(every, 0), calls)).toEqual({});
    expect(await echo(input(every, 1), calls)).toEqual({});
    expect(calls.asked).toHaveLength(0);
    // The third story turn: due, and a chorus with nothing to say writes nothing new.
    expect(await echo(input(every, 2), calls)).toEqual({});
    expect(calls.asked).toHaveLength(1);
  });

  it('fails on an answer that is not a list of reactions', async () => {
    await expect(echo(input(ON), host([{ said: 'x' }]))).rejects.toThrow(/reactions/);
  });
});
