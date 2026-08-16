// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { deflateSync } from 'node:zlib';

import encodeChunks from 'png-chunks-encode';
import textChunk from 'png-chunk-text';

/**
 * Builds real PNGs for the card tests.
 *
 * Generated rather than checked in as a fixture, for two reasons. A binary
 * fixture is opaque in review — nobody can see from the diff what changed about
 * it — and the tests need to vary the pixels to prove they survive, which a
 * fixed file cannot do.
 *
 * Only ever used by tests, but it lives beside the code rather than under a
 * `fixtures/` tree because it is the inverse of `png.ts`: if the two disagree
 * about what a PNG is, that disagreement should be visible in one directory.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface Chunk {
  name: string;
  data: Uint8Array;
}

/**
 * A valid RGB PNG of `size × size`, filled from `seed`.
 *
 * Small, but genuinely decodable: a real `IHDR`, real zlib-compressed scanlines
 * with their filter bytes, and a real `IEND`. A test that spliced chunks into
 * something that was not a PNG would prove nothing.
 */
export function makePng(size = 4, seed = 0): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is one filter byte followed by `size` RGB triples.
  const raw = new Uint8Array(size * (1 + size * 3));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      raw[offset] = (x * 17 + seed) & 0xff;
      raw[offset + 1] = (y * 31 + seed) & 0xff;
      raw[offset + 2] = (x * y + seed) & 0xff;
      offset += 3;
    }
  }

  return Uint8Array.from(
    encodeChunks([
      { name: 'IHDR', data: ihdr },
      { name: 'IDAT', data: new Uint8Array(deflateSync(raw)) },
      { name: 'IEND', data: new Uint8Array(0) },
    ]),
  );
}

/** Inserts chunks before `IEND`, the way a third-party tool would. */
export function withChunks(png: Uint8Array, extra: Chunk[]): Uint8Array {
  const chunks = decodeChunks(png);
  const end = chunks.findIndex((chunk) => chunk.name === 'IEND');
  return Uint8Array.from(encodeChunks([...chunks.slice(0, end), ...extra, ...chunks.slice(end)]));
}

/** A `tEXt` chunk carrying base64 JSON, which is how V2/V3 cards are written. */
export function base64TextChunk(keyword: string, value: unknown): Chunk {
  return textChunk.encode(keyword, Buffer.from(JSON.stringify(value), 'utf8').toString('base64'));
}

/**
 * A minimal decoder, so the tests can assert on chunks without depending on the
 * same helper the code under test uses to read them.
 */
export function decodeChunks(png: Uint8Array): Chunk[] {
  for (const [index, byte] of SIGNATURE.entries()) {
    if (png[index] !== byte) throw new Error('not a PNG');
  }

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Chunk[] = [];
  let offset = SIGNATURE.length;

  while (offset < png.length) {
    const length = view.getUint32(offset);
    const name = new TextDecoder('latin1').decode(png.subarray(offset + 4, offset + 8));
    const data = png.slice(offset + 8, offset + 8 + length);
    chunks.push({ name, data });
    // length + type + data + crc
    offset += 4 + 4 + length + 4;
  }

  return chunks;
}

/** The compressed image data, which is what "the pixels" means for these tests. */
export function pixelBytes(png: Uint8Array): Uint8Array[] {
  return decodeChunks(png)
    .filter((chunk) => chunk.name === 'IDAT' || chunk.name === 'IHDR')
    .map((chunk) => chunk.data);
}
