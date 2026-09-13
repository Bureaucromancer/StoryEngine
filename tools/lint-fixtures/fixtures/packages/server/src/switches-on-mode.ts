// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// The literal reading of docs/design/06-modes-and-turn-pipeline.md §2, and the
// shape somebody reaches for first when the pressure to special-case one mode
// finally arrives. Two of them: a bare identifier and a property, because a
// selector matching only the first would miss `session.modeId` entirely.

export function historyWindowFor(mode: string, session: { modeId: string }): number {
  switch (mode) {
    case "a":
      return 20;
    default:
      return 10;
  }

  switch (session.modeId) {
    case "b":
      return 1;
    default:
      return 2;
  }
}
