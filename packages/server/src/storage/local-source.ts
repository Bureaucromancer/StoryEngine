// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * A real directory, read as an import source
 * ([P4 §1.3](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **In `storage/` because that is where the filesystem lives.** The import
 * module cannot import `node:fs` — one audited path resolver is the only door —
 * so the transport belongs here and the engine takes the interface. That
 * boundary is why an uploaded batch, a zip and a local path cost a class each
 * rather than three sweep engines.
 *
 * The shape is deliberately not `Layout`'s. `Layout` resolves paths *inside* our
 * data directory and refuses everything else; this reads somebody else's tree,
 * which is the opposite job, and conflating them would be how the containment
 * rules that protect the library end up applied to a folder that is not ours —
 * or, far worse, relaxed so they can be.
 */

/** Why a root will not be read. Refused before anything is written. */
export type RootRefusal =
  /** Missing, unreadable, or not a directory. */
  | 'unreadable-root'
  /** Inside our own data directory — see {@link openLocalSource}. */
  | 'inside-data-root'
  /** A path that is not absolute. A relative sweep root means whatever the cwd is. */
  | 'not-absolute';

export interface LocalSourceLimits {
  /** Files, not bytes. A tree this large is a mistake rather than a library. */
  maxFiles: number;
  /** Deepest directory nesting to walk. */
  maxDepth: number;
}

export const DEFAULT_LOCAL_LIMITS: LocalSourceLimits = { maxFiles: 50_000, maxDepth: 12 };

export interface LocalSource {
  list(): AsyncIterable<string>;
  read(path: string): Promise<Uint8Array | null>;
  exists(path: string): Promise<boolean>;
}

/**
 * Opens a directory as a source, or refuses it.
 *
 * **`/data` is carved out, in code, and this is the line that makes
 * [05 §4.2.2]'s widening safe.** `fileAccess` was a permission over the user's
 * *own* content, scoped by a table of roots under their handle; P4 widened it to
 * cover naming a path for a read-only sweep. Without this refusal that widening
 * would be a route to `/data/users/<other>/library/` — which the table says
 * `never`, and which the 404-for-everything posture exists to prevent. The file
 * browser reaches the user's own content; the sweep reaches foreign apps; the
 * two do not overlap, and the gap is enforced rather than left to two rules
 * staying compatible.
 *
 * The comparison is on **real paths**, so a symlink into the data directory is
 * refused as well as a literal one.
 */
export async function openLocalSource(
  root: string,
  dataRoot: string,
  limits: LocalSourceLimits = DEFAULT_LOCAL_LIMITS,
): Promise<{ ok: true; source: LocalSource } | { ok: false; refusal: RootRefusal }> {
  if (!isAbsolute(root)) return { ok: false, refusal: 'not-absolute' };

  let real: string;
  try {
    real = await realpath(root);
    if (!(await stat(real)).isDirectory()) return { ok: false, refusal: 'unreadable-root' };
  } catch {
    return { ok: false, refusal: 'unreadable-root' };
  }

  let realData: string;
  try {
    realData = await realpath(dataRoot);
  } catch {
    realData = resolve(dataRoot);
  }

  if (contains(realData, real) || realData === real) {
    return { ok: false, refusal: 'inside-data-root' };
  }

  return { ok: true, source: new DirectorySource(real, limits) };
}

/** Is `child` at or below `parent`? Path-segment aware, so `/data2` is not inside `/data`. */
function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

class DirectorySource implements LocalSource {
  readonly #root: string;
  readonly #limits: LocalSourceLimits;

  constructor(root: string, limits: LocalSourceLimits) {
    this.#root = root;
    this.#limits = limits;
  }

  async *list(): AsyncIterable<string> {
    let seen = 0;
    const walk = async function* (
      this: DirectorySource,
      directory: string,
      depth: number,
    ): AsyncIterable<string> {
      if (depth > this.#limits.maxDepth) return;

      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        // One unreadable directory costs that directory. F22's original sin was
        // one bad folder aborting a whole scan; it is not repeated here.
        return;
      }

      for (const entry of entries) {
        if (seen >= this.#limits.maxFiles) return;
        const full = join(directory, entry.name);

        // **Symlinks are not followed.** A link out of the tree would let a
        // sweep read anywhere the process can, which is the one thing the
        // carve-out above exists to stop — and a link *within* it would make
        // the same file arrive twice.
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          yield* walk.call(this, full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        seen += 1;
        yield relative(this.#root, full).split(sep).join('/');
      }
    };

    yield* walk.call(this, this.#root, 0);
  }

  async read(path: string): Promise<Uint8Array | null> {
    const full = this.#resolve(path);
    if (full === null) return null;
    try {
      return new Uint8Array(await readFile(full));
    } catch {
      return null;
    }
  }

  async exists(path: string): Promise<boolean> {
    const full = this.#resolve(path);
    if (full === null) return false;
    try {
      await stat(full);
      return true;
    } catch {
      return false;
    }
  }

  /** Refuses anything that would leave the root, however it is spelled. */
  #resolve(path: string): string | null {
    const full = resolve(this.#root, path);
    return contains(this.#root, full) ? full : null;
  }
}
