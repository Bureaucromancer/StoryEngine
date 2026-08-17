// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { type AppServices, requireAccount } from '../app.js';
import { search } from '../index-db/query.js';
import { searchTurns } from '../index-db/sessions.js';
import { readableScopes } from '../library.js';

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

const SearchQuery = Type.Object({
  q: Type.String({ minLength: 1, maxLength: 200 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});

export function registerSearchRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/search', { schema: { querystring: SearchQuery } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const { q, limit = 50 } = request.query as { q: string; limit?: number };
    const scopes = readableScopes(account.handle).map((scope) =>
      scope.kind === 'system' ? 'system' : `user:${scope.handle}`,
    );

    let objects;
    let turns;
    try {
      objects = search(services.index.db, q, limit);
      turns = searchTurns(services.index.db, scopes, q, limit);
    } catch {
      // FTS5 has a query syntax, and a person typing into a search box does not
      // know it — an unbalanced quote or a bare `*` is a syntax error from
      // SQLite, not a server fault. Answering 400 rather than 500 says whose
      // problem it is.
      return reply
        .code(400)
        .send({ error: 'invalid', message: 'That search query could not be parsed.' });
    }

    return reply.send({
      objects: objects
        // Scoped after the query rather than inside it: `search` is the library's
        // and takes no scopes, and giving it some for this one caller would put
        // the containment rule in two places ([04 §4.3]).
        .filter((row) => scopes.includes(row.scope))
        .map((row) => ({
          id: row.id,
          schema: row.schemaId,
          name: row.name,
          slug: row.slug,
          source: row.scope === 'system' ? 'system' : 'user',
        })),
      turns,
    });
  });
}
