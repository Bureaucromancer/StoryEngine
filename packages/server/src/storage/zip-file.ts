// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { open, type FileHandle } from 'node:fs/promises';
import { Readable, Transform, Writable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, inflateRawSync } from 'node:zlib';

import { freeBytes as diskFreeBytes } from './files.js';
import { openImportScratch, type ScratchSpace } from './import-scratch.js';
import type { Layout } from './layout.js';
import { SNAPSHOT_FREE_RESERVE_BYTES, SnapshotSpaceError } from './sqlite-snapshot.js';
import {
  entryDataStart,
  locateCentralDirectory,
  parseCentralDirectory,
  ZIP_STORED,
  ZIP_TAIL_BYTES,
  type ZipEntry,
  type ZipRefusal,
} from './zip.js';

/**
 * ***A zip archive read where it lies, on disk*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * `zip.ts` reads an archive that is already in memory, which was right while
 * every upload was: the multipart reader buffered the whole file, and 64 MB
 * was the most it would. [P13.8] lands an upload in scratch instead, because
 * an Aventuras backup is somebody's whole install with its pictures in it as
 * base64, and hundreds of megabytes is ordinary. Reading that back into the
 * heap to parse it would undo the landing, so this reads the file in pieces:
 * the tail, to find the central directory; the directory; and then each entry
 * as it is asked for.
 *
 * ***The parse is `zip.ts`'s, not a second one.*** Every refusal an archive
 * can earn — traversal, a bomb's declared sizes, zip64, a compression method
 * this does not implement — is made by {@link parseCentralDirectory} for both
 * readers. What differs is only where the bytes come from, and the limits.
 *
 * ***The limits are split***, which is the other half of [P13.8]'s second
 * point, and each of the three answers a different question:
 *
 * | Limit | Checked | Against |
 * |---|---|---|
 * | `maxEntryBytes` | at parse, per entry, from its declared size | one entry larger than anything we would inflate to disk |
 * | `maxReadBytes` | inside {@link ZipFile.read}, per entry | an entry read **into memory** — 64 MB, the same bound every `FileSource.read` has |
 * | `maxReadTotalBytes` | as bytes are inflated by `read` | the archive as a whole, in memory |
 *
 * **The total counts what was inflated, not what was declared.** The
 * in-memory reader sums declared sizes, and an old Aventuras backup would
 * fail that sum for no reason: it carries `stories/*.avt` beside the database,
 * each the size of a story, and the reader lists them and never reads one.
 * Counting what `read` actually produced is also the stronger bound: many
 * central entries may point at one local header, and each read of that one
 * stream is counted again, so the 4,096-entries-over-one-bomb archive
 * `zip.ts` records stops at the total however it declared itself.
 *
 * **What goes to disk is not counted there**, because it is not in memory:
 * {@link ZipFile.extract} inflates one entry to a file, bounded by the entry's
 * own declared size (checked at parse) and by the room on the disk, which its
 * caller checks first. That is the one `aventura.db` [P13.8] names, and why
 * the per-entry cap at parse time is not 64 MB here.
 *
 * *Not a CRC check*, as `zip.ts` is not: an entry that inflates to exactly the
 * size it declared is taken. What reads an extracted database is SQLite, after
 * a `quick_check` of it (`sqlite-snapshot.ts`), which finds a torn page where
 * a checksum would have found a torn stream.
 */

export interface ZipFileLimits {
  /** Entries in the central directory. */
  maxEntries: number;
  /** An entry's declared, uncompressed size, at parse time. */
  maxEntryBytes: number;
  /** One entry read into memory by {@link ZipFile.read}. */
  maxReadBytes: number;
  /** Everything {@link ZipFile.read} has inflated into memory, added up as it goes. */
  maxReadTotalBytes: number;
}

/**
 * `zip.ts`'s numbers where they still mean the same thing — 4,096 entries,
 * 64 MB into memory at once, 256 MB into memory in all — and, per entry at
 * parse, the most a zip without zip64 can declare, which is no cap at all:
 * the caller names the one it means ({@link ZipFile.open}'s `limits`), since
 * what an entry may inflate to on disk is a question about the upload that
 * brought it.
 */
export const DEFAULT_ZIP_FILE_LIMITS: ZipFileLimits = {
  maxEntries: 4096,
  maxEntryBytes: 0xfffffffe,
  maxReadBytes: 64 * 1024 * 1024,
  maxReadTotalBytes: 256 * 1024 * 1024,
};

/**
 * How large a central directory is read at all. A real one is kilobytes —
 * forty-six bytes and a name per entry — and 4,096 entries with the longest
 * names and extras the format allows would be far past this; an end record
 * that claims more is refused rather than believed into memory.
 *
 * *Exported since [P16.3c]'s review (2026-10-10)*: the zip writer holds the
 * bound too, so a World file is never one this reader refuses — and it is a
 * bound on names, which no count or size limit says.
 */
export const MAX_CENTRAL_BYTES = 16 * 1024 * 1024;

