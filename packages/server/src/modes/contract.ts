// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

export type { ChannelDefinition } from '../sessions/channels.js';
export type { RandomApi, SiteRandom } from '../rng/random.js';
export type {
  StepDefinition,
  StepImplementation,
  StepInput,
  StepHost,
  StepResult,
} from '../turns/steps.js';

/**
 * Every engine type a mode is allowed to see, in one place.
 *
 * **This file is the relocation.** [P2 §2.4](../../../../docs/design/workplan/08-p2-implementation.md)
 * says the Scene mode lives in `server` now and moves behind the SDK at P7
 * *without changing shape* — and the thing that decides whether that is a move
 * or a rewrite is how many engine types the mode reached for. Enumerated here,
 * the answer is a fact anyone can read rather than a survey somebody has to run,
 * and the move becomes one file's import list.
 *
 * **The boundary is not enforced yet, and pretending otherwise would be worse
 * than admitting it.** `eslint.rules.js` does carry a `modes → sdk, shared`
 * policy, but it matches `packages/modes/*` — a package that does not exist —
 * so nothing stops a mode under `server/src/` importing whatever it likes. The
 * discipline here is a convention with a single choke point, which is the most
 * a stage that is explicitly not building the SDK boundary can honestly claim.
 *
 * Type-only, deliberately: a mode that imported a *value* from the engine would
 * be a mode that cannot be serialised across a worker hop.
 *
 * **And one import already breaks that rule**, which is worth saying here
 * rather than leaving for the day the build says it: `modes/scene/mode.ts`
 * takes `CLOCK_CHANNEL` — a value — straight from `sessions/channels.ts`,
 * because the definition lives engine-side to dodge a `const` cycle while the
 * mode owns the channel (`channels.ts` argues it from the other end). It is the
 * one production symbol that does not come through this file, and dissolving it
 * is what [P7.0](../../../../docs/design/workplan/23-p7-implementation.md)'s
 * move is really about.
 *
 * **`RandomApi` is here rather than `Rng` as of [P7.0].** `Rng` is a class with
 * `#private` fields, so no structural interface can stand in for it and a
 * contract published through the SDK could not name it at all — the conversion
 * this file's list forced, before any worker did. See
 * [`rng/random.ts`](../rng/random.ts).
 */
