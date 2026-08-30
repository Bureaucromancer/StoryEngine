// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newActor, newLorebook } from '@storyengine/shared';

import { makeTestLibrary, type TestLibrary } from '../index-db/test-library.js';
import { create, LibraryError, readCardPixels, type LibraryContext } from '../library.js';
import { pngCardCodec } from '../storage/card/index.js';
import { base64TextChunk, decodeChunks, makePng, withChunks } from '../storage/card/test-png.js';

/**
 * **An imported actor keeps the card it arrived on** ([P4 §1.3]).
 *
 * `create()` built every new actor on a 1×1 transparent PNG and nothing accepted
 * a canvas, so an importer wanting the card's own image had two options: write
 * the file itself, or lose the picture. The first bypasses the kind queue, the
 * id-conflict check, `writeAtomic` and the synchronous ingest that makes
 * read-after-write hold — which are not incidental to `create()`, they are what
 * it is. So `create()` grew the parameter instead, and these are the four claims
 * that makes.
 */

let library: TestLibrary;
let context: LibraryContext;

beforeEach(async () => {
  library = await makeTestLibrary();
  context = { db: library.db, layout: library.layout, keepHistoryPerObject: 10 };
});

afterEach(async () => {
  await library.dispose();
});

/** A card as it arrives from SillyTavern: real pixels, a `chara` payload. */
function importedCard(): Uint8Array {
  return withChunks(makePng(), [
    base64TextChunk('chara', { spec: 'chara_card_v2', data: { name: 'Vera Solano' } }),
  ]);
}

function idatOf(png: Uint8Array): string {
  const idat = decodeChunks(png).find((chunk) => chunk.name === 'IDAT');
  return Buffer.from(idat?.data ?? new Uint8Array()).toString('base64');
}

describe('creating an actor on imported pixels', () => {
  it('keeps the image, byte for byte, rather than re-encoding it', async () => {
    const arrived = importedCard();
    const actor = newActor('Vera Solano');

    await create(context, 'ned', actor, undefined, { cardPixels: arrived });

    const written = await readCardPixels(context, 'ned', actor.id);
    expect(idatOf(written.bytes)).toBe(idatOf(arrived));
  });

  it('reads back as one of ours', async () => {
    const actor = newActor('Vera Solano');

    await create(context, 'ned', actor, undefined, { cardPixels: importedCard() });

    const written = await readCardPixels(context, 'ned', actor.id);
    const contents = pngCardCodec.read(written.bytes);
    expect(contents.envelope?.payload).toEqual(actor);
  });

  it('leaves the legacy chunk in the file, which is somebody else’s data', async () => {
    // Stripping it would destroy the file's validity as a SillyTavern card. The
    // cost — other tools keep reading a payload that no longer moves when ours
    // does — is accepted and named per object in the review ([P4 §1.3]).
    const actor = newActor('Vera Solano');

    await create(context, 'ned', actor, undefined, { cardPixels: importedCard() });

    const written = await readCardPixels(context, 'ned', actor.id);
    const contents = pngCardCodec.read(written.bytes);
    expect(contents.legacy?.keyword).toBe('chara');
  });

  it('is still `create()`, so the id-conflict check still fires', async () => {
    // The point of doing this as a parameter rather than a second write path.
    const actor = newActor('Vera Solano');
    await create(context, 'ned', actor, undefined, { cardPixels: importedCard() });

    await expect(
      create(context, 'ned', actor, undefined, { cardPixels: importedCard() }),
    ).rejects.toThrow(LibraryError);
  });

  it('refuses bytes that are not an image this build can write', async () => {
    // Sniffed by magic number, so a JPEG named `.png` is refused at the door
    // rather than throwing inside the codec.
    await expect(
      create(context, 'ned', newActor('Vera Solano'), undefined, {
        cardPixels: new TextEncoder().encode('not a png at all'),
      }),
    ).rejects.toThrow(/not a format this build can write/);
  });

  it('refuses a canvas for a kind that is not stored as a card', async () => {
    await expect(
      create(context, 'ned', newLorebook('Rain City'), undefined, { cardPixels: importedCard() }),
    ).rejects.toThrow(/only an actor is stored as a card/i);
  });
});
