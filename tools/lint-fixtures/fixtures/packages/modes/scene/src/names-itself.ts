// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// The same three shapes the engine is forbidden, in the one place they are
// unremarkable: a mode package naming itself. Scope is half of what the rule
// says, and a rule whose scope is untested is a rule that might be global.

export const SCENE_ID = "storyengine.scene";

export const WINDOWS: Record<string, number> = {
  "storyengine.scene": 20,
};

export function isMe(modeId: string): boolean {
  if (modeId === "storyengine.scene") return true;
  switch (modeId) {
    case "storyengine.scene":
      return true;
    default:
      return false;
  }
}
