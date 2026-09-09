// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { versionName } from '@storyengine/shared';

import type { BuildInfo } from '../api.js';

/**
 * The one line that says what build this is — the footer on every page and the
 * heading of the About block, fed by the same function so the two cannot
 * disagree.
 *
 * One string from a template literal rather than a sentence assembled around a
 * value in JSX: `<p>StoryEngine {name}</p>` is the shape the assembly rule
 * forbids ([19 §12.6a]), and a message with a value substituted into it is the
 * shape a catalogue entry takes.
 *
 * The name, not the string: *1.0-alpha 2* is what a person calls a build
 * ([releases §7.1]), and for a tagged build the version already fixes the
 * commit — tags are immutable, and the release build refuses a tag that
 * disagrees with the tree — so the commit is Settings' to show, where a bug
 * report is one copy-paste, rather than every page's. A version outside the
 * scheme is shown as typed, because hiding it would hide the bug.
 *
 * `null` is a build nobody identified, which is every development run
 * ([P6A §1.5]); it is said as such rather than as a version that is not one.
 */
export function buildLine(build: BuildInfo | null): string {
  if (build === null) return 'StoryEngine development build';
  return `StoryEngine ${versionName(build.version) ?? build.version}`;
}
