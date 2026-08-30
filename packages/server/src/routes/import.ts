// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { FastifyInstance } from 'fastify';

import type { ImportItemReport, ImportNote } from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { convertChatCompletionPreset } from '../import/sillytavern/preset.js';
import { convertSyspromptPreset } from '../import/sillytavern/sysprompt.js';
import { convertTextCompletionPreset } from '../import/sillytavern/text-completion.js';
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
