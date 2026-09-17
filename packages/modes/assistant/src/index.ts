// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { ASSISTANT_MODE } from './mode.js';

/**
 * The entry the host reads — [22 §6], and the shape `mode-loader.ts` validates
 * at run time because it cannot import the type across the boundary.
 */
export const modes = [ASSISTANT_MODE];

export {
  ASSISTANT_MODE,
  ASSISTANT_ID,
  ASSISTANT,
  ASSISTANT_CONTEXT,
  ASSISTANT_PROPOSAL,
} from './mode.js';
export { ASSISTANT_PRESET } from './preset.js';
export { PROPOSE_STEP, SE_ASSISTANT_PROPOSE } from './propose.js';
