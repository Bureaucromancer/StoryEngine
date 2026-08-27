// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Draw, DrawKind, Tape } from '@storyengine/shared';

import { parseDice } from './dice.js';
import { cryptoSource, type RandomSource } from './source.js';

/**
 * The one place random numbers come from —
 * [07 §14](../../../../docs/design/07-tech-stack.md).
 *
 * **Singular is a correctness property, not tidiness.** Three things rest on
 * it: replay and branching, because state at turn N must stay a pure function
 * of the effect log and a caller drawing its own unrecorded number breaks that
 * silently — the symptom arriving much later as a branch that reconstructs
 * wrong. Auditability, because *"was that roll fair?"* is a question players
 * genuinely ask and one source with every draw logged is a complete answer.
 * And testability, because it is one seam.
 *
 * **The API has to be complete or it will be bypassed.** If this does not offer
 * what a caller needs they will reach for `Math.random()` and the invariant is
 * gone, so completeness here is a correctness requirement rather than a
 * convenience.
 *
 * ## The tape
 *
 * Every draw is recorded, and a turn carries the tape of what it consumed. That
 * is what makes **rewrite** and **reroll** two different operations
 * ([07 §14.5](../../../../docs/design/07-tech-stack.md)): replay the tape for
 * the same mechanical outcome and different prose, or draw fresh for a new
 * outcome. Rewrite is the default, which is what stops swiping from being
 * save-scumming by accident — fail a check, swipe, succeed.
 *
 * Built now although nothing rerolls until P6, because the tape is part of the
 * turn record and a record without it cannot support rewrite later.
 *
 * ## Keyed by site, never by position
 *
 * A positional tape — *"the fifth draw"* — desynchronises the moment a rewrite
 * takes a slightly different path, and then a value drawn for a lore
 * probability is handed to a skill check. So each draw carries a stable key:
 * a site, a purpose, and an index within that site. Replay looks up by key and
 * **draws fresh on a miss**, which makes partial replay well-defined when a
 * path genuinely differs — and the record marks which draws were replayed and
 * which were fresh, so a rewrite that partly diverged says so.
 */

// The tape's shapes moved to `@storyengine/shared` at [P3.0] — the tape is
// part of the turn record, and the record's shapes live together. The `Rng`
// that produces draws stays here: shared is pure types, and randomness is
// exactly the runtime behaviour it refuses to hold.
export type { Draw, DrawKind, Tape } from '@storyengine/shared';

export interface RngOptions {
  /** Defaults to `node:crypto`. A test or a fixture supplies its own. */
  source?: RandomSource;
  /**
   * A previous turn's tape to replay. Present means rewrite; absent means
   * reroll, which is also what an ordinary first run is.
   */
  replay?: Tape;
}

/**
 * The service. One per turn — the tape belongs to a turn, and so does this.
 *
 * Draws are made through {@link at}, which is what supplies the key. There is
 * deliberately no unkeyed draw: a draw with no site cannot be replayed, and an
 * API that allowed one would be an API whose invariant depends on remembering.
 */
export class Rng {
  readonly #source: RandomSource;
  readonly #replay: Map<string, Draw>;
  readonly #tape: Tape = [];
  readonly #counters = new Map<string, number>();

  constructor(options: RngOptions = {}) {
    this.#source = options.source ?? cryptoSource;
    this.#replay = new Map((options.replay ?? []).map((draw) => [draw.key, draw]));
  }

  /** Draws for one site and purpose. Indices within it are automatic. */
  at(site: string, purpose: string): SiteRng {
    return new SiteRng(this, site, purpose);
  }

  /** The turn's tape, in draw order. */
  get tape(): Tape {
    return this.#tape;
  }

  /** True when any draw was taken from the tape — the rewrite half of a rewrite. */
  get replayedAny(): boolean {
    return this.#tape.some((draw) => draw.replayed);
  }

  /**
   * True when a replay was asked for and some draw missed it.
   *
   * The honest signal for *"this rewrite partly diverged"*: the path took a
   * turn the tape did not have, so some of the outcome is genuinely new.
   */
  get diverged(): boolean {
    return this.#replay.size > 0 && this.#tape.some((draw) => !draw.replayed);
  }

