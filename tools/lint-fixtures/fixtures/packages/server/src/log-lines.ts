// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// A server log line assembled with `+` — the shape the assembly rule refuses in
// the client and must not refuse here (docs/design/19-tech-stack.md §12.7).

export function refusedPath(reason: string): string {
  return "Refused a path because it " + reason + ", and nothing was read.";
}
