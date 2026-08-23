// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

/**
 * A bordered box saying something went wrong, or might.
 *
 * It replaces seven copies of the error box and three of the warning box, which
 * between them differed only in padding and outer margin. The padding is here;
 * the margin was never appearance and belongs to whatever is stacking them.
 *
 * **The three tones are three meanings, not three colours**, and the split is
 * what makes the palette worth having:
 *
 * - `error` — a refusal or a destruction. A rejected write, a 412, a failed
 *   sign-in.
 * - `warning` — something is wrong and you may still proceed. The pending
 *   restart, an account with no way back in.
 * - `neutral` — a statement of fact that happens to need a box around it.
 *
 * `role` is passed through rather than assumed. A box rendered in reaction to
 * something the user just did wants `role="alert"`; one that was on the page
 * when it loaded does not, and announcing it would interrupt a screen reader
 * for old news.
 */

export type AlertTone = 'error' | 'warning' | 'neutral';

const BASE = 'rounded-panel border p-3 text-sm';

const TONE: Record<AlertTone, string> = {
  error: 'border-danger-line bg-danger-surface text-danger-ink',
  warning: 'border-warn-line bg-warn-surface text-warn-ink',
  neutral: 'border-line bg-surface-sunken text-ink-muted',
};

export interface AlertProps {
  tone?: AlertTone;
  children: ReactNode;
  role?: 'alert' | 'status';
  id?: string;
  /** Position only — the margin that separates this from what is above it. */
  className?: string;
}

export function Alert({ tone = 'error', children, role, id, className }: AlertProps): JSX.Element {
  const classes = `${BASE} ${TONE[tone]}`;
  return (
    <div
      id={id}
      role={role}
      className={className === undefined ? classes : `${className} ${classes}`}
    >
      {children}
    </div>
  );
}

/**
 * The same meanings without the box, for a message that sits under the control
 * it belongs to. Eight sites spelled this `text-sm text-red-900` inline and
 * five more spelled it without the size.
 */
const NOTE_TONE: Record<AlertTone, string> = {
  error: 'text-danger-ink',
  warning: 'text-warn-ink',
  neutral: 'text-ink-subtle',
};

export function AlertNote({
  tone = 'error',
  children,
  role,
  id,
  className,
}: AlertProps): JSX.Element {
  const classes = `text-sm ${NOTE_TONE[tone]}`;
  return (
    <p
      id={id}
      role={role}
      className={className === undefined ? classes : `${className} ${classes}`}
    >
      {children}
    </p>
  );
}
