// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import {
  actorsWithState,
  introducedOn,
  isTerminal,
  readPresence,
  readStatus,
  SE_PRESENCE,
  SE_STATUS,
} from './cast.js';
import { channelDefinition, channelKey } from './channels.js';
import { installBuiltIns } from '../mode-loader.js';
import { acceptEffect } from '../turns/effects.js';
import type { ChannelEffect, ChannelState, Turn } from './types.js';

/**
 * Presence, status, and *introduced* — [06 §8.1], [10 §13.2], [P7.2].
 *
 * **`scope: 'actor'` gets its first writer here**, which P7.2's own cell names:
 * the scoped-key machinery P5.5 built and P6 property-tested has been proved by
 * `scope: 'entry'` alone, so the arm stops being a declaration the moment two
 * actors hold different values without overwriting each other.
 */

function turn(effects: Partial<ChannelEffect>[]): Turn {
  return {
    id: 't',
    sessionId: 's',
    parentTurnId: null,
    createdAt: '2026-09-11T00:00:00.000Z',
    status: 'complete',
    tape: [],
    effects: effects.map((over, index) => ({
      id: `e${String(index)}`,
      turnId: 't',
      channelId: SE_PRESENCE,
      scopeKey: null,
      op: { type: 'set', path: '/' },
      before: null,
      after: true,
      proposedBy: { kind: 'model', callId: 'c1' },
      applied: true,
      rejectedReason: null,
      supersedes: null,
      channelVersion: 1,
      scope: 'session',
      ...over,
    })),
  };
}

describe('the two axes', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('registers both, per actor, owned by a package rather than a mode', () => {
    // Every mode with a cast wants these and none of them is Scene's in
    // particular. [06 §4.1] admits a package id as an `owner` for exactly this,
    // and `se.lore.timing` is the precedent.
    expect(channelDefinition(SE_PRESENCE)?.scope).toBe('actor');
    expect(channelDefinition(SE_STATUS)?.scope).toBe('actor');
    expect(channelDefinition(SE_PRESENCE)?.owner).toBe('storyengine.cast');
  });

  it('keeps two actors apart, which is what `scope: "actor"` had never proved', () => {
    const channels: Record<string, ChannelState> = {
      [channelKey(SE_PRESENCE, 'vera')]: { version: 1, value: true },
      [channelKey(SE_PRESENCE, 'ned')]: { version: 1, value: false },
      [channelKey(SE_STATUS, 'vera')]: { version: 1, value: 'dead' },
    };

    expect(readPresence(channels, 'vera')).toBe(true);
    expect(readPresence(channels, 'ned')).toBe(false);
    expect(readStatus(channels, 'vera')).toBe('dead');
    // Ned's status was never written, and the declaration's init is what a
    // reader falls back to — the same read-time default `readClock` uses.
    expect(readStatus(channels, 'ned')).toBe('alive');
  });

  it('says dead-but-present, which one enum cannot', () => {
    // The body in the room, the ghost, the open casket — [10 §13.2]'s reason for
    // splitting the axes, as an assertion rather than a sentence.
    const channels: Record<string, ChannelState> = {
      [channelKey(SE_PRESENCE, 'vera')]: { version: 1, value: true },
      [channelKey(SE_STATUS, 'vera')]: { version: 1, value: 'dead' },
    };

    expect(readPresence(channels, 'vera')).toBe(true);
    expect(readStatus(channels, 'vera')).toBe('dead');
  });

  it('treats absent as absent, so the cast is not in every room', () => {
    expect(readPresence({}, 'vera')).toBe(false);
  });

  it('names the statuses a story does not come back from', () => {
    // *"Must carry no terminal status"* — [06 §6.1]'s hook filter, which has
    // been spending the word since it was written.
    expect(isTerminal('dead')).toBe(true);
    expect(isTerminal('departed')).toBe(true);
    expect(isTerminal('alive')).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
  });

  it('collects every actor the channels say anything about', () => {
    expect(
      [
        ...actorsWithState({
          [channelKey(SE_PRESENCE, 'vera')]: { value: true },
          [channelKey(SE_STATUS, 'ned')]: { value: 'alive' },
          'se.clock': { value: {} },
        }),
      ].sort(),
    ).toEqual(['ned', 'vera']);
  });
});

