// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// A table of per-mode behaviour — the shape that looks most like data and is
// not: a third-party mode gets no row, which is exactly what §2 refuses.

export const WINDOWS: Record<string, number> = {
  "storyengine.scene": 20,
  "storyengine.freeform": 40,
};
