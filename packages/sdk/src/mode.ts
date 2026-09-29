// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Preset } from '@storyengine/shared';

import type { ChannelDefinition, WidgetSpec } from './channels.js';
import type { StepDefinition, StepImplementation } from './steps.js';

/**
 * A mode's manifest — [06 §2](../../../docs/design/06-modes-and-turn-pipeline.md).
 *
 * **Not one function anywhere on this type, and that is the contract rather
 * than a style.** §2 says a built-in mode needing a back door means the contract
 * is wrong and gets fixed rather than bypassed; §5 says the assembly plan
 * *"declares the ordering constraints and budget policy; it does not build
 * strings"*. A `collect()` on this shape would be exactly that back door — and
 * would also mean the collector P4 needs for imported presets is a second
 * implementation of the same thing.
 *
 * So a mode is data. What it *runs* is named by step id and looked up
 * separately, which is the split [22 §3] draws and what becomes a worker
 * dispatch table at P7.
 */
export interface ModeDefinition {
  /**
   * `storyengine.scene`. **Content, not code** — it lands in `session.json`, so
   * changing it later is a migration over somebody's saved games.
   */
  id: string;
  version: string;
  /**
   * Developer- and log-facing. **Never rendered**: [01 §2] keeps English out of
   * what the server sends, so a client that wants a label keys off `id`.
   */
  displayName: string;

  /**
   * [06 §3]'s two axes, fixed per mode at P2.6 ([P2 §2.4] names both).
   *
   * **Neither has an engine consumer at this stage, and saying so is the point.**
   * §2.4 enumerates them as part of what the mode declares, and §3 makes them a
   * pair — declaring one without the other would misstate the mode. ~~At P7 they
   * become optional *session* fields whose absence means the mode's value, which
   * is a field rather than a migration.~~ *Corrected 2026-09-29: P7 never did
   * it* — [P7.3] deferred the fields to [P7.9], whose record never mentions
   * them ([P13 §0.6](../../../docs/design/workplan/30-p13-scene-and-session-import.md)).
   * **They became optional session fields at [P13.0]**, and these are now what
   * a new session is *created with* rather than what every session reads:
   * creation writes them onto the session explicitly, and `chatSettingsOf` in
   * the server reads the session's own before these. What keeps them honest
   * meanwhile is a test pinning them against what the default preset's narrator
   * block actually instructs.
   */
  voice: 'narrator' | 'embodied';
  dispatch: 'merged' | 'per-actor';
  /**
   * ***What a session that predates this mode's current declared values reads
   * as*** — [P13 §1.2](../../../docs/design/workplan/30-p13-scene-and-session-import.md),
   * added at [P13.0].
   *
   * **The problem it exists for is a default that moves.** Absence on a session
   * has always meant *the mode's value*, and P13 changes Scene's values from
   * `narrator`/`merged`/`fixed` to `embodied`/`per-actor`/`natural`. Without this,
   * that change would silently re-voice every Scene session anybody has ever
   * played: a chat narrated in the third person for forty turns would answer
   * turn forty-one in the first. So creation now writes the three values
   * explicitly, and a session carrying **none** of them — which is exactly the
   * set written before that — reads these instead of the declared ones.
   *
   * ***A declaration, not a migration***, and the difference is the whole
   * choice. A migration would rewrite `session.json` under every existing
   * session, which needs each one's lock and is a write nobody asked for; this
   * says what those files already mean and leaves them as they are. It also
   * belongs to the mode rather than to the engine: only the mode knows what it
   * used to declare.
   *
   * Absent means the declared values, which is every mode whose values have
   * never moved — and a mode that declares this before it moves anything reads
   * the same either way, which is what lets it be written ahead of the change it
   * exists to survive.
   */
  legacy?: {
    voice: ModeDefinition['voice'];
    dispatch: ModeDefinition['dispatch'];
    select: ParticipantPolicy['select'];
  };

