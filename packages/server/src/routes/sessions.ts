// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { PRESET_SCHEMA } from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { LibraryError, read } from '../library.js';
import { walkPath } from '../sessions/segments.js';
import {
  childrenByParent,
  createBranchRef,
  createSession,
  deleteBranchRef,
  deleteSession,
  listSessionFiles,
  moveHead,
  readSession,
  reconcileHandEdits,
  renameBranchRef,
  setCast,
  setLore,
  readTurns,
  readTurnById,
  setArchived,
  undoTurn,
  type BranchRefOutcome,
} from '../sessions/store.js';
import { DEFAULT_MODE_ID, modeById } from '../modes/registry.js';
import { attachToSession, formatCursor, parseCursor } from '../stream/attach.js';
import { SseWriter } from '../stream/sse.js';
import { activeJob, readJob, submitTurn } from '../state/jobs.js';
import { previewAssembly } from '../turns/preview.js';
import { PathEscapeError } from '../storage/paths.js';
import type { Tape } from '../rng/rng.js';

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
const TurnParams = Type.Object({ sessionId: Type.String(), turnId: Type.String() });

/**
 * What a session is created as.
 *
 * `mode` and `cast` are here because without them half the shipped preset is
 * unreachable: the persona and actor slots resolve empty, so every prompt built
 * by this server used 4 of its 12 blocks and every test over assembly asserted
 * on absent input. ~~The preset is **not** a parameter — a session copies its
 * mode's default, and choosing a different pack is P7's surface.~~
 *
 * **Amended at P4.1 ([P4 §1.9]), rather than silently contradicted.** The
 * preset *is* a parameter now, and only just: an optional id, copied at
 * creation. P7 keeps the **surface** — browsing, previewing, switching
 * mid-session — and this is the minimum that makes PLAYABLE possible at all,
 * because a library full of imported presets that no session can play is a
 * library nobody can evaluate. The session still copies rather than links
 * ([02 §8]): editing a preset must not silently change a game in progress.
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
    /**
     * A preset from the library, copied instead of the mode's default
     * ([P4 §1.9]). Omitted = the mode's default, which is what every session
     * before this got.
     */
    preset: Type.Optional(Type.String({ maxLength: 200 })),
    cast: Type.Optional(CastBody),
    /**
     * The world — [P5.6], [02 §8].
     *
     * **Links, unlike `preset` two fields up**, and validated no harder than
     * `cast` is: an id that resolves to nothing is a session with no books, not
     * a rejected request. Refusing here would be the one place in the codebase
     * where a dangling link blocks, and [00 §3.3] says the opposite — the
     * retriever reports what it could not read, every turn, where somebody
     * playing can actually see it.
     *
     * `lore` is extras *beyond* whatever the treatment already links ([02 §7]),
     * so both may be given, and giving neither is the pre-P5.6 session.
     */
    treatment: Type.Optional(Type.String({ maxLength: 200 })),
    lore: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 64 })),
  },
  { additionalProperties: false },
);

const ListQuery = Type.Object({ archived: Type.Optional(Type.String()) });
const TurnsQuery = Type.Object({ limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,4}$' })) });
const StreamQuery = Type.Object({ after: Type.Optional(Type.String({ maxLength: 200 })) });

const ArchiveBody = Type.Object({ archived: Type.Boolean() }, { additionalProperties: false });

/** What a session plays with — the same two links `CreateBody` takes. */
const LoreBody = Type.Object(
  {
    treatment: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    lore: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 64 }),
  },
  { additionalProperties: false },
);

/**
 * What a preview is asked about — [P3.4].
 *
 * Field for field the half of `SubmitBody` that describes *what would be
 * sent*, so the preview's inputs cannot drift from the submission's. What it
 * deliberately lacks is the half about *committing*: no `idempotencyKey`,
 * because nothing is reserved, and no `headTurnId`, because nothing is
 * committed against one.
 */
