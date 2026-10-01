// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { inflateRawSync } from 'node:zlib';

/**
 * A zip archive, read as bytes, with bounds
 * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md),
 * [§7.5](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **Written rather than depended on**, for the same reason `card/png.ts` is:
 * what this needs from zip is a small, fixed, forty-year-old subset — walk the
 * central directory, stat the entries, inflate the ones that are deflated — and
 * the part that actually matters is the part a library would not do, which is
 * refusing an archive before it costs anything. A general zip library is a large
 * dependency whose job is to succeed at reading anything; this one's job is to
 * decline. `node:zlib` already ships with the runtime and already reads the
 * deflate streams inside PNG chunks here.
 *
 * **The bounds are §1.3's four, and each is a real attack rather than tidiness:**
 * entry count (a million empty files), per-entry uncompressed size and total
 * uncompressed size (the zip bomb — 42.zip is 42 KB and 4.5 PB), and path
 * traversal (`../../etc/…`, and the absolute-path and drive-letter forms of the
 * same idea). Every one of them is checked from the **central directory, before
 * a byte is inflated**, which is the only place checking them is worth anything:
 * a bomb caught after decompression has already been decompressed.
 *
 * Zip64 is refused rather than parsed. It exists for archives past 4 GB or 65535
 * entries, both of which are far outside anything this reads, and a half-right
 * zip64 parse is the kind of code that silently returns the wrong offsets.
 */

export interface ZipLimits {
  /** Entries in the central directory. */
  maxEntries: number;
  /** Uncompressed size of any single entry. */
  maxEntryBytes: number;
  /** Uncompressed size of everything, added up before anything is inflated. */
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 4096,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

export type ZipRefusal =
  /** Not a zip: no end-of-central-directory record where one must be. */
  | 'not-a-zip'
  /** Structurally wrong — a truncated archive, or an offset that leaves the file. */
  | 'malformed'
  /** Zip64. Legal, and outside what this reads. */
  | 'unsupported'
  /** Past `maxEntries`, `maxEntryBytes` or `maxTotalBytes`. */
  | 'too-large'
  /** An entry name that would escape the archive when written out. */
  | 'unsafe-path'
  /** A compression method that is neither stored nor deflate. */
  | 'unsupported-compression';

export interface ZipEntry {
  /** Normalised, forward-slashed, guaranteed not to escape. */
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the local header, which is where the bytes are found. */
  offset: number;
}

export type ZipDirectory =
  { ok: true; entries: readonly ZipEntry[] } | { ok: false; refusal: ZipRefusal };

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
/** Marks a zip64 field: the real value lives in an extra-field record. */
const ZIP64_SENTINEL = 0xffffffff;

/**
 * Is this plausibly a zip at all?
 *
 * By the local-header signature at offset zero, which is what every archive
 * written by every tool starts with. Deliberately **not** by extension: the
 * whole probe posture here is that a file is what its bytes say
 * ([P4 §1.3]), and `.charx`, `.seactor`, `.zip` and no extension at all are the
 * same container.
 */
export function looksLikeZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === LOCAL;
}

/**
 * Reads the central directory, applying every bound before returning.
 *
 * The central directory rather than a walk of local headers, because a local
 * header may carry zeroes for both sizes and defer them to a data descriptor
 * *after* the compressed bytes — which makes the sizes unknowable until the
 * entry has been read, which is exactly what the bounds exist to avoid doing.
 *
 * ***Two halves since [P13.8]***, {@link locateCentralDirectory} and
 * {@link parseCentralDirectory}, because a second reader needs them apart:
 * `zip-file.ts` reads an archive that is on disk rather than in memory, so it
 * has the file's tail and then the directory, never the whole — and the
 * parse, which is where every refusal below is made, is the part that must
 * not exist twice.
 */
export function readZipDirectory(
  bytes: Uint8Array,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): ZipDirectory {
  const located = locateCentralDirectory(bytes, 0, bytes.length);
  if (!located.ok) return located;
  if (located.count > limits.maxEntries) return { ok: false, refusal: 'too-large' };
  return parseCentralDirectory(
    bytes.subarray(located.offset, located.offset + located.size),
    located.count,
    bytes.length,
    limits,
  );
}

