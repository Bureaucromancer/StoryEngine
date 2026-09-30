// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { outputMessagesOf, type OutputMessage, type Turn } from '@storyengine/shared';

import { type AppServices, requireAccount } from '../app.js';
import { DEFAULT_MODE_ID, modeById } from '../mode-registry.js';
import { chatSettingsOf } from '../sessions/chat-settings.js';
import { setHidden } from '../sessions/hidden.js';
import { presentSession } from '../sessions/present.js';
import { readSession, readTurnById } from '../sessions/store.js';
import type { SessionFile } from '../sessions/types.js';
import { readRegistry } from '../tags/store.js';
import { resolveCast } from '../turns/cast.js';
import type { TurnPayload } from '../turns/runner.js';

/**
 * ***The gestures of a chat, onto the tree*** —
 * [P13 §1.6](../../../../docs/design/workplan/30-p13-scene-and-session-import.md),
 * built at [P13.4].
 *
 * Each SillyTavern and Marinara verb has one form here, and most of them are
 * `POST /sessions/:id/turns` with a field that says which: an empty send is a
 * turn with no `input`, force-talk is `speakers`, a swipe is `fromMessage`, a
 * continue is `continueOf`, an edit is `authored`. **This module decides what
 * each of those fields means against the record** — which turn it names, what
 * the new sibling carries from it, who speaks — and hands the submission route
 * the answer, so that route keeps its one flow (checks, reservation, runner)
 * for every gesture. The one gesture that is not a turn — hide — is the route
 * registered at the bottom.
 *
 * *Delete is not here, because it is not new*: §1.6 makes it *"the head moves
 * to the parent. The turn remains as a sibling nobody is on"*, which is
 * `PUT /sessions/:id/head` with the parent's id — or `null` for a first turn,
 * which that route accepts since [P13.4] (`moveHead`).
 */

/** The submission fields this module reads — `SubmitBody`'s, as the handler parsed them. */
export interface GestureBody {
  parentTurnId?: string | null;
  rewriteOf?: string;
  redoOf?: string;
  input?: unknown;
  guidance?: string;
  speakers?: string[];
  push?: string;
  fromMessage?: number;
  continueOf?: string;
  editOf?: string;
  authored?: {
    input?: { text: string; actorId?: string | null; kind?: string };
    messages?: { speaker: string | null; text: string }[];
  };
}

/** A refusal, as the route sends it. */
export interface GestureRefusal {
  status: number;
  body: { error: string; message: string } & Record<string, unknown>;
}

/**
 * ***What the gesture resolved to*** — every field optional, and absent means
 * *the ordinary submission decides*.
 *
 * - `parentTurnId` — where the sibling goes: the named turn's parent, for a
 *   swipe and a continue.
 * - `input` — the move the turn answers, when the gesture supplies it: the
 *   named turn's, carried, or the one written by hand.
 * - `carry` and `authored` — `TurnPayload`'s, see there.
 * - `recorded` — the force-talk the carried input recorded, which the new
 *   turn's record keeps (`TurnPayload.carry` on why it is not the carried
 *   speaker).
 * - `attempt` — for a guided swipe, the one message being redone, rather than
 *   the whole round a plain redo shows.
 * - `speaking` — the ids the route's force-talk check must pass: the carried
 *   speaker, or the speakers an edit wrote lines for.
 * - `hidden` — `TurnPayload.hidden`: the named turn's hide entry, kept to
 *   what a swipe or a continue carries (2026-09-29, the [P13.4] review). An
 *   edit's is settled once its lines are signed, from `authored.from`
 *   ({@link editedFrom}).
 * - `authored.from` — for an edit that names the turn it edits (`editOf`),
 *   that turn's messages and hide entry, so a line the edit left as it was is
 *   kept whole and stays hidden if it was.
 */
export interface Gesture {
  parentTurnId?: string | null;
  input?: NonNullable<TurnPayload['input']>;
  carry?: NonNullable<TurnPayload['carry']>;
  authored?: {
    messages: { speaker: string | null; text: string }[];
    from?: { messages: readonly OutputMessage[]; hidden?: true | readonly number[] };
  };
  recorded?: string[];
  attempt?: { turnId: string; text: string };
  speaking?: string[];
  hidden?: true | readonly number[];
}

