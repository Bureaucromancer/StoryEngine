// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Mode } from '@storyengine/sdk';

import { registerMode } from './mode-registry.js';
import { LORE_TIMING_CHANNEL, registerChannel } from './sessions/channels.js';

/**
 * The one file that reaches for a mode — [P7.0](../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ~~**It exists to be the only thing the move rewrites.**~~ **The move happened,
 * and this is what the rewrite came to.** `mode-registry.ts` holds a map, a
 * lookup and a proof and knows no mode; this knows the modes and holds nothing.
 * So exactly one import in the server had to become something else, and it did:
 * a static `import { SCENE_MODE } from './scene/mode.js'` is now a bare
 * specifier resolved at run time.
 *
 * **Why a specifier in a variable rather than a literal, which looks like
 * hiding from the lint rule and is not.** The boundary graph allows
 * `server → server, sdk, shared`, so `import('@storyengine/mode-scene')` written
 * as a literal is reported by `boundaries/dependencies` exactly as a static
 * import would be — correctly, because the rule cannot tell a loader from a
 * dependency. The available answers were an eslint exemption naming this file,
 * or genuinely not depending on the module at compile time. The second is
 * *true*: the engine has no type for what comes back, cannot be type-checked
 * against it, and has to validate the shape at run time — which is what a host
 * that will one day load a third-party package off disk has to do anyway
 * ([22 §6–§7](../../../docs/design/22-extensions.md), and nothing installs until
 * P10). An exemption would have bought a compile-time check the engine is not
 * entitled to, and would have left `packages/server/package.json` naming a mode.
 *
 * **What this costs, stated rather than discovered.** A specifier TypeScript
 * cannot see is a specifier the compiler cannot check, so a mode package that
 * renames its entry export breaks at *startup*, not at build. Three things make
 * that survivable: the validation below throws naming the specifier and the key;
 * `assertModesRunnable` refuses a build that registered nothing; and
 * `mode-loader.test.ts` runs the real loader against the real package on every
 * `pnpm test`, so the failure is a red suite rather than a red server.
 *
 * **Async since [P7.0], and it travels.** `buildServices` awaits it and five
 * test files await it in their `beforeEach`. That is what resolving a module at
 * run time costs, and it is the honest cost: a loader that could not be async
 * could not read a directory either, which is the shape P10 needs.
 *
 * **Called rather than imported for effect.** A module whose *import* registers
 * something is a module whose behaviour depends on somebody importing it, which
 * is the kind of order dependence that works until a bundler drops it for
 * having no used export. `buildServices` calls this before it opens a file, and
 * `assertModesRunnable` immediately after, so a build that fails to register is
 * a build that refuses to start.
 */

/**
 * The mode packages a stock build ships.
 *
 * **A list in the engine and not a scan of a directory**, because a built-in is
 * exactly the mode this distribution decided to ship: `Dockerfile` deploys each
 * of these beside the server for the same reason, and the two lists agreeing is
 * a repo-shape assertion rather than a runtime discovery. Installed extensions
 * are discovered — from the data directory, at P10 — and that is a different
 * mechanism with a different failure mode, which is why this one stays a
 * literal somebody can read.
 */
export const BUILT_IN_MODE_PACKAGES: readonly string[] = ['@storyengine/mode-scene'];

export async function installBuiltIns(): Promise<void> {
  /**
   * The channels no mode can own, first. `se.lore.timing` belongs to
   * `storyengine.lore` — a **package**, which [06 §4.1] admits as an `owner`
   * precisely so a subsystem that is not a mode can hold a channel — so there
   * is no mode for it to arrive with.
   */
  registerChannel(LORE_TIMING_CHANNEL);

  // Then the modes, each bringing the channels it declares.
  for (const specifier of BUILT_IN_MODE_PACKAGES) {
    for (const mode of await loadModes(specifier)) registerMode(mode);
  }
}

/**
 * Resolves one mode package and validates what came back.
 *
 * **Every throw names the specifier**, because the thing that has gone wrong is
 * a packaging fact — a module that did not resolve, a deploy step that did not
 * copy it, an entry export renamed — and an operator reading a startup failure
 * needs the package name far more than a stack trace. The `cause` carries the
 * resolver's own message, which is where "cannot find module" actually lives.
 */
export async function loadModes(specifier: string): Promise<readonly Mode[]> {
  let namespace: unknown;
  try {
    namespace = (await import(specifier)) as unknown;
  } catch (cause) {
    throw new Error(`Mode package ${specifier} could not be loaded.`, { cause });
  }

  const declared = (namespace as { modes?: unknown }).modes;
  if (!Array.isArray(declared)) {
    throw new Error(`Mode package ${specifier} does not export a 'modes' array.`);
  }

  return declared.map((mode: unknown, index) => {
    if (!isMode(mode)) {
      throw new Error(
        `Mode package ${specifier} exports a modes[${String(index)}] that is not a mode.`,
      );
    }
    return mode;
  });
}

/**
 * The shallowest check that makes the rest of the engine's assumptions safe.
 *
 * **Deliberately not a schema.** `ModeDefinition` is a large type and validating
 * all of it here would be a second declaration of the contract, living in the
 * engine, drifting from the one in the SDK — the failure `packages/sdk`'s own
 * docstring spends a paragraph preventing. What this needs to guarantee is only
 * that `registerMode` and `assertModesRunnable` can do their work without
 * throwing a `TypeError` about `undefined`: an id to key the map, iterable
 * channels and steps, a `run` table to look implementations up in. Everything
 * past that is `assertModesRunnable`'s, which reports it better.
 */
function isMode(value: unknown): value is Mode {
  if (typeof value !== 'object' || value === null) return false;
  const { definition, run } = value as { definition?: unknown; run?: unknown };
  if (typeof definition !== 'object' || definition === null) return false;
  if (typeof run !== 'object' || run === null) return false;
  const { id, steps, channels } = definition as {
    id?: unknown;
    steps?: unknown;
    channels?: unknown;
  };
  return typeof id === 'string' && id !== '' && Array.isArray(steps) && Array.isArray(channels);
}
