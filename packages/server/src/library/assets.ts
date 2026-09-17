// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';

import type { EmbeddedMedia, PortableSchemaId } from '@storyengine/shared';

import { LibraryError, read, type LibraryContext } from '../library.js';
import {
  ensureDirectory,
  listEntryNames,
  readFileBytes,
  unlinkFile,
  writeFileBytes,
} from '../storage/files.js';
import { userOwner, type LibraryOwner } from '../storage/layout.js';

/**
 * ***Bulk assets, in the folder rather than the manifest*** —
 * [03 §5.2.3](../../../../docs/design/03-data-model.md),
 * [10 §11.2b](../../../../docs/design/10-ui-surfaces.md),
 * [P11](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * ***`assetsRoot` has existed since P1 and nothing has ever written to it.***
 * `EmbeddedMedia` is *"a **reference** to bytes carried by the container, never
 * the bytes themselves"* ([04 §3]), and this build has had exactly one
 * container that carries them: a PNG's blob chunk. A lorebook is a folder with
 * a `lorebook.json` in it, so `readMedia`'s `codecFor` returns null for one and
 * the whole path ends at *"that object is not in a container that carries
 * media"* — which is why §11.2b's *"the book gets a gallery"* has never been
 * reachable rather than merely unbuilt.
 *
 * **This is the folder container, and it is the one the schema already
 * described**: [04 §5]'s own note says `media` is *"bulk, in the folder rather
 * than the manifest. Parity with Actor, and the schema catching up to a layout
 * that already listed `lorebooks/<slug>/lorebook.json + assets/`"*.
 *
 * ***Content-addressed, and that is what makes the rest simple.*** A file is
 * named by the digest of its own bytes, so: uploading the same picture twice
 * costs one file; *replace* is an add and a manifest edit rather than a
 * mutation; and **an orphan is detectable**, because a file nothing in the
 * manifest names is exactly a file whose digest no row carries. {@link sweep}
 * is that, and it is what keeps *upload, then change your mind and never save*
 * from leaving bytes behind forever.
 */

/** Where the bytes live, relative to the object folder — the `ref` of a row. */
const ASSETS = 'assets';

/**
 * The extension a mime type gets, for a file somebody may one day open in a
 * file manager.
 *
 * **A short list rather than a dependency**, and unknown falls back to `.bin`
 * rather than being refused: the name is a courtesy to a person browsing the
 * folder, and nothing reads it — a `ref` is resolved literally, and `mime` is
 * carried on the manifest row. A wrong extension is a cosmetic defect; a
 * refused upload because a table is short is not.
 */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/** `sha256:<hex>` — the same spelling `EmbeddedMedia.digest` uses. */
export function digestOf(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Every `EmbeddedMedia` row anywhere in an object.
 *
 * ***Both levels, because [10 §11.2b] has two.*** A lorebook carries `media`
 * and so does every one of its entries — *"the book gets a gallery… each entry
 * gets its own strip"* — and an asset referenced only by an entry is still
 * referenced. A sweep that looked at the book's array alone would delete every
 * picture on every entry the first time anybody saved.
 *
 * **Structural rather than kind-aware**: it walks for `media` arrays wherever
 * they are, so a kind that grows one later is covered without an edit here.
 * That is the same bet `EmbeddedMedia` itself makes by being a shared shape.
 */
export function mediaRowsIn(value: unknown): EmbeddedMedia[] {
  const found: EmbeddedMedia[] = [];
  /**
   * **Objects already walked, so a cycle terminates rather than being bounded.**
   * A depth cap was the first attempt and it is the wrong tool: it terminates,
   * but it walks the same node once per level on the way down, so a self-
   * referencing object reports its one row seven times. A `WeakSet` is the
   * actual statement — *this node has been counted* — and the test that found
   * the difference asserts the count rather than the return.
   *
   * The input is a parsed library object, so a cycle means a structure something
   * built in memory rather than a file: JSON cannot express one. Handling it is
   * cheap and the alternative is an infinite loop inside a save.
   */
  const seen = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, item] of Object.entries(node)) {
      if (key === 'media' && Array.isArray(item)) {
        for (const row of item) {
          if (
            typeof row === 'object' &&
            row !== null &&
            typeof (row as { ref?: unknown }).ref === 'string'
          ) {
            found.push(row as EmbeddedMedia);
          }
        }
        continue;
      }
      walk(item);
    }
  };
  walk(value);
  return found;
}

