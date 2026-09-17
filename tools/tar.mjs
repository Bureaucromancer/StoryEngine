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
 * ***`mtime` is a parameter and that is the interesting part.*** A backup wants
 * the time it was taken; a **release artifact wants no time at all**, because
 * [work plan §8](../docs/design/workplan/01-work-plan.md) asks for
 * *reproducible* builds and a timestamp is the commonest way an otherwise
 * identical build stops being identical. So the caller says, and
 * `pack-tarball.mjs` says zero.
 *
 * Only the fields a directory tree needs: name, mode, size, mtime, type and the
 * checksum. **Ownership is deliberately zero** — an install runs as whoever it
 * runs as, and carrying uids from the machine that packed the archive is how an
 * unpack produces files its own service cannot read.
 */
export const BLOCK = 512;

export function tarHeader(name, size, options = {}) {
  const { mtime = 0, mode = 0o644 } = options;
  const block = Buffer.alloc(BLOCK);
  block.write(name.slice(0, 100), 0, 100, 'utf8');
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

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return block;
}

/** The padding that takes a member's bytes up to a block boundary. */
export function padding(size) {
  return (BLOCK - (size % BLOCK)) % BLOCK;
}

/** Two empty blocks end a tar, and a reader that trusts the format needs them. */
export function trailer() {
  return Buffer.alloc(BLOCK * 2);
}
