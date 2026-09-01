// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Lorebook, LoreEntry } from '@storyengine/shared';

import type { Rng } from '../rng/rng.js';
import type { LoreSource } from '../turns/lore.js';
import { matchEntry, type KeyHit, type PatternRefusal, type ScanInput } from './match.js';
import { feedsRecursion, mayRecurse, recursionVerdict } from './recursion.js';
import { advanceTiming, timingVerdict, type EntryTiming, NO_TIMING } from './timing.js';

/**
 * The scan — which entries fire this turn, and why each one did not.
 *
 * **[P5 §1.3] is the shape**: an ordinary collect-stage step contributing
 * blocks, with recursion running *inside* it and the two-tier budget outside.
 * This module is the first half of that — activation and its reasons. What an
 * activated entry becomes (a candidate, a placement, a reason string) is the
 * collector's, and what fits (`tokenBudget`, `entryLimit`, the chat-wide cut)
 * is the arbiter's. Keeping them apart is what lets *why did this fire* and
 * *why was this dropped* be two answerable questions rather than one shrug.
 *
 * ## Everything is reported, including the refusals
 *
 * The output carries every entry that did **not** fire, with the rule that
 * stopped it. That is the expensive-looking half and it is the point:
 * [02 §3.2] asks for skip reasons surfaced, [P5.8]'s keyword tester is a
 * surface over exactly this list, and the commonest real complaint about a
 * lorebook — *why is my entry not firing* — has as many answers as there are
 * `SkipReason`s. A scan that returned only its hits would make every one of
 * them indistinguishable from *the key was not in the text*.
 *
 * ## The order of the refusals is the order of the questions
 *
 * Cheap and absolute first, expensive and conditional last: the book's own
 * switch, then the entry's, then the filters, then recursion eligibility, then
 * timing, then — last, because it is the only step that runs a regex — the
 * keys. An entry disabled by its author never costs a pattern execution.
 *
 * Timing sits ahead of matching for a reason beyond cost. A `constant` entry
 * has no keys to try, and a `sticky` one is contributing *without* matching
 * ([timing.ts]) — so both need an answer before anything looks at the text.
 */

/**
 * Why an entry is in the prompt — Marinara's `LorebookActivationSource`, which
 * [02 §3.1] says to *take and let grow*.
 *
 * Four of its six are live here. `semantic` waits for embeddings, and
 * `current_location` for the channel predicates [P5 §1.4] is still deciding the
 * size of. The union is written open-endedly on purpose: this value ends up in
 * the turn record as the per-block *why was this included*, so a build that
 * grows a fifth source must not make an old record unreadable.
 */
export type ActivationSource = 'keyword' | 'constant' | 'sticky' | 'recursive';

/**
 * Why an entry is **not** in the prompt.
 *
 * Every one of these is a different piece of advice to the person whose entry
 * is not firing, which is the whole reason the list is this long. `no-keys`
 * means *write a key*; `no-match` means *the key is not in the text*;
 * `cooling` means *wait*; `lost-its-group` means *another entry won*; and
 * `never-fires` means *these two flags cannot both be satisfied*. Collapsing
 * any pair of them saves a line here and costs somebody an afternoon.
 */
export type SkipReason =
  | 'book-disabled'
  | 'entry-disabled'
  | 'filtered-out'
  | 'never-fires'
  | 'awaiting-recursion'
  | 'excluded-from-recursion'
  | 'recursion-off'
  | 'depth-exhausted'
  | 'spent'
  | 'delayed'
  | 'cooling'
  | 'no-keys'
  | 'no-match'
  | 'held-by-secondary'
  | 'lost-the-roll'
  | 'lost-its-group';

export interface Activation {
  /** The library id of the book it came from, for the block's source. */
  bookId: string;
  book: Lorebook;
  entry: LoreEntry;
  by: ActivationSource;
  /** The key that fired it, where a key did. Null for `constant` and `sticky`. */
  hit: KeyHit | null;
  /** Zero is the scan over the conversation; one and up are recursive passes. */
  depth: number;
}

export interface Skipped {
  bookId: string;
  entry: LoreEntry;
  reason: SkipReason;
}

