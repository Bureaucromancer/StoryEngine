// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

import { useFocusTrap } from '../useFocusTrap.js';

/**
 * The modal.
 *
 * Unlike most of this directory it is a component on the merits rather than for
 * tidiness: it owns the focus trap and the ARIA that makes a dialog a dialog.
 * Three surfaces were hand-rolling the same four things — `useFocusTrap`,
 * `aria-modal`, a scrim and a raised panel — and the comment at the extraction
 * of `useFocusTrap` said why that is dangerous: two spellings of a trap is how
 * one of them ends up missing the Escape arm. The same argument reaches one
 * step further out, to the markup the trap is attached to.
 *
 * **`role` distinguishes the two kinds.** `alertdialog` is for a dialog raised
 * *because something went wrong* and whose message must be announced with it —
 * the save conflict. `dialog` is for one the user opened on purpose. Getting
 * this wrong is inaudible to everyone not using a screen reader, which is why
 * it is a prop with no default rather than a detail per call site.
 *
 * The scrim was `bg-slate-900/40` at two sites and `/50` at a third. It is one
 * value now, and a token rather than an opacity modifier: a modifier bakes its
 * sRGB fallback at build time, which would strand the scrim on the light
 * theme's value once a second theme exists.
 */

export interface DialogProps {
  role: 'dialog' | 'alertdialog';
  /** The id of the heading inside `children` that names this dialog. */
  labelledBy: string;
  onDismiss: () => void;
  children: ReactNode;
  /** `wide` for a dialog carrying a form rather than a question. */
  size?: 'default' | 'wide';
}

export function Dialog({
  role,
  labelledBy,
  onDismiss,
  children,
  size = 'default',
}: DialogProps): JSX.Element {
  const surface = useFocusTrap(onDismiss);

  return (
    <div
      role={role}
      aria-modal="true"
      aria-labelledby={labelledBy}
      ref={surface}
      className="fixed inset-0 flex items-center justify-center bg-overlay p-4"
    >
      <div
        className={
          size === 'wide'
            ? 'flex w-full max-w-lg flex-col gap-4 rounded-panel border border-line bg-surface p-6'
            : 'w-full max-w-md rounded-panel border border-line bg-surface p-6'
        }
      >
        {children}
      </div>
    </div>
  );
}
