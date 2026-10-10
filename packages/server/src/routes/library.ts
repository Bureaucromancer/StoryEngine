// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  ACTOR_SCHEMA,
  exportFormat,
  isKnownSchema,
  LIBRARY_DIRECTORIES,
  type ImportNote,
  type PortableSchemaId,
  type TagList,
  upgradeLegacySchema,
  WORLD_SCHEMA,
} from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { resolveObjectTags } from '../tags/resolve.js';
import { usedBy } from '../index-db/links.js';
import { exportPackage } from '../packaging/export.js';
import { writerFor } from '../export/writers.js';
import { assistField } from '../library/assist.js';
import { disconnectSignal } from './disconnect.js';
import { copyAssets, storeAsset, sweep } from '../library/assets.js';
import { sniff } from '../auth/avatars.js';
import { readOnePart } from './import.js';
import type { IndexedObject } from '../index-db/query.js';
import {
  amendVersion,
  create,
  fileErrors,
  indexRows,
  LibraryError,
  list,
  read,
  type ObjectAddress,
  readableOwners,
  readCardPixels,
  readMedia,
  remove,
  restoreVersion,
  update,
  versionPayload,
  versionsOf,
} from '../library.js';
import type { VersionRecord } from '../storage/history.js';
import { PathEscapeError } from '../storage/paths.js';
import { codecFor } from '../storage/card/index.js';

/**
 * Library CRUD — **one handler set, not six**.
 *
 * The registry from P1.1 is what makes that true: every portable object
 * self-describes, so nothing here enumerates kinds
 * ([04 §9](../../../../docs/design/04-schemas.md)). The `kind` in the URL is a *filter*, and
 * the object's own `schema` field is what decides how it is stored.
 *
 * **Every route resolves its root from the session, never from a parameter.**
 * There is no `:handle` anywhere below. The path is the owner
 * ([09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md)), and a route that
 * accepted a handle would be one forgotten check away from serving somebody
 * else's library — which is the version of the P1.2 containment check that
 * actually matters once there is more than one root.
 *
 * **There is no rename route.** A name change is an ordinary write of the
 * object's `name`; the folder does not move
 * ([P1 §1.1](../../../../docs/design/workplan/07-p1-implementation.md)).
 */

/** `actors` → `storyengine.actor/1`. The URL speaks folders; the store speaks schemas. */
const DIRECTORY_TO_SCHEMA = new Map<string, PortableSchemaId>(
  Object.entries(LIBRARY_DIRECTORIES).map(([schemaId, directory]) => [
    directory,
    schemaId as PortableSchemaId,
  ]),
);

const KindParams = Type.Object({ kind: Type.String() });
const ObjectParams = Type.Object({ kind: Type.String(), id: Type.String() });
const ExportParams = Type.Object({
  kind: Type.String(),
  id: Type.String(),
  format: Type.String({ minLength: 1 }),
});
const MediaParams = Type.Object({
  kind: Type.String(),
  id: Type.String(),
  mediaId: Type.String(),
});
const VersionParams = Type.Object({
  kind: Type.String(),
  id: Type.String(),
  versionId: Type.String(),
});
const VersionPatch = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 2000 })),
  pinned: Type.Optional(Type.Boolean()),
});

/**
 * How to reach *one specific copy* of a duplicated id — F19.
 *
 * Two files can hold the same id (a folder copied in a file manager, which is
 * a thing this design invites). The list shows both and flags the loser, and
 * until now following that row's link opened the winner while the page said it
 * was showing the shadowed one: the warning existed, the object it warned
 * about did not have an address.
 *
 * A **query parameter on the read route**, not a second path segment. The
 * canonical address of an object is its id and stays so — this narrows a read,
 * the way a filter does. It is `(source, slug)` rather than the stored path
 * because the path is native and platform-divergent (F23); the slug is the same
 * string everywhere.
 *
 * ~~*…and nothing else in the API accepts it.*~~ **The download and the export
 * accept it too** (2026-09-27), because they are reads of the same object in
 * other clothes. Without it, the detail page of a shadowed copy showed that
 * copy and offered buttons that handed over the winner, a different file,
 * under the loser's name. Still reads only: every write and every reference
 * between objects stays id-only ({@link ObjectAddress}).
 */
const ObjectQuery = Type.Object({
  slug: Type.Optional(Type.String()),
  source: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('system')])),
});

/**
 * The copy a query names, or `undefined` for the winner.
 *
 * One function for the three routes that accept the address, so they cannot
 * disagree about what a partial one means: a slug with no source is the
 * account's own library, as it has been on the read route since F19.
 */
function addressOf(query: Static<typeof ObjectQuery>): ObjectAddress | undefined {
  return query.slug === undefined
    ? undefined
    : { slug: query.slug, source: query.source ?? 'user' };
}

/**
 * The **envelope** a write arrives in — not the object inside it.
 *
 * The split is deliberate and F2 records it. What a route schema is good at is
 * the wrapper: is this an object at all, is `contentHash` a string, is the
 * whole thing not `null` (which Fastify happily accepts and which used to be a
 * 500). What it is bad at is the object, because the six portable schemas
 * behind an `anyOf` collapse every per-field error into "must match a schema in
 * anyOf" — and `assertValidObject` already validates the object against *its
 * own* schema and answers with the path and the reason. Same document
 * (`PORTABLE_SCHEMAS`), better error, and no duplicated `$id` for Ajv to refuse.
 *
 * `additionalProperties` stays open because a bare portable object is a legal
 * body here: the P1 gate posts one with `curl`.
 */
