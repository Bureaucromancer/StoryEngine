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
  /**
   * Largest single file the sweep will pull into memory.
   *
   * **Added at [P4 §7.8], because that change made it reachable.** Until then a
   * walker only ever read files under directories it recognised — cards,
   * lorebooks, presets, all small. A loose root has no recognised directories,
   * so the content probe reads *whatever is there*, and "whatever is there" in a
   * folder somebody points at can be a disc image.
   *
   * Sixty-four megabytes is far above anything this format family produces — the
   * largest plausible card is a few megabytes of PNG — and far below the size at
   * which one `readFile` is a problem for the server everyone else is sharing.
   * A file past it is not read, and reads as unrecognised: honest, since we did
   * not look, and better than the alternative, since the alternative is the
   * process.
   */
  maxFileBytes: number;
}

export const DEFAULT_LOCAL_LIMITS: LocalSourceLimits = {
  maxFiles: 50_000,
  maxDepth: 12,
  maxFileBytes: 64 * 1024 * 1024,
};

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

  /**
   * **And the carve-out is enforced during the walk, not only at the root** —
   * repaired at the P4 audit ([P4 §7.2]), where it was found by an adversarial
   * review of the relabel that had just finished promising it.
   *
   * The check above refuses a root *at or below* the data directory. It said
   * nothing about a root *above* it, and the default layout makes that the
   * common case: `dataDir` defaults to `./data`, so the install directory is an
   * ancestor of the data directory on every ordinary deployment. Sweeping
   * `/opt/storyengine` was therefore accepted, and the walk enumerated
   * `data/accounts.json`, `data/system/connections/*.json` and
   * `data/users/<someone-else>/library/actors/<slug>/actor.json` — object slugs
   * being name-derived, so another person's character and lorebook names were
   * disclosed in the review. [05 §4.2] marks that reach `never`.
   *
   * Reproduced before fixing: an ancestor root opened `ok`, listed those paths,
   * and `read('data/accounts.json')` returned the file's bytes. The walker's
   * routing was the only thing that had been keeping contents unread, which is
   * one `switch` arm away from not being true either.
   *
   * Pruning rather than refusing an ancestor root, because refusing would break
   * the legitimate case that motivates the capability: a person whose data lives
   * at `/home/bob/storyengine/data` sweeping `/home/bob` to find SillyTavern.
   * They may sweep their home directory; they may not thereby read our store.
   */
  return { ok: true, source: new DirectorySource(real, realData, limits) };
}

/** Is `child` at or below `parent`? Path-segment aware, so `/data2` is not inside `/data`. */
function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

class DirectorySource implements LocalSource {
  readonly #root: string;
  /** Real path of our own data directory. Never entered, never read. */
  readonly #dataRoot: string;
  readonly #limits: LocalSourceLimits;

  constructor(root: string, dataRoot: string, limits: LocalSourceLimits) {
    this.#root = root;
    this.#dataRoot = dataRoot;
    this.#limits = limits;
  }

  /** Is this path our own data directory, or inside it? */
  #isOurs(full: string): boolean {
    return full === this.#dataRoot || contains(this.#dataRoot, full);
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

        // Our own store, pruned wherever it turns up beneath a foreign root.
        // Checked for files as well as directories: `dataDir` may name a path
        // that is not a directory on a broken install, and a rule that only
        // holds for one kind of entry is the kind that stops holding.
        if (this.#isOurs(full)) continue;

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
      // Asked before reading, not after: `readFile` on a very large file has
      // already spent the memory by the time you could check its length.
      const info = await stat(full);
      if (info.size > this.#limits.maxFileBytes) return null;
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

  /**
   * Refuses anything that would leave the root, however it is spelled — and
   * anything inside our own data directory, however it got named.
   *
   * The second half is not redundant with pruning the walk. `read` takes a path
   * from the caller, and the readers build paths of their own — a card's
   * portrait, a Marinara table named by a manifest — so a source path that was
   * never yielded by `list()` can still arrive here.
   */
  #resolve(path: string): string | null {
    const full = resolve(this.#root, path);
    if (!contains(this.#root, full)) return null;
    return this.#isOurs(full) ? null : full;
  }
}
