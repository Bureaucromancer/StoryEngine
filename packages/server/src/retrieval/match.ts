// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { literalSpans, type Lorebook, type LoreEntry, type Span } from '@storyengine/shared';

import { testPattern, type PatternOutcome } from './regex.js';

/**
 * Does this entry's text match — and nothing else.
 *
 * **Pure, and that is the stage's own argument**
 * ([P5.4](../../../../docs/design/workplan/17-p5-implementation.md)): keys,
 * secondary keys with selective logic, whole-word, case, regex, scan depth and
 * scan sources, as functions over values. Everything that decides whether a
 * matched entry actually *fires* — `enabled`, the folder gate, `constant`,
 * `probability`, timing, recursion, budgets — belongs to the stages after this
 * one, and keeping it out is what makes this the cheapest place in the phase to
 * be exhaustive.
 *
 * **It answers with why, not with a boolean.** [03 §3.1](../../../../docs/design/03-data-model.md)
 * takes Marinara's `LorebookActivationSource` as the per-block *why was this
 * included* value, and [P5 §1.3] wires that into block reasons at P5.6. A
 * matcher that returned `true` would have thrown away the only thing those
 * surfaces need — and gate step 15 asks specifically that an entry whose
 * pattern was abandoned **reports** it.
 */

/** The text one scan runs over. */
export interface ScanInput {
  /**
   * Recent messages, **most recent first**, which is the order `scanDepth`
   * counts in. Ordering it this way rather than chronologically means a depth
   * is a prefix rather than a suffix, so the slice cannot be off by one at the
   * end that matters.
   */
  messages: readonly string[];
  /**
   * Text from entries that already activated, fed back for a recursive pass —
   * [P6B.1].
   *
   * **Its own field because it is not a conversation window, and `scanDepth`
   * only counts those.** The recursive pass used to hand this in as `messages`,
   * and `haystacksFor` then sliced it: on a default book (`scanDepth: 2`) only
   * the first **two** activated entries' content was ever scanned, forever.
   * Worse, the feed inherits the scan order, so raising an entry's `order` — a
   * *placement* setting, under a banner with nothing to do with recursion —
   * silently removed its text from the haystack, and the entry that then failed
   * to fire was reported `no-match`, which `activate.ts` argues at length is
   * the wrong thing to tell an author whose keys were fine.
   *
   * No test could see it: every recursion test was a chain of width one, so
   * the slice never had a second element to drop ([P5 §0.5]).
   *
   * **Recursion has its own limit and always did** — `maxRecursionDepth`, which
   * `mayRecurse` honours. Bounding the same loop twice, once by a setting that
   * means something else, is what produced the silence.
   */
  recursed?: readonly string[];
  /**
   * The named haystacks `additionalMatchingSources` can ask for — a persona's
   * tags, a card's description ([04 §5](../../../../docs/design/04-schemas.md)).
   *
   * A source an entry names and this does not supply is simply not scanned, and
   * is reported: an entry that never fires because it is looking somewhere that
   * does not exist is the case P5.8's tester exists to explain, and it cannot
   * explain what the matcher did not say.
   */
  sources?: Readonly<Record<string, string>>;
}

/** Which key fired, and in which haystack. */
export interface KeyHit {
  key: string;
  /** `'message'`, or the name of an additional source. */
  source: string;
  /**
   * ***Where it fired*** — added at [P7.7], and named as unpriced by
   * [P7 §1.7](../../../../docs/design/workplan/23-p7-implementation.md).
   *
   * That section measured the gap exactly: *"the scanner knows **which** key
   * fired and **in which** haystack, never **where**, so P7.7's
   * one-scan-two-consumers claim needs the matcher widened to carry offsets
   * through."* This is that widening, and it is what lets §P7.7's *"sharing
   * P5's keyword scanner so highlighting and inclusion reasons cannot disagree
   * about who the fixer is"* be one scan rather than two implementations of one
   * rule.
   *
   * **Absent under `useRegex`**, and that is the honest answer rather than a
   * gap: a pattern is run by `testPattern`, which reports whether it matched and
   * not where — and [P5.8] is emphatic that a browser must not run a stranger's
   * pattern, so widening *that* is a different question with a security half.
   * An entry whose key is a pattern therefore contributes an inclusion reason
   * and no highlight, which the surface reports rather than hides.
   */
  at?: Span;
}

