// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { MEDIA_SELECTION_SCHEMA } from '@storyengine/sdk';
import type {
  ChannelDefinition,
  Mode,
  ModeDefinition,
  OutputMessage,
  StepDefinition,
  StepHost,
  StepInput,
  StepResult,
} from '@storyengine/sdk';

import { ECHO_CHANNELS, ECHO_STEP, ECHO_SURFACES, echo } from './echo.js';
import { EDIT_CHANNELS, EDIT_STEP, EDIT_SURFACES, edit } from './edit.js';
import { PLOT_CHANNELS, PLOT_STEP, PLOT_SURFACES, plot } from './plot.js';
import { SCENE_PRESET } from './preset.js';
import { STAGE_STEP, stage } from './staging.js';
import { TRACK_STEP, TRACKING_CHANNELS, TRACKING_SURFACES, track } from './tracking.js';

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
 * build error. That is [20 §10](../../../../docs/design/20-tech-stack.md)'s
 * *"cheapest possible enforcement of the design's central bet"* actually
 * enforcing something.
 *
 * **Nothing here is conditional on being a built-in.** [23 §4.1](../../../../docs/design/23-extensions.md)
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
   * now, so the field can mean what 06 §4 says it means. *Where a pack
   * positions it*, which Scene's did not until 2026-09-30 (`se.clock` in
   * `preset.ts`): a budget bounds a slot, and there was none.
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
/**
 * ***Whether this scene stages a backdrop at all*** — [06 §10.6], [10 §2.3],
 * declared at [P9.4](../../../../docs/design/workplan/26-p9-implementation.md).
 *
 * ***Scene's rather than the engine's, and that is the one place the backdrop
 * half of P9 is genuinely mode-shaped.*** `se.illustrate` is engine-owned
 * because every mode can want a picture of a turn; this one turns on a generator
 * that writes {@link BACKDROP_CHANNEL}, and a mode with no backdrop channel has
 * nowhere to put the result. A package-owned switch would appear in Freeform
 * offering a control with no mechanism behind it, which is worse than no
 * control.
 *
 * **Off, or on — and there is no per-turn setting to offer** ([06 §10.6]).
 * *On* means when the place changes: a backdrop that regenerated every turn is
 * the failure mode rather than the thorough option, and the digest that makes
 * that true is [P9 §1.7]'s.
 *
 * *Off by default, for the third time in this file and the same reason
 * `STAGING_CHANNEL` below gives*: staging costs a model call per turn and a
 * backdrop costs an image, which on a self-hosted build is the player's own
 * machine. **The control is on the screen either way**, which is what makes a
 * default of off honest rather than a feature nobody finds.
 *
 * *`user-only`, because the person whose GPU it is decides* — and because a
 * model that could switch this on would be choosing to spend money mid-scene.
 */
