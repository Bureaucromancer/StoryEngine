// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import type { ImportItemReport, ImportNote } from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { MemoryFileSource } from '../import/memory-source.js';
import { readUpload } from '../import/upload.js';
import {
  profileAsFileSource,
  readEnvelope,
  singleObjectAsFileSource,
} from '../import/marinara/envelope.js';
import type { ConflictPolicy } from '../import/identity.js';
import type { SourceRefusal } from '../import/source.js';
import { listImports, readImport, recordImport, recordRefusal } from '../import/jobs.js';
import { convertOne, sweep } from '../import/sweep.js';
import { ZipFileSource } from '../import/zip-source.js';
import { looksLikeZip } from '../storage/zip.js';
import { openLocalSource, type RootRefusal } from '../storage/local-source.js';

/**
 * The first upload route this server has had
 * ([P4 §1.3](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **One file, not a sweep.** A directory sweep is a job with a review report at
 * its own address, and that is P4.4's. This is what somebody does when they have
 * a preset and want it in their library: the thing people use forever after, and
 * what [17 §14](../../../../docs/design/17-write-mode.md)'s content-import
 * posture later leans on — which is why §5 puts it on the must-not-cut list.
 *
 * **The limit is checked per request, off the live config reference**, which is
 * what flips `limits.maxUploadMb` from `unread` to `applied` after it spent
 * three phases as [13 §4.3]'s standing example of an honestly-unread key.
 * Fastify's constructor `bodyLimit` stays as the outer bound: it refuses a body
 * before it is read, and this is the number a person actually set.
 */

/** What the route answers with — one item's worth of the review vocabulary. */
interface UploadResult {
  item: ImportItemReport;
  notes: ImportNote[];
}

const MEGABYTE = 1024 * 1024;

/** `@fastify/multipart`'s overrun signal, by code rather than by class. */
function isTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE'
  );
}

