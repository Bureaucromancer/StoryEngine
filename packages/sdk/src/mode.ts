// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Preset } from '@storyengine/shared';

import type { ChannelDefinition } from './channels.js';
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
   * pair — declaring one without the other would misstate the mode. At P7 they
   * become optional *session* fields whose absence means the mode's value, which
   * is a field rather than a migration. What keeps them honest meanwhile is a
   * test pinning them against what the default preset's narrator block actually
   * instructs.
   */
  voice: 'narrator' | 'embodied';
  dispatch: 'merged' | 'per-actor';

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
 * - `natural` — whoever the scene just addressed. The heuristic is the last
 *   turn's prose scanned for names, which is ST's and is honestly a heuristic.
 * - `list` — each in turn, rotating.
 * - `pooled` — one at random, drawn on the turn's tape so a replay is the same
 *   scene.
 * - `manual` — whoever the player named with the input, and nobody otherwise.
 *
 * **Lowercase, where the design note writes them as ST's constants.** A
 * `select` value lands in a mode definition, which is *content*, and every
 * neighbouring vocabulary in this file is lowercase — `merged`, `per-actor`,
 * `narrator`, `embodied`. `NATURAL` would be the only shouted id in the build,
 * spelled that way because a different program spells its enum that way.
 *
 * **`fixed` stays and is not one of the four.** It is the honest answer for a
 * mode that seats one actor, and removing it would force Scene to claim a
 * selection strategy for a choice it does not make.
 */
export const PARTICIPANT_SELECTORS = ['fixed', 'natural', 'list', 'pooled', 'manual'] as const;

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
 * [06 §9]'s three regions. What a contribution *renders* is a `WidgetSpec`,
 * which [21 §6] keeps deliberately absent — so this names the slot and carries
 * no payload.
 */
export interface SurfaceContribution {
  region: 'hud' | 'panel' | 'message';
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
