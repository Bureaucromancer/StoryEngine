// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Mode } from '@storyengine/sdk';

import { FREEFORM_MODE } from './mode.js';

export { FREEFORM, FREEFORM_CHANNELS, FREEFORM_ID, FREEFORM_MODE, NARRATE } from './mode.js';
export { FREEFORM_PRESET } from './preset.js';

/**
 * What a mode package hands the host — [P7.0], [P7.9].
 *
 * **The same key, the same shape, and a second package reading it the same way
 * is the smallest proof that the convention is a convention.** `mode-loader.ts`
 * looks for `modes` by name and validates what it finds; it has never imported
 * a type from either package and does not start now.
 */
export const modes: readonly Mode[] = [FREEFORM_MODE];
