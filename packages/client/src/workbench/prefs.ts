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
