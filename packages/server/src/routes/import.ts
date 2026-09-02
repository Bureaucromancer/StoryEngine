// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type {
  ImportItemReport,
  ImportNote,
  ImportPreview,
  NearMissOffer,
} from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { classifyRoot } from '../import/detect.js';
import { planUpload, type ManifestEntry } from '../import/directory-upload.js';
import { MemoryFileSource } from '../import/memory-source.js';
import { nearMiss } from '../import/near-miss.js';
import { previewOne } from '../import/preview.js';
import { readUpload } from '../import/upload.js';
import { FORWARDED_SAMPLER_PARAMS } from '../providers/forwarded-params.js';
import {
  profileAsFileSource,
  readEnvelope,
  singleObjectAsFileSource,
} from '../import/marinara/envelope.js';
import type { ConflictPolicy } from '../import/identity.js';
import type { SourceRefusal } from '../import/source.js';
import {
  importNotesFor,
  listImports,
  readImport,
  recordImport,
  recordRefusal,
} from '../import/jobs.js';
import { convertOne, sweep } from '../import/sweep.js';
import { ZipFileSource } from '../import/zip-source.js';
import { looksLikeZip } from '../storage/zip.js';
import {
  openLocalSource,
  openParentSource,
  suggestedRoot,
  type LocalSource,
  type RootRefusal,
} from '../storage/local-source.js';

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
/**
 * The folder's parts, summed, went past the limit.
 *
 * Its own class rather than a flag checked after the loop, because the loop must
 * stop *at* the offending part: the point of the limit is not to report the size
 * afterwards but to stop buffering. Thrown from inside the iteration and caught
 * beside busboy's own refusal, which is the same answer in different words.
 */
class FolderTooLarge extends Error {}

/**
 * How many parts a folder upload may carry.
 *
 * The same number `DEFAULT_LOCAL_LIMITS` gives the directory walker and the
 * manifest schema gives its array — a tree this large is a mistake rather than a
 * library, and the three should agree about where that line is. The byte budget
 * is the real bound; this stops a folder of fifty thousand empty files from
 * being a way to spend the request anyway.
 *
 * **Untested, and named as such**: the byte budget above has a test that fails
 * when it is removed, and this does not — a case would have to build fifty
 * thousand parts to reach it. It is a backstop behind a bound that is checked,
 * not a second line of defence anybody has watched hold.
 */
const MAX_FOLDER_FILES = 50_000;

function isTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE'
  );
}

/**
 * A conflict policy off the wire, or nothing.
 *
 * **A word this build does not know is absent rather than refused**, which is
 * the opposite of how the sweep's TypeBox body treats the same three values —
 * and the difference is the transport rather than a change of mind. A JSON body
 * is validated as a whole and can say *this field is wrong*; a multipart field
 * arrives after the file has been buffered, so refusing here means throwing away
 * an upload that was otherwise fine over a spelling. The default it falls back
 * to is `replace`, which is the safe one: the write goes through version
 * history, so what it replaced becomes a version rather than a loss.
 */
function conflictPolicy(value: string | null): ConflictPolicy | undefined {
  return value === 'replace' || value === 'keep-both' || value === 'skip' ? value : undefined;
}

/**
 * One file part, the limit, and the three refusals both upload doors share.
 *
 * **Extracted when the preview arrived, before the second copy existed rather
 * than after.** The 413 below is not a check but a catch, the 415 is a `catch`
 * arm rather than a content-type test, and the truncation flag is read after the
 * buffer — three pieces of arranged-just-so control flow that would have been
 * copied verbatim and then drifted. `limits.maxUploadMb` is read here, per
 * request, off the live config reference, so both doors answer with whatever
 * number is set now.
 *
 * Returns `null` having already answered, the way `requireAccount` does.
 *
 * **`fields` carries the parts that arrived before the file, and only those.**
 * `request.file()` stops at the first file, so a text field sent after it is
 * never parsed — which is busboy's *fields before files* convention rather than
 * a limitation worth working around. The alternative is `request.parts()` and a
 * hand-rolled running size total, which `/import/directory` needs because it
 * takes many files and this does not. Callers that read a field say so, and
 * `docs/api.md` says so where a person writing a client will look.
 */