/**
 * ***Which fields cannot be sent together***, as one sentence per clash.
 *
 * - **An edit makes no call**, so everything that steers one — an input
 *   beside it (the edit carries its own), guidance, force-talk, a push, a redo, a
 *   rewrite, a swipe, a continue — is a request it cannot honour.
 * - **A swipe and a continue carry their input** from the turn they name, so
 *   an `input` beside either would be a sibling answering a different move
 *   than the messages it carries; and they choose their speaker from the
 *   record, so `speakers` would be a second answer to the same question.
 * - **A swipe needs a turn to swipe**: `fromMessage` names a message of the
 *   turn `redoOf` or `rewriteOf` names, and when both are sent they must name
 *   the same one.
 *
 * *One error class for all of them*, `conflicting-gesture`, because a client
 * acts on every one the same way — it built a body it should not have — and
 * the sentence says which.
 */
function clashOf(body: GestureBody): string | null {
  if (body.editOf !== undefined && body.authored === undefined) {
    return 'editOf names the turn an edit rewrites; send authored with it.';
  }
  if (body.authored !== undefined) {
    const steering = (
      [
        'input',
        'guidance',
        'speakers',
        'push',
        'rewriteOf',
        'redoOf',
        'fromMessage',
        'continueOf',
      ] as const
    ).filter((field) => body[field] !== undefined);
    if (steering.length > 0) {
      return `A turn written by hand makes no call, so it cannot be sent with ${steering.join(', ')}.`;
    }
    return null;
  }
  if (body.continueOf !== undefined) {
    const clashing = (['input', 'speakers', 'rewriteOf', 'redoOf', 'fromMessage'] as const).filter(
      (field) => body[field] !== undefined,
    );
    if (clashing.length > 0) {
      return `A continue carries its move and its speaker, so it cannot be sent with ${clashing.join(', ')}.`;
    }
    return null;
  }
  if (body.fromMessage !== undefined) {
    if (body.redoOf === undefined && body.rewriteOf === undefined) {
      return 'fromMessage names a message of the turn being redone; send redoOf or rewriteOf with it.';
    }
    if (
      body.redoOf !== undefined &&
      body.rewriteOf !== undefined &&
      body.redoOf !== body.rewriteOf
    ) {
      return 'A swipe redoes one turn; redoOf and rewriteOf name two.';
    }
    const clashing = (['input', 'speakers'] as const).filter((field) => body[field] !== undefined);
    if (clashing.length > 0) {
      return `A swipe carries its move and its speaker, so it cannot be sent with ${clashing.join(', ')}.`;
    }
  }
  return null;
}

/**
 * ***The force-talk an input recorded***, shape-guarded as the route's own
 * `forcedOn` is and for its reason: the record is a file, and an imported
 * turn's input rides in through a spread.
 */
function recordedSpeakers(turn: Turn): string[] | undefined {
  const held: unknown = turn.input?.speakers;
  if (!Array.isArray(held)) return undefined;
  const ids = held.filter((id): id is string => typeof id === 'string' && id !== '');
  return ids.length === 0 ? undefined : ids;
}

/**
 * ***The move a sibling carries from the turn it redoes***, without the
 * force-talk (which travels as `recorded`) — or none, for a turn that answered
 * no input: a swipe of a *let them talk* reply is itself one.
 */
function carriedInput(turn: Turn): NonNullable<TurnPayload['input']> | undefined {
  const input = turn.input;
  if (input === undefined) return undefined;
  return {
    actorId: input.actorId,
    kind: input.kind,
    text: input.text,
    raw: input.raw,
    ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
  };
}

/**
 * ***The hide entry a carrying sibling keeps*** — added 2026-09-29, at the
 * [P13.4] review, which found a swipe and a continue bringing back into the
 * prompt every message the person had hidden on the turn they named. `true`
 * stays `true` — a turn hidden whole is hidden whole on its swipe too, the
 * regenerated message with it, which is what a person who hid the round
 * asked for — and a list is kept to the indices the sibling carries (`below`),
 * whose numbering is the same `outputMessagesOf` numbering on both turns,
 * because the carried messages are copied in order from index 0.
 */
function carriedHidden(
  held: true | readonly number[] | undefined,
  below: number,
): true | number[] | undefined {
  if (held === undefined) return undefined;
  if (held === true) return true;
  const kept = held.filter((index) => index < below);
  return kept.length === 0 ? undefined : kept;
}

const NOT_A_SIBLING: GestureRefusal = {
  status: 422,
  body: {
    error: 'not-a-sibling',
    message: 'A swipe or a continue is a sibling of the turn it names; it cannot branch elsewhere.',
  },
};

/**
 * ***Where the carrying sibling goes***: the named turn's parent, or a
 * refusal when the body named somewhere else. *Filled in when the body left
 * it out*, which is the ordinary case — so the head check that a submission
 * without `parentTurnId` makes does not apply, because the gesture already
 * said which node it means.
 */
