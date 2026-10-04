// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { EffectProposal } from '@storyengine/sdk';
import {
  type Actor,
  type Opening,
  type Openings,
  type OutputMessage,
  type Setup,
  outputFromMessages,
  uuidv7,
} from '@storyengine/shared';

import { acceptEffect } from '../turns/effects.js';
import { SE_PARTY } from './cast.js';
import { SE_HOOK } from './hooks.js';
import {
  advanceHead,
  appendTurnOnly,
  readSession,
  withSessionLock,
  type SessionContext,
} from './store.js';
import type { ChannelEffect, PooledHook, SessionFile, Turn } from './types.js';

/**
 * ***What a session starts on, and one account of it*** —
 * [03 §6](../../../../docs/design/03-data-model.md),
 * [P14 §1.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md),
 * [P15 §1.7](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * Two things can write a session's first turn, and nothing else does:
 *
 * - **A Setup**, at [P15.3]: its chosen written opening, with the state it
 *   seeds — the party, and the hooks a Setup made from a turn says had already
 *   fired — riding on that turn as engine effects.
 * - **The cast**, at [P14.4]: each member's written greetings, output-only,
 *   for a mode that declares `openingTurn`.
 *
 * Both were written on the same day, on two branches that never saw each
 * other, and each was right alone. Together they both claimed turn 1 — the
 * merge first kept them side by side in this file under two lookalike pairs of
 * names. {@link firstTurns} is now the one place that decides, and these are
 * its rules, each with the reason it is the rule:
 *
 * 1. ***A Setup that carries a written opening wins over the cast's greetings,
 *    always.*** **The owner's decision, 2026-10-03, recorded as
 *    [26 B18](../../../../docs/design/26-open-questions.md) and
 *    [P15 §1.7](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).**
 *    Whichever of its openings is chosen — and when the person starts it cold too, because
 *    *start cold* is 03 §6's *"neither"*: somebody who declined the Setup's
 *    opening did not ask for a greeting in its place. A Setup made from a turn
 *    holds an opening written for this point of this story with the party
 *    already seated, and a greeting is an actor's first line in a story that
 *    has not started; the session takes one or the other, never both, and
 *    when there is a Setup's to take it takes that.
 * 2. ***The Setup's seeding rides on the Setup's own turn*** — its opening
 *    when one was chosen, and an effects-only turn when none was (start cold,
 *    or a Setup with nothing written). [P7.4] said seeding the party *"needs a
 *    turn"*, and the turn belongs to the source the seeding comes from.
 * 3. ***A Setup with no written opening, beside greetings, puts the greetings
 *    on top of its seeding turn*** — they are that turn's children, not roots
 *    beside it. **Recommended answer, owner deferred — 2026-10-03.** As the
 *    merge first wrote it, both were roots and the head went to a greeting,
 *    off the seeding's path, so the party was never seated and the spent hooks
 *    were back in the pool for anybody who played on. *Children rather than
 *    the effects copied onto each greeting*, for three reasons: a greeting
 *    stays what [P14.4] says it is, words with `effects: []`; one seeding is
 *    written once rather than once per alternate; and deleting or rewinding a
 *    greeting — the head moving to its parent — keeps the Setup's party,
 *    which is what somebody who disliked a greeting meant, where effects on
 *    the greeting would have taken the party with it.
 * 4. ***Nothing to write is no turn***, [P7.4]'s rule for a mode with no
 *    parts: *"an empty plan would commit a turn that did nothing, which is a
 *    blank first entry in somebody's transcript."*
 *
 * ---
 *
 * ***What marks such a turn afterwards is what it lacks***: no `input` and no
 * `request` — [P14]'s convention, which the play surface's Redo has read since
 * [P14.5] and `redoable` in `shared` now names. [P15.1] had added a field,
 * `Turn.opening`, for the same purpose; **it is dropped** — *recommended
 * answer, owner deferred, 2026-10-03* — because the record is frozen and a
 * field on it is a promise every reader keeps, worth adding only when a
 * consumer needs to tell a Setup's opening from something else. None does:
 * with rule 1 only one kind of opening can be a session's turn 1, and the one
 * reader, the redo refusal, asks *whether* a turn was made by nothing, never
 * *which opening* it was.
 *
 * ***A written opening is one with words***, on both halves — `writtenOf`.
 * [P14.4] always skipped a greeting with no text; [P15.3] took a Setup's
 * openings as listed, so a Setup whose editor left an empty opening behind
 * wrote a blank first turn and, after the merge, would have silenced the
 * cast's greetings for it. One reading for both, decided at the merge
 * (2026-10-03).
 */

