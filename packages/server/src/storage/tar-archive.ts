// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

import { ensureDirectory, unlinkFile, writeFileBytes } from './files.js';
import {
  BLOCK,
  headerName,
  headerSize,
  isTrailerBlock,
  padding,
  tarHeader,
  trailer,
} from './tar.js';

/**
 * Writing a gzipped tar, from inside the server —
 * [P12.2](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***Here rather than in `backup/` because this is the half that touches the
 * disk.*** `node:fs` is confined to this directory, so a module that decides
 * *what belongs in an archive* cannot also be the one that opens the files. The
 * split is the useful one anyway: this knows nothing about scopes, manifests or
 * credentials, and `backup/archive.ts` knows nothing about streams.
 *
 * **It streams, and that is not an optimisation.** A data directory with
 * renditions in it is not bounded by anything, and the one thing a backup must
 * never do is need as much memory as the thing it is backing up. Peak here is
 * one file's chunk plus gzip's window, whatever the archive weighs.
 */

/** A member: bytes we hold, or a file we will stream. */
export type ArchiveMember =
  { name: string; bytes: Uint8Array } | { name: string; path: string; size: number };

export interface ArchiveResult {
  files: number;
  /** Uncompressed, which is what a restore has to find room for. */
  bytes: number;
}

/**
 * Writes `members` to `to`, atomically enough that a crash leaves nothing.
 *
 * ***`.part` and then a rename***, which is the one property that matters when
 * this runs on a timer nobody is watching: a listing that showed a
 * half-finished archive would be offering somebody a file that cannot be
 * restored, and they would find out on the day they needed it. The partial is
 * unlinked in a `finally`, so a backup that fails on a full disk costs no space
 * either — which matters because **a full disk stops the server writing turns**,
 * and a feature meant to protect somebody's writing must not be what loses it.
 *
 * `mtime` is the caller's, per `tar.ts`: a backup wants the time it was taken.
 */
export async function writeTarGz(
  to: string,
  members: readonly ArchiveMember[],
  mtimeSeconds: number,
): Promise<ArchiveResult> {
  await ensureDirectory(dirname(to));
  const partial = `${to}.part`;

  const gzip = createGzip();
  // The same listener cap `pack-tarball.mjs` and `backup.mjs` raise, for the
  // same reason: one `close` listener per member on one gzip stream, and Node
  // warns past ten.
  gzip.setMaxListeners(0);
  const done = pipeline(gzip, createWriteStream(partial));

  let files = 0;
  let bytes = 0;
  try {
    for (const member of members) {
      const size = 'bytes' in member ? member.bytes.length : member.size;
      await push(gzip, tarHeader(member.name, size, { mtime: mtimeSeconds }));

      if ('bytes' in member) {
        await push(gzip, member.bytes);
      } else if (size > 0) {
        /**
         * ***Exactly `size` bytes, whatever the file turns out to hold.***
         *
         * The length was declared in the header a moment ago and the file is
         * live: a turn segment may have grown between the `stat` and this read,
         * and an archive whose member is longer than its header says is not a
         * slightly-wrong archive but an unreadable one — every later member
         * lands at the wrong offset.
         *
         * **Growing is the realistic case and truncating is the right answer to
         * it.** Segments are append-only, so a prefix is a whole number of
         * complete turns plus possibly a partial last line, and
         * `sessions/segments.ts` already drops a line that does not parse
         * *"because a segment is the one file a crash can leave half-written."*
         * Shrinking should not happen — library writes are temp-and-rename, so
         * the inode we opened does not change under us — and the padding below
         * is there because *should not* is not a guarantee to build a file
         * format on.
         */
        let written = 0;
        for await (const chunk of createReadStream(member.path, { end: size - 1 })) {
          const slice = (chunk as Uint8Array).subarray(0, size - written);
          if (slice.length === 0) break;
          await push(gzip, slice);
          written += slice.length;
        }
        if (written < size) await push(gzip, new Uint8Array(size - written));
      }

      const pad = padding(size);
      if (pad > 0) await push(gzip, new Uint8Array(pad));
      files += 1;
      bytes += size;
    }

    gzip.end(trailer());
    await done;
    await rename(partial, to);
    return { files, bytes };
  } catch (error) {
    /**
     * ***The pipeline's promise has to be settled, not abandoned.***
     *
     * `gzip.destroy()` makes `pipeline` reject with `ERR_STREAM_PREMATURE_CLOSE`,
     * and `done` is not awaited on this path — so without this line every failed
     * backup raises an **unhandled rejection**, which Node terminates the
     * process for by default. It would fire on a full disk or an unwritable
     * name: precisely the moments when the server most needs to stay up and
     * report what happened. Found by a test that asserted only that no `.part`
     * survived, and which passed while the run around it did not.
     */
    gzip.destroy();
    await done.catch(() => undefined);
    await unlinkFile(partial).catch(() => undefined);
    throw error;
  }
}

/**
 * One write, waiting for `drain` when the stream asks us to.
 *
 * ***Without this the streaming is a fiction.*** `Writable.write` returns false
 * once its buffer is past the high-water mark and a caller that ignores the
 * answer simply keeps queueing — so a loop of bare `gzip.write(chunk)` holds
 * the **entire archive** in memory while claiming to stream it, and the failure
 * only appears on the install with enough data to matter. `tools/backup.mjs`
 * gets this for free from `pipeline`; here the members are interleaved with
 * headers and padding, so there is no single pipe to hand the work to and the
 * backpressure has to be honoured by hand.
 */
async function push(stream: Writable, chunk: Uint8Array): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

/** One member, read back. */
export interface ReadMember {
  name: string;
  bytes: Uint8Array;
}

