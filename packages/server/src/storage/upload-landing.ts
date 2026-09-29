// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { open } from 'node:fs/promises';

import { SNAPSHOT_FREE_RESERVE_BYTES } from './sqlite-snapshot.js';

/**
 * ***An upload written to disk as it arrives, not held in memory*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * Every upload this server took before P13.8 was buffered whole: the
 * multipart part read into one `Buffer`, peaking near twice the file while
 * the chunks and their concatenation were both alive. At 64 MB that was a
 * price; at the size of an Aventuras install with a gallery it is the heap.
 * So an archive or a database is **landed** instead — each chunk written to a
 * file in the import scratch root as it arrives, and the file handed on.
 *
 * This module is the part that touches the disk, which is why it is under
 * `storage/`; the route (`routes/import-upload.ts`) decides what is landed and
 * answers for it.
 *
 * ***Three things a landing will not do***, and each is a way a large upload
 * goes wrong that a small one never showed:
 *
 * - **Take more than it was allowed.** Counted here as the chunks are written,
 *   and refused the moment the count passes — not afterwards, from a size the
 *   file reached on disk. The multipart reader's own `fileSize` limit is set
 *   as well, and its `truncated` flag is still checked by the caller, because
 *   busboy's limit ends the stream quietly rather than throwing.
 * - **Wait forever.** A client that stops sending — a phone that went to
 *   sleep, a laptop lid closed half way through a gigabyte — would otherwise
 *   hold the one large-upload slot, a file handle and a half-written file for
 *   as long as the socket stayed open, which with keep-alive can be a very
 *   long time. So a landing gives up after `idleMs` with no bytes at all.
 *   **Idle, not total**, for `providerTimeoutMs`'s reason: a gigabyte over a
 *   slow uplink is ordinary, and a wall-clock bound would refuse it.
 * - **Fill the disk.** {@link assertLandingRoom} is asked first, for 1.1× the
 *   upload and the reserve the snapshot keeps.
 */

/**
 * ***Not enough room to take this upload without filling the disk***, found
 * before a byte of it was written — `SnapshotSpaceError`'s sibling, answered
 * the same way: `507 no-space`, with the numbers.
 */
export class LandingSpaceError extends Error {
  readonly needed: number;
  readonly free: number;

  constructor(needed: number, free: number) {
    super(
      `There is not enough free space on the disk to receive this upload: it could need ${megabytes(needed)} and ${megabytes(free)} is free.`,
    );
    this.name = 'LandingSpaceError';
    this.needed = needed;
    this.free = free;
  }
}

function megabytes(bytes: number): string {
  return `${String(Math.ceil(bytes / (1024 * 1024)))} MB`;
}

/**
 * ***The headroom a landing asks for above the upload itself*** — [P13.8]'s
 * *free space of at least 1.1× the upload*.
 *
 * The tenth is for what the file system spends beside the bytes — blocks,
 * the metadata of a file that grows a megabyte at a time — and for what
 * follows a landing on the same volume before anything is let go: an
 * archive's database inflated beside it, which checks for its own room, and
 * a log folded into a database, which the snapshot checks for. The reserve
 * on top is the snapshot's, for the snapshot's reason: a full disk is what
 * stops the server saving turns.
 */
export const LANDING_HEADROOM = 1.1;

/**
 * Room for an upload of `bytes`, or {@link LandingSpaceError}.
 *
 * **A filesystem that will not say how much is free is not a refusal** —
 * `freeBytes`' rule, and the snapshot's.
 */
export async function assertLandingRoom(
  freeBytes: (path: string) => Promise<number | null>,
  dataRoot: string,
  bytes: number,
): Promise<void> {
  const free = await freeBytes(dataRoot);
  if (free === null) return;
  const needed = Math.ceil(bytes * LANDING_HEADROOM) + SNAPSHOT_FREE_RESERVE_BYTES;
  if (free < needed) throw new LandingSpaceError(needed, free);
}

/** One step of a stream, or `'idle'` when none came within the window. */
export type Step = IteratorResult<Uint8Array> | 'idle';

/**
 * The stream's next chunk, or `'idle'` after `idleMs` without one.
 *
 * The `next()` that lost the race is left pending, and **given a `catch`**:
 * the caller tears the stream down on `'idle'`, which rejects it, and a
 * rejection nobody listens to is a process-level `unhandledRejection`.
 */