export const BACKDROP_ON_CHANNEL: ChannelDefinition = {
  id: 'se.backdrop.on',
  owner: SCENE_ID,
  version: 1,
  scope: 'session',
  update: 'user-only',
  visibility: 'player',
  schema: { type: 'boolean' },
  init: { kind: 'literal', value: false },
  budget: null,
};

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
 * [26 C16].* `se.backdrop` is `engine-computed`, which refuses a step — so
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
 * continuity this mode has. Hence a `render` and a small `budget`. ~~It does~~
 * *It did not, until 2026-09-30*: a `render` says how the value reads, and only
 * a slot puts a channel in a prompt — the pack's `se.location`, placed since.
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
 *
 * ***It asks in one of three ways since [P14.2]***, and the session says which
 * — `voice` and `dispatch` as `StepInput` hands them over, the session's own
 * values rather than the ones declared below
 * ([P14 §1.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [§1.4](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)):
 *
 * - **Narrator** — exactly what this step always did: one merged call, spoken by
 *   nobody in particular, and one `message`. Who the policy selected does not
 *   change it; a narrator speaks for the scene, not for a member — and
 *   `dispatch` does not change it either; [06 §3]'s *narrator + per-actor* cell
 *   is not built (P14.2 as-built). *Absent* reads as narrator, because that is
 *   what a host that hands no voice played.
 * - **Embodied, per-actor** — one **speaking call** per selected member, in the
 *   order `speakers` gives, each awaited before the next: the host shows each
 *   call the replies before it, streams each into a message of its own and
 *   cleans it, so the loop's only job is the order. The order *is* the
 *   selection's, which is what makes a rewrite replay the same round — the
 *   policy's draws are on the tape, and this loop adds none. The turn's
 *   `messages` are the calls' results, speaker and all — *a reply cleanup cut
 *   to nothing included*, deliberately (2026-09-29, the [P14.2] review): it
 *   stays as an empty message under the speaker's name so its `original` stays
 *   on the record, and `output.text` leaves it out, since it said nothing.
 * - **Embodied, merged** — Marinara's merged mode: **one** speaking call, for
 *   the first selected member. Every present card is still in its prompt, the
 *   first speaker's first, and the reply may voice several members; nothing
 *   splits it and nothing cuts it, because a merged reply that stopped at the
 *   second member's line would not be merged. One message, under the first
 *   speaker's name — and the model is the scene's, not theirs: [06 §3] consults
 *   a card's hint only under `per-actor`, so the host resolves a merged speaking
 *   call with none.
 *
 * ***An empty `speakers` in an embodied voice is nobody speaking, and the step
 * makes no call*** — `manual` after an input ([P14 §1.3]: *"nobody replies to
 * an input"*), or a round the policy gave nobody. It returns nothing, which is
 * what an absent output has always meant on the record: the turn is the
 * player's input and no reply. *Absent `speakers` is different* — a session
 * playing `fixed`, which makes no selection at all — and an embodied session
 * with no selection makes the one merged call nobody in particular speaks,
 * rather than falling silent for good.
 *
 * *If a speaking call fails*, the loop lets it go: a failure on the first is
 * the step's own `abort`, and a failure after another member has spoken is a
 * partial round the host keeps. The step has nothing to add to either, which
 * is why it catches nothing.
 */
async function narrate(input: StepInput, host: StepHost): Promise<StepResult> {
  if (input.voice !== 'embodied' || input.speakers === undefined) {
    const result = await host.call({ stream: true });
    return { message: { text: result.text } };
  }

  const speakers = input.dispatch === 'per-actor' ? input.speakers : input.speakers.slice(0, 1);
  const messages: OutputMessage[] = [];
  for (const speaker of speakers) {
    const result = await host.call({ stream: true, speaker });
    messages.push({
      // The host names the speaker as the record will; a host too old to
      // say is answered with the id, which is at least who it was.
      speaker: result.speaker ?? { id: speaker, name: speaker },
      text: result.text,
      ...(result.original === undefined ? {} : { original: result.original }),
    });
  }
  return messages.length === 0 ? {} : { messages };
}

export const SCENE: ModeDefinition = {
  id: SCENE_ID,
  version: '1.0.0',
  displayName: 'Scene',
  /**
   * ***A chat among embodied characters, since [P14.3]*** —
   * [P14 §1.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md):
   * *"Scene's declared values become `embodied`, `per-actor`, `natural`."*
   * ~~`voice: 'narrator'`, `dispatch: 'merged'`~~ until then.
   *
   * **What a new session is created with, and nothing more.** Creation writes
   * these into the session (`chatSettingsAtCreation`), a session's own values
   * win over them, and a session written before [P14.0] reads `legacy` below —
   * so the flip re-voices nobody's saved game. *Narrated is one control away*
   * (`voice: 'narrator'` on the session), and the pack serves both voices
   * (`preset.ts`). In a single-character chat `per-actor` and `merged` are the
   * same single call.
   */
  voice: 'embodied',
  dispatch: 'per-actor',
  /**
   * ***What a Scene session written before [P14.0] was played as*** —
   * [P14 §1.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   *
   * ~~**The same three values declared above, and written down before they
   * move.**~~ *They moved at [P14.3]*, and this is what keeps them from moving
   * anybody: every Scene session made before P14.0 carries none of the three
   * fields, absence meant these, and `chatSettingsOf` reads such a session
   * through this rather than through the values above (pinned against the real
   * Scene in `sessions/chat-settings.test.ts`). Such a session also holds its
   * own copy of the pack it was created with, narrator instruction and all
   * (`SessionFile.preset`).
   */
  legacy: { voice: 'narrator', dispatch: 'merged', select: 'fixed' },
  /**
   * ***A chat opens on its cast's greetings*** — [P14 §1.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * [P14.4]: a new Scene session is written an opening turn from each
   * member's written openings, as SillyTavern opens a chat on `first_mes`.
   */
  openingTurn: true,
  /**
   * Empty by fact rather than by omission. [06 §1] names presets for Adventure;
   * Scene has no second way to be configured, and minting `scene.default` would
   * create a permanent content identifier for a distinction nothing makes.
   */
  presets: [],
  /**
   * ***Who replies: SillyTavern's natural order over a cast that is all here***
   * — [P14 §1.2], [P14 §1.3], declared at [P14.3] (~~`{ select: 'fixed',
   * maxActors: 1 }`~~ until then).
   *
   * - `natural` — mentions, then talkativeness rolls, then somebody: ST's
   *   default group strategy, and the session's to change.
   * - `castIsPresent` — a declared member nobody has said anything about is in
   *   the scene, and presence `false` is **muted**: ST's `disabled_members`,
   *   the cast panel's checkbox. A muted member is not picked, and their cards
   *   leave every call they are not speaking on.
   * - `maxActors: 32` — the cast route's own ceiling (`CastBody.actors`), a
   *   bound on a request body rather than a claim about groups; neither source
   *   caps a group.
   */
  participants: { select: 'natural', castIsPresent: true, maxActors: 32 },
  assembly: { defaultPreset: SCENE_PRESET, historyWindow: 20 },
  /**
   * **Two, and the second is [06 §7.2]'s** — [P7.12]. `NARRATE` first because
   * `generate` precedes `post`; the runner runs a stage's steps in declaration
   * order, and the stager reads what the narrator wrote.
   */
  /**
   * ***Three since [P14.5a]***: the trackers after the stager, both `post`
   * and both reading what the narrator wrote. After, because staging is the
   * cheaper question and neither reads the other.
   */
  /**
   * ***Four since [P14.5b]***: the secret plot's pass first, because it is
   * `pre` — an arc it writes steers this turn's reply, and the runner puts the
   * engine's director after it so a push reads the fresh arc.
   *
   * ***Six since [P14.5c]***: the editor straight after the narrator, first
   * among the `post` steps, so everything after it — the stager, the
   * trackers, the engine's own passes — reads the prose the turn is written
   * with; and the echo chamber last of Scene's, reacting to that prose.
   */
  steps: [PLOT_STEP, NARRATE, EDIT_STEP, STAGE_STEP, TRACK_STEP, ECHO_STEP],
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
    BACKDROP_ON_CHANNEL,
    STAGING_CHANNEL,
    EXPRESSION_CHANNEL,
    LOCATION_CHANNEL,
    /**
     * ***The six trackers, their switches, the locks, the hidden fields and
     * the cadence*** — [P14 §1.9.2], [P14.5a]; `tracking.ts` argues each.
     *
     * *`se.location` stays beside `se.track.world`'s `location`*, and the two
     * are not the same fact told twice by accident: `se.location` is the
     * **place** the stager names for the backdrop to diff ([06 §10.1a] — a
     * place, never a moment), written every staged turn whether or not any
     * tracker is on; the world tracker's is part of what the story has
     * established, written only when a person switched it on. Folding one into
     * the other would make the backdrop depend on a tracker, or a tracker on
     * staging. Recorded rather than resolved.
     */
    ...TRACKING_CHANNELS,
    // The secret plot, its switch, its reveal and its cadence — [P14.5b], `plot.ts`.
    ...PLOT_CHANNELS,
    // The editor's switches, rules and hold; the echo chamber — [P14.5c].
    ...EDIT_CHANNELS,
    ...ECHO_CHANNELS,
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
    /**
     * ***The backdrop's own control*** — [06 §10.6], [10 §2.3], added at
     * [P9.4](../../../../docs/design/workplan/26-p9-implementation.md).
     *
     * **A toggle, and there is no per-turn setting to offer**: *on* means when
     * the place changes, and a backdrop that regenerated every turn is the
     * failure mode rather than the thorough option. That is the whole of why
     * this control has two states where `se.illustrate` has three.
     *
     * *In the panel beside `Show the scene`*, which is where a setting lives —
     * the `stage` region above is where the **picture** goes, and a switch
     * floating over a backdrop would be a control competing with the thing it
     * controls.
     *
     * **Visible with the backdrop off**, which is the sentence two paragraphs up
     * applied to this feature: with it off Play is the surface it was before,
     * and the one thing that shows is the control, *because a control you cannot
     * find is a feature that does not exist*.
     */
    {
      region: 'panel',
      channelId: BACKDROP_ON_CHANNEL.id,
      widget: { kind: 'toggle', label: 'Stage a backdrop' },
    },
    // The trackers' cards and their switches — [P14.5a], see `tracking.ts`.
    ...TRACKING_SURFACES,
    // The secret plot's switch, cadence, reveal and card — [P14.5b], `plot.ts`.
    ...PLOT_SURFACES,
    // The editor's and the echo chamber's settings, and the chorus's panel — [P14.5c].
    ...EDIT_SURFACES,
    ...ECHO_SURFACES,
  ],
  /**
   * ***What Scene wants of pictures before anybody says otherwise*** —
   * [06 §10.6]'s *"per mode defaults, since Scene wants illustration far more
   * than a text-only Freeform does"*, [P9.4].
   *
   * **`on-demand` rather than `each-turn`, and that is the honest reading of
   * what a default may decide.** §10.6 asks for per-mode defaults and this is a
   * mode that stages scenes — but *each turn* spends money on every turn of
   * every session, and a **default** that does that is a build deciding to spend
   * somebody's machine on their behalf. `on-demand` is the setting that says
   * *the **Illustrate** action works and nothing runs on its own*, which is the
   * most a default can honestly claim.
   *
   * **A creation-time default, not a runtime source.** The session's
   * `se.illustrate` channel is the one thing that decides at runtime; this is
   * what gets written into it when a session is made — the rung [04 §6.1b]
   * leaves open below *a Treatment proposes, a Setup overrides, and the running
   * session owns it*.
   */
  renditions: { illustration: 'on-demand' },
  setup: { kind: 'none' },
};

export const SCENE_MODE: Mode = {
  definition: SCENE,
  run: {
    [PLOT_STEP.id]: plot,
    [NARRATE.id]: narrate,
    [STAGE_STEP.id]: stage,
    [TRACK_STEP.id]: track,
    [EDIT_STEP.id]: edit,
    [ECHO_STEP.id]: echo,
  },
};
