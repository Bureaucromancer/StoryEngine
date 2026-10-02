// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ParticipantPolicy } from '@storyengine/sdk';
import { outputMessagesOf, type Actor, type Turn } from '@storyengine/shared';

import { moveText, scanText } from '../assembly/pictures.js';
import { isTerminal, readPresence, readStatus } from '../sessions/cast.js';
import type { ChatSettings } from '../sessions/chat-settings.js';
import type { SiteRng } from '../rng/rng.js';

import type { CastMember } from './cast.js';

/**
 * Who talks this turn — [06 §7.2](../../../../docs/design/06-modes-and-turn-pipeline.md)'s
 * taxonomy, built at [P7.3](../../../../docs/design/workplan/23-p7-implementation.md)
 * and ***corrected to what its names mean at
 * [P14.1](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)***,
 * 2026-09-29.
 *
 * **The policy selects speakers**, which is 06 §7.2's own correction to the
 * source it borrows the taxonomy from: *"with the implementation being 'the
 * policy selects speakers', **not card-swapping**"*. SillyTavern's activation
 * strategies decide which character card is loaded; here every card the session
 * plays with is loaded for every turn, and this only decides who the turn is
 * *for*. That difference is why widening `select` is not a cast migration — the
 * roster is `cast.actors` and stays one ([P7 §1.6], corrected at P7.3).
 *
 * ***What P14.1 changed, and why it could change it freely.*** P7.3 took ST's
 * four names and wrote four different behaviours under them: `list` rotated
 * one speaker, `pooled` drew from everybody, `natural` scanned prose and could
 * answer nobody, and `manual` answered whoever the input named
 * ([P14 §0.7](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)
 * tabulates the four). Nothing played any of them — Freeform's one narrate step
 * ignores `speakers`, and under the old eligibility rule nobody was ever
 * eligible anyway — so correcting them changes nothing anybody has played. Each
 * arm below is now a transcription of `public/scripts/group-chats.js` at the
 * pinned commit, with the line it transcribes named beside it, and where it
 * departs from the source it says so and why.
 *
 * **The first real consumer of presence and status.** [P7.2] built both and
 * nothing outside the panel read them: eligibility is *here, and not written
 * out of the story*, so a character who left the room does not answer and a dead
 * one does not speak. That is also the honest reason the taxonomy could not have
 * been built before P7.2 — a selector over a cast with no notion of who is
 * present selects from a list of everyone the session has ever named.
 *
 * **It lives in `turns/` and takes the tape rather than an `Rng`.** The draw
 * belongs to the turn's tape, so a replay is the same scene; ~~taking the site
 * rather than the generator~~ taking a **site-bound opener** — the site fixed
 * by the runner, the purpose chosen per draw — keeps this a function of its
 * arguments, which is what lets every arm be tested against a table with the
 * rolls stubbed rather than against a turn. *Corrected at P14.1*: one site was
 * enough while `pooled` made the only draw, and it is not enough for `natural`,
 * whose rolls have to be keyed by the member they are for (see
 * {@link naturalOrder}).
 */

/**
 * ***ST's `talkativeness_default`*** (`public/script.js:548`), which is what a
 * member with no talkativeness of their own rolls against. Exported because
 * the importer that carries ST's per-card value across ([P14.9]) should agree
 * with this about what *unset* means.
 */
export const TALKATIVENESS_DEFAULT = 0.5;

/**
 * The draws an arm makes. **Two of `SiteRng`'s eight, named rather than the
 * class**, so a test can stand in a scripted pair without constructing a tape
 * — `SiteRng`'s fields are `#private`, and no structural double satisfies a
 * class that has them.
 *
 * Both record what the draw *meant* rather than where it landed: `float` is a
 * roll whose key names the member it is for, and `weightedPick` records the
 * winner's **id** — the reason `random.ts` gives for preferring it over `pick`
 * and `shuffle`, both of which record a position into a list that may have
 * changed by the time a rewrite replays it.
 */
export type SpeakerDraws = Pick<SiteRng, 'float' | 'weightedPick'>;

