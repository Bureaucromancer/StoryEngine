// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { type AppServices, requireAccount } from '../app.js';
import { DEFAULT_MODE_ID, modeSurfaces, sessionSurfaces } from '../mode-registry.js';
import { degradedChannels } from '../sessions/channels.js';
import { presentSession } from '../sessions/present.js';
import { readSession } from '../sessions/store.js';
import { activeJob } from '../state/jobs.js';
import { runOnDemand } from '../turns/on-demand.js';
import { disconnectSignal } from './disconnect.js';

/**
 * ***`POST /sessions/:id/steps/:stepId/run`*** — a mode's on-demand step, run
 * between turns: [P13 §1.9.2](../../../../docs/design/workplan/30-p13-scene-and-session-import.md)'s
 * *Update trackers*, built at [P13.5a]. `turns/on-demand.ts` carries the
 * argument for what it writes; this is the request and its refusals.
 *
 * **The step's id in the path, and the mode's declaration as the gate**, so
 * the engine names no mode's step: Scene's tracker panel asks for its own
 * tracker step by id, and an id the session's mode does not declare
 * `onDemand` is a 404 — the same answer the channel route gives a channel the
 * mode does not own, for the same reason.
 *
 * **Refused while a turn is in flight** (409 `busy`, with the job), unlike an
 * impersonation: this writes a turn, and a turn written beside a running one
 * would be a sibling its commit abandons. And **refused if the head moved**
 * while the call ran (409 `moved`): the update was computed for a story that
 * has since gone on, and writing it would put the old reading on the new line.
 *
 * *`POST`, with no body*: it dispatches a model call and must not be replayed
 * by a browser prefetching a link — the impersonation route's reason.
 */
const Params = Type.Object({
  sessionId: Type.String(),
  stepId: Type.String({ minLength: 1, maxLength: 200 }),
});

export function registerOnDemandRoutes(app: FastifyInstance, services: AppServices): void {
  app.post(
    '/sessions/:sessionId/steps/:stepId/run',
    { schema: { params: Params } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const { sessionId, stepId } = request.params as { sessionId: string; stepId: string };

      const session = await readSession(services.sessions, account.handle, sessionId);
      if (session === null) {
        return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
      }

      // A person waiting on the update is what it is for; the client leaving
      // cancels the call, as a draft's does.
      const signal = disconnectSignal(reply);
      const outcome = await runOnDemand(
        {
          sessions: services.sessions,
          accounts: services.accounts,
          providers: services.providers,
          config: services.config,
          online: () => services.updates.online,
        },
        { account: account.handle, sessionId, stepId, signal },
      );

      switch (outcome.kind) {
        case 'written': {
          const modeId = outcome.session.mode?.id ?? DEFAULT_MODE_ID;
          return reply.send({
            session: presentSession(outcome.session),
            turn: outcome.turn,
            health: degradedChannels(outcome.session.channels),
            hud: sessionSurfaces(outcome.session.channels, modeId),
            surfaces: modeSurfaces(outcome.session.channels, modeId, sessionId),
          });
        }
        /**
         * ***Nothing to change is a 200 with no turn***, not an error: no
         * tracker is on, or the model read the scene and found it as it was.
         * The call, if one was made, is named so its spend can be found.
         */
        case 'nothing':
          return reply.send({ turn: null, callId: outcome.callId });
        case 'no-session':
          return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
        case 'no-step':
          return reply
            .code(404)
            .send({ error: 'no-such-step', message: 'This session has no such step to run.' });
        case 'busy':
          return reply.code(409).send({
            error: 'busy',
            message: 'This session already has a turn in flight.',
            job: activeJob(services.state.db, sessionId),
          });
        case 'moved':
          return reply.code(409).send({
            error: 'moved',
            message: 'The story moved on while this ran, so nothing was written.',
          });
        case 'cancelled':
          if (signal.aborted) return;
          return reply
            .code(503)
            .send({ error: 'cancelled', message: 'The server stopped before this finished.' });
        case 'provider-failed':
          request.log.error(
            {
              event: 'on-demand.failed',
              sessionId,
              stepId,
              class: outcome.class,
              callId: outcome.callId,
              ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
            },
            'An on-demand step could not run',
          );
          return reply.code(502).send({
            error: 'provider-failed',
            class: outcome.class,
            remedy: outcome.remedy,
            message: 'The model endpoint could not answer.',
          });
        /**
         * *The step could not use what it was given* — in practice a model
         * answer that was not the shape asked for. The endpoint answered, so
         * not `provider-failed`; the step's own sentence is logged and the
         * client has its words for the class.
         */
        case 'step-failed':
          request.log.warn(
            { event: 'on-demand.step-failed', sessionId, stepId, message: outcome.message },
            'An on-demand step failed',
          );
          return reply
            .code(502)
            .send({ error: 'step-failed', message: 'The step could not use the answer it got.' });
        case 'role-unbound':
        case 'role-dangling':
        case 'window-too-small':
          return reply
            .code(422)
            .send({ error: outcome.kind, message: 'The step could not be run as configured.' });
      }
    },
  );
}