/**
 * How much of an archive's end has to be read to find its central directory:
 * the end record's 22 bytes, the longest comment that may follow it, and the
 * 20 bytes of a zip64 locator that may precede it — [P13.8]'s window.
 *
 * *The last twenty are the ones that are easy to forget.* The end record is
 * searched for in the last 22 + 65535 bytes, which is where it can be; but
 * the question of whether the archive is zip64 is asked of the 20 bytes
 * **before** the record, and with a maximum-length comment those lie outside
 * a window of 22 + 65535. A reader with that window would miss the locator
 * and read the zip64 archive's placeholder offsets as real ones — which is
 * the half-right zip64 parse this file refuses to be.
 */
export const ZIP_TAIL_BYTES = 22 + 0xffff + 20;

/** Where the central directory is, as the end record states it. */
export type CentralDirectoryLocation =
  { ok: true; count: number; size: number; offset: number } | { ok: false; refusal: ZipRefusal };

/**
 * Finds the end record in an archive's tail and reads where the central
 * directory is — **refusing zip64, and a directory that would leave the
 * archive**, before anybody reads it.
 *
 * `tail` is the archive's last bytes, or all of them; `tailStart` is where
 * they begin in the archive and `archiveLength` how long it is, so offsets
 * the record states are checked against the archive and not the window.
 */
export function locateCentralDirectory(
  tail: Uint8Array,
  tailStart: number,
  archiveLength: number,
): CentralDirectoryLocation {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  const eocd = findEocd(view, tail.length);
  if (eocd < 0) return { ok: false, refusal: 'not-a-zip' };

  // A zip64 locator sits immediately before the EOCD when one is in use.
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === EOCD64_LOCATOR) {
    return { ok: false, refusal: 'unsupported' };
  }

  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || size === ZIP64_SENTINEL || offset === ZIP64_SENTINEL) {
    return { ok: false, refusal: 'unsupported' };
  }
  // The directory ends where the end record begins, or before: a directory
  // said to run past it is an archive cut short or lying about itself.
  if (offset + size > Math.min(archiveLength, tailStart + eocd)) {
    return { ok: false, refusal: 'malformed' };
  }
  return { ok: true, count, size, offset };
}

/**
 * What {@link parseCentralDirectory} holds each entry to. `maxTotalBytes` is
 * the sum of *declared* sizes, and `null` switches it off — for a reader that
 * counts what it actually inflates instead (`zip-file.ts`), and for that
 * reason only.
 */
export interface CentralDirectoryLimits {
  maxEntryBytes: number;
  maxTotalBytes: number | null;
}

/**
 * The entries of a central directory, every bound applied — see the file
 * header for the four and why each is one. `central` is the directory's own
 * bytes, `count` the entries the end record promised, and `archiveLength`
 * what a local header's offset is checked against.
 */
export function parseCentralDirectory(
  central: Uint8Array,
  count: number,
  archiveLength: number,
  limits: CentralDirectoryLimits,
): ZipDirectory {
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const entries: ZipEntry[] = [];
  let total = 0;
  let at = 0;

  for (let i = 0; i < count; i += 1) {
    if (at + 46 > central.length) return { ok: false, refusal: 'malformed' };
    if (view.getUint32(at, true) !== CENTRAL) return { ok: false, refusal: 'malformed' };

    const compression = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);

    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localOffset === ZIP64_SENTINEL
    ) {
      return { ok: false, refusal: 'unsupported' };
    }

    const nameAt = at + 46;
    if (nameAt + nameLength > central.length) return { ok: false, refusal: 'malformed' };
    const raw = new TextDecoder().decode(central.subarray(nameAt, nameAt + nameLength));

    // Directory entries are the archive's own bookkeeping and carry no bytes;
    // the paths imply the directories, exactly as `MemoryFileSource` does.
    const isDirectory = raw.endsWith('/');
    if (!isDirectory) {
      const name = safeName(raw);
      if (name === null) return { ok: false, refusal: 'unsafe-path' };

      if (compression !== STORED && compression !== DEFLATED) {
        return { ok: false, refusal: 'unsupported-compression' };
      }
      if (uncompressedSize > limits.maxEntryBytes) return { ok: false, refusal: 'too-large' };
      if (limits.maxTotalBytes !== null) {
        total += uncompressedSize;
        if (total > limits.maxTotalBytes) return { ok: false, refusal: 'too-large' };
      }
      // A header that begins past the archive's end is not an entry. The
      // in-memory reader found this later, as a `null` read; a reader on disk
      // would rather not seek there to find out.
      if (localOffset + 30 > archiveLength) return { ok: false, refusal: 'malformed' };

      entries.push({ name, compression, compressedSize, uncompressedSize, offset: localOffset });
    }

    at = nameAt + nameLength + extraLength + commentLength;
  }

  return { ok: true, entries };
}

