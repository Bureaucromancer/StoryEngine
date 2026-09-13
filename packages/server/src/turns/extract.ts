// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { StepDefinition, StepImplementation } from '@storyengine/sdk';
import type { TextSpan } from '@storyengine/shared';

import { SE_HOOK } from '../sessions/hooks.js';
import { mentionSpans, namedIn, type Mentionable } from './mentions.js';

/**
 * The `extract` stage — what the engine understood about the turn's text
 * ([06 §8.2](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [03 §8](../../../../docs/design/03-data-model.md)), built at
 * [P7.7](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***The first `extract` step in the build.*** `StepStage` has carried the arm
 * since P2 with nothing declaring it, which is the shape this phase keeps
 * refusing — and [06 §8.2] named the pass that would fill it: *"mention
 * resolution is an extract step."*
 *
 * **It makes no model call, and that is the design rather than a saving.**
 * [P7.7] ships `explicit` and `matched`; both are findings of a **scanner**, and
 * the arm that would need a model — `proposed` — is the one §P7.7 defers on
 * purpose: *"`proposed` may follow, but the span overlay and the
 * never-auto-create rule land now."*
 *
 * ***And it closes [P7.5]'s fourth property row.*** [06 §6.1] leaves an
 * introduction hook *provisionally fired* until *"the extract stage confirms the
 * subject present on that turn; unconfirmed, it returns to the pool with the
 * attempt on the record"*. The confirmation is a **read of the overlay this same
 * step produced**, so the panel's highlight and the hook's fate are the same
 * finding rather than two scans that could disagree.
 */

export const SE_EXTRACT_MENTIONS = 'se.mentions';

export const MENTIONS_STEP: StepDefinition = {
  id: SE_EXTRACT_MENTIONS,
  stage: 'extract',
  /**
   * `output` for the prose, and no channels: who the cast **is** comes from the
   * gather, resolved once per turn, so a step reading presence here would be a
   * second answer to a question `resolveCast` already settled.
   */
  reads: ['output'],
  /**
   * `se.hook`, because confirming an introduction is what this step decides —
   * even though the **write** goes through the runner, since `se.hook` is
   * `engine-computed` and refuses a step. Declaring it anyway is the honest
   * statement of what the step is *for*, and it is what `callPurposeFor` reads:
   * a non-empty `writes` keeps guidance out of a call this step might make.
   */
  writes: [SE_HOOK],
  callKind: 'extract',
  when: { when: 'cadence', everyNTurns: 1 },
  /**
   * **`warn`, and the consequence is stated where it bites.** The prose exists
   * by the time this runs, so a failure costs an overlay rather than a turn —
   * and an introduction whose confirmation could not run stays **provisional**
   * rather than being marked fired, which is the under-firing direction
   * [06 §6.1] chooses everywhere.
   */
  failure: 'warn',
  /** No call, so no role to resolve. */
  role: null,
};

export interface ExtractReport {
  spans: TextSpan[];
  /**
   * Whether the introduction this turn fired actually arrived — `null` when the
   * turn fired none.
   */
  introduced: { hookId: string; confirmed: boolean } | null;
  /**
   * Provisional firings from **earlier** turns, resolved — confirmed if the
   * subject turned up now, and otherwise back in the pool.
   *
   * *This is the recovery path rather than the main one.* A firing is confirmed
   * on its own turn; a firing whose turn could not answer — the step failed, or
   * a build before this one wrote it — would otherwise be stuck `pending`
   * forever, because nothing else ever looks at it again.
   */
  resolved: { hookId: string; confirmed: boolean }[];
}

export interface ExtractContext {
  /**
   * ***Resolved when the step runs, not when the plan is built.*** The subject
   * of an introduction is whatever the **selector** fired this turn, and the
   * selector runs at `pre` — inside the loop this step is a member of. A context
   * built eagerly would read the selector's report before it was written and
   * scan for nobody, which is exactly the turn the scan exists for.
   *
   * *Measured rather than reasoned to: it did, and the provisional firing it was
   * supposed to confirm stayed provisional.*
   */
  subjects: () => {
    /** The session cast, plus any subject an introduction is trying to bring in. */
    cast: readonly Mentionable[];
    /** The introduction this turn fired, if it fired one. */
    introducing: { hookId: string; actorId: string } | null;
    /** Provisional firings already on the record, with the actor each names. */
    pending: readonly { hookId: string; actorId: string }[];
  };
  report: (report: ExtractReport) => void;
}

export function extractMentions(context: ExtractContext): {
  definition: StepDefinition;
  run: StepImplementation;
} {
  return {
    definition: MENTIONS_STEP,
    run: (input) => {
      const { cast, introducing, pending } = context.subjects();
      const text = input.output?.text ?? '';
      const spans = text === '' ? [] : mentionSpans(text, 'output', cast);

      context.report({
        spans,
        introduced:
          introducing === null
            ? null
            : { hookId: introducing.hookId, confirmed: namedIn(spans, introducing.actorId) },
        resolved: pending.map((one) => ({
          hookId: one.hookId,
          confirmed: namedIn(spans, one.actorId),
        })),
      });
      return Promise.resolve({});
    },
  };
}
