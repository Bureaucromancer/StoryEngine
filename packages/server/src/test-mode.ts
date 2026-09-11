// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Mode, ModeDefinition, Preset, StepDefinition } from '@storyengine/sdk';

/**
 * A mode and a prompt pack the **engine's own tests** run against — [P7.0].
 *
 * **Copied from Scene rather than imported from it, and the copy is the point.**
 * Ten test files reached into `modes/scene` for `SCENE_PRESET`, `SCENE_MODE` or
 * `NARRATE` because they needed *a* preset, *a* mode or *a* step and Scene was
 * the only one there. That coupling has to go before Scene becomes a package —
 * the boundary graph allows `server → server, sdk, shared` and nothing else —
 * but the boundary is the occasion rather than the reason.
 *
 * **The reason is that an engine test using a real mode tests two things and
 * says it is testing one.** Scene's block list, priorities and budget are
 * product decisions belonging to a mode; a test of the budgeter or the runner
 * that breaks when Scene reorders a slot has caught nothing and cost an
 * afternoon. These fixtures start as an exact copy so that no test changed
 * meaning on the day they were introduced, and they are free to diverge
 * afterwards — which is the whole benefit, since from here Scene can change
 * without the engine's tests having an opinion about it.
 *
 * The block ids stay `se.*` deliberately: that namespace is the **engine's**
 * slot vocabulary rather than Scene's — `se.input`, `se.lore`, `se.guidance`
 * are what the assembler and the budgeter name — so a fixture that renamed them
 * would be testing the engine against a vocabulary the engine does not use.
 */
export const TEST_PRESET: Preset = {
  schema: 'storyengine.preset/0',
  id: '0199c000-0000-7000-8000-0000000decaf',
  name: 'Engine test fixture',
  blurb: '',
  modes: ['storyengine.test'],
  blocks: [
    {
      id: 'se.instruction',
      label: 'instruction',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 90,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'text',
      template:
        "You are the narrator of a scene. Write what happens next in third person, past tense. Describe only what the player could perceive. Never write the player's own dialogue, thoughts or decisions, and never end by asking what they do.",
    },
    {
      id: 'se.treatment',
      label: 'treatment',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 60,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'treatment',
        part: 'framing',
      },
    },
    {
      id: 'se.persona',
      label: 'persona',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 70,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'persona',
      },
    },
    {
      id: 'se.actor.summary',
      label: 'actor.summary',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 70,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.summary',
      },
    },
    {
      id: 'se.actor.appearance',
      label: 'actor.appearance',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 40,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.appearance',
      },
    },
    {
      id: 'se.actor.voice',
      label: 'actor.voice',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 40,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.voice',
      },
    },
    {
      id: 'se.actor.traits',
      label: 'actor.traits',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 35,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        field: 'traits',
      },
    },
    {
      id: 'se.actor.background',
      label: 'actor.background',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 30,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'actor',
        sectionId: 'se.background',
      },
    },
    {
      id: 'se.lore',
      label: 'lore',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 25,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'lore',
        phase: 'before',
      },
    },
    {
      id: 'se.lore.after',
      label: 'lore (after)',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 25,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'lore',
        phase: 'after',
      },
    },
    {
      id: 'se.samples',
      label: 'writing samples',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 20,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'samples',
      },
    },
    {
      id: 'se.history',
      label: 'history',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 10,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'history',
      },
    },
    {
      id: 'se.guidance',
      label: 'guidance',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 80,
      appliesTo: [],
      advisory: true,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'guidance',
      },
    },
    {
      id: 'se.attempt',
      label: 'previous attempt',
      role: 'system',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 50,
      appliesTo: [],
      advisory: true,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'attempt',
      },
      wrapper:
        'This is the previous attempt at this turn. The player asked for a different one — do not repeat it.\n\n{{content}}',
    },
    {
      id: 'se.input',
      label: 'input',
      role: 'user',
      enabled: true,
      placement: {
        at: 'sequence',
      },
      priority: 100,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: {
        of: 'input',
      },
    },
  ],
  budget: {
    contextShare: 0.75,
    maxContextTokens: null,
    reserveOutputTokens: 1024,
    sources: [],
  },
  params: {
    temperature: 0.85,
    maxTokens: 800,
  },
  modelHint: null,
  variables: [],
  tags: [],
  provenance: {
    source: 'manual',
    creator: null,
    version: null,
    license: null,
    originalFilename: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  generated: null,
  compat: null,
  metadata: {},
};

/**
 * A prose step, in the one shape the engine treats specially.
 *
 * **`contributes: 'messages'` with an empty `writes` is load-bearing**, not
 * incidental: that pair is what `callPurposeFor` turns into `prose`, which is
 * what admits the guidance block. One entry in `writes` would make every
 * guidance-carrying turn an `AdvisoryLeakError` abort — [06 §5.2] working as
 * designed — so a fixture that got this wrong would quietly stop several tests
 * from testing what they say they test.
 */
export const TEST_STEP: StepDefinition = {
  id: 'se.narrate',
  stage: 'generate',
  reads: ['history'],
  writes: [],
  contributes: 'messages',
  callKind: 'narrate',
  when: { when: 'cadence', everyNTurns: 1 },
  failure: 'abort',
  role: 'prose',
};

export const TEST_MODE_ID = 'storyengine.test';

export const TEST_MODE_DEFINITION: ModeDefinition = {
  id: TEST_MODE_ID,
  version: '1.0.0',
  displayName: 'Engine test fixture',
  voice: 'narrator',
  dispatch: 'merged',
  presets: [],
  participants: { select: 'fixed', maxActors: 1 },
  assembly: { defaultPreset: TEST_PRESET, historyWindow: 20 },
  steps: [TEST_STEP],
  /**
   * Empty, and that is a choice this fixture gets to make where Scene does not.
   * A mode's declared channels are registered with it since [P7.0], so a fixture
   * declaring one would install it into the process-wide registry for every test
   * that touches this file — which is a side effect a fixture has no business
   * having. A test that wants a registered channel registers one.
   */
  channels: [],
  inputs: ['do'],
  surfaces: [],
  setup: { kind: 'none' },
};

export const TEST_MODE: Mode = {
  definition: TEST_MODE_DEFINITION,
  run: {
    [TEST_STEP.id]: async (_input, host) => {
      const result = await host.call({ stream: true });
      return { message: { text: result.text } };
    },
  },
};
