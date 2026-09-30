// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { dialChannel } from '@storyengine/sdk';
import type {
  ChannelDefinition,
  DeclaredSetup,
  Mode,
  ModeDefinition,
  Preset,
  StepDefinition,
} from '@storyengine/sdk';

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

/**
 * A mode that **selects speakers** — [06 §7.2], [P7.3], and the stage's own
 * *Ends at*.
 *
 * `select: 'list'` rather than `pooled`, because the exit line is about a
 * non-`fixed` mode *running* and a deterministic arm makes that one assertion
 * instead of two: ~~the rotation is a function of the path, so the test says
 * which actor and not merely that there was one.~~ *Corrected 2026-09-29, at
 * [P14.1]*: `list` no longer rotates — it is every eligible member, once each,
 * in cast order
 * ([P14 §0.7](../../../docs/design/workplan/31-p14-scene-and-session-import.md))
 * — and it is still the one arm with no draw, so the test can name exactly who
 * was handed to the step. `pooled`'s draw and its replay are proved where they
 * are cheap to prove, in `speakers.test.ts`, against a tape rather than against
 * a turn.
 *
 * **Its step echoes what it was handed**, which is the only way an integration
 * test can see a selection at all: `speakers` crosses into a step and nothing
 * downstream records it — a merged call names nobody by design, and
 * `StepCallRequest.actorId` reaches `resolveRole` and stops there. A fixture
 * that exists to be observed is allowed to say what it saw; a shipped mode would
 * not.
 */
export const ENSEMBLE_MODE_ID = 'storyengine.test.ensemble';

export const ENSEMBLE_MODE: Mode = {
  definition: {
    ...TEST_MODE_DEFINITION,
    id: ENSEMBLE_MODE_ID,
    displayName: 'Engine test fixture — ensemble',
    participants: { select: 'list', maxActors: 4 },
  },
  run: {
    [TEST_STEP.id]: async (input, host) => {
      /**
       * **The first speaker, passed as `actorId`** — which is the whole chain
       * the stage owes: a policy chooses, the engine hands the choice to the
       * step, the step says who it speaks for, and `resolveRole` applies that
       * actor's hint as its last and weakest layer. A mode that fanned out would
       * make one call per speaker; that mode is [P7.9]'s and this is the engine
       * half working for one call.
       */
      const result = await host.call({
        stream: true,
        ...(input.speakers?.[0] === undefined ? {} : { actorId: input.speakers[0] }),
      });
      return { message: { text: `[${(input.speakers ?? []).join(',')}] ${result.text}` } };
    },
  },
};

/**
 * A mode whose step **asks for a shape** — [P7.4].
 *
 * The fixture the validation arm is proved against. Its step declares a write,
 * which is what makes the call's purpose `effects` — the only purpose a
 * structured call ever has, since a step that writes nothing and speaks is
 * `prose` and prose has no shape to check.
 *
 * *`se.clock` as the declared write rather than a channel of its own, because a
 * fixture that registered one would install it into the process-wide registry
 * for every test that touches this file — the same reason `TEST_MODE_DEFINITION`
 * declares no channels.*
 */
export const SHAPED_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
};

export const SHAPED_STEP: StepDefinition = {
  ...TEST_STEP,
  id: 'se.shaped',
  reads: [],
  writes: ['se.clock'],
  contributes: 'messages',
  callKind: 'shape',
};

export const SHAPED_MODE_ID = 'storyengine.test.shaped';

export const SHAPED_MODE: Mode = {
  definition: {
    ...TEST_MODE_DEFINITION,
    id: SHAPED_MODE_ID,
    displayName: 'Engine test fixture — structured output',
    steps: [SHAPED_STEP],
  },
  run: {
    [SHAPED_STEP.id]: async (_input, host) => {
      const result = await host.call({ schema: SHAPED_SCHEMA });
      /**
       * **What it saw, verbatim.** A fixture that exists to be observed is
       * allowed to say what it was handed — and the distinction under test is
       * precisely whether a value that failed validation reaches here, which
       * nothing downstream of a step records.
       */
      return { message: { text: JSON.stringify(result.object ?? null) } };
    },
  },
};