const WriteBody = Type.Object(
  {
    object: Type.Optional(Type.Object({}, { additionalProperties: true })),
    contentHash: Type.Optional(Type.String()),
    /**
     * ***What came in, and from where*** —
     * [10 §11.2c](../../../../docs/design/10-ui-surfaces.md), [P11].
     *
     * *"The book's history is the record of the import. `LoreEntry` carries no
     * provenance of its own and should not gain one for this: the merge goes
     * through the same write path as every other edit, so the book takes a
     * history entry with `source: "import"` naming what came in and from
     * where."* This is that field, and it is the whole of what the route needs
     * to make it true: **one optional string, and an ordinary save otherwise.**
     *
     * ***It gives `VersionSource`'s `import` arm its first writer.***
     * `history.ts` has carried `{ kind: 'import'; from: string }` since P2 with
     * the note that *"`assist`, `extension` and `import` have no writers until
     * their phases, but the type is the contract"* — this is that phase for the
     * third of them.
     *
     * **A file name rather than an id**, because the thing being named is a
     * file somebody chose on their own machine and there is nothing else to
     * call it. It is the client's word for it and is never resolved against
     * anything, which is why it is safe to take from a caller: it lands in a
     * history line as free text, beside `reason`, and nothing branches on it.
     */
    importedFrom: Type.Optional(Type.String({ maxLength: 200 })),
    /**
     * ***Which object this create is a copy of*** (2026-09-27) — create only,
     * and only in the envelope.
     *
     * A copy is JSON under a new id, and its pictures are not JSON: bytes
     * beside the object, or inside an actor's card. So *Save my version as a
     * copy* and *Copy to my library* made objects whose every picture was
     * broken, and an actor whose portrait was a blank square. Naming the source
     * lets the create bring them: an actor is written into the source's card,
     * which carries its portrait and its expressions, and any other kind gets
     * the source's file for each picture the copy names.
     */
    copyOf: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: true },
);

/**
 * **Restore and delete have no body schema, deliberately.**
 *
 * Their hash travels in `If-Match` — [the API doc](../../../../docs/api.md)
 * calls that the preferred spelling — and restore has no object in its body at
 * all, so the ordinary request to both is *bodyless*. Fastify validates an
 * absent body against whatever schema is attached and answers `body must be
 * object`, and `Type.Optional` at the top level does not change that (measured,
 * not assumed). So "body schemas on every object route", taken literally, turns
 * the documented and tested path into a 400 — recorded at [P2 §1.4].
 *
 * What guards them instead is `expectedHash`, which already accepts a hash from
 * either place and type-checks the body field before believing it. A body that
 * is nonsense yields no hash, and the route answers 428 asking for one.
 */

/**
 * The public shape of an indexed object.
 *
 * Carries `contentHash` because **every read carries one and every write must
 * present one** ([09 §4.4](../../../../docs/design/09-server-multiuser-deployment.md)), and
 * `source` because the list merges the user's library with the system one and
 * the badge needs a second channel beyond colour
 * ([10 §5](../../../../docs/design/10-ui-surfaces.md)).
 */
/**
 * @param registry resolves tag names, or `null` to answer with the file's own.
 */
function present(row: IndexedObject, registry: TagList | null): Record<string, unknown> {
  return {
    id: row.id,
    schema: row.schemaId,
    name: row.name,
    slug: row.slug,
    source: row.owner === 'system' ? 'system' : 'user',
    contentHash: row.contentHash,
    shadowed: row.shadowed,
    /**
     * **Tag names resolved on the way out** — [05 §3]. A rename is one write to
     * the registry and touches no object, so a carrier's stored `tags` still say
     * the old thing until it is next saved. This is the boundary that makes that
     * safe: nothing downstream sees the stale name.
     */
    object: registry === null ? row.body : resolveObjectTags(row.body, registry),
  };
}

