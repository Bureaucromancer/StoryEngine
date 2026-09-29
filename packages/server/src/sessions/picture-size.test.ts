// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { pictureSize } from './picture-size.js';

/**
 * ***A header reader, and the places it reads*** — [25 E15](../../../../docs/design/25-open-questions.md)'s
 * record keeps *"the digest, type, size and dimensions the server read from its
 * own store"*, and R3's per-picture token figure is the first thing that will
 * be computed from the last of those.
 *
 * ***Every fixture here is built, byte by byte, from the format's own
 * layout***, rather than taken from a file somebody had. That is the point of
 * the file rather than a convenience: a real photograph exercises whichever
 * path its encoder happened to take, and the paths that go wrong are the ones
 * an encoder rarely takes — a Huffman table before the frame, the two
 * scale bits on a lossy WebP's width, a canvas wider than sixteen bits. Each is
 * spelled out here so that the test says which one it is.
 *
 * *Widths and heights are never equal*, anywhere below, so a reader that swapped
 * them would show; and several are past sixteen bits, so a reader that took a
 * short where the format keeps a longer field would show too.
 *
 * **Null is the answer for anything it cannot read**, never an error: a picture
 * whose size is unknown is recorded without one, exactly as a picture whose
 * bytes never arrived is.
 */

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG chunk, CRC and all — the reader never checks one, but a fixture that lies is a worse fixture. */
function pngChunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A PNG's signature and `IHDR`, which is all a header reader is owed. */
function png(width: number, height: number, first = 'IHDR'): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngChunk(first, header),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