export function registerImportRoutes(app: FastifyInstance, services: AppServices): void {
  app.post('/import/file', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    // CSRF is the app-wide hook's business and applies here like any mutation —
    // named because an upload route is exactly where somebody would be tempted
    // to make an exception for a form post.
    const limitBytes = services.config.limits.maxUploadMb * MEGABYTE;

    /**
     * Over the limit is a **413 with the number in it**, and getting that takes
     * a catch rather than a check.
     *
     * The plugin signals the overrun by throwing `FST_REQ_FILE_TOO_LARGE` out of
     * the read, so `file.truncated` is never reached — and left to the app's
     * error handler the caller would get `400 invalid`, which says *your request
     * was malformed* about a request that was fine and merely large. The message
     * names the limit because *too large* without a number is something a person
     * cannot act on.
     */
    const tooLarge = (): unknown =>
      reply.code(413).send({
        error: 'too-large',
        message: `That file is larger than the ${String(services.config.limits.maxUploadMb)} MB upload limit.`,
      });

    let file;
    try {
      file = await request.file({ limits: { fileSize: limitBytes, files: 1 } });
    } catch (error) {
      if (isTooLarge(error)) return tooLarge();
      return reply
        .code(415)
        .send({ error: 'not-multipart', message: 'Send one file as multipart/form-data.' });
    }
    if (!file) {
      return reply.code(400).send({ error: 'no-file', message: 'No file in the request.' });
    }

    let bytes: Buffer;
    try {
      bytes = await file.toBuffer();
    } catch (error) {
      if (isTooLarge(error)) return tooLarge();
      throw error;
    }
    if (file.file.truncated) return tooLarge();

    const result = await importOneFile(services, account.handle, file.filename, bytes);
    return reply.code(result.item.disposition === 'converted' ? 201 : 200).send(result);
  });

  /**
   * The server-path sweep — point the server at a data directory
   * ([P4 §1.3]).
   *
   * **Gated on `fileAccess`, as [05 §4.2.2] widened it**, and the widening is
   * only safe because of what `openLocalSource` refuses: a root inside `/data`.
   * Without that, this route would be a way for one account to read another's
   * library, which the scope table says `never`.
   *
   * `read` is enough. The sweep never writes to the source, and requiring
   * `write` would mean asking for a permission over the user's own files in
   * order to read somebody else's.
   */
  app.post('/import/sweep', { schema: { body: SweepBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    if (account.capabilities.fileAccess === 'none') {
      return reply.code(403).send({
        error: 'no-file-access',
        message: 'This account may not point the server at a directory.',
      });
    }

    const body = request.body as { root: string; onConflict?: ConflictPolicy };
    const opened = await openLocalSource(body.root, services.layout.dataRoot);
    if (!opened.ok) {
      // Recorded here as well as below, because **there are two places a root can
      // be turned away** and only one of them was reached at first: this one
      // rejects the path itself — missing, relative, inside our own data
      // directory — and never gets as far as a source to classify. A refusal
      // ledger that quietly held half the refusals would be worse than none.
      recordRefusal(services.state.db, {
        account: account.handle,
        root: body.root,
        refusal: opened.refusal,
        at: Date.now(),
      });
      // The root is named back only in the message a person asked for. It never
      // reaches a log line or a per-item row ([13 §4.1.1]).
      return reply
        .code(422)
        .send({ error: opened.refusal, message: refusalMessage(opened.refusal) });
    }

    const outcome = await sweep({
      library: services.library,
      handle: account.handle,
      files: opened.source,
      ...(body.onConflict === undefined ? {} : { onConflict: body.onConflict }),
    });

    if (!outcome.ok) {
      // Recorded even though nothing was written, because *why did my import not
      // happen* is a question with an answer, and it should live where every
      // other answer lives rather than in a toast somebody dismissed ([§7.4]).
      recordRefusal(services.state.db, {
        account: account.handle,
        root: body.root,
        refusal: outcome.refusal,
        at: Date.now(),
      });
      return reply
        .code(422)
        .send({ error: outcome.refusal, message: sweepRefusalMessage(outcome.refusal) });
    }

    /**
     * **The report gets an address**, which is what §1.4 always asked for and
     * P4.4 cut ([§7.4], gate step 11).
     *
     * The id is put on the report the caller already receives rather than
     * offered as a separate call: the panel has the answer in front of it and
     * needs the link, and a client that has to ask twice for the same thing is
     * how the second call goes unwritten.
     */
    const jobId = recordImport(services.state.db, {
      account: account.handle,
      root: body.root,
      source: outcome.report.source,
      items: outcome.report.items,
      at: Date.now(),
    });

    return reply.code(200).send({ report: { ...outcome.report, jobId } });
  });

  /**
   * Past imports, and one of them in full ([P4 §7.4]).
   *
   * Two routes rather than one because they answer different questions — *what
   * have I imported* and *what happened in that one* — and the list deliberately
   * carries counts rather than items: a sweep of a real library is thousands of
   * rows, and a list that inlined them would be a page nobody could load in
   * order to find the one they wanted.
   */
  app.get('/import/jobs', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    return reply.code(200).send({ jobs: listImports(services.state.db, account.handle) });
  });

  app.get('/import/jobs/:id', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const { id } = request.params as { id: string };
    const report = readImport(services.state.db, account.handle, id);
    if (report === null) {
      // 404 whether it is missing or somebody else's — [04 §4.4]'s posture,
      // which is what stops an id being a probe for what other people imported.
      return reply.code(404).send({ error: 'not-found', message: 'No such import.' });
    }
    return reply.code(200).send({ report });
  });
}

const SweepBody = Type.Object(
  {
    /** Absolute, and outside the data directory. Both are refused rather than fixed up. */
    root: Type.String({ minLength: 1, maxLength: 4096 }),
    onConflict: Type.Optional(
      Type.Union([Type.Literal('replace'), Type.Literal('keep-both'), Type.Literal('skip')]),
    ),
  },
  { additionalProperties: false },
);

