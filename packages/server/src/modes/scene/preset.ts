// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Preset } from '@storyengine/shared';

/**
 * Scene's default prompt pack — a real, valid portable `Preset`.
 *
 * **A literal value, not `newPreset()` plus mutation**, and that is not style:
 * the factory mints a fresh `uuidv7()` and stamps `now()`, and this object is
 * copied into every session and snapshotted by a golden test. A new id or
 * timestamp per process makes both non-reproducible.
 *
 * **A code constant rather than a file seeded into `system/library/presets/`.**
 * [P2 §2.4] says the mode relocates behind the SDK unchanged, and a mode that
 * depended on a boot-time seeder would not; nothing writes to `system/library/`
 * today, and a session gets its own copy either way. The cost, stated: the
 * default preset is readable in the turn record and not editable in the app
 * until P7.
 *
 * It goes through `validate()` in a test — the same validator a user's write
 * goes through — which is the assertion that caught `SlotSource` missing the
 * `guidance` arm that [03 §5.1] requires a preset to be able to position.
 */

/** Fixed, so a golden snapshot over this object is reproducible. */
const STAMP = '2026-01-01T00:00:00.000Z';

export const SCENE_PRESET: Preset = {
  schema: 'storyengine.preset/0',
  id: '0199c000-0000-7000-8000-00000000e5e7',
  name: 'Scene',
  blurb: '',
  modes: ['storyengine.scene'],
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
    /**
     * Writing samples — [10 §3.1].
     *
     * **Priority 20 puts it between history's floor and lore**, and the
     * arithmetic is worth stating because it is not obvious. History blocks are
     * emitted at `priority + index` over a 20-turn window, so this preset's
     * history occupies 10..29 rather than a single 10. A sample at 20 therefore
     * survives roughly the ten oldest turns falling out and drops before the ten
     * newest — which is the intended reading of "a nicety that improves voice":
     * losing it costs tone, never continuity.
     *
     * **Not advisory.** A sample is content a model may see on any call;
     * marking it advisory would bar it from every effects and verdict call
     * ([03 §6]), which is not what an exemplar is for.
     *
     * `from` is omitted, so it names every carrier. Only the actor arm produces
     * anything today; the block is positioned now so that P5 wiring the other
     * two is a change in what fills the slot rather than a change to the
     * preset — the same posture `se.lore` has held since P2.
     */
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
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  generated: null,
  compat: null,
  metadata: {},
};
