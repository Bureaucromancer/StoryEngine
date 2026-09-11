// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  ChannelDefinition,
  Mode,
  ModeDefinition,
  StepDefinition,
  StepHost,
  StepInput,
  StepResult,
} from '@storyengine/sdk';

import { SCENE_PRESET } from './preset.js';

/**
 * Scene — the P2 mode, and it is **allowed to be embarrassingly small**.
 *
 * [P2 §5](../../../../docs/design/workplan/08-p2-implementation.md) draws the line in as many
 * words: *a second step, a channel with a widget, a participant policy — each is
 * small and each belongs to P7, where the contract is tested by two real modes
 * rather than grown one convenience at a time.* So the interesting thing about
 * this file is what is **not** in it.
 *
 * Everything here is data except `narrate`, which is one host call. The mode
 * does no I/O and holds no handle.
 *
 * ~~**It reaches for exactly one thing under `server/`**~~ — **it reaches for
 * nothing under `server/`, because there is no `server/` above it any more**
 * ([P7.0](../../../../docs/design/workplan/23-p7-implementation.md)). This file
 * is in `packages/modes/scene`, and the only package it may import is
 * `@storyengine/sdk`; the boundary graph in `eslint.rules.js` makes anything
 * else a lint failure and `tsconfig.json`'s single project reference makes it a
 * build error. That is [19 §10](../../../../docs/design/19-tech-stack.md)'s
 * *"cheapest possible enforcement of the design's central bet"* actually
 * enforcing something.
 *
 * **Nothing here is conditional on being a built-in.** [22 §4.1](../../../../docs/design/22-extensions.md)
 * says built-ins go through the same boundary as anything a third party writes,
 * *"the moment built-ins run differently, they start relying on shared
 * references and the contract drifts without anyone noticing"* — so the only
 * thing that distinguishes this package from an installed extension is that the
 * distribution ships it.
 */

export const SCENE_ID = 'storyengine.scene';

/**
 * The story clock — Scene's channel, declared by Scene at last.
 *
 * **It lived in `sessions/channels.ts` until [P7.0]**, with `owner:
 * 'storyengine.scene'` naming a mode that could not hold it: the engine's
 * channel registry was a frozen record built from static imports, so a mode
 * declaring `se.clock` documented what it used without enabling it. Registration
 * is what changed — `registerMode` installs a mode's declared channels — and the
 * type coming from `@storyengine/sdk` is what made it possible, because the
 * `const` cycle that argument turned on cannot form across a third package.
 *
 * **The id is a literal here and a literal in the engine, and that is not a
 * duplication to be tidied away.** `sessions/channels.ts` keeps `SE_CLOCK`
 * because it advances the clock after the step loop and has to name it; this
 * package cannot import that constant and would not want to, since a third
 * party writing the same channel would have nothing to import either. An id is
 * *content* — it lands in `session.json` and in the effect log — so the two
 * literals are two spellings of one piece of content, pinned together by
 * `mode-loader.test.ts`, which loads the built-ins and asserts the engine's
 * `SE_CLOCK` resolves to a channel owned by the default mode. That check needs
 * no import in either direction, which is exactly why it can exist.
 */
