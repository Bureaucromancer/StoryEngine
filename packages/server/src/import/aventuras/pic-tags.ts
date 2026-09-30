// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { literalSpans } from '@storyengine/shared';

/**
 * ***Aventuras' inline `<pic …>` tags, taken out of the prose and remembered
 * where they stood*** — found at
 * [P13.13](../../../../../docs/design/workplan/30-p13-aventuras-import.md) and
 * fixed with P13.14.
 *
 * With inline images on, Aventuras asks its narrator to write
 * `<pic prompt="…" characters="…"></pic>` *after the prose that describes the
 * scene* (`NarrativeService.ts`, its inline-image instruction), and keeps the
 * tag in the entry's `content` verbatim. **Nobody ever reads the tag**: the
 * renderer swaps each one for the picture its `embedded_images` row holds
 * (`ImageEmbeddingService.ts`, `processStoryContent`), and the prompt builder
 * strips them before a model sees the history (`stripPicTags`, when inline
 * mode is off). P13.11's producer carried `content` raw, so a story with inline
 * pictures showed the literal markup in its turns here — the one surface in
 * either application that did.
 *
 * ## The pattern is Aventuras', and why that matters
 *
 * {@link PIC_TAG} is `inlineImageParser.ts`'s `PIC_TAG` at the pin (`c43da108`),
 * restated rather than improved. Its own comment explains the quoted-run
 * alternation — a `>` inside a prompt (*"a sign reading 10 > 9"*) ended the
 * older `[^>]*?` early and left the tag in the page — and the property this
 * module needs is narrower than *a good tag parser*: **the tags removed here are
 * exactly the tags Aventuras replaced with a picture**. A stricter pattern would
 * leave markup Aventuras hid; a looser one would eat prose Aventuras showed. So
 * both forms are matched (`<pic … />` and `<pic …></pic>`), case-insensitively,
 * with the `gi` flags its `picTagRegex()` defaults to. An unterminated tag is not
 * a tag to either of us, and stays in the text as Aventuras shows it.
 *
 * ## Where the picture goes, once its tag is gone
 *
 * P13.13 anchored an inline picture on the tag itself — Aventuras'
 * `source_text` for an inline image *is* the whole tag, which is how its
 * renderer finds the record to put there. With the tag stripped that anchor
 * would never resolve, and every inline picture would fall to the end of its
 * turn. **A re-anchor has to say the same place in words the text still has.**
 *
 * Our anchor is a quote, and the play and reading views put a picture *after
 * the sentence the quote ends in* (`client/src/play/Rendition.tsx`,
 * `anchorOffset`, [06 §10.4a]). Aventuras' tag sits after the prose it
 * illustrates — its instruction says so, and says never mid-sentence — and its
 * renderer draws the picture exactly there. So **the anchor is the sentence
 * immediately before the tag** ({@link anchorBefore}), with its closing
 * punctuation left off so the split lands right after that punctuation rather
 * than one sentence on (`anchorOffset` looks for the *next* `[.!?]` followed by
 * a space after the quote). The picture lands where the tag was.
 *
 * - ***First match wins*** in `anchorOffset`, so a sentence that also occurs
 *   earlier in the turn would put the picture by the earlier one. The anchor
 *   grows backwards a sentence at a time until its first occurrence is the one
 *   before the tag — the same `literalSpans` the client resolves it with, so
 *   the two agree on what *first* means.
 * - ***A tag with no prose before it*** — first in its entry — has no sentence
 *   to follow. Aventuras draws that picture above the text, and an anchor
 *   cannot say *above*: every anchor here places a picture after something. So
 *   it is left unanchored, and it renders under the turn's text, which is where
 *   [06 §10.4a] puts a picture that has no place of its own. Not
 *   `anchorResolved: false`: that says a quote *missed*, and there is no quote.
 * - ***A sentence ending in a closing quote*** (`… "Go."`) is not a sentence
 *   end to `anchorOffset`, whose pattern wants whitespace straight after the
 *   stop, so such a picture lands a sentence late. That is the client's rule,
 *   applied to every anchor and not only these; this module does not work
 *   around it, because a quote shaped to one reader's regex is a quote that
 *   breaks when the reader is fixed.
 *
 * ## The whitespace a tag leaves
 *
 * Aventuras renders Markdown, which folds the blank lines around a removed
 * block; this build renders a turn's text `whitespace-pre-wrap`, which does
 * not. A tag on a paragraph of its own — the usual case — would leave two
 * blank paragraphs where there was one. So the join keeps **the wider of the
 * two newline runs, not their sum**, drops the spaces and tabs that padded the
 * tag, and puts one space back between two words the tag alone separated. A tag
 * at either end of the text takes the whitespace between it and that end with
 * it. Nothing else in the text is touched.
 */

/**
 * Aventuras' pattern, at the pin: a `<pic`, its attributes as quoted runs or
 * characters that are neither quote nor `>`, then `/>` or `></pic>`.
 */