function siblingOf(
  body: GestureBody,
  turn: Turn,
): GestureRefusal | { parentTurnId: string | null } {
  if ('parentTurnId' in body && (body.parentTurnId ?? null) !== turn.parentTurnId) {
    return NOT_A_SIBLING;
  }
  return { parentTurnId: turn.parentTurnId };
}

/**
 * ***A swipe or a continue speaks as a member, in an embodied chat.***
 *
 * *Deliberately not built for narrated text* ([P13.4]): a narrator's reply is
 * one merged call that speaks for nobody, so *"regenerate message k by the same
 * speaker"* has no speaker to give it, and a narrated turn is one message — its
 * swipe is the plain redo that already exists. And a narrator-voice session's
 * step makes that merged call whoever is selected, so a carried speaker would be
 * shown the carried round and ignored. Both refusals name the gesture that does
 * work: redo the whole turn.
 */
function spokenBy(
  message: OutputMessage,
  voice: 'narrator' | 'embodied',
): GestureRefusal | { speaker: string } {
  if (voice === 'narrator') {
    return {
      status: 422,
      body: {
        error: 'narrated-session',
        message: 'This session is narrated; redo the whole turn instead.',
      },
    };
  }
  if (message.speaker === null) {
    return {
      status: 422,
      body: {
        error: 'narrated-message',
        message: 'That message is the narrator’s, not a member’s; redo the whole turn instead.',
      },
    };
  }
  return { speaker: message.speaker.id };
}

/**
 * ***Reads a submission's gesture against the record*** — `null` fields and
 * all, or the refusal to send. See {@link Gesture}.
 */
