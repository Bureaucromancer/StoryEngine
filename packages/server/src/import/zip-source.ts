// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import {
  DEFAULT_ZIP_LIMITS,
  readZipDirectory,
  readZipEntry,
  type ZipEntry,
  type ZipLimits,
  type ZipRefusal,
} from '../storage/zip.js';

import type { FileSource } from './source.js';

/**
 * An archive, read as a source
 * ([P4 §1.3](../../../../docs/design/workplan/06-p4-implementation.md),
 * [§7.5](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **§1.3's claim, paid a second time.** That section said *an archive is a root
 * read through a different file source*, and the Marinara profile envelope
 * already showed it was true for tables held in memory. This is the literal
 * case, and it costs one class: a CHARX, a zipped Marinara data root and a zip
 * somebody made of their cards folder are all just roots now, classified by the
 * same probes and walked by the same readers, because none of them can tell how
 * the bytes arrived.
 *
 * Every entry is decompressed **on demand and not cached**. A sweep reads each
 * file once — the walker asks for a path, converts it, and moves on — so holding
 * the inflated bytes would multiply an archive's cost by nothing useful. The
 * central directory is parsed once, up front, which is where the bounds are
 * applied.
 */
export class ZipFileSource implements FileSource {
  readonly #bytes: Uint8Array;
  readonly #entries: Map<string, ZipEntry>;
  readonly #limits: ZipLimits;

  private constructor(bytes: Uint8Array, entries: readonly ZipEntry[], limits: ZipLimits) {
    this.#bytes = bytes;
    this.#limits = limits;
    this.#entries = new Map(entries.map((entry) => [entry.name, entry]));
  }

  /**
   * Opens an archive, or refuses it before anything is inflated.
   *
   * A refusal is the whole point of the return type being a union: [§1.3]'s rule
   * is that a root is rejected **before anything is written**, and an archive
   * this build will not read is exactly that case rather than a file that failed
   * mid-import.
   */
  static open(
    bytes: Uint8Array,
    limits: ZipLimits = DEFAULT_ZIP_LIMITS,
  ): { ok: true; source: ZipFileSource } | { ok: false; refusal: ZipRefusal } {
    const directory = readZipDirectory(bytes, limits);
    if (!directory.ok) return { ok: false, refusal: directory.refusal };
    return { ok: true, source: new ZipFileSource(bytes, directory.entries, limits) };
  }

  // Async to satisfy the interface, which a directory walk and a real archive
  // both need; this one has its directory already.
  // eslint-disable-next-line @typescript-eslint/require-await
  async *list(): AsyncIterable<string> {
    for (const name of this.#entries.keys()) yield name;
  }

  read(path: string): Promise<Uint8Array | null> {
    const entry = this.#entries.get(path);
    if (entry === undefined) return Promise.resolve(null);
    return Promise.resolve(readZipEntry(this.#bytes, entry, this.#limits));
  }

  /**
   * Directories are implied by the paths, exactly as `MemoryFileSource` does it
   * — and for the same reason the probes need: `exists('storage/tables')` has to
   * answer true for an archive of a Marinara root, where the only real entries
   * are the files under it.
   */
  exists(path: string): Promise<boolean> {
    if (this.#entries.has(path)) return Promise.resolve(true);
    const prefix = `${path}/`;
    for (const name of this.#entries.keys()) {
      if (name.startsWith(prefix)) return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}
