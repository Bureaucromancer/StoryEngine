// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import type { BlockSource } from '@storyengine/shared';

import { blockSourceAddress } from './address.js';

/**
 * Gate step 4's *"no `unknown` sources on an ordinary turn"*, made
 * assertable: one source per arm of the vocabulary, each yielding a real
 * label, with the two linkable arms yielding the actor's address. A node
 * -project file on purpose — this is a pure mapping, and the `Link` that
 * spends the address is `BlockTable`'s to test.
 *
 * Falsifying mutations: delete a `SOURCE_LABELS` entry (its arm falls back
 * to the raw kind and the label assertion names it), or drop the persona
 * link arm (the persona-with-id case loses its address).
 */

const EVERY_ARM: BlockSource[] = [
  { kind: 'persona', actorId: 'a-1', contentHash: 'sha256:x' },
  { kind: 'persona', actorId: null, contentHash: null },
  { kind: 'actor', actorId: 'a-2', contentHash: 'sha256:y' },
  { kind: 'lore', entryId: 'e-1', phase: 'before' },
  { kind: 'history', turnId: 't-1', range: [0, 0], part: 'input' },
  {
    kind: 'samples',
    owner: { kind: 'actor', id: 'a-3', contentHash: 'sha256:z' },
    sampleId: 's-1',
  },
  {
    kind: 'samples',
    owner: { kind: 'treatment', id: 'tr-1', contentHash: 'sha256:w' },
    sampleId: 's-2',
  },
  { kind: 'channel', channelId: 'se.clock' },
  { kind: 'setting', part: 'framing' },
  { kind: 'goal', goalId: 'g-1' },
  { kind: 'guidance', producer: 'user' },
  { kind: 'input' },
  { kind: 'preset', blockId: 'b-1' },
  { kind: 'step', stepId: 's-1' },
];

describe('every source has an address', () => {
  it('yields a real label for every arm of the vocabulary', () => {
    for (const source of EVERY_ARM) {
      const address = blockSourceAddress(source);
      expect(address.label.length, `no label for ${source.kind}`).toBeGreaterThan(0);
      // A label, not the raw kind leaking through: the fallback is for
      // records from newer builds, never for the arms this build knows.
      expect(address.label, `raw kind leaked for ${source.kind}`).not.toBe(source.kind);
    }
  });

  it('links the actor, and the persona that has one', () => {
    expect(
      blockSourceAddress({ kind: 'actor', actorId: 'a-2', contentHash: 'sha256:y' }).link,
    ).toEqual({ kind: 'actors', id: 'a-2' });
    expect(
      blockSourceAddress({ kind: 'persona', actorId: 'a-1', contentHash: 'sha256:x' }).link,
    ).toEqual({ kind: 'actors', id: 'a-1' });
    // A session without a persona has nothing to click through to.
    expect(
      blockSourceAddress({ kind: 'persona', actorId: null, contentHash: null }).link,
    ).toBeUndefined();
  });

  it('labels a source kind from a newer build with the word itself', () => {
    const foreign = { kind: 'weather' } as unknown as BlockSource;
    expect(blockSourceAddress(foreign).label).toBe('weather');
  });
});
