// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { type Actor, type OutputMessage, outputFromMessages, uuidv7 } from '@storyengine/shared';

import {
  advanceHead,
  appendTurnOnly,
  readSession,
  withSessionLock,
  type SessionContext,
} from './store.js';
import type { SessionFile, Turn } from './types.js';

/**
 * ***The opening turn a chat starts on*** —
 * [P14 §1.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * built at [P14.4].
 *
 * A new session whose mode declares `openingTurn` is written **output-only
 * turns** at creation: no call, no `request`, no tape, one message per cast
 * member who has a written opening. SillyTavern opens a chat on the card's
 * `first_mes` before anybody has typed (`script.js:7651`), and Marinara writes
 * its greetings the same way; a Scene chat that opened on an empty page would
 * be the one place the import of a card lost the first thing the card says.
 *
 * - **One character**: the primary opening, and **every alternate a sibling**
 *   of it — ST's greetings-as-swipes and Marinara's silent swipes. The sibling
 *   strip then offers them exactly where ST's swipe counter sits on its first
 *   message.
 * - **A group**: one turn, each member's opening as one message **in cast
 *   order**. The alternates are not siblings here, because siblings across *N*
 *   members would be a product of their counts — the creation form picks one
 *   per member instead (`choices`).
 *
 * *This gives [P11](../../../../docs/design/workplan/28-p11-implementation.md)'s
 * `fromSeedId` row an owner for the written half*: a written opening now
 * reaches play. Seeds — openings a model expands — stay unowned.
 */

/**
 * ***An opening's text in this session's names*** — §1.7: *"Openings are
 * rendered at write time with the session's names. `{{user}}` and `{{char}}`
 * are what greetings are written in."*
 *
 * **At write time and never again**, because the turn is a record of what the
 * chat said: a persona renamed later should not rewrite a greeting already on
 * the page, any more than it rewrites a reply. *A replacement and not a
 * template render*, because an opening is prose ([P4 §1.6]'s fence — a `{{` in
 * prose is prose), and these are the only two names a greeting is written
 * in. The forms are SillyTavern's own, matched without regard to case as it
 * matches them — `{{user}}` and `<USER>`, `{{char}}`, `{{charIfNotGroup}}`,
 * `<BOT>`, `<CHAR>` and `<CHARIFNOTGROUP>` — plus the spaced `{{ user }}` of
 * this build's own template syntax, which an author writing here would reach
 * for. The card importer has already written a card's own placeholder as its
 * name (`import/sillytavern/card.ts`), so `{{char}}` here is a card written in
 * this build; `{{user}}` it leaves, because only a session knows who plays.
 *
 * *With no persona the player is "the player"*, which is what the assembler
 * calls them in the same case (`assembly/collect.ts`, `namesAbout`), so the
 * greeting and the prompt it is answered from agree.
 */
export function renderOpening(text: string, names: { char: string; user: string }): string {
  return text
    .replace(/\{\{\s*user\s*\}\}|<user>/gi, () => names.user)
    .replace(
      /\{\{\s*(?:char|charifnotgroup)\s*\}\}|<(?:bot|char|charifnotgroup)>/gi,
      () => names.char,
    );
}

/** A member's written openings, the primary first — `primaryWrittenId`, else the first. */
function openingsOf(actor: Actor): Actor['openings']['written'] {
  const written = actor.openings.written.filter((opening) => opening.text.trim().length > 0);
  const primary =
    written.find((opening) => opening.id === actor.openings.primaryWrittenId) ?? written[0];
  return primary === undefined ? [] : [primary, ...written.filter((one) => one !== primary)];
}

/** What a request may say about which opening a member starts on, and what it said wrong. */
export type OpeningChoiceRefusal =
  | { kind: 'not-in-cast'; actorId: string }
  | { kind: 'no-such-opening'; actorId: string; openingId: string };

/**
 * ***A choice the creation form sent that names nothing*** — checked before
 * the session exists, so a refusal leaves nothing behind. An actor not in the
 * cast, or an opening id that actor does not have written, is a 422 the route
 * names; a stale form is the only way to send one.
 */
