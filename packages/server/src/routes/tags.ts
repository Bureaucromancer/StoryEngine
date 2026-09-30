// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { normaliseTagName, sameTag, uuidv7, type TagEntry } from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { adoptLibraryTags } from '../tags/adopt.js';
import { renameTag } from '../tags/rename.js';
import { TagsError } from '../tags/store.js';

/**
 * The tag registry's API — [05](../../../../docs/design/05-tagging.md).
 *
 * **The verb split is the safety property**, and it is worth reading before the
 * routes. `DELETE /tags/:id` removes a *registry entry* and touches nothing
 * else: the objects carrying that tag keep carrying it, and it goes on
 * filtering and gating lore exactly as before, having lost only its colour and
 * its place in the order ([05 §2] invariant 4). Anything that reaches the user's
 * files is a `POST` with a verb in the path — `/adopt` and `/:id/rename`.
 *
 * That is why deleting is safe enough to need no confirmation from this layer.
 * Expressing the difference in the URL rather than in a flag means a client
 * cannot reach a destructive operation by forgetting to send something.
 */

const TagBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 64 }),
    swatch: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
    folder: Type.Optional(Type.String({ maxLength: 32 })),
    hidden: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/**
 * **`name` is not here, and its absence is the point.**
 *
 * Renaming is not a property edit: it is the operation [05 §1] says can change
 * which lore fires, because an `actorTagFilter` naming the old spelling stops
 * matching. It gets its own verb, with its own answer about the gates it found.
 * A `name` arriving in this body is refused by `additionalProperties: false`
 * with the field named, rather than being quietly applied as if it were a
 * colour.
 */
const TagPatch = Type.Object(
  {
    swatch: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
    folder: Type.Optional(Type.String({ maxLength: 32 })),
    hidden: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const OrderBody = Type.Object(
  { ids: Type.Array(Type.String({ minLength: 1 }), { maxItems: 500 }) },
  { additionalProperties: false },
);

const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });

const RenameBody = Type.Object(
  {
    to: Type.String({ minLength: 1, maxLength: 64 }),
    /**
     * Whether to rewrite the lore gates that name the old spelling.
     *
     * **Off by default, and asked rather than assumed.** Both answers are
     * defensible — an author who wrote a gate on *noir* may have meant that tag,
     * or may have meant that word — so the surface reports what it found and
     * lets somebody decide ([05 §1]).
     */
    rewriteGates: Type.Optional(Type.Boolean()),
    /**
     * ***Report, and change nothing*** (2026-09-28): the gates the old name
     * holds and the actors the rename would rename, so the question can be
     * asked before the one real rename rather than after it, when the old name
     * is no longer there to find.
     */
    dryRun: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** The store's vocabulary, in the one the rest of the API speaks. */
function status(code: TagsError['code']): number {
  if (code === 'conflict') return 409;
  if (code === 'not-found') return 404;
  return 400;
}

export function registerTagRoutes(app: FastifyInstance, services: AppServices): void {
  /**
   * The registry, and the tags in use that it has never heard of.
   *
   * **Counts are not here.** `GET /api/library` already ships every object's
   * body and the client is already holding it, so a count is one pass over data
   * in hand; computing it again server-side would be a second answer to a
   * question that already has one, and the two would eventually disagree. If
   * that route ever stops shipping bodies this is the first thing to revisit.
   */
  app.get('/tags', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const registry = await services.tags.read(account.handle);
    return reply.send({ tags: registry.tags });
  });

  app.post('/tags', { schema: { body: TagBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as {
      name: string;
      swatch?: string | null;
      folder?: string;
      hidden?: boolean;
    };
    const name = normaliseTagName(body.name);

    try {
      const registry = await services.tags.mutate(account.handle, (current) => {
        const clash = current.tags.find((tag) => sameTag(tag.name, name));
        if (clash) {
          // Named in the spelling that exists, because *noir is already a tag*
          // is unhelpful to somebody who just typed `Noir`.
          throw new TagsError('conflict', `${clash.name} is already a tag.`);
        }
        const entry: TagEntry = {
          id: uuidv7(),
          name,
          swatch: body.swatch ?? null,
          sortOrder: current.tags.reduce((high, tag) => Math.max(high, tag.sortOrder), -1) + 1,
          folder: body.folder ?? 'none',
          hidden: body.hidden ?? false,
          createdAt: new Date().toISOString(),
        };
        return [...current.tags, entry];
      });
      return await reply.code(201).send({ tags: registry.tags });
    } catch (error) {
      if (error instanceof TagsError) {
        return await reply
          .code(status(error.code))
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.patch(
    '/tags/:id',
    { schema: { params: IdParams, body: TagPatch } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { id } = request.params as { id: string };
      const patch = request.body as { swatch?: string | null; folder?: string; hidden?: boolean };

      try {
        const registry = await services.tags.mutate(account.handle, (current) => {
          if (!current.tags.some((tag) => tag.id === id)) {
            throw new TagsError('not-found', `No tag with id ${id}.`);
          }
          return current.tags.map((tag) => (tag.id === id ? { ...tag, ...patch } : tag));
        });
        return await reply.send({ tags: registry.tags });
      } catch (error) {
        if (error instanceof TagsError) {
          return await reply
            .code(status(error.code))
            .send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );

  /**
   * **Removes the decoration, never the tag.**
   *
   * Objects carrying it are untouched, which is [05 §2]'s invariant 4: losing a
   * registry entry must never lose data. The tag reappears in the manager as
   * one in use with no entry, and one click adopts it again.
   */
  app.delete('/tags/:id', { schema: { params: IdParams } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const { id } = request.params as { id: string };

    try {
      const registry = await services.tags.mutate(account.handle, (current) => {
        if (!current.tags.some((tag) => tag.id === id)) {
          throw new TagsError('not-found', `No tag with id ${id}.`);
        }
        return current.tags.filter((tag) => tag.id !== id);
      });
      return await reply.send({ tags: registry.tags });
    } catch (error) {
      if (error instanceof TagsError) {
        return await reply
          .code(status(error.code))
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  /**
   * **Renaming, which is one registry write and one question.**
   *
   * The write is O(1): an adopted object references the entry, so changing the
   * entry changes what every carrier is called without touching an object file.
   * The question is [05 §1]'s — a lore entry's `actorTagFilter` holds author-
   * written *names*, and activation compares them exactly, so a rename that
   * ignored them would silently change which lore fires. Gates are reported
   * always and rewritten only when asked.
   *
   * A `POST` with a verb in the path rather than a `PATCH`, because this is the
   * one tag operation that can reach the user's files.
   */
  app.post(
    '/tags/:id/rename',
    { schema: { params: IdParams, body: RenameBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { id } = request.params as { id: string };
      const { to, rewriteGates, dryRun } = request.body as {
        to: string;
        rewriteGates?: boolean;
        dryRun?: boolean;
      };

      try {
        const report = await renameTag(services.library, services.tags, account.handle, id, to, {
          rewriteGates: rewriteGates ?? false,
          dryRun: dryRun ?? false,
        });
        const registry = await services.tags.read(account.handle);
        return await reply.send({ tags: registry.tags, ...report });
      } catch (error) {
        if (error instanceof TagsError) {
          return await reply
            .code(status(error.code))
            .send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );

  /**
   * **Adoption — one deliberate write across the library**, after which renaming
   * is free ([05 §3]).
   *
   * A route somebody presses rather than a migration on startup. Every object it
   * touches gains a history entry, and a server that did that on first boot
   * after an upgrade would be rewriting a person's files without being asked.
   *
   * Idempotent: a second run mints nothing and writes nothing, so a partial
   * first run is simply repeated.
   */
  app.post('/tags/adopt', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const report = await adoptLibraryTags(services.library, services.tags, account.handle);
    const registry = await services.tags.read(account.handle);
    return reply.send({ tags: registry.tags, ...report });
  });

  /**
   * The manual order, as one whole list.
   *
   * **A list of ids rather than a patch of positions**, so there is no
   * interleaving to reason about: two reorders in flight are two whole answers
   * and the later one wins, where two position patches could have produced an
   * order neither client asked for. Ids the registry does not know are ignored
   * rather than refused — a stale tab reordering a list somebody else has since
   * pruned should not be an error page.
   */
  app.put('/tags/order', { schema: { body: OrderBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const { ids } = request.body as { ids: string[] };

    try {
      const registry = await services.tags.mutate(account.handle, (current) => {
        const ranked = new Map(ids.map((id, index) => [id, index]));
        // Anything the caller did not mention keeps its relative place, after
        // everything it did.
        const after = ids.length;
        return [...current.tags]
          .sort((a, b) => (ranked.get(a.id) ?? after) - (ranked.get(b.id) ?? after))
          .map((tag, index) => ({ ...tag, sortOrder: index }));
      });
      return await reply.send({ tags: registry.tags });
    } catch (error) {
      if (error instanceof TagsError) {
        return await reply
          .code(status(error.code))
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });
}