  /**
   * **Named configurations of this mode** — [06 §1]'s *freeform* / *campaign*.
   *
   * Not the portable prompt-pack `Preset`: two different things one word apart,
   * and the same collision that forced the assembler's `CallKind` to be renamed
   * `CallPurpose`.
   */
  presets: readonly ModePreset[];

  participants: ParticipantPolicy;
  assembly: AssemblyPlan;
  steps: readonly StepDefinition[];
  /** Channels this mode **enables**. It does not implement them ([06 §4]). */
  channels: readonly ChannelDefinition[];
  /**
   * Input kinds this mode accepts — `do`, `say`, `think`, `story`, `choice`.
   *
   * `string[]` rather than an alias: a union containing `string` collapses to
   * `string`, and the alias would be documentation pretending to be a type.
   */
  inputs: readonly string[];
  surfaces: readonly SurfaceContribution[];
  /**
   * ***What this mode wants of renditions before anybody says otherwise*** —
   * [06 §10.6]'s *"per mode defaults, since Scene wants illustration far more
   * than a text-only Freeform does"*, added at
   * [P9.4](../../../docs/design/workplan/26-p9-implementation.md).
   *
   * **A creation-time default, not a runtime source.** The session's
   * `se.illustrate` channel is the one thing that decides at runtime; this is
   * what is written into it when a session is made. That is the rung
   * [04 §6.1b] leaves open below *"a Treatment proposes, a Setup overrides, and
   * the running session owns it"*.
   *
   * ***Here rather than in the channel's `init`***, and the difference is not
   * cosmetic: `init` is per **channel** and this is per **mode**, so two modes
   * declaring `se.illustrate` with different initial values would be the
   * configuration problem `registerChannel`'s last-write-wins rule is resigned
   * to rather than a design. The channel is package-owned and has one `init`;
   * what varies is which mode is being played.
   *
   * **The backdrop is deliberately absent from this field.** Its switch is the
   * declaring mode's own channel ([P9.4]), because a mode with no backdrop
   * channel has nowhere to put the result — so *whether this mode stages one*
   * is already answered by whether it declares one.
   *
   * Absent means off, which is every mode that says nothing.
   */
  renditions?: { illustration?: 'off' | 'on-demand' | 'each-turn' };
  /**
   * ***Whether a new session opens on its cast's written openings*** —
   * [P13 §1.7](../../../docs/design/workplan/30-p13-scene-and-session-import.md),
   * added at [P13.4].
   *
   * `true` makes session creation write an **opening turn**: output only, no
   * call and no `request`, one message per cast member with a written opening —
   * SillyTavern's greeting, which a chat opens on before anybody has typed. A
   * single-character session writes the primary opening with each alternate as
   * a sibling (ST's greetings-as-swipes); a group writes each member's primary,
   * in cast order, as one message each.
   *
   * ***A declaration rather than a rule the engine infers***, because the
   * engine may not name a mode and nothing it could read instead means this.
   * `voice: 'embodied'` is the nearest, and the assistant is embodied too: an
   * assistant session that greeted with whatever card was cast would be a
   * mode's behaviour decided by a setting that says something else. Absent
   * means no opening turn, which is every session every mode made before
   * P13.4 — so a mode that says nothing is unchanged.
   */
  openingTurn?: boolean;
  setup: SetupSchema;
}

/** `config` is opaque and never interpreted by the host ([04 §7]). */
export interface ModePreset {
  id: string;
  config: unknown;
}

