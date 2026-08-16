// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { randomBytes } from "node:crypto";

export const key = () => randomBytes(32);
