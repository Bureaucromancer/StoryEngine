// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Mode } from '@storyengine/sdk';

import { registerChannel } from './sessions/channels.js';
import type { TurnPlan } from './turns/steps.js';

/**
 * Which modes this build knows — [06 §2].
 *
 * ~~A frozen record and a lookup, mirroring `sessions/channels.ts`'s `CHANNELS`,
 * and deliberately **not** a `registerMode` API. Dynamic registration is what an
 * extension needs and it arrives with the SDK boundary at P7; a registry that
 * could be written to now would be a shape that phase has to live with, built
 * before anything could exercise it.~~
 *
 * **That deferral is discharged at [P7.0], and the boundary is what forced it
 * rather than what merely permitted it.** The graph allows `server → server,
 * sdk, shared` — so the moment the Scene mode is `packages/modes/scene`, this
 * file's `import { SCENE_MODE } from './scene/mode.js'` is a **build error**,
 * and there is no compiling around it. Dynamic registration was never the
 * optional companion to the move; it is its prerequisite.
 *
 * **This file now knows no mode at all**, which is the property worth keeping:
 * it holds a map, a lookup and a proof, and something else decides what goes in.
 * *It also no longer lives in a directory called `modes/`*: the host half and the
 * mode were neighbours for five stages, and [P7.0] ends with
 * `packages/server/src/modes/` gone and a repo-shape check that fails if it
 * comes back, because a directory with that name beside the engine is where a
 * mode ends up next time somebody is in a hurry.
 * That something is [`mode-loader.ts`](./mode-loader.ts) — the one file that
 * reaches for a mode, and, since the move, the one file in the server that can.
 *
 * *Mutable rather than an instance threaded through every caller, deliberately.*
 * What P7 needs is that the registry stops being populated by a static import;
 * whether mode availability is ever **scoped** — per install, per account — is
 * [P10](../../../docs/design/workplan/26-p10-implementation.md)'s, with
 * extension installation, and inventing the scoping now would be exactly the
 * shape the struck paragraph above warned against building early.
 */

const registered = new Map<string, Mode>();

/**
 * Adds a mode to this build's registry.
 *
 * **Last registration wins, and that is the honest rule for a loader**: an
 * install that ships two copies of one mode id has a configuration problem, and
 * refusing at startup would take the server down over it. Idempotent for the
 * same object, which is what lets a test register the built-ins without caring
 * whether something already did.
 */
export function registerMode(mode: Mode): void {
  registered.set(mode.definition.id, mode);
  /**
   * **And its channels, which is what gives `ModeDefinition.channels` teeth.**
   * The field has existed since P2.6 and Scene's `mode.ts` said what it was
   * worth: listing a channel there "documents what Scene uses and does not
   * *enable* it", because effect application resolved a definition from the
   * engine's own frozen record. Registering here is the inversion that sentence
   * named — and the boundary is what forced it, since a mode that cannot import
   * a value from the engine cannot be handed its own channel any other way.
   */
  for (const channel of mode.definition.channels) registerChannel(channel);
}

/**
 * What a session runs when it names no mode, or names one this build has never
 * heard of.
 *
 * **Resolving to a default rather than refusing** is [00 §3.3]: a session whose
 * mode came from a newer build, or from an extension that is not installed, is
 * still somebody's story and should still open. The substitution is logged, and
 * P7 — where a mode can genuinely be missing rather than merely unknown — is
 * where it earns a visible warning on the session itself.
 *
 * **A literal since [P7.0], where it used to be `SCENE_ID`.** The default is an
 * *id*, and an id is content ([06 §2] — it lands in `session.json`); reaching
 * for the mode's own constant would reintroduce the import the boundary
 * forbids. `sessions/channels.ts` spells `'storyengine.scene'` the same way and
 * for a neighbouring reason, and a test in the mode pins the two together.
 */
export const DEFAULT_MODE_ID = 'storyengine.scene';

export function modeById(id: string): Mode | null {
  return registered.get(id) ?? null;
}

/**
 * The build's default mode, or a throw naming what is wrong.
 *
 * **The throw is the point.** `DEFAULT_MODE_ID` names an id and registering is
 * a call, so the two can disagree — a loader that found no package, a
 * composition root that forgot `installBuiltIns`, a default pointed at a mode
 * this build does not ship. Every caller that reaches for the default has to
 * handle that, and a helper is better than three copies of the same null check
 * disagreeing about what to say.
 */
export function defaultMode(): Mode {
  const mode = registered.get(DEFAULT_MODE_ID);
  if (!mode) {
    throw new Error(
      `The default mode ${DEFAULT_MODE_ID} is not registered. Call installBuiltIns() before serving.`,
    );
  }
  return mode;
}

/** Every mode registered so far, in registration order. */
export function registeredModes(): readonly Mode[] {
  return [...registered.values()];
}

/**
 * Zips a mode's declared steps with the implementations behind them.
 *
 * **Throws when a declared step id has no implementation**, and that is the
 * right failure: a plan silently short one step is a turn that quietly narrates
 * nothing, which looks like a bad model rather than a broken build. Called once
 * per mode by `assertModesRunnable`, so the throw lands at startup rather than
 * inside somebody's turn.
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
 * Proves every registered mode can actually run, at startup rather than at play.
 *
 * The cost of getting this wrong is paid by a user mid-turn; the cost of
 * checking is one pass over a small map.
 *
 * **Runs after registration closes rather than at module load**, which is what
 * registration being a call rather than an import costs and buys: it can no
 * longer fire before the modes are there, and it now also catches a build that
 * registered nothing — a server with no modes cannot take a turn, and finding
 * that out at startup beats finding it out when somebody presses Send.
 */
export function assertModesRunnable(): void {
  if (registered.size === 0) {
    throw new Error('No modes are registered. Call installBuiltIns() before serving.');
  }
  for (const mode of registered.values()) planFor(mode);
}