  /** @internal Used by {@link SiteRng}; not part of the caller-facing API. */
  draw<T>(
    site: string,
    purpose: string,
    kind: DrawKind,
    detail: string,
    produce: (source: RandomSource) => T,
  ): T {
    const counterKey = `${site}:${purpose}`;
    const index = this.#counters.get(counterKey) ?? 0;
    this.#counters.set(counterKey, index + 1);
    const key = `${counterKey}#${String(index)}`;

    const recorded = this.#replay.get(key);
    // A replayed draw has to be the *same kind* of draw, or the tape is being
    // read against a different question — `d20 → 7` handed to a `pick` is the
    // positional-tape failure wearing a key.
    if (recorded?.kind === kind && recorded.detail === detail) {
      this.#tape.push({ ...recorded, replayed: true });
      return recorded.value as T;
    }

    const value = produce(this.#source);
    this.#tape.push({ key, site, purpose, index, kind, detail, value, replayed: false });
    return value;
  }
}

/**
 * The eight draws, at one site.
 *
 * The list is [07 §14.2](../../../../docs/design/07-tech-stack.md)'s, and it is
 * a floor rather than a wish: `dice` and `chance` are needed by the authored
 * rules vocabulary, and `weightedPick` covers loot-table shapes, which is
 * exactly where somebody would otherwise improvise with `Math.random()`.
 */
export class SiteRng {
  readonly #rng: Rng;
  readonly #site: string;
  readonly #purpose: string;

  constructor(rng: Rng, site: string, purpose: string) {
    this.#rng = rng;
    this.#site = site;
    this.#purpose = purpose;
  }

  /** A uniform integer in `[min, max]`, both ends included. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`int(${String(min)}, ${String(max)}) is not a range.`);
    }
    return this.#draw(
      'int',
      `${String(min)}..${String(max)}`,
      (source) => min + source.intBelow(max - min + 1),
    );
  }

  /** A uniform float in `[0, 1)`. */
  float(): number {
    return this.#draw('float', '0..1', (source) => source.float());
  }

  bool(): boolean {
    return this.#draw('bool', 'p=0.5', (source) => source.intBelow(2) === 1);
  }

  /** True with probability `p`. `chance(0)` is never and `chance(1)` is always. */
  chance(p: number): boolean {
    if (!(p >= 0 && p <= 1)) {
      throw new RangeError(`chance(${String(p)}) is not a probability.`);
    }
    return this.#draw('chance', `p=${String(p)}`, (source) => source.float() < p);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() needs something to pick from.');
    // The *index* is the drawn value, not the item: an index survives a
    // round trip through JSON, and an arbitrary item may not.
    const index = this.#draw('pick', `n=${String(items.length)}`, (source) =>
      source.intBelow(items.length),
    );
    return items[index] as T;
  }

  /** Weighted by `weight`. Zero-weight entries are never chosen. */
  weightedPick<T>(items: readonly { value: T; weight: number }[]): T {
    const total = items.reduce((sum, item) => sum + Math.max(item.weight, 0), 0);
    if (items.length === 0 || total <= 0) {
      throw new RangeError('weightedPick() needs at least one entry with a positive weight.');
    }

    const index = this.#draw('weightedPick', `total=${String(total)}`, (source) => {
      let roll = source.float() * total;
      for (const [at, item] of items.entries()) {
        roll -= Math.max(item.weight, 0);
        if (roll < 0) return at;
      }
      // Only reachable through floating-point drift at the very top of the
      // range; the last positive-weight entry is the honest answer.
      return items.findLastIndex((item) => item.weight > 0);
    });
    return items[index]?.value as T;
  }

  /** A new array, shuffled. The input is not touched. */
  shuffle<T>(items: readonly T[]): T[] {
    // The *permutation* is the recorded value, so a replay reproduces the order
    // rather than re-running Fisher-Yates against a possibly different list.
    const order = this.#draw('shuffle', `n=${String(items.length)}`, (source) => {
      const indices = items.map((_item, index) => index);
      for (let at = indices.length - 1; at > 0; at -= 1) {
        const swap = source.intBelow(at + 1);
        // Written out rather than destructured: the array is dense by
        // construction, so the `??` fallbacks are unreachable — but they are
        // cheaper than the two lint rules that disagree about how to assert
        // that, one wanting `!` and the other forbidding it.
        const held = indices[at] ?? at;
        indices[at] = indices[swap] ?? swap;
        indices[swap] = held;
      }
      return indices;
    });
    return order.map((index) => items[index] as T);
  }

  /** `2d6+3`. Returns the total; the individual dice are on the tape. */
  dice(notation: string): number {
    const parsed = parseDice(notation);
    const rolls = this.#draw('dice', parsed.source, (source) =>
      Array.from({ length: parsed.count }, () => source.intBelow(parsed.sides) + 1),
    );
    return rolls.reduce((sum, roll) => sum + roll, 0) + parsed.modifier;
  }

  #draw<T>(kind: DrawKind, detail: string, produce: (source: RandomSource) => T): T {
    return this.#rng.draw(this.#site, this.#purpose, kind, detail, produce);
  }
}
