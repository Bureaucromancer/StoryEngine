// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { requireAccount, type AppServices } from '../app.js';
import { listNotifications, markRead, unreadCount } from '../state/notifications.js';
import { SseWriter } from '../stream/sse.js';

/**
 * What a person has been told — [09 §3.1](../../../../docs/design/09-server-multiuser-deployment.md),
 * [09 §3.6](../../../../docs/design/09-server-multiuser-deployment.md), [P10.1].
 *
 * ***Under `/me` and beside `me.ts` rather than inside it.*** That module's
 * subject is *what a signed-in person may change about themselves* — a name, a
 * locale, a password, a bag of preferences — and a notification is none of
 * those: nobody authors one, and the only thing a person does to one is read it.
 * Sharing the address space is right (it is per-account, and the prefix says so)
 * and sharing the file would make that module's opening sentence false.
 *
 * ***Three routes, and the split is [09 §3.1]'s two channels.*** The list and
 * the mark-read are the **durable** half: rows that survive a restart, which is
 * what a badge is read from and what a person comes back to. The stream is the
 * **ephemeral** half: the same records, arriving live, so a toast can be shown
 * the moment something happens rather than on the next poll.
 *
 * **Every one of them is scoped by `account.handle` and never by a parameter.**
 * [09 §4.3]'s per-user scoping is the whole safety property of a household
 * server — *user A's turn never produces an event addressed to user B* is this
 * phase's named CI claim — so the account comes from the session cookie at every
 * door. There is deliberately no route that names a person.
 */

/**
 * **Every value here is a `String`, and that is not a shortcut** — `search.ts`'s
 * finding, which this schema was written without and was corrected by its own
 * test on the first run.
 *
 * Everything in a query string arrives as text, and this app deliberately
 * replaced Fastify's coercing validator with the storage layer's Ajv
 * (`coerceTypes: false`, F2) so that a `POST` body cannot be rewritten on its
 * way to disk. One Ajv, one setting, and the cost lands here: `Type.Boolean()`
 * on a querystring answers 400 to `?unread=true` with *must be boolean*, which
 * is what it did. So the schema states what is on the wire and the handler
 * converts — which is also the only place that can answer usefully when the
 * text is neither.
 */
const ListQuery = Type.Object(
  {
    unread: Type.Optional(Type.String({ pattern: '^(true|false)$' })),
    limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,3}$' })),
  },
  { additionalProperties: false },
);

/** Clamped rather than trusted, which is `search.ts`'s rule for the same field. */
const MAX_LISTED = 200;

function listLimit(raw: string | undefined): number {
  if (raw === undefined) return 50;
  return Math.min(Math.max(Number(raw), 1), MAX_LISTED);
}

/**
 * **An empty `ids` means *all of them*** — the **Mark all read** affordance,
 * which is one request rather than a client sending fifty ids back. `ids`
 * absent means the same thing, so a bare `POST` is the gesture.
 */
const ReadBody = Type.Object(
  { ids: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 500 })) },
  { additionalProperties: false },
);

export function registerNotificationRoutes(app: FastifyInstance, services: AppServices): void {
  /**
   * The list, with the unread count beside it.
   *
   * **One request for both**, for the reason `/me/roles` gives: a badge and a
   * list rendered from two round trips are a badge and a list assembled from two
   * different moments, and the failure shows as a count that disagrees with what
   * is on screen.
   */
  app.get('/me/notifications', { schema: { querystring: ListQuery } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const query = request.query as { unread?: string; limit?: string };
    const notifications = listNotifications(services.state.db, account.handle, {
      limit: listLimit(query.limit),
      ...(query.unread === 'true' ? { unreadOnly: true } : {}),
    });

    return reply.send({ notifications, unread: unreadCount(services.state.db, account.handle) });
  });

  /**
   * Marks some, or all, read.
   *
   * ***Answers with the count afterwards rather than with an acknowledgement***
   * — `/me/prefs`' rule: a client lands on the truth rather than on its own
   * guess about what its request did, which is what makes the optimistic badge
   * decrement safe to be optimistic about.
   *
   * *An id belonging to somebody else changes nothing and is not an error.* The
   * account is in the `where` clause, so a wrong handle is a no-op rather than a
   * write to the wrong row — the same posture every per-account write in the
   * store takes, and the one that does not leak whether an id exists.
   */
  app.post('/me/notifications/read', { schema: { body: ReadBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as { ids?: string[] };
    const read = markRead(services.state.db, account.handle, body.ids ?? []);

    return reply.send({ read, unread: unreadCount(services.state.db, account.handle) });
  });

  /**
   * The notification stream — [09 §3.1]'s second channel, per **account**.
   *
   * **Everything that can produce a JSON reply happens before `writeHead`**,
   * which is the session stream's rule and was measured there: with `hijack()` a
   * throw after the head is silently swallowed, and without it the error handler
   * writes the head a second time and `ERR_HTTP_HEADERS_SENT` kills the process.
   *
   * ***The first frame is the whole list, and that is what makes a reconnect
   * whole.*** There is no cursor here and nothing to replay from: a notification
   * is a record rather than a sequenced event, so a client that missed three
   * while its socket was down gets them by reading the list on attach. It is the
   * rendition frame's bargain ([P9.2]) on a second subject — *exactness comes
   * from the snapshot* — and it is why nothing on this route emits an `id:`.
   *
   * *A `GET` carries no CSRF requirement and authenticates by cookie*, which is
   * what `EventSource` needs: it can send cookies and cannot set headers.
   * **Nothing may later add a header requirement to this route.**
   */
  app.get('/me/notifications/stream', async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const handle = account.handle;
    const snapshot = {
      notifications: listNotifications(services.state.db, handle),
      unread: unreadCount(services.state.db, handle),
    };

    reply.hijack();

    let detach: (() => void) | null = null;
    const writer = new SseWriter(reply.raw, {
      keepaliveMs: services.config.sessions.streamKeepaliveMs,
      onClose: () => {
        detach?.();
        services.streams.delete(release);
      },
    });

    const release = (): void => {
      writer.close();
    };
    // Registered so `app.close()` can end it: closing resolves in zero
    // milliseconds with a hijacked stream open, so a surviving keepalive is a
    // hung process rather than a failed test.
    services.streams.add(release);

    request.raw.on('close', release);
    reply.raw.on('error', release);

    /**
     * **Subscribed in the same synchronous tick the snapshot was read in**, so
     * nothing can arrive in between. An `await` here would open a window in
     * which a notification is written after the list was read and before the
     * listener exists — one that no reconnect would close, because the client
     * would never know it had missed anything.
     */
    detach = services.notifications.subscribe(handle, (notification) => {
      writer.emit('notification', notification);
    });

    writer.emit('snapshot', snapshot);
  });
}
