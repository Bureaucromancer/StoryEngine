// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { isKnownSchema, LIBRARY_DIRECTORIES, type PortableSchemaId } from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import type { IndexedObject } from '../index-db/query.js';
import { create, LibraryError, list, read, remove, update } from '../library.js';

/**
 * Library CRUD — **one handler set, not six**.
 *
 * The registry from P1.1 is what makes that true: every portable object
 * self-describes, so nothing here enumerates kinds
 * ([13 §9](docs/design/13-schemas.md)). The `kind` in the URL is a *filter*, and
 * the object's own `schema` field is what decides how it is stored.
 *
 * **Every route resolves its root from the session, never from a parameter.**
 * There is no `:handle` anywhere below. The path is the owner
 * ([04 §4.3](docs/design/04-server-multiuser-deployment.md)), and a route that
 * accepted a handle would be one forgotten check away from serving somebody
 * else's library — which is the version of the P1.2 containment check that
 * actually matters once there is more than one root.
 *
 * **There is no rename route.** A name change is an ordinary write of the
 * object's `name`; the folder does not move
 * ([19 §1.1](docs/design/19-p1-implementation.md)).
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

/**
 * The public shape of an indexed object.
 *
 * Carries `contentHash` because **every read carries one and every write must
 * present one** ([04 §4.4](docs/design/04-server-multiuser-deployment.md)), and
 * `source` because the list merges the user's library with the system one and
 * the badge needs a second channel beyond colour
 * ([05 §5](docs/design/05-ui-surfaces.md)).
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

    const body = request.body as { object?: unknown };
    const object = body.object ?? body;
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

    const body = request.body as { object?: unknown };
    const object = body.object ?? body;

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
 * Maps a library failure onto a status.
 *
 * The interesting one is `stale` → **412 with the current object in the body**.
 * That is what lets the UI offer reload-and-reapply or save-as-a-copy rather
 * than guessing ([04 §4.4](docs/design/04-server-multiuser-deployment.md)) — and
 * it is the only defence the hot-reload thesis has against silently eating a
 * hand edit.
 */
function respondToLibraryError(error: unknown, reply: FastifyReply): void {
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
  }
}
