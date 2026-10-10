// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { crc32 } from 'node:zlib';

import { ensureDirectory, renamePath, unlinkFile } from './files.js';
import { safeZipName } from './zip.js';
import { MAX_CENTRAL_BYTES } from './zip-file.js';

/**
 * ***The server's first zip writer*** —
 * [16 §5.2](../../../../docs/design/16-publish.md),
 * [03 §5.2.3](../../../../docs/design/03-data-model.md),
 * [P16.3c](../../../../docs/design/workplan/35-p16-world.md).
 *
 * **Why it exists at all.** The owner decided on 2026-10-10 that a World
 * travels as *a stored zip of the members' stored folders* (16 §5.2): an actor
 * as its card, portrait and expressions inside it, a lorebook with its
 * `assets/`, sessions as their exports beside their pictures. This server has
 * read zips since P4 (`zip.ts`, `zip-file.ts`) and written tar since P12
 * (`tar.ts`), and had never written a zip; 16 §5.2 named that as the decision's
 * cost — *"a writer the server does not have"*. This is it, and it is small on
 * purpose.
 *
 * ***Written rather than depended on***, for `zip.ts`'s reason turned around: a
 * general zip library's job is to write anything, and this one's job is to
 * write **only what this repository's own readers will take back**, refusing
 * the rest before a byte of it lands. The subset is fixed and forty years old:
 *
 * - **Stored, never deflated** — [03 §5.2.3]'s *"store, do not compress"*: a
 *   World file is almost entirely PNG and JSON-in-PNG, already compressed, and
 *   deflate would buy nothing and cost CPU on every read. It is also what lets
 *   a reader slice the manifest out of the first bytes it receives
 *   (`firstLocalEntry` in shared, P16.3f), which a deflated entry would not.
 * - **Sizes and CRC in the local header, so no data descriptors** (general
 *   purpose bit 3 clear). The CRC is `node:zlib`'s, which ships with the
 *   runtime and is what `test-zip.ts` moved to at [P13.8] for its speed. The
 *   member is in memory when its header is written, which is the price of
 *   bit 3 being clear — and why the writer buffers **one member at a time**,
 *   never the archive.
 * - **UTF-8 names (bit 11)**, because a member is named by a folder somebody
 *   named — *Véra*, *灯台* — and the reader decodes every name as UTF-8.
 * - **No extra fields, no comment, no directory entries, no zip64.** The
 *   readers refuse zip64 outright and skip directory entries; an extra field or
 *   a comment is somewhere for two readers to disagree. Every bound below sits
 *   inside what the format can say without them.
 * - **Unix mode 0644, made-by `0x0314`** (Unix, spec 2.0), so `unzip` on the
 *   recipient's machine makes ordinary readable files rather than whatever the
 *   absence of a mode means to it.
 * - **One timestamp for every member**, the caller's — `tar.ts`'s posture: a
 *   World file's members all carry the moment it was published
 *   (`exportedBy.at`), so the same members published at the same moment are
 *   the same bytes, and a diff of two files is a diff of what is in them.
 *
 * ***Refusals before the offending bytes, and nothing left behind.*** Every
 * refusal — too many entries, an entry or the archive too large (its central
 * directory included, against `zip-file.ts`'s own bound — added 2026-10-10
 * after the P16.3c review found long names could pass the other three), a
 * name twice, a name the readers would refuse or would read back differently
 * — is raised
 * **before** that member's header is written, so a refused write never
 * produces a file larger than its bounds, even on the way to deleting it. The
 * archive is written to `<to>.part`, opened `wx` so two writers can never share
 * one, and renamed into place only when the end record is down; **on any throw**
 * — a refusal, a failing member source, the disk — the handle is closed and the
 * `.part` unlinked, which is `tar-archive.ts`'s rule: a half-written archive
 * offered as a file is worse than no file.
 */

export interface ZipMember {
  /** The member name: `/`-separated, relative, UTF-8. Checked by {@link zipNameRefusal}. */
  name: string;
  bytes: Uint8Array;
}

export interface ZipWriteLimits {
  /** Members in the archive. */
  maxEntries: number;
  /** Bytes in any one member. */
  maxEntryBytes: number;
  /** Bytes in the whole archive, headers, directory and end record included. */
  maxArchiveBytes: number;
}

/**
 * ***The readers' own bounds, so the writer cannot outgrow them*** —
 * `zip.ts`'s `DEFAULT_ZIP_LIMITS` and `zip-file.ts`'s, where each still means
 * the same thing: 4,096 entries (both readers), 64 MiB a member (what either
 * reads into memory at once, `maxReadBytes`), and an archive no larger than a
 * zip without zip64 can address — `0xFFFFFFFE`, one short of the sentinel the
 * readers refuse as zip64. [P16.3]'s plan, risk 3: these ceilings now bound
 * what a World file can hold, and a card over 64 MiB leaves its actor behind
 * rather than producing a file nothing here will open.
 */
