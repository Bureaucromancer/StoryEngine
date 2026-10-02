// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***A picture made safe and small before it leaves the browser*** —
 * [25 E15](../../../../docs/design/25-open-questions.md), R1.
 *
 * **Every picture is redrawn, and the original is never sent.** A photograph
 * from a phone carries where it was taken, when, and on what; redrawing it
 * through a canvas keeps the pixels and nothing else. This is the one place
 * that can do it — the server keeps its position of having no raster encoder
 * — so it is not optional and it **fails closed**: a picture this cannot
 * redraw is refused, never uploaded as it came. `squareCrop` in the library
 * editor is deliberately not reused, because it hands back the original when a
 * picture is already square or anything goes wrong, which is the right answer
 * for a portrait and the wrong one here.
 *
 * ***Scaled so its longer edge is at most {@link MAX_PICTURE_EDGE}*** — past
 * that, the models that see pictures shrink them themselves, so the extra
 * pixels cost upload time and nothing else.
 */

/** The longer edge a picture is scaled down to. Never up. */
export const MAX_PICTURE_EDGE = 1568;

/** Why a picture could not be made ready — the composer words each. */
export type PictureRefusal = 'unreadable' | 'unencodable';

export class PictureRefused extends Error {
  readonly reason: PictureRefusal;

  constructor(reason: PictureRefusal) {
    super(`The picture could not be prepared: ${reason}.`);
    this.name = 'PictureRefused';
    this.reason = reason;
  }
}

/** The size a picture is drawn at: the longer edge capped, the ratio kept. */
export function scaledSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_PICTURE_EDGE / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/**
 * The picture as the upload sends it: redrawn, scaled, and written as WebP —
 * or JPEG where the browser cannot write WebP. A browser asked for a type it
 * does not write hands back a PNG, which would pass for success; the type is
 * checked, so it cannot.
 */
export async function preparePicture(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // `from-image`: a phone photo stored sideways is drawn the way it was taken,
    // which the orientation tag said and the redraw is about to discard.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PictureRefused('unreadable');
  }

  const size = scaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    bitmap.close();
    throw new PictureRefused('unencodable');
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  const webp = await encode(canvas, 'image/webp', 0.85);
  if (webp?.type === 'image/webp') return webp;
  const jpeg = await encode(canvas, 'image/jpeg', 0.88);
  if (jpeg?.type === 'image/jpeg') return jpeg;
  throw new PictureRefused('unencodable');
}
