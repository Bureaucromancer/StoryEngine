// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Suspense, type JSX } from 'react';

import { page } from '../ui/classes.js';
import { Fine, Note, PageTitle } from '../ui/Text.js';
import { ChangelogLoad, lazyChangelogReader } from './ChangelogLoad.js';

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
 *
 * ---
 *
 * ***The release is drawn by a chunk of its own*** (2026-10-07,
 * [21 §7.3](../../../../docs/design/21-client-loading.md)). Everything above
 * that reads the changelog — the lookup, the heading, the button, the rendered
 * document — is [HomeRelease](./HomeRelease.tsx), fetched when somebody arrives
 * here, and the renderer and the text went with it off the common entry. What
 * stays is what needs neither: the title and the line under it, so the page is
 * a page while the release is on its way, and stands if it never arrives.
 */
export function HomePage({ release }: { release?: string }): JSX.Element {
  return (
    <div className={page.tooling}>
      <PageTitle>StoryEngine</PageTitle>
      <Fine>
        A prototype of the arrival page. What it will hold — what you were doing, where to start,
        what needs attention — is not built yet.
      </Fine>

      {/* Keyed on the release the address names, so a document that failed to
          draw is not still the failure once another one is chosen. The chunk
          is cached after its first arrival, so the remount draws at once. */}
      <ChangelogLoad key={release ?? ''} className="mt-6">
        <Suspense
          fallback={
            <Note className="mt-6" role="status">
              Loading this build’s changelog…
            </Note>
          }
        >
          <HomeRelease {...(release === undefined ? {} : { release })} />
        </Suspense>
      </ChangelogLoad>
    </div>
  );
}

/**
 * ***The release, fetched when it is first wanted*** — through
 * [readers.ts](./readers.ts), the one chunk everything that reads the changelog
 * is in, and declared at module scope because `lazy` must be
 * (`ChangelogLoad.tsx` says why).
 */
const HomeRelease = lazyChangelogReader<{ release?: string }>(() =>
  import('./readers.js').then((module) => module.HomeRelease),
);
