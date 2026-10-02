// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// `switch (mode)` with the switch spelled out. Both operators and both
// directions, because a selector anchored on one side would let the other
// through and the rewrite is one keystroke.

export function isScene(modeId: string): boolean {
  if (modeId === "storyengine.scene") return true;
  if ("storyengine.freeform" === modeId) return false;
  // The third shipped mode, which the pattern was a fixed list without.
  if (modeId === "storyengine.assistant") return false;
  return modeId !== "storyengine.campaign";
}
