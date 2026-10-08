// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { findRelease } from '@storyengine/shared';

import { useAuthState } from '../queries.js';
import { Note, SectionTitle } from '../ui/Text.js';
import { OpenDockButton } from '../workbench/OpenDockButton.js';
import { ChangelogDocument } from './ChangelogDocument.js';
import { CHANGELOG, NEWEST } from './log.js';
import { NO_RELEASES, releaseTitle, showingLine, type Showing } from './labels.js';

/**
 * ***The release home shows, as a chunk of its own*** —
 * [21 §7.3](../../../../docs/design/21-client-loading.md), 2026-10-07.
 *
 * Everything on home that reads the changelog, moved here from
 * [HomePage](./HomePage.tsx) unchanged, so that it and the renderer it draws
 * with leave the common entry together. That is [21 §7.1]'s pre-argued
 * contingency — `React.lazy` around the renderer inside `HomePage`, behind a
 * `Suspense` sentence — taken one step wider than it was written: §7.1 left the
 * text on the entry because the workbench's list read it there, and the text is
 * what grows with every tag. With the list split off as well — into the same
 * chunk, through [readers.ts](./readers.ts) — nothing on the entry reads the
 * file. `HomePage` keeps its title and the line under it, which
 * need neither, so the page is a page while this is on its way.
 *
 * The arguments for what this draws — one release rather than the file, the
 * address choosing which, the preamble left out, the button that opens the dock
 * — are `HomePage`'s docstring's, and stay there with the page they describe.
 */
export function HomeRelease({ release }: { release?: string }): JSX.Element {
  const auth = useAuthState();
  const locale = auth.data?.account?.locale ?? undefined;

  // Asked-for and shown are computed separately because the difference is what
  // the page has to say out loud: an address naming a release this build does
  // not carry is answered, not swallowed.
  const asked = release === undefined ? undefined : findRelease(CHANGELOG, release);
  const shown = asked ?? NEWEST;
  const showing: Showing =
    release === undefined || asked === NEWEST
      ? 'newest'
      : asked === undefined
        ? 'unknown'
        : 'older';

  if (shown === undefined) return <Note className="mt-6">{NO_RELEASES}</Note>;

  return (
    <section className="mt-6 flex flex-col gap-2" aria-labelledby="release">
      {/* The heading and the way to the index sit on one baseline: the
          button is about the section, not about the release under it. */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionTitle as="h2" id="release">
          {releaseTitle(shown, locale)}
        </SectionTitle>
        {/* The way to the release index, which the dock holds: `OpenDockButton`
            says why a page points at it, and why a second press closes nothing.
            On the heading line rather than on the page, because a button for the
            history drawn before there is a history would open a dock still
            saying it is loading. */}
        <OpenDockButton variant="quiet">All releases…</OpenDockButton>
      </div>
      <Note>{showingLine(showing)}</Note>
      {/* **The Quiet family, for this block only** — [10 §1.2]'s three
          separators are type, measure and chrome, and this takes the first
          two. `max-w-reading` inside `page.tooling` is a reading column in
          a tooling column rather than a reading page: home carries a
          control and sits beside the dock, so it keeps the shell's width
          and gives only its prose the story measure. `ui/classes.ts`'s
          `page` docstring carries the argument. */}
      <article className="mt-2 flex max-w-reading flex-col gap-3 text-story font-story text-ink-muted">
        <ChangelogDocument body={shown.body} />
      </article>
    </section>
  );
}