/**
 * Where an entry's compressed bytes begin, from its **local** header — the
 * thirty bytes at `entry.offset` — or `null` when those are not a local
 * header. Shared by both readers for the reason the comment inside gives.
 */
export function entryDataStart(header: Uint8Array, entry: ZipEntry): number | null {
  if (header.length < 30) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== LOCAL) return null;
  // **The local header's own name and extra lengths, not the central
  // directory's.** They are allowed to differ, and taking the central
  // directory's is the classic way to land in the middle of an entry's data.
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  return entry.offset + 30 + nameLength + extraLength;
}

/**
 * The stored method's number, for `zip-file.ts`, which streams a stored entry
 * through untouched. ~~`ZIP_DEFLATED` beside it~~ had no reader, and went
 * (2026-10-01): deflate is the other branch of the same test.
 */
export const ZIP_STORED = STORED;

/**
 * The bytes of one entry, or null if the archive lied about them.
 *
 * `inflateRawSync` because a zip entry is a bare deflate stream with no zlib
 * header — the difference that turns an otherwise correct reader into one that
 * fails on every deflated file.
 */
export function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Uint8Array | null {
  if (entry.offset + 30 > bytes.length) return null;
  const from = entryDataStart(bytes.subarray(entry.offset, entry.offset + 30), entry);
  if (from === null) return null;
  const to = from + entry.compressedSize;
  if (to > bytes.length) return null;

  const body = bytes.subarray(from, to);
  if (entry.compression === STORED) {
    return entry.uncompressedSize === body.length ? body : null;
  }

  try {
    /**
     * `maxOutputLength` is the belt to the central directory's braces: the
     * declared size was checked before we got here, and a crafted archive can
     * declare a small one and inflate to something else entirely.
     *
     * ***So the ceiling is the declared size*** (2026-09-27). It was the
     * per-entry maximum, and the total bound is a sum of declared sizes. Many
     * central entries may point at one local header, so 4,096 entries each
     * declaring one byte, all over one stream that inflates to 64 MB, passed
     * every bound and cost about 256 GB of synchronous inflation. Now an entry
     * inflates to what it said it would or is refused, so the declared total is
     * the real one. `Math.max(1, …)` because Node refuses a zero ceiling, and an
     * empty deflated entry is legitimate: the length check settles it.
     */
    const ceiling = Math.min(limits.maxEntryBytes, Math.max(1, entry.uncompressedSize));
    const out = inflateRawSync(body, { maxOutputLength: ceiling });
    if (out.byteLength !== entry.uncompressedSize) return null;
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  } catch {
    return null;
  }
}

/**
 * The end-of-central-directory record, searched backwards.
 *
 * It sits at the very end unless the archive carries a comment, which may be up
 * to 65535 bytes — so the search window is that plus the record itself, and no
 * more. Scanning the whole file would find a signature inside compressed data.
 */
function findEocd(view: DataView, length: number): number {
  const earliest = Math.max(0, length - (22 + 0xffff));
  for (let at = length - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === EOCD) return at;
  }
  return -1;
}

/**
 * An entry name that cannot escape, or null.
 *
 * Refuses rather than sanitises, and the difference matters: silently rewriting
 * `../../x` to `x` imports a file the archive did not describe, under a name
 * nobody chose. An archive that contains one is not an archive we want half of.
 */
function safeName(raw: string): string | null {
  const name = raw.replaceAll('\\', '/');
  if (name.length === 0) return null;
  // Absolute, and the Windows drive-letter form of absolute.
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  if (name.split('/').some((part) => part === '..')) return null;
  // NUL is the other way a path means something different to two readers.
  if (name.includes('\0')) return null;
  return name;
}
