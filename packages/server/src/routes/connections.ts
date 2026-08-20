// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { AppServices } from '../app.js';
import { contentHashOf } from '../index-db/ingest.js';
import { readBindings, readSystemBindings } from '../providers/bindings.js';
import {
  ConnectionError,
  deleteConnection,
  presentForAdmin,
  readSystemConnections,
  writeConnection,
} from '../providers/connections.js';
import { MODEL_ROLES } from '../providers/types.js';
import type { RoleBindings } from '../providers/roles.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { readFileBytes } from '../storage/files.js';

/**
 * System connections and the install default bindings —
 * [05 §15.3](../../../../docs/design/05-ui-surfaces.md),
 * [P2B §3](../../../../docs/design/workplan/14-p2b-provider-configuration.md) stage P2B.2.
 *
 * Registered inside the `/api/admin` plugin, so the guard is the prefix's and
 * nothing here checks a role — [P2A §2.4] commits to never adding a per-handler
 * admin check, and the route-table test covers these the moment they register.
 *
 * **The scope line, once, so it is not renegotiated per route: this writes the
 * system scope and only the system scope** ([P2B §2.7]). A user's own
 * `connections/` and `bindings.json` stay read by the resolver, counted by the
 * delete warning, hand-written by anyone who wants one, and reachable from
 * nothing here. That is sharper than *per-user connections are deferred*, and it
 * is the right line: the per-user bindings file has a reader and no writer too,
 * and it would be easy to add one on the way past on the grounds that the shape
 * is already there.
 */

const ConnectionBody = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 200 }),
    provider: Type.String({ minLength: 1, maxLength: 64 }),
    /**
     * Absent means *keep what is stored*, which is what makes `hasKey` workable
     * as a form affordance — an empty password box cannot distinguish *no key*
     * from *unchanged*. An explicit empty string clears it.
     */
    apiKey: Type.Optional(Type.String({ maxLength: 512 })),
    baseUrl: Type.Optional(Type.String({ maxLength: 2048 })),
    models: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 200 }),
    capabilities: Type.Optional(Type.Object({}, { additionalProperties: true })),
  },
  { additionalProperties: false },
);

const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 200 }) });

/**
 * The whole document, under a hash — [P2B §6](../../../../docs/design/workplan/14-p2b-provider-configuration.md).
 *
 * A whole document rather than a patch per role: eight roles is not a chatty
 * write path, and a wrong binding stops turns rather than collapsing a pane. The
 * hash rather than config's document comparison, because nothing holds a prior
 * read of this file — every request reads it fresh — so the guard has to be
 * something the *client* presents, which is the library's own idiom.
 */
