// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***How big a stored picture is, read from its header*** —
 * [25 E15](../../../../docs/design/25-open-questions.md)'s record, which lists
 * *"the digest, type, size and dimensions the server read from its own store"*.
 *
 * **A header reader, not a decoder**, and that is the server's standing
 * position rather than a shortcut: it has no raster code and wants none
 * ([E15]: *"the server keeps its position of having no raster encoder"*). The
 * three formats the store accepts each say their size in a few bytes near the
 * front, so reading those bytes is the whole job.
 *
 * *Why the record wants it at all*: what a picture costs a model is a function
 * of its pixel dimensions — tiles, patches, or a fixed figure per resolution
 * class, by endpoint — and R3's per-image token figure is the first thing that
 * will need it. A picture recorded without its size would have to be re-read
 * from bytes that an export does not carry.
 *
 * **Null for anything it cannot read**, which is never an error: a picture
 * whose size is unknown is recorded without one, exactly as a picture whose
 * bytes never arrived is.
 */

export interface PictureSize {
  width: number;
  height: number;
}

export function pictureSize(bytes: Uint8Array): PictureSize | null {
  return pngSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes);
}

function uint16be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function uint32be(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) >>> 0) +
    ((bytes[at + 1] ?? 0) << 16) +
    ((bytes[at + 2] ?? 0) << 8) +
    (bytes[at + 3] ?? 0)
  );
}

function uint24le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function sized(width: number, height: number): PictureSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The first chunk of a PNG is `IHDR`, and its first eight bytes are the size. */
function pngSize(bytes: Uint8Array): PictureSize | null {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((byte, at) => bytes[at] === byte)) return null;
  if (ascii(bytes, 12, 4) !== 'IHDR') return null;
  return sized(uint32be(bytes, 16), uint32be(bytes, 20));
}

/**
 * A JPEG says its size in its start-of-frame segment, which is found by walking
 * the segments from the front. Every `SOFn` marker but the three that are not
 * frames (`C4` Huffman tables, `C8` reserved, `CC` arithmetic conditioning).
 */
function jpegSize(bytes: Uint8Array): PictureSize | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers that stand alone, with no length after them.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      if (at + 8 >= bytes.length) return null;
      return sized(uint16be(bytes, at + 7), uint16be(bytes, at + 5));
    }
    const length = uint16be(bytes, at + 2);
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * A WebP is a RIFF container whose first chunk says which of three encodings it
 * holds, and each keeps its size in a different place: `VP8 ` (lossy) after its
 * start code, `VP8L` (lossless) packed as fourteen-bit fields, and `VP8X` (the
 * extended header) as twenty-four-bit canvas fields.
 */
function webpSize(bytes: Uint8Array): PictureSize | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return null;
  }
  switch (ascii(bytes, 12, 4)) {
    case 'VP8 ': {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      const width = ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff;
      const height = ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff;
      return sized(width, height);
    }
    case 'VP8L': {
      if (bytes[20] !== 0x2f) return null;
      const bits =
        ((bytes[21] ?? 0) |
          ((bytes[22] ?? 0) << 8) |
          ((bytes[23] ?? 0) << 16) |
          ((bytes[24] ?? 0) << 24)) >>>
        0;
      return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    case 'VP8X':
      return sized(uint24le(bytes, 24) + 1, uint24le(bytes, 27) + 1);
    default:
      return null;
  }
}
