// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  dialChannel,
  type ChannelDefinition,
  type Mode,
  type ModeDefinition,
  type StepDefinition,
  type StepHost,
  type StepInput,
  type StepResult,
} from '@storyengine/sdk';

import { FREEFORM_PRESET } from './preset.js';

/**
 * Freeform — [06 §1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * built at [P7.9](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***The second mode, and it is the second **package** rather than only the
 * second mode***, which is §P7.9's own emphasis and the difference that matters.
 * Scene was written before the contract and moved behind it at [P7.0]; this was
 * written against the contract from its first line, by somebody who could not
 * reach past it because there is nothing to reach — `@storyengine/sdk` is the
 * only package in this one's dependencies, its tsconfig references, or its
 * resolvable graph. **Everything below that a mode could not declare would have
 * been a hole in the contract**, and finding those is what a second mode is
 * *for* ([20 §10](../../../../docs/design/20-tech-stack.md)).
 *
 * [06 §1] gives the shape in one sentence: *"the Aventuras shape — do/say/think/
 * story input, chapters, world-state classification, branching, light or no
 * mechanics."* Two of those are here, two are not, and the split is stated
 * rather than discovered:
 *
 * - **do/say/think/story input** — declared, validated against this list by the
 *   turn route, and selectable. The kinds are the same strings a preset's
 *   `appliesTo` filters on, which is [13 §8.3]'s *"a preset carries a different
 *   instruction block per kind with no new machinery"* arriving three phases
 *   before Write needs it.
 * - **branching** — the turn tree, which has been the engine's since P2 and is
 *   not a mode feature at all. Freeform gets it by existing.
 * - **chapters** are [P11]'s reading view and *world-state classification* is a
 *   step this mode can add later without an engine change, which is precisely
 *   the claim being made. Neither is declared here, because a declaration with
 *   nothing behind it is the placeholder shape this phase keeps refusing.
 *
 * ***Light or no mechanics, and "no" is the shipped answer.*** [06 §7.3.1]'s
 * table has difficulty resolve to *prompt language* for both modes and to
 * *mechanical parameters* for *"Campaign, and Freeform with dice or HP toggled
 * on"*. Campaign is 5.0 and the toggles are not built, so this mode consumes the
 * prose half only — and `DifficultyLevel.parameters` travels through the pack
 * untouched, which is what makes turning them on later a pack edit rather than a
 * schema change.
 */

export const FREEFORM_ID = 'storyengine.freeform';

/**
 * ***A channel this mode wanted and could not have, recorded rather than
 * shipped*** — [P7.9], and it is the contract finding a second mode exists to
 * produce.
 *
 * [06 §1] lists *world-state classification* among Freeform's properties, and
 * the smallest true instance is the one the input kind already supplies: a turn
 * where the player **said** something is a different kind of moment from one
 * where they **did**, and a narrator that cannot tell has to infer it from prose
 * it has not written yet. So this file declared `se.freeform.input` —
 * session-scoped, `engine-computed`, written after the step loop the way the
 * clock is.
 *
 * ***It was removed the same day, because nothing could write it.*** The engine
 * writes exactly two channels after the step loop and it names both by id in
 * `turns/runner.ts`: `se.clock`, and the goal the judge proposed. **There is no
 * mechanism by which a mode-declared `engine-computed` channel gets written**,
 * and there cannot be one that does not involve the engine knowing what a
 * particular mode's channel means — which is the `switch (mode)` [06 §2] exists
 * to forbid, wearing a different shape. The mode cannot write it either:
 * `acceptEffect` refuses an `engine-computed` channel for a `step` proposal,
 * deliberately and correctly.
 *
 * **So the honest options were three and the third is the one taken.** Declare
 * it `model-proposed` and let the narrator say what the player had just done —
 * which is a fact the *engine* holds and [06 §8.1] refuses everywhere else.
 * Declare it and leave it null forever — the placeholder shape this phase has
 * refused at every stage, and `ModeDefinition.channels` spent five of them
 * demonstrating. Or **declare nothing, and write down what the contract is
 * missing**, which is [26 C16](../../../../docs/design/26-open-questions.md).
 *
 * *The gap is narrow and real*: a mode may declare a channel a **person** or a
 * **model** writes, and may not declare one the **engine** computes on its
 * behalf — because computing it is code, and a mode's code runs in steps.
 * Nothing in this stage needed it badly enough to widen the contract in a hurry,
 * which is exactly when a contract should not be widened.
 */

