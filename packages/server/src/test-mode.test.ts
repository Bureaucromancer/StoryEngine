// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { callPurposeFor } from './turns/steps.js';
import { TEST_MODE, TEST_PRESET, TEST_STEP } from './test-mode.js';

/**
 * The fixture itself, for the same reason `test-server.test.ts` exists — [P7.0].
 *
 * **A fixture seven test files lean on can weaken them all without failing
 * anything**, which is the failure this file is against. `retrieval/retrieve.test.ts`
 * maps over the preset's blocks looking for lore slots and sets an outlet on
 * them; drop those slots and the map matches nothing, the modified preset equals
 * the original, and the test goes on passing while asserting nothing.
 * `turns/runner.test.ts` looks up `se.input` by id and would take `undefined`.
 *
 * So the properties those files depend on are asserted here, where losing one
 * is a failure with a name rather than a test quietly becoming vacuous. This is
 * not a copy of the assertions themselves — it is the floor under them.
 */
describe('the engine test fixture', () => {
  it('carries the slots the engine tests reach for by id', () => {
    const ids = new Set(TEST_PRESET.blocks.map((block) => block.id));

    // `retrieval/retrieve.test.ts` needs both lore phases: it sets an outlet on
    // every lore slot and asserts the placement that follows.
    expect(ids).toContain('se.lore');
    expect(ids).toContain('se.lore.after');
    // `turns/runner.test.ts` finds this one by id and would otherwise use
    // `undefined` as a block.
    expect(ids).toContain('se.input');
    // The advisory path — `routes/p2-gate-guidance.test.ts` and the runner's
    // leak tests are about what may reach this slot.
    expect(ids).toContain('se.guidance');
  });

  it('keeps the guidance slot advisory, which is what the leak tests are about', () => {
    const guidance = TEST_PRESET.blocks.find((block) => block.id === 'se.guidance');

    // [06 §5.2]: guidance may shape prose and must never reach a systematic
    // outcome. A fixture whose guidance block was not advisory would make the
    // refusal untestable by removing the thing being refused.
    expect(guidance?.advisory).toBe(true);
  });

  it('makes its step a prose call, which is what admits guidance at all', () => {
    // `contributes: 'messages'` with an empty `writes` is the pair
    // `callPurposeFor` turns into `prose`. One entry in `writes` would make
    // every guidance-carrying turn an abort, and several tests would stop
    // testing their subject without failing.
    expect(TEST_STEP.writes).toHaveLength(0);
    expect(callPurposeFor(TEST_STEP)).toBe('prose');
  });

  it('is a runnable mode, so a plan built from it has an implementation', () => {
    expect(TEST_MODE.definition.steps).toHaveLength(1);
    expect(TEST_MODE.run[TEST_STEP.id]).toBeTypeOf('function');
  });

  it('declares no channels, so importing it registers nothing', () => {
    // A mode's declared channels are installed with it since [P7.0]. A fixture
    // that declared one would write into the process-wide channel registry for
    // every test that touches this file, which is a side effect a fixture has
    // no business having.
    expect(TEST_MODE.definition.channels).toHaveLength(0);
  });

  it('is not Scene, so a test that meant Scene cannot reach it by accident', () => {
    // The point of the copy: these are the engine's fixtures and Scene is a
    // product decision. If they ever share an id, a test asserting "the default
    // mode" could pass against the fixture and nobody would know.
    expect(TEST_MODE.definition.id).not.toBe('storyengine.scene');
    expect(TEST_PRESET.modes).not.toContain('storyengine.scene');
  });
});
