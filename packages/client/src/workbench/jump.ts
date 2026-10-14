// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { usePatchPrefs, usePrefs } from '../queries.js';
import { workbenchOpenFromPrefs, workbenchOpenPatch } from './prefs.js';

/**
 * ***Where the dock can be opened at, over Play*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.5).
 *
 * The play subject is two stacked sections now — **Session**, the panels that
 * say how this session is set up, which the play column carried until this
 * stage, and **Turn record**, the reader [10 §3](../../../../docs/design/10-ui-surfaces.md)
 * was written about — and three controls outside the dock each mean one of
 * them: Play's *Session settings* the first, the context meter the second, and
 * a block table's *Edit in the pack* a block inside the first. So each section
 * has an address of its own in the document, spelled once here, and the
 * section element carries it (`Workbench.tsx`'s `DockSection`).
 *
 * *An element id, not a route.* The dock's open state is a preference and
 * deliberately not the URL ([P3 §1.2]), and which section of it is in view is
 * less than that: scrolling. Settings' rows put their section in the hash
 * because the page is what they move; these move the dock, which has no
 * address, so a jump here is a scroll and a focus and nothing is remembered.
 */
export const DOCK_SECTIONS = {
  session: 'workbench-session',
  record: 'workbench-record',
} as const;

/**
 * ***Bring part of the dock into view and give it the keyboard*** — once it
 * is drawn.
 *
 * `settings/contents.tsx`'s `jumpToSection` with one difference, and the
 * difference is why this is not that: a control on the page that opens the
 * dock writes a preference, and the dock is drawn a render later, so the
 * target does not exist yet at the press. This looks a frame at a time and
 * gives up after about a second — the same patience `jumpWhenShown` has for
 * the opposite trip — rather than wait on a dock whose preference write was
 * refused.
 *
 * *Only an element inside the dock.* An id is a document's, and the play page
 * draws its own sections; a jump that found one of those would scroll the
 * page behind the reader's back, so anything outside `#workbench` is treated
 * as not drawn yet.
 *
 * **Focus follows the scroll**, as a settings row's jump does: a keyboard
 * user's next Tab goes on from the section they were taken to rather than from
 * a control on the page that is now a screen away. The target is
 * `tabIndex={-1}` — focusable and out of the tab order — so the ring shows
 * only for a keyboard jump.
 */
export function jumpInDock(anchor: string, frames = 60): void {
  const target =
    document.getElementById('workbench')?.querySelector<HTMLElement>(`[id="${anchor}"]`) ?? null;
  if (target === null) {
    if (frames > 0) {
      requestAnimationFrame(() => {
        jumpInDock(anchor, frames - 1);
      });
    }
    return;
  }
  target.scrollIntoView({ block: 'start' });
  target.focus({ preventScroll: true });
}

/**
 * ***Open the dock, and take the reader to a part of it.***
 *
 * **Opens, never toggles**, `OpenDockButton`'s and the meter's rule: a control
 * that closed the dock on a second press would be a control you cannot use to
 * find the thing twice. And it **writes only when the dock is shut** — a
 * redundant patch is what `dock.test.tsx` refuses on a mount that finds the
 * preference already set. The jump is made either way, since a reader who
 * presses *Session settings* with the dock already open and scrolled to the
 * record wants the settings, which is the press's whole meaning.
 */
export function useOpenDockAt(): (anchor?: string) => void {
  const prefs = usePrefs();
  const { mutate: patch } = usePatchPrefs();
  const open = workbenchOpenFromPrefs(prefs.data?.prefs);
  return useCallback(
    (anchor?: string) => {
      if (!open) patch(workbenchOpenPatch(true));
      if (anchor !== undefined) jumpInDock(anchor);
    },
    [open, patch],
  );
}

/**
 * ***An address that asks for something in the dock opens it*** — the play
 * route's `?block=`, which [P7B.4] made the address of *Edit in the pack* and
 * which names a block the Session section edits since P12A.5 (2026-10-13).
 *
 * **Once per arrival of a value, not for as long as the address holds it.**
 * The effect is keyed on the value alone, so a person who closes the dock
 * with `?block=` still in the address is not overruled on the next render —
 * the opener is read through a ref for exactly that reason: its identity
 * changes with the open state, and an effect that depended on it would run
 * again on the close and reopen what was just shut. A different block opens it
 * again, and so does loading the address afresh.
 *
 * *Where it lands is the editor's own business* — `SessionPanel`'s block
 * editor brings itself into view and takes the keyboard when it is drawn, which
 * is the one moment that is certain to come after the dock, the session's read
 * and the pack have all arrived.
 */
export function useOpenDockFor(wanted: string | undefined): void {
  const openDock = useOpenDockAt();
  const latest = useRef(openDock);
  useLayoutEffect(() => {
    latest.current = openDock;
  });
  useEffect(() => {
    if (wanted !== undefined) latest.current();
  }, [wanted]);
}