/**
 * The dials — *declared by the mode, which is [04 §7]'s answer arriving at its
 * first real consumer.*
 *
 * [P7.8] built the mechanism against a fixture because *the mode that has a
 * difficulty is Freeform and Freeform is P7.9's*. This is that line being
 * discharged: two calls to the SDK's builder, no engine knowledge, and the
 * levels below come off {@link FREEFORM_PRESET} rather than from anything here.
 */
export const FREEFORM_CHANNELS: readonly ChannelDefinition[] = [
  dialChannel('difficulty', FREEFORM_ID),
  dialChannel('directedness', FREEFORM_ID),
];

/**
 * The narration step.
 *
 * ***Identical in shape to Scene's and that is the finding, not the
 * shortcut.*** `contributes: 'messages'` with an empty `writes` is what makes
 * `callPurposeFor` yield `prose` and admit the guidance block — one entry in
 * `writes` would turn every guidance-carrying turn into an `AdvisoryLeakError`
 * abort ([06 §5.2]) — so a second mode that narrates declares the same four
 * fields for the same four reasons. **A contract where the second instance of a
 * thing looks like the first is a contract that generalised**; the failure mode
 * would have been needing a fifth field nobody had thought of.
 *
 * *`callKind: 'narrate'` and not the input kind*, which is the one place this
 * could have gone wrong. [13 §8.3] says an input kind is also a call kind and a
 * preset carries a different instruction block per kind — and the mechanism for
 * that is the **turn's** kind reaching `appliesTo`, not the step renaming its
 * call. A step whose `callKind` varied per submission would make
 * `StepDefinition` a function of the turn, and every preset written against it
 * would have to enumerate the mode's input kinds to match one call.
 */