export async function nextWithin(
  iterator: AsyncIterator<Uint8Array>,
  idleMs: number,
): Promise<Step> {
  const next = iterator.next();
  let timer: NodeJS.Timeout | undefined;
  const idle = new Promise<'idle'>((resolve) => {
    timer = setTimeout(() => {
      resolve('idle');
    }, idleMs);
  });
  try {
    const step = await Promise.race([next, idle]);
    if (step === 'idle') next.catch(() => undefined);
    return step;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ***At least `want` bytes off the front of a stream, however it was cut*** —
 * [P13.8]'s *sniffed from at least sixteen accumulated bytes*.
 *
 * SQLite's header is sixteen bytes and a zip's four, and a network hands over
 * whatever arrived: a first chunk can be one byte, or the tail of a
 * multipart header's line. Sniffing the first *chunk* would call a real
 * database *not a database* whenever the connection happened to split it
 * early — and the file would then be buffered in memory under the smaller
 * limit, and refused as too large. So chunks are gathered until there are
 * enough, or the file ends first (a file shorter than a header is simply
 * not one).
 *
 * Returns what it took — possibly more than `want`, since chunks are not
 * split — and whether the stream ended while taking it; `'idle'` when it
 * stalled before either.
 */
export async function takeHead(
  iterator: AsyncIterator<Uint8Array>,
  want: number,
  idleMs: number,
): Promise<{ head: Uint8Array; ended: boolean } | 'idle'> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < want) {
    const step = await nextWithin(iterator, idleMs);
    if (step === 'idle') return 'idle';
    if (step.done === true) return { head: concat(chunks, length), ended: true };
    chunks.push(step.value);
    length += step.value.byteLength;
  }
  return { head: concat(chunks, length), ended: false };
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const [only] = chunks;
  if (chunks.length === 1 && only !== undefined) return only;
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export interface LandingRequest {
  /** What {@link takeHead} took off the front, written first. */
  head: Uint8Array;
  /** Whether the stream had already ended when the head was taken. */
  ended: boolean;
  /** The rest of the part. */
  rest: AsyncIterator<Uint8Array>;
  /** Where to write it: a file in a scratch space of the caller's, created `wx`. */
  target: string;
  /** The most the upload may be. One byte more is `too-large`. */
  maxBytes: number;
  /** How long the stream may send nothing before the landing gives up. */
  idleMs: number;
}

export type LandingOutcome =
  | { ok: true; bytes: number }
  /**
   * Past `maxBytes`, or silent past `idleMs`. What was written is left in the
   * caller's space, which the caller disposes of — the one clean-up that
   * cannot miss a file.
   */
  | { ok: false; why: 'too-large' | 'idle' };

/**
 * Writes the head and then every chunk to `target`, counting, and stops at
 * the first that would pass `maxBytes`.
 *
 * *One chunk at a time, each written before the next is asked for*, which is
 * the backpressure: the multipart stream is paused while a write is
 * outstanding, so a disk slower than the network holds the socket back rather
 * than filling the heap with chunks waiting their turn.
 *
 * Throws for a failure of ours — the disk, `ENOSPC` among them, which the
 * route answers `507`.
 */
export async function landUpload(request: LandingRequest): Promise<LandingOutcome> {
  const out = await open(request.target, 'wx');
  try {
    let written = 0;
    const write = async (chunk: Uint8Array): Promise<boolean> => {
      if (written + chunk.byteLength > request.maxBytes) return false;
      let at = 0;
      while (at < chunk.byteLength) {
        at += (await out.write(chunk, at, chunk.byteLength - at)).bytesWritten;
      }
      written += chunk.byteLength;
      return true;
    };

    if (!(await write(request.head))) return { ok: false, why: 'too-large' };
    if (request.ended) return { ok: true, bytes: written };
    for (;;) {
      const step = await nextWithin(request.rest, request.idleMs);
      if (step === 'idle') return { ok: false, why: 'idle' };
      if (step.done === true) return { ok: true, bytes: written };
      if (!(await write(step.value))) return { ok: false, why: 'too-large' };
    }
  } finally {
    await out.close();
  }
}
