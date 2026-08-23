// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * A real focus trap, because `aria-modal` is a claim rather than a mechanism
 * (F18).
 *
 * It says *everything behind me is inert* to a screen reader and does nothing at
 * all to the Tab key — so a form underneath stays reachable while a dialog
 * insists the save was refused. Three parts, and each is the one people leave
 * out: **Tab wraps at both ends**, **Escape is a way out** (the same one as
 * Cancel — a modal you can only leave by choosing is a modal people click
 * through), and **focus returns to whatever opened it**.
 *
 * Extracted from the conflict dialog at
 * [P2A §3](../../../docs/design/workplan/13-p2a-configuration-surface.md) so the
 * settings surface's two dialogs can use it rather than growing a second
 * spelling. The extraction was safe to make because that dialog's tests already
 * pinned all three behaviours — which is the only reason it happened in a commit
 * that changed nothing else.
 */
export function useFocusTrap(onEscape: () => void): RefObject<HTMLDivElement | null> {
  const surface = useRef<HTMLDivElement>(null);

  /**
   * Whatever had focus before this dialog existed.
   *
   * Captured during the first *render*, not in the effect below: by the time
   * effects run, the dialog's `autoFocus` has already moved focus onto its own
   * first button, so an effect would faithfully restore focus to a button that
   * is about to be removed — and the caller lands on `<body>`, which is exactly
   * the "where did my keyboard go" a trap is supposed to prevent.
   */
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    function focusable(): HTMLElement[] {
      return Array.from(
        surface.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== 'Tab') return;

      const stops = focusable();
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;

      // Also covers focus that has escaped already — a click on the page
      // behind, or a browser that moved it somewhere unexpected.
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !surface.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !surface.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Only if it is still there: the opener can have been removed by the same
      // state change that closed the dialog.
      if (opener?.isConnected === true) opener.focus();
    };
  }, [onEscape, opener]);

  return surface;
}