const BindingsBody = Type.Object(
  {
    bindings: Type.Object({}, { additionalProperties: true }),
    contentHash: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

const FetchModelsBody = Type.Object(
  {
    baseUrl: Type.Optional(Type.String({ maxLength: 2048 })),
    apiKey: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);

/** A stable hash of the bindings document, so a client can present what it read. */
async function bindingsState(
  services: AppServices,
): Promise<{ bindings: RoleBindings; contentHash: string }> {
  const bytes = await readFileBytes(services.layout.systemBindingsFile);
  return {
    bindings: await readSystemBindings(services.layout),
    // An absent file hashes as the empty document rather than as nothing, so
    // *there is no file* and *there is an empty file* present the same guard —
    // which is what a first write needs, since the client has neither.
    contentHash: contentHashOf(bytes ?? new TextEncoder().encode('{}\n')),
  };
}

export function registerConnectionRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/connections', async (_request, reply) => {
    const connections = await readSystemConnections(services.layout);
    return reply.send({ connections: connections.map(presentForAdmin) });
  });

  app.post('/connections', { schema: { body: ConnectionBody } }, async (request, reply) => {
    try {
      const written = await writeConnection(
        services.layout,
        services.layout.systemConnectionsRoot,
        bodyToInput(request.body),
      );
      services.providers.invalidate?.(written.id);
      return await reply.code(201).send({ connection: presentForAdmin(written) });
    } catch (error) {
      return await respond(error, reply);
    }
  });

  app.put(
    '/connections/:id',
    { schema: { params: IdParams, body: ConnectionBody } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const written = await writeConnection(
          services.layout,
          services.layout.systemConnectionsRoot,
          {
            id,
            ...bodyToInput(request.body),
          },
        );
        /**
         * **The writer owns the invalidation** ([P2B §2.4]).
         *
         * Without it, changing a base URL leaves every subsequent turn talking
         * to the old endpoint with the old limits until a restart — a cache
         * whose staleness was unreachable while nothing could write.
         */
        services.providers.invalidate?.(written.id);
        return await reply.send({ connection: presentForAdmin(written) });
      } catch (error) {
        return await respond(error, reply);
      }
    },
  );

  app.delete('/connections/:id', { schema: { params: IdParams } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteConnection(services.layout, services.layout.systemConnectionsRoot, id);
      services.providers.invalidate?.(id);
      return await reply.code(204).send();
    } catch (error) {
      return await respond(error, reply);
    }
  });

  /**
   * How many bindings point at a connection — [P2B §2.8].
   *
   * **Warns and proceeds** rather than refusing: an admin revoking a leaked key
   * must not be blocked by the fact that people were using it. And **counts,
   * never contents** — a list of who binds what to which key is a different
   * feature with a different justification, and nobody has asked for it.
   */
  app.get('/connections/:id/bindings', { schema: { params: IdParams } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ bindings: await countBindings(services, id) });
  });

  /**
   * Asks an endpoint what models it offers — [P2B §2.6].
   *
   * **An assist, not the path.** Typing a model id from memory is where *paste
   * in one API key and take a turn* falls down, and OpenAI-compatible endpoints
   * expose `GET {baseUrl}/models` — so this fills a picker from the endpoint's
   * own answer. The field stays free text, a failed fetch is a notice rather
   * than a blocked save, and an endpoint that does not implement `/models` costs
   * the admin nothing but the typing they would have done anyway.
   *
   * That matters more than it sounds: `/models` is optional in practice, and
   * several local runtimes answer it with one entry called `gpt-3.5-turbo`
   * regardless of what is loaded.
   *
   * **The one thing to be careful about, named rather than waved at:** this
   * makes the server fetch a URL an admin supplied. On a box whose entire
   * purpose is pointing at `localhost:8080` and the machine next door, refusing
   * private addresses would break the primary use case — so it is **not**
   * refused. The mitigation is that the action is admin-only, explicit, never
   * automatic, and its response is used only to populate a picker. That is a
   * smaller claim than *this is safe*, and it is the true one.
   */
  app.post('/connections/models', { schema: { body: FetchModelsBody } }, async (request, reply) => {
    const body = request.body as { baseUrl?: string; apiKey?: string };
    const base = (body.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');

    try {
      const response = await services.fetch(`${base}/models`, {
        headers: body.apiKey === undefined ? {} : { authorization: `Bearer ${body.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return await reply.code(502).send({
          error: 'unreachable',
          message: 'That endpoint did not answer with a model list.',
        });
      }
      const payload: unknown = await response.json();
      return await reply.send({ models: modelIdsFrom(payload) });
    } catch {
      // A class, never the fetch's own message — it can carry the URL, and the
      // URL can carry a token.
      return await reply
        .code(502)
        .send({ error: 'unreachable', message: 'That endpoint could not be reached.' });
    }
  });

  app.get('/bindings', async (_request, reply) => {
    return reply.send(await bindingsState(services));
  });

  app.put('/bindings', { schema: { body: BindingsBody } }, async (request, reply) => {
    const body = request.body as { bindings: Record<string, unknown>; contentHash: string };
    const current = await bindingsState(services);

    if (body.contentHash !== current.contentHash) {
      // The library's own vocabulary: 412 carrying what is there now, so a
      // client can offer *load what is on disk* rather than only being told no.
      return await reply.code(412).send({
        error: 'stale',
        message: 'The bindings file has changed since this page read it.',
        current: current.bindings,
      });
    }

    const picked = pickBindings(body.bindings);
    await writeJsonAtomic(services.layout.systemBindingsFile, picked);
    return await reply.send(await bindingsState(services));
  });
}

/**
 * Only the roles this build knows, and only well-formed bindings.
 *
 * The same pick-what-you-know posture the config write takes: a role the caller
 * invents does not reach disk, not because it was rejected but because nothing
 * looked at it. Unlike config there is nothing on disk to preserve — a bindings
 * document is exactly its eight possible keys — so this is a whole rewrite
 * rather than a merge.
 */
function pickBindings(body: Record<string, unknown>): RoleBindings {
  const picked: RoleBindings = {};
  for (const role of MODEL_ROLES) {
    const value = body[role];
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Record<string, unknown>;
    if (typeof record['connectionId'] !== 'string' || typeof record['modelId'] !== 'string') {
      continue;
    }
    picked[role] = { connectionId: record['connectionId'], modelId: record['modelId'] };
  }
  return picked;
}

/** Every account's bindings plus the install's, counted against one connection. */
async function countBindings(services: AppServices, connectionId: string): Promise<number> {
  let count = 0;
  const install = await readSystemBindings(services.layout);
  count += Object.values(install).filter((binding) => binding.connectionId === connectionId).length;

  for (const account of await services.accounts.list()) {
    const theirs = await readBindings(services.layout, account.handle);
    count += Object.values(theirs).filter(
      (binding) => binding.connectionId === connectionId,
    ).length;
  }
  return count;
}

/**
 * Model ids out of whatever the endpoint answered.
 *
 * Defensive rather than schema-checked, because this is the one response in the
 * server that comes from a host an admin named and nobody vetted. A shape it
 * does not recognise is an empty list — which the form renders as *no models
 * offered*, and the field stays free text, so the admin types what they were
 * going to type anyway.
 */
function modelIdsFrom(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const data = (payload as Record<string, unknown>)['data'];
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) =>
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)['id']
        : undefined,
    )
    .filter((id): id is string => typeof id === 'string');
}

function bodyToInput(body: unknown): {
  label: string;
  provider: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  models: string[];
  capabilities?: Record<string, unknown> | undefined;
} {
  const record = body as {
    label: string;
    provider: string;
    apiKey?: string;
    baseUrl?: string;
    models: string[];
    capabilities?: Record<string, unknown>;
  };
  return {
    label: record.label,
    provider: record.provider,
    ...(record.apiKey === undefined ? {} : { apiKey: record.apiKey }),
    ...(record.baseUrl === undefined ? {} : { baseUrl: record.baseUrl }),
    models: record.models,
    ...(record.capabilities === undefined ? {} : { capabilities: record.capabilities }),
  };
}

/**
 * The store's refusals, in the API's vocabulary.
 *
 * Its own function rather than a widened copy of `admin.ts`'s: that one indexes
 * a map by a four-member union and only typechecks because the literal's keys
 * cover it exactly. What is worth copying is the `instanceof` guard — it is what
 * sends an unexpected error to the handler that answers a status with no
 * message, rather than leaking a filesystem path.
 */
async function respond(error: unknown, reply: FastifyReply): Promise<FastifyReply> {
  if (!(error instanceof ConnectionError)) throw error;
  const status = { 'not-found': 404, invalid: 400, unbuildable: 400 }[error.code];
  return reply.code(status).send({ error: error.code, message: error.message });
}
