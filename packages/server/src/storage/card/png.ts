// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { inflateSync } from 'node:zlib';

import encodeChunks from 'png-chunks-encode';
import extractChunks from 'png-chunks-extract';
import textChunk from 'png-chunk-text';

import { decodeBlobIndex, encodeBlobIndex } from './blob-index.js';
import {
  type BlobStore,
  type CardCodec,
  type CardContents,
  type CardEnvelope,
  CardFormatError,
  isCardEnvelope,
  type LegacyCard,
} from './envelope.js';

/**
 * The PNG card codec.
 *
 * **Splice chunks, never re-encode pixels.** A PNG is a list of typed chunks;
 * the image lives in `IHDR` plus `IDAT` and our data lives beside it. Writing a
 * card therefore means *rewriting the list* — drop our own chunks, append fresh
 * ones, re-serialise — and every other chunk passes through byte-identical.
 *
 * That is not a micro-optimisation. `card.png` is the actor
 * ([03 §5.2](../../../../../docs/design/03-data-model.md)), not a thumbnail of it, and the
 * pixels are what a tool that only knows "a card is a picture" will render.
 * Decoding and re-compressing on every save would degrade the user's art a
 * little at a time, invisibly, which is the sort of loss nobody notices until it
 * is many saves deep.
 *
 * **Two chunks**, per [26 B5](../../../../../docs/design/26-open-questions.md):
 *
 * - `tEXt` with base64 JSON, under our own keyword. Base64 costs ~33% and buys
 *   readability by any tool that can list PNG text chunks, and the JSON is the
 *   small half of a card anyway.
 * - `seMd`, a private chunk holding the media blobs as raw bytes. See
 *   `blob-index.ts` for why that half is not base64.
 *
 * **The chunk type `seMd` is not arbitrary.** PNG encodes four properties in the
 * case of its four type bytes, and all four matter here:
 *
 * ```
 *   s  lowercase → ancillary:     a decoder that does not understand it may skip it
 *   e  lowercase → private:       not registered with the PNG spec, which is correct
 *   M  UPPERCASE → reserved bit:  required to be uppercase by the specification
 *   d  lowercase → safe to copy:  an editor that changes the pixels may keep it
 * ```
 *
 * Safe-to-copy is the interesting one and it is deliberate: the embedded media
 * is a property of the *character*, not of the pixels, so a crop in some other
 * editor should carry it along rather than drop it.
 *
 * **The honest risk**, already noted in the design: ancillary chunks are
 * droppable by spec-compliant tools, so a round trip through a careless image
 * editor can strip all of this. That risk is not new — it is the same one the
 * `chara` chunk the whole ecosystem depends on already carries — and `.seactor`
 * remains the lossless transport.
 */

const CONTAINER = 'png';

/** PNG's magic number. Eight bytes, and the last four catch line-ending damage. */
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Our `tEXt` keyword. Latin-1, 1–79 characters, no leading or trailing space. */
export const CARD_TEXT_KEYWORD = 'storyengine';

/** Our private ancillary chunk. See the module comment for the casing rules. */
export const CARD_MEDIA_CHUNK = 'seMd';

/**
 * The keywords a V2/V3 character card uses.
 *
 * Read, never written. Writing a `chara` chunk alongside ours would put two
 * descriptions of one character in one file, and the V2 shape cannot hold what
 * an Actor carries — so the copy that other tools read would drift from the copy
 * we read, which is the two-sources-of-truth failure
 * ([03 §5.2](../../../../../docs/design/03-data-model.md)) inside a single file.
 */
const LEGACY_KEYWORDS = ['ccv3', 'chara'] as const;

interface Chunk {
  name: string;
  data: Uint8Array;
}

function decodeBase64Json(text: string): unknown {
  // `Buffer.from` is lenient about padding and whitespace, which is what a
  // chunk written by some other tool is likely to have.
  const json = Buffer.from(text, 'base64').toString('utf8');
  return JSON.parse(json) as unknown;
}

