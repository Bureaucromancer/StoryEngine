// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { MultipartFile } from '@fastify/multipart';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AppServices } from '../app.js';
import { openImportScratch, type ScratchSpace } from '../storage/import-scratch.js';
import { looksLikeSqlite } from '../storage/sqlite-snapshot.js';
import {
  assertLandingRoom,
  LandingSpaceError,
  landUpload,
  nextWithin,
  takeHead,
} from '../storage/upload-landing.js';
import { looksLikeZip } from '../storage/zip.js';

/**
 * ***`POST /import/file`'s body, landed on disk when it is an archive or a
 * database*** — [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * Until P13.8 the one-file import buffered every upload whole
 * (`readOnePart`), which bounded it at `limits.maxUploadMb` and at twice that
 * in the heap. That is the right shape for a card or a preset, which are
 * kilobytes, and the wrong one for the upload P13 exists to take: an
 * Aventuras backup, which is a zip of somebody's whole install with every
 * picture in it as base64, or the bare `aventura.db` out of one. So the first
 * bytes are **sniffed**, and the two formats that can be that large are
 * written to the import scratch root as they arrive, under a limit of their
 * own, `limits.maxImportUploadMb`. Everything else is buffered exactly as it
 * was, under the limit it always had.
 *
 * ***Every archive, not only large ones***, and that is a choice rather than
 * a convenience. Deciding by size would mean deciding by `Content-Length`,
 * which a client may omit, and would give a zip two readers — the in-memory
 * one with its 64 MB entry bound and this one — so that the same backup read
 * differently at 60 MB and at 70. One road for an archive is one set of
 * answers about it. The cost is a small CHARX written to scratch and read
 * back, which is a few kilobytes of disk for a moment.
 *
 * ***What is checked, in order, and why that order.*** Each refusal comes as
 * early as the fact behind it is known, so a refused gigabyte is refused
 * before it is sent rather than after:
 *
 * 1. **The declared length**, before the body is read at all: a request that
 *    says it is larger than any limit here is `413`.
 * 2. **The multipart reader's own `fileSize`**, passed on this call — the
 *    plugin's default is the `bodyLimit` Fastify was *started* with, and does
 *    not follow Settings — as the larger of the two limits, since which one
 *    applies is not known until the bytes are.
 * 3. **The sniff**: at least sixteen bytes, gathered across however many
 *    chunks the network cut them into (`takeHead`).
 * 4. For a landing: **one large upload at a time** (`largeUploadInFlight`),
 *    **room for 1.1× it**, and then the bytes, counted against
 *    `maxImportUploadMb` as they are written. For the rest: the bytes,
 *    counted against `maxUploadMb` as they are buffered.
 * 5. **`truncated`**, after, because busboy's limit ends the stream quietly
 *    rather than throwing when the stream is read chunk by chunk.
 *
 * ***`Connection: close` on every refusal made before the body is read
 * through.*** A browser sending a large body does not read the response until
 * it has finished sending — so a server that answers `413` and then keeps the
 * connection, leaving the rest of the body unread, has a client still writing
 * into a socket nobody drains, and what the person sees is a reset, reported
 * as a network error, rather than the sentence we sent. Closing says the
 * refusal is the end of the exchange; Node shuts the socket once the answer is
 * written. It is not a guarantee — a client mid-write can still see the reset
 * — which is why the client maps a dropped connection to a sentence of its own
 * (`library/ImportPanel.tsx`).
 */

/** Megabytes, as every limit key counts them. */
const MEGABYTE = 1024 * 1024;

/**
 * How many bytes are gathered before the format is decided: SQLite's header,
 * which is the longer of the two magics (a zip's is four).
 */
export const SNIFF_BYTES = 16;

/**
 * ***How long an upload may send nothing before it is abandoned*** — [P13.8]'s
 * idle timeout.
 *
 * A minute: longer than any pause an upload that is still going makes — a
 * phone's radio waking, a proxy flushing its buffer — and short enough that a
 * client that went away frees the one large-upload slot and its half-written
 * file while the person who wants the slot is still at the screen. Idle, not
 * total, so a gigabyte over a slow link is never cut off for being slow.
 */
export const IMPORT_UPLOAD_IDLE_MS = 60_000;

/**
 * What a request's `Content-Length` may exceed the file's limit by and still
 * be let through to the byte count: the multipart envelope — boundaries, the
 * part's headers, the two short fields the route reads. A megabyte is
 * hundreds of times any honest envelope; the exact limit is the byte count's
 * to enforce, which counts the file alone, so this only has to be generous
 * enough never to refuse a file that fits.
 */