/**
 * Reads a gzipped tar, one member at a time —
 * [P12.2](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***Streaming, where `tools/backup.mjs` reads the whole archive into memory.***
 * That script states its reasoning and it is sound for a script: *"a data
 * directory of stories and cards is megabytes, and a streaming tar reader is a
 * state machine — which is a thing to get wrong in the one tool somebody
 * reaches for when things have already gone wrong."* The server is the other
 * case. It reads archives on a request, it may be holding several sessions'
 * worth of renditions, and an install archive is not bounded by anything — so
 * here the state machine is worth writing, and it is bounded by **the largest
 * single member** rather than by the archive.
 *
 * ***It yields names, not paths, and checks nothing about them.*** Containment
 * is the caller's, because the two callers want different answers: a restore
 * refuses an escaping name outright, and an import is reading into a sandbox it
 * chose. Deciding here would make one of them wrong.
 *
 * ***Both streams are destroyed in a `finally`, and that is for the caller who
 * stops early.*** A reader that wants only the manifest breaks out of the
 * `for await` after the first member — which calls `.return()` on this
 * generator and runs nothing else, because the iterator over `source` is held
 * in a closure here rather than by the loop. Without this, `readArchiveManifest`
 * would leak a file descriptor and an inflate context **per request**, which is
 * the kind of leak that looks like nothing until a schedule has run for a
 * fortnight. `pipe` does not propagate a destroy, so both ends are named.
 */
export async function* readTarGz(path: string): AsyncGenerator<ReadMember> {
  let held = new Uint8Array(0);
  let done = false;

  const file = createReadStream(path);
  const source = file.pipe(createGunzip());
  const chunks = source[Symbol.asyncIterator]();

  /** Fills `held` to at least `want` bytes, or gives up at the end of the stream. */
  const fill = async (want: number): Promise<boolean> => {
    while (held.length < want && !done) {
      const next = await chunks.next();
      if (next.done === true) {
        done = true;
        break;
      }
      const chunk = next.value as Uint8Array;
      const grown = new Uint8Array(held.length + chunk.length);
      grown.set(held, 0);
      grown.set(chunk, held.length);
      held = grown;
    }
    return held.length >= want;
  };

  const take = (count: number): Uint8Array => {
    const slice = held.subarray(0, count);
    held = held.subarray(count);
    // Copied, because `subarray` is a view onto a buffer this loop keeps
    // replacing — a member handed out by reference would change under its
    // reader.
    return new Uint8Array(slice);
  };

  try {
    for (;;) {
      if (!(await fill(BLOCK))) return;
      const header = take(BLOCK);
      // Two of these end the archive; one is enough to stop on, because there
      // is nothing after it that a reader of ours should act on.
      if (isTrailerBlock(header)) return;

      const size = headerSize(header);
      if (size === null) return;
      const name = headerName(header);

      if (!(await fill(size))) return;
      const bytes = take(size);
      const pad = padding(size);
      if (pad > 0 && (await fill(pad))) take(pad);

      // A directory member carries no bytes and is not a file; the paths imply
      // the directories, exactly as `MemoryFileSource` has it.
      if (!name.endsWith('/')) yield { name, bytes };
    }
  } finally {
    source.destroy();
    file.destroy();
  }
}

/**
 * A name a member may be written out under, or null —
 * [P12.12](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***Refused rather than sanitised***, which is `storage/zip.ts`'s posture and
 * its argument: *"silently rewriting `../../x` to `x` imports a file the
 * archive did not describe, under a name nobody chose."* Here the stakes are
 * higher than an import's — what is being written is about to **become** the
 * install — so a single bad name stops the whole unpack rather than being
 * dropped from it.
 *
 * ***It runs on the rejoined name.*** A long member arrives as ustar's `prefix`
 * and `name`, which `headerName` puts back together with a `/`, so checking
 * either half alone would miss a `..` in the other.
 */
function safeMemberName(name: string): string | null {
  const joined = name.replaceAll('\\', '/');
  if (joined === '' || joined.startsWith('/') || /^[A-Za-z]:/.test(joined)) return null;
  if (joined.includes('\0')) return null;
  if (joined.split('/').some((part) => part === '..')) return null;
  return joined;
}

export class UnpackError extends Error {}

/**
 * Writes every member of an archive under `toRoot` —
 * [P12.12](../../../../docs/design/workplan/29-p12-implementation.md).
 *
 * ***The other end of `writeTarGz`, and the one that runs before a logger
 * exists.*** A restore unpacks on the next boot, ahead of `buildServices`,
 * because everything after that opens a handle on the directory being replaced
 * or stamps it. So this throws rather than logging, and the caller turns it
 * into the one thing a boot can say.
 *
 * ***It writes into a sibling directory rather than over the live one***, which
 * is the caller's decision but the reason belongs here: every member is written
 * before anything is renamed, so an unpack that fails half way has ruined a
 * directory nothing is using. The live data is untouched until two renames,
 * microseconds apart, at the end.
 *
 * **Not atomic per file, deliberately.** `writeAtomic`'s temp-and-rename is for
 * a file a reader might be holding; nothing can be reading this tree, because
 * nothing knows it exists yet.
 */
export async function unpackTarGz(path: string, toRoot: string): Promise<number> {
  let files = 0;
  for await (const member of readTarGz(path)) {
    const name = safeMemberName(member.name);
    if (name === null) {
      throw new UnpackError(`This archive names a file outside the directory: ${member.name}`);
    }
    const to = join(toRoot, ...name.split('/'));
    await ensureDirectory(dirname(to));
    await writeFileBytes(to, member.bytes);
    files += 1;
  }
  return files;
}
