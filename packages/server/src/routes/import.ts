// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type {
  ImportDestination,
  ImportItemReport,
  ImportNote,
  ImportPreview,
  ImportReport,
  NearMissOffer,
} from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { classifyRoot } from '../import/detect.js';
import { planUpload, type ManifestEntry } from '../import/directory-upload.js';
import { MemoryFileSource } from '../import/memory-source.js';
import { nearMiss } from '../import/near-miss.js';
import { previewOne } from '../import/preview.js';
import { SILLYTAVERN_CHAT_FORMAT } from '../import/sillytavern/chat.js';
import { readAvtUpload, readUpload } from '../import/upload.js';
import type { AvtStory } from '../import/aventuras/avt.js';
import { priorSessionImport } from '../sessions/import.js';
import { FORWARDED_SAMPLER_PARAMS } from '../providers/forwarded-params.js';
import {
  profileAsFileSource,
  readEnvelope,
  singleObjectAsFileSource,
  type MarinaraEnvelope,
} from '../import/marinara/envelope.js';
import type { ConflictPolicy } from '../import/identity.js';
import type { SourceRefusal } from '../import/source.js';
import {
  importNotesFor,
  listImports,
  readImport,
  recordedRootFor,
  recordImport,
  recordRefusal,
} from '../import/jobs.js';
import {
  convertOne,
  countBy,
  sweep,
  type SweepOutcome,
  type SweepRequest,
} from '../import/sweep.js';
import { ZipFileSource } from '../import/zip-source.js';
import { LandedDatabaseSource, LandedZipSource } from '../import/landed-source.js';
import type { FileSource } from '../import/source.js';
import { readSession } from '../sessions/store.js';
import { looksLikeSqlite, SnapshotSpaceError } from '../storage/sqlite-snapshot.js';
import { LandingSpaceError } from '../storage/upload-landing.js';
import { looksLikeZip } from '../storage/zip.js';
import { DEFAULT_ZIP_FILE_LIMITS } from '../storage/zip-file.js';
import { receiveImportUpload, type ReceivedUpload } from './import-upload.js';
import {
  openLocalSource,
  openParentSource,
  suggestedRoot,
  type LocalSource,
  type RootRefusal,
} from '../storage/local-source.js';

/**
 * The first upload route this server has had
 * ([P4 §1.3](../../../../docs/design/workplan/16-p4-implementation.md)).
 *
 * **One file, not a sweep.** A directory sweep is a job with a review report at
 * its own address, and that is P4.4's. This is what somebody does when they have
 * a preset and want it in their library: the thing people use forever after, and
 * what [13 §14](../../../../docs/design/13-write-mode.md)'s content-import
 * posture later leans on — which is why §5 puts it on the must-not-cut list.
 *
 * **The limit is checked per request, off the live config reference**, which is
 * what flips `limits.maxUploadMb` from `unread` to `applied` after it spent
 * three phases as [22 §4.3]'s standing example of an honestly-unread key.
 * ~~Fastify's constructor `bodyLimit` stays as the outer bound: it refuses a
 * body before it is read, and this is the number a person actually set.~~
 * *Corrected 2026-09-27:* `bodyLimit` bounds the bodies Fastify's own parsers
 * read, and the multipart plugin reads none, so this is the only bound on an
 * upload, and the one that counts its bytes.
 */

