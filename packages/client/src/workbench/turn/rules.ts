// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { BudgetVerdict } from '@storyengine/shared';

/**
 * `blockId` → the rule that ruled on it, for {@link BlockTable}.
 *
 * Extracted at [P3.4] because it acquired a second caller: the panel now
 * renders a *pending* assembly beside a committed one, and both tables have to
 * be built from the verdict the same way. A verdict lists **every** block
 * including the included ones ([21 §1.5] — *a verdict listing only drops
 * cannot answer what falls out next*), which is what makes one lookup enough
 * for both the ruling column and the dropped-row fade.
 */
export function rulesOf(verdict: BudgetVerdict): ReadonlyMap<string, string> {
  return new Map(verdict.decisions.map((decision) => [decision.blockId, decision.rule]));
}