export const DEFAULT_ZIP_WRITE_LIMITS: ZipWriteLimits = {
  maxEntries: 4096,
  maxEntryBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 0xfffffffe,
};

/**
 * What the format itself can say without zip64, which no injected limit can
 * raise: an entry count of `0xFFFF` and a size or offset of `0xFFFFFFFF` are the
 * zip64 sentinels both readers refuse, and a name length is sixteen bits.
 */
const FORMAT_CEILING = {
  entries: 0xfffe,
  entryBytes: 0xfffffffe,
  archiveBytes: 0xfffffffe,
  nameBytes: 0xffff,
} as const;

export type ZipWriteRefusal =
  /** Past `maxEntries`. */
  | 'too-many-entries'
  /** One member past `maxEntryBytes`. */
  | 'entry-too-large'
  /** The archive would pass `maxArchiveBytes` with this member in it. */
  | 'archive-too-large'
  /** A second member under a name already written. */
  | 'duplicate-name'
  /** A name the readers would refuse, skip, or read back as something else. */
  | 'unsafe-name';

/**
 * A refusal, typed, because the caller maps each to an answer a person can
 * read (P16.3d) rather than a 500 — `tar.ts`'s `TarNameError` posture.
 * `memberName` is the member that was refused; `written` is how many members
 * were already down when it was, which is also how a test proves the refusal
 * came first.
 */
export class ZipWriteError extends Error {
  readonly code: ZipWriteRefusal;
  readonly memberName: string;
  readonly written: number;

