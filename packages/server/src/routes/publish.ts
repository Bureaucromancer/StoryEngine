// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  type ImportNote,
  PUBLISH_MAX_START,
  type PublishChoices,
  type PublishStart,
} from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { LibraryError } from '../library.js';
import { confirmPublish, type PublishRefusal } from '../packaging/confirm.js';
import { appendPublishRecord, readPublishRecords } from '../packaging/ledger.js';
import { type PublishContext, previewPublish } from '../packaging/review.js';
import { openFileRead } from '../storage/files.js';
import { encodeNotesWithin } from './headers.js';
import { respondToLibraryError } from './library.js';

/**
 * ***Publish: the review, the file, and the record of it*** —
 * [16 §5](../../../../docs/design/16-publish.md),
 * [16 §3](../../../../docs/design/16-publish.md),
 * [16 §2](../../../../docs/design/16-publish.md), [P16.3d].
 *
 * ***Top-level `/publish*`, beside `/import/file*`*** ([P16.3]'s plan, §3): 16
 * §6 calls Publish *that export path given a name*, and import's door is
 * top-level rather than under `/library/:kind`. It also keeps clear of `POST
 * /library/:kind`, which is create.
 *
 * - **`POST /publish/preview`** — the review. Walks, measures, answers;
 *   **writes nothing** ([16 §5]: *it stages nothing and holds no copy*).
 * - **`POST /publish`** — the confirm. Walks again, and answers the file itself
 *   (`application/zip`, a `.seworld`), with what the surface needs to say
 *   about it in headers, because the body is the file ([P11.10]'s rule for
 *   `x-storyengine-missing`). **Its one library write is a kept World**, for a
 *   selection of two or more not sent as a snapshot ([16 §3]); a World start
 *   writes nothing to the World, and one object writes nothing at all ([16
 *   §2]).
 * - **`GET /publish/records`** — the ledger, newest first: *Published N
 *   times* on a World's page, and what a re-publish's diff reads ([P16.3h]).
 *
 * ***No `If-Match` and no idempotency key*** ([P16.3]'s plan, §3): nothing the
 * caller read is overwritten, and a double POST of a selection makes two
 * Worlds — the client's pending-disable is the guard, and the plan's risk 14
 * names it.
 *
 * *The old `GET /library/worlds/:id/export` stays answering until [P16.3g]
 * moves the client off it* — [P16 §6]'s open question, which this stage does
 * not answer.
 */

/**
 * ***Every body here is closed*** (2026-10-11, the P16.3d review):
 * `additionalProperties: false` on each object, so a key the route does not
 * read is a `400` naming it rather than a key dropped and a `200` — the house
 * rule for JSON bodies, and `routes/me.ts` says why: ignoring a field *teaches
 * a client that the request worked*. Here it was sharper than that: a
 * misspelt `reviewed` arrived as no review at all, and switched drift off.
 * `ticked` alone stays open — a keyed record, whose keys are the closure's.
 */
const CLOSED = { additionalProperties: false } as const;

/** A start, as the wire carries it — 1..{@link PUBLISH_MAX_START} ids, or a World. */
const Id = Type.String({ minLength: 1, maxLength: 200 });
const Start = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('objects'),
      ids: Type.Array(Id, { minItems: 1, maxItems: PUBLISH_MAX_START }),
    },
    CLOSED,
  ),
  Type.Object({ kind: Type.Literal('world'), id: Id }, CLOSED),
]);

const PreviewBody = Type.Object({ start: Start }, CLOSED);

/**
 * ***The choices as the review sends them*** — `PublishChoices`.
 *
 * `ticked` is keyed by node key, which is an id or a `missing:`/`excluded:`
 * key — an open record, because the closure decides which keys mean anything
 * and a key it does not hold is ignored (`fileSet`). The name is bounded here
 * only loosely: *is this a name worth keeping* is the confirm's answer
 * (`422 invalid-name`), and a schema rejection would say it in the
 * validator's words.
 */
const ConfirmBody = Type.Object(
  {
    start: Start,
    choices: Type.Object(
      {
        ticked: Type.Record(Type.String(), Type.Boolean()),
        history: Type.Boolean(),
        keep: Type.Union([Type.Literal('world'), Type.Literal('snapshot')]),
        name: Type.Optional(Type.String({ maxLength: 2000 })),
      },
      CLOSED,
    ),
    reviewed: Type.Optional(Type.String({ maxLength: 200 })),
  },
  CLOSED,
);

const RecordsQuery = Type.Object({
  world: Type.Optional(Id),
  // A querystring number is a string here: the validator coerces nothing
  // (`routes/search.ts` says why), so the pattern is the bound.
  limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,3}$' })),
});

/** The newest records a listing answers with when it is not told. */
const RECORDS_DEFAULT = 20;
const RECORDS_MAX = 200;

/**
 * ***A choices body is ticks and a few flags***, so a megabyte is a closure of
 * tens of thousands of rows — far past what a review shows — and the
 * constructor's `bodyLimit`, which is the upload limit, is not this route's
 * number ([P16.3]'s plan).
 */
