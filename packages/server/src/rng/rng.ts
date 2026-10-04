// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Draw, DrawKind, Tape } from '@storyengine/shared';

import { parseDice } from './dice.js';
import { cryptoSource, type RandomSource } from './source.js';

/**
 * The one place random numbers come from —
 * [20 §14](../../../../docs/design/20-tech-stack.md).
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
 * ([20 §14.5](../../../../docs/design/20-tech-stack.md)): replay the tape for
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
  /** `Draw.message` for the draws being made now — see {@link speaking}. */
  #message: number | undefined;

  constructor(options: RngOptions = {}) {
    this.#source = options.source ?? cryptoSource;
    this.#replay = new Map((options.replay ?? []).map((draw) => [draw.key, draw]));
  }

  /** Draws for one site and purpose. Indices within it are automatic. */
  at(site: string, purpose: string): SiteRng {
    return new SiteRng(this, site, purpose);
  }

  /**
   * ***Tags the draws `task` makes with the round message they are for*** —
   * `Draw.message`, 2026-09-29 at the [P14.4] review. **Synchronous on
   * purpose**: the tag is this object's state while `task` runs, and a task
   * that awaited could lend it to a draw made elsewhere meanwhile. The runner
   * wraps a speaking call's lore retrieval, which is synchronous, and nothing
   * else. `undefined` tags nothing, so a call that speaks for nobody passes
   * straight through.
   */
  speaking<T>(message: number | undefined, task: () => T): T {
    const before = this.#message;
    this.#message = message;
    try {
      return task();
    } finally {
      this.#message = before;
    }
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

  /**
   * @internal Used by {@link SiteRng}; not part of the caller-facing API.
   *
   * `usable` is the second half of the replay guard, added at [P6.2]. `kind`
   * and `detail` ask *was this the same question*; `usable` asks *is the
   * recorded answer still one of the available answers*, which only the caller
   * can know. A draw whose value is a position into caller data — or an
   * identity from it — is meaningless against a list that has changed, and
   * without this the guard would accept it and mark it `replayed: true`.
   */
  draw<T>(
    site: string,
    purpose: string,
    kind: DrawKind,
    detail: string,
    produce: (source: RandomSource) => T,
    usable?: (recorded: unknown) => boolean,
  ): T {
    const counterKey = `${site}:${purpose}`;
    const index = this.#counters.get(counterKey) ?? 0;
    this.#counters.set(counterKey, index + 1);
    const key = `${counterKey}#${String(index)}`;

    const recorded = this.#replay.get(key);
    // A replayed draw has to be the *same kind* of draw, or the tape is being
    // read against a different question — `d20 → 7` handed to a `pick` is the
    // positional-tape failure wearing a key.
    // This turn's tag, never the recorded one: the tape says which of *this*
    // turn's messages a draw was for.
    const tag = this.#message === undefined ? {} : { message: this.#message };
    if (
      recorded?.kind === kind &&
      recorded.detail === detail &&
      (usable?.(recorded.value) ?? true)
    ) {
      const draw: Draw = { ...recorded, replayed: true };
      delete draw.message;
      this.#tape.push({ ...draw, ...tag });
      return recorded.value as T;
    }

    const value = produce(this.#source);
    this.#tape.push({ key, site, purpose, index, kind, detail, value, replayed: false, ...tag });
    return value;
  }
}

/**
 * ***The tape a rewrite swipe from message `from` replays*** — 2026-09-29, at
 * the [P14.4] review.
 *
 * A swipe's first speaking call is the one that writes message *k*, so keys
 * counted from 0 across the turn line its draws up with **call 0's** in the
 * original: message *k* was handed message 0's lore rolls, and the tape
 * marked them `replayed`. Here the draws calls `0..k-1` made (`Draw.message`
 * below `from`) are dropped — the swipe carries those messages and makes none
 * of their calls — and each site's remaining draws are renumbered from 0 in
 * the order they were made, which is the order the swipe makes them: the
 * turn-wide draws before the round, then call *k*'s, then the rest.
 *
 * ***A tape with no tag at all*** was recorded before the tag existed, so which
 * lore draw belonged to which call cannot be read off it. Its `lore.*` draws
 * are dropped — call *k* then draws fresh, a reroll of its lore, which is
 * honest where handing it another call's rolls was not — and every other draw
 * is kept as it was. `from` 0 is the whole turn's tape, unchanged.
 */
export function swipeReplay(tape: Tape, from: number): Tape {
  if (from <= 0) return tape;
  const tagged = tape.some((draw) => draw.message !== undefined);
  const kept = tape.filter((draw) =>
    tagged ? draw.message === undefined || draw.message >= from : !draw.site.startsWith('lore.'),
  );
  const counters = new Map<string, number>();
  return kept.map((draw) => {
    const counterKey = `${draw.site}:${draw.purpose}`;
    const index = counters.get(counterKey) ?? 0;
    counters.set(counterKey, index + 1);
    return { ...draw, index, key: `${counterKey}#${String(index)}` };
  });
}

/**
 * The eight draws, at one site.
 *
 * The list is [20 §14.2](../../../../docs/design/20-tech-stack.md)'s, and it is
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

  /**
   * One of `items`, uniformly.
   *
   * **The same hazard `weightedPick` was fixed for is open here, and nothing
   * can reach it** — [P6.2]. `detail` is `n=<length>`, which describes the
   * list's size and not its membership, so a replay against a list of the same
   * length hands back a position into different content. There is no
   * production caller: the two draw sites are the retriever's, and both are
   * `chance` and `weightedPick`. Closing it means what closing that one meant —
   * the caller naming its candidates — and doing that to a uniform pick over a
   * list of strings would be ceremony for a hazard nobody can trigger. The
   * first production caller is where it gets paid for, and `draw`'s `usable`
   * gate is the mechanism waiting for it. `shuffle` below is the same sentence.
   */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() needs something to pick from.');
    // The *index* is the drawn value, not the item: an index survives a
    // round trip through JSON, and an arbitrary item may not.
    const index = this.#draw('pick', `n=${String(items.length)}`, (source) =>
      source.intBelow(items.length),
    );
    return items[index] as T;
  }

  /**
   * Weighted by `weight`. Zero-weight entries are never chosen.
   *
   * **The winner's id is the recorded value, not its position** — [P6.2], and
   * the reason is the one failure a positional tape has left: `detail` is
   * `total=<summed weight>`, which describes the *shape* of the contest and not
   * its membership. A group whose members changed without changing the sum —
   * one entry swapped for another of equal weight, or the scan order moved —
   * replayed the old index onto a **different entry** and reported
   * `replayed: true` while doing it. [P6 §0.1a] found it before anything could
   * construct a replaying `Rng`; [P6.2] is the stage that does, so it is fixed
   * before the thing that would have suffered from it exists.
   *
   * An id also makes the record legible in the way `detail` is meant to be:
   * *this entry won*, rather than *index two won* of a list nobody kept.
   *
   * **Replay is refused when the winner is no longer a candidate**, or when its
   * weight has been zeroed — which is this method's own promise, kept under
   * replay rather than only on a first run. A refusal is a fresh draw, which is
   * what a rewrite down a genuinely different path is supposed to do.
   */
  weightedPick<T>(items: readonly { id: string; value: T; weight: number }[]): T {
    const total = items.reduce((sum, item) => sum + Math.max(item.weight, 0), 0);
    if (items.length === 0 || total <= 0) {
      throw new RangeError('weightedPick() needs at least one entry with a positive weight.');
    }

    const won = this.#draw(
      'weightedPick',
      `total=${String(total)}`,
      (source) => {
        let roll = source.float() * total;
        for (const item of items) {
          roll -= Math.max(item.weight, 0);
          if (roll < 0) return item.id;
        }
        // Only reachable through floating-point drift at the very top of the
        // range; the last positive-weight entry is the honest answer.
        return items.findLast((item) => item.weight > 0)?.id;
      },
      (recorded) => items.some((item) => item.id === recorded && item.weight > 0),
    );

    return items.find((item) => item.id === won)?.value as T;
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

  #draw<T>(
    kind: DrawKind,
    detail: string,
    produce: (source: RandomSource) => T,
    usable?: (recorded: unknown) => boolean,
  ): T {
    return this.#rng.draw(this.#site, this.#purpose, kind, detail, produce, usable);
  }
}