  constructor(code: ZipWriteRefusal, memberName: string, written: number) {
    super(`A zip member was refused (${code}): ${JSON.stringify(memberName)}`);
    this.name = 'ZipWriteError';
    this.code = code;
    this.memberName = memberName;
    this.written = written;
  }
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const EOCD_BYTES = 22;
/** Version 1.0: a stored file with no directories, encryption or zip64 needs nothing later. */
const VERSION_NEEDED = 10;
/** Unix (high byte 3), spec 2.0 (low byte 20) — what `zipinfo` reads the mode out under. */
const MADE_BY = 0x0314;
/** General purpose bit 11: the name is UTF-8. Bit 3 (data descriptor) is never set. */
const FLAGS = 0x0800;
/** A regular file, rw-r--r--, in the high half of the external attributes. */
const EXTERNAL_ATTRIBUTES = (0o100644 << 16) >>> 0;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * ***Why a name would not come back as itself***, or null when it would.
 *
 * **`safeZipName` first, and then stricter.** The readers' function refuses
 * what would escape — absolute, a drive letter, `..`, NUL — and the writer asks
 * it rather than restating it, so *the writer never writes what the reader
 * refuses* holds by construction. On top, the writer refuses what the reader
 * would *accept differently*:
 *
 * - a name `safeZipName` changes — a backslash, which it folds to `/`, so the
 *   member would be returned under a name nobody wrote;
 * - a trailing `/`, which the readers take for a directory entry and skip;
 * - an empty or `.` segment, which the readers keep and every extractor
 *   normalises away, so two tools would disagree about where the bytes go;
 * - a string that is not well-formed UTF-16 — a lone surrogate encodes to
 *   U+FFFD and decodes as that, which is a different name;
 * - one longer than the sixteen-bit length field.
 *
 * Exported because the World file's planner names members from folder names
 * and asks the same question before it plans one, so a refusal is a planning
 * decision rather than a write that fails half way.
 */
export function zipNameRefusal(name: string): 'unsafe-name' | null {
  if (typeof name !== 'string' || name.length === 0) return 'unsafe-name';
  const bytes = encoder.encode(name);
  if (bytes.length > FORMAT_CEILING.nameBytes) return 'unsafe-name';
  if (decoder.decode(bytes) !== name) return 'unsafe-name';
  if (safeZipName(name) !== name) return 'unsafe-name';
  if (name.split('/').some((segment) => segment === '' || segment === '.')) return 'unsafe-name';
  return null;
}

/**
 * ***The size an archive of these members will be***, exactly — every local
 * header, every byte, the directory and the end record.
 *
 * The planner asks this before it writes anything ([P16.3]'s plan: *plans over
 * 4096 entries or 4 GiB are refused before anything is written*), so it is the
 * writer's own arithmetic rather than an estimate beside it: ~~a plan that
 * passes this passes {@link writeStoredZip}'s archive bound~~ — *2026-10-10*:
 * the archive's size is one of three whole-archive bounds now, and
 * {@link storedZipRefusal} is the question that asks all three; this stays the
 * exact size the download's `Content-Length` is.
 */
export function storedZipBytes(members: Iterable<{ name: string; size: number }>): number {
  let total = EOCD_BYTES;
  for (const member of members) {
    const name = encoder.encode(member.name).length;
    total += LOCAL_HEADER_BYTES + name + member.size + CENTRAL_HEADER_BYTES + name;
  }
  return total;
}

/**
 * ***What {@link writeStoredZip} would say about these members as a
 * whole*** — too many of them, or an archive or a directory too large — or
 * null when it would say nothing. Per-member refusals (a name, a size) are the
 * caller's to have settled already; this is the arithmetic only.
 *
 * *One function rather than the planner restating three bounds* (2026-10-10,
 * the P16.3c review): the directory bound was added to the writer after a
 * review found an archive it accepted and `ZipFile.open` refused, and a planner
 * that checked only `storedZipBytes` would then pass a plan the writer refuses
 * half way through — which is the half-written publish the plan's early refusal
 * exists to prevent. Asking here keeps the two from drifting.
 */
export function storedZipRefusal(
  members: Iterable<{ name: string; size: number }>,
  limits: ZipWriteLimits = DEFAULT_ZIP_WRITE_LIMITS,
): 'too-many-entries' | 'archive-too-large' | null {
  const bounds = clamp(limits);
  let entries = 0;
  let central = 0;
  let total = EOCD_BYTES;
  for (const member of members) {
    const name = encoder.encode(member.name).length;
    entries += 1;
    central += CENTRAL_HEADER_BYTES + name;
    total += LOCAL_HEADER_BYTES + name + member.size + CENTRAL_HEADER_BYTES + name;
  }
  if (entries > bounds.maxEntries) return 'too-many-entries';
  if (total > bounds.maxArchiveBytes || central > MAX_CENTRAL_BYTES) return 'archive-too-large';
  return null;
}

/**
 * ***Writes `members` to `to` as a stored zip***, in the order given, and
 * answers how many members and how many bytes the archive holds.
 *
 * `members` may be lazy — an async generator that reads one file per member is
 * the World file's — and is consumed one member at a time: a member's bytes
 * are held while its CRC is taken and its header and body are written, and
 * then let go. What stays in memory is the central directory, forty-six bytes
 * and a name per member.
 *
 * Throws {@link ZipWriteError} for a refusal, and whatever the member source
 * or the disk threw otherwise; in every case nothing is left at `to` or at
 * `<to>.part`. The one exception is a `.part` that was already there — `wx`
 * refuses to open it, and since this writer did not make it, it does not
 * remove it either.
 */
export async function writeStoredZip(
  to: string,
  members: AsyncIterable<ZipMember> | Iterable<ZipMember>,
  options: { mtime: Date; limits?: ZipWriteLimits },
): Promise<{ entries: number; bytes: number }> {
  const limits = clamp(options.limits ?? DEFAULT_ZIP_WRITE_LIMITS);
  // Before anything is opened: a writer asked to stamp an invalid date is a
  // caller's bug, and a file of 1980 timestamps would hide it.
  const stamp = dosDateTime(options.mtime);

  await ensureDirectory(dirname(to));
  const partial = `${to}.part`;
  const handle = await open(partial, 'wx');
  let closed = false;

  const central: Uint8Array[] = [];
  const names = new Set<string>();
  let offset = 0;
  let centralBytes = 0;
  try {
    for await (const member of members) {
      const name = member.name;
      const written = central.length;
      // Every check before a byte of this member is written. The order is
      // the one a person would want to hear about first: a malformed name is
      // wrong whatever its size, and a size is wrong whatever else fits.
      if (written + 1 > limits.maxEntries) {
        throw new ZipWriteError('too-many-entries', name, written);
      }
      if (zipNameRefusal(name) !== null) throw new ZipWriteError('unsafe-name', name, written);
      if (names.has(name)) throw new ZipWriteError('duplicate-name', name, written);
      const size = member.bytes.byteLength;
      if (size > limits.maxEntryBytes) throw new ZipWriteError('entry-too-large', name, written);

      const encoded = encoder.encode(name);
      const local = LOCAL_HEADER_BYTES + encoded.length + size;
      const record = CENTRAL_HEADER_BYTES + encoded.length;
      // The whole archive as it would stand with this member as the last one:
      // what is written, this member, every directory record so far and its
      // own, and the end record. Checked per member rather than at the end,
      // so the file on disk never passes the bound even while it is a `.part`.
      if (offset + local + centralBytes + record + EOCD_BYTES > limits.maxArchiveBytes) {
        throw new ZipWriteError('archive-too-large', name, written);
      }
      // And the directory alone, against the on-disk reader's own bound
      // (2026-10-10, the P16.3c review): a bound on *names*, which no count
      // or size above says — 256 members named near the sixteen-bit maximum
      // pass all three and make an archive `ZipFile.open` refuses.
      if (centralBytes + record > MAX_CENTRAL_BYTES) {
        throw new ZipWriteError('archive-too-large', name, written);
      }

      const crc = crc32(member.bytes) >>> 0;
      await writeAll(handle, localHeader(encoded, size, crc, stamp));
      await writeAll(handle, member.bytes);
      central.push(centralHeader(encoded, size, crc, stamp, offset));
      names.add(name);
      offset += local;
      centralBytes += record;
    }

    for (const record of central) await writeAll(handle, record);
    await writeAll(handle, endRecord(central.length, centralBytes, offset));
    await handle.close();
    closed = true;
    await renamePath(partial, to);
    return { entries: central.length, bytes: offset + centralBytes + EOCD_BYTES };
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined);
    await unlinkFile(partial).catch(() => undefined);
    throw error;
  }
}

