// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

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
}

export function Panel({ variant = 'card', children, className }: PanelProps): JSX.Element {
  const classes = VARIANT[variant];
  return (
    <div className={className === undefined ? classes : `${className} ${classes}`}>{children}</div>
  );
}
