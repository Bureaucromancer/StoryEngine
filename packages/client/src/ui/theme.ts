// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The theme choice: which of the two designed defaults a person sees, or
 * neither, which means the one their system asked for.
 *
 * The stylesheet already answers all three
 * ([05 §1.2](../../../../docs/design/05-ui-surfaces.md)) — `prefers-color-scheme`
 * for the default, `[data-theme]` for an explicit choice, and a
 * `:not([data-theme='light'])` guard so the explicit one wins in *both*
 * directions. This module is only the part that decides what to put in the
 * attribute, and where the answer is kept.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

/**
 * The key in `prefs.json` — [06 B13](../../../../docs/design/06-open-questions.md),
 * and the first preference to actually use the store that question settled.
 *
 * Per-user rather than per-install, which is what a theme is: two people
 * sharing a server do not share eyes. The server enforces the dotted shape and
 * a size cap and reads no meaning into either half, so the name is this
 * module's to choose and its to keep stable.
 */
export const THEME_KEY = 'ui.theme';

/**
 * **`system` is the absence of a preference, not a third value.**
 *
 * `PATCH /api/me/prefs` deletes a key sent as `null`, so choosing *Match my
 * system* removes the row rather than storing a word that means "ignore me".
 * That keeps one meaning for the default: a person who never opened this
 * setting and a person who chose *system* are in the same state, and the
 * behaviour cannot drift apart later because there is nothing to drift.
 */
export function themeFromPrefs(prefs: Record<string, unknown> | undefined): ThemeChoice {
  const stored = prefs?.[THEME_KEY];
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** The patch that records a choice. `null` deletes, which is what `system` is. */
export function themePatch(choice: ThemeChoice): Record<string, unknown> {
  return { [THEME_KEY]: choice === 'system' ? null : choice };
}

/**
 * Where the choice is mirrored so it can be applied before anything renders.
 *
 * The authority is the server; this is a cache, and it is the only use of
 * `localStorage` in the client. Without it every load would paint the system
 * theme first and correct itself once `GET /api/me/prefs` answered — a white
 * flash on every navigation for anyone whose choice differs from their OS,
 * which is the failure that makes people stop using a theme setting.
 *
 * Two consequences worth stating rather than discovering. It is **per browser
 * and not per account**, so on a shared browser the first paint after a switch
 * of user can be the previous user's choice, corrected as soon as prefs land —
 * cosmetic, and self-healing. And it is **not authoritative**: nothing reads it
 * to decide what to save, so a stale or hand-edited value cannot outlive the
 * next answer from the server.
 */
const MIRROR_KEY = 'storyengine.theme';

/** Reads the mirror. Storage can throw — private mode, a disabled cookie jar. */
export function readMirroredTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(MIRROR_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writeMirroredTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(MIRROR_KEY);
    else localStorage.setItem(MIRROR_KEY, choice);
  } catch {
    // A browser that refuses storage still gets a working theme, one paint
    // late. Refusing to apply it because it could not be cached would trade a
    // flash for a broken setting.
  }
}

/**
 * Puts the choice where CSS can see it, and mirrors it for the next load.
 *
 * `system` **removes** the attribute rather than setting it to `'system'`,
 * because the stylesheet's default arm is the media query and an unrecognised
 * attribute value would sit in front of it doing nothing.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  writeMirroredTheme(choice);
}