export interface SpeakerInputs {
  /**
   * ***The session's policy***, which is `chatSettingsOf(...).speakers.policy`
   * — [P14 §1.2](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
   *
   * ~~The mode's `ParticipantPolicy`~~ *until [P14.1]*: the mode's declared
   * `select` is now what a session is **created** with, and a session may say
   * otherwise. Only the arm travels, because the rest of the mode's policy —
   * `maxActors`, `castIsPresent` — is about the mode rather than the session.
   */
  policy: ParticipantPolicy['select'];
  /**
   * The mode's `participants.castIsPresent`: whether a cast member with no
   * presence value is in the scene, and presence `false` is *muted* rather than
   * *elsewhere* ([P14 §1.3]).
   */
  castIsPresent: boolean;
  /**
   * Whether the member who spoke last may be picked again on a turn nobody
   * started — ST's `allow_self_responses`, which `natural` alone reads
   * (`group-chats.js:1245-1251`).
   */
  allowSelfResponses: boolean;
  /** The resolved cast, in roster order — `resolveCast`'s output. */
  actors: readonly CastMember[];
  persona: string | null;
  channels: Readonly<Record<string, { value: unknown }>>;
  /**
   * ***Force-talk*** — a submission's `speakers`, [P14 §1.3], ST's member
   * *speak* button and `/trigger`, Marinara's `forCharacterId`.
   *
   * **Present overrides every policy**, `fixed` included (`group-chats.js:1006`
   * checks `force_chid` before it reads the strategy at all). Absent is every
   * ordinary turn.
   */
  forced?: readonly string[] | undefined;
  /**
   * ***Whether the player started this round*** — ST's `isUserInput`
   * (`group-chats.js:991-994`): an input that says something. A turn with no input,
   * or with an input that is empty, is *let them talk*.
   */
  hasInput: boolean;
  /**
   * ***What `natural` and `smart` scan for names*** — ST's `activationText`
   * (`group-chats.js:990-1000`): the input when there is one, else the last
   * message's text, else nothing. {@link activationText} builds it.
   */
  activation: string;
  /**
   * ***Who spoke the last message on the path*** — the author ST's `natural`
   * bans and `pooled` steps around. `null` when that message was the player's,
   * the narrator's, or when nothing has been said. {@link chatSoFar} finds it.
   */
  lastSpeaker: string | null;
  /**
   * ***Who has spoken since the player last did*** — `activatePooledOrder`'s
   * `spokenSinceUser` (`group-chats.js:1203-1216`). {@link chatSoFar} finds it.
   */
  spokenSinceInput: readonly string[];
  /**
   * Each member's talkativeness, by actor id, in `[0, 1]`. **A member missing
   * from the map rolls against {@link TALKATIVENESS_DEFAULT}**, which is ST's
   * `isNaN(character.talkativeness)` arm (`group-chats.js:1282-1284`).
   * {@link talkativenessOf} reads one off a card.
   */
  talkativeness: Readonly<Record<string, number>>;
  /**
   * ***The turn's tape, at this selector's own site*** — a purpose in, the draws
   * for it out.
   *
   * **Required, and that is the lesson of the arm it replaced.** It was optional
   * while `pooled` made the only draw, and a `pooled` handed no tape answered
   * nobody — which is an arm that silently does nothing, the failure
   * [P14 §1.3a] refuses by name. Every arm that chooses at random now has a tape
   * to choose on or does not compile.
   */
  draw: (purpose: string) => SpeakerDraws;
}

/**
 * What a selection answers: who speaks, in order — and, for `smart` alone,
 * whether a model still has to be asked.
 */
export interface SpeakerSelection {
  /**
   * Actor ids, in the order they speak. **Empty is a real answer** — `manual`
   * replying to an input, or a room nobody is eligible in.
   */
  speakers: string[];
  /**
   * ***`smart`, and only when no rule decided*** — [P14 §1.3a]'s fourth row.
   *
   * Present means *the engine step `se.speakers.smart` should ask a model to
   * choose among `eligible`*, and `speakers` beside it is then **the fallback**:
   * `natural`'s pick, drawn on the tape *before* any call, so a failed or
   * unusable answer lands somewhere deterministic and replayable. Absent means
   * the answer is final, which is every other arm and every turn a rule
   * settled.
   */
  ask?: { eligible: readonly string[] };
}

/**
 * ***Why a named speaker cannot be made to talk*** — force-talk's three
 * refusals, shared by the submission route (which says so with a 422) and the
 * runner (which drops the name).
 *
 * - `persona` — the player. They submitted the input; a turn voicing them is
 *   impersonation, which is its own gesture (`turns/impersonate.ts`).
 * - `not-in-cast` — nobody this session plays with.
 * - `written-out` — dead or departed. Force-talk reaches the **muted**, as ST's
 *   does, and never the dead ([P14 §1.3]).
 */
export type ForceRefusal = 'persona' | 'not-in-cast' | 'written-out';

/**
 * Whether `actorId` may be made to speak, or why not.
 *
 * **Presence is not consulted at all**, under either reading of it: a muted
 * member is exactly who force-talk exists to reach (`force_chid` bypasses
 * `disabled_members`, `group-chats.js:1006`), and under the old reading an
 * absent one is the same case with a different default. Status is consulted,
 * because a character the story wrote out is not one a button should be able
 * to bring back mid-scene — that is what correcting the status is for.
 */
export function forceRefusal(
  actorId: string,
  scene: {
    cast: ReadonlySet<string>;
    persona: string | null;
    channels: Readonly<Record<string, { value: unknown }>>;
  },
): ForceRefusal | null {
  if (actorId === scene.persona) return 'persona';
  if (!scene.cast.has(actorId)) return 'not-in-cast';
  if (isTerminal(readStatus(scene.channels, actorId))) return 'written-out';
  return null;
}

