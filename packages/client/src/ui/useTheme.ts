// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect } from 'react';

import { usePrefs } from '../queries.js';
import { applyTheme, themeFromPrefs, type ThemeChoice } from './theme.js';

/**
 * Keeps `data-theme` in step with the stored preference.
 *
 * **Mounted once, in the signed-in frame.** `Shell` renders only behind the
 * gate in `App.tsx`, so this query is never issued unauthenticated. Before
 * login the answer comes from the mirror `main.tsx` applied instead, which is
 * the right split: a preference belongs to an account, but the *browser* can
 * remember what it last showed, and the login screen has no account to ask.
 *
 * **It re-applies rather than applying once.** `main.tsx` has already set the
 * attribute from the mirror, so the common path is this effect confirming what
 * is on screen. The paths that matter are the others: a first load on a new
 * browser where the mirror is empty, a load after the choice was changed in
 * another browser, and the sign-out below.
 *
 * The query is not gated on being signed in because the surface that renders
 * this already is. If that ever stops being true, gate it — an unauthenticated
 * `GET /api/me/prefs` is a 401 in the console for someone who has done nothing
 * wrong, which is the pattern `SettingsPage` avoids by not rendering the admin
 * half at all.
 */
export function useTheme(): ThemeChoice {
  const prefs = usePrefs();
  const choice = themeFromPrefs(prefs.data?.prefs);

  useEffect(() => {
    // Only once there is an answer. Applying `system` while the read is still
    // in flight would undo `main.tsx`'s mirrored value and produce exactly the
    // flash the mirror exists to prevent.
    if (prefs.data === undefined) return;
    applyTheme(choice);
  }, [choice, prefs.data]);

  return choice;
}
