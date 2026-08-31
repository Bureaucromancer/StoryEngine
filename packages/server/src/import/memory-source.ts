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
 */
export class MemoryFileSource implements FileSource {
  readonly #files: Map<string, Uint8Array>;

  constructor(files: Record<string, Uint8Array | string>) {
    this.#files = new Map(
      Object.entries(files).map(([path, value]) => [
        normalise(path),
        typeof value === 'string' ? new TextEncoder().encode(value) : value,
      ]),
    );
  }

  // The interface is async because a directory walk and a zip read both are;
  // this one holds its bytes already and has nothing to wait for. Making the
  // interface synchronous to suit the simplest implementation would be the tail
  // wagging the dog.
  // eslint-disable-next-line @typescript-eslint/require-await
  async *list(): AsyncIterable<string> {
    for (const path of this.#files.keys()) {
      yield path;
    }
  }

  read(path: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.#files.get(normalise(path)) ?? null);
  }

  exists(path: string): Promise<boolean> {
    const target = normalise(path);
    if (this.#files.has(target)) return Promise.resolve(true);
    const prefix = `${target}/`;
    for (const held of this.#files.keys()) {
      if (held.startsWith(prefix)) return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}

/** Leading `./` and `/` are noise; a path is relative or it is not a path here. */
function normalise(path: string): string {
  return path.replace(/^\.?\//, '');
}
