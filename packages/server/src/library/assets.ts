// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

import type { EmbeddedMedia, PortableSchemaId } from '@storyengine/shared';

import { LibraryError, read, type LibraryContext } from '../library.js';
import {
  ensureDirectory,
  listEntryNames,
  readFileBytes,
  statFile,
  unlinkFile,
  writeFileBytes,
} from '../storage/files.js';
import { listVersions, readVersionPayload } from '../storage/history.js';
import { userOwner, type LibraryOwner } from '../storage/layout.js';
import { resolveAssetPath } from '../storage/paths.js';

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

/**
 * ***The only names {@link sweep} deletes*** (2026-09-27): the shape
 * {@link storeAsset} writes, a sha256 and one of its extensions.
 *
 * The sweep deleted every name in the folder that no row carried, and the
 * folder is whatever `assets` resolves to. A link `assets -> .` passes any
 * containment check, since it points into the object's own folder, and then
 * the sweep's listing is the object folder itself: `lorebook.json` is a name
 * no row carries. A file somebody put there by hand is not ours to collect
 * either. So a name this build did not write is left alone, whatever it is.
 */
const STORED_NAME = new RegExp(
  `^[0-9a-f]{64}\\.(?:${[...Object.values(EXTENSIONS), 'bin'].join('|')})$`,
);

/**
 * ***How long an upload waits for a save to name it*** (2026-09-27).
 *
 * An upload is stored before any save names it, by design (see
 * {@link storeAsset}), so a sweep cannot tell *an upload nobody saved* from
 * *an upload whose save has not happened yet*. It deleted both. A picture
 * uploaded while another save of the same object was in flight, or in a
 * second tab, was gone before its own save arrived, and that save then named
 * a file that was not there. A day is longer than any draft is held open, and
 * the cost is only that an abandoned upload is collected a day later.
 */
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

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

interface ObjectRow {
  owner: string;
  schemaId: string;
  slug: string;
}

/**
 * The object's folder, checked to be inside the data directory where it lands,
 * which is the check every read of the object file already makes
 * (`layout.assertReal`). {@link assetFile} then holds the assets to this folder.
 */
async function objectFolder(
  context: LibraryContext,
  handle: string,
  row: ObjectRow,
): Promise<string> {
  const root = context.layout.objectRoot(
    ownerOf(row, handle),
    row.schemaId as PortableSchemaId,
    row.slug,
  );
  await context.layout.assertReal(root);
  return root;
}

/**
 * Where an object's assets live, and the guard that they are that object's.
 *
 * `basename` is applied to the ref, so a manifest row saying
 * `../../../etc/passwd` resolves to `passwd` inside this object's own assets
 * and finds nothing: a hand-edited file produces *not found* rather than an
 * exception from a path resolver.
 *
 * ***And the path is checked where it lands, not only as it is spelled***
 * (2026-09-27). Every string here stays inside the object's folder, and the
 * folder can still send it elsewhere: `assets` as a link to another account's
 * library, or to the data root that holds `accounts.json`. Nothing checked
 * the real path, so a read followed the link and served what was there, a
 * store wrote there, and a sweep deleted there. `resolveAssetPath` is
 * [03 §5.3]'s rule, rooted at the object folder, and it had no callers.
 * Rooted at the object and not at `assets`, because a check rooted at a link
 * resolves the root through the link too, and then everything is inside it.
 * An escape is a `PathEscapeError`, which the routes answer `422`.
 */
async function assetFile(
  context: LibraryContext,
  handle: string,
  row: ObjectRow,
  ref: string,
): Promise<string> {
  return resolveAssetPath(await objectFolder(context, handle, row), `${ASSETS}/${basename(ref)}`);
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
  // A ref that names no file at all is a disagreement too, and not a read of
  // the `assets` folder itself.
  if (['', '.', '..'].includes(basename(ref))) return null;
  return readFileBytes(await assetFile(context, handle, row, ref));
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

  // Written again when it is already there, which is also what renews an
  // upload's grace in the sweep below.
  const target = await assetFile(context, handle, row, ref);
  await ensureDirectory(dirname(target));
  await writeFileBytes(target, bytes);

  return { ref, digest, bytes: bytes.length, mime };
}

/**
 * Deletes every asset file nothing will ask for again.
 *
 * ***Called after a save, and never before one.*** The manifest on disk is the
 * only thing that says which bytes are wanted, so sweeping against a draft would
 * delete the picture somebody had just added and not yet saved — which is the
 * failure this function most wants to avoid, because it is silent and it is
 * somebody's file.
 *
 * ***Wanted means named by the object or by any version of it*** (2026-09-27).
 * This read the current body alone, and history keeps JSON and never pixels
 * ([03 §11.2]). So removing a map and saving deleted the map, and restoring the
 * version before brought back a row naming bytes that were gone for good:
 * *going back never destroys what you were on*, broken by the housekeeping
 * behind it. A file is kept while any surviving version names it, and
 * collected by the first save after pruning drops the last one, which is
 * [03 §11.3]'s rule applied to the bytes. A version whose payload is missing
 * cannot be restored, so it needs nothing kept. History is read only when
 * there is something to delete, which is not the common save.
 *
 * With {@link SWEEP_GRACE_MS} and {@link STORED_NAME} above, and the real-path
 * check on the folder, a file is deleted only when this build wrote it, nobody
 * has saved it into any version, and it is a day old.
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

    const objectRoot = await objectFolder(context, handle, row);
    // Throws when `assets` resolves outside the object, and a sweep that
    // throws deletes nothing.
    const root = await resolveAssetPath(objectRoot, ASSETS);

    const wanted = new Set(mediaRowsIn(row.body).map((one) => basename(one.ref)));
    const cutoff = Date.now() - SWEEP_GRACE_MS;
    const candidates: string[] = [];
    for (const name of await listEntryNames(root)) {
      if (wanted.has(name) || !STORED_NAME.test(name)) continue;
      const facts = await statFile(join(root, name));
      if (facts === null || facts.mtimeMs > cutoff) continue;
      candidates.push(name);
    }
    if (candidates.length === 0) return 0;

    const digests = new Set((await listVersions(objectRoot)).map((version) => version.digest));
    for (const digest of digests) {
      const payload = await readVersionPayload(objectRoot, digest);
      if (payload === null) continue;
      for (const one of mediaRowsIn(payload)) wanted.add(basename(one.ref));
    }

    let removed = 0;
    for (const name of candidates) {
      if (wanted.has(name)) continue;
      await unlinkFile(join(root, name));
      removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}
