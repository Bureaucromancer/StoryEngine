// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { newActor, type Actor } from '@storyengine/shared';
import { describe, expect, it } from 'vitest';

import { castEntries } from './runner.js';

/**
 * ***Who a step is told is in the room*** — `castEntries`, the host's one
 * reading for every step that declares `cast`.
 *
 * *Written out is out of the room* (2026-09-30), under either reading of
 * presence: [06 §8.1]'s cast is who is in the scene, and the render step drew
 * the dead and the departed with everybody else, as the chorus and the
 * trackers would have spoken for them. The persona is the player's and stays.
 */

function member(name: string): { actor: Actor; contentHash: string } {
  return { actor: newActor(name), contentHash: `sha256:${name}` };
}

const persona = member('Ned');
const vera = member('Vera');
const marlow = member('Marlow');
const lund = member('Lund');

function outOfTheRoom(
  channels: Record<string, { value: unknown }>,
  castIsPresent: boolean,
): string[] {
  return castEntries(
    {
      persona,
      actors: [vera.actor, marlow.actor, lund.actor].map((actor) => ({ actor, contentHash: 'h' })),
    },
    { channels, castIsPresent },
  )
    .filter((entry) => entry.present === false)
    .map((entry) => entry.name);
}

describe('who is out of the room', () => {
  it('is somebody the story has killed or seen off, under either reading of presence', () => {
    const channels = {
      [`se.status#${marlow.actor.id}`]: { value: 'dead' },
      [`se.status#${lund.actor.id}`]: { value: 'departed' },
      [`se.status#${persona.actor.id}`]: { value: 'dead' },
    };
    expect(outOfTheRoom(channels, false)).toEqual(['Marlow', 'Lund']);
    expect(outOfTheRoom(channels, true)).toEqual(['Marlow', 'Lund']);
  });

  it('is a muted member only where the mode reads presence', () => {
    const channels = { [`se.presence#${vera.actor.id}`]: { value: false } };
    expect(outOfTheRoom(channels, true)).toEqual(['Vera']);
    expect(outOfTheRoom(channels, false)).toEqual([]);
  });

  it('is nobody for a caller that reads no scene', () => {
    const entries = castEntries({ persona: null, actors: [marlow] });
    expect(entries.map((entry) => entry.present)).toEqual([undefined]);
  });
});
