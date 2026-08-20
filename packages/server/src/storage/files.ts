// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { appendFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The read side of the storage layer.
 *
 * `atomic.ts` owns writes; this owns everything else that touches the disk, and
 * between them they are the only `fs` in the server. That is the no-direct-`fs`
 * rule from P1.0 doing its job rather than being worked around: the index needs
 * to read files, and the answer to *"may it import `node:fs`?"* is no — it asks
 * here.
 *
 * The veneer is thin on purpose. These are not clever, and the point is not
 * abstraction: it is that there is exactly one directory to audit, one place to
 * add a permission check when `fileAccess`
 * ([05 §4.2](../../../../docs/design/05-ui-surfaces.md)) grows teeth, and no second opinion
 * about what "read a file" means.
 *
 * **Paths arriving here are already resolved** by `paths.ts`. Nothing in this
 * file re-checks containment, and that is deliberate — a second, differently
 * shaped check would invite callers to skip the first one, and two resolvers is
 * how a project ends up with one that is wrong.
 */

export interface FileFacts {
  mtimeMs: number;
  size: number;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Bytes, or null if the file is not there. */
export async function readFileBytes(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * Size and mtime, or null if the file is not there.
 *
 * Absence is a return value rather than an exception because it is the normal
 * case for both callers: the watcher is routinely handed a path that has
 * already been deleted again, and the index checks whether a row's file still
 * exists precisely when it expects that it might not.
 */
export async function statFile(path: string): Promise<FileFacts | null> {
  try {
    const info = await stat(path);
    return { mtimeMs: info.mtimeMs, size: info.size };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * Appends a line to a file, creating it if it is not there.
 *
 * The one write in this package that is deliberately **not** atomic. An
 * append-only turn segment ([02 §5.5](../../../../docs/design/02-data-model.md))
 * is never rewritten, and routing an append through temp-then-rename would copy
 * the whole segment on every turn — turning an O(1) write into O(n) and
 * throwing away the immutability the format is built on. A torn append costs
 * the last line of one segment, which is the bounded loss that trade buys.
 */
export async function appendLine(path: string, line: string): Promise<void> {
  await ensureDirectory(dirname(path));
  await appendFile(path, line, 'utf8');
}

export async function fileExists(path: string): Promise<boolean> {
  return (await statFile(path)) !== null;
}

/** Directory names within `path`, or none if it does not exist yet. */
export async function listDirectoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** Every entry name within `path`, directories included. */
export async function listEntryNames(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * Removes a directory and everything under it.
 *
 * Used for deleting an object, which is a *folder* rather than a file — the
 * card plus its assets travel together ([02 §5.2](../../../../docs/design/02-data-model.md)).
 * Recursive deletion is the one operation here worth being nervous about, which
 * is why it takes a path that has already been through the resolver and why it
 * lives beside the rest of the filesystem access rather than at a call site.
 */
export async function removeTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/**
 * Removes a single file, if it is there.
 *
 * A sibling of {@link removeTree} rather than the same function, even though
 * `rm` would take either: the two have different blast radii, and a call site
 * that says *tree* while meaning *file* is one refactor away from meaning what
 * it says. A connection is one file ([P2B §2.3]) — unlike a library object,
 * which is a folder.
 *
 * **`unlinkFile`, not `removeFile`**, because `index-db/ingest.ts` already
 * exports a `removeFile` that removes an index *row*. Two exports named the same
 * thing for a filesystem operation and a database one is the ambiguity the
 * package index refuses to re-export, and it would read as the same act at every
 * call site.
 *
 * `force`, so removing something already gone is not an error. A delete whose
 * file has been removed by hand has achieved what it was asked to.
 */
export async function unlinkFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

/**
 * Moves a directory, creating the destination's parent.
 *
 * Deletion is a move ([02 §10.2](../../../../docs/design/02-data-model.md)): `remove()`
 * sends object folders to the user's trash through this rather than erasing
 * them, history and all. Both ends live under one data directory, so the
 * rename is same-volume by construction; a cross-volume symlink or a handle
 * held on the folder (a scanner, an open explorer window) surfaces as a loud
 * error with the source intact — the right failure mode for a deletion path.
 */
export async function moveTree(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
}
