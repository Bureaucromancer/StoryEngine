// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

export type { ChannelDefinition } from '../sessions/channels.js';
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
 * **This file is the relocation.** [P2 §2.4](../../../../docs/design/workplan/04-p2-implementation.md)
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
 */