/**
 * ~~[P2 §2.4]'s *"no participant policy beyond the user and one actor"*, written
 * as exactly that.~~ **[06 §7.2]'s taxonomy, widened at [P7.3]** — 2026-09-12.
 *
 * `select: 'fixed'` was load-bearing rather than decorative: it was **the
 * declaration that the cast cannot change as an outcome of a turn**, which is
 * what licensed a plain `cast` field on the session instead of an `se.party`
 * channel — the channel [P2 §2.7] rejected as placeholder-shaped. That licence
 * expired here, and `se.party` landed in the same commit, which is what
 * `sessions/cast.test.ts`' tripwire was built to force.
 *
 * *What the field no longer licenses and never did is the **roster**: [P7.3]
 * measured that `se.presence`'s `init: false` cannot express one, so
 * `cast.actors` stays a session field and the two casts are reconciled in
 * `resolveCast` instead. The tripwire carries that correction.*
 *
 * **The four arms are SillyTavern's activation strategies**, which [06 §7.2]
 * takes as the taxonomy — *"with the implementation being **the policy selects
 * speakers**, not card-swapping"*. So none of them decides who is in the story;
 * they decide who talks this turn, over whoever presence and status say is
 * available:
 *
 * - ~~`natural` — whoever the scene just addressed. The heuristic is the last
 *   turn's prose scanned for names, which is ST's and is honestly a heuristic.~~
 * - ~~`list` — each in turn, rotating.~~
 * - ~~`pooled` — one at random, drawn on the turn's tape so a replay is the same
 *   scene.~~
 * - ~~`manual` — whoever the player named with the input, and nobody otherwise.~~
 *
 * ***Corrected 2026-09-29, at [P13.1]: those four lines named ST's arms and
 * described something else.*** [P7.3] took the taxonomy and not the behaviour
 * — [P13 §0.7](../../../docs/design/workplan/30-p13-scene-and-session-import.md)
 * lays the two side by side — and nothing noticed because no shipped step read
 * the answer. The arms now do what `group-chats.js` does at the pinned commit
 * ([P13 §1.3]), every random choice on the turn's tape:
 *
 * - `natural` — the default for a chat. Whoever the **activation text** names
 *   (the input, or the last message when there is none), in the order the
 *   words appear; then **every** member whose talkativeness roll succeeds; then,
 *   if still nobody, one member at random. The last speaker sits out a turn
 *   the player did not start, unless self-responses are allowed. *Not a
 *   prose-only scan, and not able to answer nobody* while anybody is eligible.
 * - `list` — **everybody** eligible, once each, in cast order. Not a rotation
 *   of one: that was P7.3's reading, and ST's LIST (and Marinara's
 *   `sequential`) is the whole group replying in turn within one round.
 * - `pooled` — one member. After an input, anyone; on a turn with no input,
 *   one who has not spoken since the last input, else anyone but the last
 *   speaker.
 * - `manual` — **nobody** replies to an input; replies are asked for by name
 *   (force-talk, which overrides every arm). A turn with no input gets one
 *   member at random, which is ST's and is what keeps *let them talk* from
 *   silently doing nothing.
 *
 * **And a fifth, `smart`, which is not ST's** — [P13 §1.3a], Marinara's
 * `smart` order built the way the hook selector is. The rules decide whenever
 * they can (force-talk, a mention, a room of one); otherwise an engine step
 * asks a model, with `natural`'s pick drawn beforehand as the fallback. It is
 * the one arm that can cost a call, which is why §1.3a puts the cost in the
 * control's label. The step is `se.speakers.smart`, engine-owned and planned
 * only on a turn the rules could not settle; a session may point its
 * `stepRoles` at that id to send the call to a cheaper model.
 *
 * **Lowercase, where the design note writes them as ST's constants.** A
 * `select` value lands in a mode definition, which is *content*, and every
 * neighbouring vocabulary in this file is lowercase — `merged`, `per-actor`,
 * `narrator`, `embodied`. `NATURAL` would be the only shouted id in the build,
 * spelled that way because a different program spells its enum that way.
 *
 * **`fixed` stays and is not one of the four.** It is the honest answer for a
 * mode that seats one actor, and removing it would force Scene to claim a
 * selection strategy for a choice it does not make. *It also stays after
 * [P13.1]*: a pre-P13 Scene session reads as `fixed` through
 * `ModeDefinition.legacy`, and a session file naming it has to keep meaning
 * what it meant.
 */
