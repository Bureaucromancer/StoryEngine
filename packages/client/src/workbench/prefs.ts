// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The workbench's preferences —
 * [P3.1a](../../../../docs/design/workplan/05-p3-implementation.md), through
 * the store whose own docstring gives *"whether a pane is collapsed"* as its
 * motivating example. This module is the same shape as `ui/theme.ts`: the key
 * spelled once, a read helper and a patch helper as a pair, and the default
 * expressed as the *absence* of the preference rather than a stored value
 * that means "ignore me".
 *
 * The segments are hyphenated — `workbench-open`, never `workbenchOpen` —
 * because the store's `KEY_PATTERN` admits lowercase and hyphens only, and a
 * camelCased key would be refused with a 400 at the first patch. Written here
 * so it is a constraint the next key inherits rather than rediscovers.
 */

export const OPEN_KEY = 'ui.workbench-open';

/**
 * Closed is the absence of the preference, exactly as `system` is for the
 * theme: a person who never opened the dock and a person who closed it are in
 * one state, and the default cannot drift apart from the never-set case
 * because there is nothing to drift.
 */
export function workbenchOpenFromPrefs(prefs: Record<string, unknown> | undefined): boolean {
  return prefs?.[OPEN_KEY] === true;
}

/** The patch that records a toggle. `null` deletes, which is what closed is. */
export function workbenchOpenPatch(open: boolean): Record<string, unknown> {
  return { [OPEN_KEY]: open ? true : null };
}

export const SIZE_KEY = 'ui.workbench-size';

/**
 * The bounds, and why the *read* clamps rather than trusting the file:
 * [P3 §1.2] names the failure — a per-account pixel width fights between a
 * laptop and a large monitor, and prefs.json is hand-editable by design, so
 * the number can be anything at all. Clamping on read is the one-line
 * defusal: whatever is stored, what renders is a dock that fits. The floor
 * keeps the JSON readable; the ceiling keeps main usable beside it on the
 * narrowest desktop the phase supports (the phone sheet is P3.8's problem).
 */
export const MIN_SIZE = 280;
export const MAX_SIZE = 640;
export const DEFAULT_SIZE = 384;

/** One arrow press's worth of resize, for the splitter's keyboard half. */
export const SIZE_STEP = 16;

export function clampSize(size: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size)));
}

/**
 * Unlike the open key there is no absence case to honour — a width is a
 * number, not a mode — so anything unusable (missing, a string, `NaN`, an
 * `Infinity` from a hand edit) reads as the default rather than as an error.
 * The store's own position: a broken prefs file means somebody's pane is the
 * wrong size, nothing worse.
 */
export function workbenchSizeFromPrefs(prefs: Record<string, unknown> | undefined): number {
  const stored = prefs?.[SIZE_KEY];
  return typeof stored === 'number' && Number.isFinite(stored) ? clampSize(stored) : DEFAULT_SIZE;
}

/** Clamped on write as well, so a drag released off-screen stores a legal number. */
export function workbenchSizePatch(size: number): Record<string, unknown> {
  return { [SIZE_KEY]: clampSize(size) };
}