/**
 * A mode that **asks for something before the first turn** — [06 §7.3], [P7.4].
 *
 * The stage's exit line is *a wizard for a mode the engine has no knowledge of,
 * rendered from its declaration alone*, and this is the mode the engine has no
 * knowledge of: nothing in `packages/server` names it, and every arm of the
 * widget vocabulary is exercised by a field with a subject [06 §7.3] actually
 * names — a difficulty chosen from a ranked list, a premise written in prose,
 * and dice as a toggle rather than as a different mode.
 *
 * *A fixture rather than a shipped mode, because the mode that wants a wizard is
 * Freeform and Freeform is [P7.9]'s. What this proves is the mechanism, which is
 * what a mode the engine knows nothing about is the only honest witness for.*
 */
export const SETUP_MODE_ID = 'storyengine.test.setup';

export const SETUP_MODE: Mode = {
  definition: {
    ...TEST_MODE_DEFINITION,
    id: SETUP_MODE_ID,
    displayName: 'Engine test fixture — wizard',
    setup: {
      kind: 'declared',
      fields: [
        {
          id: 'premise',
          required: true,
          widget: {
            kind: 'text',
            label: 'What is this story about?',
            hint: 'A sentence or two. The narrator opens from it.',
            lines: 4,
          },
        },
        {
          id: 'difficulty',
          required: true,
          widget: {
            kind: 'choice',
            label: 'How much should the world resist you?',
            options: [
              { value: 'gentle', label: 'Gentle' },
              { value: 'even', label: 'Even' },
              { value: 'harsh', label: 'Harsh' },
            ],
          },
        },
        { id: 'dice', widget: { kind: 'toggle', label: 'Roll dice for outcomes' } },
      ],
    },
  },
  run: TEST_MODE.run,
};

/**
 * A channel this fixture's parts write — and **not `se.clock`**, which is where
 * the first draft of this went ([P7.4], 2026-09-12).
 *
 * `se.clock` is `update: 'engine-computed'`, so a *step's* proposal on it is
 * refused and recorded as refused — which is the refusal ladder doing exactly
 * what it is for, and a fixture that walked into it would have been testing
 * that rather than what it meant to. A part writes what a mode's own channel
 * declares it may.
 *
 * *Declared on this mode rather than on `TEST_MODE_DEFINITION`, which declares
 * none: `registerMode` installs a mode's channels, so a fixture every test
 * touches would install this into the process-wide registry for all of them.
 * This one is registered only by the tests that want it.*
 */
const OPENING_CHANNEL: ChannelDefinition = {
  id: 'se.test.opening',
  owner: 'storyengine.test.generating',
  version: 1,
  scope: 'session',
  // What a *generated world* decides is model-proposed by definition: there is
  // nothing to compute it from.
  update: 'model-proposed',
  visibility: 'player',
  schema: {
    type: 'object',
    properties: { hour: { type: 'integer', minimum: 0, maximum: 23 } },
    required: ['hour'],
    additionalProperties: false,
  },
  init: { kind: 'literal', value: null },
  budget: null,
};

/**
 * A mode that **generates its world** — [06 §7.3], [P7.4].
 *
 * Two parts, because one would not show the property the design is actually
 * after: *"each individually retryable, **applied as they succeed**"*. With two,
 * a failing first part and a succeeding second one are distinguishable from a
 * turn that fell over, and the second part's effect is on disk either way.
 *
 * *`failure: 'warn'` on both, deliberately.* `abort` is the right policy for
 * narration — a turn that could not narrate has nothing to show — and the wrong
 * one here: a world half-made is worth more than no world, and the part that
 * failed is named in the record for a person to run again.
 */
