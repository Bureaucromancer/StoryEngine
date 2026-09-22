// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Buffer } from 'node:buffer';

/**
 * One ustar header, and the whole of this project's tar writing.
 *
 * ***Written by hand, and no dependency*** — the argument is `backup.mjs`'s and
 * it holds for both callers: the format is forty years old, the subset an
 * archive of a directory tree needs is a header struct and padding, and a
 * dependency here would be a supply-chain surface on the two tools somebody
 * reaches for when things have already gone wrong or when they are about to
 * ship.
 *
 * ***One copy because there are two callers***, which is the only reason this
 * file exists — [P11.11](../docs/design/workplan/28-p11-implementation.md)
 * wrote the first and [P11.9] wanted the same bytes. Two hand-written tar
 * writers in one repository is two places for the checksum arithmetic to be
 * subtly different, and the failure mode is an archive that most readers accept.
 *
 * *That sentence is now load-bearing in a third direction.* The server cannot
 * import this file — the image ships `packages/server` alone, and this must stay
 * buildless because it is the tool somebody reaches for when things have already
 * gone wrong — so `packages/server/src/storage/tar.ts` is a deliberate second
 * copy, and `tar-seam.test.ts` holds the seam by asserting the two emit
 * identical bytes. The duplication is admitted and checked rather than argued
 * away.
 *
 * ***`mtime` is a parameter and that is the interesting part.*** A backup wants
 * the time it was taken; a **release artifact wants no time at all**, because
 * [work plan §8](../docs/design/workplan/01-work-plan.md) asks for
 * *reproducible* builds and a timestamp is the commonest way an otherwise
 * identical build stops being identical. So the caller says, and
 * `pack-tarball.mjs` says zero.
 *
 * Only the fields a directory tree needs: name, mode, size, mtime, type, the
 * prefix and the checksum. **Ownership is deliberately zero** — an install runs
 * as whoever it runs as, and carrying uids from the machine that packed the
 * archive is how an unpack produces files its own service cannot read.
 */
export const BLOCK = 512;

/** ustar's two name fields. A member may use 100 bytes, or 155 + `/` + 100. */
const NAME_MAX = 100;
const PREFIX_MAX = 155;

/**
 * A member name split across ustar's `prefix` and `name` fields.
 *
 * ***This existed as `name.slice(0, 100)` and that was a silent data-loss
 * bug.*** Two things were wrong with it and the second is the one that bites.
 * `slice` counts **characters** where the field counts **bytes**, so any
 * non-ASCII name was mismeasured; and past 100 the name was simply *cut*, which
 * does not produce a broken archive — it produces a plausible one, in which
 * `…/history/v/<64-hex>.json` entries land on top of each other under a shared
 * truncated name. StoryEngine reaches that length in ordinary use:
 * `users/<handle≤63>/library/lorebooks/<slug≤64>/history/v/<64-hex>.json` is
 * about 232 bytes.
 *
 * ustar has had the answer since 1988: a second 155-byte field holding
 * everything up to a `/`, which a reader rejoins with a `/` between. That covers
 * 255 bytes, which is every path this project can produce.
 *
 * ***A name that will not fit is refused rather than shortened***, which is the
 * posture `storage/zip.ts` takes coming the other way: *"refuses rather than
 * sanitises, and the difference matters — silently rewriting `../../x` to `x`
 * imports a file the archive did not describe, under a name nobody chose."* An
 * archive is a promise about what is in it, and the one failure mode worth
 * ruling out absolutely is the quiet one.
 */
export function splitName(name) {
  if (Buffer.byteLength(name, 'utf8') <= NAME_MAX) return { name, prefix: '' };

  // **The longest prefix that still leaves a legal name**, walked from the
  // right: a longer prefix means a shorter tail, and the tail is the field with
  // less room. The split point is consumed — ustar rejoins with its own `/` —
  // so a leading or trailing separator would produce `//` or a relative name.
  for (let at = name.lastIndexOf('/'); at > 0; at = name.lastIndexOf('/', at - 1)) {
    const prefix = name.slice(0, at);
    const tail = name.slice(at + 1);
    if (tail.length === 0) continue;
    if (
      Buffer.byteLength(prefix, 'utf8') <= PREFIX_MAX &&
      Buffer.byteLength(tail, 'utf8') <= NAME_MAX
    ) {
      return { name: tail, prefix };
    }
  }

  throw new Error(
    `This name is too long for a tar header and cannot be split at a directory boundary: ${name}`,
  );
}

export function tarHeader(name, size, options = {}) {
  const { mtime = 0, mode = 0o644 } = options;
  const split = splitName(name);
  const block = Buffer.alloc(BLOCK);
  block.write(split.name, 0, NAME_MAX, 'utf8');
  block.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 8, 'ascii');
  block.write('0000000\0', 108, 8, 'ascii');
  block.write('0000000\0', 116, 8, 'ascii');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  block.write(`${Math.floor(mtime).toString(8).padStart(11, '0')}\0`, 136, 12, 'ascii');
  // Spaces while the sum is taken, then the sum written over them. That is the
  // format's own rule and the reason the two writes below look redundant.
  block.write('        ', 148, 8, 'ascii');
  block.write('0', 156, 1, 'ascii');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  // **Before the checksum**, which is the whole of what makes adding a field to
  // this function delicate: the sum is over the finished block, so a field
  // written after it is a field the sum does not cover, and the archive fails
  // in a reader that checks rather than here.
  if (split.prefix !== '') block.write(split.prefix, 345, PREFIX_MAX, 'utf8');

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return block;
}

/**
 * The name a header block carries, rejoined.
 *
 * Here rather than in each reader for the reason the writer is here: the join
 * rule is part of the format, and a reader that forgot the prefix would read a
 * 232-byte path as its last few segments and write it to the wrong place. Both
 * fields stop at the first NUL, and an unset `prefix` is 155 zero bytes.
 */
export function headerName(block) {
  /**
   * ***`TextDecoder`, not `block.toString('utf8')`.***
   *
   * The second is a `Buffer` method, and on a plain `Uint8Array` it resolves to
   * `Array.prototype.toString` — which does not throw. It returns
   * `"115,116,97,..."`, a string of comma-joined byte values that every caller
   * here would accept as a member name. `backup.mjs` happens to hand this a
   * `Buffer` and so never met it; `tar-seam.test.ts` handed it the server
   * writer's `Uint8Array` on its first run and found it immediately, which is
   * the seam earning its keep before the archive format did.
   */
  const decoder = new TextDecoder();
  const field = (at, length) =>
    decoder.decode(block.subarray(at, at + length)).replace(/\0.*$/s, '');
  const name = field(0, NAME_MAX);
  const prefix = field(345, PREFIX_MAX);
  return prefix === '' ? name : `${prefix}/${name}`;
}

/** The padding that takes a member's bytes up to a block boundary. */
export function padding(size) {
  return (BLOCK - (size % BLOCK)) % BLOCK;
}

/** Two empty blocks end a tar, and a reader that trusts the format needs them. */
export function trailer() {
  return Buffer.alloc(BLOCK * 2);
}
