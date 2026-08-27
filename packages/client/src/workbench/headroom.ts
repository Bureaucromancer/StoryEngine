// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { BudgetVerdict } from '@storyengine/shared';

/**
 * The budget verdict, phrased with its headroom — gate step 5's guard,
 * computed in the view because the record is honest and unbothered:
 * `nextToDrop` is unconditionally *the next survivor in sacrifice order*, so
 * the first real turn recorded the system instruction as next-to-fall while
 * spending 61 of 5,344 available tokens. Showing that line as an alarm would
 * be the view shipping a false one; hiding the answer would break the
 * verdict's own promise that *what falls out next* is answerable before it
 * happens. So both states carry the answer, and the phrasing carries the
 * pressure.
 */
export interface Headroom {
  /** What assembly may spend: the limit minus the completion reserve. */
  available: number;
  spent: number;
  /** Whether "next to fall" is a warning or an idle fact. */
  imminent: boolean;
  next: string[];
}

/**
 * A view-side phrasing threshold, not record data: below it, naming the next
 * block to fall is trivia; at or above it, it is the warning the meter
 * exists for.
 */
const HEADROOM_WARN_RATIO = 0.85;

export function headroom(verdict: BudgetVerdict): Headroom {
  const available = Math.max(0, verdict.limit.tokens - verdict.reserved);
  const imminent = available === 0 || verdict.spent >= HEADROOM_WARN_RATIO * available;
  return { available, spent: verdict.spent, imminent, next: verdict.nextToDrop };
}