describe('a model may not kill somebody on its own', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  const proposal = (after: unknown, by: ChannelEffect['proposedBy']) => ({
    channelId: SE_STATUS,
    scopeKey: 'vera',
    op: { type: 'set' as const, path: '/' },
    after,
    proposedBy: by,
  });

  it('refuses a terminal status from the model, and records the attempt', () => {
    // **The asymmetry** — [06 §8.1], [25 C12]. A missed death is corrected in a
    // click; a false one silently removes somebody from every subsequent
    // assembly. So the model is under-fired and the attempt stays in the record.
    const effect = acceptEffect('t1', proposal('dead', { kind: 'model', callId: 'c1' }), {});

    expect(effect.applied).toBe(false);
    expect(effect.rejectedReason).toBe('needs-confirmation');
  });

  it('refuses `departed` too, because the harm is identical', () => {
    // A character wrongly written out is assembled around the same way as one
    // wrongly killed, and the click that corrects it is the same click.
    const effect = acceptEffect('t1', proposal('departed', { kind: 'step', stepId: 's' }), {});

    expect(effect.rejectedReason).toBe('needs-confirmation');
  });

  it('lets the model say somebody is alive, so it is not a wall', () => {
    const effect = acceptEffect('t1', proposal('alive', { kind: 'model', callId: 'c1' }), {});

    expect(effect.applied).toBe(true);
  });

  it('lets a person do it, which is the always-available manual path', () => {
    // 25 C12: *"Under-firing plus always-available manual completion is the
    // position regardless."* The channel write route is that path.
    const effect = acceptEffect('t1', proposal('dead', { kind: 'user' }), {});

    expect(effect.applied).toBe(true);
    expect(effect.rejectedReason).toBeNull();
  });

  it('answers needs-confirmation before schema, because it is the useful sentence', () => {
    // A proposal that is both loaded and malformed is more usefully answered as
    // the first: *this one needs a person* has a next step, and `schema` on a
    // value the model was never going to be allowed to set sends somebody
    // looking for a typo.
    const effect = acceptEffect('t1', proposal('dead', { kind: 'model', callId: 'c1' }), {});
    const malformed = acceptEffect('t1', proposal('vanished', { kind: 'model', callId: 'c1' }), {});

    expect(effect.rejectedReason).toBe('needs-confirmation');
    // Not in `confirm`, so the schema is what refuses it.
    expect(malformed.rejectedReason).toBe('schema');
  });
});

describe('introduced', () => {
  it('is acquired by a presence effect and never lost along the path', () => {
    // *"This actor has been the subject of a presence or party effect at some
    // point on the path to this node"* — monotone, so it can only be acquired.
    const path = [
      turn([{ scopeKey: 'vera', after: true }]),
      turn([{ scopeKey: 'vera', after: false }]),
    ];

    expect([...introducedOn(path)]).toEqual(['vera']);
  });

  it('is not presence, which is the distinction the definition exists for', () => {
    // A character introduced in chapter one and absent since reads `false` for
    // presence and is emphatically not *never introduced*.
    const path = [turn([{ scopeKey: 'vera', after: false }])];

    expect(introducedOn(path).has('vera')).toBe(true);
    expect(readPresence({}, 'vera')).toBe(false);
  });

  it('un-introduces on a rewind, for free', () => {
    // The property 8.1 calls out: *"rewind past a character's arrival and they
    // are un-introduced again, which is what anyone would expect and would
    // otherwise have had to be built."* A shorter path is the whole mechanism.
    const arrival = turn([{ scopeKey: 'vera', after: true }]);

    expect(introducedOn([arrival]).has('vera')).toBe(true);
    expect(introducedOn([]).has('vera')).toBe(false);
  });

  it('is not acquired by a refused proposal', () => {
    // A character is not introduced by something that did not happen.
    const path = [turn([{ scopeKey: 'vera', applied: false, rejectedReason: 'schema' }])];

    expect(introducedOn(path).has('vera')).toBe(false);
  });

  it('ignores effects on other channels', () => {
    const path = [turn([{ channelId: 'se.clock', scopeKey: null, after: { day: 1 } }])];

    expect([...introducedOn(path)]).toEqual([]);
  });

  it('counts a party effect, which is named before the channel exists', () => {
    // The definition says *presence or party*, and a list that omitted the
    // second would be a definition quietly narrowed to what happened to be
    // built. `se.party` waits on P7.3's policy; this does not.
    const path = [turn([{ channelId: 'se.party', scopeKey: 'ned', after: {} }])];

    expect([...introducedOn(path)]).toEqual(['ned']);
  });
});
