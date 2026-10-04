// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

/**
 * ***What a producer of `storyengine.session-export/1` owes the one reader*** —
 * [P13.10](../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * [P13 §0.3](../../../../docs/design/workplan/30-p13-aventuras-import.md#03-how-this-sits-with-25-e4),
 * [26 E4](../../../../docs/design/26-open-questions.md).
 *
 * A producer converts somebody else's story into our format and hands the
 * document to `importSession`; it never writes a session itself, which is what
 * keeps E4's *one format, not N importers* true and what makes deleting a
 * producer delete nothing else. The reader is defensive about everything a
 * file can say (`sessions/import.ts`); this module is the one thing a producer
 * has to get right that the reader cannot check for it: **the turn ids**.
 *
 * ***Why they are derived, and why that makes a re-import a refusal.*** The
 * reader keeps a document's turn ids ([P11.10]'s decision), and since
 * 2026-09-27 it refuses — `409 already-here` — a document whose turns this
 * install already holds, because a turn id is one row on the install and two
 * sessions sharing one take each other's search rows, locations and pictures
 * ([P13 §0.4]). So the id a producer gives a turn decides what a second import
 * of the same story does:
 *
 * - **minted fresh** (`uuidv7()` per run), a second import has ids nothing
 *   holds and is written — *a copy*, every time somebody presses the button;
 * - **derived from the source's own ids**, a second import has the ids the
 *   first one wrote and is refused — *nothing doubles*, which is
 *   [P4 §1.3]'s whole rule for the library, reached for a session by the
 *   mechanism the reader already has.
 *
 * The producer's `originalFilename` key refuses the same re-import on its own
 * (`SessionImportOptions.originalFilename`), and the two are not redundant:
 * the key holds when a later producer derives ids differently, and the ids
 * hold when a session reaches this account by some road that did not carry
 * the key. *A producer uses both.*
 */

/**
 * ***A turn id a producer derives rather than mints*** — the same source turn
 * gives the same id on every run, and nothing else gives it.
 *
 * - **`handle`** is in the derivation because a turn id is one row on the
 *   **install** and the key above is scoped to the **account**. Two people on
 *   one server who each import the same Aventuras database are two stories
 *   with a reader each; without the handle the second import would be refused
 *   for turns the first person holds, and told so in words that describe an
 *   account it cannot see.
 * - **`origin`** is the producer's key for the whole source —
 *   `aventura.db/stories/<id>` — so two stories whose rows happen to share an
 *   id, or a source that numbers its rows per story, cannot meet.
 * - **`sourceId`** is the source's own id for the thing this turn was made
 *   from: an Aventuras `story_entries.id`, or, for a turn made of an action
 *   and its answer, the id the producer chooses to key the pair on — the same
 *   one every run.
 * - **`at`** is when the source says the thing was made, in milliseconds. It
 *   is **not** identity — the hash is — and it is here only for order (below).
 *   It must come from the source, never from the clock, or the id is no
 *   longer a function of the source; a source with no time passes `0`.
 *
 * ***A UUID, version 8, laid out like our own v7.*** Nothing validates a turn
 * id's shape — `isUuidv7` is documented as *for our own writes*, and a foreign
 * id must be storable — but a turn id becomes a path (`renditions/<id>.<n>.json`,
 * `snapshots/<id>.json`) and a route parameter, and a hex UUID is the one
 * shape every one of those already takes. Version 8 is RFC 9562's
 * *custom* version, which is exactly what this is; claiming 7 would claim 74
 * random bits that are a hash. **The first 48 bits are `at`, as in a v7**, so
 * these ids sort by the source's own creation time the way ours sort by mint
 * time, and the exporter's id sort (`sessions/export.ts`) lays a produced
 * session out in the order it happened — which the reader no longer depends
 * on (`importSession`'s `treeOf`), and a person reading the file does.
 *
 * The remaining 74 bits are SHA-256 of the four parts, **length-prefixed**
 * through JSON rather than joined with a separator — `stableId` joins with a
 * space, and `distinctIds` exists partly because `('a b', 'c')` and
 * `('a', 'b c')` hash the same text. Two different source turns meet only in
 * the same millisecond *and* a 74-bit collision.
 */
export function producedTurnId(parts: {
  handle: string;
  origin: string;
  sourceId: string;
  at: number;
}): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([PRODUCED_TURN_ID, parts.handle, parts.origin, parts.sourceId]), 'utf8')
    .digest();

  const bytes = new Uint8Array(16);
  const ms = millisecondsOf(parts.at);
  // 48-bit big-endian milliseconds, in two halves because a 48-bit value
  // exceeds what the bitwise operators hold — `createUuidv7`'s own layout.
  const high = Math.floor(ms / 0x1_0000_0000);
  const low = ms >>> 0;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;
  for (let at = 6; at < 16; at += 1) bytes[at] = digest[at - 6] ?? 0;
  // Version 8 in the high nibble of byte 6; variant 0b10 in the top of byte 8.
  bytes[6] = 0x80 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * The derivation's own name, hashed with the parts. Changing how ids are
 * derived means changing this, and the ids with it — which turns a re-import
 * of a story imported under the old derivation into a copy unless the
 * producer's `originalFilename` key catches it, and that is the key's job.
 */
const PRODUCED_TURN_ID = 'storyengine.produced-turn/1';

/** The largest millisecond 48 bits hold — the year 10889. */
const MAX_MS = 2 ** 48 - 1;

/**
 * `at` as 48 bits. A time a source could not have meant — negative, fractional
 * past the millisecond, `NaN` from an unparsable column — is clamped rather
 * than refused: it affects where the id sorts and never whether it is stable.
 */
function millisecondsOf(at: number): number {
  if (!Number.isFinite(at) || at < 0) return 0;
  return Math.min(Math.floor(at), MAX_MS);
}