/** What the route answers with — one item's worth of the review vocabulary. */
interface UploadResult {
  item: ImportItemReport;
  notes: ImportNote[];
  /**
   * ***The whole review, when the file was a root*** —
   * [P13.7](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   * Absent for a single file, whose one row is the review.
   *
   * `item` and `notes` answer an archive as though it were one file, which
   * was a fair summary of a zip of cards and is not one of an Aventuras
   * backup: a library of rows answered with its first converted row, and the
   * second upload of the same backup with one `recorded` row named for the
   * zip — so *everything was unchanged*, the answer a re-import exists to
   * give, could not be read through this door at all, where the sweep and the
   * folder upload both give it row by row. The report is carried beside the
   * summary rather than instead of it so a client that reads only `item` goes
   * on working. ~~its `jobId` is `unsaved`, as the folder upload's is, since
   * neither upload door records a job.~~ *Both doors record one since
   * 2026-09-28*, and the report carries its id.
   */
  report?: ImportReport;
  /**
   * ***The recorded upload's id*** (2026-09-28), for a single file as for a
   * root, so the review can be opened again from *Earlier imports* and the
   * object's page can say what the import said about it.
   */
  jobId?: string;
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

/**
 * ***No room to copy somebody's database is a state of the disk, not a server
 * fault*** — [P13.2](../../../../docs/design/workplan/30-p13-aventuras-import.md),
 * answering `routes/backups.ts`'s way: `507 no-space`, with the numbers.
 *
 * An Aventuras sweep takes a private copy of the database before it reads a
 * row (`storage/sqlite-snapshot.ts`), and a copy the size of somebody's
 * install is the one thing an import does that can fill the data volume. The
 * snapshot checks for room first and throws `SnapshotSpaceError` when there is
 * none, which is the right thing for it to do and was the error handler's bare
 * `500` until this: logged as *Unhandled error*, and answered with a sentence
 * that said nothing a person could act on. `ENOSPC` is the same answer arrived
 * at late — something else filled the disk while the copy was written, noticed
 * by our own write or by SQLite's, which the snapshot throws with that code.
 *
 * Answers and returns `true` when it was one of those; the caller rethrows
 * anything else. Exported for its own test: a late `ENOSPC` is the one arm no
 * route test can make happen, since the services' `freeBytes` seam produces
 * only the early one.
 */
export function answeredNoRoom(error: unknown, reply: FastifyReply): boolean {
  const late = (error as NodeJS.ErrnoException | null)?.code === 'ENOSPC';
  // `LandingSpaceError` since [P13.8]: the landing answers its own, with the
  // connection closed behind it, and this is the backstop for one that is not.
  const early = error instanceof SnapshotSpaceError || error instanceof LandingSpaceError;
  if (!early && !late) return false;
  void reply.code(507).send({
    error: 'no-space',
    message: early
      ? error.message
      : 'There is not enough free space on the disk to read this import.',
  });
  return true;
}

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
 * Which kind a source with a choice should become, off the wire.
 *
 * Unknown means absent, on `conflictPolicy`'s reasoning directly above: this
 * field arrives after the file has been buffered, and refusing here throws away
 * an upload that was otherwise fine over a spelling. Absent falls back to
 * `treatment`, which is the reading the converter would have taken anyway.
 */
function destination(value: string | null): ImportDestination | undefined {
  return value === 'treatment' || value === 'lorebook' ? value : undefined;
}

/**
 * ***Whether the sweep brings an Aventuras install's stories as sessions*** —
 * [P13.11](../../../../docs/design/workplan/30-p13-aventuras-import.md), and
 * `SweepRequest.stories` for why it is asked rather than assumed.
 *
 * **Only the word `true` asks**, off a multipart field as off a JSON body: a
 * sweep that writes sessions is the one kind a person has to take back one at
 * a time, so anything else — a missing field, `1`, `on` — is the default,
 * which writes none. The answer is the context the Writer needs, or nothing.
 */
function storiesFor(
  services: AppServices,
  asked: string | boolean | null | undefined,
): SweepRequest['stories'] {
  return asked === true || asked === 'true' ? { sessions: services.sessions } : undefined;
}

/**
 * One file part, the limit, and the three refusals both upload doors share.
 *
 * **Extracted when the preview arrived, before the second copy existed rather
 * than after.** The 413 below is not a check but a catch, the 415 is a `catch`
 * arm rather than a content-type test, and the truncation flag is read after the
 * buffer — three pieces of arranged-just-so control flow that would have been
 * copied verbatim and then drifted.
 *
 * ***Exported at [P10.4], when the third door arrived from outside this
 * module*** — `POST /api/me/avatar`, [12 §5.2]. That section calls the avatar
 * route *"the server's first upload"*, which was true when it was written and
 * had stopped being true by P4; what it names correctly is the three
 * obligations, and two of them — bound the size, take the bytes as received —
 * are this function. **The paragraph above predicted this exactly**, and the
 * export is that prediction paying off rather than a widening: the arranged
 * control flow stays in one place, and the avatar route adds only the sniffing
 * that is its own. `limits.maxUploadMb` is read here, per
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
export async function readOnePart(
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
    //
    // ***Not `readOnePart` since [P13.8]***: an archive or a database is landed
    // on disk rather than buffered (`import-upload.ts`), and everything else is
    // buffered under the limit it always had.
    const part = await receiveImportUpload(request, reply, services);
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

    /**
     * **Read the same way and for the same reason as `onConflict`: off the
     * parts that arrived ahead of the file.**
     *
     * `request.file()` stops at the file part, so a field appended after it is
     * accepted by `FormData`, sent by the browser, and never parsed — which
     * would silently ignore the one control the preview exists to offer. The
     * client's `importFile` carries that ordering rule in its own docstring;
     * this is the other half of it.
     */
    const into = destination(part.field('destination'));

    /**
     * ***And whether to bring stories*** — [P13.11]. Before the file for the
     * same reason again; read by an Aventuras database or backup and by
     * nothing else, which is every archive this door lands.
     */
    const stories = storiesFor(services, part.field('stories'));

    /**
     * ***`kind: chat` — the file must be a chat, or nothing is written*** —
     * [P14.8]. Play's *Import session* sends a `.jsonl` here and opens the
     * row's `objectId` as a session. Without this, a `.jsonl` that was really a
     * card or a lorebook went into the library through the door the person
     * used to load a conversation, and Play then navigated to a library id as
     * though it were a session. Read ahead of the file, as the two above are.
     */
    const only = part.field('kind') === 'chat' ? 'chat' : undefined;