/** A pattern that could not be run, carried so a surface can name it. */
export interface PatternRefusal {
  key: string;
  reason: 'timed-out' | 'invalid';
  detail?: string;
}

/**
 * ***What one scan has learned about its patterns*** (2026-09-27).
 *
 * `testPattern`'s fifty milliseconds bounds one call, and the scan made a great
 * many: every key against every message, then again against every recursive
 * pass, then again as a secondary key. A pattern that timed out on the first
 * message was run again on the second. A book of five catastrophic keys, read
 * to `scanDepth: 0` over an eight-hundred-message session, cost about two
 * hundred seconds per call kind per turn, synchronously, for every account on
 * the server. That is the denial of service [P5.4]'s timeout was written to
 * close, reached by repetition.
 *
 * So a scan keeps a ledger. A pattern refused once, invalid or timed out, is
 * refused for the rest of the scan without being run again: an invalid one is
 * invalid everywhere, and one that times out on one haystack is not worth
 * betting on the next. And a scan that has seen {@link SCAN_TIMEOUT_LIMIT}
 * timeouts runs no more patterns, and reports each one it skips as timed out,
 * because the scan's time for patterns is what ran out. Invalid patterns cost
 * nothing to discover and do not count.
 */
export interface RegexLedger {
  /** Patterns this scan has refused, keyed by flags and source. */
  refused: Map<string, PatternRefusal>;
  /** Patterns this scan has seen time out. */
  timeouts: number;
}

export function newRegexLedger(): RegexLedger {
  return { refused: new Map(), timeouts: 0 };
}

/**
 * Timeouts one scan will spend before it runs no more patterns: a fifth of a
 * second at `PATTERN_TIMEOUT_MS`. **Not configurable**, for the reason
 * `regex.ts` gives about its own number.
 */
export const SCAN_TIMEOUT_LIMIT = 4;

export interface MatchResult {
  /**
   * - `matched` — a primary key hit and any secondary condition allowed it.
   * - `no-keys` — the entry has nothing to match on. Distinct from `no-match`
   *   because it is a property of the *entry*, and it is the commonest reason a
   *   newly created entry never fires.
   * - `no-match` — keys, none of them in the text.
   * - `held-by-secondary` — a primary key hit and `selectiveLogic` refused it.
   *   Its own outcome because *matched then held* is the answer a person
   *   debugging selective logic needs and `no-match` hides it.
   */
  outcome: 'matched' | 'no-keys' | 'no-match' | 'held-by-secondary';
  /** The primary key that hit, where one did — including when held. */
  by: KeyHit | null;
  refused: PatternRefusal[];
  /** Sources the entry asked for that the caller did not supply. */
  unknownSources: string[];
}

/**
 * ~~A literal term in a haystack, optionally at word boundaries.~~
 *
 * **Moved to `shared/matching.ts` at [P5.8]**, unchanged, because the book
 * page's inline highlighting claims to show *what the scanner sees* and two
 * implementations of one rule disagree eventually — this one has three flags to
 * disagree about. The same move [P5.7] made with `entryGate`, for the same
 * reason. The argument for writing the boundary test out rather than building a
 * `\b`-anchored pattern travelled with it.
 *
 * The **regex** arm below deliberately did not travel: it needs `node:vm` and a
 * timeout, and a browser has neither.
 */

