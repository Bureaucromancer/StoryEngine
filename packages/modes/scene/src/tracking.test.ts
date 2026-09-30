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

import { SCENE_ID } from './mode.js';
import {
  CADENCE,
  CHARACTER,
  CUSTOM,
  HIDDEN,
  INVENTORY,
  LOCKS,
  TRACK_STEP,
  TRACKERS,
  TRACKING_CHANNELS,
  TRACKING_SURFACES,
  WORLD,
  track,
  trackerPath,
  writeBack,
} from './tracking.js';

/**
 * ***The trackers, held to [P14 §1.9.2]*** — [P14.5a].
 *
 * The step's claims, each with the mutation that would falsify it: **off costs
 * nothing** (no call until a person switches one on); **one call for every
 * tracker that is on**, whose schema is theirs side by side; **absent keeps**
 * (a group the model left out is the old group); **a lock holds** (written
 * back before proposing, so the model's other changes still land); **manual
 * means on demand only**; and the persona is the persona's tracker, never a
 * character's. The engine half — a swipe's own state, the prompt block, the
 * engine turn — is `turns/trackers.test.ts`, which runs the real pipeline.
 */

const VERA: CastEntry = { actorId: 'a-vera', name: 'Vera', kind: 'actors', media: [] };
const NED: CastEntry = {
  actorId: 'a-ned',
  name: 'Ned',
  kind: 'actors',
  media: [],
  persona: true,
};

/** A host that records what it was asked and answers as the test says — `staging.test.ts`'s, for its reasons. */
function host(object?: unknown): StepHost & { asked: StepCallRequest[] } {
  const asked: StepCallRequest[] = [];
  const call = (request: StepCallRequest): Promise<StepCallResult> => {
    asked.push(request);
    return Promise.resolve({
      callId: 'c-track',
      text: '',
      usage: null,
      ...(object === undefined ? {} : { object }),
    });
  };
  return { asked, call } as unknown as StepHost & { asked: StepCallRequest[] };
}

type Channels = StepInput['channels'];

function state(value: unknown): Channels[string] {
  return { value } as Channels[string];
}

/** The switches for these trackers on, and whatever else the test adds. */
function on(ids: readonly string[], more: Channels = {}): Channels {
  return {
    ...Object.fromEntries(ids.map((id) => [`${id}.on`, state(true)])),
    ...more,
  };
}

function input(channels: Channels, over: Partial<StepInput> = {}): StepInput {
  return {
    turnId: 't-new',
    sessionId: 's',
    parentTurnId: null,
    channels,
    cast: [NED, VERA],
    input: { actorId: null, kind: 'do', text: 'I follow her out.', raw: 'I follow her out.' },
    output: {
      text: 'Vera led the way down to the docks and pressed a cold iron key into your palm.',
    },
    transcript: [],
    ...over,
  };
}

const MOVED = {
  world: { location: 'the docks', weather: 'fog' },
  characters: { Vera: { mood: 'wary', outfit: 'oilskin coat' } },
  inventory: { inventory: [{ name: 'iron key', qty: 1 }] },
};