/**
 * Whether an actor is in the scene at this node, under the mode's reading of
 * presence.
 *
 * ***Two readings, and the mode picks*** — `ParticipantPolicy.castIsPresent`.
 * Without it, present is presence `true` and nothing else: absent is absent,
 * which is the channel's own `init: false` and what a story whose cast walks in
 * and out of rooms wants. With it, **only an explicit `false` is not present**,
 * and it means *muted* — so a cast nobody has said anything about is a cast
 * that is all here, which is what a group chat is.
 *
 * *Over the resolved cast, not only the declared roster*: §1.3 says *"a declared
 * cast member"*, and the resolved cast is the roster plus anyone the channels
 * name ([P7.3]'s union in `resolveCast`). An arrival is in it only because the
 * story wrote them a status or a party place, and reading them as absent until
 * somebody also wrote presence would make the prompt carry a card the selector
 * could never pick — the drift the union was built to close, reopened one
 * layer down.
 */
function isPresent(
  channels: Readonly<Record<string, { value: unknown }>>,
  actorId: string,
  castIsPresent: boolean,
): boolean {
  // The one reader since [P14.3], shared with the cast panel and the collector.
  return readPresence(channels, actorId, castIsPresent);
}

/**
 * The actors a policy may choose from: in the cast, in the scene, and not
 * written out of it — ST's `enabledMembers` (`group-chats.js:1003`), which is
 * the list every arm is handed.
 *
 * The persona is **not** here. They are the one participant whose turn it is by
 * construction — they submitted the input — and a policy that could decline to
 * let the player speak would be a policy that can refuse a turn.
 */
function eligible(inputs: SpeakerInputs): string[] {
  return inputs.actors
    .map((member) => member.actor.id)
    .filter(
      (id) =>
        id !== inputs.persona &&
        isPresent(inputs.channels, id, inputs.castIsPresent) &&
        !isTerminal(readStatus(inputs.channels, id)),
    );
}

/**
 * Who speaks this turn, in order — force-talk if a submission named anybody,
 * otherwise the session's policy over whoever is eligible.
 *
 * **Every random choice is drawn on `inputs.draw`**, and nothing else here is
 * random, so the same inputs and the same tape are the same answer: that is
 * what lets a rewrite keep its speakers, and what lets every arm below be held
 * to a table rather than to a distribution.
 */
export function selectSpeakers(inputs: SpeakerInputs): SpeakerSelection {
  /**
   * **Force-talk first, and it settles the turn** — `group-chats.js:1006`,
   * where `force_chid` is read before the strategy is. Filtered through
   * {@link forceRefusal} rather than trusted: the route refuses a bad name with
   * a 422 before a job exists, and this is the second check a recovered job or
   * a status written between the two would otherwise slip past. *Nobody left
   * after filtering is nobody*, rather than a fall back to the policy — a person
   * who asked for one character and got another would have been answered by
   * somebody they did not ask for.
   */
  if (inputs.forced !== undefined) {
    const cast = new Set(inputs.actors.map((member) => member.actor.id));
    const scene = { cast, persona: inputs.persona, channels: inputs.channels };
    return {
      speakers: unique(inputs.forced.filter((id) => forceRefusal(id, scene) === null)),
    };
  }

  const pool = eligible(inputs);

  switch (inputs.policy) {
    case 'fixed':
      /**
       * **Everyone eligible, which is what a mode that makes no selection
       * means.** Not an empty list: `fixed` declares that the cast cannot change
       * as an outcome of a turn, which is a statement about membership and not
       * about silence. A merged call names nobody regardless, so for every
       * shipped mode this is the same behaviour it had before the taxonomy
       * existed.
       */
      return { speakers: pool };

    case 'list':
      /**
       * ***Everybody eligible, once each, in cast order*** — `activateListOrder`
       * (`group-chats.js:1180-1188`), and Marinara's `sequential`.
       *
       * ~~Each in turn, rotating on the path's depth. One speaker, because a
       * list that answered with all of them in a rotated order would be `fixed`
       * with extra steps.~~ *Corrected 2026-09-29, at [P14.1]* — that was P7.3's
       * reading of the name and not ST's behaviour ([P14 §0.7]): ST's LIST is
       * the whole group answering in turn within one round, and no member is
       * banned, not even the one who just spoke.
       *
       * **The same set `fixed` answers, and the difference is not nothing.**
       * `fixed` is never handed to a step at all (`selectsSpeakers`), because it
       * is a mode saying *I make no selection*; `list` is a selection, handed on
       * in order, and under `per-actor` dispatch ([P14.2]) it is one call per
       * member with each seeing the replies before it. *The rotation's receipt
       * — "it jumps when the pool's size changes" — went with the rotation.*
       */
      return { speakers: pool };

    case 'manual':
      /**
       * ***Nobody replies to an input; one member replies to no input*** —
       * `group-chats.js:1029-1031`, and the empty `activatedMembers` of
       * `:1033-1041` that sends the player's message as it is.
       *
       * ~~Whoever the player named, and nobody otherwise.~~ *Corrected at
       * [P14.1]*: ST's MANUAL reads no name off the input — replies are asked
       * for by force-talk, which overrides this arm before it is reached. The
       * one random member on a turn with no input is ST's
       * (`shuffle(enabledMembers).slice(0, 1)`), and it is kept over Marinara's
       * *do nothing* because a *let them talk* that silently does nothing is the
       * failure [P14 §1.3a] refuses for `smart` too.
       */
      if (inputs.hasInput || pool.length === 0) return { speakers: [] };
      return { speakers: [uniformly(pool, inputs.draw('speaker'))] };

    case 'pooled':
      return { speakers: pooledOrder(inputs, pool) };

    case 'natural':
      return { speakers: naturalOrder(inputs, pool) };

    case 'smart':
      return smartOrder(inputs, pool);
  }
}

