// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { validate } from '@storyengine/shared';

import { callPurposeFor } from '../../turns/steps.js';
import { CHANNELS } from '../../sessions/channels.js';
import { assertModesRunnable, BUILT_IN_MODES, DEFAULT_MODE_ID, planFor } from '../registry.js';
import { NARRATE, SCENE, SCENE_ID, SCENE_MODE } from './mode.js';
import { SCENE_PRESET } from './preset.js';

/**
 * Scene, held to what it claims — [03 §2], [P2 §2.4].
 *
 * Two of these matter more than the rest. **The preset is a real portable
 * object**, validated by the same validator a user's write goes through — which
 * is what caught `SlotSource` missing the `guidance` arm that [03 §5.1] requires
 * a preset to be able to position. And **the mode is data**: a manifest with a
 * function on it would be the back door §2 says means the contract is wrong.
 */

describe('the manifest is data', () => {
  it('survives a round trip through JSON with nothing lost', () => {
    // The P7 relocation is a move rather than a rewrite exactly to the extent
    // this holds: anything that did not survive here is something that cannot
    // cross a worker boundary.
    expect(JSON.parse(JSON.stringify(SCENE))).toEqual(SCENE);
  });

  it('carries no function on any field', () => {
    // `collect()` on an AssemblyPlan is the specific back door [03 §5] rules
    // out — it would also mean the collector P4 needs for imported presets is a
    // second implementation of the same thing.
    const walk = (value: unknown, path: string): void => {
      expect(typeof value, `${path} is a function`).not.toBe('function');
      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          walk(item, `${path}[${String(i)}]`);
        });
      }
      if (!Array.isArray(value) && value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      }
    };
    walk(SCENE, 'SCENE');
  });

  it('keeps what it runs separate from what it declares', () => {
    // [12 §3]'s split: `definition` crosses any boundary unchanged, `run` is
    // what becomes a dispatch table.
    expect(Object.keys(SCENE_MODE.run)).toEqual([NARRATE.id]);
    expect(SCENE_MODE.definition).toBe(SCENE);
  });
});

describe('the default preset is a real portable object', () => {
  it('validates through the shared registry', () => {
    // Not "looks like a preset" — the actual validator, the actual schema.
    const result = validate(SCENE_PRESET);
    expect(result.valid, JSON.stringify(result.valid ? [] : result.issues)).toBe(true);
  });

  it('positions the guidance block, which is the whole point of the slot', () => {
    // [03 §5.1] says the guidance block is positioned by the preset. Until the
    // `SlotSource` fix this line could not be written: the schema had no
    // `guidance` arm, so this preset would not have validated above.
    const guidance = SCENE_PRESET.blocks.find(
      (block) => block.kind === 'slot' && block.source.of === 'guidance',
    );
    expect(guidance).toBeDefined();
    // Advisory in the pack as well as forced by the collector — an author
    // reading the preset should see the claim, not just inherit it.
    expect(guidance?.advisory).toBe(true);
  });

  it('positions the previous attempt after the guidance, advisory, and ranked below it', () => {
    // [03 §5.1]'s second advisory slot, the one a guided redo fills. Three
    // claims, each with its own falsifying mutation.
    const blocks = SCENE_PRESET.blocks;
    const at = (of: string): number =>
      blocks.findIndex((block) => block.kind === 'slot' && block.source.of === of);
    const attempt = blocks[at('attempt')];
    expect(attempt?.kind).toBe('slot');
    if (attempt?.kind !== 'slot') return;

    // Advisory in the pack, as guidance is, so an author sees the claim.
    expect(attempt.advisory).toBe(true);
    expect(attempt.omitWhenEmpty).toBe(true);
    expect(attempt.role).toBe('system');

    // **A wrapper, and one that frames.** Bare, the slot is a system message
    // holding prose the model itself wrote, with nothing to say it is a
    // discarded draft — dropping the wrapper is the mutation this catches.
    expect(attempt.wrapper).toContain('{{content}}');
    expect(attempt.wrapper?.replace('{{content}}', '').trim().length).toBeGreaterThan(0);

    // **Directly after the guidance.** `render` merges adjacent same-role
    // blocks and the guidance slot has no wrapper, so the other order would
    // hand a provider the instruction as the last line of the attempt's prose.
    expect(at('attempt')).toBe(at('guidance') + 1);

    // **Below the instruction in the order of sacrifice**, as a relationship
    // rather than a number: a squeezed redo drops the reply it is discarding
    // before the instruction about it.
    const priorityOf = (of: string): number | undefined => blocks[at(of)]?.priority;
    expect(priorityOf('attempt')).toBeLessThan(priorityOf('guidance') ?? 0);
  });

  it('positions the player action, and nothing else is a user-role block', () => {
    const user = SCENE_PRESET.blocks.filter((block) => block.role === 'user');
    expect(user).toHaveLength(1);
    expect(user[0]?.kind === 'slot' && user[0].source.of).toBe('input');
  });

  it('is deterministic, so a golden snapshot over it means something', () => {
    // `newPreset()` would mint a fresh uuid and stamp `now()` per process.
    expect(SCENE_PRESET.id).toBe('0199c000-0000-7000-8000-00000000e5e7');
    expect(SCENE_PRESET.provenance.createdAt).toBe(SCENE_PRESET.provenance.updatedAt);
  });

  it('ranks writing samples above history and below lore', () => {
    // [10 §3.1]. The constant is the whole behaviour of the feature under
    // pressure, and it is not self-evident: history is emitted at
    // `priority + index` across the window, so this preset's history spans
    // 10..29 rather than sitting at its declared 10. A sample at 20 therefore
    // outlives the oldest turns and dies before the newest, and before lore.
    //
    // Asserted as a *relationship* rather than a bare 20, so re-tuning the
    // scale stays free and only changing the order of sacrifice trips it.
    const priorityOf = (of: string): number | undefined =>
      SCENE_PRESET.blocks.find((block) => block.kind === 'slot' && block.source.of === of)
        ?.priority;

    const samples = priorityOf('samples');
    expect(samples).toBeDefined();
    expect(samples).toBeGreaterThan(priorityOf('history') ?? 0);
    expect(samples).toBeLessThan(priorityOf('lore') ?? 0);
  });

  it('namespaces every block id', () => {
    // F18's reservation, applied where the first `se.*` ids in a shipped
    // artefact appear.
    for (const block of SCENE_PRESET.blocks) expect(block.id.startsWith('se.')).toBe(true);
  });
});

