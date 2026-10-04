// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { TurnAttachment } from '@storyengine/shared';

/**
 * ***A picture, in words*** — [25 E15](../../../../docs/design/25-open-questions.md), R1.
 *
 * **Every attachment always has a text rendering**, and this is where it is
 * spelled — once, so the prompt, the summariser and memory describe the same
 * picture the same way, and the lore scan and the index read the same caption.
 * It is the caption the player wrote when there is one, and an honest
 * placeholder when there is not: a model that cannot see the picture is told
 * one was there, and a summary written later says so rather than losing the
 * move.
 *
 * *English, as every other instruction this engine writes into a prompt is.*
 * These are words a model reads, not words a person does — the reading view
 * shows the picture and its caption, and search indexes the caption alone
 * ({@link scanText}), so no person reads these.
 */

function captionOf(attachment: Pick<TurnAttachment, 'caption'>): string | null {
  const caption = attachment.caption?.trim() ?? '';
  return caption === '' ? null : caption;
}

/**
 * The stand-in the text consumers use — summaries, memory, the index, the
 * transcript a step reads. A picture as a line of the story.
 */
export function pictureWords(attachment: Pick<TurnAttachment, 'caption'>): string {
  const caption = captionOf(attachment);
  return caption === null ? '[Picture, not described]' : `[Picture: ${caption}]`;
}

/**
 * What a prompt carries for a picture, both ways the send rule can go.
 *
 * - **`sent`** accompanies the pixels: the caption, when there is one, is the
 *   player's own words about what they are showing, and it goes with the
 *   picture rather than instead of it.
 * - **`held`** is everything the model gets when the pixels do not go, and it
 *   says so — *not shown* — because a model told only a caption would take the
 *   caption for the whole of what was there.
 */
export function pictureTexts(attachment: Pick<TurnAttachment, 'caption'>): {
  sent: string;
  held: string;
} {
  const caption = captionOf(attachment);
  return caption === null
    ? { sent: '[Picture]', held: '[Picture — not shown, and not described]' }
    : { sent: `[Picture: ${caption}]`, held: `[Picture — not shown: ${caption}]` };
}

/**
 * A move's words with its pictures' stand-ins after them — what a text
 * consumer reads as *what the player did*.
 *
 * **Exactly the words when there are no pictures**, which is the property that
 * keeps every key and every summary written before pictures existed unchanged.
 */
export function moveText(
  input: { text: string; attachments?: readonly Pick<TurnAttachment, 'caption'>[] } | undefined,
): string {
  if (input === undefined) return '';
  const pictures = input.attachments ?? [];
  if (pictures.length === 0) return input.text;
  return [input.text, ...pictures.map(pictureWords)].filter((part) => part !== '').join('\n');
}

/**
 * A move's words with its pictures' **captions** after them, and nothing else —
 * what a keyword scan reads ([25 E15]: the caption is scanned as input is), and
 * what search indexes, since a person reads search.
 *
 * *No placeholder*, which is the difference from {@link moveText}: a lorebook
 * keyed on *picture* must not fire because somebody attached one without a
 * word, and the player's own caption is the only part of a picture that is the
 * player saying something.
 */
export function scanText(
  input: { text: string; attachments?: readonly Pick<TurnAttachment, 'caption'>[] } | undefined,
): string {
  if (input === undefined) return '';
  const captions = (input.attachments ?? [])
    .map((attachment) => captionOf(attachment))
    .filter((caption): caption is string => caption !== null);
  if (captions.length === 0) return input.text;
  return [input.text, ...captions].filter((part) => part !== '').join('\n');
}

/**
 * A move as a quotation — **every line of it**, which is the whole point.
 *
 * The summariser and memory extraction quote the player's move and leave the
 * reply bare, so a model can tell an instruction from narration without being
 * told which is which. They quoted with one `> ` in front of the whole string,
 * which is a quotation of the first line only: a picture's stand-in on the
 * next line — {@link moveText} puts each on a line of its own — read as the
 * first line of the narrator's reply, and so did the second line of a move
 * typed with a line break, which was wrong before pictures. The reading view
 * has always quoted line by line; this is that rule for the prompt.
 *
 * *Empty in, empty out*, so a move with nothing in it adds no bare `>`.
 */
export function quoted(text: string): string {
  if (text === '') return '';
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}