export function openingChoiceRefusal(
  members: readonly Actor[],
  choices: Readonly<Record<string, string>>,
): OpeningChoiceRefusal | null {
  for (const [actorId, openingId] of Object.entries(choices)) {
    const member = members.find((actor) => actor.id === actorId);
    if (member === undefined) return { kind: 'not-in-cast', actorId };
    if (!openingsOf(member).some((opening) => opening.id === openingId)) {
      return { kind: 'no-such-opening', actorId, openingId };
    }
  }
  return null;
}

/**
 * ***The opening turns for a new session, and which one the head goes to***,
 * or null when nobody in the cast has anything written.
 *
 * `members` is the cast **in cast order**, the persona excluded — the order
 * a group's messages go in. `choices` maps a member to the opening they start
 * on; absent is the primary. In a single-character session the choice picks
 * which sibling the head is on and every opening is still written, so the
 * others stay a swipe away.
 *
 * *Pure*, so the shape is tested without a store. Every turn is a root
 * (`parentTurnId: null`), `complete`, with no effects and an empty tape:
 * nothing was drawn and nothing about the story's state changed — a greeting
 * is words, and the channels the session starts with are its own.
 */
export function openingTurns(
  session: Pick<SessionFile, 'id'>,
  members: readonly Actor[],
  persona: string | null,
  choices: Readonly<Record<string, string>> = {},
): { turns: Turn[]; head: string } | null {
  const user = persona ?? 'the player';
  const speaking = members
    .map((actor) => ({ actor, openings: openingsOf(actor) }))
    .filter((member) => member.openings.length > 0);
  const first = speaking[0];
  if (first === undefined) return null;

  const createdAt = new Date().toISOString();
  const turnOf = (messages: OutputMessage[]): Turn => ({
    id: uuidv7(),
    sessionId: session.id,
    parentTurnId: null,
    createdAt,
    status: 'complete',
    output: outputFromMessages(messages),
    effects: [],
    tape: [],
  });
  const messageOf = (actor: Actor, text: string): OutputMessage => ({
    speaker: { id: actor.id, name: actor.name },
    text: renderOpening(text, { char: actor.name, user }),
  });

  if (members.length === 1) {
    /**
     * ***The primary is written first***, so it is the first sibling the strip
     * offers, as ST's swipe 0 is the `first_mes` — and the head goes to the
     * chosen one, the primary unless the form said otherwise.
     */
    const turns = first.openings.map((opening) => turnOf([messageOf(first.actor, opening.text)]));
    const chosen = choices[first.actor.id];
    const at = first.openings.findIndex((opening) => opening.id === chosen);
    const head = turns[at === -1 ? 0 : at] ?? turns[0];
    return head === undefined ? null : { turns, head: head.id };
  }

  const turn = turnOf(
    speaking.map(({ actor, openings }) => {
      const chosen = choices[actor.id];
      const opening = openings.find((one) => one.id === chosen) ?? openings[0];
      return messageOf(actor, opening?.text ?? '');
    }),
  );
  return { turns: [turn], head: turn.id };
}

/**
 * ***Writes the opening turns and puts the head on the chosen one***, under the
 * session's lock.
 *
 * *Every turn appended, then the head advanced once*, rather than one
 * `appendTurnLocked` per turn: an append advances the head to what it wrote,
 * and walking it through every alternate to land on the first would be three
 * session-file writes to say one thing. `advanceHead` on a root folds no
 * effects onto an empty map, so the session's channels are unchanged.
 * `lastSelectedChild` is keyed by a parent, and roots have none — the head is
 * the whole of *which one is selected* here.
 */
export async function writeOpening(
  context: SessionContext,
  handle: string,
  sessionId: string,
  opening: { turns: readonly Turn[]; head: string },
): Promise<SessionFile | null> {
  return withSessionLock(sessionId, async () => {
    for (const turn of opening.turns) await appendTurnOnly(context, handle, sessionId, turn);
    const head = opening.turns.find((turn) => turn.id === opening.head);
    if (head === undefined) return readSession(context, handle, sessionId);
    return advanceHead(context, handle, sessionId, head);
  });
}
