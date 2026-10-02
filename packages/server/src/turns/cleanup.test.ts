// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { cleanReply } from './cleanup.js';

/**
 * ***A group reply, cleaned*** — [P14 §1.4] point 3, [P14.2].
 *
 * Each row names the source line it was transcribed from, so a reader can check
 * the claim against the pin rather than against this file's own reading of it.
 */
const OTHERS = ['Lund', 'Marlow', 'Ned'];

describe('cleanReply', () => {
  it("strips the speaker's own leading label — ST script.js:6515, Marinara :6680", () => {
    expect(cleanReply('Vera: "You came."', 'Vera', OTHERS)).toBe('"You came."');
    // Whitespace before and after the colon is forgiven, as Marinara forgives it.
    expect(cleanReply('  Vera :\n"You came."', 'Vera', OTHERS)).toBe('"You came."');
  });

  it("strips the speaker's label from every line, not the first — ST script.js:6494-6497", () => {
    expect(cleanReply('Vera: "You came."\nVera: "Sit."', 'Vera', OTHERS)).toBe(
      '"You came."\n"Sit."',
    );
  });

  it("cuts at the first line opened by another member's name — ST script.js:3131-3137", () => {
    expect(cleanReply('"You came."\nShe set the glass down.\nLund: "Aye."', 'Vera', OTHERS)).toBe(
      '"You came."\nShe set the glass down.',
    );
    // The earliest of several, whichever member it is.
    expect(cleanReply('"One."\n\nMarlow: "Two."\nLund: "Three."', 'Vera', OTHERS)).toBe('"One."');
  });

  it('cuts at the player’s line too — ST’s trimWrongNames, script.js:6433-6457', () => {
    expect(cleanReply('"You came."\nNed: "I did."', 'Vera', OTHERS)).toBe('"You came."');
  });

  it('cuts first and then strips, which is the order ST applies them — script.js:6491, :6507', () => {
    expect(cleanReply('Vera: "You came."\nLund: "Aye."', 'Vera', OTHERS)).toBe('"You came."');
    // The order shows only here: Lund's name is on Vera's line, not opening one.
    expect(cleanReply('Vera: Lund: "Aye," she mocked.', 'Vera', OTHERS)).toBe(
      'Lund: "Aye," she mocked.',
    );
  });

  it('cuts a reply that opens as somebody else to nothing, as ST does', () => {
    // `(^|\n)Lund:` matches at 0 and `substring(0, 0)` is empty. The caller
    // keeps the model's words as `original`, so nothing is lost.
    expect(cleanReply('Lund: "Aye."', 'Vera', OTHERS)).toBe('');
  });

  it('returns the very reply it was given when nothing matched', () => {
    const reply = '  She said nothing about Lund: not yet.  ';
    // A name mid-line is prose, not a line of dialogue; and untouched means the
    // same string, whitespace and all, so the caller's equality check holds.
    expect(cleanReply(reply, 'Vera', OTHERS)).toBe(reply);
  });

  it('is exact about names: case, prefixes and the speaker’s own namesake', () => {
    expect(cleanReply('"Fine."\nlund: "aye."', 'Vera', OTHERS)).toBe('"Fine."\nlund: "aye."');
    expect(cleanReply('"Fine."\nLunda: "No."', 'Vera', OTHERS)).toBe('"Fine."\nLunda: "No."');
    // Two members who share a name do not cut each other's replies — the line
    // is the speaker's own, and loses its label as every such line does.
    expect(cleanReply('"Fine."\nVera: "Again."', 'Vera', ['Vera', 'Lund'])).toBe(
      '"Fine."\n"Again."',
    );
  });

  it('matches a name with pattern characters in it literally', () => {
    expect(cleanReply('"Hm."\nDr. (Who)?: "Yes."', 'Vera', ['Dr. (Who)?'])).toBe('"Hm."');
    expect(cleanReply('"Hm."\nDrX (Who): "Yes."', 'Vera', ['Dr. (Who)?'])).toBe(
      '"Hm."\nDrX (Who): "Yes."',
    );
  });
});