export const PARTICIPANT_SELECTORS = [
  'fixed',
  'natural',
  'list',
  'pooled',
  'manual',
  'smart',
] as const;

export interface ParticipantPolicy {
  /**
   * **A runtime list as well as a type, so a deferral can be held to it** —
   * [P7.2], 2026-09-11. ***It worked: the arm landed at [P7.3] and the test went
   * red, which is how one of its three clauses came to be examined and
   * withdrawn.***
   *
   * The docstring above says `select: 'fixed'` is what licenses a plain `cast`
   * field instead of an `se.party` channel. That licence expired the moment a
   * second arm landed, and the only thing that would otherwise have noticed was
   * somebody remembering — which, on [P7 §0.1a]'s evidence, is what a deferral
   * routed to a later phase does not survive.
   */
  select: (typeof PARTICIPANT_SELECTORS)[number];
  /**
   * ***A declared cast member with no presence value is present; presence
   * `false` is muted*** —
   * [P13 §1.3](../../../docs/design/workplan/30-p13-scene-and-session-import.md),
   * added at [P13.1].
   *
   * **The problem is a default that made every arm select from nobody.**
   * `se.presence` has been the eligibility test since [P7.3], its `init` is
   * `false` because *a cast member nobody has mentioned is not in the scene*,
   * and nothing in the build writes it — so under that reading nobody was ever
   * eligible, and a selector could only ever answer an empty room. That
   * default is right for a story whose cast wanders in and out of rooms, and
   * wrong for a chat: somebody who added three characters to a group expects
   * three characters in it.
   *
   * ***So a mode says which reading it plays, rather than the engine choosing
   * one for everybody.*** Declared, a card on the session's cast is in the
   * scene until something says otherwise, and presence `false` becomes
   * **muted** — SillyTavern's `disabled_members`, Marinara's
   * `inactiveCharacterIds`, and the checkbox the cast panel already draws. A
   * muted member is still in the cast, still in the prompt, and still reachable
   * by force-talk, which is exactly what ST's `force_chid` does with a disabled
   * member (`group-chats.js:1006`).
   *
   * Absent means the old reading — present only when presence says `true` —
   * which is every mode that has not asked, and which is why declaring it is
   * not a migration of anybody's saved games.
   *
   * *No built-in mode declares it yet.* Scene is the one meant to, and the
   * design dates that twice — [P13 §1.2] and §1.3 read as P13.1, §3's stage
   * list as [P13.3] with the rest of Scene's declared values; P13.1 follows
   * the stage list, and `speakers.ts`'s `naturalOrder` says why.
   */
  castIsPresent?: boolean;
  /**
   * How many actors a person may seat, checked at the create and cast routes.
   *
   * **An input bound on configuration, not a cap on the story.** A character the
   * model walks into a three-seat scene is already there; `resolveCast` loads
   * their card and the budgeter decides what fits, because refusing would
   * assemble the turn around somebody the record says is present ([P7.3]).
   */
  maxActors: number;
}

/**
 * [06 §5]: declares ordering constraints and budget policy, and does not build
 * strings.
 *
 * Both live in the preset — the order *is* the block order, the budget *is*
 * `Preset.budget` — so this names the preset plus the one bound a preset cannot
 * express.
 */
export interface AssemblyPlan {
  /** The prompt pack a session gets a resolved copy of when it is created. */
  defaultPreset: Preset;
  /**
   * How many turns of the path are offered to the budgeter. An **input bound**,
   * not a budget rule: the budgeter still drops what does not fit.
   */
  historyWindow: number;
}

/**
 * The wizard, declared rather than coded ([06 §2]).
 *
 * A real state, and session creation is its consumer: POST /api/sessions
 * resolves the mode and writes a null config without asking anybody anything,
 * which is exactly what a no-wizard mode means. ~~The field vocabulary a *real*
 * wizard needs is P7's, and guessing it is what [21 §6] refuses to do for
 * `WidgetSpec`.~~ **The vocabulary arrived at [P7.4]** — see
 * {@link DeclaredSetup}. Scene still declares this arm, and should: it has
 * nothing to ask.
 */
