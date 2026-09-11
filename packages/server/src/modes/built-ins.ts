// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { LORE_TIMING_CHANNEL, registerChannel } from '../sessions/channels.js';
import { registerMode } from './registry.js';
import { SCENE_MODE } from './scene/mode.js';

/**
 * The one file that reaches for a mode — [P7.0](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **It exists to be the only thing the move rewrites.** `registry.ts` holds a
 * map, a lookup and a proof and knows no mode; this knows the modes and holds
 * nothing. So when `packages/modes/scene` exists and the boundary graph makes
 * `server → modes` a build error, exactly one import in the server has to
 * become something else — a loader that resolves the mode package at runtime
 * rather than a static import the bundler follows.
 *
 * Splitting it out now, while the import is still legal, is what makes that a
 * one-file change instead of a change to the registry every consumer imports.
 *
 * **Called rather than imported for effect.** A module whose *import* registers
 * something is a module whose behaviour depends on somebody importing it, which
 * is the kind of order dependence that works until a bundler drops it for
 * having no used export. `buildServices` calls this before it opens a file, and
 * `assertModesRunnable` immediately after, so a build that fails to register is
 * a build that refuses to start.
 */
export function installBuiltIns(): void {
  /**
   * The channels no mode can own, first. `se.lore.timing` belongs to
   * `storyengine.lore` — a **package**, which [06 §4.1] admits as an `owner`
   * precisely so a subsystem that is not a mode can hold a channel — so there
   * is no mode for it to arrive with.
   */
  registerChannel(LORE_TIMING_CHANNEL);

  // Then the modes, each bringing the channels it declares.
  registerMode(SCENE_MODE);
}