const ENVELOPE_SLACK_BYTES = MEGABYTE;

/** Which of the two formats a landed upload turned out to be. */
export type LandedFormat = 'zip' | 'sqlite';

/** A field that arrived ahead of the file, by name, or `null`. */
export type FieldReader = (name: string) => string | null;

export type ReceivedUpload =
  /** Buffered, as every upload was before [P13.8]: not an archive or a database. */
  | { kind: 'memory'; filename: string; bytes: Buffer; field: FieldReader }
  /**
   * ***Landed***: in `space`, as the file `name`. **`release()` must be
   * called**, in a `finally`, when whatever reads it is done: it removes the
   * space and gives up the large-upload slot if this upload held it.
   */
  | {
      kind: 'landed';
      filename: string;
      format: LandedFormat;
      space: ScratchSpace;
      name: string;
      field: FieldReader;
      release: () => Promise<void>;
    };

/** The names a landing takes inside its space — what it is, readable in a listing of what a crash left. */
const LANDED_NAMES: Record<LandedFormat, string> = {
  zip: 'upload.zip',
  // The name the probe looks for, so the landing *is* the root: §1.1's
  // `MemoryFileSource({ 'aventura.db': bytes })`, on disk.
  sqlite: 'aventura.db',
};

/**
 * Reads the one file part of an import, and either buffers it or lands it —
 * see the file header. Returns `null` having already answered, the way
 * `readOnePart` does.
 *
 * `idleMs` is a parameter for the tests that meet it; the route takes the
 * default.
 */
export async function receiveImportUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AppServices,
  idleMs: number = IMPORT_UPLOAD_IDLE_MS,
): Promise<ReceivedUpload | null> {
  // Read once, here, off the live reference: both apply to this request, and
  // a save part way through it applies to the next.
  const { maxUploadMb, maxImportUploadMb } = services.config.limits;
  const uploadLimit = maxUploadMb * MEGABYTE;
  const importLimit = maxImportUploadMb * MEGABYTE;
  const outerMb = Math.max(maxUploadMb, maxImportUploadMb);
  const outer = outerMb * MEGABYTE;

  const declared = declaredLength(request);
  if (declared !== null && declared > outer + ENVELOPE_SLACK_BYTES) {
    return refuse(reply, 413, tooLarge(outerMb, outerMb === maxImportUploadMb));
  }

  let file: MultipartFile | undefined;
  try {
    file = await request.file({ limits: { fileSize: outer, files: 1 } });
  } catch (error) {
    if (isTooLarge(error)) {
      return refuse(reply, 413, tooLarge(outerMb, outerMb === maxImportUploadMb));
    }
    void reply
      .code(415)
      .send({ error: 'not-multipart', message: 'Send one file as multipart/form-data.' });
    return null;
  }
  if (!file) {
    void reply.code(400).send({ error: 'no-file', message: 'No file in the request.' });
    return null;
  }

  const part = file;
  const field = fieldsOf(part);
  const chunks = part.file[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  /** Stops reading: the rest of the body is left to the socket's close. */
  const abandon = (): void => {
    part.file.destroy();
  };

  const taken = await takeHead(chunks, SNIFF_BYTES, idleMs);
  if (taken === 'idle') {
    abandon();
    return refuse(reply, 408, idle());
  }

  const format: LandedFormat | null = looksLikeZip(taken.head)
    ? 'zip'
    : looksLikeSqlite(taken.head)
      ? 'sqlite'
      : null;

  if (format === null) {
    // ***Buffered, under the limit it always had.*** Counted here rather than
    // left to busboy, whose `fileSize` is the larger of the two limits.
    const held: Uint8Array[] = [taken.head];
    let total = taken.head.byteLength;
    if (total > uploadLimit) {
      abandon();
      return refuse(reply, 413, tooLarge(maxUploadMb, false));
    }
    if (!taken.ended) {
      for (;;) {
        const step = await nextWithin(chunks, idleMs);
        if (step === 'idle') {
          abandon();
          return refuse(reply, 408, idle());
        }
        if (step.done === true) break;
        total += step.value.byteLength;
        if (total > uploadLimit) {
          abandon();
          return refuse(reply, 413, tooLarge(maxUploadMb, false));
        }
        held.push(step.value);
      }
    }
    // Only reachable when the two limits are equal, since a lower one is
    // counted out above before busboy's could end the stream.
    if (part.file.truncated) return refuse(reply, 413, tooLarge(maxUploadMb, false));
    return { kind: 'memory', filename: part.filename, bytes: Buffer.concat(held), field };
  }

  /**
   * ***Large* means larger than anything this server would have held in
   * memory** — or of a size nobody declared. Only those take the slot: a
   * CHARX of a few hundred kilobytes lands too, and two people importing
   * cards at once is not what [P13.8]'s *one large upload in flight* is for.
   */
  const large = declared === null || declared > uploadLimit;
  if (large) {
    if (services.largeUploadInFlight) {
      abandon();
      return refuse(
        reply,
        503,
        {
          error: 'upload-busy',
          message:
            'Another large import is being uploaded to this server. Try again when it has finished.',
        },
        { 'retry-after': '30' },
      );
    }
    // Taken before the first `await`, so two requests cannot both find it free.
    services.largeUploadInFlight = true;
  }
  const letGo = (): void => {
    if (large) services.largeUploadInFlight = false;
  };

  let space: ScratchSpace | null = null;
  const unwind = async (): Promise<void> => {
    letGo();
    await space?.dispose().catch(() => undefined);
  };

  try {
    // Before the space exists, so a refusal here leaves nothing to remove.
    await assertLandingRoom(services.freeBytes, services.layout.dataRoot, declared ?? importLimit);
    space = await openImportScratch(services.layout);
    const name = LANDED_NAMES[format];
    const landed = await landUpload({
      head: taken.head,
      ended: taken.ended,
      rest: chunks,
      target: space.path(name),
      maxBytes: importLimit,
      idleMs,
    });
    if (!landed.ok) {
      abandon();
      await unwind();
      return landed.why === 'idle'
        ? refuse(reply, 408, idle())
        : refuse(reply, 413, tooLarge(maxImportUploadMb, true));
    }
    if (part.file.truncated) {
      await unwind();
      return refuse(reply, 413, tooLarge(maxImportUploadMb, true));
    }

    const held = space;
    return {
      kind: 'landed',
      filename: part.filename,
      format,
      space: held,
      name,
      field,
      release: async () => {
        letGo();
        await held.dispose();
      },
    };
  } catch (error) {
    abandon();
    await unwind();
    // No room, found first — or `ENOSPC` from our own write, the same answer
    // arrived at late: `answeredNoRoom`'s two arms, answered here because this
    // is a refusal made with the body unread, and those close the connection.
    if (error instanceof LandingSpaceError) {
      return refuse(reply, 507, { error: 'no-space', message: error.message });
    }
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOSPC') {
      return refuse(reply, 507, {
        error: 'no-space',
        message: 'There is not enough free space on the disk to receive this upload.',
      });
    }
    throw error;
  }
}

