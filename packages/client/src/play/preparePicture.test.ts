// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { describe, expect, it } from 'vitest';

import { MAX_PICTURE_EDGE, PictureRefused, preparePicture, scaledSize } from './preparePicture.js';

/**
 * ***Redrawn, scaled, and never the original*** — [26 E15], R1.
 *
 * The redraw itself is a browser's canvas and is not exercised here; what is,
 * is the two decisions this module makes on its own. **The size**: the longer
 * edge capped, the ratio kept, never enlarged. **The failure**: a picture that
 * cannot be redrawn is refused rather than sent as it came — which is the whole
 * point, because the original is what carries where a photograph was taken.
 */
describe('preparing a picture', () => {
  it('caps the longer edge and keeps the ratio', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: MAX_PICTURE_EDGE, height: 1176 });
    expect(scaledSize(1000, 3136)).toEqual({ width: 500, height: MAX_PICTURE_EDGE });
  });

  it('never enlarges a picture that is already small enough', () => {
    expect(scaledSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  /**
   * ***Fails closed.*** Where the picture cannot be decoded — here, a runtime
   * with no image decoder at all — the answer is a refusal, and there is no
   * code path that hands back the file it was given.
   */
  it('refuses a picture it cannot redraw rather than passing it through', async () => {
    const original = new Blob(['not decodable'], { type: 'image/jpeg' });
    await expect(preparePicture(original)).rejects.toBeInstanceOf(PictureRefused);
  });
});
