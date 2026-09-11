// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import {
  advance,
  channelKey,
  CLOCK_START,
  readClock,
  SE_CLOCK,
  SE_LORE_TIMING,
} from '../sessions/channels.js';
import { applyEffects } from '../sessions/store.js';
import type { ChannelState } from '../sessions/types.js';
import { installBuiltIns } from '../mode-loader.js';
import { acceptEffect, type EffectProposal } from './effects.js';

/**
 * The engine decides, and records the decision either way — [21 §1.2].
 *
 * The claim under test is that `ChannelDefinition.update` finally means
 * something. It has been a declared field with no consumer since P2.3; a
 * channel that says *engine-computed* and then accepts a model's proposal is a
 * policy that exists only in a docstring.
 */

const RUNNING: Record<string, ChannelState> = {
  [SE_CLOCK]: { version: 1, value: CLOCK_START },
};

function proposal(overrides: Partial<EffectProposal> = {}): EffectProposal {
  return {
    channelId: SE_CLOCK,
    op: { type: 'set', path: '/' },
    after: advance(CLOCK_START, 5),
    proposedBy: { kind: 'engine' },
    ...overrides,
  };
}

describe('a proposal is judged against the channel that owns it', () => {
  // Channels are registered rather than frozen into the engine since [P7.0], so
  // a test that needs one asks for the built-ins the way `buildServices` does.
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('applies an engine proposal to an engine-computed channel', () => {
    const effect = acceptEffect('t1', proposal(), RUNNING);

    expect(effect.applied).toBe(true);
    expect(effect.rejectedReason).toBeNull();
    expect(effect.before).toEqual(CLOCK_START);
    expect(effect.after).toEqual({ day: 1, hour: 8, minute: 5 });
  });

  for (const by of ['model', 'step'] as const) {
    it(`refuses a ${by} proposal on an engine-computed channel, and records it`, () => {
      // The model deciding it is suddenly midnight. Recorded as having tried —
      // dropping it would leave the workbench unable to say why nothing
      // happened ([00 §3.3]).
      const effect = acceptEffect(
        't1',
        proposal({
          after: { day: 1, hour: 0, minute: 0 },
          proposedBy:
            by === 'model' ? { kind: 'model', callId: 'c1' } : { kind: 'step', stepId: 's' },
        }),
        RUNNING,
      );

      expect(effect.applied).toBe(false);
      // The *which* policy, not one merged string — [P3.0]. `'update-policy'`
      // could not say whether the remedy was "the engine computes this" or
      // "only a person may change this", and those are different sentences.
      // (The `'user-only'` reason gains a producer with the first user-only
      // channel; no shipped channel declares that policy yet.)
      expect(effect.rejectedReason).toBe('engine-computed');
      // And it changes nothing: `after` is the value that was already there, so
      // a replay that ignores `applied` still cannot move the clock.
      expect(effect.after).toEqual(CLOCK_START);
      expect(readClock(applyEffects(RUNNING, [effect]))).toEqual(CLOCK_START);
    });
  }

  it('records an unknown channel rather than failing the turn', () => {
    // A mode or extension that is not loaded may own it. A turn that died
    // because of an unrecognised id would be a worse outcome than a refusal
    // somebody can read.
    const effect = acceptEffect('t1', proposal({ channelId: 'se.party', after: [] }), RUNNING);

    expect(effect.applied).toBe(false);
    expect(effect.rejectedReason).toBe('unknown-channel');
  });

  it('chains within a turn, so the second effect inverts to the first', () => {
    // `before` comes from the running map, not the pre-turn one. Two effects on
    // one channel in one turn have to chain, or the second's inverse restores a
    // value that was already superseded — and replay-from-zero then diverges
    // from the head snapshot.
    const first = acceptEffect('t1', proposal(), RUNNING);
    const running = applyEffects(RUNNING, [first]);
    const second = acceptEffect('t1', proposal({ after: advance(CLOCK_START, 10) }), running);

    expect(second.before).toEqual({ day: 1, hour: 8, minute: 5 });

    // Undoing the tip is applying `before` — and it lands on the first
    // effect's value, not on the start of the turn.
    const undone = applyEffects(applyEffects(running, [second]), [
      { ...second, before: second.after, after: second.before },
    ]);
    expect(readClock(undone)).toEqual({ day: 1, hour: 8, minute: 5 });
  });

  it('refuses an op the applier cannot honour, as a programmer error', () => {
    // `applyEffects` replaces the whole channel value with `after` and reads
    // `op.path` for nothing but `delete`, so an increment carrying a sub-value
    // would silently clobber the channel. Better to be unable to write it.
    expect(() =>
      acceptEffect('t1', proposal({ op: { type: 'increment', path: '/minute', by: 5 } }), RUNNING),
    ).toThrow(/whole-value set/);
  });
});

/**
 * **A scoped effect's `before` is that scope's previous value**, which is the
 * half of P5.5's key widening that only shows up later.
 *
 * `before` is the inverse an undo replays ([P6 §1.4]), so reading it from the
 * unscoped key would not be a wrong number on a screen — it would be a restore
 * that put one entry's timing back onto another. The mistake is invisible until
 * somebody rewinds, which is exactly why it is asserted here rather than left
 * to the stage that will rely on it.
 */
describe('a proposal on a scoped channel', () => {
  const RUNNING_SCOPED: Record<string, ChannelState> = {
    [channelKey(SE_LORE_TIMING, 'entry-a')]: { version: 1, value: { sticky: 2 } },
    [channelKey(SE_LORE_TIMING, 'entry-b')]: { version: 1, value: { sticky: 9 } },
  };

  function timingProposal(scopeKey: string): EffectProposal {
    return {
      channelId: SE_LORE_TIMING,
      scopeKey,
      op: { type: 'set', path: '/' },
      after: { sticky: 1 },
      proposedBy: { kind: 'engine' },
    };
  }

  it('takes its inverse from its own scope, not from the channel', () => {
    expect(acceptEffect('t-1', timingProposal('entry-a'), RUNNING_SCOPED).before).toEqual({
      sticky: 2,
    });
    expect(acceptEffect('t-1', timingProposal('entry-b'), RUNNING_SCOPED).before).toEqual({
      sticky: 9,
    });
  });

  it('has no inverse for a scope nothing has written yet', () => {
    expect(acceptEffect('t-1', timingProposal('entry-new'), RUNNING_SCOPED).before).toBeNull();
  });

  it('carries the scope key onto the effect, so replay can key on it', () => {
    expect(acceptEffect('t-1', timingProposal('entry-a'), RUNNING_SCOPED).scopeKey).toBe('entry-a');
  });
});