export interface ScanContext {
  books: readonly LoreSource[];
  input: ScanInput;
  /**
   * Messages on the path before this turn — what `delay` counts, read from the
   * history rather than from a counter ([timing.ts]).
   */
  messagesSoFar: number;
  /** The stored counters, by entry id. Absent reads as {@link NO_TIMING}. */
  timing: Readonly<Record<string, EntryTiming>>;
  filters: FilterContext;
  /**
   * The turn's RNG — [07 §14].
   *
   * **Two fields here are stochastic and both draw through the service**, which
   * is not a style rule: an unrecorded draw does not fail where it is written,
   * it fails much later as a branch that reconstructs wrong. `probability` is
   * *stochastic firing* by definition and `groupWeight` is a weight, so both
   * would otherwise have reached for `Math.random`, and the eslint rule that
   * forbids it is the reason this parameter exists at all — it was written
   * with an injected `() => number` first, and the rule was right.
   *
   * What the tape buys is the distinction [07 §14.5] draws between **rewrite**
   * and **reroll**: swiping replays the same draws, so which of three weather
   * entries is in the prompt does not change under a person who only wanted
   * different prose. That is the property a hand-rolled RNG could not have had,
   * and it is why the group draw below is a draw rather than the deterministic
   * highest-weight-wins this started as.
   */
  rng: Rng;
}

/**
 * What the gating filters are matched against — [02 §3.1]'s *filters*.
 *
 * Supplied by the caller rather than read here, for `gather.ts`'s reason: a
 * retriever that went looking for the cast would be a second place that
 * decides who is in the scene.
 */
export interface FilterContext {
  /** Ids of the actors in the scene, persona included. */
  actorIds: readonly string[];
  /** Their tags, flattened — an entry filters on the set, not on whose it was. */
  actorTags: readonly string[];
  /** The call kind this scan is for, which `generationTriggerFilter` names. */
  generationTrigger: string;
}

export interface ScanResult {
  /** In the order they were found: book order, then entry order, then by depth. */
  activated: Activation[];
  skipped: Skipped[];
  /** Patterns that could not be run, from every entry that tried one. */
  refused: PatternRefusal[];
  /** Sources entries asked for that the caller did not supply. Deduplicated. */
  unknownSources: string[];
  /**
   * The counters every entry should be left at, by entry id — including the
   * ones that did not fire, because `cooling` counts down on a turn the entry
   * takes no other part in.
   *
   * **Returned rather than written.** Only a step may propose an effect
   * ([P5 §1.3]), so this module computes and the step commits. It also means
   * the scan is a pure function of its inputs and can be run for a preview
   * without moving anybody's cooldown.
   */
  timing: Record<string, EntryTiming>;
}

