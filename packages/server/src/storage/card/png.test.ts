// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { newActor } from '@storyengine/shared';

import { CardFormatError, envelope, type BlobStore } from './envelope.js';
import { codecFor, requireCodecFor } from './index.js';
import { CARD_MEDIA_CHUNK, CARD_TEXT_KEYWORD, pngCardCodec } from './png.js';
import { base64TextChunk, decodeChunks, makePng, pixelBytes, withChunks } from './test-png.js';

/**
 * The card envelope — docs/design/workplan/03-p1-implementation.md §P1.3.
 *
 * Four claims are under test, and they are the four the stage plan names:
 * object → chunk → object is identity, the pixels survive a save byte-identical,
 * a V2/V3 card still parses, and an unknown ancillary chunk comes through.
 */

const codec = pngCardCodec;

function roundTrip(payload: unknown, blobs?: BlobStore): ReturnType<typeof codec.read> {
  return codec.read(codec.write(makePng(), envelope(payload), blobs));
}

describe('object → chunk → object is identity', () => {
  it('carries an actor through unchanged', () => {
    // [testing §1](../../../../../docs/design/workplan/10-testing.md) lists this as an invariant rather than
    // an example, which is why the property test below exists too.
    const actor = newActor('Vera Solano');
    expect(roundTrip(actor).envelope?.payload).toEqual(actor);
  });

  it('preserves fields the codec has never heard of', () => {
    // The codec does not know what an Actor is and must not start caring
    // ([10 §2](../../../../../docs/design/10-schemas.md)).
    const payload = { schema: 'storyengine.campaign/1', id: 'x', invented: { deep: [1, null] } };
    expect(roundTrip(payload).envelope?.payload).toEqual(payload);
  });

  it('adds no loss of its own beyond what JSON already costs', () => {
    // The reason this is a property rather than three examples: `tEXt` is
    // Latin-1, so any non-Latin-1 character would corrupt if the JSON were
    // written raw. Base64 of UTF-8 is what makes it safe, and a generator finds
    // the counterexample a hand-written test forgets — emoji, RTL marks, lone
    // surrogates, NUL.
    //
    // Compared against `JSON.parse(JSON.stringify(x))` rather than against `x`,
    // and that is the honest form of the claim. JSON is lossy for a few values
    // — see the `-0` case below — and the invariant worth asserting is that the
    // *envelope* adds nothing to that. Comparing against `x` would either fail
    // for a reason that is not ours or force the generator to be trimmed until
    // it stopped finding things.
    fc.assert(
      fc.property(fc.jsonValue(), (payload) => {
        const throughJson: unknown = JSON.parse(JSON.stringify(payload));
        expect(roundTrip(payload).envelope?.payload).toEqual(throughJson);
      }),
      { numRuns: 200 },
    );
  });

  it('holds for unicode strings specifically', () => {
    // `unit: 'binary'` reaches astral planes and lone surrogates, which is where
    // a UTF-8/Latin-1 confusion would surface.
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (name) => {
        const actor = { ...newActor('placeholder'), name };
        expect(roundTrip(actor).envelope?.payload).toEqual(actor);
      }),
      { numRuns: 200 },
    );
  });

  it('loses negative zero, because JSON does', () => {
    // Found by the property test above rather than anticipated, and recorded
    // here so it is a known property of the format instead of a surprise.
    // `JSON.stringify(-0)` is `"0"`, so no JSON-carried format can preserve it —
    // and nothing in a portable object has a use for a signed zero.
    expect(roundTrip({ zero: -0 }).envelope?.payload).toEqual({ zero: 0 });
  });

  it('replaces rather than accumulates on a second save', () => {
    // Writing twice must not leave two `storyengine` chunks, with a reader
    // silently picking whichever came first.
    const first = codec.write(makePng(), envelope(newActor('First')));
    const second = codec.write(first, envelope(newActor('Second')));

    const textChunks = decodeChunks(second).filter((chunk) => chunk.name === 'tEXt');
    expect(textChunks).toHaveLength(1);
    expect((codec.read(second).envelope?.payload as { name: string }).name).toBe('Second');
  });
});

