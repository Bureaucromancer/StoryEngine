// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { FileSource } from './source.js';

/**
 * A {@link FileSource} over an in-memory map of path to bytes.
 *
 * **Not only a test double.** The uploaded-batch transport is this shape — many
 * files arriving with relative paths and no directory to walk — so the adapter
 * P4.4 needs for `webkitdirectory` uploads is this class with a different
 * constructor. Which is the seam paying for itself: a transport that does not
 * exist yet costs nothing to have already.
 *
 * Directories are implied by the paths rather than stored. `exists('storage/tables')`
 * is true when anything is under it, which is what a zip would answer too and
 * what detection actually means when it asks.
 *
 * **A path can be known without its bytes** ([P4 §7.13]). The browser directory
 * upload sends a manifest of everything the folder holds and then only the files
 * the reader will actually open — a SillyTavern tree is thirty directories and
 * most of them are chats and backups nobody is importing, so uploading all of it
 * to report that most was skipped would be absurd. Those paths are `declared`:
 * `list()` yields them and `exists()` finds them, so *nothing is silently
 * dropped* still holds — the review names them and says what they were — and
 * `read()` answers `null`, which is the same answer a genuinely unreadable file
 * gives, and is handled the same way.
 */
export class MemoryFileSource implements FileSource {
  readonly #files: Map<string, Uint8Array>;
  /** Paths that exist and carry no bytes. Disjoint from `#files` after the constructor. */
  readonly #declared: Set<string>;

  constructor(files: Record<string, Uint8Array | string>, declared: readonly string[] = []) {
    this.#files = new Map(
      Object.entries(files).map(([path, value]) => [
        normalise(path),
        typeof value === 'string' ? new TextEncoder().encode(value) : value,
      ]),
    );
    // A path that arrived both ways is a carried one: bytes beat a declaration,
    // so a caller listing everything and then uploading a subset needs no
    // filtering of its own to avoid hiding what it did send.
    this.#declared = new Set(declared.map(normalise).filter((path) => !this.#files.has(path)));
  }

  // The interface is async because a directory walk and a zip read both are;
  // this one holds its bytes already and has nothing to wait for. Making the
  // interface synchronous to suit the simplest implementation would be the tail
  // wagging the dog.
  // eslint-disable-next-line @typescript-eslint/require-await
  async *list(under?: string): AsyncIterable<string> {
    const within = scope(under);
    for (const path of this.#files.keys()) {
      if (within(path)) yield path;
    }
    // Declared paths are listed too, which is the whole point of declaring
    // them: a walker that never saw them could not report them, and a report
    // that omits what it did not carry is the silent drop this exists to avoid.
    for (const path of this.#declared) {
      if (within(path)) yield path;
    }
  }

  read(path: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.#files.get(normalise(path)) ?? null);
  }

  exists(path: string): Promise<boolean> {
    const target = normalise(path);
    if (this.#files.has(target) || this.#declared.has(target)) return Promise.resolve(true);
    const prefix = `${target}/`;
    for (const held of this.#files.keys()) {
      if (held.startsWith(prefix)) return Promise.resolve(true);
    }
    for (const held of this.#declared) {
      if (held.startsWith(prefix)) return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}

/** Leading `./` and `/` are noise; a path is relative or it is not a path here. */
function normalise(path: string): string {
  return path.replace(/^\.?\//, '');
}

/**
 * A predicate for `list(under)`: everything when unscoped, otherwise paths
 * strictly beneath the directory. Exported for `ZipFileSource`, whose entries
 * are implied directories the same way, so the two cannot disagree about what
 * "under" means — including that a prefix naming a file yields nothing.
 */
export function scope(under: string | undefined): (path: string) => boolean {
  if (under === undefined || under === '') return () => true;
  const prefix = `${normalise(under).replace(/\/+$/, '')}/`;
  return (path) => path.startsWith(prefix);
}