/**
 * ***One member, preferring whoever has not had a say*** — `activatePooledOrder`
 * (`group-chats.js:1197-1231`).
 *
 * ~~One at random, from all eligible.~~ *Corrected at [P14.1]*: ST's POOLED is
 * a queue without the bookkeeping. On a turn with no input it draws from those
 * who have not spoken since the player last did, so a round of *let them talk*
 * works through the room before anybody repeats; when everybody has, it draws
 * from anyone but the last speaker — unless they are the only one there
 * (`members.length > 1`, `:1224`).
 *
 * **After an input, anyone at all**, and that is ST's loop and not a
 * simplification of it: its scan back stops at once when the round has user
 * input (`if (message.is_user || isUserInput) break`, `:1204`), so the
 * *not spoken* list is everybody. Written out here as the same test rather than
 * as a special case, so the transcription can be read against the source.
 *
 * **Drawn by id, on the tape** — `weightedPick` at equal weights, the reason
 * `random.ts` gives at the call site of the hazard: a `pick` records a
 * *position*, so a replay against a pool of the same length hands back a
 * different actor, and a pool whose membership changes is the ordinary case
 * here. `weightedPick` records the winner and redraws when that winner is no
 * longer a candidate, which is the promise kept under replay rather than only
 * on a first run.
 */
function pooledOrder(inputs: SpeakerInputs, pool: readonly string[]): string[] {
  if (pool.length === 0) return [];
  const spoken = inputs.hasInput ? [] : inputs.spokenSinceInput;
  const haveNotSpoken = pool.filter((id) => !spoken.includes(id));
  if (haveNotSpoken.length > 0) return [uniformly(haveNotSpoken, inputs.draw('speaker'))];

  const last = pool.length > 1 ? inputs.lastSpeaker : null;
  const from = last === null ? pool : pool.filter((id) => id !== last);
  return [uniformly(from, inputs.draw('speaker'))];
}