export function activate(context: ScanContext): ScanResult {
  const activated: Activation[] = [];
  const skipped: Skipped[] = [];
  const refused: PatternRefusal[] = [];
  const unknown = new Set<string>();
  const timing: Record<string, EntryTiming> = {};

  /**
   * Groups already won, keyed by book and group name — see {@link settleGroups}
   * for why the book is part of the key, and why winning is permanent for the
   * rest of the scan.
   */
  const wonGroups = new Set<string>();

  for (const source of context.books) {
    const book = source.book;
    if (!book.enabled) {
      for (const entry of book.entries) {
        skipped.push({ bookId: source.id, entry, reason: 'book-disabled' });
      }
      continue;
    }

    /** Entries still in play, re-scanned at each depth until nothing new fires. */
    let pending = inScanOrder(book.entries).filter((entry) => {
      const held = heldBack(entry, context);
      if (held === null) return true;
      skipped.push({ bookId: source.id, entry, reason: held });
      return false;
    });

    /**
     * Why each pending entry would be skipped if no further pass ran.
     *
     * Kept rather than recomputed after the loop, because recomputing means
     * running every unmatched entry's patterns a second time — paying [P5.4]'s
     * 50ms timeout twice for the pathological ones, and throwing away the
     * refusals the second run produced instead of reporting them.
     */
    const ifNothingElse = new Map<string, SkipReason>();

    let depth = 0;
    let haystack = context.input;

    for (;;) {
      const firedHere: Activation[] = [];
      const stillPending: LoreEntry[] = [];

      for (const entry of pending) {
        const outcome = considerAt(entry, book, haystack, depth, context);
        for (const pattern of outcome.refused) refused.push(pattern);
        for (const name of outcome.unknownSources) unknown.add(name);

        if (outcome.kind === 'fires') {
          firedHere.push({
            bookId: source.id,
            book,
            entry,
            by: outcome.by,
            hit: outcome.hit,
            depth,
          });
          continue;
        }
        if (outcome.kind === 'later') {
          ifNothingElse.set(entry.id, outcome.reason);
          stillPending.push(entry);
          continue;
        }
        skipped.push({ bookId: source.id, entry, reason: outcome.reason });
      }

      /**
       * **Groups are settled once per pass, over everything that fired in it**,
       * rather than as each entry is reached. A weighted draw has to see the
       * whole set of candidates to be a weighted draw at all — first past the
       * post with the weights used as a sort would make `groupWeight: 99` mean
       * *always* rather than *usually*, which is not a weight.
       */
      const winners = settleGroups(source.id, firedHere, wonGroups, context.rng);
      for (const one of firedHere) {
        if (winners.has(one.entry.id)) activated.push(one);
        else skipped.push({ bookId: source.id, entry: one.entry, reason: 'lost-its-group' });
      }
      const wonHere = firedHere.filter((one) => winners.has(one.entry.id));
      pending = stillPending;

      /**
       * **The next pass reads what this one activated**, and only from the
       * entries that permit it — `preventRecursion` is the outbound half
       * ([recursion.ts]). An entry that fired but forbids it contributes to the
       * prompt and to nothing else.
       *
       * The messages are dropped from the haystack for the recursive passes:
       * an entry that would match the conversation has already had its chance
       * at depth zero, and leaving them in would re-find it every pass and
       * make the loop's exit depend on the dedup rather than on the depth.
       */
      const next = depth + 1;
      /**
       * Only the winners feed the next pass. A group's losers are not in the
       * prompt, so letting their text trigger further entries would let an
       * entry nobody can read reach into the one they can.
       */
      const feeding = wonHere
        .filter((one) => feedsRecursion(one.entry))
        .map((one) => one.entry.content);
      if (feeding.length === 0 || pending.length === 0 || !mayRecurse(book, next)) break;

      /**
       * The named sources ride along unchanged while the messages are replaced.
       *
       * Dropping the messages is the point — an entry that the conversation
       * would have matched already had its turn at depth zero, and leaving them
       * in would re-find nothing while making the loop's exit depend on the
       * pending list rather than on the depth. The *sources* stay because
       * removing them would make every entry naming one report it as an unknown
       * source on the second pass, turning a working scan into a page of
       * warnings about sources that were supplied.
       */
      haystack = {
        messages: feeding,
        ...(context.input.sources === undefined ? {} : { sources: context.input.sources }),
      };
      depth = next;
    }

    /**
     * Everything still pending when the loop stopped. Reported with the reason
     * the *last* pass gave it, which is the one an author can act on: an entry
     * the loop ran out of depth for says so, rather than repeating the
     * `no-match` that was true at depth zero.
     */
    for (const entry of pending) {
      skipped.push({
        bookId: source.id,
        entry,
        reason: ifNothingElse.get(entry.id) ?? 'no-match',
      });
    }
  }

  /**
   * The counters, computed over **every** entry of every book that was scanned
   * — not only the ones that fired. A cooling entry has to count down on a turn
   * it took no part in, and an entry whose book was disabled must not: the book
   * being off is not time passing for its entries.
   */
  const fired = new Set(activated.map((one) => one.entry.id));
  for (const source of context.books) {
    if (!source.book.enabled) continue;
    for (const entry of source.book.entries) {
      const held = context.timing[entry.id] ?? NO_TIMING;
      const verdict = timingVerdict(entry, held, {
        messagesSoFar: context.messagesSoFar,
        matched: fired.has(entry.id),
      });
      timing[entry.id] = advanceTiming(entry, held, verdict);
    }
  }

  return { activated, skipped, refused, unknownSources: [...unknown], timing };
}

/**
 * The refusals that do not depend on the text or on the depth, so they are
 * asked once per entry rather than once per pass.
 *
 * Null means *still in play*.
 */
function heldBack(entry: LoreEntry, context: ScanContext): SkipReason | null {
  if (!entry.enabled) return 'entry-disabled';
  if (!passesFilters(entry, context.filters)) return 'filtered-out';
  return null;
}

interface Carried {
  refused: PatternRefusal[];
  unknownSources: string[];
}

type Outcome =
  | ({ kind: 'fires'; by: ActivationSource; hit: KeyHit | null } & Carried)
  /**
   * Not at this depth, but a later pass may still find it. `reason` is what it
   * would be skipped for if no later pass runs, so the caller never has to ask
   * a second time.
   */
  | ({ kind: 'later'; reason: SkipReason } & Carried)
  | ({ kind: 'skip'; reason: SkipReason } & Carried);