/**
 * ***A cast's greetings, as P14.4 writes them*** —
 * [P14 §1.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
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

/**
 * ***The written openings that can be played, the primary first*** —
 * `primaryWrittenId`, else the first with words.
 *
 * An actor's openings and a Setup's are the same shape (`Openings`), and this
 * is the one reading of it both halves share: an opening with no words is not
 * an opening, and a primary pointer that names nothing playable — deleted,
 * hand-edited, or left blank by an editor — falls back to the first that is.
 */
function writtenOf(openings: Openings | undefined): Opening[] {
  const written = (openings?.written ?? []).filter((opening) => opening.text.trim().length > 0);
  const primary =
    written.find((opening) => opening.id === openings?.primaryWrittenId) ?? written[0];
  return primary === undefined ? [] : [primary, ...written.filter((one) => one !== primary)];
}

/** What a request may say about which greeting a member starts on, and what it said wrong. */
export type OpeningChoiceRefusal =
  | { kind: 'not-in-cast'; actorId: string }
  | { kind: 'no-such-opening'; actorId: string; openingId: string };

/**
 * ***A greeting choice the creation form sent that names nothing*** — checked
 * before the session exists, so a refusal leaves nothing behind. An actor not
 * in the cast, or an opening id that actor does not have written, is a 422 the
 * route names (`unknown-opening`); a stale form is the only way to send one.
 */
export function openingChoiceRefusal(
  members: readonly Actor[],
  choices: Readonly<Record<string, string>>,
): OpeningChoiceRefusal | null {
  for (const [actorId, openingId] of Object.entries(choices)) {
    const member = members.find((actor) => actor.id === actorId);
    if (member === undefined) return { kind: 'not-in-cast', actorId };
    if (!writtenOf(member.openings).some((opening) => opening.id === openingId)) {
      return { kind: 'no-such-opening', actorId, openingId };
    }
  }
  return null;
}

/**
 * Which of a Setup's openings a creation asked for.
 *
 * `undefined` — the parameter absent — is **the primary**, which is 03 §6's
 * default and what *start a session from this Setup* means. `null` is **start
 * cold**, the third of 03 §6's three choices, and it is a choice rather than an
 * absence: somebody who picked it wants no opening even though there is one.
 * A string names one written opening.
 */
export type OpeningChoice = string | null | undefined;

/**
 * ***The Setup's written opening a choice resolves to***, or `null` for none —
 * [03 §6], [P15.3](../../../../docs/design/workplan/33-p15-setup-from-a-turn.md).
 *
 * **An id that names nothing is `unknown`, never silently the primary.** A
 * client that asked for a particular opening and got a different one would
 * have started a story somebody did not choose, which is the dangling Setup's
 * argument for a 422 one field smaller — the route's `unknown-setup-opening`.
 * An id naming an opening with no words names nothing playable, and is
 * `unknown` for the same reason P14.4's `openingChoiceRefusal` refuses a blank
 * greeting. *A primary that names nothing falls back to the first written
 * one* (`writtenOf`): a hand-edited Setup whose primary was deleted still has
 * openings, and refusing to start it over a stale pointer would be
 * [00 §3.3]'s visible refusal spent on the wrong failure.
 */
export function chooseOpening(
  openings: Openings | undefined,
  choice: OpeningChoice,
): Opening | null | 'unknown' {
  const written = writtenOf(openings);
  if (choice === null) return null;
  if (choice !== undefined) return written.find((one) => one.id === choice) ?? 'unknown';
  return written[0] ?? null;
}

/**
 * ***Whether a Setup carries a written opening*** — the question 25 B18
 * turns on (rule 1 above), asked of what the Setup holds rather than of what
 * was chosen from it, because a person who starts a Setup cold has still
 * started a Setup that has one.
 */
export function carriesOpening(setup: Setup | undefined): boolean {
  return setup !== undefined && writtenOf(setup.openings).length > 0;
}

