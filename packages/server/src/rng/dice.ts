// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Dice notation — `1d20`, `2d6+3`, `d%`.
 *
 * Not speculative: the authored-rules vocabulary already needs `<<1d20>>` and
 * both first-party reference extensions need dice
 * ([19 §14.2](../../../../docs/design/19-tech-stack.md)).
 *
 * **A notation this parser does not understand is an error, never a default.**
 * Quietly rolling `1d6` because `2d6kh1` did not parse would produce a game
 * that is subtly wrong in a way nobody can see — which is the same class of
 * failure as the modulo bias §14.3 rejects, and harder to find.
 */

export interface DiceNotation {
  /** How many dice. */
  count: number;
  /** How many sides. `d%` is 100. */
  sides: number;
  /** A flat modifier, added after the dice. */
  modifier: number;
  /** As written, for the record: `2d6+3` reads better than its parts. */
  source: string;
}

export class DiceNotationError extends Error {
  constructor(notation: string) {
    super(`Unrecognised dice notation: ${JSON.stringify(notation)}.`);
    this.name = 'DiceNotationError';
  }
}

/** `2d6+3`, `d20`, `4d%`, `1d8-1`. Whitespace is ignored; case is not significant. */
const DICE = /^(\d*)d(%|\d+)([+-]\d+)?$/i;

/** Bounds that keep a typo from becoming a denial of service. */
const MAX_COUNT = 1000;
const MAX_SIDES = 1_000_000;

export function parseDice(notation: string): DiceNotation {
  const cleaned = notation.replace(/\s+/g, '');
  const match = DICE.exec(cleaned);
  if (!match) throw new DiceNotationError(notation);

  const count = match[1] === '' || match[1] === undefined ? 1 : Number(match[1]);
  const sides = match[2] === '%' ? 100 : Number(match[2]);
  const modifier = match[3] === undefined ? 0 : Number(match[3]);

  if (count < 1 || count > MAX_COUNT) throw new DiceNotationError(notation);
  if (sides < 2 || sides > MAX_SIDES) throw new DiceNotationError(notation);

  return { count, sides, modifier, source: cleaned };
}
