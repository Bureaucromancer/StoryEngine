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
 * **And `se.party` is not here**, deliberately.
 * [P7 §1.6](../../../../docs/design/workplan/23-p7-implementation.md) records
 * that `ParticipantPolicy.select: 'fixed'` is *"the declaration that the cast
 * cannot change as an outcome of a turn, which is what licenses a plain `cast`
 * field on the session instead of an `se.party` channel"* — so a party channel
 * declared while the policy still says the cast cannot change is a
 * placeholder-shaped channel, which [P2 §2.7] rejected by name. That licence
 * expires when P7.3 widens `select`. **Presence and status carry no such
 * licence**: they are facts about a scene and about a life, and neither is a
 * claim about whether the cast can change.
 */

export const CAST_OWNER = 'storyengine.cast';

export const SE_PRESENCE = 'se.presence';
export const SE_STATUS = 'se.status';

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
 * *Party effects count and there are none yet*, because `se.party` waits on
 * P7.3's policy (see this module's header). The predicate names both from the
 * first line written so that adding the channel adds no case here — which is
 * also why it matches by channel id rather than by a list of two.
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
 * `se.party` is named here before it exists, which is the one place in this
 * module that is worth doing: the predicate's definition says *presence or
 * party*, and a list that omitted the second would be a definition quietly
 * narrowed to what happened to be built.
 */
const INTRODUCING: readonly string[] = [SE_PRESENCE, 'se.party'];

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

/** Whether an actor is in the scene at a node. Absent is absent. */
export function readPresence(
  channels: Readonly<Record<string, { value: unknown }>>,
  actorId: string,
): boolean {
  return channels[channelKey(SE_PRESENCE, actorId)]?.value === true;
}

/** Every actor this session's channels say anything about, by scope key. */
export function actorsWithState(
  channels: Readonly<Record<string, { value: unknown }>>,
): Set<string> {
  const actors = new Set<string>();
  for (const key of Object.keys(channels)) {
    if (!keyBelongsTo(key, SE_PRESENCE) && !keyBelongsTo(key, SE_STATUS)) continue;
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
 * *Party members are not marked, because there is no party channel yet.*
 * 10 §13.2 says *"the panel marks party members distinctly and introduces no
 * parallel membership concept"*, and the way to honour the second half while the
 * first is unbuildable is to mark nothing rather than to invent a second source
 * of truth about who is in the story — which that sentence calls *"exactly the
 * class of bug this section exists to surface"*. It arrives with `se.party` at
 * P7.3.
 */
export function castRows(
  cast: { persona?: string | null; actors?: string[] } | undefined,
  channels: Readonly<Record<string, { value: unknown }>>,
  path: readonly Turn[],
): CastRow[] {
  const introduced = introducedOn(path);
  const pending = pendingStatuses(path);

  const ids = new Set<string>(actorsWithState(channels));
  for (const actorId of cast?.actors ?? []) ids.add(actorId);
  if (cast?.persona != null && cast.persona !== '') ids.add(cast.persona);

  return [...ids].sort().map((actorId) => ({
    actorId,
    presence: readPresence(channels, actorId),
    status: readStatus(channels, actorId),
    pending: pending.get(actorId) ?? null,
    introduced: introduced.has(actorId),
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
