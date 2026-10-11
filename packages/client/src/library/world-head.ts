// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***A World's file, sliced to its manifest*** —
 * [P16.3f](../../../../docs/design/workplan/35-p16-world.md),
 * [16 §5.1](../../../../docs/design/16-publish.md), the plan's R4.
 *
 * **The one archive this panel does send for a look — and only its head.** A
 * World's file says what is inside it in its manifest, so *do I want these in
 * my library* can be answered before anything is written; and the writer puts
 * that manifest first, stored, its size in its local header, so a slice from
 * byte zero to the manifest's last byte is the whole question. That slice goes
 * to the preview door as a file of its own, and the server reads it with the
 * same shared parser (`firstLocalEntry`) — it parses rather than trusting
 * this — before any archive reader would refuse a zip with no directory. A
 * file of a gigabyte of pictures is looked at for the kilobytes its manifest
 * takes.
 *
 * ***And where the manifest is not first*** (P16.3e's probe, which finds it
 * anywhere, so a file zipped again by another tool is still read as the World
 * it is): the archive's own directory, at its tail, says where the manifest's
 * local header is, and the slice is taken from there instead — still the
 * header and its bytes, still the one parser on the server. The head is the
 * fast path, the tail the fallback, and neither sends the archive.
 *
 * ***Deflated, and with its sizes after its data*** (2026-10-11, the P16.3f
 * review): ~~a manifest deflated (no bytes to slice, only a stream), or
 * written with a data descriptor~~ — *which is what every tool that zips a
 * folder again writes*, the ordinary course P16.3e's record names. A deflated
 * manifest's slice is its local header and its **compressed** bytes, which
 * the server inflates, bounded by the ceiling; a data descriptor keeps the
 * sizes out of the local header, so they are taken from the archive's
 * directory, which always has them, and the slice ends where the data does.
 *
 * **Null — and the archive is looked at as a folder in a file, as before —**
 * for anything the slice cannot be: no manifest at either end; a method other
 * than stored or deflated; a manifest past the manifest's ceiling, compressed
 * or not; a directory that names it twice, that disagrees with the local
 * header about its method, or that this build would not read (zip64, a
 * comment that hides the end record). Whatever this cannot slice, the commit
 * still reads; only the look is the plainer one.
 *
 * ***Its own module, fetched when a zip is picked*** (P16.3f, the entry
 * budget): beside `import-sniff.ts`, which every pick runs and so is on the
 * entry, this is the half only a zip needs — a directory reader, in effect —
 * and the import panel loads it with `import()` once the sniff says *zip*. The
 * plan named `import-sniff.ts` as its home; the split is the budget's.
 *
 * ***And it imports nothing***, not even `@storyengine/shared`: a module this
 * chunk shared with the entry was split by the bundler into a chunk of its own
 * on the entry, and the gzip of two files is more than the gzip of one — the
 * first cut, which took `firstLocalEntry` and the manifest's name from shared,
 * measured *more* on the entry than leaving this on it. So the header is read
 * here in the twelve lines it takes, and `import-sniff.test.ts` holds the
 * slice to the shared reader — `firstLocalEntry` must read the manifest out of
 * whatever this returns — and the two constants to shared's.
 */
export const MANIFEST_NAME = 'storyengine-world.json';
export const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
export async function worldHeadOf(file: Blob): Promise<Blob | null> {
  const first = await manifestSliceAt(file, 0, null);
  if (first !== null) return first;
  const listed = await manifestInDirectory(file);
  return listed === null ? null : manifestSliceAt(file, listed.offset, listed);
}

/** The most a local header and its name can take: 30 bytes, a name and an extra field of 64 KiB each. */
const LOCAL_HEADER_MAX = 30 + 0xffff + 0xffff;

/** Bit 3 of a local header's flags: the sizes are in a data descriptor after the data. */
const DATA_DESCRIPTOR = 0x0008;
const STORED = 0;
const DEFLATED = 8;

/** What the archive's directory says of a member — its own record, where the sizes always are. */
interface Listed {
  offset: number;
  method: number;
  compressed: number;
  size: number;
}

/**
 * The manifest's local header and its bytes — compressed, when it is deflated
 * — when the local header at `offset` is the manifest's. `listed` is the
 * directory's record of it, whose sizes are used when there is one; without
 * one, a header whose sizes are in a data descriptor cannot be sliced.
 */
