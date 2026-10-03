// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { requireAccount, type AppServices } from '../app.js';
import {
  pickBindings,
  readBindings,
  readSystemBindings,
  systemBindingsState,
} from '../providers/bindings.js';
import {
  ConnectionError,
  deleteConnection,
  presentConnectionsForAdmin,
  presentForAdmin,
  readSystemConnectionEntries,
  readSystemConnections,
  readUserConnectionEntries,
  writeConnection,
} from '../providers/connections.js';
import {
  type Binding,
  defaultBindings,
  presentRoleRow,
  type RoleBindings,
  roleTable,
} from '../providers/roles.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { isLocalEndpoint } from '../updates.js';

/**
 * System connections and the install default bindings —
 * [10 §15.3](../../../../docs/design/10-ui-surfaces.md),
 * [P2B §3](../../../../docs/design/workplan/10-p2b-provider-configuration.md) stage P2B.2.
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
 *
 * ---
 *
 * ***That line expired on schedule, and this file now has two registrars***
 * — 2026-09-16, [P10.3]. {@link registerConnectionRoutes} is still the system
 * scope and only the system scope; {@link registerMyConnectionRoutes} is
 * [10 §15.1](../../../../docs/design/10-ui-surfaces.md)'s *your connections*,
 * which [P2B §2.7] sent to *"the phase after, or at P10 with the rest of
 * §15.1"*. The per-user bindings half went at [P7.3].
 *
 * ***Two registrars in one file rather than two files, and the reason is the
 * paragraph above.*** What made the old line worth writing is that the two
 * scopes share a **body schema, a stale check, a presenter and an error
 * vocabulary** — so the easy mistake was never a second module, it was a route
 * in this one quietly pointing at the other root. Keeping them here makes each
 * root appear at a call site where the other is visible, and the guard is now a
 * capability rather than a promise.
 *
 * **The personal half is gated on `privateConnections`, checked per request.**
 * [09 §4.5](../../../../docs/design/09-server-multiuser-deployment.md) calls a
 * UI-level check *"a trivial bypass"* and puts the real one in the loader, where
 * it has been since P3 — so this gate is not the security boundary either. It is
 * there so that somebody whose capability was withdrawn stops being offered a
 * form whose writes the resolver would then ignore.
 */

const CONNECTION_FIELDS = {
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
  /** Which of `models` see pictures ([25 E15]). Absent keeps what is stored. */
  imageModels: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 200 }),
  ),
  capabilities: Type.Optional(Type.Object({}, { additionalProperties: true })),
};

const ConnectionBody = Type.Object(CONNECTION_FIELDS, { additionalProperties: false });

/**
 * An edit presents what it read — [P2B §6](../../../../docs/design/workplan/10-p2b-provider-configuration.md).
 *
 * Required rather than optional, because an optional guard is not one: a client
 * that omitted it would get the old behaviour, which is the behaviour this
 * exists to stop. A **create** has nothing to be stale against, so
 * {@link ConnectionBody} stays as it was and only the `PUT` body extends it.
 *
 * Spelled as one closed object over a shared field map rather than as
 * `Type.Intersect`: an `allOf` of two schemas that each close
 * `additionalProperties` refuses every key the *other* branch declares, so the
 * intersection accepts nothing at all. It typechecks, and every edit answers
 * 400.
 */
const EditBody = Type.Object(
  { ...CONNECTION_FIELDS, contentHash: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);

const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 200 }) });

/**
 * The two models a first run answers with — [19 §5.1](../../../../docs/design/19-tech-stack.md)'s
 * *a good one and a cheap one*.
 *
 * Sent as two bindings rather than as eight, because the eight are policy
 * ({@link ROLE_TIER_DEFAULTS}) and policy belongs on the server: a client that
 * posted a whole document would be free to spread them differently, and the
 * first install to do so would have `prose` on the cheap model with nothing
 * anywhere saying that was a choice.
 */