export async function gestureOf(
  services: AppServices,
  handle: string,
  sessionId: string,
  body: GestureBody,
): Promise<{ refused: GestureRefusal } | { gesture: Gesture }> {
  const clash = clashOf(body);
  if (clash !== null) {
    return { refused: { status: 422, body: { error: 'conflicting-gesture', message: clash } } };
  }

  if (body.authored !== undefined) {
    const written = body.authored.input;
    /**
     * ***An edit that names what it edits*** (`editOf`) — added 2026-09-29,
     * at the [P13.4] review. Without it an edit was a turn re-authored from
     * nothing: an edit of the reply lost the player's line unless the client
     * re-sent it, and even then its pictures, force-talk and raw text, which
     * `authored.input` has no field for. Named, the edit is a sibling of that
     * turn and **carries what it does not rewrite**: the input whole unless
     * `authored.input` is sent — and then only the text, the actor and the
     * kind are laid over it, so the pictures survive — the messages whole
     * unless `authored.messages` is sent, and any line it leaves as it was
     * kept whole, reasoning and `original` included ({@link editedFrom}).
     */
    const edited =
      body.editOf === undefined
        ? null
        : await readTurnById(services.sessions, handle, sessionId, body.editOf);
    if (body.editOf !== undefined && edited === null) {
      return {
        refused: {
          status: 404,
          body: { error: 'no-such-turn', message: 'No such turn in this session to edit.' },
        },
      };
    }
    let placed: { parentTurnId?: string | null } = {};
    let from: NonNullable<Gesture['authored']>['from'];
    let carried: NonNullable<TurnPayload['input']> | undefined;
    let recorded: string[] | undefined;
    if (edited !== null) {
      const sibling = siblingOf(body, edited);
      if ('status' in sibling) return { refused: sibling };
      placed = sibling;
      const session = await readSession(services.sessions, handle, sessionId);
      const held = session?.hidden?.[edited.id];
      from = {
        messages: outputMessagesOf(edited.output),
        ...(held === undefined ? {} : { hidden: held }),
      };
      carried = carriedInput(edited);
      recorded = recordedSpeakers(edited);
    }
    const input: NonNullable<TurnPayload['input']> | undefined =
      written === undefined
        ? carried
        : {
            ...carried,
            actorId: written.actorId ?? carried?.actorId ?? null,
            kind: written.kind ?? carried?.kind ?? 'do',
            text: written.text,
            // What the person typed: the new words, unless they left the
            // words as they were, when the carried raw text still is.
            raw: carried?.text === written.text ? carried.raw : written.text,
          };
    const messages =
      body.authored.messages ??
      (from?.messages ?? []).map((message) => ({
        speaker: message.speaker?.id ?? null,
        text: message.text,
      }));
    return {
      gesture: {
        ...placed,
        ...(input === undefined ? {} : { input }),
        ...(recorded === undefined ? {} : { recorded }),
        authored: { messages, ...(from === undefined ? {} : { from }) },
        speaking: [
          ...new Set(
            messages.flatMap((message) => (message.speaker === null ? [] : [message.speaker])),
          ),
        ],
      },
    };
  }

  const named =
    body.continueOf ??
    (body.fromMessage === undefined ? undefined : (body.redoOf ?? body.rewriteOf));
  if (named === undefined) return { gesture: {} };

  const turn = await readTurnById(services.sessions, handle, sessionId, named);
  if (turn === null) {
    return {
      refused: {
        status: 404,
        body: { error: 'no-such-turn', message: 'No such turn in this session.' },
      },
    };
  }
  const session = await readSession(services.sessions, handle, sessionId);
  if (session === null) {
    return { refused: { status: 404, body: { error: 'not-found', message: 'No such session.' } } };
  }
  const mode = modeById(session.mode?.id ?? DEFAULT_MODE_ID) ?? modeById(DEFAULT_MODE_ID);
  const voice = mode === null ? 'narrator' : chatSettingsOf(session, mode.definition).voice;
  const messages = outputMessagesOf(turn.output);
  const placed = siblingOf(body, turn);
  if ('status' in placed) return { refused: placed };
  const input = carriedInput(turn);
  const recorded = recordedSpeakers(turn);
  // The named turn's hide entry — see `carriedHidden`.
  const held = session.hidden?.[turn.id];
  const common = {
    parentTurnId: placed.parentTurnId,
    ...(input === undefined ? {} : { input }),
    ...(recorded === undefined ? {} : { recorded }),
  };

  if (body.continueOf !== undefined) {
    const last = messages.at(-1);
    if (last === undefined) {
      return {
        refused: {
          status: 422,
          body: { error: 'nothing-to-continue', message: 'That turn said nothing to continue.' },
        },
      };
    }
    const speaking = spokenBy(last, voice);
    if ('status' in speaking) return { refused: speaking };
    /*
     * ***A hidden message is not continued*** (2026-09-29, the [P13.4]
     * review): the call would be shown, as its `required` last entry, a line
     * the person took out of the story, and the continuation would bring it
     * back. Unhide it first — which is the refusal's sentence.
     */
    if (held === true || held?.includes(messages.length - 1) === true) {
      return {
        refused: {
          status: 422,
          body: {
            error: 'hidden-message',
            message: 'That message is hidden; unhide it before continuing it.',
          },
        },
      };
    }
    const hidden = carriedHidden(held, messages.length - 1);
    const kept: OutputMessage = { ...last, carried: true };
    delete kept.original;
    return {
      gesture: {
        ...common,
        ...(hidden === undefined ? {} : { hidden }),
        carry: {
          messages: [
            ...messages.slice(0, -1).map((message) => ({ ...message, carried: true as const })),
            /*
             * The one being extended is carried whole, `reasoning` and all, and
             * **marked `carried` until the first streamed piece takes it
             * over** — the runner puts an unmarked message of this turn's own
             * in its place then (`speakingAs`'s first-piece branch, and
             * `settled`). A call that fails before its first word therefore
             * leaves the failed sibling saying what is true: it carried this
             * message and wrote none of it. ~~Written as `{ speaker, text }`,
             * unmarked~~ — corrected 2026-09-29, at the [P13.4] review: that
             * dropped the reasoning, and a failed continue's record claimed a
             * message it had only carried. Only its old `original` goes, which
             * described text the continued message no longer is.
             */
            kept,
          ],
          speaker: speaking.speaker,
          continues: true,
        },
        speaking: [speaking.speaker],
      },
    };
  }

  const at = body.fromMessage ?? 0;
  const swiped = messages[at];
  if (swiped === undefined) {
    return {
      refused: {
        status: 422,
        body: {
          error: 'no-such-message',
          message: 'That turn has no message there.',
          messages: messages.length,
        },
      },
    };
  }
  const speaking = spokenBy(swiped, voice);
  if ('status' in speaking) return { refused: speaking };
  const hidden = carriedHidden(held, at);
  return {
    gesture: {
      ...common,
      ...(hidden === undefined ? {} : { hidden }),
      carry: {
        messages: messages.slice(0, at).map((message) => ({ ...message, carried: true as const })),
        speaker: speaking.speaker,
      },
      // A guided swipe shows the model the one message it is redoing — not the
      // round, most of which it is keeping.
      ...(body.redoOf === undefined ? {} : { attempt: { turnId: turn.id, text: swiped.text } }),
      speaking: [speaking.speaker],
    },
  };
}

