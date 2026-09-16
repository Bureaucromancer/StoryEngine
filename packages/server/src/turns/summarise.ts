// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type {
  Candidate,
  StepDefinition,
  StepHost,
  StepImplementation,
  StepInput,
} from '@storyengine/sdk';

import { ensureChain, type Summariser } from '../sessions/summaries.js';
import type {
  SummarisableTurn,
  SummaryLink,
  SummaryPolicy,
  SummaryUnit,
} from '../sessions/summary-chain.js';
import type { Layout } from '../storage/layout.js';

/**
 * The summariser — [07 §5.1](../../../../docs/design/07-branching.md),
 * [25 E1](../../../../docs/design/25-open-questions.md), [P8.1].
 *
 * **A step, and [P8 §1.3] is why it cannot also be the extractor.** Two
 * arguments, and the second is the one that is not about cost. `callPurposeFor`
 * derives a call's purpose from the step's own declaration, so a step that
 * contributed messages *and* wrote channels is one the derivation has no honest
 * answer for. And the two want **different payloads**: a step entitled to the
 * record that then writes to the library is
 * [08 §6](../../../../docs/design/08-cross-session-memory.md)'s spoiler failure
 * with the defence architecturally removed. *What can be shared is the call and
 * not the step*, which nothing here forecloses.
 *
 * ***It declines the record it is entitled to.*** §1.3 grants the summariser the
 * record, and this declares `reads: ['transcript']` — what was said and what
 * came back, and nothing about how either was produced. Summarising the *prompt*
 * would carry a hook's premise into every later prompt through the back door,
 * and the narrower payload costs this step nothing because a summary of a
 * session is a summary of its story.
 *
 * **The fifth engine-owned step**, after the hook selector, the mention pass,
 * the goal judge and the suggester — `turns/runner.ts` appends it the way it
 * appends those, and for the same reason: the chain is engine machinery like the
 * clock, not a narrative choice a mode makes. A mode that wants no summary
 * positions no summary slot, and the runner leaves the step out of the plan
 * entirely rather than running it to do nothing.
 *
 * ---
 *
 * ***What it does not do is as much of the design as what it does.*** It derives
 * nothing that is already on disk: `ensureChain` reads by content address first,
 * so a warm chain costs zero calls and a fork costs exactly the one link it
 * invalidated. **On a long session the steady-state cost is one call per turn
 * beyond the window** — the trailing link gains a unit and re-keys — and that
 * number is [P8 §1.3]'s denominator rather than a decision this file is making.
 * `SummariseReport.derived` is how it gets measured.
 */

export const SE_SUMMARY = 'se.summary';

export const SUMMARISE_STEP: StepDefinition = {
  id: SE_SUMMARY,
  /**
   * **`pre`, because the thing it produces goes into this turn's prompt.** The
   * hook selector is `pre` for the identical reason and is the precedent: a
   * `post` step's report reaches the next turn, and a summary that arrived a
   * turn late would be a chain permanently one link behind the story.
   */
  stage: 'pre',
  reads: ['transcript'],
  /**
   * Nothing. What this produces reaches the prompt through the runner, the way a
   * hook selection and a span set do — and a `writes` entry would be a claim
   * that a summary changes session state, which [08 §5] spends a section
   * refusing for memories and which is no less true of a summary.
   */
  writes: [],
  callKind: 'summarise',
  when: { when: 'cadence', everyNTurns: 1 },
  /**
   * **`warn`, never `abort`.** A summary is derived and disposable — that is
   * [P8]'s own safety argument — so a turn thrown away because a summariser
   * timed out would trade the story for a cache. A session with no chain has a
   * shorter prompt, which is the state every session was in before this phase.
   */
  failure: 'warn',
  /**
   * `prose`, for [25 C15]'s reason and `turns/suggest.ts`' precedent: nothing in
   * this build binds any role but that one and `resolveRole` has no cross-role
   * fallback, so asking for `fast` would make every long session log a failed
   * step. **An install that wants something cheaper says so through the
   * session's `stepRoles`** — and because the resolved binding is in every
   * summary key, saying so re-derives the chain rather than silently mixing two
   * models' prose.
   */
  role: 'prose',
};

export interface SummariseReport {
  /** Oldest first. What the collector positions, if the preset has a slot. */
  links: readonly SummaryLink[];
  /** How many needed a model call. Zero on a warm chain — [P8 §1.3]. */
  derived: number;
}