const PIC_TAG = String.raw`<pic\s+((?:"[^"]*"|'[^']*'|[^>"'])*?)(?:\/>|>\s*<\/pic>)`;

/** A fresh instance each time: a shared `g` regex carries `lastIndex` between callers. */
function picTagRegex(): RegExp {
  return new RegExp(PIC_TAG, 'gi');
}

/** Whether `text` is one whole tag and nothing else — an inline picture's `source_text`. */
export function isPicTag(text: string): boolean {
  const match = new RegExp(`^${PIC_TAG}$`, 'i').exec(text.trim());
  return match !== null;
}

/** One tag that was taken out: its text, and where it stood in the text left behind. */
export interface PicSite {
  /** The tag as Aventuras wrote it — what an inline picture's `source_text` names. */
  tag: string;
  /** An offset into {@link StrippedText.text}: the join the tag's removal made. */
  at: number;
}

export interface StrippedText {
  text: string;
  /** In the order the tags stood. Empty when there were none, and `text` is the input. */
  sites: PicSite[];
}

/**
 * ***The text with every tag taken out***, and where each one stood. A text
 * with no tag comes back as it was, byte for byte, which is every entry
 * Aventuras wrote without inline images on.
 */
export function stripPicTags(content: string): StrippedText {
  const matches = [...content.matchAll(picTagRegex())];
  if (matches.length === 0) return { text: content, sites: [] };

  const sites: PicSite[] = [];
  let text = '';
  let from = 0;
  for (const match of matches) {
    const start = match.index;
    const segment = content.slice(from, start);
    const leftPadded = /[ \t]$/.test(segment);
    text += segment.replace(/[ \t]+$/, '');
    sites.push({ tag: match[0], at: text.length });

    // Past the tag, and past the spaces and tabs that padded it.
    let next = start + match[0].length;
    const tagEnd = next;
    while (content.charAt(next) === ' ' || content.charAt(next) === '\t') next += 1;
    const rightPadded = next > tagEnd;

    const leftRun = /\n*$/.exec(text)?.[0].length ?? 0;
    const rightRun = /^\n*/.exec(content.slice(next))?.[0].length ?? 0;
    if (leftRun > 0 && rightRun > 0) {
      // The wider run, not the sum: skip as many of the right's as the left has.
      next += Math.min(leftRun, rightRun);
    } else if (leftRun === 0 && rightRun === 0 && text !== '' && next < content.length) {
      // Two words the tag alone kept apart — or kept apart with the spaces the
      // trim took — get one space back. A tag against punctuation with nothing
      // around it does not: `lamp.<pic/>.` was never two words.
      const before = text.charAt(text.length - 1);
      const after = content.charAt(next);
      const apart = leftPadded || rightPadded || /\w/u.test(after);
      if (/\S/u.test(before) && /\S/u.test(after) && apart) text += ' ';
    }
    from = next;
  }
  text += content.slice(from);

  // A tag at either end takes the whitespace between it and that end.
  const firstSite = sites[0];
  if (firstSite !== undefined && text.slice(0, firstSite.at).trim() === '') {
    const leading = text.length - text.trimStart().length;
    text = text.slice(leading);
    for (const site of sites) site.at = Math.max(0, site.at - leading);
  }
  const lastSite = sites.at(-1);
  if (lastSite !== undefined && text.slice(lastSite.at).trim() === '') {
    text = text.trimEnd();
    for (const site of sites) site.at = Math.min(site.at, text.length);
  }
  return { text, sites };
}

/** A sentence's closing marks: the stop itself and any quote or bracket after it. */
const CLOSING = /[\s.!?…"'”’)\]]+$/u;

/** Where each sentence of `text` starts: after a stop and whitespace, or after a line break. */
function sentenceStarts(text: string): number[] {
  const starts = [0];
  for (const match of text.matchAll(/(?:[.!?…]["'”’)\]]*[ \t]+|\n+[ \t]*)/gu)) {
    starts.push(match.index + match[0].length);
  }
  return starts;
}

/**
 * ***The quote a picture that stood at `at` is anchored on***, or `null` when
 * there is no prose before it. See the header: the sentence just before the
 * site, its closing marks left off, grown backwards until its first occurrence
 * in `text` is this one.
 */
export function anchorBefore(text: string, at: number): string | null {
  const before = text.slice(0, at).replace(CLOSING, '');
  if (before.trim() === '') return null;

  const starts = sentenceStarts(before).filter((start) => start < before.length);
  for (let n = starts.length - 1; n >= 0; n -= 1) {
    const start = starts[n] ?? 0;
    const quote = before.slice(start).trim();
    if (quote === '') continue;
    const first = literalSpans(text, quote, { wholeWords: false, caseSensitive: false })[0];
    // Its first occurrence ends where this one does: the quote says this place.
    if (first === undefined || first.end >= before.length) return quote;
  }
  return before.trim();
}
