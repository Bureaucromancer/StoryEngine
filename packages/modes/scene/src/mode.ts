// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { MEDIA_SELECTION_SCHEMA } from '@storyengine/sdk';
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
import { STAGE_STEP, stage } from './staging.js';

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

/**
 * ***Which backdrop is showing*** — [06 §7.2], [06 §10.1a], declared at
 * [P7.9].
 *
 * §7.2 has said *"a background channel says which backdrop is showing"* since
 * the first draft, and this is that declaration. What it holds is a
 * {@link MediaSelection}, which is the shape [06 §10.1a] requires **from the
 * declaration onward** rather than from the stage that fills it: *"narrowing it
 * to a filename now means changing a channel's schema under live sessions later
 * to admit the generated case."* The rendition arm is dead until [P9] and is
 * here so that it never has to arrive as a migration.
 *
 * ***`engine-computed`, which admits a person and refuses a model and a
 * step.*** That is the exact set this channel wants, and it took saying out
 * loud to see it:
 *
 * - **A person may pick a backdrop.** `engine-computed` refuses `model` and
 *   `step` and admits `user` — deliberately, and stated in `effects.ts` in as
 *   many words — so the manual path needs no policy of its own.
 * - **A model may not**, because a narrator choosing what the scene looks like
 *   is the narrator deciding where you are, which is a fact about the session
 *   rather than about the prose.
 * - **And P9's generator writes it through the engine rather than out of its
 *   step**, which is the route [P7.5]'s hook firing and [P7.6]'s goal
 *   achievement both take: what a new backdrop *means* for the session is the
 *   engine's to apply.
 *
 * *`user-only` was the tempting answer and is wrong for the third reason.*
 * [P7 §5] guessed this channel would be *"the build's first plausible
 * `user-only` subject"*; it is not, because P9 has to be able to write it and
 * `user-only` refuses everything but a person. (The first `user-only` channels
 * were hook pacing at [P7.5] and the two dials at [P7.8].)
 *
 * ***Text-only stays first-class, and `null` is how.*** §7.2: *"Text-only must
 * remain a fully supported first-class configuration, as it is in both
 * sources."* A session that never sets this reads `null` forever, renders
 * nothing, and costs nothing — no step runs, no prompt grows, and no surface
 * appears. **A backdrop is a thing a session may have, not a thing it lacks.**
 *
 * *`budget: null` and no `render`: a backdrop is shown, not described.* [06
 * §10.1a] is explicit that a background's own prompt comes from channel state
 * and the treatment's tone rather than from the turn — so the picture never
 * enters the narrator's prompt, and a channel that rendered *"you are in a
 * tavern"* into it would be inventing a second, quieter source of place.
 */
export const BACKDROP_CHANNEL: ChannelDefinition = {
  id: 'se.backdrop',
  owner: SCENE_ID,
  version: 1,
  scope: 'session',
  update: 'engine-computed',
  visibility: 'player',
  schema: {
    // `null` is in the schema, which is the invariant every channel is held to
    // since [P7.5] — and here it is also the *meaning* rather than only the
    // initial value: nothing showing is a state a scene returns to.
    oneOf: [...MEDIA_SELECTION_SCHEMA.oneOf, { type: 'null' }],
  },
  init: { kind: 'literal', value: null },
  budget: null,
  /**
   * **No `surface`, and its absence is the decision.** [10 §8]'s HUD is a strip
   * of short labelled values above the transcript, and a backdrop is neither
   * short nor a value — it is the picture *behind* the story, which is a place
   * in the layout rather than a row in a strip. A mode cannot declare that
   * place yet ([06 §9]'s *"contribute UI surfaces"* is the part of the contract
   * P7 does not build), so what ships is the state, and the surface that reads
   * it arrives with `surfaces`.
   */
};

