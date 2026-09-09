// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { BlobStore } from './envelope.js';
import { CardFormatError } from './envelope.js';

/**
 * The media payload: a length-prefixed blob index followed by raw bytes.
 *
 * **Binary, not base64** ([03 §5.2.2](../../../../../docs/design/03-data-model.md)). PNG
 * ancillary chunks hold arbitrary bytes, so there is no reason to pay base64's
 * ~33% for the part that is actually large. The JSON keeps base64 because it
 * rides in a `tEXt` chunk that other tools can read
 * ([25 B5](../../../../../docs/design/25-open-questions.md)); the images do not need to be
 * readable by anything that does not already understand this format.
 *
 * ```
 *   magic     4 bytes    "SEMD"
 *   version   1 byte     0x01
 *   count     uint32be
 *   index     count × { idLength uint16be, id (UTF-8), size uint32be }
 *   blobs     count × raw bytes, in index order
 * ```
 *
 * **The index is separate from the blobs** rather than interleaved, so a reader
 * that only wants the manifest — how many images, how big, under what ids —
 * stops after a bounded prefix instead of walking the whole payload. That
 * matters for the size indicator the editor owes
 * ([03 §5.2.2](../../../../../docs/design/03-data-model.md)), where a card that quietly grew to
 * 80 MB is a bad surprise at share time.
 *
 * **Magic and version, despite the chunk type already naming this.** A PNG
 * private chunk type is four unregistered bytes that anyone may choose, so the
 * magic is what distinguishes our payload from a collision. The version byte is
 * the cheaper half of the argument: it costs one byte now and is the difference
 * between an upgrade and a guess later.
 */

const MAGIC = 'SEMD';
const MAGIC_BYTES = 4;
const VERSION = 1;
const HEADER_BYTES = MAGIC_BYTES + 1 + 4;
const INDEX_ENTRY_FIXED_BYTES = 2 + 4;

/** Guards a malformed length prefix from becoming a huge allocation. */
const MAX_BLOB_COUNT = 10_000;

const CONTAINER = 'blob-index';

interface IndexEntry {
  id: string;
  bytes: Uint8Array;
  idBytes: Uint8Array;
}

export function encodeBlobIndex(blobs: BlobStore): Uint8Array {
  const entries: IndexEntry[] = [...blobs].map(([id, bytes]) => ({
    id,
    bytes,
    idBytes: new TextEncoder().encode(id),
  }));

  for (const entry of entries) {
    if (entry.idBytes.length === 0) {
      throw new CardFormatError(CONTAINER, 'a blob id may not be empty');
    }
    if (entry.idBytes.length > 0xffff) {
      throw new CardFormatError(CONTAINER, `blob id too long: ${entry.id.slice(0, 40)}…`);
    }
  }

  const indexBytes = entries.reduce(
    (total, entry) => total + INDEX_ENTRY_FIXED_BYTES + entry.idBytes.length,
    0,
  );
  const blobBytes = entries.reduce((total, entry) => total + entry.bytes.length, 0);

  const out = new Uint8Array(HEADER_BYTES + indexBytes + blobBytes);
  const view = new DataView(out.buffer);
  let offset = 0;

  out.set(new TextEncoder().encode(MAGIC), offset);
  offset += MAGIC_BYTES;
  out[offset] = VERSION;
  offset += 1;
  view.setUint32(offset, entries.length);
  offset += 4;

  for (const entry of entries) {
    view.setUint16(offset, entry.idBytes.length);
    offset += 2;
    out.set(entry.idBytes, offset);
    offset += entry.idBytes.length;
    view.setUint32(offset, entry.bytes.length);
    offset += 4;
  }

  for (const entry of entries) {
    out.set(entry.bytes, offset);
    offset += entry.bytes.length;
  }

  return out;
}

export function decodeBlobIndex(data: Uint8Array): BlobStore {
  if (data.length < HEADER_BYTES) {
    throw new CardFormatError(CONTAINER, 'truncated header');
  }

  const magic = new TextDecoder().decode(data.subarray(0, MAGIC_BYTES));
  if (magic !== MAGIC) {
    throw new CardFormatError(CONTAINER, `not a media payload (magic ${JSON.stringify(magic)})`);
  }

  const version = data[MAGIC_BYTES];
  if (version !== VERSION) {
    // Refused rather than guessed. Unlike an unknown *field*, which must survive
    // a round trip, an unknown binary layout cannot be parsed at all — reading
    // it as v1 would hand back plausible nonsense.
    throw new CardFormatError(CONTAINER, `unsupported media payload version ${String(version)}`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = MAGIC_BYTES + 1;

  const count = view.getUint32(offset);
  offset += 4;
  if (count > MAX_BLOB_COUNT) {
    throw new CardFormatError(CONTAINER, `implausible blob count ${String(count)}`);
  }

  const index: { id: string; size: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 2 > data.length) {
      throw new CardFormatError(CONTAINER, 'truncated index');
    }
    const idLength = view.getUint16(offset);
    offset += 2;

    if (offset + idLength + 4 > data.length) {
      throw new CardFormatError(CONTAINER, 'truncated index');
    }
    const id = new TextDecoder().decode(data.subarray(offset, offset + idLength));
    offset += idLength;

    const size = view.getUint32(offset);
    offset += 4;

    index.push({ id, size });
  }

  const blobs: BlobStore = new Map();
  for (const { id, size } of index) {
    if (offset + size > data.length) {
      throw new CardFormatError(CONTAINER, `truncated blob ${JSON.stringify(id)}`);
    }
    // `slice`, not `subarray`: the caller gets bytes it owns rather than a view
    // onto the whole chunk, which would keep the entire card alive in memory for
    // as long as anyone holds one image.
    blobs.set(id, data.slice(offset, offset + size));
    offset += size;
  }

  return blobs;
}
