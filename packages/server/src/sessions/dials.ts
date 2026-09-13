// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  DIAL_CHANNELS,
  dialChannel,
  SE_DIFFICULTY,
  SE_DIRECTEDNESS,
  type DialAxis,
} from '@storyengine/sdk';
import type { DifficultyLevel, Preset } from '@storyengine/shared';

import { initialValue } from './channels.js';

/**
 * ***Re-exported rather than re-declared***, which is the same rule the SDK's
 * own index states for `shared`: the ids and the declaration are the contract's,
 * and a second spelling on the engine side would be two vocabularies for one
 * registry key. What this module adds is everything the contract deliberately
 * does not have — resolution over a session's rungs, and a lookup into the pack
 * — because both read records a mode has no business reaching.
 */
export { DIAL_CHANNELS, SE_DIFFICULTY, SE_DIRECTEDNESS, dialChannel, type DialAxis };

/**
 * Difficulty and directedness — [06 §7.3.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [06 §7.3.2], built at
 * [P7.8](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***Two settings, and the separation is the feature rather than the filing.***
 * [06 §7.3.2] states the failure this file exists to make impossible:
 * *"A naive difficulty implementation raises both together, because the prompt
 * language for 'push back' and the prompt language for 'assert your own plot'
 * look similar from the outside. The result is railroading wearing difficulty's
 * clothes, and players report it as* the AI ignoring me *rather than as* hard."
 * So there are two channels, two slot arms, two level lists, and no field
 * anywhere that sets both.
 *
 * ***And a third dial that is deliberately not here.*** [23 §5.4] adds the
 * constraint in as many words — a frequency dial stays a **separate** channel
 * from difficulty, *"because folding* how often *into* how hard *rebuilds
 * exactly the conflation 06 §7.3.2 exists to prevent"*. Hook pacing
 * (`sessions/hooks.ts`) is that channel and it predates this file by three
 * stages; nothing here reads it, nothing here writes it, and
 * `dials.test.ts` asserts the three are three.
 *
 * **What this module is and is not.** It resolves *which level*, from the rungs
 * below. The level's **prose** is the prompt pack's — [06 §7.3.1]: *"The levels
 * live in the prompt pack, not in engine code… 'Hard' meaning something
 * different in one prompt pack than another is a feature"* — so nothing in this
 * file contains a fragment, and {@link levelFragments} reads them off the
 * `Preset` rather than a table.
 *
 * ***Engine code keeps only what cannot transfer.*** That is the same line
 * `hooks.ts` draws for pacing and quotes [06 §6.1] for: what transfers is the
 * half about prose. Difficulty's non-prose half is *"target numbers, resource
 * pressure, enemy competence"* — {@link DifficultyLevel.parameters}, which
 * 7.3.1's table hands to the **mode**, not to the engine — so it is passed
 * through opaquely here too.
 */

/**
 * The level a dial is on at a node, resolved over its rungs.
 *
 * **Three rungs and not four, which is where this differs from `readPacing`.**
 * Pacing resolves channel → Setup → Treatment, because [04 §6.1b] puts
 * `hookPacing` on both portable kinds. Neither carries a difficulty and [04 §7]
 * says why in as many words: *"Modelling it on Setup would imply Messages and
 * Scene have a difficulty, which they do not."* So the authored rung here is
 * `mode.config` — the wizard's answer — and there is nothing under it but the
 * declaration.
 *
 * *Read untyped*, because `mode.config` is `unknown` by design and a value off
 * it may be a build ahead of this one.
 */
export function readDial(
  axis: DialAxis,
  channels: Readonly<Record<string, { value: unknown }>>,
  config?: unknown,
): string | null {
  const id = DIAL_CHANNELS[axis];
  return (
    asLevelId(channels[id]?.value) ??
    asLevelId(configField(config, axis)) ??
    asLevelId(initialValue(id))
  );
}

function asLevelId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function configField(config: unknown, field: string): unknown {
  if (typeof config !== 'object' || config === null) return undefined;
  return (config as Record<string, unknown>)[field];
}

/** Which levels a pack ships for one axis. */
export function packLevels(preset: Preset, axis: DialAxis): readonly DifficultyLevel[] {
  return (axis === 'difficulty' ? preset.difficultyLevels : preset.directednessLevels) ?? [];
}

/**
 * The level in play, or null — the check that makes {@link dialChannel}'s
 * enum-free schema safe.
 *
 * ***A dial with no level selected falls to the pack's lowest rank, and that is
 * a decision rather than a default.*** [06 §7.3.2] wants directedness low —
 * *"some is wanted, since a narrator with none is a stenographer, but it should
 * never be a hidden passenger on the difficulty slider"* — and the same rule
 * read for difficulty gives the gentler end, which is the right way to be wrong
 * about a session nobody configured. **The floor is the pack's lowest entry
 * rather than a constant**, because a constant here would be engine code
 * deciding what *easy* means, which is the one thing 7.3.1 forbids.
 *
 * *A level id the pack does not have resolves to the same floor rather than to
 * nothing*, which is the difference between a session that swapped packs and a
 * session with no dial: the first still wants the dial to work.
 */
export function resolveLevel(
  preset: Preset,
  axis: DialAxis,
  levelId: string | null,
): DifficultyLevel | null {
  const levels = packLevels(preset, axis);
  if (levels.length === 0) return null;

  const named = levels.find((level) => level.id === levelId);
  if (named !== undefined) return named;

  // Lowest `rank` wins. `reduce` rather than a sort so a pack that ships them
  // out of order is read the same as one that does not — `rank` is the
  // ordering, and array position is not.
  return levels.reduce((lowest, level) => (level.rank < lowest.rank ? level : lowest));
}

/**
 * A level's fragments, highest `priority` first.
 *
 * **Ordered here rather than at the cap**, because [19 §5.3]'s machinery drops
 * from the end of what it was given and {@link DifficultyLevel} documents
 * `priority` as *"lower is dropped first"*. A collector that emitted them in
 * array order would make the pack's ranking depend on how the author happened to
 * type the list, which is the same class of accident `rank` avoids above.
 *
 * *The index travels with the fragment* so the emitted block can address it —
 * and it is the index **in the level**, taken before this sort, because that is
 * the position an author reading the file would count to.
 */
export function levelFragments(
  level: DifficultyLevel,
): readonly { text: string; priority: number; index: number }[] {
  return level.fragments
    .map((fragment, index) => ({ ...fragment, index }))
    .sort((left, right) => right.priority - left.priority);
}