function readTextChunks(chunks: Chunk[]): { keyword: string; text: string }[] {
  const found: { keyword: string; text: string }[] = [];
  for (const chunk of chunks) {
    if (chunk.name !== 'tEXt') continue;
    try {
      found.push(textChunk.decode(chunk.data));
    } catch {
      // A malformed text chunk is somebody else's problem, not a reason to
      // refuse the card. Skip it and keep looking for ours.
    }
  }
  return found;
}

function readEnvelope(chunks: Chunk[]): CardEnvelope | null {
  for (const { keyword, text } of readTextChunks(chunks)) {
    if (keyword !== CARD_TEXT_KEYWORD) continue;
    let value: unknown;
    try {
      value = decodeBase64Json(text);
    } catch (cause) {
      throw new CardFormatError(
        CONTAINER,
        `the ${CARD_TEXT_KEYWORD} chunk is not base64-encoded JSON (${String(cause)})`,
      );
    }
    if (!isCardEnvelope(value)) {
      throw new CardFormatError(CONTAINER, `the ${CARD_TEXT_KEYWORD} chunk is not an envelope`);
    }
    return value;
  }
  return null;
}

/** A null-terminated Latin-1 field, and the offset just past its terminator. */
function readNullTerminated(
  data: Uint8Array,
  from: number,
): { value: string; next: number } | null {
  const end = data.indexOf(0, from);
  if (end === -1) return null;
  return { value: Buffer.from(data.subarray(from, end)).toString('latin1'), next: end + 1 };
}

/**
 * A `zTXt` or `iTXt` chunk as keyword and text, or `null` if it is malformed or
 * uses a compression method PNG does not define.
 *
 * **Why this exists, and why only for reading legacy payloads.** The card
 * reader handled `tEXt` alone until P4.0, and the P4 readiness audit found the
 * gap by reading Marinara's importer, which handles both: **Character Tavern
 * writes its `chara` payload into a compressed `zTXt` chunk.** The failure mode
 * is the bad one. Such a file is not a card that fails to convert — it is a
 * file nothing recognises as a card at all, so it lands under *not recognised*
 * and reads to the person as *this tool cannot open my cards*
 * ([P4 §0](../../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * `iTXt` is handled beside it because a card written that way fails
 * identically, and the parse is four more fields once the shape is open.
 *
 * **Our own envelope stays `tEXt`-only, deliberately.** `write()` drops our
 * chunk by looking for a `tEXt` with our keyword; a reader that also accepted a
 * compressed envelope could read one the writer would then fail to remove,
 * leaving two envelopes in one file — the two-sources-of-truth failure this
 * module exists to avoid, rebuilt inside a single card. Foreign compressed
 * chunks survive a write untouched either way, because `write()` preserves
 * everything that is not ours.
 */
function decodeCompressedTextChunk(chunk: Chunk): { keyword: string; text: string } | null {
  const keyword = readNullTerminated(chunk.data, 0);
  if (keyword === null) return null;

  const inflate = (body: Uint8Array): string | null => {
    try {
      return Buffer.from(inflateSync(body)).toString('utf8');
    } catch {
      // Truncated or not actually zlib. Someone else's damage, and skipping it
      // keeps the rest of the card readable.
      return null;
    }
  };

  if (chunk.name === 'zTXt') {
    // keyword \0 compressionMethod(1) compressedText — and 0, zlib deflate, is
    // the only method the format defines.
    if (chunk.data[keyword.next] !== 0) return null;
    const text = inflate(chunk.data.subarray(keyword.next + 1));
    return text === null ? null : { keyword: keyword.value, text };
  }

  // iTXt: keyword \0 compressionFlag(1) compressionMethod(1) language \0
  // translatedKeyword \0 text — the text being UTF-8, compressed only when the
  // flag is set.
  const compressed = chunk.data[keyword.next];
  const method = chunk.data[keyword.next + 1];
  const language = readNullTerminated(chunk.data, keyword.next + 2);
  if (language === null) return null;
  const translated = readNullTerminated(chunk.data, language.next);
  if (translated === null) return null;

  const body = chunk.data.subarray(translated.next);
  if (compressed === 0) return { keyword: keyword.value, text: Buffer.from(body).toString('utf8') };
  if (compressed !== 1 || method !== 0) return null;
  const text = inflate(body);
  return text === null ? null : { keyword: keyword.value, text };
}