export const CLOCK_CHANNEL: ChannelDefinition = {
  id: 'se.clock',
  owner: SCENE_ID,
  version: 1,
  // Engine-computed: the model does not get to decide what time it is. That is
  // the property making this a useful first channel — an effect nobody proposed
  // still has to be recorded, attributed and reversible like any other.
  update: 'engine-computed',
  scope: 'session',
  visibility: 'player',
  /**
   * **A budget at last, because [P7.1] built the thing it was waiting for.**
   *
   * This was `null` — *never injected* — and the collector's own comment said
   * why: *"a channel value is an object with no channel-to-text renderer
   * specified, which is also why the clock's budget is null."* A renderer exists
   * now, so the field can mean what 06 §4 says it means.
   *
   * Twenty-four tokens is roughly four times what `render` below produces, which
   * is deliberate slack rather than a measurement: the cap is a guard against a
   * template somebody edits into something long, not a target. A channel that
   * cannot fit its budget is truncated rather than dropped — the time of day is
   * more useful wrong-by-truncation than absent.
   */
  budget: 24,
  /**
   * **How the clock reads in a prompt, said by the mode that owns it.**
   *
   * The engine cannot know that `{day, hour, minute}` is a time of day, let
   * alone that `8` should read as `08`. This is the smallest possible instance
   * of the declarative contract: data in, text out, no code.
   *
   * *Padded through Liquid's own filters rather than a helper*, because the
   * vocabulary a mode author gets has to be the one the template engine ships —
   * an engine-supplied `pad` would be a capability only built-ins knew about.
   * `slice: -2, 2` and not `slice: -2`: the second argument is a **length**, and
   * without it Liquid takes one character and the clock reads `0:0`. Measured,
   * because it renders plausibly either way.
   */
  render:
    'Day {{ day }}, {{ hour | prepend: "0" | slice: -2, 2 }}:{{ minute | prepend: "0" | slice: -2, 2 }}',
  /**
   * **Normalised, and the schema is where that stops being a convention.**
   * `advance` carries minutes into hours and days, so an hour of 24 or a minute
   * of 60 is a value nothing in the engine produces — and a hand-edited
   * `session.json` is a supported way to get data in
   * ([03 §8.1](../../../../docs/design/03-data-model.md)), which is exactly the
   * path a 25 lands on. Bounds here mean that lands in the quarantine ladder
   * with its raw value kept, rather than rendering as a time that does not
   * exist.
   */
  schema: {
    type: 'object',
    properties: {
      day: { type: 'integer', minimum: 1 },
      hour: { type: 'integer', minimum: 0, maximum: 23 },
      minute: { type: 'integer', minimum: 0, maximum: 59 },
    },
    required: ['day', 'hour', 'minute'],
  },
  /**
   * **Morning, because a story usually starts in one — and it is Scene's to
   * say** ([P7.1]).
   *
   * This was `CLOCK_START` in `sessions/channels.ts`: an engine constant beside
   * the function that read it, so where the clock began was something the
   * *engine* knew about a channel a *mode* owns. A mode that cannot say where
   * its own channel starts has not really declared it — the same gap
   * `ModeDefinition.channels` had before [P7.0], one level down.
   */
  init: { kind: 'literal', value: { day: 1, hour: 8, minute: 0 } },
  /**
   * **The HUD half, and it is a different sentence from `render`** — [10 §8],
   * [P7.1].
   *
   * `render` says how the clock reads *to a model*, in a prompt, under a token
   * budget. This says how it reads *to a person*, in the HUD, with a label
   * beside it and no budget at all. Both are declarations and neither is code,
   * which is the whole of what 10 §8 buys: a mode cannot break the app's
   * rendering, and the frontend framework stays a reversible decision.
   *
   * *The label is authored content travelling with the mode, like a preset's
   * prose — not a key into the UI's catalogue. [01 §2] keeps English out of what
   * the **server** sends; this comes from a package an author wrote.*
   */
  surface: { kind: 'text', label: 'Time' },
};

export const NARRATE: StepDefinition = {
  id: 'se.narrate',
  stage: 'generate',
  reads: ['history'],
  /**
   * `contributes: 'messages'` with an empty `writes` is what makes
   * `callPurposeFor` yield `prose` and admit the guidance block. **One entry in
   * `writes` would turn every guidance-carrying turn into an
   * `AdvisoryLeakError` abort** — which is [06 §5.2] working exactly as
   * designed, and worth knowing before somebody adds a channel here.
   */
  writes: [],
  contributes: 'messages',
  // What a preset's `appliesTo` matches. Scene makes one kind of call.
  callKind: 'narrate',
  when: { when: 'cadence', everyNTurns: 1 },
  // If the call fails there is nothing else to narrate, and a turn that
  // continued would commit a record with no prose in it.
  failure: 'abort',
  role: 'prose',
};

/**
 * The whole of Scene's behaviour: ask the host, and the answer is the turn.
 *
 * The step does not assemble, does not choose a model, and does not know what a
 * Scene is. It asks; the runner resolves the role from the definition and
 * assembles with the purpose the definition implies.
 */
async function narrate(_input: StepInput, host: StepHost): Promise<StepResult> {
  const result = await host.call({ stream: true });
  return { message: { text: result.text } };
}

export const SCENE: ModeDefinition = {
  id: SCENE_ID,
  version: '1.0.0',
  displayName: 'Scene',
  voice: 'narrator',
  dispatch: 'merged',
  /**
   * Empty by fact rather than by omission. [06 §1] names presets for Adventure;
   * Scene has no second way to be configured, and minting `scene.default` would
   * create a permanent content identifier for a distinction nothing makes.
   */
  presets: [],
  participants: { select: 'fixed', maxActors: 1 },
  assembly: { defaultPreset: SCENE_PRESET, historyWindow: 20 },
  steps: [NARRATE],
  /**
   * ~~**A declaration the engine does not yet consult**~~ — **consulted since
   * [P7.0]**: `registerMode` installs a mode's declared channels, so this array
   * is what makes `se.clock` a channel effect application will accept rather
   * than a note about one. The old text is worth keeping because it names the
   * thing the move fixed: a declaration nothing reads is decoration, and this
   * one was decoration for five stages.
   */
  channels: [CLOCK_CHANNEL],
  /**
   * One kind, matching what the wire already defaults to — so nothing that
   * works today stops working. `say` / `think` / `story` arrive with the
   * input-kind selector, which is a surface this stage does not build.
   */
  inputs: ['do'],
  /** [10 §8] has extensions declare widgets; that machinery is P7's. */
  surfaces: [],
  setup: { kind: 'none' },
};

export const SCENE_MODE: Mode = { definition: SCENE, run: { [NARRATE.id]: narrate } };
