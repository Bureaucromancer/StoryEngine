// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { beforeEach, describe, expect, it } from 'vitest';

import {
  advance,
  channelKey,
  clockStart,
  readClock,
  SE_CLOCK,
  SE_LORE_TIMING,
} from '../sessions/channels.js';
import { readPacing, SE_HOOK_PACING } from '../sessions/hooks.js';
import { applyEffects } from '../sessions/store.js';
import type { ChannelState } from '../sessions/types.js';
import { installBuiltIns } from '../mode-loader.js';
import { acceptEffect, acceptStepEffect, type EffectProposal } from './effects.js';

/**
 * The engine decides, and records the decision either way — [22 §1.2].
 *
 * The claim under test is that `ChannelDefinition.update` finally means
 * something. It has been a declared field with no consumer since P2.3; a
 * channel that says *engine-computed* and then accepts a model's proposal is a
 * policy that exists only in a docstring.
 */

/**
 * **A function, not a constant, and the reason is the registry** — [P7.1].
 *
 * `clockStart()` reads Scene's declaration, and Scene is registered in the
 * `beforeEach` below. Evaluated at module scope this would run *before* that
 * and get the engine's no-mode fallback instead — which happens to be the same
 * value, so every test here would pass while asserting against the wrong
 * source. That is the shape of vacuous pass worth a function call to avoid.
 */
function atStart(): Record<string, ChannelState> {
  return { [SE_CLOCK]: { version: 1, value: clockStart() } };
}

