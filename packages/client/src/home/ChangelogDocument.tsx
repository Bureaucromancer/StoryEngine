// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';

import { link } from '../ui/classes.js';
import { SubsectionTitle } from '../ui/Text.js';

/**
 * A release's markdown, rendered — [home, revised].
 *
 * ***This file is the reversal of a fence, and the fence's other half still
 * stands.*** `HomePage.tsx` refused a renderer on the grounds that *"pulling a
 * markdown renderer into the bundle to draw one document would be the larger
 * half of this page's cost"* and sent markdown to the reading view at
 * [P11.1](../../../../docs/design/workplan/28-p11-implementation.md). The price
 * was real and is now paid rather than argued past —
 * [20 §7](../../../../docs/design/20-client-loading.md) names *a new dependency
 * joining the common entry* as its revisit trigger, `/` is the entry route, and
 * the measurement is recorded there. What the fence still holds is the
 * **general job**: this renders a changelog, in `home/`, against a declared
 * element set, and it is deliberately not exported from `ui/` or from any
 * barrel. Moving it is an act somebody has to argue for, which is the point.
 *
 * ---
 *
 * **The grammar is declared even though the library is general.**
 * {@link ALLOWED} is the element set `CHANGELOG.md` actually uses, and
 * `unwrapDisallowed` makes everything else degrade to its own text rather than
 * to unstyled default markup. Two consequences worth stating rather than
 * discovering:
 *
 * - **`h1` and `h2` are absent on purpose.** The parser has already consumed
 *   both — the file's title and the release headings — so one appearing in a
 *   body is a parse failure, and rendering it would drop page-title-sized type
 *   into the middle of the prose. Unwrapped, it reads as the words it is.
 * - **A void element unwraps to nothing.** `img` and `hr` have no children to
 *   keep. The grammar has neither, and `changelog.test.ts` parsing the real
 *   file is what keeps that true; it is named here so the loss is known rather
 *   than found.
 *
 * **Nothing is injected as markup.** There is no `rehype-raw` and no
 * `dangerouslySetInnerHTML`, so raw HTML in the source arrives as a `raw` node
 * that renders as **its own escaped text** — `<script>alert(1)</script>` is
 * eleven visible characters and no element, never a script — rather than being
 * sanitised by something we would then have to keep current. Text rather than
 * silence is the better of the two failures here: a stray tag in the changelog
 * should be visible to whoever wrote it, not quietly swallowed. And
 * `react-markdown`'s own `defaultUrlTransform` refuses `javascript:` and
 * friends before this file's link rule ever sees them.
 * [10 §8.1](../../../../docs/design/10-ui-surfaces.md) spends its argument on
 * the vocabulary never acquiring an `html: string` field, and adding a rehype
 * plugin here is the change that undoes both defaults at once — so it is the
 * change that needs the argument, and `ChangelogDocument.test.tsx` holds the
 * current behaviour so the undoing cannot be quiet.
 */

/**
 * The changelog's elements, and no others.
 *
 * `em` covers both `*` and `_`; `code` is inline only, because `pre` is not
 * here and a fence therefore degrades to its content. `ol` is absent for the
 * same reason `h2` is — the file has no numbered lists, and admitting one
 * without a style for it is how an unstyled list ships.
 */
const ALLOWED = ['p', 'ul', 'li', 'h3', 'strong', 'em', 'code', 'a'];

/**
 * A link in the changelog, which is usually not a link a browser can follow.
 *
 * **Sixteen of the file's seventeen links are relative paths into `docs/`.**
 * Those resolve in the repository, which is where the changelog is also read,
 * and `tools/doc-links.test.ts` holds them to resolving — so the *file* keeps
 * them and this is where the decision about a *browser* belongs. Rendered as an
 * anchor, `docs/design/10-ui-surfaces.md` from `/` is a full navigation the SPA
 * fallback answers with `RouteErrorCard`: a link that looks real, and lands on
 * an error card, for a document the reader has no way to open anyway.
 *
 * So a relative href renders its own text. The sentence still reads — these are
 * citations, and a citation whose target is unreachable is still a citation —
 * and nothing about the page claims an affordance it does not have.
 */
// `| undefined` spelled out on both: `exactOptionalPropertyTypes` makes
// `href?: string` mean *present and a string, or absent*, which is not what
// react-markdown hands a component — it passes the key through with `undefined`
// in it. The explicit union is the shape that accepts both.
function ChangelogLink({
  href,
  children,
}: {
  href?: string | undefined;
  children?: ReactNode | undefined;
}): JSX.Element {
  if (href === undefined || !/^https?:\/\//i.test(href)) return <>{children}</>;
  return (
    <a href={href} className={link.prose} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/**
 * Appearance, entirely here — which is what keeps the palette rule, the `dark:`
 * rule and the logical-property rule ordinary lint rather than something a
 * stylesheet reaching into generated markup could evade.
 *
 * `p`, `li` and `em` are in {@link ALLOWED} and deliberately absent here: they
 * need no class, and a pass-through entry would be a line to maintain that says
 * nothing. Block rhythm is the wrapper's `gap`, not a margin per block, so a
 * heading and a list cannot arrive with two different ideas of the space above
 * them.
 *
 * Each component destructures rather than spreading its props: `node` is in
 * there, and spreading it onto a DOM element is a React warning per element.
 */
const COMPONENTS: Components = {
  // `###` is `h3` because the page is `h1` (the wordmark) then `h2` (the
  // release). The element is the document's structure and the step is its
  // appearance — `ui/Text.tsx`'s rule — so the level is stated and the size
  // follows from `SubsectionTitle`.
  h3: ({ children }) => (
    // **The rule line is doing the work, and it is sanctioned rather than
    // borrowed.** *Added*, *Fixed*, *Changed*, *Known* are category labels, and
    // at the subsection step they were the same size and weight as the bold
    // lede that opens every bullet beneath them — so the eye had nothing to
    // separate a section from the first sentence in it. [10 §1.1] names
    // *"typography, weight, rule lines and alignment"* as the hierarchy tools
    // that cost no room, and a hairline is the one of the four that does not
    // spend a type step this page has already assigned.
    //
    // On a wrapper rather than on the heading: `ui/Text.tsx` documents its
    // `className` as position only, and a border is not position. Layout at the
    // call site is where this repo puts arrangement anyway.
    <div className="mt-2 border-b border-line pb-1">
      <SubsectionTitle as="h3">{children}</SubsectionTitle>
    </div>
  ),
  ul: ({ children }) => (
    <ul className="flex list-disc flex-col gap-2 ps-5 marker:text-ink-faint">{children}</ul>
  ),
  // Nearly every bullet in this file opens with a bold sentence, and it is a
  // lede rather than a shout: `font-medium` is the subsection step's weight,
  // and the ink is what actually lifts it off the body copy around it.
  //
  // **Which only works because the body around it is `ink-muted`.** Rendered
  // against `text-ink`, weight alone carried the whole distinction and the lede
  // was invisible at reading distance — looked at in a browser, which is the
  // only place that was ever going to show.
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded-control bg-surface-muted px-1 py-0.5 text-sm">{children}</code>
  ),
  a: ChangelogLink,
};

export function ChangelogDocument({ body }: { body: string }): JSX.Element {
  return (
    <Markdown allowedElements={ALLOWED} unwrapDisallowed components={COMPONENTS}>
      {body}
    </Markdown>
  );
}
