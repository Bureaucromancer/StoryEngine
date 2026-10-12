// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ScratchSpace } from '../storage/import-scratch.js';
import type { Layout } from '../storage/layout.js';
import { landEntryWithLog, ZipFile, type ZipFileLimits } from '../storage/zip-file.js';
import type { ZipEntry, ZipRefusal } from '../storage/zip.js';

import { duplicatesOf, scope } from './memory-source.js';
import type { FileSource, LandedFile } from './source.js';

/**
 * ***An upload that was landed on disk, read as a root*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * [P4 §1.3]'s rule once more — *an archive is a root read through a different
 * file source* — for the two things `POST /import/file` now streams to scratch
 * rather than holding in memory: an archive, and a bare SQLite database. Every
 * reader downstream is the one it was; none of them learns the bytes are on
 * disk, except the Aventuras reader through `FileSource.land`, which is the
 * one that needs a file SQLite can open.
 *
 * **Neither owns the landing.** The route opened the scratch space the upload
 * was written into and disposes of it when the sweep is over, whatever
 * happened in between; these read it while it is there.
 */

/**
 * ***An archive on disk*** — `ZipFileSource`'s answer for a file that was
 * never in memory. Entries are read on demand through `storage/zip-file.ts`,
 * under its split limits; `land` inflates one entry, and its log, to a
 * scratch space of its own and hands it over.
 */
export class LandedZipSource implements FileSource {
  readonly #zip: ZipFile;
  readonly #entries: Map<string, ZipEntry>;
  /** Names more than one member carries — `FileSource.duplicateNames`. */
  readonly #duplicates: readonly string[];
  readonly #layout: Layout;
  readonly #freeBytes: ((path: string) => Promise<number | null>) | undefined;

  private constructor(
    zip: ZipFile,
    layout: Layout,
    freeBytes: ((path: string) => Promise<number | null>) | undefined,
  ) {
    this.#zip = zip;
    this.#entries = new Map(zip.entries.map((entry) => [entry.name, entry]));
    this.#duplicates = duplicatesOf(zip.entries);
    this.#layout = layout;
    this.#freeBytes = freeBytes;
  }

  /**
   * Opens the archive at `path`, or refuses it before anything is inflated —
   * `ZipFileSource.open`'s contract, from disk. `layout` is where `land`
   * takes its scratch, and `freeBytes` the services' seam that room is asked
   * of, so a test can answer *full* for this copy as for every other.
   */
  static async open(
    path: string,
    options: {
      layout: Layout;
      limits: ZipFileLimits;
      freeBytes?: (path: string) => Promise<number | null>;
    },
  ): Promise<{ ok: true; source: LandedZipSource } | { ok: false; refusal: ZipRefusal }> {
    const opened = await ZipFile.open(path, options.limits);
    if (!opened.ok) return opened;
    return {
      ok: true,
      source: new LandedZipSource(opened.zip, options.layout, options.freeBytes),
    };
  }

  // The directory is read already; async only because the interface is.
  //
  // ***Scoped by `under`, as `ZipFileSource` is*** (2026-10-02). Written
  // against the one-argument contract while [P4 §7.18] was widening it on
  // another branch, and TypeScript accepts a method with fewer parameters, so
  // the merge left this — the source every zip sent to `POST /import/file` is
  // swept through since P13.8 — yielding the whole archive whatever it was
  // asked for. The Marinara store lists one table's directory per table, so it
  // walked every entry once per table, and counted `lorebooks/images/…` as a
  // file of the `lorebooks` table: the same store laid out differently by
  // transport, which the structural gate would read as a changed layout.
  // eslint-disable-next-line @typescript-eslint/require-await
  async *list(under?: string): AsyncIterable<string> {
    const within = scope(under);
    for (const name of this.#entries.keys()) if (within(name)) yield name;
  }

  read(path: string): Promise<Uint8Array | null> {
    const entry = this.#entries.get(path);
    return entry === undefined ? Promise.resolve(null) : this.#zip.read(entry);
  }

  /** Directories implied by the paths, exactly as `ZipFileSource` answers. */
  exists(path: string): Promise<boolean> {
    if (this.#entries.has(path)) return Promise.resolve(true);
    const prefix = `${path}/`;
    for (const name of this.#entries.keys()) {
      if (name.startsWith(prefix)) return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  land(path: string): Promise<LandedFile | null> {
    return landEntryWithLog(this.#zip, path, {
      layout: this.#layout,
      ...(this.#freeBytes === undefined ? {} : { freeBytes: this.#freeBytes }),
    });
  }

  /** Names more than one member carries — the last is what `read` answers with. */
  duplicateNames(): readonly string[] {
    return this.#duplicates;
  }

  /** Lets go of the archive's file handle. The route calls it; safe twice. */
  close(): Promise<void> {
    return this.#zip.close();
  }
}

/**
 * ***A bare database, landed*** — one file, already in scratch, under the name
 * the probe looks for (`aventura.db`, [§1.1]'s
 * `MemoryFileSource({ 'aventura.db': bytes })` without the bytes in memory).
 *
 * **`read` holds nothing**, and says so with `null`: the file is as large as
 * somebody's install, and the one reader that opens it asks `land`, which
 * hands over the landing itself — once. A second `land` is `null`, because
 * the space is no longer this source's to give.
 */
export class LandedDatabaseSource implements FileSource {
  readonly #name: string;
  #space: ScratchSpace | null;

  constructor(space: ScratchSpace, name: string) {
    this.#space = space;
    this.#name = name;
  }

  // One file, and a file is not a directory: scoped to anything, it is
  // nothing, which is the contract's "a prefix naming a file yields nothing".
  // eslint-disable-next-line @typescript-eslint/require-await
  async *list(under?: string): AsyncIterable<string> {
    if (scope(under)(this.#name)) yield this.#name;
  }

  read(): Promise<Uint8Array | null> {
    return Promise.resolve(null);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(path === this.#name);
  }

  land(path: string): Promise<LandedFile | null> {
    const space = this.#space;
    if (path !== this.#name || space === null) return Promise.resolve(null);
    this.#space = null;
    return Promise.resolve({ space, name: this.#name });
  }
}