describe('a PNG', () => {
  /**
   * The size is the first eight bytes of `IHDR`, which the format requires to
   * be the first chunk. `640 × 480` is the ordinary case; `70000 × 3` is the one
   * that shows a reader taking a sixteen-bit field where PNG keeps thirty-two.
   */
  it('reads the size from IHDR, all thirty-two bits of it', () => {
    expect(pictureSize(png(640, 480))).toEqual({ width: 640, height: 480 });
    expect(pictureSize(png(70_000, 3))).toEqual({ width: 70_000, height: 3 });
  });

  /**
   * ***What the first chunk says is only a size if the chunk is `IHDR`.*** A
   * reader that took bytes 16 to 23 of anything with a PNG signature would
   * record a size for a file that has none where it looked.
   */
  it('reads nothing from a first chunk that is not IHDR', () => {
    expect(pictureSize(png(640, 480, 'tEXt'))).toBeNull();
  });

  it('reads a zero side as no size, and a header cut short as none at all', () => {
    // A picture zero pixels wide is not a size a record should carry: every
    // cost computed from it would be zero, which is the one wrong answer that
    // looks plausible.
    expect(pictureSize(png(0, 480))).toBeNull();
    expect(pictureSize(png(640, 480).subarray(0, 22))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/** A marker segment: `FF`, the marker, a big-endian length that counts itself, the payload. */
function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

/**
 * A start-of-frame segment: precision, height, width, then three components —
 * seventeen bytes counting the length, which is the size every baseline JPEG
 * has.
 */
function frame(marker: number, width: number, height: number): number[] {
  return segment(marker, [
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    3,
    ...[1, 0x22, 0],
    ...[2, 0x11, 1],
    ...[3, 0x11, 1],
  ]);
}

const ascii = (text: string): number[] => [...Buffer.from(text, 'latin1')];

/** JFIF's `APP0`, which nearly every JPEG opens with. */
const APP0 = segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
/** An `APP1` of the length Exif gives one, which is what a phone's photo opens with. */
const APP1 = segment(0xe1, [...ascii('Exif\0\0'), ...Array<number>(40).fill(0x4d)]);
/** A quantisation table — a segment every real file has before its frame. */
const DQT = segment(0xdb, [0, ...Array<number>(64).fill(1)]);
/** A start-of-scan, after which the bytes are entropy-coded data rather than segments. */
const SOS = segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);

function jpeg(...parts: number[][]): Uint8Array {
  return Uint8Array.from([...SOI, ...parts.flat(), ...EOI]);
}

describe('a JPEG', () => {
  /**
   * ***The frame is found by walking the segments***, each of which says its
   * own length. `APP0` and `APP1` of different lengths before it, and a `DQT`,
   * so a reader that assumed where the frame starts — the offset JFIF alone
   * would put it at — reads a table instead.
   */
  it('walks the segments to a baseline frame and reads its size', () => {
    expect(pictureSize(jpeg(APP0, APP1, DQT, frame(0xc0, 1024, 768), SOS))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  /**
   * ***A progressive JPEG*** says its size in `SOF2` rather than `SOF0`, and is
   * what most photographs saved for the web are. A reader that knew only `C0`
   * would record every one of them without a size.
   */
  it('reads a progressive frame', () => {
    expect(pictureSize(jpeg(APP0, DQT, frame(0xc2, 3000, 2000), SOS))).toEqual({
      width: 3000,
      height: 2000,
    });
  });

  /**
   * ***Every `SOFn` is a frame***, lossless and arithmetic-coded included:
   * thirteen markers between `C0` and `CF`. Rare, which is why they are here —
   * nothing else in this suite would ever produce one.
   */
  it('reads every start-of-frame marker as a frame', () => {
    const frames = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];
    for (const marker of frames) {
      expect(pictureSize(jpeg(APP0, frame(marker, 321, 123))), marker.toString(16)).toEqual({
        width: 321,
        height: 123,
      });
    }
  });

  /**
   * ***Three markers in the `SOFn` range are not frames*** — `C4` Huffman
   * tables, `C8` reserved, `CC` arithmetic conditioning — and a Huffman table
   * before the frame is ordinary. Each is given a payload that *would* read as
   * a plausible size (`0x3344 × 0x1122`), so a reader that took the range as
   * `C0`–`CF` without the three exceptions records that instead of the frame's.
   */
  it('steps over the three markers in that range that are not frames', () => {
    for (const marker of [0xc4, 0xc8, 0xcc]) {
      const table = segment(marker, [0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);
      expect(pictureSize(jpeg(APP0, table, frame(0xc0, 1024, 768))), marker.toString(16)).toEqual({
        width: 1024,
        height: 768,
      });
    }
  });

  /**
   * ***Fill bytes and the markers that stand alone.*** Any marker may be
   * preceded by `FF` padding, and `RSTn` and `TEM` have no length after them —
   * a reader that took the next two bytes as one would jump into the middle
   * of the following segment.
   */
  it('steps over fill bytes and markers that carry no length', () => {
    const fill = [0xff, 0xff, 0xff];
    const alone = [0xff, 0xd0, 0xff, 0x01];
    expect(pictureSize(jpeg(APP0, fill, alone, frame(0xc0, 1024, 768)))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  /**
   * ***A scan before any frame ends the walk.*** After `SOS` come entropy-coded
   * bytes, which are not segments and can contain anything — including bytes
   * that look like a frame, which is what follows it here. A reader that walked
   * on would record a size from inside the picture's data.
   *
   * The same for an `EOI` before any frame: the file has ended, and what comes
   * after it — a second picture a camera appended, or anything else — is not
   * this one's. *The two bytes after it are `00 02` on purpose*: a reader that
   * took `EOI` for an ordinary segment would read them as its length and land
   * exactly on the frame, where any other bytes would send it off the end and
   * pass this test by accident.
   */
  it('reads no size when a scan or the end comes before any frame', () => {
    expect(pictureSize(jpeg(APP0, SOS, frame(0xc0, 1024, 768)))).toBeNull();
    expect(pictureSize(jpeg(APP0, EOI, [0x00, 0x02], frame(0xc0, 1024, 768)))).toBeNull();
  });

  /**
   * ***Truncated, three ways.*** A frame whose width is cut through its second
   * byte — the half that is there reads as `0x0400`, so a reader without the
   * bounds check records `1024 × 768` from a frame that never said so; a segment
   * whose length runs past the end; and something other than a marker where a
   * marker should be.
   */
  it('reads no size from a file cut short or broken mid-walk', () => {
    const cut = Uint8Array.from([...SOI, 0xff, 0xc0, 0x00, 0x11, 8, 0x03, 0x00, 0x04]);
    expect(pictureSize(cut)).toBeNull();

    const overlong = Uint8Array.from([...SOI, 0xff, 0xe0, 0x01, 0x00, 1, 2, 3, 4]);
    expect(pictureSize(overlong)).toBeNull();

    const broken = Uint8Array.from([...SOI, ...APP0, 0x00, 0xc0, ...frame(0xc0, 1024, 768)]);
    expect(pictureSize(broken)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

/**
 * A RIFF/WebP file with one chunk of `body` — the container header, the chunk's
 * fourcc and length, and enough padding that the reader's thirty-byte minimum is
 * never the reason a case passes or fails.
 */
function webp(fourcc: string, body: readonly number[]): Uint8Array {
  const chunk = Buffer.alloc(Math.max(body.length, 16));
  chunk.set(body);
  const head = Buffer.alloc(20);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(12 + chunk.length, 4);
  head.write('WEBP', 8, 'ascii');
  head.write(fourcc, 12, 'ascii');
  head.writeUInt32LE(chunk.length, 16);
  return Buffer.concat([head, chunk]);
}

const le16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];
const le24 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
const le32 = (value: number): number[] => [...le16(value & 0xffff), ...le16(value >>> 16)];

/**
 * A lossy frame: a three-byte frame tag, the start code `9d 01 2a`, then width
 * and height as sixteen-bit fields whose top two bits are a *scale*, not size.
 */
function vp8(width: number, height: number, startCode = [0x9d, 0x01, 0x2a]): Uint8Array {
  return webp('VP8 ', [0x50, 0x02, 0x00, ...startCode, ...le16(width), ...le16(height)]);
}

/**
 * A lossless frame: the signature byte `2f`, then one thirty-two-bit field
 * holding width − 1 and height − 1 in fourteen bits each, an alpha hint, and a
 * three-bit version.
 */
function vp8l(width: number, height: number, alpha: boolean, signature = 0x2f): Uint8Array {
  const bits = ((width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0;
  return webp('VP8L', [signature, ...le32(bits)]);
}

/** The extended header: flags, three reserved bytes, then canvas width − 1 and height − 1 in twenty-four bits each. */
function vp8x(width: number, height: number): Uint8Array {
  return webp('VP8X', [0x10, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);
}

describe('a WebP', () => {
  /**
   * ***The two scale bits are not size.*** Both are set here, on both sides, so
   * a reader that took all sixteen bits reads `49552 × 49452` for a picture
   * that is `400 × 300`.
   */
  it('reads a lossy frame after its start code, without the scale bits', () => {
    expect(pictureSize(vp8(0xc000 | 400, 0xc000 | 300))).toEqual({ width: 400, height: 300 });
  });

  it('reads nothing from a lossy frame without its start code', () => {
    expect(pictureSize(vp8(400, 300, [0x9d, 0x01, 0x2b]))).toBeNull();
  });

  /**
   * ***Fourteen bits each, stored minus one, beside an alpha bit.*** The largest
   * lossless side is `16384`, which is fourteen ones plus one — so it pins both
   * the mask and the `+ 1`. The alpha bit is set, so a reader that shifted
   * without masking reads a height past sixteen thousand.
   */
  it('reads a lossless frame’s packed fields, plus one, without the alpha bit', () => {
    expect(pictureSize(vp8l(16_384, 3000, true))).toEqual({ width: 16_384, height: 3000 });
    expect(pictureSize(vp8l(1, 2, false))).toEqual({ width: 1, height: 2 });
  });

  it('reads nothing from a lossless frame without its signature byte', () => {
    expect(pictureSize(vp8l(400, 300, false, 0x2e))).toBeNull();
  });

  /**
   * ***The extended header's canvas is twenty-four bits a side, minus one*** —
   * the only one of the three that can say a size past sixteen bits, which is
   * what `70000` is for.
   */
  it('reads the extended header’s canvas, twenty-four bits a side, plus one', () => {
    expect(pictureSize(vp8x(70_000, 2))).toEqual({ width: 70_000, height: 2 });
  });

  /**
   * A RIFF file that is not a WebP — a WAV has the same first four bytes, which
   * is why the sniffer checks the second marker too — and a WebP whose first
   * chunk is one the reader does not know.
   */
  it('reads nothing from another RIFF, or an encoding it does not know', () => {
    const wave = Buffer.from(vp8x(640, 480));
    wave.write('WAVE', 8, 'ascii');
    expect(pictureSize(wave)).toBeNull();
    expect(pictureSize(webp('VP9 ', [...le16(640), ...le16(480)]))).toBeNull();
  });

  it('reads nothing from a WebP cut short of its size', () => {
    expect(pictureSize(vp8x(640, 480).subarray(0, 28))).toBeNull();
  });
});

describe('anything else', () => {
  /**
   * ***Null, not a throw***, for bytes that are none of the three — the store
   * refuses those at the door, so this is the reader's own floor rather than a
   * path the store takes: nothing, a PNG signature with nothing after it, a GIF
   * (which says its size in its first ten bytes, and is still not one of the
   * three), text, and a JPEG that is its first marker and nothing else.
   */
  it('reads no size from what is not one of the three formats', () => {
    expect(pictureSize(new Uint8Array())).toBeNull();
    expect(pictureSize(Uint8Array.from(PNG_SIGNATURE))).toBeNull();
    expect(pictureSize(Uint8Array.from([...ascii('GIF89a'), 0x80, 0x02, 0xe0, 0x01]))).toBeNull();
    expect(pictureSize(Buffer.from('<html>not a picture</html>'))).toBeNull();
    expect(pictureSize(Uint8Array.from(SOI))).toBeNull();
  });
});
