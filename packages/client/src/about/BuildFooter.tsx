// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { BuildInfo } from '../api.js';
import { Fine } from '../ui/Text.js';
import { buildLine } from './labels.js';

/**
 * The build, at the bottom of every page — login and setup included.
 *
 * A `<footer>` landmark, so it is reachable by name and so the one `<main>`
 * per page ([P3.−1]) stays the one. The shell mounts it after the dock row and
 * outside the scrolling main, for the reason the restart banner sits above it:
 * a footer that scrolled away with the page would be a footer on some pages.
 * `Gate` mounts the same component under the pages before sign-in.
 *
 * `undefined` is *not known yet* — the auth state has not loaded, or could not
 * — and renders nothing rather than a placeholder that would be wrong for the
 * length of a request. `null` is known: a build nobody identified.
 *
 * The AGPL §13 source link, when publication brings it ([09 §7]), goes here:
 * it is required to be visible to every logged-in user without hunting, which
 * a settings page is not ([10 §15.1]).
 */
export function BuildFooter(props: { build: BuildInfo | null | undefined }): JSX.Element | null {
  if (props.build === undefined) return null;
  return (
    <footer className="shrink-0 border-t border-line bg-surface px-6 py-2">
      <Fine className="mx-auto max-w-4xl">{buildLine(props.build)}</Fine>
    </footer>
  );
}
