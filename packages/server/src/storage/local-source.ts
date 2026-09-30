// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * A real directory, read as an import source
 * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)).
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
  /**
   * The file's real, absolute path on this machine, or null —
   * [P13 §1.3](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * Required here and optional on the importer's `FileSource`, because this is
   * the one source that has a disk under it. See `DirectorySource.realPath`.
   */
  realPath(path: string): Promise<string | null>;
}

/**
 * Opens a directory as a source, or refuses it.
 *
 * **`/data` is carved out, in code, and this is the line that makes
 * [10 §4.2.2]'s widening safe.** `fileAccess` was a permission over the user's
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
   * disclosed in the review. [10 §4.2] marks that reach `never`.
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

/**
 * The folder above `root`, opened exactly the way {@link openLocalSource} opens
 * `root`.
 *
 * **Why the importer cannot do this itself.** A near miss wants to ask *is the
 * folder above this one a SillyTavern library* — the case where somebody picked
 * `characters/`. A `FileSource` cannot answer it: the contract says an
 * implementation refuses paths that leave the root, `DirectorySource` does
 * refuse them, and that is the containment working rather than an obstacle to
 * route around. So the second source is opened here, where `node:path` and the
 * carve-out already live, and handed in.
 *
 * **`null` rather than a refusal**, deliberately. Every reason to decline — a
 * relative path, a filesystem root with no parent above it, an unreadable
 * parent, a parent at or below our own data directory — means *no ascending
 * advice*, which is not a thing a person needs to be told. Giving it a
 * `RootRefusal` member would also break `refusalMessage`'s exhaustive switch and
 * demand a sentence nobody would ever read.
 *
 * Nothing is restated: the `realpath`, the directory check and the `/data`
 * carve-out are all inherited by calling back through `openLocalSource`, so a
 * parent inside the data directory is refused by the same line that refuses a
 * root inside it. That is the point of routing it here rather than duplicating
 * three checks that would then have to stay in step.
 */
export async function openParentSource(
  root: string,
  dataRoot: string,
  limits: LocalSourceLimits = DEFAULT_LOCAL_LIMITS,
): Promise<LocalSource | null> {
  if (!isAbsolute(root)) return null;

  let real: string;
  try {
    real = await realpath(root);
  } catch {
    return null;
  }

  // `dirname` of a filesystem root is itself, on both platforms. Without this
  // the sweep of `C:\` or `/` would probe its own root a second time and could
  // answer that the folder above it is the folder itself.
  const above = dirname(real);
  if (above === real) return null;

  const opened = await openLocalSource(above, dataRoot, limits);
  return opened.ok ? opened.source : null;
}

/**
 * A suggestion made absolute against **the directory the probes actually read**.
 *
 * **Anchored on the real path, not on the string the caller sent**, and the
 * difference is a defect this had before an adversarial review found it. Both
 * sources are rooted at `realpath(root)` — {@link openLocalSource} resolves
 * before constructing, and {@link openParentSource} takes `dirname` of the same
 * resolved path — so every mark behind a finding was observed relative to the
 * real path. Resolving the suggestion against the unresolved string instead made
 * the two agree only when no symlink was involved.
 *
 * Reproduced before fixing: with `decoy/st-characters` a link to a real
 * library's `characters/`, the parent probed was the library's user directory
 * and the path handed back was `decoy/` — so a finding marked `verified`, whose
 * contract says the classifier would agree, named a folder that classifies as
 * `loose-files`. Following it swept an unrelated directory. Descending
 * suggestions were unaffected, because re-opening them resolves the same link
 * again; the ascending forms are where the two bases diverge.
 *
 * **No safety property rides on this**, and that was true before and stays true:
 * the retry goes back through `openLocalSource`, which re-runs `realpath` and
 * the carve-out on whatever it is handed. What rides on it is the *honesty* of
 * `confidence: 'verified'`, which is a claim about a specific folder.
 *
 * An unresolvable root keeps the string as given — there is nothing better to
 * say, and the retry will fail the same way the original did.
 */
export async function suggestedRoot(root: string, suggestion: string): Promise<string> {
  let anchor = root;
  try {
    anchor = await realpath(root);
  } catch {
    // Nothing there to resolve. `resolve` still normalises the `..` forms.
  }
  return resolve(anchor, suggestion);
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
    const full = await this.#reach(path);
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
    return (await this.#reach(path)) !== null;
  }

  /**
   * ***Where a file really is, for a reader that has to hand it to something
   * that is not us*** — [P13 §1.3](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * The Aventuras reader hands its database to SQLite, which opens a path and
   * not a byte array, and it has to: `VACUUM INTO` from the real file is the
   * only way to copy a database somebody else is writing without tearing it,
   * and the only way to take one past `maxFileBytes` without holding it in
   * memory ([§1.11]). So this is the one method here with **no size ceiling**,
   * and that is the reason it exists rather than an oversight in it.
   *
   * Every refusal `read` makes — which is `#reach`'s, links followed and
   * their targets checked — and one more: **a regular file
   * or nothing.** The only caller wants a database, and a directory or a
   * device handed to SQLite as one is a refusal waiting to be made in a worse
   * place.
   */
  async realPath(path: string): Promise<string | null> {
    const real = await this.#reach(path);
    if (real === null) return null;
    try {
      return (await stat(real)).isFile() ? real : null;
    } catch {
      return null;
    }
  }

  /**
   * ***Where a path really leads, or null***: every refusal `#resolve` makes,
   * and then the same two again on the target — for `read`, `exists` and
   * `realPath` alike.
   *
   * `#resolve` is lexical: it refuses `..` and a name spelled into our data
   * directory, and it cannot see that `link/accounts.json` is a symbolic link
   * to somewhere else. So the path is resolved through its links, and a target
   * outside the root — or inside our own store, however it was reached — is
   * refused exactly as a spelled one is. A link that stays inside the root is
   * allowed, since it names nothing the root did not already reach.
   *
   * ***`read` and `exists` went without this until P13.1's review***
   * (2026-09-29), which reproduced `read('link/accounts.json')`, with `link`
   * pointing at the data directory, returning our accounts file, and a link
   * to a file outside the root returning that file. The walk not following
   * links was the whole of the defence, and a path does not have to come from
   * the walk: the readers build their own — a Marinara manifest's table, a
   * card's portrait — and `FileSource`'s contract promised links that leave
   * are refused. `realPath` was written with the check, because a path it
   * gives away is followed by something that is not us; the same review
   * found the reader's documented fallback from a refused `realPath` to
   * `read` handing over our operational store, which is why the check now
   * lives here, once, for all three.
   */
  async #reach(path: string): Promise<string | null> {
    const full = this.#resolve(path);
    if (full === null) return null;
    let real: string;
    try {
      real = await realpath(full);
    } catch {
      return null;
    }
    if (!contains(this.#root, real)) return null;
    return this.#isOurs(real) ? null : real;
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
