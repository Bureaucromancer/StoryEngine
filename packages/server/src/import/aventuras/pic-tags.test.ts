// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { anchorBefore, isPicTag, stripPicTags } from './pic-tags.js';

/**
 * ***Aventuras' inline `<pic …>` tags, out of the prose*** — found at P13.13,
 * fixed with P13.14.
 *
 * Two claims. **The tags removed are the tags Aventuras replaced with a
 * picture** — its own pattern, so a `>` or the other quote inside a prompt is
 * still one tag, and an unterminated one is prose to both of us — and **the
 * text left reads as Aventuras showed it**, without the blank paragraphs a
 * tag on a line of its own would leave. Then the anchor: the sentence before
 * the place a tag stood, which `anchorOffset` (the client's) resolves to the
 * split right after that sentence — asserted here by running the same rule.
 */

/** `client/src/play/Rendition.tsx`'s `anchorOffset`, restated for the assertion: the end of the first match, carried to the sentence's end. */
function splitAt(text: string, anchor: string): number | null {
  const at = text.toLowerCase().indexOf(anchor.toLowerCase());
  if (at === -1) return null;
  const end = at + anchor.length;
  const stop = text.slice(end).search(/[.!?](\s|$)/);
  return stop === -1 ? null : end + stop + 1;
}

/** Where the prose before a site ends — the site keeps the paragraph break, and the split comes before it. */
function proseBefore(text: string, at: number): number {
  return text.slice(0, at).trimEnd().length;
}

describe('stripping', () => {
  it('leaves a text with no tag exactly as it was', () => {
    const text = '  The lamp room smells of oil.\n\n\nAnd <b>nothing</b> else <picture>. ';
    expect(stripPicTags(text)).toEqual({ text, sites: [] });
  });

  it('takes out both forms, whatever the quotes hold, and remembers each tag', () => {
    const sign = '<pic prompt="A sign reading 10 > 9" characters=""></pic>';
    const blade = "<pic prompt='a knight\"s blade' />";
    const loud = '<PIC prompt="loud" ></PIC>';
    const tags = [sign, blade, loud];
    const { text, sites } = stripPicTags(`One.\n\n${sign}\n\nTwo. ${blade} Three.${loud}`);
    expect(text).toBe('One.\n\nTwo. Three.');
    expect(sites.map((site) => site.tag)).toEqual(tags);
    expect(sites.map((site) => site.at)).toEqual([6, 10, 17]);
  });

  it('keeps the wider of two blank runs, not their sum, and one space between words', () => {
    expect(stripPicTags('A.\n\n<pic prompt="x" />\n\nB.').text).toBe('A.\n\nB.');
    expect(stripPicTags('A.\n<pic prompt="x" />\n\n\nB.').text).toBe('A.\n\n\nB.');
    expect(stripPicTags('rang<pic prompt="x" />then').text).toBe('rang then');
    expect(stripPicTags('rang.<pic prompt="x" />.').text).toBe('rang..');
    expect(stripPicTags('rang. \t<pic prompt="x" /> \tThen').text).toBe('rang. Then');
  });

  it('takes the whitespace between a tag and the end it stands at', () => {
    const { text, sites } = stripPicTags(
      '\n<pic prompt="first" />\n\nBody.\n\n<pic prompt="last" />\n',
    );
    expect(text).toBe('Body.');
    expect(sites.map((site) => site.at)).toEqual([0, 5]);
  });

  it('leaves an unterminated tag in the prose, as Aventuras shows it', () => {
    const text = 'Before <pic prompt="never closed" and after.';
    expect(stripPicTags(text)).toEqual({ text, sites: [] });
  });

  it('knows a whole tag from a tag inside something else', () => {
    expect(isPicTag('  <pic prompt="x" characters="Mara"></pic> ')).toBe(true);
    expect(isPicTag("<pic prompt='x' />")).toBe(true);
    expect(isPicTag('LAMP ROOM')).toBe(false);
    expect(isPicTag('see <pic prompt="x" />')).toBe(false);
  });
});

describe('anchoring where a tag stood', () => {
  it('quotes the sentence before it, and a reader splits right after that sentence', () => {
    const { text, sites } = stripPicTags(
      'The door opens. "Who is there?" she asks.\n\n<pic prompt="a door" />\n\nNobody answers.',
    );
    const anchor = anchorBefore(text, sites[0]!.at);
    // A question closed inside its quote is a sentence of its own, so the
    // quote is the one after it — short, and the only place it occurs.
    expect(anchor).toBe('she asks');
    expect(splitAt(text, anchor!)).toBe(proseBefore(text, sites[0]!.at));
  });

  it('grows backwards until the quote is the place the tag stood, not an earlier one', () => {
    const { text, sites } = stripPicTags(
      'The tide is out. Boats lean.\n\nA call. The tide is out.\n\n<pic prompt="a pier" />\n\nLater.',
    );
    const anchor = anchorBefore(text, sites[0]!.at);
    expect(anchor).toBe('A call. The tide is out');
    expect(splitAt(text, anchor!)).toBe(proseBefore(text, sites[0]!.at));
  });

  it('has no quote for a tag with no prose before it', () => {
    const { text, sites } = stripPicTags('<pic prompt="opening" />\n\nThe story starts.');
    expect(anchorBefore(text, sites[0]!.at)).toBeNull();
  });

  it('follows a sentence a tag interrupts to its end, rather than splitting it', () => {
    const { text, sites } = stripPicTags(
      'The bell <pic prompt="a bell" /> rings twice. Then quiet.',
    );
    expect(text).toBe('The bell rings twice. Then quiet.');
    const anchor = anchorBefore(text, sites[0]!.at);
    expect(anchor).toBe('The bell');
    expect(splitAt(text, anchor!)).toBe('The bell rings twice.'.length);
  });
});