export function registerLibraryRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/library', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const registry = await services.tags.read(account.handle);
    return reply.send({
      objects: list(services.library, account.handle).map((row) => present(row, registry)),
    });
  });

  /**
   * The files that could not be read — F20.
   *
   * **Registered before `/library/:kind` and static, so it is not a kind.** The
   * router prefers a static segment over a parameter, and `errors` is not in
   * `LIBRARY_DIRECTORIES`, so the two cannot collide from either direction.
   *
   * A list rather than a badge count: "one of your files is broken" is not
   * actionable, and the whole argument for a folder of JSON is that when
   * something goes wrong you can open the file and look. So the answer names the
   * file, the reason, and — for a schema failure — which field.
   */
  app.get('/library/errors', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    return reply.send({ errors: fileErrors(services.library, account.handle) });
  });

  app.get('/library/:kind', { schema: { params: KindParams } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const schemaId = schemaFor(request.params as { kind: string }, reply);
    if (!schemaId) return;

    const registry = await services.tags.read(account.handle);
    return reply.send({
      objects: list(services.library, account.handle, schemaId).map((row) =>
        present(row, registry),
      ),
    });
  });

  app.post(
    '/library/:kind',
    { schema: { params: KindParams, body: WriteBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      const object = objectFromBody(request.body);
      if (object === null) {
        return reply
          .code(400)
          .send({ error: 'invalid', message: 'The request body is not an object.' });
      }
      if (!isKnownSchema(String((object as { schema?: unknown }).schema))) {
        return reply.code(400).send({ error: 'invalid', message: 'Unrecognised object schema.' });
      }

      try {
        const copyOf = copyOfFrom(request.body);
        // Read before anything is written, so a copy of something this account
        // cannot see, or of another kind, is refused rather than half made.
        if (copyOf !== null) read(services.library, account.handle, copyOf, schemaId);
        const stored = await create(
          services.library,
          account.handle,
          object,
          schemaId,
          copyOf !== null && schemaId === ACTOR_SCHEMA
            ? {
                cardPixels: (
                  await readCardPixels(services.library, account.handle, copyOf, schemaId)
                ).bytes,
              }
            : undefined,
        );
        if (copyOf !== null && schemaId !== ACTOR_SCHEMA) {
          await copyAssets(
            services.library,
            account.handle,
            copyOf,
            (object as { id: string }).id,
            schemaId,
          );
        }
        // 201 with the object as stored, so the client has the content hash it
        // will need for the first edit without a second round trip.
        return await reply
          .code(201)
          .header('etag', stored.contentHash)
          .send({
            id: (object as { id: string }).id,
            slug: stored.slug,
            contentHash: stored.contentHash,
            object,
          });
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  app.get(
    '/library/:kind/:id',
    { schema: { params: ObjectParams, querystring: ObjectQuery } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      try {
        const row = read(
          services.library,
          account.handle,
          (request.params as { id: string }).id,
          schemaId,
          // Everything else — every write, every reference — stays id-only and
          // winner-resolving.
          addressOf(request.query as Static<typeof ObjectQuery>),
        );
        const registry = await services.tags.read(account.handle);
        return await reply.header('etag', row.contentHash).send(present(row, registry));
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  /**
   * ***A World, with the objects it names*** — [04 §9], [P11 §1.9], [P11.10].
   *
   * ***At `/library/worlds/:id/export` from [P16.0]***, with the kind; the old
   * `/library/packages/*` paths are not kept, because the only caller is the
   * client that ships with this server ([P16 §1.1], and §6 lists it as the
   * revisit's question). **The file it writes is unchanged** — still
   * P11.10's frozen `storyengine.package-export/1` envelope, as `.sepack.json`
   * — because [P16.3] defines the World's format once and reads this one beside
   * it; renaming the envelope here and reshaping it there would be two formats
   * written inside one phase.
   *
   * **`.sepack` is this stage's rather than a stage of its own**, and §1.9's
   * argument was not scheduling: an envelope is one of [19 §3]'s four
   * consequences — free while the format is written, expensive afterwards — and
   * a second one written later is two formats forever.
   *
   * *`missing` travels in a header rather than in the body*, because the body is
   * the file: a person downloading a bundle gets the bundle, and a stale
   * reference is something the **surface** tells them about. A field inside the
   * document would be a note to the importer about the exporter's library.
   */
  app.get(
    '/library/worlds/:id/export',
    { schema: { params: Type.Object({ id: Type.String({ minLength: 1 }) }) } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const id = (request.params as { id: string }).id;
      /**
       * ***A World, and only a World, at this address*** (2026-10-10). The
       * writer reads its id with no kind, so `/library/packages/<actor id>`
       * exported an actor as a bundle of nothing — harmless while the path
       * said *package* and nobody built one, and a lie once the path says
       * *worlds*. Asked here rather than in the writer, which [P16.3] replaces
       * and P16.0 leaves alone.
       */
      if (!exists(services.library, account.handle, id, WORLD_SCHEMA)) {
        return reply.code(404).send({ error: 'not-found', message: 'That world is not there.' });
      }
      const result = exportPackage(
        { library: services.library, build: services.build },
        account.handle,
        id,
      );
      if (result === null) {
        return reply.code(404).send({ error: 'not-found', message: 'That world is not there.' });
      }

      return reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('x-storyengine-missing', String(result.missing.length))
        .header(
          'content-disposition',
          `attachment; filename="${packFileName(result.exported.manifest.name)}"`,
        )
        .send(result.exported);
    },
  );

  /**
   * ***The object itself, as a file*** — the primitive this surface was missing.
   *
   * **Nothing in this build downloaded a library object except a `.sepack`**, and
   * `ObjectDetailPage` said so in a comment for two phases. That is a strange
   * absence in a project whose library note is
   * [10 §2.1](../../../../docs/design/10-ui-surfaces.md)'s *the library is the
   * model* — the objects are yours, in folders you may open in a text editor,
   * and the one surface that shows them could not hand you one.
   *
   * **It serves what is stored and converts nothing**, which is what makes it
   * the primitive rather than one more format. Everything under `/export/`
   * below is a *writer*, and a writer loses something by definition; this loses
   * nothing, and needs no row in `EXPORT_FORMATS` because there is no
   * conversion to describe. *As stored* ([polish §2]) already shows these bytes
   * in a fold; this is the same bytes with somewhere to put them.
   *
   * It carries no `x-storyengine-missing`: a package resolves references and can
   * come up short, and an object is just itself.
   *
   * **`?source=&slug=` reaches one copy of a duplicated id**, as it does on the
   * read above: the bytes a person downloads from a copy's page are that copy's.
   *
   * ***An actor is its card*** (2026-09-28). ~~It serves what is stored~~ — it
   * served the index's JSON, and an actor is stored as a card image: the
   * portrait is the file's pixels, and every expression and embedded picture
   * rides inside it as a chunk the JSON only names. So "Download this actor"
   * handed over a file with every picture missing and no word of it. The card
   * goes whole now, byte for byte, and our own import reads it back as ours
   * (`import/upload.ts`). Every other kind is still the JSON it is stored as,
   * and a folder kind's pictures — a lorebook's gallery, its entries' strips —
   * live in `assets/` beside it and stay behind.
   */
  app.get(
    '/library/:kind/:id/download',
    { schema: { params: ObjectParams, querystring: ObjectQuery } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      try {
        const id = (request.params as { id: string }).id;
        const address = addressOf(request.query as Static<typeof ObjectQuery>);
        const row = read(services.library, account.handle, id, schemaId, address);
        if (schemaId === ACTOR_SCHEMA) {
          const { bytes } = await readCardPixels(
            services.library,
            account.handle,
            id,
            schemaId,
            address,
          );
          const codec = codecFor(bytes);
          return await reply
            .header('content-type', codec?.mime ?? 'application/octet-stream')
            .header(
              'content-disposition',
              `attachment; filename="${downloadName(row.name, codec?.extension ?? '.png')}"`,
            )
            .send(Buffer.from(bytes));
        }
        return await reply
          .header('content-type', 'application/json; charset=utf-8')
          .header(
            'content-disposition',
            `attachment; filename="${downloadName(row.name, '.json')}"`,
          )
          .send(row.body);
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  /**
   * ***The same object, written as somebody else's format*** —
   * [00 §2.4](../../../../docs/design/00-stance.md)'s *"nothing is lost and
   * re-export is possible"*, which until now had preservation behind it and no
   * writer.
   *
   * **One route and a registry rather than a route per format**, because the
   * second format is the one that decides which of those you have built. The
   * shared `EXPORT_FORMATS` says what exists and what it accepts, `writerFor`
   * pairs it with the code, and adding a third is a table row.
   *
   * **What it loses travels in a header rather than the body**, on the reason
   * the `.sepack` route already gives one route up: *the body is the file*. A
   * person downloading a scenario gets a scenario, and what did not fit in it is
   * something the **surface** tells them — a field inside the document would be
   * a note to the importer about the exporter's library. The notes are keys and
   * params as everywhere else, so the client composes the sentence.
   *
   * **404 for a format nobody has, 409 for one aimed at the wrong kind, 422 for
   * an object that does not validate.** The last is the interesting one: the
   * folder is the object and somebody may have hand-edited it, so *this file is
   * not a treatment any more* is a real answer and a better one than a
   * cheerfully empty download.
   */
  app.get(
    '/library/:kind/:id/export/:format',
    { schema: { params: ExportParams, querystring: ObjectQuery } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      const { format: formatId, id } = request.params as { format: string; id: string };
      const writer = writerFor(formatId, schemaId);

      if (writer === 'unknown-format') {
        return reply
          .code(404)
          .send({ error: 'unknown-format', message: `No export format called ${formatId}.` });
      }
      if (writer === 'wrong-kind') {
        return reply.code(409).send({
          error: 'wrong-kind',
          message: `${formatId} is not written from ${(request.params as { kind: string }).kind}.`,
        });
      }

      try {
        /**
         * The copy asked for, when one is ({@link ObjectQuery}) — but only the
         * object being written out. What it names below is resolved as every
         * reference is, by id to the winner: a copy's cast is the same `Ref`s
         * the winner's is, and nothing about one copy of a duplicated
         * treatment makes its actors a different actor.
         */
        const row = read(
          services.library,
          account.handle,
          id,
          schemaId,
          addressOf(request.query as Static<typeof ObjectQuery>),
        );
        /**
         * **Resolved by id against the same library, and a miss is `null`.**
         *
         * A treatment's cast points at actors, and [00 §3.3] is the standing
         * answer for one that does not resolve: visible, non-blocking, never
         * fatal. So a dangling ref costs a line in the notes rather than the
         * download — which is the same posture `exportPackage` takes when it
         * reports `missing` instead of refusing.
         */
        const written = writer(row.body, (refId) => {
          try {
            return read(services.library, account.handle, refId).body;
          } catch (error) {
            if (error instanceof LibraryError && error.code === 'not-found') return null;
            throw error;
          }
        });

        if (written === null) {
          return await reply.code(422).send({
            error: 'not-exportable',
            message: 'That object does not match its own schema, so it cannot be written out.',
          });
        }

        const format = exportFormat(formatId);
        return await reply
          .header('content-type', format?.contentType ?? 'application/json; charset=utf-8')
          .header('x-storyengine-export-notes', encodeNotes(written.notes))
          .header(
            'content-disposition',
            `attachment; filename="${downloadName(written.name, format?.extension ?? '.json')}"`,
          )
          .send(written.body);
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  /**
   * ***Write this field for me*** —
   * [10 §11.1](../../../../docs/design/10-ui-surfaces.md), [P11.2].
   *
   * ***One route for every field of every editor***, which is §11's own
   * instruction read literally: assist has to be *"a primitive the editors are
   * built from"*, and a primitive with six endpoints behind it is six
   * primitives. The kind travels as a word in the body because the model is
   * told it in a sentence — this is not a route that looks anything up.
   *
   * **The draft is the body and that is the whole design.** §11.1: *"an assist
   * that receives only the field label produces generic slop and trains people
   * not to use it."* So the editor sends what the person is looking at,
   * unsaved fields included, and the size of that is the cost of the sentence
   * being true.
   *
   * ***It writes nothing but a usage line*** (`usage/log.ts`: what the call
   * cost, which a person cannot recover later). No provenance, no object, no
   * history entry — the
   * answer goes back to a form, and whether it is kept is the person's next
   * decision. That is §11.1's *"nothing may require a model call to proceed,
   * ever"* on the server's side of the line: a route that recorded the
   * generation would have made accepting it the default by making refusing it
   * a second write.
   */
  app.post('/library/assist', { schema: { body: AssistBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as Static<typeof AssistBody>;
    /**
     * ***Ended by the person leaving*** (2026-09-27): an editor closed on a
     * pending assist left the call running, because nothing handed it a
     * signal. `disconnectSignal`, for the reason the illustrate route gives.
     */
    const signal = disconnectSignal(reply);
    const result = await assistField(
      {
        layout: services.library.layout,
        accounts: services.accounts,
        providers: services.providers,
        config: services.config,
        online: () => services.updates.online,
      },
      {
        account: account.handle,
        subject: body.subject,
        path: body.path,
        label: body.label,
        draft: body.draft,
        ...(body.guidance === undefined ? {} : { guidance: body.guidance }),
        ...(body.current === undefined ? {} : { current: body.current }),
        signal,
      },
    );

    if (!result.ok && result.reason === 'cancelled') {
      // Nobody is left to answer when the person left; anything else that
      // stopped it is the server stopping, and whoever is waiting is told.
      if (signal.aborted) return;
      return reply.code(503).send({ error: 'cancelled' });
    }

    if (!result.ok && result.reason === 'provider-failed') {
      /**
       * ***The class and the remedy, and never the prompt*** — a failed
       * draft's shape (2026-09-27). The endpoint's own words go to the log
       * line an operator filters on; the person gets what they could do.
       */
      request.log.error(
        {
          event: 'assist.failed',
          class: result.class,
          ...(result.detail === undefined ? {} : { detail: result.detail }),
        },
        'A field assist could not be written',
      );
      return reply
        .code(502)
        .send({ error: 'provider-failed', class: result.class, remedy: result.remedy });
    }

    if (!result.ok) {
      /**
       * **A class, never a sentence** — [22 §1.4]. `not-bound` is a
       * configuration fault with a remedy the client already knows how to
       * word ([P11.6]'s `REMEDY_SENTENCES`), `window-too-small` is another
       * (2026-09-27), and `no-answer` is an endpoint that replied with
       * nothing, which is not the same thing and must not be reported as one.
       */
      return reply.code(422).send({ error: result.reason });
    }
    return reply.send(result);
  });

  /**
   * ***Who points at this*** —
   * [03 §10.1](../../../../docs/design/03-data-model.md),
   * [10 §5.2](../../../../docs/design/10-ui-surfaces.md),
   * [P11.7](../../../../docs/design/workplan/28-p11-implementation.md).
   *
   * **One route for two surfaces**, which is [P4 §6.6]'s *"whichever phase
   * builds that panel pays both"* kept: the object page's *Used by* and the
   * delete confirmation's *referenced by 12 sessions, 3 treatments and 1
   * package* are the same question at two moments, and separate answers could
   * disagree about what a reference is.
   *
   * **A route rather than a field on the object read**, because the panel is
   * read once per object view and the object read is on the hot path of every
   * editor save — and because a count that is a fact about the *index* has no
   * business in the payload whose etag is the file's content hash.
   *
   * *Not an existence check*: an id nothing points at answers with an empty
   * list rather than a 404, which is what makes *used by nothing* renderable.
   */
  app.get(
    '/library/:kind/:id/links',
    { schema: { params: ObjectParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      const owners = readableOwners(account.handle).map((owner) =>
        owner.kind === 'system' ? 'system' : `user:${owner.handle}`,
      );
      const used = usedBy(services.index.db, (request.params as { id: string }).id, owners);
      return reply.send({ usedBy: used });
    },
  );

  /**
   * The index rows behind an object — the workbench's projection ([P3.3]).
   *
   * **Best-effort by decision** ([P3 §7.4], decided 2026-08-27): [22 §5] keeps
   * the index's tables an implementation detail and the migration policy is
   * drop-and-rescan, so this route *restates* rather than promises — after an
   * index schema bump it may return less until the surface catches up. What it
   * restates: every row the index holds for the id — the winner first in
   * portable-path order, the shadowed copies, and any row inside its tombstone
   * settling window — which is what lets the panel name the winning path over
   * a shadowed object (the stage's ends-at). Read-only, like everything the
   * panel is allowed to be.
   */
  app.get(
    '/library/:kind/:id/rows',
    { schema: { params: ObjectParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      try {
        return await reply.send({
          rows: indexRows(
            services.library,
            account.handle,
            (request.params as { id: string }).id,
            schemaId,
          ),
        });
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  app.put(
    '/library/:kind/:id',
    { schema: { params: ObjectParams, body: WriteBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      const expected = expectedHash(request.headers['if-match'], request.body);
      if (!expected) {
        return reply.code(428).send({
          error: 'hash-required',
          message:
            'Send the content hash you last read, as If-Match or as contentHash in the body.',
        });
      }

      const object = objectFromBody(request.body);
      if (object === null) {
        return reply
          .code(400)
          .send({ error: 'invalid', message: 'The request body is not an object.' });
      }

      /**
       * **`import` when the client says so, `manual` otherwise** — the default
       * is `undefined`, which `update` reads as `MANUAL`, and the kind is the
       * argument after it. The reason is what the history list shows beside the
       * line, so it says what happened rather than restating the source name.
       */
      const from = (request.body as { importedFrom?: unknown }).importedFrom;
      const change =
        typeof from === 'string' && from !== ''
          ? { source: { kind: 'import' as const, from }, reason: `Imported entries from ${from}` }
          : undefined;

      try {
        const stored = await update(
          services.library,
          account.handle,
          (request.params as { id: string }).id,
          object,
          expected,
          change,
          schemaId,
        );
        /**
         * ***Assets nothing names are collected here*** — [10 §11.2b], and the
         * other half of `POST …/assets` storing bytes without touching the
         * object. A picture uploaded by somebody who then closed the tab is a
         * file with no manifest row, and this is the moment the manifest on
         * disk is authoritative about which rows there are.
         *
         * **After the write and never before it**, because sweeping against a
         * draft would delete the picture somebody had just added and not yet
         * saved. Best-effort, and awaited rather than detached: the object is
         * already on disk, so the worst a failure costs is a file the next save
         * collects — but a detached sweep is one more thing writing into a
         * directory after the request that caused it has answered, which is the
         * shape that just cost a shutdown race one layer over.
         */
        await sweep(
          services.library,
          account.handle,
          (request.params as { id: string }).id,
          schemaId,
        );

        return await reply
          .header('etag', stored.contentHash)
          .send({ contentHash: stored.contentHash, object: stored.object });
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  /**
   * The version history routes — [03 §11](../../../../docs/design/03-data-model.md).
   *
   * Newest first, with the revision number computed from append order rather
   * than stored ([03 §11.5]). The *current* state is not an entry: the client
   * pins it at the top of the panel itself, because "current" is a fact about
   * the object, not about its history.
   */
  app.get(
    '/library/:kind/:id/history',
    { schema: { params: ObjectParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      try {
        const { versions } = await versionsOf(
          services.library,
          account.handle,
          (request.params as { id: string }).id,
          schemaId,
        );
        return await reply.send({
          versions: versions.map((record, position) => presentVersion(record, position)).reverse(),
        });
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  app.get(
    '/library/:kind/:id/history/:versionId',
    { schema: { params: VersionParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      const params = request.params as { id: string; versionId: string };
      try {
        const { record, object } = await versionPayload(
          services.library,
          account.handle,
          params.id,
          params.versionId,
          schemaId,
        );
        return await reply.send({ version: presentVersion(record), object });
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  /**
   * Restore is an ordinary write wearing a route: it is hash-checked like PUT,
   * snapshots the current state first, and answers with the same shape — so a
   * client treats the response exactly as it treats a save.
   */
  app.post(
    '/library/:kind/:id/history/:versionId/restore',
    { schema: { params: VersionParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      const expected = expectedHash(request.headers['if-match'], request.body);
      if (!expected) {
        return reply.code(428).send({
          error: 'hash-required',
          message:
            'Send the content hash you last read, as If-Match or as contentHash in the body.',
        });
      }

      const params = request.params as { id: string; versionId: string };
      try {
        const stored = await restoreVersion(
          services.library,
          account.handle,
          params.id,
          params.versionId,
          expected,
          schemaId,
        );
        /**
         * ***Assets nothing names are collected here*** — [10 §11.2b], and the
         * other half of `POST …/assets` storing bytes without touching the
         * object. A picture uploaded by somebody who then closed the tab is a
         * file with no manifest row, and this is the moment the manifest on
         * disk is authoritative about which rows there are.
         *
         * **After the write and never before it**, because sweeping against a
         * draft would delete the picture somebody had just added and not yet
         * saved. Best-effort, and awaited rather than detached: the object is
         * already on disk, so the worst a failure costs is a file the next save
         * collects — but a detached sweep is one more thing writing into a
         * directory after the request that caused it has answered, which is the
         * shape that just cost a shutdown race one layer over.
         */
        await sweep(
          services.library,
          account.handle,
          (request.params as { id: string }).id,
          schemaId,
        );

        return await reply
          .header('etag', stored.contentHash)
          .send({ contentHash: stored.contentHash, object: stored.object });
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  /** Rename (set `reason`) and pin — the two caller-editable fields ([10 §11.2a]). */
  app.patch(
    '/library/:kind/:id/history/:versionId',
    { schema: { params: VersionParams, body: VersionPatch } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      const params = request.params as { id: string; versionId: string };
      const body = request.body as { reason?: string; pinned?: boolean };
      try {
        const record = await amendVersion(
          services.library,
          account.handle,
          params.id,
          params.versionId,
          {
            ...(body.reason === undefined ? {} : { reason: body.reason }),
            ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
          },
          schemaId,
        );
        return await reply.send({ version: presentVersion(record) });
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  /**
   * The card's pixels, for the editor to show and not replace
   * ([P1 §P1.7](../../../../docs/design/workplan/07-p1-implementation.md)). Actors only — no other
   * kind has an image that *is* the object.
   */
  app.get(
    '/library/:kind/:id/avatar',
    { schema: { params: ObjectParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      try {
        const { bytes, contentHash } = await readCardPixels(
          services.library,
          account.handle,
          (request.params as { id: string }).id,
          schemaId,
        );
        return await reply
          .header('content-type', 'image/png')
          .header('etag', contentHash)
          .send(Buffer.from(bytes));
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  /**
   * One embedded media entry's bytes — [03 §5.2.2], [06 §7.2], built at
   * [P7.10](../../../../docs/design/workplan/23-p7-implementation.md).
   *
   * **The route nothing could show a picture without.** `/avatar` above serves
   * the card's own pixels and is the only image path this build has had; an
   * actor's expression set, a treatment's cover and an authored backdrop are
   * all `EmbeddedMedia`, and nothing served those. [06 §7.2]'s sprites and
   * [06 §10.1a]'s authored backdrop both stopped here.
   *
   * ***Keyed on the media's own `digest`, not the object's `contentHash`.*** A
   * card's hash changes when any field of the object changes; the bytes of one
   * expression do not. An etag on the object would re-fetch every sprite the
   * moment somebody edited a line of the character's description.
   *
   * *Any kind, unlike `/avatar`*: [04 §3] puts `media` on treatments, lorebooks
   * and Worlds too, and a route that named actors would grow a second arm for
   * the first one of those to carry a picture. **[P9] is the next consumer** —
   * a rendition's asset needs serving the same way, and `MediaSelection`'s two
   * arms are already the one shape both go through.
   */
  app.get(
    '/library/:kind/:id/media/:mediaId',
    { schema: { params: MediaParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      const { id, mediaId } = request.params as { id: string; mediaId: string };
      try {
        const { bytes, mime, digest } = await readMedia(
          services.library,
          account.handle,
          id,
          mediaId,
          schemaId,
        );
        return await reply
          .header('content-type', mime)
          .header('etag', digest)
          .send(Buffer.from(bytes));
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  /**
   * ***Bytes beside an object*** — [10 §11.2b](../../../../docs/design/10-ui-surfaces.md),
   * [03 §5.2.3](../../../../docs/design/03-data-model.md), built at P11.
   *
   * §11 lists *"every image slot can be generated, uploaded, cropped and
   * replaced"* and §11.2b is the lorebook half of it. **Three of those four are
   * this route and the editor above it**; *generated* is a rendition
   * ([06 §10](../../../../docs/design/06-modes-and-turn-pipeline.md)) and
   * §11.2b sends it away by name, to arrive *"with the providers and not
   * before"* — which [P9](../../../../docs/design/workplan/26-p9-implementation.md)
   * has now shipped as the backdrop.
   *
   * ***It stores bytes and does not touch the object***, which is the decision
   * worth reading twice. §11.2b puts a gallery on the **book** and a strip on
   * **each entry**, so *which array does this row belong to* is a question only
   * the form knows the answer to — a route that decided would need an arm per
   * array, and it would write the object behind the editor's draft, which is
   * the one thing the editor shell exists to prevent. So the manifest row
   * travels in the ordinary save, hash-checked like every other field, and
   * `library/assets.ts` explains what that costs and how it is paid back.
   *
   * ***Cropping happens in the browser, and the cropped bytes are what arrives
   * here.*** A crop is a rectangle over pixels somebody is looking at; doing it
   * on the server would mean shipping an image library to re-derive a decision
   * the client had already made exactly, and then keeping an uncropped original
   * nothing asks for. The canvas the browser already has is the better tool,
   * and what reaches disk is what the person chose.
   */
  app.post(
    '/library/:kind/:id/assets',
    { schema: { params: ObjectParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const schemaId = schemaFor(request.params as { kind: string }, reply);
      if (!schemaId) return;

      const part = await readOnePart(request, reply, services);
      if (part === null) return;

      /**
       * **Sniffed, not trusted.** The part's own content type is what the browser
       * said; this is what the bytes are, and it is the same `sniff` the avatar
       * upload uses so the two doors accept the same set. A file that is not an
       * image is refused here rather than stored and discovered by a broken
       * picture later.
       */
      const kind = sniff(part.bytes);
      if (kind === null) {
        return reply
          .code(415)
          .send({ error: 'not-an-image', message: 'That is not a PNG, JPEG or WebP image.' });
      }

      try {
        const stored = await storeAsset(
          services.library,
          account.handle,
          (request.params as { id: string }).id,
          part.bytes,
          kind.mime,
          schemaId,
        );
        // 201, and the body is the manifest row the editor is about to add — the
        // caller has to be able to write `ref`, `digest`, `bytes` and `mime` into
        // an `EmbeddedMedia` without computing any of them.
        return await reply.code(201).send({ asset: stored });
      } catch (error) {
        respondToLibraryError(error, reply);
        return;
      }
    },
  );

  app.delete('/library/:kind/:id', { schema: { params: ObjectParams } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const schemaId = schemaFor(request.params as { kind: string }, reply);
    if (!schemaId) return;

    const expected = expectedHash(request.headers['if-match'], request.body);
    if (!expected) {
      return reply.code(428).send({ error: 'hash-required' });
    }

    try {
      await remove(
        services.library,
        account.handle,
        (request.params as { id: string }).id,
        expected,
        schemaId,
      );
      return await reply.code(204).send();
    } catch (error) {
      respondToLibraryError(error, reply);
      return;
    }
  });
}

/**
 * A version record as the client sees it. `revision` is the entry's position
 * in append order, oldest = 1 — computed here for display and never stored
 * ([03 §11.5](../../../../docs/design/03-data-model.md)).
 */
function presentVersion(record: VersionRecord, position?: number): Record<string, unknown> {
  return {
    id: record.id,
    digest: record.digest,
    ...(position === undefined ? {} : { revision: position + 1 }),
    authoredAt: record.authoredAt,
    recordedAt: record.recordedAt,
    source: record.source,
    reason: record.reason,
    authorVersion: record.authorVersion,
    pinned: record.pinned,
  };
}

function schemaFor(params: { kind: string }, reply: FastifyReply): PortableSchemaId | null {
  const schemaId = DIRECTORY_TO_SCHEMA.get(params.kind);
  if (!schemaId) {
    const known = [...DIRECTORY_TO_SCHEMA.keys()].join(', ');
    void reply.code(404).send({ error: 'unknown-kind', message: `Known kinds: ${known}.` });
    return null;
  }
  return schemaId;
}

/**
 * The object out of a request body — `{object: …}` or the object bare — or
 * null when the body is not an object at all. `JSON.parse('null')` is a valid
 * body as far as Fastify is concerned, and dereferencing it was a 500; a
 * malformed request deserves a 400 that says so. (Full body schemas are the
 * P2.0 validation item; this is only the guard.)
 */
/** The `copyOf` of an envelope, or null — never read off a bare object. */
function copyOfFrom(body: unknown): string | null {
  const held = body as { object?: unknown; copyOf?: unknown };
  return held.object !== undefined && typeof held.copyOf === 'string' ? held.copyOf : null;
}

function objectFromBody(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return null;
  const inner: unknown = (body as { object?: unknown }).object;
  const object: unknown = inner ?? body;
  // ***A body in a kind's old name is that kind, from the door in*** —
  // [P16 §1.1]. `create` and `update` upgrade too, and this is the door in
  // front of them: the create route's own "is this a schema I know" check ran
  // first and answered a `storyengine.package/1` body *unrecognised*, so a
  // Package somebody had downloaded before the rename could be saved over a
  // World with `PUT` and not posted as one.
  return typeof object === 'object' && object !== null ? upgradeLegacySchema(object) : null;
}

/**
 * The hash the caller believes it is writing over.
 *
 * `If-Match` is the HTTP spelling and the one to prefer; the body field exists
 * because `fetch` in a browser makes headers easy but a hand-written `curl` in
 * the P1 exit gate does not, and refusing the second spelling would make the
 * demo harder for no gain.
 */
function expectedHash(ifMatch: unknown, body: unknown): string | null {
  if (typeof ifMatch === 'string' && ifMatch.length > 0) {
    return ifMatch.replace(/^"|"$/g, '');
  }
  const fromBody = (body as { contentHash?: unknown } | undefined)?.contentHash;
  return typeof fromBody === 'string' && fromBody.length > 0 ? fromBody : null;
}

/**
 * A refused path, as a message safe to send.
 *
 * {@link PathEscapeError}'s own message is for a log, not a client: the
 * symlink-escape case appends the resolved candidate and the real root, both
 * absolute. What the caller needs is *which* segment was refused and *why* —
 * the reason is a closed vocabulary, and `attempted` is relative at every throw
 * site. So the message is rebuilt rather than forwarded (P2 §1.2, F22).
 */
function refusedPathMessage(error: PathEscapeError): string {
  return `Refused path (${error.reason}): ${JSON.stringify(error.attempted)}`;
}

/**
 * Maps a library failure onto a status.
 *
 * The interesting one is `stale` → **412 with the current object in the body**.
 * That is what lets the UI offer reload-and-reapply or save-as-a-copy rather
 * than guessing ([09 §4.4](../../../../docs/design/09-server-multiuser-deployment.md)) — and
 * it is the only defence the hot-reload thesis has against silently eating a
 * hand edit.
 *
 * **A `PathEscapeError` is answered here rather than rethrown** (F22). It used
 * to fall through to Fastify's default handler, which meant a 500 whose body
 * carried two absolute filesystem paths — and it is reachable without anyone
 * attacking anything: `parseObjectPath` takes a slug from a folder name on
 * disk, so a directory hand-named `con` or `evil.` is indexed happily and then
 * refused the moment a route rebuilds a path from it. That is a 422: the
 * request is well-formed and the thing it names is not usable.
 *
 * **Exported because a second caller arrived** — the hook-promotion route in
 * [sessions.ts](./sessions.js), which writes a library object from outside this
 * file and so can be refused by every code below. It was briefly a copy of this
 * switch living over there, which is the shape this repository keeps having to
 * undo: *one description, two renderings*, where the second is discovered when
 * a caller learns *403 means the system library* from one route and something
 * else from another. The threshold `ui/reorder.ts` states for the client is the
 * one being kept here — the second occurrence is when a decision is lifted, not
 * the third.
 */
export function respondToLibraryError(error: unknown, reply: FastifyReply): void {
  if (error instanceof PathEscapeError) {
    void reply.code(422).send({ error: 'refused-path', message: refusedPathMessage(error) });
    return;
  }
  if (!(error instanceof LibraryError)) throw error;

  switch (error.code) {
    case 'not-found':
      void reply.code(404).send({ error: 'not-found', message: error.message });
      return;
    case 'stale':
      void reply.code(412).send({
        error: 'stale',
        message: error.message,
        /**
         * **Unresolved, deliberately.** The conflict dialog's subject is the
         * file as another writer left it, so its tags are that file's own names
         * rather than what the registry would call them today. It is also
         * self-correcting: `tagIds` is what identity runs on, so a stale name
         * merged back in displays correctly on the next read.
         */
        current: error.current ? present(error.current, null) : null,
      });
      return;
    case 'read-only':
      void reply.code(403).send({ error: 'read-only', message: error.message });
      return;
    case 'conflict':
      void reply.code(409).send({ error: 'conflict', message: error.message });
      return;
    case 'invalid':
      void reply.code(400).send({
        error: 'invalid',
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      });
      return;
    case 'refused-path':
      // Nothing throws this as a `LibraryError` yet; the code exists so that a
      // route resolving a caller-supplied path segment can refuse it in the
      // same vocabulary the escape above answers in.
      void reply.code(422).send({ error: 'refused-path', message: error.message });
      return;
    case 'diverged':
      // 409 rather than 412, deliberately (P2C finding 8): the caller must not
      // read this as *reload and reapply*, because reloading returns the same
      // hash and the loop never ends. No `current` either — the envelope it
      // would carry is the stale row, and handing it back is what invited the
      // retry.
      void reply.code(409).send({ error: 'diverged', message: error.message });
      return;
  }

  /**
   * Unreachable while the switch covers the union, and it is here because it
   * nearly was not: adding `diverged` to `LibraryError['code']` compiled
   * cleanly with the switch left uncovered, and the route would have fallen
   * through without sending a reply — a hung request rather than an error.
   * TypeScript does not check a `void` switch for exhaustiveness on its own, so
   * this assignment is what asks it to.
   */
  const unhandled: never = error.code;
  throw new Error(`unhandled library error code: ${String(unhandled)}`);
}

/**
 * A `.sepack` filename — [P11.10], and `fileNameFor`'s rules in `sessions.ts`.
 *
 * ASCII only, because `content-disposition` is latin-1 by specification; the
 * extension is the one [04 §9] names and the one an importer will look for.
 */
/**
 * A download filename, by `packFileName`'s rules and for its reason.
 *
 * ASCII only, because `content-disposition` is latin-1 by specification. The
 * extension is the format's rather than fixed, since the next writer added may
 * not be JSON.
 */
function downloadName(name: string, extension: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\p{ASCII}]/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug === '' ? 'object' : slug}${extension}`;
}

/**
 * What an export did not carry, as a header.
 *
 * **Base64 of the JSON, because a header is latin-1 and a note's params are
 * whatever an object is called** — a treatment named *Café* would otherwise put
 * bytes in a header that no specification says how to read. The body is the
 * file ([P11.10]'s rule for `x-storyengine-missing`), so the notes cannot ride
 * inside it, and dropping them would leave the only surface that can tell
 * somebody what they lost with nothing to say.
 */
function encodeNotes(notes: readonly ImportNote[]): string {
  return Buffer.from(JSON.stringify(notes), 'utf8').toString('base64');
}

function packFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\p{ASCII}]/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug === '' ? 'package' : slug}.sepack.json`;
}

/**
 * What an assist needs to know — [10 §11.1], [P11.2].
 *
 * **`draft` is `Type.Unknown()` on purpose.** It is the object the editor is
 * holding, which may be a draft of a kind this build validates and may equally
 * be a half-typed one that would fail its own schema — refusing it here would
 * make assist available only once the form was already correct, which is the
 * opposite of when somebody wants it.
 */
const AssistBody = Type.Object({
  subject: Type.String({ minLength: 1, maxLength: 60 }),
  path: Type.String({ minLength: 1, maxLength: 200 }),
  label: Type.String({ minLength: 1, maxLength: 200 }),
  draft: Type.Unknown(),
  guidance: Type.Optional(Type.String({ maxLength: 2000 })),
  current: Type.Optional(Type.String({ maxLength: 100_000 })),
});

/** Whether an id is an object of a kind this caller can read — the not-found arm of `read`, as a test. */
function exists(
  library: AppServices['library'],
  handle: string,
  id: string,
  inKind: PortableSchemaId,
): boolean {
  try {
    read(library, handle, id, inKind);
    return true;
  } catch (error) {
    if (error instanceof LibraryError && error.code === 'not-found') return false;
    throw error;
  }
}
