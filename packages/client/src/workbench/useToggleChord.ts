// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect } from 'react';

/**
 * The workbench toggle: Ctrl+` on a document listener —
 * [P3.1](../../../../docs/design/workplan/15-p3-implementation.md).
 *
 * The client's only other keyboard handling is `useFocusTrap`, and this hook
 * is deliberately not it and must never call it: the trap teleports escaped
 * focus back on the next Tab press and swallows Escape unconditionally, which
 * over a non-modal dock makes the main view unusable while the dock is open —
 * the exact opposite of *left open while you work*. The toggle is its own,
 * smaller mechanism: one chord, one guard, one callback.
 *
 * **The chord is Ctrl+`**, decided at this stage rather than inherited — the
 * plan constrains it only negatively (not F12, not Ctrl+Shift+I, both spoken
 * for by devtools) — and it matches the physical key *or* the logical one:
 * `event.code === 'Backquote'` covers layouts where the backquote is a dead
 * key (no `` ` `` character, `key: 'Dead'`), and `event.key` covers senders
 * with no physical key to report — measured, not imagined: this project's own
 * browser pane synthesises Ctrl+` as `{ code: '', key: '`' }`, and remote
 * desktops do the same. One event can match both halves and still toggles
 * once. VS Code's panel toggle is the same chord, which is the muscle memory
 * worth borrowing.
 *
 * **The editable guard is the plan's own requirement**: text inputs are
 * everywhere — the action input, the guidance box — and a toggle that fired
 * out of one would trade a keystroke of typing for a panel jump. The chord is
 * simply inert while an editable element has focus; there is no second, wider
 * chord for that case, because the visible opener in the header is the
 * always-available path.
 *
 * The caller owes a stable callback (`useCallback`), because the effect
 * re-subscribes when it changes — the same contract `useFocusTrap` states for
 * `onEscape`.
 */
export function useToggleChord(onToggle: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.code !== 'Backquote' && event.key !== '`') || !event.ctrlKey) return;
      if (event.altKey || event.metaKey || event.shiftKey || event.repeat) return;
      if (isEditable(event.target)) return;
      event.preventDefault();
      onToggle();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onToggle]);
}

/**
 * The three form controls, plus contenteditable both ways: the property is
 * the browser's answer and carries the inheritance rules (a child of an
 * editable region is editable), and the attribute walk beside it is not
 * test-only decoration — it is also correct in a browser for every region an
 * author marks — but it is *load-bearing* in jsdom, which has never
 * implemented `isContentEditable` and would otherwise report every editable
 * region as fair game, making the guard's contenteditable arm untestable.
 */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}
