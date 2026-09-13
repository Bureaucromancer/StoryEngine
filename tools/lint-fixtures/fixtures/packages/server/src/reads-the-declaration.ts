// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// **The permitted control, and it is the point of the rule rather than its
// exception.** Everything here is the engine doing per-mode work *without*
// knowing which mode: a switch on something that is not a mode, a comparison
// against a namespaced string that is not a mode id, a table keyed by channel,
// and the declaration being read. A rule that fired on any of these would be
// teaching people to work around it.

interface Declaration {
  id: string;
  dispatch: "merged" | "per-actor";
  assembly: { historyWindow: number };
}

export function historyWindowFor(mode: Declaration): number {
  return mode.assembly.historyWindow;
}

export function callsPerTurn(mode: Declaration, speakers: string[]): number {
  switch (mode.dispatch) {
    case "per-actor":
      return speakers.length;
    default:
      return 1;
  }
}

export function isClock(channelId: string): boolean {
  return channelId === "storyengine.cast" || channelId === "se.clock";
}

export const BUDGETS: Record<string, number> = {
  "se.clock": 24,
  "se.location": 32,
};