/**
 * ***Whether this scene is staged at all*** — [06 §7.2], built at
 * [P7.12](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * §7.2: *"Text-only must remain a fully supported first-class configuration, as
 * it is in both sources."* This is the control that makes it a **configuration**
 * rather than an absence — with it off, no step runs, no channel moves, and
 * every region renders nothing.
 *
 * ***Off by default, and the argument is the third time this phase has made
 * it.*** Staging costs a model call per turn, and on a self-hosted build that is
 * the player's own machine roughly doubling the wait for a picture they may not
 * want. [P7.9]'s suggestion toggle made the same call for the same reason; what
 * makes a default of *off* honest rather than hiding the feature is that the
 * control is **on the screen either way**, which is what [P7.11] built.
 *
 * *`user-only`, because the person whose GPU it is decides.* A model turning its
 * own staging on would be the narrator deciding to spend somebody's machine.
 */
export const STAGING_CHANNEL: ChannelDefinition = {
  id: 'se.staging',
  owner: SCENE_ID,
  version: 1,
  scope: 'session',
  update: 'user-only',
  visibility: 'player',
  schema: { type: 'boolean' },
  init: { kind: 'literal', value: false },
  budget: null,
};

/**
 * ***Which face an actor is wearing*** — [06 §7.2]'s *expression selection*,
 * [P7.12].
 *
 * **Actor-scoped, like the three channels beside it in `sessions/cast.ts`.** A
 * scene has several people in it and each has their own face; a session-scoped
 * channel would hold one expression for everybody, which is not a smaller
 * feature but a wrong one.
 *
 * ***`model-proposed`, and that is what makes §7.2's "steps writing to channels"
 * true without touching a policy.*** An expression is a judgement about the
 * prose — *is she angry now* — so the actor that decides is a model, and
 * `model-proposed` is the policy that says so. A step may write it: `refuse()`
 * has no branch for this policy, so the staging step stamps
 * `{ kind: 'model', callId }` itself and the record says a model judged it.
 *
 * *This is worth stating because the obvious reading is that §7.2 forces
 * [25 C16].* `se.backdrop` is `engine-computed`, which refuses a step — so
 * *"steps writing to channels"* looks like a contradiction. It is not: the three
 * things §7.2 names have three different writers. A background's pointer is the
 * engine's and [P9] writes it; an expression is a model's judgement and a step
 * writes it; text-only is a person's setting. **C16 stays open and stays
 * unforced**, which is the right outcome for a question that should be answered
 * by a mode that cannot proceed without it.
 *
 * **No `render` and no `budget`**, for the reason `se.presence` gives: a face is
 * *shown*, not described, and a line saying *Vera: smiling* beside prose that
 * has her smiling is tokens spent to repeat the page. The surface is the
 * surface.
 */
export const EXPRESSION_CHANNEL: ChannelDefinition = {
  id: 'se.expression',
  owner: SCENE_ID,
  version: 1,
  scope: 'actor',
  update: 'model-proposed',
  visibility: 'player',
  schema: {
    // `null` is *no face chosen*, which is where every actor starts and where
    // one returns when nothing in the prose says otherwise.
    oneOf: [...MEDIA_SELECTION_SCHEMA.oneOf, { type: 'null' }],
  },
  init: { kind: 'literal', value: null },
  budget: null,
};

/**
 * ***Where this scene is*** — [06 §10.1a], [P7.12].
 *
 * **Declared here because [P9] assumes it and [P7.9] did not collect it.**
 * [P7 §0.1a] item 6 records the gap in as many words: *"P9's backdrop selector
 * assumes a **location channel** this phase declares; §P7.9 declares a backdrop
 * channel and no location one."* §10.1a's generator *"runs when the fragments
 * that describe the place actually change"* — this is what it diffs.
 *
 * ***A place, not a moment, and the distinction is load-bearing.*** [06 §10.1a]
 * says a background's prompt comes from *"channel state and the treatment's
 * tone — and pointedly not from the turn's output text"*, and this value **is**
 * distilled from the turn's output text, which looks like the line being
 * crossed. It is not, and the difference is what the sentence is about: what
 * §10.1a forbids is the backdrop carrying **the moment** — *"a backdrop that
 * redraws itself around each turn's action is an illustration wearing the wrong
 * clothes: it will put the fight in the wallpaper and then stay there for thirty
 * turns."* A location is a place: *the harbourmaster's office*, not *the
 * argument in it*. Said here because this is the most plausible place for that
 * line to get crossed by accident.
 *
 * *It does enter the prompt*, unlike the two above — a narrator that has been
 * told where the scene is writes a scene that stays there, which is the cheapest
 * continuity this mode has. Hence a `render` and a small `budget`.
 */
