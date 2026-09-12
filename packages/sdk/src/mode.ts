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
 * which is exactly what a no-wizard mode means. The field vocabulary a *real*
 * wizard needs is P7's, and guessing it is what [21 §6] refuses to do for
 * `WidgetSpec`.
 */
export interface NoSetup {
  kind: 'none';
}

/**
 * One arm today. A union rather than the interface alone because P7's real
 * wizard adds arms rather than fields, and a type that started as an interface
 * would have to be widened at the point every consumer already narrowed.
 */
export type SetupSchema = NoSetup;

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