const OPENING_PART: StepDefinition = {
  ...TEST_STEP,
  id: 'se.part.opening',
  stage: 'generate',
  reads: [],
  writes: [OPENING_CHANNEL.id],
  contributes: 'effects',
  callKind: 'setup',
  failure: 'warn',
};

const PREMISE_PART: StepDefinition = {
  ...OPENING_PART,
  id: 'se.part.premise',
  writes: [],
  contributes: 'messages',
};

export const GENERATING_MODE_ID = 'storyengine.test.generating';

export const GENERATING_MODE: Mode = {
  definition: {
    ...SETUP_MODE.definition,
    id: GENERATING_MODE_ID,
    displayName: 'Engine test fixture — generated world',
    channels: [OPENING_CHANNEL],
    setup: {
      ...(SETUP_MODE.definition.setup as DeclaredSetup),
      parts: [OPENING_PART, PREMISE_PART],
    },
  },
  run: {
    /**
     * **The ordinary steps too.** A generating mode still takes ordinary turns
     * after its setup one, and `assertModesRunnable` proves both lists against
     * this single table — so a fixture that implemented only its parts would
     * fail at startup, which is the check doing its job.
     */
    ...SETUP_MODE.run,
    /**
     * **Generates from the answers**, which is the whole point of a part: it
     * reads `input.setup`, asks for a shape, and proposes an effect. Nothing
     * here is setup-specific machinery — it is an ordinary step.
     */
    [OPENING_PART.id]: async (_input, host) => {
      const result = await host.call({ schema: HOUR_SCHEMA });
      const hour = (result.object as { hour?: number } | undefined)?.hour;
      if (hour === undefined) throw new Error('no hour');
      return {
        effects: [
          {
            channelId: OPENING_CHANNEL.id,
            op: { type: 'set', path: '/' },
            after: { hour },
            proposedBy: { kind: 'step', stepId: OPENING_PART.id },
          },
        ],
      };
    },
    [PREMISE_PART.id]: async (input, host) => {
      const result = await host.call({});
      // Echoing the answer proves it reached the step, which is the only way to
      // see from outside that `StepInput.setup` carries what the wizard collected.
      const premise = (input.setup?.['premise'] as string | undefined) ?? '';
      return { message: { text: `${premise} ${result.text}`.trim() } };
    },
  },
};

const HOUR_SCHEMA = {
  type: 'object',
  properties: { hour: { type: 'integer', minimum: 0, maximum: 23 } },
  required: ['hour'],
  additionalProperties: false,
};

/**
 * ***The dials' witness*** — [06 §7.3.1], [06 §7.3.2], [P7.8].
 *
 * A mode that declares both dials and a pack that ships levels for both, which
 * is the only arrangement in which [P7.8]'s *ends at* is checkable: *"two levels
 * of difficulty producing visibly different friction against the same goal, with
 * the level's prose coming from the pack and the scheduling from engine code."*
 * The visible difference is a block-for-block one and it is asserted rather than
 * read, which is what a stage can produce before the mode that *has* a
 * difficulty exists — Freeform is [P7.9]'s, and it will declare the same two
 * channels through the same builder.
 *
 * *A fixture rather than a shipped mode, for the reason `SETUP_MODE` is one*,
 * and registered only by the tests that want it: `registerMode` installs a
 * mode's channels into a process-wide registry, and two dials installed for
 * every test would make `channelDefinition(SE_DIFFICULTY)` answer in suites that
 * never declared one.
 */
export const DIALS_MODE_ID = 'storyengine.test.dials';

