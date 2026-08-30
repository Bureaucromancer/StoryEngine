// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import type { ImportItemReport, ImportNote } from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { convertChatCompletionPreset } from '../import/sillytavern/preset.js';
import { convertSyspromptPreset } from '../import/sillytavern/sysprompt.js';
import { convertTextCompletionPreset } from '../import/sillytavern/text-completion.js';
import {
  profileAsFileSource,
  readEnvelope,
  singleObjectAsFileSource,
} from '../import/marinara/envelope.js';
import type { ConflictPolicy } from '../import/identity.js';
import type { SourceRefusal } from '../import/source.js';
import { sweep } from '../import/sweep.js';
import { openLocalSource, type RootRefusal } from '../storage/local-source.js';
import { create, LibraryError } from '../library.js';

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
      return reply
        .code(422)
        .send({ error: outcome.refusal, message: sweepRefusalMessage(outcome.refusal) });
    }
    return reply.code(200).send({ report: outcome.report });
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
 * **What it cannot convert yet is `recorded`, not an error.** At P4.1 only
 * presets convert; cards and lorebooks arrive at P4.2. Answering 4xx for a
 * perfectly good card would tell somebody their file is wrong when the truth is
 * that this build is not finished — so the file is named, its class is reported,
 * and the review vocabulary carries the difference ([P4 §1.4]).
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // A PNG card lands here today. It is a file this build will convert at
    // P4.2, and saying *not recognised* would be a smaller lie than saying it
    // is broken — so it says neither, and reports what it is waiting for.
    return item('recorded', [
      { key: 'import.file.notYetConvertible', params: { filename }, level: 'info' },
    ]);
  }

  // Marinara's own export formats, which are the same reader over a different
  // file source ([P4 §1.3]) — a `.marinara.json` is one row of a table that
  // happens to have travelled alone.
  const envelope = readEnvelope(parsed);
  if (envelope !== null) {
    const files =
      envelope.type === 'marinara_profile'
        ? profileAsFileSource(envelope.data)
        : singleObjectAsFileSource(envelope);

    if (files === null) {
      return item('recorded', [
        {
          key: 'import.file.notYetConvertible',
          params: { filename, kind: envelope.type },
          level: 'info',
        },
      ]);
    }

    const outcome = await sweep({ library: services.library, handle, files });
    if (!outcome.ok) {
      return item('unrecognised', [
        {
          key: 'import.file.refused',
          params: { filename, refusal: outcome.refusal },
          level: 'warn',
        },
      ]);
    }
    // One envelope can carry a whole profile, so the answer is the report rather
    // than a single row — the route reports the first item and the counts speak
    // for the rest.
    const converted = outcome.report.items.find((row) => row.disposition === 'converted');
    return {
      item: converted ?? { source: filename, disposition: 'recorded', notes: [] },
      notes: outcome.report.items.flatMap((row) => row.notes),
    };
  }

  const converted = convertPreset(parsed, presetNameFrom(filename));
  if (converted === null) {
    return item('unrecognised', [
      { key: 'import.file.unrecognised', params: { filename }, level: 'warn' },
    ]);
  }
  if (!converted.ok) {
    return item('unrecognised', [
      {
        key: 'import.file.refused',
        params: { filename, refusal: converted.refusal },
        level: 'warn',
      },
    ]);
  }

  try {
    const stored = await create(services.library, handle, converted.value.preset);
    return item('converted', converted.value.notes, (stored.object as { id: string }).id);
  } catch (error) {
    if (error instanceof LibraryError) {
      return item('unrecognised', [
        { key: 'import.file.notStored', params: { filename, reason: error.code }, level: 'warn' },
      ]);
    }
    throw error;
  }
}

/**
 * Which preset kind this is, by shape rather than by filename.
 *
 * The same posture root detection takes ([P4 §1.3]): a file is what it probes
 * as. A `.json` in `OpenAI Settings/` is a chat-completion preset because it has
 * `prompts`, not because of the folder it came out of — and a single upload has
 * no folder to go on at all.
 */
function convertPreset(parsed: unknown, name: string) {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;

  if (Array.isArray(body['prompts'])) return convertChatCompletionPreset(parsed, name);
  if (typeof body['content'] === 'string' || typeof body['post_history'] === 'string') {
    return convertSyspromptPreset(parsed, name);
  }
  // A sampler panel is the least distinctive shape of the three, so it is the
  // fallback rather than a probe: anything object-shaped with a sampler field
  // in it. A file matching none of the three is `unrecognised`.
  const samplerish = ['temp', 'temperature', 'top_p', 'rep_pen', 'max_length'];
  if (samplerish.some((field) => typeof body[field] === 'number')) {
    return convertTextCompletionPreset(parsed, name);
  }
  return null;
}

/** The filename without its extension, which is what ST names a preset by. */
function presetNameFrom(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[^.]+$/, '') || 'Imported preset';
}
