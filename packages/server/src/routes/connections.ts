// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Candidate, StepDefinition } from '@storyengine/sdk';

import { requireAccount, type AppServices } from '../app.js';
import {
  pickBindings,
  readBindings,
  readSystemBindings,
  systemBindingsState,
} from '../providers/bindings.js';
import { redactText } from '../providers/capture.js';
import {
  ConnectionError,
  type ConnectionEntry,
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
import {
  type ErrorClass,
  type ModelRole,
  type Provider,
  ProviderError,
} from '../providers/types.js';
import { writeJsonAtomic } from '../storage/atomic.js';
import { CallFailed, Cancelled, performCall, WindowTooSmall } from '../turns/calls.js';
import { isLocalEndpoint } from '../updates.js';
import { CONNECTION_TEST_ROLE, fromModelCall, recordUsage, USAGE_SCHEMA } from '../usage/log.js';
import { disconnectSignal } from './disconnect.js';

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
 * The completion ceiling a test message is asked for — [polish §25].
 *
 * ***High enough for a model that thinks before it answers, and that is the
 * only reason it is not 32.*** An ordinary model says hello in a dozen tokens
 * and stops, so the ceiling costs nothing there; a reasoning model spends its
 * first hundred or so thinking, and at a tiny cap it returns *empty text,
 * finished by length* — a working connection that reads as a broken one. Worst
 * case at a frontier price is about two cents, for a button a person pressed.
 *
 * `max_tokens` is also what every turn already sends (the built-in presets say
 * 800), so an endpoint that refuses the parameter refuses turns too, and the
 * test saying so is the test being right.
 */
const TEST_MAX_TOKENS = 256;

/** Longer than any test prompt a person types, short enough that nobody pastes a chapter. */
const TEST_PROMPT_MAX_CHARS = 2000;

/**
 * What a test asks — [polish §25].
 *
 * ***Closed, and closed on purpose***: a body carrying `apiKey` or `baseUrl` is
 * refused rather than honoured, because what this route tests is **what is
 * saved** — the stored key, the stored address, the memoised provider a turn
 * would get. A test of the form as typed would be a test of a configuration no
 * turn uses yet, and it would need the key to travel, which a saved connection
 * never makes it do.
 *
 * `modelId` is deliberately **not** checked against the connection's `models`.
 * That list may be empty (it is free text, [P2B §2.6]), and *try this model
 * before adding it* is one of the things a test is for.
 */
const TestBody = Type.Object(
  {
    kind: Type.Union([Type.Literal('text'), Type.Literal('image')]),
    modelId: Type.String({ minLength: 1, maxLength: 200 }),
    prompt: Type.String({ minLength: 1, maxLength: TEST_PROMPT_MAX_CHARS, pattern: '\\S' }),
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

  /**
   * Tries a saved connection — [polish §25], and the health check
   * [P2B §5](../../../../docs/design/workplan/10-p2b-provider-configuration.md)
   * deferred until the connectivity work existed.
   *
   * The install's connections, resolved the way the list presents them, and
   * recorded in the usage log of the admin who pressed it — the prefix's guard
   * has put them on the request. See {@link testConnection} for everything else.
   */
  app.post(
    '/connections/:id/test',
    { schema: { params: IdParams, body: TestBody } },
    async (request, reply) =>
      testConnection(
        services,
        request,
        reply,
        await readSystemConnectionEntries(services.layout),
        request.account?.handle,
      ),
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
    return await reply.code(502).send(silence(services, base));
  }
}

/**
 * *Nothing answered*, in [P11.6]'s two words — one spelling for the two routes
 * that meet it.
 *
 * `offline` only when the endpoint is remote **and** a check has actually
 * established there is no route out; a local model server that does not answer
 * is simply not running, and `null` is *nothing has looked*. The reasoning is
 * {@link fetchModels}' catch block, and it lives here so the test route cannot
 * drift from it: a stranger meets this sentence on whichever of the two buttons
 * they press first.
 */
function silence(
  services: AppServices,
  baseUrl: string | undefined,
): { error: 'offline' | 'unreachable'; message: string } {
  return !isLocalEndpoint(baseUrl) && services.updates.online === false
    ? { error: 'offline', message: 'This server appears to have no internet access.' }
    : { error: 'unreachable', message: 'That endpoint could not be reached.' };
}

/**
 * The step a connection test's message is, for `performCall` — [polish §25].
 *
 * ***True of the call in every field `performCall` reads.*** A message a person
 * reads and nothing written (`contributes: 'messages'`, `writes: []`), so its
 * purpose is `prose` and no advisory block could reach it; `failure: 'abort'`
 * because nothing follows it. Its `callKind` matches no preset block, and no
 * preset is collected: the one candidate is this route's own.
 *
 * ***The role is a key, not a claim.*** `performCall` resolves a role through a
 * bindings document, and a test has no role — it asks one model on one
 * connection, both chosen by the person pressing the button. So the route
 * hands it a bindings document of one entry under this role, naming exactly
 * the connection and model to try, and a `usable` list holding only that
 * connection: resolution cannot land anywhere else, and the install's and the
 * account's real bindings are never read. `prose` because it is the role every
 * install binds first; nothing else the role decides in planning applies here
 * (no session or step override, no actor hint, no preset). The usage line does
 * not repeat it — see {@link CONNECTION_TEST_ROLE}.
 */
const TEST_ROLE_KEY: ModelRole = 'prose';

const TEST_STEP: StepDefinition = {
  id: 'se.connection.test',
  stage: 'generate',
  reads: [],
  writes: [],
  contributes: 'messages',
  callKind: 'connection-test',
  when: { when: 'cadence', everyNTurns: 1 },
  failure: 'abort',
  role: TEST_ROLE_KEY,
};

/**
 * One call to a saved connection, on demand — [polish §25], discharging the
 * health check [P2B §5](../../../../docs/design/workplan/10-p2b-provider-configuration.md)
 * deferred: *"is this key still good" is a live call with a cost, and it belongs
 * with the connectivity work P10 does once P11's producer exists.* Both have
 * landed, and this answers in [P11.6]'s vocabulary.
 *
 * ***What is tested is what is saved.*** The connection is looked up by id in
 * `entries` — which the caller scopes, so the admin's and the personal route
 * differ only at their call sites — and the provider comes from
 * `services.providers`, the **same memoised factory a turn uses**. So a pass
 * means a turn will work, a `--capture` run records the exchange as a cassette
 * like any other, and the stored key is used without ever leaving the server.
 * `find` takes the first claimant of an id, which is the winner: entries are
 * label-ordered and `presentConnectionsForAdmin` marks every later one
 * `shadowed`, the same rule `resolveRole` applies.
 *
 * ***It never invalidates the memo***, and that is a decision rather than an
 * omission: ~~a test that rebuilt the provider would test something no turn
 * uses, and would make pressing a button a way to put a provider into a cache
 * that other people's turns read from.~~ *(2026-10-03: both reasons belonged to
 * the memo keyed by id, which the branch was written against — there, a
 * rebuilt provider could differ from the stale one turns were still handed,
 * and the rebuild would land in the slot they read. Since 8dc8e587
 * (2026-09-27) each slot remembers the connection it was built from, so this
 * route's own `services.providers(connection)` already builds and caches a
 * fresh provider whenever the file says anything new — exactly what the next
 * turn would build — and no turn can be handed a provider built from a
 * different connection. What is left is smaller: an invalidate here would only
 * throw away a provider the next call rebuilds identically, so not
 * invalidating is a small decision now rather than a safeguard.)*
 *
 * ***A message goes through `performCall`, like every other call that is not a
 * turn*** (merged 2026-10-03 — the recommended answer, which the owner deferred
 * to). The branch this route came from (2026-09-26) called `provider.generate`
 * itself, with its own timeout and one attempt; main had meanwhile made
 * `performCall` the one way a model call is made — 8c34a7f7 moved the field
 * assist, the last direct caller, because it was the one call with no idle
 * bound, no retry ladder and no classification — and this route would have
 * been the next. So a test message gets exactly what a turn's call gets:
 * `providerTimeoutMs` as its idle bound (for a call that does not stream, the
 * whole call; `0` is none), the retry ladder for a busy or unreachable
 * endpoint, the classes, and a stall told apart from a refusal.
 *
 * *That costs the branch's "one attempt", and the trade is the right way
 * round.* Its argument was that a test which retried a 429 would hide the thing
 * it exists to report. But a 429 that clears on the second ask clears for a
 * turn too, so answering `busy` to it reported a fault no turn would meet: the
 * test said a less true thing about turns, not a more candid one. A 429 that
 * persists through the ladder is still `busy`, and the whole ladder costs a
 * second and a quarter.
 *
 * ***A picture does not go through it, and cannot.*** `performCall` has no
 * picture arm — it renders messages and calls `generate` or `stream` — and
 * `renditions/worker.ts`, the other caller of `renderImage`, calls it directly
 * for the same reason. Nor would its ladder be right if it had one: a picture
 * is asked once, by the owner's decision of 2026-10-03 at
 * [25 E7](../../../../docs/design/25-open-questions.md), and the adapter sends
 * it with `maxRetries: 0` so that a 429 arrives as itself — `busy` here, rather
 * than a status-less `RetryError` read as `refused`. So the picture keeps the
 * branch's shape: one attempt, bounded by `providerTimeoutMs` as a wall clock
 * (`0` is none, as everywhere), and classed by the same function as a message.
 * The bound is the one difference from a rendition, which no clock stops: a
 * rendition is a job nobody waits on, and this is a button somebody is
 * watching.
 *
 * **Pictures only where the connection says so**, checked before anything is
 * sent: `renderImage` is *"present only when `capabilities.rendersImages`. The
 * caller checks"*, and `renditions/worker.ts` is the other caller that does.
 *
 * ***It stops when the person leaves*** (2026-10-03, the recommended answer;
 * the branch had argued for running on). `disconnectSignal`, taken off the
 * reply as Illustrate and the field assist take it, ends both arms. A picture
 * a hosted endpoint has already accepted may be billed whether or not the
 * request is aborted, and aborting does not un-spend it — but nobody is left
 * to see the answer, the server stops holding a socket open for it, and an
 * endpoint that notices a closed request stops working on it. A request ended
 * this way answers nothing and logs nothing at error level, because nobody is
 * reading and the person leaving is not a fault.
 *
 * **Refusals are classes and fixed sentences, never the endpoint's words** —
 * those can echo the key they refuse, which on this route is the likeliest
 * failure there is. The words go to the log, redacted.
 *
 * ***A test that returns is recorded*** (2026-10-03, the recommended answer,
 * owner deferred) — one line in the presser's `usage.jsonl`, under the role
 * {@link CONNECTION_TEST_ROLE} and the purpose `connection-test:text` or
 * `connection-test:image`. [10 §11.4](../../../../docs/design/10-ui-surfaces.md)
 * says a model call that is not a turn still costs money and *must be
 * recorded*, and since c814f3ed (2026-09-27) there is somewhere to record it:
 * the branch's *it records nothing* was written the day before that log
 * existed, and was true of the build it was written against. **The presser's
 * own log, admin or not**: what a call outside a turn costs stays with whoever
 * made it, and an admin trying the install's connection is the one who spent
 * it. A test that failed or was cancelled records nothing, as the field assist,
 * impersonation and Illustrate's moment call do. That is not every call a
 * person presses, and not `main`'s one rule, because there is none yet: the
 * on-demand step behind *Update trackers* (`turns/on-demand.ts`, `failed`)
 * writes a line for a failed or cancelled call that reached the provider, and
 * so do background summaries (`turns/warm-summaries.ts`), both since P14 and
 * with null figures — a summary the person never sees has no other trace. This
 * route takes the rule of the three calls it most resembles, each a single
 * call whose answer goes straight back to the person who asked. A test's
 * failure is on the screen of the person who caused it, and its likeliest
 * causes — a refused key, an address that does not answer — are calls no
 * endpoint billed. A picture's line is the
 * one image call the log carries: a rendition's cost has no field to go in
 * ([25 E16](../../../../docs/design/25-open-questions.md)), and a test picture
 * leaves no record of its own for one to be added to.
 */
async function testConnection(
  services: AppServices,
  request: FastifyRequest,
  reply: FastifyReply,
  entries: readonly ConnectionEntry[],
  handle: string | undefined,
): Promise<FastifyReply | undefined> {
  const { id } = request.params as { id: string };
  const body = request.body as Static<typeof TestBody>;

  const connection = entries.find((entry) => entry.connection.id === id)?.connection;
  if (connection === undefined) {
    return reply
      .code(404)
      .send({ error: 'not-found', message: `No connection with the id ${id}.` });
  }

  let provider: Provider;
  try {
    provider = services.providers(connection);
  } catch {
    // A hand-written file naming a provider this build has no adapter for — the
    // save refuses it, a text editor does not. `respond()`'s class for it, and
    // the name from the file rather than the thrown sentence.
    return reply.code(400).send({
      error: 'unbuildable',
      message: `This build has no adapter for ${JSON.stringify(connection.provider)}.`,
    });
  }

  const renderImage = provider.renderImage?.bind(provider);
  if (
    body.kind === 'image' &&
    (renderImage === undefined || !provider.capabilities.rendersImages)
  ) {
    return reply.code(422).send({
      error: 'not-an-image-endpoint',
      message: 'This connection does not say it makes pictures.',
    });
  }

  // After the `await`s the route made before calling this — reading the
  // directory, and on the personal route the capability check — which is safe:
  // `disconnectSignal` reads `destroyed` for a client that left during one.
  const left = disconnectSignal(reply);
  const started = Date.now();
  const logged = {
    event: 'connection.tested',
    account: request.account?.handle ?? null,
    connectionId: connection.id,
    scope: connection.scope,
    kind: body.kind,
    asked: body.modelId,
  };

  /** A refusal, logged with the endpoint's words redacted and answered as a class. */
  const refused = async (failure: TestFailure, detail: string | undefined) => {
    const answer = refusalFor(failure, services, connection.baseUrl);
    request.log.info(
      {
        ...logged,
        outcome: answer.body.error,
        class: failure.class,
        status: failure.status,
        elapsedMs: Date.now() - started,
        // The provider's own words, for whoever reads the log — and redacted,
        // because an endpoint refusing a key is the endpoint most likely to
        // quote it back.
        ...(detail === undefined
          ? {}
          : {
              detail: redactText(
                detail,
                connection.apiKey === undefined ? [] : [connection.apiKey],
              ),
            }),
      },
      'A connection was tried',
    );
    return await reply.code(answer.status).send(answer.body);
  };

  if (body.kind === 'image' && renderImage !== undefined) {
    const timeoutMs = services.config.limits.providerTimeoutMs;
    const clock = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    try {
      const picture = await renderImage({
        modelId: body.modelId,
        prompt: body.prompt,
        // `illustrate.ts`' seed, for its reason: any value will do, and a
        // clock is one nobody has to seed.
        seed: Date.now() % 2_147_483_647,
        // Empty for the reason a rendition's is: what an endpoint wants beyond
        // a prompt is per-connection configuration nothing supplies yet.
        workflow: {},
        signal: clock === undefined ? left : AbortSignal.any([left, clock]),
      });
      const elapsedMs = Date.now() - started;
      if (handle !== undefined) {
        await recordUsage(services.layout, handle, {
          schema: USAGE_SCHEMA,
          at: new Date().toISOString(),
          purpose: 'connection-test:image',
          role: CONNECTION_TEST_ROLE,
          resolved: { connectionId: connection.id, modelId: picture.modelId },
          // A picture reports no tokens; its cost is the adapter's, null on
          // every endpoint this build knows, as a turn's is.
          usage: null,
          cost: picture.cost,
          wallMs: elapsedMs,
        });
      }
      request.log.info(
        { ...logged, outcome: 'ok', answeredAs: picture.modelId, elapsedMs },
        'A connection was tried',
      );
      return await reply.send({
        kind: 'image',
        mime: picture.mime,
        base64: Buffer.from(picture.bytes).toString('base64'),
        modelId: picture.modelId,
        seed: picture.seed,
        cost: picture.cost,
        elapsedMs,
      });
    } catch (error) {
      // The person left: see the docstring. Checked before the class, because
      // an aborted request reads `transient` and would answer *unreachable* to
      // a socket nobody holds.
      if (left.aborted) return undefined;
      if (!(error instanceof ProviderError)) throw error;
      return await refused(
        {
          class: error.class,
          status: error.status,
          // Our wall clock, or the transport's own limit reported by the adapter.
          stalled: clock?.aborted === true || error.stalled,
        },
        error.detail,
      );
    }
  }

  /**
   * One candidate, required, and the only one — the assist's shape: the
   * message came from the person, not from a preset's blocks, and a budget
   * that dropped it would be asking the model nothing.
   */
  const ask: Candidate = {
    id: TEST_STEP.id,
    source: { kind: 'step', stepId: TEST_STEP.id },
    reason: 'a test message, typed or accepted by the person trying this connection',
    role: 'user',
    text: body.prompt,
    required: true,
  };

  try {
    const outcome = await performCall(
      {
        definition: TEST_STEP,
        bindings: { [TEST_ROLE_KEY]: { connectionId: connection.id, modelId: body.modelId } },
        usable: [connection],
        providers: services.providers,
        config: services.config,
        notFilled: [],
        signal: left,
        // Nothing is checkpointed: a test writes no turn and no job, so there is
        // no seam for either to be about. What it spent is recorded below.
        onCallAssembled: () => undefined,
        onProgress: () => undefined,
      },
      // The ceiling and nothing else — no sampler settings, because a preset's
      // are the preset's, and no `stream`, because this proves the key, the
      // address and the model rather than the streaming path.
      { params: { maxTokens: TEST_MAX_TOKENS } },
      [ask],
    );
    const elapsedMs = Date.now() - started;
    if (handle !== undefined) {
      await recordUsage(services.layout, handle, {
        ...fromModelCall(outcome.call, 'connection-test:text'),
        role: CONNECTION_TEST_ROLE,
      });
    }
    const finishReason = outcome.call.finishReason ?? 'unknown';
    request.log.info(
      {
        ...logged,
        outcome: 'ok',
        answeredAs: outcome.call.resolved.modelId,
        finishReason,
        promptTokens: outcome.usage?.promptTokens,
        completionTokens: outcome.usage?.completionTokens,
        retries: outcome.call.retries,
        elapsedMs,
      },
      'A connection was tried',
    );
    return await reply.send({
      kind: 'text',
      text: outcome.text,
      modelId: outcome.call.resolved.modelId,
      finishReason,
      usage: outcome.usage,
      cost: outcome.call.cost,
      elapsedMs,
    });
  } catch (error) {
    // The cancellation this route caused, ended silently — the illustrate
    // route's reasoning: an *Unhandled error* for every closed tab is a false
    // alarm in the log a person reads when something is really wrong.
    if (error instanceof Cancelled && left.aborted) return undefined;
    if (error instanceof WindowTooSmall) {
      /**
       * ***The connection's own context window, too small to hold a test
       * message beside its reply*** — a fixed sentence with the two numbers,
       * because the window is a field on this connection's form and the test
       * is the cheapest place to find it wrong: every turn would refuse the
       * same way.
       */
      return reply.code(422).send({
        error: 'window-too-small',
        message: `This connection's context window is ${String(error.window)} tokens and a test keeps ${String(error.reserved)} for the reply, so nothing would fit.`,
      });
    }
    if (!(error instanceof CallFailed)) throw error;
    return await refused(
      { class: error.class, status: error.status, stalled: error.stalled },
      error.detail,
    );
  }
}

/** What a failed test is decided from — the same three facts on either arm. */
interface TestFailure {
  class: ErrorClass;
  /** The endpoint's HTTP status, when it answered at all. */
  status: number | undefined;
  /** Gave up on silence: a clock ran out, ours or the transport's. */
  stalled: boolean;
}

/**
 * A failed test, as a class a person can act on — [polish §25].
 *
 * **The order is the argument.** A stall comes first because it is the
 * opposite remedy to everything after it: the endpoint accepted the request and
 * went quiet, and an aborted request is classed `transient` from its message
 * alone, which would otherwise read as *unreachable* about an endpoint that was
 * merely slow — the ordering lesson `turns/calls.ts` records for a stall. A
 * message's stall arrives already flagged by `performCall` (its own idle bound
 * or the transport's, `CallFailed.stalled`); a picture's by this route's clock
 * or the adapter (`ProviderError.stalled`). *The flag, not the clock*, since
 * the merge of 2026-10-03: the branch read only its own signal, so a transport
 * that gave up first fell through to `refused`. Then the status, because a
 * refused key and a refused request are both `terminal` and point at opposite
 * fields of the form (finding 5, [P2C log]). Then the class.
 */
function refusalFor(
  failure: TestFailure,
  services: AppServices,
  baseUrl: string | undefined,
): { status: number; body: { error: string; message: string } } {
  if (failure.stalled) {
    return {
      status: 504,
      body: { error: 'timeout', message: 'That endpoint did not answer in time.' },
    };
  }
  if (failure.status === 401 || failure.status === 403) {
    return {
      status: 401,
      body: { error: 'unauthorized', message: 'That endpoint refused the key.' },
    };
  }
  if (failure.class === 'retryable') {
    return {
      status: 502,
      body: { error: 'busy', message: 'That endpoint asked to be tried later.' },
    };
  }
  if (failure.class === 'transient') {
    return { status: 502, body: silence(services, baseUrl) };
  }
  return { status: 502, body: { error: 'refused', message: 'That endpoint refused the request.' } };
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

  /**
   * Tries one of *your* connections — the admin route's twin.
   *
   * ***Scoped to the caller's own directory***, which is the whole of what this
   * adds over the admin one: an id that exists only in the system scope, or in
   * somebody else's, is a 404 here rather than a way to spend another person's
   * key. And the models route's argument holds unchanged — this can only reach a
   * URL the caller already saved, and every turn of theirs would reach it too, so
   * what it adds is the *timing*, not the reach.
   */
  app.post(
    '/me/connections/:id/test',
    { schema: { params: IdParams, body: TestBody } },
    async (request, reply) => {
      const mine = await permitted(request, reply);
      if (!mine) return;
      return testConnection(
        services,
        request,
        reply,
        await readUserConnectionEntries(services.layout, mine.handle),
        mine.handle,
      );
    },
  );
}