export interface SummariseContext {
  layout: Layout;
  handle: string;
  sessionId: string;
  /** `span` and the mode's `historyWindow`, resolved by the caller. */
  policy: SummaryPolicy;
  /**
   * The resolved summariser's identity — `summariserKey`'s output.
   *
   * **Computed by the runner, which is the only place that can.** The key is the
   * *resolved* binding plus the prompt plus the parameters ([P8 §1.9]), and
   * resolving a role needs the account's bindings, the install defaults and the
   * session's overrides. A step has none of those and should not: `StepHost`
   * gives it `call` and deliberately nothing that would let it know which model
   * answered.
   */
  key: string;
  report: (report: SummariseReport) => void;
}

/**
 * ***What it asks for, and the two things it is told not to do.***
 *
 * A link is `f(previous link, the turns since)`, so the prompt hands over both
 * and asks for their union. **Continuity is the whole job**: a link that
 * restarts the story from its own window would make the chain a list of
 * disconnected paragraphs, which is exactly the blob
 * [08 §2.1](../../../../docs/design/08-cross-session-memory.md) argues against
 * for memories and is no better here.
 *
 * *Do not invent* is worth stating to a model asked to compress: a summariser
 * that smooths over a gap produces a prompt that asserts something that never
 * happened, and — because the chain is a chain — every later link inherits it.
 *
 * *Do not address anyone*, because this text lands in a prompt as context and
 * not as narration. A summary written in the second person reads as a turn.
 */
export const SUMMARISE_PROMPT = [
  'Summarise what has happened in this story so far.',
  '',
  'You are given the summary of everything before this point, then the turns since.',
  'Write a single continuous summary covering both, in the past tense.',
  'Keep every fact, name, place and decision that a later scene might depend on.',
  'Drop description, atmosphere and anything already implied by what you keep.',
  'Do not invent anything that is not in the material, and do not address the reader.',
  'Aim for one short paragraph per twenty turns covered.',
].join('\n');

/**
 * The chain as a step — appended to the plan by `turns/runner.ts`.
 *
 * Returns `{}`: this contributes no candidates and proposes no effects. What it
 * produces reaches the collector through `context.report`, which is the shape
 * the selector, the mention pass, the judge and the suggester all use.
 */
export function summarise(context: SummariseContext): {
  definition: StepDefinition;
  run: StepImplementation;
} {
  return {
    definition: SUMMARISE_STEP,
    run: async (input: StepInput, host: StepHost) => {
      /**
       * `transcript` to the chain's own shape. The one field that changes name
       * is the identity — a `TranscriptTurn` calls it `turnId` because it is a
       * reference, and a `Turn` calls it `id` because it is the thing.
       */
      const path: SummarisableTurn[] = (input.transcript ?? []).map((turn) => ({
        id: turn.turnId,
        ...(turn.input === undefined ? {} : { input: { text: turn.input.text } }),
        ...(turn.output === undefined ? {} : { output: { text: turn.output.text } }),
      }));

      const summariser: Summariser = {
        key: context.key,
        run: async ({ previous, units }) => {
          const result = await host.call({
            candidates: [
              block('se.summary.task', 'system', SUMMARISE_PROMPT),
              ...(previous === null ? [] : [block('se.summary.previous', 'user', previous)]),
              block('se.summary.turns', 'user', renderUnits(units)),
            ],
          });
          return result.text.trim();
        },
      };

      const chain = await ensureChain(
        context.layout,
        context.handle,
        context.sessionId,
        path,
        summariser,
        context.policy,
      );
      context.report({ links: chain.links, derived: chain.derived });
      return {};
    },
  };
}

/**
 * The turns a link covers, as one block.
 *
 * **Reads `said` and `replied` rather than the unit's key input**, which is the
 * separation `SummaryUnit` exists to keep: the digest's encoding is canonical
 * and unambiguous, and the model's is readable. A prompt rewrite must never be
 * able to invalidate a chain, and it cannot when the two do not share a field.
 *
 * The player's line is quoted and the reply is not, so a model can tell an
 * instruction from narration without being told which is which.
 */
function renderUnits(units: readonly SummaryUnit[]): string {
  return units
    .map((unit) =>
      [unit.said === '' ? '' : `> ${unit.said}`, unit.replied]
        .filter((line) => line !== '')
        .join('\n'),
    )
    .filter((turn) => turn !== '')
    .join('\n\n');
}

/**
 * *A local helper, like the judge's, the selector's and the suggester's.* The
 * fourth, and the repetition is still deliberate: what would be shared is a
 * `reason` string, which is author-facing English about **this** step and is the
 * one part that must not be.
 */
function block(id: string, role: 'system' | 'user', text: string): Candidate {
  return {
    id,
    source: { kind: 'step', stepId: SE_SUMMARY },
    reason: 'the story so far',
    role,
    text,
    required: true,
  };
}
