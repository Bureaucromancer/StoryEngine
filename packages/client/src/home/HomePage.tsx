// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import changelog from '../../../../CHANGELOG.md?raw';

import { page } from '../ui/classes.js';
import { Fine, SectionTitle } from '../ui/Text.js';

/**
 * Home, as a prototype — [P7B.9], and deliberately the smallest thing that
 * makes the address real.
 *
 * ***The value is not the changelog.*** `router.tsx`'s index route has thrown a
 * redirect to `/library` since P4, under a docstring reading *"`/` redirects
 * until home is built… every link resolves to the address that will still be
 * correct after home lands"*; `Shell.tsx`'s wordmark has pointed at the library
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
 * ---
 *
 * **Why the changelog is imported rather than fetched** — [P7B §1.3]. A
 * changelog shown by a running build should be **that build's**, which is the
 * same category of fact as the version string
 * [AboutBuild](../about/AboutBuild.tsx) already renders from the auth payload. A
 * route would invite a question nobody needs to answer — who may read it, and
 * whether it exists before sign-in — and a bundled string has no permission
 * model because it is not a resource. `tools/release.test.ts` already pins this
 * file's version against `package.json`, `compose.yaml` and the unraid
 * template, so a fourth consumer inherits that guarantee.
 *
 * *The cost, stated:* the bundle grows by the changelog, and
 * [20 — client loading](../../../../docs/design/20-client-loading.md) is what
 * measures whether that matters, at [P11.0].
 *
 * **Rendered as text, not as markdown.** Pulling a markdown renderer into the
 * bundle to draw one document would be the larger half of this page's cost, for
 * a file whose headings are legible as they stand. The reading view (P11.1) is
 * the stage that owns markdown rendering, and it can have this when it arrives.
 */
export function HomePage(): JSX.Element {
  return (
    <div className={page.tooling}>
      <h1 className="text-title text-ink">StoryEngine</h1>
      <Fine>
        A prototype of the arrival page. What it will hold — what you were doing, where to start,
        what needs attention — is not built yet.
      </Fine>

      <section className="mt-6">
        <SectionTitle as="h2">What changed in this build</SectionTitle>
        {/* `pre`, because the source is plain text and a `div` of it would
            collapse the blank lines that are its only structure. Scrolls on its
            own axis so a long line cannot widen the page. */}
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-sm text-ink-subtle">
          {changelog}
        </pre>
      </section>
    </div>
  );
}
