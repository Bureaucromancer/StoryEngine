// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { isKnownSchema, LIBRARY_DIRECTORIES, type PortableSchemaId } from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import type { IndexedObject } from '../index-db/query.js';
import {
  amendVersion,
  create,
  LibraryError,
  list,
  read,
  readCardPixels,
  remove,
  restoreVersion,
  update,
  versionPayload,
  versionsOf,
} from '../library.js';
import type { VersionRecord } from '../storage/history.js';
import { PathEscapeError } from '../storage/paths.js';

/**
 * Library CRUD — **one handler set, not six**.
 *
 * The registry from P1.1 is what makes that true: every portable object
 * self-describes, so nothing here enumerates kinds
 * ([10 §9](../../../../docs/design/10-schemas.md)). The `kind` in the URL is a *filter*, and
 * the object's own `schema` field is what decides how it is stored.
 *
 * **Every route resolves its root from the session, never from a parameter.**
 * There is no `:handle` anywhere below. The path is the owner
 * ([04 §4.3](../../../../docs/design/04-server-multiuser-deployment.md)), and a route that
 * accepted a handle would be one forgotten check away from serving somebody
 * else's library — which is the version of the P1.2 containment check that
 * actually matters once there is more than one root.
 *
 * **There is no rename route.** A name change is an ordinary write of the
 * object's `name`; the folder does not move
 * ([P1 §1.1](../../../../docs/design/workplan/03-p1-implementation.md)).
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
 * The public shape of an indexed object.
 *
 * Carries `contentHash` because **every read carries one and every write must
 * present one** ([04 §4.4](../../../../docs/design/04-server-multiuser-deployment.md)), and
 * `source` because the list merges the user's library with the system one and
 * the badge needs a second channel beyond colour
 * ([05 §5](../../../../docs/design/05-ui-surfaces.md)).
 */
function present(row: IndexedObject): Record<string, unknown> {
  return {
    id: row.id,
    schema: row.schemaId,
    name: row.name,
    slug: row.slug,
    source: row.scope === 'system' ? 'system' : 'user',
    contentHash: row.contentHash,
    shadowed: row.shadowed,
    object: row.body,
  };
}

export function registerLibraryRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/library', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    return reply.send({ objects: list(services.library, account.handle).map(present) });
  });

  app.get('/library/:kind', { schema: { params: KindParams } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const schemaId = schemaFor(request.params as { kind: string }, reply);
    if (!schemaId) return;

    return reply.send({
      objects: list(services.library, account.handle, schemaId).map(present),
    });
  });

  app.post('/library/:kind', { schema: { params: KindParams } }, async (request, reply) => {
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
      const stored = await create(services.library, account.handle, object);
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
  });

  app.get('/library/:kind/:id', { schema: { params: ObjectParams } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    try {
      const row = read(services.library, account.handle, (request.params as { id: string }).id);
      return await reply.header('etag', row.contentHash).send(present(row));
    } catch (error) {
      respondToLibraryError(error, reply);
      return;
    }
  });

  app.put('/library/:kind/:id', { schema: { params: ObjectParams } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const expected = expectedHash(request.headers['if-match'], request.body);
    if (!expected) {
      return reply.code(428).send({
        error: 'hash-required',
        message: 'Send the content hash you last read, as If-Match or as contentHash in the body.',
      });
    }

    const object = objectFromBody(request.body);
    if (object === null) {
      return reply
        .code(400)
        .send({ error: 'invalid', message: 'The request body is not an object.' });
    }

    try {
      const stored = await update(
        services.library,
        account.handle,
        (request.params as { id: string }).id,
        object,
        expected,
      );
      return await reply
        .header('etag', stored.contentHash)
        .send({ contentHash: stored.contentHash, object: stored.object });
    } catch (error) {
      respondToLibraryError(error, reply);
      return;
    }
  });

  /**
   * The version history routes — [02 §11](../../../../docs/design/02-data-model.md).
   *
   * Newest first, with the revision number computed from append order rather
   * than stored ([02 §11.5]). The *current* state is not an entry: the client
   * pins it at the top of the panel itself, because "current" is a fact about
   * the object, not about its history.
   */
  app.get(
    '/library/:kind/:id/history',
    { schema: { params: ObjectParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!schemaFor(request.params as { kind: string }, reply)) return;

      try {
        const { versions } = await versionsOf(
          services.library,
          account.handle,
          (request.params as { id: string }).id,
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
      if (!schemaFor(request.params as { kind: string }, reply)) return;

      const params = request.params as { id: string; versionId: string };
      try {
        const { record, object } = await versionPayload(
          services.library,
          account.handle,
          params.id,
          params.versionId,
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
      if (!schemaFor(request.params as { kind: string }, reply)) return;

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

  /** Rename (set `reason`) and pin — the two caller-editable fields ([05 §11.2a]). */
  app.patch(
    '/library/:kind/:id/history/:versionId',
    { schema: { params: VersionParams, body: VersionPatch } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!schemaFor(request.params as { kind: string }, reply)) return;

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
   * ([P1 §P1.7](../../../../docs/design/workplan/03-p1-implementation.md)). Actors only — no other
   * kind has an image that *is* the object.
   */
  app.get(
    '/library/:kind/:id/avatar',
    { schema: { params: ObjectParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!schemaFor(request.params as { kind: string }, reply)) return;

      try {
        const { bytes, contentHash } = await readCardPixels(
          services.library,
          account.handle,
          (request.params as { id: string }).id,
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

  app.delete('/library/:kind/:id', { schema: { params: ObjectParams } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

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
 * ([02 §11.5](../../../../docs/design/02-data-model.md)).
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
function objectFromBody(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return null;
  const inner: unknown = (body as { object?: unknown }).object;
  const object: unknown = inner ?? body;
  return typeof object === 'object' && object !== null ? object : null;
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
 * than guessing ([04 §4.4](../../../../docs/design/04-server-multiuser-deployment.md)) — and
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
 */
function respondToLibraryError(error: unknown, reply: FastifyReply): void {
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
        current: error.current ? present(error.current) : null,
      });
      return;
    case 'read-only':
      void reply.code(403).send({ error: 'read-only', message: error.message });
      return;
    case 'conflict':
      void reply.code(409).send({ error: 'conflict', message: error.message });
      return;
    case 'invalid':
      void reply.code(400).send({ error: 'invalid', message: error.message });
      return;
    case 'refused-path':
      // Nothing throws this as a `LibraryError` yet; the code exists so that a
      // route resolving a caller-supplied path segment can refuse it in the
      // same vocabulary the escape above answers in.
      void reply.code(422).send({ error: 'refused-path', message: error.message });
      return;
  }
}
