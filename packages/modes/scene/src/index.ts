// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Mode } from '@storyengine/sdk';

import { SCENE_MODE } from './mode.js';

export {
  BACKDROP_CHANNEL,
  CLOCK_CHANNEL,
  EXPRESSION_CHANNEL,
  LOCATION_CHANNEL,
  NARRATE,
  SCENE,
  SCENE_ID,
  SCENE_MODE,
  STAGING_CHANNEL,
} from './mode.js';
export { SE_SCENE_STAGE, STAGE_STEP, stage } from './staging.js';
export { SCENE_PRESET } from './preset.js';

/**
 * What a mode package hands the host — [P7.0](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **An array rather than the mode itself, because [22 §6](../../../../docs/design/22-extensions.md)'s
 * manifest says `modes` and means a list.** This package ships one and will
 * probably only ever ship one; the shape is chosen so that the day a package
 * ships two, the host needs no second convention. `mode-loader.ts` reads this
 * key by name and validates what it finds, because it cannot import the type —
 * a bare specifier resolved at runtime is the *only* thing the boundary leaves
 * the engine, and that is the point rather than a workaround.
 *
 * **Not the whole of [22 §6]'s manifest, and deliberately not.** That object
 * carries `id`, `license`, an SDK version range and a capability request, all of
 * which exist to be shown to a human at install time — and nothing installs
 * until [P10](../../../../docs/design/workplan/27-p10-implementation.md). Minting
 * the full shape now would be inventing an install-time contract with no
 * installer to hold it honest, which is the mistake `ModeDefinition.channels`
 * spent five stages demonstrating. One key of it, the key a built-in actually
 * needs, is what ships.
 */
export const modes: readonly Mode[] = [SCENE_MODE];