    let result: UploadResult | null = null;
    let failure: { error: unknown } | null = null;
    try {
      // An archive holding an `aventura.db` is swept like any root, and the
      // sweep may need room for a copy of it.
      result =
        part.kind === 'landed'
          ? await importLanded(services, account.handle, part, onConflict, request.log, {
              stories,
              only,
            })
          : await importOneFile(
              services,
              account.handle,
              part.filename,
              part.bytes,
              onConflict,
              into,
              only,
            );
    } catch (error) {
      failure = { error };
    } finally {
      /**
       * The landing, and the large-upload slot, however the import ended —
       * ***and before anything is answered***. A reply sent first lets the
       * client, and the next request, see a server still holding a gigabyte
       * of scratch and the slot for a moment after it said it was done; found
       * by the test that looks at scratch as soon as a `507` arrives.
       */
      if (part.kind === 'landed') await part.release().catch(() => undefined);
    }
    if (failure !== null) {
      if (answeredNoRoom(failure.error, reply)) return reply;
      throw failure.error;
    }
    if (result === null) throw new Error('An import finished with neither a result nor a failure.');

    /**
     * ***An upload is recorded like a sweep*** (2026-09-28), marked as an
     * upload. Neither upload door recorded anything, so an object brought in
     * by one had no import notes on its page, and its review ended with the
     * panel. The root is the name of what was sent; `transport: 'upload'` is
     * what keeps *Update from source* from trying to reopen it as a path.
     */
    const report = result.report;
    const jobId = recordImport(services.state.db, {
      account: account.handle,
      root: part.filename,
      // One file on its own is the walker's plain mode: taken one at a time.
      source: report?.source ?? 'loose-files',
      items: report?.items ?? [result.item],
      at: Date.now(),
      transport: 'upload',
    });
    return reply.code(result.item.disposition === 'converted' ? 201 : 200).send({
      ...result,
      jobId,
      ...(report === undefined ? {} : { report: { ...report, jobId } }),
    });
  });

  /**
   * What that upload *would* do, with nothing written
   * ([10 §5](../../../../docs/design/10-ui-surfaces.md), as amended).
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

    return reply.code(200).send({
      preview: await previewUpload(
        services,
        account.handle,
        part.filename,
        part.bytes,
        destination(part.field('destination')),
      ),
    });
  });

  /**
   * The server-path sweep — point the server at a data directory
   * ([P4 §1.3]).
   *
   * **Gated on `fileAccess`, as [10 §4.2.2] widened it**, and the widening is
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

    const body = request.body as { root: string; onConflict?: ConflictPolicy; stories?: boolean };
    const stories = storiesFor(services, body.stories);
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
      // reaches a log line or a per-item row ([22 §4.1.1]).
      return reply
        .code(422)
        .send({ error: opened.refusal, message: refusalMessage(opened.refusal) });
    }

    let outcome: SweepOutcome;
    try {
      outcome = await sweep({
        library: services.library,
        // Chats become sessions in the same sweep ([P14.8]), after the cards.
        sessions: services.sessions,
        handle: account.handle,
        tags: services.tags,
        files: opened.source,
        freeBytes: services.freeBytes,
        log: request.log,
        ...(body.onConflict === undefined ? {} : { onConflict: body.onConflict }),
        ...(stories === undefined ? {} : { stories }),
      });
    } catch (error) {
      // Not recorded as a refusal: nothing was wrong with the folder, and the
      // same request succeeds once there is room.
      if (answeredNoRoom(error, reply)) return reply;
      throw error;
    }

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
   * ***Update from source*** —
   * [P14 §2.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
   * [P14.10a]: Play's session menu, on a session made from a chat.
   *
   * *"Re-sweeps the server path recorded in the ledger when the import came
   * from one"* — and a sweep of it is the whole mechanism: the chat pass finds
   * the session by its source and extends it (`importSession`'s `extend`
   * arm), and every other chat in the folder is brought up to date by the same
   * pass, as §2.7 says a re-run sweep does. **`onConflict: skip`**, because the
   * person asked to update a conversation, and replacing a card they edited
   * here with the source's would be an answer to a question they did not ask;
   * the review says which objects differ, and a sweep from the import panel is
   * still there to take them.
   *
   * ***Nothing recorded is a `409` that says so***, and the client offers the
   * file picker instead — *a browser cannot reopen a path* — for a chat that
   * came in as one file. The recorded root is never sent back: it is this
   * install's knowledge of somebody's disk ([22 §4.1.1]), and the client has
   * no use for it.
   *
   * Answers the sweep's report, with its job id, and the row that names this
   * session — `converted` when it grew, `unchanged` when it did not.
   */
  app.post(
    '/import/sessions/:sessionId/update',
    { schema: { params: Type.Object({ sessionId: Type.String() }) } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId } = request.params as { sessionId: string };
      const session = await readSession(services.sessions, account.handle, sessionId);
      if (session === null) {
        return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
      }
      const originalFilename = session.origin?.originalFilename ?? null;
      if (typeof originalFilename !== 'string' || originalFilename === '') {
        return reply.code(422).send({
          error: 'no-source',
          message: 'This session was not made from a chat, so it has no source to update from.',
        });
      }

      const root = recordedRootFor(services.state.db, account.handle, sessionId);
      if (root === null) {
        return reply.code(409).send({
          error: 'no-recorded-source',
          message: 'This session did not come from a folder on the server. Choose the file again.',
        });
      }
      if (account.capabilities.fileAccess === 'none') {
        return reply.code(403).send({
          error: 'no-file-access',
          message: 'This account may not point the server at a directory.',
        });
      }

      const opened = await openLocalSource(root, services.layout.dataRoot);
      if (!opened.ok) {
        recordRefusal(services.state.db, {
          account: account.handle,
          root,
          refusal: opened.refusal,
          at: Date.now(),
        });
        return reply
          .code(422)
          .send({ error: opened.refusal, message: refusalMessage(opened.refusal) });
      }
      const outcome = await sweep({
        library: services.library,
        sessions: services.sessions,
        handle: account.handle,
        tags: services.tags,
        files: opened.source,
        freeBytes: services.freeBytes,
        log: request.log,
        onConflict: 'skip',
      });
      if (!outcome.ok) {
        recordRefusal(services.state.db, {
          account: account.handle,
          root,
          refusal: outcome.refusal,
          at: Date.now(),
        });
        return reply
          .code(422)
          .send({ error: outcome.refusal, message: sweepRefusalMessage(outcome.refusal) });
      }
      const jobId = recordImport(services.state.db, {
        account: account.handle,
        root,
        source: outcome.report.source,
        items: outcome.report.items,
        at: Date.now(),
      });
      // The family's root chat's row, which carries what the sync said; a
      // branch's row names the same session and says only whose branch it is.
      const item =
        outcome.report.items.find(
          (one) => one.objectId === sessionId && one.source === originalFilename,
        ) ?? outcome.report.items.find((one) => one.objectId === sessionId);
      return reply.code(200).send({ report: { ...outcome.report, jobId }, item: item ?? null });
    },
  );

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
   * the right side of [10 §4.2.2]'s line — the sweep report is kept relative so
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
   * why [10 §4.2.2] grants it to *somebody you would give a shell to*. This
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

    const body = request.body as { entries: ManifestEntry[]; chats?: boolean };
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

    /**
     * ***Chats only when asked for*** — [P14.8]. They are most of a
     * SillyTavern tree's bytes, so the first plan leaves them out and says what
     * they would cost (`chats`); the panel offers the choice with that number
     * on it, and asks again with `chats: true` when it is taken. Asked again
     * rather than worked out in the browser, so the budget is spent by the one
     * function that spends it.
     */
    const plan = planUpload(
      classified.kind,
      body.entries,
      services.config.limits.maxUploadMb * MEGABYTE,
      { chats: body.chats === true },
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
    let stories: SweepRequest['stories'];
    /**
     * ***Whether the person chose chats*** — [P14.8]. `skip` says they did not,
     * and the chats they were offered were named in the manifest and never
     * sent: each is then `skipped` in the review, which is true, rather than
     * *could not be read*, which is what a named-and-unsent file otherwise
     * reads as. Anything else — `include`, or no field at all — takes what
     * arrived, which is every folder the choice was never offered for.
     *
     * `include` is kept apart from absent for one sentence: a chat named and
     * not sent under `include` was chosen and left out by the plan's budget,
     * so it is *over the limit*. Absent, nobody chose anything, and the reason
     * a named file has no bytes is not this route's to guess.
     */
    let chats = true;
    let included = false;
    /**
     * ***What the plan's budget left out*** (2026-09-28) — its `overLimit`,
     * handed back. Kept only where it is true of this request: named in the
     * manifest, and not carried. So it can only ever describe a file that was
     * in fact not sent.
     */
    let overLimit: string[] = [];
    /** The picked folder's own name, for the ledger's root — its last segment only. */
    let folder = '';

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
        if (part.fieldname === 'stories') stories = storiesFor(services, String(part.value));
        if (part.fieldname === 'chats') {
          chats = String(part.value) !== 'skip';
          included = String(part.value) === 'include';
        }
        if (part.fieldname === 'overLimit') overLimit = parseManifest(String(part.value));
        if (part.fieldname === 'folder') {
          folder = (String(part.value).split('/').pop() ?? '').slice(0, 200);
        }
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
    const notCarried = included
      ? new Set(manifest.filter((path) => !Object.hasOwn(carried, path)))
      : undefined;
    const named = new Set(manifest);
    const cut = new Set(
      overLimit.filter((path) => named.has(path) && !Object.hasOwn(carried, path)),
    );
    let outcome: SweepOutcome;
    try {
      outcome = await sweep({
        library: services.library,
        sessions: services.sessions,
        handle: account.handle,
        tags: services.tags,
        files,
        freeBytes: services.freeBytes,
        log: request.log,
        chats,
        ...(notCarried === undefined
          ? {}
          : { notCarried, uploadLimitMb: services.config.limits.maxUploadMb }),
        ...(onConflict === undefined ? {} : { onConflict }),
        ...(stories === undefined ? {} : { stories }),
      });
    } catch (error) {
      if (answeredNoRoom(error, reply)) return reply;
      throw error;
    }

    const root = folder === '' ? 'Uploaded folder' : folder;
    if (!outcome.ok) {
      // A refused upload is recorded too, as a refused sweep is (2026-09-28).
      recordRefusal(services.state.db, {
        account: account.handle,
        root,
        refusal: outcome.refusal,
        at: Date.now(),
        transport: 'upload',
      });
      /**
       * ***A root the limit left unreadable says the limit*** (2026-09-28). An
       * Aventuras folder is one database and its log, taken whole or not at
       * all; over the limit, nothing readable arrived, and the answer was
       * *there is nothing readable at that path* — true, and no help, since the
       * cause was the size.
       */
      if (outcome.refusal === 'unreadable-root' && cut.size > 0) {
        return reply.code(413).send({
          error: 'too-large',
          message: `What that folder has to send is larger than the ${String(services.config.limits.maxUploadMb)} MB upload limit, so there was nothing to read. Import it from the server’s disk instead, where there is no such limit.`,
        });
      }
      return reply
        .code(422)
        .send({ error: outcome.refusal, message: sweepRefusalMessage(outcome.refusal) });
    }

    // No `suggestions`: a near miss names a *sibling folder* to point at, and a
    // browser upload has no path to point anywhere with. The plan step says it
    // before the upload, which is the moment a person can still act on it.
    const report = overLimitReport(outcome.report, cut, services.config.limits.maxUploadMb);
    const jobId = recordImport(services.state.db, {
      account: account.handle,
      root,
      source: report.source,
      items: report.items,
      at: Date.now(),
      transport: 'upload',
    });
    return reply.code(200).send({ report: { ...report, jobId } });
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
      // 404 whether it is missing or somebody else's — [09 §4.4]'s posture,
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
    /** Plan the chats in as well — [P14.8]'s opt-in, asked for by the panel. */
    chats: Type.Optional(Type.Boolean()),
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
    /** Bring an Aventuras install's stories as sessions — [P13.11]. Absent is no. */
    stories: Type.Optional(Type.Boolean()),
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
    // *Reworded at the P13.2 review.* This said only "written by a newer
    // version", which was Marinara's one cause; an Aventuras database is
    // refused for a part it lacks and never for being newer (P13 §1.4), and a
    // backup archive with no manifest is not newer either.
    case 'unknown-format':
      return 'That folder is in a format this build cannot read: written by a newer version, or missing a part this build needs.';
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
  into?: ImportDestination,
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

  /**
   * ***A SQLite database is a root too*** —
   * [P13.7](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * Since P13.8 `/import/file` sweeps any SQLite upload, whatever it was
   * called, as an Aventuras root of one file, and this door went on answering
   * `unrecognised` for the same bytes — so an older client, or anybody calling
   * the API directly, was told *not a file this reads* about a file the commit
   * then imported. The answer is the zip arm's, word for word, because it is
   * the same fact: a folder in a file, whose contents are the sweep's business.
   *
   * **Not opened, where the zip above is.** Opening a zip is a parse of its
   * central directory in memory, cheap and pure; asking anything of a database
   * means a copy on disk and a worker (`storage/sqlite-snapshot.ts`), which is
   * a sweep's worth of machinery for a look that writes nothing. So a SQLite
   * file that is not Aventuras' — no `_sqlx_migrations`, a column missing — is
   * called a folder here and refused at the word by the column gate, with an
   * `import.file.refused` note. That is the order a directory already takes:
   * `inspect` calls a folder `aventuras` by the name of its database, and the
   * sweep may still refuse it ([P13 §1.1](../../../../docs/design/workplan/30-p13-aventuras-import.md), as built).
   *
   * ***And the client never sends one here*** (`library/import-sniff.ts`). This
   * door still buffers under `limits.maxUploadMb` rather than landing under
   * `maxImportUploadMb`, deliberately — it is a look, and a look that took a
   * gigabyte to scratch would be a second import door with none of the first's
   * accounting. An Aventuras install is often past the ordinary limit, so a
   * client that asked here would be refused a `413` for a file the import door
   * takes, after sending it once to learn what its first sixteen bytes said.
   * The client reads those bytes itself and answers exactly this; the arm is
   * for everybody else, and for a database small enough to fit.
   */
  if (looksLikeSqlite(bytes)) {
    return blank(
      'converted',
      [{ key: 'import.file.importsAsFolder', params: { file: filename }, level: 'info' }],
      { kind: 'sweep' },
    );
  }

  /**
   * ***An Aventuras story file*** —
   * [P13.15](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   * Asked before the file is parsed whole, as the import asks it, for the
   * size reason `readUpload` gives. *A look, then a word*, as for every
   * hand-picked file: the look says which story and how much of it — and,
   * from the story's key, whether it is already a session here, in which case
   * the word would write nothing. Never `unknown`, since the key answers it
   * without converting anything.
   */
  const avt = readAvtUpload(filename, bytes);
  if (avt !== null) {
    if (avt.outcome === 'observed') return blank(avt.report.disposition, avt.report.notes, null);
    const story = avt.candidate.payload as AvtStory;
    const prior = priorSessionImport({ sessions: services.sessions }, handle, story.key);
    const notes: ImportNote[] = [
      {
        key: 'import.aventuras.avtStory',
        params: {
          story: story.title,
          version: story.version,
          entries: story.tally.entries,
          branches: story.tally.branches,
        },
        level: 'info',
      },
      ...story.notes,
      ...(prior === null
        ? []
        : [
            {
              key: 'import.aventuras.storyAlreadyHere',
              params: { story: story.title },
              level: 'info' as const,
            },
          ]),
    ];
    return {
      source: filename,
      disposition: prior === null ? 'converted' : 'unchanged',
      notes,
      advisories: [],
      object: { kind: 'opaque', name: story.title === '' ? filename : story.title },
      reimport: prior === null ? 'new' : 'unchanged',
    };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // Not JSON, which is very likely a card. The reader below decides.
  }

  const envelope = parsed === null ? null : readEnvelope(parsed);
  if (envelope !== null) {
    /**
     * ***What the commit will do, not more*** (2026-09-28). Every envelope was
     * previewed as *everything inside would be imported*, and the commit then
     * recorded the ones it cannot unpack yet and imported nothing. The same
     * question the commit asks, asked here.
     */
    if (envelopeFiles(envelope) === null) {
      return blank('recorded', [notYetConvertible(filename, envelope.type)], null);
    }
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
    ...(into === undefined ? {} : { destination: into }),
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
  into?: ImportDestination,
  only?: 'chat',
): Promise<UploadResult> {
  const item = (
    disposition: ImportItemReport['disposition'],
    notes: ImportNote[],
    objectId?: string,
  ): UploadResult => ({
    // Named as it arrived, never as a path: the foreign-path doctrine applies to
    // a single upload as much as to a sweep ([22 §4.1.1]).
    item: { source: filename, disposition, notes, ...(objectId ? { objectId } : {}) },
    notes,
  });

  /**
   * ***A chat, or `unrecognised` before anything is tried*** — [P14.8]'s
   * `kind: chat`. Asked first, so neither the story-file arm nor the envelope
   * arm below can sweep an `.avt` or a Marinara profile into the library on
   * the way to answering a door that only ever wanted a conversation — and an
   * archive, which since [P13.8] never reaches this function, is refused the
   * same way by {@link importLanded}. A file that is one falls through to the
   * one-item reader below, which reads it the same way again and hands it to
   * the session pass.
   */
  if (only === 'chat') {
    const read = readUpload(filename, bytes);
    if (read.outcome !== 'candidate' || read.candidate.format !== SILLYTAVERN_CHAT_FORMAT) {
      return item('unrecognised', [
        { key: 'import.file.unrecognised', params: { file: filename }, level: 'warn' },
      ]);
    }
  }

  /**
   * ***An Aventuras story file, asked before anything parses it whole*** —
   * [P13.15](../../../../docs/design/workplan/30-p13-aventuras-import.md).
   *
   * **A hand-picked `.avt` brings its story, whatever `stories` says.** The
   * opt-in (`SweepRequest.stories`) is there to keep a *library* sweep from
   * filling the session list with every story somebody ever started — two
   * hundred sessions nobody picked, each taken back by hand. One file, picked
   * out of a dialog, looked at in a preview that names the story, and then
   * confirmed, is none of that: it is a request for that story, and the only
   * thing this file can become. Asking again with a checkbox would ask the
   * person a question they have already answered twice. A zip of them is a
   * folder, and is swept under the opt-in like one.
   *
   * *Before the envelope check*, which parses the file whole, for the size
   * reason `readUpload` gives: the story file is the one JSON here that is
   * mostly pictures.
   */
  const avt = readAvtUpload(filename, bytes);
  if (avt !== null) {
    if (avt.outcome === 'observed') return { item: avt.report, notes: avt.report.notes };
    const [answer] = await convertOne(
      {
        library: services.library,
        handle,
        tags: services.tags,
        files: new MemoryFileSource({}),
        stories: { sessions: services.sessions },
      },
      avt.candidate,
    );
    if (answer === undefined) {
      return item('unrecognised', [
        { key: 'import.file.unrecognised', params: { file: filename }, level: 'warn' },
      ]);
    }
    return { item: answer, notes: answer.notes };
  }

  /**
   * ~~**An archive is a root, so it is swept rather than read as an item**~~ —
   * *moved to {@link importLanded} at [P13.8]*, with its reasoning, because an
   * archive no longer reaches this function: it is landed on disk before a
   * byte of it is buffered, and these bytes are never a zip.
   */
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

  const envelope = parsed === null || only === 'chat' ? null : readEnvelope(parsed);
  if (envelope !== null) {
    const files = envelopeFiles(envelope);
    if (files === null) return item('recorded', [notYetConvertible(filename, envelope.type)]);

    const outcome = await sweep({
      library: services.library,
      sessions: services.sessions,
      handle,
      tags: services.tags,
      files,
      freeBytes: services.freeBytes,
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
    return reportAsUpload(filename, outcome.report);
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
      /**
       * *A chat is one file too* ([P14.8]): `readUpload` knows one by its
       * lines, and `convertOne` hands it to the sweep's session pass, which
       * answers with the new session's id as the row's `objectId`. This route
       * learns nothing else about chats — Play's *Import session* sends a
       * `.jsonl` here and opens that id.
       */
      sessions: services.sessions,
      handle,
      tags: services.tags,
      files: new MemoryFileSource({ [filename]: bytes }),
      ...(onConflict === undefined ? {} : { onConflict }),
      // Only `aventuras.scenario` reads it. Passed unconditionally rather than
      // gated on the format here, so this route stays ignorant of which
      // converters have a choice — that is the engine's to know.
      ...(into === undefined ? {} : { destination: into }),
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
 * ***An archive or a database that was landed on disk*** —
 * [P13.8](../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * **An archive is a root, so it is swept rather than read as an item**
 * ([P4 §1.3], [§7.5]) — moved here from `importOneFile` when archives stopped
 * being buffered. This is the same argument the profile envelope makes, and it
 * pays for several things at once rather than one: a CHARX (`card.json` and
 * its assets), a zipped Marinara data root, a zip somebody made of their cards
 * folder, which classifies as `loose-files` — and, since P13, an Aventuras
 * backup. None of the readers learns that the bytes came out of an archive,
 * nor now that the archive is on disk.
 *
 * **A bare database is a root too**, of one file: [P13 §1.1]'s fourth
 * transport, *recognised by the SQLite header*. It is landed under the name
 * the probe looks for, so it classifies as `aventuras` by that name, and the
 * reader takes the landing itself as the snapshot's `owned` input
 * (`FileSource.land`) — no second copy, and none of it in memory. A database
 * that is not Aventuras' is refused by the reader's column gate, as one found
 * in a folder would be.
 *
 * The landing is the caller's to release; this only reads it. The archive's
 * handle is closed here, in a `finally`, before the release removes the file.
 */
async function importLanded(
  services: AppServices,
  handle: string,
  part: Extract<ReceivedUpload, { kind: 'landed' }>,
  onConflict?: ConflictPolicy,
  /** The request's logger, for the one thing a sweep cannot put in its report ({@link SweepRequest.log}). */
  log?: SweepRequest['log'],
  asked: {
    /** Whether an Aventuras root's stories become sessions ({@link SweepRequest.stories}). */
    stories?: SweepRequest['stories'];
    /** Play's *Import session* door, which only a chat answers ([P14.8]). */
    only?: 'chat' | undefined;
  } = {},
): Promise<UploadResult> {
  const { filename } = part;
  const { stories, only } = asked;
  const unrecognised = (note: ImportNote): UploadResult => ({
    item: { source: filename, disposition: 'unrecognised', notes: [note] },
    notes: [note],
  });

  /**
   * ***A chat door never opens an archive*** — [P14.8]'s `kind: chat`, as
   * `importOneFile` answers it for a file that is not a chat. The two arrived
   * on two branches: P14.8 refused a zip in `importOneFile`'s archive arm, and
   * P13.8 had moved that arm here, so the refusal moved with it. Asked before
   * the archive is opened, so nothing in it is swept into the library on the
   * way to saying *that is not a conversation*.
   */
  if (only === 'chat') {
    return unrecognised({
      key: 'import.file.unrecognised',
      params: { file: filename },
      level: 'warn',
    });
  }

  let files: FileSource;
  let archive: LandedZipSource | null = null;
  if (part.format === 'zip') {
    const opened = await LandedZipSource.open(part.space.path(part.name), {
      layout: services.layout,
      limits: landedZipLimits(services),
      freeBytes: services.freeBytes,
    });
    if (!opened.ok) {
      return unrecognised({
        key: 'import.file.badArchive',
        params: { file: filename, refusal: opened.refusal },
        level: 'warn',
      });
    }
    archive = opened.source;
    files = archive;
  } else {
    files = new LandedDatabaseSource(part.space, part.name);
  }

  try {
    const outcome = await sweep({
      library: services.library,
      // A zip of a SillyTavern folder carries its chats, and they come across
      // as sessions as a server-path sweep's do ([P14.8]).
      sessions: services.sessions,
      handle,
      tags: services.tags,
      files,
      // What a CHARX is identified by: the file the person sent, rather than
      // the `card.json` inside every one of them.
      rootName: filename,
      freeBytes: services.freeBytes,
      ...(log === undefined ? {} : { log }),
      ...(onConflict === undefined ? {} : { onConflict }),
      ...(stories === undefined ? {} : { stories }),
    });
    if (!outcome.ok) {
      return unrecognised({
        key: 'import.file.refused',
        params: { file: filename, refusal: outcome.refusal },
        level: 'warn',
      });
    }
    return reportAsUpload(filename, outcome.report);
  } finally {
    await archive?.close();
  }
}

/**
 * ***How far one entry of a landed archive may declare itself***, as a
 * multiple of the import upload limit — [P13.8]'s *per-entry cap at parse
 * time*.
 *
 * The in-memory reader's 64 MB per entry was a bound on the heap; an entry
 * landed on disk is bounded by the disk instead, and the one that is landed
 * is somebody's database, which can be larger than the archive that carried
 * it. Aventuras deflates at level 1, and a database's bulk is its pictures as
 * base64, which barely compress — so a real one is under twice its entry.
 * Four times is room for a database with little in it but text, and it keeps
 * a bomb to a known multiple of what the operator already agreed to receive;
 * past it, the archive is refused before anything is inflated. At the default
 * of 1024 MB it is the zip format's own ceiling without zip64, which is not
 * read here at all.
 */
const ENTRY_ALLOWANCE = 4;

function landedZipLimits(services: AppServices): typeof DEFAULT_ZIP_FILE_LIMITS {
  const cap = services.config.limits.maxImportUploadMb * MEGABYTE * ENTRY_ALLOWANCE;
  return {
    ...DEFAULT_ZIP_FILE_LIMITS,
    maxEntryBytes: Math.min(cap, DEFAULT_ZIP_FILE_LIMITS.maxEntryBytes),
  };
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
/**
 * The files a Marinara envelope unpacks to, or null for one this build cannot
 * unpack yet — **one answer for the preview and the commit**, which disagreed
 * while each asked its own question (2026-09-28).
 */
function envelopeFiles(envelope: MarinaraEnvelope): FileSource | null {
  return envelope.type === 'marinara_profile'
    ? profileAsFileSource(envelope.data)
    : singleObjectAsFileSource(envelope);
}

function notYetConvertible(filename: string, kind: string): ImportNote {
  return { key: 'import.file.notYetConvertible', params: { file: filename, kind }, level: 'info' };
}

/**
 * ***A file the budget left out, named for that*** (2026-09-28). A card too big
 * to send reached the readers as a name with no bytes, and they said what a
 * reader says of that: *not recognised*, or *could not be read* — which sent
 * people looking for a broken card. Each such file is `skipped` with the
 * limit's own note, and one no reader mentioned is added, so the review
 * accounts for it either way.
 *
 * ***Replaced, except for what was read in its place*** (2026-10-02). The
 * rewrite exists to drop what a reader says about a name with no bytes — *not
 * recognised*, *could not be read* — and keeping those would bring back the
 * review it was written to fix. {@link KEPT_ON_A_CUT_FILE} is the one kind of
 * note that is not about the absence: a Marinara store reading a cut primary's
 * `.bak` instead says so on the primary's row, and that is the only place the
 * review says the rows came from a file one save older. The plan no longer
 * carries a backup without its primary (`directory-upload.ts`, `backupOf`); this
 * is what keeps the sentence if a client sends one anyway.
 */
function overLimitReport(
  report: ImportReport,
  cut: ReadonlySet<string>,
  limitMb: number,
): ImportReport {
  if (cut.size === 0) return report;
  const skipped = (source: string, kept: readonly ImportNote[] = []): ImportItemReport => ({
    source,
    disposition: 'skipped',
    notes: [
      ...kept,
      { key: 'import.file.overLimit', params: { file: source, limit: limitMb }, level: 'warn' },
    ],
  });
  const named = new Set<string>();
  const items = report.items.map((item) => {
    if (!cut.has(item.source)) return item;
    named.add(item.source);
    return skipped(
      item.source,
      item.notes.filter((one) => KEPT_ON_A_CUT_FILE.has(one.key)),
    );
  });
  for (const path of cut) if (!named.has(path)) items.push(skipped(path));
  return { ...report, items, counts: countBy(items) };
}

/**
 * The notes a cut file's row keeps through {@link overLimitReport}: those that
 * say what was read *instead* of it, rather than what its missing bytes looked
 * like. One today — a list rather than a comparison so the next is a line, and
 * a closed one so a reader's *could not be read* never rides along.
 */
const KEPT_ON_A_CUT_FILE: ReadonlySet<string> = new Set(['import.marinara.backupUsed']);

/**
 * ***What a root's upload was, when nothing in it converted*** (2026-09-28):
 * what its rows say. The summary was `recorded` whatever happened — *read, and
 * nowhere to put it* — so an archive uploaded twice said so the second time,
 * when every row in it said *already here*.
 */
function summaryOf(report: ImportReport): ImportItemReport['disposition'] {
  if (report.items.some((row) => row.disposition === 'unchanged')) return 'unchanged';
  return report.items[0]?.disposition ?? 'unrecognised';
}

function reportAsUpload(filename: string, report: ImportReport): UploadResult {
  const converted = report.items.find((row) => row.disposition === 'converted');
  return {
    item: converted ?? { source: filename, disposition: summaryOf(report), notes: [] },
    notes: report.items.flatMap((row) => row.notes),
    report,
  };
}
