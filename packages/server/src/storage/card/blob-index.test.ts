// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { decodeBlobIndex, encodeBlobIndex } from './blob-index.js';
import { type BlobStore, CardFormatError } from './envelope.js';

describe('the blob index round-trips', () => {
  it('carries bytes and ids unchanged', () => {
    const blobs: BlobStore = new Map([
      ['portrait', Uint8Array.from([0x89, 0x50, 0x4e, 0x47])],
      ['expression-angry', new Uint8Array(1024).fill(0x2a)],
    ]);

    expect(decodeBlobIndex(encodeBlobIndex(blobs))).toEqual(blobs);
  });

  it('handles an empty store', () => {
    expect(decodeBlobIndex(encodeBlobIndex(new Map()))).toEqual(new Map());
  });

  it('handles a zero-length blob', () => {
    // Distinct from an absent one, and a length-prefixed format has to say so.
    const blobs: BlobStore = new Map([['empty', new Uint8Array(0)]]);
    expect(decodeBlobIndex(encodeBlobIndex(blobs))).toEqual(blobs);
  });

  it('handles ids that are not ASCII', () => {
    // Ids are length-prefixed in *bytes*, not characters, which is the bug this
    // catches: a multi-byte id would desynchronise everything after it.
    const blobs: BlobStore = new Map([
      ['地図', Uint8Array.from([1])],
      ['carte-régionale', Uint8Array.from([2, 3])],
      ['🗺️', Uint8Array.from([4, 5, 6])],
    ]);

    expect(decodeBlobIndex(encodeBlobIndex(blobs))).toEqual(blobs);
  });

  it('holds for arbitrary ids and payloads', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(fc.string({ unit: 'binary', minLength: 1 }), fc.uint8Array()), {
          selector: ([id]) => id,
          maxLength: 12,
        }),
        (entries) => {
          const blobs: BlobStore = new Map(entries);
          expect(decodeBlobIndex(encodeBlobIndex(blobs))).toEqual(blobs);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('preserves insertion order', () => {
    // The index and the blob run are written in the same order, so a reader
    // that got one of them backwards would hand back mismatched bytes.
    const blobs: BlobStore = new Map([
      ['c', Uint8Array.from([3])],
      ['a', Uint8Array.from([1])],
      ['b', Uint8Array.from([2])],
    ]);

    expect([...decodeBlobIndex(encodeBlobIndex(blobs)).keys()]).toEqual(['c', 'a', 'b']);
  });
});

describe('the blob index stores bytes raw', () => {
  it('costs almost nothing over the payload itself', () => {
    // The reason this half is not base64 like the JSON half: ~33% on the large
    // part of a card is worth avoiding ([02 §5.2.2](docs/design/02-data-model.md)).
    const payload = new Uint8Array(100_000).fill(0xcd);
    const encoded = encodeBlobIndex(new Map([['big', payload]]));

    expect(encoded.length).toBeLessThan(payload.length + 64);
  });

  it('contains the payload verbatim', () => {
    const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    const encoded = encodeBlobIndex(new Map([['x', payload]]));

    expect([...encoded.subarray(encoded.length - 4)]).toEqual([...payload]);
  });
});

describe('the blob index refuses what it cannot trust', () => {
  it('rejects a truncated header', () => {
    expect(() => decodeBlobIndex(new Uint8Array(4))).toThrow(CardFormatError);
  });

  it('rejects a payload that is not ours', () => {
    // A PNG private chunk type is four unregistered bytes anyone may pick, so
    // the magic is what distinguishes our payload from a collision.
    const foreign = new Uint8Array(16);
    foreign.set(new TextEncoder().encode('XXXX'));
    expect(() => decodeBlobIndex(foreign)).toThrow(/not a media payload/);
  });

  it('rejects a version it does not know', () => {
    // Refused rather than guessed. Unlike an unknown *field*, an unknown binary
    // layout cannot be parsed at all — reading it as v1 would hand back
    // plausible nonsense.
    const encoded = encodeBlobIndex(new Map([['x', Uint8Array.from([1])]]));
    encoded[4] = 99;
    expect(() => decodeBlobIndex(encoded)).toThrow(/unsupported media payload version 99/);
  });

  it('rejects an implausible blob count rather than allocating for it', () => {
    const encoded = encodeBlobIndex(new Map());
    new DataView(encoded.buffer).setUint32(5, 0xffffffff);
    expect(() => decodeBlobIndex(encoded)).toThrow(/implausible blob count/);
  });

  it('rejects a truncated blob run', () => {
    const encoded = encodeBlobIndex(new Map([['x', new Uint8Array(64)]]));
    expect(() => decodeBlobIndex(encoded.slice(0, encoded.length - 8))).toThrow(/truncated/);
  });

  it('rejects an empty id on the way in', () => {
    expect(() => encodeBlobIndex(new Map([['', new Uint8Array(1)]]))).toThrow(/may not be empty/);
  });
});