function considerAt(
  entry: LoreEntry,
  book: Lorebook,
  haystack: ScanInput,
  depth: number,
  context: ScanContext,
): Outcome {
  const nothing = { refused: [], unknownSources: [] };

  const recursion = recursionVerdict(book, entry, depth);
  if (recursion !== 'consider') {
    /**
     * `awaiting-recursion` at depth zero is the one refusal that is not final:
     * `delayUntilRecursion` says *fire only during recursion*, and the
     * recursion has not happened yet. Reporting it as a skip here would take
     * the entry out of the loop before it reached the pass it was waiting for.
     */
    return recursion === 'awaiting-recursion' && depth === 0
      ? { kind: 'later', reason: recursion, ...nothing }
      : { kind: 'skip', reason: recursion, ...nothing };
  }

  const held = context.timing[entry.id] ?? NO_TIMING;
  const verdict = timingVerdict(entry, held, {
    messagesSoFar: context.messagesSoFar,
    /**
     * **Asked before the text has been looked at**, so this answers *would
     * timing let it fire* rather than *did it* — and the flag is unobservable
     * here, which mutation testing established rather than argument. It
     * chooses only between `fires` and `idle`, and the arms below read neither:
     * they read the three refusals, which hold whatever matched, and `sticky`,
     * which outranks the flag. So `false` is written because it is the true
     * statement at this point in the function, not because anything depends on
     * it. An arm added below that reads `fires` would need this reconsidered.
     */
    matched: false,
  });
  if (verdict === 'spent' || verdict === 'delayed' || verdict === 'cooling') {
    return { kind: 'skip', reason: verdict, ...nothing };
  }

  /**
   * **A running sticky window contributes without matching**, which is the
   * whole of what `sticky` means, so the text is never consulted for one. It
   * also short-circuits `probability`: a window is one firing continuing, and
   * re-rolling it every turn would make a 50% entry with `sticky: 4` almost
   * never last four turns.
   */
  if (verdict === 'sticky') {
    return { kind: 'fires', by: 'sticky', hit: null, ...nothing };
  }

  if (entry.constant) {
    return rolled(entry, context.rng)
      ? { kind: 'fires', by: 'constant', hit: null, ...nothing }
      : { kind: 'skip', reason: 'lost-the-roll', ...nothing };
  }

  const match = matchEntry(book, entry, haystack);
  const carried = { refused: match.refused, unknownSources: match.unknownSources };
  if (match.outcome !== 'matched') {
    /**
     * A miss at a depth the loop can still get past is *later*, not a skip —
     * the whole point of recursion is that an entry the conversation did not
     * name may be named by an entry that fired. `no-keys` is final at any
     * depth, because an entry with nothing to match on will not match a
     * different haystack either.
     */
    if (match.outcome !== 'no-keys' && mayRecurse(book, depth + 1)) {
      return { kind: 'later', reason: match.outcome, ...carried };
    }
    /**
     * **A miss on the last permitted pass is the book's limit, not the text.**
     *
     * Both are true — the entry did not match what it was shown, *and* it has
     * no pass left — and only one of them is advice. `no-match` sends an author
     * to rewrite keys that may be perfectly good; `depth-exhausted` names the
     * setting that would find them. It is said only when recursion was actually
     * on: a book with the switch off never had a later pass to run out of, so
     * there the miss really is the whole story.
     */
    return {
      kind: 'skip',
      reason:
        match.outcome !== 'no-keys' && book.recursiveScanning ? 'depth-exhausted' : match.outcome,
      ...carried,
    };
  }

  if (!rolled(entry, context.rng)) {
    return { kind: 'skip', reason: 'lost-the-roll', ...carried };
  }

  return {
    kind: 'fires',
    // The same keyword match, named for the pass that found it — which is the
    // distinction `LorebookActivationSource` draws between `keyword` and
    // `recursive`, and the one a reader of the panel most wants.
    by: depth === 0 ? 'keyword' : 'recursive',
    hit: match.by,
    ...carried,
  };
}

/** `probability` — 0..100, null meaning always. */
function rolled(entry: LoreEntry, rng: Rng): boolean {
  if (entry.probability === null) return true;
  /**
   * Keyed on the entry rather than on the site alone, which is [07 §14]'s
   * **keyed by site, never by position** applied where it bites hardest: a
   * positional tape hands one entry's coin flip to another the moment a
   * rewrite takes a slightly different path, and lore is where paths differ.
   */
  return rng.at('lore.probability', entry.id).chance(entry.probability / 100);
}