export interface NoSetup {
  kind: 'none';
}

/**
 * One field a mode asks for before a session starts.
 *
 * **No `schema` beside the widget, deliberately.** A toggle is a boolean, a
 * choice is one of its options' values, and a text field is a string — so a
 * schema alongside would be a *second description of the same field*, which is
 * the thing that drifts. `library/fields.ts` makes this argument for the
 * portable kinds and has the receipt: *"any hand-written list of a kind's
 * fields is a second description"*. Here the widget is the description, and
 * {@link setupAnswerSchema} derives what the answer is validated against.
 *
 * *What that gives up is a cross-field constraint — `endDate` after `startDate`.
 * A wizard is not the place for one: the mode's own steps see the answers and
 * can say so in words a person can act on, where a schema can only refuse.*
 */
export interface SetupField {
  /** The key this field's answer lands under. */
  id: string;
  widget: FieldWidget;
  /**
   * Whether a session may be created without it.
   *
   * Absent means optional, which is the safer default in the direction that
   * matters: a mode that forgets the flag asks for something and accepts
   * nothing, where the reverse would refuse every session over a field the
   * author meant as a nicety.
   */
  required?: boolean;
}

/**
 * A mode that asks for something before the first turn — [06 §7.3], [P7.4].
 *
 * **The declaration is the whole wizard.** [06 §2] says a mode needing a back
 * door means the contract is wrong and gets fixed rather than bypassed, and a
 * setup form is where that is most tempting: every engine grows a
 * mode-specific screen eventually. So there is no screen — there is a list of
 * fields, and the host renders it. The stage's own exit line is a wizard *"for a
 * mode the engine has no knowledge of, rendered from its declaration alone"*.
 *
 * **Fields now; generated parts next.** [06 §7.3] wants setup to produce *"world
 * overview, map, cast, sheets and widgets as **separate validated
 * generations**, each individually retryable, applied as they succeed"* — which
 * [00 §2.3] calls the single biggest reliability difference available versus the
 * source. That is a second list beside this one and it needs a generator; what
 * it does not need is a different shape for the answers, which is why they come
 * first.
 */
export interface DeclaredSetup {
  kind: 'declared';
  fields: readonly SetupField[];
  /**
   * What is generated from the answers — [06 §7.3], [P7.4].
   *
   * ***`StepDefinition`, because a part **is** a step.*** [06 §7.3] wants setup
   * to produce *"world overview, map, cast, sheets and widgets as separate
   * validated generations, **each individually retryable, applied as they
   * succeed**"* — and read back, that sentence describes the step loop. An
   * ordered list of declarations, each with its own model call, its own schema,
   * its own `failure` policy, its own record in `StepOutcome`, and effects
   * applied as each one returns. Every clause already exists; a second
   * generation pipeline beside the turn would have been a second implementation
   * of all of it, differing in the places nobody checked.
   *
   * **So setup runs as a turn** — the session's first, with the answers as its
   * input. That is the record-shape decision this list rests on, and it is worth
   * stating because [P7.3] rejected a creation-time turn for the roster: there
   * it would have given *every* session with a cast a blank first transcript
   * entry, for a shape that did not work anyway. Here a turn happens only when a
   * mode declares parts and generation actually runs, and what it records is
   * true — the world was made, it took model calls, and they cost something.
   *
   * *Zipped against the same `run` table the steps are, so a part's
   * implementation is written where a step's is and `assertModesRunnable` proves
   * both at startup.* A part's `stage` is the turn pipeline's vocabulary and
   * `generate` is the honest value; overloading `StepStage` with a `setup` arm
   * would make one member mean *a different occasion* where the other five mean
   * *a position within a turn*.
   */
  parts?: readonly StepDefinition[];
}

