// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { LoreEntry, LoreReport } from '@storyengine/shared';

import type { Candidate } from '../assembly/types.js';
import type { LoreSource } from '../turns/lore.js';
import type { PatternRefusal } from './match.js';
import type { Activation, ScanResult } from './activate.js';
import { trimRank } from './shelf.js';
import type { Shelved, ShelfResult } from './shelf.js';

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

/**
 * The inner budget's refusals, in the arbiter's own vocabulary — [P5.6].
 *
 * **Written here rather than in `shelf.ts`**, because a rule an author reads is
 * a product string and the shelf's job is the arithmetic. It is also where the
 * outlet mismatch joins them: three different things decided against these
 * blocks and a reader needs one list, not three.
 *
 * The sentences name the setting to change, which is the whole reason they are
 * sentences: *the book's token budget* is a field somebody can find, and *over
 * budget* is a shrug.
 */
export function refusalsFor(
  refused: readonly Shelved[],
  unplaced: readonly Unplaced[],
): { blockId: string; tokens: number; rule: string }[] {
  return [
    ...refused.map((one) => ({
      blockId: `lore.${one.activation.bookId}.${one.activation.entry.id}`,
      tokens: one.tokens,
      rule:
        one.refusedBy === 'entry-limit'
          ? `past the book's entry limit of ${String(one.activation.book.entryLimit)}`
          : `over the book's token budget of ${String(one.activation.book.tokenBudget)}`,
    })),
    ...unplaced.map((one) => ({
      blockId: `lore.${one.activation.bookId}.${one.activation.entry.id}`,
      // Not a budget decision at all, so it has no size: nothing measured it,
      // because nothing was going to send it. Reporting an estimate here would
      // read as *this cost you tokens*, which is the opposite of what happened.
      tokens: 0,
      rule: `no preset slot positions the outlet “${one.outletName}”`,
    })),
  ];
}

/**
 * The scan, the shelf and the outlets as one report for a surface — [P5.8].
 *
 * **Assembled here rather than in the preview**, because every piece of it is
 * this module's vocabulary and the preview's job is to answer a question rather
 * than to know how a lorebook works. It is also what keeps the runner and the
 * preview from producing two differently-shaped accounts of one scan.
 *
 * The *skipped* half is the substance. An entry that fired is already legible —
 * it is a block with a reason beside it — and nothing anywhere could say why an
 * entry did not.
 */
export function loreReport(input: {
  books: readonly LoreSource[];
  scan: ScanResult;
  shelf: ShelfResult;
  unplaced: readonly Unplaced[];
}): LoreReport {
  const spend = new Map(input.shelf.books.map((row) => [row.bookId, row]));

  return {
    /**
     * Every book in play, including one that activated nothing — which is the
     * row somebody most needs. *This book is being scanned and contributed
     * nothing* and *this book is not being scanned* are different problems with
     * different repairs, and only a row can tell them apart.
     */
    books: input.books.map((source) => {
      const spent = spend.get(source.id);
      return {
        bookId: source.id,
        bookName: source.book.name,
        by: source.by,
        tokenBudget: source.book.tokenBudget,
        tokensSpent: spent?.tokensSpent ?? 0,
        entryLimit: source.book.entryLimit,
        entriesKept: spent?.entriesKept ?? 0,
      };
    }),
    skipped: input.scan.skipped.map((one) => ({
      bookId: one.bookId,
      entryId: one.entry.id,
      entryName: one.entry.name,
      reason: one.reason,
      ...(one.folder === undefined ? {} : { folder: one.folder }),
    })),
    /**
     * Deduplicated by entry and key. `firstHit` walks every haystack, so one
     * bad pattern in an entry scanned across a `scanDepth` of eight produces
     * eight identical refusals — and a person reading *8 patterns could not be
     * run* would go looking for eight problems.
     */
    refused: dedupeRefusals(input.scan, input.scan.refused),
    unknownSources: input.scan.unknownSources,
  };
}

function dedupeRefusals(
  scan: ScanResult,
  refused: readonly PatternRefusal[],
): LoreReport['refused'] {
  /**
   * The matcher reports a refusal by key without saying whose entry it was, so
   * the entry is recovered by looking for one that holds that key. Ambiguous
   * only when two entries share a key *and* both patterns fail, in which case
   * naming either is more use than naming none — and the key itself, which is
   * the thing to fix, is exact either way.
   */
  const owner = new Map<string, { id: string; name: string }>();
  for (const one of [...scan.activated.map((a) => a.entry), ...scan.skipped.map((s) => s.entry)]) {
    for (const key of one.keys) {
      if (!owner.has(key)) owner.set(key, { id: one.id, name: one.name });
    }
  }

  const seen = new Set<string>();
  const rows: LoreReport['refused'] = [];
  for (const one of refused) {
    if (seen.has(one.key)) continue;
    seen.add(one.key);
    const from = owner.get(one.key);
    rows.push({
      entryId: from?.id ?? '',
      entryName: from?.name ?? '',
      key: one.key,
      reason: one.reason,
    });
  }
  return rows;
}