/** One key against one haystack, under the entry's own three flags. */
function keyMatches(
  entry: LoreEntry,
  key: string,
  haystack: string,
  ledger: RegexLedger,
): { hit: boolean; at?: Span; refusal?: PatternRefusal } {
  if (entry.useRegex) {
    /**
     * **`matchWholeWords` is ignored under `useRegex`**, and that is a decision
     * rather than an omission: a pattern already says where its own boundaries
     * are, and wrapping somebody's alternation in an implicit `\b…\b` would
     * change what they wrote. It is also what SillyTavern does, which matters
     * because the library is full of patterns written against it.
     */
    const flags = entry.caseSensitive ? '' : 'i';
    const id = `${flags}\u0000${key}`;
    const known = ledger.refused.get(id);
    if (known !== undefined) return { hit: false, refusal: known };
    if (ledger.timeouts >= SCAN_TIMEOUT_LIMIT) {
      const skipped: PatternRefusal = { key, reason: 'timed-out' };
      ledger.refused.set(id, skipped);
      return { hit: false, refusal: skipped };
    }

    const outcome: PatternOutcome = testPattern(key, flags, haystack);
    if (outcome.kind === 'matched') return { hit: true };
    if (outcome.kind === 'no-match') return { hit: false };
    const refusal: PatternRefusal = {
      key,
      reason: outcome.kind === 'timed-out' ? 'timed-out' : 'invalid',
      ...(outcome.kind === 'invalid' ? { detail: outcome.detail } : {}),
    };
    ledger.refused.set(id, refusal);
    if (outcome.kind === 'timed-out') ledger.timeouts += 1;
    return { hit: false, refusal };
  }

  /**
   * ***`literalSpans` rather than `containsTerm`, which is the same scan asked
   * for its answer instead of for a boolean*** — [P7.7]. `containsTerm` is
   * itself a length check over `literalSpans`, so this costs nothing and returns
   * the offsets [P7 §1.7] says the matcher has to carry through.
   *
   * *The first hit, because that is what `KeyHit` has always meant*: `firstHit`
   * returns on the first key that fires and the surface highlights the whole
   * entry's keys separately through `entrySpans`. A list here would be a second
   * answer to a question this shape does not ask.
   *
   * **Case folding is applied to both sides rather than passed as a flag**,
   * which is what the previous spelling did — and `literalSpans` keeps the
   * *original* offsets through a fold, which is exactly the property its own
   * docstring promises and the reason this stays correct.
   */
  const spans = literalSpans(haystack, key, {
    wholeWords: entry.matchWholeWords,
    caseSensitive: entry.caseSensitive,
  });
  const first = spans[0];
  return first === undefined ? { hit: false } : { hit: true, at: first };
}

/**
 * The haystacks this entry reads, each with the name a hit reports.
 *
 * **`scanDepth` counts messages and nothing else.** An additional source is a
 * place rather than a point in the conversation, so a depth of one does not
 * mean *and none of the sources* — it means one message, plus whatever the
 * entry also asked to look at.
 *
 * `null` on the entry inherits the book's, and **`0` means the whole session**
 * at either level ([04 §5]). Zero-as-unlimited is the format's convention and
 * not ours to improve: the books that carry it were written elsewhere.
 */
function haystacksFor(
  book: Lorebook,
  entry: LoreEntry,
  input: ScanInput,
): { named: { source: string; text: string }[]; unknownSources: string[] } {
  const depth = entry.scanDepth ?? book.scanDepth;
  const messages = depth === 0 ? input.messages : input.messages.slice(0, Math.max(0, depth));

  const named = messages.map((text) => ({ source: 'message', text }));
  /**
   * **Every fed entry, unsliced** — see `ScanInput.recursed`. A depth counts
   * messages and there are none in a recursive pass; the loop is bounded by
   * `maxRecursionDepth` instead, which is the setting that means it.
   *
   * Named `entry` rather than `message`, because a hit here happened in another
   * entry's text and the surfaces that show *where* a key hit should not say
   * the conversation.
   */
  for (const text of input.recursed ?? []) named.push({ source: 'entry', text });
  const unknownSources: string[] = [];

  for (const name of entry.additionalMatchingSources) {
    const text = input.sources?.[name];
    if (text === undefined) unknownSources.push(name);
    else named.push({ source: name, text });
  }

  return { named, unknownSources };
}