/**
 * **A union now, which is what the one-arm note predicted.** *"P7's real wizard
 * adds arms rather than fields, and a type that started as an interface would
 * have to be widened at the point every consumer already narrowed"* — so the
 * union was written before there was anything to union, and this is the arm it
 * was written for.
 */
export type SetupSchema = NoSetup | DeclaredSetup;

/**
 * How a setup field is asked — [10 §8](../../../docs/design/10-ui-surfaces.md)'s
 * declarative vocabulary, for input.
 *
 * **Separate from {@link WidgetSpec}, and the split is not bureaucracy.** That
 * one renders a value the engine already holds; this one asks for a value nobody
 * holds yet. Sharing the `kind` vocabulary would make `text` mean *show a
 * string* in one place and *ask for a string* in another, which is the sort of
 * quiet double meaning that costs an afternoon the first time somebody trusts
 * it. What the two **do** share is 10 §8's terms, and they apply here in full:
 * declared and never shipped, so an extension cannot break the app's rendering
 * and the frontend framework stays a reversible decision; the vocabulary keeps
 * growing rather than acquiring an escape hatch; and **never an `html: string`
 * field**, which 10 §8 names as *"how this decision would be undone by accident
 * rather than on purpose"*.
 *
 * **Three arms, each with a named subject in [06 §7.3].** That section asks for
 * a difficulty *"named entry"* chosen from a ranked list (`choice`), a world
 * overview written in prose (`text`), and *"dice, HP or inventory channels
 * available as **toggles** rather than as a different mode"* (`toggle`). A
 * `number` arm has no subject anywhere in the corpus and is not here — the same
 * rule `WidgetSpec`'s single arm and `InitPolicy`'s two are held to.
 *
 * *A `ref` arm — pick a lorebook, pick an actor — is deliberately absent for a
 * different reason: session creation already takes `treatment`, `cast` and
 * `lore` as its own parameters, so a mode asking for them through a wizard would
 * be a second way to say the same thing.*
 */
export type FieldWidget =
  | {
      kind: 'text';
      label: string;
      /** A sentence under the control. Whole, never a fragment — [work plan §2]. */
      hint?: string;
      /**
       * How tall to draw it. **Presentation, and legitimately so here**: a
       * portable schema may not carry a rendering hint
       * ([11 §4](../../../docs/design/11-lorebooks-as-a-format.md) refuses a
       * `format` keyword invented to serve one), but a *form declaration* is
       * presentation by definition. Absent means one line.
       */
      lines?: number;
    }
  | {
      kind: 'choice';
      label: string;
      hint?: string;
      /**
       * The options, in the order they are offered. **A label beside each
       * value**, because a difficulty level's value is an id the prompt pack
       * keys off and its label is for reading — the same split
       * `SOURCE_LABELS` keeps, and the reason [06 §7.3.1] can say *"Hard meaning
       * something different in one prompt pack than another is a feature"*.
       */
      options: readonly { value: string; label: string }[];
    }
  | { kind: 'toggle'; label: string; hint?: string };

/**
 * What a setup's answers are validated against — derived, never declared.
 *
 * **One description, two readers.** The server validates a creation request
 * against this and the client can render and pre-check against the same
 * derivation, which is `library/fields.ts`' arrangement — *one description of a
 * kind's fields, two renderings of it* — applied to a mode's own declaration.
 * A schema written out beside the fields would be the second description that
 * drifts.
 *
 * `additionalProperties: false`, so a field the mode did not ask for is refused
 * rather than stored. A wizard's answers are the one place a client could
 * quietly persist arbitrary data into a session file, and *ignoring* an unknown
 * key would teach the next version of that client that it worked.
 */
export function setupAnswerSchema(setup: SetupSchema): object {
  if (setup.kind === 'none') return { type: 'object', properties: {}, additionalProperties: false };

  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const field of setup.fields) {
    properties[field.id] = answerShapeOf(field.widget);
    if (field.required === true) required.push(field.id);
  }

  return {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: false,
  };
}

