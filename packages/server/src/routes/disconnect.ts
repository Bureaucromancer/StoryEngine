// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { FastifyReply } from 'fastify';

/**
 * ***A signal that aborts when the client stops waiting for this reply.***
 *
 * For a route that dispatches a model call from inside a request: the call
 * costs money and time, and when the person has gone there is nobody left to
 * read the answer. `performCall`'s idle timeout is the same judgement made
 * about an endpoint that has stopped talking, and this one is about the client
 * on the other end.
 *
 * ***Read off the response, not the request, and that choice is the whole of
 * this function.*** Each of the obvious alternatives was measured over a real
 * loopback socket (Fastify 5.12, Node 26) and does nothing:
 *
 * - **`request.raw.on('close')`** is the `IncomingMessage`, and in current Node
 *   it closes when its *body* has been read, not when the client leaves. On a
 *   POST with a body, Fastify has read it before the handler runs, so by the
 *   time a handler has awaited anything the request is already destroyed and a
 *   listener attached then never runs, whether the client stays or goes. The
 *   illustrate route used this and never cancelled anything.
 * - **Fastify's own `request.signal`** is that same listener, created lazily on
 *   first read, and read after an `await` it did not abort when the client
 *   left either.
 *
 * The response is different: it lives until it has been written, and it closes
 * early only if the socket goes first. So *closed without having finished* is
 * the client leaving, and *closed having finished* is the ordinary end of every
 * request, which must not count.
 *
 * ***The `destroyed` check is for a client that left before this was called.***
 * A route calls this after authentication and ownership checks, each an
 * `await`, and a `close` that fired during one of those has already been
 * emitted. Without the check that case looks exactly like a client still
 * waiting.
 *
 * *The two SSE streams keep `request.raw.on('close')`, correctly.* They are
 * bodiless GETs, where the request stays open until the client goes, and that
 * was measured too.
 *
 * `inject` cannot show any of this: light-my-request's request ignores a
 * destroy once its body has been read. So the tests for this file go over a
 * real socket.
 */
export function disconnectSignal(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  const raw = reply.raw;
  const left = (): void => {
    if (!raw.writableFinished) controller.abort();
  };
  if (raw.destroyed) left();
  else raw.once('close', left);
  return controller.signal;
}