/**
 * ***Whoever is named, then whoever feels like it, then somebody*** —
 * `activateNaturalOrder` (`group-chats.js:1242-1316`), NATURAL, and the arm
 * [P14 §1.3] makes a chat's default.
 *
 * *Scene declares it at [P14.3], and the design gives two dates: this follows
 * the stage list.* [P14 §1.2]'s P14.0 correction says Scene declares
 * `select: 'fixed'` *"until P14.1 changes it"*, and §1.3 has Scene declaring
 * `castIsPresent`; §3 puts Scene's declared values in P14.3 instead, where
 * `mode.test.ts`'s pin moves to `embodied`, `per-actor` and `natural`
 * together. So P14.1 builds the arms and the SDK's `castIsPresent`, and leaves
 * Scene at `{ select: 'fixed', maxActors: 1 }` with no `castIsPresent`. Neither
 * of Scene's steps reads `speakers` today — per-actor dispatch ([P14.2]) is
 * what will — so declaring `natural` sooner would only put draws on the tape
 * that decide nothing. The design note is not edited here: CLAUDE.md asks for
 * the disagreement to be named, not settled silently in either direction.
 * *Done at [P14.3], 2026-09-29*: Scene declares `natural`, `castIsPresent` and
 * 32 seats, with `per-actor` dispatch reading the selection.
 *
 * ~~Whoever the scene just addressed — the last prose and the input scanned
 * for names, and nobody found is nobody.~~ *Corrected 2026-09-29, at
 * [P14.1]*: that was the first of ST's three steps, standing alone. In order:
 *
 * 1. **Mentions.** Every eligible member one of whose name's words is a word of
 *    the activation text, in the order the **words** appear — for each word,
 *    the first member in cast order whose name has it (`:1253-1268`). So
 *    *"Lund, ask Vera"* is Lund then Vera, and a name mentioned twice is found
 *    twice and de-duplicated at the end.
 * 2. **Talkativeness.** Every member, in shuffled order, rolls; a roll at or
 *    under their talkativeness speaks (`talkativeness >= rollValue`,
 *    `:1270-1293`). *Every* member, the mentioned ones included, which is why
 *    step 4 exists — and the shuffle is what orders the talkative ones among
 *    themselves.
 * 3. **Somebody.** If still nobody, one member at random among those whose
 *    talkativeness is above zero (the ban excepted), or among everybody if
 *    nobody's is (`:1295-1307`). So `natural` answers nobody only when nobody
 *    is eligible — a silent card is quiet, not mute.
 * 4. De-duplicated, first appearance kept (`onlyUnique`, `:1309`).
 *
 * ***The ban, and only on a turn the player did not start*** — `:1245-1251`:
 * `bannedUser = !isUserInput && lastMessage && !lastMessage.is_user &&
 * lastMessage.name`, lifted by `allowSelfResponses`. A banned member is skipped
 * in steps 1 and 2 and in step 3's talkative pool — ST's `chattyMembers` is
 * filled inside the same loop, after the ban's `continue` (`:1277-1290`) — and
 * comes back only through step 3's last resort: when nobody else has any
 * talkativeness, that pool is `members`, the unfiltered list (`:1296`), not the
 * filtered one. So a room of one who just spoke still answers *let them talk*,
 * which is ST's behaviour and the right one.
 *
 * **Words are Unicode letters and digits, where ST's are ASCII — a deliberate
 * difference.** `extractAllWords` (`utils.js:1357`) matches `\b\w+\b` without
 * the `u` flag, so a word ends at its first letter outside ASCII. *Measured
 * against the source, that is not quite [P14 §1.3]'s "a name like Zoë never
 * matches"*: *Zoë* is the word *zo*, so she **is** found by *Zoë* — and also by
 * *Zo* and by *Zoé*; *Renée* is *ren* and a lone *e*, found by any sentence
 * with a stray *e* in it; and a name in Cyrillic, Greek or CJK has no words at
 * all and is never found. Wrong in both directions, and nobody's behaviour to
 * keep, so {@link wordsOf} matches `\p{L}`, `\p{M}` and `\p{N}` (and `_`, which
 * `\w` has), after NFC normalisation so a composed and a decomposed *ë* are the
 * same letter.
 *
 * **Every draw is on the tape and keyed by what it is for**, so a rewrite picks
 * the same speakers:
 * - the shuffle is a run of `weightedPick`s without replacement at `order`,
 *   each recording the member it placed — `SiteRng.shuffle` records a
 *   permutation of positions, the hazard its own docstring leaves open for the
 *   first production caller to pay for, and this is that caller declining to;
 * - each roll is a `float` at `talkativeness:<actor id>`, so a member's roll is
 *   their own under replay even when somebody else has left the room — a
 *   positional run of rolls would hand Vera's to Lund;
 * - the fallback is a `weightedPick` at `speaker`, as `pooled`'s is.
 *
 * *The shuffle places only the members who roll.* ST shuffles the banned member
 * too and then skips them; a uniform shuffle of everybody restricted to the rest
 * is a uniform shuffle of the rest, so the order is distributed identically and
 * the tape does not carry a draw that decided nothing.
 */
function naturalOrder(inputs: SpeakerInputs, pool: readonly string[]): string[] {
  if (pool.length === 0) return [];
  const banned = bannedSpeaker(inputs);

  const activated = mentioned(inputs, pool, banned);

  const rolling = pool.filter((id) => id !== banned);
  for (const id of shuffled(rolling, inputs.draw('order'))) {
    const roll = inputs.draw(`talkativeness:${id}`).float();
    if (talkativenessIn(inputs, id) >= roll) activated.push(id);
  }

  if (activated.length === 0) {
    const chatty = rolling.filter((id) => talkativenessIn(inputs, id) > 0);
    activated.push(uniformly(chatty.length > 0 ? chatty : pool, inputs.draw('speaker')));
  }

  return unique(activated);
}