/**
 * **Three levels, and the fragments say what the dial is about.** [06 §7.3.1]:
 * what varies is *"how readily the world grants what you attempt"*, which is a
 * dial on narrator sycophancy rather than a number added to rolls — so the
 * prose concedes, or does not.
 *
 * ***And the floor is in the fragments***, which is where 7.3.1 puts it:
 * *"Obstruction must not reach unreachability. Difficulty modulates the cost and
 * the route, never whether the goal can be attained at all."* `harsh` says so in
 * its own words, because the rule is a claim about what the model is told and
 * engine code has no way to enforce it — a pack that drops the clause has built
 * the losing game the section warns about, and the only mechanism against that
 * is that the clause is readable in the file.
 */
const DIFFICULTY_LEVELS = [
  {
    id: 'gentle',
    label: 'Gentle',
    rank: 1,
    fragments: [
      {
        text: 'When the player attempts something, let it work. Complications are colour, not obstacles.',
        priority: 90,
      },
      { text: 'The world volunteers help before it is asked.', priority: 40 },
    ],
  },
  {
    id: 'even',
    label: 'Even',
    rank: 2,
    fragments: [
      {
        text: 'An attempt succeeds when it is reasonable and costs something when it is not.',
        priority: 90,
      },
    ],
  },
  {
    id: 'harsh',
    label: 'Harsh',
    rank: 3,
    fragments: [
      {
        text: 'Concede little. Most attempts work partially, late, or at a price the player did not price in.',
        priority: 90,
      },
      {
        text: 'The route to the objective may be long and expensive. It is never closed.',
        priority: 80,
      },
      { text: 'Nothing volunteers help.', priority: 30 },
    ],
  },
];

/**
 * **Two levels on the other axis, and their prose is about steering rather than
 * about resistance** — which is [06 §7.3.2]'s whole distinction, written out so
 * a reader can see that the two lists could not be swapped.
 */
const DIRECTEDNESS_LEVELS = [
  {
    id: 'following',
    label: 'Following',
    rank: 1,
    fragments: [
      { text: 'Follow where the player goes. You may offer, never insist.', priority: 90 },
    ],
  },
  {
    id: 'steering',
    label: 'Steering',
    rank: 2,
    fragments: [
      {
        text: 'You have an idea of where this is going. Bend scenes back toward it when you can do so without contradicting what happened.',
        priority: 90,
      },
    ],
  },
];

export const DIALS_PRESET: Preset = {
  ...TEST_PRESET,
  id: '0199c000-0000-7000-8000-0000000d1a15',
  name: 'Engine test fixture — dials',
  modes: [DIALS_MODE_ID],
  difficultyLevels: DIFFICULTY_LEVELS,
  directednessLevels: DIRECTEDNESS_LEVELS,
  blocks: [
    ...TEST_PRESET.blocks,
    /**
     * **Two slots, adjacent but separate**, which is the layout [06 §7.3.2]
     * argues for: an author who wants them together writes them together and has
     * *said so*, where one slot with a discriminator would have decided it for
     * every pack.
     */
    {
      id: 'se.difficulty',
      label: 'difficulty',
      role: 'system',
      enabled: true,
      placement: { at: 'sequence' },
      priority: 85,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: { of: 'difficulty' },
    },
    {
      id: 'se.directedness',
      label: 'directedness',
      role: 'system',
      enabled: true,
      placement: { at: 'sequence' },
      priority: 84,
      appliesTo: [],
      advisory: false,
      omitWhenEmpty: true,
      kind: 'slot',
      source: { of: 'directedness' },
    },
  ],
};

export const DIALS_MODE: Mode = {
  definition: {
    ...SETUP_MODE.definition,
    id: DIALS_MODE_ID,
    displayName: 'Engine test fixture — dials',
    /**
     * *Through the builder rather than as two literals*, which is the contract
     * decision `sdk/src/dials.ts` is: a mode that spelled these out would be
     * restating three policy choices, and the second mode to restate them is
     * where they stop agreeing.
     */
    channels: [
      dialChannel('difficulty', DIALS_MODE_ID),
      dialChannel('directedness', DIALS_MODE_ID),
    ],
  },
  run: SETUP_MODE.run,
};
