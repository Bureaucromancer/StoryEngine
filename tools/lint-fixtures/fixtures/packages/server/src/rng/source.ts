// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { randomInt } from 'node:crypto';

// The service itself. This is the destination the rule points at, and the one
// place a draw may come from.
export const intBelow = (bound: number) => randomInt(bound);