/**
 * *Only one of a group fires* — [02 §3.1].
 *
 * **A weighted draw, which is what `groupWeight` says it is** — and the tape is
 * what makes that safe. This was written first as deterministic
 * highest-weight-wins, reasoning that a swipe changing which of three weather
 * entries is in the prompt reads as instability rather than as variety. Good
 * reason, aimed at a problem [07 §14.5] had already solved: draws go on the
 * turn's tape and a rewrite replays it, so a swipe keeps the same weather while
 * a genuine reroll gets new weather. Sorting by weight would instead have made
 * `groupWeight: 99` mean *always* rather than *usually*, quietly deleting the
 * field's meaning — which is what a lint rule about `Math.random` turned out to
 * be protecting.
 *
 * Groups are scoped per book: two imported books that both use the word
 * `weather` have not agreed to compete, and lorebooks silently suppressing each
 * other's entries would be a bug that gets worse the more books somebody has.
 *
 * Returns the ids that survive; everything else in `fired` lost its group.
 */
function settleGroups(
  bookId: string,
  fired: readonly Activation[],
  won: Set<string>,
  rng: Rng,
): Set<string> {
  const winners = new Set<string>();
  const contests = new Map<string, Activation[]>();

  for (const one of fired) {
    const group = one.entry.group;
    if (group === null || group === '') {
      winners.add(one.entry.id);
      continue;
    }
    const key = `${bookId} ${group}`;
    // Already won on an earlier pass: everything in it loses now, with no draw.
    // A recursive pass must not unseat the entry already in the prompt, or the
    // prompt would change underneath the text that triggered the pass.
    if (won.has(key)) continue;
    contests.set(key, [...(contests.get(key) ?? []), one]);
  }

  for (const [key, members] of contests) {
    won.add(key);
    const winner = pickOne(key, members, rng);
    if (winner !== null) winners.add(winner.entry.id);
  }
  return winners;
}

/**
 * The draw. Null only for an empty contest, which cannot arise — a key is put
 * in the map by the entry that joins it — and is answered rather than asserted
 * away, because both spellings of the assertion are lint-forbidden here and the
 * ban is right: an assertion that is true today is a claim nothing re-checks.
 */
function pickOne(key: string, members: readonly Activation[], rng: Rng): Activation | null {
  const [first, ...rest] = members;
  if (first === undefined) return null;
  if (rest.length === 0) return first;

  const items = members.map((one) => ({ value: one, weight: one.entry.groupWeight ?? 1 }));
  /**
   * **Every weight at zero is an author's instruction, not an error.**
   * `weightedPick` refuses a set with no positive weight, correctly, since
   * there is nothing to draw from; and this is the one place that arises by
   * ordinary means, because zeroing a group is a plausible way to say *none of
   * these for now*. Falling back to the first in scan order keeps [00 §3.3]'s
   * never-blocks promise. Throwing would make one careless field cost somebody
   * their turn.
   */
  if (items.every((item) => item.weight <= 0)) return first;
  return rng.at('lore.group', key).weightedPick(items);
}

/**
 * The three `NullableFilter`s — [02 §3.1]'s *gating*.
 *
 * Each is `{ mode: 'any' | 'include' | 'exclude', values }`, and null is the
 * same as `any`: no opinion. `include` is *at least one of mine is present*
 * rather than *all of mine are*, which is what makes a filter listing three
 * actors mean "any scene with one of these" — the reading an author writing a
 * list expects, and the one that makes an empty `include` list mean nothing can
 * satisfy it rather than everything can.
 */
function passesFilters(entry: LoreEntry, filters: FilterContext): boolean {
  return (
    passes(entry.actorFilter, filters.actorIds) &&
    passes(entry.actorTagFilter, filters.actorTags) &&
    passes(entry.generationTriggerFilter, [filters.generationTrigger])
  );
}

function passes(
  filter: { mode: 'any' | 'include' | 'exclude'; values: string[] } | null,
  present: readonly string[],
): boolean {
  if (filter === null || filter.mode === 'any') return true;
  const hit = filter.values.some((value) => present.includes(value));
  return filter.mode === 'include' ? hit : !hit;
}

/**
 * The scan order — the book's own `order`, applied before the first pass.
 *
 * Exported because the order is a *contract* rather than an implementation
 * detail, and because [P5.8]'s tester has to show the queue in the order the
 * scan will actually walk it.
 *
 * **`groupWeight` is deliberately not in this sort**, though an earlier draft
 * had it first: that was the deterministic highest-weight-wins grouping, and
 * once the group became a weighted draw ({@link settleGroups}) a weight in the
 * scan order would have been a second, silent tie-break on top of the draw.
 *
 * **Total, not partial.** Two entries at the same `order` have to come out the
 * same way on every scan or a group's all-zero fallback and the panel's listing
 * both wobble between runs for no reason a reader could ever see. The id is
 * arbitrary and that is fine; what it has to be is stable.
 */
export function inScanOrder(entries: readonly LoreEntry[]): LoreEntry[] {
  return [...entries].sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}
