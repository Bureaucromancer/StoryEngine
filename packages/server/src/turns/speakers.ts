// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ParticipantPolicy } from '@storyengine/sdk';
import type { Turn } from '@storyengine/shared';

import { isTerminal, readPresence, readStatus } from '../sessions/cast.js';
import type { SiteRng } from '../rng/rng.js';

import type { CastMember } from './cast.js';

/**
 * Who talks this turn — [06 §7.2](../../../../docs/design/06-modes-and-turn-pipeline.md)'s
 * taxonomy, built at [P7.3](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **The policy selects speakers**, which is 06 §7.2's own correction to the
 * source it borrows the taxonomy from: *"with the implementation being 'the
 * policy selects speakers', **not card-swapping**"*. SillyTavern's activation
 * strategies decide which character card is loaded; here every card the session
 * plays with is loaded for every turn, and this only decides who the turn is
 * *for*. That difference is why widening `select` is not a cast migration — the
 * roster is `cast.actors` and stays one ([P7 §1.6], corrected at P7.3).
 *
 * **The first real consumer of presence and status.** [P7.2] built both and
 * nothing outside the panel read them: eligibility is *here, and not written
 * out of the story*, so a character who left the room does not answer and a dead
 * one does not speak. That is also the honest reason the taxonomy could not have
 * been built before P7.2 — a selector over a cast with no notion of who is
 * present selects from a list of everyone the session has ever named.
 *
 * **It lives in `turns/` and takes a drawn value rather than an `Rng`.** The
 * draw belongs to the turn's tape, so a replay is the same scene; taking the
 * site rather than the generator keeps this a function of its arguments, which
 * is what lets the interesting cases be tested without a turn.
 */
export interface SpeakerInputs {
  policy: ParticipantPolicy;
  /** The resolved cast, in roster order — `resolveCast`'s output. */
  actors: readonly CastMember[];
  persona: string | null;
  channels: Readonly<Record<string, { value: unknown }>>;
  /** The turn being answered, for `manual` and for `natural`'s scan. */
  input?: { actorId: string | null; text: string } | undefined;
  /** The prose the scene last produced, which is what `natural` reads. */
  lastProse?: string | undefined;
  /**
   * How many story turns are on the path to this node — `list`'s rotation.
   * Story turns because a HUD edit is on the path too, and a rotation that
   * counted it skipped whoever's turn it was (`sessions/depth.ts`).
   *
   * **A length, not an ordinal, and [07 §3] is why the difference matters.**
   * That section refuses `(branch, index)` addressing because *"a turn's
   * position is not a fact about the turn; it is a fact about a path through the
   * tree"* — and the path to a node is exactly what this is. Two branches
   * diverging at turn 30 rotate independently from turn 30, which is what
   * anybody would expect and what an id-keyed scheme would have had to build.
   */
  depth: number;
  /** The turn's tape, at this selector's own site. Only `pooled` draws. */
  draw?: SiteRng | undefined;
}

