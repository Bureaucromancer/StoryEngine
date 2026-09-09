// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { TurnPlan } from '../turns/steps.js';
import { SCENE_ID, SCENE_MODE } from './scene/mode.js';
import type { Mode } from './types.js';

/**
 * Which modes this build knows — [06 §2].
 *
 * A frozen record and a lookup, mirroring `sessions/channels.ts`'s `CHANNELS`,
 * and deliberately **not** a `registerMode` API. Dynamic registration is what an
 * extension needs and it arrives with the SDK boundary at P7; a registry that
 * could be written to now would be a shape that phase has to live with, built
 * before anything could exercise it.
 */

export const BUILT_IN_MODES: Readonly<Record<string, Mode>> = { [SCENE_ID]: SCENE_MODE };

/**
 * What a session runs when it names no mode, or names one this build has never
 * heard of.
 *
 * **Resolving to a default rather than refusing** is [00 §3.3]: a session whose
 * mode came from a newer build, or from an extension that is not installed, is
 * still somebody's story and should still open. The substitution is logged, and
 * P7 — where a mode can genuinely be missing rather than merely unknown — is
 * where it earns a visible warning on the session itself.
 */
export const DEFAULT_MODE_ID = SCENE_ID;

export function modeById(id: string): Mode | null {
  return BUILT_IN_MODES[id] ?? null;
}

/**
 * Zips a mode's declared steps with the implementations behind them.
 *
 * **Throws when a declared step id has no implementation**, and that is the
 * right failure: a plan silently short one step is a turn that quietly narrates
 * nothing, which looks like a bad model rather than a broken build. Called once
 * per mode at module load by `assertModesRunnable`, so the throw lands at
 * startup rather than inside somebody's turn.
 */
export function planFor(mode: Mode): TurnPlan {
  return {
    steps: mode.definition.steps.map((definition) => {
      const run = mode.run[definition.id];
      if (run === undefined) {
        throw new Error(
          `Mode ${mode.definition.id} declares step ${definition.id} with no implementation.`,
        );
      }
      return { definition, run };
    }),
  };
}

/**
 * Proves every built-in mode can actually run, at startup rather than at play.
 *
 * The cost of getting this wrong is paid by a user mid-turn; the cost of
 * checking is one pass over a record with one entry in it.
 */
export function assertModesRunnable(): void {
  for (const mode of Object.values(BUILT_IN_MODES)) planFor(mode);
}
