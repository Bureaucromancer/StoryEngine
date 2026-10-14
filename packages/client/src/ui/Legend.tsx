// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Fragment, type JSX } from 'react';

/**
 * ***What the marks above mean, said under them*** (2026-10-13) —
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.8, for
 * [10 §1.3](../../../../docs/design/10-ui-surfaces.md)'s second phone rule:
 * *no essential action that exists only on hover*, and an explanation that
 * exists only in a `title` is one, since a phone never shows a title and a
 * keyboard never reaches one.
 *
 * **A legend rather than a sentence beside every mark**, because the marks it
 * explains repeat: a shelf of forty lorebooks wears *Linked* on a dozen rows,
 * and an import's counts name each class once with a number. The meaning
 * belongs to the word, not to the row, so it is said once, under what it
 * explains, for each word that is drawn there — and only those: a word the
 * shelf does not wear has nothing to explain. `MembersField`'s `missingNote`
 * is the same move for a single mark, as a sentence.
 *
 * *A description list* because that is what it is — a term and what it means
 * — and a screen reader announces it as one. *Fine print's step*, since a
 * legend is what `Fine` names itself for, in `ink-subtle` rather than its
 * faintest ink: the term is a word somebody is looking up, not a timestamp.
 */
export function Legend(props: {
  /** Each mark drawn above, and what it means. Empty draws nothing. */
  entries: readonly (readonly [term: string, means: string])[];
}): JSX.Element | null {
  if (props.entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-subtle">
      {props.entries.map(([term, means]) => (
        <Fragment key={term}>
          <dt className="font-medium text-ink-muted">{term}</dt>
          <dd>{means}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
