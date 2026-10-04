// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ChannelDefinition } from '@storyengine/sdk';

import { channelKey, keyBelongsTo, splitChannelKey } from './channels.js';
import type { Turn } from './types.js';

/**
 * Who is here, who is still alive, and who the story has met —
 * [06 §8.1](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §13.2](../../../../docs/design/10-ui-surfaces.md), built at
 * [P7.2](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Two axes rather than one enum, and the split is the correction.** Aventuras'
 * *active / inactive / dead* squashes together two things that behave
 * differently: presence is volatile and historically uninteresting, status is
 * durable and every change is significant. One enum cannot say *dead but
 * present* — the body in the room, the ghost, the open casket — nor *alive,
 * elsewhere, coming back*, which 10 §13.2 calls **the ordinary state of most of
 * the cast most of the time**. The UI derives one badge from both; the split
 * lives here.
 *
 * **Channels rather than fields, which is what makes them behave under
 * branching.** The effects are per-node, so a character dead on one line and
 * alive on another is a consequence rather than a special case
 * ([07 §4](../../../../docs/design/07-branching.md)). It also makes every change
 * an effect in the turn record, invertible at the tip, and the panel
 * reconstructible at any node — three properties bought with no new machinery.
 *
 * **Package-owned, like `se.lore.timing`.** Every mode with a cast wants these
 * and none of them is Scene's in particular; [06 §4.1] admits a package id as an
 * `owner` for exactly this. *`storyengine.cast` rather than `storyengine.party`,
 * because the party is a subset of the cast and naming the owner after the
 * subset would be the conflation §8.1 spends a paragraph refusing.*
 *
 * ~~**And `se.party` is not here**, deliberately.~~ **It is here since
 * [P7.3]**, 2026-09-12, because the licence expired in the same commit.
 * [P7 §1.6](../../../../docs/design/workplan/23-p7-implementation.md) recorded
 * that `ParticipantPolicy.select: 'fixed'` is *"the declaration that the cast
 * cannot change as an outcome of a turn, which is what licenses a plain `cast`
 * field on the session instead of an `se.party` channel"* — so a party channel
 * declared while the policy still said the cast cannot change would have been
 * the placeholder-shaped channel [P2 §2.7] rejected by name. `select` now has
 * five arms, and `cast.test.ts`' tripwire is what made the two land together
 * rather than one of them landing and the other being remembered.
 *
 * **Presence and status carried no such licence** and never waited: they are
 * facts about a scene and about a life, and neither is a claim about whether
 * the cast can change.
 */

export const CAST_OWNER = 'storyengine.cast';

export const SE_PRESENCE = 'se.presence';
export const SE_STATUS = 'se.status';
export const SE_PARTY = 'se.party';

/**
 * Durable state about a life — [10 §13.2]'s *"alive, dead, departed,
 * imprisoned"*.
 *
 * **Three of that list, and the fourth is an example rather than a member.**
 * `imprisoned` appears once, in prose, as an illustration of *durable*; shipping
 * it with no consumer is the placeholder pattern this phase keeps refusing. The
 * three here are the ones the design leans on: `alive` and `dead` carry §8.1's
 * asymmetry, and `departed` is the *gone* that [04 §6.1]'s hook filter has been
 * spending since it was written.
 *
 * **The union widens additively**, which is what a string enum in a channel
 * schema buys: a mode shipping a fourth status writes it, the schema rejects it
 * until the declaration says otherwise, and no stored session migrates.
 */