describe('the pixels survive', () => {
  it('is byte-identical across a save', () => {
    // The whole reason this is a chunk splice rather than a decode-and-re-encode
    // ([02 §5.2](../../../../../docs/design/02-data-model.md)). Re-compressing degrades the
    // user's art a little at a time, invisibly, and `card.png` is the actor —
    // not a thumbnail of it.
    const original = makePng(8, 3);
    const written = codec.write(original, envelope(newActor('Vera Solano')));

    expect(pixelBytes(written)).toEqual(pixelBytes(original));
  });

  it('stays byte-identical across ten saves', () => {
    // One save proving nothing changed is weaker than it looks: a lossy step
    // would show up as slow drift. Ten saves make drift visible.
    const original = makePng(8, 3);
    let current = original;
    for (let i = 0; i < 10; i += 1) {
      current = codec.write(current, envelope(newActor(`Save ${String(i)}`)));
    }

    expect(pixelBytes(current)).toEqual(pixelBytes(original));
  });

  it('keeps the chunk order the format requires', () => {
    const written = decodeChunks(codec.write(makePng(), envelope(newActor('Vera'))));

    expect(written[0]?.name).toBe('IHDR');
    expect(written.at(-1)?.name).toBe('IEND');
  });
});

describe('a V2/V3 chara card still parses', () => {
  const v2 = { name: 'Seraphina', description: 'A forest guardian.', personality: 'Warm' };

  it('reads a V2 chara chunk without converting it', () => {
    // Read, not adopted. Mapping `personality` onto traits and `scenario` onto a
    // Setting draft is import's job at P4
    // ([02 §2.7](../../../../../docs/design/02-data-model.md)) — it involves heuristics and a
    // review step, neither of which belongs in a decoder.
    const card = withChunks(makePng(), [base64TextChunk('chara', v2)]);
    const contents = codec.read(card);

    expect(contents.legacy).toEqual({ keyword: 'chara', data: v2 });
    expect(contents.envelope).toBeNull();
  });

  it('prefers ccv3 when a card carries both', () => {
    // A card with both is a V2 that was upgraded, so the V3 chunk is the one its
    // author last edited.
    const v3 = { ...v2, spec: 'chara_card_v3' };
    const card = withChunks(makePng(), [base64TextChunk('chara', v2), base64TextChunk('ccv3', v3)]);

    expect(codec.read(card).legacy).toEqual({ keyword: 'ccv3', data: v3 });
  });

  it('reports both when a card carries a legacy chunk and one of ours', () => {
    // Which wins is the caller's decision, so both are surfaced rather than one
    // shadowing the other.
    const actor = newActor('Vera Solano');
    const card = codec.write(
      withChunks(makePng(), [base64TextChunk('chara', v2)]),
      envelope(actor),
    );
    const contents = codec.read(card);

    expect(contents.envelope?.payload).toEqual(actor);
    expect(contents.legacy?.keyword).toBe('chara');
  });

  it('does not write a chara chunk of its own', () => {
    // Two descriptions of one character in one file is the two-sources-of-truth
    // failure inside a single file: the V2 shape cannot hold what an Actor
    // carries, so the copy other tools read would drift from ours.
    const written = codec.write(makePng(), envelope(newActor('Vera Solano')));
    const keywords = decodeChunks(written)
      .filter((chunk) => chunk.name === 'tEXt')
      .map((chunk) => new TextDecoder('latin1').decode(chunk.data).split('\0')[0]);

    expect(keywords).toEqual([CARD_TEXT_KEYWORD]);
  });

  it('survives a legacy chunk that will not decode', () => {
    // A card whose `chara` chunk is corrupt still reads as a picture and may
    // still carry a valid envelope of ours. Refusing the whole file would be a
    // worse answer than reporting no legacy payload.
    const card = withChunks(makePng(), [
      { name: 'tEXt', data: new TextEncoder().encode('chara\0not base64 at all!!') },
    ]);

    expect(codec.read(card).legacy).toBeNull();
  });
});

