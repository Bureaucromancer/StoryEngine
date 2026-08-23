// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

/**
 * A small label attached to a name.
 *
 * `provenance` is amber and `warning` is amber, and they are still two
 * different tones here. That is the whole return on a token layer: "System" and
 * "Hand edit on disk" say *this was not authored here*, which is not a warning
 * and should not be recoloured as if it were. Spelled as one colour — which is
 * how both arrived, as `bg-amber-100 text-amber-900` in two files — a later
 * theme cannot tell them apart and cannot move one without the other.
 */

export type BadgeTone = 'neutral' | 'provenance' | 'danger';

const BASE = 'rounded-control px-2 py-0.5 text-xs font-medium';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-badge-surface text-badge-ink',
  provenance: 'bg-provenance-surface text-provenance-ink',
  danger: 'bg-danger-muted text-danger-ink',
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string;
}

export function Badge({ tone = 'neutral', children, title }: BadgeProps): JSX.Element {
  return (
    <span title={title} className={`${BASE} ${TONE[tone]}`}>
      {children}
    </span>
  );
}
