// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { Rng } from './rng.js';

/**
 * Randomness as the **host** offers it to a step — [22 §4](../../../../docs/design/22-extensions.md),
 * [P7 §1.2](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **Why this exists rather than handing a step the `Rng` itself.** `StepHost`
 * carried `rng: Rng` from P2.5 to here, and that was always recorded as a debt:
 * [22 §4] specifies the host API as async and narrow with `random` supplied by
 * the host, and `steps.test.ts` named the mismatch as *the one thing on
 * `StepHost` that cannot cross a worker hop*. Two things forced it now rather
 * than at the hop.
 *
 * **It is the package split that forces it, not the worker.** `Rng` is a class
 * with `#private` fields, so no structural interface can stand in for it, and
 * `packages/sdk` may not import `server` ([19 §10](../../../../docs/design/19-tech-stack.md)).
 * A contract published through the SDK therefore cannot mention `Rng` at all —
 * the alternative being to publish the tape machinery as contract, which is the
 * engine's business and nobody else's. So the conversion is owed the moment the
 * mode is a package, with or without a hop.
 *
 * **And it closes a hole `callPurposeFor` cannot.**
 * [06 §5.2](../../../../docs/design/06-modes-and-turn-pipeline.md)'s first
 * exclusion is *the RNG service and anything consuming it*, and the derivation
 * in `turns/steps.ts` does not cover it: a prose step is handed the guidance and
 * — until now — an `Rng` it could draw from. With the draw behind the host, the
 * engine is the one making it, which is where the rule can be enforced rather
 * than remembered.
 *
 * ## What is deliberately unchanged
 *
 * **Every draw still carries a site and a purpose**, because
 * [rng.ts](./rng.ts)'s invariant is an API property rather than a convention:
 * *"There is deliberately no unkeyed draw: a draw with no site cannot be
 * replayed, and an API that allowed one would be an API whose invariant depends
 * on remembering."* A host API that offered a bare `random(): Promise<number>`
 * would hand extensions the one shape [19 §14](../../../../docs/design/19-tech-stack.md)
 * forbids, and adding the keys afterwards would be this conversion paid twice —
 * with a window in between where a mode's draws are unreplayable and rewrite,
 * the default swipe gesture, silently diverges.
 *
 * **The method set is `SiteRng`'s, unchanged.** The point of this file is the
 * *shape* of the seam — async, keyed, and free of class instances — not a new
 * vocabulary. `pick`'s membership hazard and `weightedPick`'s id-keyed replay
 * are the engine's, argued where they live, and they do not change by being
 * reached through an interface.
 */
export interface RandomApi {
  /**
   * Draws for one site and purpose.
   *
   * **Not async, and that is the design rather than an oversight.** `at` makes
   * no draw — it names one — so across a worker hop it is implemented on the
   * *worker's* side of the seam as a local constructor closing over the two
   * strings, and only the draws below become messages. Making it async would
   * put an `await` at every call site in exchange for nothing, and would put a
   * round trip in front of a step that names a site and then decides not to
   * draw.
   */
  at(site: string, purpose: string): SiteRandom;
}

/**
 * The draws themselves, asynchronous because each one is a message once the
 * step runs somewhere else.
 *
 * Every method mirrors {@link SiteRng}'s of the same name and defers to it for
 * what the draw *means*; what this adds is the return type. Nothing here holds
 * state: a `SiteRandom` is a name for a site, and the tape it writes to belongs
 * to the turn.
 */
export interface SiteRandom {
  /** A uniform integer in `[min, max]`, both ends included. */
  int(min: number, max: number): Promise<number>;
  /** A uniform float in `[0, 1)`. */
  float(): Promise<number>;
  bool(): Promise<boolean>;
  /** True with probability `p`. `chance(0)` is never and `chance(1)` is always. */
  chance(p: number): Promise<boolean>;
  /** One of `items`, uniformly. See {@link SiteRng.pick} for the open hazard. */
  pick<T>(items: readonly T[]): Promise<T>;
  /** Weighted by `weight`; the winner's id is what the tape records. */
  weightedPick<T>(items: readonly { id: string; value: T; weight: number }[]): Promise<T>;
  /** A new array, shuffled. The input is not touched. */
  shuffle<T>(items: readonly T[]): Promise<T[]>;
  /** `2d6+3`. Returns the total; the individual dice are on the tape. */
  dice(notation: string): Promise<number>;
}

/**
 * The host's `random`, over the turn's `Rng`.
 *
 * **An adapter and not a reimplementation**, which is the whole of its claim:
 * every draw lands on the same tape, keyed the same way, with the same replay
 * semantics, because it *is* the same draw. The asynchrony is the seam's and
 * not the service's — there is no worker yet, so these resolve immediately, and
 * the day there is one this is the file that grows a message rather than every
 * step growing an `await` it does not have.
 *
 * **The engine keeps drawing synchronously**, and that is deliberate. The
 * retriever draws inside a step's `call` closure ([P5.6]) — engine-side of this
 * seam, never from a mode's own body — and converting `Rng` itself would have
 * meant sixteen signatures, sixty call sites and four property tests converted
 * to `fc.asyncProperty`, in exchange for nothing the boundary asks for. It
 * would also have cost the ordering guarantee the tape's index depends on:
 * `Rng.draw` numbers a draw by arrival within its site, and synchronous methods
 * are what make that arrival order structural rather than incidental.
 */
export function randomOver(rng: Rng): RandomApi {
  return {
    at(site, purpose) {
      const site_ = rng.at(site, purpose);
      return {
        int: (min, max) => Promise.resolve(site_.int(min, max)),
        float: () => Promise.resolve(site_.float()),
        bool: () => Promise.resolve(site_.bool()),
        chance: (p) => Promise.resolve(site_.chance(p)),
        pick: (items) => Promise.resolve(site_.pick(items)),
        weightedPick: (items) => Promise.resolve(site_.weightedPick(items)),
        shuffle: (items) => Promise.resolve(site_.shuffle(items)),
        dice: (notation) => Promise.resolve(site_.dice(notation)),
      };
    },
  };
}