/**
 * Adds a refusal once. A ledgered refusal comes back as the same object on
 * every haystack, so an entry names each refused key once, not once per message.
 */
function note(refused: PatternRefusal[], refusal: PatternRefusal | undefined): void {
  if (refusal !== undefined && !refused.includes(refusal)) refused.push(refusal);
}

/** The first key to hit anywhere, with where it hit, plus every refusal met. */
function firstHit(
  entry: LoreEntry,
  keys: readonly string[],
  haystacks: readonly { source: string; text: string }[],
  ledger: RegexLedger,
): { hit: KeyHit | null; refused: PatternRefusal[] } {
  const refused: PatternRefusal[] = [];

  for (const { source, text } of haystacks) {
    for (const key of keys) {
      const outcome = keyMatches(entry, key, text, ledger);
      note(refused, outcome.refusal);
      if (outcome.hit) {
        return {
          hit: { key, source, ...(outcome.at === undefined ? {} : { at: outcome.at }) },
          refused,
        };
      }
    }
  }
  return { hit: null, refused };
}

/**
 * Whether the secondary keys allow an entry whose primary key hit.
 *
 * The four logics are SillyTavern's `world_info_logic`, and the importer
 * records that its integers are **not** in the order our union lists them — so
 * these arms are named rather than indexed, and the converter is where the
 * decoding lives.
 *
 * **An empty secondary list is no condition at all**, whatever `selectiveLogic`
 * says, and this is the case the imported corpus forced. Both entries of the
 * SillyTavern fixture carry `selective: true` with an empty `keysecondary`;
 * read literally, `and_any` — *at least one secondary matched* — is vacuously
 * false and every one of those entries is dead. ST treats the empty list as
 * *nothing further to check*, the books were written against that, and a
 * matcher tested only on entries this repository wrote would have shipped the
 * literal reading and killed them.
 */
function secondaryAllows(
  entry: LoreEntry,
  haystacks: readonly { source: string; text: string }[],
  refused: PatternRefusal[],
  ledger: RegexLedger,
): boolean {
  if (!entry.selective || entry.secondaryKeys.length === 0) return true;

  const hits = entry.secondaryKeys.map((key) => {
    for (const { text } of haystacks) {
      const outcome = keyMatches(entry, key, text, ledger);
      note(refused, outcome.refusal);
      if (outcome.hit) return true;
    }
    return false;
  });

  switch (entry.selectiveLogic) {
    case 'and_any':
      return hits.includes(true);
    case 'and_all':
      return hits.every(Boolean);
    case 'not_any':
      return !hits.includes(true);
    default:
      return !hits.every(Boolean);
  }
}

/**
 * One entry against what it reads. `ledger` is the scan's, so a caller that
 * matches many entries passes one; alone, an entry gets its own.
 */
export function matchEntry(
  book: Lorebook,
  entry: LoreEntry,
  input: ScanInput,
  ledger: RegexLedger = newRegexLedger(),
): MatchResult {
  const { named, unknownSources } = haystacksFor(book, entry, input);

  if (entry.keys.length === 0) {
    return { outcome: 'no-keys', by: null, refused: [], unknownSources };
  }

  const { hit, refused } = firstHit(entry, entry.keys, named, ledger);
  if (hit === null) return { outcome: 'no-match', by: null, refused, unknownSources };

  return secondaryAllows(entry, named, refused, ledger)
    ? { outcome: 'matched', by: hit, refused, unknownSources }
    : { outcome: 'held-by-secondary', by: hit, refused, unknownSources };
}