function refusalMessage(refusal: RootRefusal): string {
  switch (refusal) {
    case 'inside-data-root':
      return 'That folder is inside this install’s own data directory. Import reads other applications’ folders.';
    case 'not-absolute':
      return 'Give the full path to the folder.';
    case 'unreadable-root':
      return 'There is no readable folder at that path.';
  }
}

function sweepRefusalMessage(refusal: SourceRefusal): string {
  switch (refusal) {
    case 'live-install':
      return 'That application is running, or is part-way through an upgrade. Close it and try again.';
    case 'unknown-format':
      return 'That folder was written by a newer version than this build understands.';
    case 'ambiguous-root':
      return 'That folder looks like two different applications at once.';
    case 'unreadable-root':
      return 'There is nothing readable at that path.';
  }
}

/**
 * Classifies one uploaded file and converts it if this build can.
 *
 * ~~**What it cannot convert yet is `recorded`, not an error.** At P4.1 only
 * presets convert; cards and lorebooks arrive at P4.2.~~ *Rewritten at the P4
 * completeness audit ([P4 §7.1]).* That paragraph was true when it was written
 * and this route kept acting on it for three stages after it stopped being
 * true: P4.2 landed cards and lorebooks in the sweep and nothing taught them to
 * the upload, so the single most common import there is — one card — came back
 * `recorded` with a note claiming the build was unfinished.
 *
 * **It now has no converter of its own.** The file is read by `readUpload`, the
 * third reader §1.3 always described, and written by `convertOne`, which is the
 * sweep's own engine. What is left here is transport: multipart, size, and
 * turning a list of reports back into one answer.
 *
 * A file this build genuinely cannot identify is `unrecognised` and says so.
 * `recorded` survives for the one case that still earns it — a Marinara export
 * whose *type* we know and whose destination does not exist yet — because that
 * is the class that means **read, named, nowhere to put it**, and a card is no
 * longer an example of it.
 */
