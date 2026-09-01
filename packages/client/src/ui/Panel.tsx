// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode, Ref } from 'react';

/**
 * A bordered region grouping controls that belong together.
 *
 * Three variants, distinguished by how much they are claiming:
 *
 * - `card` — a thing in a list of things. A connection, an account.
 * - `surface` — a region raised off the canvas. The header, a dialog body.
 * - `inset` — a region recessed into it. A `<pre>`, a read-only echo of stored
 *   bytes.
 *
 * `inset` is the one that earns its place: it is where raw stored content gets
 * shown back, and it was the site of the contrast failure that started this
 * work — a `bg-neutral-900` block inheriting near-black text from a light
 * shell, at 1.01 to 1. Named here, it cannot inherit the wrong ink again,
 * because the token that sets its background and the token that sets its text
 * are chosen together.
 */

export type PanelVariant = 'card' | 'surface' | 'inset';

const VARIANT: Record<PanelVariant, string> = {
  card: 'rounded-panel border border-line p-4',
  surface: 'rounded-panel border border-line bg-surface p-4',
  inset: 'rounded-panel border border-line bg-surface-muted p-3 text-ink-muted',
};

export interface PanelProps {
  variant?: PanelVariant;
  children: ReactNode;
  /** Position and layout — a margin, a `max-w-md`, a `flex flex-col gap-4`. */
  className?: string;
  /**
   * The element, for a caller that has to reach it — scrolling one into view is
   * the case this arrived for ([05 §5.3]'s entry address, which lands a link on
   * one entry of a few hundred).
   */
  ref?: Ref<HTMLDivElement>;
  /**
   * *This is the one the address meant.*
   *
   * Typed rather than spread through, and present because the alternative was
   * an outline and nothing else — a focus mark that exists only as a colour is
   * a focus mark half the people using the page cannot perceive.
   */
  'aria-current'?: 'true';
}

export function Panel({
  variant = 'card',
  children,
  className,
  ref,
  'aria-current': current,
}: PanelProps): JSX.Element {
  const classes = VARIANT[variant];
  return (
    <div
      ref={ref}
      aria-current={current}
      className={className === undefined ? classes : `${className} ${classes}`}
    >
      {children}
    </div>
  );
}
