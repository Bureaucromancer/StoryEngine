// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

import { usePrefs } from '../queries.js';
import { Button } from '../ui/Button.js';
import { useOpenDockAt } from './jump.js';
import { workbenchOpenFromPrefs } from './prefs.js';

/**
 * ***A page's way to what the workbench shows over it*** — the library's
 * *Import…*, home's *All releases…* and settings' *Contents…*, which were two
 * copies of one control until a third asked for it (2026-10-07).
 *
 * **Its whole job is to open the dock**, which is why it patches the preference
 * rather than routing anywhere: [P3 §1.2] is explicit that the panel's open
 * state is a preference and deliberately **not** the URL, because a
 * URL-addressable panel is a place and [10 §3](../../../../docs/design/10-ui-surfaces.md)
 * spent its argument on the panel not being one. The panel's *subject* is in
 * the address; its *visibility* is not, and the two are different facts.
 *
 * It exists at all because something reachable only by knowing that Ctrl+`
 * opens a panel which happens to show it over this route is not pointed at by
 * anything. Deliberately not disabled or hidden once the dock is open: the
 * button is where somebody looks for the thing, and a control that vanishes
 * once it has worked is a control you cannot find twice. So a second press
 * changes nothing rather than closing the dock — the dock's own *Close* does
 * that.
 *
 * ***And it can open the dock at a part of it*** (2026-10-13,
 * [P12A](../../../../docs/design/workplan/35-p12a-the-look.md) P12A.5): Play's
 * *Session settings*, whose subject is two sections, of which it means the
 * first. `at` is one of `jump.ts`'s section anchors; the press opens the dock
 * if it is shut and then takes the reader there, and a second press takes them
 * there again — the one thing a second press does, since by then the reader
 * may have scrolled to the record. `keyshortcuts` names the chord that opens
 * the dock at the same place, for the control's `aria-keyshortcuts`, so the
 * keystroke is as discoverable from the control as the shell's own button
 * makes it.
 */
export function OpenDockButton({
  children,
  variant,
  at,
  keyshortcuts,
}: {
  children: ReactNode;
  variant?: 'quiet';
  at?: string;
  keyshortcuts?: string;
}): JSX.Element {
  const prefs = usePrefs();
  const open = workbenchOpenFromPrefs(prefs.data?.prefs);
  const openAt = useOpenDockAt();

  return (
    <Button
      type="button"
      size="compact"
      {...(variant === undefined ? {} : { variant })}
      {...(keyshortcuts === undefined ? {} : { 'aria-keyshortcuts': keyshortcuts })}
      aria-expanded={open}
      aria-controls={open ? 'workbench' : undefined}
      onClick={() => {
        openAt(at);
      }}
    >
      {children}
    </Button>
  );
}