/**
 * ***Rules first, and most turns never make the call*** —
 * [P14 §1.3a](../../../../docs/design/workplan/31-p14-scene-and-session-import.md)'s
 * first table, which is the whole of what `smart` decides without a model.
 *
 * | Situation | Answer |
 * |---|---|
 * | force-talk named somebody | them — {@link selectSpeakers} answered before reaching here |
 * | the activation text names eligible members | them, in order of mention |
 * | one eligible member | them |
 * | otherwise | ask, with `natural`'s pick as the fallback |
 *
 * **Mentions are `natural`'s first step exactly**, ban included: *"mentions
 * winning outright is Marinara's rule and ST's first step"*, and a second
 * scanner that disagreed with the first about what a name is would be two
 * answers to one question.
 *
 * ***The fallback is drawn now, before any call***, which is rule 4 of §1.3a:
 * a timeout, an unbound role or an unusable answer lands on a pick the tape
 * already holds, so the fallback is as replayable as any other arm. The step
 * that asks is `se.speakers.smart` (`turns/smart-speakers.ts`), which the
 * runner plans exactly when `ask` is present; ~~until it lands the runner plays
 * the fallback~~ *it landed with the rest of [P14.1]*, and the fallback is now
 * what plays only when the call does not work out.
 *
 * *Force-talk and rewrite are both upstream of this.* Force-talk never reaches
 * the arm ({@link selectSpeakers} answers it first), and a rewrite reaches it
 * and still asks — the step, handed the redone turn's speakers, writes them
 * without a call. Keeping that decision in the step rather than here is what
 * puts a rewritten smart pick on the record as one.
 */
function smartOrder(inputs: SpeakerInputs, pool: readonly string[]): SpeakerSelection {
  if (pool.length === 0) return { speakers: [] };

  const named = unique(mentioned(inputs, pool, bannedSpeaker(inputs)));
  if (named.length > 0) return { speakers: named };
  if (pool.length === 1) return { speakers: [...pool] };

  return { speakers: naturalOrder(inputs, pool), ask: { eligible: [...pool] } };
}

/**
 * Who `natural` and `smart` skip this turn: the last speaker, **only on a turn
 * the player did not start** and only unless self-responses are allowed
 * (`group-chats.js:1245-1251`).
 *
 * *Why not after an input too:* the player speaking is itself the break in the
 * run. A character who spoke, then was answered by the player, is being
 * replied to — and a ban there would stop the person the player just addressed
 * from answering them.
 */
function bannedSpeaker(inputs: SpeakerInputs): string | null {
  if (inputs.hasInput || inputs.allowSelfResponses) return null;
  return inputs.lastSpeaker;
}

/**
 * `natural`'s step 1 — for each word of the activation text, in order, the
 * first member in cast order one of whose name's words it is
 * (`group-chats.js:1253-1268`). **One member per word**, which is ST's `break`:
 * a word two names share goes to whichever comes first in the cast.
 */
function mentioned(
  inputs: SpeakerInputs,
  pool: readonly string[],
  banned: string | null,
): string[] {
  const names = new Map(inputs.actors.map((member) => [member.actor.id, member.actor.name]));
  const nameWords = new Map(pool.map((id) => [id, wordsOf(names.get(id) ?? '')]));

  const found: string[] = [];
  for (const word of wordsOf(inputs.activation)) {
    const who = pool.find((id) => id !== banned && (nameWords.get(id)?.includes(word) ?? false));
    if (who !== undefined) found.push(who);
  }
  return found;
}

/**
 * The words of a string, lowercased — `extractAllWords` (`utils.js:1357`) with
 * Unicode letters where it has ASCII ones. See {@link naturalOrder} for why the
 * difference is deliberate.
 */
export function wordsOf(value: string): string[] {
  return [...value.normalize('NFC').matchAll(/[\p{L}\p{M}\p{N}_]+/gu)].map((match) =>
    match[0].toLowerCase(),
  );
}

/**
 * A member's talkativeness as `natural` rolls against it, from the map the
 * runner built — {@link TALKATIVENESS_DEFAULT} for anybody not in it.
 */
function talkativenessIn(inputs: SpeakerInputs, actorId: string): number {
  return inputs.talkativeness[actorId] ?? TALKATIVENESS_DEFAULT;
}

/**
 * ***An actor's talkativeness in a mode*** — `actor.modeData[modeId].talkativeness`,
 * [P14 §1.3](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 *
 * **In `modeData` because it is participation, not prompt.** The card schema
 * refuses `talkativeness` as a top-level field under *"prompt assembly is owned
 * by the preset"* — which is about the other kind of field. How often a
 * character joins in is a fact about how a *mode* plays them, and `modeData`
 * is where a mode keeps such facts about a card.
 *
 * ***Keyed by the session's mode id, which is passed in and never written
 * here*** — `tools/repo-shape.test.ts` forbids engine code naming a mode, and
 * the reason is sound rather than bureaucratic: the engine reading
 * `'storyengine.scene'` would be Scene's behaviour living in the engine, where
 * an extension mode could never have the same.
 *
 * **Tolerant, and never throwing**: a value that is not a finite number is the
 * default, and one outside `[0, 1]` is clamped to it. Clamping is ST's
 * behaviour in effect — a talkativeness of 1.5 is `>=` every roll there, as 1
 * is here — without carrying a number the slider could never have produced.
 */
