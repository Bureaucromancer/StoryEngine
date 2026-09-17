// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { BuildInfo } from '../api.js';
import { link } from '../ui/classes.js';
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
 * ***The AGPL §13 source link is here, which is the slot [P6A] cut and [P10.5]
 * filled.*** §7 requires it *"visible to every logged-in user, not buried in an
 * admin screen"* — and this footer is on **every** page including the ones
 * before sign-in, which is more than the obligation asks for and costs nothing.
 *
 * ***It resolves to the version actually running***, which is the half that
 * takes machinery: `buildInfo.source` is written at build time from the remote
 * the build was cut from, and the link lands on that build's **tag**. §7 is
 * explicit that *"a link to `main` is not strictly compliant when the operator
 * is running a patched build — and the patched-build case is exactly the one
 * §13 exists for."*
 */
export function BuildFooter(props: { build: BuildInfo | null | undefined }): JSX.Element | null {
  if (props.build === undefined) return null;
  const source = props.build === null ? null : sourceHref(props.build);

  return (
    <footer className="shrink-0 border-t border-line bg-surface px-6 py-2">
      <Fine className="mx-auto flex max-w-4xl items-baseline justify-between gap-4">
        <span>{buildLine(props.build)}</span>
        {source === null ? null : (
          <a href={source} className={link.back} target="_blank" rel="noreferrer">
            Source
          </a>
        )}
      </Fine>
    </footer>
  );
}

/**
 * The URL for *this* build's source.
 *
 * ***A tag, never a branch***, which is what makes the offer correspond to the
 * running version: [releases §2] keeps tags immutable and release branches
 * forever *"directly to serve an obligation we already have"*, and a link to a
 * branch answers a different question — *where do I fix this?* rather than
 * *what precisely is the user running?*
 *
 * **Shaped for the forge it came from rather than assumed.** GitHub, GitLab and
 * Gitea all answer `/tree/<ref>`; anything else gets the repository root, which
 * is a smaller claim and still a true one. *A guessed path that 404s would be
 * worse than the root*, because a §13 offer that leads to a missing page is not
 * an offer.
 *
 * `null` when the build carries no source — see {@link BuildInfo.source}.
 */
function sourceHref(build: BuildInfo): string | null {
  if (build.source === undefined) return null;
  const base = build.source.replace(/\/+$/, '');
  // The tag is `v` plus the version ([P6A §1.6] fixes that), and the version is
  // what the build carries.
  return /(?:github|gitlab|codeberg|gitea)/i.test(base)
    ? `${base}/tree/v${encodeURIComponent(build.version)}`
    : base;
}
