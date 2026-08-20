// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AppServices } from '../app.js';
import { AccountError, type PublicAccount } from '../auth/accounts.js';
import { listEntryNames } from '../storage/files.js';
import { registerConfigRoutes } from './config.js';
import { registerConnectionRoutes } from './connections.js';

/**
 * Administration — [05 §15.2](../../../../docs/design/05-ui-surfaces.md),
 * [P2A §2.4](../../../../docs/design/workplan/13-p2a-configuration-surface.md).
 *
 * **The guard is a prefix, not a habit.** `adminOnly` is an `onRequest` hook on
 * an encapsulated `/api/admin` plugin, and this file commits to never adding a
 * per-handler admin check. Two spellings of one guard is how the second one gets
 * missed — the same argument the library already makes about there being no
 * `:handle` parameter to forget.
 *
 * That is also why the route-table test in `admin.test.ts` enumerates Fastify's
 * own routing table rather than a list somebody maintains: a list of admin
 * routes written by hand is wrong the first time a route is added in a hurry,
 * and it is wrong silently.
 *
 * `requireAccount` is unchanged and stays per-handler in the user half, where
 * the account object is the thing the handler *wants* rather than a gate in
 * front of it.
 */

/**
 * **403 for a signed-in non-admin, 401 for nobody.**
 *
 * Two different facts, so two different codes. And deliberately *not* the
 * library's 404-for-another-user's-object: that hides whether an id exists,
 * which is worth hiding. `/api/admin` is a fixed path whose existence is not a
 * secret, and answering 404 would leave a client unable to tell *this build has
 * no admin API* from *you are not an admin* — a distinction its error message
 * depends on.
 */
async function adminOnly(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.account) {
    await reply.code(401).send({ error: 'unauthenticated', message: 'Sign in first.' });
    return;
  }
  if (request.account.role !== 'admin') {
    await reply
      .code(403)
      .send({ error: 'forbidden', message: 'This needs an administrator account.' });
  }
}

const HandleParams = Type.Object({ handle: Type.String({ minLength: 1, maxLength: 63 }) });

