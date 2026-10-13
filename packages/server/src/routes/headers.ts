// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportNote } from '@storyengine/shared';

/**
 * ***What a download says about itself, beside the body*** — the headers more
 * than one route writes the same way.
 *
 * **Its own module since [P16.3d]**, which is the second route to need
 * {@link encodeNotes}: the per-format export in `routes/library.ts` had it to
 * itself from [P11.10], and `routes/publish.ts` now answers a World file with
 * the same header. Two private copies of an encoding the client decodes once
 * (`api.ts`'s `exportNotesOf`) would be two encodings the day either changed.
 */

/**
 * What an export did not carry, as a header.
 *
 * **Base64 of the JSON, because a header is latin-1 and a note's params are
 * whatever an object is called** — a treatment named *Café* would otherwise put
 * bytes in a header that no specification says how to read. The body is the
 * file ([P11.10]'s rule for `x-storyengine-missing`), so the notes cannot ride
 * inside it, and dropping them would leave the only surface that can tell
 * somebody what they lost with nothing to say.
 *
 * *Moved from `routes/library.ts` at [P16.3d], unchanged.*
 */
export function encodeNotes(notes: readonly ImportNote[]): string {
  return Buffer.from(JSON.stringify(notes), 'utf8').toString('base64');
}

/**
 * ***{@link encodeNotes}, within a budget*** — `maxBytes` of base64, so a
 * header that grows with the library cannot outgrow what a client or a proxy
 * in front of the server will take (2026-10-11, the P16.3d review; the World
 * file's notes are one per missing picture, and sixty made a header Node's own
 * `fetch` refuses).
 *
 * **All of them when they fit, unchanged** — so a short list is exactly what
 * {@link encodeNotes} sends. **When they do not: warnings first, then the
 * rest, each in its own order, as many as fit with one closing note** that
 * `more` writes from what was left out — a count, for a surface that can then
 * say *and N more, listed in the file*. Warnings first because a header cut
 * short should drop *a picture was not there* before *a book play wrote stayed
 * home*. The closing note is sent even when the budget cannot hold it with
 * anything else: a header that said nothing would read as nothing omitted.
 *
 * A route whose notes are bounded by what it sends — the per-format export,
 * one object's few — has no need of this, and keeps {@link encodeNotes}.
 */
export function encodeNotesWithin(
  notes: readonly ImportNote[],
  maxBytes: number,
  more: (rest: readonly ImportNote[]) => ImportNote,
): string {
  const whole = encodeNotes(notes);
  if (whole.length <= maxBytes) return whole;
  const ordered = [
    ...notes.filter((note) => note.level === 'warn'),
    ...notes.filter((note) => note.level !== 'warn'),
  ];
  let kept = 0;
  while (kept < ordered.length) {
    const trial = [...ordered.slice(0, kept + 1), more(ordered.slice(kept + 1))];
    if (base64Length(trial) > maxBytes) break;
    kept += 1;
  }
  return encodeNotes([...ordered.slice(0, kept), more(ordered.slice(kept))]);
}

/** How long {@link encodeNotes} would make these, without making it. */
function base64Length(notes: readonly ImportNote[]): number {
  return 4 * Math.ceil(Buffer.byteLength(JSON.stringify(notes), 'utf8') / 3);
}