const PreviewBody = Type.Object(
  {
    input: Type.Optional(
      Type.Object(
        {
          text: Type.String({ maxLength: 100_000 }),
          actorId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          kind: Type.Optional(Type.String({ maxLength: 40 })),
        },
        { additionalProperties: false },
      ),
    ),
    guidance: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);

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
    /**
     * Branch from this node instead of extending the head — [P6.0c].
     *
     * Absent is every submission before P6: attach to `headTurnId`, and refuse
     * with `412` if that is no longer the head. Present says *I mean this one*,
     * and the head check does not apply to it. Explicit `null` branches from
     * the root.
     */
    parentTurnId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    /**
     * Replay this turn's draws — **rewrite** rather than reroll, [07 §14.5],
     * [P6.2].
     *
     * A turn id rather than a tape: the draws are read from the record on this
     * server, so a client cannot post the roll it wishes it had got. Absent is
     * a reroll, which is also every ordinary turn.
     */
    rewriteOf: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    input: Type.Object({
      text: Type.String({ maxLength: 100_000 }),
      actorId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      kind: Type.Optional(Type.String({ maxLength: 40 })),
    }),
    guidance: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);

/**
 * Where to put the head — [P6.1].
 *
 * `resume` rather than a second route, because it is the same write with one
 * question answered differently: *this node*, or *this node and then wherever I
 * was going*.
 */
