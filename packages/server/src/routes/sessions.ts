// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { type AppServices, requireAccount } from '../app.js';
import { walkPath } from '../sessions/segments.js';
import {
  createSession,
  deleteSession,
  listSessionFiles,
  readSession,
  reconcileHandEdits,
  setCast,
  readTurns,
  setArchived,
} from '../sessions/store.js';
import { DEFAULT_MODE_ID, modeById } from '../modes/registry.js';
import { attachToSession, formatCursor, parseCursor } from '../stream/attach.js';
import { SseWriter } from '../stream/sse.js';
import { activeJob, readJob, submitTurn } from '../state/jobs.js';
import { PathEscapeError } from '../storage/paths.js';

/**
 * Sessions, turns, and the stream — [P2 §2.10], [04 §3.1], [07 §8].
 *
 * **Every route resolves its session from the account, never from a parameter.**
 * There is no `:handle` here any more than there is in the library routes: the
 * path is the owner ([04 §4.3]), so a missing session and somebody else's are
 * the same 404. Confirming that a session id exists elsewhere would leak the one
 * fact the separation exists to keep.
 *
 * **Querystring numbers and booleans are strings.** This app replaced Fastify's
 * validator with the storage layer's Ajv, which has `coerceTypes: false` (F2) —
 * so `Type.Integer()` on a query parameter rejects `?limit=10` with *must be
 * integer*. Measured, on a route that shipped that way. The schemas below say
 * what is on the wire and the handlers convert.
 */

const SessionParams = Type.Object({ sessionId: Type.String() });
const JobParams = Type.Object({ sessionId: Type.String(), jobId: Type.String() });

/**
 * What a session is created as.
 *
 * `mode` and `cast` are here because without them half the shipped preset is
 * unreachable: the persona and actor slots resolve empty, so every prompt built
 * by this server used 4 of its 12 blocks and every test over assembly asserted
 * on absent input. The preset is **not** a parameter — a session copies its
 * mode's default, and choosing a different pack is P7's surface.
 */
const CastBody = Type.Object(
  {
    persona: Type.Union([Type.String(), Type.Null()]),
    actors: Type.Array(Type.String(), { maxItems: 32 }),
  },
  { additionalProperties: false },
);

const CreateBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    mode: Type.Optional(Type.String({ maxLength: 100 })),
    cast: Type.Optional(CastBody),
  },
  { additionalProperties: false },
);

