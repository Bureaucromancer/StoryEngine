// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';

/**
 * Builds real zip archives, for tests
 * ([P4 §7.5](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **A writer in the test tree rather than a fixture blob**, and the reasoning is
 * `card/test-png.ts`'s exactly: a checked-in binary is a thing nobody can read
 * in a review, cannot be varied to make a case, and quietly becomes the only
 * archive the reader is ever proved against. A builder makes the awkward cases —
 * a traversing name, a lying size, a stored entry beside a deflated one — one
 * argument each.
 *
 * It writes the same subset the reader reads, which is a real limitation of this
 * pairing and worth saying: a bug in both would be invisible. That is why the
 * CHARX tests assert against a *card* that came out the far end rather than
 * against the archive's own structure, and why the reader's refusals are tested
 * by hand-corrupting bytes rather than by asking the writer for a broken zip.
 */

export interface ZipInput {
  name: string;
  body: Uint8Array | string;
  /** Deflate it. Default is stored, which is what [03 §5.2] specifies for ours. */
  deflate?: boolean;
  /**
   * ***Written as a streaming writer writes it*** — [P13.8]: general-purpose
   * bit 3 set, the local header's CRC and sizes left zero, and a data
   * descriptor carrying them after the bytes. The central directory has the
   * real ones, which is why the readers never trust a local header's sizes.
   */
  descriptor?: boolean;
}

/** What goes around the entries rather than in one — [P13.8]'s awkward tails. */
export interface ZipOptions {
  /** The archive comment, after the end record; up to 65535 bytes. */
  comment?: Uint8Array | string;
  /**
   * Bytes between the central directory and the end record, where a zip64
   * locator would sit — so a test can put one there.
   */
  beforeEnd?: Uint8Array;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

/**
 * CRC-32, because the format carries one and a reader may one day check it.
 *
 * *`node:zlib`'s since [P13.8]*, which needs an archive holding a database
 * past 64 MB, and the bit-at-a-time loop this was took seconds over one.
 */
function crc32(bytes: Uint8Array): number {
  return zlibCrc32(bytes) >>> 0;
}

const DESCRIPTOR = 0x08074b50;

export function makeZip(inputs: readonly ZipInput[], options: ZipOptions = {}): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const input of inputs) {
    const name = encoder.encode(input.name);
    const raw = typeof input.body === 'string' ? encoder.encode(input.body) : input.body;
    const deflated = input.deflate === true;
    const body = deflated ? new Uint8Array(deflateRawSync(raw)) : raw;

    const streamed = input.descriptor === true;
    const trailer = streamed ? 16 : 0;
    const local = new Uint8Array(30 + name.length + body.length + trailer);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL, true);
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, streamed ? 0x0008 : 0, true);
    localView.setUint16(8, deflated ? 8 : 0, true);
    if (!streamed) {
      localView.setUint32(14, crc32(raw), true);
      localView.setUint32(18, body.length, true);
      localView.setUint32(22, raw.length, true);
    }
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);
    if (streamed) {
      const at = 30 + name.length + body.length;
      localView.setUint32(at, DESCRIPTOR, true);
      localView.setUint32(at + 4, crc32(raw), true);
      localView.setUint32(at + 8, body.length, true);
      localView.setUint32(at + 12, raw.length, true);
    }
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, streamed ? 0x0008 : 0, true);
    centralView.setUint16(10, deflated ? 8 : 0, true);
    centralView.setUint32(16, crc32(raw), true);
    centralView.setUint32(20, body.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const directorySize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const comment =
    typeof options.comment === 'string'
      ? encoder.encode(options.comment)
      : (options.comment ?? new Uint8Array(0));
  const eocd = new Uint8Array(22 + comment.length);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, EOCD, true);
  eocdView.setUint16(8, inputs.length, true);
  eocdView.setUint16(10, inputs.length, true);
  eocdView.setUint32(12, directorySize, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, comment.length, true);
  eocd.set(comment, 22);

  return concat([...locals, ...centrals, options.beforeEnd ?? new Uint8Array(0), eocd]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