async function readOnePart(
  request: FastifyRequest,
  reply: FastifyReply,
  services: AppServices,
): Promise<{ filename: string; bytes: Buffer; field: (name: string) => string | null } | null> {
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
  const tooLarge = (): null => {
    void reply.code(413).send({
      error: 'too-large',
      message: `That file is larger than the ${String(services.config.limits.maxUploadMb)} MB upload limit.`,
    });
    return null;
  };

  let file;
  try {
    file = await request.file({ limits: { fileSize: limitBytes, files: 1 } });
  } catch (error) {
    if (isTooLarge(error)) return tooLarge();
    void reply
      .code(415)
      .send({ error: 'not-multipart', message: 'Send one file as multipart/form-data.' });
    return null;
  }
  if (!file) {
    void reply.code(400).send({ error: 'no-file', message: 'No file in the request.' });
    return null;
  }

  let bytes: Buffer;
  try {
    bytes = await file.toBuffer();
  } catch (error) {
    if (isTooLarge(error)) return tooLarge();
    throw error;
  }
  if (file.file.truncated) return tooLarge();

  const field = (name: string): string | null => {
    const found: unknown = (file.fields as Record<string, unknown>)[name];
    // A repeated field arrives as an array; the first wins rather than the last,
    // so a second copy cannot quietly override the one a person meant.
    const one: unknown = Array.isArray(found) ? (found as unknown[])[0] : found;
    const value = (one as { value?: unknown } | null | undefined)?.value;
    return typeof value === 'string' ? value : null;
  };

  return { filename: file.filename, bytes, field };
}