const BODY_LIMIT = 1024 * 1024;

/**
 * ***How much of `x-storyengine-export-notes` a response carries*** — 3 KiB of
 * base64 (2026-10-11, the P16.3d review).
 *
 * Every picture a carried object names and does not have is a note, so the
 * header grows with the library rather than with the request: sixty missing
 * pictures made 18 KB of it, past the 16 KiB Node's own `fetch` takes before
 * it refuses the whole response, and far past the 4 KiB (one page) a reverse
 * proxy such as nginx gives *all* of a response's headers by default — and
 * [docs/deploy.md] puts one in front for TLS. Its answer is a `502`, after a
 * selection's World was kept. 3 KiB leaves the rest of the headers a
 * kilobyte inside that page.
 *
 * What does not fit is counted, not lost: the header ends with one
 * `publish.file.moreInManifest` note, and the manifest — inside the file the
 * person now has — says every one: its `omitted` the file's own notes, and
 * its `requires` (at `0.0.0`) the mode this install does not have, which is
 * the one note here that is not also in `omitted`.
 */
export const PUBLISH_NOTES_HEADER_MAX = 3 * 1024;

export function registerPublishRoutes(app: FastifyInstance, services: AppServices): void {
  const context = (): PublishContext => ({
    library: services.library,
    sessions: services.sessions,
    build: services.build,
    // Read per request rather than captured: it is the services' seam, and a
    // test that answers *full* replaces it on the services object.
    freeBytes: (path) => services.freeBytes(path),
  });

  /**
   * ***The review*** — the closure, measured, and the answers about the publish
   * as a whole (`PublishPreview`). **Writes nothing**: not the library, not the
   * index, not the ledger, and no scratch — `routes/publish.test.ts` holds it
   * to the whole data directory.
   *
   * `404 not-found` for a World or a lone id that is not there, or a
   * selection none of whose ids is (2026-10-11); `422 world-in-selection` for
   * a selection holding a World. A selection id that is not there, beside one
   * that is, is a missing row in the answer, not a refusal ([16 §4]).
   */
  app.post(
    '/publish/preview',
    { bodyLimit: BODY_LIMIT, schema: { body: PreviewBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const { start } = request.body as { start: PublishStart };
      const answer = await previewPublish(context(), account.handle, start);
      if ('refusal' in answer) return refuse(reply, answer);
      return reply.send(answer);
    },
  );

  /**
   * ***The file*** — `200 application/zip`, the `.seworld` the confirm wrote to
   * scratch, sent with its exact `content-length` ([P16.3]'s plan, R3: a
   * stored entry needs its CRC before its header, and a member changing
   * mid-stream would be a truncated `200`, which this corpus refuses
   * everywhere — so the file is whole before the first byte is sent).
   *
   * Beside it:
   *
   * - `content-disposition` — `worldFileName`'s ASCII name;
   * - `x-storyengine-world` — the World **this publish kept**, for a selection
   *   of two or more; absent for a World start (the caller has its id, and
   *   nothing was kept), one object, and a snapshot;
   * - `x-storyengine-missing` — references the file would have followed and
   *   could not, P11.10's header kept;
   * - `x-storyengine-review-drift: 1` — the library changed between the review
   *   and this confirm; absent otherwise, and absent when no review was named;
   * - `x-storyengine-export-notes` — what the file does not carry and says so,
   *   `encodeNotes`' base64 JSON, warnings first and within
   *   {@link PUBLISH_NOTES_HEADER_MAX} (2026-10-11), ending with a count of
   *   the rest when they do not all fit — the manifest says every one.
   *
   * ***The ledger line is written when the response has finished***, never
   * before ([P16.3d]): a download the person abandoned leaves no record, so the
   * next diff never compares against a file nobody received. ***And only for
   * a file sent whole*** (2026-10-11, the P16.3d review): a `200` whose stream
   * reached its end. A file that cannot be opened to send is answered by
   * fastify as a `500` that ends normally — it *finishes* — and `finish`
   * alone recorded that as a publish. Scratch is disposed of when the
   * response closes, finished or not.
   *
   * Refusals: `404 not-found`; `409 publish.changed` (and a World this confirm
   * kept stays, named in the answer); `422 world-in-selection`,
   * `invalid-name` or `publish.tooLarge`; `507 no-space` — before anything is
   * kept, or when the disk fills under the write, after which the World this
   * confirm kept is taken back (2026-10-11), as for any other failure there.
   */
  app.post(
    '/publish',
    { bodyLimit: BODY_LIMIT, schema: { body: ConfirmBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const body = request.body as {
        start: PublishStart;
        choices: PublishChoices;
        reviewed?: string;
      };

      let confirmed;
      try {
        confirmed = await confirmPublish(
          context(),
          account.handle,
          body.start,
          body.choices,
          body.reviewed,
        );
      } catch (error) {
        // A disk that filled while the file was written — the late arm of the
        // room check, which no plan can see coming. In publish's words, not
        // import's (`answeredNoRoom` said *to read this import*, 2026-10-11),
        // and naming no World because none is left: the confirm took back
        // the one it kept before this was thrown.
        if (isNoSpace(error)) {
          return reply.code(507).send({
            error: 'no-space',
            message: 'The disk filled while the file was being written.',
          });
        }
        if (error instanceof LibraryError) {
          respondToLibraryError(error, reply);
          return reply;
        }
        throw error;
      }
      if ('refusal' in confirmed) return refuse(reply, confirmed);

      const { space, record } = confirmed;
      const handle = account.handle;
      const raw = reply.raw;
      /**
       * ***A client that left while the file was being made*** — its response
       * has already closed, and a listener attached now would wait for a
       * `close` that has been emitted. Nothing is sent, nothing is recorded,
       * and the scratch goes. (A World a selection kept stays: it was kept
       * before the file existed, and is cheap — [16 §3].)
       */
      if (raw.destroyed) {
        await space.dispose().catch(() => undefined);
        void reply.hijack();
        return;
      }
      /**
       * ***Delivered*** is two things, and `finish` is only the second: the
       * file's stream reached its end (every byte was handed to the
       * response), and the response that finished was the `200` carrying it.
       * A stream that fails before its first byte becomes fastify's `500`,
       * which ends normally and finishes too (2026-10-11, the P16.3d review);
       * one that fails after it destroys the response, which never finishes.
       */
      const file = openFileRead(confirmed.path);
      let sentWhole = false;
      file.once('end', () => {
        sentWhole = true;
      });
      raw.once('finish', () => {
        if (!sentWhole || raw.statusCode !== 200) return;
        void appendPublishRecord(services.layout, handle, record);
      });
      raw.once('close', () => {
        void space.dispose().catch(() => undefined);
      });

      void reply
        .header('content-type', 'application/zip')
        .header('content-length', String(confirmed.bytes))
        .header('content-disposition', `attachment; filename="${confirmed.fileName}"`)
        .header('x-storyengine-missing', String(confirmed.missing))
        .header(
          'x-storyengine-export-notes',
          encodeNotesWithin(confirmed.notes, PUBLISH_NOTES_HEADER_MAX, moreInManifest),
        );
      if (confirmed.world?.kept === 'created') {
        void reply.header('x-storyengine-world', confirmed.world.id);
      }
      if (confirmed.drift) void reply.header('x-storyengine-review-drift', '1');
      return reply.send(file);
    },
  );

  /**
   * ***The ledger, newest first*** — `{ count, records }`, where `count` is
   * every record that matches and `records` the newest `limit` of them
   * (20 unless asked, at most 200). `?world=<id>` narrows to one World's —
   * the World page's *Published N times*, and the diff's baseline.
   */
  app.get('/publish/records', { schema: { querystring: RecordsQuery } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const query = request.query as { world?: string; limit?: string };
    const limit = Math.min(
      RECORDS_MAX,
      Math.max(1, query.limit === undefined ? RECORDS_DEFAULT : Number(query.limit)),
    );
    const records = await readPublishRecords(
      services.layout,
      account.handle,
      query.world === undefined ? {} : { world: query.world },
    );
    return reply.send({ count: records.length, records: records.slice(0, limit) });
  });
}

/**
 * ***Every refusal, in the shape every route answers*** — `{ error, message }`,
 * with the message a sentence for a log or a developer, never the surface's:
 * the client keys its own words off `error`.
 */
function refuse(reply: FastifyReply, refusal: PublishRefusal): FastifyReply {
  switch (refusal.refusal) {
    case 'not-found':
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'There is nothing there to publish.' });
    case 'world-in-selection':
      return reply.code(422).send({
        error: 'world-in-selection',
        message: 'A World is published from its own page, not as part of a selection.',
      });
    case 'invalid-name':
      return reply.code(422).send({
        error: 'invalid-name',
        message: 'A World kept from a selection needs a name: one line, at most 200 characters.',
      });
    case 'too-large':
      return reply.code(422).send({
        error: 'publish.tooLarge',
        reason: refusal.reason,
        message: 'This would make a file larger than the readers of one can take.',
      });
    case 'changed':
      return reply.code(409).send({
        error: 'publish.changed',
        path: refusal.path,
        world: refusal.world,
        message: 'Something changed while it was being published. Publish again.',
      });
    case 'no-space':
      return reply.code(507).send({
        error: 'no-space',
        message: `There is not enough free space on the disk for this file: it could need ${megabytes(refusal.needed)} and ${megabytes(refusal.free)} is free.`,
      });
  }
}

/**
 * The note that closes a notes header the budget cut short: how many the
 * manifest names that the header does not, at the level of the most serious
 * of them. A client sentence is owed at [P16.3g], as for every `publish.file.*`
 * key.
 */
function moreInManifest(rest: readonly ImportNote[]): ImportNote {
  return {
    key: 'publish.file.moreInManifest',
    level: rest.some((note) => note.level === 'warn') ? 'warn' : 'info',
    params: { count: rest.length },
  };
}

/** The disk is full — `ENOSPC` from the write, or from anything under it. */
function isNoSpace(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOSPC';
}

function megabytes(bytes: number): string {
  return `${String(Math.ceil(bytes / (1024 * 1024)))} MB`;
}
