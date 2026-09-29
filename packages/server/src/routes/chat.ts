// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { PARTICIPANT_SELECTORS } from '@storyengine/sdk';

import { type AppServices, requireAccount } from '../app.js';
import { DEFAULT_MODE_ID, modeById } from '../mode-registry.js';
import { isChatMode } from '../sessions/chat-settings.js';
import { setChatSettings, type ChatPatch } from '../sessions/chat-write.js';
import { presentSession } from '../sessions/present.js';
import { readSession } from '../sessions/store.js';

/**
 * ***`PUT /sessions/:id/chat`*** — the session-settings half of
 * [P13 §1.8](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * built at [P13.5]. `setChatSettings` carries the argument for what a write
 * does; this is the shape of the request and the one refusal it can meet.
 *
 * ***Every member optional, at least one sent*** — `SessionPatch`'s posture: a
 * request that changes nothing is refused rather than answered with a 200 that
 * did nothing. The vocabularies are closed here because they are closed on the
 * reader: a value `chatSettingsOf` would read past as malformed is a value no
 * client should be able to write and then see silently ignored.
 *
 * *`maxPerRound` stops at 32*, the cast route's own ceiling — a smart pick of
 * more members than a session can seat is not a setting anybody means.
 */
const CARD_PARTS = Type.Union([
  Type.Literal('system'),
  Type.Literal('post-history'),
  Type.Literal('depth'),
]);

const ChatBody = Type.Object(
  {
    voice: Type.Optional(Type.Union([Type.Literal('narrator'), Type.Literal('embodied')])),
    dispatch: Type.Optional(Type.Union([Type.Literal('merged'), Type.Literal('per-actor')])),
    speakers: Type.Optional(
      Type.Object(
        {
          policy: Type.Optional(
            Type.Union(PARTICIPANT_SELECTORS.map((selector) => Type.Literal(selector))),
          ),
          allowSelfResponses: Type.Optional(Type.Boolean()),
          namesInHistory: Type.Optional(
            Type.Union([Type.Literal('never'), Type.Literal('groups'), Type.Literal('always')]),
          ),
          maxPerRound: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
        },
        { additionalProperties: false, minProperties: 1 },
      ),
    ),
    note: Type.Optional(
      Type.Union([
        Type.Object(
          {
            text: Type.String({ maxLength: 20_000 }),
            depth: Type.Integer({ minimum: 0, maximum: 1000 }),
            every: Type.Integer({ minimum: 0, maximum: 1000 }),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
    ),
    prompts: Type.Optional(
      Type.Object(
        {
          instruction: Type.Optional(Type.Boolean()),
          cards: Type.Optional(
            Type.Record(
              Type.String({ minLength: 1, maxLength: 200 }),
              Type.Union([
                Type.Boolean(),
                Type.Array(CARD_PARTS, { maxItems: 3, uniqueItems: true }),
              ]),
              { maxProperties: 64 },
            ),
          ),
        },
        { additionalProperties: false, minProperties: 1 },
      ),
    ),
  },
  { additionalProperties: false, minProperties: 1 },
);
const ChatParams = Type.Object({ sessionId: Type.String() });

export function registerChatRoutes(app: FastifyInstance, services: AppServices): void {
  app.put(
    '/sessions/:sessionId/chat',
    { schema: { params: ChatParams, body: ChatBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const { sessionId } = request.params as { sessionId: string };

      const session = await readSession(services.sessions, account.handle, sessionId);
      if (session === null) {
        return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
      }
      /**
       * ***Only a mode that plays its cast as a chat*** — the same test the read
       * route uses to send `chat` at all (`isChatMode`). A Freeform session's
       * narrator is not a room of speakers, and a setting written there would
       * be a field on the file nothing in that mode reads: configuration with no
       * effect, which [work plan §2.3] refuses as firmly as the inverse.
       */
      const mode = modeById(session.mode?.id ?? DEFAULT_MODE_ID) ?? modeById(DEFAULT_MODE_ID);
      if (mode === null || !isChatMode(mode.definition)) {
        return reply.code(422).send({
          error: 'not-a-chat',
          message: 'This session’s mode does not play as a chat, so it has no chat settings.',
        });
      }

      const outcome = await setChatSettings(
        services.sessions,
        account.handle,
        sessionId,
        mode.definition,
        request.body as ChatPatch,
      );
      if (outcome.kind === 'no-session') {
        return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
      }
      return reply.send({ session: presentSession(outcome.session), chat: outcome.chat });
    },
  );
}
