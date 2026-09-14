// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { RandomApi } from '@storyengine/sdk';

import type { Rng } from './rng.js';

/**
 * The engine's side of the host's `random` — [22 §4](../../../../docs/design/22-extensions.md),
 * [P7 §1.2](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **The interfaces live in `@storyengine/sdk` and the implementation lives
 * here**, which is the shape the whole boundary is: a mode is handed a
 * `RandomApi` and can name its type; only the engine can satisfy it, because
 * satisfying it means writing to the turn's tape. Re-exported below so the
 * engine's own import paths stay put — the same idiom `assembly/types.ts` uses
 * for the record's shapes.
 *
 * **Why a seam at all, rather than handing a step the `Rng`.** `StepHost`
 * carried `rng: Rng` from P2.5 to [P7.0], recorded as a debt throughout. It is
 * the **package split** that forced the conversion rather than the worker hop:
 * `Rng` is a class with `#private` fields, so no structural interface can stand
 * in for it, and the SDK may not import `server`
 * ([19 §10](../../../../docs/design/19-tech-stack.md)) — so a published contract
 * could not mention it at all, the alternative being to publish the tape
 * machinery as contract.
 *
 * **And it half-closes a hole `callPurposeFor` cannot.**
 * [06 §5.2](../../../../docs/design/06-modes-and-turn-pipeline.md)'s first
 * exclusion is *the RNG service and anything consuming it*, and the derivation
 * in `turns/steps.ts` does not cover it: a prose step was handed the guidance
 * and an `Rng` it could draw from. The draw is now the engine's, so there is a
 * seam to enforce the rule at; enforcing it structurally still waits on the
 * worker split.
 */

export type { RandomApi, SiteRandom } from '@storyengine/sdk';

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