export function registerImportRoutes(app: FastifyInstance, services: AppServices): void {
  app.post('/import/file', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    // CSRF is the app-wide hook's business and applies here like any mutation —
    // named because an upload route is exactly where somebody would be tempted
    // to make an exception for a form post.
    const part = await readOnePart(request, reply, services);
    if (part === null) return;

    /**
     * **What a re-import does, which this route did not ask until now.**
     *
     * `onConflict` has been plumbed through the sweep and the folder upload
     * since P4.4, and the single-file door ignored it — so re-uploading a
     * changed preset silently replaced, with no way to say otherwise. That was
     * survivable while the answer arrived after the write; it is not once the
     * preview asks the question first, because a screen that offers *replace or
     * keep both* has to be able to send it.
     *
     * An unknown value is treated as absent rather than refused: the default is
     * `replace`, and `replace` is the safe one — the write goes through version
     * history, so what it replaced becomes a version rather than a loss.
     */
    const onConflict = conflictPolicy(part.field('onConflict'));

    const result = await importOneFile(
      services,
      account.handle,
      part.filename,
      part.bytes,
      onConflict,
    );
    return reply.code(result.item.disposition === 'converted' ? 201 : 200).send(result);
  });

  /**
   * What that upload *would* do, with nothing written
   * ([05 §5](../../../../docs/design/05-ui-surfaces.md), as amended).
   *
   * **A POST that writes nothing**, and the two halves of that are separate
   * claims. POST because the body carries a file and because the CSRF header
   * rides along with it — a look that a cross-site form could take is a look
   * worth refusing. Writes nothing because that is the entire point of the
   * route: the person is being shown a converted preset in order to decide
   * whether to have it.
   *
   * **The commit is a second upload of the same bytes to `/import/file`**, not a
   * POST of the object this returns, and that is the decision this route's shape
   * rests on. Sending the converted object to `/api/library/presets` would have
   * been less work and would have cost four things at once: `stampImported`
   * never runs, so re-import identity is dead for that object forever;
   * `identify` never runs, so every later re-import doubles; nothing reaches the
   * job ledger, so `importNotesFor` can never find the object's own review; and
   * the credential rule moves from the converter to the client, which is where
   * it least belongs. One write path, and this is a way of looking at it rather
   * than a second one.
   *
   * So the bytes travel twice. A preset is kilobytes, and the cost buys the
   * property that **what lands is always what the converter says about the bytes
   * that arrived** — if the file changed in between, the commit's report is the
   * truth and the preview was a prediction that expired.
   *
   * **`200` for everything the reader can answer about**, including files it
   * does not recognise. A file is a fact about the world rather than a malformed
   * request, which is the shape `/import/file` already takes.
   */
  app.post('/import/file/preview', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const part = await readOnePart(request, reply, services);
    if (part === null) return;

    return reply
      .code(200)
      .send({ preview: await previewUpload(services, account.handle, part.filename, part.bytes) });
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

    // **Advice rides beside the report, never inside it.** `ImportReport` is the
    // durable record of what the library received; a near miss is a fact about
    // the *request*, and putting it in the report would make somebody’s stored
    // history carry a sentence about a folder they have since fixed. The same
    // reason `UploadResult` carries `notes` beside `item` rather than in it.
    //
    // `jobId` is the exception that proves it: it names *this* record, so it
    // belongs to the report rather than beside it.
    return reply.code(200).send({
      report: { ...outcome.report, jobId },
      suggestions: await adviseOn(services, body.root, opened.source),
    });
  });

  /**
   * What a folder is, without importing anything from it.
   *
   * **The same gates as the sweep, and deliberately not fewer.** This reads a
   * foreign directory through the server's own user exactly as the sweep does,
   * so it is behind `fileAccess` and behind `openLocalSource`'s `/data`
   * carve-out. A cheaper check that skipped either would be a way to ask
   * questions about the filesystem that the route which actually reads it
   * refuses to answer.
   *
   * **It never lists a directory.** Every answer here is a yes/no probe at a
   * path this build already names in its own source, which is what keeps it on
   * the right side of [05 §4.2.2]'s line — the sweep report is kept relative so
   * the review does not become a filesystem map, and an endpoint that enumerated
   * children would hand back exactly the map that clause refuses. What a person
   * learns from this is whether the folder they already named is the one to use.
   */
  app.post('/import/inspect', { schema: { body: InspectBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    if (account.capabilities.fileAccess === 'none') {
      return reply.code(403).send({
        error: 'no-file-access',
        message: 'This account may not point the server at a directory.',
      });
    }

    const body = request.body as { root: string };
    const opened = await openLocalSource(body.root, services.layout.dataRoot);
    if (!opened.ok) {
      return reply
        .code(422)
        .send({ error: opened.refusal, message: refusalMessage(opened.refusal) });
    }

    const classified = await classifyRoot(opened.source);
    if (!classified.ok) {
      return reply
        .code(422)
        .send({ error: classified.refusal, message: sweepRefusalMessage(classified.refusal) });
    }

    return reply.code(200).send({
      verdict: classified.kind,
      suggestions: await adviseOn(services, body.root, opened.source),
    });
  });

  /**
   * What a picked folder is, from its **names alone** — the first half of the
   * browser directory upload ([P4 §7.13]).
   *
   * **No `fileAccess` gate here, and that is the point of the transport.** The
   * sweep reads the host's filesystem through the server's own user, which is
   * why [05 §4.2.2] grants it to *somebody you would give a shell to*. This
   * reads nothing: the browser has already opened the folder under the person's
   * own credentials, and what arrives is a list of names they chose to send. An
   * account that may upload one file may upload a folder of them.
   *
   * The manifest is enough to classify, because every probe is an existence
   * question. So the verdict, the near-miss advice and the list of files worth
   * carrying all come back before a single byte is uploaded — which is what
   * keeps a thirty-directory tree from being sent to discover that most of it is
   * chats.
   */
  app.post('/import/directory/plan', { schema: { body: ManifestBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as { entries: ManifestEntry[] };
    const files = new MemoryFileSource(
      {},
      body.entries.map((entry) => entry.path),
    );

    const classified = await classifyRoot(files);
    if (!classified.ok) {
      return reply
        .code(422)
        .send({ error: classified.refusal, message: sweepRefusalMessage(classified.refusal) });
    }

    const plan = planUpload(
      classified.kind,
      body.entries,
      services.config.limits.maxUploadMb * MEGABYTE,
    );

    // The same advice the sweep gives, from the same module — a folder picked in
    // a browser is as easy to get wrong as one typed, and more so, since the
    // picker shows names without saying which is the one to choose.
    const found = await nearMiss({ files });

    return reply.code(200).send({
      verdict: classified.kind,
      suggestions: found.map((miss) => ({ ...miss, root: null })),
      ...plan,
    });
  });

  /**
   * The folder itself — the second half ([P4 §7.13]).
   *
   * Takes the manifest again alongside the files, because the two are one claim:
   * *this is the folder, and these are the parts of it you asked for*. Anything
   * named and not sent becomes a `declared` path — listed and reported, never
   * read — so the review accounts for the whole folder rather than for the
   * fraction that travelled.
   */
  app.post('/import/directory', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const limitBytes = services.config.limits.maxUploadMb * MEGABYTE;
    const carried: Record<string, Uint8Array> = {};
    let manifest: string[] = [];
    let onConflict: ConflictPolicy | undefined;

    let carriedBytes = 0;

    try {
      for await (const part of request.parts({
        limits: { fileSize: limitBytes, files: MAX_FOLDER_FILES },
      })) {
        if (part.type === 'file') {
          // The browser sends `webkitRelativePath` as the field name, because a
          // multipart filename cannot carry a directory and survive: every
          // sanitiser in the chain would strip it, and rightly.
          const bytes = await part.toBuffer();

          /**
           * **The limit is the folder's, not each file's**, and the two halves
           * of this transport disagreed about that until a test said so.
           * `planUpload` spends `maxUploadMb` as a running total across every
           * file it asks for; busboy's `fileSize` is per part. So a folder of a
           * thousand files each just under the limit was a thousand times the
           * limit, buffered into one object in memory — and this route is
           * deliberately not behind `fileAccess`, so any signed-in account could
           * send it. A limit a well-behaved client respects and the server does
           * not enforce is not a limit.
           */
          carriedBytes += bytes.byteLength;
          if (carriedBytes > limitBytes) throw new FolderTooLarge();

          carried[relativePath(part.fieldname)] = bytes;
          continue;
        }
        if (part.fieldname === 'manifest') manifest = parseManifest(String(part.value));
        if (part.fieldname === 'onConflict') onConflict = String(part.value) as ConflictPolicy;
      }
    } catch (error) {
      // Either half: busboy refusing one oversized part, or the running total
      // above refusing the folder. Both are the same answer to a person.
      if (error instanceof FolderTooLarge || isTooLarge(error)) {
        return reply.code(413).send({
          error: 'too-large',
          message: `That folder is larger than the ${String(services.config.limits.maxUploadMb)} MB upload limit.`,
        });
      }
      return reply
        .code(415)
        .send({ error: 'not-multipart', message: 'Send the folder as multipart/form-data.' });
    }

    if (manifest.length === 0) {
      return reply
        .code(400)
        .send({ error: 'no-manifest', message: 'A folder upload needs its manifest.' });
    }

    const files = new MemoryFileSource(carried, manifest);
    const outcome = await sweep({
      library: services.library,
      handle: account.handle,
      files,
      ...(onConflict === undefined ? {} : { onConflict }),
    });

    if (!outcome.ok) {
      return reply
        .code(422)
        .send({ error: outcome.refusal, message: sweepRefusalMessage(outcome.refusal) });
    }

    // No `suggestions`: a near miss names a *sibling folder* to point at, and a
    // browser upload has no path to point anywhere with. The plan step says it
    // before the upload, which is the moment a person can still act on it.
    return reply.code(200).send({ report: outcome.report });
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

  /**
   * What every import said about one object — [P5 §1.8].
   *
   * **The question is asked from the object, so the answer is addressed by
   * it.** §1.8 chose that over finishing the sweep's own report on the grounds
   * that somebody debugging an entry six months after an import will not think
   * to go looking for the sweep that created it. The facts they want — this
   * entry sat at a position with no equivalent here, the entry limit was
   * reduced, this book was scoped to one chat — are per *object*, and this is
   * the only route that answers per object.
   *
   * **An empty list rather than a 404 for an object with no notes**, which is
   * the common case and not an error: an object created by hand, or imported
   * through a route that does not record, simply has nothing to say. A 404
   * would make "nothing was recorded" and "no such thing" the same answer, and
   * the page has to tell them apart to say something honest.
   */
  app.get('/import/objects/:id/notes', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const { id } = request.params as { id: string };
    return reply.code(200).send({ notes: importNotesFor(services.state.db, account.handle, id) });
  });
}

/**
 * A relative path from a multipart field name, kept inside the folder.
 *
 * Segment-aware rather than a string check: `..` is what a crafted upload would
 * use to make a path that climbs, and although nothing here touches a disk —
 * these become keys in a `Map` — a path that escapes its root would still make
 * the review describe a folder nobody picked.
 */
function relativePath(fieldname: string): string {
  return fieldname
    .split(/[\\/]/)
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .join('/');
}

/** The manifest travels as one JSON field. A malformed one is no manifest. */
function parseManifest(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((path): path is string => typeof path === 'string').map(relativePath);
  } catch {
    return [];
  }
}

