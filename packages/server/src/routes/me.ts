// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { requireAccount } from '../app.js';
import type { AppServices } from '../app.js';
import { PrefsError } from '../auth/prefs.js';

/**
 * What a signed-in person may change about themselves — [05 §15.1](../../../../docs/design/05-ui-surfaces.md).
 *
 * The user half of the settings surface, and the smaller half by design: a
 * display name, a locale, a password, and a bag of client preferences. Roles,
 * enabled flags and capabilities are somebody else's business and live under
 * `/api/admin` ([P2A §2.4](../../../../docs/design/workplan/13-p2a-configuration-surface.md)).
 *
 * **`requireAccount` per handler rather than a prefix hook**, which is the
 * opposite of what the admin half does and deliberately so. Here the account
 * object is the thing every handler *wants* — it is the subject of the request,
 * not a gate in front of it — so a hook that only proved one existed would leave
 * every handler fetching it again anyway.
 */

/**
 * **`additionalProperties: false` is the refusal**, and it is the whole reason
 * this schema is written out rather than derived from the store's patch type.
 *
 * A `role` in the body answers 400 naming the field. Ignoring it — stripping it
 * and carrying on with a 200 — would be worse than either accepting or
 * refusing, because it teaches a client that the request worked. The next
 * version of that client sends the field on purpose.
 *
 * `locale` is nullable: null is *no preference*, which is a different state from
 * a locale of `""` and the one a user picks when they want the browser's.
 */
const ProfilePatch = Type.Object(
  {
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    locale: Type.Optional(Type.Union([Type.String({ maxLength: 35 }), Type.Null()])),
  },
  { additionalProperties: false },
);

const PasswordChange = Type.Object(
  {
    currentPassword: Type.String({ minLength: 1, maxLength: 512 }),
    newPassword: Type.String({ minLength: 8, maxLength: 512 }),
  },
  { additionalProperties: false },
);

/**
 * Preferences are **not** validated beyond their shape — [06 B13](../../../../docs/design/06-open-questions.md).
 *
 * `additionalProperties: true` here is the point rather than a shortcut: the
 * server does not know what a preference means, and a newer client must be able
 * to store one an older server has never heard of. The bounds that do exist —
 * a key pattern and a document size cap — live in the store, which is where the
 * comment explaining that they are bounds and not validation lives too.
 */
const PrefsPatch = Type.Object({}, { additionalProperties: true });

export function registerMeRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/me', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    return reply.send({ account });
  });

  app.patch('/me', { schema: { body: ProfilePatch } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as { displayName?: string; locale?: string | null };
    const updated = await services.accounts.updateSelf(account.handle, body);
    return reply.send({ account: updated });
  });

  /**
   * Changing your own password, which requires knowing it.
   *
   * **The current password is verified through `authenticate`**, not through a
   * check written here. That is *the* password check in this codebase, and a
   * second one beside it is how two drift into disagreeing about disabled
   * accounts or about timing. It also makes the admin reset — no current
   * password to know — the same store method with one fewer step rather than a
   * separate code path.
   *
   * 401 rather than 403: the fact being reported is that a credential did not
   * check out, which is what 401 means. And `invalid-credentials` is the same
   * class login sends, because it is the same event.
   *
   * **Sessions elsewhere survive this**, and [the API doc](../../../../docs/api.md) says
   * so. Sessions are signed stateless cookies with no denylist, so nothing here
   * can revoke one; pretending otherwise would be the lie. The honest upgrade
   * is the one `auth/session.ts` already names, and it is not this phase's.
   */
  app.post('/me/password', { schema: { body: PasswordChange } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as { currentPassword: string; newPassword: string };
    const verified = await services.accounts.authenticate(account.handle, body.currentPassword);
    if (!verified) {
      return reply.code(401).send({
        error: 'invalid-credentials',
        message: 'That is not your current password.',
      });
    }

    /**
     * `changePassword` rather than `resetPassword`, and the reason is
     * defensive rather than currently load-bearing — which is worth saying
     * plainly, because a comment claiming a live consequence that cannot happen
     * is how the next reader decides the choice was arbitrary.
     *
     * `resetPassword` re-enables, which is right for break-glass and wrong for
     * a self-service form. **Today that difference is unobservable here**: the
     * identity hook refuses a disabled account, so nobody who could be
     * re-enabled can reach this handler. The claim is proved where it is
     * reachable, in `auth/accounts.test.ts`, and named here so that relaxing
     * the hook — or reusing this handler for an admin-initiated change — does
     * not quietly turn a password form into a way to undo a disablement.
     */
    await services.accounts.changePassword(account.handle, body.newPassword);
    return reply.code(204).send();
  });

  app.get('/me/prefs', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const prefs = await services.prefs.read(account.handle);
    return reply.send({ prefs });
  });

  /**
   * A shallow merge, answering with the whole document.
   *
   * The response is the map afterwards rather than an acknowledgement, so a
   * client lands on the truth rather than on its own guess about what its patch
   * did — which is what makes the client's one optimistic mutation safe to be
   * optimistic about.
   */
  app.patch('/me/prefs', { schema: { body: PrefsPatch } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    try {
      const prefs = await services.prefs.patch(
        account.handle,
        request.body as Record<string, unknown>,
      );
      return await reply.send({ prefs });
    } catch (error) {
      if (error instanceof PrefsError) {
        // The store's bounds, reported in the vocabulary the rest of the API
        // uses. `too-large` is 413 because that is the fact; `invalid` is 400.
        return await reply
          .code(error.code === 'too-large' ? 413 : 400)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });
}