describe('chunks we do not own', () => {
  it('survives a round trip', () => {
    // The point of splicing: everything that is not ours passes through
    // untouched, whether it is a colour profile, someone's copyright notice, or
    // a chunk from a tool that did not exist when this was written.
    const foreign = { name: 'gAMA', data: Uint8Array.from([0, 1, 134, 160]) };
    const notice = base64TextChunk('Copyright', 'Mireille, 2026');

    const card = codec.write(
      withChunks(makePng(), [foreign, notice]),
      envelope(newActor('Vera Solano')),
    );
    const chunks = decodeChunks(card);

    expect(chunks.find((chunk) => chunk.name === 'gAMA')?.data).toEqual(foreign.data);
    expect(chunks.filter((chunk) => chunk.name === 'tEXt')).toHaveLength(2);
  });
});

describe('media blobs', () => {
  const blobs: BlobStore = new Map([
    ['blob-1', Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x01])],
    ['blob-2', new Uint8Array(4096).fill(7)],
  ]);

  it('round-trips raw bytes', () => {
    expect(roundTrip(newActor('Vera'), blobs).blobs).toEqual(blobs);
  });

  it('writes no media chunk when there is no media', () => {
    const written = codec.write(makePng(), envelope(newActor('Vera')));
    expect(decodeChunks(written).some((chunk) => chunk.name === CARD_MEDIA_CHUNK)).toBe(false);
    expect(codec.read(written).blobs.size).toBe(0);
  });

  it('stores bytes raw rather than base64', () => {
    // The reason the media half is not base64 like the JSON half: ~33% on the
    // large part of a card is worth avoiding ([02 §5.2.2]).
    const one = new Map([['solid', new Uint8Array(10_000).fill(0xab)]]);
    const written = codec.write(makePng(), envelope(newActor('Vera')), one);
    const chunk = decodeChunks(written).find((c) => c.name === CARD_MEDIA_CHUNK);

    expect(chunk!.data.length).toBeLessThan(10_500);
  });

  it('replaces the media chunk rather than appending a second', () => {
    const first = codec.write(makePng(), envelope(newActor('Vera')), blobs);
    const second = codec.write(
      first,
      envelope(newActor('Vera')),
      new Map([['only', new Uint8Array(3)]]),
    );

    expect(decodeChunks(second).filter((c) => c.name === CARD_MEDIA_CHUNK)).toHaveLength(1);
    expect([...codec.read(second).blobs.keys()]).toEqual(['only']);
  });

  it('round-trips ids that are not ASCII', () => {
    const unicodeIds: BlobStore = new Map([['地図', Uint8Array.from([1, 2, 3])]]);
    expect(roundTrip(newActor('Vera'), unicodeIds).blobs).toEqual(unicodeIds);
  });
});

describe('refusing what it cannot read', () => {
  it('rejects bytes that are not a PNG', () => {
    const notPng = new TextEncoder().encode('GIF89a and then some');
    expect(() => codec.read(notPng)).toThrow(CardFormatError);
    expect(codec.sniff(notPng)).toBe(false);
    expect(codecFor(notPng)).toBeNull();
    expect(() => requireCodecFor(notPng)).toThrow(CardFormatError);
  });

  it('selects the PNG codec by magic number, not by extension', () => {
    expect(codecFor(makePng())).toBe(codec);
  });

  it('rejects an envelope chunk that is not an envelope', () => {
    const card = withChunks(makePng(), [
      base64TextChunk(CARD_TEXT_KEYWORD, { not: 'an envelope' }),
    ]);
    expect(() => codec.read(card)).toThrow(/not an envelope/);
  });

  it('rejects an envelope chunk that is not base64 JSON', () => {
    const card = withChunks(makePng(), [
      { name: 'tEXt', data: new TextEncoder().encode(`${CARD_TEXT_KEYWORD}\0!!!not base64!!!`) },
    ]);
    expect(() => codec.read(card)).toThrow(CardFormatError);
  });

  it('accepts an envelope from a newer version rather than refusing it', () => {
    // The payload is self-describing and the registry decides whether it can be
    // read, so refusing here would strand a card for a reason this layer cannot
    // actually judge ([10 §2](../../../../../docs/design/10-schemas.md)).
    const card = withChunks(makePng(), [
      base64TextChunk(CARD_TEXT_KEYWORD, {
        schema: 'storyengine.card',
        version: 99,
        payload: { schema: 'storyengine.actor/1', name: 'From the future' },
      }),
    ]);

    expect(codec.read(card).envelope?.version).toBe(99);
  });
});