/**
 * ***The Setup's own turn*** — its opening, its seeding, or both; `null` when
 * there is nothing to write.
 *
 * **What 03 §6 has always said happens at session creation, and nothing did**:
 * *"the user picks one written opening, one seed to expand, or neither (start
 * cold)."* `Setup.openings` reached a session only inside the Setup's copy and
 * no reader on either side looked at it, so a Setup's opening was a field the
 * library kept and the game ignored. This is the written half. The seed half —
 * expand, edit, accept — stays where [P7B §1.11] put it, because it is a model
 * call and a review loop where this is a copy.
 *
 * ***An opening is a turn, and [P7.4] asked for one by name.*** Session creation
 * did not read `cast.partyDefault`, and the route said why: *"seeding it means
 * writing effects, which needs a turn."* An opening **is** that turn. So the
 * seeding writes ride on it — the party, and the hooks a Setup made from a turn
 * says had already fired — through `acceptEffect` and the ordinary log, which
 * is what makes them branch and undo like anything else. Rewind past the
 * opening and the party is a party of one again and the spent hooks are back in
 * the pool, which is exactly what a person rewinding past the start of a story
 * would expect.
 *
 * **`engine` proposes them**, which both channels' policies admit: `se.party`
 * is model-proposed and takes anyone, and `se.hook` is engine-computed and
 * refuses a model and a step but not the engine. The hand-edit reconciler's
 * divergence turn is the precedent — an engine-written turn carrying effects
 * and no call — and `divergenceTurn` is the shape this copies. *A Setup that
 * seeds state but had no opening chosen* — a hand-written one with a
 * `partyDefault`, or a person who pressed *start cold* — gets an effects-only
 * turn, which is the divergence turn's shape exactly: no input, no output.
 *
 * **The seeding writes, each for its stated reason:**
 *
 * - **`se.party: companion`** for each `partyDefault` member who is not the
 *   persona. The persona is in the party by `readParty`'s invariant and writing
 *   it would be a second answer to the same question. *Companion* rather than
 *   the control they had when the Setup was made, because a `Ref` carries none —
 *   and [06 §8]'s default for a member who is not the player's is companion.
 * - **`se.hook: fired`** for each `spentHooks` id **the pool holds**. An id that
 *   names nothing is skipped rather than written: an effect on a hook the pool
 *   does not contain would be an orphan row in every hook panel, and a Setup
 *   whose treatment was swapped should still start.
 *
 * Duplicates are written once, so a hand-edited list that names someone twice
 * does not produce a `before` that is its own `after`. ~~The turn also carried
 * `opening: { id }`~~ — dropped at the merge, 2026-10-03; see the module's
 * account above.
 */
function setupTurn(
  sessionId: string,
  from: NonNullable<FirstTurnsRequest['setup']>,
  createdAt: string,
): Turn | null {
  const id = uuidv7();
  const proposals: EffectProposal[] = [];

  const party = new Set<string>();
  for (const member of from.setup.cast.partyDefault) {
    if (member.id === '' || member.id === from.personaId || party.has(member.id)) continue;
    party.add(member.id);
    proposals.push(engineSet(SE_PARTY, member.id, 'companion'));
  }

  const pooled = new Set(from.pool.map((entry) => entry.hook.id));
  const spent = new Set<string>();
  for (const hookId of from.setup.spentHooks ?? []) {
    if (!pooled.has(hookId) || spent.has(hookId)) continue;
    spent.add(hookId);
    proposals.push(engineSet(SE_HOOK, hookId, 'fired'));
  }

  if (from.opening === null && proposals.length === 0) return null;

  // Distinct keys throughout, so each `before` is the channel's initial state
  // and there is no running map to chain — `acceptEffect` reads `null` for a
  // key nothing has written, which is what both channels' `init` is.
  const effects: ChannelEffect[] = proposals.map((proposal) => acceptEffect(id, proposal, {}));

  return {
    id,
    sessionId,
    parentTurnId: null,
    createdAt,
    status: 'complete',
    ...(from.opening === null ? {} : { output: { text: from.opening.text } }),
    effects,
    tape: [],
  };
}

function engineSet(channelId: string, scopeKey: string, after: string): EffectProposal {
  return {
    channelId,
    scopeKey,
    op: { type: 'set', path: '/' },
    after,
    proposedBy: { kind: 'engine' },
  };
}