export function talkativenessOf(actor: Actor, modeId: string): number {
  const own: unknown = actor.modeData[modeId];
  const value =
    typeof own === 'object' && own !== null && !Array.isArray(own)
      ? (own as Record<string, unknown>)['talkativeness']
      : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return TALKATIVENESS_DEFAULT;
  return Math.min(1, Math.max(0, value));
}

/**
 * One of `ids`, uniformly, on the tape by id. `weightedPick` at equal weights
 * rather than `pick`, for the position hazard {@link pooledOrder} describes.
 */
function uniformly(ids: readonly string[], draws: SpeakerDraws): string {
  return draws.weightedPick(ids.map((id) => ({ id, value: id, weight: 1 })));
}

/**
 * `ids` in a random order, placed one at a time by id — see
 * {@link naturalOrder} for why not `SiteRng.shuffle`. The last one left is
 * placed without a draw, because a choice of one decides nothing.
 */
function shuffled(ids: readonly string[], draws: SpeakerDraws): string[] {
  const left = [...ids];
  const order: string[] = [];
  while (left.length > 1) {
    const next = uniformly(left, draws);
    order.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return [...order, ...left];
}

/** First appearance kept — ST's `onlyUnique`. */
function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Whether a policy makes a selection at all.
 *
 * `fixed` does not, and the distinction reaches a step as *absent* rather than
 * as a list: a mode that declares no strategy should not hand its steps a
 * speaker set that looks like one it chose. *The session's policy since
 * [P14.1]*, so it takes the arm rather than the mode's whole policy.
 */
export function selectsSpeakers(policy: ParticipantPolicy['select']): boolean {
  return policy !== 'fixed';
}

/**
 * Whether a move says anything — ST's `userInput?.length` (`group-chats.js:993`),
 * with a picture counting as saying something.
 *
 * *An empty input is no input*, which is ST's reading and the one [P14 §1.6]
 * builds *let them talk* on: an empty send is a round the player did not
 * start, and the arms treat it that way.
 */
export function saysSomething(
  input: Parameters<typeof moveText>[0] | undefined,
): input is NonNullable<Parameters<typeof moveText>[0]> {
  return input !== undefined && moveText(input) !== '';
}

/**
 * ***The chat as the arms read it*** — the two facts about the path
 * `group-chats.js` reads off `chat` before it activates anybody.
 */
export interface ChatSoFar {
  /**
   * ***ST's `lastMessage`*** — `chat[chat.length - 1]`, **hidden or not**: ST
   * reads the author of a hidden last message for the ban and for `pooled`'s
   * fallback, and only its *text* is withheld (`:997`'s `!lastMessage.is_system`).
   * Null before anything has been said.
   */
  last: { speaker: string | null; byPlayer: boolean; text: string; hidden: boolean } | null;
  /** `pooled`'s `spokenSinceUser`, most recent first. */
  spokenSinceInput: string[];
}

/**
 * The path read as a chat: a turn is its input, if it said anything, then its
 * output's messages ([P14 §1.1]), and the last of those on the path is ST's
 * last message.
 *
 * - **Messages come from `outputMessagesOf`**, so a turn written before
 *   [P14.0] is one narrator message — and the narrator is nobody: a legacy
 *   output has no speaker to ban and none to count as having spoken.
 * - **A message with no text is not a message.** A failed turn with an empty
 *   output, or a hand edit that wrote nothing, is bookkeeping rather than
 *   something said — the rule `lastProse` kept before this replaced it, and
 *   the reason the last *turn* and the last *message* differ.
 * - **Hidden follows ST in each place ST reads it** (`session.hidden`,
 *   [P14 §1.6]): a hidden message is still the last message, its author is
 *   still who spoke last, its text is not the activation text, it does not
 *   count as having spoken (`:1208`'s `is_system` skip), and a hidden input
 *   still ends `pooled`'s scan back (`:1204` breaks on `is_user` before it
 *   looks at `is_system`).
 */
export function chatSoFar(history: readonly Turn[], hidden: ChatSettings['hidden']): ChatSoFar {
  let last: ChatSoFar['last'] = null;
  const spokenSinceInput: string[] = [];
  let scanning = true;

  for (let at = history.length - 1; at >= 0 && (scanning || last === null); at -= 1) {
    const turn = history[at];
    if (turn === undefined) continue;
    const held = hidden[turn.id];
    const whole = held === true;
    const indices: readonly number[] = held === undefined || held === true ? [] : held;

    const messages = [...outputMessagesOf(turn.output).entries()].reverse();
    for (const [index, message] of messages) {
      if (message.text === '') continue;
      const isHidden = whole || indices.includes(index);
      const speaker = message.speaker?.id ?? null;
      last ??= { speaker, byPlayer: false, text: message.text, hidden: isHidden };
      if (scanning && !isHidden && speaker !== null) spokenSinceInput.push(speaker);
    }

    if (saysSomething(turn.input)) {
      last ??= { speaker: null, byPlayer: true, text: scanText(turn.input), hidden: whole };
      scanning = false;
    }
  }

  return { last, spokenSinceInput };
}

/**
 * ***What `natural` and `smart` scan for names*** — `group-chats.js:990-1000`.
 *
 * The input when it says something; otherwise the last message's text, unless
 * that message is hidden — **in which case nothing**, not the message before
 * it. That is ST's `if (lastMessage && !lastMessage.is_system)`, which looks at
 * one message and does not walk back; a hidden line is withheld from the
 * characters, and reaching past it to the one before would activate somebody on
 * words that are no longer the last thing said.
 *
 * *Captions count*, as they do for the retriever: naming somebody under a
 * picture addresses them.
 */
export function activationText(
  input: Parameters<typeof scanText>[0] | undefined,
  soFar: ChatSoFar,
): string {
  if (saysSomething(input)) return scanText(input);
  return soFar.last !== null && !soFar.last.hidden ? soFar.last.text : '';
}

/**
 * The member who spoke the last message, for the ban and for `pooled` — null
 * when it was the player's (`!lastMessage.is_user`), the narrator's, or when
 * nothing has been said.
 */
export function lastSpeakerOf(soFar: ChatSoFar): string | null {
  return soFar.last === null || soFar.last.byPlayer ? null : soFar.last.speaker;
}

/**
 * ***Each member's talkativeness, by id, as this mode reads it*** — [P14.3],
 * lifted out of the runner so the preview reads the same numbers.
 *
 * *Read through the mode's id*, never a literal: talkativeness is how a mode
 * plays a card, and the engine naming one mode's key would be that mode's
 * behaviour living where no other mode could have it (`tools/repo-shape.test.ts`).
 */
export function talkativenessMap(
  actors: readonly CastMember[],
  modeId: string,
): Record<string, number> {
  return Object.fromEntries(
    actors.map((member) => [member.actor.id, talkativenessOf(member.actor, modeId)]),
  );
}

/**
 * ***Who speaks this turn, or no selection at all*** — the runner's question,
 * asked in one place since [P14.3] so that the preview (`turns/preview.ts`)
 * asks it the same way ([P14 §1.4]: a preview under `per-actor` shows what the
 * first speaker's call would see, and it cannot unless it knows who that is).
 *
 * **`undefined` is no selection, and there are now two ways to have none.**
 *
 * - *The session's policy selects nobody by construction* — `fixed`, which is
 *   what a pre-P14 Scene session reads as — and nobody forced anybody.
 * - ***The room has nobody in it to select***: no cast member but the
 *   persona, and nobody forced. Added at [P14.3] with Scene's flip to an
 *   embodied chat, because an empty `speakers` in an embodied voice is
 *   *nobody replies* — right for `manual` after an input, and for a room whose
 *   every member is muted, which is ST's behaviour — and wrong for a scene
 *   nobody has cast yet, which before the flip was narrated and after it would
 *   have answered every input with silence. With no selection the step makes
 *   the one merged call nobody in particular speaks (`modes/scene/src/mode.ts`),
 *   and the pack reads that call as the narrator's (`CollectContext.voice`).
 *   So a scene with no characters is narrated, as it always was.
 *
 * `castIsPresent` stays the mode's, because it is a statement about how the mode
 * reads presence rather than a choice a chat makes.
 */
export function turnSelection(args: {
  policy: ChatSettings['speakers'];
  castIsPresent: boolean;
  cast: { persona: CastMember | null; actors: readonly CastMember[] };
  channels: Readonly<Record<string, { value: unknown }>>;
  history: readonly Turn[];
  hidden: ChatSettings['hidden'];
  input: (Parameters<typeof moveText>[0] & Parameters<typeof scanText>[0]) | undefined;
  forced: readonly string[] | undefined;
  talkativeness: Readonly<Record<string, number>>;
  draw: (purpose: string) => SpeakerDraws;
}): SpeakerSelection | undefined {
  const persona = args.cast.persona?.actor.id ?? null;
  const room = args.cast.actors.some((member) => member.actor.id !== persona);
  if (args.forced === undefined && !(selectsSpeakers(args.policy.policy) && room)) {
    return undefined;
  }
  const soFar = chatSoFar(args.history, args.hidden);
  return selectSpeakers({
    policy: args.policy.policy,
    castIsPresent: args.castIsPresent,
    allowSelfResponses: args.policy.allowSelfResponses,
    actors: args.cast.actors,
    persona,
    channels: args.channels,
    forced: args.forced,
    hasInput: saysSomething(args.input),
    activation: activationText(args.input, soFar),
    lastSpeaker: lastSpeakerOf(soFar),
    spokenSinceInput: soFar.spokenSinceInput,
    talkativeness: args.talkativeness,
    draw: args.draw,
  });
}