function proposal(overrides: Partial<EffectProposal> = {}): EffectProposal {
  return {
    channelId: SE_CLOCK,
    op: { type: 'set', path: '/' },
    after: advance(clockStart(), 5),
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
    const effect = acceptEffect('t1', proposal(), atStart());

    expect(effect.applied).toBe(true);
    expect(effect.rejectedReason).toBeNull();
    expect(effect.before).toEqual(clockStart());
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
        atStart(),
      );

      expect(effect.applied).toBe(false);
      // The *which* policy, not one merged string — [P3.0]. `'update-policy'`
      // could not say whether the remedy was "the engine computes this" or
      // "only a person may change this", and those are different sentences.
      // ~~(The `'user-only'` reason gains a producer with the first user-only
      // channel; no shipped channel declares that policy yet.)~~ **It has one:
      // `se.hook.pacing`, at [P7.5] — see below.**
      expect(effect.rejectedReason).toBe('engine-computed');
      /**
       * ***And the record says what was wanted*** — corrected at [P7.2].
       *
       * This asserted `after` equalled the value already there, on the reasoning
       * that *"a replay that ignores `applied` still cannot move the clock"* —
       * belt and braces for a replay bug that does not exist, bought at the cost
       * of the record. [22 §1.2] justifies recording refusals with *"the model
       * tried to give itself forty gold and the engine said no"*, and the forty
       * gold was exactly what this pinned out of the record: the workbench
       * rendered `08:00 → 08:00` and said *Rejected* beside it.
       *
       * `applied` is what says whether it happened, and both readers — replay
       * and undo — skip an unapplied effect before touching `after`.
       */
      expect(effect.after).toEqual({ day: 1, hour: 0, minute: 0 });
      expect(effect.before).toEqual(clockStart());
      expect(readClock(applyEffects(atStart(), [effect]))).toEqual(clockStart());
    });
  }

  /**
   * **The other policy, and the first channel in the build that declares it** —
   * `se.hook.pacing` at [P7.5]. [P7 §1.4] recorded `update: 'user-only'` as
   * *"never exercised"*, and the note two tests up said the reason class had no
   * producer; both are discharged here.
   *
   * ***`engine` is refused too, which is what makes this policy different from
   * the one above rather than a stricter spelling of it.*** [06 §6.1] calls the
   * dial *author-facing*: how much authored plot a session pushes at a player is
   * a person's decision, and an engine that could adjust it is a selector able
   * to widen its own gate. So the refusal is *everything but a person*, and the
   * three refused proposers are the three there are.
   */
  for (const by of [
    { kind: 'model', callId: 'c1' },
    { kind: 'step', stepId: 'se.hooks.select' },
    { kind: 'engine' },
  ] as const) {
    it(`refuses a ${by.kind} proposal on the pacing dial, and records it`, () => {
      const effect = acceptEffect(
        't1',
        proposal({ channelId: SE_HOOK_PACING, after: 'aggressive', proposedBy: by }),
        { [SE_HOOK_PACING]: { version: 1, value: 'sparse' } },
      );

      expect(effect.applied).toBe(false);
      // The *which* policy, not one merged string: "only a person may change
      // this" is a different sentence from "the engine computes this", and a
      // client offering a remedy needs to know which one it is looking at.
      expect(effect.rejectedReason).toBe('user-only');
      // And what was wanted survives, for the reason the clock's test gives at
      // length: the record is what the workbench renders.
      expect(effect.after).toBe('aggressive');
      expect(
        readPacing(applyEffects({ [SE_HOOK_PACING]: { version: 1, value: 'sparse' } }, [effect])),
      ).toBe('sparse');
    });
  }

  it('lets a person turn the pacing dial', () => {
    const effect = acceptEffect(
      't1',
      proposal({
        channelId: SE_HOOK_PACING,
        after: 'aggressive',
        proposedBy: { kind: 'user' },
      }),
      { [SE_HOOK_PACING]: { version: 1, value: 'sparse' } },
    );

    expect(effect.applied).toBe(true);
    expect(effect.rejectedReason).toBeNull();
    // Through the reader a turn actually uses, rather than off the effect: the
    // dial's value is what the gate consults, and an effect the fold does not
    // land is a passing test about a channel nobody can turn.
    expect(
      readPacing(applyEffects({ [SE_HOOK_PACING]: { version: 1, value: 'sparse' } }, [effect])),
    ).toBe('aggressive');
  });

  it('records an unknown channel rather than failing the turn', () => {
    // A mode or extension that is not loaded may own it. A turn that died
    // because of an unrecognised id would be a worse outcome than a refusal
    // somebody can read.
    //
    // **An id from somebody else's namespace, and that is the point** ([P7.3]).
    // This said `se.party` until the channel was declared, at which point the
    // refusal moved from `unknown-channel` to `schema` and this test failed for
    // a reason that had nothing to do with what it is about. A planned-but-
    // unbuilt id is exactly the wrong fixture for *unknown*: it is scheduled to
    // stop being unknown. `se.` is this build's prefix, so nothing under it is
    // safe to borrow.
    const effect = acceptEffect(
      't1',
      proposal({ channelId: 'com.example.nobody/ledger', after: [] }),
      atStart(),
    );

    expect(effect.applied).toBe(false);
    expect(effect.rejectedReason).toBe('unknown-channel');
  });

  it('chains within a turn, so the second effect inverts to the first', () => {
    // `before` comes from the running map, not the pre-turn one. Two effects on
    // one channel in one turn have to chain, or the second's inverse restores a
    // value that was already superseded — and replay-from-zero then diverges
    // from the head snapshot.
    const first = acceptEffect('t1', proposal(), atStart());
    const running = applyEffects(atStart(), [first]);
    const second = acceptEffect('t1', proposal({ after: advance(clockStart(), 10) }), running);

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
      acceptEffect(
        't1',
        proposal({ op: { type: 'increment', path: '/minute', by: 5 } }),
        atStart(),
      ),
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

/**
 * **The `rejectedReason` cause [22 §1.2] lists first and nothing had ever
 * produced** — [P7.1].
 *
 * That field is documented as *"validation failure, an engine-computed rule
 * overriding a model proposal, or a policy refusal"*, and until
 * `ChannelDefinition` grew a `schema` the first of the three was unreachable:
 * policy refusals were the whole vocabulary.
 */
describe('a proposal is judged against the channel’s schema', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  it('refuses an impossible clock and keeps the value that was true', () => {
    // The refusal machinery is the same one the policies use, which is the
    // point: `before` is preserved as `after`, so the state does not move and
    // the attempt is in the record.
    const effect = acceptEffect(
      't1',
      proposal({ after: { day: 1, hour: 25, minute: 0 }, proposedBy: { kind: 'user' } }),
      atStart(),
    );

    expect(effect.applied).toBe(false);
    expect(effect.rejectedReason).toBe('schema');
    // The impossible value is in the record, and `before` is what was true —
    // which together are the whole sentence a workbench reader needs.
    expect(effect.after).toEqual({ day: 1, hour: 25, minute: 0 });
    expect(effect.before).toEqual(clockStart());
  });

  /**
   * **This is what stops a hand edit from poisoning the log**, which is the live
   * consequence rather than a hypothetical.
   *
   * [03 §8.1] makes editing `session.json` a supported way to get data in, and
   * `divergenceEffects` turns such an edit into a **user-attributed** effect —
   * so before this, `{"hour": 25}` typed into a file became an *applied* effect
   * and an impossible clock in the permanent record, replayed onto every branch
   * from that node. The posture is unchanged and the outcome is not: the edit is
   * still recorded, attributed and visible; it is answered rather than obeyed.
   */
  it('refuses it from a person too, because a file is where it comes from', () => {
    const effect = acceptEffect(
      't1',
      proposal({ after: { day: 1, hour: 99, minute: 0 }, proposedBy: { kind: 'user' } }),
      atStart(),
    );

    expect(effect.proposedBy).toEqual({ kind: 'user' });
    expect(effect.applied).toBe(false);
    expect(effect.rejectedReason).toBe('schema');
  });

  it('prefers the policy reason when both would refuse, and that is the useful sentence', () => {
    // A model proposing a malformed value to a channel it may not touch gets
    // `engine-computed`. *Who may write* is the more useful answer, because the
    // remedies differ: a policy refusal was never going to land however it was
    // shaped, a schema refusal nearly did.
    const effect = acceptEffect(
      't1',
      proposal({
        after: { day: 1, hour: 25, minute: 0 },
        proposedBy: { kind: 'model', callId: 'c1' },
      }),
      atStart(),
    );

    expect(effect.rejectedReason).toBe('engine-computed');
  });

  it('still applies a well-formed proposal, so the check is not a wall', () => {
    const effect = acceptEffect(
      't1',
      proposal({ after: { day: 2, hour: 0, minute: 0 }, proposedBy: { kind: 'engine' } }),
      atStart(),
    );

    expect(effect.applied).toBe(true);
    expect(effect.rejectedReason).toBeNull();
  });
});

/**
 * ***A step's proposal, held to what the step declared*** (2026-09-30) —
 * `acceptStepEffect`. The channel's policy read the proposal's own stamp, and
 * nothing held the channel or the stamp to the step: a step could write what
 * it never declared, and stamp itself a person (which `user-only` admits) or
 * the engine (which `engine-computed` does).
 */
describe('a step’s proposal is held to its declaration', () => {
  beforeEach(async () => {
    await installBuiltIns();
  });

  const claim = { id: 'example.step', writes: [SE_HOOK_PACING], calls: new Set(['call-1']) };
  const pacing = (proposedBy: EffectProposal['proposedBy']): EffectProposal => ({
    channelId: SE_HOOK_PACING,
    op: { type: 'set', path: '/' },
    after: 'aggressive',
    proposedBy,
  });

  it('refuses a person’s stamp, and records the step as the one who proposed', () => {
    const effect = acceptStepEffect('t1', pacing({ kind: 'user' }), {}, claim);

    expect(effect.applied).toBe(false);
    expect(effect.rejectedReason).toBe('not-its-proposer');
    expect(effect.proposedBy).toEqual({ kind: 'step', stepId: 'example.step' });
    // What it tried is kept, as every refusal keeps it ([22 §1.2]).
    expect(effect.after).toBe('aggressive');
  });

  it('refuses the engine’s stamp, another step’s, and a call it did not make', () => {
    for (const forged of [
      { kind: 'engine' },
      { kind: 'step', stepId: 'another.step' },
      { kind: 'model', callId: 'call-of-another' },
    ] as const) {
      const effect = acceptStepEffect('t1', pacing(forged), {}, claim);
      expect(effect.rejectedReason, forged.kind).toBe('not-its-proposer');
      expect(effect.applied, forged.kind).toBe(false);
    }
  });

  it('refuses a channel outside what it declared it writes', () => {
    const effect = acceptStepEffect(
      't1',
      proposal({ proposedBy: { kind: 'model', callId: 'call-1' } }),
      atStart(),
      claim,
    );

    expect(effect.rejectedReason).toBe('undeclared-write');
    expect(effect.applied).toBe(false);
  });

  it('leaves its own proposals to the channel’s policy', () => {
    // Its own stamps: the channel decides, as it always has — and `user-only`
    // refuses a step even when the step is honest about being one.
    expect(
      acceptStepEffect('t1', pacing({ kind: 'model', callId: 'call-1' }), {}, claim),
    ).toMatchObject({ applied: false, rejectedReason: 'user-only' });
    expect(
      acceptStepEffect('t1', pacing({ kind: 'step', stepId: 'example.step' }), {}, claim),
    ).toMatchObject({ applied: false, rejectedReason: 'user-only' });

    const lore = acceptStepEffect(
      't1',
      {
        channelId: SE_LORE_TIMING,
        scopeKey: 'e-1',
        op: { type: 'set', path: '/' },
        after: { sticky: 0, cooldown: 0, fired: 1 },
        proposedBy: { kind: 'step', stepId: 'example.step' },
      },
      {},
      { ...claim, writes: [SE_LORE_TIMING] },
    );
    expect(lore.rejectedReason).toBe('engine-computed');
  });
});
