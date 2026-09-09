// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { CardCodec } from './envelope.js';
import { CardFormatError } from './envelope.js';
import { pngCardCodec } from './png.js';

export * from './envelope.js';
export * from './blob-index.js';
export { CARD_MEDIA_CHUNK, CARD_TEXT_KEYWORD, pngCardCodec } from './png.js';

/**
 * Every container that can carry a card.
 *
 * One entry today. The list exists so that WebP and JPEG
 * ([03 §5.2](../../../../../docs/design/03-data-model.md)) arrive as an append here rather than
 * as a change to every caller — which is the whole reason the envelope was
 * defined separately from the PNG chunk layout.
 */
export const CARD_CODECS: readonly CardCodec[] = [pngCardCodec];

/**
 * Picks a codec by magic number rather than by file extension.
 *
 * The extension is what the user named the file; the magic is what the file is.
 * Import accepts whatever someone drags in ([03 §5.2](../../../../../docs/design/03-data-model.md)),
 * and a JPEG named `.png` is a normal thing to be handed.
 */
export function codecFor(bytes: Uint8Array): CardCodec | null {
  return CARD_CODECS.find((codec) => codec.sniff(bytes)) ?? null;
}

export function requireCodecFor(bytes: Uint8Array): CardCodec {
  const codec = codecFor(bytes);
  if (!codec) {
    const known = CARD_CODECS.map((candidate) => candidate.container).join(', ');
    throw new CardFormatError('card', `unrecognised container. Known containers: ${known}`);
  }
  return codec;
}