async function manifestSliceAt(
  file: Blob,
  offset: number,
  listed: Listed | null,
): Promise<Blob | null> {
  const bytes = new Uint8Array(await readSlice(file.slice(offset, offset + LOCAL_HEADER_MAX)));
  const entry = localHeader(bytes);
  if (entry?.name !== MANIFEST_NAME) return null;
  if (entry.method !== STORED && entry.method !== DEFLATED) return null;
  if (listed !== null && listed.method !== entry.method) return null;
  if (listed === null && (entry.flags & DATA_DESCRIPTOR) !== 0) return null;
  const compressed = listed?.compressed ?? entry.compressed;
  const size = listed?.size ?? entry.size;
  if (compressed > MANIFEST_MAX_BYTES || size > MANIFEST_MAX_BYTES) return null;
  const end = offset + entry.dataStart + compressed;
  return end > file.size ? null : file.slice(offset, end);
}

/** End-of-central-directory: its signature, its fixed size, and the longest comment after it. */
const END_SIGNATURE = 0x06054b50;
const END_BYTES = 22;
const COMMENT_MAX = 0xffff;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_BYTES = 46;
/** `ZipFile`'s own bound on a central directory, which the commit would refuse past. */
const DIRECTORY_MAX = 16 * 1024 * 1024;

/**
 * ***The manifest's record in the archive's directory*** — where its local
 * header is, its method and its two sizes — or null. Read from the tail: the
 * end record (scanned for backwards, past any comment), then the directory it
 * points at, then the one entry named for the manifest. Only what a reader of
 * this file needs, and refusing what the server's readers refuse (zip64, a
 * directory past 16 MiB, a name twice).
 */
async function manifestInDirectory(file: Blob): Promise<Listed | null> {
  const tailStart = Math.max(0, file.size - (END_BYTES + COMMENT_MAX));
  const tail = new Uint8Array(await readSlice(file.slice(tailStart, file.size)));
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let at = tail.length - END_BYTES; at >= 0; at -= 1) {
    if (view.getUint32(at, true) === END_SIGNATURE) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (size === 0xffffffff || start === 0xffffffff || size > DIRECTORY_MAX) return null;
  if (start + size > file.size) return null;

  const directory = new Uint8Array(await readSlice(file.slice(start, start + size)));
  const entries = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const decoder = new TextDecoder();
  let found: Listed | null = null;
  for (let at = 0; at + CENTRAL_BYTES <= directory.length;) {
    if (entries.getUint32(at, true) !== CENTRAL_SIGNATURE) return null;
    const nameLength = entries.getUint16(at + 28, true);
    const extraLength = entries.getUint16(at + 30, true);
    const commentLength = entries.getUint16(at + 32, true);
    const name = decoder.decode(
      directory.subarray(at + CENTRAL_BYTES, at + CENTRAL_BYTES + nameLength),
    );
    if (name === MANIFEST_NAME) {
      // Named twice is a file the commit refuses; the look does not choose one.
      if (found !== null) return null;
      found = {
        method: entries.getUint16(at + 10, true),
        compressed: entries.getUint32(at + 20, true),
        size: entries.getUint32(at + 24, true),
        offset: entries.getUint32(at + 42, true),
      };
    }
    at += CENTRAL_BYTES + nameLength + extraLength + commentLength;
  }
  return found;
}

/**
 * A zip's local file header — what `firstLocalEntry` (shared) reads, read the
 * same way: signature, flags, method, the compressed size (offset 18, which
 * shared calls `size`) and the uncompressed one (22), the name as UTF-8, and
 * where the data starts. Null when the bytes are not one, or are cut short.
 */
function localHeader(head: Uint8Array): {
  name: string;
  method: number;
  flags: number;
  dataStart: number;
  compressed: number;
  size: number;
} | null {
  if (head.length < 30) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) return null;
  const nameLength = view.getUint16(26, true);
  if (head.length < 30 + nameLength) return null;
  return {
    name: new TextDecoder().decode(head.subarray(30, 30 + nameLength)),
    flags: view.getUint16(6, true),
    method: view.getUint16(8, true),
    compressed: view.getUint32(18, true),
    size: view.getUint32(22, true),
    dataStart: 30 + nameLength + view.getUint16(28, true),
  };
}

/** A slice's bytes — `import-sniff.ts`'s reader, kept here so this chunk imports nothing. */
function readSlice(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('The file could not be read.'));
    };
    reader.readAsArrayBuffer(blob);
  });
}