describe('what Scene declares, and what the engine does with it', () => {
  it('makes its one step a prose call, which is what admits guidance', () => {
    // One `writes` entry here would turn every guidance-carrying turn into an
    // AdvisoryLeakError abort — [03 §5.2] working as designed, and worth
    // pinning before somebody adds a channel to the step.
    expect(callPurposeFor(NARRATE)).toBe('prose');
  });

  it('declares se.clock, and the engine still resolves channels globally', () => {
    // **An honest record of a gap rather than a pinned inversion.** `channels`
    // documents what Scene uses; effect application reads the module-global
    // registry, so this declaration does not *enable* anything. Making the
    // registry mode-derived is P7's, where a mode with a channel of its own can
    // prove the field does something.
    expect(SCENE.channels.map((channel) => channel.id)).toEqual(['se.clock']);
    // The owner is a literal in `channels.ts` rather than an import of this id,
    // because naming it the other way round would be a module cycle. This is
    // what keeps the two in step instead.
    for (const channel of SCENE.channels) expect(channel.owner).toBe(SCENE_ID);
    for (const channel of SCENE.channels) expect(CHANNELS[channel.id]).toBe(channel);
  });

  it('ships its empty fields empty, and its one-armed fields at one arm', () => {
    // [P2 §5]'s erosion line, as an assertion: a second step or a participant
    // policy belongs to P7, and this is what notices one arriving early.
    expect(SCENE.presets).toEqual([]);
    expect(SCENE.surfaces).toEqual([]);
    expect(SCENE.setup).toEqual({ kind: 'none' });
    expect(SCENE.participants).toEqual({ select: 'fixed', maxActors: 1 });
    expect(SCENE.steps).toHaveLength(1);
    expect(SCENE.inputs).toEqual(['do']);
  });

  it('says narrator and merged, and the instruction block agrees', () => {
    // `voice` and `dispatch` have no engine consumer at P2.6, so what keeps
    // them from being decoration is that the prose they describe is checkable.
    expect(SCENE.voice).toBe('narrator');
    expect(SCENE.dispatch).toBe('merged');

    const instruction = SCENE_PRESET.blocks.find((block) => block.kind === 'text');
    const text = instruction?.kind === 'text' ? instruction.template : '';
    // narrator: it describes rather than speaks as anybody.
    expect(text).toContain('narrator');
    // merged: one reply, so it must not be told to answer as one actor.
    expect(text).not.toContain('in character');
  });
});

describe('the registry', () => {
  it('builds a runnable plan for every built-in mode', () => {
    expect(() => {
      assertModesRunnable();
    }).not.toThrow();
    expect(planFor(SCENE_MODE).steps.map((step) => step.definition.id)).toEqual([NARRATE.id]);
  });

  it('refuses a mode that declares a step it cannot run', () => {
    // A plan silently short one step is a turn that quietly narrates nothing,
    // which reads as a bad model rather than a broken build.
    expect(() => planFor({ definition: SCENE, run: {} })).toThrow(/no implementation/);
  });

  it('names Scene as the default, and knows it by id', () => {
    expect(DEFAULT_MODE_ID).toBe(SCENE_ID);
    expect(BUILT_IN_MODES[SCENE_ID]).toBe(SCENE_MODE);
  });
});
