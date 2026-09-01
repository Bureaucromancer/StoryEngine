// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { LoreEntry } from '@storyengine/shared';

import type { Candidate } from '../assembly/types.js';
import type { Activation } from './activate.js';
import { trimRank } from './shelf.js';
import type { Shelved } from './shelf.js';

/**
 * Activated entries as prompt blocks — the last third of [P5 §1.3], after the
 * scan and the inner budget.
 *
 * Three things happen here and nowhere else: an activation acquires the **words
 * the workbench shows** for why it is in the prompt, it acquires a
 * **placement**, and it acquires a **priority** for the chat-wide cut it has
 * not faced yet.
 *
 * ## Placement is the entry's, not the preset's — which is why lore is odd
 *
 * Every other slot the collector fills is positioned by the preset block that
 * asked for it. Lore is the exception: `position` lives on the **entry**, so
 * one preset slot can emit blocks that belong in four different places. That is
 * [02 §3.1]'s design and it is right — an author writing *this one goes right
 * before the reply* is making a claim about that entry, not about everybody
 * else's preset — but it means the collector cannot treat a lore slot as a slot
 * that produces a run of adjacent blocks, and this module exists to say so in
 * one place rather than four.
 */

/** Where an activated entry wants to sit. */
export type LorePlacement =
  /** `before_char` — the phase-before slot. */
  | { at: 'before' }
  /** `after_char` — the phase-after slot. */
  | { at: 'after' }
  /**
   * `at_depth` — N messages from the end of the history, which is the same
   * mechanism the preset's own `in-history` blocks use.
   */
  | { at: 'in-history'; fromEnd: number }
  /**
   * `outlet` — wherever a preset slot naming this outlet sits.
   *
   * **Block addressing arriving from the other direction** ([P5.6]): everywhere
   * else a preset names what it wants and the engine supplies it; here the
   * entry names a place and the preset decides whether that place exists. An
   * outlet nobody positions is an entry that activated and went nowhere, which
   * is reported rather than silently dropped — see {@link Unplaced}.
   */
  | { at: 'outlet'; name: string };

/**
 * The entry's own `position`, read as a placement.
 *
 * `outlet` with no `outletName` degrades to `before` rather than becoming an
 * outlet named `''`. An empty name would match a preset slot that also left it
 * empty, which is two mistakes finding each other; landing in the ordinary
 * before-slot is visible, harmless, and what an author who half-configured a
 * field would rather have than silence.
 */
export function placementOf(entry: LoreEntry): LorePlacement {
  switch (entry.position) {
    case 'after_char':
      return { at: 'after' };
    case 'at_depth':
      // Clamped, because `depth` is a plain number in the schema and a
      // negative one would splice from the wrong end of the history.
      return { at: 'in-history', fromEnd: Math.max(0, Math.trunc(entry.depth)) };
    case 'outlet':
      return entry.outletName === null || entry.outletName === ''
        ? { at: 'before' }
        : { at: 'outlet', name: entry.outletName };
    default:
      return { at: 'before' };
  }
}

/**
 * Why it is here, in the words the workbench shows.
 *
 * **A product feature, not a debug string** — `Candidate.reason` says so, and
 * it is why these read as sentences rather than as enum values. The key is
 * quoted because *which* word did it is the whole question when somebody is
 * looking at an entry they did not expect.
 */
export function reasonFor(activation: Activation): string {
  switch (activation.by) {
    case 'constant':
      return 'always on';
    case 'sticky':
      return 'still active from an earlier turn';
    case 'recursive':
      return activation.hit === null
        ? 'named by another entry'
        : `named by another entry: “${activation.hit.key}”`;
    default:
      return activation.hit === null ? 'keyword match' : `keyword match: “${activation.hit.key}”`;
  }
}

export interface LoreBlock {
  candidate: Candidate;
  placement: LorePlacement;
}

/**
 * An activation that survived the inner budget and had nowhere to go, because
 * it named an outlet no preset slot positions.
 *
 * **Its own report rather than a silent drop.** This is the failure mode
 * outlets add to the system: an entry that fires perfectly, passes every
 * budget, and then does not appear — and the cause is a name mismatch between
 * two objects that were probably written by two different people. Without this
 * the only symptom is absence.
 */
export interface Unplaced {
  activation: Activation;
  outletName: string;
}

export interface BlocksInput {
  kept: readonly Shelved[];
  latestMessage: string;
  /** Outlet names the preset positions. Anything else is {@link Unplaced}. */
  outlets: ReadonlySet<string>;
  /**
   * The lore slot's own priority, from the preset. Each block takes it,
   * adjusted by trim rank — see {@link priorityFor}.
   */
  basePriority: number | undefined;
}

export function loreBlocks(input: BlocksInput): { blocks: LoreBlock[]; unplaced: Unplaced[] } {
  const blocks: LoreBlock[] = [];
  const unplaced: Unplaced[] = [];

  for (const shelved of input.kept) {
    const { activation } = shelved;
    const placement = placementOf(activation.entry);
    if (placement.at === 'outlet' && !input.outlets.has(placement.name)) {
      unplaced.push({ activation, outletName: placement.name });
      continue;
    }

    blocks.push({
      placement,
      candidate: {
        /**
         * Namespaced by book **and** entry. Two books can hold entries with the
         * same id — an import of the same source twice is the ordinary way to
         * get there — and a duplicate block id would make the two
         * indistinguishable in the record they are supposed to explain.
         */
        id: `lore.${activation.bookId}.${activation.entry.id}`,
        source: {
          kind: 'lore',
          entryId: activation.entry.id,
          // The record's own vocabulary has two phases where the entry has
          // four positions, so everything that is not explicitly after the
          // character reads as before it. The precise placement is not lost:
          // it is where the block *is* in the sequence.
          phase: placement.at === 'after' ? 'after' : 'before',
        },
        reason: reasonFor(activation),
        role: activation.entry.role,
        text: activation.entry.content,
        ...spreadPriority(priorityFor(activation, input.latestMessage, input.basePriority)),
      },
    });
  }

  return { blocks, unplaced };
}

/**
 * The chat-wide cut's ordering, carried over from the inner one.
 *
 * **The two budgets must drop lore in the same order or the documented one is
 * a lie.** [02 §3.2] specifies constants, then latest-message matches, then
 * injection order; the inner tier walks exactly that, and a chat-wide cut that
 * then dropped whatever came last would undo it for anybody whose prompt is
 * over budget — which is precisely the person the order was written for.
 *
 * So the rank rides out as priority. Lower drops first, and rank 0 is the
 * constant, so it subtracts: a constant sits one above the slot's own number
 * and an ordinary match two below it. A preset that gave the slot no priority
 * gets none here either — the budgeter reads absent as *the middle*, and
 * inventing a number would quietly rank lore against blocks the preset
 * deliberately left unranked.
 */
export function priorityFor(
  activation: Activation,
  latestMessage: string,
  basePriority: number | undefined,
): number | undefined {
  if (basePriority === undefined) return undefined;
  return basePriority - trimRank(activation, latestMessage);
}

/**
 * `exactOptionalPropertyTypes` is on, so *absent* and *present and undefined*
 * are different types and only the first one is what "the preset did not say"
 * means. Spread rather than assigned, which is the idiom the rest of the server
 * uses for exactly this.
 */
function spreadPriority(priority: number | undefined): { priority?: number } {
  return priority === undefined ? {} : { priority };
}
