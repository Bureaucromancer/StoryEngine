// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { randomInt } from "node:crypto";

export const seed = () => randomInt(0, 1024);

// The form the real ids.ts uses: the Web Crypto global, so `shared` also runs
// in a browser. Exempt here, banned in the file next door.
export const tail = () => crypto.getRandomValues(new Uint8Array(8));