function ownerOf(row: { owner: string }, handle: string): LibraryOwner {
  return row.owner === 'system' ? { kind: 'system' } : userOwner(handle);
}

/**
 * Where an object's assets live, and the guard that they are that object's.
 *
 * `assetsRoot` resolves within the object folder and `basename` is applied to
 * the ref, so a manifest row saying `../../../etc/passwd` resolves to
 * `passwd` inside this object's own assets and finds nothing. **Both halves
 * matter**: the layout's `resolveWithin` is what refuses an escape, and this is
 * what stops a row from trying, so a hand-edited file produces *not found*
 * rather than an exception from a path resolver.
 */
function assetFile(
  context: LibraryContext,
  handle: string,
  row: { owner: string; schemaId: string; slug: string },
  ref: string,
): string {
  const root = context.layout.assetsRoot(
    ownerOf(row, handle),
    row.schemaId as PortableSchemaId,
    row.slug,
  );
  return join(root, basename(ref));
}

/** The bytes one `ref` names, or null when the manifest and the folder disagree. */
export async function readAsset(
  context: LibraryContext,
  handle: string,
  id: string,
  ref: string,
  inKind?: PortableSchemaId,
): Promise<Uint8Array | null> {
  const row = read(context, handle, id, inKind);
  return readFileBytes(assetFile(context, handle, row, ref));
}

/** What an upload becomes: a file on disk, and the row a manifest should carry. */
export interface StoredAsset {
  ref: string;
  digest: string;
  bytes: number;
  mime: string;
}

/**
 * Stores bytes beside an object and hands back the row that would name them.
 *
 * ***It does not touch the object***, and that is the design rather than an
 * omission. The editor holds a draft, [10 §11.2b]'s gallery and strips are two
 * different arrays inside it, and *which array* is a question only the form
 * knows the answer to — a route that decided would need an arm per array and
 * would write the object behind the draft's back, which is the one thing the
 * editor shell exists to prevent.
 *
 * So the bytes land first and the manifest row travels in the ordinary save,
 * hash-checked like every other field. **What that costs is an orphan** — bytes
 * uploaded by somebody who then closed the tab — and {@link sweep} is what that
 * cost buys back, on the next save of the same object.
 *
 * **Refused for a system object**, like every other write: the app ships those
 * and a release would overwrite whatever was put beside them.
 */
export async function storeAsset(
  context: LibraryContext,
  handle: string,
  id: string,
  bytes: Uint8Array,
  mime: string,
  inKind?: PortableSchemaId,
): Promise<StoredAsset> {
  const row = read(context, handle, id, inKind);
  if (row.owner === 'system') {
    throw new LibraryError('read-only', 'System library objects cannot be edited.');
  }

  const digest = digestOf(bytes);
  const ref = `${ASSETS}/${digest.replace('sha256:', '')}.${EXTENSIONS[mime] ?? 'bin'}`;

  const root = context.layout.assetsRoot(
    ownerOf(row, handle),
    row.schemaId as PortableSchemaId,
    row.slug,
  );
  await ensureDirectory(root);
  await writeFileBytes(join(root, basename(ref)), bytes);

  return { ref, digest, bytes: bytes.length, mime };
}

/**
 * Deletes every asset file no manifest row names.
 *
 * ***Called after a save, and never before one.*** The manifest on disk is the
 * only thing that says which bytes are wanted, so sweeping against a draft would
 * delete the picture somebody had just added and not yet saved — which is the
 * failure this function most wants to avoid, because it is silent and it is
 * somebody's file.
 *
 * ***Best-effort by decision.*** A sweep that threw would turn a successful save
 * into a failed request, and what it was doing is housekeeping: the object is on
 * disk, correct, and the worst outcome of a skipped sweep is a file nobody
 * references, which the next save collects. The count comes back so a caller can
 * log it; nothing branches on it.
 */
export async function sweep(
  context: LibraryContext,
  handle: string,
  id: string,
  inKind?: PortableSchemaId,
): Promise<number> {
  try {
    const row = read(context, handle, id, inKind);
    if (row.owner === 'system') return 0;

    const wanted = new Set(mediaRowsIn(row.body).map((one) => basename(one.ref)));
    const root = context.layout.assetsRoot(
      ownerOf(row, handle),
      row.schemaId as PortableSchemaId,
      row.slug,
    );

    let removed = 0;
    for (const name of await listEntryNames(root)) {
      if (wanted.has(name)) continue;
      await unlinkFile(join(root, name));
      removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}
