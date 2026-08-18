// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Preset } from '@storyengine/shared';

import type { ChannelDefinition, StepDefinition, StepImplementation } from './contract.js';

/**
 * A mode's manifest — [03 §2](../../../../docs/design/03-modes-and-turn-pipeline.md).
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
 * separately, which is the split [12 §3] draws and what becomes a worker
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
   * [03 §3]'s two axes, fixed per mode at P2.6 ([P2 §2.4] names both).
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
   * **Named configurations of this mode** — [03 §1]'s *freeform* / *campaign*.
   *
   * Not the portable prompt-pack `Preset`: two different things one word apart,
   * and the same collision that forced the assembler's `CallKind` to be renamed
   * `CallPurpose`.
   */
  presets: readonly ModePreset[];

  participants: ParticipantPolicy;
  assembly: AssemblyPlan;
  steps: readonly StepDefinition[];
  /** Channels this mode **enables**. It does not implement them ([03 §4]). */
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

/** `config` is opaque and never interpreted by the host ([10 §7]). */
export interface ModePreset {
  id: string;
  config: unknown;
}

/**
 * [P2 §2.4]'s *"no participant policy beyond the user and one actor"*, written
 * as exactly that.
 *
 * `select: 'fixed'` is load-bearing rather than decorative: it is **the
 * declaration that the cast cannot change as an outcome of a turn**, which is
 * what licenses a plain `cast` field on the session instead of an `se.party`
 * channel — the channel [P2 §2.7] rejected as placeholder-shaped. [03 §7.2]'s
 * fuller taxonomy adds arms here at P7; it does not change this shape.
 */
export interface ParticipantPolicy {
  select: 'fixed';
  maxActors: number;
}

/**
 * [03 §5]: declares ordering constraints and budget policy, and does not build
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
 * The wizard, declared rather than coded ([03 §2]).
 *
 * `{ kind: 'none' }` is a real state with a real consumer — session creation
 * reads it and writes no config without asking anybody anything. The field
 * vocabulary a real wizard needs is P7's, and guessing it is what [13 §6]
 * refuses to do for `WidgetSpec`.
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
 * [03 §9]'s three regions. What a contribution *renders* is a `WidgetSpec`,
 * which [13 §6] keeps deliberately absent — so this names the slot and carries
 * no payload.
 */
export interface SurfaceContribution {
  region: 'hud' | 'panel' | 'message';
}

/**
 * The manifest, plus what its declared step ids actually run — [12 §3]'s split.
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
