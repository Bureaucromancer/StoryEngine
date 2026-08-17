// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { randomInt } from 'node:crypto';

// The file next door, inside the same directory. If this ever passes, the
// exemption has widened from two files to a folder — and a `dice.ts` that draws
// its own numbers is precisely the unrecorded draw the rule exists to stop.
export const cheat = () => randomInt(1, 21);
