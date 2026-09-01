// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { type AppServices, requireAccount } from '../app.js';
import { search, searchLoreEntries } from '../index-db/query.js';
import { searchTurns } from '../index-db/sessions.js';
import { readableOwners } from '../library.js';

/**
 * Search — [07 §7](../../../../docs/design/07-tech-stack.md), and F10's answer.
 *
 * The finding was that `search()` existed, was tested, and had **no caller**: an
 * FTS index maintained on every write that nothing could ever query. This route
 * is its first one, and the second consumer that makes the shape honest —
 * objects and turns are both searched, because a person looking for "the
 * cathedral" does not know or care whether they wrote it in a lorebook or said
 * it in a turn.
 *
 * **API only at P2.** The UI is P3's ([05 §4](../../../../docs/design/05-p3-implementation.md)), and
 * [P2 §2.9] names this route as the phase's second pressure valve — it is a
 * reader, so it can slip without anything else moving. It did not need to.
 */

/**
 * **A querystring number is a `String` here, and that is not a shortcut.**
 *
 * Every value in a query string arrives as text. Fastify's default validator
 * coerces it, and this app deliberately replaced that validator with the storage
 * layer's Ajv — `coerceTypes: false` — because coercion is what let a `POST`
 * body be rewritten on its way to disk (F2, `app.ts`'s `setValidatorCompiler`).
 * One Ajv, one setting, and the cost lands here: `Type.Integer()` on a
 * querystring rejects `?limit=10` with *must be integer*, because the value it
 * is handed is `"10"`.
 *
 * Measured rather than reasoned about — this route shipped with `Type.Integer`
 * and answered 400 to its own documented parameter. So the schema states what is
 * actually on the wire and the handler converts, which is also the only place
 * that can answer usefully when the text is not a number.
 */
const SearchQuery = Type.Object({
  q: Type.String({ minLength: 1, maxLength: 200 }),
  limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,3}$' })),
});

const MAX_RESULTS = 200;

/** Clamped rather than trusted: a caller does not get to ask for everything. */
function resultLimit(raw: string | undefined): number {
  if (raw === undefined) return 50;
  return Math.min(Math.max(Number(raw), 1), MAX_RESULTS);
}

export function registerSearchRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/search', { schema: { querystring: SearchQuery } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const query = request.query as { q: string; limit?: string };
    const q = query.q;
    const limit = resultLimit(query.limit);
    const owners = readableOwners(account.handle).map((owner) =>
      owner.kind === 'system' ? 'system' : `user:${owner.handle}`,
    );

    let objects;
    let turns;
    let entries;
    try {
      objects = search(services.index.db, q, limit);
      turns = searchTurns(services.index.db, owners, q, limit);
      /**
       * The third kind of hit — [05 §14.5]'s *one query, three kinds*.
       *
       * **Scoped in its own SQL, where `objects` is scoped below.** The comment
       * on that filter argues against giving `search` owners, and it still
       * holds for `search`: that query has no owner in it at all, so scoping it
       * would *add* a second site for the containment rule. This one already
       * joins `object` — it needs the book's id, name and slug, and the
       * tombstone filter — so the owner is in its `from` clause either way, and
       * declining to use it would mean reaching the fact and then re-deriving
       * it. `searchTurns` makes the same call for the same reason.
       *
       * The other half is the limit. SQL applies it before this route sees a
       * row, so a filter applied afterwards returns fewer than it should — and
       * an entry hit is worse than an object hit to get wrong in that
       * direction, because what an unscoped one would carry is the prose
       * itself, in the snippet.
       */
      entries = searchLoreEntries(services.index.db, owners, q, limit);
    } catch (error) {
      /**
       * FTS5 has a query syntax, and a person typing into a search box does not
       * know it — an unbalanced quote or a bare `*` is a syntax error from
       * SQLite, not a server fault. Answering 400 rather than 500 says whose
       * problem it is.
       *
       * **But not every throw from here is theirs**, and this catch used to say
       * it was. A **missing table** is the case that matters and it is not
       * hypothetical: running the P5.2 code against an index still at schema 5
       * makes every search answer *"that search query could not be parsed"* —
       * the server blaming the reader for a table the server has not built.
       * That state is unreachable in production, because `migrate` runs when
       * the index is opened and a version mismatch rebuilds; it is entirely
       * reachable in development, where it cost half a minute of looking in the
       * wrong place.
       *
       * The message is the only thing that separates them — every one of these
       * arrives as `ERR_SQLITE_ERROR` with errcode 1 — and `no such table` is
       * the one a caller's query text cannot produce, because the table names
       * are ours. So it is re-thrown and becomes a 500 with a real message in
       * the log, which is what a fault of ours should look like.
       */
      if (error instanceof Error && error.message.startsWith('no such table')) throw error;
      return reply
        .code(400)
        .send({ error: 'invalid', message: 'That search query could not be parsed.' });
    }

    return reply.send({
      objects: objects
        // Scoped after the query rather than inside it: `search` is the library's
        // and takes no owners, and giving it some for this one caller would put
        // the containment rule in two places ([04 §4.3]).
        .filter((row) => owners.includes(row.owner))
        .map((row) => ({
          id: row.id,
          schema: row.schemaId,
          name: row.name,
          slug: row.slug,
          source: row.owner === 'system' ? 'system' : 'user',
        })),
      turns,
      /**
       * The owner key is mapped the way `objects` maps it above, because it is
       * the internal `user:ned` spelling and no client should learn it.
       *
       * `objectId` and `entryId` together are the address the read route
       * already takes, and `entryName` earns its place beside the snippet: the
       * excerpt comes from whichever field matched, so a hit on `keys` arrives
       * as a bare fragment with nothing to label it.
       *
       * *One thing a reader of this response has to know*, and it belongs in
       * the API docs rather than only here: a phrase that occurs in one entry
       * matches the **book** too, because `object_fts` indexes the whole
       * serialised object. Two keys, one match. That is [05 §14.5]'s *one
       * query, three kinds of hit* working rather than a duplicate — the ranks
       * are per table and not comparable across them either.
       */
      entries: entries.map((row) => ({
        entryId: row.entryId,
        entryName: row.entryName,
        objectId: row.objectId,
        objectName: row.objectName,
        slug: row.slug,
        source: row.owner === 'system' ? 'system' : 'user',
        snippet: row.snippet,
      })),
    });
  });
}