/** Every text chunk a foreign tool might have written a card payload into. */
function readAnyTextChunks(chunks: Chunk[]): { keyword: string; text: string }[] {
  const found = readTextChunks(chunks);
  for (const chunk of chunks) {
    if (chunk.name !== 'zTXt' && chunk.name !== 'iTXt') continue;
    const decoded = decodeCompressedTextChunk(chunk);
    if (decoded !== null) found.push(decoded);
  }
  return found;
}

function readLegacy(chunks: Chunk[]): LegacyCard | null {
  const texts = readAnyTextChunks(chunks);
  // V3 first: a card carrying both is a V2 card that was upgraded, and the
  // newer chunk is the one its author last edited.
  for (const keyword of LEGACY_KEYWORDS) {
    const match = texts.find((entry) => entry.keyword === keyword);
    if (!match) continue;
    try {
      return { keyword, data: decodeBase64Json(match.text) };
    } catch {
      // A card whose legacy chunk will not decode still reads as a picture, and
      // may still carry a valid envelope of ours. Report nothing rather than
      // failing the whole read.
      return null;
    }
  }
  return null;
}

function readBlobs(chunks: Chunk[]): BlobStore {
  const chunk = chunks.find((candidate) => candidate.name === CARD_MEDIA_CHUNK);
  return chunk ? decodeBlobIndex(chunk.data) : new Map<string, Uint8Array>();
}

function assertPng(bytes: Uint8Array): void {
  if (!sniff(bytes)) {
    throw new CardFormatError(CONTAINER, 'not a PNG (bad signature)');
  }
}

function sniff(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function parse(bytes: Uint8Array): Chunk[] {
  assertPng(bytes);
  try {
    return extractChunks(bytes);
  } catch (cause) {
    throw new CardFormatError(CONTAINER, `could not read chunks (${String(cause)})`);
  }
}

export const pngCardCodec: CardCodec = {
  container: CONTAINER,
  mime: 'image/png',
  extension: '.png',

  sniff,

  read(bytes: Uint8Array): CardContents {
    const chunks = parse(bytes);
    return {
      envelope: readEnvelope(chunks),
      blobs: readBlobs(chunks),
      legacy: readLegacy(chunks),
    };
  },

  write(
    bytes: Uint8Array,
    envelope: CardEnvelope,
    blobs: BlobStore = new Map<string, Uint8Array>(),
  ): Uint8Array {
    const chunks = parse(bytes);

    // Drop the chunks we own. Everything else — `IHDR`, `IDAT`, a colour
    // profile, someone's `tEXt` copyright notice — survives untouched, which is
    // what makes an unknown ancillary chunk a non-event rather than a loss.
    const preserved = chunks.filter((chunk) => {
      if (chunk.name === CARD_MEDIA_CHUNK) return false;
      if (chunk.name !== 'tEXt') return true;
      try {
        return textChunk.decode(chunk.data).keyword !== CARD_TEXT_KEYWORD;
      } catch {
        return true;
      }
    });

    const endIndex = preserved.findIndex((chunk) => chunk.name === 'IEND');
    if (endIndex === -1) {
      throw new CardFormatError(CONTAINER, 'no IEND chunk');
    }

    const json = JSON.stringify(envelope);
    const inserted: Chunk[] = [
      textChunk.encode(CARD_TEXT_KEYWORD, Buffer.from(json, 'utf8').toString('base64')),
    ];
    // Omitted entirely when there is no media, so a card without images carries
    // no empty chunk to explain.
    if (blobs.size > 0) {
      inserted.push({ name: CARD_MEDIA_CHUNK, data: encodeBlobIndex(blobs) });
    }

    // Before `IEND`, which must be last. Position among the ancillary chunks is
    // otherwise unconstrained for `tEXt`.
    const rewritten = [...preserved.slice(0, endIndex), ...inserted, ...preserved.slice(endIndex)];

    return Uint8Array.from(encodeChunks(rewritten));
  },
};
