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

// The shapes the engine's own data takes (2026-10-01): a session stores
// `mode?: { id, config }`, so these are the switches somebody would write.
// Four reports: the optional chain, the property chain, the bare object, and a
// `case` naming a mode id under a discriminant that names nothing.
export function windowFor(
  session: { mode?: { id: string } },
  declared: { mode: { id: string } },
  mode: { id: string },
  kind: string,
): number {
  switch (session.mode?.id) {
    default:
      return 1;
  }

  switch (declared.mode.id) {
    default:
      return 2;
  }

  switch (mode.id) {
    default:
      return 3;
  }

  switch (kind) {
    case "storyengine.assistant":
      return 4;
    default:
      return 5;
  }
}
