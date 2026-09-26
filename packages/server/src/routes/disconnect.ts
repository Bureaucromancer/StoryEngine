// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { FastifyReply } from 'fastify';

/**
 * ***A signal that aborts when the person who asked has gone away*** — found at
 * [P13](../../../../docs/design/workplan/30-p13-implementation.md) §0.5, and
 * the repair of [P9.4](../../../../docs/design/workplan/26-p9-implementation.md)'s
 * Illustrate route.
 *
 * **For a route that makes a model call on a request somebody is waiting on**,
 * so the call is cancelled when nobody is waiting any more — the judgement
 * `performCall`'s idle timeout already makes about an endpoint that has stopped
 * talking, made about a person who has.
 *
 * ---
 *
 * ***The response closing unfinished is the disconnect; the request closing is
 * not.*** Since Node 16 a request's `close` is emitted once its body has been
 * read, and Fastify reads the body before the handler runs. Probed on this
 * build: for a `POST` with a body it fires **at the moment the handler starts**,
 * whether or not the client is still there, and it fires **once**. That makes
 * listening to it wrong both ways round, depending only on when the listener
 * goes on:
 *
 * - attached before anything is awaited, it aborts every call it guards at
 *   once — a button that fails every time it is pressed;
 * - attached after an awaited read, as Illustrate's was, the event has already
 *   gone by and it **never** fires — so a person who leaves is not noticed, and
 *   the call they abandoned runs to the end and is paid for.
 *
 * Illustrate shipped the second, which is why its button worked and its
 * cancellation did not. The response's `close`, by contrast, is emitted when
 * the connection finishes with it — after a reply that was sent, or when the
 * socket goes away first — so `writableFinished` says which. It can be attached
 * at any point in a handler.
 *
 * *The two SSE streams that release on the request's `close` are right to*, and
 * should not be "fixed" by analogy: they are `GET`s, and for a request with no
 * body the event is emitted when the connection ends, which is exactly when a
 * stream should let go.
 *
 * ***`inject` cannot show any of this***, because it has no socket — which is
 * how the fault survived a suite that exercised the route many times.
 * `disconnect.test.ts` and Illustrate's own tests use a listening app.
 */
export function abortOnDisconnect(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}