const ManifestBody = Type.Object(
  {
    entries: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1, maxLength: 4096 }),
          bytes: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 50_000 },
    ),
  },
  { additionalProperties: false },
);

/**
 * What to say about the folder somebody named, made absolute for a retry.
 *
 * **The parent is opened here rather than inside the detector**, because the
 * detector may not touch the filesystem — `node:fs` is confined to `storage/` —
 * and because a `FileSource` refuses to resolve outside its own root by
 * contract. `openParentSource` inherits every check `openLocalSource` makes,
 * carve-out included, and answers `null` for all the ordinary reasons there is
 * no folder above to read.
 *
 * Absolute paths appear only in `root`, which is the string a retry carries back
 * to a route that re-validates it from scratch. Nothing here is trusted later.
 */
async function adviseOn(
  services: AppServices,
  root: string,
  files: LocalSource,
): Promise<NearMissOffer[]> {
  const parent = await openParentSource(root, services.layout.dataRoot);
  const found = await nearMiss({ files, ...(parent === null ? {} : { parent }) });
  return Promise.all(
    found.map(async (miss) => ({
      ...miss,
      root: miss.suggest === null ? null : await suggestedRoot(root, miss.suggest),
    })),
  );
}

const InspectBody = Type.Object(
  { root: Type.String({ minLength: 1, maxLength: 4096 }) },
  { additionalProperties: false },
);

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
/**
 * The same three arms as {@link importOneFile}, answering *what would happen*.
 *
 * **Only the third arm can say much, and the seam is principled rather than
 * convenient.** A zip and a Marinara envelope are *roots*: previewing one means
 * a dry-run of a whole sweep, which would need `Writer` split into pure and
 * impure halves — and sweeps keep committing first and reporting, deliberately.
 * So those two arms answer honestly with *this is a folder in a file* and leave
 * the summary empty.
 *
 * The **flow** is still the same for every hand-picked file: a look, then a
 * word. Only the richness of the look varies. A preview that appeared for preset
 * JSON and not for the card PNG most people upload first would be §7.1's defect
 * committed a second time, on purpose.
 */