/** An archive on disk, open. {@link ZipFile.close} lets go of the handle. */
export class ZipFile {
  readonly #handle: FileHandle;
  readonly #length: number;
  readonly #limits: ZipFileLimits;
  readonly entries: readonly ZipEntry[];
  #readTotal = 0;

  private constructor(
    handle: FileHandle,
    length: number,
    entries: readonly ZipEntry[],
    limits: ZipFileLimits,
  ) {
    this.#handle = handle;
    this.#length = length;
    this.entries = entries;
    this.#limits = limits;
  }

  /**
   * Opens the archive at `path` and reads its directory, or refuses it having
   * inflated nothing — `zip.ts`'s refusals, and one of its own: ***a file with
   * no end record is `malformed` here, not `not-a-zip`***. Only a file that
   * began like an archive is opened this way (the route sniffs first), so one
   * with no end is an archive that was cut short — an upload that stopped, a
   * copy that did not finish — and `not-a-zip` would describe it wrongly.
   *
   * Throws only when the file cannot be opened or read, which is ours.
   */
  static async open(
    path: string,
    limits: ZipFileLimits = DEFAULT_ZIP_FILE_LIMITS,
  ): Promise<{ ok: true; zip: ZipFile } | { ok: false; refusal: ZipRefusal }> {
    const handle = await open(path, 'r');
    try {
      const length = (await handle.stat()).size;
      const tailStart = Math.max(0, length - ZIP_TAIL_BYTES);
      const tail = await readAt(handle, tailStart, length - tailStart);

      const located = locateCentralDirectory(tail, tailStart, length);
      if (!located.ok) {
        await handle.close();
        return {
          ok: false,
          refusal: located.refusal === 'not-a-zip' ? 'malformed' : located.refusal,
        };
      }
      if (located.count > limits.maxEntries || located.size > MAX_CENTRAL_BYTES) {
        await handle.close();
        return { ok: false, refusal: 'too-large' };
      }

      const central = await readAt(handle, located.offset, located.size);
      const directory = parseCentralDirectory(central, located.count, length, {
        maxEntryBytes: limits.maxEntryBytes,
        maxTotalBytes: null,
      });
      if (!directory.ok) {
        await handle.close();
        return directory;
      }
      return { ok: true, zip: new ZipFile(handle, length, directory.entries, limits) };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  /**
   * One entry's bytes, into memory, or `null` when it would not fit the
   * bounds or the archive lied about it — `readZipEntry`'s answer, with the
   * read limits of the table above.
   *
   * The ceiling on the inflate is the declared size, for `zip.ts`'s reason:
   * an entry inflates to what it said it would or is refused, so what is
   * counted toward the total is what was really produced.
   */
  async read(entry: ZipEntry): Promise<Uint8Array | null> {
    if (entry.uncompressedSize > this.#limits.maxReadBytes) return null;
    if (this.#readTotal + entry.uncompressedSize > this.#limits.maxReadTotalBytes) return null;

    const from = await this.#dataStart(entry);
    if (from === null || from + entry.compressedSize > this.#length) return null;
    const body = await readAt(this.#handle, from, entry.compressedSize);

    let out: Uint8Array;
    if (entry.compression === ZIP_STORED) {
      if (body.length !== entry.uncompressedSize) return null;
      out = body;
    } else {
      try {
        const inflated = inflateRawSync(body, {
          maxOutputLength: Math.max(1, entry.uncompressedSize),
        });
        if (inflated.byteLength !== entry.uncompressedSize) return null;
        out = new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
      } catch {
        return null;
      }
    }
    this.#readTotal += out.byteLength;
    return out;
  }

  /**
   * ***One entry inflated to a file, never through memory whole*** — the
   * `aventura.db` of an uploaded backup, which [P13.8] lands in scratch so
   * SQLite can open it.
   *
   * The compressed bytes are streamed from the archive through `inflateRaw`
   * into `target`, a megabyte or so at a time, and **counted as they come
   * out**: past the entry's declared size is refused at once, rather than
   * after the disk has taken whatever a crafted stream would inflate to, and
   * short of it is refused at the end. `target` is created `wx` — it is in a
   * scratch space of its own — and on a refusal what was written is left for
   * the caller to dispose of with the space.
   *
   * Answers `'extracted'`, or `'malformed'` when the entry was not what the
   * directory said. Throws for a failure of ours: the disk under `target`,
   * above all `ENOSPC`, which the routes answer `507`.
   */
  async extract(entry: ZipEntry, target: string): Promise<'extracted' | 'malformed'> {
    const from = await this.#dataStart(entry);
    if (from === null || from + entry.compressedSize > this.#length) return 'malformed';

    const out = await open(target, 'wx');
    try {
      if (entry.compressedSize === 0) {
        return entry.uncompressedSize === 0 ? 'extracted' : 'malformed';
      }
      /**
       * *Both ends driven through handles this code holds*, rather than a
       * handle's own `createReadStream` and `createWriteStream`: with
       * `autoClose` off — which it must be, since the archive's handle serves
       * every later read and the target's is closed below — those streams
       * never emit `close`, and `pipeline` waits for it. Measured: forever.
       */
      const source = Readable.from(chunksOf(this.#handle, from, entry.compressedSize));
      const bound = new Bounded(entry.uncompressedSize);
      const sink = new Writable({
        write(chunk: Buffer, _encoding, done) {
          writeAll(out, chunk).then(() => {
            done();
          }, done);
        },
      });
      try {
        if (entry.compression === ZIP_STORED) await pipeline(source, bound, sink);
        else await pipeline(source, createInflateRaw(), bound, sink);
      } catch (error) {
        // Ours when it came from the write; the archive's otherwise — a
        // deflate stream that does not parse, or one past its declared size.
        if (isOurs(error)) throw error;
        return 'malformed';
      }
      return bound.seen === entry.uncompressedSize ? 'extracted' : 'malformed';
    } finally {
      await out.close();
    }
  }

  /** Lets go of the file. Safe to call twice. */
  async close(): Promise<void> {
    await this.#handle.close().catch(() => undefined);
  }

  async #dataStart(entry: ZipEntry): Promise<number | null> {
    if (entry.offset + 30 > this.#length) return null;
    return entryDataStart(await readAt(this.#handle, entry.offset, 30), entry);
  }
}

/** Bytes counted as they pass, and refused past `limit`: the declared size, held to. */
class Bounded extends Transform {
  seen = 0;
  readonly #limit: number;

  constructor(limit: number) {
    super();
    this.#limit = limit;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.seen += chunk.byteLength;
    if (this.seen > this.#limit) {
      done(new Error('A zip entry inflated past the size it declared.'));
      return;
    }
    done(null, chunk);
  }
}

/**
 * Errors from our own side of an extraction: the disk under the target. A
 * zlib error, or `Bounded`'s own, is the archive's.
 */
function isOurs(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && !code.startsWith('Z_') && !code.startsWith('ERR_');
}

/** Exactly `length` bytes at `position`, or as many as the file has. */
async function readAt(handle: FileHandle, position: number, length: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let got = 0;
  while (got < length) {
    const { bytesRead } = await handle.read(buffer, got, length - got, position + got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return buffer.subarray(0, got);
}

/**
 * ***An archive's database, and its log if it carries one, landed in a
 * scratch space of their own*** — the file-backed zip source's `land`
 * ([P13.8]'s *the one `aventura.db` entry is inflated to scratch*).
 *
 * **Room first**, for the declared sizes of both and the snapshot's reserve,
 * and as `SnapshotSpaceError`: this *is* the copy of the database the
 * snapshot would otherwise have made, and the route answers it `507` the same
 * way. The declared size is what the extraction is held to (`extract`), so it
 * is the honest figure to ask for.
 *
 * The space is the caller's on success; on `null` — an entry that is not
 * there or not what the directory said — or a throw, it is gone before this
 * returns, so a refusal leaves scratch as it found it.
 */
export async function landEntryWithLog(
  zip: ZipFile,
  path: string,
  options: {
    layout: Layout;
    freeBytes?: (path: string) => Promise<number | null>;
  },
): Promise<{ space: ScratchSpace; name: string } | null> {
  const entry = zip.entries.find((candidate) => candidate.name === path);
  if (entry === undefined) return null;
  const log = zip.entries.find((candidate) => candidate.name === `${path}-wal`);

  const free = await (options.freeBytes ?? diskFreeBytes)(options.layout.dataRoot);
  const needed =
    SNAPSHOT_FREE_RESERVE_BYTES + entry.uncompressedSize + (log?.uncompressedSize ?? 0);
  if (free !== null && free < needed) throw new SnapshotSpaceError(needed, free);

  // The last segment, which is one the resolver takes: an entry's name is
  // already safe (`zip.ts`'s `safeZipName`), and the space holds nothing else.
  const name = path.split('/').pop() ?? path;
  const space = await openImportScratch(options.layout);
  try {
    if ((await zip.extract(entry, space.path(name))) !== 'extracted') {
      await space.dispose();
      return null;
    }
    if (log !== undefined && (await zip.extract(log, space.path(`${name}-wal`))) !== 'extracted') {
      await space.dispose();
      return null;
    }
    return { space, name };
  } catch (error) {
    await space.dispose().catch(() => undefined);
    throw error;
  }
}

/** A megabyte at a time, as the snapshot's own copy reads. */
const CHUNK_BYTES = 1024 * 1024;

/** `length` bytes from `position`, in chunks, ending early only if the file does. */
async function* chunksOf(
  handle: FileHandle,
  position: number,
  length: number,
): AsyncGenerator<Uint8Array> {
  let at = 0;
  while (at < length) {
    const chunk = await readAt(handle, position + at, Math.min(CHUNK_BYTES, length - at));
    if (chunk.length === 0) return;
    yield chunk;
    at += chunk.length;
  }
}

/** All of `chunk`, however many writes it takes. */
async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let at = 0;
  while (at < chunk.byteLength) {
    at += (await handle.write(chunk, at, chunk.byteLength - at)).bytesWritten;
  }
}