/**
 * ***What an edit that names its turn keeps of it*** — the signed lines, with
 * each one the edit left as it was (same place, same speaker, same words)
 * replaced by the original message whole, so its reasoning and `original`
 * survive; and the hide entry, `true` kept and a list kept to the indices
 * whose line is still the original's — a hide was of those words, and a line
 * rewritten by hand is the person's new text, shown. 2026-09-29, the [P13.4]
 * review; see `gestureOf`'s `editOf`.
 */
export function editedFrom(
  signed: readonly OutputMessage[],
  from: NonNullable<NonNullable<Gesture['authored']>['from']>,
): { messages: OutputMessage[]; hidden?: true | number[] } {
  const unchanged = (index: number): boolean => {
    const was = from.messages[index];
    const now = signed[index];
    return (
      was !== undefined &&
      now !== undefined &&
      (was.speaker?.id ?? null) === (now.speaker?.id ?? null) &&
      was.text === now.text
    );
  };
  const messages = signed.map((message, index) =>
    unchanged(index) ? (from.messages[index] ?? message) : message,
  );
  if (from.hidden === undefined) return { messages };
  if (from.hidden === true) return { messages, hidden: true };
  const hidden = from.hidden.filter(unchanged);
  return hidden.length === 0 ? { messages } : { messages, hidden };
}

/**
 * ***An edit's lines, attributed*** — the names a `Ref` carries, read from
 * the cast at the node the edit is written at, so a line is signed with who
 * the story says the member is there. The route has already refused an id
 * that is the persona, outside the cast, or written out of the story
 * (`speaking`); an id whose card will not read is refused here, because a
 * line needs a name and the record would otherwise sign it with an id.
 */
export async function authoredMessages(
  services: AppServices,
  handle: string,
  session: SessionFile,
  channels: Readonly<Record<string, { value: unknown }>>,
  messages: readonly { speaker: string | null; text: string }[],
): Promise<{ refused: GestureRefusal } | { messages: OutputMessage[] }> {
  if (messages.every((message) => message.speaker === null)) {
    return { messages: messages.map((message) => ({ speaker: null, text: message.text })) };
  }
  const cast = resolveCast(
    services.library,
    handle,
    session.cast,
    await readRegistry(services.sessions.layout, handle),
    channels,
  );
  const signed: OutputMessage[] = [];
  for (const message of messages) {
    if (message.speaker === null) {
      signed.push({ speaker: null, text: message.text });
      continue;
    }
    const member = cast.actors.find((one) => one.actor.id === message.speaker);
    if (member === undefined) {
      return {
        refused: {
          status: 422,
          body: {
            error: 'speaker-not-in-cast',
            message: 'A line was written for somebody who is not in this scene.',
            speaker: message.speaker,
          },
        },
      };
    }
    signed.push({ speaker: { id: member.actor.id, name: member.actor.name }, text: message.text });
  }
  return { messages: signed };
}

/**
 * ***Hide and unhide*** — `PUT /sessions/:id/turns/:turnId/hidden`, [P13 §1.6],
 * [P13.4]; `setHidden` carries the argument for what an entry is.
 *
 * `hidden: true` hides the turn whole, a list of indices hides those
 * messages, and `false` or `[]` unhides it. **One route and a set**, not a
 * hide and an unhide: the entry is one value, and a client that shows a ghost
 * on a line already knows the whole of it.
 */
const HiddenBody = Type.Object(
  {
    hidden: Type.Union([
      Type.Boolean(),
      Type.Array(Type.Integer({ minimum: 0, maximum: 999 }), { maxItems: 1000 }),
    ]),
  },
  { additionalProperties: false },
);
const HiddenParams = Type.Object({ sessionId: Type.String(), turnId: Type.String() });

export function registerGestureRoutes(app: FastifyInstance, services: AppServices): void {
  app.put(
    '/sessions/:sessionId/turns/:turnId/hidden',
    { schema: { params: HiddenParams, body: HiddenBody } },
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const { sessionId, turnId } = request.params as { sessionId: string; turnId: string };
      const { hidden } = request.body as { hidden: boolean | number[] };

      const outcome = await setHidden(services.sessions, account.handle, sessionId, turnId, hidden);
      switch (outcome.kind) {
        case 'no-session':
          return reply.code(404).send({ error: 'not-found', message: 'No such session.' });
        case 'no-turn':
          return reply
            .code(404)
            .send({ error: 'no-such-turn', message: 'No such turn in this session.' });
        case 'no-message':
          return reply.code(422).send({
            error: 'no-such-message',
            message: 'That turn has no message there.',
            index: outcome.index,
          });
        case 'written':
          return reply.send({ session: presentSession(outcome.session) });
      }
    },
  );
}