const DefaultsBody = Type.Object(
  {
    hi: Type.Object(
      {
        connectionId: Type.String({ minLength: 1, maxLength: 200 }),
        modelId: Type.String({ minLength: 1, maxLength: 200 }),
      },
      { additionalProperties: false },
    ),
    lo: Type.Object(
      {
        connectionId: Type.String({ minLength: 1, maxLength: 200 }),
        modelId: Type.String({ minLength: 1, maxLength: 200 }),
      },
      { additionalProperties: false },
    ),
    contentHash: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

/**
 * The whole document, under a hash — [P2B §6](../../../../docs/design/workplan/10-p2b-provider-configuration.md).
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

/**
 * A stable hash of the bindings document, so a client can present what it read.
 *
 * *The rule moved to `providers/bindings.ts` at [P7.3]*, when the personal file
 * grew a writer and wanted the same one — in particular the empty-file
 * convention, which is the half worth having in one place. This stays as a
 * one-line alias because every call here is about the *system* document and
 * saying so at the call site is the point.
 */
async function bindingsState(
  services: AppServices,
): Promise<{ bindings: RoleBindings; contentHash: string }> {
  return systemBindingsState(services.layout);
}

export function registerConnectionRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/connections', async (_request, reply) => {
    const entries = await readSystemConnectionEntries(services.layout);
    return reply.send({ connections: presentConnectionsForAdmin(entries) });
  });

  app.post('/connections', { schema: { body: ConnectionBody } }, async (request, reply) => {
    try {
      const written = await writeConnection(
        services.layout,
        services.layout.systemConnectionsRoot,
        bodyToInput(request.body),
      );
      services.providers.invalidate?.(written.connection.id);
      return await reply
        .code(201)
        .send({ connection: presentForAdmin(written.connection, written.contentHash) });
    } catch (error) {
      return await respond(error, reply);
    }
  });

  app.put(
    '/connections/:id',
    { schema: { params: IdParams, body: EditBody } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const presented = (request.body as { contentHash: string }).contentHash;

      /**
       * **The stale check, against the file rather than against a held read**
       * ([P2B §6]).
       *
       * Nothing in the process remembers a connection between requests, so the
       * comparison is the library's idiom and not the config form's: the client
       * presents the hash it read and this compares it to what is on disk now.
       * The writer this defends against is a text editor — a connections
       * directory is hand-editable by design ([P2B §2.3]) — and without it,
       * renaming a connection in the form silently reverts whatever somebody
       * changed in the file since the page loaded.
       */
      const entries = await readSystemConnectionEntries(services.layout);
      const current = entries.find((entry) => entry.connection.id === id);
      if (current === undefined) {
        return await reply
          .code(404)
          .send({ error: 'not-found', message: `No connection with the id ${id}.` });
      }
      if (current.contentHash !== presented) {
        return await reply.code(412).send({
          error: 'stale',
          message: 'That connection has changed on disk since this page read it.',
          current: presentForAdmin(current.connection, current.contentHash),
          contentHash: current.contentHash,
        });
      }

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
         * (2026-10-03: not since 2026-09-27 — each memo slot remembers the
         * connection it was built from and rebuilds for one that says anything
         * new (`factory.ts`), and every turn re-reads the files, so an edit
         * reaches the next turn without this call. What it still does is
         * release the provider the write replaced, key and all: see
         * `factory.test.ts`, "releases the provider, so the next call builds a
         * fresh one", and [P2B §2.4]'s *Amended 2026-09-27*.)
         */
        services.providers.invalidate?.(written.connection.id);

        /**
         * **Presented over the list, not on its own** — because an edit can
         * change which of two files claiming one id *wins*.
         *
         * `shadowed` is decided by label order ([P2B §4] step 10), so renaming
         * the winner from `A` to `Z` hands the win to the other file: a
         * different endpoint, a different key, and the role silently repointed.
         * Answering with `presentForAdmin` alone reported `shadowed: false`
         * about a connection the same write had just killed — the one moment
         * the admin had any signal at all, spent saying the opposite.
         *
         * Matched on the path `writeConnection` returns rather than by
         * re-deciding the winner, so this does not become a second
         * implementation of the order the list already computes. Found by a
         * P2B review.
         */
        const after = await readSystemConnectionEntries(services.layout);
        const rows = presentConnectionsForAdmin(after);
        const mine = after.findIndex((entry) => entry.path === written.path);
        return await reply.send({
          connection:
            mine === -1 ? presentForAdmin(written.connection, written.contentHash) : rows[mine],
        });
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
  app.post('/connections/models', { schema: { body: FetchModelsBody } }, async (request, reply) =>
    fetchModels(services, request.body, reply),
  );

  app.get('/bindings', async (_request, reply) => {
    return reply.send(await bindingsState(services));
  });

  /**
   * What every role will do — [P2B §3](../../../../docs/design/workplan/10-p2b-provider-configuration.md)
   * stage P2B.3, and the route the role table could not be built without.
   *
   * **Which layer won is computed here, because it is only computable here.**
   * It is a local in `resolveRole`, it is deliberately absent from the turn
   * record ([21 §1.4] specifies no such field), and before this nothing
   * returned it — so a table showing it would have had to reimplement
   * [19 §5.1]'s layering in the browser, against two binding maps it would also
   * have had to fetch. That is a second copy of the resolution order living in
   * a different language from the first.
   *
   * **The install's answer, not the caller's.** The question this surface asks
   * is *what has the install got* ([P2B §2.7]'s line), so it resolves the
   * system bindings against the system connections and passes no personal
   * layer at all. An admin's own `bindings.json` is theirs and belongs in the
   * user half, which is the phase after — the same reason `readSystemConnections`
   * exists beside `resolveConnections`.
   */
  app.get('/roles', async (_request, reply) => {
    const rows = roleTable({
      bindings: {},
      defaults: await readSystemBindings(services.layout),
      usable: await readSystemConnections(services.layout),
    });

    // `presentRoleRow` rather than a mapping written here — [P7.3]. The user
    // half answers the same shape from different layers, and one function is
    // what keeps that true.
    return reply.send({ roles: rows.map(presentRoleRow) });
  });

  /**
   * The first run's two answers, spread across the eight roles — [P2B §3] stage
   * P2B.4, and {@link defaultBindings}'s first production caller.
   *
   * **Two bindings in, a whole document out.** The spread is
   * {@link ROLE_TIER_DEFAULTS}'s policy — *the expensive model writes,
   * everything else uses the cheap one* — and it stays on this side of the wire
   * so that an install cannot end up with `prose` on the cheap model without
   * anybody having chosen that. A client posting eight bindings itself is
   * `PUT /bindings`, which still exists for the admin who is editing rather
   * than starting.
   *
   * Under the same hash guard as `PUT /bindings`, and for a sharper reason: the
   * offer this answers appears right after a connection is saved, which is
   * exactly when a second admin — or the person who wrote the file by hand a
   * minute ago — is most likely to have put something there already.
   */
  app.post('/bindings/defaults', { schema: { body: DefaultsBody } }, async (request, reply) => {
    const body = request.body as { hi: Binding; lo: Binding; contentHash: string };
    const current = await bindingsState(services);

    if (body.contentHash !== current.contentHash) {
      return await reply.code(412).send({
        error: 'stale',
        message: 'The bindings file has changed since this page read it.',
        current: current.bindings,
        contentHash: current.contentHash,
      });
    }

    /**
     * **Merged over what is there, not written over it.** `defaultBindings`
     * builds a document of exactly the five `hi`/`lo` roles — `image`, `video`
     * and `speech` are *unset by design* and simply absent — so writing it
     * verbatim destroyed any hand-written binding for those three. Hand-editing
     * `bindings.json` is a first-class gesture here, and the moment this offer
     * appears — right after a first connection is saved — is precisely when a
     * person who wrote the file a minute ago is looking at it.
     *
     * The five defaulted roles still take the new answer; that is what the
     * button says it does. Only the roles it does not speak for survive.
     */
    await writeJsonAtomic(services.layout.systemBindingsFile, {
      ...current.bindings,
      ...defaultBindings(body.hi, body.lo),
    });
    return await reply.send(await bindingsState(services));
  });

  app.put('/bindings', { schema: { body: BindingsBody } }, async (request, reply) => {
    const body = request.body as { bindings: Record<string, unknown>; contentHash: string };
    const current = await bindingsState(services);

    if (body.contentHash !== current.contentHash) {
      /**
       * The library's own vocabulary: 412 carrying what is there now, so a
       * client can offer *load what is on disk* rather than only being told no.
       *
       * **And the hash of what is there now, which this refusal used to
       * withhold.** `docs/api.md` states it as a property of every 412 on this
       * server — *a 412 always carries a hash different from the one you sent* —
       * and the reason is that without one, *overwrite with mine* has nothing to
       * present and the form is wedged: it can only re-send the hash that was
       * just refused. The connection form escaped exactly that wedge at P2A by
       * carrying the hash back; this route was written before anything wrote
       * bindings from a form, so the gap was unreachable and stayed.
       */
      return await reply.code(412).send({
        error: 'stale',
        message: 'The bindings file has changed since this page read it.',
        current: current.bindings,
        contentHash: current.contentHash,
      });
    }

    const picked = pickBindings(body.bindings);
    await writeJsonAtomic(services.layout.systemBindingsFile, picked);
    return await reply.send(await bindingsState(services));
  });
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
  imageModels?: string[] | undefined;
  capabilities?: Record<string, unknown> | undefined;
} {
  const record = body as {
    label: string;
    provider: string;
    apiKey?: string;
    baseUrl?: string;
    models: string[];
    imageModels?: string[];
    capabilities?: Record<string, unknown>;
  };
  return {
    label: record.label,
    provider: record.provider,
    ...(record.apiKey === undefined ? {} : { apiKey: record.apiKey }),
    ...(record.baseUrl === undefined ? {} : { baseUrl: record.baseUrl }),
    models: record.models,
    ...(record.imageModels === undefined ? {} : { imageModels: record.imageModels }),
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
/**
 * `GET {baseUrl}/models`, as a picker's worth of ids — [P2B §2.6], [P10.3].
 *
 * ***One implementation behind two routes***, because the admin's and the
 * personal one ask an endpoint the identical question and the interesting part
 * is the **error vocabulary**: a refused key and an unreachable host point at
 * opposite remedies, and a copy of this would be a second place for those to
 * drift back together.
 *
 * `gate` is the personal route's capability check, already performed — `null`
 * means it answered and this must not. The admin route passes nothing, because
 * its guard is the `/api/admin` prefix's.
 */
async function fetchModels(
  services: AppServices,
  requestBody: unknown,
  reply: FastifyReply,
  gate?: unknown,
): Promise<FastifyReply | undefined> {
  if (gate === null) return undefined;

  const body = requestBody as { baseUrl?: string; apiKey?: string };
  const base = (body.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');

  try {
    const response = await services.fetch(`${base}/models`, {
      headers: body.apiKey === undefined ? {} : { authorization: `Bearer ${body.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    /**
     * **A refused key is not an unreachable endpoint** — finding 5 in
     * [P2C log](../../../../docs/design/workplan/14-p2c-log.md). Both answered
     * `502 unreachable`, and the remedies point in opposite directions: an
     * admin told *unreachable* checks the URL and the network, when what is
     * wrong is the one field this response cannot name. Adding a connection is
     * a stranger's third step, so this is the first wrong turn available.
     *
     * Still a class and never the endpoint's own words, for the same reason as
     * below — the body can echo the key it is refusing.
     */
    if (response.status === 401 || response.status === 403) {
      return await reply.code(401).send({
        error: 'unauthorized',
        message: 'That endpoint refused the key.',
      });
    }
    if (!response.ok) {
      return await reply.code(502).send({
        error: 'unreachable',
        message: 'That endpoint did not answer with a model list.',
      });
    }
    const payload: unknown = await response.json();
    return await reply.send({ models: modelIdsFrom(payload) });
  } catch {
    /**
     * ***Nothing answered, and [P11.6] splits that in two.***
     *
     * [09 §6.5](../../../../docs/design/09-server-multiuser-deployment.md) asks
     * for *"this server appears to have no internet access"* instead of a raw
     * connection error, and **this route is where a stranger meets it first**:
     * adding a connection is their third step, and a remote endpoint that will
     * never work because the machine has no route out is the failure most
     * likely to be diagnosed as a wrong URL.
     *
     * **Both conditions, and the order matters.** A *local* endpoint that does
     * not answer says nothing about the internet — the model server is simply
     * not running, and telling that operator they are offline is the mistake
     * §6.5 warns about. And `online` is only claimed when a check has actually
     * run: `null` is *nothing has looked*, which leaves the neutral sentence
     * rather than inventing a diagnosis in a server's first minute.
     *
     * A class, never the fetch's own message — it can carry the URL, and the
     * URL can carry a token.
     */
    const offline = !isLocalEndpoint(base) && services.updates.online === false;
    return await reply.code(502).send(
      offline
        ? {
            error: 'offline',
            message: 'This server appears to have no internet access.',
          }
        : { error: 'unreachable', message: 'That endpoint could not be reached.' },
    );
  }
}

async function respond(error: unknown, reply: FastifyReply): Promise<FastifyReply> {
  if (!(error instanceof ConnectionError)) throw error;
  const status = { 'not-found': 404, invalid: 400, unbuildable: 400 }[error.code];
  return reply.code(status).send({ error: error.code, message: error.message });
}

/**
 * *Your* connections — [10 §15.1](../../../../docs/design/10-ui-surfaces.md),
 * [P2B §2.7](../../../../docs/design/workplan/10-p2b-provider-configuration.md),
 * [P10.3].
 *
 * ***The same form the admin has, scoped to the path that is the owner***,
 * which is this stage's brief verbatim. Every route below is the system one with
 * one substitution — `userConnectionsRoot(handle)` for `systemConnectionsRoot` —
 * and nothing else differs, because nothing else should: a personal connection
 * *is* a system connection in a different directory, which is exactly what
 * `resolveConnections` has always believed.
 *
 * **[19 §5.1]'s sentence is the point of the whole surface**: *"anyone who wants
 * their own key overrides a role without the admin's involvement"*. Until now
 * the only way to exercise it was to write a JSON file by hand.
 *
 * **Personal first in resolution order**, which is `resolveConnections`' own
 * rule and is why nothing here needs to say anything about precedence: a
 * personal connection wins over a system default, visibly and switchably, and
 * `presentConnectionsForAdmin` computes `shadowed` from the array it is given.
 * *The array here is the personal scope alone*, so a personal file shadowing a
 * **system** one reads as `shadowed: false` — correct, because it is the one
 * that wins. It wins for **this account only**, which was not true until the
 * provider memo began checking what each slot was built from (`factory.ts`,
 * 2026-09-27): before that, the memo was keyed on the id alone, and whichever
 * of the two was built first was served to every account.
 *
 * A create here mints a uuidv7 and cannot collide; a file a person wrote by
 * hand, or a backup import carried in, can. `resolveConnections` reports it as
 * `shadowing` and the runner logs a count. ***This list does not say so*** —
 * `shadowed: false` is the truth about the row and silence about what it
 * hides, and showing that is a known follow-up recorded under
 * [P2B §1.5](../../../../docs/design/workplan/10-p2b-provider-configuration.md).
 */
export function registerMyConnectionRoutes(app: FastifyInstance, services: AppServices): void {
  /**
   * The capability, per request.
   *
   * ***Re-read rather than held***, which is `gather.ts`'s rule on a smaller
   * subject: an admin who withdraws `privateConnections` while somebody has the
   * form open should find that the next save is refused, not that it lands
   * because a session cookie remembers a capability from before.
   *
   * *404 rather than 403 is deliberately **not** used here.* The account exists
   * and the route exists; what is missing is permission, and `forbidden` is the
   * honest class — the same one `adminOnly` sends. Hiding it would leave
   * somebody who was told *ask an administrator* unable to tell whether they
   * had been refused or had mistyped a URL.
   */
  async function permitted(
    request: Parameters<typeof requireAccount>[0],
    reply: FastifyReply,
  ): Promise<{ handle: string; root: string } | null> {
    const account = await requireAccount(request, reply);
    if (!account) return null;

    const held = await services.accounts.find(account.handle);
    if (held?.capabilities.privateConnections !== true) {
      await reply.code(403).send({
        error: 'forbidden',
        message: 'This account may not keep its own provider connections.',
      });
      return null;
    }
    return { handle: account.handle, root: services.layout.userConnectionsRoot(account.handle) };
  }

  app.get('/me/connections', async (request, reply) => {
    const mine = await permitted(request, reply);
    if (!mine) return;

    const entries = await readUserConnectionEntries(services.layout, mine.handle);
    return reply.send({ connections: presentConnectionsForAdmin(entries) });
  });

  app.post('/me/connections', { schema: { body: ConnectionBody } }, async (request, reply) => {
    const mine = await permitted(request, reply);
    if (!mine) return;

    try {
      const written = await writeConnection(services.layout, mine.root, bodyToInput(request.body));
      // The same invalidation the admin path does, for the same reason: the
      // factory caches by connection id and a personal id is a connection id.
      services.providers.invalidate?.(written.connection.id);
      return await reply
        .code(201)
        .send({ connection: presentForAdmin(written.connection, written.contentHash) });
    } catch (error) {
      return await respond(error, reply);
    }
  });

  app.put(
    '/me/connections/:id',
    { schema: { params: IdParams, body: EditBody } },
    async (request, reply) => {
      const mine = await permitted(request, reply);
      if (!mine) return;

      const { id } = request.params as { id: string };
      const presented = (request.body as { contentHash: string }).contentHash;

      /**
       * **The stale check, and here it defends against the same text editor**
       * ([P2B §6]) — more so, in fact: [P2B §2.3] promises a hand-written
       * personal file keeps working, and this directory is the one a person is
       * most likely to have edited themselves.
       *
       * *Scoped to their own entries*, so an id that exists only in the system
       * scope is a 404 rather than a route into somebody else's file.
       */
      const entries = await readUserConnectionEntries(services.layout, mine.handle);
      const current = entries.find((entry) => entry.connection.id === id);
      if (current === undefined) {
        return await reply
          .code(404)
          .send({ error: 'not-found', message: `No connection with the id ${id}.` });
      }
      if (current.contentHash !== presented) {
        return await reply.code(412).send({
          error: 'stale',
          message: 'That connection has changed on disk since this page read it.',
          current: presentForAdmin(current.connection, current.contentHash),
          contentHash: current.contentHash,
        });
      }

      try {
        const written = await writeConnection(services.layout, mine.root, {
          id,
          ...bodyToInput(request.body),
        });
        services.providers.invalidate?.(written.connection.id);

        // Presented over the list, for the admin path's reason: an edit can
        // change which of two files claiming one id wins, and answering with
        // the single presenter would report `shadowed: false` about a
        // connection the same write had just killed.
        const after = await readUserConnectionEntries(services.layout, mine.handle);
        const rows = presentConnectionsForAdmin(after);
        const at = after.findIndex((entry) => entry.path === written.path);
        return await reply.send({
          connection:
            at === -1 ? presentForAdmin(written.connection, written.contentHash) : rows[at],
        });
      } catch (error) {
        return await respond(error, reply);
      }
    },
  );

  app.delete('/me/connections/:id', { schema: { params: IdParams } }, async (request, reply) => {
    const mine = await permitted(request, reply);
    if (!mine) return;

    const { id } = request.params as { id: string };
    try {
      /**
       * **No binding count and no warning**, which is the one place this
       * deliberately differs from the admin form.
       *
       * [P2B §2.8]'s warning exists because an admin deleting a system
       * connection breaks **other people's** turns, and *"counts, never
       * contents"* is how it says so without listing who binds what. Deleting
       * your own breaks your own, and telling somebody that a thing they are
       * about to delete is used by them is not information.
       */
      await deleteConnection(services.layout, mine.root, id);
      services.providers.invalidate?.(id);
      return await reply.code(204).send();
    } catch (error) {
      return await respond(error, reply);
    }
  });

  /**
   * Asks an endpoint what models it offers — the admin route's twin.
   *
   * ***Worth a sentence about why this is not a new reach.*** It makes the
   * server fetch a URL the caller typed, which is the shape of a request worth
   * being careful with. But an account with `privateConnections` can already
   * store that URL as a connection and have every turn call it — so what this
   * adds is the *timing*, not the capability, and refusing it would leave the
   * form worse without making anything safer. The gate is the same one, checked
   * the same way.
   */
  app.post(
    '/me/connections/models',
    { schema: { body: FetchModelsBody } },
    async (request, reply) =>
      fetchModels(services, request.body, reply, await permitted(request, reply)),
  );
}
