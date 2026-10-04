// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { deflateSync, inflateSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { pngCardCodec } from './png.js';
import { base64TextChunk, base64ZTextChunk, makePng, withChunks } from './test-png.js';

/**
 * ***A card's compressed text is opened only when it could be the card, and
 * never past a budget*** (2026-09-27).
 *
 * `inflateSync` had no ceiling and ran on every `zTXt` and `iTXt` chunk before
 * anything looked at its keyword. Deflate reaches about a thousand to one, so
 * a one-megabyte card could ask for a gigabyte, synchronously, on the thread
 * every account shares, and the watcher and the rebuild read cards too, so one
 * dropped into a library folder killed the server on every boot.
 *
 * What changed is how much work a read does, which a result cannot show: an
 * unbounded inflate of a bomb and a bounded one both end in *no card here*. So
 * `inflateSync` is wrapped (the real one still runs) and the calls are the
 * assertion.
 */
vi.mock('node:zlib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:zlib')>();
  return { ...actual, inflateSync: vi.fn(actual.inflateSync) };
});

afterEach(() => {
  vi.mocked(inflateSync).mockClear();
});

const CARD = { spec: 'chara_card_v2', data: { name: 'Vera' } };
const BUDGET = 64 * 1024 * 1024;

/** A `zTXt` chunk whose text inflates to `bytes` zeros: a bomb, past the budget. */
function bombChunk(keyword: string, bytes: number) {
  return {
    name: 'zTXt',
    data: Uint8Array.from(
      Buffer.concat([
        Buffer.from(keyword, 'latin1'),
        Buffer.from([0, 0]),
        deflateSync(Buffer.alloc(bytes)),
      ]),
    ),
  };
}

describe("a card's compressed text", () => {
  it('is never opened under a keyword that is not a card', () => {
    const card = withChunks(makePng(), [
      base64TextChunk('chara', CARD),
      base64ZTextChunk('Comment', { anything: 'at all' }),
      base64ZTextChunk('Software', { anything: 'else' }),
    ]);

    expect(pngCardCodec.read(card).legacy).toEqual({ keyword: 'chara', data: CARD });
    expect(inflateSync).not.toHaveBeenCalled();
  });

  it('is opened with a ceiling when it could be the card', () => {
    const card = withChunks(makePng(), [base64ZTextChunk('chara', CARD)]);

    expect(pngCardCodec.read(card).legacy).toEqual({ keyword: 'chara', data: CARD });
    expect(inflateSync).toHaveBeenCalledTimes(1);
    const options = vi.mocked(inflateSync).mock.calls[0]?.[1] as
      { maxOutputLength?: number } | undefined;
    expect(options?.maxOutputLength).toBeLessThanOrEqual(BUDGET);
  });

  it('spends one budget across the read, so a file of bombs costs one', () => {
    const card = withChunks(makePng(), [
      bombChunk('chara', BUDGET + 1),
      bombChunk('chara', BUDGET + 1),
      bombChunk('ccv3', BUDGET + 1),
    ]);

    expect(pngCardCodec.read(card).legacy).toBeNull();
    // The first bomb hits the ceiling and spends what was left, so neither of
    // the others is opened at all.
    expect(inflateSync).toHaveBeenCalledTimes(1);
  });
});