/**
 * The actors a policy may choose from: in the scene, and not written out of it.
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
        readPresence(inputs.channels, id) &&
        !isTerminal(readStatus(inputs.channels, id)),
    );
}

export function selectSpeakers(inputs: SpeakerInputs): string[] {
  const pool = eligible(inputs);

  switch (inputs.policy.select) {
    case 'fixed':
      /**
       * **Everyone eligible, which is what a mode that makes no selection
       * means.** Not an empty list: `fixed` declares that the cast cannot change
       * as an outcome of a turn, which is a statement about membership and not
       * about silence. A merged call names nobody regardless, so for every
       * shipped mode this is the same behaviour it had before the taxonomy
       * existed.
       */
      return pool;

    case 'manual':
      /**
       * **Whoever the player named, and nobody otherwise.** An empty answer is
       * a real answer here and the reason `speakers` had to be able to be empty:
       * `manual` with nobody named is a turn the player has not addressed to
       * anyone, which a mode may reasonably narrate rather than voice.
       */
      return inputs.input?.actorId != null && pool.includes(inputs.input.actorId)
        ? [inputs.input.actorId]
        : [];

    case 'list':
      /**
       * **Each in turn, rotating on the path's depth.** One speaker, because a
       * list that answered with all of them in a rotated order would be `fixed`
       * with extra steps.
       *
       * *The rotation jumps when the pool's size changes*, which is worth
       * naming rather than discovering: somebody leaving the room shifts whose
       * turn it is. The alternative is remembering who spoke last, which is a
       * fact the turn record does not carry — and inventing a channel to hold it
       * would be a second source of truth about a thing the path already
       * determines.
       */
      if (pool.length === 0) return [];
      // `slice` rather than an index, because `noUncheckedIndexedAccess` makes
      // the index `string | undefined` and the assertion that silences it is
      // banned — rightly, since the guard above is the thing that makes it safe
      // and an assertion would move the reasoning away from it.
      {
        const at = inputs.depth % pool.length;
        return pool.slice(at, at + 1);
      }

    case 'pooled':
      /**
       * **One at random, on the turn's tape.** `weightedPick` rather than
       * `pick`, for the reason `random.ts` gives at the call site of the
       * hazard: a `pick` records a *position*, so a replay against a pool of the
       * same length hands back a different actor, and a pool whose membership
       * changes is the ordinary case here. `weightedPick` records the winner's
       * id and redraws when that winner is no longer a candidate, which is the
       * promise kept under replay rather than only on a first run.
       */
      if (pool.length === 0 || inputs.draw === undefined) return [];
      return [inputs.draw.weightedPick(pool.map((id) => ({ id, value: id, weight: 1 })))];

    case 'natural':
      return naturallyAddressed(inputs, pool);
  }
}

/**
 * Whoever the scene just addressed — SillyTavern's `NATURAL`, and **honestly a
 * heuristic**.
 *
 * It scans the last prose the scene produced, plus the player's own input, for
 * the names of eligible actors, and answers those in the order they appear. That
 * is what the source does and what 06 §7.2 takes as the taxonomy; it is not
 * inference and it should not be described as if it were. A character addressed
 * by epithet rather than by name is not found, and one whose name is an ordinary
 * word is found too often.
 *
 * **The player's input is scanned too, and it is scanned last but matters
 * most** — asking *"Vera, what do you think?"* is the case a reader would expect
 * this to handle, and a scan of the previous turn's prose alone would miss it
 * entirely. Order is by first appearance across the two, with the input first,
 * because addressing somebody is more recent than the prose that preceded it.
 *
 * **Nobody found is nobody**, deliberately, rather than falling back to the
 * whole pool. A turn that addresses no one is a turn the narrator answers, and a
 * fallback would make `natural` indistinguishable from `fixed` in exactly the
 * case a mode most wants to tell apart.
 */
function naturallyAddressed(inputs: SpeakerInputs, pool: readonly string[]): string[] {
  const byId = new Map(inputs.actors.map((member) => [member.actor.id, member.actor.name]));
  const haystack = `${inputs.input?.text ?? ''}\n${inputs.lastProse ?? ''}`.toLowerCase();

  const found: { id: string; at: number }[] = [];
  for (const id of pool) {
    const name = byId.get(id);
    if (name === undefined || name === '') continue;
    const at = haystack.indexOf(name.toLowerCase());
    if (at >= 0) found.push({ id, at });
  }

  return found.sort((a, b) => a.at - b.at).map((one) => one.id);
}

/**
 * Whether a policy makes a selection at all.
 *
 * `fixed` does not, and the distinction reaches a step as *absent* rather than
 * as a list: a mode that declares no strategy should not hand its steps a
 * speaker set that looks like one it chose.
 */
export function selectsSpeakers(policy: ParticipantPolicy): boolean {
  return policy.select !== 'fixed';
}

/**
 * The last thing the scene said, for `natural` to scan.
 *
 * **The last turn that produced prose, not the last turn.** A hand edit, an undo
 * and a quarantine all write turns with effects and no output ([03 §8.1]), so
 * walking back to the most recent one with text is the difference between
 * *whoever was addressed* and *nobody, because the last event was bookkeeping*.
 */
export function lastProse(history: readonly Turn[]): string | undefined {
  for (let at = history.length - 1; at >= 0; at -= 1) {
    const text = history[at]?.output?.text;
    if (text !== undefined && text !== '') return text;
  }
  return undefined;
}
