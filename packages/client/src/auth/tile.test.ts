// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { drawnTile, hueOf, initialsOf } from './tile.js';

/**
 * The tile nobody uploaded — [12 §5.4](../../../../docs/design/12-account-gallery.md),
 * [P10.4].
 *
 * ***Two inputs, chosen rather than convenient, and each is a claim worth
 * holding.*** **Initials from the display name**, because that is the name on
 * the tile; **hue from the handle**, because the handle is immutable and *a
 * rename should not change anybody's colour* — the tile is how you find
 * yourself in a grid, and having it move under you is the failure a generated
 * identicon exists to avoid.
 *
 * **The falsifying mutation is hashing the display name.** Every assertion about
 * a colour existing still passes; *a rename keeps the colour* goes red, which is
 * the only thing that makes this better than a random swatch.
 */

describe('the initials', () => {
  it('takes the first and last word, so a middle name does not win', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('Ada Byron King Lovelace')).toBe('AL');
  });

  /**
   * **One word, one letter.** *Ada* is `A` rather than `Ad`: one initial looks
   * deliberate, and two letters cut out of the middle of a word look like a bug.
   */
  it('takes one letter from one word', () => {
    expect(initialsOf('Ada')).toBe('A');
  });

  /**
   * ***Grapheme-aware rather than by code unit.*** `displayName` is free text,
   * and the lint rules already forbid spreading a string for this reason — a
   * spread cuts a surrogate pair in half, and a combining mark is worse: it
   * renders as a letter with nothing under it.
   */
  it('does not cut a character in half', () => {
    // A surrogate pair: one character, two code units.
    expect(initialsOf('𝒜da')).toBe('𝒜');
    // A base plus a combining acute, which `[0]` would split.
    expect(initialsOf('Áda')).toBe('Á'.toUpperCase());
  });

  it('answers something for a name that is only spaces', () => {
    // A blank tile with no letters is indistinguishable from a broken one.
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('the colour', () => {
  /**
   * ***The claim the whole design rests on.*** A rename is the ordinary event
   * this has to survive: somebody changes their display name and their tile is
   * where it was, the colour it was.
   */
  it('follows the handle, so a rename keeps it', () => {
    const before = drawnTile({ handle: 'ned', displayName: 'Ned' });
    const after = drawnTile({ handle: 'ned', displayName: 'Ned Carlson' });

    expect(after.background).toBe(before.background);
    // The letters do move, which is correct: they are the name on the tile.
    expect(after.initials).not.toBe(before.initials);
  });

  it('is stable for one handle and different across two', () => {
    expect(hueOf('ned')).toBe(hueOf('ned'));
    expect(hueOf('ned')).not.toBe(hueOf('mara'));
  });

  /**
   * ***The gold-angle multiplier is what makes this useful rather than
   * technically correct.*** `ned` and `neil` differ in one byte; without the
   * spread they would get two colours a person cannot tell apart, which is the
   * whole job undone.
   */
  it('pushes adjacent handles far apart', () => {
    const gap = Math.abs(hueOf('ned') - hueOf('neil'));
    expect(Math.min(gap, 360 - gap)).toBeGreaterThan(30);
  });

  it('stays inside the hue circle', () => {
    for (const handle of ['a', 'ned', 'mara', 'ada', 'zzzzzzzzzzzz', '']) {
      expect(hueOf(handle), handle).toBeGreaterThanOrEqual(0);
      expect(hueOf(handle), handle).toBeLessThan(360);
    }
  });

  /**
   * ***`oklch` rather than `hsl`, which is the appearance layer's own
   * choice.*** `index.css` defines every token in `oklch` precisely because
   * equal lightness numbers look equally light across hues there and do not in
   * `hsl` — so a generated tile in `hsl` would be the one surface whose yellows
   * glare and whose blues disappear.
   */
  it('is spelled in the colour space the theme is spelled in', () => {
    const tile = drawnTile({ handle: 'ned', displayName: 'Ned' });
    expect(tile.background).toMatch(/^oklch\(/);
    expect(tile.ink).toMatch(/^oklch\(/);
  });
});