const CreateAccount = Type.Object(
  {
    handle: Type.String({ minLength: 1, maxLength: 63 }),
    password: Type.String({ minLength: 8, maxLength: 512 }),
    role: Type.Union([Type.Literal('admin'), Type.Literal('user')]),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    locale: Type.Optional(Type.Union([Type.String({ maxLength: 35 }), Type.Null()])),
    capabilities: Type.Optional(
      Type.Object(
        {
          privateConnections: Type.Optional(Type.Boolean()),
          fileAccess: Type.Optional(
            Type.Union([Type.Literal('none'), Type.Literal('read'), Type.Literal('write')]),
          ),
          enableExtensions: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/**
 * Everything an admin may change about anyone.
 *
 * A superset of `/api/me`'s body rather than a different shape, and closed the
 * same way — a key this build does not know is refused rather than ignored, so
 * a client learns it was wrong instead of learning that it worked.
 */
const PatchAccount = Type.Object(
  {
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    locale: Type.Optional(Type.Union([Type.String({ maxLength: 35 }), Type.Null()])),
    role: Type.Optional(Type.Union([Type.Literal('admin'), Type.Literal('user')])),
    enabled: Type.Optional(Type.Boolean()),
    capabilities: Type.Optional(
      Type.Object(
        {
          privateConnections: Type.Optional(Type.Boolean()),
          fileAccess: Type.Optional(
            Type.Union([Type.Literal('none'), Type.Literal('read'), Type.Literal('write')]),
          ),
          enableExtensions: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const AdminPassword = Type.Object(
  { newPassword: Type.String({ minLength: 8, maxLength: 512 }) },
  { additionalProperties: false },
);

/**
 * Who cannot send a message, and how many of them there are — [04 §4.5](../../../../docs/design/04-server-multiuser-deployment.md).
 *
 * The sentence that document commissioned is *"2 users have no usable
 * connection"*, and it named the admin screen as where it appears. This is the
 * data behind it, and the phase exists partly to make it appear at all: without
 * it the state arrives as a bug report from somebody who cannot play.
 *
 * **Counts, never contents.** A connection stays opaque ([04 §4.5]) — the
 * warning needs a number, not a list of what somebody has configured, and an
 * admin who can enumerate another account's connections is one step from the
 * disclosure that document declines.
 *
 * **The system directory is read once**, not once per account: it is the same
 * answer every time, and a listing per account turns a page render into O(n)
 * directory reads for a fact that does not vary.
 */
async function deadEnds(
  services: AppServices,
  accounts: PublicAccount[],
): Promise<{ handles: Set<string>; systemCount: number }> {
  const systemCount = (await listEntryNames(services.layout.systemConnectionsRoot)).filter((name) =>
    name.endsWith('.json'),
  ).length;

  const handles = new Set<string>();
  for (const account of accounts) {
    // A system connection is usable by everyone, so one is enough for nobody to
    // be stuck — and checking it first means no personal listing at all in the
    // ordinary install.
    if (systemCount > 0) continue;
    // Without `privateConnections` a personal connection is not usable, so it
    // does not rescue the account and the directory need not be read.
    const personal = account.capabilities.privateConnections
      ? (await listEntryNames(services.layout.userConnectionsRoot(account.handle))).filter((name) =>
          name.endsWith('.json'),
        ).length
      : 0;
    if (personal === 0) handles.add(account.handle);
  }

  return { handles, systemCount };
}

export function registerAdminRoutes(app: FastifyInstance, services: AppServices): void {
  app.addHook('onRequest', adminOnly);

  // The install's settings, inside the same prefix and therefore behind the same
  // hook — which is the whole of [P2A §2.4]'s argument for the guard being a
  // property of the prefix rather than something each file remembers.
  registerConfigRoutes(app, services);
  registerConnectionRoutes(app, services);

  app.get('/accounts', async (_request, reply) => {
    const accounts = await services.accounts.list();
    const { handles, systemCount } = await deadEnds(services, accounts);

    return reply.send({
      accounts: accounts.map((account) => ({
        ...account,
        // Inline on the row, because a count in a heading with nothing to point
        // at leaves an admin counting rows themselves ([05 §15.4]).
        hasUsableConnection: !handles.has(account.handle),
      })),
      // The heading's number, and the fact that explains it: with no system
      // connection configured, "nobody can play" has one fix rather than n.
      withoutUsableConnection: handles.size,
      systemConnectionCount: systemCount,
    });
  });

  app.post('/accounts', { schema: { body: CreateAccount } }, async (request, reply) => {
    const body = request.body as {
      handle: string;
      password: string;
      role: 'admin' | 'user';
      displayName?: string;
      locale?: string | null;
      capabilities?: Record<string, unknown>;
    };

    try {
      const account = await services.accounts.create({
        handle: body.handle,
        password: body.password,
        role: body.role,
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
        ...(body.locale === undefined ? {} : { locale: body.locale }),
        ...(body.capabilities === undefined ? {} : { capabilities: body.capabilities }),
      });
      return await reply.code(201).send({ account });
    } catch (error) {
      return await respond(error, reply);
    }
  });

  app.patch(
    '/accounts/:handle',
    { schema: { params: HandleParams, body: PatchAccount } },
    async (request, reply) => {
      const { handle } = request.params as { handle: string };
      try {
        const account = await services.accounts.update(handle, request.body as object);
        return await reply.send({ account });
      } catch (error) {
        return await respond(error, reply);
      }
    },
  );

  /**
   * An admin resetting somebody's password.
   *
   * `changePassword` rather than `resetPassword`, so this does **not** re-enable
   * a disabled account: an admin who disabled somebody and then reset their
   * password should not have undone the disablement by accident. Re-enabling is
   * `PATCH … { enabled: true }`, which is a separate thing to decide and
   * therefore a separate thing to do.
   */
  app.post(
    '/accounts/:handle/password',
    { schema: { params: HandleParams, body: AdminPassword } },
    async (request, reply) => {
      const { handle } = request.params as { handle: string };
      const body = request.body as { newPassword: string };
      try {
        await services.accounts.changePassword(handle, body.newPassword);
        return await reply.code(204).send();
      } catch (error) {
        return await respond(error, reply);
      }
    },
  );

  app.delete('/accounts/:handle', { schema: { params: HandleParams } }, async (request, reply) => {
    const { handle } = request.params as { handle: string };
    try {
      await services.accounts.remove(handle);
      return await reply.code(204).send();
    } catch (error) {
      return await respond(error, reply);
    }
  });
}

/**
 * The store's refusals, in the API's vocabulary.
 *
 * `last-admin` is **409**: the request is well formed and the caller is
 * permitted; what refuses it is the state of the install. 403 would say *you
 * may not*, which is wrong — an admin may demote an admin, just not the last
 * one — and 400 would say the body was malformed, which it was not.
 */
async function respond(error: unknown, reply: FastifyReply): Promise<FastifyReply> {
  if (!(error instanceof AccountError)) throw error;
  const status = { exists: 409, 'not-found': 404, invalid: 400, 'last-admin': 409 }[error.code];
  return reply.code(status).send({ error: error.code, message: error.message });
}
