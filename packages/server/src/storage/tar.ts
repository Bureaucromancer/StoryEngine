// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * One ustar header, for the server — the second copy, and it is admitted.
 *
 * ***Why this is not an import of `tools/tar.mjs`.*** The image ships
 * `packages/server` alone (`pnpm --filter @storyengine/server --legacy deploy`),
 * so nothing under `tools/` is there to import at runtime. And the direction
 * does not reverse either: `tools/backup.mjs` is the tool somebody reaches for
 * when things have already gone wrong, so it must run under plain node with no
 * build — which rules out it importing this. Two callers that cannot reach each
 * other, and one format.
 *
 * ***So the seam is held by a test rather than argued away.*** `tools/tar.mjs`'s
 * own docstring names the hazard — *"two hand-written tar writers in one
 * repository is two places for the checksum arithmetic to be subtly different,
 * and the failure mode is an archive that most readers accept"* — and
 * `tools/tar-seam.test.ts` asserts the two emit **identical bytes** across a
 * table of cases. That is the shape `tools/repo-shape.test.ts` already uses for
 * a fact duplicated across packages that cannot import one another.
 *
 * ***Written in the server's idiom rather than transliterated.*** `node:buffer`
 * appears nowhere in this package; `storage/zip.ts` and `storage/card/png.ts`
 * read and write bytes as `Uint8Array` through `DataView` and `TextEncoder`, and
 * a `Buffer` here would be the one file that did it differently. The bytes are
 * the same either way, which is exactly what the seam test is for.
 *
 * ***`mtime` is a parameter*** for the reason `tools/tar.mjs` gives: a backup
 * wants the time it was taken and a release artifact wants no time at all. Here
 * there is only the first caller, and it still says so rather than relying on a
 * default that would silently be wrong for the second.
 *
 * **Ownership is written as zero**, deliberately: a restore into a container
 * runs as whoever the container runs as, and carrying uids from the machine the
 * backup was taken on is how a restore produces files its own server cannot
 * read.
 */

export const BLOCK = 512;

/** ustar's two name fields. A member may use 100 bytes, or 155 + `/` + 100. */
const NAME_MAX = 100;
const PREFIX_MAX = 155;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface TarOptions {
  /** Seconds since the epoch. Zero for anything that must be reproducible. */
  mtime?: number;
  mode?: number;
}

/** A member name as the two fields carry it. `prefix` is `''` when unused. */
export interface TarName {
  name: string;
  prefix: string;
}

/**
 * A name that will not fit ustar's fields, refused rather than shortened.
 *
 * Typed, where the script throws a plain `Error`, because a route has to turn
 * this into a refusal a person can read rather than a 500 — and because
 * `archive.ts` names the member in its own message. The two messages are kept
 * word for word the same so the behaviour reads identically from either side.
 */
export class TarNameError extends Error {
  readonly memberName: string;

  constructor(memberName: string) {
    super(
      `This name is too long for a tar header and cannot be split at a directory boundary: ${memberName}`,
    );
    this.name = 'TarNameError';
    this.memberName = memberName;
  }
}

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Splits a member name across `prefix` and `name`.
 *
 * ***The rule this replaces was `name.slice(0, 100)`, and it was a silent
 * data-loss bug*** — `slice` counts characters where the field counts bytes, and
 * past 100 the name was *cut*, which does not produce a broken archive but a
 * plausible one. StoryEngine reaches that length in ordinary use:
 * `users/<handle≤63>/library/lorebooks/<slug≤64>/history/v/<64-hex>.json` is
 * about 232 bytes, and every version payload under one object would land on the
 * same truncated name.
 *
 * **The longest prefix that still leaves a legal name**, walked from the right:
 * a longer prefix means a shorter tail, and the tail is the field with less
 * room. The split point is consumed, because ustar rejoins with its own `/`.
 */
export function splitName(memberName: string): TarName {
  if (byteLength(memberName) <= NAME_MAX) return { name: memberName, prefix: '' };

  for (let at = memberName.lastIndexOf('/'); at > 0; at = memberName.lastIndexOf('/', at - 1)) {
    const prefix = memberName.slice(0, at);
    const tail = memberName.slice(at + 1);
    if (tail.length === 0) continue;
    if (byteLength(prefix) <= PREFIX_MAX && byteLength(tail) <= NAME_MAX) {
      return { name: tail, prefix };
    }
  }

  throw new TarNameError(memberName);
}

function writeText(block: Uint8Array, at: number, text: string): void {
  block.set(encoder.encode(text), at);
}

export function tarHeader(memberName: string, size: number, options: TarOptions = {}): Uint8Array {
  const { mtime = 0, mode = 0o644 } = options;
  const split = splitName(memberName);
  const block = new Uint8Array(BLOCK);

  writeText(block, 0, split.name);
  writeText(block, 100, `${mode.toString(8).padStart(7, '0')}\0`);
  writeText(block, 108, '0000000\0');
  writeText(block, 116, '0000000\0');
  writeText(block, 124, `${size.toString(8).padStart(11, '0')}\0`);
  writeText(block, 136, `${Math.floor(mtime).toString(8).padStart(11, '0')}\0`);
  // Spaces while the sum is taken, then the sum written over them. That is the
  // format's own rule and the reason the two writes below look redundant.
  writeText(block, 148, '        ');
  writeText(block, 156, '0');
  writeText(block, 257, 'ustar\0');
  writeText(block, 263, '00');
  // **Before the checksum**, which is the whole of what makes adding a field to
  // this function delicate: the sum is over the finished block, so a field
  // written after it is a field the sum does not cover, and the archive fails in
  // a reader that checks rather than here.
  if (split.prefix !== '') writeText(block, 345, split.prefix);

  let sum = 0;
  for (const byte of block) sum += byte;
  writeText(block, 148, `${sum.toString(8).padStart(6, '0')}\0 `);

  return block;
}

/**
 * The name a header block carries, rejoined.
 *
 * Here rather than in each reader for the reason the writer is here: the join is
 * part of the format, and a reader that forgot the prefix would read a 232-byte
 * path as its last few segments and write it to the wrong place. Both fields
 * stop at the first NUL, and an unset `prefix` is 155 zero bytes.
 */
export function headerName(block: Uint8Array): string {
  const field = (at: number, length: number): string =>
    decoder.decode(block.subarray(at, at + length)).replace(/\0.*$/s, '');
  const name = field(0, NAME_MAX);
  const prefix = field(345, PREFIX_MAX);
  return prefix === '' ? name : `${prefix}/${name}`;
}

/**
 * The size a header block declares, or null when the field is not octal.
 *
 * Null rather than a throw, and rather than `NaN`: a block whose size field is
 * not a number is a block we are not positioned on, which is a fact about the
 * archive rather than about this member — the reader stops there rather than
 * guessing an offset and reporting whatever it lands in.
 */
export function headerSize(block: Uint8Array): number | null {
  const raw = decoder.decode(block.subarray(124, 136)).replace(/\0.*$/s, '').trim();
  if (!/^[0-7]+$/.test(raw)) return null;
  return Number.parseInt(raw, 8);
}

/** Whether a block is the all-zero kind that ends an archive. */
export function isTrailerBlock(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0);
}

/** The padding that takes a member's bytes up to a block boundary. */
export function padding(size: number): number {
  return (BLOCK - (size % BLOCK)) % BLOCK;
}

/** Two empty blocks end a tar, and a reader that trusts the format needs them. */
export function trailer(): Uint8Array {
  return new Uint8Array(BLOCK * 2);
}