describe('what is declared', () => {
  it('declares six trackers, each off and each owned by Scene', () => {
    expect(TRACKERS.map((one) => one.channel.id)).toEqual([
      'se.track.world',
      'se.track.character',
      'se.track.persona',
      'se.track.quests',
      'se.track.inventory',
      'se.track.custom',
    ]);
    for (const one of TRACKERS) {
      // [00 §4]: opt-in, and a person's to switch.
      expect(one.toggle.init).toEqual({ kind: 'literal', value: false });
      expect(one.toggle.update).toBe('user-only');
      // A judgement about prose: a model proposes, and a person may edit.
      expect(one.channel.update).toBe('model-proposed');
      expect(one.channel.state).toMatchObject({
        label: expect.any(String),
        enabledBy: one.toggle.id,
      });
    }
    /**
     * ***The world's own date, time and place stand the pack's aside***
     * (2026-09-30) — `EstablishedState.supersedes`: two clocks that disagree
     * would be worse than either. Only the world's; the others say nothing the
     * clock or the place would.
     */
    expect(TRACKERS.map((one) => one.channel.state?.supersedes)).toEqual([
      ['se.clock', 'se.location'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // The one per-actor tracker, which is why the state slot exists at all.
    expect(CHARACTER.channel.scope).toBe('actor');
    // The spelling `tracking.ts` repeats rather than imports.
    for (const channel of TRACKING_CHANNELS) expect(channel.owner).toBe(SCENE_ID);
    expect([LOCKS.update, HIDDEN.update, CADENCE.update]).toEqual([
      'user-only',
      'user-only',
      'user-only',
    ]);
  });

  it('starts every tracker at a value its own schema admits', () => {
    // The quarantine ladder resets to `init`; an init the schema refused would
    // make every reset a second refusal.
    const validator = createValidator();
    for (const channel of TRACKING_CHANNELS) {
      if (channel.init.kind !== 'literal') throw new Error(channel.id);
      expect(validator.validate(channel.schema, channel.init.value), channel.id).toBe(true);
    }
  });

  it('may be run between turns, and writes only the trackers', () => {
    expect(TRACK_STEP.onDemand).toEqual({ label: 'Update trackers' });
    expect(TRACK_STEP.stage).toBe('post');
    expect(TRACK_STEP.contributes).toBe('effects');
    expect(TRACK_STEP.failure).toBe('warn');
    expect(TRACK_STEP.writes).toEqual(TRACKERS.map((one) => one.channel.id));
  });
});

/**
 * ***The cards and the switches*** — the client half of [P14.5a]. A card is a
 * `record` whose fields are declared rather than inferred, so the claim worth
 * holding is that every declared field is a property the channel's schema
 * actually has: a field naming nothing would be a row the host draws empty
 * forever and an edit written somewhere the schema then refuses.
 */
describe('where the trackers are shown', () => {
  it('gives every tracker a card whose fields its schema has, with locks and hiding', () => {
    for (const one of TRACKERS) {
      const card = TRACKING_SURFACES.find((surface) => surface.channelId === one.channel.id);
      if (card?.widget.kind !== 'record') throw new Error(one.channel.id);
      expect(card.region).toBe('panel');
      expect(card.widget.locks).toBe(LOCKS.id);
      expect(card.widget.hidden).toBe(HIDDEN.id);
      const schema = one.channel.schema as { type: string; properties?: Record<string, unknown> };
      for (const field of card.widget.fields) {
        if (field.key === '') expect(schema.type).toBe('array');
        else expect(Object.keys(schema.properties ?? {}), field.key).toContain(field.key);
      }
    }
  });

  it('puts each switch and the cadence in settings, under Agents', () => {
    const settings = TRACKING_SURFACES.filter((surface) => surface.region === 'settings');
    expect(settings.map((surface) => surface.channelId)).toEqual([
      ...TRACKERS.map((one) => one.toggle.id),
      CADENCE.id,
    ]);
    for (const surface of settings) expect(surface.group).toBe('Agents');
  });
});

describe('a turn with trackers on', () => {
  it('makes no call while every tracker is off', async () => {
    const asked = host(MOVED);
    expect(await track(input({}), asked)).toEqual({});
    expect(asked.asked).toHaveLength(0);
  });

  /**
   * ***P14.5a's first claim***: *"with world, character and inventory switched
   * on, a turn whose prose moves a character to the docks and hands the player
   * a key proposes all three"* — in **one** call.
   */
  it('proposes world, character and inventory from one call', async () => {
    const asked = host(MOVED);
    const result = await track(
      input(on([WORLD.channel.id, CHARACTER.channel.id, INVENTORY.channel.id])),
      asked,
    );

    expect(asked.asked).toHaveLength(1);
    const schema = asked.asked[0]?.schema as { properties: Record<string, unknown> };
    // The enabled channels' schemas, side by side — and nothing that is off.
    expect(Object.keys(schema.properties)).toEqual(['world', 'characters', 'inventory']);
    // The persona is not a character: it has its own tracker.
    expect(
      Object.keys((schema.properties['characters'] as { properties: object }).properties),
    ).toEqual(['Vera']);
    // Its own candidates: never the scene prompt.
    expect(asked.asked[0]?.candidates?.map((one) => one.id)).toEqual([
      'se.scene.track.task',
      'se.scene.track.state',
      'se.scene.track.turn',
    ]);
    expect(asked.asked[0]?.candidates?.at(-1)?.text).toContain('Ned: I follow her out.');

    const effects = result.effects ?? [];
    expect(effects.map((one) => [one.channelId, one.scopeKey ?? null])).toEqual([
      ['se.track.world', null],
      ['se.track.character', 'a-vera'],
      ['se.track.inventory', null],
    ]);
    for (const effect of effects) {
      expect(effect.proposedBy).toEqual({ kind: 'model', callId: 'c-track' });
      expect(effect.op).toEqual({ type: 'set', path: '/' });
    }
    // Whole values, every field present: what the model left out is the old
    // (here, the empty) value — *absent is not empty*.
    expect(effects[0]?.after).toEqual({
      date: '',
      time: '',
      location: 'the docks',
      weather: 'fog',
      temperature: '',
      fields: [],
      recent: [],
    });
    expect(effects[2]?.after).toEqual({
      currencies: [],
      equipped: [],
      inventory: [{ name: 'iron key', qty: 1 }],
    });
  });

  it('keeps a group the model left out', async () => {
    const standing = {
      currencies: [{ name: 'crowns', qty: 12 }],
      equipped: [{ name: 'lantern' }],
      inventory: [],
    };
    const result = await track(
      input(on([INVENTORY.channel.id], { 'se.track.inventory': state(standing) })),
      host({ inventory: { inventory: [{ name: 'iron key' }] } }),
    );
    expect(result.effects?.[0]?.after).toEqual({
      ...standing,
      inventory: [{ name: 'iron key' }],
    });
  });

  it('reads a blank world line as absent, keeping the stored one — Marinara’s `?? prev`', async () => {
    const standing = { ...(WORLD.empty as object), location: 'the docks', weather: 'fog' };
    const result = await track(
      input(on([WORLD.channel.id], { 'se.track.world': state(standing) })),
      host({ world: { location: '  ', weather: 'rain' } }),
    );
    expect(result.effects?.[0]?.after).toMatchObject({ location: 'the docks', weather: 'rain' });
  });

  it('proposes nothing for a tracker the answer leaves as it was', async () => {
    const result = await track(input(on([WORLD.channel.id])), host({ world: { location: '' } }));
    expect(result).toEqual({});
  });

  /** ***P14.5a's second claim***: *"a locked location stays put"*. */
  it('writes a locked field back, and lets the rest of the answer land', async () => {
    const standing = { ...(WORLD.empty as object), location: 'the harbourmaster’s office' };
    const result = await track(
      input(
        on([WORLD.channel.id], {
          'se.track.world': state(standing),
          'se.track.locks': state([trackerPath('se.track.world', 'location')]),
        }),
      ),
      host({ world: { location: 'the docks', weather: 'fog' } }),
    );
    expect(result.effects?.[0]?.after).toMatchObject({
      location: 'the harbourmaster’s office',
      weather: 'fog',
    });
  });

  it('does not show the model a hidden character field, and keeps it as it was', async () => {
    // Marinara's `compactGameStateForAgentContext`: hidden from the tracker
    // agents, kept for the narrator.
    const standing = {
      ...(CHARACTER.empty as object),
      mood: 'calm',
      thoughts: 'He knows about the key.',
    };
    const asked = host({ characters: { Vera: { mood: 'wary', thoughts: 'Nothing.' } } });
    const result = await track(
      input(
        on([CHARACTER.channel.id], {
          'se.track.character#a-vera': state(standing),
          'se.track.hidden': state([trackerPath('se.track.character#a-vera', 'thoughts')]),
        }),
      ),
      asked,
    );
    const shown = JSON.stringify(asked.asked[0]?.candidates);
    expect(shown).toContain('calm');
    expect(shown).not.toContain('He knows about the key.');
    expect(result.effects?.[0]?.after).toMatchObject({
      mood: 'wary',
      thoughts: 'He knows about the key.',
    });
  });

  it('fills only the custom fields a person named', async () => {
    const result = await track(
      input(
        on([CUSTOM.channel.id], {
          'se.track.custom': state([{ name: 'Suspicion', value: 'low' }]),
        }),
      ),
      host({ custom: { Suspicion: 'high' } }),
    );
    expect(result.effects?.[0]?.after).toEqual([{ name: 'Suspicion', value: 'high' }]);
  });

  it('fails, rather than shrugging, when the answer is not the shape', async () => {
    await expect(track(input(on([WORLD.channel.id])), host())).rejects.toThrow(/tracked state/);
  });
});

describe('when it runs', () => {
  it('runs on the session’s cadence, counted in story turns', async () => {
    const every2 = on([WORLD.channel.id], {
      'se.track.cadence': state({ everyNTurns: 2, manual: false }),
    });
    const turn = { turnId: 'x', output: { text: 'Earlier.' } };
    // One story turn before this one: this is the second, which is due.
    const due = host(MOVED);
    await track(input(every2, { transcript: [turn] }), due);
    expect(due.asked).toHaveLength(1);
    // None before it: the first, which is not.
    const early = host(MOVED);
    await track(input(every2, { transcript: [] }), early);
    expect(early.asked).toHaveLength(0);
  });

  it('runs only when asked, in manual mode', async () => {
    const manual = on([WORLD.channel.id], {
      'se.track.cadence': state({ everyNTurns: 1, manual: true }),
    });
    const turn = host(MOVED);
    expect(await track(input(manual), turn)).toEqual({});
    expect(turn.asked).toHaveLength(0);

    const asked = host(MOVED);
    const result = await track(input(manual, { onDemand: true }), asked);
    expect(asked.asked).toHaveLength(1);
    expect(result.effects?.[0]?.channelId).toBe('se.track.world');
  });
});

describe('the lock grammar', () => {
  it('addresses a row by name, and escapes a slash inside one', () => {
    expect(trackerPath('se.track.quests', 'Either/Or', 'completed')).toBe(
      'se.track.quests/Either~1Or/completed',
    );
    const was = [{ name: 'Either/Or', objectives: [], completed: false }];
    const proposed = [{ name: 'Either/Or', objectives: [], completed: true }];
    expect(
      writeBack(proposed, was, ['se.track.quests/Either~1Or/completed'], 'se.track.quests'),
    ).toEqual(was);
  });

  it('holds a quest’s `completed` and lets its objectives move — an imported quest-field lock', () => {
    // What the Marinara import writes for `quests.<q>.completed`: the field,
    // not the row, so the objectives nested in the quest still tick.
    const was = [
      { name: 'The mill', objectives: [{ text: 'Ask', completed: false }], completed: false },
    ];
    const proposed = [
      { name: 'The mill', objectives: [{ text: 'Ask', completed: true }], completed: true },
    ];
    expect(
      writeBack(proposed, was, ['se.track.quests/The mill/completed'], 'se.track.quests'),
    ).toEqual([
      { name: 'The mill', objectives: [{ text: 'Ask', completed: true }], completed: false },
    ]);
  });

  it('puts back a locked row the model dropped, and keeps out one the story never had', () => {
    const was = { currencies: [], equipped: [], inventory: [{ name: 'lantern' }] };
    const dropped = { currencies: [], equipped: [], inventory: [{ name: 'iron key' }] };
    expect(
      writeBack(dropped, was, ['se.track.inventory/inventory/lantern'], 'se.track.inventory'),
    ).toEqual({ ...dropped, inventory: [{ name: 'iron key' }, { name: 'lantern' }] });

    const invented = { ...was, inventory: [{ name: 'lantern' }, { name: 'vault key' }] };
    expect(
      writeBack(invented, was, ['se.track.inventory/inventory/vault key'], 'se.track.inventory'),
    ).toEqual(was);
  });

  it('locks one character without touching another', () => {
    const was = { mood: 'calm' };
    const lock = trackerPath('se.track.character#a-vera', 'mood');
    expect(writeBack({ mood: 'furious' }, was, [lock], 'se.track.character#a-lund')).toEqual({
      mood: 'furious',
    });
    expect(writeBack({ mood: 'furious' }, was, [lock], 'se.track.character#a-vera')).toEqual(was);
  });
});