/** The request's declared length, or `null` when it declared none (a chunked body). */
function declaredLength(request: FastifyRequest): number | null {
  const raw = request.headers['content-length'];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** The fields that arrived ahead of the file — `readOnePart`'s rule, and its reasons. */
function fieldsOf(file: MultipartFile): FieldReader {
  return (name) => {
    const found: unknown = (file.fields as Record<string, unknown>)[name];
    // A repeated field arrives as an array; the first wins rather than the last,
    // so a second copy cannot quietly override the one a person meant.
    const one: unknown = Array.isArray(found) ? (found as unknown[])[0] : found;
    const value = (one as { value?: unknown } | null | undefined)?.value;
    return typeof value === 'string' ? value : null;
  };
}

function isTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE'
  );
}

/**
 * ***The number that refused it, and which setting holds it*** — the 413
 * `readOnePart` has always sent, naming now which of the two limits a person
 * would change.
 */
function tooLarge(limitMb: number, isImportLimit: boolean): { error: string; message: string } {
  return {
    error: 'too-large',
    message: isImportLimit
      ? `That file is larger than the ${String(limitMb)} MB import upload limit.`
      : `That file is larger than the ${String(limitMb)} MB upload limit.`,
  };
}

function idle(): { error: string; message: string } {
  return {
    error: 'upload-stalled',
    message: 'The upload stopped arriving part way through. Try again.',
  };
}

/**
 * Answers a refusal and **closes the connection behind it** — see the file
 * header for why a refusal with the body unread must.
 */
function refuse(
  reply: FastifyReply,
  status: number,
  body: { error: string; message: string },
  headers: Record<string, string> = {},
): null {
  void reply
    .code(status)
    .headers({ ...headers, connection: 'close' })
    .send(body);
  return null;
}
