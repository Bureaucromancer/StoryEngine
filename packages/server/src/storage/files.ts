// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { constants, createReadStream } from 'node:fs';
import {
  access,
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';

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
 * ([10 §4.2](../../../../docs/design/10-ui-surfaces.md)) grows teeth, and no second opinion
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
 * append-only turn segment ([03 §5.5](../../../../docs/design/03-data-model.md))
 * is never rewritten, and routing an append through temp-then-rename would copy
 * the whole segment on every turn — turning an O(1) write into O(n) and
 * throwing away the immutability the format is built on. A torn append costs
 * the last line of one segment, which is the bounded loss that trade buys.
 */
export async function appendLine(path: string, line: string): Promise<void> {
  await ensureDirectory(dirname(path));
  await appendFile(path, line, 'utf8');
}

/**
 * Writes bytes, replacing whatever was there — [P9.2].
 *
 * **Not atomic, and for a different reason than `appendLine`'s.** That one
 * declines the temp-then-rename dance because it would turn an O(1) append into
 * an O(n) copy; this one declines it because the file is
 * [03 §5.5](../../../../docs/design/03-data-model.md)'s *"one directory here
 * whose contents are **deliberately disposable**"*. A torn rendition asset is a
 * picture that fails to decode, which is the state an evicted one is already in
 * and which the record's recipe answers: the placeholder renders, the retry
 * runs, and nothing irreplaceable was involved.
 *
 * *The path is already resolved by the caller*, per this module's standing rule:
 * containment is `resolveWithin`'s job and re-checking it here would be a second
 * answer to a question already answered.
 */
export async function writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
  await ensureDirectory(dirname(path));
  await writeFile(path, bytes);
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
 * A directory this process can write into, or the reason it cannot.
 *
 * **Alpha 1's first install found the shape of this failure**
 * ([P6A §3](../../../../docs/design/workplan/19-p6a-alpha-1.md) step 11): Docker
 * creates a missing bind-mount source as root, the container runs as uid 1000,
 * and the first write — `mkdir /data/state`, from the stamp — died as an
 * `EACCES` stack trace with the fix nowhere in it. `mkdir -p` alone is not the
 * check, because it returns quietly on a directory that exists and cannot be
 * written; the `access` after it is what asks the question.
 *
 * Errors are thrown as the filesystem raised them, `code` and all, so that
 * {@link describeUnusableDataDirectory} can say which of two different things
 * went wrong — a path that cannot be made, or one that cannot be written.
 */
export async function ensureWritableDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await access(path, constants.W_OK);
}

/** Who this process runs as, where the platform can say — undefined on Windows. */
export interface ProcessIdentity {
  uid: number | undefined;
  gid: number | undefined;
}

/**
 * The one line an operator reads when the data directory cannot be used.
 *
 * Two shapes, because they have two fixes. A permission error names the user
 * this process runs as and the `chown` that gives it the directory — the
 * container case, where the answer is on the host and not in the image.
 * Anything else names the path and the code and leaves the guessing to the
 * person, who can see the disk and this process cannot.
 */
export function describeUnusableDataDirectory(
  error: unknown,
  dataRoot: string,
  identity: ProcessIdentity,
): string {
  const { code, syscall, path } = (error ?? {}) as NodeJS.ErrnoException;
  const what = `${code ?? 'error'} on ${syscall ?? 'access'} ${path ?? dataRoot}`;
  if (code === 'EACCES' || code === 'EPERM') {
    const user = identity.uid === undefined ? 'this process' : `uid ${String(identity.uid)}`;
    const owner =
      identity.uid === undefined
        ? '<uid>:<gid>'
        : `${String(identity.uid)}:${String(identity.gid ?? identity.uid)}`;
    return (
      `The data directory ${dataRoot} is not writable by ${user}: ${what}.\n` +
      `If it is a bind-mounted host directory, make it writable by that user — on the host, once: ` +
      `chown -R ${owner} <directory> — then start again. See docs/deploy.md, "The volume".`
    );
  }
  return (
    `The data directory ${dataRoot} cannot be created or written: ${what}.\n` +
    'Check the path: --data, SE_DATA_DIR, or dataDir in config.json.'
  );
}

