// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { findRelease } from '@storyengine/shared';

import { usePatchPrefs, usePrefs, useAuthState } from '../queries.js';
import { Button } from '../ui/Button.js';
import { page } from '../ui/classes.js';
import { Fine, Note, PageTitle, SectionTitle } from '../ui/Text.js';
import { workbenchOpenFromPrefs, workbenchOpenPatch } from '../workbench/prefs.js';
import { ChangelogDocument } from './ChangelogDocument.js';
import { CHANGELOG, NEWEST } from './log.js';
import { NO_RELEASES, releaseTitle, showingLine, type Showing } from './labels.js';

/**
 * Home, as a prototype — [P7B.9], and deliberately the smallest thing that
 * makes the address real.
 *
 * ***The value is not the changelog.*** `router.tsx`'s index route had thrown a
 * redirect to `/library` since P4, under a docstring reading *"`/` redirects
 * until home is built… every link resolves to the address that will still be
 * correct after home lands"*; `Shell.tsx`'s wordmark pointed at the library
 * under *"It becomes home once home exists ([10 §2.2]) — the wordmark is the
 * arrival affordance, and arrival is not the library's job."* **Two comments
 * describing a future.** This makes them describe the present, after which the
 * full home is a page that gains sections rather than a route somebody has to
 * introduce.
 *
 * **The full [10 §2.2](../../../../docs/design/10-ui-surfaces.md) home — resume,
 * start, notice, recent work — is deliberately not here.** It is not core-alpha
 * work: it stays nominally a 1.0 feature expected immediately before the
 * cut-over to feature-complete beta, and it may move further out
 * ([polish §5](../../../../docs/design/workplan/06-polish.md) carries the
 * wording). The fence is the stage, because a home page attracts every idea
 * anybody has ever had about a dashboard and polish §5 says so at length.
 *
 * ***That fence is unchanged by the revision below, and this is where to check
 * it.*** P7B.9's own note warns that *"a prototype that quietly grew a session
 * list would be that deferral being reversed by accretion rather than by
 * decision"*, and the test of the warning is **which deferral**. The four
 * deferred panels are each a reader over *the user's own data*, needing a
 * surface that computes something. None of them is here and none is nearer.
 * What changed is that the one thing this page already showed is now shown
 * properly. The day home grows a fifth thing that is about the person rather
 * than about the build, that is §1.10 being reversed, and it wants a decision.
 *
 * ---
 *
 * **Why the changelog is imported rather than fetched** — [P7B §1.3]. The
 * argument, and the parse both this page and the workbench read, are in
 * [log.ts](./log.ts).
 *
 * ~~**Rendered as text, not as markdown.** Pulling a markdown renderer into the
 * bundle to draw one document would be the larger half of this page's cost, for
 * a file whose headings are legible as they stand. The reading view (P11.1) is
 * the stage that owns markdown rendering, and it can have this when it
 * arrives.~~
 *
 * ***Rendered, and the cost paid rather than avoided*** — [home, revised]. The
 * struck paragraph was right about the price and wrong about the trade. Sixteen
 * kilobytes in a `<pre>` is not *legible as it stands* when it is the only
 * content on the page: it reads as a dump, which is what a person arriving at
 * the application saw. `react-markdown` is pinned in the client's manifest, and
 * [21 §7](../../../../docs/design/21-client-loading.md)'s revisit trigger — *a
 * new dependency joins the common entry* — is fired by this **on purpose**,
 * measured, and recorded at [21 §7.1] rather than argued past. The fence that
 * still holds is the general job: rendering goes through
 * [ChangelogDocument](./ChangelogDocument.tsx), which declares the changelog's
 * element set and degrades everything else to its own text, and which lives in
 * this directory so it cannot be reached for. The reading view (P11.1) still
 * owns markdown rendering for the application.
 *
 * ***And the page shows one release rather than the file.*** The whole
 * changelog at once is both too much on arrival and too little for looking
 * something up. The panel shows the newest by default; the workbench holds the
 * index ([ReleaseSubject](../workbench/home/ReleaseSubject.tsx)) and the
 * selection lives in the address, which is what keeps that panel a reader —
 * `router.tsx`'s `IndexSearch` carries the argument.
 *
 * **The preamble is not rendered**, which is an editorial decision rather than
 * an oversight. `CHANGELOG.md`'s opening addresses somebody reading the
 * repository — the semver caveat, the naming rule, five citations into `docs/`
 * that cannot resolve in a browser. This page's own title and the line under it
 * do that job for somebody reading the application.
 */
export function HomePage({ release }: { release?: string }): JSX.Element {
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

  return (
    <div className={page.tooling}>
      <PageTitle>StoryEngine</PageTitle>
      <Fine>
        A prototype of the arrival page. What it will hold — what you were doing, where to start,
        what needs attention — is not built yet.
      </Fine>

      {shown === undefined ? (
        <Note className="mt-6">{NO_RELEASES}</Note>
      ) : (
        <section className="mt-6 flex flex-col gap-2" aria-labelledby="release">
          {/* The heading and the way to the index sit on one baseline: the
              button is about the section, not about the release under it. */}
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <SectionTitle as="h2" id="release">
              {releaseTitle(shown, locale)}
            </SectionTitle>
            <ReleaseHistoryButton />
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
      )}
    </div>
  );
}

/**
 * The way to the release index — `LibraryPage.tsx`'s `ImportButton`, for the
 * same reason and with the same shape.
 *
 * **Its whole job is to open the dock**, which is why it patches the preference
 * rather than routing anywhere: [P3 §1.2] is explicit that the panel's open
 * state is a preference and deliberately **not** the URL, because a
 * URL-addressable panel is a place and [10 §3] spent its argument on the panel
 * not being one. The panel's *subject* is in the address; its *visibility* is
 * not, and the two are different facts.
 *
 * It exists at all because a history reachable only by knowing that Ctrl+`
 * opens a panel which happens to list releases over this route is not pointed
 * at by anything. Deliberately not disabled or hidden once the dock is open:
 * the button is where somebody looks for the history, and a control that
 * vanishes once it has worked is a control you cannot find twice.
 */
function ReleaseHistoryButton(): JSX.Element {
  const prefs = usePrefs();
  const patchPrefs = usePatchPrefs();
  const open = workbenchOpenFromPrefs(prefs.data?.prefs);

  return (
    <Button
      type="button"
      size="compact"
      variant="quiet"
      aria-expanded={open}
      aria-controls={open ? 'workbench' : undefined}
      onClick={() => {
        if (!open) patchPrefs.mutate(workbenchOpenPatch(true));
      }}
    >
      All releases…
    </Button>
  );
}
