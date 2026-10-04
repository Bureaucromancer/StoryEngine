// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * Randomness as the host offers it — [23 §4](../../../docs/design/23-extensions.md).
 *
 * **Why the contract names this and not the engine's `Rng`.** `Rng` is a class
 * with `#private` fields, so no structural interface can stand in for it, and
 * this package may not import `server` ([20 §10](../../../docs/design/20-tech-stack.md))
 * — publishing it would mean publishing the tape machinery as contract, which
 * is the engine's business and nobody else's. So the seam is an interface and
 * the service stays behind it, which is also what makes the worker split a
 * change to one file rather than to every step that draws.
 *
 * **Every draw carries a site and a purpose, and that is not negotiable.** The
 * engine's rule is an API property rather than a convention — *a draw with no
 * site cannot be replayed, and an API that allowed one would be an API whose
 * invariant depends on remembering* — and
 * [20 §14](../../../docs/design/20-tech-stack.md) puts an extension's draws on
 * the same tape as the engine's. A host API offering a bare
 * `random(): Promise<number>` would hand every extension author the one shape
 * that makes a session unreplayable.
 */
export interface RandomApi {
  /**
   * Draws for one site and purpose.
   *
   * **Not async, deliberately.** `at` names a draw rather than making one, so
   * on the far side of a worker hop it is a local constructor closing over two
   * strings and only the draws below are messages. Making it async would put a
   * round trip in front of a step that names a site and then decides not to
   * draw, and an `await` at every call site in exchange for nothing.
   */
  at(site: string, purpose: string): SiteRandom;
}

/**
 * The draws themselves, asynchronous because each one is a message once the
 * step runs somewhere else.
 *
 * Nothing here holds state: a `SiteRandom` is a name for a site, and the tape it
 * writes to belongs to the turn.
 */
export interface SiteRandom {
  /** A uniform integer in `[min, max]`, both ends included. */
  int(min: number, max: number): Promise<number>;
  /** A uniform float in `[0, 1)`. */
  float(): Promise<number>;
  bool(): Promise<boolean>;
  /** True with probability `p`. `chance(0)` is never and `chance(1)` is always. */
  chance(p: number): Promise<boolean>;
  /**
   * One of `items`, uniformly.
   *
   * **The open hazard, stated where an author will read it:** what the tape
   * records for a `pick` is the list's *length*, not its membership, so a
   * replay against a different list of the same length hands back a position
   * into different content. Closing it means the caller naming its candidates,
   * which is what `weightedPick` already does — so prefer that one when the
   * items have ids and the replay has to be honest.
   */
  pick<T>(items: readonly T[]): Promise<T>;
  /**
   * Weighted by `weight`; zero-weight entries are never chosen.
   *
   * **The winner's id is what the tape records**, not its position, and a
   * replay is refused — drawn fresh — when that winner is no longer a candidate
   * or its weight has been zeroed. That refusal is the method's promise kept
   * under replay rather than only on a first run.
   */
  weightedPick<T>(items: readonly { id: string; value: T; weight: number }[]): Promise<T>;
  /** A new array, shuffled. The input is not touched. */
  shuffle<T>(items: readonly T[]): Promise<T[]>;
  /** `2d6+3`. Returns the total; the individual dice are on the tape. */
  dice(notation: string): Promise<number>;
}
