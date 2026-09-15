// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChangelogRelease } from '@storyengine/shared';

import { formatCalendarDate } from '../format.js';

/**
 * Home's sentences, one string each —
 * [about/labels.ts](../about/labels.ts#buildLine)'s arrangement for
 * [about/labels.ts]'s reason.
 *
 * A message with a value substituted into it is the shape a catalogue entry
 * takes; `<p>Showing {name}</p>` is the shape the assembly rule forbids, because
 * a sentence that exists only as a shape in the JSX tree cannot be handed to a
 * translator at all ([19 §12.6a]). So each of these returns a whole sentence,
 * and the page renders one expression.
 *
 * The branch is on a **code**, never on displayed text — the other half of the
 * same rule. {@link Showing} is that code: the moment a label doubles as an
 * identifier, translating it changes what the program does.
 */

/**
 * Which of three situations the page is in.
 *
 * `unknown` is not an error. The address named a release this build's file does
 * not carry, and the page shows the newest instead and says so — the router's
 * *dropped rather than rejected* posture carried onto the surface, because a
 * changelog is pinned to the build that bundled it and a link shared from a
 * newer build is the expected end of one.
 */
export type Showing = 'newest' | 'older' | 'unknown';

/** The release's own name and date — the heading of the panel below it. */
export function releaseTitle(release: ChangelogRelease, locale?: string): string {
  return `${release.name} — ${formatCalendarDate(release.date, locale)}`;
}

export function showingLine(showing: Showing): string {
  if (showing === 'older') return 'An earlier release. This build is a later one.';
  if (showing === 'unknown') {
    return 'The address named a release this build’s changelog does not have, so this is the newest one instead.';
  }
  return 'The newest release in this build’s changelog.';
}

/** The empty state, which the shipped file cannot be in but the type can. */
export const NO_RELEASES = 'This build’s changelog carries no releases.';
