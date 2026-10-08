// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX, ReactNode } from 'react';

import { usePatchPrefs, usePrefs } from '../queries.js';
import { Button } from '../ui/Button.js';
import { workbenchOpenFromPrefs, workbenchOpenPatch } from './prefs.js';

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
 */
export function OpenDockButton({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: 'quiet';
}): JSX.Element {
  const prefs = usePrefs();
  const patchPrefs = usePatchPrefs();
  const open = workbenchOpenFromPrefs(prefs.data?.prefs);

  return (
    <Button
      type="button"
      size="compact"
      {...(variant === undefined ? {} : { variant })}
      aria-expanded={open}
      aria-controls={open ? 'workbench' : undefined}
      onClick={() => {
        if (!open) patchPrefs.mutate(workbenchOpenPatch(true));
      }}
    >
      {children}
    </Button>
  );
}