export const LOCATION_CHANNEL: ChannelDefinition = {
  id: 'se.location',
  owner: SCENE_ID,
  version: 1,
  scope: 'session',
  update: 'model-proposed',
  visibility: 'player',
  schema: { type: ['string', 'null'] },
  init: { kind: 'literal', value: null },
  render: 'Where this is happening: {{ value }}',
  // Roughly three times what a short place name renders to. Slack against an
  // author editing the template, not a target — the same posture the clock's
  // budget takes.
  budget: 32,
  surface: { kind: 'text', label: 'Place' },
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
  /**
   * **Two, and the second is [06 §7.2]'s** — [P7.12]. `NARRATE` first because
   * `generate` precedes `post`; the runner runs a stage's steps in declaration
   * order, and the stager reads what the narrator wrote.
   */
  steps: [NARRATE, STAGE_STEP],
  /**
   * ~~**A declaration the engine does not yet consult**~~ — **consulted since
   * [P7.0]**: `registerMode` installs a mode's declared channels, so this array
   * is what makes `se.clock` a channel effect application will accept rather
   * than a note about one. The old text is worth keeping because it names the
   * thing the move fixed: a declaration nothing reads is decoration, and this
   * one was decoration for five stages.
   */
  channels: [
    CLOCK_CHANNEL,
    BACKDROP_CHANNEL,
    STAGING_CHANNEL,
    EXPRESSION_CHANNEL,
    LOCATION_CHANNEL,
  ],
  /**
   * One kind, matching what the wire already defaults to — so nothing that
   * works today stops working. `say` / `think` / `story` arrive with the
   * input-kind selector, which is a surface this stage does not build.
   */
  inputs: ['do'],
  /**
   * ***Where the scene shows up*** — [06 §9]'s fifth bullet, declared at
   * [P7.12] against the machinery [P7.11] built.
   *
   * **Three regions and each is a different kind of thing**, which is the
   * argument for the vocabulary having more than one: a backdrop is the picture
   * *behind* the story, a face belongs *beside the line* that person speaks, and
   * a switch belongs in the panel with the other switches. Collapsing any two of
   * them into [10 §8]'s HUD strip would put a picture in a row of short labelled
   * values.
   *
   * ***`se.location` is not here and its absence is the shorthand working***:
   * it declares `surface` on the channel, which {@link SurfaceContribution}
   * defines as exactly `{ region: 'hud', channelId: 'se.location', widget }`.
   * Restating it here would contribute it twice.
   *
   * **With staging off all three render nothing**, which is [10 §2.3]'s
   * requirement rather than tidiness: *"with the backdrop off Play is the
   * surface it was before, not a surface with an empty frame in it."* The two
   * image channels init to `null` and the renderer skips a surface with no
   * value; the toggle is the one thing that shows, because a control you cannot
   * find is a feature that does not exist.
   */
  surfaces: [
    { region: 'stage', channelId: BACKDROP_CHANNEL.id, widget: { kind: 'image', label: 'Scene' } },
    {
      region: 'message',
      channelId: EXPRESSION_CHANNEL.id,
      widget: { kind: 'image', label: 'Expression' },
    },
    {
      region: 'panel',
      channelId: STAGING_CHANNEL.id,
      widget: { kind: 'toggle', label: 'Show the scene' },
    },
  ],
  setup: { kind: 'none' },
};

export const SCENE_MODE: Mode = {
  definition: SCENE,
  run: { [NARRATE.id]: narrate, [STAGE_STEP.id]: stage },
};