export const NARRATE: StepDefinition = {
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

async function narrate(_input: StepInput, host: StepHost): Promise<StepResult> {
  const result = await host.call({ stream: true });
  return { message: { text: result.text } };
}

export const FREEFORM: ModeDefinition = {
  id: FREEFORM_ID,
  version: '1.0.0',
  displayName: 'Freeform',
  voice: 'narrator',
  dispatch: 'merged',
  presets: [],
  /**
   * ***A party, which is the first thing this mode needs that Scene's policy
   * forbids.*** [06 §8]'s sixth rule: *"party is session state available to
   * every mode, not a Freeform or Campaign feature… Modes differ in what they do
   * with it."* Scene declares `{ select: 'fixed', maxActors: 1 }` — which
   * [P7.3] made the declaration that *the cast cannot change as an outcome of a
   * turn* — and Freeform's whole shape is that it can.
   *
   * ***`natural` of the four, which is the arm this mode's own input kinds make
   * sensible.*** [06 §7.2] takes SillyTavern's strategies as the taxonomy and is
   * clear that none of them decides who is *in* the story — they decide who
   * talks this turn. `natural` is *whoever the scene just addressed*, ~~scanned
   * out of the last prose and the player's own input~~, and a mode with a `say`
   * kind is the mode where *"Vera, what do you think?"* is the ordinary
   * submission rather than an edge case. ~~`list` would rotate through a party
   * nobody addressed~~ `list` would hand every turn to the whole eligible party,
   * once each, whoever was addressed, and `pooled` would pick at random, both of
   * which are answers to a question this mode does not ask.
   *
   * *Corrected 2026-09-29, at [P14.1]*: `natural` is now ST's three steps
   * (`group-chats.js:1242-1316`) — first the members the activation text names
   * (the input, or the last message when there is none), then every member
   * whose talkativeness roll succeeds, then one member at random if still
   * nobody — so it answers nobody only when nobody is eligible, and the mention
   * is the step that answers *"Vera, what do you think?"*; the struck `list`
   * clause described P7.3's rotation, which P14.1 removed. The reason for
   * declaring `natural` stands. *What it changes today is little*: the narrate
   * step is merged and never reads `speakers`, so the arm's pick reaches a step
   * that does not use it.
   *
   * ~~*It is honestly a heuristic and `speakers.ts` says so at length.*~~ It is
   * a transcription of ST's arm since [P14.1], and `speakers.ts` names the line
   * each step comes from. Declaring it is a claim about what this mode wants,
   * not about how well the scan works.
   *
   * *`maxActors` is a ceiling rather than a target*: six is what fits in a
   * prompt beside a goal, a treatment and twenty turns of history without the
   * cast crowding out the story, and it is the mode's number to pick, which is
   * the point of the field.
   */
  participants: { select: 'natural', maxActors: 6 },
  assembly: { defaultPreset: FREEFORM_PRESET, historyWindow: 20 },
  steps: [NARRATE],
  channels: FREEFORM_CHANNELS,
  /**
   * ***The four kinds [06 §1] names, and this is the phase that gives them a
   * surface.*** §P7.9 routes the input-kind selector here by name, and the
   * standing line it discharges is [work plan §2.3]'s — *no phase exits with
   * configuration that has no surface*. `ModeDefinition.inputs` has documented
   * five kinds since P2 and been read by one line of `presentMode`; a client
   * could not act on it and the turn route did not check it.
   *
   * **`choice` is deliberately not here.** [06 §1]'s sentence is *"do/say/think/
   * story input"* and `choice` belongs to a mode that offers choices — which
   * [R11]'s suggested actions make *available* to Freeform and do not make
   * *required*. A kind this mode declares is a kind a player can submit at any
   * time, and an unprompted *choice* with nothing to choose between is a kind
   * with no meaning.
   */
  inputs: ['do', 'say', 'think', 'story'],
  surfaces: [],
  /**
   * ***The wizard, and the gate's hardest claim.*** Step 9a — *"a setup wizard
   * for a mode the engine has no knowledge of, rendered from its declaration
   * alone"* — is walked against **this**, so every field here is a field
   * `packages/server` does not name and `packages/client` renders from the wire.
   *
   * *Difficulty and directedness are `choice` fields whose option ids are the
   * pack's level ids*, which is the one coupling in this declaration and it is
   * the intended one: [P7.8]'s middle rung reads `mode.config` for exactly these
   * keys, so a wizard answer becomes the dial's opening value with nothing
   * in between. **A level id here that the pack does not ship resolves to the
   * pack's lowest rank rather than to an error**, which is what makes swapping
   * packs survivable.
   */
  setup: {
    kind: 'declared',
    fields: [
      {
        id: 'premise',
        required: true,
        widget: {
          kind: 'text',
          label: 'What is this story about?',
          hint: 'A sentence or two. The narrator opens from it, and you can change everything later.',
          lines: 4,
        },
      },
      {
        id: 'difficulty',
        required: true,
        widget: {
          kind: 'choice',
          label: 'How much should the world resist you?',
          hint: 'Harder means longer and more expensive. It never means you cannot get there.',
          options: [
            { value: 'gentle', label: 'Gentle' },
            { value: 'even', label: 'Even' },
            { value: 'harsh', label: 'Harsh' },
          ],
        },
      },
      {
        id: 'directedness',
        required: true,
        widget: {
          kind: 'choice',
          label: 'How much should the narrator steer?',
          hint: 'A narrator with none is a stenographer. One with too much ignores you.',
          options: [
            { value: 'following', label: 'Follow me' },
            { value: 'steering', label: 'Have its own ideas' },
          ],
        },
      },
    ],
  },
};

export const FREEFORM_MODE: Mode = {
  definition: FREEFORM,
  run: { [NARRATE.id]: narrate },
};