/** The caller's limits, never past what the format can say. */
function clamp(limits: ZipWriteLimits): ZipWriteLimits {
  return {
    maxEntries: Math.min(limits.maxEntries, FORMAT_CEILING.entries),
    maxEntryBytes: Math.min(limits.maxEntryBytes, FORMAT_CEILING.entryBytes),
    maxArchiveBytes: Math.min(limits.maxArchiveBytes, FORMAT_CEILING.archiveBytes),
  };
}

/**
 * ***MS-DOS date and time, from UTC, clamped to what they can hold.***
 *
 * **UTC rather than local time**, deliberately against the format's own habit:
 * a DOS timestamp carries no zone, and the server's zone is a fact about the
 * machine it runs on — the same publish at the same instant would be different
 * bytes on two installs. Clamped to 1980-01-01 below (the format's epoch) and
 * 2107-12-31 above (seven bits of year); two-second resolution, as the format
 * has.
 */
function dosDateTime(at: Date): { time: number; date: number } {
  const ms = at.getTime();
  if (Number.isNaN(ms)) throw new RangeError('A zip member needs a valid modification time.');
  const earliest = Date.UTC(1980, 0, 1, 0, 0, 0);
  const latest = Date.UTC(2107, 11, 31, 23, 59, 58);
  const when = new Date(Math.min(Math.max(ms, earliest), latest));
  const time =
    (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | Math.floor(when.getUTCSeconds() / 2);
  const date =
    ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();
  return { time, date };
}

function localHeader(
  name: Uint8Array,
  size: number,
  crc: number,
  stamp: { time: number; date: number },
): Uint8Array {
  const header = new Uint8Array(LOCAL_HEADER_BYTES + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, LOCAL, true);
  view.setUint16(4, VERSION_NEEDED, true);
  view.setUint16(6, FLAGS, true);
  view.setUint16(8, 0, true); // stored
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true); // compressed: stored, so the same
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true); // no extra field
  header.set(name, LOCAL_HEADER_BYTES);
  return header;
}

function centralHeader(
  name: Uint8Array,
  size: number,
  crc: number,
  stamp: { time: number; date: number },
  offset: number,
): Uint8Array {
  const header = new Uint8Array(CENTRAL_HEADER_BYTES + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, CENTRAL, true);
  view.setUint16(4, MADE_BY, true);
  view.setUint16(6, VERSION_NEEDED, true);
  view.setUint16(8, FLAGS, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, stamp.time, true);
  view.setUint16(14, stamp.date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, 0, true); // extra
  view.setUint16(32, 0, true); // comment
  view.setUint16(34, 0, true); // disk number
  view.setUint16(36, 0, true); // internal attributes
  view.setUint32(38, EXTERNAL_ATTRIBUTES, true);
  view.setUint32(42, offset, true);
  header.set(name, CENTRAL_HEADER_BYTES);
  return header;
}

function endRecord(count: number, size: number, offset: number): Uint8Array {
  const record = new Uint8Array(EOCD_BYTES);
  const view = new DataView(record.buffer);
  view.setUint32(0, EOCD, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  view.setUint16(20, 0, true); // no comment
  return record;
}

/** All of `bytes`, however many writes it takes — `zip-file.ts`'s `writeAll`. */
async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let at = 0;
  while (at < bytes.byteLength) {
    at += (await handle.write(bytes, at, bytes.byteLength - at)).bytesWritten;
  }
}