async function previewUpload(
  services: AppServices,
  handle: string,
  filename: string,
  bytes: Uint8Array,
): Promise<ImportPreview> {
  const blank = (
    disposition: ImportPreview['disposition'],
    notes: ImportNote[],
    object: ImportPreview['object'],
  ): ImportPreview => ({
    source: filename,
    disposition,
    notes,
    advisories: [],
    object,
    reimport: 'unknown',
  });

  // Tried first and by signature rather than by parse, exactly as the import
  // path does: a zip is never JSON.
  if (looksLikeZip(bytes)) {
    const opened = ZipFileSource.open(bytes);
    if (!opened.ok) {
      return blank(
        'unrecognised',
        [
          {
            key: 'import.file.badArchive',
            params: { file: filename, refusal: opened.refusal },
            level: 'warn',
          },
        ],
        null,
      );
    }
    // Opened and discarded. The archive is validated so a broken one is refused
    // here rather than at commit; what is inside it is the sweep's business.
    return blank(
      'converted',
      [{ key: 'import.file.importsAsFolder', params: { file: filename }, level: 'info' }],
      { kind: 'sweep' },
    );
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // Not JSON, which is very likely a card. The reader below decides.
  }

  if (parsed !== null && readEnvelope(parsed) !== null) {
    return blank(
      'converted',
      [{ key: 'import.file.importsAsFolder', params: { file: filename }, level: 'info' }],
      { kind: 'sweep' },
    );
  }

  const read = readUpload(filename, bytes);
  if (read.outcome === 'observed') {
    // Unrecognised, or one of the three templates that are named and never
    // converted. Either way the reader has already said it in the right words.
    return blank(read.report.disposition, read.report.notes, null);
  }

  return previewOne({
    library: services.library,
    handle,
    filename,
    candidate: read.candidate,
    forwarded: FORWARDED,
  });
}

/**
 * The sampler parameters this build puts on the wire, as a set.
 *
 * Built once here rather than inside `previewOne`, which takes it as an
 * argument so that `import/` stays ignorant of what a provider is — the same
 * fence `source.ts` puts around the converters.
 */
const FORWARDED: ReadonlySet<string> = new Set<string>(FORWARDED_SAMPLER_PARAMS);

async function importOneFile(
  services: AppServices,
  handle: string,
  filename: string,
  bytes: Uint8Array,
  onConflict?: ConflictPolicy,
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

    const outcome = await sweep({
      library: services.library,
      handle,
      files: opened.source,
      ...(onConflict === undefined ? {} : { onConflict }),
    });
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

    const outcome = await sweep({
      library: services.library,
      handle,
      files,
      ...(onConflict === undefined ? {} : { onConflict }),
    });
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
    {
      library: services.library,
      handle,
      files: new MemoryFileSource({ [filename]: bytes }),
      ...(onConflict === undefined ? {} : { onConflict }),
    },
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