/**
 * Removes a directory and everything under it.
 *
 * Used for deleting an object, which is a *folder* rather than a file — the
 * card plus its assets travel together ([03 §5.2](../../../../docs/design/03-data-model.md)).
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
 * Deletion is a move ([03 §10.2](../../../../docs/design/03-data-model.md)): `remove()`
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

/** A file found by {@link listTreeFiles}: its portable path, and its size now. */
export interface TreeFile {
  /** Relative to the root, `/`-separated whatever the platform stored. */
  name: string;
  size: number;
}

/**
 * Every file under a root, with its size, sorted, minus what `skip` refuses —
 * [P12.2](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***`skip` is asked about directories too, before the descent***, which is
 * both halves of what a backup needs from a walk. `index/` costs one comparison
 * rather than a traversal, and a rule can say *where* as well as *what* — the
 * distinction `tools/backup.mjs` could not make when its exclusion was a
 * filename test, which is how the derived index ended up in every archive it
 * ever wrote.
 *
 * ***Sorted, because `readdir` order is a fact about a filesystem*** rather than
 * about the tree — `pack-tarball.mjs` learned this for the release artifact and
 * the reasoning is the same here: two backups of an unchanged directory should
 * differ in their timestamps and nowhere else.
 *
 * **The size comes back with the name** because the caller needs it twice — once
 * to declare the member's length in a tar header, and once, summed, to say how
 * much disk a restore will need before it commits. Two walks would be two
 * answers.
 */
export async function listTreeFiles(
  root: string,
  skip: (name: string) => boolean = () => false,
  at = '',
): Promise<TreeFile[]> {
  let entries;
  try {
    entries = await readdir(at === '' ? root : join(root, at), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const found: TreeFile[] = [];
  for (const entry of entries) {
    const name = at === '' ? entry.name : `${at}/${entry.name}`;
    if (skip(name)) continue;
    if (entry.isDirectory()) {
      found.push(...(await listTreeFiles(root, skip, name)));
    } else if (entry.isFile()) {
      /**
       * ***A symbolic link is not a file and is deliberately not followed.***
       * `isFile()` is false for one, so a link inside a library is left out of
       * the archive rather than dereferenced into a copy of something outside
       * it — the same position `LibraryWatcher` takes with `followSymlinks:
       * false`, and for the same reason: a link is a second path to content the
       * containment rules were never asked about.
       */
      const facts = await statFile(at === '' ? join(root, entry.name) : join(root, at, entry.name));
      if (facts !== null) found.push({ name, size: facts.size });
    }
  }
  return found.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
}

/**
 * A file as a stream, for a response that must not buffer it —
 * [P12.3](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***The first thing in this build that streams a file body out.*** The four
 * existing `content-disposition` routes all `.send()` an object they already
 * hold, because a session export or a card is a document. An archive is not
 * bounded by anything, and a download that read one into memory first would
 * make the server's footprint a function of the largest backup anybody takes.
 *
 * **A `Readable` rather than bytes**, and the caller hands it to Fastify — which
 * is the one thing in this file that returns something lazy, so it is the one
 * thing here whose failure arrives *after* it returns. A missing file throws on
 * the stream rather than here, and the route treats that as the 404 it is by
 * checking the archive exists first.
 */
export function openFileRead(path: string): Readable {
  return createReadStream(path);
}

/**
 * How many bytes the filesystem holding `path` will still take —
 * [P12.11](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***For the one check that has to happen before the process exits.*** A
 * restore unpacks an archive on the **next** boot, so a refusal for lack of
 * room after the drain is a refusal nobody can read — and a restore that fills
 * the disk half way through is the failure this whole feature exists to
 * prevent, arriving from the feature itself.
 *
 * `bavail` rather than `bfree`, which is the difference between *free* and
 * *free to this process*: a filesystem reserves blocks for root, and counting
 * them would let this promise room a restore cannot have.
 *
 * **Null when the answer is not available.** `statfs` is missing on some
 * filesystems and platforms, and a caller that cannot learn the free space has
 * to decide what to do about that rather than be handed a zero it would read as
 * *no room*.
 */
export async function freeBytes(path: string): Promise<number | null> {
  try {
    const facts = await statfs(path);
    return facts.bsize * facts.bavail;
  } catch {
    return null;
  }
}
