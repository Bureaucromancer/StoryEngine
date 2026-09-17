// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';

import { writeAtomic } from '../storage/atomic.js';
import { readFileBytes, unlinkFile } from '../storage/files.js';
import type { Layout } from '../storage/layout.js';

/**
 * The account's face — [12 §5](../../../../docs/design/12-account-gallery.md),
 * [P10.4].
 *
 * ***The gallery's whole aesthetic claim is faces, and accounts had no image.***
 * This is that image: uploaded by its owner, stored as received beside their
 * library, served unauthenticated to a sign-in screen, and removed by the same
 * gesture that removes the account.
 *
 * ***Sniff the bytes, never trust the extension.*** [10 §4.4] already states
 * that rule for the file browser and it is not weaker here — a route that
 * believed a filename would store an HTML document as `avatar.png` and serve it
 * back with a type somebody chose. PNG, JPEG and WebP by **magic number**, and
 * the sniffed type is what names the file.
 *
 * *No re-encoding.* [12 §5.2] is explicit: the server has no raster encoder and
 * should not grow one for this. Contrast the actor card, which is PNG-only
 * because the card **is** the object ([03 §5.2]) — a constraint with no purchase
 * on a picture that is only ever shown.
 */

/** The three types, by sniffed signature. The extension is derived, never read. */
const SIGNATURES: readonly {
  extension: string;
  mime: string;
  test: (bytes: Uint8Array) => boolean;
}[] = [
  {
    extension: 'png',
    mime: 'image/png',
    test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { extension: 'jpg', mime: 'image/jpeg', test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  {
    extension: 'webp',
    mime: 'image/webp',
    // `RIFF` … `WEBP` — the container is RIFF, so the second marker is what
    // distinguishes it from a WAV file with the same first four bytes.
    test: (b) =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
      b.length > 11 &&
      startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
];

/** Every name an avatar could be under, for reading and for replacing. */
const EXTENSIONS = SIGNATURES.map((one) => one.extension);

export interface StoredAvatar {
  mime: string;
  extension: string;
  bytes: Uint8Array;
  /**
   * The content hash — the `ETag`, and the token the listing carries.
   *
   * ***One value doing both jobs, which is what makes the cache story hold
   * together*** ([12 §5.3]): a changed face is a changed token is a changed URL,
   * and an unchanged one is a 304. Two values — a version counter and a hash —
   * could disagree, and the way they disagree is a stale portrait nobody can
   * clear.
   */
  digest: string;
}

/** What the bytes actually are, or null for something that is not an image. */
export function sniff(bytes: Uint8Array): { mime: string; extension: string } | null {
  for (const one of SIGNATURES) {
    if (one.test(bytes)) return { mime: one.mime, extension: one.extension };
  }
  return null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, at) => bytes[at] === byte);
}

/**
 * Reads whichever avatar this account has, or null.
 *
 * **Tries each extension rather than storing the name**, because the name *is*
 * the type: nothing else records which of the three it is, and a record that did
 * would be a second source of truth for a fact the filename already carries.
 */
export async function readAvatar(layout: Layout, handle: string): Promise<StoredAvatar | null> {
  for (const one of SIGNATURES) {
    const path = layout.userAvatarFile(handle, one.extension);
    const bytes = await readFileBytes(path);
    if (bytes === null) continue;
    return {
      mime: one.mime,
      extension: one.extension,
      bytes,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    };
  }
  return null;
}

/**
 * The token the gallery listing carries, without reading the whole file twice.
 *
 * *It does read the file*, which is honest rather than clever: a household has
 * single-digit accounts and the listing is served to an unauthenticated caller
 * once per arrival. A stored token would be a second thing to keep in step with
 * the bytes, and [12 §5.3] wants exactly one.
 */
export async function avatarToken(layout: Layout, handle: string): Promise<string | null> {
  return (await readAvatar(layout, handle))?.digest ?? null;
}

export type AvatarRefusal = 'not-an-image' | 'too-large';

/**
 * Stores one, replacing whatever was there.
 *
 * ***Replacing means removing the others, not only overwriting one.*** Three
 * extensions can name one account's avatar, so a PNG uploaded over a JPEG would
 * leave both on disk and {@link readAvatar} would keep answering with the JPEG —
 * which reads as *the upload did nothing*, forever, with no error anywhere.
 *
 * **Atomically, like every other write**, so a half-written face is never
 * served: the temporary file is renamed into place or nothing changed.
 */
export async function writeAvatar(
  layout: Layout,
  handle: string,
  bytes: Uint8Array,
  limits: { maxBytes: number },
): Promise<StoredAvatar | { refused: AvatarRefusal }> {
  if (bytes.byteLength > limits.maxBytes) return { refused: 'too-large' };

  const kind = sniff(bytes);
  if (kind === null) return { refused: 'not-an-image' };

  await writeAtomic(layout.userAvatarFile(handle, kind.extension), bytes);
  for (const extension of EXTENSIONS) {
    if (extension === kind.extension) continue;
    await unlinkFile(layout.userAvatarFile(handle, extension)).catch(() => undefined);
  }

  return {
    mime: kind.mime,
    extension: kind.extension,
    bytes,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

/** Removes every avatar this account has. Answers whether there was one. */
export async function deleteAvatar(layout: Layout, handle: string): Promise<boolean> {
  let removed = false;
  for (const extension of EXTENSIONS) {
    const gone = await unlinkFile(layout.userAvatarFile(handle, extension))
      .then(() => true)
      .catch(() => false);
    removed ||= gone;
  }
  return removed;
}