const ListQuery = Type.Object({ archived: Type.Optional(Type.String()) });
const TurnsQuery = Type.Object({ limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,4}$' })) });
const StreamQuery = Type.Object({ after: Type.Optional(Type.String({ maxLength: 200 })) });

const ArchiveBody = Type.Object({ archived: Type.Boolean() }, { additionalProperties: false });

/**
 * A turn submission — [P2 §2.10].
 *
 * `guidance` is **its own field** and is never concatenated into `input.text`.
 * That is the whole point of the guidance slot ([03 §5.1]): typed into the
 * action it would land in history permanently, be summarised as narrative,
 * be scanned by keyword matching, be read back as dialogue, and appear in
 * exports — none of which the person typing it intended.
 */
const SubmitBody = Type.Object(
  {
    idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
    headTurnId: Type.Union([Type.String(), Type.Null()]),
    input: Type.Object({
      text: Type.String({ maxLength: 100_000 }),
      actorId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      kind: Type.Optional(Type.String({ maxLength: 40 })),
    }),
    guidance: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);

export function registerSessionRoutes(app: FastifyInstance, services: AppServices): void {
  app.post('/sessions', { schema: { body: CreateBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as {
      name: string;
      mode?: string;
      cast?: { persona: string | null; actors: string[] };
    };

    /**
     * An unknown mode is refused **here** rather than resolved to the default.
     *
     * The runner falls back for a session that is *already* playing one this
     * build does not know — somebody else's story, which should still open
     * ([00 §3.3]). Creating a new session naming a mode that does not exist is a
     * different thing: nobody's story depends on it yet, and silently giving
     * them a different mode than they asked for is the surprise.
     */
    const mode = modeById(body.mode ?? DEFAULT_MODE_ID);
    if (mode === null) {
      return reply.code(422).send({ error: 'unknown-mode', message: 'No such mode.' });
    }

    // What the mode says it can seat ([03 §7.2]) — the first real consumer of
    // `ParticipantPolicy`, which was a declaration nothing read.
    const actors = body.cast?.actors ?? [];
    if (actors.length > mode.definition.participants.maxActors) {
      return reply.code(422).send({
        error: 'too-many-actors',
        message: 'That mode seats fewer actors than this session names.',
      });
    }

    try {
      const session = await createSession(services.sessions, account.handle, {
        name: body.name,
        mode: { id: mode.definition.id, config: null },
        // **Copied, not referenced** ([02 §8]): the session owns its prompt pack
        // from here, so editing the mode's default never rewrites a game in
        // progress.
        preset: structuredClone(mode.definition.assembly.defaultPreset),
        ...(body.cast === undefined ? {} : { cast: body.cast }),
      });
      return await reply.code(201).send({ session });
    } catch (error) {
      if (error instanceof PathEscapeError) {
        return reply.code(422).send({ error: 'refused-path', message: error.message });
      }
      throw error;
    }
  });

  app.get('/sessions', { schema: { querystring: ListQuery } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const { archived } = request.query as { archived?: string };
    const sessions = await listSessionFiles(services.sessions, account.handle, {
      includeArchived: archived === 'true',
    });
    return reply.send({ sessions });
  });

  app.get('/sessions/:sessionId', { schema: { params: SessionParams } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const session = await mine(services, request, reply);
    if (!session) return;

    // The active job travels with the session, because a client reloading
    // mid-turn needs to know there *is* one before it decides whether to open a
    // stream or offer a submit box.
    const job = activeJob(services.state.db, session.id);
    return reply.send({ session, activeJob: job });
  });

  app.put(
    '/sessions/:sessionId/cast',
    { schema: { params: SessionParams, body: CastBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await mine(services, request, reply);
      if (!session) return;

      const body = request.body as { persona: string | null; actors: string[] };
      const mode = modeById(session.mode?.id ?? DEFAULT_MODE_ID);
      if (mode !== null && body.actors.length > mode.definition.participants.maxActors) {
        return reply.code(422).send({
          error: 'too-many-actors',
          message: 'That mode seats fewer actors than this session names.',
        });
      }

      const { sessionId } = request.params as { sessionId: string };
      // **Ids, not objects.** A cast entry is a link resolved fresh every turn,
      // so improving a character card reaches an ongoing game — the asymmetry
      // with the copied preset is the design ([02 §8]).
      const updated = await setCast(services.sessions, account.handle, sessionId, body);
      return reply.send({ session: updated });
    },
  );

  app.patch(
    '/sessions/:sessionId',
    { schema: { params: SessionParams, body: ArchiveBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { archived } = request.body as { archived: boolean };
      const { sessionId } = request.params as { sessionId: string };
      const session = await setArchived(services.sessions, account.handle, sessionId, archived);
      return reply.send({ session });
    },
  );

  app.delete(
    '/sessions/:sessionId',
    { schema: { params: SessionParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const { sessionId } = request.params as { sessionId: string };
      await deleteSession(services.sessions, account.handle, sessionId);
      // Moved to the trash rather than erased ([02 §10.3]) — 204 says the session
      // is gone from here, which is what the caller asked about.
      return reply.code(204).send();
    },
  );

  app.get(
    '/sessions/:sessionId/turns',
    { schema: { params: SessionParams, querystring: TurnsQuery } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await mine(services, request, reply);
      if (!session) return;

      const byId = await readTurns(services.sessions, account.handle, session.id);
      // The path from the head, oldest first — not every turn in the file. A
      // session is a tree that P2 happens to use linearly, and a transcript is
      // one walk of it ([02 §5.5]).
      const path = walkPath(byId, session.headTurnId);
      const query = request.query as { limit?: string };
      const limit = query.limit === undefined ? 100 : Math.min(Number(query.limit), 1000);

      return reply.send({ turns: path.slice(-limit) });
    },
  );

  app.post(
    '/sessions/:sessionId/turns',
    { schema: { params: SessionParams, body: SubmitBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as {
        idempotencyKey: string;
        headTurnId: string | null;
        input: { text: string; actorId?: string | null; kind?: string };
        guidance?: string;
      };

      const outcome = await submitTurn(services.jobs, {
        account: account.handle,
        sessionId,
        idempotencyKey: body.idempotencyKey,
        headTurnId: body.headTurnId,
      });

      switch (outcome.kind) {
        case 'no-session':
          return reply.code(404).send({ error: 'not-found', message: 'No such session.' });

        case 'busy':
          // The job travels with the refusal: a UI handed a bare "no" can only
          // offer "try again", which produces the same "no".
          return reply.code(409).send({
            error: 'busy',
            message: 'This session already has a turn in flight.',
            job: outcome.job,
          });

        case 'stale':
          // With the head it should have used, so a client can rebase rather
          // than reload everything.
          return reply.code(412).send({
            error: 'stale-head',
            message: 'The session has moved on since this was composed.',
            head: outcome.head,
          });

        case 'existing': {
          /**
           * A retry. **Branching on the job's status, not on the outcome kind**
           * — `existing` is returned for a running or committed job too, and
           * restarting one of those would make a second provider call for a turn
           * that already happened.
           */
          if (outcome.job.status === 'queued') {
            services.runner.start(outcome.job, payloadOf(body));
          }
          return reply.send(accepted(outcome.job, sessionId));
        }

        case 'created':
          services.runner.start(outcome.job, payloadOf(body));
          // 202: the work is accepted, not done. The stream is where it happens.
          return reply.code(202).send(accepted(outcome.job, sessionId));
      }
    },
  );

  app.post(
    '/sessions/:sessionId/jobs/:jobId/cancel',
    { schema: { params: JobParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { jobId } = request.params as { jobId: string };
      const job = readJob(services.state.db, jobId);
      // `readJob` applies no owner filter and a job id in a URL is user input.
      if (job?.account !== account.handle) {
        return reply.code(404).send({ error: 'not-found', message: 'No such job.' });
      }
      if (job.finishedAt !== null) {
        return reply.code(409).send({ error: 'finished', message: 'That turn is already over.' });
      }

      services.runner.cancel(jobId);
      return reply.code(202).send({ jobId });
    },
  );

  /**
   * The session stream.
   *
   * **Everything that can produce a JSON reply happens before `writeHead`.**
   * Both framework defaults are wrong here and both were measured: *with*
   * `hijack()` a throw after the head is silently swallowed — status stays 200,
   * the stream stays open, and no log line is written, because the error handler
   * never runs. *Without* it, the same throw reaches `setErrorHandler`, which
   * sends unconditionally, Fastify calls `writeHead` a second time, and
   * `ERR_HTTP_HEADERS_SENT` kills the process.
   *
   * So: authenticate, check ownership, and only then take the socket.
   *
   * A `GET` carries no CSRF requirement (`isStateChanging` excludes it) and
   * authenticates by cookie — which is exactly what `EventSource` needs, since
   * it can send cookies and cannot set headers. **Nothing may later add a header
   * requirement to this route.**
   */
  app.get(
    '/sessions/:sessionId/stream',
    { schema: { params: SessionParams, querystring: StreamQuery } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await mine(services, request, reply);
      if (!session) return;

      const query = request.query as { after?: string };
      const cursor = parseCursor(query.after ?? headerCursor(request));

      reply.hijack();
      const writer = new SseWriter(reply.raw, {
        keepaliveMs: services.config.sessions.streamKeepaliveMs,
        onClose: () => {
          attachment?.detach();
          services.streams.delete(release);
        },
      });

      let attachment: { detach: () => void } | null = null;
      const release = (): void => {
        writer.close();
      };
      // Registered so `app.close()` can end it: closing resolves in zero
      // milliseconds with a hijacked stream open, so a surviving keepalive is a
      // hung process rather than a failed test.
      services.streams.add(release);

      request.raw.on('close', release);
      reply.raw.on('error', release);

      try {
        attachment = attachToSession(
          { ...services.jobs, bus: services.bus },
          session.id,
          account.handle,
          cursor,
          (frame) => {
            writer.send(frame);
          },
        );
      } catch (error) {
        // Logged deliberately, because nothing else will: the error handler is
        // unreachable once the head is written.
        request.log.error({ err: error, event: 'stream.failed' }, 'Could not open a stream');
        writer.fail('internal');
      }
    },
  );
}

function payloadOf(body: {
  input: { text: string; actorId?: string | null; kind?: string };
  guidance?: string;
}): {
  input: { actorId: string | null; kind: string; text: string; raw: string };
  guidance?: string;
} {
  return {
    input: {
      actorId: body.input.actorId ?? null,
      kind: body.input.kind ?? 'do',
      text: body.input.text,
      // What the player typed, before anything normalised it. Kept because a
      // rewrite replays the original rather than the interpretation.
      raw: body.input.text,
    },
    ...(body.guidance === undefined ? {} : { guidance: body.guidance }),
  };
}

function accepted(
  job: { id: string; turnId: string; parentTurnId: string | null; status: string },
  sessionId: string,
): Record<string, unknown> {
  const cursor = formatCursor({ jobId: job.id, seq: 0 });
  return {
    jobId: job.id,
    turnId: job.turnId,
    parentTurnId: job.parentTurnId,
    status: job.status,
    cursor,
    stream: `/api/sessions/${sessionId}/stream?after=${cursor}`,
  };
}

/** A browser's automatic reconnect header. Same cursor, a different door. */
function headerCursor(request: FastifyRequest): string | undefined {
  const header = request.headers['last-event-id'];
  return Array.isArray(header) ? header[0] : header;
}

/**
 * The session, if it is this account's — and a 404 if it is not there *or* not
 * theirs.
 *
 * One helper rather than the check repeated in seven handlers, which is how one
 * of them ends up without it.
 */
async function mine(
  services: AppServices,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Awaited<ReturnType<typeof readSession>>> {
  const { sessionId } = request.params as { sessionId: string };
  const handle = request.account?.handle ?? '';

  /**
   * **Reconciled before it is answered** — [02 §8.1].
   *
   * The section says the engine compares the file's channel state against the
   * state replayed at head *on load*, and turns any divergence into a
   * user-authored effect. Until this call existed, `reconcileHandEdits` was
   * exported, unit-tested, and reached by nothing — so a hand edit was silently
   * absorbed into the head snapshot on the next turn and never entered the
   * effect log, which is the failure §8.1 exists to prevent.
   *
   * Here rather than inside `readSession`: the reconciler takes the session
   * lock, which is not reentrant, and `readSession` is called from inside that
   * lock in several places. This is the outermost read, and it holds nothing.
   */
  const reconciled = await reconcileHandEdits(services.sessions, handle, sessionId);
  if (reconciled.length > 0) {
    request.log.info(
      { event: 'session.diverged', sessionId, effects: reconciled.length },
      'A hand edit landed as a user-attributed effect',
    );
  }

  const session = await readSession(services.sessions, handle, sessionId);
  if (session === null) {
    await reply.code(404).send({ error: 'not-found', message: 'No such session.' });
    return null;
  }
  return session;
}