/**
 * ***The cast's greeting turns, and which one the head goes to***, or null
 * when nobody in the cast has anything written — P14.4's writer, unchanged
 * but for where the turns hang.
 *
 * `members` is the cast **in cast order**, the persona excluded — the order a
 * group's messages go in. `choices` maps a member to the opening they start
 * on; absent is the primary. In a single-character session the choice picks
 * which sibling the head is on and every opening is still written, so the
 * others stay a swipe away.
 *
 * Every turn is `complete`, with no effects and an empty tape: nothing was
 * drawn and nothing about the story's state changed — a greeting is words,
 * and the channels the session starts with are its own. ~~Every turn is a
 * root (`parentTurnId: null`)~~ — *the parent is `parentTurnId`*, since the
 * merge (2026-10-03): `null`, a root, as P14.4 wrote them, or the Setup's
 * seeding turn when one was written (rule 3 above), so every alternate's path
 * passes through the seeding.
 */
function greetingTurns(
  sessionId: string,
  from: NonNullable<FirstTurnsRequest['greetings']>,
  parentTurnId: string | null,
  createdAt: string,
): { turns: Turn[]; head: string } | null {
  const { members, choices } = from;
  const user = from.user ?? 'the player';
  const speaking = members
    .map((actor) => ({ actor, openings: writtenOf(actor.openings) }))
    .filter((member) => member.openings.length > 0);
  const first = speaking[0];
  if (first === undefined) return null;

  const turnOf = (messages: OutputMessage[]): Turn => ({
    id: uuidv7(),
    sessionId,
    parentTurnId,
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

/** What a new session can start on, as the creation route has resolved it. */
export interface FirstTurnsRequest {
  sessionId: string;
  /**
   * The Setup it starts from, or `null` for none. `opening` is
   * {@link chooseOpening}'s answer, already checked — `null` is none, whether
   * start cold or nothing written; `pool` is the session's, so a spent id that
   * names nothing in it is not written; `personaId` is the persona, who is in
   * the party by the reader's invariant already.
   */
  setup: {
    setup: Setup;
    opening: Opening | null;
    pool: readonly PooledHook[];
    personaId: string | null;
  } | null;
  /**
   * The cast's greetings, or `null` for none — a mode that does not declare
   * `openingTurn`, or nobody cast. `members` in cast order with the persona
   * out of it, `user` the persona's name for `{{user}}`, `choices` the
   * creation body's `openings`.
   */
  greetings: {
    members: readonly Actor[];
    user: string | null;
    choices: Readonly<Record<string, string>>;
  } | null;
  createdAt?: string;
}

/**
 * ***The session's first turns, and which one the head goes to*** — or `null`
 * when there is nothing to write. The one account the module header gives,
 * as code: *pure*, so every rule is tested over values without a store
 * (`opening.test.ts`), and the route's only part is to write what this
 * returns.
 *
 * The turns come **parents first**, the order `writeOpening` appends them in:
 * the Setup's turn, then the greetings that hang from it.
 */
export function firstTurns(request: FirstTurnsRequest): { turns: Turn[]; head: string } | null {
  const createdAt = request.createdAt ?? new Date().toISOString();
  const from = request.setup;
  const setup = from === null ? null : setupTurn(request.sessionId, from, createdAt);

  // Rule 1, 25 B18: the Setup's opening wins, chosen or declined. An
  // opening being written counts as carrying one even if the caller's Setup
  // somehow lists none, so the two can never both be turn 1.
  const setupWins = from !== null && (from.opening !== null || carriesOpening(from.setup));
  const greetings =
    request.greetings === null || setupWins
      ? null
      : greetingTurns(request.sessionId, request.greetings, setup?.id ?? null, createdAt);

  if (greetings === null) return setup === null ? null : { turns: [setup], head: setup.id };
  return {
    turns: setup === null ? greetings.turns : [setup, ...greetings.turns],
    head: greetings.head,
  };
}

/**
 * ***Writes the first turns and puts the head on the chosen one***, under the
 * session's lock.
 *
 * *Every turn appended, then the head advanced once*, rather than one
 * `appendTurnLocked` per turn: an append advances the head to what it wrote,
 * and walking it through every alternate to land on the first would be three
 * session-file writes to say one thing. `lastSelectedChild` is keyed by a
 * parent and records a head *move*, so it has nothing to say here — the head
 * is the whole of *which one is selected*.
 *
 * **The head's state is folded from its parent's**, which `advanceHead` reads
 * by [P6.0b]'s walk when the parent is not where the snapshot is: for a
 * greeting on the Setup's seeding turn, the seeding is replayed under it and
 * the session's channels come out seated and spent; for a root, no effects
 * fold onto an empty map and the session's channels are unchanged.
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
