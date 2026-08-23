// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

/**
 * The type scale, which the client did not previously have.
 *
 * Headings were spelled seven ways — `text-base font-medium` ten times,
 * `text-lg font-medium` twice, `text-2xl font-semibold` twice, and four more
 * one-offs — with no rule about which meant what. Three steps replace them, and
 * the step names say the structural role rather than the size, so a theme can
 * move the size without the name becoming wrong.
 *
 * Each step is one utility because the token carries its line height and weight
 * as sub-properties (`--text-section--font-weight`), which is the reason those
 * doubled hyphens exist in `index.css`.
 *
 * **The element is separate from the step.** A `SectionTitle` renders `h2` by
 * default, but a surface whose heading structure needs `h3` says so — heading
 * level is document structure and belongs to the page, whereas size is
 * appearance and belongs here. Conflating them is how a page ends up choosing
 * its outline to get the type it wanted.
 */

type Level = 'h1' | 'h2' | 'h3' | 'h4';

interface HeadingProps {
  children: ReactNode;
  as?: Level;
  id?: string;
  /** Position only — the margin below the heading. */
  className?: string;
}

function heading(step: string, fallback: Level) {
  return function Heading({ children, as, id, className }: HeadingProps): JSX.Element {
    const Tag = as ?? fallback;
    return (
      <Tag id={id} className={className === undefined ? step : `${className} ${step}`}>
        {children}
      </Tag>
    );
  };
}

/** The name of the surface. One per page. */
export const PageTitle = heading('text-title text-ink', 'h1');

/** A region within the surface. */
export const SectionTitle = heading('text-section text-ink', 'h2');

/** A group within a region — the smallest step that is still a heading. */
export const SubsectionTitle = heading('text-subsection text-ink', 'h3');

/**
 * Supporting prose: the sentence under a control saying what it does, the
 * empty state, the loading line. Three shades were in use for this
 * interchangeably; this is the one.
 */
export function Note({
  children,
  className,
  role,
}: {
  children: ReactNode;
  className?: string;
  role?: 'status';
}): JSX.Element {
  const classes = 'text-sm text-ink-subtle';
  return (
    <p role={role} className={className === undefined ? classes : `${className} ${classes}`}>
      {children}
    </p>
  );
}

/** Fine print: a legend, a hash, a timestamp. The faintest step that is text. */
export function Fine({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const classes = 'text-xs text-ink-faint';
  return (
    <p className={className === undefined ? classes : `${className} ${classes}`}>{children}</p>
  );
}