async function importOneFile(
  services: AppServices,
  handle: string,
  filename: string,
  bytes: Uint8Array,
): Promise<UploadResult> {
  const item = (
    disposition: ImportItemReport['disposition'],
    notes: ImportNote[],
    objectId?: string,
  ): UploadResult => ({
    // Named as it arrived, never as a path: the foreign-path doctrine applies to
    // a single upload as much as to a sweep ([13 §4.1.1]).
    item: { source: filename, disposition, notes, ...(objectId ? { objectId } : {}) },
    notes,
  });

  /**
   * **An archive is a root, so it is swept rather than read as an item**
   * ([P4 §1.3], [§7.5]).
   *
   * This is the same argument the profile envelope below makes, and it pays for
   * three things at once rather than one: a CHARX (`card.json` and its assets),
   * a zipped Marinara data root — the archive form P4.3 deferred for want of
   * exactly this reader — and a zip somebody made of their cards folder, which
   * classifies as `loose-files` and sweeps like any other. None of the readers
   * learns that the bytes came out of an archive.
   *
   * Tried before JSON because a zip is never JSON, and `looksLikeZip` is a
   * four-byte signature rather than a parse.
   */
  if (looksLikeZip(bytes)) {
    const opened = ZipFileSource.open(bytes);
    if (!opened.ok) {
      return item('unrecognised', [
        {
          key: 'import.file.badArchive',
          params: { file: filename, refusal: opened.refusal },
          level: 'warn',
        },
      ]);
    }

    const outcome = await sweep({ library: services.library, handle, files: opened.source });
    if (!outcome.ok) {
      return item('unrecognised', [
        {
          key: 'import.file.refused',
          params: { file: filename, refusal: outcome.refusal },
          level: 'warn',
        },
      ]);
    }
    return reportAsUpload(filename, outcome.report.items);
  }

  // Marinara's own export formats, which are the same reader over a different
  // file source ([P4 §1.3]) — a `.marinara.json` is one row of a table that
  // happens to have travelled alone.
  //
  // Tried first, and only if the bytes are JSON at all: an envelope can carry a
  // whole profile, so it is a *source* rather than an item and cannot go through
  // the single-item reader below.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // Not JSON. That is not a failure — it is very likely a card — and the
    // reader below is what decides.
  }

  const envelope = parsed === null ? null : readEnvelope(parsed);
  if (envelope !== null) {
    const files =
      envelope.type === 'marinara_profile'
        ? profileAsFileSource(envelope.data)
        : singleObjectAsFileSource(envelope);

    if (files === null) {
      return item('recorded', [
        {
          key: 'import.file.notYetConvertible',
          params: { file: filename, kind: envelope.type },
          level: 'info',
        },
      ]);
    }

    const outcome = await sweep({ library: services.library, handle, files });
    if (!outcome.ok) {
      return item('unrecognised', [
        {
          key: 'import.file.refused',
          params: { file: filename, refusal: outcome.refusal },
          level: 'warn',
        },
      ]);
    }
    return reportAsUpload(filename, outcome.report.items);
  }

  // Everything else is one item from the upload reader, written by the sweep's
  // own engine ([P4 §7.1]). The file source holds the single file so that a
  // card's portrait — `assets: [filename]` — resolves the same way it does in a
  // directory walk.
  const read = readUpload(filename, bytes);
  if (read.outcome === 'observed') return { item: read.report, notes: read.report.notes };

  const reports = await convertOne(
    { library: services.library, handle, files: new MemoryFileSource({ [filename]: bytes }) },
    read.candidate,
  );

  /**
   * A card that names a scenario produces an actor *and* a treatment, so the
   * route has to choose which row is the answer. It is always the **first**,
   * which is the uploaded file's own — `convertOne` returns it ahead of anything
   * `flushTreatments` synthesises.
   *
   * **Not `find(converted)`**, which is what this said first and which an
   * adversarial review of the fix caught. A re-imported card's own row reads
   * `unchanged`, not `converted`, so `find` skipped it and answered with the
   * treatment — whose `source` is `Scenario: …` rather than a filename. Upload
   * the same card twice and the second response names a file the person never
   * had. The envelope arm above keeps `find`, and correctly: a profile is a
   * whole sweep with no single file row to be first.
   *
   * Every note travels regardless, so nothing the treatment reported is lost by
   * not being the row that was chosen.
   */
  const notes = reports.flatMap((row) => row.notes);
  const answer = reports[0];
  if (answer === undefined) {
    return item('unrecognised', [
      { key: 'import.file.unrecognised', params: { file: filename }, level: 'warn' },
    ]);
  }
  return { item: { ...answer, notes }, notes };
}

/**
 * A whole sweep's report, answered as one upload result.
 *
 * **Shared by the two arms that turn one file into a root** — a Marinara
 * envelope and an archive ([P4 §7.5]) — because they had the same three lines
 * and the same reasoning, and two copies of a rule about *which row is the
 * answer* is how the two arms start giving different ones. That is not
 * hypothetical: [§7.9]'s review found the single-file arm answering with a
 * treatment it had synthesised, and this is the same choice made once.
 *
 * `find(converted)` rather than the first row, and here it is right where it was
 * wrong for a single file: an archive has no row that *is* the uploaded file —
 * every row names something inside it — so there is nothing to prefer, and the
 * thing a person wants to see is what landed. Every note travels regardless.
 */
function reportAsUpload(filename: string, items: readonly ImportItemReport[]): UploadResult {
  const converted = items.find((row) => row.disposition === 'converted');
  return {
    item: converted ?? { source: filename, disposition: 'recorded', notes: [] },
    notes: items.flatMap((row) => row.notes),
  };
}