const HeadBody = Type.Object(
  {
    turnId: Type.String({ minLength: 1, maxLength: 200 }),
    resume: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** A name, and the node it bookmarks — [09 §3]. */
const RefBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    turnId: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

const RefNameBody = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);

const RefParams = Type.Object({
  sessionId: Type.String(),
  refId: Type.String(),
});

/**
 * The three ref writes answer the same four ways, so they say so once.
 *
 * A named node that is not in this session is a `404` rather than a `422` for
 * the reason the turn submission's `no-such-parent` gives: the request is well
 * formed and names something that is not there.
 */
function refReply(reply: FastifyReply, outcome: BranchRefOutcome): FastifyReply {
  switch (outcome.kind) {
    case 'no-session':
      return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
    case 'no-turn':
      return reply
        .code(404)
        .send({ error: 'no-such-turn', message: 'No such turn in this session.' });
    case 'no-ref':
      return reply.code(404).send({ error: 'no-such-ref', message: 'No such branch ref.' });
    case 'written':
      return reply.send({ session: outcome.session });
  }
}

export function registerSessionRoutes(app: FastifyInstance, services: AppServices): void {
  app.post('/sessions', { schema: { body: CreateBody } }, async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;

    const body = request.body as {
      name: string;
      mode?: string;
      preset?: string;
      cast?: { persona: string | null; actors: string[] };
      treatment?: string;
      lore?: string[];
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

    /**
     * The named preset, or the mode's default ([P4 §1.9]).
     *
     * Read through the ordinary library door, so it is subject to the same
     * ownership rule as everything else: another account's preset is
     * `not-found`, never `forbidden`, because confirming that an id exists
     * elsewhere leaks the one fact that separation exists to keep ([04 §4.3]).
     *
     * `preset.modes` is deliberately **not** checked. It is advisory ([10 §8.2])
     * — a preset written for a mode you do not have still imports, still shows,
     * and still plays if you insist. Refusing here would turn a hint into a
     * gate, and the phase that fills a library with other people's presets is
     * the worst possible place to do that.
     */
    let preset;
    if (body.preset === undefined) {
      preset = structuredClone(mode.definition.assembly.defaultPreset);
    } else {
      let row;
      try {
        row = read(services.library, account.handle, body.preset, PRESET_SCHEMA);
      } catch (error) {
        if (error instanceof LibraryError && error.code === 'not-found') {
          return reply.code(422).send({ error: 'unknown-preset', message: 'No such preset.' });
        }
        throw error;
      }
      // **Copied, not referenced** ([02 §8]), exactly as the default is: the
      // session owns its prompt pack from here, so editing the library's copy
      // never rewrites a game in progress.
      preset = structuredClone(row.body) as typeof mode.definition.assembly.defaultPreset;
    }

    try {
      const session = await createSession(services.sessions, account.handle, {
        name: body.name,
        mode: { id: mode.definition.id, config: null },
        preset,
        ...(body.cast === undefined ? {} : { cast: body.cast }),
        ...(body.treatment === undefined ? {} : { treatment: body.treatment }),
        ...(body.lore === undefined ? {} : { lore: body.lore }),
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

  /**
   * Which treatment and which lorebooks this session plays with.
   *
   * **The sibling of the cast route, and it exists because selection is the
   * only way a book reaches a session.** A lorebook does not volunteer,
   * whatever its own `scope` says — so without this, a session started without
   * naming books could never gain a world, and every session written before the
   * field existed would be stuck without one permanently.
   *
   * Validated no harder than `cast` is: an id that resolves to nothing is a
   * session with a dangling link, not a rejected request. The retriever reports
   * what it could not read, every turn, where somebody playing can see it.
   */
  app.put(
    '/sessions/:sessionId/lore',
    { schema: { params: SessionParams, body: LoreBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      if (!(await mine(services, request, reply))) return;

      const body = request.body as { treatment: string | null; lore: string[] };
      const { sessionId } = request.params as { sessionId: string };
      const updated = await setLore(services.sessions, account.handle, sessionId, body);
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
      /**
       * Floored as well as capped.
       *
       * `?limit=0` used to return **every turn in the file**: `slice(-0)` is
       * `slice(0)`, which is the whole array. A caller asking for none got
       * everything, which is the wrong direction for a parameter whose job is
       * to bound a response.
       */
      const limit =
        query.limit === undefined ? 100 : Math.min(Math.max(Number(query.limit), 1), 1000);

      /**
       * Which nodes on this path have siblings, and what they are — [§1.2],
       * [P6.3].
       *
       * **History shows the selected path only** ([09 §6]), so the alternatives
       * are not in `turns` and must be named some other way or they are
       * unreachable — which is what [P2C §5] meant by *a storage affordance with
       * no route*, and what [21 §4.3] predicted for an imported chat: swipes
       * land correctly in the tree and cannot be seen.
       *
       * Only nodes that actually have alternatives appear. A map of every turn
       * to its lone self would be a payload that grows with the transcript and
       * says nothing, and the surface's rule is that an affordance appears where
       * there is a choice.
       */
      const children = childrenByParent(byId);
      const siblings: Record<string, string[]> = {};
      for (const turn of path.slice(-limit)) {
        const here = (children.get(turn.parentTurnId) ?? []).map((child) => child.id);
        if (here.length > 1) siblings[turn.id] = here;
      }

      return reply.send({ turns: path.slice(-limit), siblings });
    },
  );

  /**
   * One turn by id, without the transcript riding along — [P3.0]. `GET
   * /turns` costs ~10.8 KB a turn and the whole path per request; the
   * workbench wants one turn, including one the head has passed — a re-run
   * sibling, a compare target — which the path walk never serves.
   *
   * The same 404 discipline as everything here: the session resolves from
   * the account, and a turn that exists in somebody else's session is the
   * same "No such turn." as one that never existed — the lookup is scoped to
   * *this* session inside the store, so a bare turn id cannot confirm
   * existence across the boundary.
   */
  app.get(
    '/sessions/:sessionId/turns/:turnId',
    { schema: { params: TurnParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await mine(services, request, reply);
      if (!session) return;

      const { turnId } = request.params as { turnId: string };
      const turn = await readTurnById(services.sessions, account.handle, session.id, turnId);
      if (turn === null) {
        return reply.status(404).send({ error: 'not-found', message: 'No such turn.' });
      }
      return reply.send({ turn });
    },
  );

  /**
   * What this turn *would* assemble to — the stateless preview ([P3.4]).
   *
   * **A POST that writes nothing**, and the two halves of that are separate
   * claims. POST because the body carries up to a hundred thousand characters
   * of somebody's prose, which cannot go in a URL — and because the CSRF
   * header rides along, so a cross-site page cannot loop this into re-reading
   * every turn on disk. Writes nothing because [P3 §1.6] scoped this stage
   * that way: no job is reserved, no draft is checkpointed, no record is
   * appended, and — through `readMine` rather than `mine` — no hand edit is
   * reconciled into a divergence turn.
   *
   * `input` is optional, matching the collector's own `input?`: *nothing typed
   * yet* is the same shape on the wire as it is in `CollectContext`, and it is
   * the reading the meter shows at rest. There is no `headTurnId` in the body
   * — the preview assembles against the session's current head and echoes back
   * which one that was; a stale preview corrects itself on the next keystroke,
   * where refusing would blank the meter at the moment somebody is watching it.
   */
  app.post(
    '/sessions/:sessionId/preview',
    { schema: { params: SessionParams, body: PreviewBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const session = await readMine(services, request, reply);
      if (!session) return;

      const body = request.body as { input?: { text: string }; guidance?: string };
      const preview = await previewAssembly(
        {
          sessions: services.sessions,
          accounts: services.accounts,
          providers: services.providers,
          config: services.config,
        },
        {
          account: account.handle,
          sessionId: session.id,
          parentTurnId: session.headTurnId ?? null,
          ...(body.input === undefined ? {} : { input: body.input }),
          ...(body.guidance === undefined ? {} : { guidance: body.guidance }),
        },
      );

      return reply.send({ preview });
    },
  );

  /**
   * Where you are in the tree — [09 §3], [P6.1].
   *
   * **Moving the head moves no turn data.** It re-derives the channel state at
   * the node ([P6.0b], through [P6.0d]'s cache) and records the path it
   * selected, so navigating back and forward again resumes rather than guesses.
   * `resume` is that forward gesture: from the node named, follow what was last
   * selected — or the only child, where there is nothing to choose between —
   * and stop at a fork nobody has been through.
   *
   * **Refused while a turn is in flight**, with the job, for the reason [P2
   * §2.10] gives about submissions: the running turn is going to set the head
   * when it commits, and a move that raced it would either be silently
   * overwritten or overwrite the turn's own parentage. One turn advances a
   * session at a time, and this is the same rule seen from the other side.
   */
  app.put(
    '/sessions/:sessionId/head',
    { schema: { params: SessionParams, body: HeadBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as { turnId: string; resume?: boolean };

      // No account filter, matching `submitTurn`'s own busy check: a session
      // belongs to the directory it is in, so the job on it is this account's.
      const active = activeJob(services.state.db, sessionId);
      if (active !== null) {
        return reply.code(409).send({
          error: 'busy',
          message: 'This session already has a turn in flight.',
          job: active,
        });
      }

      const outcome = await moveHead(services.sessions, account.handle, sessionId, body.turnId, {
        ...(body.resume === undefined ? {} : { resume: body.resume }),
      });

      switch (outcome.kind) {
        case 'no-session':
          return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
        case 'no-turn':
          return reply
            .code(404)
            .send({ error: 'no-such-turn', message: 'No such turn in this session.' });
        case 'moved':
          // With what the line being left still has out in the world — [09 §7]'s
          // honesty banner. Zero until something writes an escaped effect, and
          // the field is here so the first producer has somewhere to surface.
          return reply.send({ session: outcome.session, abandoned: outcome.abandoned });
      }
    },
  );

  /**
   * Naming a node, renaming the name, and forgetting it — [09 §6]'s *promote*,
   * [P6.1].
   *
   * Three routes over one array in `session.json`, because that is all a
   * `BranchRef` is: an id, a name, and the node it bookmarks. None of them
   * reads or writes a turn, and the delete deletes a name — which is worth
   * saying in the routing layer as well as in the store, since *delete branch*
   * is a phrase that sounds like it removes a story.
   */

  /**
   * Undo — apply an effect's `before`, or refuse and offer the branch —
   * [§1.4], [13 §1.2.1], [P6.3].
   *
   * The refusal is the feature. `before` is an inverse only while nothing has
   * touched the same key since; applying it otherwise destroys the later change
   * and produces a state no turn ever wrote, plausibly enough that nothing
   * surfaces. So a turn that is no longer the tip for its keys is refused with
   * the keys that block it and the node to branch from instead — which is the
   * thing this phase spent four stages making cheap.
   */
  app.post(
    '/sessions/:sessionId/turns/:turnId/undo',
    { schema: { params: TurnParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId, turnId } = request.params as { sessionId: string; turnId: string };

      // The same rule a head move follows: a running turn is about to write
      // state and move the head, and an undo racing it would be inverting
      // against a tip that is moving underneath.
      const active = activeJob(services.state.db, sessionId);
      if (active !== null) {
        return reply.code(409).send({
          error: 'busy',
          message: 'This session already has a turn in flight.',
          job: active,
        });
      }

      const outcome = await undoTurn(services.sessions, account.handle, sessionId, turnId);

      switch (outcome.kind) {
        case 'no-session':
          return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
        case 'no-turn':
          return reply
            .code(404)
            .send({ error: 'no-such-turn', message: 'No such turn in this session.' });
        case 'off-path':
          return reply.code(409).send({
            error: 'off-path',
            message: 'That turn is not on the line this session is on.',
          });
        case 'nothing-to-undo':
          return reply
            .code(409)
            .send({ error: 'nothing-to-undo', message: 'That turn changed no channel state.' });
        case 'not-at-tip':
          // With what blocks it and where to branch from, because a bare "no"
          // leaves a UI able to offer only *try again*.
          return reply.code(409).send({
            error: 'not-at-tip',
            message: 'Something has written those channels since. Branch instead.',
            keys: outcome.keys,
            branchFrom: outcome.branchFrom,
          });
        case 'undone':
          return reply.send({ session: outcome.session, turn: outcome.turn });
      }
    },
  );
  app.post(
    '/sessions/:sessionId/refs',
    { schema: { params: SessionParams, body: RefBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as { name: string; turnId: string };
      const outcome = await createBranchRef(
        services.sessions,
        account.handle,
        sessionId,
        body.name,
        body.turnId,
      );
      return refReply(reply, outcome);
    },
  );

  app.patch(
    '/sessions/:sessionId/refs/:refId',
    { schema: { params: RefParams, body: RefNameBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId, refId } = request.params as { sessionId: string; refId: string };
      const body = request.body as { name: string };
      const outcome = await renameBranchRef(
        services.sessions,
        account.handle,
        sessionId,
        refId,
        body.name,
      );
      return refReply(reply, outcome);
    },
  );

  app.delete(
    '/sessions/:sessionId/refs/:refId',
    { schema: { params: RefParams } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;

      const { sessionId, refId } = request.params as { sessionId: string; refId: string };
      const outcome = await deleteBranchRef(services.sessions, account.handle, sessionId, refId);
      return refReply(reply, outcome);
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
        parentTurnId?: string | null;
        rewriteOf?: string;
        input: { text: string; actorId?: string | null; kind?: string };
        guidance?: string;
      };

      /**
       * The tape a rewrite replays, read from the record — [P6.2].
       *
       * Read here rather than in the runner because this is where the request
       * is still a request: a turn id that names nothing in this session is a
       * refusal, and the runner's job starts after that question is settled.
       */
      let replay: Tape | undefined;
      if (body.rewriteOf !== undefined) {
        const rewritten = await readTurnById(
          services.sessions,
          account.handle,
          sessionId,
          body.rewriteOf,
        );
        if (rewritten === null) {
          return reply
            .code(404)
            .send({ error: 'no-such-turn', message: 'No such turn in this session to rewrite.' });
        }
        replay = rewritten.tape;
      }

      const outcome = await submitTurn(services.jobs, {
        account: account.handle,
        sessionId,
        idempotencyKey: body.idempotencyKey,
        headTurnId: body.headTurnId,
        // Spread rather than passed, because *absent* and *null* are different
        // requests here — see `SubmitRequest.parentTurnId`.
        ...('parentTurnId' in body ? { parentTurnId: body.parentTurnId } : {}),
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
          /**
           * With the head it should have used, so a client can rebase rather
           * than reload everything.
           *
           * **Still a refusal after [P6.0c], and that is the decision rather
           * than a leftover.** A client whose head moved under it can now do
           * one of two things with this answer, where before it could only
           * rebase: resubmit against `head`, or resubmit naming
           * `parentTurnId` and keep the line it was composing on. The refusal
           * is what makes the second one a choice somebody made instead of a
           * branch the server invented — [08 §1.7].
           */
          return reply.code(412).send({
            error: 'stale-head',
            message: 'The session has moved on since this was composed.',
            head: outcome.head,
          });

        case 'no-parent':
          // A named branch point that is not a turn of this session. A 404
          // rather than a 422: the request is well formed and names something
          // that is not there, which is the same answer `GET /turns/:turnId`
          // gives for the same id.
          return reply.code(404).send({
            error: 'no-such-parent',
            message: 'No such turn in this session to branch from.',
          });

        case 'existing': {
          /**
           * A retry. **Branching on the job's status, not on the outcome kind**
           * — `existing` is returned for a running or committed job too, and
           * restarting one of those would make a second provider call for a turn
           * that already happened.
           */
          if (outcome.job.status === 'queued') {
            services.runner.start(outcome.job, payloadOf(body, replay));
          }
          return reply.send(accepted(outcome.job, sessionId));
        }

        case 'created':
          services.runner.start(outcome.job, payloadOf(body, replay));
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
        /**
         * Logged deliberately, because nothing else will: the error handler is
         * unreachable once the head is written.
         *
         * **With the session id**, which it did not carry — on the play
         * surface's own path, where the session id is the one thing a person
         * reporting a broken stream actually has.
         */
        request.log.error(
          { event: 'stream.failed', sessionId: session.id, err: error },
          'Could not open a stream',
        );
        writer.fail('internal');
      }
    },
  );
}

function payloadOf(
  body: {
    input: { text: string; actorId?: string | null; kind?: string };
    guidance?: string;
  },
  replay?: Tape,
): {
  input: { actorId: string | null; kind: string; text: string; raw: string };
  guidance?: string;
  replay?: Tape;
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
    ...(replay === undefined ? {} : { replay }),
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
/**
 * The session, if it is this account's — **without `mine()`'s reconciliation**.
 *
 * For the one route that must not write: the preview ([P3.4]). `mine()`
 * reconciles hand edits, which takes the non-reentrant session lock and, when
 * the file has diverged, **appends a user-authored divergence turn**. Both are
 * correct for a read somebody performed once by opening a session, and wrong
 * for one that fires every time a person pauses typing: it would contend the
 * lock `finaliseTurn` needs, and it would make looking at a meter move the
 * head the meter is measuring against.
 *
 * Skipping reconciliation is consistent rather than a hole — `POST /turns`
 * does not reconcile either, and the door for it is the session read the play
 * surface already performs on arrival.
 */
async function readMine(
  services: AppServices,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Awaited<ReturnType<typeof readSession>>> {
  const { sessionId } = request.params as { sessionId: string };
  const handle = request.account?.handle ?? '';

  const session = await readSession(services.sessions, handle, sessionId);
  if (session === null) {
    await reply.code(404).send({ error: 'not-found', message: 'No such session.' });
    return null;
  }
  return session;
}

/**
 * The same check, plus the reconciliation — the door every *other* session
 * route goes through. See {@link readMine} for the one that may not take it.
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