export const STATUSES = ['alive', 'dead', 'departed'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * The statuses a story does not come back from.
 *
 * **Terminal is the engine's reading of a value, not a field on it**, because
 * the hook filter's clause is *"must carry no terminal status"* ([06 §6.1]) and
 * that is a question the engine asks rather than one a mode answers. A mode
 * adding a status says whether it is terminal by whether the engine's list names
 * it — which is a limitation worth writing down: the day a mode ships a terminal
 * status of its own, this becomes a declaration.
 */
export const TERMINAL_STATUSES: readonly string[] = ['dead', 'departed'];

export const PRESENCE_CHANNEL: ChannelDefinition = {
  id: SE_PRESENCE,
  owner: CAST_OWNER,
  version: 1,
  // Per actor: presence is a fact about one person in one scene, and a
  // session-scoped value would make it a list the engine had to diff.
  scope: 'actor',
  // §8.1's table. The model narrates who walks in, and the engine records it.
  update: 'model-proposed',
  visibility: 'player',
  schema: { type: 'boolean' },
  /**
   * **Absent is not present**, and the default matters more than it looks: a
   * cast member nobody has mentioned is not in the scene, and an init of `true`
   * would put the whole cast in every room until something said otherwise.
   *
   * ***Under a mode's `castIsPresent` this literal is not the default*** —
   * [P14.3]. There absent reads as present and `false` as *muted*
   * ({@link readPresence}), so the one place that writes `init` as a value —
   * the quarantine, which resets a malformed value to it
   * (`quarantineEffects`) — would have muted a member where it meant to put
   * them back to nobody-said-anything. `readPresence` reads a quarantined
   * value as absent instead (2026-09-29, the [P14.3] review); the literal
   * stays `false` because the channel is the engine's, and the other reading
   * is still the one every mode without `castIsPresent` has.
   */
  init: { kind: 'literal', value: false },
  /**
   * No `render` and no `budget`, so nothing injects this into a prompt —
   * deliberately. Presence is already implicit in what the assembler includes,
   * and a line saying *Vera: present* beside prose that has her speaking is
   * tokens spent to repeat the obvious. The panel is the surface.
   */
  budget: null,
};

export const STATUS_CHANNEL: ChannelDefinition = {
  id: SE_STATUS,
  owner: CAST_OWNER,
  version: 1,
  scope: 'actor',
  update: 'model-proposed',
  visibility: 'player',
  schema: { type: 'string', enum: [...STATUSES] },
  init: { kind: 'literal', value: 'alive' },
  /**
   * **The asymmetry, declared** — [06 §8.1], [10 §13.2], [25 C12].
   *
   * *"Models kill characters casually and in passing. A missed death is an
   * annoyance corrected in one click; a false one silently removes someone from
   * the story, and every subsequent turn is then assembled around their
   * absence."* So a model proposing a terminal status is refused and recorded,
   * and a person applies it — which is 25 C12's *under-firing plus
   * always-available manual completion*, exactly.
   *
   * *Both terminal values, not just `dead`.* A character wrongly written out as
   * `departed` is assembled around identically to one wrongly killed, and the
   * click that corrects it is the same click.
   */
  confirm: TERMINAL_STATUSES,
  budget: null,
};

/**
 * Who authors a party member's words — [06 §8]'s `control`.
 *
 * **Three arms, and the middle one is the design's line rather than a setting.**
 * A `companion` is narrated by the narrator, with the player able to address,
 * direct and influence but **not author** — 06 §8 calls that *"the 'we are not
 * building a D&D engine' line, and the difference between a party member and a
 * second player"*. `auto` is the same structure with a different lifetime: the
 * guide who walks you to the next town. `player` is yours to write.
 *
 * *`player` may apply to more than one member*, which 06 §8 resolves explicitly:
 * one human authoring two characters is allowed, and it is the seam where
 * genuine multiplayer would eventually attach.
 */
export const CONTROLS = ['player', 'companion', 'auto'] as const;
export type Control = (typeof CONTROLS)[number];

/**
 * Who is travelling with you — [06 §8], built at [P7.3].
 *
 * **The party is a subset of the cast and not a rival to it.** Presence says who
 * is in the room; the roster (`cast.actors`) says which cards this session
 * plays with; this says who is *with you*, which is a third question and the one
 * [10 §13.2] wants marked on the panel *"without introducing a parallel
 * membership concept"* — satisfied by marking a subset rather than listing one.
 *
 * **A timeline, not a set**, which is 06 §8's fifth design rule and which a
 * channel gives for nothing: *"who was with me in chapter two"* is a walk up the
 * path, and *"joined at turn 40"* — the ordinal the design found and rejected,
 * because a turn's position is a fact about a path and differs per branch — is
 * not expressible here at all. An effect carries a `turnId`, which is 07 §3's
 * rule enforced by the shape rather than remembered.
 *
 * **`model-proposed`, like presence, and with no `confirm`.** Somebody joining
 * or leaving the party is a thing the story narrates. It carries none of
 * `se.status`' asymmetry: a character wrongly written out of the party is
 * corrected in a click and the story is unchanged, where a wrongly-killed one
 * has every subsequent turn assembled around their absence.
 */
export const PARTY_CHANNEL: ChannelDefinition = {
  id: SE_PARTY,
  owner: CAST_OWNER,
  scope: 'actor',
  version: 1,
  update: 'model-proposed',
  visibility: 'player',
  /**
   * **A `control`, or absent.** Not a boolean plus a second channel for who
   * authors: 06 §8's second rule is *"default is one member, `control:
   * 'player'`"*, so membership and authorship arrive together and a member with
   * no control would be a state the design does not describe.
   *
   * ***`null` is in the enum, and leaving it out meant nobody could ever leave
   * the party*** — found at [P7.5] by `channels.test.ts`'s new invariant, which
   * holds every registered channel to being able to be written the value its own
   * `init` declares. This one said *absent is not in the party* in the docstring
   * below and then refused a proposal of `null` against this schema, so removing
   * a companion was a write `acceptEffect` would have recorded as a **refusal**.
   * It was invisible because nothing has removed anybody yet: [P7.3] built the
   * reader and the declaration, and the control that writes it is [P7.9]'s.
   */
  schema: { type: ['string', 'null'], enum: [...CONTROLS, null] },
  /**
   * **Absent is not in the party**, and the read-time invariant below is what
   * makes that compatible with 06 §8's first rule — *"the party always exists
   * and always contains the persona"*. An `init` of `player` would put the whole
   * cast in the party the moment anything asked, which is the same mistake
   * `se.presence` declines for the same reason.
   */
  init: { kind: 'literal', value: null },
  /**
   * No `render` and no `budget`, like presence and status. Who is travelling
   * with you is already in the prose that put them there, and a line saying
   * *Vera: companion* beside it is tokens spent on the obvious. The panel is the
   * surface.
   */
  budget: null,
};

/**
 * **Introduced: this actor has been the subject of a presence or party effect at
 * some point on the path to this node** — [06 §8.1]'s definition, verbatim, and
 * this is its first implementation.
 *
 * **Two documents have spent the word as a mechanical predicate since they were
 * written** — [06 §6.1]'s hook filter wants *cast alive and introduced* and
 * [04 §6.1]'s introduction hook wants *dead, gone, or never introduced* — and no
 * section defined it until §8.1 did. Neither channel means it: `se.presence` is
 * *in this scene right now*, so a character introduced in chapter one and absent
 * since reads `false` and is emphatically not *never introduced*.
 *
 * **Derived rather than stored, and the three reasons are 8.1's.** It needs no
 * third channel; it is monotone along a path, so it can only be acquired and
 * never lost; and it branches correctly for free — rewind past a character's
 * arrival and they are un-introduced again, which is what anyone would expect
 * and would otherwise have had to be built.
 *
 * ~~*Party effects count and there are none yet*, because `se.party` waits on
 * P7.3's policy~~ — **it exists since [P7.3]** (see this module's header), and
 * nothing here changed to admit it. *The predicate named both from the first
 * line written so that adding the channel would add no case, and the test that
 * covered a party effect was written against an id nothing declared; both stayed
 * exactly as they were. That is the payoff for matching by channel id rather
 * than by a list of two.*
 */
export function introducedOn(path: readonly Turn[]): Set<string> {
  const introduced = new Set<string>();

  for (const turn of path) {
    for (const effect of turn.effects) {
      // **Applied only.** A refused presence proposal is a model's claim the
      // engine declined, and a character is not introduced by something that did
      // not happen. `escaped` effects are skipped for the reason [07 §7] gives:
      // they are never replayed, so they cannot be part of a derived fact.
      if (!effect.applied || effect.scope === 'escaped') continue;
      if (
        !INTRODUCING.some((id) => keyBelongsTo(channelKey(effect.channelId, effect.scopeKey), id))
      )
        continue;
      if (effect.scopeKey !== null) introduced.add(effect.scopeKey);
    }
  }

  return introduced;
}

/**
 * The channels whose effects introduce somebody.
 *
 * ~~`se.party` is named here before it exists~~ — **and it exists now** ([P7.3]),
 * so the literal became the constant. *Naming it early was the one place in this
 * module worth doing so: the predicate's definition says **presence or party**,
 * and a list that omitted the second would have been a definition quietly
 * narrowed to what happened to be built. The test that covered it was written
 * against an id nothing declared and did not have to change.*
 */
const INTRODUCING: readonly string[] = [SE_PRESENCE, SE_PARTY];

/** Whether a status is one a story does not come back from — [06 §6.1]. */
export function isTerminal(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_STATUSES.includes(status);
}

/**
 * One actor's status at a node, from the channel map.
 *
 * The read-time default is the declaration's, the same way `readClock` reads the
 * clock's: an actor nothing has said anything about is alive, and a reader that
 * returned `null` would make *not yet mentioned* and *status unknown* the same
 * answer.
 */
export function readStatus(
  channels: Readonly<Record<string, { value: unknown }>>,
  actorId: string,
): string {
  const held = channels[channelKey(SE_STATUS, actorId)]?.value;
  return typeof held === 'string' ? held : 'alive';
}

/**
 * Whether an actor is in the scene at a node. ~~Absent is absent.~~
 *
 * ***Under the mode's reading of presence since [P14.3]*** —
 * `ParticipantPolicy.castIsPresent`, [P14 §1.3](../../../../docs/design/workplan/31-p14-scene-and-session-import.md).
 * Without it, absent is absent: the channel's own `init: false`, and what a
 * story whose cast walks in and out of rooms wants. With it, **only an explicit
 * `false` is not present**, and it means *muted* — a cast nobody has said
 * anything about is a cast that is all here, which is what a group chat is.
 *
 * *One reader for the three places that ask* — the speaker policy, the
 * collector's cards and the cast panel. [P14.1] flagged that the panel read
 * presence as `true`-only while the selector read it through the mode, so a
 * Scene member nobody had muted spoke every turn and showed on the panel as
 * absent. The default stays the old reading, so a caller that says nothing
 * about the mode reads what it always read.
 */
export function readPresence(
  channels: Readonly<Record<string, { value: unknown; degraded?: unknown }>>,
  actorId: string,
  castIsPresent = false,
): boolean {
  const state = channels[channelKey(SE_PRESENCE, actorId)];
  /**
   * ***A quarantined value is absent, under `castIsPresent`*** (2026-09-29,
   * the [P14.3] review). The quarantine resets a malformed value to the
   * channel's `init: false` and marks the state `degraded`; read as written,
   * that ~~is the default~~ is **muted** under this reading, so a member whose
   * presence a hand edit had mangled left every call and the round — a
   * decision nobody made. The marker is how to tell the engine's reset from a
   * person's mute: the next write of the channel clears it (`store.ts`), so a
   * member muted afterwards reads as muted. Without `castIsPresent` the reset
   * already is the default, and nothing changes.
   */
  if (castIsPresent && state?.degraded !== undefined) return true;
  const held = state?.value;
  return castIsPresent ? held !== false : held === true;
}

/**
 * Who authors this actor, if they are in the party at all — [06 §8], [P7.3].
 *
 * **The persona's membership is the reader's invariant, not the log's.** 06 §8's
 * first rule is *"the party always exists and always contains the persona…
 * a solo game is a party of one"*, written *"as an invariant so the code has one
 * shape instead of two"* — and an invariant a session has to have written an
 * effect to satisfy is not one, because a session is created before its first
 * turn. So it is answered here, the same way `readStatus` answers `alive` for
 * somebody nothing has said anything about.
 *
 * *The log may still say something about the persona — `companion` is a
 * coherent thing for a story to narrate about a character you were writing — and
 * what it may not do is remove them, because there is no value for that: the
 * channel's absence means absent and the persona's absence is what rule 1
 * forbids.*
 */
export function readParty(
  channels: Readonly<Record<string, { value: unknown }>>,
  actorId: string,
  persona?: string | null,
): Control | null {
  const held = channels[channelKey(SE_PARTY, actorId)]?.value;
  if (typeof held === 'string' && (CONTROLS as readonly string[]).includes(held)) {
    return held as Control;
  }
  // The empty check is not redundant: `cast.persona` is `string | null` and a
  // hand-edited `""` is a persona nobody has chosen, which must not make every
  // actor with an empty id a party member.
  return persona !== undefined && persona !== null && persona !== '' && actorId === persona
    ? 'player'
    : null;
}

/**
 * Every actor this session's channels say anything about, by scope key.
 *
 * **By key rather than by value**, which is load-bearing in both directions:
 * somebody the story has walked out of the room still has a `false` presence and
 * is still someone this story is about, and [P7.3] measured that a value-based
 * read cannot tell *elsewhere* from *never here* at all. It is also why this
 * cannot be a roster — `inverseOf` deletes a key when undoing an arrival, which
 * is right for presence and would be an eviction for a cast list.
 *
 * *`se.party` joined the three at [P7.3], with the channel.*
 */
const ABOUT_ACTORS: readonly string[] = [SE_PRESENCE, SE_STATUS, SE_PARTY];

export function actorsWithState(
  channels: Readonly<Record<string, { value: unknown }>>,
): Set<string> {
  const actors = new Set<string>();
  for (const key of Object.keys(channels)) {
    if (!ABOUT_ACTORS.some((id) => keyBelongsTo(key, id))) continue;
    const { scopeKey } = splitChannelKey(key);
    if (scopeKey !== null) actors.add(scopeKey);
  }
  return actors;
}

/**
 * One row of the cast panel — [10 §13.2], [P7.2].
 *
 * **Two axes out, one badge derived on the screen.** 10 §13.2 is explicit that
 * *"a two-axis matrix is the wrong thing to put in a sidebar"* and that **the
 * split is in the data, not on the screen** — so both values cross and the
 * client derives one badge from them. Sending a pre-derived badge would put the
 * derivation in the server and leave the client unable to offer *correct
 * presence and status directly*, which is the panel's whole justification.
 */
export interface CastRow {
  actorId: string;
  presence: boolean;
  status: string;
  /**
   * A terminal status the model proposed and the engine refused, still
   * unanswered — [06 §8.1]'s *"flagged, not applied quietly"*.
   *
   * **This is the prominent surface.** The refusal is already in the turn
   * record; what it needs is somewhere a person will see it, and a badge that
   * looked the same as any other would be the *quiet* half of what that sentence
   * rules out. Null when there is nothing outstanding.
   */
  pending: string | null;
  /** [06 §8.1]'s predicate, for a panel that wants to say *not yet met*. */
  introduced: boolean;
  /**
   * Who authors them, when they are travelling with you — [06 §8], [10 §13.2],
   * [P7.3]. `null` is *in the story and not in the party*, which is most of the
   * cast most of the time.
   *
   * **The control and not a boolean**, because the panel *"marks party members
   * distinctly"* and *companion* and *player* are the distinction worth marking:
   * one of them is a character you write and the other is one the narrator
   * writes for you.
   */
  party: Control | null;
}

/**
 * The cast panel's rows, at a node.
 *
 * **Who is in it: the session's cast, the persona, and anyone the channels have
 * something to say about.** The third is not redundancy — a character written
 * into the story and given presence without being added to `cast.actors` is
 * exactly the drift the panel exists to make visible, and a list built from the
 * cast field alone would hide it.
 *
 * ***And the assembler joined it — [P7.3], 2026-09-12.*** For one stage this
 * union was the only one: `turns/cast.ts` resolved the roster alone, so the
 * panel gave an arrival a row and the prompt carried no card for them. It now
 * takes the channel map and computes the same set. *The two are deliberately
 * separate computations rather than one shared helper, because they want
 * different things from it — this one wants rows including the persona's, and
 * the assembler wants actors excluding it.*
 *
 * ~~*Party members are not marked, because there is no party channel yet.*~~
 * **They are marked since [P7.3]**, when `se.party` arrived with the widened
 * `select` it was waiting on. 10 §13.2 says *"the panel marks party members
 * distinctly and introduces no parallel membership concept"*, and both halves
 * hold: `party` is a third value on a row that already exists, read from a
 * channel keyed the same way as presence, so there is no second list of who is
 * in the story to disagree with the first.
 */
export function castRows(
  cast: { persona?: string | null; actors?: string[] } | undefined,
  channels: Readonly<Record<string, { value: unknown }>>,
  path: readonly Turn[],
  /**
   * The mode's `participants.castIsPresent` — [P14.3]. See {@link readPresence}:
   * under it a declared member with no presence value is present, so the panel
   * shows present who the speaker policy treats as present.
   */
  castIsPresent = false,
): CastRow[] {
  const introduced = introducedOn(path);
  const pending = pendingStatuses(path);

  const ids = new Set<string>(actorsWithState(channels));
  for (const actorId of cast?.actors ?? []) ids.add(actorId);
  if (cast?.persona != null && cast.persona !== '') ids.add(cast.persona);

  const persona = cast?.persona ?? null;

  return [...ids].sort().map((actorId) => ({
    actorId,
    presence: readPresence(channels, actorId, castIsPresent),
    status: readStatus(channels, actorId),
    pending: pending.get(actorId) ?? null,
    introduced: introduced.has(actorId),
    party: readParty(channels, actorId, persona),
  }));
}

/**
 * Terminal statuses proposed and refused, and not since answered.
 *
 * **Answered, not acknowledged.** A refusal stops being outstanding when an
 * *applied* status effect lands on that actor afterwards — which is what both of
 * the panel's buttons produce: confirming writes the proposed value, dismissing
 * writes the standing one, and either way a person has ruled. Nothing else
 * clears it, so a proposal a player never looked at is still there next session,
 * which is the point of surfacing it at all.
 *
 * *Walked forward rather than backward because the path is oldest-first and a
 * later applied effect must beat an earlier refusal; the map keeps the last
 * word.*
 */
function pendingStatuses(path: readonly Turn[]): Map<string, string> {
  const pending = new Map<string, string>();

  for (const turn of path) {
    for (const effect of turn.effects) {
      if (effect.channelId !== SE_STATUS || effect.scopeKey === null) continue;
      if (effect.scope === 'escaped') continue;

      if (effect.applied) {
        pending.delete(effect.scopeKey);
      } else if (effect.rejectedReason === 'needs-confirmation') {
        /**
         * **The value the model wanted, from `after`** — which is what that
         * field means on a refused effect since [P7.2] corrected it. It used to
         * stamp `before` back into `after`, so a refusal recorded that
         * *something* had been refused and not *what*, and this panel could only
         * have said *the narrator proposed something* — which is the *quiet*
         * half of what [06 §8.1] rules out.
         */
        if (typeof effect.after === 'string') pending.set(effect.scopeKey, effect.after);
      }
    }
  }

  return pending;
}

/**
 * ***Who a per-character card is about*** — the present members of the cast
 * but the persona, [P14.5a]'s *"each present character"*.
 *
 * *The persona is left out* because the player has a tracker of their own, a
 * different shape (`StepCastMember.persona`); a character card for them would be
 * the same person described twice, which the character tracker's step already
 * refuses to do. *Present*, read off the rows, so it is presence as the mode
 * reads it — a member nobody muted in an embodied chat is in the room.
 */
export function presentMembers(rows: readonly CastRow[], persona: string | null): string[] {
  return rows.filter((row) => row.presence && row.actorId !== persona).map((row) => row.actorId);
}