function answerShapeOf(widget: FieldWidget): object {
  switch (widget.kind) {
    case 'text':
      // No `minLength`: *required* is about the key being present, and a
      // required field answered with an empty string is a person who looked at
      // it and had nothing to say. The mode's steps can tell the difference.
      return { type: 'string' };
    case 'choice':
      return { type: 'string', enum: widget.options.map((option) => option.value) };
    case 'toggle':
      return { type: 'boolean' };
  }
}

/**
 * ***Where a mode puts something*** — [06 §9]'s fifth bullet, *"contribute UI
 * surfaces (a HUD region, a side panel, a message decoration)"*, built at
 * [P7.11](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ~~What a contribution *renders* is a `WidgetSpec`, which [21 §6] keeps
 * deliberately absent — so this names the slot and carries no payload.~~
 * ***`WidgetSpec` arrived at [P7.1] and this did not grow with it***, which
 * left a field that was compile-time required, runtime-unchecked, sent on the
 * wire and read by nothing. The payload is the shape
 * [13 §6.1](../../../docs/design/13-write-mode.md) already proposed for 2.0,
 * built here because [06 §7.2] needs it now.
 *
 * ***One vocabulary, two ways to place it, and the second is defined in terms
 * of the first.*** {@link ChannelDefinition.surface} means exactly
 * `{ region: 'hud', channelId: <that channel>, widget: <that spec> }` — it is
 * the shorthand for the common case, not a rival mechanism. The two are
 * **additive** and need no precedence rule, which is what keeps this from being
 * the two-vocabularies-for-one-thing failure [21 §1.1] exists to prevent: a
 * channel says *this value is worth showing*, and a mode says *and it goes
 * here*.
 *
 * **Nothing crosses the boundary**, which is [22 §3]'s claim for this bullet
 * and the reason it costs nothing: a region name, a channel id and a widget
 * declaration are all data. The client renders; the mode never does. **And
 * never an `html` field** — [10 §8] names it as *"how this decision would be
 * undone by accident rather than on purpose"*, and `mode.test.ts` asserts its
 * absence rather than only saying so.
 */
export interface SurfaceContribution {
  /**
   * ***Four, where [06 §9] names three***, and the fourth is not an
   * embellishment.
   *
   * - `hud` — the strip of short labelled values above the story ([10 §8]).
   * - `panel` — the stack beside it, where the cast, lore, goal and hook panels
   *   already are.
   * - `message` — a decoration on a turn. [P7.7]'s mention overlay is the
   *   engine's own instance of one.
   * - `stage` — **the picture behind the story.** [06 §9]'s three were written
   *   before [06 §10.1a] existed, and a backdrop is none of them:
   *   [10 §2.3] calls it *chrome* — *"The prose wins, always… On a phone it is
   *   the first thing to go"* — which is not a strip row, not a panel and not a
   *   mark on a message. Adding an arm is exactly what [10 §8.1]'s paired
   *   commitment requires of the widget vocabulary, and the same sentence
   *   governs regions: *"ask what widget would let it, and add that."*
   */
  region: 'hud' | 'panel' | 'message' | 'stage';
  /**
   * The channel whose value this renders.
   *
   * **A contribution shows state and never invents it**, which is what keeps
   * this declarative all the way down: there is no text field here, no
   * template and no payload of the mode's own. If a mode wants to show
   * something, it declares a channel holding it — and everything that already
   * governs a channel (its `update` policy, its `visibility`, the
   * `channelInPlay` rule) governs the surface for free.
   */
  channelId: string;
  widget: WidgetSpec;
}

/**
 * The manifest, plus what its declared step ids actually run — [22 §3]'s split.
 *
 * `definition` crosses any boundary unchanged; `run` is the half that becomes a
 * dispatch table when steps move to a worker. The built-in mode goes through the
 * same shape an extension will, which is the only thing that makes *"additional
 * modes as extensions"* real rather than aspirational.
 */
export interface Mode {
  definition: ModeDefinition;
  run: Readonly<Record<string, StepImplementation>>;
}
